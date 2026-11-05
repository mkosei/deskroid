// 初回セットアップ：必要なもの（Ollama・会話モデル・VOICEVOX・マイク・音声認識）がそろっているか調べ、
// 足りないものは案内やダウンロードをする。main.js から ctx（設定や VOICEVOX・音声認識の操作）を渡してもらう
const { shell, systemPreferences } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { systemInfo, recommend, CHAT_MODELS } = require('./system-info');
const { installOllama, latestOllama } = require('./ollama-install');
const { latestAsset: latestVoicevox } = require('./voicevox-install');
const { freeSpace } = require('./download');

const OLLAMA_SITE = 'https://ollama.com/';
const OLLAMA_DOWNLOAD = 'https://ollama.com/download';
const VOICEVOX_SITE = 'https://voicevox.hiroshiba.jp/';
const VOICEVOX_TERMS = 'https://voicevox.hiroshiba.jp/term/';

async function getJson(url, timeoutMs = 3000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function ollamaReachable(url) {
  try {
    await getJson(`${url}/api/version`, 1500);
    return true;
  } catch {
    return false;
  }
}

// 配布物の大きさなどは GitHub に聞くので、1 時間はおぼえておく（セットアップ画面は何度も確認し直すため）
function cachedFor(ms, fn) {
  let at = 0;
  let value = null;
  return async () => {
    if (!value || Date.now() - at > ms) {
      value = await fn().catch(() => null);
      at = Date.now();
    }
    return value;
  };
}
const ollamaAsset = cachedFor(60 * 60 * 1000, latestOllama);
const voicevoxAsset = cachedFor(60 * 60 * 1000, latestVoicevox);

// Ollama 本体の場所（起動していないときに起動するため）
function findOllama(isMac) {
  const candidates = isMac
    ? ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications', 'Ollama.app'), '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']
    : [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// "qwen3:8b" と "qwen3:8b-q4_K_M" などの表記ゆれを吸収して、入っているか調べる
function hasModel(models, name) {
  const want = name.includes(':') ? name : `${name}:latest`;
  return models.some((m) => m.name === want || m.model === want || m.name === name);
}

async function checkAll(ctx) {
  const { config, isMac } = ctx;
  const result = { lang: ctx.lang }; // 画面の言語（文言は画面側で作る）

  // この PC の性能と、おすすめの会話モデル
  const info = await systemInfo();
  const rec = recommend(info);
  const free = await freeSpace(os.homedir());
  result.pc = {
    ram: info.ram,
    cpu: info.cpu,
    gpu: info.gpu,
    unified: info.unified,
    level: rec.level,
    recommended: rec.recommended,
    models: rec.models.map(({ name, size, fit }) => ({ name, size, fit })),
    free: free === null ? null : free / 1e9,
  };

  // Ollama と会話モデル
  let version = null;
  try {
    version = (await getJson(`${config.ollamaUrl}/api/version`)).version;
  } catch {}
  if (version) {
    result.ollama = { state: 'ok', detail: version };
    try {
      const { models = [] } = await getJson(`${config.ollamaUrl}/api/tags`);
      result.model = hasModel(models, config.ollamaModel)
        ? { state: 'ok', detail: config.ollamaModel }
        : { state: 'missing', detail: config.ollamaModel };
      result.model.installed = models.map((m) => m.name);
    } catch {
      result.model = { state: 'unknown', detail: config.ollamaModel };
    }
  } else {
    result.ollama = findOllama(isMac) ? { state: 'stopped' } : { state: 'missing' };
    result.model = { state: 'waiting', detail: config.ollamaModel };
  }
  // 入れるときに落とす大きさ（GB）
  if (result.ollama.state === 'missing') result.ollama.size = ((await ollamaAsset())?.size || 0) / 1e9 || null;
  // 自分で選んだモデルがあればそれ、なければこの PC へのおすすめを入れる
  result.model.choice = ctx.chosenModel || ctx.userModel || rec.recommended;
  result.model.fit = rec.models.find((m) => m.name === config.ollamaModel)?.fit || null;

  // 声（任意）。日本語は VOICEVOX、英語は Kokoro（アプリの中で動くので、初回にダウンロードするだけ）
  if (ctx.lang === 'en') {
    result.kokoro = { state: ctx.kokoro.isReady() ? 'ok' : 'notLoaded', optional: true, enabled: !!config.voice?.enabled };
  } else {
    if (await ctx.voicevoxReady()) result.voicevox = { state: 'ok' };
    else if (ctx.findVoicevoxEngine()) result.voicevox = { state: 'stopped' };
    else result.voicevox = { state: 'missing', size: ((await voicevoxAsset())?.size || 0) / 1e9 || null };
    result.voicevox.optional = true;
    const update = ctx.voicevoxUpdate?.();
    if (update && result.voicevox.state !== 'missing') result.voicevox.update = update;
    result.voicevox.enabled = !!config.voice?.enabled;
  }

  // マイク（Mac は OS の許可が要る。Windows は使うときに確認される）
  if (isMac) {
    const s = systemPreferences.getMediaAccessStatus('microphone');
    result.mic = { state: s === 'granted' ? 'ok' : s === 'not-determined' ? 'ask' : 'denied' };
  } else {
    result.mic = { state: 'ok', askOnUse: true };
  }

  // 音声認識モデル（任意。初めて声で話しかけたときにも自動で準備される）
  result.stt = { state: ctx.asr.isReady() ? 'ok' : 'notLoaded', optional: true, enabled: !!config.stt?.enabled };

  return result;
}

// 会話モデルのダウンロード（Ollama の /api/pull を流しながら進み具合を知らせる）
async function pullModel(config, model, onProgress) {
  const res = await fetch(`${config.ollamaUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const data = JSON.parse(line);
      if (data.error) throw new Error(data.error);
      onProgress({ item: 'model', status: data.status, completed: data.completed, total: data.total });
    }
  }
}

async function waitOllama(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await ollamaReachable(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function startOllama(isMac, en, url = 'http://localhost:11434') {
  if (await ollamaReachable(url)) return;
  const found = findOllama(isMac);
  if (!found) throw new Error(en ? "Couldn't find Ollama. Please install it first." : 'Ollama が見つかりません。先にインストールしてください。');
  if (isMac && found.endsWith('.app')) {
    spawn('open', ['-a', found], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(found, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  if (await waitOllama(url, 30)) return;
  throw new Error(en ? "Couldn't start Ollama. Please try starting it yourself." : 'Ollama を起動できませんでした。手動で起動してみてください。');
}

async function runAction(name, ctx, onProgress, arg) {
  const { config, isMac } = ctx;
  const en = ctx.lang === 'en';
  switch (name) {
    case 'openOllamaSite':
      return shell.openExternal(OLLAMA_SITE);
    case 'openOllamaDownload':
      return shell.openExternal(OLLAMA_DOWNLOAD);
    case 'startOllama':
      return startOllama(isMac, en, config.ollamaUrl);
    case 'installOllama':
      await installOllama(ctx.downloadDir, (p) => onProgress({ item: 'ollama', ...p }), { en });
      // 入れた直後は Ollama が自分で起動することがあるので、少し待ってから起動する
      if (!(await waitOllama(config.ollamaUrl, 8))) await startOllama(isMac, en, config.ollamaUrl);
      return true;
    case 'selectModel':
      // 落とすモデルを選んだだけ（まだ落とさない）
      if (CHAT_MODELS.some((m) => m.name === arg)) ctx.setChosenModel(arg);
      return true;
    case 'pullModel': {
      const model = CHAT_MODELS.some((m) => m.name === arg) ? arg : config.ollamaModel;
      await pullModel(config, model, onProgress);
      // 落としたモデルで話すようにする
      if (model !== config.ollamaModel) ctx.setChatModel(model);
      return true;
    }
    case 'openVoicevoxDownload':
    case 'openVoicevoxSite':
      return shell.openExternal(VOICEVOX_SITE);
    case 'startVoicevox':
      return ctx.startVoicevox();
    case 'installVoicevox':
      return ctx.installVoicevox((p) => onProgress({ item: 'voicevox', ...p }));
    case 'openVoicevoxTerms':
      return shell.openExternal(VOICEVOX_TERMS);
    case 'requestMic':
      if (isMac) return systemPreferences.askForMediaAccess('microphone');
      return true;
    case 'openMicSettings':
      return shell.openExternal(isMac
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
        : 'ms-settings:privacy-microphone');
    case 'prepareStt':
      await ctx.asr.load((p) => {
        if (p.status === 'progress') onProgress({ item: 'stt', file: p.file, progress: p.progress });
      });
      return true;
    case 'prepareKokoro':
      await ctx.kokoro.load((p) => {
        if (p.status === 'progress') onProgress({ item: 'kokoro', file: p.file, progress: p.progress });
      });
      return true;
    default:
      throw new Error(en ? `Unknown action: ${name}` : `不明な操作: ${name}`);
  }
}

module.exports = { checkAll, runAction, ollamaReachable };
