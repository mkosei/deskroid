// AI が呼び出せるツール（アプリ・サイト・フォルダを開く、Web で調べる、天気、音量・再生、タイマー）と、
// 結果を見ながら続けてツールを呼ぶエージェントループ（runAgent）
// Electron に依存しないようにして、scripts/test-tools.mjs からも同じものを使えるようにしている
// lang は 'ja' か 'en'。AI への説明と結果の文を、その言語で返す
// 安全のため、AI にできるのは「開く」「調べる」「音量・再生」「タイマー」だけ。コマンドの実行やファイルの削除などはさせない
const { findApp } = require('./pc-apps');
const { MEDIA_ACTIONS } = require('./pc-control');

// 小さいモデルはキャラ設定と一緒だとツールを呼ばなくなるので、判定専用のプロンプトで呼ばせる
const ROUTER_PROMPTS = {
  ja: [
    'あなたはユーザーの依頼を判定して、ツールで実行する係です。ユーザーの最後の発言を見て、必要なツールを呼び出してください。',
    '- パソコンに入っているアプリを開く・起動する → open_app（name にはアプリの一覧の名前を入れる）',
    '- YouTube や Amazon などの Web サイトを開く・そのサイトの中で探す → open_website',
    '- サイトを指定せずに「〜を調べて」「〜って何？を検索して」→ web_search',
    '- ダウンロード・ドキュメント・デスクトップなどのフォルダを開く → open_folder',
    '- 天気・気温・雨・傘などを聞かれた → get_weather',
    '- 音量を上げる・下げる・ミュート、曲の再生・一時停止・次の曲・前の曲 → media_control',
    '- 「〇分後に教えて」「〇時に〜って言って」などのタイマー・リマインダー → set_timer。取り消し → cancel_timers',
    '- 「コピーした文章」「これ」「クリップボード」を要約・翻訳・説明・添削してと言われた → read_clipboard で中身を読む',
    '  会話に出てきていない「これ」「この〜」（「このエラーどういう意味？」「これ何？」「これ訳して」）も、コピーした文章のことなので read_clipboard。',
    '  write_clipboard は「クリップボードに入れて」「コピーしといて」「貼れるようにして」とはっきり言われたときだけ使う。要約・翻訳・説明だけなら使わない。',
    '  時刻の指定（「7時半」「朝7時」「19時」）は at に "07:30" のように 24 時間表記で入れる。「〇分後」は minutes、「〇秒後」は seconds に入れる（秒を minutes に入れない）。',
    '  message には、時間になったときに伝える内容を書く（「〜って言って」ではなく「カップラーメンができたよ」のように）。',
    'アプリとサイトの両方がある名前（Spotify、Discord など）は、入っていればアプリを開く。',
    '一覧にないアプリを頼まれても、似た別のアプリに置き換えず、言われた名前のまま name に入れる（例: 一覧に Chrome がなくても name は "Chrome"。Microsoft Edge にしない）。',
    '頼みが複数あれば、それぞれツールを呼ぶ。ツールの結果が返ってきたら、それを見て、まだ残っている頼みがあれば次のツールを呼ぶ',
    '（例:「明日雨なら 7 時に傘のことを教えて」→ 天気を調べ、雨ならタイマー）。全部終わったら、ツールを呼ばず「完了」とだけ答える。',
    '同じツールを同じ内容で 2 回呼ばない。',
    '普通の会話や質問（「今日疲れた」「おすすめの映画は？」など）には、ツールを呼ばず「なし」とだけ答えてください。',
  ].join('\n'),
  en: [
    "You decide which tools the user's request needs and carry it out. Look at the user's last message and call the tools it needs.",
    '- Open or launch an app installed on the computer → open_app (put a name from the app list in name)',
    '- Open a website such as YouTube or Amazon, or search inside it → open_website',
    '- "Look up ..." or "search for ..." without naming a site → web_search',
    '- Open a folder such as Downloads, Documents or Desktop → open_folder',
    '- Questions about the weather, temperature, rain, umbrellas and so on → get_weather',
    '- Volume up / down / mute, play / pause, next / previous track → media_control',
    '- Timers and reminders ("tell me in 10 minutes", "remind me at 7 to ...") → set_timer. To cancel them → cancel_timers',
    '- Asked to summarize / translate / explain / proofread "what I copied", "this" or "the clipboard" → read it with read_clipboard',
    '  "this" / "this error" that has not come up in the conversation ("what does this error mean?", "what is this?", "translate this") also means the copied text, so use read_clipboard.',
    '  Use write_clipboard only when the user clearly says "put it on the clipboard", "copy it" or "so I can paste it"; never for just a summary, translation or explanation.',
    '  For a clock time ("7:30", "7 am", "7 pm") put it in at as 24-hour "07:30". "in N minutes" goes in minutes and "in N seconds" goes in seconds (never put seconds in minutes).',
    '  In message, write what to tell the user ("your noodles are ready"), not the request itself.',
    'If something exists both as an app and a website (Spotify, Discord, ...), open the app when it is installed.',
    'If the requested app is not in the list, do not swap in a similar app; put the name exactly as the user said it (e.g. if Chrome is not listed, name is "Chrome", not Microsoft Edge).',
    'If there are several requests, call a tool for each. When tool results come back, look at them and call the next tool if any request is left',
    '(e.g. "if it rains tomorrow, remind me about an umbrella at 7" → check the weather, then set a timer only if it rains). When everything is done, do not call any tool and reply only with "done".',
    'Never call the same tool with the same arguments twice.',
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

  tools.push({
    type: 'function',
    function: {
      name: 'media_control',
      description: en
        ? 'Change the volume or control music / video playback (same as the media keys on a keyboard).'
        : '音量を変える、または音楽・動画の再生を操作する（キーボードのメディアキーと同じ）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: MEDIA_ACTIONS,
            description: en
              ? 'volume_up, volume_down, mute (toggle), play_pause, next (track), previous (track)'
              : 'volume_up=音量を上げる、volume_down=下げる、mute=ミュート切り替え、play_pause=再生・一時停止、next=次の曲、previous=前の曲',
          },
          steps: {
            type: 'integer',
            description: en
              ? 'For volume only: how much to change, 1-25. "a little" / "a bit" = 2, not specified = 5, "a lot" = 10'
              : '音量のときだけ。どれくらい変えるか 1〜25。「少し」「ちょっと」なら 2、指定がなければ 5、「かなり」「すごく」なら 10',
          },
        },
        required: ['action'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'set_timer',
      description: en
        ? 'Set a timer or reminder. The character will tell the user when the time comes. Give either minutes / seconds from now, or a clock time in at.'
        : 'タイマー・リマインダーをセットする。時間になったらキャラが知らせる。「今から何分・何秒後」か、時刻（at）のどちらかを入れる。',
      parameters: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: en ? 'Minutes from now. Only for "in N minutes"; never for a clock time' : '今から何分後か。「〇分後」のときだけ使い、時刻には使わない' },
          seconds: { type: 'number', description: en ? 'Seconds from now. Use this for "in N seconds"' : '今から何秒後か。「〇秒後」のときはこちら' },
          at: { type: 'string', description: en ? 'Clock time in 24-hour HH:MM, e.g. 7:30 am = "07:30", 7 pm = "19:00"' : '時刻（24 時間表記の HH:MM）。例: 7時半 → "07:30"、朝7時 → "07:00"、夜7時 → "19:00"' },
          message: { type: 'string', description: en ? 'What to tell the user when the time comes, e.g. "Your noodles are ready"' : '時間になったら伝える内容。例:「カップラーメンができたよ」「傘を持っていってね」' },
        },
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'cancel_timers',
      description: en ? 'Cancel all timers and reminders that are set.' : 'セットしてあるタイマー・リマインダーを全部取り消す。',
      parameters: { type: 'object', properties: {} },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'read_clipboard',
      description: en
        ? 'Read the text the user copied (the clipboard). Use it when asked about "what I copied" or "this".'
        : 'ユーザーがコピーした文章（クリップボード）を読む。「コピーした文章」「これ」について頼まれたときに使う。',
      parameters: { type: 'object', properties: {} },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'write_clipboard',
      description: en
        ? 'Put text on the clipboard so the user can paste it (e.g. a translation or a rewritten text).'
        : 'ユーザーが貼り付けられるよう、文章をクリップボードに入れる（翻訳や書き直した文章など）。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: en ? 'The full text to put on the clipboard' : 'クリップボードに入れる文章の全文' } },
        required: ['text'],
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

const MEDIA_DONE = {
  ja: { volume_up: '音量を上げました', volume_down: '音量を下げました', mute: 'ミュートを切り替えました', play_pause: '再生・一時停止を切り替えました', next: '次の曲にしました', previous: '前の曲にしました' },
  en: { volume_up: 'Turned the volume up', volume_down: 'Turned the volume down', mute: 'Toggled mute', play_pause: 'Toggled play / pause', next: 'Skipped to the next track', previous: 'Went back to the previous track' },
};

async function mediaControlTool({ action, steps }, { mediaControl, lang }) {
  const en = lang === 'en';
  const ok = await mediaControl(action, steps ?? 5);
  if (!ok) return en ? "That operation isn't supported on this computer." : 'その操作は、このパソコンではまだできません。';
  return `${(en ? MEDIA_DONE.en : MEDIA_DONE.ja)[action]}${en ? '.' : '。'}`;
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// 何ミリ秒後に鳴らすか。時刻（HH:MM）がもう過ぎていれば明日のその時刻にする
function timerDelay({ minutes, seconds, at }, now = new Date()) {
  const m = String(at || '').match(/^(\d{1,2})[:：時](\d{1,2})?/);
  if (m) {
    const t = new Date(now);
    t.setHours(Number(m[1]), Number(m[2] || 0), 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return t - now;
  }
  return ((Number(minutes) || 0) * 60 + (Number(seconds) || 0)) * 1000;
}

async function setTimerTool(args, { timers, lang }) {
  const en = lang === 'en';
  const ms = timerDelay(args);
  if (!(ms > 0)) return en ? "I couldn't tell when to set the timer for." : 'いつにタイマーをセットすればいいか、わかりませんでした。';
  if (ms > 24 * 60 * 60 * 1000) return en ? 'Timers can be set up to 24 hours ahead.' : 'タイマーは 24 時間先までしかセットできません。';
  const when = new Date(Date.now() + ms);
  const message = args.message || (en ? "Time's up!" : '時間になりましたよ。');
  timers.add(ms, message);
  const mins = Math.round(ms / 60000);
  const secs = Math.round(ms / 1000);
  const inEn = mins < 60 ? ` (in ${secs < 90 ? `${secs} seconds` : `${mins} minutes`})` : '';
  const inJa = mins < 60 ? `（${secs < 90 ? `${secs} 秒後` : `${mins} 分後`}）` : '';
  if (en) return `Set a timer: at ${clock(when)}${inEn} I will tell the user "${message}".`;
  return `タイマーをセットしました。${clock(when)}${inJa}になったら「${message}」と知らせる予定です。`;
}

async function cancelTimersTool(_args, { timers, lang }) {
  const n = timers.cancelAll();
  if (lang === 'en') return n ? `Cancelled ${n} timer(s).` : 'There were no timers set.';
  return n ? `タイマーを ${n} 件取り消しました。` : 'セットしてあるタイマーはありませんでした。';
}

// クリップボードはローカルの AI（Ollama）にしか渡さない。長すぎるときは先頭だけにする
const CLIPBOARD_LIMIT = 6000;

async function readClipboardTool(_args, { clipboard, lang }) {
  const en = lang === 'en';
  const text = (clipboard.readText() || '').trim();
  if (!text) return en ? 'The clipboard is empty (no text has been copied).' : 'クリップボードは空でした（文章がコピーされていません）。';
  const cut = text.length > CLIPBOARD_LIMIT;
  const body = cut ? text.slice(0, CLIPBOARD_LIMIT) : text;
  if (en) return `When the user says "this" or "what I copied", they mean this text from the clipboard (${text.length} characters${cut ? `, first ${CLIPBOARD_LIMIT} shown` : ''}):\n<<<\n${body}\n>>>`;
  return `ユーザーが「これ」「コピーした文章」と言っているのは、クリップボードにある次の文章です（${text.length} 文字${cut ? `。長いので最初の ${CLIPBOARD_LIMIT} 文字だけ` : ''}）:\n<<<\n${body}\n>>>`;
}

// 「クリップボードに入れて」「コピーしといて」「貼れるように」などと頼まれたときだけ書き込む（コピーしてあるものを勝手に消さない）
const ASKED_TO_WRITE = /クリップボード|コピーし(て|と)|貼(り付け|れる|って)|ペースト|clipboard|copy (it|that|this)|paste/i;

async function writeClipboardTool({ text }, { clipboard, lang, request = '', show }) {
  const en = lang === 'en';
  if (!text) return en ? 'There was no text to put on the clipboard.' : 'クリップボードに入れる文章がありませんでした。';
  show?.push(String(text));
  if (!ASKED_TO_WRITE.test(request)) {
    return en
      ? 'Made the text (it will be shown in the speech bubble). The clipboard was not changed, because the user did not ask for that.'
      : '文章を作りました（吹き出しに表示されます）。頼まれていないので、クリップボードは書き換えていません。';
  }
  clipboard.writeText(String(text));
  return en
    ? `Made the text and put it on the clipboard (${String(text).length} characters; it will also be shown in the speech bubble). The user can paste it with Ctrl+V.`
    : `文章を作ってクリップボードに入れました（${String(text).length} 文字。吹き出しにも表示されます）。Ctrl+V で貼り付けられます。`;
}

const HANDLERS = {
  open_app: openApp,
  open_website: openWebsite,
  web_search: webSearch,
  open_folder: openFolder,
  get_weather: getWeather,
  media_control: mediaControlTool,
  set_timer: setTimerTool,
  cancel_timers: cancelTimersTool,
  read_clipboard: readClipboardTool,
  write_clipboard: writeClipboardTool,
};

// ctx: { config, shell, lang, apps, launchApp, folders, mediaControl, timers, clipboard, request（ユーザーの最後の発言） }
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

// エージェントループ：判定役にツールを選ばせて実行し、結果を返してまた考えさせる。
// 「全部終わった（ツールを呼ばない）」と言うか、maxSteps 回で止める
// chat(messages, tools) は { toolCalls } を返す関数（main.js は Ollama のストリーム、テストは普通の fetch）
// 結果を見てから次を決めるための「調べる」ツール。これ以外（開く・セットする・書き込む…）を実行したら、そこで止める
// （小さいモデルは、終わったあとも余計なツール（検索など）を呼び続けることがあるため）
const INFO_TOOLS = new Set(['get_weather', 'read_clipboard']);

async function runAgent({ chat, history, tools, ctx: baseCtx, maxSteps = 5, log = () => {} }) {
  let ctx = baseCtx;
  // 判定役には、最後の発言と、その直前のキャラの返事（「これ」などが何を指すかの手がかり）だけを渡す。
  // それより前の発言を渡すと、もう済んだ頼み（前のタイマーなど）をもう一度実行してしまう
  const lastUser = history.map((m) => m.role).lastIndexOf('user');
  const prev = history[lastUser - 1]?.role === 'assistant' ? [history[lastUser - 1]] : [];
  const messages = [{ role: 'system', content: routerPrompt(ctx.lang) }, ...prev, ...history.slice(lastUser, lastUser + 1)];
  const request = history[lastUser]?.content || '';
  const show = []; // 返事のあとに吹き出しへそのまま出す文章（翻訳など）
  ctx = { ...ctx, request, show };
  const results = [];
  const done = new Set();
  for (let step = 0; step < maxSteps; step++) {
    const { toolCalls = [] } = await chat(messages, tools);
    // 小さいモデルは同じ呼び出しを繰り返すことがある（同じアプリが 2 回開くのを防ぐ）
    const fresh = toolCalls.filter((c) => {
      const key = `${c.function.name}:${JSON.stringify(Object.entries(c.function.arguments || {}).sort())}`;
      if (done.has(key)) return false;
      done.add(key);
      return true;
    });
    if (!fresh.length) break;
    messages.push({ role: 'assistant', content: '', tool_calls: fresh });
    for (const call of fresh) {
      const { name, arguments: args } = call.function;
      const result = await runTool(name, args, ctx);
      log(step, name, args, result);
      results.push({ name, result });
      messages.push({ role: 'tool', content: result, tool_name: name });
    }
    // 調べただけの回なら、結果を見て続ける。何かを実行した回なら、そこで終わり
    if (!fresh.some((c) => INFO_TOOLS.has(c.function.name))) break;
  }
  // 作った文章（翻訳など）を吹き出しに出すときは、元のクリップボードの文章を返事役に渡さない（同じ内容を二度言わせない）
  const forReply = results.filter((r) => !(show.length && r.name === 'read_clipboard')).map((r) => r.result);
  return { results: forReply, show };
}

// ツールの結果をキャラ側に渡すときの添え書き
// 返事役（キャラ）に渡す、ユーザーの最後の発言の中身を作る
// - 作った文章（翻訳など）を吹き出しに出すとき：中身は見せず、「渡すときの一言」だけを頼む（同じ内容を二度言わせない）
// - ツールを使ったとき：発言のあとに結果の添え書きを付ける
function replyMessage(userText, results, show, lang = 'ja') {
  if (show.length) {
    return lang === 'en'
      ? `(System note: you have finished making the text the user asked for ("${userText}"). It is shown in the speech bubble right after your reply. Say just one short line, in character, as you hand it over. Do not repeat the text.)`
      : `（システムより：ユーザーの頼み「${userText}」に応えて、文章を作り終えました。文章はあなたの返事のすぐあとに吹き出しへ表示されます。キャラとして、渡すときの一言だけを短く言ってください。文章の中身は繰り返さないでください）`;
  }
  return results.length ? `${userText}\n\n${resultNote(results, lang)}` : userText;
}

function resultNote(results, lang = 'ja') {
  if (lang === 'en') {
    return `(System note: you just carried out this request. Result: ${results.join(' ')} `
      + 'Tell the user about it briefly and naturally. Only if you opened something, say that you just opened it, like "There you go, it\'s open!". '
      + "If it failed or wasn't found, say so honestly. If you set a timer, only say when it will go off; it hasn't happened yet, so don't say the message as if it already did. "
      + 'If the result contains clipboard text, use it to do what the user asked (summarize, explain, ...); for that, you may use more sentences than usual. '
      + "For the weather, don't just list the numbers; tell them what matters, like rain or what to wear, in a conversational way.)";
  }
  return `（システムより：あなたが今この依頼を実行しました。結果: ${results.join(' ')} `
    + 'この結果をもとに短く自然に伝えてください。何かを開いた場合だけ「開いたよ」のように今開いたことを伝え、'
    + '見つからなかったり失敗したりした場合は正直にそう伝えてください。タイマーをセットした場合は、いつ知らせるかだけを伝え、まだ時間になっていないので、伝える内容をもう起きたことのように言わないでください。'
    + 'クリップボードの文章が結果に入っていたら、それを使って頼まれたこと（要約・説明など）に答えてください。そのときは、いつもより長くなってもかまいません。'
    + '天気の場合は数字をそのまま並べず、雨や服装など大事なところを話し言葉で伝えてください）';
}

module.exports = { ROUTER_PROMPT, routerPrompt, buildTools, runTool, runAgent, resultNote, replyMessage, customApps, timerDelay };
