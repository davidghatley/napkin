// Colours for the panel's picker (LAY-08). Pure. A colour is { r, g, b, a } with r,g,b in 0..255 and a in 0..1.
// Values are written in the format the file already uses: hex stays hex, rgb() stays rgb(), oklch() stays oklch().
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; };
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

// srgb <-> oklab (Bjorn Ottosson)
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function toOklch({ r, g, b }) {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, Bb);
  return { l: L, c: C, h: C < 1e-4 ? 0 : ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360 };
}
export function fromOklch(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3, m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const G = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const B = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return { r: clamp(gam(clamp(R, 0, 1)), 0, 255), g: clamp(gam(clamp(G, 0, 1)), 0, 255), b: clamp(gam(clamp(B, 0, 1)), 0, 255) };
}
export function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}
export function fromHsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}
export const toHsv = ({ r, g, b }) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; const h = toHsl({ r: r * 255, g: g * 255, b: b * 255 }).h; return { h, s: mx === 0 ? 0 : d / mx, v: mx }; };
export const fromHsv = (h, s, v) => { const l = v * (1 - s / 2), sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l); return fromHsl(h, sl * 100, l * 100); };

const NUM = '(-?\\d*\\.?\\d+)(%|deg)?';
const FN = /^(rgba?|hsla?|oklch)\(\s*([^)]*)\)$/i;
// "#abc", "#aabbcc", "#aabbccdd", "rgb(1, 2, 3)", "rgb(1 2 3 / 50%)", "hsl(...)", "oklch(0.7 0.1 200 / .5)" -> { r, g, b, a, space } | null
export function parseColor(text) {
  const t = String(text ?? '').trim();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1, aRaw: h.length === 8 ? h.slice(6) : undefined, space: 'hex', short: m[1].length <= 4, upper: /[A-F]/.test(m[1]) };
  }
  m = FN.exec(t);
  if (!m) return null;
  const fn = m[1].toLowerCase(), body = m[2].replace(/\s*\/\s*/, ' / ');
  const [main, alpha] = body.split(' / ');
  const parts = main.split(/[\s,]+/).filter(Boolean);
  let aRaw = alpha;
  if (!alpha && parts.length === 4) aRaw = parts.pop();
  const re = new RegExp(`^${NUM}$`);
  const n = parts.map((p) => re.exec(p));
  if (n.length !== 3 || n.some((x) => !x)) return null;
  const v = n.map((x) => Number(x[1])), unit = n.map((x) => x[2]);
  let a = 1, rawA;
  if (aRaw !== undefined) { const am = re.exec(aRaw.trim()); if (!am) return null; a = am[2] === '%' ? Number(am[1]) / 100 : Number(am[1]); rawA = aRaw.trim(); }
  a = clamp(a, 0, 1); // exact: the alpha you wrote is kept as you wrote it until you change it
  const legacy = !/\s/.test(main.trim()) || /,/.test(main);
  if (fn.startsWith('rgb')) return { r: clamp(unit[0] === '%' ? v[0] * 2.55 : v[0], 0, 255), g: clamp(unit[1] === '%' ? v[1] * 2.55 : v[1], 0, 255), b: clamp(unit[2] === '%' ? v[2] * 2.55 : v[2], 0, 255), a, aRaw: rawA, space: 'rgb', legacy, fn };
  if (fn.startsWith('hsl')) return { ...fromHsl(v[0], v[1], v[2]), a, aRaw: rawA, space: 'hsl', legacy, fn };
  return { ...fromOklch(unit[0] === '%' ? v[0] / 100 : v[0], v[1], v[2]), a, aRaw: rawA, space: 'oklch', oklch: { l: unit[0] === '%' ? v[0] / 100 : v[0], c: v[1], h: v[2] } };
}
// Colour -> text in `space` ('hex' | 'rgb' | 'hsl' | 'oklch'). `like` (a parsed colour) keeps small habits: rgba() vs rgb(), commas vs spaces, upper-case hex.
export function formatColor(c, space = 'hex', like = {}) {
  // The alpha you did not touch is written exactly as you wrote it; a changed alpha gets two decimals (0.25, never 0.251).
  const raw = like.space === space && like.aRaw !== undefined && c.a === like.a;
  const a = round(c.a ?? 1, 2), hasA = raw || a < 1;
  if (space === 'hex') {
    const body = hex2(c.r) + hex2(c.g) + hex2(c.b) + (hasA ? (raw ? like.aRaw : hex2(a * 255)) : '');
    return '#' + (like.upper ? body.toUpperCase() : body);
  }
  const at = raw ? like.aRaw : String(a);
  if (space === 'rgb') {
    const [r, g, b] = [c.r, c.g, c.b].map((x) => Math.round(x));
    if (like.legacy === false) return `rgb(${r} ${g} ${b}${hasA ? ` / ${at}` : ''})`;
    return hasA ? `rgba(${r}, ${g}, ${b}, ${at})` : `rgb(${r}, ${g}, ${b})`;
  }
  if (space === 'hsl') { const h = toHsl(c); return `hsl(${Math.round(h.h)} ${Math.round(h.s)}% ${Math.round(h.l)}%${hasA ? ` / ${at}` : ''})`; }
  const o = c.oklch && Math.abs(c.oklch.l - toOklch(c).l) < 0.002 ? c.oklch : toOklch(c);
  return `oklch(${round(o.l, 3)} ${round(o.c, 3)} ${round(o.h, 1)}${hasA ? ` / ${at}` : ''})`;
}
const IN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^)]*\)/gi;
// Every colour written in a piece of CSS (a border or shadow value has one inside it).
export const colorsIn = (css) => String(css ?? '').match(IN) ?? [];
// The colour format a component's styles use most (hex when it has none): new colours follow it.
export function fileSpace(doc) {
  const count = { hex: 0, rgb: 0, hsl: 0, oklch: 0 };
  const walk = (n) => { for (const v of Object.values(n.style || {})) for (const c of colorsIn(v)) { const p = parseColor(c); if (p) count[p.space]++; } n.children?.forEach(walk); };
  walk(doc.root);
  for (const vals of Object.values(doc.variants || {})) for (const nodes of Object.values(vals)) for (const st of Object.values(nodes)) for (const v of Object.values(st)) for (const c of colorsIn(v)) { const p = parseColor(c); if (p) count[p.space]++; }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(count).sort((a, b) => b[1] - a[1])[0][0] : 'hex';
}
// The colours of a component (for the picker's "in this file" row), most used first.
export function documentColors(doc, limit = 12) {
  const seen = new Map();
  const add = (v) => { for (const c of colorsIn(v)) { const k = c.toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1); } };
  const walk = (n) => { Object.values(n.style || {}).forEach(add); n.children?.forEach(walk); };
  walk(doc.root);
  return [...seen].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}
