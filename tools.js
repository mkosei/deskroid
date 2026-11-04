// AI が呼び出せるツール（アプリを開く・天気を調べる）
// Electron に依存しないようにして、scripts/test-tools.mjs からも同じものを使えるようにしている
// lang は 'ja' か 'en'。AI への説明と結果の文を、その言語で返す

// 小さいモデルはキャラ設定と一緒だとツールを呼ばなくなるので、判定専用のプロンプトで呼ばせる
const ROUTER_PROMPTS = {
  ja: [
    'あなたはユーザーの依頼を判定する係です。ユーザーの最後の発言を見て、必要なツールを呼び出してください。',
    '- サイトやアプリを開く・その中で検索する依頼 → open_app',
    '- 天気・気温・雨・傘などを聞かれた → get_weather',
    'どれにも当てはまらない発言には、ツールを呼ばず「なし」とだけ答えてください。',
  ].join('\n'),
  en: [
    "You decide which tools the user's request needs. Look at the user's last message and call the tools it needs.",
    '- Requests to open a site or app, or to search inside one → open_app',
    '- Questions about the weather, temperature, rain, umbrellas and so on → get_weather',
    'If the message matches none of these, do not call any tool and reply only with "none".',
  ].join('\n'),
};
const routerPrompt = (lang) => ROUTER_PROMPTS[lang] || ROUTER_PROMPTS.ja;
const ROUTER_PROMPT = ROUTER_PROMPTS.ja;

// WMO 天気コード → 日本語 / 英語
const WEATHER_CODES = {
  ja: {
    0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり',
    45: '霧', 48: '霧',
    51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨', 56: '冷たい霧雨', 57: '冷たい霧雨',
    61: '小雨', 63: '雨', 65: '大雨', 66: '冷たい雨', 67: '冷たい雨',
    71: '小雪', 73: '雪', 75: '大雪', 77: '霧雪',
    80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨', 85: 'にわか雪', 86: '激しいにわか雪',
    95: '雷雨', 96: 'ひょうを伴う雷雨', 99: 'ひょうを伴う雷雨',
  },
  en: {
    0: 'clear sky', 1: 'mostly sunny', 2: 'partly cloudy', 3: 'cloudy',
    45: 'fog', 48: 'fog',
    51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'snow showers', 86: 'heavy snow showers',
    95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
  },
};
const DAY_LABELS = {
  ja: ['今日', '明日', '明後日'],
  en: ['today', 'tomorrow', 'the day after tomorrow'],
};

// 英語のときの表示名。name_en があればそれを使い、なければ「Prime Video（プライムビデオ）」の括弧の読みを外す
function appName(entry, lang) {
  if (lang !== 'en') return entry.name;
  return entry.name_en || entry.name.replace(/[（(].*?[）)]/g, '').trim();
}
const PLACE_EN = {
  東京: 'Tokyo', 千葉: 'Chiba', 大阪: 'Osaka', 京都: 'Kyoto', 名古屋: 'Nagoya',
  横浜: 'Yokohama', 札幌: 'Sapporo', 福岡: 'Fukuoka', 神戸: 'Kobe', 仙台: 'Sendai',
};
function placeName(key, place, lang) {
  if (lang !== 'en') return key;
  return place?.name_en || PLACE_EN[key] || key;
}

function buildTools(config, lang = 'ja') {
  const en = lang === 'en';
  const tools = [];

  const apps = Object.entries(config.apps || {});
  if (apps.length) {
    tools.push({
      type: 'function',
      function: {
        name: 'open_app',
        description: en
          ? "Open a site or app on the computer. If there is something to search for, put it in query to open that site's search results."
          : 'サイトやアプリをパソコンで開く。検索したい言葉があれば query に入れると、そのサイト内の検索結果を開く。',
        parameters: {
          type: 'object',
          properties: {
            app: {
              type: 'string',
              enum: apps.map(([key]) => key),
              description: en
                ? `What to open. ${apps.map(([key, a]) => `${key}=${appName(a, lang)}`).join(', ')}`
                : `開くもの。${apps.map(([key, a]) => `${key}=${a.name}`).join('、')}`,
            },
            query: { type: 'string', description: en ? 'What to search for (optional)' : '検索したい言葉（任意）' },
          },
          required: ['app'],
        },
      },
    });
  }

  const placeMap = config.weather?.places || {};
  const places = Object.keys(placeMap);
  if (places.length) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_weather',
        description: en
          ? 'Look up the weather forecast (weather, temperature, chance of rain).'
          : '天気予報（天気・気温・降水確率）を調べる。',
        parameters: {
          type: 'object',
          properties: {
            place: {
              type: 'string',
              enum: places,
              description: en
                ? `Location (${places.map((p) => `${p}=${placeName(p, placeMap[p], lang)}`).join(', ')}). Omit it if none is given (all registered locations are checked)`
                : '地域。指定がなければ省略する（登録済みの地域をすべて調べる）',
            },
            day: {
              type: 'integer',
              description: en
                ? 'Days from now. 0=today, 1=tomorrow, 2=the day after tomorrow (up to 6). 0 if not given'
                : '何日後か。0=今日、1=明日、2=明後日（最大6）。指定がなければ0',
            },
          },
        },
      },
    });
  }

  return tools;
}

// config.apps に登録されたものだけを開く（URL かローカルのパス）
async function openApp({ app: key, query }, { config, shell, lang }) {
  const en = lang === 'en';
  const entry = config.apps?.[key];
  if (!entry) return en ? `"${key}" isn't registered, so it couldn't be opened.` : `「${key}」は登録されていないので開けませんでした。`;
  const name = appName(entry, lang);
  const target = query && entry.search
    ? entry.search.replace('{query}', encodeURIComponent(query))
    : entry.open;
  if (/^https?:\/\//.test(target)) {
    await shell.openExternal(target);
  } else {
    const err = await shell.openPath(target);
    if (err) return en ? `Couldn't open ${name}: ${err}` : `${name} を開けませんでした: ${err}`;
  }
  if (en) return query ? `Opened a search for "${query}" on ${name}.` : `Opened ${name}.`;
  return query ? `${name} で「${query}」を検索して開きました。` : `${name} を開きました。`;
}

// Open-Meteo（無料・登録不要）で天気予報を取る
async function getWeather({ place, day }, { config, lang }) {
  const en = lang === 'en';
  const codes = en ? WEATHER_CODES.en : WEATHER_CODES.ja;
  const unknown = en ? 'unknown' : '不明';
  const all = config.weather?.places || {};
  const names = place && all[place] ? [place] : Object.keys(all);
  const d = Math.min(6, Math.max(0, Number(day) || 0));

  const lines = await Promise.all(names.map(async (name) => {
    const { lat, lon } = all[name];
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + `&timezone=auto&forecast_days=${d + 1}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(en ? `couldn't get the weather (${res.status})` : `天気の取得に失敗しました (${res.status})`);
    const { current, daily } = await res.json();

    const [, m, dd] = daily.time[d].split('-').map(Number);
    const sky = codes[daily.weather_code[d]] ?? unknown;
    const max = Math.round(daily.temperature_2m_max[d]);
    const min = Math.round(daily.temperature_2m_min[d]);
    const rain = daily.precipitation_probability_max[d];
    const now = codes[current.weather_code] ?? unknown;
    const temp = Math.round(current.temperature_2m);

    if (en) {
      const label = `${DAY_LABELS.en[d] || `in ${d} days`} (${m}/${dd})`;
      let line = `${placeName(name, all[name], lang)}, ${label}: ${sky}, high ${max}°C, low ${min}°C, ${rain}% chance of rain`;
      if (d === 0) line += ` (right now: ${now}, ${temp}°C)`;
      return line;
    }
    const label = `${DAY_LABELS.ja[d] || `${d}日後`}(${m}/${dd})`;
    let line = `${name}の${label}: ${sky}、最高${max}℃・最低${min}℃、降水確率${rain}%`;
    if (d === 0) line += `（いまは${now}で${temp}℃）`;
    return line;
  }));
  return lines.join(' / ');
}

const HANDLERS = { open_app: openApp, get_weather: getWeather };

async function runTool(name, args, ctx) {
  const en = ctx?.lang === 'en';
  const handler = HANDLERS[name];
  if (!handler) return en ? `Unknown tool: ${name}` : `不明なツール: ${name}`;
  try {
    return await handler(args || {}, ctx);
  } catch (err) {
    return en ? `Failed: ${err.message}` : `失敗しました: ${err.message}`;
  }
}

// ツールの結果をキャラ側に渡すときの添え書き
function resultNote(results, lang = 'ja') {
  if (lang === 'en') {
    return `(System note: you just carried out this request. Result: ${results.join(' ')} `
      + 'Tell the user about it briefly and naturally. If you opened an app, say that you just opened it, like "There you go, it\'s open!". '
      + "For the weather, don't just list the numbers; tell them what matters, like rain or what to wear, in a conversational way.)";
  }
  return `（システムより：あなたが今この依頼を実行しました。結果: ${results.join(' ')} `
    + 'この結果をもとに短く自然に伝えてください。アプリを開いた場合は「開いたよ」のように今開いたことを伝え、'
    + '天気の場合は数字をそのまま並べず、雨や服装など大事なところを話し言葉で伝えてください）';
}

module.exports = { ROUTER_PROMPT, routerPrompt, buildTools, runTool, resultNote };
