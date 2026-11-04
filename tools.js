// AI が呼び出せるツール（アプリ・サイト・フォルダを開く、Web で調べる、天気を調べる）
// Electron に依存しないようにして、scripts/test-tools.mjs からも同じものを使えるようにしている
// lang は 'ja' か 'en'。AI への説明と結果の文を、その言語で返す
// 安全のため、AI にできるのは「開く」「調べる」だけ。コマンドの実行やファイルの削除などはさせない
const { findApp } = require('./pc-apps');

// 小さいモデルはキャラ設定と一緒だとツールを呼ばなくなるので、判定専用のプロンプトで呼ばせる
const ROUTER_PROMPTS = {
  ja: [
    'あなたはユーザーの依頼を判定する係です。ユーザーの最後の発言を見て、必要なツールを呼び出してください。',
    '- パソコンに入っているアプリを開く・起動する → open_app（name にはアプリの一覧の名前を入れる）',
    '- YouTube や Amazon などの Web サイトを開く・そのサイトの中で探す → open_website',
    '- サイトを指定せずに「〜を調べて」「〜って何？を検索して」→ web_search',
    '- ダウンロード・ドキュメント・デスクトップなどのフォルダを開く → open_folder',
    '- 天気・気温・雨・傘などを聞かれた → get_weather',
    'アプリとサイトの両方がある名前（Spotify、Discord など）は、入っていればアプリを開く。',
    '一覧にないアプリを頼まれても、似た別のアプリに置き換えず、言われた名前のまま name に入れる（例: 一覧に Chrome がなくても name は "Chrome"。Microsoft Edge にしない）。',
    '普通の会話や質問（「今日疲れた」「おすすめの映画は？」など）には、ツールを呼ばず「なし」とだけ答えてください。',
  ].join('\n'),
  en: [
    "You decide which tools the user's request needs. Look at the user's last message and call the tools it needs.",
    '- Open or launch an app installed on the computer → open_app (put a name from the app list in name)',
    '- Open a website such as YouTube or Amazon, or search inside it → open_website',
    '- "Look up ..." or "search for ..." without naming a site → web_search',
    '- Open a folder such as Downloads, Documents or Desktop → open_folder',
    '- Questions about the weather, temperature, rain, umbrellas and so on → get_weather',
    'If something exists both as an app and a website (Spotify, Discord, ...), open the app when it is installed.',
    'If the requested app is not in the list, do not swap in a similar app; put the name exactly as the user said it (e.g. if Chrome is not listed, name is "Chrome", not Microsoft Edge).',
    'For ordinary chat or questions ("I\'m tired", "any movie recommendations?"), do not call any tool and reply only with "none".',
  ].join('\n'),
};
const routerPrompt = (lang) => ROUTER_PROMPTS[lang] || ROUTER_PROMPTS.ja;
const ROUTER_PROMPT = ROUTER_PROMPTS.ja;

// よく使うサイト。config.apps に URL で書いたものも、ここに足される（同じキーなら config の方が優先）
const SITES = {
  google: { name: 'Google', open: 'https://www.google.com/', search: 'https://www.google.com/search?q={query}' },
  youtube: { name: 'YouTube', open: 'https://www.youtube.com/', search: 'https://www.youtube.com/results?search_query={query}' },
  x: { name: 'X', open: 'https://x.com/home', search: 'https://x.com/search?q={query}' },
  github: { name: 'GitHub', open: 'https://github.com/', search: 'https://github.com/search?q={query}' },
  amazon: {
    name: 'Amazon',
    open: { ja: 'https://www.amazon.co.jp/', en: 'https://www.amazon.com/' },
    search: { ja: 'https://www.amazon.co.jp/s?k={query}', en: 'https://www.amazon.com/s?k={query}' },
  },
  wikipedia: {
    name: 'Wikipedia',
    open: { ja: 'https://ja.wikipedia.org/', en: 'https://en.wikipedia.org/' },
    search: { ja: 'https://ja.wikipedia.org/w/index.php?search={query}', en: 'https://en.wikipedia.org/w/index.php?search={query}' },
  },
  maps: { name: 'Google Maps', open: 'https://www.google.com/maps', search: 'https://www.google.com/maps/search/{query}' },
  gmail: { name: 'Gmail', open: 'https://mail.google.com/', search: 'https://mail.google.com/mail/u/0/#search/{query}' },
  spotify: { name: 'Spotify', open: 'https://open.spotify.com/', search: 'https://open.spotify.com/search/{query}' },
  netflix: { name: 'Netflix', open: 'https://www.netflix.com/', search: 'https://www.netflix.com/search?q={query}' },
  chatgpt: { name: 'ChatGPT', open: 'https://chatgpt.com/', search: 'https://chatgpt.com/?q={query}' },
};
const SEARCH_URL = 'https://www.google.com/search?q={query}';

// 開けるフォルダ（実際の場所は main.js から ctx.folders で渡す）
const FOLDERS = ['downloads', 'documents', 'desktop', 'pictures', 'music', 'videos', 'home'];
const FOLDER_NAMES = {
  ja: { downloads: 'ダウンロード', documents: 'ドキュメント', desktop: 'デスクトップ', pictures: 'ピクチャ', music: 'ミュージック', videos: 'ビデオ', home: 'ホーム' },
  en: { downloads: 'Downloads', documents: 'Documents', desktop: 'Desktop', pictures: 'Pictures', music: 'Music', videos: 'Videos', home: 'Home' },
};

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
function displayName(entry, lang) {
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

const isUrl = (s) => /^https?:\/\//i.test(String(s || ''));
const pick = (v, lang) => (v && typeof v === 'object' ? v[lang] || v.ja || v.en : v);

// 開けるサイトの一覧（よく使うサイト + config.apps の URL のもの）
function siteList(config) {
  const sites = { ...SITES };
  for (const [key, a] of Object.entries(config.apps || {})) {
    if (isUrl(a.open)) sites[key] = a;
  }
  return sites;
}

// config.apps にローカルのパスで書いたもの（スタートメニューに出ないアプリなど）は、アプリとして扱う
function customApps(config) {
  return Object.entries(config.apps || {})
    .filter(([, a]) => a.open && !isUrl(a.open))
    .map(([key, a]) => ({ name: a.name || key, alt: [key], path: a.open }));
}

// apps: 入っているアプリの一覧（pc-apps.js の listApps）。AI がその中から名前を選べるよう説明に並べる
function buildTools(config, lang = 'ja', apps = []) {
  const en = lang === 'en';
  const sites = siteList(config);
  const tools = [];

  if (apps.length) {
    const names = apps.map((a) => a.name).join(en ? ', ' : '、');
    tools.push({
      type: 'function',
      function: {
        name: 'open_app',
        description: en
          ? `Launch an app installed on this computer. Installed apps: ${names}`
          : `このパソコンに入っているアプリを起動する。入っているアプリ: ${names}`,
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: en ? 'The app name, chosen from the installed apps' : 'アプリの名前。入っているアプリの一覧から選ぶ',
            },
          },
          required: ['name'],
        },
      },
    });
  }

  tools.push({
    type: 'function',
    function: {
      name: 'open_website',
      description: en
        ? "Open a website in the browser. If there is something to search for, put it in query to open that site's search results."
        : 'Web サイトをブラウザで開く。探したい言葉があれば query に入れると、そのサイトの中の検索結果を開く。',
      parameters: {
        type: 'object',
        properties: {
          site: {
            type: 'string',
            enum: Object.keys(sites),
            description: en
              ? `Which site. ${Object.entries(sites).map(([k, s]) => `${k}=${displayName(s, lang)}`).join(', ')}`
              : `開くサイト。${Object.entries(sites).map(([k, s]) => `${k}=${s.name}`).join('、')}`,
          },
          query: { type: 'string', description: en ? 'What to search for on that site (optional)' : 'そのサイトで探したい言葉（任意）' },
          url: { type: 'string', description: en ? 'A full URL, only when the site is not in the list (optional)' : '一覧にないサイトのときだけ、https:// から始まる URL（任意）' },
        },
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'web_search',
      description: en ? 'Search the web in the browser.' : 'ブラウザで Web 検索をする。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: en ? 'What to search for' : '検索する言葉' } },
        required: ['query'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'open_folder',
      description: en ? 'Open a folder on this computer.' : 'パソコンのフォルダを開く。',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            enum: FOLDERS,
            description: en
              ? FOLDERS.map((f) => `${f}=${FOLDER_NAMES.en[f]}`).join(', ')
              : FOLDERS.map((f) => `${f}=${FOLDER_NAMES.ja[f]}`).join('、'),
          },
        },
        required: ['folder'],
      },
    },
  });

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

// 入っているアプリから一番近いものを起動する
async function openApp({ name }, ctx) {
  const { apps = [], launchApp, shell, lang, config } = ctx;
  const en = lang === 'en';
  const { app, candidates } = findApp(apps, name);
  if (!app) {
    // アプリが入っていなくても、同じ名前のサイトがあればそちらを開く（YouTube、Spotify など）
    const key = String(name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const site = Object.entries(siteList(config)).find(([k, s]) => k === key || s.name.toLowerCase().replace(/\s+/g, '') === key);
    if (site) return openWebsite({ site: site[0] }, ctx);
    if (en) return `Couldn't find an app called "${name}" on this computer.${candidates.length ? ` Similar apps: ${candidates.join(', ')}.` : ''}`;
    return `「${name}」というアプリは、このパソコンに見つかりませんでした。${candidates.length ? `近いもの: ${candidates.join('、')}。` : ''}`;
  }
  try {
    await launchApp(app, shell);
  } catch (err) {
    return en ? `Couldn't open ${app.name}: ${err.message}` : `${app.name} を開けませんでした: ${err.message}`;
  }
  return en ? `Opened ${app.name}.` : `${app.name} を開きました。`;
}

// サイトを開く（一覧のサイト、その中の検索、または https の URL）
async function openWebsite({ site, query, url }, { config, shell, lang }) {
  const en = lang === 'en';
  const entry = siteList(config)[site];
  if (entry) {
    const name = displayName(entry, lang);
    const searchUrl = pick(entry.search, lang);
    const target = query && searchUrl ? searchUrl.replace('{query}', encodeURIComponent(query)) : pick(entry.open, lang);
    await shell.openExternal(target);
    if (en) return query ? `Opened a search for "${query}" on ${name}.` : `Opened ${name}.`;
    return query ? `${name} で「${query}」を検索して開きました。` : `${name} を開きました。`;
  }
  if (isUrl(url)) {
    await shell.openExternal(url);
    return en ? `Opened ${url}.` : `${url} を開きました。`;
  }
  if (query) return webSearch({ query }, { shell, lang });
  return en ? `I don't know a site called "${site || url}", so I couldn't open it.` : `「${site || url}」というサイトがわからず、開けませんでした。`;
}

async function webSearch({ query }, { shell, lang }) {
  const en = lang === 'en';
  if (!query) return en ? 'There was nothing to search for.' : '検索する言葉がありませんでした。';
  await shell.openExternal(SEARCH_URL.replace('{query}', encodeURIComponent(query)));
  return en ? `Searched the web for "${query}".` : `「${query}」を Web で検索しました。`;
}

async function openFolder({ folder }, { folders = {}, shell, lang }) {
  const en = lang === 'en';
  const dir = folders[folder];
  const name = (en ? FOLDER_NAMES.en : FOLDER_NAMES.ja)[folder] || folder;
  if (!dir) return en ? `I don't know the folder "${folder}".` : `「${folder}」というフォルダはわかりませんでした。`;
  const err = await shell.openPath(dir);
  if (err) return en ? `Couldn't open the ${name} folder: ${err}` : `${name}フォルダを開けませんでした: ${err}`;
  return en ? `Opened the ${name} folder.` : `${name}フォルダを開きました。`;
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

const HANDLERS = {
  open_app: openApp,
  open_website: openWebsite,
  web_search: webSearch,
  open_folder: openFolder,
  get_weather: getWeather,
};

// ctx: { config, shell, lang, apps, launchApp, folders }
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
      + 'Tell the user about it briefly and naturally. If you opened something, say that you just opened it, like "There you go, it\'s open!". '
      + "If it failed or wasn't found, say so honestly. "
      + "For the weather, don't just list the numbers; tell them what matters, like rain or what to wear, in a conversational way.)";
  }
  return `（システムより：あなたが今この依頼を実行しました。結果: ${results.join(' ')} `
    + 'この結果をもとに短く自然に伝えてください。何かを開いた場合は「開いたよ」のように今開いたことを伝え、'
    + '見つからなかったり失敗したりした場合は正直にそう伝えてください。'
    + '天気の場合は数字をそのまま並べず、雨や服装など大事なところを話し言葉で伝えてください）';
}

module.exports = { ROUTER_PROMPT, routerPrompt, buildTools, runTool, resultNote, customApps };
