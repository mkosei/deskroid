// 英語の読み上げ（Kokoro）の動作確認：声ごとに WAV を作って、かかった時間を表示する
// 使い方: node scripts/test-kokoro.mjs [声の名前 ...]
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import path from 'path';
import fs from 'fs';

// node_modules 配下だと Windows のパス長制限(260文字)を超えるので短い場所に置く（アプリ本体と同じ場所）
env.cacheDir = path.join(process.env.LOCALAPPDATA || '.', 'desktop-mate', 'hf-cache');
const outDir = path.join(process.env.LOCALAPPDATA || '.', 'desktop-mate');
const voices = process.argv.length > 2 ? process.argv.slice(2) : ['af_heart', 'bf_emma'];

let t = Date.now();
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
console.log(`load ${Date.now() - t}ms; female voices: ${Object.keys(tts.voices).filter((v) => /^[ab]f_/.test(v)).join(', ')}`);
for (const voice of voices) {
  t = Date.now();
  const audio = await tts.generate("Good morning! Let's do our best today. Call me anytime you need help.", { voice });
  fs.writeFileSync(path.join(outDir, `kokoro-${voice}.wav`), Buffer.from(audio.toWav()));
  console.log(`${voice}: ${Date.now() - t}ms, ${(audio.audio.length / audio.sampling_rate).toFixed(1)}s of audio`);
}
