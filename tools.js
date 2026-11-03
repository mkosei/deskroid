// AI が呼び出せるツール（アプリを開く・天気を調べる）
// Electron に依存しないようにして、scripts/test-tools.mjs からも同じものを使えるようにしている

// 小さいモデルはキャラ設定と一緒だとツールを呼ばなくなるので、判定専用のプロンプトで呼ばせる
const ROUTER_PROMPT = [
  'あなたはユーザーの依頼を判定する係です。ユーザーの最後の発言を見て、必要なツールを呼び出してください。',
  '- サイトやアプリを開く・その中で検索する依頼 → open_app',
  '- 天気・気温・雨・傘などを聞かれた → get_weather',
  'どれにも当てはまらない発言には、ツールを呼ばず「なし」とだけ答えてください。',
].join('\n');

// WMO 天気コード → 日本語
const WEATHER_CODES = {
  0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり',
  45: '霧', 48: '霧',
  51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨', 56: '冷たい霧雨', 57: '冷たい霧雨',
  61: '小雨', 63: '雨', 65: '大雨', 66: '冷たい雨', 67: '冷たい雨',
  71: '小雪', 73: '雪', 75: '大雪', 77: '霧雪',
  80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨', 85: 'にわか雪', 86: '激しいにわか雪',
  95: '雷雨', 96: 'ひょうを伴う雷雨', 99: 'ひょうを伴う雷雨',
};
const DAY_LABELS = ['今日', '明日', '明後日'];

function buildTools(config) {
  const tools = [];

  const apps = Object.entries(config.apps || {});
  if (apps.length) {
    tools.push({
      type: 'function',
      function: {
        name: 'open_app',
        description: 'サイトやアプリをパソコンで開く。検索したい言葉があれば query に入れると、そのサイト内の検索結果を開く。',
        parameters: {
          type: 'object',
          properties: {
            app: {
              type: 'string',
              enum: apps.map(([key]) => key),
              description: `開くもの。${apps.map(([key, a]) => `${key}=${a.name}`).join('、')}`,
            },
            query: { type: 'string', description: '検索したい言葉（任意）' },
          },
          required: ['app'],
        },
      },
    });
  }

  const places = Object.keys(config.weather?.places || {});
  if (places.length) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_weather',
        description: '天気予報（天気・気温・降水確率）を調べる。',
        parameters: {
          type: 'object',
          properties: {
            place: {
              type: 'string',
              enum: places,
              description: '地域。指定がなければ省略する（登録済みの地域をすべて調べる）',
            },
            day: {
              type: 'integer',
              description: '何日後か。0=今日、1=明日、2=明後日（最大6）。指定がなければ0',
            },
          },
        },
      },
    });
  }

  return tools;
}

// config.apps に登録されたものだけを開く（URL かローカルのパス）
async function openApp({ app: key, query }, { config, shell }) {
  const entry = config.apps?.[key];
  if (!entry) return `「${key}」は登録されていないので開けませんでした。`;
  const target = query && entry.search
    ? entry.search.replace('{query}', encodeURIComponent(query))
    : entry.open;
  if (/^https?:\/\//.test(target)) {
    await shell.openExternal(target);
  } else {
    const err = await shell.openPath(target);
    if (err) return `${entry.name} を開けませんでした: ${err}`;
  }
  return query ? `${entry.name} で「${query}」を検索して開きました。` : `${entry.name} を開きました。`;
}

// Open-Meteo（無料・登録不要）で天気予報を取る
async function getWeather({ place, day }, { config }) {
  const all = config.weather?.places || {};
  const names = place && all[place] ? [place] : Object.keys(all);
  const d = Math.min(6, Math.max(0, Number(day) || 0));

  const lines = await Promise.all(names.map(async (name) => {
    const { lat, lon } = all[name];
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + `&timezone=Asia%2FTokyo&forecast_days=${d + 1}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`天気の取得に失敗しました (${res.status})`);
    const { current, daily } = await res.json();

    const [, m, dd] = daily.time[d].split('-').map(Number);
    const label = `${DAY_LABELS[d] || `${d}日後`}(${m}/${dd})`;
    const sky = WEATHER_CODES[daily.weather_code[d]] ?? '不明';
    const max = Math.round(daily.temperature_2m_max[d]);
    const min = Math.round(daily.temperature_2m_min[d]);
    const rain = daily.precipitation_probability_max[d];
    let line = `${name}の${label}: ${sky}、最高${max}℃・最低${min}℃、降水確率${rain}%`;
    if (d === 0) {
      line += `（いまは${WEATHER_CODES[current.weather_code] ?? '不明'}で${Math.round(current.temperature_2m)}℃）`;
    }
    return line;
  }));
  return lines.join(' / ');
}

const HANDLERS = { open_app: openApp, get_weather: getWeather };

async function runTool(name, args, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return `不明なツール: ${name}`;
  try {
    return await handler(args || {}, ctx);
  } catch (err) {
    return `失敗しました: ${err.message}`;
  }
}

// ツールの結果をキャラ側に渡すときの添え書き
function resultNote(results) {
  return `（システムより：あなたが今この依頼を実行しました。結果: ${results.join(' ')} `
    + 'この結果をもとに短く自然に伝えてください。アプリを開いた場合は「開いたよ」のように今開いたことを伝え、'
    + '天気の場合は数字をそのまま並べず、雨や服装など大事なところを話し言葉で伝えてください）';
}

module.exports = { ROUTER_PROMPT, buildTools, runTool, resultNote };
