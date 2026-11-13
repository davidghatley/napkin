// The one edit path (decision 0014). Every contract op, on HTML, CSS or TSX, becomes a few byte splices in one file:
// only the bytes the op is about change, and the surrounding formatting (quote style, spacing, comments, line endings,
// indentation) is read from the file and mirrored in anything new. A spot that cannot be written as text is refused on
// its own, with the reason (EditRefused); the rest of the file stays editable.
//   planNodeEdit(s, node, edit, { jsx, eol }) -> splices          text | inner | attr | prop | class | style | delete
//     inner: an HTML element's content replaced with markup (formatted text from the canvas: text, <br>, <strong>, <em>, <u>)
//   planInsert(s, parent, index, text, { jsx }) -> splices          insert (text is HTML, or JSX for TSX files)
//   planMove(s, node, parent, index, { jsx }) -> splices
//   planRule(s, sheets, edit) -> { splices, rule }                    rule (selector + prop) in one file's stylesheets
//   planVar(s, sheets, edit) -> { splices, decl }                     var (a custom property definition)
// s is the file as latin1; edit values arrive as UTF-8 strings and are converted here.
import { toL, wsBack, wsFwd, indentAt, isWs, lineOf, fromL } from './source.js';
import { parseCss, normSelector, normPrelude } from './css.js';

export class EditRefused extends Error {
  constructor(message, status = 422, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const refuse = (msg, status, extra) => { throw new EditRefused(msg, status, extra); };
const at = (s, i) => `line ${lineOf(s, i)}`;

// ---------- escaping ----------
const escText = (v) => v.replace(/&(?=#?\w+;?)/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (v, q) => v.replace(/&(?=(#\d+;?|#x[0-9a-f]+;?|[a-z][a-z0-9]*;))/gi, '&amp;').replace(q === "'" ? /'/g : /"/g, q === "'" ? '&#39;' : '&quot;');
const jsonL = (v) => toL(JSON.stringify(fromL(v))); // a JS string literal of latin1 text, as latin1
const jsxText = (v) => (/[{}<>]/.test(v) || /^\s|\s$/.test(v) ? `{${jsonL(v)}}` : v);
const UNQUOTED = /^[^\s"'=<>`]+$/;

// ---------- start-tag helpers ----------
const attrOf = (node, name) => {
  const ln = node.jsx ? name : name.toLowerCase();
  for (let k = node.attrs.length - 1; k >= 0; k--) { const a = node.attrs[k]; if (!a.spread && (node.jsx ? a.name === ln : a.lname === ln)) return a; }
  return null;
};
// Where a new attribute goes: right after the last attribute (or the tag name), before any space and the closing > or />.
function attrSlot(s, node) {
  let close = node.openEnd - 1;
  if (s[close - 1] === '/') close--;
  const nameEnd = node.start + 1 + String(node.tag).length;
  return Math.max(wsBack(s, close), nameEnd);
}
// Where and how a new attribute goes: at the end of the tag (so after a {...props} spread, where it wins). When the tag's attributes each sit on their
// own line, the new one gets its own line with the same indent; otherwise it follows the last one on the line.
function newAttr(s, node, text) {
  const last = node.attrs?.[node.attrs.length - 1];
  if (last) {
    const gap = s.slice(wsBack(s, last.start), last.start);
    if (gap.includes('\n')) return [{ from: last.end, to: last.end, text: `\n${gap.slice(gap.lastIndexOf('\n') + 1)}${text}` }];
  }
  const at = attrSlot(s, node);
  return [{ from: at, to: at, text: ` ${text}` }];
}
function setAttr(s, node, name, value) {
  const a = attrOf(node, name);
  if (node.jsx) {
    if (a && a.quote && !value.includes(a.quote) && !/[\r\n]/.test(value)) return [{ from: a.valStart, to: a.valEnd, text: value }];
    const lit = !value.includes('"') ? `"${value}"` : `{${jsonL(value)}}`;
    if (a && a.valStart !== null) return [{ from: a.valStart - (a.quote ? 1 : 0), to: a.valEnd + (a.quote ? 1 : 0), text: lit }];
    if (a) return [{ from: a.end, to: a.end, text: '=' + lit }];
    return newAttr(s, node, `${name}=${lit}`);
  }
  if (a && a.quote) return [{ from: a.valStart, to: a.valEnd, text: escAttr(value, a.quote) }];
  if (a && a.valStart !== null) return [{ from: a.valStart, to: a.valEnd, text: UNQUOTED.test(value) ? value : `"${escAttr(value, '"')}"` }];
  if (a) return [{ from: a.end, to: a.end, text: `="${escAttr(value, '"')}"` }];
  return newAttr(s, node, `${name}="${escAttr(value, '"')}"`);
}
function removeAttr(s, node, name) {
  const a = attrOf(node, name);
  if (!a) return [];
  // the attribute and the space before it; when it sat between two attributes, the space after it stays
  return [{ from: wsBack(s, a.start), to: a.end, text: '' }];
}

// ---------- text ----------
// The text runs directly inside an element, in order, each with its span and whether it can be written as text:
// HTML text between child elements (comments split a run), JSX text, and JSX strings written as {"..."}; a computed
// {expression} is listed but cannot be edited as text. Runs that are only whitespace are left out.
// [{ index, from, to, text (latin1, as written), editable, kind, quote? }]   from..to is the run without its outer spaces
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
export const decodeText = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
export function runsOf(s, node) {
  const raw = [];
  if (node.jsx) for (const r of node.jsxRuns || []) raw.push(r.kind === 'text' ? { from: r.start, to: r.end, kind: 'text' } : r.kind === 'string' ? { from: r.valStart, to: r.valEnd, kind: 'string', quote: r.quote, outer: [r.start, r.end] } : { from: r.start, to: r.end, kind: 'computed' });
  else if (!node.selfClosing && node.closeStart > node.openEnd && !['script', 'style'].includes(node.name)) {
    const cuts = node.children.map((c) => [c.start, c.end]);
    for (let i = s.indexOf('<!--', node.openEnd); i >= 0 && i < node.closeStart; i = s.indexOf('<!--', i + 4)) { const e = s.indexOf('-->', i); if (!cuts.some(([a, b]) => i >= a && i < b)) cuts.push([i, e < 0 ? node.closeStart : e + 3]); }
    cuts.sort((a, b) => a[0] - b[0]);
    let p = node.openEnd;
    for (const [a, b] of [...cuts, [node.closeStart, node.closeStart]]) { if (a > p) raw.push({ from: p, to: a, kind: 'text' }); p = Math.max(p, b); }
  }
  const out = [];
  for (const r of raw) {
    let { from, to } = r;
    if (r.kind === 'text') { while (from < to && /[ \t\r\n\f]/.test(s[from])) from++; while (to > from && /[ \t\r\n\f]/.test(s[to - 1])) to--; if (from === to) continue; }
    out.push({ ...r, from, to, index: out.length, text: s.slice(from, to), editable: r.kind !== 'computed' });
  }
  return out;
}
function textSplices(s, node, value, run) {
  if (node.jsx && !node.textOnly || !node.jsx && node.children.length || run !== undefined && run !== null) {
    if (!node.jsx && ['script', 'style'].includes(node.name)) refuse(`<${node.tag}> (${at(s, node.start)}) holds code, not text; edit its rules or the file instead`);
    const runs = runsOf(s, node);
    let r;
    if (run !== undefined && run !== null) {
      if (!Number.isInteger(run) || !runs[run]) refuse(`<${node.tag}> (${at(s, node.start)}) has no text run ${run} (it has ${runs.length})`, 404);
      r = runs[run];
    } else {
      const editable = runs.filter((x) => x.editable);
      if (!runs.length) refuse(`<${node.tag}> (${at(s, node.start)}) holds no text of its own; edit the text of one of its elements`);
      if (editable.length !== 1) refuse(`<${node.tag}> (${at(s, node.start)}) holds ${runs.length} text runs between its elements; send run (0-${Math.max(0, runs.length - 1)}) to choose one`, 409, { runs: runs.map((x) => ({ index: x.index, text: fromL(x.text), editable: x.editable })) });
      r = editable[0];
    }
    if (!r.editable) refuse(`text run ${r.index} of <${node.tag}> (${at(s, node.start)}) is computed in code (${s.slice(r.from, Math.min(r.to, r.from + 40))}); change it in the code`);
    const v = toL(value);
    if (r.kind === 'string') { // keep the string's own quotes: escape only what that quote needs
      const esc = v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
      return [{ from: r.from, to: r.to, text: r.quote === '`' ? esc.replace(/`|\$\{/g, (c) => '\\' + c) : esc.split(r.quote).join('\\' + r.quote) }];
    }
    return [{ from: r.from, to: r.to, text: node.jsx ? jsxText(v) : escText(v) }];
  }
  if (node.selfClosing || node.openEnd === node.closeStart && node.end === node.openEnd) refuse(`<${node.tag}> (${at(s, node.start)}) has no content to hold text`);
  if (!node.jsx && ['script', 'style'].includes(node.name)) refuse(`<${node.tag}> (${at(s, node.start)}) holds code, not text; edit its rules or the file instead`);
  if (node.jsx ? !node.textOnly : node.children.length) refuse(`<${node.tag}> (${at(s, node.start)}) holds ${node.jsx ? 'elements or {…} expressions' : 'other elements'}; edit the text of one of them instead`);
  const a = node.openEnd, b = node.closeStart, inner = s.slice(a, b);
  const lead = inner.length - inner.replace(/^[ \t\r\n\f]+/, '').length, trail = inner.length - inner.replace(/[ \t\r\n\f]+$/, '').length;
  const v = toL(value);
  const text = node.jsx ? jsxText(v) : escText(v);
  if (lead + trail >= inner.length) return [{ from: a, to: b, text }];
  return [{ from: a + lead, to: b - trail, text }];
}

// The whole content of an HTML element, replaced with markup (the canvas's text editor sends text with inline formatting).
// The whitespace the file had just inside the tags stays as it was.
function innerSplices(s, node, html) {
  if (node.jsx) refuse(`<${node.tag}> (${at(s, node.start)}) is JSX; edit its text with op text`);
  if (node.selfClosing || node.openEnd === node.closeStart && node.end === node.openEnd) refuse(`<${node.tag}> (${at(s, node.start)}) has no content to hold text`);
  if (['script', 'style', 'html', 'head', 'body', 'title'].includes(node.name)) refuse(`<${node.tag}> (${at(s, node.start)}) cannot hold formatted text; edit an element inside it`);
  if (/<\s*\/?\s*(script|style|iframe|object|embed)\b/i.test(html)) refuse('inner takes text and inline formatting, not scripts, styles or embedded documents', 400);
  const a = node.openEnd, b = node.closeStart, inner = s.slice(a, b);
  const lead = inner.length - inner.replace(/^[ \t\r\n\f]+/, '').length, trail = inner.length - inner.replace(/[ \t\r\n\f]+$/, '').length;
  const text = toL(html);
  if (lead + trail >= inner.length) return [{ from: a, to: b, text }];
  return [{ from: a + lead, to: b - trail, text }];
}

// ---------- class ----------
const CLASS_FNS = new Set(['cn', 'clsx', 'classNames', 'classnames', 'cx', 'twMerge', 'cva']);
// The class list of a JSX element as text, when there is one napkin can edit: className="a b", className={"a b"}, or the first plain string of cn("a b", …).
// null when there is none (no className, or built only from variables).
export function classLiteral(node) {
  if (!node.jsx) return null;
  const a = attrOf(node, 'className');
  if (!a || a.valStart === null) return null;
  if (a.quote) return a.value;
  const e = a.expr, plain = (x) => x && (x.type === 'StringLiteral' ? x.value : x.type === 'TemplateLiteral' && !x.expressions.length ? x.quasis[0].value.cooked : null);
  if (plain(e) !== null && plain(e) !== undefined) return plain(e);
  if (e && e.type === 'CallExpression' && e.callee.type === 'Identifier' && CLASS_FNS.has(e.callee.name)) { const lit = e.arguments.map(plain).find((v) => v !== null && v !== undefined); return lit ?? null; }
  return null;
}
function classSplices(s, node, add = [], remove = []) {
  const name = node.jsx ? 'className' : 'class';
  const a = attrOf(node, name);
  add = add.map(toL); remove = remove.map(toL);
  if (!a || a.valStart === null) {
    const next = add.join(' ');
    if (!next) return [];
    return a ? [{ from: a.end, to: a.end, text: `="${next}"` }] : setAttr(s, node, name, next);
  }
  let vs = a.valStart, ve = a.valEnd, quoted = !!a.quote;
  if (node.jsx && !a.quote) {
    const e = a.expr;
    const plain = (x) => x && (x.type === 'StringLiteral' || (x.type === 'TemplateLiteral' && !x.expressions.length));
    const fn = e && e.type === 'CallExpression' && e.callee.type === 'Identifier' && CLASS_FNS.has(e.callee.name) ? e : null;
    const lit = fn ? fn.arguments.find(plain) : null; // className={cn("a b", cond && "c", props.className)}: the first plain string is the list napkin edits
    if (plain(e)) { vs = e.start + 1; ve = e.end - 1; quoted = true; }
    else if (lit) { vs = lit.start + 1; ve = lit.end - 1; quoted = true; }
    else if (fn) refuse(`${name} on <${node.tag}> (${at(s, node.start)}) is computed in code: ${fn.callee.name}() has no plain class string in it; add a string such as "a b" to ${fn.callee.name}(…), or edit a rule instead`);
    else refuse(`${name} on <${node.tag}> (${at(s, node.start)}) is computed in code (${s.slice(a.valStart, Math.min(a.valEnd, a.valStart + 40))}); change it in the code, or edit a rule instead`);
  }
  const val = s.slice(vs, ve);
  const tokens = []; for (const m of val.matchAll(/[^ \t\r\n\f]+/g)) tokens.push({ t: m[0], from: vs + m.index, to: vs + m.index + m[0].length });
  const splices = [];
  const gone = tokens.filter((x) => remove.includes(x.t));
  const kept = tokens.filter((x) => !remove.includes(x.t));
  const extra = add.filter((t) => !tokens.some((x) => x.t === t && !remove.includes(t)));
  if (!quoted) { // unquoted value: rewrite it, quoting when it now holds more than one class
    const result = [...kept.map((x) => x.t), ...extra];
    const text = result.length === 1 ? result[0] : `"${result.join(' ')}"`;
    return text === val ? [] : [{ from: vs, to: ve, text }];
  }
  // each removed token goes with the space before it (the first token: with the space after it); overlapping spans join
  const cuts = gone.map((x) => { const k = tokens.indexOf(x); return k > 0 ? [wsBack(s, x.from, vs), x.to] : [x.from, k + 1 < tokens.length ? tokens[k + 1].from : x.to]; }).sort((p, q) => p[0] - q[0]);
  for (const [f, t] of cuts) { const prev = splices[splices.length - 1]; if (prev && f <= prev.to) prev.to = Math.max(prev.to, t); else splices.push({ from: f, to: t, text: '' }); }
  if (extra.length) {
    const last = kept[kept.length - 1];
    const pos = last ? last.to : (tokens.length ? splices[0]?.from ?? vs : wsBack(s, ve, vs));
    splices.push({ from: pos, to: pos, text: (last ? ' ' : '') + extra.join(' ') });
  }
  return splices;
}

// ---------- inline style ----------
// Declarations of a style attribute value [a, b): [{ prop, start, colon, valStart, valEnd, semi, end }]
function styleDecls(s, a, b) {
  const out = [];
  let i = a;
  while (i < b) {
    let j = i, depth = 0, q = null;
    for (; j < b; j++) {
      const ch = s[j];
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === '(') depth++; else if (ch === ')') depth--;
      else if (ch === ';' && depth <= 0) break;
    }
    const piece = s.slice(i, j);
    const colon = piece.indexOf(':');
    if (colon > 0 && piece.trim()) {
      const ps = i + piece.search(/\S/), pe = wsBack(s, i + colon, ps);
      const vs = wsFwd(s, i + colon + 1, j);
      let ve = wsBack(s, j, vs);
      const bang = /!\s*important$/i.exec(s.slice(vs, ve));
      if (bang) ve = wsBack(s, vs + bang.index, vs);
      out.push({ prop: s.slice(ps, pe), start: ps, colon: i + colon, valStart: vs, valEnd: ve, semi: j < b ? j : -1, end: j < b ? j + 1 : wsBack(s, j, ps), pieceStart: i });
    }
    i = j + 1;
  }
  return out;
}
const sameProp = (a, b) => (a.startsWith('--') || b.startsWith('--') ? a === b : a.toLowerCase() === b.toLowerCase());
function styleSplices(s, node, prop, value) {
  prop = toL(prop);
  if (node.jsx) return jsxStyleSplices(s, node, prop, value);
  const a = attrOf(node, 'style');
  if (!a || a.valStart === null) return value === null ? [] : setAttr(s, node, 'style', `${prop}: ${toL(value)}`);
  if (!a.quote) refuse(`the style attribute on <${node.tag}> (${at(s, node.start)}) is unquoted; napkin edits quoted style attributes`);
  const decls = styleDecls(s, a.valStart, a.valEnd);
  const hits = decls.filter((d) => sameProp(d.prop, prop));
  const d = hits[hits.length - 1];
  if (d && value !== null) return [{ from: d.valStart, to: d.valEnd, text: escAttr(toL(value), a.quote) }];
  if (d) {
    const k = decls.indexOf(d);
    if (decls.length === 1) return [{ from: d.start, to: wsFwd(s, d.end, a.valEnd), text: '' }];
    if (k === decls.length - 1) { const prev = decls[k - 1]; return [{ from: d.semi < 0 ? prev.semi : prev.semi + 1, to: d.end, text: '' }]; }
    return [{ from: d.start, to: d.end, text: '' }];
  }
  if (value === null) return [];
  // mirror the attribute's own spacing: "a:b;c:d" stays compact, "a: b; c: d" stays spaced
  const compact = decls.length && decls.every((x) => x.valStart === x.colon + 1);
  const gap = decls.length > 1 && decls.slice(1).every((x) => x.start === x.pieceStart) ? '' : ' ';
  const body = `${prop}${compact ? ':' : ': '}${escAttr(toL(value), a.quote)}`;
  const trimmedEnd = wsBack(s, a.valEnd, a.valStart);
  if (trimmedEnd === a.valStart) return [{ from: a.valStart, to: a.valStart, text: body }];
  const endsSemi = s[trimmedEnd - 1] === ';';
  return [{ from: trimmedEnd, to: trimmedEnd, text: endsSemi ? `${decls.length ? gap : ''}${body}` : `;${compact ? gap : ' '}${body}` }];
}
const camel = (p) => (p.startsWith('--') ? p : p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
function jsxStyleSplices(s, node, prop, value) {
  const a = attrOf(node, 'style');
  const key = camel(prop);
  // Strings keep the quote the file uses: the value's own, else the first string in this style object, else the file's majority.
  const obj0 = a?.expr?.type === 'ObjectExpression' ? a.expr : null;
  const firstStr = obj0?.properties.find((p) => p.value?.type === 'StringLiteral')?.value;
  const fileQ = (s.match(/'/g) || []).length > (s.match(/"/g) || []).length ? "'" : '"';
  const quoteStr = (v, q) => q + v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').split(q).join('\\' + q) + q;
  const lit = (v, old) => (old?.type === 'NumericLiteral' && /^-?\d+(\.\d+)?px$/.test(v) ? v.slice(0, -2) : /^-?\d+(\.\d+)?$/.test(v) && old?.type === 'NumericLiteral' ? v
    : quoteStr(v, old?.type === 'StringLiteral' ? s[old.start] : firstStr ? s[firstStr.start] : fileQ));
  if (!a) return value === null ? [] : setAttrRaw(s, node, `style={{ ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : quoteStr(key, fileQ)}: ${lit(toL(value))} }}`);
  const obj = a.expr;
  if (!obj || obj.type !== 'ObjectExpression') refuse(`style on <${node.tag}> (${at(s, node.start)}) is computed in code (${s.slice(a.valStart, Math.min(a.valEnd, a.valStart + 40))}); change it in the code`);
  const props = obj.properties;
  const keyOf = (p) => (p.type === 'ObjectProperty' && !p.computed ? (p.key.type === 'Identifier' ? p.key.name : p.key.value) : null);
  const p = [...props].reverse().find((x) => keyOf(x) === key);
  if (p && value !== null) return [{ from: p.value.start, to: p.value.end, text: lit(toL(value), p.value) }];
  if (p) {
    const k = props.indexOf(p);
    if (k + 1 < props.length) return [{ from: p.start, to: props[k + 1].start, text: '' }];
    if (k > 0) return [{ from: props[k - 1].end, to: p.end, text: '' }];
    return [{ from: p.start, to: p.end, text: '' }];
  }
  if (value === null) return [];
  const k2 = /^[A-Za-z_$][\w$]*$/.test(key) ? key : quoteStr(key, firstStr ? s[firstStr.start] : fileQ);
  if (!props.length) return [{ from: obj.start + 1, to: obj.end - 1, text: ` ${k2}: ${lit(toL(value))} ` }];
  const last = props[props.length - 1];
  const multi = s.slice(obj.start, obj.end).includes('\n');
  return [{ from: last.end, to: last.end, text: multi ? `,\n${indentAt(s, last.start)}${k2}: ${lit(toL(value))}` : `, ${k2}: ${lit(toL(value))}` }];
}
function setAttrRaw(s, node, text) { const at = attrSlot(s, node); return [{ from: at, to: at, text: ' ' + text }]; }

// ---------- structure ----------
const isRootish = (node) => !node.parent || node.parent.tag === '#document' || ['html', 'head', 'body'].includes(node.name) && !node.jsx;
function deleteSplices(s, node) {
  if (isRootish(node)) refuse(node.jsx ? `<${node.tag}> (${at(s, node.start)}) is what the component returns; deleting it would leave no JSX` : `<${node.tag}> is part of the document itself and cannot be deleted`);
  if (node.jsx && node.parent && !node.parent.directChildren.has(node.start)) refuse(`<${node.tag}> (${at(s, node.start)}) sits inside a {…} expression; change it in the code`);
  const a = wsBack(s, node.start), b = wsFwd(s, node.end);
  const before = s.slice(a, node.start), after = s.slice(node.end, b);
  if (before.includes('\n') && after.includes('\n')) return [{ from: a + before.lastIndexOf('\n') + 1, to: node.end + after.indexOf('\n') + 1, text: '' }];
  if (before && !before.includes('\n') && after) return [{ from: a, to: node.end, text: '' }];
  return [{ from: node.start, to: node.end, text: '' }];
}
const isLeafParent = (p) => p.selfClosing || (!p.jsx && p.openEnd === p.end && p.tag !== '#document');
// The whitespace to repeat between siblings, read from the parent's own children ('' when they share a line).
function siblingGap(s, kids, k) {
  const pick = (g) => (g && !/\S/.test(g) ? g : '');
  if (k > 0 && kids[k - 1]) return pick(s.slice(kids[k - 1].end, kids[k].start));
  if (kids.length > 1) return pick(s.slice(kids[0].end, kids[1].start));
  return '';
}
function insertPoint(s, parent, kids, index, text) {
  if (isLeafParent(parent)) refuse(`<${parent.tag}> (${at(s, parent.start)}) cannot hold children`);
  if (!Number.isInteger(index) || index < 0) refuse('index must be a whole number from 0');
  if (parent.jsx && kids[index] && !parent.directChildren.has(kids[index].start)) refuse(`position ${index} of <${parent.tag}> (${at(s, parent.start)}) is inside a {…} expression; choose another position`);
  if (index < kids.length) {
    const kid = kids[index];
    let gap = siblingGap(s, kids, index);
    if (!gap) { const lead = s.slice(wsBack(s, kid.start, parent.openEnd), kid.start); gap = lead.includes('\n') ? lead.slice(lead.lastIndexOf('\n') - (lead[lead.lastIndexOf('\n') - 1] === '\r' ? 1 : 0)) : ''; }
    return { from: kid.start, to: kid.start, text: text + gap };
  }
  const point = wsBack(s, parent.closeStart, parent.openEnd);
  if (!kids.length) return { from: parent.closeStart, to: parent.closeStart, text };
  const gap = kids.length > 1 ? siblingGap(s, kids, kids.length - 1) : (() => { const lead = s.slice(wsBack(s, kids[0].start, parent.openEnd), kids[0].start); return lead.includes('\n') ? lead.slice(lead.lastIndexOf('\n') - (lead[lead.lastIndexOf('\n') - 1] === '\r' ? 1 : 0)) : ''; })();
  return { from: point, to: point, text: gap + text };
}
export function planInsert(s, parent, index, html) {
  if (typeof html !== 'string' || !html.trim()) refuse('insert needs the markup to insert (html)');
  return [insertPoint(s, parent, parent.children, index, toL(html.trim()))];
}
export function planMove(s, node, parent, index) {
  for (let p = parent; p; p = p.parent) if (p === node) refuse(`cannot move <${node.tag}> into itself`);
  if (node.jsx && node.parent && !node.parent.directChildren.has(node.start)) refuse(`<${node.tag}> (${at(s, node.start)}) sits inside a {…} expression; change it in the code`);
  const kids = parent.children.filter((k) => k !== node);
  if (parent === node.parent && Math.min(index, kids.length) === parent.children.indexOf(node)) return []; // already there
  const del = deleteSplices(s, node);
  const ins = insertPoint(s, parent, kids, Math.min(index, kids.length), s.slice(node.start, node.end));
  if (ins.from > del[0].from && ins.from < del[0].to) ins.from = ins.to = del[0].to;
  return [...del, ins];
}

// ---------- one node, one op ----------
export function planNodeEdit(s, node, edit) {
  const str = (v, what) => { if (typeof v !== 'string') refuse(`${edit.op} needs ${what} as a string`, 400); return v; };
  switch (edit.op) {
    case 'text': return textSplices(s, node, str(edit.value, 'value'), edit.run);
    case 'inner': return innerSplices(s, node, str(edit.html, 'html'));
    case 'attr': case 'prop': {
      const name = str(edit.name, 'name');
      if (!/^[^\s"'>/=]+$/.test(name)) refuse(`"${name}" is not an attribute name`, 400);
      if (edit.value === null || edit.value === undefined) return removeAttr(s, node, name);
      if (node.jsx && (name === 'className' || name === 'style') && attrOf(node, name)?.expr && edit.op === 'attr') { /* allowed: replaces the expression with a string */ }
      return setAttr(s, node, name, toL(String(edit.value)));
    }
    case 'class': {
      const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x.map(String) : [String(x)]);
      const add = list(edit.add), remove = list(edit.remove);
      if (![...add, ...remove].every((t) => /^[^\s"'<>]+$/.test(t))) refuse('class names cannot contain spaces or quotes', 400);
      return classSplices(s, node, add, remove);
    }
    case 'style': return styleSplices(s, node, str(edit.prop, 'prop'), edit.value === null || edit.value === undefined ? null : String(edit.value));
    case 'delete': return deleteSplices(s, node);
    default: refuse(`unknown op "${edit.op}"`, 400);
  }
}

// ---------- stylesheets ----------
// sheets: [{ from, to }] ranges of CSS inside s (a .css file is one sheet; an HTML file has one per <style>).
function rulesIn(s, sheets) {
  const out = [];
  for (const sh of sheets) for (const r of parseCss(s, sh.from, sh.to).rules) out.push(r);
  return out;
}
const mediaOf = (r) => r.context.filter((c) => c.name === 'media').map((c) => c.prelude).pop() ?? null;
const describeRule = (s, r) => `${r.selector.replace(/\s+/g, ' ')} (${at(s, r.selStart)}${mediaOf(r) ? `, @media ${mediaOf(r).replace(/\s+/g, ' ')}` : ''})`;
function pick(s, matches, edit, what, hasProp) {
  if (edit.index !== undefined && edit.index !== null) {
    if (!Number.isInteger(edit.index) || !matches[edit.index]) refuse(`${what}: no match number ${edit.index} (there ${matches.length === 1 ? 'is 1' : `are ${matches.length}`})`, 404);
    return matches[edit.index];
  }
  if (matches.length === 1) return matches[0];
  if (!matches.length) refuse(`${what}: not found`, 404);
  const withProp = hasProp ? matches.filter(hasProp) : [];
  if (withProp.length === 1) return withProp[0];
  refuse(`${what} is ambiguous: ${matches.length} matches. Send media and/or index (0-${matches.length - 1}) to choose one`, 409, { matches: matches.map((m, i) => ({ index: i, line: lineOf(s, m.selStart ?? m.start), media: m.media ?? mediaOf(m.rule ?? m) })) });
}
function ruleFormat(s, rule) {
  const decls = rule.decls;
  const spaced = !decls.length || decls.some((d) => d.valStart > d.colon + 1);
  let gap = s[rule.open + 1] === ' ' ? ' ' : '';
  for (let k = 1; k < decls.length; k++) {
    const prev = decls[k - 1]; if (prev.semi < 0) continue;
    const g = s.slice(prev.semi + 1, decls[k].start);
    if (!/\S/.test(g) && !g.includes('\n')) { gap = g; break; }
  }
  return { colon: spaced ? ': ' : ':', gap, eol: s.slice(rule.open, rule.close).includes('\r\n') ? '\r\n' : '\n' };
}
// The text before `i` on its line is only whitespace.
const ownLine = (s, i, floor) => { let k = i; while (k > floor && (s[k - 1] === ' ' || s[k - 1] === '\t')) k--; return s[k - 1] === '\n'; };
function addDecl(s, rule, prop, value) {
  const f = ruleFormat(s, rule);
  const decls = rule.decls;
  if (!decls.length) {
    if (s.slice(rule.open, rule.close).includes('\n')) return { from: rule.open + 1, to: rule.open + 1, text: `${f.eol}${indentAt(s, rule.selStart)}  ${prop}${f.colon}${value};` };
    return { from: rule.open + 1, to: rule.open + 1, text: ` ${prop}${f.colon}${value};${s[rule.open + 1] === ' ' ? '' : ' '}` };
  }
  const last = decls[decls.length - 1];
  const semi = last.semi >= 0;
  if (ownLine(s, last.start, rule.open + 1)) {
    // one declaration per line: a new line after the last one, at its indentation (a comment after it stays on its line)
    let pos = last.end;
    const nl = s.indexOf('\n', pos), rest = s.slice(pos, nl < 0 || nl > rule.close ? rule.close : nl);
    if (!/\S/.test(rest.replace(/\/\*[\s\S]*?\*\//g, ''))) pos += rest.replace(/[ \t\r]+$/, '').length;
    return { from: pos, to: pos, text: `${semi ? '' : ';'}${f.eol}${indentAt(s, last.start)}${prop}${f.colon}${value};` };
  }
  return { from: last.end, to: last.end, text: `${semi ? f.gap : ';' + f.gap}${prop}${f.colon}${value}${semi ? ';' : ''}` };
}
function removeDecl(s, rule, d) {
  let ls = d.start; while (ls > rule.open + 1 && (s[ls - 1] === ' ' || s[ls - 1] === '\t')) ls--;
  const lineStart = s[ls - 1] === '\n' || ls === rule.open + 1 && s.slice(rule.open + 1, d.start).includes('\n');
  let le = d.end; while (le < rule.close && (s[le] === ' ' || s[le] === '\t' || s[le] === '\r')) le++;
  if (lineStart && s[ls - 1] === '\n' && s[le] === '\n') return { from: ls, to: le + 1, text: '' };
  const to = wsFwd(s, d.end, rule.close);
  if (s.slice(d.end, to).includes('\n')) return { from: d.start, to: d.end, text: '' };
  return { from: d.start, to, text: '' };
}
export function planRule(s, sheets, edit) {
  if (typeof edit.selector !== 'string' || !edit.selector.trim()) refuse('rule needs a selector', 400);
  if (typeof edit.prop !== 'string' || !edit.prop.trim()) refuse('rule needs a prop', 400);
  const sel = normSelector(toL(edit.selector)), prop = toL(edit.prop.trim());
  const lprop = prop.startsWith('--') ? prop : prop.toLowerCase();
  let rules = rulesIn(s, sheets).filter((r) => r.kind === 'style' && normSelector(r.selector) === sel);
  if (edit.media !== undefined && edit.media !== null) { const m = normPrelude(toL(String(edit.media).replace(/^@media\s+/i, ''))); rules = rules.filter((r) => (mediaOf(r) === null ? '' : normPrelude(mediaOf(r))) === m); }
  const rule = pick(s, rules, edit, `rule ${edit.selector}${edit.media ? ` @media ${edit.media}` : ''} in ${edit.file}`, (r) => r.decls.some((d) => d.lprop === lprop));
  const hits = rule.decls.filter((d) => d.lprop === lprop);
  const d = hits[hits.length - 1];
  if (edit.value === null || edit.value === undefined) return { rule, splices: d ? [removeDecl(s, rule, d)] : [] };
  const v = toL(String(edit.value)).trim();
  if (/[;{}]/.test(v.replace(/"[^"]*"|'[^']*'/g, ''))) refuse(`"${edit.value}" is not one CSS value (it holds ; { or })`, 400);
  if (d) return { rule, splices: [{ from: d.valStart, to: d.valEnd, text: v }] };
  return { rule, splices: [addDecl(s, rule, prop, v)] };
}
export function planVar(s, sheets, edit) {
  if (typeof edit.name !== 'string' || !/^--[^\s:;{}]+$/.test(edit.name)) refuse('var needs a name like --space-4', 400);
  if (edit.value === null || edit.value === undefined) refuse('var needs a value', 400);
  const name = toL(edit.name);
  let defs = [];
  for (const r of rulesIn(s, sheets)) for (const d of r.decls) if (d.lprop === name) defs.push({ ...d, rule: r, selStart: d.start, media: mediaOf(r) });
  if (edit.media !== undefined && edit.media !== null) { const m = normPrelude(toL(String(edit.media).replace(/^@media\s+/i, ''))); defs = defs.filter((x) => (x.media === null ? '' : normPrelude(x.media)) === m); }
  const d = pick(s, defs, edit, `variable ${edit.name} in ${edit.file}`);
  const v = toL(String(edit.value)).trim();
  if (/[;{}]/.test(v.replace(/"[^"]*"|'[^']*'/g, ''))) refuse(`"${edit.value}" is not one CSS value (it holds ; { or })`, 400);
  return { decl: d, splices: [{ from: d.valStart, to: d.valEnd, text: v }] };
}
export { styleDecls, describeRule, mediaOf, isWs };
