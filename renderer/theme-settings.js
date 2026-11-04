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
  statusEl.textContent = 'キャラの色を調べています…';
  const auto = await window.themeApi.auto();
  if (!auto) {
    statusEl.textContent = 'このキャラからは色を取り出せませんでした。';
    return;
  }
  setFromTheme(auto);
  statusEl.textContent = 'キャラの見た目から配色を作りました。よければ「保存」を押してください。';
});

document.getElementById('reset').addEventListener('click', async () => {
  const t = await window.themeApi.reset();
  setFromTheme(t, { send: false });
  statusEl.textContent = '保存していた配色を消して、元の配色に戻しました。';
});

document.getElementById('save').addEventListener('click', async () => {
  await window.themeApi.save(theme);
  window.close();
});

document.getElementById('close').addEventListener('click', () => window.close());

(async () => {
  const info = await window.themeApi.get();
  document.getElementById('p-name').textContent = info.characterName;
  document.getElementById('lead').textContent = `「${info.characterName}」の配色です。色を変えると、キャラの吹き出しや入力欄にすぐ反映されます。`;
  // 今の配色をそのまま見せる（グラデーションの名札なども崩さないよう、最初は元の値を使う）
  base = baseFromTheme(info.theme);
  writeInputs(base);
  show(Object.keys(info.theme).length ? info.theme : buildTheme(base), { send: false });
})();
