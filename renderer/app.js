const canvas = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const bubbleName = document.getElementById('bubble-name');
const bubbleYou = document.getElementById('bubble-you');
const bubbleText = document.getElementById('bubble-text');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const inputBar = document.getElementById('input-bar');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const micBtn = document.getElementById('mic');
const levelBar = document.querySelector('#level i');

let config;

// キャラを描く場所（ステージ）は、起動したときの窓の大きさで固定し、窓の下端にそろえる。
// 吹き出しが長いときは窓を上へ伸ばすが、キャラの大きさと位置は変わらない
const STAGE_W = window.innerWidth;
const STAGE_H = window.innerHeight;
document.documentElement.style.setProperty('--stage-w', `${STAGE_W}px`);
document.documentElement.style.setProperty('--stage-h', `${STAGE_H}px`);
// 窓の座標 → ステージの座標（窓が上へ伸びた分だけずらす）
const stageY = (y) => y - (window.innerHeight - STAGE_H);
let character;            // { view, hitTest, setMouth, lookAt, setExpression?, tap? }
let history = [];         // Ollama に送る会話履歴（system 以外）
let generating = false;   // 返答ストリーミング中か
let currentChatId = 0;
let bubbleTimer = null;

const app = new PIXI.Application({
  view: canvas,
  width: STAGE_W,
  height: STAGE_H,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
  backgroundAlpha: 0,
  antialias: true,
});

// ---------- キャラクター ----------

async function loadLive2D(url) {
  const model = await PIXI.live2d.Live2DModel.from(url, { autoInteract: false });
  const scale = Math.min(
    (STAGE_W * 0.95) / model.width,
    (STAGE_H * 0.8) / model.height,
  ) * (config.modelScale || 1);
  model.scale.set(scale);
  model.anchor.set(0.5, 1);
  model.position.set(STAGE_W / 2, STAGE_H);
  app.stage.addChild(model);

  // 表情ファイルの無いモデル向け：パラメータを直接動かして表情を作る
  let exprParams = {};
  let exprWeight = 0;
  let exprTarget = 0;

  let mouth = 0;
  model.internalModel.on('beforeModelUpdate', () => {
    const core = model.internalModel.coreModel;
    exprWeight += (exprTarget - exprWeight) * 0.12;
    for (const [id, v] of Object.entries(exprParams)) core.setParameterValueById(id, v, exprWeight);
    core.setParameterValueById('ParamMouthOpenY', mouth);
  });

  return {
    view: model,
    hitTest: (x, y) => model.getBounds().contains(x, y),
    topY: () => model.getBounds().y,
    setMouth: (v) => { mouth = v; },
    lookAt: (x, y) => model.focus(x, y),
    // 文字列なら exp3.json の表情名、オブジェクトなら { パラメータID: 値 }
    setExpression: (expr) => {
      if (!expr) return;
      if (typeof expr === 'string') {
        model.expression(expr);
      } else if (Object.keys(expr).length) {
        exprParams = expr;
        exprWeight = 0;
        exprTarget = 1;
      } else {
        exprTarget = 0;
      }
    },
    // 配色の自動作成用に、キャラだけを描いた小さな画像を返す
    snapshot: (w = 80, h = 124) => {
      const src = app.renderer.extract.canvas(model);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    },
    // 上の方を触ったら頭、それ以外は体のモーション（FORCE 優先度）
    tap: (x, y) => {
      const b = model.getBounds();
      const part = y < b.y + b.height * 0.22 ? 'head' : 'body';
      const group = config.tapMotions?.[part];
      if (group) model.motion(group, undefined, 3);
    },
  };
}

// モデル未設定時の仮キャラ（図形で描画）
function createPlaceholder() {
  const root = new PIXI.Container();
  const body = new PIXI.Graphics();
  const face = new PIXI.Container();
  const eyes = new PIXI.Graphics();
  const mouthG = new PIXI.Graphics();
  const R = 110;

  body.beginFill(0x2a2650).lineStyle(4, 0xd2b46c).drawEllipse(0, 0, R * 1.1, R).endFill();
  face.addChild(eyes, mouthG);
  root.addChild(body, face);
  root.position.set(STAGE_W / 2, STAGE_H - R - 70);
  app.stage.addChild(root);

  let mouth = 0;
  let blink = 1;
  let nextBlink = performance.now() + 2500;
  let look = { x: 0, y: 0 };
  const t0 = performance.now();

  app.ticker.add(() => {
    const now = performance.now();
    if (now > nextBlink) { blink = 0; nextBlink = now + 2500 + Math.random() * 3000; }
    blink = Math.min(1, blink + 0.12);
    root.y = STAGE_H - R - 70 + Math.sin((now - t0) / 600) * 4;
    face.position.set(look.x * 14, look.y * 8);

    eyes.clear().beginFill(0xf3f1f8);
    eyes.drawEllipse(-R * 0.35, -R * 0.1, 11, 16 * blink + 1);
    eyes.drawEllipse(R * 0.35, -R * 0.1, 11, 16 * blink + 1);
    eyes.endFill();

    mouthG.clear().beginFill(0x2f86e0);
    mouthG.drawEllipse(0, R * 0.3, 12, 3 + mouth * 13);
    mouthG.endFill();
  });

  return {
    view: root,
    hitTest: (x, y) => root.getBounds().contains(x, y),
    topY: () => root.getBounds().y,
    setMouth: (v) => { mouth = v; },
    lookAt: (x, y) => {
      const b = root.getBounds();
      look = {
        x: Math.max(-1, Math.min(1, (x - (b.x + b.width / 2)) / 200)),
        y: Math.max(-1, Math.min(1, (y - (b.y + b.height / 2)) / 200)),
      };
    },
  };
}

// ---------- 状態表示 ----------

// 画面に出す文言（config.lang で切り替え）
const UI_STRINGS = {
  ja: {
    status: { listening: '聞いています…', thinking: '考え中…', speaking: '話しています', loading: '音声認識を準備中…' },
    micError: (msg) => `マイクが使えないみたいです。\n(${msg})`,
    voiceTimeout: '声が聞こえなかったので、音声会話を終わりますね。',
    sttError: (msg) => `うまく聞き取れませんでした。\n(${msg})`,
    sttEmpty: 'ごめん、うまく聞き取れませんでした。もう一度お願いします。',
    sttLoadFailed: '音声認識の準備に失敗しちゃいました。もう一度話しかけてみて、だめならアプリを再起動してください（パソコンのメモリが足りないときに起きることがあります）。',
    sttLoadError: (msg) => `音声認識を準備できませんでした。\n(${msg})`,
    tagInstruction: (tags) => `返事の先頭には、そのときの気持ちに合うタグを必ず1つ付けてください。使えるタグ: ${tags}\n例: [smile] おはよう、今日も早いですね。`,
    reset: '会話をリセットしました。',
    modelLoadError: (msg) => `Live2Dモデルを読み込めなかったので仮の姿でいます。\n(${msg})`,
    greeting: (name) => `${name}です。クリックで話しかけてください。マイクボタンで声でも話せますよ。`,
    placeholder: '話しかける…',
    mic: (key) => `音声会話（${key}）`,
    send: '送信',
    weekdays: ['日', '月', '火', '水', '木', '金', '土'],
    date: (d, w) => `${d.getMonth() + 1}/${d.getDate()}（${w}）`,
    phases: { focus: '集中', short: '休憩', long: '長めの休憩' },
    paused: '一時停止中',
    timerLeft: (n) => (n > 1 ? `タイマー（ほか ${n - 1} 件）` : 'タイマー'),
    clockButtons: { start: 'ポモドーロ', timer: 'タイマー', cancelTimers: 'タイマーを取り消す', back: 'もどる', pause: '一時停止', resume: '再開', skip: '次へ進む', stop: 'ポモドーロをやめる' },
    timerPreset: (m) => (m >= 60 ? `${m / 60}時間` : `${m}分`),
  },
  en: {
    status: { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking', loading: 'Preparing speech recognition…' },
    micError: (msg) => `I can't seem to use the microphone.\n(${msg})`,
    voiceTimeout: "I didn't hear anything, so I'll end the voice conversation.",
    sttError: (msg) => `I couldn't make that out.\n(${msg})`,
    sttEmpty: "Sorry, I didn't catch that. Could you say it again?",
    sttLoadFailed: 'Speech recognition failed to load. Please try again, and if it still fails, restart the app (this can happen when the PC is low on memory).',
    sttLoadError: (msg) => `I couldn't prepare speech recognition.\n(${msg})`,
    tagInstruction: (tags) => `Always start your reply with exactly one tag that matches your mood. Available tags: ${tags}\nExample: [smile] Good morning, you're up early today.\nAlways reply in English.`,
    reset: 'The conversation has been reset.',
    modelLoadError: (msg) => `I couldn't load the model, so I'm using a stand-in for now.\n(${msg})`,
    greeting: (name) => `Hi, I'm ${name}! Click me to talk, or use the mic button to talk by voice.`,
    placeholder: 'Say something…',
    mic: (key) => `Voice conversation (${key})`,
    send: 'Send',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    date: (d, w) => `${w} ${d.getMonth() + 1}/${d.getDate()}`,
    phases: { focus: 'Focus', short: 'Break', long: 'Long break' },
    paused: 'Paused',
    timerLeft: (n) => (n > 1 ? `Timer (+${n - 1} more)` : 'Timer'),
    clockButtons: { start: 'Pomodoro', timer: 'Timer', cancelTimers: 'Cancel timers', back: 'Back', pause: 'Pause', resume: 'Resume', skip: 'Skip', stop: 'Stop pomodoro' },
    timerPreset: (m) => (m >= 60 ? `${m / 60}h` : `${m}m`),
  },
};
const ui = () => UI_STRINGS[config?.lang] || UI_STRINGS.ja;

// "CommandOrControl+Alt+V" → "Ctrl+Alt+V"（Mac は "Command+Option+V"）のように、OS に合わせた呼び名にする
function keyLabel(accel) {
  if (!accel) return '';
  const mac = /Mac/i.test(navigator.platform);
  const names = {
    CommandOrControl: mac ? 'Command' : 'Ctrl', CmdOrCtrl: mac ? 'Command' : 'Ctrl',
    Control: 'Ctrl', Alt: mac ? 'Option' : 'Alt', Cmd: 'Command', Super: 'Win',
  };
  return accel.split('+').map((k) => names[k] || k).join('+');
}

function setStatus(state) {
  if (!state) {
    statusEl.classList.add('hidden');
    return;
  }
  statusEl.dataset.state = state;
  statusText.textContent = ui().status[state];
  statusEl.classList.remove('hidden');
}

// ---------- 音声再生（VOICEVOX）と口パク ----------

const audioCtx = new AudioContext();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 1024;
analyser.connect(audioCtx.destination);
const levelBuf = new Float32Array(analyser.fftSize);

let speechQueue = [];     // { audio: Promise<Uint8Array> }
let speechGen = 0;        // 中断用の世代番号
let currentSource = null;
let playing = false;
let mouthLevel = 0;

function voiceEnabled() {
  return !!config.voice?.enabled;
}

function enqueueSpeech(text) {
  const clean = text.replace(/[「」『』（）()…・\s]+/g, ' ').trim();
  if (!voiceEnabled() || !/[\p{L}\p{N}]/u.test(clean)) return;
  // 合成は先に投げておき、再生だけ順番に行う
  speechQueue.push({ audio: window.mate.tts(clean).catch((err) => { console.warn(err); return null; }) });
  if (!playing) playQueue(speechGen);
}

async function playQueue(gen) {
  playing = true;
  setStatus('speaking');
  while (speechQueue.length && gen === speechGen) {
    const data = await speechQueue.shift().audio;
    if (!data || gen !== speechGen) continue;
    try {
      const buf = await audioCtx.decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      await new Promise((resolve) => {
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(analyser);
        src.onended = resolve;
        currentSource = src;
        src.start();
      });
    } catch (err) {
      console.warn('音声の再生に失敗しました', err);
    }
  }
  currentSource = null;
  playing = false;
  if (gen === speechGen) onSpeechIdle();
}

function stopSpeaking() {
  speechGen++;
  speechQueue = [];
  try { currentSource?.stop(); } catch {}
  currentSource = null;
  playing = false;
}

// 話し終わった（＝返事の生成も再生も終わった）ら、音声会話中なら次を聞きにいく
function onSpeechIdle() {
  if (generating || playing) return;
  setStatus(null);
  if (voiceMode) startListening();
}

app.ticker.add(() => {
  if (!character) return;
  let target = 0;
  if (playing && currentSource) {
    analyser.getFloatTimeDomainData(levelBuf);
    let sum = 0;
    for (const v of levelBuf) sum += v * v;
    target = Math.min(1, Math.sqrt(sum / levelBuf.length) * 7);
  } else if (generating && !voiceEnabled()) {
    target = Math.abs(Math.sin(performance.now() / 90)) * 0.8;
  }
  mouthLevel += (target - mouthLevel) * 0.5;
  character.setMouth(mouthLevel);
});

// ---------- 音声入力（マイク → Whisper） ----------

let voiceMode = false;    // 音声会話モード（話し終わるたびに自動で聞く）
let oneShot = false;      // ホットキーで 1 回だけ聞いている途中か
let mic = null;           // 録音中のリソース

// ホットキー：1 回だけ聞いて返事をする。聞いている途中にもう一度押すと取り消し
function listenOnce() {
  if (voiceMode) return; // 音声会話モード中はもともと聞いている
  if (oneShot) {
    if (sendSpeechNow()) return; // 話している途中なら、待たずに送る
    oneShot = false;
    stopListening();
    if (!generating && !playing) setStatus(null);
    return;
  }
  stopSpeaking();
  audioCtx.resume();
  oneShot = true;
  startListening();
}

function setVoiceMode(on) {
  voiceMode = on;
  micBtn.classList.toggle('on', on);
  if (on) {
    toggleInput(true);
    stopSpeaking();
    startListening();
  } else {
    stopListening();
    if (!generating && !playing) setStatus(null);
  }
}

async function startListening() {
  if (mic || !(voiceMode || oneShot)) return;
  // 音声認識のモデルは話しかけ始めたときに読み込む。読み込んでいる間も録音はしているので「聞いている」と出す
  window.mate.sttWarmup('listen');
  setStatus('listening');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    showBubble(ui().micError(err.message));
    oneShot = false;
    setVoiceMode(false);
    return;
  }

  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.resume();
  console.log(`[mic] device="${stream.getAudioTracks()[0]?.label}" ctx=${ctx.state}/${ctx.sampleRate}Hz`);
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(1024, 1, 1);
  const frameMs = (1024 / 16000) * 1000;
  const preroll = [];
  const chunks = [];
  let noise = 0.005;
  let voicedMs = 0;
  let started = false;
  let silentMs = 0;
  let waitedMs = 0;
  let peak = 0;
  let logMs = 0;

  const self = { stream, ctx, chunks, started: false };
  mic = self;

  proc.onaudioprocess = (e) => {
    if (mic !== self) return; // 停止済みの録音から遅れて届いた分は捨てる
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    const threshold = Math.max(config.stt.threshold ?? 0.008, noise * 2.5);
    const voiced = rms > threshold;
    if (!voiced) noise = noise * 0.95 + rms * 0.05;

    levelBar.style.width = `${Math.min(100, (rms / 0.08) * 100)}%`;
    peak = Math.max(peak, rms);
    logMs += frameMs;
    if (logMs >= 1000) {
      console.log(`[mic] peak=${peak.toFixed(4)} noise=${noise.toFixed(4)} threshold=${threshold.toFixed(4)} started=${started}`);
      peak = 0;
      logMs = 0;
    }

    if (!started) {
      preroll.push(data);
      if (preroll.length > 6) preroll.shift();
      voicedMs = voiced ? voicedMs + frameMs : 0;
      waitedMs += frameMs;
      if (voicedMs >= 190) {
        started = true;
        self.started = true;
        console.log('[mic] 発話を検出');
        chunks.push(...preroll);
      } else if (oneShot && waitedMs > 8000) {
        // ホットキーで聞いたのに何も話さなければ取りやめる
        oneShot = false;
        stopListening();
        setStatus(null);
      } else if (waitedMs > 20000) {
        // しばらく何も話さなければ音声会話を終える
        setVoiceMode(false);
        showBubble(ui().voiceTimeout, '');
        hideBubbleLater(5000);
      }
      return;
    }

    chunks.push(data);
    silentMs = voiced ? 0 : silentMs + frameMs;
    self.silentMs = silentMs;
    self.frameMs = frameMs;
    if (silentMs > SILENCE_MS() || chunks.length * frameMs > MAX_UTTERANCE_MS) finishUtterance(trimSilence(chunks, silentMs, frameMs));
  };

  source.connect(proc);
  proc.connect(ctx.destination);
}

// 話し終わったとみなすまでの、黙っている時間。考えながら話しても切れないよう長めにする
// （待たずに送りたいときは、送信ボタンかホットキーをもう一度押す）
const SILENCE_MS = () => config.stt?.silenceMs ?? 3000;
const MAX_UTTERANCE_MS = 30000; // 1 回に話せる長さの上限

// 話している途中なら、黙るのを待たずにすぐ送る。送ったら true
function sendSpeechNow() {
  if (!mic?.started) return false;
  finishUtterance(trimSilence(mic.chunks, mic.silentMs || 0, mic.frameMs || 64));
  return true;
}

// 最後の無音は 0.3 秒だけ残して切る（長い無音を Whisper に渡すと、言っていない言葉を聞き取ることがある）
function trimSilence(chunks, silentMs, frameMs) {
  const drop = Math.floor(Math.max(0, silentMs - 300) / frameMs);
  return drop > 0 ? chunks.slice(0, chunks.length - drop) : chunks;
}

function stopListening() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ctx.close();
  mic = null;
}

async function finishUtterance(chunks) {
  stopListening();
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { samples.set(c, off); off += c.length; }

  setStatus('thinking');
  let text = '';
  const t0 = performance.now();
  try {
    text = await window.mate.stt(samples);
  } catch (err) {
    console.error('[stt]', err);
    // モデルの読み込み失敗は、生のエラーではなく「どうすればいいか」を伝える
    showBubble(/Load model|Protobuf/i.test(err.message) ? ui().sttLoadFailed : ui().sttError(err.message));
  }
  console.log(`[stt] ${(samples.length / 16000).toFixed(1)}s -> "${text}" (${Math.round(performance.now() - t0)}ms)`);
  const wasOneShot = oneShot;
  oneShot = false;
  if (!voiceMode && !wasOneShot) return; // 途中で取り消された
  if (!text) {
    showBubble(ui().sttEmpty, '');
    hideBubbleLater(4000);
    if (voiceMode) startListening();
    else setStatus(null);
    return;
  }
  ask(text);
}

micBtn.addEventListener('click', () => setVoiceMode(!voiceMode));

window.mate.on('toggle-voice-chat', () => setVoiceMode(!voiceMode));
window.mate.on('listen-once', listenOnce);

window.mate.on('stt-status', ({ ready, error }) => {
  if (ready && mic) setStatus('listening');
  if (error) {
    // モデルの読み込み失敗（メモリ不足など）は、生のエラーではなく「どうすればいいか」を伝える
    showBubble(/Load model|Protobuf/i.test(error) ? ui().sttLoadFailed : ui().sttLoadError(error));
    setVoiceMode(false);
  }
});

// ---------- マウス：クリック透過・ドラッグ移動・クリック ----------

let ignoring = true;
let drag = null;

function setInteractive(on) {
  if (on === !ignoring) return;
  ignoring = !on;
  window.mate.setIgnoreMouse(ignoring);
}

window.addEventListener('mousemove', (e) => {
  character?.lookAt(e.clientX, stageY(e.clientY));

  if (drag) {
    const dx = e.screenX - drag.lastX;
    const dy = e.screenY - drag.lastY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.lastX = e.screenX;
    drag.lastY = e.screenY;
    if (dx || dy) window.mate.moveWindow(dx, dy);
    return;
  }

  const overUi = !!e.target.closest?.('.ui');
  const overChar = character?.hitTest(e.clientX, stageY(e.clientY));
  setInteractive(overUi || overChar);
});

window.addEventListener('mousedown', (e) => {
  audioCtx.resume();
  if (e.button !== 0 || e.target.closest('.ui')) return;
  if (!character?.hitTest(e.clientX, stageY(e.clientY))) return;
  drag = { lastX: e.screenX, lastY: e.screenY, x: e.clientX, y: stageY(e.clientY), moved: 0 };
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const { moved, x, y } = drag;
  drag = null;
  if (moved < 5) {
    character.tap?.(x, y);
    toggleInput();
  }
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.mate.showMenu({ poses: character?.getPoses?.() });
});

// 立ち姿・足はキャラごとにこの PC に覚えておく
const poseKey = () => `pose:${config.characterId}`;
const legsKey = () => `legs:${config.characterId}`;

window.mate.on('set-pose', (id) => {
  character?.setPose?.(id);
  try { localStorage.setItem(poseKey(), id); } catch {}
});

window.mate.on('set-legs', (id) => {
  character?.setLegs?.(id);
  try { localStorage.setItem(legsKey(), id); } catch {}
});

// ---------- 吹き出し・入力欄 ----------

function toggleInput(show = inputBar.classList.contains('hidden')) {
  inputBar.classList.toggle('hidden', !show);
  if (show) input.focus();
}

function showBubble(text, you) {
  clearTimeout(bubbleTimer);
  if (you !== undefined) {
    bubbleYou.textContent = you;
    bubbleYou.classList.toggle('hidden', !you);
  }
  bubbleText.textContent = text;
  bubble.classList.remove('hidden');
  fitBubble();
  bubbleText.scrollTop = bubbleText.scrollHeight;
}

function hideBubbleLater(ms = 15000) {
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  bubble.classList.add('hidden');
  fitBubble();
}

// ---------- 吹き出しをキャラの頭に重ねない ----------
// 吹き出しの下（しっぽの先）が頭のてっぺんより上に来るよう、足りない分だけ窓を上へ伸ばす。
// 画面の上端まで伸ばしても足りないときは、本文の高さを縮めてスクロールさせる。
// 返事を受け取っている間は伸ばすだけにして（縮めるとガタつく）、吹き出しを隠したら元の高さに戻す
const BUBBLE_TEXT_MAX = 300; // 本文の高さの上限（これより長いときはスクロール）
const BUBBLE_GAP = 14;       // しっぽの分の、頭とのすき間
let topExtra = 0;            // 今、窓を上へ伸ばしている量
let fitQueued = false;

function fitBubble() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(async () => {
    fitQueued = false;
    if (bubble.classList.contains('hidden')) {
      bubbleText.style.maxHeight = '';
      if (topExtra) topExtra = await window.mate.setTopExtra(0);
      return;
    }
    const headTop = Math.max(0, character?.topY?.() ?? STAGE_H * 0.2);
    // 本文の上限を最大に戻してから、吹き出しの本当の高さを測る
    bubbleText.style.maxHeight = `${BUBBLE_TEXT_MAX}px`;
    const need = bubble.offsetTop + bubble.offsetHeight + BUBBLE_GAP - headTop;
    if (need > topExtra) topExtra = await window.mate.setTopExtra(need);
    // 伸ばしきれなかった分は、本文を縮めてスクロールで読ませる
    const over = need - topExtra;
    if (over > 0) bubbleText.style.maxHeight = `${Math.max(60, BUBBLE_TEXT_MAX - over)}px`;
  });
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleInput(false);
});

inputBar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text && sendSpeechNow()) return;
  if (!text || generating) return;
  input.value = '';
  await ask(text);
});

// ---------- 会話 ----------

let reply = '';
let replyTagApplied = false;
let spokenLen = 0;        // 本文のうち読み上げキューに入れ終わった文字数
let expressionTimer = null;

function systemPrompt() {
  const tags = Object.keys(config.expressions || {});
  if (!tags.length || !character?.setExpression) return config.persona;
  return `${config.persona}\n\n${ui().tagInstruction(tags.map((t) => `[${t}]`).join(' '))}`;
}

// 返事の先頭の [tag] を取り出す。タグが書きかけの間は本文を空にしておく。
// ツールを使うと返事が複数回に分かれて途中にもタグが出るので、それも本文から消す
function splitTag(text) {
  const m = text.match(/^\s*\[([a-z]+)\]\s*/i);
  const tag = m ? m[1].toLowerCase() : null;
  const body = (m ? text.slice(m[0].length) : text.trimStart())
    .replace(/\s*\[[a-z]+\]\s*/gi, ' ')
    .replace(/\[[a-z]*$/i, '');
  return { tag, body: body.trimStart() };
}

// 文の区切りまで来た分を読み上げキューへ
function speakCompletedSentences(body, flush = false) {
  let rest = body.slice(spokenLen);
  let m;
  while ((m = rest.match(/^[\s\S]*?(?:[。！？!?\n]+|\.+\s+)/))) {
    enqueueSpeech(m[0]);
    spokenLen += m[0].length;
    rest = rest.slice(m[0].length);
  }
  if (flush && rest.trim()) {
    enqueueSpeech(rest);
    spokenLen += rest.length;
  }
}

function finishReply() {
  generating = false;
  sendBtn.disabled = false;
  hideBubbleLater(voiceMode ? 30000 : 15000);
  clearTimeout(expressionTimer);
  expressionTimer = setTimeout(() => character?.setExpression?.(config.expressions?.normal, 'normal'), 15000);
  onSpeechIdle();
}

window.mate.on('chat-chunk', (d) => {
  if (d.id !== currentChatId) return;
  reply += d.text;
  const { tag, body } = splitTag(reply);
  if (tag && !replyTagApplied) {
    replyTagApplied = true;
    character?.setExpression?.(config.expressions?.[tag], tag);
  }
  showBubble(body || '…');
  speakCompletedSentences(body);
});

window.mate.on('chat-done', (d) => {
  if (d.id !== currentChatId) return;
  speakCompletedSentences(splitTag(reply).body, true);
  history.push({ role: 'assistant', content: reply.trim() });
  finishReply();
});

window.mate.on('chat-error', (d) => {
  if (d.id !== currentChatId) return;
  history.pop(); // 失敗した発言は履歴から外す
  showBubble(d.message);
  finishReply();
});

async function ask(text) {
  stopSpeaking();
  history.push({ role: 'user', content: text });
  history = history.slice(-config.maxHistory);

  const id = ++currentChatId;
  reply = '';
  replyTagApplied = false;
  spokenLen = 0;
  generating = true;
  sendBtn.disabled = true;
  setStatus('thinking');
  showBubble('…', text);

  await window.mate.chat(id, [
    { role: 'system', content: systemPrompt() },
    ...history,
  ]);
}

// タイマー・リマインダーの時間になった：驚いた顔で知らせて、声でも伝える
window.mate.on('timer-fired', ({ message, icon = '⏰' }) => {
  character?.setExpression?.(config.expressions?.surprised, 'surprised');
  clearTimeout(expressionTimer);
  expressionTimer = setTimeout(() => character?.setExpression?.(config.expressions?.normal, 'normal'), 8000);
  character?.tap?.();
  showBubble(`${icon} ${message}`, '');
  enqueueSpeech(message);
  hideBubbleLater(30000);
});

window.mate.on('reset-chat', () => {
  stopSpeaking();
  history = [];
  showBubble(ui().reset, '');
  hideBubbleLater(4000);
});

// ---------- 時計・ポモドーロ・タイマーの表示 ----------
// ふだんは時計。ポモドーロ中は残り時間と輪っか、タイマーだけがあるときは一番近いタイマーの残り時間を出す。
// 時間の管理は main.js がしていて、ここは受け取った状態を 1 秒ごとに描くだけ
const clockEl = document.getElementById('clock');
const clockTime = document.getElementById('clock-time');
const clockSub = document.getElementById('clock-sub');
const clockRing = document.getElementById('clock-ring-bar');
const clockDots = document.getElementById('clock-dots');
const clockButtons = document.getElementById('clock-actions');
const RING_LEN = 2 * Math.PI * 21;
let clock = null;      // main.js から受け取った状態

const two = (n) => String(n).padStart(2, '0');
function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

function setRing(frac) {
  clockRing.style.strokeDashoffset = String(RING_LEN * (1 - Math.min(1, Math.max(0, frac))));
}

function renderClock() {
  if (!clock) return;
  const p = clock.pomodoro;
  const timer = clock.timers?.[0];
  const mode = p?.running ? 'pomodoro' : timer ? 'timer' : 'clock';
  clockEl.classList.toggle('hidden', !clock.show && mode === 'clock');
  clockEl.dataset.mode = mode;
  clockEl.dataset.side = clock.side || 'right';
  clockEl.dataset.phase = p?.running ? p.phase : '';
  clockEl.classList.toggle('paused', !!p?.paused);
  const now = new Date();
  if (mode === 'pomodoro') {
    const left = p.paused ? p.remaining : p.endsAt - Date.now();
    clockTime.textContent = mmss(left);
    clockSub.textContent = p.paused ? ui().paused : ui().phases[p.phase];
    setRing(1 - left / p.total);
    // 長い休憩までの 4 回のうち、何回終えたか
    const inSet = p.phase === 'long' ? p.longEvery : p.done % p.longEvery;
    clockDots.innerHTML = Array.from({ length: p.longEvery }, (_, i) => `<i class="${i < inSet ? 'on' : ''}"></i>`).join('');
  } else if (mode === 'timer') {
    const left = timer.due - Date.now();
    clockTime.textContent = mmss(left);
    clockSub.textContent = ui().timerLeft(clock.timers.length);
    clockEl.title = timer.message;
    setRing(1 - left / timer.total);
    clockDots.innerHTML = '';
  } else {
    clockTime.textContent = `${two(now.getHours())}:${two(now.getMinutes())}`;
    clockSub.textContent = ui().date(now, ui().weekdays[now.getDay()]);
    clockEl.title = '';
    clockDots.innerHTML = '';
  }
  renderClockButtons(mode, p);
}

// 時計にマウスを乗せたときに出すボタン（同じ並びなら作り直さない）
// アイコンだけを並べ、マウスを乗せたボタンの上に名前（「ポモドーロ」「タイマー」など）を出す。
// タイマーのボタンを押すと、長さを選ぶボタン（1分・3分…）に切り替わる
const TIMER_PRESETS = [1, 3, 5, 10, 15, 30, 60];
const ICON_PATHS = {
  // ポモドーロ：くり返しの矢印と時計の針（集中と休憩をくり返す）
  start: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v3.5H16"/><path d="M12 8.5V12l2.5 1.5"/>',
  // ストップウォッチ（タイマー）
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3h4M12 3v3.5M18 7.5l1.3-1.3"/>',
  // ストップウォッチに斜線（タイマーを取り消す）
  cancelTimers: '<circle cx="12" cy="13.5" r="7"/><path d="M10 3h4M12 3v3.5M7.5 9l9 9"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  resume: '<path d="M8 5.5v13l10.5-6.5Z"/>',
  skip: '<path d="M6 6v12l8.5-6Z"/><path d="M18 6v12"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  back: '<path d="M7 7l10 10M17 7 7 17"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
let pickingTimer = false;
let clockButtonsKey = '';

function renderClockButtons(mode, p) {
  const B = ui().clockButtons;
  let list;
  if (pickingTimer) {
    list = [
      ...TIMER_PRESETS.map((m) => [`timer:${m}`, ui().timerPreset(m), () => { window.mate.timer('start', m); setPicking(false); }]),
      ['back', null, () => setPicking(false)],
    ];
  } else {
    const pomo = mode === 'pomodoro' ? [p.paused ? 'resume' : 'pause', 'skip', 'stop'] : ['start'];
    list = [
      ...pomo.map((a) => [a, null, () => window.mate.pomodoro(a)]),
      ['timer', null, () => setPicking(true)],
      ...(clock?.timers?.length ? [['cancelTimers', null, () => window.mate.timer('cancel')]] : []),
    ];
  }
  const key = list.map(([a]) => a).join(',') + config?.lang;
  if (key === clockButtonsKey) return;
  clockButtonsKey = key;
  clockButtons.innerHTML = '';
  for (const [action, text, onClick] of list) {
    const b = document.createElement('button');
    b.type = 'button';
    if (text) {
      b.textContent = text; // 長さを選ぶボタン（「5分」など）は文字で出す
      b.className = 'pill';
    } else {
      b.innerHTML = icon(action);
      b.dataset.label = B[action] || '';
      b.setAttribute('aria-label', B[action] || '');
    }
    b.addEventListener('click', onClick);
    clockButtons.appendChild(b);
  }
}

function setPicking(on) {
  pickingTimer = on;
  clockEl.classList.toggle('picking', on);
  renderClock();
}

// 選んでいる途中で時計からマウスが離れたら、元のボタンに戻す
clockEl.addEventListener('mouseleave', () => { if (pickingTimer) setPicking(false); });

function setClock(state) {
  clock = state;
  renderClock();
}

window.mate.on('clock-state', setClock);
// 秒の変わり目に合わせて描く
(function tick() {
  renderClock();
  setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
}());

// ---------- 配色 ----------

let appliedThemeKeys = [];

// CSS 変数を差し替える（前に付けた変数は外して、style.css の既定に戻してから付ける）
function applyTheme(theme = {}) {
  const root = document.documentElement.style;
  for (const k of appliedThemeKeys) root.removeProperty(`--${k}`);
  appliedThemeKeys = Object.keys(theme);
  for (const [k, v] of Object.entries(theme)) root.setProperty(`--${k}`, v);
}

// キャラを描いた画像から配色を作る（描けないキャラなら null）
async function autoThemeFromCharacter() {
  if (!character?.snapshot) return null;
  // テクスチャが読み込まれて 1〜2 回描かれるのを待ってから、まばたきなどでぶれないよう少しずつ間をあけて 4 枚撮る
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const shots = [];
    for (let i = 0; i < 4; i++) {
      await frame();
      shots.push(character.snapshot());
      await new Promise((r) => setTimeout(r, 120));
    }
    return window.ThemeUtil.autoTheme(shots)?.theme || null;
  } catch (err) {
    console.warn('[theme] 自動の配色を作れませんでした', err);
    return null;
  }
}

// 配色設定画面からの操作
window.mate.on('apply-theme', (theme) => applyTheme(theme));
window.mate.on('theme-auto-request', async () => {
  window.mate.themeAutoResult(await autoThemeFromCharacter());
});

// ---------- 起動 ----------

(async () => {
  config = await window.mate.getConfig();
  bubbleName.textContent = config.characterName;
  document.documentElement.lang = config.lang || 'ja';
  input.placeholder = ui().placeholder;
  micBtn.title = ui().mic(keyLabel(config.hotkeys?.voiceChat) || 'Ctrl+Alt+V');
  sendBtn.title = ui().send;
  const hasTheme = Object.keys(config.theme || {}).length > 0;
  if (hasTheme) applyTheme(config.theme);
  setClock(await window.mate.clockState());
  if (config.stt?.enabled) window.mate.sttWarmup('start');
  else micBtn.classList.add('hidden');

  try {
    if (config.modelUrl && config.characterType === 'gltf') {
      const canvas3d = document.getElementById('stage3d');
      canvas.classList.add('hidden');
      canvas3d.classList.remove('hidden');
      const { createGltfCharacter } = await import('./three-character.js');
      let savedPose = null;
      let savedLegs = null;
      try {
        savedPose = localStorage.getItem(poseKey());
        savedLegs = localStorage.getItem(legsKey());
      } catch {}
      character = await createGltfCharacter(canvas3d, config.modelUrl, {
        ...config.model3d,
        pose: savedPose || config.model3d?.pose,
        legs: savedLegs || config.model3d?.legs,
      });
    } else {
      character = config.modelUrl ? await loadLive2D(config.modelUrl) : createPlaceholder();
    }
  } catch (err) {
    console.error(err);
    canvas.classList.remove('hidden');
    character = createPlaceholder();
    showBubble(ui().modelLoadError(err.message), '');
    hideBubbleLater(10000);
    return;
  }
  // 配色が決まっていないキャラ（読み込んだモデルなど）は、見た目から配色を作る
  if (!hasTheme) {
    const auto = await autoThemeFromCharacter();
    if (auto) applyTheme(auto);
    window.mate.themeApplied(auto || {}, true);
  } else {
    window.mate.themeApplied(config.theme);
  }
  showBubble(ui().greeting(config.characterName), '');
  hideBubbleLater(8000);
})();
