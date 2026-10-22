// Shared by the panel and tests. Distances are in OKLab, not RGB or polar OKLCH.
import { parseColor, toOklch } from './color.js';
export const tokenName = value => /^var\(\s*--([\w-]+)\s*\)$/.exec(String(value))?.[1];
export function tokenFamily(prop) {
  if (/^(background|backgroundColor|color|borderColor|outlineColor|fill|stroke)$/.test(prop)) return 'color';
  if (/radius/i.test(prop)) return 'radius';
  if (prop === 'fontSize') return 'fontSize';
  if (/^(padding|margin|gap|rowGap|columnGap)/.test(prop)) return 'spacing';
  return null;
}
export const familyTokens = (tokens, prop) => tokens.filter(t => t.type === tokenFamily(prop));
export const tokenValue = (t, mode) => t?.resolved?.[mode] ?? t?.values?.[mode] ?? t?.values?.light;
const length = v => { const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(String(v).trim()); return m ? Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1) : null; };
const NAMED = { black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff', maroon: '#800000', red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00', navy: '#000080', blue: '#0000ff', teal: '#008080', aqua: '#00ffff', orange: '#ffa500', rebeccapurple: '#663399', transparent: '#00000000' };
export const tokenColor = v => parseColor(NAMED[String(v).trim().toLowerCase()] ?? v);
const lab = c => { const p = c.oklch ?? toOklch(c), h = p.h * Math.PI / 180; return [p.l, p.c * Math.cos(h), p.c * Math.sin(h)]; };
function distance(a, b, type) {
  if (type === 'color') {
    const A = tokenColor(a), B = tokenColor(b); if (!A || !B) return Infinity;
    const x = lab(A), y = lab(B); return Math.hypot(...x.map((v, i) => v - y[i]), A.a - B.a);
  }
  const A = length(a), B = length(b); return A === null || B === null ? Infinity : Math.abs(A - B);
}
// 0.10 on the 0..1 OKLab scale allows a modest colour adjustment. Larger
// changes (including opacity changes) require an explicit choice from the person.
export const MAX_COLOR_SNAP_DISTANCE = 0.10;
export function nearestTokens(tokens, prop, value, mode = 'light', limit = 3) {
  const type = tokenFamily(prop);
  return familyTokens(tokens, prop).map(t => ({ token: t, distance: distance(value, tokenValue(t, mode), type) }))
    .filter(x => Number.isFinite(x.distance)).sort((a, b) => a.distance - b.distance).slice(0, limit);
}
export function nearestToken(tokens, prop, value, mode = 'light') {
  return nearestTokens(tokens, prop, value, mode, 1)[0]?.token ?? null;
}
// A function is a CSS expression, not a literal. Do not split its arguments or
// accidentally turn a unitless zero inside calc()/var() into a spacing token.
const expression = value => /[a-z-]+\(/i.test(String(value));
const partsOf = (prop, value) => tokenFamily(prop) === 'color' ? [value] : String(value).trim().split(/\s+/);
const literal = (type, value) => type === 'color' ? !!tokenColor(value) : length(value) !== null && length(value) !== 0;
export function offToken(tokens, prop, value, mode = 'light') {
  if (value == null || value === '' || !familyTokens(tokens, prop).length) return false;
  const type = tokenFamily(prop);
  if ((type !== 'color' && expression(value)) || /\bvar\(/i.test(String(value))) return false;
  return partsOf(prop, value).some(v => {
    if (!literal(type, v)) return false;
    const nearest = nearestTokens(tokens, prop, v, mode, 1)[0];
    return !!nearest && nearest.distance > 0.00001;
  });
}
export function snapValue(tokens, prop, value, mode = 'light') {
  const type = tokenFamily(prop);
  if ((type !== 'color' && expression(value)) || /\bvar\(/i.test(String(value))) return String(value);
  return partsOf(prop, value).map(v => {
    if (!literal(type, v)) return String(v);
    const nearest = nearestTokens(tokens, prop, v, mode, 1)[0];
    if (!nearest || type === 'color' && nearest.distance > MAX_COLOR_SNAP_DISTANCE) return String(v);
    return `var(--${nearest.token.name})`;
  }).join(' ');
}
