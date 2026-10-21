// Write a model back into the component's AST, touching only what changed between two models,
// then print with recast. recast reuses the original text of every AST node we don't replace,
// so a save with no change is byte-identical and one property change is a one-line diff.
import * as recast from 'recast';
import { parse as babelParse } from '@babel/parser';
import { locate, literalValue } from './read.js';
import { index } from '../model.js';

const b = recast.types.builders;
const PRINT = { quote: 'single', trailingComma: true, tabWidth: 2, reuseWhitespace: true, wrapColumn: 120 };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const IDENT = /^[A-Za-z_$][\w$]*$/;
// How the file being written is laid out (set at the top of each writeComponent call, which is synchronous):
// the quote its strings use, so a double-quoted file stays double-quoted.
let Q = "'";

// Literals carry their raw text so quotes come out the way we want (single in code, double in JSX).
function str(value, quote = Q) {
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

// --- props: interface, destructured params, and the `v` object ---
// The interface and `v` go through recast (`v` as raw text: an Identifier whose name is the source, so it stays on
// one line). The parameter list is printed by paramsSplice below. The store re-reads the file after every write,
// so raw nodes never linger.
const raw = (code) => b.identifier(code);
function typeText(p) {
  if (p.type === 'string') return 'string';
  if (p.type === 'boolean') return 'boolean';
  return p.options.map((o) => `${Q}${o}${Q}`).join(' | ');
}
const litText = (v) => (typeof v === 'string' ? `${Q}${v.replace(/\\/g, '\\\\').split(Q).join(`\\${Q}`)}${Q}` : String(v));
function syncProps(ast, parts, before, after) {
  const was = new Map(before.props.map((p) => [p.name, p]));
  const fn = parts.fn;
  if (parts.iface) {
    const members = new Map(parts.iface.body.body.map((m) => [keyName(m.key), m]));
    const kept = after.props.map((p) => {
      const m = members.get(p.name), old = was.get(p.name);
      if (m && old && old.type === p.type && same(old.options, p.options)) return m;
      const sig = b.tsPropertySignature(key(p.name), b.tsTypeAnnotation(b.tsTypeReference(raw(typeText(p)))));
      sig.optional = true;
      return sig;
    });
    parts.iface.body = b.tsInterfaceBody(kept); // reprint the body so every member gets its ';'
  }
  const axesBefore = before.props.filter((p) => p.type === 'enum').map((p) => p.name);
  const axesAfter = after.props.filter((p) => p.type === 'enum').map((p) => p.name);
  if (axesBefore.join() !== axesAfter.join() || !parts.vObj) {
    const obj = raw(axesAfter.length ? `{ ${axesAfter.join(', ')} }` : '{}');
    if (parts.vObj) {
      const st = fn.body.body.find((x) => x.type === 'VariableDeclaration' && x.declarations[0].id.name === 'v');
      st.declarations[0].init = obj;
    } else {
      fn.body.body.unshift(b.variableDeclaration('const', [b.variableDeclarator(b.identifier('v'), obj)]));
    }
  }
}

// --- JSX ---
// The element tree is printed by us, not by recast (recast re-indents moved nodes badly). The unchanged subtrees keep
// their own text, shifted to the new depth; only the elements that changed are printed fresh, one per line:
//   <tag data-n="id" style={s('id', v)}>text</tag>        a leaf
//   <tag data-n="id" style={s('id', v)} />                 an empty element
// and an element with children gets its opening tag, its children one level deeper, and its closing tag.
const attrText = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const attrValue = (s) => (s.includes('"') && !s.includes("'") ? `'${s.replace(/&/g, '&amp;')}'` : `"${attrText(s)}"`);
function openText(node, selfClose) {
  let t = `<${node.tag} data-n="${node.id}" style={s('${node.id}', v)}`;
  for (const k of ['src', 'alt']) if (node.attrs?.[k] !== undefined) t += ` ${k}=${attrValue(node.attrs[k])}`;
  return t + (selfClose ? ' />' : '>');
}
function textText(node) {
  if (node.textProp) return `{${node.textProp}}`;
  if (node.text === undefined || node.text === '') return '';
  if (/^[^{}<>&]+$/.test(node.text) && node.text === node.text.trim()) return node.text;
  return `{${litText(node.text)}}`;
}
const shape = (n) => ({ id: n.id, tag: n.tag, text: n.text, textProp: n.textProp, attrs: n.attrs, children: n.children.map(shape) });
const hasContent = (n) => n.children.length > 0 || textText(n) !== '';

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

// Rebuild the JSX element text of `parts.jsx` (found in `text`) so it matches `after`; returns the new text.
function rewriteJsx(text, jsx, before, after, unit) {
  const els = elementsById(jsx);
  const A = index(before).byId;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rootIndent = lineIndent(text, jsx.start);
  const unchanged = (n) => A.has(n.id) && same(shape(A.get(n.id)), shape(n));
  // The text of an element that did not change, moved to `indent`.
  const reuse = (n, indent) => {
    const el = els.get(n.id);
    const old = lineIndent(text, el.start);
    const lines = text.slice(el.start, el.end).split(/\r?\n/);
    return lines.map((l, i) => (i === 0 ? l : l.startsWith(old) ? indent + l.slice(old.length) : l)).join(eol);
  };
  const print = (n, indent) => {
    if (unchanged(n)) return reuse(n, indent);
    const el = els.get(n.id);
    const old = A.get(n.id);
    const content = hasContent(n);
    // keep the original opening tag (and how it was laid out) when only its content changed
    const sameOpen = el && old && old.tag === n.tag && same(old.attrs, n.attrs) && hasContent(old) === content;
    const open = sameOpen ? text.slice(el.openingElement.start, el.openingElement.end) : openText(n, !content);
    if (!content) return open;
    const close = `</${n.tag}>`;
    if (!n.children.length) return `${open}${textText(n)}${close}`;
    const inner = indent + unit;
    return [open, ...n.children.map((c) => inner + print(c, inner)), indent + close].join(eol);
  };
  return print(after.root, rootIndent);
}

// recast separates reprinted multi-line object entries with blank lines. The dialect has none, so
// drop blank lines that weren't in the original text (an LCS line diff finds the inserted ones).
function dropInsertedBlankLines(original, out) {
  const a = original.split('\n'), o = out.split('\n');
  const n = a.length, m = o.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === o[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = [];
  let i = 0, j = 0;
  while (j < m) {
    if (i < n && a[i] === o[j]) { keep.push(o[j]); i++; j++; }
    else if (i < n && L[i + 1][j] >= L[i][j + 1]) i++;
    else { if (o[j].trim() !== '') keep.push(o[j]); j++; }
  }
  return keep.join('\n');
}

// How the file is written, so what we add looks like what is there: line endings, tabs or spaces (and how many), quotes.
function detectStyle(text) {
  const useTabs = /^\t/m.test(text);
  const widths = (text.match(/^ {2,}(?=\S)/gm) || []).map((x) => x.length);
  const width = useTabs ? 2 : Math.min(8, widths.length ? Math.min(...widths) : 2);
  const single = (text.match(/[:=] '/g) || []).length, double = (text.match(/[:=] "[^"\n]*"[,;]?$/gm) || []).length;
  const quote = double > single ? '"' : "'";
  return {
    unit: useTabs ? '\t' : ' '.repeat(width),
    quote,
    recast: { quote: quote === '"' ? 'double' : 'single', tabWidth: width, ...(text.includes('\r\n') && { lineTerminator: '\r\n' }), ...(useTabs && { useTabs: true }) },
  };
}

// The destructured parameter list, printed by us so it hugs the braces the way prettier writes it:
//   export function Name({ a, b = 1 }: NameProps) {          when the whole signature fits in 80 columns
//   export function Name({\n  a,\n  b = 1,\n}: NameProps) {   when it does not (one prop per line)
// If only a default changed the file's own layout is kept. Props whose name and default did not change keep their text.
// Returns { start, end, text } for the text it replaces, or null when the list does not change.
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
  const sameNames = same(before.props.map((p) => p.name), after.props.map((p) => p.name));
  const wasMulti = param ? /\n/.test(text.slice(param.start, param.end)) : false;
  const fits = `export function ${fn.id.name}(${flat}) {`.length <= 80;
  const multi = items.length > 0 && (sameNames ? wasMulti : !fits);
  const indent = lineIndent(text, parts.fnStmt.start);
  const out = multi ? `{${eol}${items.map((x) => `${indent}${st.unit}${x},${eol}`).join('')}${indent}}: ${iface}` : flat;
  return param ? { start: param.start, end: param.end, text: out } : { start: fn.id.end + 1, end: fn.id.end + 1, text: out };
}

// Patch `ast` (from readComponent, parsed from `original`) from model `before` to model `after`; returns the new text.
export function writeComponent(ast, before, after, original) {
  if (same(before, after)) return original; // nothing to change: the bytes stay exactly as they were
  const st = detectStyle(original);
  Q = st.quote;
  const parts = locate(ast);
  if (!same(before.props, after.props)) syncProps(ast, parts, before, after);
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
  if (!same(before.variants, after.variants)) {
    if (!parts.variants) throw new Error('component has no variants object');
    syncNested(parts.variants, before.variants, after.variants, 2);
  }
  let out = recast.print(ast, { ...PRINT, ...st.recast }).code;
  // The pieces recast does not print well are spliced in by offset, last one first so earlier offsets stay valid:
  // the parameter list and the element tree (and an empty interface body, which prettier writes as `{}`).
  const jsxChanged = !same(shape(before.root), shape(after.root));
  const propsChanged = !same(before.props, after.props);
  if (jsxChanged || propsChanged) {
    const p2 = locate(babelParse(out, { sourceType: 'module', plugins: ['typescript', 'jsx'] }));
    const splices = [];
    if (jsxChanged) splices.push({ start: p2.jsx.start, end: p2.jsx.end, text: rewriteJsx(out, p2.jsx, before, after, st.unit) });
    if (propsChanged) {
      const ps = paramsSplice(out, p2, before, after, st);
      if (ps) splices.push(ps);
      if (!after.props.length && p2.iface && /\{\s+\}$/.test(out.slice(p2.iface.body.start, p2.iface.body.end))) splices.push({ start: p2.iface.body.start, end: p2.iface.body.end, text: '{}' });
    }
    for (const sp of splices.sort((x, y) => y.start - x.start)) out = out.slice(0, sp.start) + sp.text + out.slice(sp.end);
  }
  return out === original ? out : dropInsertedBlankLines(original, out);
}

// Source for a brand-new component: one root frame, no props.
export function newComponentSource(name, rootTag = 'div') {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`component name "${name}" must be PascalCase`);
  return `import type { CSSProperties } from 'react';

export interface ${name}Props {
}

const base: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 16,
  },
};

const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function ${name}({}: ${name}Props) {
  const v = {};
  return (
    <${rootTag} data-n="root" style={s('root', v)} />
  );
}
`;
}
