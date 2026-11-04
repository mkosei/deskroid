// ホットキー設定画面：キーを押してもらって Electron の Accelerator 形式（"Control+Space" など）に直し、保存する
const rowsEl = document.getElementById('rows');
const messageEl = document.getElementById('message');
const saveBtn = document.getElementById('save');

let info = null;    // { current, defaults, labels, isMac }
let draft = {};     // 編集中の値（名前 → Accelerator。空文字は「なし」）
let capturing = null; // キー入力を待っている項目の名前

// e.code → Accelerator のキー名
const CODE_KEYS = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
};

function keyFromCode(code) {
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit(\d)$/))) return m[1];
  if ((m = code.match(/^Numpad(\d)$/))) return `num${m[1]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return CODE_KEYS[code] || null;
}

function toAccelerator(e) {
  const key = keyFromCode(e.code);
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push(info.isMac ? 'Command' : 'Super');
  // 修飾キーなしで使えるのはファンクションキーだけ（普通の文字を奪わないように）
  if (!mods.length && !/^F\d+$/.test(key)) return { error: 'Ctrl・Alt・Shift などと組み合わせてください（F1〜F12 は単独でも使えます）。' };
  return { accel: [...mods, key].join('+') };
}

// 表示用に、OS に合わせた呼び名にする
function keyLabels(accel) {
  const mac = info.isMac;
  const names = {
    Control: 'Ctrl',
    CommandOrControl: mac ? 'Command' : 'Ctrl',
    CmdOrCtrl: mac ? 'Command' : 'Ctrl',
    Alt: mac ? 'Option' : 'Alt',
    Option: 'Option',
    Command: 'Command',
    Cmd: 'Command',
    Super: 'Win',
  };
  return accel.split('+').map((k) => names[k] || k);
}

function render() {
  rowsEl.innerHTML = '';
  for (const name of Object.keys(info.labels)) {
    const value = draft[name] ?? '';
    const row = document.createElement('div');
    row.className = `row${capturing === name ? ' capturing' : ''}`;
    row.innerHTML = '<div class="name"></div><div class="actions"></div><div class="keys"></div>';
    row.querySelector('.name').textContent = info.labels[name];

    const keys = row.querySelector('.keys');
    if (capturing === name) {
      keys.innerHTML = '<span class="hint">キーを押してください…（Esc でやめる）</span>';
    } else if (value) {
      keyLabels(value).forEach((k, i) => {
        if (i) keys.insertAdjacentHTML('beforeend', '<span class="plus">+</span>');
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keys.append(kbd);
      });
    } else {
      keys.innerHTML = '<span class="none">なし（使わない）</span>';
    }

    const actions = row.querySelector('.actions');
    const change = document.createElement('button');
    change.textContent = capturing === name ? 'やめる' : '変更';
    change.addEventListener('click', () => (capturing === name ? stopCapture() : startCapture(name)));
    const clear = document.createElement('button');
    clear.textContent = 'なしにする';
    clear.disabled = !value || !!capturing;
    clear.addEventListener('click', () => { draft[name] = ''; messageEl.textContent = ''; render(); });
    actions.append(change, clear);
    rowsEl.append(row);
  }
  saveBtn.disabled = !!capturing;
}

async function startCapture(name) {
  capturing = name;
  messageEl.textContent = '';
  await window.hotkeys.suspend(); // 今のホットキーが反応しないように外す
  render();
}

async function stopCapture() {
  capturing = null;
  await window.hotkeys.resume();
  render();
}

window.addEventListener('keydown', (e) => {
  if (!capturing) return;
  e.preventDefault();
  if (e.key === 'Escape') {
    stopCapture();
    return;
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // 修飾キーだけのときは続きを待つ
  const result = toAccelerator(e);
  if (!result) return;
  if (result.error) {
    messageEl.textContent = result.error;
    return;
  }
  const other = Object.entries(draft).find(([n, v]) => n !== capturing && v === result.accel);
  if (other) {
    messageEl.textContent = `そのキーは「${info.labels[other[0]]}」で使っています。`;
    return;
  }
  draft[capturing] = result.accel;
  stopCapture();
});

saveBtn.addEventListener('click', async () => {
  const res = await window.hotkeys.save(draft);
  if (res.ok) {
    messageEl.style.color = '';
    window.close();
  } else {
    const names = res.failed.map((n) => `「${info.labels[n]}」`).join('・');
    messageEl.textContent = `${names}のキーは、ほかのアプリが使っているため登録できませんでした。別のキーにしてください。`;
  }
});

document.getElementById('reset').addEventListener('click', () => {
  draft = { ...info.defaults };
  messageEl.textContent = '';
  render();
});

document.getElementById('cancel').addEventListener('click', () => window.close());

(async () => {
  info = await window.hotkeys.get();
  draft = { ...info.current };
  render();
})();
