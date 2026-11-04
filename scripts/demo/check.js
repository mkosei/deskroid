// 動画のいくつかの時点の画面を 1 枚にまとめ、音が入っているかも調べる
// 使い方: electron scripts/demo/check.js <動画> <長さ(秒)>（動画と同じ場所に contact.png を作る）
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const file = process.argv[process.argv.length - 2];
const knownDur = Number(process.argv[process.argv.length - 1]);
const src = pathToFileURL(file).href;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { webSecurity: false, backgroundThrottling: false } });
  await w.loadURL('data:text/html,<body></body>');
  const res = await w.webContents.executeJavaScript(`(async () => {
    const v = document.createElement('video');
    v.src = ${JSON.stringify(src)};
    v.muted = true;
    await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('load error')); });
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : ${knownDur};
    const n = 16, cols = 4, tw = 320, th = 180;
    const c = document.createElement('canvas'); c.width = tw * cols; c.height = th * Math.ceil(n / cols);
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      const t = dur * (i + 0.5) / n;
      v.currentTime = t;
      await new Promise((r) => { v.onseeked = r; setTimeout(r, 4000); });
      g.drawImage(v, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
      g.fillStyle = '#ff0'; g.font = '14px sans-serif'; g.fillText(t.toFixed(1) + 's', (i % cols) * tw + 6, Math.floor(i / cols) * th + 18);
    }
    let audio;
    try {
      const buf = await (await fetch(v.src)).arrayBuffer();
      const ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf);
      const d = ab.getChannelData(0);
      // 1 秒ごとの音の大きさ（どこで声が出ているか）
      const perSec = [];
      for (let s = 0; s < Math.floor(ab.duration); s++) {
        let peak = 0;
        for (let k = s * ab.sampleRate; k < (s + 1) * ab.sampleRate; k += 20) peak = Math.max(peak, Math.abs(d[k] || 0));
        perSec.push(peak > 0.02 ? '#' : '.');
      }
      audio = { seconds: ab.duration.toFixed(1), loud: perSec.join('') };
    } catch (e) { audio = 'decode failed: ' + e.message; }
    return { dur, w: v.videoWidth, h: v.videoHeight, audio, png: c.toDataURL('image/png') };
  })()`);
  fs.writeFileSync(path.join(path.dirname(file), 'contact.png'), Buffer.from(res.png.split(',')[1], 'base64'));
  console.log(JSON.stringify({ dur: res.dur, w: res.w, h: res.h, audio: res.audio }));
  app.quit();
});
