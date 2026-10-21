// Write a model back into the component's text, touching only what changed between two models.
// Every change is a text splice made at the offsets of a fresh parse of the file: new lines take the indentation and
// line endings of their neighbours, and a line that is not part of the change is never reprinted. So a save with no
// change is byte-identical and one property change is a one-line diff, whatever the file's own formatting.
import { parse as babelParse } from '@babel/parser';
import { locate, literalValue } from './read.js';
import { index } from '../model.js';

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const IDENT = /^[A-Za-z_$][\w$]*$/;
// The quote of the file being written (set at the top of each writeComponent call, which is synchronous): a
// double-quoted file stays double-quoted.
let Q = "'";
// The quote prettier picks for a string: the file's quote, unless the string holds more of it than of the other one.
const quoteFor = (value) => {
  const other = Q === "'" ? '"' : "'";
  return value.split(Q).length > value.split(other).length ? other : Q;
};

const keyName = (k) => (k.type === 'Identifier' ? k.name : k.value);
const findProp = (obj, k) => obj.properties.find((p) => keyName(p.key) === k);
const baseMap = (doc) => Object.fromEntries([...index(doc).byId.values()].map((n) => [n.id, n.style]));
const EOL = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const lineStart = (text, at) => text.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (text, at) => { const i = text.indexOf('\n', at); return i < 0 ? text.length : i + 1; };
// The indentation of the line that holds offset `at`.
const indentOfLine = (text, at) => text.slice(lineStart(text, at)).match(/^[ \t]*/)[0];
// One level inside `inner` compared with `outer`, as this file writes it (`fallback` if there is no example).
const unitOf = (outer, inner, fallback) => (inner.length > outer.length && inner.startsWith(outer) ? inner.slice(outer.length) : fallback);
const litText = (v) => { if (typeof v !== 'string') return String(v); const q = quoteFor(v); return `${q}${v.replace(/\\/g, '\\\\').split(q).join(`\\${q}`)}${q}`; };

// --- object literals: base and variants ---
// syncObj(text, obj, before, after, d, st) -> splices that turn the object literal `obj` (a babel node) from `before` into
// `after`. The values are nested objects `d` levels deep ending in literals (d = 0: the values themselves are literals).
// Existing entries are edited in place; new ones are added after the last entry, with its indentation.
const litSrc = (v) => (typeof v === 'string' ? litText(v) : typeof v === 'number' && v < 0 ? `-${-v}` : String(v));
const keySrc = (k) => (IDENT.test(k) ? k : litText(k));
function emit(key, value, d, indent, unit, eol) {
  if (d === 0) return `${indent}${keySrc(key)}: ${litSrc(value)},${eol}`;
  return `${indent}${keySrc(key)}: {${eol}${Object.entries(value).map(([k, v]) => emit(k, v, d - 1, indent + unit, unit, eol)).join('')}${indent}},${eol}`;
}
const ownLines = (text, node) => /^[ \t]*$/.test(text.slice(lineStart(text, node.start), node.start)) && /^[ \t]*,?[ \t]*(\/\/[^\n]*|\/\*[^\n]*?\*\/[ \t]*)?(\r?\n|$)/.test(text.slice(node.end)); // (a trailing comment is part of the line)
function syncObj(text, obj, bef, aft, d, st) {
  const eol = EOL(text);
  const out = [];
  const props = obj.properties;
  const closeIndent = indentOfLine(text, obj.start);
  const memberIndent = props.length && ownLines(text, props[0]) ? indentOfLine(text, props[0].start) : closeIndent + st.unit;
  const unit = unitOf(closeIndent, memberIndent, st.unit);
  const removed = Object.keys(bef).filter((k) => !(k in aft));
  const added = Object.keys(aft).filter((k) => !(k in bef));
  if (!Object.keys(aft).length && props.length) return [{ start: obj.start, end: obj.end, text: '{}' }];
  if (!props.length || !props.every((p) => ownLines(text, p))) { // empty, or written inline: print the whole object
    if (same(bef, aft)) return [];
    const body = Object.entries(aft).map(([k, v]) => emit(k, v, d, memberIndent, unit, eol)).join('');
    return [{ start: obj.start, end: obj.end, text: body ? `{${eol}${body}${closeIndent}}` : '{}' }];
  }
  for (const k of removed) {
    const p = findProp(obj, k);
    out.push({ start: lineStart(text, p.start), end: lineEnd(text, p.end), text: '' });
  }
  for (const k of Object.keys(aft)) {
    if (!(k in bef)) continue;
    const p = findProp(obj, k);
    if (d === 0) {
      if (literalValue(p.value) !== aft[k]) out.push({ start: p.value.start, end: p.value.end, text: litSrc(aft[k]) });
    } else if (!same(bef[k], aft[k])) out.push(...syncObj(text, p.value, bef[k], aft[k], d - 1, st));
  }
  if (added.length) {
    const last = props.at(-1);
    if (!removed.includes(keyName(last.key)) && !/^[ \t]*,/.test(text.slice(last.end))) out.push({ start: last.end, end: last.end, text: ',' }); // hand-written, no trailing comma
    const at = lineEnd(text, last.end);
    out.push({ start: at, end: at, text: (at === text.length && !text.endsWith('\n') ? eol : '') + added.map((k) => emit(k, aft[k], d, memberIndent, unit, eol)).join('') });
  }
  return out;
}

// --- props: the interface, the destructured parameter list, and `const v` ---
// All three are text splices (see writeComponent), laid out the way prettier writes them. Members, parameters and the
// `v` object that did not change keep their text.
function typeText(p, indent, unit, eol, name) {
  if (p.type === 'string') return 'string';
  if (p.type === 'boolean') return 'boolean';
  const opts = p.options.map((o) => `${Q}${o}${Q}`);
  const one = opts.join(' | ');
  if (`${indent}${name}?: ${one};`.length <= 80) return one;
  return `${eol}${opts.map((o) => `${indent}${unit}| ${o}`).join(eol)}`; // prettier's layout for a union that does not fit
}

// --- the interface ---
function ifaceSplices(text, parts, before, after, st) {
  const iface = parts.iface;
  if (!iface || same(before.props.map((p) => [p.name, p.type, p.options]), after.props.map((p) => [p.name, p.type, p.options]))) return [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const outer = lineIndent(text, parts.ifaceStmt.start);
  const indent = parts.iface.body.body.length ? indentOfLine(text, parts.iface.body.body[0].start) : outer + st.unit;
  const member = (p) => `${indent}${p.name}?: ${typeText(p, indent, st.unit, eol, p.name)};`;
  const body = iface.body;
  const members = body.body;
  if (!after.props.length) return members.length ? [{ start: body.start, end: body.end, text: '{}' }] : [];
  if (!members.length || !/^\s*\}$/.test(text.slice(lineStart(text, body.end - 1), body.end))) {
    return [{ start: body.start, end: body.end, text: `{${eol}${after.props.map(member).join(eol)}${eol}${outer}}` }];
  }
  const was = new Map(before.props.map((p) => [p.name, p]));
  const now = new Map(after.props.map((p) => [p.name, p]));
  const out = [];
  const renamed = new Map(st.renames.props);
  for (const m of members) {
    const name = keyName(m.key), p = now.get(renamed.get(name) ?? name), old = was.get(name);
    if (!p) out.push({ start: lineStart(text, m.start), end: lineEnd(text, m.end), text: '' });
    else if (old && (old.name !== p.name || old.type !== p.type || !same(old.options, p.options))) out.push({ start: m.start, end: m.end, text: member(p).slice(indent.length) });
  }
  const have = new Set(members.map((m) => renamed.get(keyName(m.key)) ?? keyName(m.key)));
  const added = after.props.filter((p) => !have.has(p.name));
  if (added.length) { const at = lineStart(text, body.end - 1); out.push({ start: at, end: at, text: added.map((p) => member(p) + eol).join('') }); }
  return out;
}

// --- the destructured parameter list, printed so it hugs the braces the way prettier writes it:
//   export function Name({ a, b = 1 }: NameProps) {          when the whole signature fits in 80 columns
//   export function Name({\n  a,\n  b = 1,\n}: NameProps) {   when it does not (one prop per line)
// If only a default changed the file's own layout is kept. Props whose name and default did not change keep their text.
function paramsSplice(text, parts, before, after, st) {
  const names = (doc) => doc.props.map((p) => [p.name, p.default]);
  if (same(names(before), names(after))) return null;
  const fn = parts.fn;
  const param = fn.params[0] || null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const was = new Map(before.props.map((p) => [p.name, p]));
  const old = new Map((param?.properties || []).map((pr) => [keyName(pr.key), text.slice(pr.start, pr.end)]));
  const iface = param?.typeAnnotation ? text.slice(param.typeAnnotation.typeAnnotation.start, param.typeAnnotation.typeAnnotation.end) : (parts.iface?.id.name || `${fn.id.name}Props`);
  const items = after.props.map((p) => {
    const w = was.get(p.name);
    if (w && w.default === p.default && old.has(p.name)) return old.get(p.name);
    return p.default === undefined ? p.name : `${p.name} = ${litText(p.default)}`;
  });
  // A list written one per line whose names did not change: edit only the items that changed, in place.
  const stillMulti = (() => { // would prettier still break this list? (if it would now fit on one line, the whole list is re-laid out below)
    const oldFlat = param ? `{ ${[...old.values()].join(', ')} }: ${iface}` : '';
    const wasPrettier = `export function ${fn.id.name}(${oldFlat}) {`.length > 80; // the old list was broken the way prettier breaks it
    const fitsNew = `export function ${fn.id.name}(${items.length ? `{ ${items.join(', ')} }` : '{}'}: ${iface}) {`.length <= 80;
    return !wasPrettier || !fitsNew;
  })();
  if (stillMulti && param && /\n/.test(text.slice(param.start, param.end)) && same(before.props.map((p) => p.name), after.props.map((p) => p.name)) && param.properties.length === after.props.length) {
    return param.properties.map((pr, i) => (text.slice(pr.start, pr.end) === items[i] ? null : { start: pr.start, end: pr.end, text: items[i] })).filter(Boolean);
  }
  const flat = items.length ? `{ ${items.join(', ')} }: ${iface}` : `{}: ${iface}`;
  const sameNames = before.props.length === after.props.length; // (a rename, or a default changed: the list keeps its shape)
  const wasMulti = param ? /\n/.test(text.slice(param.start, param.end)) : false;
  const fits = `export function ${fn.id.name}(${flat}) {`.length <= 80;
  // Same names (a default changed): keep a hand-chosen layout, but if the list is laid out the way prettier would lay out
  // the old one, re-lay it out for the new one (a shorter default can make a list fit on one line again).
  const oldFlat = param ? `{ ${[...old.values()].join(', ')} }: ${iface}` : '';
  const prettierBefore = param ? wasMulti === !(`export function ${fn.id.name}(${oldFlat}) {`.length <= 80) : true;
  const multi = items.length > 0 && (sameNames && !prettierBefore ? wasMulti : !fits);
  const indent = lineIndent(text, parts.fnStmt.start);
  const itemIndent = param && wasMulti && param.properties.length ? indentOfLine(text, param.properties[0].start) : indent + st.unit; // (the file's own indentation of the list)
  const out = multi ? `{${eol}${items.map((x) => `${itemIndent}${x},${eol}`).join('')}${indent}}: ${iface}` : flat;
  return param ? { start: param.start, end: param.end, text: out } : { start: fn.id.end + 1, end: fn.id.end + 1, text: out };
}

// --- `const v = { axis, axis };` lists the variant axes in prop order ---
function vSplice(text, parts, before, after, st) {
  const axes = (doc) => doc.props.filter((p) => p.type === 'enum').map((p) => p.name);
  if (same(axes(before), axes(after)) && parts.vObj) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const names = axes(after);
  const indent = lineIndent(text, parts.vStmt.start);
  const flat = names.length ? `{ ${names.join(', ')} }` : '{}';
  const out = `${indent}const v = ${flat};`.length <= 80 ? flat : `{${eol}${names.map((n) => `${indent}${st.unit}${n},${eol}`).join('')}${indent}}`;
  return { start: parts.vObj.start, end: parts.vObj.end, text: out };
}

// --- JSX ---
// The element tree is printed by us. Unchanged subtrees keep their
// own text, shifted to the new depth; only elements that changed are printed fresh, laid out as prettier lays them out:
//   <tag data-n="id" style={s('id', v)} />                 an empty element (one line when it fits in 80 columns)
//   <tag data-n="id" style={s('id', v)}>                    an element with text or children: prettier always puts the
//     text or the children on their own lines when a tag has two or more attributes (and these always have two)
//   </tag>
// A tag that does not fit in 80 columns puts one attribute per line.
const attrText = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const attrValue = (s) => (s.includes('"') && !s.includes("'") ? `'${s.replace(/&/g, '&amp;')}'` : `"${attrText(s)}"`);
const attrsOf = (node) => {
  const a = [`data-n="${node.id}"`, `style={s(${Q}${node.id}${Q}, v)}`];
  for (const k of ['src', 'alt']) if (node.attrs?.[k] !== undefined) a.push(`${k}=${attrValue(node.attrs[k])}`);
  return a;
};
// Text as it appears between the tags; '' when there is none. Long text goes in {'...'} so no line wrapping is needed.
function textText(node, room) {
  if (node.textProp) return `{${node.textProp}}`;
  if (node.text === undefined || node.text === '') return '';
  if (/^[^{}<>&]+$/.test(node.text) && node.text === node.text.trim() && node.text.length <= room) return node.text;
  return `{${litText(node.text)}}`;
}
const shape = (n) => ({ id: n.id, tag: n.tag, text: n.text, textProp: n.textProp, attrs: n.attrs, children: n.children.map(shape) });
const hasContent = (n) => n.children.length > 0 || textText(n, 1000) !== '';
const WIDTH = 80;

// Elements of a parsed JSX tree by data-n id (babel nodes, with start/end offsets into the text they came from).
function elementsById(jsx) {
  const m = new Map();
  (function walk(el) {
    const a = el.openingElement.attributes.find((x) => x.name?.name === 'data-n');
    if (a) m.set(a.value.value, el);
    for (const c of el.children) if (c.type === 'JSXElement') walk(c);
  })(jsx);
  return m;
}
const lineIndent = (text, at) => { const ls = text.lastIndexOf('\n', at - 1) + 1; const pre = text.slice(ls, at); return /^[ \t]*$/.test(pre) ? pre : ''; };

// Print the element tree of `after` (the unchanged parts taken from `text`, where the root element is `jsx`), starting at
// `indent`. Returns the lines joined with `eol`; the first line has no indent.
function jsxPrinter(text, jsx, before, st) {
  const els = elementsById(jsx);
  const A = index(before).byId;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = st.unit;
  const unchanged = (n) => A.has(n.id) && same(shape(A.get(n.id)), shape(n));
  const reuse = (n, to) => {
    const el = els.get(n.id);
    const old = lineIndent(text, el.start);
    return text.slice(el.start, el.end).split(/\r?\n/).map((l, i) => (i === 0 ? l : l.startsWith(old) ? to + l.slice(old.length) : l)).join(eol);
  };
  // The opening tag: on one line if `<tag attrs>` (plus `tail`) fits, else one attribute per line.
  const open = (n, at, selfClose, tail = '') => {
    const attrs = attrsOf(n);
    const line = `<${n.tag} ${attrs.join(' ')}${selfClose ? ' />' : '>'}${tail}`;
    if (at.length + line.length <= WIDTH) return { text: line, broken: false };
    return { text: [`<${n.tag}`, ...attrs.map((a) => at + unit + a), at + (selfClose ? '/>' : '>')].join(eol), broken: true };
  };
  const print = (n, at) => {
    if (unchanged(n)) return reuse(n, at);
    const content = hasContent(n);
    const el = els.get(n.id), old = A.get(n.id);
    // keep the original opening tag (and how it was laid out) when only the content changed and it is on one line
    const sameOpen = el && old && old.tag === n.tag && same(old.attrs, n.attrs) && hasContent(old) === content && (content || el.openingElement.selfClosing) && !/\n/.test(text.slice(el.openingElement.start, el.openingElement.end));
    if (!content) return sameOpen ? text.slice(el.openingElement.start, el.openingElement.end) : open(n, at, true).text;
    const close = `</${n.tag}>`;
    if (!n.children.length) {
      // prettier puts the text of an element with two or more attributes on its own line; an element that was written
      // on one line by hand stays on one line, so editing its text is a one-line diff
      const handLine = sameOpen && old.children.length === 0 && !/\n/.test(text.slice(el.start, el.end));
      if (handLine) return `${text.slice(el.openingElement.start, el.openingElement.end)}${textText(n, 1000)}${close}`;
      return [sameOpen ? text.slice(el.openingElement.start, el.openingElement.end) : open(n, at, false).text, at + unit + textText(n, 0), at + close].join(eol);
    }
    const o = sameOpen ? { text: text.slice(el.openingElement.start, el.openingElement.end) } : open(n, at, false);
    return [o.text, ...n.children.map((c) => at + unit + print(c, at + unit)), at + close].join(eol);
  };
  return { print, els, A, eol, unit };
}
const printJsx = (text, jsx, before, after, st, indent) => jsxPrinter(text, jsx, before, st).print(after.root, indent);

// Edits to the element tree as splices, so everything we did not mean to change stays: comments (`{/* ... */}`), blank
// lines, the layout of untouched elements. An element is only rewritten whole when its own tag, attributes or text
// changed or it gained or lost its first/last child; otherwise a removed child is deleted by its own lines, a new one is
// inserted after its previous sibling, and the children that stay are visited in place.
const lcs = (a, b) => {
  const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  return out;
};
function jsxSplices(text, parts, before, after, st) {
  const jp = jsxPrinter(text, parts.jsx, before, st);
  const { print, els, A, eol } = jp;
  const out = [];
  const onOwnLines = (el) => /^[ \t]*$/.test(text.slice(lineStart(text, el.start), el.start)) && /^[ \t]*(\r?\n|$)/.test(text.slice(el.end));
  const whole = (n, el) => out.push({ start: el.start, end: el.end, text: print(n, indentOfLine(text, el.start)) });
  const walk = (n, old) => {
    const el = els.get(n.id);
    if (same(shape(old), shape(n))) return;
    if (!n.children.length || !old.children.length || old.tag !== n.tag || !same(old.attrs, n.attrs)) return whole(n, el);
    const oldIds = old.children.map((c) => c.id), newIds = n.children.map((c) => c.id);
    const stay = new Set(lcs(oldIds.filter((i) => newIds.includes(i)), newIds.filter((i) => oldIds.includes(i))));
    if (!old.children.every((c) => els.get(c.id) && onOwnLines(els.get(c.id)))) return whole(n, el); // children written inline: rewrite this element
    for (const c of old.children) {
      if (stay.has(c.id)) continue;
      const ce = els.get(c.id);
      out.push({ start: lineStart(text, ce.start), end: lineEnd(text, ce.end), text: '' });
    }
    for (const c of n.children) if (stay.has(c.id)) walk(c, A.get(c.id));
    // new (or moved) children go after the previous sibling that stays, or right after the opening tag
    const childIndent = indentOfLine(text, els.get(old.children[0].id).start);
    const groups = new Map();
    let anchor = null;
    for (const c of n.children) {
      if (stay.has(c.id)) { anchor = c.id; continue; }
      const key = anchor ?? '';
      (groups.get(key) ?? groups.set(key, []).get(key)).push(`${childIndent}${print(c, childIndent)}${eol}`);
    }
    for (const [key, lines] of groups) {
      const at = key ? lineEnd(text, els.get(key).end) : lineEnd(text, el.openingElement.end);
      out.push({ start: at, end: at, text: lines.join('') });
    }
  };
  walk(after.root, before.root);
  return out;
}

// The whole `return ...;` statement: `return <x />;` when a single line fits, else `return (` + the tree + `);`.
function returnText(text, parts, before, after, st) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const ind = lineIndent(text, parts.ret.start);
  const jsxIndent = indentOfLine(text, parts.jsx.start);
  const unit = unitOf(ind, jsxIndent, st.unit); // the file's own step from `return` to the root element
  st = { ...st, unit };
  const tree = printJsx(text, parts.jsx, before, after, st, ind + st.unit);
  const single = `return ${tree};`;
  return !tree.includes('\n') && ind.length + single.length <= WIDTH ? single : `return (${eol}${ind}${st.unit}${tree}${eol}${ind});`;
}

// the file gets only the lines that name it changed, instead of the old entry removed and a new one added at the end.
function findRenames(before, after) {
  const props = [], values = [];
  if (before.props.length === after.props.length) {
    before.props.forEach((p, i) => {
      const q = after.props[i];
      if (p.name !== q.name && p.type === q.type && same(p.options, q.options) && p.default === q.default) props.push([p.name, q.name]);
    });
  }
  const renamedAxis = new Map(props);
  for (const p of before.props) {
    if (p.type !== 'enum') continue;
    const q = after.props.find((x) => x.name === (renamedAxis.get(p.name) ?? p.name));
    if (!q || q.type !== 'enum' || q.options.length !== p.options.length) continue;
    const diff = p.options.map((o, i) => [o, q.options[i]]).filter(([a, b2]) => a !== b2);
    if (diff.length === 1) values.push({ axis: p.name, to: q.name, from: diff[0][0], toValue: diff[0][1] });
  }
  return { props, values };
}


// How the file is written, so what we add looks like what is there: tabs or spaces (and how many), quotes.
function detectStyle(text) {
  const useTabs = /^\t/m.test(text);
  const widths = (text.match(/^ {2,}(?=\S)/gm) || []).map((x) => x.length);
  const width = Math.min(8, widths.length ? Math.min(...widths) : 2);
  const single = (text.match(/[:=] '/g) || []).length, double = (text.match(/[:=] "[^"\n]*"[,;]?$/gm) || []).length;
  return { unit: useTabs ? '\t' : ' '.repeat(width), quote: double > single ? '"' : "'" };
}

// The key of an entry, renamed in place: only the key's characters change.
function keySplices(text, parts, renames) {
  const out = [];
  if (!parts.variants) return out;
  for (const [from, to] of renames.props) { const p = findProp(parts.variants, from); if (p) out.push({ start: p.key.start, end: p.key.end, text: keySrc(to) }); }
  for (const r of renames.values) {
    const axis = findProp(parts.variants, r.axis);
    const p = axis && findProp(axis.value, r.from);
    if (p) out.push({ start: p.key.start, end: p.key.end, text: keySrc(r.toValue) });
  }
  return out;
}
// `variants` (new names) with the renames undone, so it can be compared with the old text that still has the old names.
function unrenameVariants(variants, renames) {
  const axisFrom = new Map(renames.props.map(([a, b]) => [b, a]));
  const out = {};
  for (const [axis, vals] of Object.entries(variants)) {
    const oldAxis = axisFrom.get(axis) ?? axis;
    const r = renames.values.find((x) => x.axis === oldAxis);
    out[oldAxis] = r ? Object.fromEntries(Object.entries(vals).map(([k, v]) => [k === r.toValue ? r.from : k, v])) : vals;
  }
  return out;
}

// A node rename (the model's `rename {id, to}`) changes an id in place: the same tree with a different data-n. Found by walking
// both trees together; a reorder keeps both ids, a rename drops one and adds one.
function nodeRenames(before, after) {
  const map = new Map();
  const was = index(before).byId, now = index(after).byId;
  (function walk(a, c) {
    if (a.tag !== c.tag || a.children.length !== c.children.length) return;
    if (a.id !== c.id && !now.has(a.id) && !was.has(c.id)) map.set(a.id, c.id);
    a.children.forEach((x, i) => walk(x, c.children[i]));
  })(before.root, after.root);
  return map;
}
// The text with every renamed id changed where it appears: data-n, s('id', v), and the keys in base and variants. Only
// those characters change (the quotes the file uses stay).
function renameIds(text, map) {
  const parts = locate(babelParse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }));
  const out = [];
  const lit = (node, to) => out.push({ start: node.start, end: node.end, text: `${text[node.start]}${to}${text[node.start]}` });
  (function el(e) {
    for (const a of e.openingElement.attributes) {
      const l = a.name?.name === 'data-n' ? a.value : a.name?.name === 'style' ? a.value.expression.arguments[0] : null;
      if (l && map.has(l.value)) lit(l, map.get(l.value));
    }
    for (const c of e.children) if (c.type === 'JSXElement') el(c);
  })(parts.jsx);
  const rekey = (obj) => { for (const p of obj.properties) if (map.has(keyName(p.key))) out.push({ start: p.key.start, end: p.key.end, text: keySrc(map.get(keyName(p.key))) }); };
  rekey(parts.base);
  if (parts.variants) for (const axis of parts.variants.properties) for (const val of axis.value.properties) rekey(val.value);
  let t = text;
  for (const sp of out.sort((x, y) => y.start - x.start)) t = t.slice(0, sp.start) + sp.text + t.slice(sp.end);
  return t;
}
function withNodeIds(doc, map) {
  const moved = structuredClone(doc);
  const to = (id) => map.get(id) ?? id;
  (function ids(n) { n.id = to(n.id); n.children.forEach(ids); })(moved.root);
  for (const vals of Object.values(moved.variants)) for (const nodes of Object.values(vals)) for (const id of Object.keys(nodes)) if (map.has(id)) { nodes[to(id)] = nodes[id]; delete nodes[id]; }
  return moved;
}

// Patch the text `original` from model `before` to model `after`; returns the new text. (`ast` is unused: the splices need
// offsets into the real text, so the file is parsed again here.)
export function writeComponent(ast, before, after, original) {
  if (same(before, after)) return original; // nothing to change: the bytes stay exactly as they were
  const renamedIds = nodeRenames(before, after);
  if (renamedIds.size) return writeComponent(ast, withNodeIds(before, renamedIds), after, renameIds(original, renamedIds)); // ids first, then the rest of the diff
  const st = detectStyle(original);
  Q = st.quote;
  const parts = locate(babelParse(original, { sourceType: 'module', plugins: ['typescript', 'jsx'] }));
  const splices = [];
  const bb = baseMap(before), ba = baseMap(after);
  if (!same(bb, ba)) {
    // Only entries that exist in the file or have styles: an unstyled node without a base entry stays without one, so
    // inserting a bare element adds one line, not an empty block; a node whose last style was removed loses its block.
    const inFile = (k) => !!findProp(parts.base, k);
    const from = Object.fromEntries(Object.keys(bb).filter(inFile).map((k) => [k, bb[k]]));
    const to = Object.fromEntries(Object.entries(ba).filter(([k, st2]) => Object.keys(st2).length || (inFile(k) && !Object.keys(bb[k] || {}).length)));
    splices.push(...syncObj(original, parts.base, from, to, 1, st));
  }
  const renames = findRenames(before, after);
  splices.push(...keySplices(original, parts, renames));
  const afterVariants = unrenameVariants(after.variants, renames);
  if (!same(before.variants, afterVariants)) {
    if (!parts.variants) throw new Error('component has no variants object');
    splices.push(...syncObj(original, parts.variants, before.variants, afterVariants, 3, st));
  }
  st.renames = renames;
  if (!same(before.props, after.props)) {
    splices.push(...ifaceSplices(original, parts, before, after, st));
    for (const sp of [paramsSplice(original, parts, before, after, st), vSplice(original, parts, before, after, st)].flat()) if (sp) splices.push(sp);
  }
  if (!same(shape(before.root), shape(after.root))) {
    // the `return` statement changes form (`return <x />;` <-> `return (` ... `);`) only when the root gains or loses its content
    if (hasContent(before.root) !== hasContent(after.root)) splices.push({ start: parts.ret.start, end: parts.ret.end, text: returnText(original, parts, before, after, st) });
    else {
      const jsxUnit = unitOf(lineIndent(original, parts.ret.start), indentOfLine(original, parts.jsx.start), st.unit);
      splices.push(...jsxSplices(original, parts, before, after, { ...st, unit: jsxUnit }));
    }
  }
  let out = original;
  for (const sp of splices.sort((x, y) => y.start - x.start || y.end - x.end)) out = out.slice(0, sp.start) + sp.text + out.slice(sp.end);
  return out;
}

// Source for a brand-new component: one root frame, no props.
export function newComponentSource(name, rootTag = 'div') {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`component name "${name}" must be PascalCase`);
  return `import type { CSSProperties } from 'react';

export interface ${name}Props {}

type Styles = Record<string, CSSProperties>;

const base: Styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 16,
  },
};

const variants: Record<string, Record<string, Styles>> = {};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function ${name}({}: ${name}Props) {
  const v = {};
  return <${rootTag} data-n="root" style={s('root', v)} />;
}
`;
}
