// Ollama を、公式の GitHub のリリースからダウンロードして入れる（セットアップの「Ollama を入れる」ボタン）
// - Windows：OllamaSetup.exe を画面を出さずに実行する（このユーザーだけに入るので、管理者の許可は要らない）
// - Mac：Ollama-darwin.zip を展開して「アプリケーション」に置く
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { latestRelease, ensureFreeSpace, download, verifyDigest } = require('./download');

const REPO = 'ollama/ollama';
const ASSET = process.platform === 'win32' ? 'OllamaSetup.exe' : 'Ollama-darwin.zip';
// 入れたあとの大きさ（ダウンロードしたものとは別に要る空き）
const INSTALLED_SIZE = process.platform === 'win32' ? 3.5e9 : 0.6e9;

// 最新版の配布物 { version, url, size, digest }。届かなければ null
async function latestOllama() {
  const rel = await latestRelease(REPO);
  const asset = rel?.assets?.find((a) => a.name === ASSET);
  if (!asset) return null;
  return { version: rel.tag_name.replace(/^v/, ''), url: asset.browser_download_url, size: asset.size, digest: asset.digest };
}

function runInstaller(file, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(file, args, { windowsHide: true });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`installer exit ${code}`))));
  });
}

// Mac：書き込めるほうの「アプリケーション」フォルダ
function macAppsDir() {
  try {
    fs.accessSync('/Applications', fs.constants.W_OK);
    return '/Applications';
  } catch {
    const dir = path.join(os.homedir(), 'Applications');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

// downloadDir：ダウンロードしたものを一時的に置く場所。onProgress には { phase: 'prepare' | 'download' | 'install' | 'done', ... }
async function installOllama(downloadDir, onProgress = () => {}, { en = false } = {}) {
  onProgress({ phase: 'prepare' });
  const asset = await latestOllama();
  if (!asset) {
    throw new Error(en
      ? "Couldn't reach the Ollama download. Check your internet connection, or install it from the download page."
      : 'Ollama のダウンロード先につながりませんでした。インターネットの接続を確かめるか、ダウンロードページから入れてください。');
  }
  await ensureFreeSpace(downloadDir, asset.size + INSTALLED_SIZE, en);

  const file = path.join(downloadDir, `${ASSET}.part`);
  await download(asset.url, file, asset.size, onProgress);
  await verifyDigest(file, asset.digest, en);

  onProgress({ phase: 'install' });
  try {
    if (process.platform === 'win32') {
      // 名前が .exe でないと実行できないので付け替える
      const exe = path.join(downloadDir, ASSET);
      fs.rmSync(exe, { force: true });
      fs.renameSync(file, exe);
      await runInstaller(exe, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-']);
      fs.rmSync(exe, { force: true });
    } else {
      const dest = macAppsDir();
      await runInstaller('/usr/bin/ditto', ['-x', '-k', file, dest]);
      fs.rmSync(file, { force: true });
    }
  } catch (err) {
    throw new Error(en ? `Couldn't install Ollama (${err.message}).` : `Ollama を入れられませんでした（${err.message}）。`);
  }
  onProgress({ phase: 'done' });
}

module.exports = { installOllama, latestOllama };
