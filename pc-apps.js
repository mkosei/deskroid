// パソコンに入っているアプリを集めて、名前で探して開く（Electron に依存しないので、テストからも使える）
// - Windows: スタートメニューのアプリ一覧（Get-StartApps）。Microsoft Store のアプリも含み、名前は OS の言語のまま
// - Mac: /Applications などの .app。Finder に出る名前（日本語の Mac なら「計算機」など）も読む
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// アプリではない項目（説明書へのリンク、アンインストーラーなど）
const NOISE = /uninstall|アンインストール|readme|release notes|documentation|\bfaq\b|website|ヘルプ|\bhelp\b|manual|マニュアル|license|ライセンス/i;

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', ...opts }, (err, stdout) => {
    if (err) reject(err);
    else resolve(stdout);
  });
});

async function listWindowsApps() {
  const out = await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress',
  ]);
  const parsed = JSON.parse(out.trim() || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed])
    .filter((a) => a?.Name && a?.AppID && !/^https?:/i.test(a.AppID))
    .map((a) => ({ name: a.Name, id: a.AppID }));
}

async function listMacApps() {
  const dirs = [
    '/Applications', '/Applications/Utilities',
    '/System/Applications', '/System/Applications/Utilities',
    path.join(os.homedir(), 'Applications'),
  ];
  const paths = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (n.endsWith('.app')) paths.push(path.join(dir, n));
  }
  // Finder に出る名前（言語に合わせた名前）。取れなければファイル名を使う
  let display = [];
  try {
    const out = await run('mdls', ['-name', 'kMDItemDisplayName', '-raw', ...paths]);
    display = out.split('\0');
  } catch {}
  return paths.map((p, i) => {
    const base = path.basename(p, '.app');
    const shown = (display[i] || '').replace(/\.app$/, '').trim();
    const name = shown && shown !== '(null)' ? shown : base;
    return { name, id: p, alt: name !== base ? [base] : [] };
  });
}

let cache = null;
let cacheAt = 0;

// 入っているアプリの一覧。数秒かかることがあるので 10 分ためておく
async function listApps({ extra = [] } = {}) {
  if (!cache || Date.now() - cacheAt > 10 * 60 * 1000) {
    let apps = [];
    try {
      apps = IS_WIN ? await listWindowsApps() : IS_MAC ? await listMacApps() : [];
    } catch (err) {
      console.warn('[apps] アプリの一覧を取れませんでした', err.message);
    }
    const seen = new Set();
    cache = apps.filter((a) => {
      const key = a.name.toLowerCase();
      if (NOISE.test(a.name) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    cacheAt = Date.now();
  }
  return [...extra, ...cache];
}

// 話し言葉の呼び名 → アプリ名に含まれる言葉（声で話すとカタカナになりやすいので）
const ALIASES = {
  電卓: ['calculator', '電卓'], 計算機: ['calculator', '計算機', '電卓'],
  メモ帳: ['notepad', 'メモ帳'], ノートパッド: ['notepad', 'メモ帳'],
  ペイント: ['paint', 'ペイント'], エクスプローラー: ['file explorer', 'エクスプローラー', 'finder'],
  ファインダー: ['finder'], 設定: ['settings', '設定', 'system settings', 'システム設定'],
  ターミナル: ['terminal', 'ターミナル'], 写真: ['photos', 'フォト', '写真'], フォト: ['photos', 'フォト', '写真'],
  カメラ: ['camera', 'カメラ'], カレンダー: ['calendar', 'カレンダー'], 時計: ['clock', '時計'],
  クローム: ['google chrome', 'chrome'], グーグルクローム: ['google chrome', 'chrome'],
  エッジ: ['microsoft edge', 'edge'], サファリ: ['safari'], ファイアフォックス: ['firefox'],
  ワード: ['word'], エクセル: ['excel'], パワポ: ['powerpoint'], パワーポイント: ['powerpoint'],
  アウトルック: ['outlook'], チームズ: ['teams'], ワンノート: ['onenote'],
  スポティファイ: ['spotify'], ディスコード: ['discord'], スチーム: ['steam'], スラック: ['slack'],
  ライン: ['line'], ズーム: ['zoom'], ノーション: ['notion'], オブシディアン: ['obsidian'],
  ブイエスコード: ['visual studio code', 'vs code'], vscode: ['visual studio code', 'vs code'],
  クロード: ['claude'], チャットgpt: ['chatgpt'], オラマ: ['ollama'], ストア: ['microsoft store', 'app store'],
};

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\-_.・()（）]+/g, '');

// 名前のゆれを吸収して一番近いアプリを探す。見つからなければ null と、近い候補
function findApp(apps, query) {
  const q = norm(query).replace(/(アプリ|app)$/, '');
  if (!q) return { app: null, candidates: [] };
  const words = [q, ...(ALIASES[q] || []).map(norm)];
  const scored = [];
  for (const app of apps) {
    const names = [app.name, ...(app.alt || [])].map(norm);
    let score = 0;
    for (const w of words) {
      for (const n of names) {
        if (n === w) score = Math.max(score, 100);
        else if (n.startsWith(w) || w.startsWith(n)) score = Math.max(score, 80 - Math.abs(n.length - w.length));
        else if (n.includes(w) && w.length >= 2) score = Math.max(score, 60 - (n.length - w.length));
        else if (w.includes(n) && n.length >= 3) score = Math.max(score, 50);
      }
    }
    if (score > 0) scored.push({ app, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return {
    app: best && best.score >= 40 ? best.app : null,
    candidates: scored.slice(0, 3).map((s) => s.app.name),
  };
}

// アプリを起動する。config.apps に書いたローカルのパスは openPath で開く
async function launchApp(app, shell) {
  if (app.path) {
    const err = await shell.openPath(app.path);
    if (err) throw new Error(err);
    return;
  }
  if (IS_WIN) {
    spawn('explorer.exe', [`shell:AppsFolder\\${app.id}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (IS_MAC) {
    spawn('open', ['-a', app.id], { detached: true, stdio: 'ignore' }).unref();
  } else {
    throw new Error('unsupported platform');
  }
}

module.exports = { listApps, findApp, launchApp };
