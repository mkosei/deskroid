// セットアップ画面：main 側の setup.js で調べた結果を表示し、ボタンで準備を進める
const itemsEl = document.getElementById('items');
const noteEl = document.getElementById('note');
const startBtn = document.getElementById('start');
const recheckBtn = document.getElementById('recheck');

let status = {};
let busy = null; // 実行中の操作の名前

// 画面の文言（status.lang で切り替え）
const TEXT = {
  ja: {
    heading: 'セットアップ',
    lead: 'キャラと話すために必要なものを確認します。足りないものはボタンから準備できます。',
    recheck: '再チェック',
    start: 'はじめる',
    later: 'あとで設定する',
    ready: '準備ができました。',
    notReady: 'Ollama と会話モデルがそろうと話せるようになります。この画面は右クリックメニューからいつでも開けます。',
    optional: '任意',
    running: '実行中…',
    officialSite: '公式サイト',
    failed: (msg) => `うまくいきませんでした。\n${msg}`,
    downloading: (file) => `${file} をダウンロード中`,
    ollama: {
      title: 'Ollama（会話する AI を動かすソフト）',
      ok: (v) => `起動しています（バージョン ${v}）`,
      stopped: 'インストールされていますが、起動していません。',
      start: '起動する',
      missing: 'インストールされていません。ダウンロードページから入れて、終わったら「再チェック」を押してください。',
      download: 'ダウンロードページを開く',
    },
    model: {
      title: '会話モデル',
      ok: (m) => `${m} が入っています`,
      missing: (m) => `${m} をダウンロードします（約 5GB、数分〜数十分）。`,
      download: 'ダウンロードする',
      unknown: (m) => `${m} が入っているか確認できませんでした。`,
      waiting: (m) => `Ollama が起動したら、${m} があるか確認します。`,
    },
    voicevox: {
      title: 'VOICEVOX（声で話させるとき）',
      ok: '使えます。',
      stopped: 'インストールされています。話すときはアプリが自動で起動します。',
      start: '今すぐ起動して確かめる',
      missing: '入っていません。「声を入れる」を押すと、VOICEVOX のエンジン（全部の声。約 1.9GB、展開すると約 2.2GB）を公式の配布元からダウンロードして使えるようにします。文字だけで話すなら不要です。',
      install: '声を入れる',
      terms: '利用規約',
      termsNote: 'VOICEVOX と、声ごとのキャラクターの利用規約に従って使ってください。作った音声を公開するときは「VOICEVOX:ずんだもん」のようなクレジットが必要です。',
      download: 'ダウンロードページを開く',
      phases: {
        prepare: '準備中…',
        download: (r, t) => `ダウンロード中  ${(r / 1e9).toFixed(2)} / ${(t / 1e9).toFixed(2)} GB`,
        extract: '展開中…（数分かかることがあります）',
        done: '入りました。エンジンを起動しています…',
      },
    },
    kokoro: {
      title: '英語の声（Kokoro）',
      ok: '準備できています。',
      notLoaded: '初めて話すときに自動でダウンロードされます（約 90MB）。今のうちに準備することもできます。',
      prepare: '今すぐ準備する',
    },
    mic: {
      title: 'マイク（声で話しかけるとき）',
      ok: '使えます。',
      askOnUse: '使うときに確認されます',
      ask: 'マイクを使う許可がまだです。',
      allow: '許可する',
      denied: 'マイクの使用が許可されていません。設定の「プライバシー → マイク」でこのアプリを許可してください。',
      settings: '設定を開く',
    },
    stt: {
      title: '音声認識モデル（声で話しかけるとき）',
      ok: '準備できています。',
      notLoaded: '初めて声で話しかけたときに自動でダウンロードされます（約 1GB）。今のうちに準備することもできます。',
      prepare: '今すぐ準備する',
    },
  },
  en: {
    heading: 'Setup',
    lead: 'This checks what you need to talk with your character. Anything missing can be set up with the buttons.',
    recheck: 'Check again',
    start: 'Start',
    later: 'Set up later',
    ready: "You're all set.",
    notReady: 'You can start talking once Ollama and the chat model are ready. You can open this screen anytime from the right-click menu.',
    optional: 'Optional',
    running: 'Working…',
    officialSite: 'Official site',
    failed: (msg) => `Something went wrong.\n${msg}`,
    downloading: (file) => `Downloading ${file}`,
    ollama: {
      title: 'Ollama (runs the chat AI)',
      ok: (v) => `Running (version ${v})`,
      stopped: "Installed, but not running.",
      start: 'Start it',
      missing: 'Not installed. Install it from the download page, then press "Check again".',
      download: 'Open the download page',
    },
    model: {
      title: 'Chat model',
      ok: (m) => `${m} is installed`,
      missing: (m) => `Download ${m} (about 5 GB; takes a few minutes to tens of minutes).`,
      download: 'Download',
      unknown: (m) => `Couldn't check whether ${m} is installed.`,
      waiting: (m) => `Once Ollama is running, this checks whether ${m} is installed.`,
    },
    voicevox: {
      title: 'VOICEVOX (for a speaking voice)',
      ok: 'Ready to use.',
      stopped: 'Installed. The app starts it automatically when the character speaks.',
      start: 'Start it now to check',
      missing: 'Not installed. "Install voices" downloads the VOICEVOX engine with all of its voices (about 1.9 GB, about 2.2 GB once unpacked) from the official source. Not needed for text-only chat.',
      install: 'Install voices',
      terms: 'Terms of use',
      termsNote: 'Follow the VOICEVOX terms and the terms for each character voice. If you publish audio you made, credit it like "VOICEVOX:Zundamon".',
      download: 'Open the download page',
      phases: {
        prepare: 'Getting ready…',
        download: (r, t) => `Downloading  ${(r / 1e9).toFixed(2)} / ${(t / 1e9).toFixed(2)} GB`,
        extract: 'Unpacking… (this can take a few minutes)',
        done: 'Installed. Starting the engine…',
      },
    },
    kokoro: {
      title: 'English voice (Kokoro)',
      ok: 'Ready.',
      notLoaded: 'Downloaded automatically the first time the character speaks (about 90 MB). You can also prepare it now.',
      prepare: 'Prepare now',
    },
    mic: {
      title: 'Microphone (for talking by voice)',
      ok: 'Ready to use.',
      askOnUse: "You'll be asked when it's first used",
      ask: "Microphone access hasn't been granted yet.",
      allow: 'Allow',
      denied: 'Microphone access is not allowed. Allow this app under "Privacy → Microphone" in your system settings.',
      settings: 'Open settings',
    },
    stt: {
      title: 'Speech recognition model (for talking by voice)',
      ok: 'Ready.',
      notLoaded: 'Downloaded automatically the first time you talk by voice (about 1 GB). You can also prepare it now.',
      prepare: 'Prepare now',
    },
  },
};
const t = () => TEXT[status.lang] || TEXT.ja;

// 各項目の表示内容。state ごとに、色（ok / warn / ng / wait）・説明・ボタンを決める
const ITEMS = [
  {
    key: 'ollama',
    link: 'openOllamaSite',
    view: (s, x) => ({
      ok: { tone: 'ok', desc: x.ok(s.detail) },
      stopped: { tone: 'warn', desc: x.stopped, actions: [['startOllama', x.start, true]] },
      missing: { tone: 'ng', desc: x.missing, actions: [['openOllamaDownload', x.download, true]] },
    })[s.state],
  },
  {
    key: 'model',
    view: (s, x) => ({
      ok: { tone: 'ok', desc: x.ok(s.detail) },
      missing: { tone: 'ng', desc: x.missing(s.detail), actions: [['pullModel', x.download, true]] },
      unknown: { tone: 'warn', desc: x.unknown(s.detail) },
      waiting: { tone: 'wait', desc: x.waiting(s.detail) },
    })[s.state],
  },
  {
    key: 'voicevox',
    optional: true,
    link: 'openVoicevoxSite',
    view: (s, x) => ({
      ok: { tone: 'ok', desc: x.ok },
      stopped: { tone: 'warn', desc: x.stopped, actions: [['startVoicevox', x.start]] },
      missing: { tone: s.enabled ? 'warn' : 'wait', desc: x.missing, note: x.termsNote, actions: [['installVoicevox', x.install, true], ['openVoicevoxTerms', x.terms]] },
    })[s.state],
  },
  {
    key: 'kokoro',
    optional: true,
    view: (s, x) => ({
      ok: { tone: 'ok', desc: x.ok },
      notLoaded: { tone: 'wait', desc: x.notLoaded, actions: [['prepareKokoro', x.prepare]] },
    })[s.state],
  },
  {
    key: 'mic',
    view: (s, x) => ({
      ok: { tone: 'ok', desc: s.askOnUse ? x.askOnUse : x.ok },
      ask: { tone: 'warn', desc: x.ask, actions: [['requestMic', x.allow, true]] },
      denied: { tone: 'ng', desc: x.denied, actions: [['openMicSettings', x.settings]] },
    })[s.state],
  },
  {
    key: 'stt',
    optional: true,
    view: (s, x) => ({
      ok: { tone: 'ok', desc: x.ok },
      notLoaded: { tone: 'wait', desc: x.notLoaded, actions: [['prepareStt', x.prepare]] },
    })[s.state],
  },
];

function render() {
  const T = t();
  document.documentElement.lang = status.lang || 'ja';
  document.title = T.heading;
  document.getElementById('heading').textContent = T.heading;
  document.getElementById('lead').textContent = T.lead;
  recheckBtn.textContent = T.recheck;

  itemsEl.innerHTML = '';
  for (const item of ITEMS) {
    const s = status[item.key];
    if (!s) continue;
    const x = T[item.key];
    const v = item.view(s, x) || { tone: 'wait', desc: '' };
    const el = document.createElement('div');
    el.className = 'item';
    el.dataset.state = v.tone;
    el.innerHTML = `
      <span class="dot"></span>
      <div class="title"></div>
      <div class="desc"></div>
      <div class="actions"></div>
      <div class="progress" id="progress-${item.key}"><div class="bar"><i></i></div><small></small></div>`;
    el.querySelector('.title').textContent = x.title;
    if (item.optional) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = T.optional;
      el.querySelector('.title').append(tag);
    }
    el.querySelector('.desc').textContent = v.desc;
    if (v.note) {
      const n = document.createElement('small');
      n.className = 'note';
      n.textContent = v.note;
      el.querySelector('.desc').append(n);
    }
    for (const [action, label, primary] of v.actions || []) {
      const b = document.createElement('button');
      b.textContent = busy === action ? T.running : label;
      if (primary) b.classList.add('primary');
      b.disabled = !!busy;
      b.addEventListener('click', () => run(action));
      el.querySelector('.actions').append(b);
    }
    // 入っていてもいなくても、公式サイトはいつでも開けるようにしておく
    if (item.link) {
      const a = document.createElement('button');
      a.className = 'link';
      a.textContent = `${T.officialSite} ↗`;
      a.addEventListener('click', () => window.setup.action(item.link));
      el.querySelector('.actions').append(a);
    }
    itemsEl.append(el);
  }

  const ready = status.ollama?.state === 'ok' && status.model?.state === 'ok';
  startBtn.textContent = ready ? T.start : T.later;
  startBtn.classList.toggle('primary', ready);
  noteEl.textContent = ready ? T.ready : T.notReady;
  recheckBtn.disabled = !!busy;
}

async function check() {
  status = await window.setup.check();
  render();
}

async function run(action) {
  busy = action;
  render();
  try {
    await window.setup.action(action);
  } catch (err) {
    alert(t().failed(err.message));
  } finally {
    busy = null;
    await check();
  }
}

// ダウンロードの進み具合
window.setup.onProgress((p) => {
  const box = document.getElementById(`progress-${p.item}`);
  if (!box) return;
  box.classList.add('on');
  let pct = null;
  let text = '';
  if (p.item === 'model') {
    if (p.total) pct = (p.completed || 0) / p.total * 100;
    text = p.total ? `${p.status}  ${(p.completed / 1e9 || 0).toFixed(2)} / ${(p.total / 1e9).toFixed(2)} GB` : p.status;
  } else if (p.item === 'voicevox') {
    const P = t().voicevox.phases;
    if (p.phase === 'download' && p.total) pct = p.received / p.total * 100;
    if (p.phase === 'extract' || p.phase === 'done') pct = 100;
    text = p.phase === 'download' ? P.download(p.received, p.total) : P[p.phase] || '';
  } else if (p.item === 'stt' || p.item === 'kokoro') {
    pct = p.progress;
    text = t().downloading(p.file);
  }
  if (pct !== null) box.querySelector('i').style.width = `${Math.min(100, pct).toFixed(1)}%`;
  box.querySelector('small').textContent = text;
});

recheckBtn.addEventListener('click', check);
startBtn.addEventListener('click', () => window.setup.done());

// インストールしている間に戻ってきたら自動で確認し直す
window.addEventListener('focus', () => { if (!busy) check(); });

check();
