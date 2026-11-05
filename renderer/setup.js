// セットアップ画面：main 側の setup.js で調べた結果を表示し、ボタンで準備を進める
const itemsEl = document.getElementById('items');
const noteEl = document.getElementById('note');
const startBtn = document.getElementById('start');
const recheckBtn = document.getElementById('recheck');
const allEl = document.getElementById('all');

let status = {};
let busy = null; // 実行中の操作の名前
let runningAll = false; // 「まとめて準備する」の途中か
const skipped = new Set(); // 「まとめて準備する」で外した項目

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
    gb: (n) => `約 ${n < 1 ? n.toFixed(1) : Math.round(n * 10) / 10}GB`,
    all: {
      title: 'まとめて準備する',
      lead: '足りないものを、上から順に全部準備します。外したいものはチェックを外してください。',
      total: (size, free) => `ダウンロード 合計 ${size}${free ? `（ディスクの空き ${free}）` : ''}`,
      lowDisk: 'ディスクの空きが足りないかもしれません。',
      button: 'まとめて準備する',
      running: (name) => `準備中：${name}`,
      steps: {
        installOllama: 'Ollama を入れる',
        startOllama: 'Ollama を起動する',
        pullModel: (m) => `会話モデル（${m}）を入れる`,
        installVoicevox: '声（VOICEVOX）を入れる',
        prepareKokoro: '英語の声（Kokoro）を準備する',
        prepareStt: '音声認識モデルを準備する',
        requestMic: 'マイクの使用を許可する',
      },
    },
    pc: {
      title: 'この PC の性能',
      summary: (ram, gpu, free) => [`メモリ ${ram}GB`, gpu, free && `空き容量 ${free}`].filter(Boolean).join(' / '),
      gpu: (name, vram) => `GPU ${name}（VRAM ${vram}GB）`,
      apple: 'Apple シリコン（GPU はメモリを共有）',
      noGpu: 'GPU なし（CPU で動かします）',
      good: (m) => `会話する AI を快適に動かせます。おすすめのモデルは ${m} です。`,
      ok: (m) => `動きますが、軽いモデル（おすすめは ${m}）になるので、返事が遅めだったり、道具の使い分けが苦手だったりします。`,
      low: 'メモリが少ないので、会話する AI を動かすのはかなり厳しいです。',
      guide: '目安：メモリ 8GB 以上。メモリ 16GB 以上か、VRAM 6GB 以上の GPU（NVIDIA・AMD）があると快適です。',
    },
    ollama: {
      title: 'Ollama（会話する AI を動かすソフト）',
      ok: (v) => `起動しています（バージョン ${v}）`,
      stopped: 'インストールされていますが、起動していません。',
      start: '起動する',
      missing: (size) => `入っていません。「Ollama を入れる」を押すと、公式の配布元からダウンロードして入れます${size ? `（${size}）` : ''}。`,
      install: 'Ollama を入れる',
      download: 'ダウンロードページを開く',
      phases: {
        prepare: '準備中…',
        download: (r, t) => `ダウンロード中  ${(r / 1e9).toFixed(2)} / ${(t / 1e9).toFixed(2)} GB`,
        install: 'インストール中…（1〜2 分かかることがあります）',
        done: '入りました。起動しています…',
      },
    },
    model: {
      title: '会話モデル',
      ok: (m) => `${m} が入っています`,
      heavy: (m) => `${m} が入っていますが、この PC には重いかもしれません。返事が遅いときは、軽いモデルに変えてください。`,
      missing: '話すときに使うモデルを選んで、ダウンロードします（数分〜数十分）。',
      download: 'ダウンロードする',
      change: 'このモデルに変える',
      unknown: (m) => `${m} が入っているか確認できませんでした。`,
      waiting: 'Ollama が起動したらダウンロードできます。先に、使うモデルを選んでおけます。',
      notes: {
        'qwen3:8b': '標準',
        'qwen3:4b': '軽量',
        'qwen3:1.7b': 'とても軽い・道具の使い分けは苦手',
        'qwen3:0.6b': '最軽量・道具の使い分けは苦手',
      },
      fit: { gpu: '', cpu: 'GPU なしで遅め', heavy: 'この PC には重い' },
      recommended: 'おすすめ',
    },
    voicevox: {
      title: 'VOICEVOX（声で話させるとき）',
      ok: '使えます。',
      stopped: 'インストールされています。話すときはアプリが自動で起動します。',
      start: '今すぐ起動して確かめる',
      missing: '入っていません。「声を入れる」を押すと、VOICEVOX のエンジン（全部の声。約 2GB、展開すると約 2.2GB）を公式の配布元からダウンロードして使えるようにします。文字だけで話すなら不要です。',
      install: '声を入れる',
      update: (v, c, gb) => `新しい版（${v}）が出ています。今は ${c} です。更新すると、約 ${gb}GB をダウンロードして入れ替えます。`,
      updateButton: '更新する',
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
    gb: (n) => `about ${n < 1 ? n.toFixed(1) : Math.round(n * 10) / 10} GB`,
    all: {
      title: 'Set up everything',
      lead: 'Sets up everything that is missing, from top to bottom. Uncheck anything you want to skip.',
      total: (size, free) => `Total download ${size}${free ? ` (${free} free on disk)` : ''}`,
      lowDisk: 'There may not be enough free disk space.',
      button: 'Set up everything',
      running: (name) => `Setting up: ${name}`,
      steps: {
        installOllama: 'Install Ollama',
        startOllama: 'Start Ollama',
        pullModel: (m) => `Install the chat model (${m})`,
        installVoicevox: 'Install voices (VOICEVOX)',
        prepareKokoro: 'Prepare the English voice (Kokoro)',
        prepareStt: 'Prepare the speech recognition model',
        requestMic: 'Allow microphone access',
      },
    },
    pc: {
      title: 'This PC',
      summary: (ram, gpu, free) => [`${ram} GB memory`, gpu, free && `${free} free on disk`].filter(Boolean).join(' / '),
      gpu: (name, vram) => `GPU ${name} (${vram} GB VRAM)`,
      apple: 'Apple silicon (GPU shares the memory)',
      noGpu: 'No GPU (runs on the CPU)',
      good: (m) => `This PC runs the chat AI comfortably. Recommended model: ${m}.`,
      ok: (m) => `It works, but with a lighter model (recommended: ${m}), so replies may be slow and it may be weaker at choosing tools.`,
      low: 'This PC has little memory, so running the chat AI will be very hard.',
      guide: 'Guide: 8 GB of memory or more. 16 GB of memory, or a GPU (NVIDIA or AMD) with 6 GB of VRAM or more, is comfortable.',
    },
    ollama: {
      title: 'Ollama (runs the chat AI)',
      ok: (v) => `Running (version ${v})`,
      stopped: "Installed, but not running.",
      start: 'Start it',
      missing: (size) => `Not installed. "Install Ollama" downloads it from the official source and installs it${size ? ` (${size})` : ''}.`,
      install: 'Install Ollama',
      download: 'Open the download page',
      phases: {
        prepare: 'Getting ready…',
        download: (r, t) => `Downloading  ${(r / 1e9).toFixed(2)} / ${(t / 1e9).toFixed(2)} GB`,
        install: 'Installing… (this can take a minute or two)',
        done: 'Installed. Starting it…',
      },
    },
    model: {
      title: 'Chat model',
      ok: (m) => `${m} is installed`,
      heavy: (m) => `${m} is installed, but it may be too heavy for this PC. If replies are slow, switch to a lighter model.`,
      missing: 'Choose the model to talk with, then download it (a few minutes to tens of minutes).',
      download: 'Download',
      change: 'Switch to this model',
      unknown: (m) => `Couldn't check whether ${m} is installed.`,
      waiting: 'You can download it once Ollama is running. You can choose the model now.',
      notes: {
        'qwen3:8b': 'standard',
        'qwen3:4b': 'light',
        'qwen3:1.7b': 'very light, weaker at choosing tools',
        'qwen3:0.6b': 'lightest, weaker at choosing tools',
      },
      fit: { gpu: '', cpu: 'slow without a GPU', heavy: 'too heavy for this PC' },
      recommended: 'recommended',
    },
    voicevox: {
      title: 'VOICEVOX (for a speaking voice)',
      ok: 'Ready to use.',
      stopped: 'Installed. The app starts it automatically when the character speaks.',
      start: 'Start it now to check',
      missing: 'Not installed. "Install voices" downloads the VOICEVOX engine with all of its voices (about 2 GB, about 2.2 GB once unpacked) from the official source. Not needed for text-only chat.',
      install: 'Install voices',
      update: (v, c, gb) => `A new version (${v}) is available; you have ${c}. Updating downloads about ${gb} GB and replaces it.`,
      updateButton: 'Update',
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
const gbText = (n) => (n ? t().gb(n) : '');

// 会話モデルを選ぶ欄（この PC での動きそうな具合と、おすすめを添える）
function modelSelect(s, x) {
  const models = status.pc?.models || [];
  const options = models.map((m) => {
    const extra = [x.notes[m.name], gbText(m.size), x.fit[m.fit], m.name === status.pc.recommended && `★${x.recommended}`].filter(Boolean);
    return [m.name, `${m.name}（${extra.join('・')}）`];
  });
  if (s.choice && !models.some((m) => m.name === s.choice)) options.unshift([s.choice, s.choice]);
  return { options, value: s.choice, action: 'selectModel' };
}

const ITEMS = [
  {
    key: 'pc',
    view: (s, x) => {
      const gpu = s.unified ? x.apple : s.gpu ? x.gpu(s.gpu.name, Math.round(s.gpu.vram)) : x.noGpu;
      const free = s.free ? gbText(s.free).replace(/^約 |^about /, '') : '';
      return {
        tone: { good: 'ok', ok: 'warn', low: 'ng' }[s.level],
        desc: `${x.summary(Math.ceil(s.ram), gpu, free)}\n${x[s.level](s.recommended)}`,
        note: x.guide,
      };
    },
  },
  {
    key: 'ollama',
    link: 'openOllamaSite',
    view: (s, x) => ({
      ok: { tone: 'ok', desc: x.ok(s.detail) },
      stopped: { tone: 'warn', desc: x.stopped, actions: [['startOllama', x.start, true]] },
      missing: { tone: 'ng', desc: x.missing(gbText(s.size)), actions: [['installOllama', x.install, true], ['openOllamaDownload', x.download]] },
    })[s.state],
  },
  {
    key: 'model',
    view: (s, x) => {
      const pick = modelSelect(s, x);
      if (s.state === 'ok' && s.fit === 'heavy') {
        return { tone: 'warn', desc: x.heavy(s.detail), select: { ...pick, value: s.choice === s.detail ? status.pc.recommended : s.choice }, actions: [['pullModel', x.change, true, 'choice']] };
      }
      return {
        ok: { tone: 'ok', desc: x.ok(s.detail) },
        missing: { tone: 'ng', desc: x.missing, select: pick, actions: [['pullModel', x.download, true, 'choice']] },
        unknown: { tone: 'warn', desc: x.unknown(s.detail) },
        waiting: { tone: 'wait', desc: x.waiting, select: pick },
      }[s.state];
    },
  },
  {
    key: 'voicevox',
    optional: true,
    link: 'openVoicevoxSite',
    view: (s, x) => (s.update ? {
      // 自分で入れたエンジンに新しい版があるとき
      tone: 'warn',
      desc: x.update(s.update.version, s.update.current, (s.update.size / 1e9).toFixed(1)),
      actions: [['installVoicevox', x.updateButton, true]],
    } : {
      ok: { tone: 'ok', desc: x.ok },
      stopped: { tone: 'warn', desc: x.stopped, actions: [['startVoicevox', x.start]] },
      missing: { tone: s.enabled ? 'warn' : 'wait', desc: x.missing, note: x.termsNote, actions: [['installVoicevox', x.install, true], ['openVoicevoxTerms', x.terms]] },
    }[s.state]),
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
    if (v.select) {
      const sel = document.createElement('select');
      for (const [value, label] of v.select.options) sel.append(new Option(label, value, false, value === v.select.value));
      sel.disabled = !!busy;
      sel.addEventListener('change', async () => {
        await window.setup.action(v.select.action, sel.value);
        await check();
      });
      el.querySelector('.actions').append(sel);
    }
    for (const [action, label, primary, arg] of v.actions || []) {
      const b = document.createElement('button');
      b.textContent = busy === action ? T.running : label;
      if (primary) b.classList.add('primary');
      b.disabled = !!busy;
      // 'choice' は、選ぶ欄で今選んでいるもの
      b.addEventListener('click', () => run(action, arg === 'choice' ? el.querySelector('select')?.value : arg));
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
    if (item.key === 'pc') itemsEl.append(allEl);
  }

  renderAll();

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

// 「まとめて準備する」でやること。{ action, label, size（GB）, optional, arg }
function pendingSteps() {
  const S = t().all.steps;
  const steps = [];
  const o = status.ollama?.state;
  if (o === 'missing') steps.push({ action: 'installOllama', label: S.installOllama, size: status.ollama.size });
  if (o === 'stopped') steps.push({ action: 'startOllama', label: S.startOllama });
  const m = status.model;
  if (m && (m.state === 'missing' || m.state === 'waiting')) {
    const size = status.pc?.models.find((x) => x.name === m.choice)?.size;
    steps.push({ action: 'pullModel', label: S.pullModel(m.choice), size, arg: m.choice });
  }
  if (status.voicevox?.state === 'missing') steps.push({ action: 'installVoicevox', label: S.installVoicevox, size: status.voicevox.size || 2, optional: true });
  if (status.kokoro?.state === 'notLoaded') steps.push({ action: 'prepareKokoro', label: S.prepareKokoro, size: 0.09, optional: true });
  if (status.stt?.state === 'notLoaded') steps.push({ action: 'prepareStt', label: S.prepareStt, size: 1, optional: true });
  if (status.mic?.state === 'ask') steps.push({ action: 'requestMic', label: S.requestMic, optional: true });
  return steps;
}

// 足りないものが 2 つ以上あるときだけ、上に「まとめて準備する」を出す
function renderAll() {
  const T = t();
  const steps = pendingSteps();
  allEl.innerHTML = '';
  allEl.hidden = !runningAll && steps.length < 2;
  if (allEl.hidden) return;
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = T.all.title;
  const lead = document.createElement('div');
  lead.className = 'desc';
  lead.textContent = T.all.lead;
  const list = document.createElement('div');
  list.className = 'steps';
  for (const step of steps) {
    const row = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !skipped.has(step.action);
    box.disabled = !step.optional || !!busy;
    box.addEventListener('change', () => {
      if (box.checked) skipped.delete(step.action); else skipped.add(step.action);
      renderAll();
    });
    const text = document.createElement('span');
    text.textContent = step.size ? (status.lang === 'en' ? `${step.label} (${gbText(step.size)})` : `${step.label}（${gbText(step.size)}）`) : step.label;
    if (busy === step.action) text.classList.add('now');
    row.append(box, text);
    list.append(row);
  }
  const chosen = steps.filter((s) => !skipped.has(s.action));
  const total = chosen.reduce((n, s) => n + (s.size || 0), 0);
  const free = status.pc?.free;
  const sum = document.createElement('div');
  sum.className = 'desc';
  sum.textContent = T.all.total(gbText(total) || '0GB', free ? gbText(free) : '');
  if (free && free < total * 1.8) {
    const warn = document.createElement('small');
    warn.className = 'note warn';
    warn.textContent = T.all.lowDisk;
    sum.append(warn);
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  const b = document.createElement('button');
  b.className = 'primary';
  b.textContent = runningAll ? T.running : T.all.button;
  b.disabled = !!busy || !chosen.length;
  b.addEventListener('click', runAll);
  actions.append(b);
  allEl.append(title, lead, list, sum, actions);
}

// 足りないものを順に準備する。1 つ終わるたびに確認し直して、次にやることを決め直す
async function runAll() {
  runningAll = true;
  const done = new Set();
  try {
    for (;;) {
      const step = pendingSteps().find((s) => !skipped.has(s.action) && !done.has(s.action));
      if (!step) break;
      done.add(step.action);
      busy = step.action;
      render();
      await window.setup.action(step.action, step.arg);
      await check();
    }
  } catch (err) {
    alert(t().failed(err.message));
  } finally {
    runningAll = false;
    busy = null;
    await check();
  }
}

async function run(action, arg) {
  busy = action;
  render();
  try {
    await window.setup.action(action, arg);
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
  } else if (p.item === 'voicevox' || p.item === 'ollama') {
    const P = t()[p.item].phases;
    if (p.phase === 'download' && p.total) pct = p.received / p.total * 100;
    if (p.phase === 'extract' || p.phase === 'install' || p.phase === 'done') pct = 100;
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
