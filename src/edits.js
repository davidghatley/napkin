// F02: the one edit path's pure half. Validates a batch and applies it all-or-nothing
// to a copy of the document. Ops: set / insert / delete / move.
//   { op: 'set',    path: '<nodeId>.<prop>', value }   prop 'text' sets text, anything else a style property
//   { op: 'insert', parent: '<nodeId>', index, node }  node needs a fresh id
//   { op: 'delete', id: '<nodeId>' }                   not the root
//   { op: 'move',   id: '<nodeId>', parent: '<nodeId>', index }
// Pure: no Node imports.

export class EditError extends Error {
  constructor(index, message) {
    super(`invalid edit #${index}: ${message}`);
    this.index = index;
  }
}

const PROP = /^[a-z][a-zA-Z]*$/;

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

export function getValue(doc, path) {
  const [id, prop] = path.split('.');
  const node = index(doc).byId.get(id);
  if (!node) return undefined;
  return prop === 'text' ? node.text : node.style?.[prop];
}

// Keys a batch touches, used for revision conflict checks.
// set -> "node.prop"; structural ops -> "children:<parent>" for every parent involved, plus "node:<id>".
export function touched(edits) {
  const keys = new Set();
  for (const e of edits) {
    if (e.op === 'set') keys.add(e.path);
    else if (e.op === 'insert') { keys.add(`children:${e.parent}`); keys.add(`node:${e.node?.id}`); }
    else if (e.op === 'delete') keys.add(`node:${e.id}`);
    else if (e.op === 'move') { keys.add(`node:${e.id}`); keys.add(`children:${e.parent}`); }
  }
  return keys;
}

// Do two key sets conflict? Same key, or one side replaced/removed a node the other side touched.
const nodeOf = (k) => (k.startsWith("node:") ? k.slice(5) : k.startsWith("children:") ? k.slice(9) : k.split(".")[0]);
export function conflicts(a, b) {
  for (const k of a) if (b.has(k)) return true;
  const whole = (s) => new Set([...s].filter((k) => k.startsWith("node:")).map(nodeOf));
  const wa = whole(a), wb = whole(b);
  for (const k of a) if (wb.has(nodeOf(k))) return true;
  for (const k of b) if (wa.has(nodeOf(k))) return true;
  return false;
}

// Keys that differ between two documents (for edits that arrive as whole-file changes, e.g. git restore).
export function diffKeys(before, after) {
  const keys = new Set();
  const A = index(before).byId, B = index(after).byId;
  for (const id of new Set([...A.keys(), ...B.keys()])) {
    const a = A.get(id), b = B.get(id);
    if (!a || !b) { keys.add(`node:${id}`); continue; }
    if (a.text !== b.text) keys.add(`${id}.text`);
    for (const p of new Set([...Object.keys(a.style || {}), ...Object.keys(b.style || {})])) {
      if (a.style?.[p] !== b.style?.[p]) keys.add(`${id}.${p}`);
    }
    const ca = (a.children || []).map((c) => c.id).join(','), cb = (b.children || []).map((c) => c.id).join(',');
    if (ca !== cb) keys.add(`children:${id}`);
    if (a.tag !== b.tag) keys.add(`node:${id}`);
  }
  if (before.name !== after.name) keys.add('meta.name');
  return keys;
}

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
          if (typeof e.value !== 'string') throw new EditError(i, 'text must be a string');
          node.text = e.value;
        } else {
          if (!PROP.test(prop)) throw new EditError(i, `bad property "${prop}"`);
          if (e.value === null) { if (node.style) delete node.style[prop]; break; }
          if (typeof e.value !== 'string' && typeof e.value !== 'number') throw new EditError(i, `value for ${e.path} must be a string or number`);
          if (typeof e.value === 'string' && /[;{}<>]/.test(e.value)) throw new EditError(i, `unsafe value for ${e.path}`);
          node.style ??= {};
          node.style[prop] = e.value;
        }
        break;
      }
      case 'insert': {
        const parent = byId.get(e.parent);
        if (!parent) throw new EditError(i, `no parent "${e.parent}"`);
        const n = e.node;
        if (!n || typeof n.id !== 'string' || typeof n.tag !== 'string') throw new EditError(i, 'node needs id and tag');
        if (byId.has(n.id)) throw new EditError(i, `id "${n.id}" already exists`);
        if (!/^[a-z][a-z0-9-]*$/.test(n.tag)) throw new EditError(i, `bad tag "${n.tag}"`);
        parent.children ??= [];
        const at = e.index ?? parent.children.length;
        if (!Number.isInteger(at) || at < 0 || at > parent.children.length) throw new EditError(i, `bad index ${e.index}`);
        parent.children.splice(at, 0, { id: n.id, tag: n.tag, ...(n.text !== undefined ? { text: String(n.text) } : {}), style: { ...(n.style || {}) }, children: [] });
        break;
      }
      case 'delete': {
        const parent = parentOf.get(e.id);
        if (!parent) throw new EditError(i, byId.has(e.id) ? 'cannot delete the root' : `no node "${e.id}"`);
        parent.children = parent.children.filter((c) => c.id !== e.id);
        break;
      }
      case 'move': {
        const node = byId.get(e.id), from = parentOf.get(e.id), to = byId.get(e.parent);
        if (!node || !from) throw new EditError(i, `cannot move "${e.id}"`);
        if (!to) throw new EditError(i, `no parent "${e.parent}"`);
        for (let p = to; p; p = parentOf.get(p.id)) if (p === node) throw new EditError(i, 'cannot move a node into itself');
        from.children = from.children.filter((c) => c.id !== e.id);
        to.children ??= [];
        const at = e.index ?? to.children.length;
        if (!Number.isInteger(at) || at < 0 || at > to.children.length) throw new EditError(i, `bad index ${e.index}`);
        to.children.splice(at, 0, node);
        break;
      }
      default:
        throw new EditError(i, `unknown op "${e.op}"`);
    }
  });
  return next;
}
