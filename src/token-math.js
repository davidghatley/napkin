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
export const tokenColor = v => parseColor(NAMED[String(v).toLowerCase()] ?? v);
const lab = c => { const p = c.oklch ?? toOklch(c), h = p.h * Math.PI / 180; return [p.l, p.c * Math.cos(h), p.c * Math.sin(h)]; };
function distance(a, b, type) {
  if (type === 'color') {
    const A = tokenColor(a), B = tokenColor(b); if (!A || !B) return Infinity;
    const x = lab(A), y = lab(B); return Math.hypot(...x.map((v, i) => v - y[i]));
  }
  const A = length(a), B = length(b); return A === null || B === null ? Infinity : Math.abs(A - B);
}
export function nearestToken(tokens, prop, value, mode = 'light') {
  const type = tokenFamily(prop);
  return familyTokens(tokens, prop).map(t => ({ t, d: distance(value, tokenValue(t, mode), type) })).filter(x => Number.isFinite(x.d)).sort((a, b) => a.d - b.d)[0]?.t ?? null;
}
export function offToken(tokens, prop, value, mode = 'light') {
  if (value == null || value === '' || !familyTokens(tokens, prop).length) return false;
  if (tokenName(value)) return !tokens.some(t => t.name === tokenName(value));
  const type = tokenFamily(prop);
  const values = type === 'color' ? [value] : String(value).split(/\s+/);
  // Only literal values are judged; CSS keywords and expressions have no numerical nearest.
  return values.some(v => {
    const nearest = nearestToken(tokens, prop, v, mode);
    return nearest && (distance(v, tokenValue(nearest, mode), type) > 0.00001 || type === 'color' && Math.abs(tokenColor(v).a - tokenColor(tokenValue(nearest, mode)).a) > 0.00001);
  });
}
export function snapValue(tokens, prop, value, mode = 'light') {
  const parts = tokenFamily(prop) === 'color' ? [value] : String(value).split(/\s+/);
  return parts.map(v => { const t = nearestToken(tokens, prop, v, mode); return t ? `var(--${t.name})` : String(v); }).join(' ');
}
