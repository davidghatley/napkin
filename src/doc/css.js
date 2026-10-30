// CSS source map (decision 0014). Records where every rule, declaration and at-rule of a stylesheet is, by byte
// offset, without normalising anything: comments, odd spacing, missing semicolons and alignment survive because edits
// only ever splice the bytes of one value (src/doc/edit.js).
//   parseCss(s, from = 0, to = s.length) -> { rules, imports, fontFaces }   (s is latin1; offsets are into s)
// rule: { kind: 'style'|'keyframe'|'font-face'|'page'|'property', selector, selStart, selEnd, open, close, context, decls, parent }
//   context: the enclosing at-rule preludes, outermost first ([{ name: 'media', prelude: '(max-width: 600px)' }])
//   close: the index of the closing '}' (or the end of the sheet when it is missing)
// decl: { prop, lprop, start, colon, valStart, valEnd, value, important, end, semi }
//   valStart..valEnd is the value alone (no surrounding space or comments, no !important); end is just past the ';'
//   when there is one, else just past the value (or !important); semi is the ';' index or -1.
// import: { url, start, end, prelude, media }

const NESTING_AT = new Set(['media', 'supports', 'container', 'layer', 'document', '-moz-document', 'scope', 'starting-style']);
const DECL_AT = new Set(['font-face', 'page', 'property', 'counter-style', 'font-palette-values', 'view-transition', 'position-try']);

// Skip a comment or string at i; returns the index after it, or i when there is none.
function skipToken(s, i, end) {
  const ch = s[i];
  if (ch === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); return e < 0 || e >= end ? end : e + 2; }
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    while (j < end && s[j] !== ch && s[j] !== '\n') { if (s[j] === '\\') j++; j++; }
    return Math.min(j + 1, end);
  }
  return i;
}
// The first of `stops` at nesting depth 0 from i (skipping comments, strings and (...) [...] groups), or end.
function scanTo(s, i, end, stops) {
  let depth = 0;
  while (i < end) {
    const j = skipToken(s, i, end);
    if (j !== i) { i = j; continue; }
    const ch = s[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && stops.includes(ch)) return i;
    i++;
  }
  return end;
}
// Skip whitespace and comments forwards.
function skipWsC(s, i, end) {
  for (;;) {
    while (i < end && /\s/.test(s[i])) i++;
    if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 || e >= end ? end : e + 2; continue; }
    return i;
  }
}
// Trim whitespace and comments backwards from b (exclusive) down to a.
function trimBackWsC(s, a, b) {
  for (;;) {
    while (b > a && /\s/.test(s[b - 1])) b--;
    if (b - 2 >= a && s[b - 1] === '/' && s[b - 2] === '*') {
      const open = s.lastIndexOf('/*', b - 3);
      if (open >= a) { b = open; continue; }
    }
    return b;
  }
}
// Matching '}' for the '{' at `open`.
function blockEnd(s, open, end) {
  let depth = 0, i = open;
  while (i < end) {
    const j = skipToken(s, i, end);
    if (j !== i) { i = j; continue; }
    const ch = s[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return end;
}
export const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ');
// One way to write a selector or prelude for comparison: comments out, whitespace collapsed, none around , > + ~.
export const normSelector = (t) => stripComments(String(t)).replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim();
export const normPrelude = (t) => stripComments(String(t)).replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*:\s*/g, ': ').trim().toLowerCase();

function parseDecl(s, a, b) {
  const colon = scanTo(s, a, b, [':']);
  if (colon >= b) return null;
  const pStart = skipWsC(s, a, colon), pEnd = trimBackWsC(s, pStart, colon);
  const prop = s.slice(pStart, pEnd);
  if (!prop || /[\s{}]/.test(prop)) return null;
  const valStart = skipWsC(s, colon + 1, b);
  let valEnd = trimBackWsC(s, valStart, b), important = false;
  const bang = /!\s*important$/i.exec(s.slice(valStart, valEnd));
  if (bang) { important = true; valEnd = trimBackWsC(s, valStart, valStart + bang.index); }
  return { prop, lprop: prop.startsWith('--') ? prop : prop.toLowerCase(), start: pStart, colon, valStart, valEnd: Math.max(valEnd, valStart), value: s.slice(valStart, Math.max(valEnd, valStart)), important };
}

export function parseCss(s, from = 0, to = s.length) {
  const rules = [], imports = [], fontFaces = [];
  // Declarations (and nested rules) of a block whose content is [a, b).
  const declBlock = (a, b, rule, context) => {
    let i = a;
    while (i < b) {
      i = skipWsC(s, i, b);
      if (i >= b) break;
      if (s[i] === ';') { i++; continue; }
      const stop = scanTo(s, i, b, [';', '{', '}']);
      if (s[stop] === '{') { // a nested rule (CSS nesting) or a nested at-rule
        const close = blockEnd(s, stop, b);
        if (s[i] === '@') atRule(i, stop, close, context, rule);
        else styleRule(i, stop, close, context, rule);
        i = close + 1; continue;
      }
      const d = parseDecl(s, i, stop);
      if (d) {
        const semi = s[stop] === ';' && stop < b ? stop : -1;
        d.semi = semi;
        d.end = semi >= 0 ? semi + 1 : trimBackWsC(s, i, stop);
        rule.decls.push(d);
      }
      i = stop < b && s[stop] === ';' ? stop + 1 : stop;
      if (s[stop] === '}') i = stop + 1;
    }
  };
  const styleRule = (a, open, close, context, parent = null) => {
    const selStart = skipWsC(s, a, open), selEnd = trimBackWsC(s, selStart, open);
    const inKeyframes = context.some((c) => /keyframes$/.test(c.name));
    const rule = { kind: inKeyframes ? 'keyframe' : 'style', selector: s.slice(selStart, selEnd), selStart, selEnd, open, close, context, decls: [], parent };
    rules.push(rule);
    declBlock(open + 1, close, rule, context);
    return rule;
  };
  const atRule = (a, open, close, context, parent = null) => {
    const m = /^@([\w-]+)/.exec(s.slice(a, a + 64));
    const name = m ? m[1].toLowerCase() : '';
    const pStart = skipWsC(s, a + (m ? m[0].length : 1), open), pEnd = trimBackWsC(s, pStart, open);
    const prelude = s.slice(pStart, pEnd);
    if (NESTING_AT.has(name) || /keyframes$/.test(name)) block(open + 1, close, [...context, { name, prelude, start: a, open }], parent);
    else if (DECL_AT.has(name)) {
      const rule = { kind: name, selector: '@' + name + (prelude ? ' ' + prelude : ''), selStart: a, selEnd: pEnd, open, close, context, decls: [], parent };
      rules.push(rule); if (name === 'font-face') fontFaces.push(rule);
      declBlock(open + 1, close, rule, context);
    }
  };
  const block = (a, b, context, parent = null) => {
    let i = a;
    while (i < b) {
      i = skipWsC(s, i, b);
      if (i >= b) break;
      const ch = s[i];
      if (ch === ';' || ch === '}') { i++; continue; }
      if (s.startsWith('<!--', i)) { i += 4; continue; }
      if (s.startsWith('-->', i)) { i += 3; continue; }
      const stop = scanTo(s, i, b, [';', '{', '}']);
      if (ch === '@' && (stop >= b || s[stop] !== '{')) { // a statement at-rule: @import, @charset, @layer a, b;
        const m = /^@([\w-]+)/.exec(s.slice(i, i + 64));
        if (m && m[1].toLowerCase() === 'import') {
          const pStart = skipWsC(s, i + m[0].length, stop), pEnd = trimBackWsC(s, pStart, stop);
          const prelude = s.slice(pStart, pEnd);
          const u = /^(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*([\s\S]*)$/i.exec(prelude);
          if (u) imports.push({ url: u[1] ?? u[2] ?? u[3] ?? u[4] ?? u[5], start: i, end: stop < b ? stop + 1 : stop, prelude, media: (u[6] || '').trim(), context });
        }
        i = stop + 1; continue;
      }
      if (stop >= b || s[stop] !== '{') { i = stop + 1; continue; } // garbage: skip it, as a browser does
      const close = blockEnd(s, stop, b);
      if (ch === '@') atRule(i, stop, close, context, parent);
      else styleRule(i, stop, close, context, parent);
      i = close + 1;
    }
  };
  block(from, to, []);
  return { rules, imports, fontFaces };
}

// Custom properties a stylesheet text uses through var(): [{ name, fallback: bool, at }].
export function varUses(text, base = 0) {
  const out = [];
  const t = stripCommentsKeep(text);
  for (const m of t.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) out.push({ name: m[1], fallback: !!m[2], at: base + m.index });
  return out;
}
// Comments blanked with spaces (offsets stay the same).
export const stripCommentsKeep = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));

// Selector specificity [ids, classes/attributes/pseudo-classes, types/pseudo-elements] of one complex selector (no
// commas), as the cascade computes it: :is()/:not()/:has() take their most specific argument, :where() counts nothing,
// :nth-child(... of S) adds S, and the universal selector and combinators count nothing.
export function splitList(sel) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of sel) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export function specificity(sel) {
  const s = stripComments(sel);
  let a = 0, b = 0, c = 0, i = 0;
  const add = (x) => { a += x[0]; b += x[1]; c += x[2]; };
  const max = (list) => splitList(list).map(specificity).reduce((m, x) => (cmpSpec(x, m) > 0 ? x : m), [0, 0, 0]);
  const args = (from) => { let depth = 1, j = from; while (j < s.length && depth) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; } return [s.slice(from, j - 1), j]; };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { a++; i++; while (i < s.length && /[\w-]|\\/.test(s[i])) i++; continue; }
    if (ch === '.') { b++; i++; while (i < s.length && /[\w-]|\\/.test(s[i])) i++; continue; }
    if (ch === '[') { b++; while (i < s.length && s[i] !== ']') i++; i++; continue; }
    if (ch === ':') {
      if (s[i + 1] === ':') { c++; i += 2; while (i < s.length && /[\w-]/.test(s[i])) i++; if (s[i] === '(') i = args(i + 1)[1]; continue; }
      i++; let name = ''; while (i < s.length && /[\w-]/.test(s[i])) name += s[i++];
      name = name.toLowerCase();
      if (['before', 'after', 'first-line', 'first-letter'].includes(name)) { c++; continue; } // legacy one-colon pseudo-elements
      if (s[i] === '(') {
        const [inner, next] = args(i + 1); i = next;
        if (name === 'where') continue;
        if (['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any'].includes(name)) { add(max(inner)); continue; }
        if (/^nth-(last-)?child$/.test(name)) { b++; const of = /\sof\s+([\s\S]+)$/i.exec(inner); if (of) add(max(of[1])); continue; }
        b++; continue;
      }
      b++; continue;
    }
    if (/[A-Za-z_]/.test(ch)) { // a type selector (a namespace prefix before | counts nothing)
      while (i < s.length && /[\w-]/.test(s[i])) i++;
      if (!(s[i] === '|' && s[i + 1] !== '=')) c++;
      continue;
    }
    i++;
  }
  return [a, b, c];
}
export const cmpSpec = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
