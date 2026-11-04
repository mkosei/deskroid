// Deskroid の宣伝用デモ映像を録る（Deskroid をデバッグポートで操作しながら、まわりを切り抜いて MP4 にする）
// 使い方は scripts/demo/README.md
const { app, BrowserWindow, desktopCapturer, session, screen, clipboard, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 保存先：DEMO_OUT があればそこ、なければ「ビデオ」フォルダ
const OUT = () => process.env.DEMO_OUT || path.join(app.getPath('videos'), 'deskroid-demo.mp4');
// 隠した録画用の窓でも、描画やタイマーを間引かせない
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const ICON = require('url').pathToFileURL(path.join(__dirname, '..', '..', 'build', 'icon.png')).href;
const BG = '#0d0e17';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Deskroid をデバッグポートで操作する ----------
let ws;
let msgId = 0;
const pending = new Map();
async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = list.find((p) => p.type === 'page' && p.title === 'Deskroid');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
}
const ev = (expression) => new Promise((resolve) => {
  const n = ++msgId;
  pending.set(n, (m) => resolve(m.result?.result?.value ?? m.result?.exceptionDetails?.exception?.description));
  ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});

// 入力欄に 1 文字ずつ打って送る
async function say(text) {
  await ev(`toggleInput(true)`);
  await ev(`input.value = ''`);
  for (const ch of text) {
    await ev(`input.value += ${JSON.stringify(ch)}; input.dispatchEvent(new Event('input'))`);
    await sleep(85);
  }
  await sleep(450);
  await ev(`inputBar.requestSubmit()`);
}

// 返事と読み上げが終わるまで待つ
async function waitReply(timeout = 60000) {
  const t0 = Date.now();
  await sleep(800);
  while (Date.now() - t0 < timeout) {
    const busy = await ev(`generating || playing || speechQueue.length > 0`);
    if (busy === false) return;
    await sleep(250);
  }
}

// ---------- 録画 ----------
let recWin;
function setState(s) { recWin.webContents.send('state', s); }

app.whenReady().then(async () => {
  await connect();
  console.log('connected');
  await ev(`hideBubble(); history = []`);

  // Deskroid を決めた場所へ動かす（画面の右寄り、下端は作業領域の下）
  const disp = screen.getPrimaryDisplay();
  const sf = disp.scaleFactor;
  const target = { x: 1080, y: disp.workArea.y + disp.workArea.height - 620 };
  const pos = JSON.parse(await ev(`JSON.stringify([window.screenX, window.screenY])`));
  await ev(`window.mate.moveWindow(${target.x - pos[0]}, ${target.y - pos[1]})`);
  await sleep(500);

  // 背景の幕（Deskroid は常に最前面なので、その下・ほかの窓の上に来る）
  const backdrop = new BrowserWindow({
    ...disp.workArea, frame: false, backgroundColor: BG, skipTaskbar: true, show: false, resizable: false,
  });
  // 画面全体を覆うと Windows が「全画面アプリ」とみなし、最前面の Deskroid を下げてしまうので、タスクバーは残す
  backdrop.setBounds(disp.workArea);
  await backdrop.loadURL(`data:text/html,<body style="margin:0;background:${BG};cursor:none"></body>`);
  backdrop.show();
  backdrop.focus();

  // 録画用の窓（画面には出さない）
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [src] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: src, audio: 'loopback' });
  });
  recWin = new BrowserWindow({ width: 1280, height: 720, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  await recWin.loadFile(path.join(__dirname, 'recorder.html'));
  const saved = new Promise((resolve) => ipcMain.once('saved', (_e, buf) => { fs.writeFileSync(OUT(), Buffer.from(buf)); resolve(); }));
  const started = new Promise((resolve) => ipcMain.once('recording', resolve));

  // 切り抜く範囲：吹き出し・頭・上半身（スマホでも文字が読めるよう大きめに写す）。上端は窓の上端を追いかける
  const crop = { sx: (target.x - 35) * sf, sy: (target.y - 12) * sf, sw: 470 * sf, sh: 465 * sf };
  const follow = setInterval(async () => {
    const top = await ev('window.screenY');
    if (typeof top === 'number') recWin.webContents.send('win-top', (top - 12) * sf);
  }, 100);
  // 録画のあいだだけ、吹き出しの文字を大きくする
  await ev(`document.head.insertAdjacentHTML('beforeend', '<style id="demo-style">#bubble{font-size:18px;line-height:1.65} #bubble-you{font-size:15px} #bubble-name{font-size:13px} #input{font-size:16px}</style>')`);
  setState({ mode: 'title', caption: 'デスクトップに住む、話せる相棒', sub: 'ローカル AI で動く・無料・オープンソース' });
  recWin.webContents.send('start', { crop, icon: ICON });
  await started;
  console.log('recording');

  // 文字を打ったときの音や読み上げが「いい感じ」に入るよう、最初は少し間を置く
  await sleep(3200);

  // 01 話しかける
  setState({ mode: 'scene', step: '01', caption: '話しかけるだけ', sub: '文字でも声でも。\n表情・身ぶり・声つきで返事してくれる' });
  await sleep(1200);
  await say('はじめまして！自己紹介して');
  await waitReply();
  await sleep(2600);

  // 02 天気（ツール）
  setState({ mode: 'scene', step: '02', caption: 'パソコンのことを手伝う', sub: 'アプリ・サイト・天気・音量・タイマー…\n頼めば、その場で実行' });
  await ev(`hideBubble(); history = []`);
  await sleep(900);
  await say('明日の東京の天気どう？');
  await waitReply();
  await sleep(2600);

  // 03 タイマー
  setState({ mode: 'scene', step: '03', caption: 'タイマー・リマインダー', sub: '時間になったら、声で教えてくれる' });
  await ev(`hideBubble(); history = []`);
  await sleep(900);
  await say('8秒後にお茶が入ったって教えて');
  await waitReply();
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    if (String(await ev(`bubbleText.textContent`)).startsWith('⏰')) break;
    await sleep(250);
  }
  await waitReply(20000);
  await sleep(2400);

  // 04 クリップボード（翻訳）
  const original = clipboard.readText();
  const english = 'Deskroid runs only on your PC. No cloud, no API keys, and no fees.';
  clipboard.writeText(english);
  setState({ mode: 'scene', step: '04', caption: 'コピーした文章を翻訳・要約', sub: 'Ctrl+C して「これ訳して」と言うだけ', note: `コピーした文章: ${english}` });
  await ev(`hideBubble(); history = []`);
  await sleep(1500);
  await say('これ日本語に訳して');
  await waitReply();
  await sleep(3800);
  clipboard.writeText(original);

  // おわり
  setState({
    mode: 'end',
    caption: 'github.com/mkosei/deskroid',
    sub: 'Windows / Mac ・ 日本語 / English\n好きな Live2D・VRM モデルを読み込める',
    note: 'キャラクター：VRoid プロジェクト サンプルモデル「ヴィータ」\n音声：VOICEVOX:冥鳴ひまり　／　会話：Ollama（qwen3:8b）',
  });
  await sleep(5500);

  clearInterval(follow);
  await ev(`document.getElementById('demo-style')?.remove()`);
  recWin.webContents.send('stop');
  await saved;
  console.log('saved', OUT(), fs.statSync(OUT()).size);
  backdrop.close();
  ws.close();
  app.quit();
});
