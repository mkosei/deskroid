// この PC の性能（メモリ・GPU）を調べて、会話モデルのおすすめを決める（セットアップ画面で使う）
const os = require('os');
const { execFile } = require('child_process');

// 選べる会話モデル（大きい順）。size はダウンロードの大きさ（GB）。
// vram：GPU に全部載せるのに要る VRAM（GB）、ram：GPU なしで動かすのに要るメモリ（GB）。
// 音声認識（約 1GB）や VOICEVOX（約 0.6GB）も同時に動くので、少し余裕を見ている
const CHAT_MODELS = [
  { name: 'qwen3:8b', size: 5.2, vram: 7, ram: 16 },
  { name: 'qwen3:4b', size: 2.5, vram: 4, ram: 8 },
  { name: 'qwen3:1.7b', size: 1.4, vram: 2, ram: 6 },
  { name: 'qwen3:0.6b', size: 0.5, vram: 1, ram: 0 },
];

const GB = 1024 ** 3;

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// Windows：ディスプレイアダプターのレジストリにある 64 ビットの VRAM の大きさを読む
// （Win32_VideoController の AdapterRAM は 4GB までしか表せないので使わない）
async function windowsGpus() {
  const script = "Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue"
    + " | Where-Object { $_.DriverDesc } | ForEach-Object { \"$($_.DriverDesc)`t$($_.'HardwareInformation.qwMemorySize')`t$($_.'HardwareInformation.MemorySize')\" }";
  const out = await run('powershell.exe', ['-NoProfile', '-Command', script]);
  const gpus = [];
  for (const line of out.split(/\r?\n/)) {
    const [name, qw, dw] = line.split('\t');
    if (!name?.trim()) continue;
    const bytes = Number(qw) || Number(dw) || 0;
    gpus.push({ name: name.trim(), vram: bytes / GB });
  }
  return gpus;
}

// NVIDIA のドライバーが入っていれば nvidia-smi でも読める（Linux や、レジストリで読めなかったとき）
async function nvidiaGpus() {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, mib] = line.split(',');
    return { name: name.trim(), vram: Number(mib) / 1024 };
  });
}

// 会話に使える GPU か（Ollama が速く動かせるのは NVIDIA と AMD の GPU。Intel の内蔵 GPU などは数えない）
const usableGpu = (g) => /nvidia|geforce|rtx|quadro|radeon|amd/i.test(g.name) && g.vram >= 2;

let cached = null;

// { ram, cpu, gpu: { name, vram } | null, unified }（ram・vram は GB）
async function systemInfo() {
  if (cached) return cached;
  const ram = os.totalmem() / GB;
  const cpu = os.cpus()[0]?.model?.trim() || '';
  let gpu = null;
  let unified = false;
  if (process.platform === 'darwin') {
    // Apple シリコンは GPU がメモリを共有する（全体の 2/3 くらいまで GPU に使える）
    unified = process.arch === 'arm64';
    if (unified) gpu = { name: 'Apple Silicon', vram: ram * 0.66 };
  } else {
    let gpus = process.platform === 'win32' ? await windowsGpus() : [];
    if (!gpus.some(usableGpu)) gpus = gpus.concat(await nvidiaGpus());
    gpu = gpus.filter(usableGpu).sort((a, b) => b.vram - a.vram)[0] || null;
  }
  cached = { ram, cpu, gpu, unified };
  return cached;
}

// おすすめのモデルと、それぞれのモデルがこの PC でどう動きそうか。
// fit: 'gpu'（GPU に載るので速い）・'cpu'（GPU なし。動くが返事は遅め）・'heavy'（この PC には重い）
function recommend(info) {
  const vram = info.gpu?.vram || 0;
  const models = CHAT_MODELS.map((m) => {
    // 「16GB」の PC でも OS からは 15GB 少しに見えるので、1 割ほど甘く見る
    const fit = vram >= m.vram * 0.9 ? 'gpu' : info.ram >= m.ram * 0.9 ? 'cpu' : 'heavy';
    return { ...m, fit };
  });
  // GPU に載る一番大きいもの。無ければ、メモリで動く一番大きいもの（ただし GPU なしで 8b は遅すぎるので 4b まで）
  const best = models.find((m) => m.fit === 'gpu')
    || models.find((m) => m.fit === 'cpu' && m.name !== 'qwen3:8b')
    || models[models.length - 1];
  // PC 全体の見立て。good：快適、ok：動くが軽いモデル・遅め、low：かなり厳しい
  const level = info.ram < 4 ? 'low'
    : best.fit === 'gpu' && best.name !== 'qwen3:1.7b' && best.name !== 'qwen3:0.6b' ? 'good'
      : 'ok';
  return { recommended: best.name, level, models };
}

module.exports = { systemInfo, recommend, CHAT_MODELS };
