// The inspector's pure parts: colour and length parsing, the folder's variables sorted into swatch, scale and type
// strips, off-scale detection with the nearest variable, scope edits and the one-line diff they will make, and the
// WCAG contrast ratio. No DOM and no imports, so tests run it in Node and the canvas runs the same code.

// ---------- colour ----------
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0], red: [255, 0, 0, 1], blue: [0, 0, 255, 1], green: [0, 128, 0, 1], gray: [128, 128, 128, 1], grey: [128, 128, 128, 1], navy: [0, 0, 128, 1], orange: [255, 165, 0, 1], yellow: [255, 255, 0, 1] };
export function parseColor(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (NAMED[t]) return [...NAMED[t]];
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? Math.round(parseInt(h.slice(6, 8), 16) / 2.55) / 100 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) { const c = (v, p) => Math.round(p ? parseFloat(v) * 2.55 : parseFloat(v)); return [c(m[1], m[2]), c(m[3], m[4]), c(m[5], m[6]), m[7] === undefined ? 1 : m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7])]; }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) {
    const h = (parseFloat(m[1]) % 360) / 360, s = parseFloat(m[2]) / 100, l = parseFloat(m[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255), m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4])];
  }
  return null;
}
export const hex = ([r, g, b, a = 1]) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : ''}`;
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
// WCAG 2 contrast ratio of two opaque colours (alpha is composited over `under` first when it is given).
export function contrast(fg, bg, under = [255, 255, 255, 1]) {
  const over = (top, base) => { const a = top[3] ?? 1; return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1]; };
  const b = over(bg, under), f = over(fg, b);
  const [l1, l2] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + Math.abs((a[3] ?? 1) - (b[3] ?? 1)) * 255;

// ---------- length ----------
export function parseLength(text) {
  const m = /^(-?[\d.]+)(px|rem|em)$/.exec(String(text ?? '').trim().toLowerCase());
  return m ? parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16) : null;
}

// ---------- which kind of value a property takes ----------
export function kindOfProp(prop) {
  const p = String(prop).toLowerCase();
  if (/^(color|background|background-color|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color)$/.test(p)) return 'color';
  if (/^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/.test(p) || /^(inset|top|right|bottom|left)$/.test(p)) return 'space';
  if (/^border(-(top|right|bottom|left|start-start|start-end|end-start|end-end))*-radius$/.test(p)) return 'radius';
  if (/^(font-size|line-height)$/.test(p)) return 'size';
  if (/^(font-family|font)$/.test(p)) return 'type';
  return null;
}
// The whitespace-separated pieces of a value, keeping var(...), rgb(...) and quotes whole.
export function tokens(value) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const c of String(value)) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') depth++; if (c === ')') depth--;
    if (/\s/.test(c) && !depth) { if (cur) out.push(cur); cur = ''; } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- the folder's variables as instruments ----------
// vars: { '--space-3': '12px', ... } (resolved values, for the current theme). Sorted into strips.
export function classify(vars) {
  const out = { color: [], space: [], radius: [], size: [], type: [], other: [] };
  for (const [name, value] of Object.entries(vars)) {
    const v = String(value).trim();
    if (!v) continue;
    const c = parseColor(v), px = parseLength(v);
    if (c) out.color.push({ name, value: v, rgba: c });
    else if (px !== null) {
      const kind = /radius|round|corner/i.test(name) ? 'radius' : /font|text|type|size|leading|line/i.test(name) && !/space|gap|pad|margin/i.test(name) ? 'size' : 'space';
      out[kind].push({ name, value: v, px });
    } else if (/font|type|family|face/i.test(name) || /^\s*(\d{3}\s+)?[\d.]+(px|rem)(\/[\d.]+(px|rem)?)?\s+\S/.test(v) || /["'][^"']+["']/.test(v) && /,/.test(v)) out.type.push({ name, value: v });
    else out.other.push({ name, value: v });
  }
  for (const k of ['space', 'radius', 'size']) out[k].sort((a, b) => a.px - b.px || a.name.localeCompare(b.name));
  return out;
}
const FAMILY = { space: /space|gap|pad|margin|unit|size/i, radius: /radius|round|corner/i, size: /size|text|type|font|leading|line/i };
// The folder variable closest to one raw token of `prop`, or null. { name, value, exact }.
export function nearest(prop, token, groups) {
  const kind = kindOfProp(prop);
  if (kind === 'color') {
    const c = parseColor(token); if (!c || !groups.color.length) return null;
    const best = groups.color.map((v) => ({ v, d: colorDistance(c, v.rgba) })).sort((a, b) => a.d - b.d || a.v.name.localeCompare(b.v.name))[0];
    return { name: best.v.name, value: best.v.value, exact: best.d < 0.5 };
  }
  if (kind === 'space' || kind === 'radius' || kind === 'size') {
    const px = parseLength(token); if (px === null) return null;
    const pool = groups[kind];
    if (!pool.length) return null;
    const best = pool.map((v) => ({ v, d: Math.abs(v.px - px) })).sort((a, b) => a.d - b.d || (FAMILY[kind].test(b.v.name) - FAMILY[kind].test(a.v.name)) || a.v.name.localeCompare(b.v.name))[0];
    return { name: best.v.name, value: best.v.value, exact: best.d < 0.01 };
  }
  return null;
}
// Off-scale pieces of a declared value: raw colours and lengths that are not one of the folder's variables.
export function offScale(prop, value, groups) {
  const kind = kindOfProp(prop);
  if (!kind || kind === 'type' || /var\(/.test(value)) return [];
  const out = [];
  for (const t of tokens(value)) {
    const raw = kind === 'color' ? parseColor(t) !== null && !/^(transparent|currentcolor)$/i.test(t) : /^-?[\d.]+(px|rem)$/i.test(t) && parseLength(t) !== 0;
    if (!raw) continue;
    const n = nearest(prop, t, groups);
    if (n) out.push({ token: t, ...n });
  }
  return out;
}
// A typed raw value that is exactly one folder variable (every raw piece is on the scale): its var() form, else null.
export function bindPieces(prop, typed, groups) {
  const out = [];
  for (const t of tokens(typed)) { const n = nearest(prop, t, groups); if (n?.exact && (kindOfProp(prop) === 'color' ? parseColor(t) : parseLength(t) !== null)) out.push({ raw: t, name: n.name }); }
  return out;
}
export function bindExact(prop, typed, groups) {
  const pieces = bindPieces(prop, typed, groups);
  return pieces.length ? tokens(typed).map((t) => { const p = pieces.find((x) => x.raw === t); return p ? `var(${p.name})` : t; }).join(' ') : null;
}

// ---------- the change an edit will make ----------
// decl text as the file would show it
export const declLine = (prop, value, important) => `${prop}: ${value}${important ? ' !important' : ''};`;
// The first custom property a value uses.
export const firstVar = (value) => /var\(\s*(--[\w-]+)/.exec(String(value))?.[1] ?? null;
// The rule a class-scope edit lands in: among the rules that reach the element, a plain `.class` rule (the one that
// already sets the property first), else null. matched: [{ rule, part }] weakest first.
export function classTarget(matched, prop, classes) {
  const plain = matched.filter((m) => /^\.[\w-]+$/.test(m.part) && classes.includes(m.part.slice(1)));
  const has = (m) => m.rule.decls.some((d) => d.prop.toLowerCase() === prop.toLowerCase());
  return plain.filter(has).at(-1) || plain.at(-1) || null;
}
