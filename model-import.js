// モデルの読み込み：選ばれたファイルを models/<id>/ にコピーし、キャラ設定の雛形を作る
// - Live2D: *.model3.json（同じフォルダの中身をまるごとコピー）
// - 3D: *.glb / *.vrm（ファイルだけ）、*.gltf（参照するファイルがあるのでフォルダごと）
const path = require('path');
const fs = require('fs');

const MODEL_FILTERS = [
  { name: 'キャラクターモデル', extensions: ['json', 'glb', 'gltf', 'vrm'] },
  { name: 'Live2D (*.model3.json)', extensions: ['json'] },
  { name: '3D (*.glb, *.gltf, *.vrm)', extensions: ['glb', 'gltf', 'vrm'] },
];

// 感情タグ → Live2D の表情名を探すときの手がかり
const EXPRESSION_HINTS = {
  normal: /normal|default|neutral|idle/i,
  smile: /smile|happy|joy|laugh|fun/i,
  angry: /angry|anger|mad|annoy/i,
  sad: /sad|cry|sorrow|tear/i,
  surprised: /surpris|shock|amaze/i,
  shy: /blush|shy|embarrass|tere/i,
};

// ボーンで動く 3D キャラの感情タグ → 動き（three-character.js の ONE_SHOT / POSES）
const GLTF_EXPRESSIONS = {
  normal: 'idle',
  smile: 'nod',
  angry: 'shake',
  sad: 'droop',
  surprised: 'startle',
  shy: 'tilt',
};

function defaultPersona(name, withVoice, lang = 'ja') {
  if (lang === 'en') {
    return `You are "${name}", who lives on the user's desktop. You are cheerful and friendly, and talk with the user like a friend. `
      + `Your replies are shown in a speech bubble${withVoice ? ' and also read aloud' : ''}, so `
      + 'answer in English with short, conversational replies of one to three sentences. Do not use emoji, emoticons, symbols or Markdown.';
  }
  return `あなたはユーザーのデスクトップに住んでいる「${name}」です。明るく親しみやすい性格で、ユーザーとは友達のように話します。`
    + `返事は吹き出しに表示${withVoice ? 'され、声でも読み上げられる' : 'される'}ので、`
    + '1〜3文程度の短い話し言葉の日本語で答えてください。絵文字・顔文字・記号・マークダウンは使わないでください。';
}

// ファイル名から、設定のキーに使える ID を作る（既にあれば番号を付ける）
function makeId(base, taken) {
  const slug = base.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'model';
  let id = slug;
  for (let i = 2; taken.has(id); i++) id = `${slug}_${i}`;
  return id;
}

function detectLive2D(model3Path) {
  const json = JSON.parse(fs.readFileSync(model3Path, 'utf8'));
  const names = (json.FileReferences?.Expressions || []).map((e) => e.Name).filter(Boolean);
  const expressions = {};
  for (const [tag, re] of Object.entries(EXPRESSION_HINTS)) {
    const hit = names.find((n) => re.test(n));
    if (hit) expressions[tag] = hit;
  }
  const groups = Object.keys(json.FileReferences?.Motions || {});
  const head = groups.find((g) => /head/i.test(g) && /tap/i.test(g)) || groups.find((g) => /head/i.test(g));
  const body = groups.find((g) => /tap/i.test(g) && !/head/i.test(g)) || groups.find((g) => /tap/i.test(g));
  const tapMotions = {};
  if (head) tapMotions.head = head;
  if (body) tapMotions.body = body;
  return { expressions, tapMotions };
}

/**
 * @param {string} src 選ばれたファイル
 * @param {string} appDir アプリのフォルダ（models/ を置く場所）
 * @param {Set<string>} takenIds すでにあるキャラ ID
 * @param {boolean} withVoice 声ありか（性格の文面に使う）
 * @returns {{ id: string, entry: object }}
 */
function importModel(src, appDir, takenIds, withVoice, lang = 'ja') {
  const lower = src.toLowerCase();
  const isLive2D = lower.endsWith('.model3.json');
  const ext = path.extname(lower);
  if (!isLive2D && !['.glb', '.gltf', '.vrm'].includes(ext)) {
    throw new Error(lang === 'en'
      ? 'Please choose a Live2D .model3.json, or a 3D .glb / .gltf / .vrm file.'
      : 'Live2D の .model3.json か、3D の .glb / .gltf / .vrm を選んでください。');
  }

  const base = path.basename(src).replace(/\.model3\.json$/i, '').replace(/\.(glb|gltf|vrm)$/i, '');
  const id = makeId(base, takenIds);
  const destDir = path.join(appDir, 'models', id);
  fs.mkdirSync(destDir, { recursive: true });

  if (isLive2D || ext === '.gltf') {
    // 参照しているテクスチャなどが同じフォルダにあるので、フォルダごとコピー
    fs.cpSync(path.dirname(src), destDir, { recursive: true });
  } else {
    fs.copyFileSync(src, path.join(destDir, path.basename(src)));
  }
  const modelPath = path.posix.join('models', id, path.basename(src));

  const entry = {
    characterName: base,
    characterType: isLive2D ? 'live2d' : 'gltf',
    modelPath,
    persona: defaultPersona(base, withVoice, 'ja'),
    persona_en: defaultPersona(base, withVoice, 'en'),
  };
  if (isLive2D) {
    Object.assign(entry, { modelScale: 1.0 }, detectLive2D(path.join(destDir, path.basename(src))));
  } else {
    entry.model3d = { fill: 0.8, rig: 'auto', fingers: 'auto' };
    entry.expressions = GLTF_EXPRESSIONS;
  }
  return { id, entry };
}

module.exports = { MODEL_FILTERS, importModel, defaultPersona };
