// セットアップ画面：main 側の setup.js で調べた結果を表示し、ボタンで準備を進める
const itemsEl = document.getElementById('items');
const noteEl = document.getElementById('note');
const startBtn = document.getElementById('start');
const recheckBtn = document.getElementById('recheck');

let status = {};
let busy = null; // 実行中の操作の名前

// 各項目の表示内容。state ごとに、色（ok / warn / ng / wait）・説明・ボタンを決める
const ITEMS = [
  {
    key: 'ollama',
    title: 'Ollama（会話する AI を動かすソフト）',
    link: ['openOllamaSite', '公式サイト'],
    view: (s) => ({
      ok: { tone: 'ok', desc: `起動しています（${s.detail}）` },
      stopped: { tone: 'warn', desc: 'インストールされていますが、起動していません。', actions: [['startOllama', '起動する', true]] },
      missing: {
        tone: 'ng',
        desc: 'インストールされていません。ダウンロードページから入れて、終わったら「再チェック」を押してください。',
        actions: [['openOllamaDownload', 'ダウンロードページを開く', true]],
      },
    })[s.state],
  },
  {
    key: 'model',
    title: '会話モデル',
    view: (s) => ({
      ok: { tone: 'ok', desc: `${s.detail} が入っています` },
      missing: { tone: 'ng', desc: `${s.detail} をダウンロードします（約 5GB、数分〜数十分）。`, actions: [['pullModel', 'ダウンロードする', true]] },
      unknown: { tone: 'warn', desc: `${s.detail} が入っているか確認できませんでした。` },
      waiting: { tone: 'wait', desc: `Ollama が起動したら、${s.detail} があるか確認します。` },
    })[s.state],
  },
  {
    key: 'voicevox',
    title: 'VOICEVOX（声で話させるとき）',
    optional: true,
    link: ['openVoicevoxSite', '公式サイト'],
    view: (s) => ({
      ok: { tone: 'ok', desc: '使えます。' },
      stopped: { tone: 'warn', desc: 'インストールされています。話すときはアプリが自動で起動します。', actions: [['startVoicevox', '今すぐ起動して確かめる']] },
      missing: {
        tone: s.enabled ? 'warn' : 'wait',
        desc: '入っていません。声で話させたいときは、ダウンロードして一度起動してください。文字だけで話すなら不要です。',
        actions: [['openVoicevoxDownload', 'ダウンロードページを開く']],
      },
    })[s.state],
  },
  {
    key: 'mic',
    title: 'マイク（声で話しかけるとき）',
    view: (s) => ({
      ok: { tone: 'ok', desc: s.detail || '使えます。' },
      ask: { tone: 'warn', desc: 'マイクを使う許可がまだです。', actions: [['requestMic', '許可する', true]] },
      denied: {
        tone: 'ng',
        desc: 'マイクの使用が許可されていません。設定の「プライバシー → マイク」でこのアプリを許可してください。',
        actions: [['openMicSettings', '設定を開く']],
      },
    })[s.state],
  },
  {
    key: 'stt',
    title: '音声認識モデル（声で話しかけるとき）',
    optional: true,
    view: (s) => ({
      ok: { tone: 'ok', desc: '準備できています。' },
      notLoaded: {
        tone: 'wait',
        desc: '初めて声で話しかけたときに自動でダウンロードされます（約 1GB）。今のうちに準備することもできます。',
        actions: [['prepareStt', '今すぐ準備する']],
      },
    })[s.state],
  },
];

function render() {
  itemsEl.innerHTML = '';
  for (const item of ITEMS) {
    const s = status[item.key];
    if (!s) continue;
    const v = item.view(s) || { tone: 'wait', desc: '' };
    const el = document.createElement('div');
    el.className = 'item';
    el.dataset.state = v.tone;
    el.innerHTML = `
      <span class="dot"></span>
      <div class="title"></div>
      <div class="desc"></div>
      <div class="actions"></div>
      <div class="progress" id="progress-${item.key}"><div class="bar"><i></i></div><small></small></div>`;
    el.querySelector('.title').textContent = item.title;
    if (item.optional) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '任意';
      el.querySelector('.title').append(tag);
    }
    el.querySelector('.desc').textContent = v.desc;
    for (const [action, label, primary] of v.actions || []) {
      const b = document.createElement('button');
      b.textContent = busy === action ? '実行中…' : label;
      if (primary) b.classList.add('primary');
      b.disabled = !!busy;
      b.addEventListener('click', () => run(action));
      el.querySelector('.actions').append(b);
    }
    // 入っていてもいなくても、公式サイトはいつでも開けるようにしておく
    if (item.link) {
      const [action, label] = item.link;
      const a = document.createElement('button');
      a.className = 'link';
      a.textContent = `${label} ↗`;
      a.addEventListener('click', () => window.setup.action(action));
      el.querySelector('.actions').append(a);
    }
    itemsEl.append(el);
  }

  const ready = status.ollama?.state === 'ok' && status.model?.state === 'ok';
  startBtn.textContent = ready ? 'はじめる' : 'あとで設定する';
  startBtn.classList.toggle('primary', ready);
  noteEl.textContent = ready
    ? '準備ができました。'
    : 'Ollama と会話モデルがそろうと話せるようになります。この画面は右クリックメニューからいつでも開けます。';
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
    alert(`うまくいきませんでした。\n${err.message}`);
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
  } else if (p.item === 'stt') {
    pct = p.progress;
    text = `${p.file} をダウンロード中`;
  }
  if (pct !== null) box.querySelector('i').style.width = `${Math.min(100, pct).toFixed(1)}%`;
  box.querySelector('small').textContent = text;
});

recheckBtn.addEventListener('click', check);
startBtn.addEventListener('click', () => window.setup.done());

// インストールしている間に戻ってきたら自動で確認し直す
window.addEventListener('focus', () => { if (!busy) check(); });

check();
