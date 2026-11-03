// 音声まわりの動作確認: VOICEVOX で喋らせた音声を Whisper で文字起こしする
// 使い方: node scripts/test-voice.mjs [device] [model]
import { pipeline, env } from '@huggingface/transformers';
import path from 'path';

// node_modules 配下だと Windows のパス長制限(260文字)を超えるので短い場所に置く
env.cacheDir = path.join(process.env.LOCALAPPDATA, 'desktop-mate', 'hf-cache');

const device = process.argv[2] || 'dml';
const model = process.argv[3] || 'onnx-community/whisper-large-v3-turbo';
const VV = 'http://127.0.0.1:50021';
const text = 'こんにちは、今日はいい天気ですね。散歩にでも行きませんか。';

let t = Date.now();
const q = await (await fetch(`${VV}/audio_query?speaker=100&text=${encodeURIComponent(text)}`, { method: 'POST' })).json();
const wav = Buffer.from(await (await fetch(`${VV}/synthesis?speaker=100`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q),
})).arrayBuffer());
console.log(`TTS: ${Date.now() - t}ms, ${wav.length} bytes`);

// WAV(PCM16 mono) -> Float32 16kHz
const rate = wav.readUInt32LE(24);
const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
const outLen = Math.floor(pcm.length * 16000 / rate);
const audio = new Float32Array(outLen);
for (let i = 0; i < outLen; i++) audio[i] = pcm[Math.floor(i * rate / 16000)] / 32768;

t = Date.now();
const asr = await pipeline('automatic-speech-recognition', model, {
  device,
  dtype: { encoder_model: process.argv[5] || 'fp16', decoder_model_merged: process.argv[4] || 'q4' },
});
console.log(`STT load (${device}): ${Date.now() - t}ms`);
for (let i = 0; i < 2; i++) {
  t = Date.now();
  const r = await asr(audio, { language: 'japanese', task: 'transcribe' });
  console.log(`STT run ${i + 1}: ${Date.now() - t}ms -> ${r.text}`);
}
