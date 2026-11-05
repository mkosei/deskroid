// アプリ自身と、自分で入れた VOICEVOX エンジンの新しい版を調べる（起動の少しあとと、その後 1 日ごと）
// - Windows（インストール版）：electron-updater で裏でダウンロードしておき、終了するときに入れ替える。
//   すぐ入れ替えたいときは、右クリックメニューの「再起動して更新する」
// - Mac（インストール版）：署名していないので自動では入れ替えられない。新しい版を知らせて、ダウンロードページを開く
// - ソースから動かしているとき（npm start / start.bat）：アプリの更新は調べない（git で更新する）
const { app, shell } = require('electron');
const { compareVersions } = require('./voicevox-install');

const REPO = 'mkosei/deskroid';
const FIRST_CHECK_MS = 20 * 1000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

let appUpdate = null; // { state: 'ready' | 'available', version, url? }
let autoUpdater = null;
let announced = new Set();
let deps = null;

// GitHub の最新のリリース（Mac 用）
async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Deskroid' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

// 新しい版のことを、キャラに一度だけ言ってもらう
function tell(kind, version) {
  const key = `${kind}:${version}`;
  if (announced.has(key)) return;
  announced.add(key);
  const T = deps.strings().update;
  deps.announce(kind === 'ready' ? T.announceReady(version) : T.announceAvailable(version));
}

function setupAutoUpdater() {
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('update-downloaded', (info) => {
    appUpdate = { state: 'ready', version: info.version };
    deps.log(`アプリの新しい版をダウンロードしました: ${info.version}`);
    tell('ready', info.version);
  });
  autoUpdater.on('error', (err) => deps.log(`アプリの更新の確認に失敗: ${err.message}`));
}

async function checkApp() {
  if (!app.isPackaged) return;
  if (process.platform === 'win32') {
    if (!autoUpdater) setupAutoUpdater();
    // 失敗したときは autoUpdater の 'error' がログに書くので、ここでは何もしない（同じ失敗を 2 回書かない）
    await autoUpdater.checkForUpdates().catch(() => {});
    return;
  }
  const rel = await latestRelease();
  if (compareVersions(rel.tag_name, app.getVersion()) > 0) {
    const version = rel.tag_name.replace(/^v/, '');
    appUpdate = { state: 'available', version, url: rel.html_url };
    tell('available', version);
  }
}

async function checkAll() {
  for (const check of [checkApp, ...deps.extraChecks]) {
    try { await check(); } catch (err) { deps.log(`更新の確認に失敗: ${err.message}`); }
  }
}

// announce(text)：キャラに言ってもらう、strings()：今の言語の文言、log(text)：ログ、extraChecks：ほかに調べるもの
function startUpdateChecks(options) {
  deps = { extraChecks: [], log: () => {}, ...options };
  setTimeout(checkAll, FIRST_CHECK_MS);
  setInterval(checkAll, INTERVAL_MS);
}

// 右クリックメニューに出す項目（新しい版が無ければ空）
function appUpdateMenu(T) {
  if (!appUpdate) return [];
  if (appUpdate.state === 'ready') {
    return [{ label: T.update.restart(appUpdate.version), click: () => autoUpdater.quitAndInstall(true, true) }];
  }
  return [{ label: T.update.download(appUpdate.version), click: () => shell.openExternal(appUpdate.url) }];
}

module.exports = { startUpdateChecks, appUpdateMenu };
