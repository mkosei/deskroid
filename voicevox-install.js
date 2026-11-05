// VOICEVOX エンジンを、公式の GitHub のリリースからダウンロードして、アプリのデータの場所に展開する。
// VOICEVOX 本体（エディタ）を入れなくても、セットアップのボタン 1 つで声が使えるようにするため。
// エンジンはアプリに同梱せず、ユーザーがボタンを押したときに公式の配布物をそのまま取ってくる（再配布はしない）
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { latestRelease, ensureFreeSpace, download, verifyDigest } = require('./download');

const RELEASES_REPO = 'VOICEVOX/voicevox_engine';
// GitHub の API に届かなかったときに使う版
const FALLBACK_VERSION = '0.26.0';

// この PC 用の配布物の名前。Windows は GPU（DirectML）でも CPU でも動く版、Mac は CPU の種類で選ぶ
function assetName(version, platform = process.platform, arch = process.arch) {
  const kind = platform === 'win32' ? 'windows-directml'
    : platform === 'darwin' ? `macos-${arch === 'arm64' ? 'arm64' : 'x64'}`
      : `linux-cpu-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  // .vvpp は中身が zip（VOICEVOX 本体がエンジンを入れるときに使う形式）。7z より展開しやすい
  return `voicevox_engine-${kind}-${version}.vvpp`;
}

const exeName = () => (process.platform === 'win32' ? 'run.exe' : 'run');

// 版の番号を比べる（"0.27.0" > "0.26.0" なら正）
const compareVersions = (a, b) => String(a).replace(/^v/, '').localeCompare(String(b).replace(/^v/, ''), undefined, { numeric: true });

// 入っている版（新しい順）。run(.exe) があるものだけ
function installedVersions(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+$/.test(d.name) && fs.existsSync(path.join(root, d.name, exeName())))
    .map((d) => d.name)
    .sort((a, b) => compareVersions(b, a));
}

// 入れたエンジンの run(.exe)。一番新しい版
function findInstalledEngine(root) {
  const [v] = installedVersions(root);
  return v ? path.join(root, v, exeName()) : null;
}

// 新しい版があるか。{ version, size } か null（入れていない・調べられないときも null）
async function checkEngineUpdate(root) {
  const [current] = installedVersions(root);
  if (!current) return null;
  const latest = await latestAsset();
  // API に届かなかった（大きさがわからない）ときは、あると言わない
  if (!latest.size || compareVersions(latest.version, current) <= 0) return null;
  return { current, version: latest.version, size: latest.size };
}

// 一番新しい版以外と、展開の途中で残ったものを消す（アプリの起動時と、更新のあとに呼ぶ）。
// 消す前にフォルダの名前を変える：Windows では動いているエンジンのフォルダは名前を変えられないので、
// 動いている版を途中まで消してしまうことがない（そのときは何もせず、次の起動時にまた試す）
function removeOldVersions(root) {
  if (!fs.existsSync(root)) return;
  const [keep] = installedVersions(root);
  for (const d of fs.readdirSync(root)) {
    const old = /^\d+\.\d+\.\d+$/.test(d) && d !== keep;
    const leftover = /\.(removing|extracting)$/.test(d);
    if (!old && !leftover) continue;
    let target = path.join(root, d);
    try {
      if (old) {
        const renamed = `${target}.removing`;
        fs.renameSync(target, renamed);
        target = renamed;
      }
      fs.rmSync(target, { recursive: true, force: true });
    } catch {}
  }
}

// root の下で動いているエンジンのうち、keepExe 以外を止める（更新のとき、古い版を止めるため）。
// このアプリが起動したものでなくても（前に落ちたときの残りなど）止める
function stopOtherEngines(root, keepExe) {
  const under = (p) => p && path.resolve(p).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep)
    && path.resolve(p).toLowerCase() !== path.resolve(keepExe || '').toLowerCase();
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const p = isWin
      ? spawn('powershell.exe', ['-NoProfile', '-Command', 'Get-Process run -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)`t$($_.Path)" }'], { windowsHide: true })
      : spawn('ps', ['-axo', 'pid=,comm=']);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(0));
    p.on('close', () => {
      let n = 0;
      for (const line of out.split(/\r?\n/)) {
        const m = isWin ? line.match(/^(\d+)\t(.+)$/) : line.trim().match(/^(\d+)\s+(.+)$/);
        if (!m || !under(m[2].trim())) continue;
        try { process.kill(Number(m[1])); n++; } catch {}
      }
      resolve(n);
    });
  });
}

// リリースの中から、この PC 用の配布物を探す。
// GitHub に置ける 1 ファイルの大きさに上限があるので、大きいものは
// "〜.001.vvppp"・"〜.002.vvppp" のように分けて置かれる（つなげると .vvpp になる）
function findParts(assets, name) {
  const pick = (a) => ({ name: a.name, url: a.browser_download_url, size: a.size, digest: a.digest });
  const whole = assets.find((a) => a.name === name);
  if (whole) return [pick(whole)];
  const base = name.replace(/\.vvpp$/, '');
  return assets
    .filter((a) => a.name.startsWith(`${base}.`) && /^\.\d{3}\.vvppp$/.test(a.name.slice(base.length)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(pick);
}

// 最新版の配布物（名前・分かれたファイルの URL と大きさ・全体の大きさ）。API に届かなければ決めておいた版にする
async function latestAsset() {
  const rel = await latestRelease(RELEASES_REPO);
  if (rel) {
    const name = assetName(rel.tag_name);
    const parts = findParts(rel.assets || [], name);
    if (parts.length) return { version: rel.tag_name, name, parts, size: parts.reduce((n, p) => n + p.size, 0) };
  }
  const name = assetName(FALLBACK_VERSION);
  const url = `https://github.com/VOICEVOX/voicevox_engine/releases/download/${FALLBACK_VERSION}/${name}`;
  return { version: FALLBACK_VERSION, name, parts: [{ name, url, size: 0 }], size: 0 };
}

// 分かれたファイルを順に落として、1 つの .vvpp につなげる。全体で何バイト進んだかを知らせる
async function downloadParts(root, asset, onProgress, en) {
  const files = [];
  let done = 0;
  for (const part of asset.parts) {
    const file = path.join(root, `${part.name}.part`);
    await download(part.url, file, part.size, (p) => onProgress({ ...p, received: done + p.received, total: asset.size || p.total }));
    await verifyDigest(file, part.digest, en);
    done += part.size || fs.statSync(file).size;
    files.push(file);
  }
  if (files.length === 1) return files[0];
  // 1 つ目に残りを足していく（足し終えたものから消すので、余分な空きは要らない）
  const joined = path.join(root, `${asset.name}.part`);
  fs.renameSync(files[0], joined);
  for (const file of files.slice(1)) {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(joined, { flags: 'a' });
      fs.createReadStream(file).on('error', reject).pipe(out).on('error', reject).on('finish', resolve);
    });
    fs.rmSync(file, { force: true });
  }
  return joined;
}

// zip（.vvpp）を展開する。Windows 10 以降・Mac に最初から入っている bsdtar を使う
function extract(file, dest) {
  const tar = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : '/usr/bin/tar';
  return new Promise((resolve, reject) => {
    const p = spawn(tar, ['-xf', file, '-C', dest], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar ${code}: ${err.slice(-300)}`))));
  });
}

// 展開した中から run(.exe) のあるフォルダを探す（zip の一番上に入っていても、1 段下にあっても動くように）
function engineDirIn(dir) {
  if (fs.existsSync(path.join(dir, exeName()))) return dir;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory() && fs.existsSync(path.join(dir, d.name, exeName()))) return path.join(dir, d.name);
  }
  return null;
}

// root（例: %LOCALAPPDATA%\Deskroid\voicevox-engine）の下に <版>/ として入れる。終わったら run(.exe) の場所を返す
async function installEngine(root, onProgress = () => {}, { en = false } = {}) {
  onProgress({ phase: 'prepare' });
  const asset = await latestAsset();
  const target = path.join(root, asset.version);
  const already = path.join(target, exeName());
  if (fs.existsSync(already)) return already;

  // 落としたファイル（約 1.9GB）と展開したもの（約 2.2GB）が同時に置かれる
  await ensureFreeSpace(root, (asset.size || 1.95e9) * 2.3, en);

  const file = await downloadParts(root, asset, onProgress, en);

  onProgress({ phase: 'extract' });
  const tmp = path.join(root, `${asset.version}.extracting`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    await extract(file, tmp);
    const dir = engineDirIn(tmp);
    if (!dir) throw new Error(en ? 'The downloaded file did not contain the engine.' : 'ダウンロードしたファイルにエンジンが入っていませんでした。');
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(dir, target);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (process.platform !== 'win32') fs.chmodSync(path.join(target, exeName()), 0o755);
  // 展開できたら、落としたファイルは消す（容量を空ける）
  fs.rmSync(file, { force: true });
  // 古い版は、呼び出し側が新しい版に切り替えてから removeOldVersions で消す（動いている間は消せないため）
  onProgress({ phase: 'done' });
  return path.join(target, exeName());
}

module.exports = { installEngine, findInstalledEngine, installedVersions, checkEngineUpdate, removeOldVersions, stopOtherEngines, compareVersions, assetName, latestAsset, findParts };
