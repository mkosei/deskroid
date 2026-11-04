// 配色設定画面：基本の 6 色を選ぶと ThemeUtil.buildTheme で全部の変数を作り、プレビューとキャラ画面に反映する
const { buildTheme, baseFromTheme } = window.ThemeUtil;
const previewEl = document.getElementById('preview');
const statusEl = document.getElementById('status');
const inputs = {
  panel: document.getElementById('panel'),
  panelAlpha: document.getElementById('panelAlpha'),
  text: document.getElementById('text'),
  accent: document.getElementById('accent'),
  nameBg: document.getElementById('nameBg'),
  nameText: document.getElementById('nameText'),
};

let base = null;
let theme = {};
let previewTimer = null;
let lang = 'ja';

// 画面の文言（themeApi.get の lang で切り替え）
const TEXT = {
  ja: {
    heading: '配色設定',
    previewYou: 'あなた：こんにちは',
    previewReply: 'やっほー、今日もいい天気だね。',
    placeholder: '話しかける…',
    panel: '背景', panelHint: '吹き出しと入力欄の地の色',
    text: '文字', textHint: '吹き出しの文字',
    accent: '強調色', accentHint: '送信ボタン・枠線・「話しています」の点',
    nameBg: '名札', nameBgHint: '吹き出しの左上の名前',
    nameText: '名札の文字',
    auto: 'キャラの見た目から自動で作る',
    reset: '元の配色に戻す',
    close: '閉じる',
    save: '保存',
    lead: (name) => `「${name}」の配色です。色を変えると、キャラの吹き出しや入力欄にすぐ反映されます。`,
    autoRunning: 'キャラの色を調べています…',
    autoFailed: 'このキャラからは色を取り出せませんでした。',
    autoDone: 'キャラの見た目から配色を作りました。よければ「保存」を押してください。',
    resetDone: '保存していた配色を消して、元の配色に戻しました。',
  },
  en: {
    heading: 'Color settings',
    previewYou: 'You: Hello',
    previewReply: "Hey there, it's a nice day again today.",
    placeholder: 'Say something…',
    panel: 'Background', panelHint: 'Base color of the speech bubble and input box',
    text: 'Text', textHint: 'Text in the speech bubble',
    accent: 'Accent', accentHint: 'Send button, borders and the "Speaking" dot',
    nameBg: 'Name tag', nameBgHint: 'The name at the top left of the speech bubble',
    nameText: 'Name tag text',
    auto: "Generate from the character's look",
    reset: 'Restore the original colors',
    close: 'Close',
    save: 'Save',
    lead: (name) => `Colors for "${name}". Changes show up right away on the character's speech bubble and input box.`,
    autoRunning: "Checking the character's colors…",
    autoFailed: "Couldn't get colors from this character.",
    autoDone: 'Generated colors from the character\'s look. Press "Save" if you like them.',
    resetDone: 'Removed the saved colors and restored the original ones.',
  },
};
const t = () => TEXT[lang] || TEXT.ja;

function readInputs() {
  return {
    panel: inputs.panel.value,
    panelAlpha: Number(inputs.panelAlpha.value),
    text: inputs.text.value,
    accent: inputs.accent.value,
    nameBg: inputs.nameBg.value,
    nameText: inputs.nameText.value,
  };
}

function writeInputs(b) {
  for (const [k, el] of Object.entries(inputs)) el.value = b[k];
  document.getElementById('alphaPct').textContent = `${Math.round(b.panelAlpha * 100)}%`;
}

// この画面のプレビューに配色を付け、キャラ画面にも少し間をおいて送る
function show(nextTheme, { send = true } = {}) {
  theme = nextTheme;
  for (const [k, v] of Object.entries(theme)) previewEl.style.setProperty(`--${k}`, v);
  if (!send) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => window.themeApi.preview(theme), 60);
}

function setFromTheme(t, opts) {
  base = baseFromTheme(t);
  writeInputs(base);
  show(buildTheme(base), opts);
}

for (const el of Object.values(inputs)) {
  el.addEventListener('input', () => {
    base = readInputs();
    document.getElementById('alphaPct').textContent = `${Math.round(base.panelAlpha * 100)}%`;
    show(buildTheme(base));
    statusEl.textContent = '';
  });
}

document.getElementById('auto').addEventListener('click', async () => {
  statusEl.textContent = t().autoRunning;
  const auto = await window.themeApi.auto();
  if (!auto) {
    statusEl.textContent = t().autoFailed;
    return;
  }
  setFromTheme(auto);
  statusEl.textContent = t().autoDone;
});

document.getElementById('reset').addEventListener('click', async () => {
  const saved = await window.themeApi.reset();
  setFromTheme(saved, { send: false });
  statusEl.textContent = t().resetDone;
});

document.getElementById('save').addEventListener('click', async () => {
  await window.themeApi.save(theme);
  window.close();
});

document.getElementById('close').addEventListener('click', () => window.close());

(async () => {
  const info = await window.themeApi.get();
  lang = info.lang || 'ja';
  const T = t();
  document.documentElement.lang = lang;
  document.title = T.heading;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T[el.dataset.t];
  document.getElementById('p-name').textContent = info.characterName;
  document.getElementById('lead').textContent = T.lead(info.characterName);
  // 今の配色をそのまま見せる（グラデーションの名札なども崩さないよう、最初は元の値を使う）
  base = baseFromTheme(info.theme);
  writeInputs(base);
  show(Object.keys(info.theme).length ? info.theme : buildTheme(base), { send: false });
})();
