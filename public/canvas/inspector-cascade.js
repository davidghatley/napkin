// The cascade, worked out the way a browser does it, for one element (decision 0015). Pure: no DOM, no imports, so the
// same code runs in the canvas (matching with the frame's own element.matches) and on the server (matching with
// src/doc/select.js against the parsed file), and GET /api/component/<id>/rules?node= agrees with the inspector.
//
//   createCascade(rules, adapter, { width, height, dark, sheets }) -> { matched(el), explain(el), customValue(el, name), resolve(el, text) }
//   adapter: { matches(el, selector) -> bool, parent(el) -> el | null, inline(el) -> the style="" text, id(el) -> node id,
//              media?(prelude) -> bool (the canvas answers with matchMedia) }
//   rules: the `rules` of GET /api/component/<id>/rules ({ order, file, line, kind, selector, parts, media, sheet, decls })
//
// What it follows: a rule applies when its @media (and its sheet's media) hold and one selector of its list matches; per
// property the winner is chosen by importance (inline beats rules at the same importance), then specificity of the part
// that matched, then source order (a later declaration beats an earlier one). A custom property is inherited when nothing
// on the element sets it; var() is resolved on the element it is used on, with its fallback.
// What it does not: @layer order, @container, shorthand against longhand (padding vs padding-left), animations.

const PSEUDO_EL = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b/i;
const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

// ---------- @media ----------
const topSplit = (text, ch) => {
  const out = []; let depth = 0, cur = '';
  for (const c of text) { if (c === '(') depth++; if (c === ')') depth--; if (c === ch && !depth) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
};
const length = (v, env) => {
  const m = /^(-?[\d.]+)(px|em|rem|vw|vh)?$/.exec(String(v).trim());
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return m[2] === 'em' || m[2] === 'rem' ? n * 16 : m[2] === 'vw' ? n * env.width / 100 : m[2] === 'vh' ? n * env.height / 100 : n;
};
const compare = (a, op, b) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b);
const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };
function feature(f, env) {
  const t = f.trim().replace(/^\(|\)$/g, '').trim();
  const dim = (name) => (name === 'width' ? env.width : name === 'height' ? env.height : NaN);
  let m = /^(min-|max-)?(width|height)\s*:\s*(.+)$/.exec(t);
  if (m) { const v = length(m[3], env), a = dim(m[2]); return m[1] === 'min-' ? a >= v : m[1] === 'max-' ? a <= v : a === v; }
  m = /^(width|height)\s*(<=|>=|<|>|=)\s*(.+)$/.exec(t);
  if (m) return compare(dim(m[1]), m[2], length(m[3], env));
  m = /^(.+?)\s*(<=|>=|<|>|=)\s*(width|height)$/.exec(t);
  if (m) return compare(dim(m[3]), flip[m[2]], length(m[1], env));
  m = /^(.+?)\s*(<=|<)\s*(width|height)\s*(<=|<)\s*(.+)$/.exec(t);
  if (m) return compare(length(m[1], env), m[2], dim(m[3])) && compare(dim(m[3]), m[4], length(m[5], env));
  m = /^(.+?)\s*(>=|>)\s*(width|height)\s*(>=|>)\s*(.+)$/.exec(t);
  if (m) return compare(length(m[1], env), m[2], dim(m[3])) && compare(dim(m[3]), m[4], length(m[5], env));
  m = /^([\w-]+)\s*(?::\s*(.+))?$/.exec(t);
  if (!m) return false;
  const [, name, v] = m;
  switch (name) {
    case 'prefers-color-scheme': return v === (env.dark ? 'dark' : 'light');
    case 'prefers-reduced-motion': case 'prefers-contrast': case 'prefers-reduced-transparency': return v === 'no-preference' || v === undefined ? v === 'no-preference' : false;
    case 'hover': case 'any-hover': return v === undefined ? true : v === 'hover';
    case 'pointer': case 'any-pointer': return v === undefined ? true : v === 'fine';
    case 'orientation': return v === (env.height >= env.width ? 'portrait' : 'landscape');
    case 'color': return true;
    case 'forced-colors': return v === 'none';
    case 'display-mode': return v === 'browser';
    case 'scripting': return v === 'enabled';
    case 'min-resolution': case '-webkit-min-device-pixel-ratio': return parseFloat(v) <= 1;
    default: return false;
  }
}
export function mediaMatches(prelude, env = {}) {
  const e = { width: 1280, height: 800, dark: false, ...env };
  const q = String(prelude ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().toLowerCase();
  if (!q) return true;
  return topSplit(q, ',').some((one) => {
    let s = one.trim(), neg = false;
    if (s.startsWith('not ')) { neg = true; s = s.slice(4).trim(); }
    if (s.startsWith('only ')) s = s.slice(5).trim();
    const terms = s.split(/\s+and\s+(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
    const ok = terms.every((t) => (t.startsWith('(') ? feature(t, e) : t === 'all' || t === 'screen'));
    return neg ? !ok : ok;
  });
}

// ---------- declarations ----------
export function parseInline(text) {
  const out = []; let depth = 0, cur = '', q = null;
  const flush = () => {
    const i = cur.indexOf(':');
    if (i > 0) {
      let value = cur.slice(i + 1).trim(), important = false;
      const m = /\s*!\s*important\s*$/i.exec(value);
      if (m) { important = true; value = value.slice(0, m.index).trim(); }
      out.push({ prop: cur.slice(0, i).trim(), value, important });
    }
    cur = '';
  };
  for (const c of String(text ?? '')) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') depth++; if (c === ')') depth--;
    if (c === ';' && !depth) flush(); else cur += c;
  }
  flush();
  return out;
}
const sameProp = (a, b) => (a.startsWith('--') || b.startsWith('--') ? a === b : a.toLowerCase() === b.toLowerCase());

export function createCascade(rules, ad, opts = {}) {
  const env = { width: 1280, height: 800, dark: false, ...opts };
  const media = ad.media || ((p) => mediaMatches(p, env));
  const sheets = opts.sheets || [];
  const styleRules = rules.filter((r) => r.kind === 'style');
  const matchCache = new Map(), varCache = new Map(), inlineCache = new Map();

  const inlineOf = (el) => { let v = inlineCache.get(el); if (!v) { v = parseInline(ad.inline(el)); inlineCache.set(el, v); } return v; };
  // The rules that apply to el, weakest first: { rule, spec, part }.
  function matched(el) {
    let m = matchCache.get(el);
    if (m) return m;
    m = [];
    for (const r of styleRules) {
      const sm = sheets[r.sheet]?.media;
      if ((sm && !media(sm)) || !r.media.every(media)) continue;
      let best = null, part = null, real = false;
      for (const p of r.parts) if (ad.matches(el, p.selector)) { if (!PSEUDO_EL.test(p.selector)) real = true; if (!best || cmp(p.specificity, best) > 0) { best = p.specificity; part = p.selector; } }
      // a rule that only reaches a pseudo-element (::before, ::first-line) is listed with the element but styles another box
      if (best) m.push({ rule: r, spec: best, part, pseudo: !real });
    }
    m.sort((a, b) => cmp(a.spec, b.spec) || a.rule.order - b.rule.order);
    matchCache.set(el, m);
    return m;
  }
  // Every declaration of `prop` that reaches el, weakest first; the last one wins.
  function candidates(el, prop) {
    const out = [];
    for (const m of matched(el)) if (!m.pseudo) m.rule.decls.forEach((d, k) => { if (sameProp(d.prop, prop)) out.push({ kind: 'rule', rank: d.important ? 2 : 0, spec: m.spec, order: m.rule.order, k, d, m }); });
    inlineOf(el).forEach((d, k) => { if (sameProp(d.prop, prop)) out.push({ kind: 'inline', rank: d.important ? 3 : 1, spec: [0, 0, 0], order: Infinity, k, d }); });
    return out.sort((a, b) => a.rank - b.rank || (a.rank === 0 || a.rank === 2 ? cmp(a.spec, b.spec) : 0) || a.order - b.order || a.k - b.k);
  }
  const sourceOf = (c) => (c.kind === 'inline'
    ? { kind: 'inline' }
    : { kind: 'rule', order: c.m.rule.order, file: c.m.rule.file, line: c.m.rule.line, declLine: c.d.line, selector: c.m.rule.selector, part: c.m.part, specificity: c.m.spec, media: c.m.rule.media, important: !!c.d.important });

  // ---------- custom properties and var() ----------
  const topComma = (t) => { let d = 0; for (let i = 0; i < t.length; i++) { if (t[i] === '(') d++; else if (t[i] === ')') d--; else if (t[i] === ',' && !d) return i; } return -1; };
  function substitute(el, text, stack = []) {
    let out = '', i = 0, ok = true; const uses = [];
    while (i < text.length) {
      const j = text.indexOf('var(', i);
      if (j < 0) { out += text.slice(i); break; }
      if (/[\w-]/.test(text[j - 1] || '')) { out += text.slice(i, j + 4); i = j + 4; continue; }
      out += text.slice(i, j);
      let depth = 1, k = j + 4;
      while (k < text.length && depth) { if (text[k] === '(') depth++; else if (text[k] === ')') depth--; k++; }
      const inner = text.slice(j + 4, depth ? k : k - 1), c = topComma(inner);
      const name = (c < 0 ? inner : inner.slice(0, c)).trim(), fallback = c < 0 ? null : inner.slice(c + 1).trim();
      uses.push(name);
      const v = customValue(el, name, stack);
      if (v) out += v.value;
      else if (fallback !== null) { const f = substitute(el, fallback, stack); out += f.text; ok = ok && f.ok; }
      else { ok = false; out += text.slice(j, k); }
      i = k;
    }
    return { text: out, uses, ok };
  }
  // The value of a custom property on el: set there (cascade winner) or inherited. { value, raw, source, at, from }
  function customValue(el, name, stack = []) {
    const key = ad.id(el);
    let byEl = varCache.get(el); if (!byEl) varCache.set(el, byEl = new Map());
    if (byEl.has(name)) return byEl.get(name);
    const tag = `${key}|${name}`;
    if (stack.includes(tag)) return null; // a cycle: the property is invalid
    const c = candidates(el, name).at(-1);
    let v;
    if (c) {
      const s = substitute(el, c.d.value, [...stack, tag]);
      v = s.ok ? { value: s.text, raw: c.d.value, source: sourceOf(c), at: key, from: key } : null;
    } else { const p = ad.parent(el); v = p ? customValue(p, name, stack) : null; }
    if (!stack.length) byEl.set(name, v);
    return v;
  }
  const resolve = (el, text) => substitute(el, text);

  // ---------- the whole story of one element ----------
  function explain(el) {
    const props = new Map(); // prop key -> winner
    const all = [];          // every declaration reaching el, with its place
    const note = (c) => { all.push(c); };
    for (const m of matched(el)) if (!m.pseudo) m.rule.decls.forEach((d, k) => note({ kind: 'rule', m, d, k }));
    inlineOf(el).forEach((d, k) => note({ kind: 'inline', d, k }));
    const keyOf = (p) => (p.startsWith('--') ? p : p.toLowerCase());
    for (const c of all) { const key = keyOf(c.d.prop); if (!props.has(key)) props.set(key, candidates(el, c.d.prop).at(-1)); }
    const usedVars = new Set();
    const shape = (c) => {
      if (c.m?.pseudo) return { prop: c.d.prop, value: c.d.value, important: !!c.d.important, line: c.d.line, state: 'pseudo' };
      const winner = props.get(keyOf(c.d.prop));
      const applied = winner.d === c.d;
      const info = { prop: c.d.prop, value: c.d.value, important: !!c.d.important, ...(c.kind === 'rule' && { line: c.d.line }), state: applied ? 'applied' : 'overridden' };
      if (!applied) info.by = sourceOf(winner);
      if (/var\(/.test(c.d.value)) {
        const s = substitute(el, c.d.value);
        info.resolved = s.ok ? s.text : null;
        info.uses = s.uses.map((n) => { usedVars.add(n); return n; });
      }
      return info;
    };
    const rulesOut = matched(el).map((m) => ({ ...sourceOf({ kind: 'rule', m, d: { line: m.rule.line } }), decls: m.rule.decls.map((d, k) => shape({ kind: 'rule', m, d, k })) }));
    const inline = inlineOf(el).map((d, k) => shape({ kind: 'inline', d, k }));
    // custom properties in play: those used, those defined on the way, and what they use in turn
    const vars = {}; const queue = [...usedVars];
    while (queue.length) {
      const n = queue.shift();
      if (vars[n] !== undefined) continue;
      const v = customValue(el, n);
      vars[n] = v ? { value: v.value, raw: v.raw, source: v.source, at: v.at, inherited: v.at !== ad.id(el) } : null;
      if (v) for (const u of substitute(el, v.raw).uses) if (vars[u] === undefined) queue.push(u);
    }
    const winners = {};
    for (const [k, c] of props) { const s = c.d.value && /var\(/.test(c.d.value) ? substitute(el, c.d.value) : null; winners[k] = { value: c.d.value, ...(s && { resolved: s.ok ? s.text : null }), important: !!c.d.important, source: sourceOf(c) }; }
    return { rules: rulesOut, inline, props: winners, vars };
  }
  return { matched, candidates, explain, customValue, resolve, sourceOf };
}
