// ツール呼び出しの動作確認。本体と同じ tools.js を使い、
// 「①判定役がツールを呼ぶ → ②キャラとして返事」の2段階で試す（アプリは実際には開かない）
// 使い方: node scripts/test-tools.mjs [発言 ...]
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ROUTER_PROMPT, buildTools, runTool, resultNote } = require('../tools.js');

const raw = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const config = { ...raw, ...raw.characters?.[raw.activeCharacter] };
const tools = buildTools(config);
const fakeShell = { openExternal: async () => {}, openPath: async () => '' };
const tags = Object.keys(config.expressions);
const persona = `${config.persona}\n\n返事の先頭には、そのときの気持ちに合うタグを必ず1つ付けてください。使えるタグ: ${tags.map((t) => `[${t}]`).join(' ')}\n例: [smile] おはよう、今日も早いですね。`;

const prompts = process.argv.length > 2 ? process.argv.slice(2) : [
  'YouTube開いて',
  'githubでelectronを検索して',
  'Claude開いて',
  '今日の天気は？',
  '明日千葉って雨降る？',
  '東京の明後日の気温教えて',
  '傘いるかな',
  '今日はつかれたなあ',
];

async function chat(messages, withTools) {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ollamaModel, messages, tools: withTools ? tools : undefined, stream: false, think: false }),
  });
  return (await res.json()).message;
}

for (const p of prompts) {
  const t = Date.now();
  const routed = await chat([{ role: 'system', content: ROUTER_PROMPT }, { role: 'user', content: p }], true);
  const calls = routed.tool_calls || [];
  const results = [];
  for (const c of calls) results.push(await runTool(c.function.name, c.function.arguments, { config, shell: fakeShell }));
  const user = results.length ? `${p}\n\n${resultNote(results)}` : p;
  const reply = await chat([{ role: 'system', content: persona }, { role: 'user', content: user }], false);
  const label = calls.map((c) => `${c.function.name}(${JSON.stringify(c.function.arguments)})`).join(', ') || '(ツールなし)';
  console.log(`「${p}」 -> ${label}`);
  if (results.length) console.log(`    結果: ${results.join(' ')}`);
  console.log(`    返事: ${reply.content.replace(/\n/g, ' ')} (${Date.now() - t}ms)`);
}
