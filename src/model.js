import { explainError } from './errors.js';
// The component model (napkin/1, decision 0003) and its one edit path (F02).
// A model is what napkin reads out of a component .tsx file:
//   { format: 'napkin/1', name, props, root, variants }
//   props:    [{ name, type: 'string' | 'boolean' | 'enum' | 'number' | 'node', options?: [..], default? }]
//             an enum prop is a variant axis; its default is the axis's base value; a 'node' prop is a ReactNode slot (decision 0004)
//   root:     { id, tag, style: {}, text?: string, textProp?: string, attrs?: { src?, alt? }, children: [], when?: 'boolProp', slot?: 'nodeProp', instance?: { component, props } }
//             a node holds child elements OR one text (a string, or a prop: "a setting") OR a slot ({children});
//             `when` shows it only while that boolean prop is true; `instance` makes it another component (tag = its name)
//   variants: { [axis]: { [value]: { [nodeId]: { [cssProp]: value } } } }   overrides only
// Pure: no Node imports, so the canvas page can load it too.
import { CSS_PROPS, CSS_NUMBER_PROPS } from './css-props.js';

export class EditError extends Error {
  constructor(index, message) {
    super(explainError(`invalid edit #${index}: ${message}`, { next: "read the component and /api/guide, correct edit #" + index + ", and retry." }));
    this.index = index;
  }
}

export const TAGS = new Set(['div', 'span', 'p', 'button', 'img', 'a', 'section', 'article', 'header', 'footer', 'nav', 'ul', 'li', 'h1', 'h2', 'h3', 'h4', 'label', 'strong', 'em', 'small']);
export const VOID = new Set(['img']);
export const ATTRS = ['src', 'alt'];
const CSS_PROP = /^[a-z][a-zA-Z]*$/;
const NODE_ID = /^[a-z][a-zA-Z0-9_]*$/;
const PROP_NAME = /^[a-z][a-zA-Z0-9]*$/;
const OPTION = /^[a-zA-Z0-9_-]+$/;
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;
export const PROP_TYPES = ['string', 'boolean', 'enum', 'number', 'node'];
// A node that can hold child elements: not an <img>, not another component, not showing text or a slot.
const holdsText = (n) => n.text !== undefined || !!n.textProp || !!n.slot;
const canHold = (n) => !VOID.has(n.tag) && !n.instance && !holdsText(n);
const RESERVED = new Set(['v', 's', 'base', 'variants', 'children', 'key', 'ref', 'style', 'class', 'default', 'new', 'delete', 'function', 'return', 'const', 'let', 'var', 'this']);

export function index(doc) {
  const byId = new Map();
  const parentOf = new Map();
  (function walk(node, parent) {
    byId.set(node.id, node);
    if (parent) parentOf.set(node.id, parent);
    for (const c of node.children || []) walk(c, node);
  })(doc.root, null);
  return { byId, parentOf };
}

export const propOf = (doc, name) => doc.props.find((p) => p.name === name);
export const axes = (doc) => doc.props.filter((p) => p.type === 'enum');

// The style a node shows for one variant (e.g. { size: 'sm', state: 'hover' }): base + overrides, axes in prop order.
export function resolveStyle(doc, nodeId, variant = {}) {
  const node = index(doc).byId.get(nodeId);
  const out = { ...(node?.style || {}) };
  for (const a of axes(doc)) {
    const value = variant[a.name] ?? a.default;
    Object.assign(out, doc.variants?.[a.name]?.[value]?.[nodeId]);
  }
  return out;
}

// Every combination of axis values, base first. [{}] when the component has no axes.
export function variantGrid(doc) {
  let rows = [{}];
  for (const a of axes(doc)) rows = rows.flatMap((r) => a.options.map((o) => ({ ...r, [a.name]: o })));
  return rows;
}

export function getValue(doc, path, variant) {
  const [id, prop] = String(path).split('.');
  const node = index(doc).byId.get(id);
  if (!node) return undefined;
  if (prop === 'text') return node.textProp ? { prop: node.textProp } : node.text;
  if (prop?.startsWith('@')) return node.attrs?.[prop.slice(1)];
  if (variant) {
    const [[axis, value]] = Object.entries(variant);
    return doc.variants?.[axis]?.[value]?.[id]?.[prop];
  }
  return node.style?.[prop];
}

// --- keys a batch touches, for revision conflict checks (F03) ---
// set -> "node.prop" or "node.prop@axis=value"; structure -> "children:<parent>" + "node:<id>"; props -> "prop:<name>".
export function touched(edits) {
  const keys = new Set();
  for (const e of edits) {
    switch (e?.op) {
      case 'set': keys.add(e.variant ? `${e.path}@${Object.entries(e.variant).map(([a, v]) => `${a}=${v}`).join(',')}` : e.path); break;
      case 'insert': keys.add(`children:${e.parent}`); keys.add(`node:${e.node?.id}`); break;
      case 'delete': keys.add(`node:${e.id}`); break;
      case 'rename': keys.add(`node:${e.id}`); keys.add(`node:${e.to}`); break;
      case 'insertInstance': keys.add(`children:${e.parent}`); keys.add(`node:${e.id}`); break;
      case 'swapInstance': keys.add(`node:${e.id}`); break;
      case 'move': keys.add(`node:${e.id}`); keys.add(`children:${e.parent}`); break;
      case 'duplicate': case 'paste': keys.add(`children:${e.op === 'paste' ? e.parent : `of:${e.id}`}`); break;
      case 'wrap': for (const id of e.ids || []) keys.add(`node:${id}`); keys.add(`node:${e.id}`); keys.add(`children:of:${e.ids?.[0]}`); break;
      case 'unwrap': keys.add(`node:${e.id}`); keys.add(`children:of:${e.id}`); break;
      case 'addProp': case 'removeProp': case 'setDefault': keys.add(`prop:${e.name}`); break;
      case 'renameProp': keys.add(`prop:${e.name}`); keys.add(`prop:${e.to}`); break;
      case 'renameVariant': keys.add(`prop:${e.axis}`); break;
      case 'bindText': keys.add(`${e.id}.text`); if (e.prop) keys.add(`prop:${e.prop}`); break;
      case 'addVariant': case 'removeVariant': keys.add(`prop:${e.axis}`); break;
      default: keys.add(`op:${e?.op}`);
    }
  }
  return keys;
}

const nodeOf = (k) => (k.startsWith('node:') ? k.slice(5) : k.startsWith('children:') ? k.slice(9) : k.startsWith('prop:') ? k : k.split('.')[0]);
export function conflicts(a, b) {
  for (const k of a) if (b.has(k)) return true;
  const whole = (s) => new Set([...s].filter((k) => k.startsWith('node:')).map(nodeOf));
  const wa = whole(a), wb = whole(b);
  for (const k of a) if (wb.has(nodeOf(k))) return true;
  for (const k of b) if (wa.has(nodeOf(k))) return true;
  return false;
}

// Keys that differ between two models (for whole-file changes such as git restore).
export function diffKeys(before, after) {
  const keys = new Set();
  const A = index(before).byId, B = index(after).byId;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  for (const id of new Set([...A.keys(), ...B.keys()])) {
    const a = A.get(id), b = B.get(id);
    if (!a || !b || a.tag !== b.tag) { keys.add(`node:${id}`); continue; }
    if (a.text !== b.text || a.textProp !== b.textProp || a.slot !== b.slot) keys.add(`${id}.text`);
    if (a.when !== b.when) keys.add(`${id}.@when`);
    if (!same(a.instance, b.instance)) keys.add(`node:${id}`);
    for (const p of new Set([...Object.keys(a.style), ...Object.keys(b.style)])) if (a.style[p] !== b.style[p]) keys.add(`${id}.${p}`);
    for (const p of ATTRS) if (a.attrs?.[p] !== b.attrs?.[p]) keys.add(`${id}.@${p}`);
    if (!same(a.children.map((c) => c.id), b.children.map((c) => c.id))) keys.add(`children:${id}`);
  }
  for (const name of new Set([...before.props, ...after.props].map((p) => p.name))) {
    if (!same(propOf(before, name), propOf(after, name))) keys.add(`prop:${name}`);
  }
  const flat = (doc) => {
    const m = new Map();
    for (const [axis, vals] of Object.entries(doc.variants)) for (const [val, nodes] of Object.entries(vals))
      for (const [id, st] of Object.entries(nodes)) for (const [p, x] of Object.entries(st)) m.set(`${id}.${p}@${axis}=${val}`, x);
    return m;
  };
  const fa = flat(before), fb = flat(after);
  for (const k of new Set([...fa.keys(), ...fb.keys()])) if (fa.get(k) !== fb.get(k)) keys.add(k);
  if (before.name !== after.name) keys.add('meta.name');
  return keys;
}

// --- validation helpers ---
// A CSS value may hold ; { } < > inside quotes or parentheses (url(data:image/png;base64,...), 'a;b'); outside them they would end the declaration.
export function unsafeCssValue(value) {
  let d = 0, q = '';
  for (const ch of value) {
    if (/[\n`\\]/.test(ch)) return true;
    if (q) { if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '(') d++; else if (ch === ')') { d--; if (d < 0) return true; }
    else if (d === 0 && /[;{}<>]/.test(ch)) return true;
  }
  return d !== 0 || q !== '';
}
function checkValue(i, path, value) {
  // only real CSS properties, and numbers only where React's CSSProperties takes them: the file must pass `tsc --strict`
  const prop = path.slice(path.lastIndexOf('.') + 1);
  if (!CSS_PROPS.has(prop)) throw new EditError(i, `unknown CSS property "${prop}"`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EditError(i, `value for ${path} must be finite`);
    if (!CSS_NUMBER_PROPS.has(prop)) throw new EditError(i, `${prop} takes text such as '8px' or 'red', not the number ${value}`);
    return;
  }
  if (typeof value !== 'string') throw new EditError(i, `value for ${path} must be a string or number`);
  if (unsafeCssValue(value)) throw new EditError(i, `unsafe value for ${path}`);
}
function checkText(i, text) {
  if (typeof text !== 'string') throw new EditError(i, 'text must be a string');
  if (/[\n`]/.test(text) || text.length > 500) throw new EditError(i, 'text must be one line, at most 500 characters');
}
function checkPropValue(i, prop, value) {
  if (value === undefined) return;
  if (prop.type === 'string') checkText(i, value);
  else if (prop.type === 'boolean' && typeof value !== 'boolean') throw new EditError(i, `default for ${prop.name} must be true or false`);
  else if (prop.type === 'enum' && !prop.options.includes(value)) throw new EditError(i, `default for ${prop.name} must be one of ${prop.options.join(', ')}`);
  else if (prop.type === 'number' && !(typeof value === 'number' && Number.isFinite(value))) throw new EditError(i, `default for ${prop.name} must be a number`);
  else if (prop.type === 'node') throw new EditError(i, `${prop.name} is a slot (ReactNode): it has no default; its preview text lives in the sidecar`);
}
function cleanVariants(doc) {
  for (const [axis, vals] of Object.entries(doc.variants)) {
    for (const [val, nodes] of Object.entries(vals)) {
      for (const [id, st] of Object.entries(nodes)) if (!Object.keys(st).length) delete nodes[id];
      if (!Object.keys(nodes).length) delete vals[val];
    }
    if (!Object.keys(vals).length) delete doc.variants[axis];
  }
}
function removeOverrides(doc, ids) {
  for (const vals of Object.values(doc.variants)) for (const nodes of Object.values(vals)) for (const id of ids) delete nodes[id];
}
const subtreeIds = (node) => [node.id, ...(node.children || []).flatMap(subtreeIds)];


// --- LAY-09: wrap, unwrap, duplicate, paste. Fresh ids: the wanted id when free, else the stem plus the lowest free number >= 2. ---
function freshId(taken, wanted) {
  const stem = String(wanted).replace(/\d+$/, '') || 'node';
  if (!taken.has(wanted) && NODE_ID.test(wanted)) { taken.add(wanted); return wanted; }
  for (let n = 2; ; n++) if (!taken.has(`${stem}${n}`)) { taken.add(`${stem}${n}`); return `${stem}${n}`; }
}
// A deep copy of a subtree with fresh ids; `map` collects old -> new so variant overrides can follow.
function cloneTree(node, taken, map) {
  const id = freshId(taken, node.id);
  map.set(node.id, id);
  const out = { id, tag: node.tag, style: { ...(node.style || {}) }, children: [] };
  if (node.text !== undefined) out.text = node.text;
  if (node.textProp) out.textProp = node.textProp;
  if (node.attrs) out.attrs = { ...node.attrs };
  if (node.when) out.when = node.when;
  if (node.slot) out.slot = node.slot;
  if (node.instance) out.instance = structuredClone(node.instance);
  out.children = (node.children || []).map((c) => cloneTree(c, taken, map));
  return out;
}
// Validates a pasted tree the way `insert` validates a node, recursively.
function checkTree(i, n, depth = 0) {
  if (!n || typeof n.id !== 'string' || typeof n.tag !== 'string') throw new EditError(i, 'node needs id and tag');
  if (!(n.instance ? COMPONENT_NAME.test(n.tag) && n.instance.component === n.tag : TAGS.has(n.tag))) throw new EditError(i, `tag "${n.tag}" is not supported`);
  if (depth > 40) throw new EditError(i, 'tree is too deep');
  for (const [k, v] of Object.entries(n.style || {})) { if (!CSS_PROP.test(k)) throw new EditError(i, `bad property "${k}"`); checkValue(i, `${n.id}.${k}`, v); }
  if (n.text !== undefined) { if (VOID.has(n.tag)) throw new EditError(i, `<${n.tag}> cannot hold text`); checkText(i, n.text); }
  for (const [k, v] of Object.entries(n.attrs || {})) { if (!ATTRS.includes(k)) throw new EditError(i, `unknown attribute "${k}"`); checkText(i, v); }
  if ((n.children || []).length && (n.text !== undefined || n.slot || n.instance || VOID.has(n.tag))) throw new EditError(i, `"${n.id}" cannot hold both text and elements`);
  (n.children || []).forEach((c) => checkTree(i, c, depth + 1));
}

// Props of an instance that are the component's own business, not the target's.
const INSTANCE_RESERVED = new Set(['key', 'ref', 'style', 'className', 'data-n', 'id']);
// An instance prop value: text, a finite number, true/false, or { prop: 'name' } to pass one of the host's own props through.
function checkInstanceValue(i, doc, v) {
  if (typeof v === 'string') return checkText(i, v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new EditError(i, 'a number prop must be finite'); return; }
  if (typeof v === 'boolean') return;
  if (v && typeof v === 'object' && Object.keys(v).length === 1 && typeof v.prop === 'string') {
    if (!propOf(doc, v.prop)) throw new EditError(i, `no prop "${v.prop}" to pass through`);
    return;
  }
  throw new EditError(i, 'an instance prop is a text, a number, true/false or { prop: "name" }');
}

// Put prop into a style object; `at` (optional, only used by undo and restore) is where a NEW key goes in the object's order.
function put(obj, prop, value, at) {
  if (at === undefined || prop in obj) { obj[prop] = value; return; }
  const entries = Object.entries(obj);
  entries.splice(Math.min(at, entries.length), 0, [prop, value]);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k] = v;
}

// Validate a batch and apply it all-or-nothing to a copy of the model.
export function applyEdits(doc, edits) {
  if (!Array.isArray(edits) || edits.length === 0) throw new EditError(0, 'edits must be a non-empty array');
  const next = structuredClone(doc);
  edits.forEach((e, i) => {
    const { byId, parentOf } = index(next);
    if (!e || typeof e !== 'object') throw new EditError(i, 'not an object');
    switch (e.op) {
      case 'set': {
        if (typeof e.path !== 'string' || e.path.split('.').length !== 2) throw new EditError(i, `bad path "${e.path}"`);
        const [id, prop] = e.path.split('.');
        const node = byId.get(id);
        if (!node) throw new EditError(i, `no node "${id}"`);
        if (prop === 'text') {
          if (e.variant) throw new EditError(i, 'text cannot differ per variant; make it a setting instead');
          if (node.children.length) throw new EditError(i, `"${id}" has child elements, so it cannot hold text`);
          if (VOID.has(node.tag) || node.instance) throw new EditError(i, `<${node.tag}> cannot hold text`);
          if (e.value === null || e.value === '') { delete node.text; delete node.textProp; delete node.slot; break; } // empty text is no text: the file can't tell them apart
          checkText(i, e.value);
          delete node.textProp; delete node.slot; node.text = e.value;
          break;
        }
        if (prop === '@when') { // show the node only while a boolean prop is true
          if (e.variant) throw new EditError(i, 'a condition cannot differ per variant');
          if (!parentOf.get(id)) throw new EditError(i, 'the root is always shown, so it cannot have a condition');
          if (e.value === null) { delete node.when; break; }
          const p = propOf(next, e.value);
          if (!p || p.type !== 'boolean') throw new EditError(i, `"${e.value}" is not a true/false prop; add one first (addProp type boolean)`);
          node.when = e.value;
          break;
        }
        if (prop === '@slot') { // the node shows what the caller passes in this ReactNode prop
          if (e.variant) throw new EditError(i, 'a slot cannot differ per variant');
          if (e.value === null) { delete node.slot; break; }
          const p = propOf(next, e.value);
          if (!p || p.type !== 'node') throw new EditError(i, `"${e.value}" is not a slot prop; add one first (addProp type node)`);
          if (node.children.length || node.instance || VOID.has(node.tag)) throw new EditError(i, `"${id}" cannot hold a slot (it has child elements, or is an image or another component)`);
          delete node.text; delete node.textProp;
          node.slot = e.value;
          break;
        }
        if (prop.startsWith('prop:')) { // an instance's prop: a text, a number, true/false, or { prop: 'ours' } to pass one of this component's props through
          const name = prop.slice(5);
          if (!node.instance) throw new EditError(i, `"${id}" is not another component`);
          if (e.variant) throw new EditError(i, 'instance props cannot differ per variant');
          if (!PROP_NAME.test(name) || INSTANCE_RESERVED.has(name)) throw new EditError(i, `bad prop name "${name}"`);
          if (e.value === null) { delete node.instance.props[name]; break; }
          checkInstanceValue(i, next, e.value);
          node.instance.props[name] = e.value;
          break;
        }
        if (prop.startsWith('@')) {
          const attr = prop.slice(1);
          if (!ATTRS.includes(attr)) throw new EditError(i, `unknown attribute "${attr}"`);
          if (e.variant) throw new EditError(i, 'attributes cannot differ per variant');
          if (e.value === null) { if (node.attrs) delete node.attrs[attr]; if (node.attrs && !Object.keys(node.attrs).length) delete node.attrs; break; }
          checkText(i, e.value);
          node.attrs = { ...(node.attrs || {}), [attr]: e.value };
          break;
        }
        if (node.instance) throw new EditError(i, `"${id}" is another component, so it has no styles of its own; set its props, or style it from its own file`);
        if (!CSS_PROP.test(prop)) throw new EditError(i, `bad property "${prop}"`);
        if (e.at !== undefined && !(Number.isInteger(e.at) && e.at >= 0)) throw new EditError(i, 'at must be a whole number from 0');
        if (e.value !== null) checkValue(i, e.path, e.value);
        if (e.variant) {
          const entries = Object.entries(e.variant);
          if (entries.length !== 1) throw new EditError(i, 'variant must name exactly one axis, e.g. { "size": "sm" }');
          const [[axis, value]] = entries;
          const a = propOf(next, axis);
          if (!a || a.type !== 'enum') throw new EditError(i, `no variant axis "${axis}"`);
          if (!a.options.includes(value)) throw new EditError(i, `"${value}" is not a value of ${axis}`);
          if (value === a.default) throw new EditError(i, `"${value}" is the base of ${axis}; set the base style instead`);
          if (e.value === null) { delete next.variants[axis]?.[value]?.[id]?.[prop]; cleanVariants(next); break; }
          ((next.variants[axis] ??= {})[value] ??= {})[id] ??= {};
          put(next.variants[axis][value][id], prop, e.value, e.at);
          break;
        }
        if (e.value === null) { delete node.style[prop]; break; }
        put(node.style, prop, e.value, e.at);
        break;
      }
      case 'insert': {
        const parent = byId.get(e.parent);
        if (!parent) throw new EditError(i, `no parent "${e.parent}"`);
        if (!canHold(parent)) throw new EditError(i, `"${e.parent}" shows text, a slot or an image, or is another component, so it cannot hold elements`);
        const n = e.node;
        if (!n || typeof n.id !== 'string' || typeof n.tag !== 'string') throw new EditError(i, 'node needs id and tag');
        if (!NODE_ID.test(n.id)) throw new EditError(i, `bad id "${n.id}" (letters, digits, _; starts lowercase)`);
        if (byId.has(n.id)) throw new EditError(i, `id "${n.id}" already exists`);
        if (!TAGS.has(n.tag)) throw new EditError(i, `tag "${n.tag}" is not supported`);
        const node = { id: n.id, tag: n.tag, style: {}, children: [] };
        for (const [k, v] of Object.entries(n.style || {})) { if (!CSS_PROP.test(k)) throw new EditError(i, `bad property "${k}"`); checkValue(i, `${n.id}.${k}`, v); node.style[k] = v; }
        if (n.text !== undefined && n.text !== '') { if (VOID.has(n.tag)) throw new EditError(i, `<${n.tag}> cannot hold text`); checkText(i, n.text); node.text = n.text; }
        for (const [k, v] of Object.entries(n.attrs || {})) { if (!ATTRS.includes(k)) throw new EditError(i, `unknown attribute "${k}"`); checkText(i, v); (node.attrs ??= {})[k] = v; }
        const at = e.index ?? parent.children.length;
        if (!Number.isInteger(at) || at < 0 || at > parent.children.length) throw new EditError(i, `bad index ${e.index}`);
        parent.children.splice(at, 0, node);
        break;
      }
      case 'delete': {
        const parent = parentOf.get(e.id);
        if (!parent) throw new EditError(i, byId.has(e.id) ? 'cannot delete the root' : `no node "${e.id}"`);
        removeOverrides(next, subtreeIds(byId.get(e.id)));
        cleanVariants(next);
        parent.children = parent.children.filter((c) => c.id !== e.id);
        break;
      }
      case 'move': {
        const node = byId.get(e.id), from = parentOf.get(e.id), to = byId.get(e.parent);
        if (!node || !from) throw new EditError(i, `cannot move "${e.id}"`);
        if (!to) throw new EditError(i, `no parent "${e.parent}"`);
        if (!canHold(to)) throw new EditError(i, `"${e.parent}" cannot hold elements`);
        for (let p = to; p; p = parentOf.get(p.id)) if (p === node) throw new EditError(i, 'cannot move a node into itself');
        from.children = from.children.filter((c) => c.id !== e.id);
        const at = e.index ?? to.children.length;
        if (!Number.isInteger(at) || at < 0 || at > to.children.length) throw new EditError(i, `bad index ${e.index}`);
        to.children.splice(at, 0, node);
        break;
      }
      case 'rename': {
        const node = byId.get(e.id);
        if (!node) throw new EditError(i, `no node "${e.id}"`);
        if (typeof e.to !== 'string' || !NODE_ID.test(e.to)) throw new EditError(i, `bad id "${e.to}" (letters, digits, _; starts lowercase)`);
        if (e.to === e.id) break;
        if (byId.has(e.to)) throw new EditError(i, `id "${e.to}" already exists`);
        node.id = e.to;
        for (const vals of Object.values(next.variants)) for (const nodes of Object.values(vals)) if (e.id in nodes) { nodes[e.to] = nodes[e.id]; delete nodes[e.id]; }
        break;
      }
      case 'addProp': {
        if (typeof e.name !== 'string' || !PROP_NAME.test(e.name) || (RESERVED.has(e.name) && !(e.name === 'children' && e.type === 'node'))) throw new EditError(i, `bad prop name "${e.name}"`);
        if (propOf(next, e.name)) throw new EditError(i, `prop "${e.name}" already exists`);
        if (!PROP_TYPES.includes(e.type)) throw new EditError(i, 'type must be string, boolean, number, enum or node (a slot)');
        const p = { name: e.name, type: e.type };
        if (e.type === 'enum') {
          if (!Array.isArray(e.options) || !e.options.length || e.options.some((o) => typeof o !== 'string' || !OPTION.test(o)) || new Set(e.options).size !== e.options.length) throw new EditError(i, 'enum needs distinct options (letters, digits, _ or -)');
          p.options = [...e.options];
          p.default = e.default ?? e.options[0];
        } else if (e.default !== undefined) p.default = e.default;
        checkPropValue(i, p, p.default);
        next.props.push(p);
        break;
      }
      case 'removeProp': {
        const p = propOf(next, e.name);
        if (!p) throw new EditError(i, `no prop "${e.name}"`);
        const user = [...byId.values()].find((n) => n.textProp === e.name || n.slot === e.name || n.when === e.name || Object.values(n.instance?.props || {}).some((v) => v?.prop === e.name));
        if (user) throw new EditError(i, `"${user.id}" uses ${e.name} (text, slot, condition or an instance prop); free it first`);
        next.props = next.props.filter((x) => x !== p);
        delete next.variants[e.name];
        break;
      }
      case 'setDefault': {
        const p = propOf(next, e.name);
        if (!p) throw new EditError(i, `no prop "${e.name}"`);
        if (e.value === null || e.value === undefined) {
          if (p.type === 'enum') throw new EditError(i, `variant axis ${e.name} needs a base value`);
          delete p.default; break;
        }
        checkPropValue(i, p, e.value);
        if (p.type === 'enum' && next.variants[e.name]?.[e.value]) throw new EditError(i, `${e.name}=${e.value} has overrides; reset them before making it the base`);
        p.default = e.value;
        break;
      }
      case 'insertInstance': { // {parent, index?, id, component, props?, when?}: another component, from a sibling file, as a child
        const parent = byId.get(e.parent);
        if (!parent) throw new EditError(i, `no parent "${e.parent}"`);
        if (!canHold(parent)) throw new EditError(i, `"${e.parent}" shows text, a slot or an image, or is another component, so it cannot hold elements`);
        if (typeof e.id !== 'string' || !NODE_ID.test(e.id)) throw new EditError(i, `bad id "${e.id}" (letters, digits, _; starts lowercase)`);
        if (byId.has(e.id)) throw new EditError(i, `id "${e.id}" already exists`);
        if (typeof e.component !== 'string' || !COMPONENT_NAME.test(e.component)) throw new EditError(i, `bad component name "${e.component}" (PascalCase, the name of a sibling file)`);
        if (e.component === next.name) throw new EditError(i, `${next.name} cannot use itself`);
        const props = {};
        for (const [k, v] of Object.entries(e.props || {})) {
          if (!PROP_NAME.test(k) || INSTANCE_RESERVED.has(k)) throw new EditError(i, `bad prop name "${k}"`);
          checkInstanceValue(i, next, v);
          props[k] = v;
        }
        const node = { id: e.id, tag: e.component, style: {}, children: [], instance: { component: e.component, props } };
        if (e.when !== undefined && e.when !== null) {
          const w = propOf(next, e.when);
          if (!w || w.type !== 'boolean') throw new EditError(i, `"${e.when}" is not a true/false prop`);
          node.when = e.when;
        }
        const at = e.index ?? parent.children.length;
        if (!Number.isInteger(at) || at < 0 || at > parent.children.length) throw new EditError(i, `bad index ${e.index}`);
        parent.children.splice(at, 0, node);
        break;
      }
      case 'extractComponent': { // {id, component}: the node (and everything in it) becomes an instance of `component`, whose file already holds the subtree (see extractPlan)
        if (typeof e.component !== 'string' || !COMPONENT_NAME.test(e.component)) throw new EditError(i, `bad component name "${e.component}" (PascalCase)`);
        if (e.component === next.name) throw new EditError(i, `${next.name} cannot use itself`);
        let plan; try { plan = extractPlan(next, e.id); } catch (err) { throw new EditError(i, err.message); }
        const parent = parentOf.get(e.id), node = byId.get(e.id);
        removeOverrides(next, subtreeIds(node)); cleanVariants(next);
        const inst = { id: e.id, tag: e.component, style: {}, children: [], instance: { component: e.component, props: Object.fromEntries(plan.props.map((p) => [p.name, { prop: p.name }])) } };
        if (node.when) inst.when = node.when;
        parent.children.splice(parent.children.indexOf(node), 1, inst);
        break;
      }
      case 'swapInstance': { // {id, component}: the same place and props, another component (props the new one lacks are dropped by the store, which can read it)
        const node = byId.get(e.id);
        if (!node?.instance) throw new EditError(i, `"${e.id}" is not another component`);
        if (typeof e.component !== 'string' || !COMPONENT_NAME.test(e.component)) throw new EditError(i, `bad component name "${e.component}"`);
        if (e.component === next.name) throw new EditError(i, `${next.name} cannot use itself`);
        node.tag = e.component; node.instance.component = e.component;
        break;
      }
      case 'renameProp': { // {name, to}: the prop, every element that shows it, and (for a variant axis) its overrides
        const p = propOf(next, e.name);
        if (!p) throw new EditError(i, `no prop "${e.name}"`);
        if (typeof e.to !== 'string' || !PROP_NAME.test(e.to) || RESERVED.has(e.to)) throw new EditError(i, `bad prop name "${e.to}"`);
        if (propOf(next, e.to)) throw new EditError(i, `prop "${e.to}" already exists`);
        p.name = e.to;
        for (const n of byId.values()) {
          if (n.textProp === e.name) n.textProp = e.to;
          if (n.slot === e.name) n.slot = e.to;
          if (n.when === e.name) n.when = e.to;
          for (const [k, v] of Object.entries(n.instance?.props || {})) if (v?.prop === e.name) n.instance.props[k] = { prop: e.to };
        }
        if (next.variants[e.name]) next.variants = Object.fromEntries(Object.entries(next.variants).map(([k, v]) => [k === e.name ? e.to : k, v]));
        break;
      }
      case 'renameVariant': { // {axis, value, to}: a value of a variant axis, including its overrides (and the base, if it is the base)
        const p = propOf(next, e.axis);
        if (!p || p.type !== 'enum') throw new EditError(i, `no variant axis "${e.axis}"`);
        if (!p.options.includes(e.value)) throw new EditError(i, `${e.axis} has no "${e.value}"`);
        if (typeof e.to !== 'string' || !OPTION.test(e.to)) throw new EditError(i, `bad variant value "${e.to}"`);
        if (p.options.includes(e.to)) throw new EditError(i, `${e.axis} already has "${e.to}"`);
        p.options = p.options.map((o) => (o === e.value ? e.to : o));
        if (p.default === e.value) p.default = e.to;
        const vals = next.variants[e.axis];
        if (vals?.[e.value]) next.variants[e.axis] = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k === e.value ? e.to : k, v]));
        break;
      }
      case 'bindText': {
        const node = byId.get(e.id);
        if (!node) throw new EditError(i, `no node "${e.id}"`);
        if (node.children.length || VOID.has(node.tag) || node.instance) throw new EditError(i, `"${e.id}" cannot hold text`);
        if (e.prop === null) {
          if (!node.textProp) throw new EditError(i, `"${e.id}" is not bound to a setting`);
          const p = propOf(next, node.textProp);
          if (typeof p?.default === 'string' && p.default !== '') node.text = p.default; // an empty default is no text: the file can't tell them apart
          delete node.textProp;
          break;
        }
        if (typeof e.prop !== 'string' || !PROP_NAME.test(e.prop) || RESERVED.has(e.prop)) throw new EditError(i, `bad prop name "${e.prop}"`);
        let p = propOf(next, e.prop);
        if (!p) { p = { name: e.prop, type: 'string', ...(node.text !== undefined ? { default: node.text } : {}) }; next.props.push(p); }
        if (p.type !== 'string') throw new EditError(i, `prop "${e.prop}" is not a string`);
        delete node.text; node.textProp = e.prop;
        break;
      }
      case 'addVariant': {
        if (typeof e.axis !== 'string' || !PROP_NAME.test(e.axis) || RESERVED.has(e.axis)) throw new EditError(i, `bad axis name "${e.axis}"`);
        if (typeof e.value !== 'string' || !OPTION.test(e.value)) throw new EditError(i, `bad variant value "${e.value}"`);
        let p = propOf(next, e.axis);
        if (!p) {
          const base = e.base ?? 'default';
          if (!OPTION.test(base) || base === e.value) throw new EditError(i, `bad base value "${base}"`);
          next.props.push({ name: e.axis, type: 'enum', options: [base, e.value], default: base });
          break;
        }
        if (p.type !== 'enum') throw new EditError(i, `prop "${e.axis}" is not a variant axis`);
        if (p.options.includes(e.value)) throw new EditError(i, `${e.axis} already has "${e.value}"`);
        p.options.push(e.value);
        break;
      }
      case 'removeVariant': {
        const p = propOf(next, e.axis);
        if (!p || p.type !== 'enum') throw new EditError(i, `no variant axis "${e.axis}"`);
        if (!p.options.includes(e.value)) throw new EditError(i, `${e.axis} has no "${e.value}"`);
        if (p.default === e.value) throw new EditError(i, `"${e.value}" is the base of ${e.axis}`);
        if (p.options.length <= 2) { next.props = next.props.filter((x) => x !== p); delete next.variants[e.axis]; break; }
        p.options = p.options.filter((o) => o !== e.value);
        if (next.variants[e.axis]) delete next.variants[e.axis][e.value];
        cleanVariants(next);
        break;
      }
      case 'duplicate': {
        const node = byId.get(e.id), parent = parentOf.get(e.id);
        if (!node) throw new EditError(i, `no node "${e.id}"`);
        if (!parent) throw new EditError(i, 'cannot duplicate the root');
        const map = new Map(), copy = cloneTree(node, new Set(byId.keys()), map);
        for (const vals of Object.values(next.variants)) for (const nodes of Object.values(vals)) for (const [old, nw] of map) if (nodes[old]) nodes[nw] = { ...nodes[old] };
        parent.children.splice(parent.children.findIndex((c) => c.id === e.id) + 1, 0, copy);
        break;
      }
      case 'paste': {
        const parent = byId.get(e.parent);
        if (!parent) throw new EditError(i, `no parent "${e.parent}"`);
        if (!canHold(parent)) throw new EditError(i, `"${e.parent}" cannot hold elements`);
        checkTree(i, e.tree);
        const map = new Map(), copy = cloneTree(e.tree, new Set(byId.keys()), map);
        // a text bound to a setting this component lacks becomes plain text (the tree carries the setting's default as `text`)
        (function unbind(n) { if (n.textProp && propOf(next, n.textProp)?.type !== 'string') { delete n.textProp; n.text = n.text ?? ''; } n.children.forEach(unbind); })(copy);
        for (const [axis, vals] of Object.entries(e.variants || {})) {
          const a = propOf(next, axis);
          if (!a || a.type !== 'enum') continue; // an axis this component lacks: its overrides stay behind
          for (const [val, nodes] of Object.entries(vals)) {
            if (!a.options.includes(val) || val === a.default) continue;
            for (const [old, st] of Object.entries(nodes)) if (map.has(old)) { for (const [k, v] of Object.entries(st)) { if (!CSS_PROP.test(k)) throw new EditError(i, `bad property "${k}"`); checkValue(i, `${old}.${k}`, v); } (((next.variants[axis] ??= {})[val] ??= {})[map.get(old)] = { ...st }); }
          }
        }
        const at = e.index ?? parent.children.length;
        if (!Number.isInteger(at) || at < 0 || at > parent.children.length) throw new EditError(i, `bad index ${e.index}`);
        parent.children.splice(at, 0, copy);
        break;
      }
      case 'wrap': {
        if (!Array.isArray(e.ids) || !e.ids.length) throw new EditError(i, 'wrap needs ids');
        if (typeof e.id !== 'string' || !NODE_ID.test(e.id)) throw new EditError(i, `bad id "${e.id}" (letters, digits, _; starts lowercase)`);
        if (byId.has(e.id)) throw new EditError(i, `id "${e.id}" already exists`);
        const tag = e.tag ?? 'div';
        if (!TAGS.has(tag) || VOID.has(tag)) throw new EditError(i, `tag "${tag}" is not supported`);
        const parent = parentOf.get(e.ids[0]);
        for (const id of e.ids) if (!byId.has(id)) throw new EditError(i, `no node "${id}"`);
        if (!parent) throw new EditError(i, 'cannot wrap the root');
        if (e.ids.some((id) => parentOf.get(id) !== parent)) throw new EditError(i, 'wrapped nodes must share one parent');
        const frame = { id: e.id, tag, style: {}, children: [] };
        for (const [k, v] of Object.entries(e.style || {})) { if (!CSS_PROP.test(k)) throw new EditError(i, `bad property "${k}"`); checkValue(i, `${e.id}.${k}`, v); frame.style[k] = v; }
        const members = parent.children.filter((c) => e.ids.includes(c.id)); // keep document order
        const at = parent.children.indexOf(members[0]);
        parent.children = parent.children.filter((c) => !e.ids.includes(c.id));
        frame.children = members;
        parent.children.splice(at, 0, frame);
        break;
      }
      case 'unwrap': {
        const node = byId.get(e.id), parent = parentOf.get(e.id);
        if (!node) throw new EditError(i, `no node "${e.id}"`);
        if (!parent) throw new EditError(i, 'cannot unwrap the root');
        if (holdsText(node) || node.instance || !node.children.length) throw new EditError(i, `"${e.id}" holds no elements to lift out`);
        removeOverrides(next, [e.id]); cleanVariants(next);
        const at = parent.children.indexOf(node);
        parent.children.splice(at, 1, ...node.children);
        break;
      }
      default:
        throw new EditError(i, `unknown op "${e.op}"; valid ops: set, insert, delete, move, addProp, removeProp, setDefault, bindText, addVariant, removeVariant, rename, renameProp, renameVariant, insertInstance, swapInstance`);
    }
  });
  return next;
}

// Checks every instance in `doc` against the components it uses. `lookup(name)` returns { doc, uses: Set<string> } for a sibling
// component, or null when there is none; a missing resolver skips the checks. Returns an error text, or null.
//   - the component exists and is not the host itself, and no import cycle (the target must not, through its own uses, reach the host);
//   - every prop passed is a prop of the target, and its value fits the target's type (number, true/false, text, one of an enum's values);
//   - a pass-through ({ prop: 'x' }) must have the same kind of type on both sides.
const kindOf = (p) => (p.type === 'enum' ? 'string' : p.type);
// Does value `v` (as passed by `hostDoc`) fit target prop `tp`?
export function instancePropFits(hostDoc, v, tp) {
  if (v && typeof v === 'object') { const mine = propOf(hostDoc, v.prop); return !!mine && kindOf(mine) === kindOf(tp); }
  if (tp.type === 'enum') return tp.options.includes(v);
  if (tp.type === 'boolean') return typeof v === 'boolean';
  if (tp.type === 'number') return typeof v === 'number';
  if (tp.type === 'string') return typeof v === 'string';
  return false; // a slot takes content, which a file cannot hold here
}
// After a swapInstance: keep the props the new component also has (with a fitting value), drop the rest.
export function pruneSwapped(doc, edits, lookup) {
  if (!lookup) return doc;
  const byId = index(doc).byId;
  for (const e of edits) {
    if (e?.op !== 'swapInstance') continue;
    const node = byId.get(e.id), target = lookup(e.component)?.doc;
    if (!node?.instance || !target) continue;
    for (const [k, v] of Object.entries(node.instance.props)) { const tp = propOf(target, k); if (!tp || !instancePropFits(doc, v, tp)) delete node.instance.props[k]; }
  }
  return doc;
}
export function checkInstances(doc, lookup) {
  if (!lookup) return null;
  for (const n of index(doc).byId.values()) {
    if (!n.instance) continue;
    const name = n.instance.component;
    if (name === doc.name) return `${doc.name} cannot use itself ("${n.id}")`;
    const target = lookup(name);
    if (!target) return `"${n.id}" uses ${name}, but there is no ${name}.tsx next to this file`;
    if (target.reaches?.(doc.name)) return `"${n.id}" would make an import cycle: ${name} already uses ${doc.name}`;
    if (!target.doc) return `"${n.id}" uses ${name}, which is not editable here (read-only), so its props are unknown`;
    for (const [k, v] of Object.entries(n.instance.props)) {
      const tp = propOf(target.doc, k);
      if (!tp) return `${name} has no prop "${k}" (on "${n.id}")`;
      if (!instancePropFits(doc, v, tp)) {
        if (v && typeof v === 'object') return `"${n.id}" passes ${v.prop} to ${name}.${k}, but they are different kinds of prop`;
        return `${name}.${k} takes ${tp.type === 'enum' ? `one of ${tp.options.join(', ')}` : tp.type === 'node' ? 'content, which cannot be set from a file here' : tp.type}, not ${JSON.stringify(v)} (on "${n.id}")`;
      }
    }
  }
  return null;
}

// What moving the subtree under `id` into a component of its own takes with it: the subtree (its root without any condition,
// which stays on the instance), the props the subtree uses (text settings, conditions, slots, passed-through props, variant
// axes that override a node in it) and the overrides of its nodes. Pure; throws Error(text) when it cannot be done.
export function extractPlan(doc, id) {
  const { byId, parentOf } = index(doc);
  const node = byId.get(id);
  if (!node) throw new Error(`no node "${id}". Next: use the id of a node in this component.`);
  if (!parentOf.get(id)) throw new Error('the root cannot be extracted: it is the component. Next: pick a node inside it.');
  if (node.instance) throw new Error(`"${id}" is already another component. Next: pick a plain element.`);
  const ids = new Set(subtreeIds(node));
  if ([...ids].some((x) => x === 'root' && x !== id)) throw new Error('a node called "root" is inside; rename it first, the new component needs the name for its own root. Next: rename that node.');
  const used = new Set();
  for (const n of [...ids].map((x) => byId.get(x))) {
    if (n.textProp) used.add(n.textProp);
    if (n.slot) used.add(n.slot);
    if (n.when && n !== node) used.add(n.when);
    for (const v of Object.values(n.instance?.props || {})) if (v && typeof v === 'object') used.add(v.prop);
  }
  const variants = {};
  for (const [axis, vals] of Object.entries(doc.variants)) for (const [val, nodes] of Object.entries(vals)) for (const [nid, st] of Object.entries(nodes)) if (ids.has(nid)) { ((variants[axis] ??= {})[val] ??= {})[nid] = { ...st }; used.add(axis); }
  const props = doc.props.filter((p) => used.has(p.name)).map((p) => structuredClone(p));
  const root = structuredClone(node);
  delete root.when;
  return { node: root, props, variants };
}
