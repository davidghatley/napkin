// Write a model back into the component's AST, touching only what changed between two models,
// then print with recast. recast reuses the original text of every AST node we don't replace,
// so a save with no change is byte-identical and one property change is a one-line diff.
import { explainError } from '../errors.js';
import * as recast from 'recast';
import { locate, literalValue } from './read.js';
import { index } from '../model.js';

const b = recast.types.builders;
const PRINT = { quote: 'single', trailingComma: true, tabWidth: 2, reuseWhitespace: true, wrapColumn: 120 };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const IDENT = /^[A-Za-z_$][\w$]*$/;

// Literals carry their raw text so quotes come out the way we want (single in code, double in JSX).
function str(value, quote = "'") {
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
// A new key goes right after the key before it in the new model's order (the end for an ordinary add), so an undo puts it back where it was.
function place(obj, order, k, node) {
  const prev = order.slice(0, order.indexOf(k)).reverse().find((q) => findProp(obj, q));
  obj.properties.splice(prev === undefined ? 0 : obj.properties.indexOf(findProp(obj, prev)) + 1, 0, node);
}
function syncStyle(obj, before, after) {
  for (const k of Object.keys(before)) if (!(k in after)) obj.properties.splice(obj.properties.indexOf(findProp(obj, k)), 1);
  for (const [k, v] of Object.entries(after)) {
    const p = findProp(obj, k);
    if (!p) place(obj, Object.keys(after), k, prop(k, lit(v)));
    else if (literalValue(p.value) !== v) p.value = lit(v);
  }
}
// A nested object: levels of plain keys ending in style objects. Removes empty branches.
function syncNested(obj, before, after, depth) {
  for (const k of Object.keys(before)) if (!(k in after)) obj.properties.splice(obj.properties.indexOf(findProp(obj, k)), 1);
  for (const [k, v] of Object.entries(after)) {
    let p = findProp(obj, k);
    if (!p) { p = prop(k, b.objectExpression([])); place(obj, Object.keys(after), k, p); }
    if (depth === 0) syncStyle(p.value, before[k] || {}, v);
    else syncNested(p.value, before[k] || {}, v, depth - 1);
  }
}
const baseMap = (doc) => Object.fromEntries([...index(doc).byId.values()].map((n) => [n.id, n.style]));

// --- props: interface, destructured params, and the `v` object ---
// Params and `v` are written as raw text (an Identifier whose name is the source), so they stay on
// one line when they fit. The store re-reads the file after every write, so raw nodes never linger.
const raw = (code) => b.identifier(code);
function typeText(p) {
  if (p.type === 'string') return 'string';
  if (p.type === 'boolean') return 'boolean';
  return p.options.map((o) => `'${o}'`).join(' | ');
}
const litText = (v) => (typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(v));
function syncProps(ast, parts, before, after) {
  const was = new Map(before.props.map((p) => [p.name, p]));
  const fn = parts.fn;
  const iface = parts.iface?.id.name || `${fn.id.name}Props`;
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
  const one = after.props.map((p) => (p.default === undefined ? p.name : `${p.name} = ${litText(p.default)}`));
  const indent = ' '.repeat((fn.loc?.start.column ?? 0) + 2);
  const flat = `{ ${one.join(', ')} }: ${iface}`;
  const text = !one.length ? `{}: ${iface}` : flat.length + fn.id.name.length + 20 <= 120 ? flat : `{\n${one.map((x) => `${indent}${x},`).join('\n')}\n}: ${iface}`;
  if (!same(before.props.map((p) => [p.name, p.default]), after.props.map((p) => [p.name, p.default]))) fn.params = [raw(text)];
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
// Changed child lists are rebuilt from real nodes so recast handles indentation: unchanged children
// are the original AST nodes (reprinted verbatim), new ones are built with a raw tag name that
// carries their attributes, so quoting is ours.
function elementsById(jsx) {
  const m = new Map();
  (function walk(el) {
    const a = el.openingElement.attributes.find((x) => x.name?.name === 'data-n');
    if (a) m.set(a.value.value, el);
    for (const c of el.children) if (c.type === 'JSXElement') walk(c);
  })(jsx);
  return m;
}
const attrText = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function textNodes(node) {
  if (node.textProp) return [b.jsxExpressionContainer(raw(node.textProp))];
  if (node.text === undefined || node.text === '') return [];
  if (/^[^{}<>&]+$/.test(node.text) && node.text === node.text.trim()) return [b.jsxText(node.text)];
  return [b.jsxExpressionContainer(raw(litText(node.text)))];
}
function openName(node) {
  let t = `${node.tag} data-n="${node.id}" style={s('${node.id}', v)}`;
  for (const k of ['src', 'alt']) if (node.attrs?.[k] !== undefined) t += ` ${k}="${attrText(node.attrs[k])}"`;
  return b.jsxIdentifier(t);
}
function childNodes(node, els, reuse) {
  if (!node.children.length) return textNodes(node);
  return node.children.flatMap((c) => [b.jsxText('\n'), element(c, els, reuse)]).concat(b.jsxText('\n'));
}
function element(node, els, reuse) {
  const el = els.get(node.id);
  if (el && reuse.has(node.id)) return el;
  const kids = childNodes(node, els, reuse);
  if (el) { // existing element whose own children changed: keep its opening tag
    setKids(el, kids);
    return el;
  }
  const open = b.jsxOpeningElement(openName(node), [], !kids.length);
  return b.jsxElement(open, kids.length ? b.jsxClosingElement(b.jsxIdentifier(node.tag)) : null, kids);
}
function setKids(el, kids) {
  const open = el.openingElement;
  if (!kids.length) { open.selfClosing = true; el.closingElement = null; el.children = []; return; }
  if (open.selfClosing) { open.selfClosing = false; el.closingElement = b.jsxClosingElement(b.jsxIdentifier(open.name.name)); }
  el.children = kids;
}
function syncJsx(parts, before, after) {
  const els = elementsById(parts.jsx);
  const A = index(before).byId;
  const shape = (n) => ({ id: n.id, tag: n.tag, text: n.text, textProp: n.textProp, attrs: n.attrs, children: n.children.map(shape) });
  const reuse = new Set([...index(after).byId.values()].filter((n) => A.has(n.id) && same(shape(A.get(n.id)), shape(n))).map((n) => n.id));
  (function walk(node) {
    const el = els.get(node.id);
    const old = A.get(node.id);
    if (!el || !old || reuse.has(node.id)) return;
    for (const k of ['src', 'alt']) {
      if (old.attrs?.[k] === node.attrs?.[k]) continue;
      const attrs = el.openingElement.attributes;
      const i = attrs.findIndex((a) => a.name?.name === k);
      if (node.attrs?.[k] === undefined) attrs.splice(i, 1);
      else if (i >= 0) attrs[i] = b.jsxAttribute(b.jsxIdentifier(k), str(node.attrs[k], '"')); // a new node, so the quotes stay double like the rest of the JSX
      else attrs.push(b.jsxAttribute(b.jsxIdentifier(k), str(node.attrs[k], '"')));
    }
    const kidsChanged = !same(old.children.map((c) => c.id), node.children.map((c) => c.id));
    const textChanged = old.text !== node.text || old.textProp !== node.textProp;
    if (kidsChanged || textChanged) { setKids(el, childNodes(node, els, reuse)); return; }
    for (const c of node.children) walk(c);
  })(after.root);
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

// A rename (model op `rename`) changes an id in place: same tree shape, different data-n. Finds the
// old -> new ids by walking both trees together, renames them everywhere in the AST (data-n, s('id', v),
// base and variants keys) and returns `before` with the new ids, so the rest of the diff sees no change.
function applyRenames(parts, before, after) {
  const map = new Map();
  const was = index(before).byId, now = index(after).byId;
  (function walk(a, c) {
    if (a.tag !== c.tag || a.children.length !== c.children.length) return;
    if (a.id !== c.id && !now.has(a.id) && !was.has(c.id)) map.set(a.id, c.id); // a reorder keeps both ids; a rename drops one and adds one
    a.children.forEach((x, i) => walk(x, c.children[i]));
  })(before.root, after.root);
  if (!map.size) return before;
  const to = (id) => map.get(id) ?? id;
  (function el(e) {
    for (const a of e.openingElement.attributes) {
      const lit = a.name?.name === 'data-n' ? a.value : a.name?.name === 'style' ? a.value.expression.arguments[0] : null;
      if (!lit || !map.has(lit.value)) continue;
      const q = a.name.name === 'data-n' ? '"' : "'";
      if (q === '"') a.value = raw(`"${to(lit.value)}"`); // verbatim, so the file keeps JSX double quotes
      else { lit.value = to(lit.value); lit.extra = { rawValue: lit.value, raw: `${q}${lit.value}${q}` }; }
    }
    for (const c of e.children) if (c.type === 'JSXElement') el(c);
  })(parts.jsx);
  const rekey = (obj) => { for (const p of obj.properties) if (map.has(keyName(p.key))) p.key = key(to(keyName(p.key))); };
  rekey(parts.base);
  if (parts.variants) for (const axis of parts.variants.properties) for (const val of axis.value.properties) rekey(val.value);
  const moved = structuredClone(before);
  (function ids(n) { n.id = to(n.id); n.children.forEach(ids); })(moved.root);
  for (const vals of Object.values(moved.variants)) for (const nodes of Object.values(vals)) for (const id of Object.keys(nodes)) if (map.has(id)) { nodes[to(id)] = nodes[id]; delete nodes[id]; }
  return moved;
}

// Patch `ast` (from readComponent, parsed from `original`) from model `before` to model `after`; returns the new text.
export function writeComponent(ast, before, after, original) {
  const parts = locate(ast);
  before = applyRenames(parts, before, after);
  if (!same(before.props, after.props)) syncProps(ast, parts, before, after);
  const bb = baseMap(before), ba = baseMap(after);
  if (!same(bb, ba)) {
    // Only entries that exist in the file, have styles, or belong to new nodes; an unstyled node
    // without a base entry stays without one, so a save doesn't add noise.
    const inFile = (k) => !!findProp(parts.base, k);
    const from = Object.fromEntries(Object.keys(bb).filter(inFile).map((k) => [k, bb[k]]));
    const to = Object.fromEntries(Object.entries(ba).filter(([k, st]) => inFile(k) || Object.keys(st).length || !(k in bb)));
    syncNested(parts.base, from, to, 0);
  }
  if (!same(before.variants, after.variants)) {
    if (!parts.variants) throw new Error(explainError('component has no variants object'));
    syncNested(parts.variants, before.variants, after.variants, 2);
  }
  syncJsx(parts, before, after);
  // keep the dialect's `return (\n    <jsx>\n  );` shape when recast collapses a one-line root
  // recast prints a replaced JSX attribute value with its own quote setting; the dialect's JSX is double-quoted, so put the quotes back
  const out = recast.print(ast, PRINT).code.replace(/^.*data-n=".*$/gm, (l) => l.replace(/ (src|alt)='([^'"\\]*)'/g, ' $1="$2"')).replace(/^( *)return \((<.*>)\);$/m, (_, pad, jsx) => `${pad}return (\n${pad}  ${jsx}\n${pad});`);
  return original === undefined || out === original ? out : dropInsertedBlankLines(original, out);
}

// Source for a brand-new component: one root frame, no props.
export function newComponentSource(name, rootTag = 'div') {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(explainError(`component name "${name}" must be PascalCase`));
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
