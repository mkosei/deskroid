// UI の配色（style.css の CSS 変数）を作る共通の処理。キャラ画面と配色設定画面の両方で使う
// - buildTheme: 基本の 6 色（背景・不透明度・文字・強調色・名札・名札の文字）から全部の変数を作る
// - baseFromTheme: 既存の配色から基本の 6 色を取り出す（設定画面の初期値に使う）
// - autoTheme: キャラを描いた画像から目立つ色を拾って配色を作る
(() => {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const toHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hslToRgb([h, s, l]) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }

  const hsl = (h, s, l) => toHex(hslToRgb([h, clamp(s, 0, 1), clamp(l, 0, 1)]));
  const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(', ')}, ${a})`;
  const mix = (a, b, t) => toHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));

  // 見た目の明るさ（0〜1）
  function luminance(hex) {
    const c = hexToRgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const readableOn = (hex) => (luminance(hex) > 0.4 ? '#1c1b24' : '#ffffff');

  // 基本の 6 色から、style.css の変数を全部作る
  function buildTheme({ panel, panelAlpha = 0.92, text, accent, nameBg, nameText }) {
    const dark = luminance(panel) < 0.25;
    const [h, s, l] = rgbToHsl(hexToRgb(accent));
    const hover = hsl(h, s, l + (l > 0.6 ? -0.08 : 0.08));
    const sub = mix(text, panel, 0.42);
    return {
      panel: rgba(panel, panelAlpha),
      'panel-text': text,
      'sub-text': sub,
      border: rgba(accent, 0.45),
      accent,
      'accent-hover': hover,
      'accent-text': readableOn(accent),
      soft: rgba(accent, 0.16),
      'soft-hover': rgba(accent, 0.3),
      'name-bg': nameBg || accent,
      'name-text': nameText || readableOn(nameBg || accent),
      listen: '#e05a7a',
      think: sub,
      speak: accent,
      shadow: dark ? 'rgba(5, 8, 20, 0.5)' : 'rgba(60, 40, 50, 0.22)',
    };
  }

  // style.css の既定の配色（テーマが空のとき）と同じ基本色
  const DEFAULT_BASE = {
    panel: '#fffbf6', panelAlpha: 0.94, text: '#4a3d3a', accent: '#c8435a', nameBg: '#c8435a', nameText: '#ffffff',
  };

  // 色の文字列から #rrggbb と不透明度を取り出す（rgba・#hex・グラデーションの最初の色に対応）
  function parseColor(str) {
    if (!str) return null;
    let m = str.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
    if (m) return { hex: toHex([+m[1], +m[2], +m[3]]), alpha: m[4] === undefined ? 1 : +m[4] };
    m = str.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
    if (m) return { hex: toHex(hexToRgb(m[1])), alpha: 1 };
    return null;
  }

  function baseFromTheme(theme = {}) {
    const panel = parseColor(theme.panel);
    return {
      panel: panel?.hex || DEFAULT_BASE.panel,
      panelAlpha: panel ? panel.alpha : DEFAULT_BASE.panelAlpha,
      text: parseColor(theme['panel-text'])?.hex || DEFAULT_BASE.text,
      accent: parseColor(theme.accent)?.hex || DEFAULT_BASE.accent,
      nameBg: parseColor(theme['name-bg'])?.hex || parseColor(theme.accent)?.hex || DEFAULT_BASE.nameBg,
      nameText: parseColor(theme['name-text'])?.hex || DEFAULT_BASE.nameText,
    };
  }

  // キャラの画像（ImageData。まばたきなどでぶれないよう数枚まとめて渡せる）から配色を作る。
  // 鮮やかな色のうちいちばん多い色相を強調色にし、キャラ全体が暗めなら暗い背景、明るめなら明るい背景にする
  function autoTheme(images) {
    const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let lightSum = 0;
    let count = 0;
    for (const { data } of [].concat(images)) {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue; // 透明な部分（背景）は数えない
        const rgb = [data[i], data[i + 1], data[i + 2]];
        const [h, s, l] = rgbToHsl(rgb);
        lightSum += l;
        count++;
        if (s < 0.3 || l < 0.25 || l > 0.75) continue;
        const bin = bins[Math.floor(h / 15) % 24];
        // 肌や茶髪の色（オレンジ〜黄土色）は面積が大きくなりがちなので軽く見る。鮮やかな色ほど重く見る
        const skinish = h >= 10 && h <= 45;
        const w = s * s * (1 - Math.abs(l - 0.55)) * (skinish ? 0.06 : 1);
        bin.w += w;
        bin.r += rgb[0] * w;
        bin.g += rgb[1] * w;
        bin.b += rgb[2] * w;
      }
    }
    if (!count) return null;

    const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
    let [h, s] = [230, 0.45];
    if (best.w > count * 0.0015) {
      [h, s] = rgbToHsl([best.r / best.w, best.g / best.w, best.b / best.w]);
    }
    const accent = hsl(h, Math.max(s, 0.55), 0.55);
    const darkModel = lightSum / count < 0.5;
    const base = darkModel
      ? { panel: hsl(h, 0.35, 0.12), panelAlpha: 0.92, text: hsl(h, 0.2, 0.94), accent }
      : { panel: hsl(h, 0.35, 0.975), panelAlpha: 0.95, text: hsl(h, 0.25, 0.22), accent };
    base.nameBg = accent;
    base.nameText = readableOn(accent);
    return { base, theme: buildTheme(base) };
  }

  window.ThemeUtil = { buildTheme, baseFromTheme, autoTheme, DEFAULT_BASE };
})();
