// ポモドーロ（集中 → 休憩 をくり返す）。時間の管理だけをして、知らせ方は呼び出し側（main.js）が決める
// 集中を longEvery 回終えるごとに、長い休憩になる。休憩が終わると、次の集中を自動で始める

const DEFAULTS = { focus: 25, shortBreak: 5, longBreak: 15, longEvery: 4 };

function createPomodoro({ settings = {}, onPhaseEnd = () => {}, onChange = () => {}, now = () => Date.now() } = {}) {
  let opts = { ...DEFAULTS, ...settings };
  let phase = null;     // 'focus' | 'short' | 'long' | null（止まっている）
  let endsAt = 0;       // 今の区切りが終わる時刻（動いているとき）
  let remaining = 0;    // 一時停止中の残り（ミリ秒）
  let paused = false;
  let total = 0;        // 今の区切りの長さ（ミリ秒）
  let done = 0;         // 今日終えた集中の回数（start でリセット）
  let timer = null;

  const minutes = (p) => (p === 'focus' ? opts.focus : p === 'long' ? opts.longBreak : opts.shortBreak);

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(finish, ms);
  }

  function begin(p, ms = minutes(p) * 60000) {
    phase = p;
    total = ms;
    paused = false;
    endsAt = now() + ms;
    schedule(ms);
    onChange(state());
  }

  function finish() {
    const ended = phase;
    if (!ended) return;
    if (ended === 'focus') done += 1;
    const next = ended === 'focus' ? (done % opts.longEvery === 0 ? 'long' : 'short') : 'focus';
    begin(next);
    onPhaseEnd({ ended, next, done, minutes: minutes(next) });
  }

  function state() {
    if (!phase) return { running: false, done };
    return {
      running: true,
      phase,
      paused,
      endsAt: paused ? null : endsAt,
      remaining: paused ? remaining : Math.max(0, endsAt - now()),
      total,
      done,
      longEvery: opts.longEvery,
    };
  }

  return {
    // focus / shortBreak は分。指定が無ければ設定の値
    start({ focus, shortBreak } = {}) {
      opts = { ...DEFAULTS, ...settings };
      if (focus > 0) opts.focus = focus;
      if (shortBreak > 0) opts.shortBreak = shortBreak;
      done = 0;
      begin('focus');
      return state();
    },
    pause() {
      if (!phase || paused) return false;
      remaining = Math.max(0, endsAt - now());
      paused = true;
      clearTimeout(timer);
      onChange(state());
      return true;
    },
    resume() {
      if (!phase || !paused) return false;
      paused = false;
      endsAt = now() + remaining;
      schedule(remaining);
      onChange(state());
      return true;
    },
    // 今の区切りを飛ばして次へ
    skip() {
      if (!phase) return false;
      clearTimeout(timer);
      finish();
      return true;
    },
    stop() {
      if (!phase) return false;
      clearTimeout(timer);
      phase = null;
      paused = false;
      onChange(state());
      return true;
    },
    // 時間の設定を変える。動いている途中なら、今の区切りはそのままで、次の区切りから新しい時間にする
    setSettings(s) {
      settings = s || {};
      opts = { ...DEFAULTS, ...settings };
    },
    state,
  };
}

module.exports = { createPomodoro, POMODORO_DEFAULTS: DEFAULTS };
