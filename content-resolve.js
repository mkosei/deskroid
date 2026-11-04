// 「〇〇のチャンネル」「〇〇の作品」を名前から探し、直接開ける URL を返す（Electron に依存しない）
// ブラウザは使わず、検索結果のページを取ってきて、いちばん上の結果のリンクを読む。
// 見つからない・サイトに断られたときは null を返す（呼ぶ側は検索結果のページを開く）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function getPage(url, lang) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': lang === 'en' ? 'en-US,en;q=0.8' : 'ja,en;q=0.8' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------- YouTube ----------

// 検索結果のページに埋め込まれている ytInitialData（JSON）を取り出す
function ytInitialData(html) {
  const start = html.indexOf('var ytInitialData = ');
  if (start < 0) return null;
  const from = start + 'var ytInitialData = '.length;
  const end = html.indexOf(';</script>', from);
  try { return JSON.parse(html.slice(from, end)); } catch { return null; }
}

// JSON の中から、出てくる順にチャンネルと動画を集める
function collectRenderers(node, out = []) {
  if (!node || typeof node !== 'object' || out.length >= 20) return out;
  if (node.channelRenderer?.channelId) {
    const c = node.channelRenderer;
    out.push({
      type: 'channel',
      title: c.title?.simpleText || '',
      url: `https://www.youtube.com${c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || `/channel/${c.channelId}`}`,
    });
  } else if (node.videoRenderer?.videoId) {
    const v = node.videoRenderer;
    out.push({
      type: 'video',
      title: v.title?.runs?.map((r) => r.text).join('') || '',
      channel: v.ownerText?.runs?.[0]?.text || '',
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    });
  } else {
    for (const v of Array.isArray(node) ? node : Object.values(node)) collectRenderers(v, out);
  }
  return out;
}

// kind: 'channel'（チャンネルを開く）/ 'video'（動画を開く）/ 'any'（上に出てきた方）
async function resolveYouTube(query, kind = 'any', lang = 'ja') {
  const hl = lang === 'en' ? 'en' : 'ja';
  // チャンネルだけを探すときは「チャンネル」の絞り込みを付ける
  const filter = kind === 'channel' ? '&sp=EgIQAg%253D%253D' : kind === 'video' ? '&sp=EgIQAQ%253D%253D' : '';
  const html = await getPage(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${filter}&hl=${hl}`, lang);
  const items = collectRenderers(ytInitialData(html));
  const hit = kind === 'any' ? items[0] : items.find((i) => i.type === kind);
  return hit || null;
}

// ---------- プライムビデオ ----------

const AMAZON = { ja: 'https://www.amazon.co.jp', en: 'https://www.amazon.com' };

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

async function resolvePrimeVideo(query, lang = 'ja') {
  const base = AMAZON[lang] || AMAZON.ja;
  const html = await getPage(`${base}/s?k=${encodeURIComponent(query)}&i=instant-video`, lang);
  // 検索結果のリンクには ref_=...pvsearchresults... が付いている（上の広告のリンクと見分けるため）
  const m = html.match(/\/gp\/video\/detail\/([A-Z0-9]{10})\?ref_=[^"]*pvsearchresults[^"]*"[^>]*>([^<]+)/);
  if (!m) return null;
  return { type: 'title', title: decodeHtml(m[2]), url: `${base}/gp/video/detail/${m[1]}` };
}

module.exports = { resolveYouTube, resolvePrimeVideo };
