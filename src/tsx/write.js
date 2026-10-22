// Write a model back into the component's text, touching only what changed between two models.
// Every change is a text splice made at the offsets of a fresh parse of the file: new lines take the indentation and
// line endings of their neighbours, and a line that is not part of the change is never reprinted. So a save with no
// change is byte-identical and one property change is a one-line diff, whatever the file's own formatting.
import { parse as babelParse } from '@babel/parser';
import { explainError } from '../errors.js';
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
const flatEntry = (k, v, d) => `${keySrc(k)}: ${d === 0 ? litSrc(v) : '{ ' + Object.entries(v).map(([a, b]) => flatEntry(a, b, d - 1)).join(', ') + ' }'}`;
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
  if (!props.length) { // empty: print the whole object
    if (same(bef, aft)) return [];
    const body = Object.entries(aft).map(([k, v]) => emit(k, v, d, memberIndent, unit, eol)).join('');
    return [{ start: obj.start, end: obj.end, text: body ? `{${eol}${body}${closeIndent}}` : '{}' }];
  }
  // entries written several to a line (`{ a: 1, /* c */ b: 2 }`) are edited in place, comments and all
  for (const k of removed) {
    const p = findProp(obj, k);
    if (ownLines(text, p)) { out.push({ start: lineStart(text, p.start), end: lineEnd(text, p.end), text: '' }); continue; }
    const next = props[props.indexOf(p) + 1];
    if (next) { const m = text.slice(p.end, next.start).match(/^[ \t]*,[ \t]*/); out.push({ start: p.start, end: p.end + (m ? m[0].length : 0), text: '' }); }
    else out.push({ start: p.start - text.slice(0, p.start).match(/[ \t]*$/)[0].length, end: p.end, text: '' });
  }
  for (const k of Object.keys(aft)) {
    if (!(k in bef)) continue;
    const p = findProp(obj, k);
    if (d === 0) {
      if (literalValue(p.value) !== aft[k]) out.push({ start: p.value.start, end: p.value.end, text: litSrc(aft[k]) });
    } else if (!same(bef[k], aft[k])) out.push(...syncObj(text, p.value, bef[k], aft[k], d - 1, st));
  }
  if (added.length) {
    // a new key goes right after the key before it in the new model's order (the end for an ordinary add), so an undo puts it back where it was
    const order = Object.keys(aft);
    const live = props.filter((p) => !removed.includes(keyName(p.key)));
    const groups = new Map(); // anchor property (or null: the very start) -> lines to insert
    for (const k of added) {
      const prev = order.slice(0, order.indexOf(k)).reverse().find((q) => live.some((p) => keyName(p.key) === q) || added.includes(q) && groups.has(`k:${q}`));
      // a run of new keys stays together after the same anchor
      const anchor = prev === undefined ? null : (live.find((p) => keyName(p.key) === prev) ?? null);
      const key = anchor ? `p:${anchor.start}` : prev === undefined ? 'start' : groups.get(`k:${prev}`)?.anchor;
      const g = groups.get(key) ?? groups.set(key, { anchor, lines: [] }).get(key);
      g.lines.push(emit(k, aft[k], d, memberIndent, unit, eol));
      groups.set(`k:${k}`, { anchor: key });
    }
    for (const [key, g] of groups) {
      if (key.startsWith('k:')) continue;
      if (g.anchor && !ownLines(text, g.anchor)) { // the anchor shares its line with other entries: add inside the line
        const flat = (k) => `${keySrc(k)}: ${d === 0 ? litSrc(aft[k]) : '{ ' + Object.entries(aft[k]).map(([a, b]) => flatEntry(a, b, d - 1)).join(', ') + ' }'}`;
        const items = added.filter((k) => groups.get(`k:${k}`)?.anchor === key).map(flat);
        const comma = text.slice(g.anchor.end).match(/^[ \t]*,/);
        if (comma) out.push({ start: g.anchor.end + comma[0].length, end: g.anchor.end + comma[0].length, text: ` ${items.join(', ')},` });
        else out.push({ start: g.anchor.end, end: g.anchor.end, text: `, ${items.join(', ')}` });
      } else if (!g.anchor && live[0] && !ownLines(text, live[0])) {
        const items = added.filter((k) => groups.get(`k:${k}`)?.anchor === key).map((k) => `${keySrc(k)}: ${d === 0 ? litSrc(aft[k]) : '{ ' + Object.entries(aft[k]).map(([a, b]) => flatEntry(a, b, d - 1)).join(', ') + ' }'}`);
        out.push({ start: live[0].start, end: live[0].start, text: `${items.join(', ')}, ` });
      } else if (g.anchor) {
        if (!removed.includes(keyName(g.anchor.key)) && !/^[ \t]*,/.test(text.slice(g.anchor.end))) out.push({ start: g.anchor.end, end: g.anchor.end, text: ',' }); // hand-written, no trailing comma
        const at = lineEnd(text, g.anchor.end);
        out.push({ start: at, end: at, text: (at === text.length && !text.endsWith('\n') ? eol : '') + g.lines.join('') });
      } else {
        const at = lineStart(text, live[0] ? live[0].start : props[0].start);
        out.push({ start: at, end: at, text: g.lines.join('') });
      }
    }
  }
  return out;
}

// --- props: the interface, the destructured parameter list, and `const v` ---
// All three are text splices (see writeComponent), laid out the way prettier writes them. Members, parameters and the
// `v` object that did not change keep their text.
function typeText(p, indent, unit, eol, name) {
  if (p.type === 'string') return 'string';
  if (p.type === 'boolean') return 'boolean';
  if (p.type === 'number') return 'number';
  if (p.type === 'node') return 'ReactNode';
  const opts = p.options.map((o) => `${Q}${o}${Q}`);
  const one = opts.join(' | ');
  if (`${indent}${name}?: ${one};`.length <= 80) return one;
  return `${eol}${opts.map((o) => `${indent}${unit}| ${o}`).join(eol)}`; // prettier's layout for a union that does not fit
}

// A union of values edited in place, comments and layout included: a renamed value changes only its literal, a removed value
// takes its own piece (its line when the union is written one value per line), and new values go after the last one in the
// file's own layout. Returns null when the union is not a plain list of strings (then the member is rewritten).
function unionSplices(text, m, old, p, st, memberIndent) {
  const u = m.typeAnnotation?.typeAnnotation;
  const lits = u?.type === 'TSUnionType' ? u.types : u?.type === 'TSLiteralType' ? [u] : null;
  if (!lits || !lits.every((x) => x.type === 'TSLiteralType' && x.literal.type === 'StringLiteral') || lits.length !== old.options.length) return null;
  const out = [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const renamedTo = new Map((st.renames.values || []).filter((r) => r.axis === old.name).map((r) => [r.from, r.toValue]));
  const keep = new Set();
  lits.forEach((lit, i) => {
    const v = old.options[i];
    if (renamedTo.has(v) && p.options.includes(renamedTo.get(v))) { keep.add(i); out.push({ start: lit.literal.start, end: lit.literal.end, text: `${Q}${renamedTo.get(v)}${Q}` }); }
    else if (p.options.includes(v)) keep.add(i);
  });
  const multi = /\n/.test(text.slice(u.start, u.end));
  lits.forEach((lit, i) => {
    if (keep.has(i)) return;
    if (multi) {
      const ls = lineStart(text, lit.start);
      const own = /^[ \t]*(\|[ \t]*)?$/.test(text.slice(ls, lit.start)) && /^[ \t]*[;,]?[ \t]*(\r?\n|\/\/)/.test(text.slice(lit.end));
      if (own && i < lits.length - 1) out.push({ start: ls, end: lineEnd(text, lit.end), text: '' });
      else if (i > 0) out.push({ start: lits[i - 1].end, end: lit.end, text: '' });
      else out.push({ start: lit.start, end: lits[1].start, text: '' });
    } else if (i > 0) out.push({ start: lits[i - 1].end, end: lit.end, text: '' });
    else out.push({ start: lit.start, end: lits[1] ? lits[1].start : lit.end, text: '' });
  });
  if (keep.size === 0) return null;
  const present = new Set([...keep].map((i) => renamedTo.get(old.options[i]) ?? old.options[i]));
  const added = p.options.filter((o) => !present.has(o));
  if (added.length) {
    const last = lits.at(-1);
    if (!keep.has(lits.length - 1)) return null; // the last value is being removed and new ones added: rewrite
    const lastLine = multi ? text.slice(lineStart(text, last.start), last.start) : '';
    const lead = multi ? (lastLine.match(/^[ \t]*/)[0]) : '';
    const bar = multi && /^[ \t]*\|[ \t]*$/.test(lastLine) ? lastLine : null;
    out.push({ start: last.end, end: last.end, text: added.map((o) => (multi ? `${eol}${bar ?? lead + '| '}${Q}${o}${Q}` : ` | ${Q}${o}${Q}`)).join('') });
  }
  return out;
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
    else if (old && old.name !== p.name && old.type === p.type && same(old.options, p.options)) out.push({ start: m.key.start, end: m.key.end, text: p.name }); // a rename: only the name changes
    else if (old && (old.type !== p.type || !same(old.options, p.options))) {
      const inPlace = old.type === 'enum' && p.type === 'enum' ? unionSplices(text, m, old, p, st, indent) : null;
      if (inPlace) { if (old.name !== p.name) out.push({ start: m.key.start, end: m.key.end, text: p.name }); out.push(...inPlace); }
      else out.push({ start: m.start, end: m.end, text: member(p).slice(indent.length) });
    }
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
  if (stillMulti && param && /\n/.test(text.slice(param.start, param.end)) && (same(before.props.map((p) => p.name), after.props.map((p) => p.name)) || st.renames.props.length) && param.properties.length === after.props.length) {
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
// An instance prop as the text after `name=`: a quoted text, or {number}, {true}/{false}, {ourProp}.
const propValueText = (v) => (typeof v === 'string' ? attrValue(v) : v && typeof v === 'object' ? `{${v.prop}}` : `{${v}}`);
const attrsOf = (node) => {
  if (node.instance) return [`data-n="${node.id}"`, ...Object.entries(node.instance.props).map(([k, v]) => `${k}=${propValueText(v)}`)];
  const a = [`data-n="${node.id}"`, `style={s(${Q}${node.id}${Q}, v)}`];
  for (const k of ['src', 'alt']) if (node.attrs?.[k] !== undefined) a.push(`${k}=${attrValue(node.attrs[k])}`);
  return a;
};
// Text as it appears between the tags; '' when there is none. Long text goes in {'...'} so no line wrapping is needed.
function textText(node, room) {
  if (node.textProp) return `{${node.textProp}}`;
  if (node.slot) return `{${node.slot}}`;
  if (node.text === undefined || node.text === '') return '';
  // plain JSX text when it can be (only what JSX needs is escaped); `{'...'}` for text with edge or doubled spaces, or too long for the line
  const plain = node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/'/g, '&apos;').replace(/"/g, '&quot;'); // (what react/no-unescaped-entities asks for too)
  if (node.text === node.text.trim() && !/\s{2}/.test(node.text) && plain.length <= room) return plain;
  return `{${litText(node.text)}}`;
}
const shape = (n) => ({ id: n.id, tag: n.tag, text: n.text, textProp: n.textProp, slot: n.slot, when: n.when, instance: n.instance, attrs: n.attrs, children: n.children.map(shape) });
const hasContent = (n) => n.children.length > 0 || textText(n, 1000) !== '';
const WIDTH = 80;

// Elements of a parsed JSX tree by data-n id (babel nodes, with start/end offsets into the text they came from).
function elementsById(jsx) {
  const m = new Map();
  (function walk(el) {
    const a = el.openingElement.attributes.find((x) => x.name?.name === 'data-n');
    if (a) m.set(a.value.value, el);
    for (const c of el.children) {
      if (c.type === 'JSXElement') walk(c);
      else if (c.type === 'JSXExpressionContainer' && c.expression.type === 'LogicalExpression') { // {flag && <el />}: the element's outer extent is the whole {...}
        let r = c.expression.right; while (r?.type === 'ParenthesizedExpression') r = r.expression;
        if (r?.type === 'JSXElement') { r.__outer = c; walk(r); }
      }
    }
  })(jsx);
  return m;
}
// The extent of an element including its `{flag && ...}` wrapper, if it has one.
const ext = (el) => el.__outer ?? el;
const lineIndent = (text, at) => { const ls = text.lastIndexOf('\n', at - 1) + 1; const pre = text.slice(ls, at); return /^[ \t]*$/.test(pre) ? pre : ''; };

// Print the element tree of `after` (the unchanged parts taken from `text`, where the root element is `jsx`), starting at
// `indent`. Returns the lines joined with `eol`; the first line has no indent.
function jsxPrinter(text, jsx, before, st) {
  const els = elementsById(jsx);
  const A = index(before).byId;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = st.unit;
  const unchanged = (n) => A.has(n.id) && same(shape(A.get(n.id)), shape(n));
  // Text of `a..b` moved from the indentation of the line it starts on to `to`.
  const moveText = (a, b, to) => {
    const old = indentOfLine(text, a);
    return text.slice(a, b).split(/\r?\n/).map((l, i) => (i === 0 ? l : l.startsWith(old) ? to + l.slice(old.length) : l)).join(eol);
  };
  const reuse = (n, to) => {
    const e = ext(els.get(n.id));
    const body = moveText(e.start, e.end, to);
    const tail = text.slice(e.end, lineEnd(text, e.end)).match(/^[ \t]*(\{\/\*.*?\*\/\})[ \t]*(\r?\n|$)/)?.[1]; // a `{/* ... */}` after it on its last line travels with it
    return tail ? `${body} ${tail}` : body;
  };
  // `{flag && <el />}` on one line when it fits, else `{flag && (` + the element one step in + `)}`.
  const wrapWhen = (n, make, at) => {
    const one = make(at);
    if (!one.includes('\n') && at.length + `{${n.when} && ${one}}`.length <= WIDTH) return `{${n.when} && ${one}}`;
    return [`{${n.when} && (`, at + unit + make(at + unit), `${at})}`].join(eol);
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
    const old0 = A.get(n.id);
    const bare = (x) => ({ ...x, when: undefined });
    if (n.when) { // the element itself may be unchanged (only its condition is new): keep its text, wrap it
      if (old0 && same(shape(bare(old0)), shape(bare(n)))) { const el0 = els.get(n.id); return wrapWhen(n, (a) => moveText(el0.start, el0.end, a), at); }
      return wrapWhen(n, (a) => build(bare(n), a), at);
    }
    if (old0?.when && same(shape(bare(old0)), shape(n))) { const el0 = els.get(n.id); return moveText(el0.start, el0.end, at); } // the condition was dropped: the bare element
    return build(n, at);
  };
  const build = (n, at) => {
    const content = hasContent(n);
    const el = els.get(n.id), old = A.get(n.id);
    // keep the original opening tag (and how it was laid out) when only the content changed and it is on one line
    const sameOpen = el && old && old.tag === n.tag && same(old.attrs, n.attrs) && same(old.instance, n.instance) && hasContent(old) === content && (content || el.openingElement.selfClosing) && !/\n/.test(text.slice(el.openingElement.start, el.openingElement.end));
    if (!content) return sameOpen ? text.slice(el.openingElement.start, el.openingElement.end) : open(n, at, true).text;
    const close = `</${n.tag}>`;
    if (!n.children.length) {
      // prettier puts the text of an element with two or more attributes on its own line; an element that was written
      // on one line by hand stays on one line, so editing its text is a one-line diff
      const handLine = sameOpen && old.children.length === 0 && !/\n/.test(text.slice(el.start, el.end));
      if (handLine) return `${text.slice(el.openingElement.start, el.openingElement.end)}${textText(n, 1000)}${close}`;
      return [sameOpen ? text.slice(el.openingElement.start, el.openingElement.end) : open(n, at, false).text, at + unit + textText(n, WIDTH - at.length - unit.length), at + close].join(eol);
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
  // an element on lines of its own (only a trailing comment may share the last line)
  const onOwnLines = (el0) => { const el = ext(el0); return /^[ \t]*$/.test(text.slice(lineStart(text, el.start), el.start)) && /^[ \t]*(\{\/\*.*?\*\/\}[ \t]*)?(\r?\n|$)/.test(text.slice(el.end)); };
  const whole = (n, el0) => { const el = ext(el0); out.push({ start: el.start, end: el.end, text: print(n, indentOfLine(text, el.start)) }); };
  const walk = (n, old) => {
    const el = els.get(n.id);
    if (same(shape(old), shape(n))) return;
    if (old.tag !== n.tag || old.when !== n.when) return whole(n, el);
    const oc = hasContent(old), nc = hasContent(n);
    const leafBoth = !n.children.length && !old.children.length;
    // 1. the attributes (src, alt): only the attribute changes, so comments between attributes stay
    if (!same(old.attrs, n.attrs) || !same(old.instance, n.instance)) {
      const sp = attrSplices(el, old, n);
      if (!sp) return whole(n, el);
      out.push(...sp);
    }
    // 2. leaves: change only the text span, or open/close an empty element, never the opening tag
    if (leafBoth) {
      if (oc && nc) { if (old.text !== n.text || old.textProp !== n.textProp || old.slot !== n.slot) { const sp = textSplice(el, n); if (!sp) return whole(n, el); out.push(sp); } return; }
      if (!oc && !nc) return;
      const cm = el.children.find((x) => x.type === 'JSXExpressionContainer' && x.expression.type === 'JSXEmptyExpression');
      if (!oc && nc && cm && !el.openingElement.selfClosing) { // an element holding only a comment gets its text before the comment
        const own = /^[ \t]*$/.test(text.slice(lineStart(text, cm.start), cm.start));
        const at = own ? lineStart(text, cm.start) : cm.start;
        out.push({ start: at, end: at, text: own ? `${indentOfLine(text, cm.start)}${textText(n, WIDTH)}${eol}` : textText(n, WIDTH) });
        return;
      }
      if (oc && !nc && cm && !el.openingElement.selfClosing) { // the text goes, the comment stays
        const tn = el.children.find((x) => (x.type === 'JSXText' && x.value.trim()) || (x.type === 'JSXExpressionContainer' && x.expression.type !== 'JSXEmptyExpression'));
        if (tn) {
          const ownT = /^[ \t]*$/.test(text.slice(lineStart(text, tn.start), tn.start)) && /^\s*\r?\n/.test(text.slice(tn.end));
          if (tn.type === 'JSXText') { const raw = text.slice(tn.start, tn.end); const a = tn.start + raw.match(/^\s*/)[0].length, b2 = tn.end - raw.match(/\s*$/)[0].length; out.push(ownT ? { start: lineStart(text, a), end: lineEnd(text, b2), text: '' } : { start: a, end: b2, text: '' }); }
          else out.push(ownT ? { start: lineStart(text, tn.start), end: lineEnd(text, tn.end), text: '' } : { start: tn.start, end: tn.end, text: '' });
          return;
        }
      }
      if (!oc && nc) { // `<x ... />` -> `<x ...>` + text + `</x>`
        const oe = el.openingElement;
        if (!oe.selfClosing) return whole(n, el);
        const at = indentOfLine(text, el.start);
        let from = oe.end - 2; if (text[from - 1] === ' ') from--;
        out.push({ start: from, end: oe.end, text: `>${eol}${at}${st.unit}${textText(n, WIDTH - at.length - st.unit.length)}${eol}${at}</${n.tag}>` });
        return;
      }
      // text -> nothing: `<x ...>text</x>` -> `<x ... />`
      const oe = el.openingElement;
      if (oe.selfClosing || !el.closingElement) return whole(n, el);
      out.push({ start: oe.end - 1, end: el.end, text: ' />' });
      return;
    }
    // an element that holds a comment keeps it: children are added or removed around it instead of rewriting the element
    const comment = el.children.find((x) => x.type === 'JSXExpressionContainer' && x.expression.type === 'JSXEmptyExpression');
    if ((!n.children.length || !old.children.length) && !(comment && !el.openingElement.selfClosing && (n.children.length || old.children.length))) return whole(n, el);
    // 3. elements with children: removed children are deleted by their own lines, new ones inserted after the previous sibling that stays
    const oldIds = old.children.map((c) => c.id), newIds = n.children.map((c) => c.id);
    const stay = new Set(lcs(oldIds.filter((i) => newIds.includes(i)), newIds.filter((i) => oldIds.includes(i))));
    const structural = old.children.some((c) => !stay.has(c.id)) || n.children.some((c) => !stay.has(c.id));
    if (structural && !old.children.every((c) => els.get(c.id) && onOwnLines(els.get(c.id)))) return whole(n, el); // children written inline: rewrite this element
    for (const c of old.children) {
      if (stay.has(c.id)) continue;
      const ce = ext(els.get(c.id));
      out.push({ start: lineStart(text, ce.start), end: lineEnd(text, ce.end), text: '' });
    }
    for (const c of n.children) if (stay.has(c.id)) walk(c, A.get(c.id));
    if (!structural) return;
    // new (or moved) children go after the previous sibling that stays, or right after the opening tag
    const childIndent = old.children.length ? indentOfLine(text, ext(els.get(old.children[0].id)).start) : comment && /^[ \t]*$/.test(text.slice(lineStart(text, comment.start), comment.start)) ? indentOfLine(text, comment.start) : indentOfLine(text, el.start) + st.unit;
    const groups = new Map();
    let anchor = null;
    for (const c of n.children) {
      if (stay.has(c.id)) { anchor = c.id; continue; }
      const key = anchor ?? '';
      (groups.get(key) ?? groups.set(key, []).get(key)).push(`${childIndent}${print(c, childIndent)}${eol}`);
    }
    for (const [key, lines] of groups) {
      // after the previous sibling that stays; with none, right before the first element child (after any comments that open the element)
      const first = old.children.length ? ext(els.get(old.children[0].id)) : null;
      const at = key ? lineEnd(text, ext(els.get(key)).end) : first ? lineStart(text, first.start) : lineEnd(text, el.openingElement.end);
      out.push({ start: at, end: at, text: lines.join('') });
    }
  };
  // The text of a leaf: replace only the text node itself (keeping the whitespace round it and any comment beside it).
  function textSplice(el, n) {
    const c = el.children.find((x) => (x.type === 'JSXText' && x.value.trim()) || (x.type === 'JSXExpressionContainer' && x.expression.type !== 'JSXEmptyExpression'));
    if (!c) return null;
    let start = c.start, end = c.end;
    if (c.type === 'JSXText') { const raw = text.slice(c.start, c.end); start += raw.match(/^\s*/)[0].length; end -= raw.match(/\s*$/)[0].length; }
    const ownLine = /^[ \t]*$/.test(text.slice(lineStart(text, start), start));
    const room = ownLine ? WIDTH - indentOfLine(text, start).length : 1000;
    return { start, end, text: textText(n, room) };
  }
  // src / alt, or an instance's props: change the value in place, add after the last attribute, or remove the attribute with the space before it.
  function attrSplices(el, old, n) {
    const oe = el.openingElement, attrs = oe.attributes, sp = [];
    const adds = [];
    const names = n.instance || old.instance ? [...new Set([...Object.keys(old.instance?.props || {}), ...Object.keys(n.instance?.props || {})])] : ['src', 'alt'];
    const valueOf = (x, k) => (n.instance || old.instance ? (x.instance?.props[k] === undefined ? undefined : propValueText(x.instance.props[k])) : x.attrs?.[k] === undefined ? undefined : attrValue(x.attrs[k]));
    for (const k of names) {
      const ov = valueOf(old, k), nv = valueOf(n, k);
      if (ov === nv) continue;
      const a = attrs.find((x) => x.name?.name === k);
      if (nv === undefined) { if (!a) continue; const prev = attrs[attrs.indexOf(a) - 1]; sp.push({ start: prev ? prev.end : a.start, end: a.end, text: '' }); }
      else if (a && a.value) sp.push({ start: a.value.start, end: a.value.end, text: nv });
      else if (a) sp.push({ start: a.start, end: a.end, text: `${k}=${nv}` }); // <X disabled /> written without a value
      else adds.push(`${k}=${nv}`);
    }
    if (adds.length) {
      const last = attrs.at(-1);
      const multi = /\n/.test(text.slice(oe.start, oe.end)) && /^[ \t]*$/.test(text.slice(lineStart(text, last.start), last.start));
      sp.push({ start: last.end, end: last.end, text: multi ? adds.map((x) => eol + indentOfLine(text, last.start) + x).join('') : ` ${adds.join(' ')}` });
    }
    // a single-line tag that no longer fits in 80 columns is laid out again by the caller
    if (adds.length && !/\n/.test(text.slice(oe.start, oe.end))) { // (only a new attribute can push a tag past 80 columns; replacing a value keeps the layout, so it stays a one-line diff)
      const grow = sp.reduce((a, x) => a + x.text.length - (x.end - x.start), 0);
      if (indentOfLine(text, oe.start).length + (oe.end - oe.start) + grow > WIDTH && grow > 0) return null;
    }
    return sp;
  }
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

// The imports a component needs: `ReactNode` in the react type import while a slot prop exists, and one
// `import { X } from './X';` per component used as an instance. Only what changed is touched.
const usesOf = (doc) => new Set([...index(doc).byId.values()].filter((n) => n.instance).map((n) => n.instance.component));
function importSplices(text, parts, before, after) {
  const out = [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const imports = parts.imports || [];
  const needNode = (d) => d.props.some((p) => p.type === 'node');
  if (needNode(before) !== needNode(after)) {
    const react = imports.find((i) => i.source.value === 'react' && i.importKind === 'type');
    if (react) {
      const specs = react.specifiers, at = specs.findIndex((x) => x.imported?.name === 'ReactNode');
      if (needNode(after) && at < 0) out.push({ start: specs.at(-1).end, end: specs.at(-1).end, text: ', ReactNode' });
      else if (!needNode(after) && at >= 0) {
        if (specs.length === 1) { /* leave an import of nothing but ReactNode alone */ }
        else out.push(at > 0 ? { start: specs[at - 1].end, end: specs[at].end, text: '' } : { start: specs[0].start, end: specs[1].start, text: '' });
      }
    }
  }
  const was = usesOf(before), now = usesOf(after);
  const have = (name) => imports.find((i) => i.source.value === `./${name}`);
  const add = [...now].filter((c) => !was.has(c) && !have(c)).sort();
  if (add.length) {
    const last = imports.at(-1);
    const at = last ? lineEnd(text, last.end) : 0;
    out.push({ start: at, end: at, text: (at === text.length && last && !text.endsWith('\n') ? eol : '') + add.map((c) => `import { ${c} } from './${c}';${eol}`).join('') + (last ? '' : eol) });
  }
  for (const c of [...was].filter((x) => !now.has(x))) {
    const imp = have(c);
    if (imp) out.push({ start: lineStart(text, imp.start), end: lineEnd(text, imp.end), text: '' });
  }
  return out;
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
    if (!parts.variants) throw new Error(explainError('component has no variants object'));
    splices.push(...syncObj(original, parts.variants, before.variants, afterVariants, 3, st));
  }
  st.renames = renames;
  splices.push(...importSplices(original, parts, before, after));
  if (!same(before.props, after.props)) {
    splices.push(...ifaceSplices(original, parts, before, after, st));
    for (const sp of [paramsSplice(original, parts, before, after, st), vSplice(original, parts, before, after, st)].flat()) if (sp) splices.push(sp);
  }
  if (!same(shape(before.root), shape(after.root))) {
    // the `return` statement changes form (`return <x />;` <-> `return (` ... `);`) only when the root gains or loses its content
    const rootComment = parts.jsx.children.some((x) => x.type === 'JSXExpressionContainer' && x.expression.type === 'JSXEmptyExpression'); // a root that holds a comment keeps its parentheses
    if (hasContent(before.root) !== hasContent(after.root) && !rootComment) splices.push({ start: parts.ret.start, end: parts.ret.end, text: returnText(original, parts, before, after, st) });
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
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(explainError(`component name "${name}" must be PascalCase`));
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
