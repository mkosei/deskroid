const { app, BrowserWindow, ipcMain, Menu, screen, globalShortcut, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { ROUTER_PROMPT, buildTools, runTool, resultNote } = require('./tools');
const { MODEL_FILTERS, importModel, defaultPersona } = require('./model-import');
const setup = require('./setup');

const IS_MAC = process.platform === 'darwin';

// config.json は共通の設定（アプリに同梱）、config.local.json はこの PC だけの設定
// （読み込んだキャラ、選択中のキャラなど）。local の方が優先される。
// インストールしたアプリは自分のフォルダに書き込めないので、local 設定と読み込んだモデルは
// ユーザーごとのフォルダ（Windows: %APPDATA%、Mac: ~/Library/Application Support）に置く
const DATA_DIR = app.isPackaged ? app.getPath('userData') : __dirname;
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOCAL_CONFIG_PATH = path.join(DATA_DIR, 'config.local.json');
const MERGED_KEYS = ['voice', 'stt', 'hotkeys', 'apps', 'weather'];
const DEFAULT_HOTKEYS = {
  listenOnce: IS_MAC ? 'Alt+Space' : 'Control+Space',
  voiceChat: 'CommandOrControl+Alt+V',
};

// ホットキーは "Control+Space" のような文字列か、OS ごとの { "win": ..., "mac": ... }
const hotkeyFor = (v) => (v && typeof v === 'object' ? v[IS_MAC ? 'mac' : 'win'] : v);

// 読み込んだモデル（DATA_DIR/models）と、同梱・開発用のモデル（アプリのフォルダ/models）の両方を探す
function resolveModelPath(p) {
  if (path.isAbsolute(p)) return p;
  return [path.join(DATA_DIR, p), path.join(__dirname, p)].find((f) => fs.existsSync(f)) || path.join(DATA_DIR, p);
}
const WIN_W = 400;
const WIN_H = 620;

let win;
let config;
let rawConfig;

function readLocalConfig() {
  if (!fs.existsSync(LOCAL_CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
}

function writeLocalConfig(update) {
  const local = { ...readLocalConfig(), ...update };
  fs.mkdirSync(path.dirname(LOCAL_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(local, null, 2)}\n`);
}

// 共通設定に、選択中キャラ（characters[activeCharacter]）の設定を重ねる
function loadConfig() {
  const shared = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const local = readLocalConfig();
  rawConfig = { ...shared, ...local, characters: { ...shared.characters, ...local.characters } };
  for (const key of MERGED_KEYS) rawConfig[key] = { ...shared[key], ...local[key] };

  const { characters = {}, activeCharacter, ...base } = rawConfig;
  const id = characters[activeCharacter] ? activeCharacter : Object.keys(characters)[0];
  const chara = characters[id] || {};
  config = {
    ...base,
    ...chara,
    characterId: id,
    voice: { ...base.voice, ...chara.voice },
    stt: { ...base.stt, ...chara.stt },
  };
  config.characterName ||= 'マスコット';
  config.persona ||= defaultPersona(config.characterName, !!config.voice.enabled);
  config.hotkeys = Object.fromEntries(
    Object.entries({ ...DEFAULT_HOTKEYS, ...config.hotkeys }).map(([k, v]) => [k, hotkeyFor(v)]),
  );
  let modelUrl = '';
  if (config.modelPath) {
    const abs = resolveModelPath(config.modelPath);
    if (fs.existsSync(abs)) modelUrl = pathToFileURL(abs).href;
    else console.warn('モデルが見つかりません:', abs);
  }
  return { ...config, modelUrl };
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - 20,
    y: workArea.y + workArea.height - WIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  // 透明部分のクリックはデスクトップへ通す（キャラ・UI上に来たら renderer 側で解除）
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('console-message', (e) => {
    if (!e.message.includes('ScriptProcessorNode')) console.log(`[renderer ${e.level}] ${e.message}`);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('get-config', () => {
  const c = loadConfig();
  ensureVoicevox(); // 声ありのキャラに切り替えたとき用
  return c;
});

// 選んだキャラは config.local.json に覚えて再読み込み
function switchCharacter(id) {
  writeLocalConfig({ activeCharacter: id });
  win.reload();
}

// モデルを選んでもらい、models/ にコピーしてキャラとして追加する
async function importModelFromDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'キャラクターのモデルを選ぶ（Live2D は .model3.json）',
    properties: ['openFile'],
    filters: MODEL_FILTERS,
  });
  if (canceled || !filePaths[0]) return;
  try {
    const taken = new Set(Object.keys(rawConfig.characters || {}));
    const { id, entry } = importModel(filePaths[0], DATA_DIR, taken, !!rawConfig.voice?.enabled);
    const local = readLocalConfig();
    writeLocalConfig({ characters: { ...local.characters, [id]: entry }, activeCharacter: id });
    await dialog.showMessageBox(win, {
      type: 'info',
      message: `「${entry.characterName}」を追加しました`,
      detail: '名前や性格は、右クリック →「キャラ設定を開く」で config.local.json を編集して変えられます。',
    });
    win.reload();
  } catch (err) {
    dialog.showErrorBox('モデルを読み込めませんでした', err.message);
  }
}

// config.local.json を開く（無ければ空のものを作る）
function openLocalConfig() {
  if (!fs.existsSync(LOCAL_CONFIG_PATH)) writeLocalConfig({});
  shell.openPath(LOCAL_CONFIG_PATH);
}

ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('move-window', (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.on('show-menu', (event, extra) => {
  const characters = Object.entries(rawConfig.characters || {});
  const poses = extra?.poses;
  const menu = Menu.buildFromTemplate([
    ...(characters.length > 1 ? [{
      label: 'キャラ切り替え',
      submenu: characters.map(([id, c]) => ({
        label: c.characterName || id,
        type: 'radio',
        checked: id === config.characterId,
        click: () => { if (id !== config.characterId) switchCharacter(id); },
      })),
    }] : []),
    ...(poses?.poses?.length ? [{
      label: '立ち姿',
      submenu: poses.poses.map(({ id, label }) => ({
        label,
        type: 'radio',
        checked: id === poses.current,
        click: () => event.sender.send('set-pose', id),
      })),
    }] : []),
    ...(poses?.legs?.options?.length ? [{
      label: '足',
      submenu: poses.legs.options.map(({ id, label }) => ({
        label,
        type: 'radio',
        checked: id === poses.legs.current,
        click: () => event.sender.send('set-legs', id),
      })),
    }] : []),
    { label: `音声会話 ON/OFF（${config.hotkeys.voiceChat || 'ホットキーなし'}）`, click: () => event.sender.send('toggle-voice-chat') },
    { label: '会話をリセット', click: () => event.sender.send('reset-chat') },
    {
      label: '常に最前面',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: (item) => win.setAlwaysOnTop(item.checked, 'floating'),
    },
    { type: 'separator' },
    { label: 'モデルを読み込む…', click: () => importModelFromDialog() },
    { label: 'キャラ設定を開く', click: () => openLocalConfig() },
    { label: 'ホットキー設定…', click: () => openHotkeyWindow() },
    { label: 'セットアップ（Ollama・声・マイクの確認）', click: () => openSetupWindow() },
    { label: '設定を再読み込み', click: () => win.reload() },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
});

// Ollama にストリーミングで問い合わせる。本文の断片は onText に流し、ツール呼び出しは最後にまとめて返す
async function streamOllama(messages, tools, onText) {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages,
      tools: tools.length ? tools : undefined,
      stream: true,
      think: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  const toolCalls = [];
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const data = JSON.parse(line);
      if (data.error) throw new Error(data.error);
      if (data.message?.content) {
        content += data.message.content;
        onText(data.message.content);
      }
      if (data.message?.tool_calls) toolCalls.push(...data.message.tool_calls);
    }
  }
  return { content, toolCalls };
}

// ①判定役としてツールを使うか決めて実行 → ②キャラとして結果を踏まえて返事、の2段階にする
async function runTools(messages) {
  const tools = buildTools(config);
  if (!tools.length) return [];
  const recent = messages.filter((m) => m.role !== 'system').slice(-4);
  const { toolCalls } = await streamOllama([{ role: 'system', content: ROUTER_PROMPT }, ...recent], tools, () => {});

  const results = [];
  for (const call of toolCalls) {
    const { name, arguments: args } = call.function;
    const result = await runTool(name, args, { config, shell });
    console.log(`[tool] ${name}(${JSON.stringify(args)}) -> ${result}`);
    results.push(result);
  }
  return results;
}

ipcMain.handle('chat', async (event, { id, messages }) => {
  const send = (ch, data) => {
    if (!event.sender.isDestroyed()) event.sender.send(ch, { id, ...data });
  };
  try {
    const results = await runTools(messages);
    const convo = [...messages];
    if (results.length) {
      const last = convo[convo.length - 1];
      convo[convo.length - 1] = { ...last, content: `${last.content}\n\n${resultNote(results)}` };
    }
    await streamOllama(convo, [], (text) => send('chat-chunk', { text }));
    send('chat-done', {});
  } catch (err) {
    const msg = err.cause?.code === 'ECONNREFUSED'
      ? 'Ollamaに接続できないみたい…起動してるか確認してね。'
      : `エラー: ${err.message}`;
    send('chat-error', { message: msg });
  }
});

// ---------- 音声合成（VOICEVOX） ----------

let voicevoxProc = null;

// VOICEVOX エンジン（run / run.exe）を探す。エディタを一度起動すると vvpp-engines に展開される
function findVoicevoxEngine() {
  if (config.voice?.enginePath && fs.existsSync(config.voice.enginePath)) return config.voice.enginePath;
  const exeName = IS_MAC ? 'run' : 'run.exe';
  const roots = IS_MAC
    ? [path.join(os.homedir(), 'Library', 'Application Support', 'voicevox', 'vvpp-engines')]
    : [path.join(process.env.APPDATA || '', 'voicevox', 'vvpp-engines')];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const exe = path.join(root, dir, exeName);
      if (fs.existsSync(exe)) return exe;
    }
  }
  const bundled = IS_MAC
    ? '/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run'
    : path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VOICEVOX', 'vv-engine', 'run.exe');
  return fs.existsSync(bundled) ? bundled : null;
}

async function voicevoxReady() {
  try {
    return (await fetch(`${config.voice.voicevoxUrl}/version`)).ok;
  } catch {
    return false;
  }
}

// エンジンが動いていなければ裏で起動する（VOICEVOX 本体を開かなくても喋れるように）
async function ensureVoicevox() {
  if (!config.voice?.enabled || (await voicevoxReady())) return;
  const exe = findVoicevoxEngine();
  if (!exe) return console.warn('VOICEVOX エンジンが見つかりません');
  const port = new URL(config.voice.voicevoxUrl).port || '50021';
  voicevoxProc = spawn(exe, ['--host', '127.0.0.1', '--port', port], {
    cwd: path.dirname(exe),
    windowsHide: true,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60 && !(await voicevoxReady()); i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

ipcMain.handle('tts', async (_e, text) => {
  const { voicevoxUrl, speaker, speedScale = 1, pitchScale = 0, intonationScale = 1 } = config.voice;
  const q = await fetch(
    `${voicevoxUrl}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`,
    { method: 'POST' },
  );
  if (!q.ok) throw new Error(`VOICEVOX audio_query ${q.status}`);
  const query = { ...(await q.json()), speedScale, pitchScale, intonationScale };
  const s = await fetch(`${voicevoxUrl}/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!s.ok) throw new Error(`VOICEVOX synthesis ${s.status}`);
  return new Uint8Array(await s.arrayBuffer());
});

// ---------- 音声認識（Whisper / transformers.js） ----------

let asrPromise = null;
let asrReady = false;
let asrProgress = null; // セットアップ画面に読み込みの進み具合を知らせる

function loadAsr() {
  if (asrPromise) return asrPromise;
  asrPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    // node_modules 配下だと Windows のパス長制限(260文字)を超えるので短い場所に置く
    env.cacheDir = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'desktop-mate', 'hf-cache');
    const opts = {
      dtype: config.stt.dtype || { encoder_model: 'q8', decoder_model_merged: 'q4' },
      progress_callback: (p) => asrProgress?.(p),
    };
    try {
      return await pipeline('automatic-speech-recognition', config.stt.model, { ...opts, device: config.stt.device });
    } catch (err) {
      console.warn(`STT: ${config.stt.device} で読み込めなかったので CPU で動かします`, err.message);
      return pipeline('automatic-speech-recognition', config.stt.model, { ...opts, device: 'cpu' });
    }
  })();
  asrPromise.then(
    () => {
      asrReady = true;
      console.log('[stt] 音声認識モデルの準備完了');
      win?.webContents.send('stt-status', { ready: true });
    },
    (err) => {
      console.error('[stt] 読み込み失敗', err);
      asrPromise = null;
      win?.webContents.send('stt-status', { ready: false, error: err.message });
    },
  );
  return asrPromise;
}

// 無音や雑音のときに Whisper が出しがちな定型文
const STT_NOISE = /^(ご視聴ありがとうございました|ご清聴ありがとうございました|お疲れ様でした|字幕|はい|。|\s)*[。.!！]?$/;

ipcMain.handle('stt', async (_e, samples) => {
  const asr = await loadAsr();
  const audio = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const { text } = await asr(audio, { language: 'japanese', task: 'transcribe' });
  const t = text.trim();
  return STT_NOISE.test(t) ? '' : t;
});

ipcMain.handle('stt-warmup', () => {
  if (config.stt?.enabled) loadAsr().catch(() => {});
});

// ---------- ホットキー ----------

const HOTKEY_ACTIONS = { listenOnce: 'listen-once', voiceChat: 'toggle-voice-chat' };
const HOTKEY_LABELS = { listenOnce: '1 回だけ声を聞く', voiceChat: '音声会話 ON/OFF' };

// 登録し直す。登録できなかった（他のアプリが使っているなど）ものの名前を返す
function registerHotkeys(hotkeys) {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [name, accel] of Object.entries(hotkeys)) {
    if (!accel || !HOTKEY_ACTIONS[name]) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () => win?.webContents.send(HOTKEY_ACTIONS[name]));
    } catch {
      ok = false; // キーの書き方が正しくないとき
    }
    if (!ok) failed.push(name);
  }
  return failed;
}

let hotkeyWin = null;

function openHotkeyWindow() {
  if (hotkeyWin) {
    hotkeyWin.focus();
    return;
  }
  hotkeyWin = new BrowserWindow({
    width: 480,
    height: 460,
    title: 'ホットキー設定',
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'hotkeys-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hotkeyWin.loadFile(path.join(__dirname, 'renderer', 'hotkeys.html'));
  hotkeyWin.on('closed', () => {
    hotkeyWin = null;
    registerHotkeys(config.hotkeys); // キー入力の待ち受け中に閉じても元に戻す
  });
}

ipcMain.handle('hotkeys:get', () => ({
  current: config.hotkeys,
  defaults: DEFAULT_HOTKEYS,
  labels: HOTKEY_LABELS,
  isMac: IS_MAC,
}));

// キーを押してもらっている間は、今のホットキーが反応しないように外しておく
ipcMain.handle('hotkeys:suspend', () => globalShortcut.unregisterAll());
ipcMain.handle('hotkeys:resume', () => registerHotkeys(config.hotkeys));

// 試しに登録してみて、全部登録できたら config.local.json に保存する。だめなら元に戻す
ipcMain.handle('hotkeys:save', (_e, hotkeys) => {
  const next = { ...config.hotkeys, ...hotkeys };
  const failed = registerHotkeys(next);
  if (failed.length) {
    registerHotkeys(config.hotkeys);
    return { ok: false, failed };
  }
  const local = readLocalConfig();
  writeLocalConfig({ hotkeys: { ...local.hotkeys, ...hotkeys } });
  config.hotkeys = next;
  return { ok: true };
});

// ---------- 初回セットアップ ----------

let setupWin = null;

function setupContext() {
  return {
    config,
    isMac: IS_MAC,
    findVoicevoxEngine,
    voicevoxReady,
    startVoicevox: async () => {
      const wasEnabled = config.voice.enabled;
      config.voice.enabled = true; // 声なしのキャラでも、確認のために起動はできるように
      try { await ensureVoicevox(); } finally { config.voice.enabled = wasEnabled; }
    },
    asr: {
      isReady: () => asrReady,
      load: (onProgress) => { asrProgress = onProgress; return loadAsr(); },
    },
  };
}

function openSetupWindow() {
  if (setupWin) {
    setupWin.show();
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 560,
    height: 800,
    title: 'セットアップ',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWin.on('closed', () => {
    setupWin = null;
    // 初回はセットアップを閉じたらキャラを出す
    if (!win) createWindow();
  });
}

ipcMain.handle('setup:check', () => setup.checkAll(setupContext()));
ipcMain.handle('setup:action', (event, name) => setup.runAction(name, setupContext(), (p) => {
  if (!event.sender.isDestroyed()) event.sender.send('setup:progress', p);
}));
ipcMain.handle('setup:done', () => {
  writeLocalConfig({ setupDone: true });
  setupWin?.close();
});

// 二重起動しない（すでに動いていれば、そちらを前に出すだけ）
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.showInactive(); win?.moveTop(); });

app.whenReady().then(async () => {
  loadConfig();

  // 初めて起動したとき、または Ollama につながらないときはセットアップ画面を出す
  const firstRun = !readLocalConfig().setupDone;
  const ollamaOk = await setup.ollamaReachable(config.ollamaUrl);
  if (firstRun) {
    openSetupWindow();
  } else {
    createWindow();
    if (!ollamaOk) openSetupWindow();
  }
  ensureVoicevox();

  for (const name of registerHotkeys(config.hotkeys)) {
    console.warn(`ホットキーを登録できませんでした（他のアプリが使用中かも）: ${name}=${config.hotkeys[name]}`);
  }
  // 開発用：`electron . --hotkeys` で起動時にホットキー設定を開く
  if (process.argv.includes('--hotkeys')) openHotkeyWindow();
});

// Mac ではウィンドウを全部閉じてもアプリを終わらせないのが普通だが、
// このアプリはキャラの窓が本体なので、どちらの OS でも閉じたら終了する
// （初回はセットアップを閉じた直後にキャラの窓を作るので、そのときは終了しない）
app.on('window-all-closed', () => {
  if (!win || win.isDestroyed()) app.quit();
});
app.on('quit', () => voicevoxProc?.kill());
