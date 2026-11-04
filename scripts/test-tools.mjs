// ツール呼び出しの動作確認。本体と同じ tools.js / pc-apps.js を使い、
// 「①判定役がツールを呼ぶ → ②キャラとして返事」の2段階で試す（アプリやサイトは実際には開かない）
// 使い方: [OLLAMA_MODEL=qwen3:4b] node scripts/test-tools.mjs [--en] [--no-reply] [発言 ...]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildTools, runAgent, replyMessage, customApps } = require('../tools.js');
const { listApps } = require('../pc-apps.js');

const args = process.argv.slice(2);
const lang = args.includes('--en') ? 'en' : 'ja';
const withReply = !args.includes('--no-reply');
const raw = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const config = { ...raw, ...raw.characters?.[raw.activeCharacter] };
// 会話のモデルを変えて試すとき：OLLAMA_MODEL=qwen3:4b node scripts/test-tools.mjs
if (process.env.OLLAMA_MODEL) config.ollamaModel = process.env.OLLAMA_MODEL;
const persona = lang === 'en' ? config.persona_en || config.persona : config.persona;

// 実際には開かず、何を開こうとしたかだけ記録する
const opened = [];
const fakeShell = {
  openExternal: async (url) => { opened.push(`url ${url}`); },
  openPath: async (p) => { opened.push(`path ${p}`); return ''; },
};
const fakeLaunch = async (app) => { opened.push(`app ${app.name}`); };
const fakeMedia = async (action, steps) => { opened.push(`media ${action} x${steps}`); return true; };
// クリップボードの中身は環境変数 CLIP で渡せる（例: CLIP="英語の文章" node scripts/test-tools.mjs "これ訳して"）
let clip = process.env.CLIP || '';
const fakeClipboard = { readText: () => clip, writeText: (t) => { clip = t; opened.push(`clipboard <- ${t.slice(0, 80)}${t.length > 80 ? '…' : ''}`); } };
const fakeTimers = { add: (ms, message) => opened.push(`timer ${Math.round(ms / 1000)}s "${message}"`), cancelAll: () => 0 };
const home = os.homedir();
const folders = {
  downloads: path.join(home, 'Downloads'), documents: path.join(home, 'Documents'), desktop: path.join(home, 'Desktop'),
  pictures: path.join(home, 'Pictures'), music: path.join(home, 'Music'), videos: path.join(home, 'Videos'), home,
};
const apps = await listApps({ extra: customApps(config) });
const ctx = { config, shell: fakeShell, lang, apps, launchApp: fakeLaunch, folders, mediaControl: fakeMedia, timers: fakeTimers, clipboard: fakeClipboard };
const tools = buildTools(config, lang, apps);

const prompts = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : lang === 'en' ? [
  'Open YouTube',
  'Can you launch Discord?',
  'Open the calculator',
  'Search GitHub for electron',
  'Look up how to make carbonara',
  'Open my downloads folder',
  'Will it rain in Chiba tomorrow?',
  "I'm so tired today.",
] : [
  'YouTube開いて',
  'ディスコード起動して',
  '電卓出して',
  'メモ帳開いてくれる？',
  'エクセル使いたい',
  'githubでelectronを検索して',
  'アマゾンでワイヤレスイヤホン探して',
  'カルボナーラの作り方調べて',
  'ダウンロードフォルダ開いて',
  '設定開いて',
  'Chrome開いて',
  '明日千葉って雨降る？',
  '今日はつかれたなあ',
  'おすすめの映画ある？',
];

async function chat(messages, withTools) {
  const body = { model: config.ollamaModel, messages, tools: withTools || undefined, stream: false, think: false };
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()).message;
}

console.log(`apps: ${apps.length}, lang: ${lang}`);
for (const p of prompts) {
  const t = Date.now();
  opened.length = 0;
  const steps = [];
  const { results, show } = await runAgent({
    chat: async (msgs, t) => ({ toolCalls: (await chat(msgs, t)).tool_calls || [] }),
    history: [{ role: 'user', content: p }],
    tools,
    ctx,
    log: (step, name, args) => steps.push(`${step + 1}:${name}(${JSON.stringify(args)})`),
  });
  const label = steps.join(', ') || '(no tool)';
  console.log(`「${p}」 -> ${label}  [${Date.now() - t}ms]`);
  if (opened.length) console.log(`    opened: ${opened.join(' / ')}`);
  if (results.length) console.log(`    result: ${results.join(' ')}`);
  if (withReply) {
    const user = replyMessage(p, results, show, lang);
    const reply = await chat([{ role: 'system', content: persona }, { role: 'user', content: user }], false);
    console.log(`    reply: ${reply.content.replace(/\n/g, ' ')}`);
    for (const text of show) console.log(`    + bubble: ${text.replace(/\n/g, ' ')}`);
  }
}
