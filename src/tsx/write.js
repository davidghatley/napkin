// Write a model back into the component's AST, touching only what changed between two models,
// then print with recast. recast reuses the original text of every AST node we don't replace,
// so a save with no change is byte-identical and one property change is a one-line diff.
import * as recast from 'recast';
import { parse as babelParse } from '@babel/parser';
import { locate, literalValue, parseAst } from './read.js';
import { index } from '../model.js';

const b = recast.types.builders;
const PRINT = { quote: 'single', trailingComma: true, tabWidth: 2, reuseWhitespace: true, wrapColumn: 120 };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const IDENT = /^[A-Za-z_$][\w$]*$/;
// How the file being written is laid out (set at the top of each writeComponent call, which is synchronous):
// the quote its strings use, so a double-quoted file stays double-quoted.
let Q = "'";

// The quote prettier picks for a string: the file's quote, unless the string holds more of it than of the other one.
const quoteFor = (value) => {
  const other = Q === "'" ? '"' : "'";
  return value.split(Q).length > value.split(other).length ? other : Q;
};
// Literals carry their raw text so quotes come out the way we want (the file's quote in code, double in JSX).
function str(value, quote) {
  quote ??= quoteFor(value);
  const lit = b.stringLiteral(value);
  const body = JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"');
  lit.extra = { rawValue: value, raw: quote === "'" ? `'${body.replace(/'/g, "\\'")}'` : `"${body.replace(/"/g, '\\"')}"` };
  return lit;
}
function lit(value) {
  if (typeof value === 'string') return str(value);
  if (typeof value === 'boolean') return b.booleanLiteral(value);
  if (value < 0) return b.unaryExpression('-', b.numericLiteral(-value));
  return b.numericLiteral(value);
}
const key = (k) => (IDENT.test(k) ? b.identifier(k) : str(k));
const keyName = (k) => (k.type === 'Identifier' ? k.name : k.value);
const findProp = (obj, k) => obj.properties.find((p) => keyName(p.key) === k);
const prop = (k, v) => b.objectProperty(key(k), v);

// --- object literals: base and variants ---
function syncStyle(obj, before, after) {
  for (const k of Object.keys(before)) if (!(k in after)) obj.properties.splice(obj.properties.indexOf(findProp(obj, k)), 1);
  for (const [k, v] of Object.entries(after)) {
    const p = findProp(obj, k);
    if (!p) obj.properties.push(prop(k, lit(v)));
    else if (literalValue(p.value) !== v) p.value = lit(v);
  }
}
// A nested object: levels of plain keys ending in style objects. Removes empty branches.
function syncNested(obj, before, after, depth) {
  for (const k of Object.keys(before)) if (!(k in after)) obj.properties.splice(obj.properties.indexOf(findProp(obj, k)), 1);
  for (const [k, v] of Object.entries(after)) {
    let p = findProp(obj, k);
    if (!p) { p = prop(k, b.objectExpression([])); obj.properties.push(p); }
    if (depth === 0) syncStyle(p.value, before[k] || {}, v);
    else syncNested(p.value, before[k] || {}, v, depth - 1);
  }
}
const baseMap = (doc) => Object.fromEntries([...index(doc).byId.values()].map((n) => [n.id, n.style]));

// --- props: the interface, the destructured parameter list, and `const v` ---
// All three are text splices made after recast has printed the style objects (see writeComponent): recast prints them
// in its own layout, and these have to look the way prettier writes them. Members, parameters and the `v` object that
// did not change keep their text.
function typeText(p, indent, unit, eol, name) {
  if (p.type === 'string') return 'string';
  if (p.type === 'boolean') return 'boolean';
  const opts = p.options.map((o) => `${Q}${o}${Q}`);
  const one = opts.join(' | ');
  if (`${indent}${name}?: ${one};`.length <= 80) return one;
  return `${eol}${opts.map((o) => `${indent}${unit}| ${o}`).join(eol)}`; // prettier's layout for a union that does not fit
}
const litText = (v) => { if (typeof v !== 'string') return String(v); const q = quoteFor(v); return `${q}${v.replace(/\\/g, '\\\\').split(q).join(`\\${q}`)}${q}`; };
const lineStart = (text, at) => text.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (text, at) => { const i = text.indexOf('\n', at); return i < 0 ? text.length : i + 1; };

// --- the interface ---
function ifaceSplices(text, parts, before, after, st) {
  const iface = parts.iface;
  if (!iface || same(before.props.map((p) => [p.name, p.type, p.options]), after.props.map((p) => [p.name, p.type, p.options]))) return [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const outer = lineIndent(text, parts.ifaceStmt.start), indent = outer + st.unit;
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
  const out = multi ? `{${eol}${items.map((x) => `${indent}${st.unit}${x},${eol}`).join('')}${indent}}: ${iface}` : flat;
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
// The element tree is printed by us, not by recast (recast re-indents moved nodes badly). Unchanged subtrees keep their
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
function printJsx(text, jsx, before, after, st, indent) {
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
  return print(after.root, indent);
}

// The whole `return ...;` statement: `return <x />;` when a single line fits, else `return (` + the tree + `);`.
function returnText(text, parts, before, after, st) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const ind = lineIndent(text, parts.ret.start);
  const tree = printJsx(text, parts.jsx, before, after, st, ind + st.unit);
  const single = `return ${tree};`;
  return !tree.includes('\n') && ind.length + single.length <= WIDTH ? single : `return (${eol}${ind}${st.unit}${tree}${eol}${ind});`;
}

// recast separates reprinted multi-line object entries with blank lines. The dialect has none, so
// drop blank lines that weren't in the original text (an LCS line diff finds the inserted ones).
// For each line of `b`, the index of the line of `a` it is (same text, order kept: a longest common subsequence), or -1.
function alignLines(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const from = new Array(m).fill(-1);
  let i = 0, j = 0;
  while (j < m && i < n) {
    if (a[i] === b[j]) from[j++] = i++;
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return from;
}
function dropInsertedBlankLines(original, out) {
  const o = out.split('\n');
  const from = alignLines(original.split('\n'), o);
  return o.filter((l, j) => from[j] >= 0 || l.trim() !== '').join('\n');
}
// A tab-indented file is edited as if it used four spaces per level (recast mixes tabs and spaces when it reprints);
// lines that did not change get their original text back, new lines are indented with tabs.
function restoreTabs(spaced, out, original) {
  const o = out.split('\n'), orig = original.split('\n');
  const from = alignLines(spaced.split('\n'), o);
  return o.map((l, j) => (from[j] >= 0 ? orig[from[j]] : l.replace(/^( {4})+/, (m) => '\t'.repeat(m.length / 4)))).join('\n');
}

// How the file is written, so what we add looks like what is there: line endings, tabs or spaces (and how many), quotes.
// (A tab prints with recast's tabWidth 4 because parseAst reads a tab as 4 columns; the two must agree.)
function detectStyle(text) {
  const useTabs = /^\t/m.test(text);
  const widths = (text.match(/^ {2,}(?=\S)/gm) || []).map((x) => x.length);
  const width = useTabs ? 2 : Math.min(8, widths.length ? Math.min(...widths) : 2);
  const single = (text.match(/[:=] '/g) || []).length, double = (text.match(/[:=] "[^"\n]*"[,;]?$/gm) || []).length;
  const quote = double > single ? '"' : "'";
  return {
    unit: useTabs ? '\t' : ' '.repeat(width),
    quote,
    recast: { quote: quote === '"' ? 'double' : 'single', tabWidth: useTabs ? 4 : width, ...(text.includes('\r\n') && { lineTerminator: '\r\n' }), ...(useTabs && { useTabs: true }) },
  };
}

// A prop or a variant value that kept its place but changed its name is a rename (the model's renameProp / renameVariant):
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
// `variants` with the renames applied, key order kept.
function renameVariantsKeys(variants, renames) {
  const axisTo = new Map(renames.props);
  const out = {};
  for (const [axis, vals] of Object.entries(variants)) {
    const r = renames.values.find((x) => x.axis === axis);
    out[axisTo.get(axis) ?? axis] = r ? Object.fromEntries(Object.entries(vals).map(([k, v]) => [k === r.from ? r.toValue : k, v])) : vals;
  }
  return out;
}

// Patch `ast` (from readComponent, parsed from `original`) from model `before` to model `after`; returns the new text.
export function writeComponent(ast, before, after, original) {
  if (same(before, after)) return original; // nothing to change: the bytes stay exactly as they were
  const tabbed = /^\t/m.test(original);
  const src = tabbed ? original.replace(/^\t+/gm, (m) => '    '.repeat(m.length)) : original;
  if (tabbed) ast = parseAst(src);
  const st = detectStyle(src);
  Q = st.quote;
  const parts = locate(ast);
  const bb = baseMap(before), ba = baseMap(after);
  if (!same(bb, ba)) {
    // Only entries that exist in the file or have styles: an unstyled node without a base entry
    // stays without one, so inserting a bare element adds one line, not an empty block.
    const inFile = (k) => !!findProp(parts.base, k);
    const from = Object.fromEntries(Object.keys(bb).filter(inFile).map((k) => [k, bb[k]]));
    // a node whose last style was just removed loses its (now empty) block
    const to = Object.fromEntries(Object.entries(ba).filter(([k, st]) => Object.keys(st).length || (inFile(k) && !Object.keys(bb[k] || {}).length)));
    syncNested(parts.base, from, to, 0);
  }
  const renames = findRenames(before, after);
  let wasVariants = before.variants;
  if (renames.props.length || renames.values.length) { // rename the keys in place, then diff against the renamed "before"
    if (parts.variants) {
      for (const [from, to] of renames.props) { const pr = findProp(parts.variants, from); if (pr) pr.key = key(to); }
      for (const r of renames.values) { const axisObj = findProp(parts.variants, r.to)?.value; const pr = axisObj && findProp(axisObj, r.from); if (pr) pr.key = key(r.toValue); }
    }
    wasVariants = renameVariantsKeys(before.variants, renames);
  }
  if (!same(wasVariants, after.variants)) {
    if (!parts.variants) throw new Error('component has no variants object');
    syncNested(parts.variants, wasVariants, after.variants, 2);
  }
  st.renames = renames;
  let out = recast.print(ast, { ...PRINT, ...st.recast }).code;
  // The pieces recast does not print the way we want are spliced in by offset, last one first so earlier offsets stay valid:
  // the interface, the parameter list, `const v`, and the `return` with its element tree.
  const jsxChanged = !same(shape(before.root), shape(after.root));
  const propsChanged = !same(before.props, after.props);
  if (jsxChanged || propsChanged) {
    const p2 = locate(babelParse(out, { sourceType: 'module', plugins: ['typescript', 'jsx'] }));
    const splices = [];
    if (jsxChanged) splices.push({ start: p2.ret.start, end: p2.ret.end, text: returnText(out, p2, before, after, st) });
    if (propsChanged) {
      splices.push(...ifaceSplices(out, p2, before, after, st));
      for (const sp of [paramsSplice(out, p2, before, after, st), vSplice(out, p2, before, after, st)]) if (sp) splices.push(sp);
    }
    for (const sp of splices.sort((x, y) => y.start - x.start)) out = out.slice(0, sp.start) + sp.text + out.slice(sp.end);
  }
  const result = out === src ? out : dropInsertedBlankLines(src, out);
  return tabbed ? restoreTabs(src, result, original) : result;
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
