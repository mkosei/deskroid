// 大きなファイルのダウンロードまわり（VOICEVOX エンジンと Ollama のインストールで使う）
const fs = require('fs');
const crypto = require('crypto');

// GitHub の最新のリリース。届かなければ null
async function latestRelease(repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Deskroid' },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
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

// 空きが足りなければ止める（need・free はバイト）
async function ensureFreeSpace(dir, need, en) {
  const free = await freeSpace(dir);
  if (free === null || free >= need) return;
  const gb = (n) => (n / 1e9).toFixed(1);
  throw new Error(en
    ? `Not enough free disk space (needs about ${gb(need)} GB, ${gb(free)} GB free).`
    : `ディスクの空きが足りません（約 ${gb(need)}GB 必要で、空きは ${gb(free)}GB です）。`);
}

// 途中まで落としたファイルがあれば、続きから落とす（何 GB もあるので、失敗のたびに最初からにしない）
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

// ファイルの SHA-256（16 進）
function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// GitHub のリリースに書いてある digest（"sha256:..."）と合っているか。digest が無ければ確かめない
async function verifyDigest(file, digest, en) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest || '');
  if (!m) return;
  if ((await sha256(file)) === m[1].toLowerCase()) return;
  fs.rmSync(file, { force: true });
  throw new Error(en
    ? 'The downloaded file was damaged. Please try again.'
    : 'ダウンロードしたファイルが壊れていました。もう一度試してください。');
}

module.exports = { latestRelease, freeSpace, ensureFreeSpace, download, sha256, verifyDigest };
