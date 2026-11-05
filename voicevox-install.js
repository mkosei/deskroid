// VOICEVOX エンジンを、公式の GitHub のリリースからダウンロードして、アプリのデータの場所に展開する。
// VOICEVOX 本体（エディタ）を入れなくても、セットアップのボタン 1 つで声が使えるようにするため。
// エンジンはアプリに同梱せず、ユーザーがボタンを押したときに公式の配布物をそのまま取ってくる（再配布はしない）
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RELEASES_API = 'https://api.github.com/repos/VOICEVOX/voicevox_engine/releases/latest';
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

// 入れたエンジンの run(.exe)。新しい版から探す
function findInstalledEngine(root) {
  if (!fs.existsSync(root)) return null;
  const versions = fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+\.\d+/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const exe = path.join(root, v, exeName());
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

// 最新版の配布物（名前・URL・大きさ）。API に届かなければ決めておいた版にする
async function latestAsset() {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Deskroid' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const rel = await res.json();
      const name = assetName(rel.tag_name);
      const asset = rel.assets?.find((a) => a.name === name);
      if (asset) return { version: rel.tag_name, name, url: asset.browser_download_url, size: asset.size };
    }
  } catch {}
  const name = assetName(FALLBACK_VERSION);
  return { version: FALLBACK_VERSION, name, url: `https://github.com/VOICEVOX/voicevox_engine/releases/download/${FALLBACK_VERSION}/${name}`, size: 0 };
}

// 空き容量（バイト）。調べられなければ null
async function freeSpace(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const s = await fs.promises.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

// 途中まで落としたファイルがあれば、続きから落とす（1.9GB あるので、失敗のたびに最初からにしない）
async function download(url, file, size, onProgress) {
  let have = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (size && have === size) return;
  if (size && have > size) { fs.rmSync(file); have = 0; }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Deskroid', ...(have ? { Range: `bytes=${have}-` } : {}) },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  // 続きからを受け付けなかった（200 で全部返ってきた）ときは最初から書き直す
  if (have && res.status !== 206) have = 0;
  const total = size || (Number(res.headers.get('content-length')) || 0) + have;
  const out = fs.createWriteStream(file, { flags: have ? 'a' : 'w' });
  let received = have;
  let last = 0;
  try {
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      received += chunk.length;
      const now = Date.now();
      if (now - last > 250) {
        last = now;
        onProgress({ phase: 'download', received, total });
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total && received !== total) throw new Error(`download incomplete (${received} / ${total})`);
  onProgress({ phase: 'download', received, total });
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
  const need = (asset.size || 1.95e9) * 2.3;
  const free = await freeSpace(root);
  if (free !== null && free < need) {
    const gb = (n) => (n / 1e9).toFixed(1);
    throw new Error(en
      ? `Not enough free disk space (needs about ${gb(need)} GB, ${gb(free)} GB free).`
      : `ディスクの空きが足りません（約 ${gb(need)}GB 必要で、空きは ${gb(free)}GB です）。`);
  }

  const file = path.join(root, `${asset.name}.part`);
  await download(asset.url, file, asset.size, onProgress);

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
  // 古い版が残っていれば消す
  for (const d of fs.readdirSync(root)) {
    if (d === asset.version || !/^\d+\.\d+\.\d+$/.test(d)) continue;
    try { fs.rmSync(path.join(root, d), { recursive: true, force: true }); } catch {} // 動いている古い版は消せないので、次の機会に
  }
  onProgress({ phase: 'done' });
  return path.join(target, exeName());
}

module.exports = { installEngine, findInstalledEngine, assetName, latestAsset };
