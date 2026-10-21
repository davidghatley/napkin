// Undo, redo and restore are ordinary edits (decision 0005, G5). The one hard part is turning "go back to that
// document" into edits the store can apply, so it is done by comparing two documents.
//   diffToEdits(from, to) -> [edits] that turn `from` into `to`, or null when the ops cannot say it exactly.
// Every answer is checked: the edits are applied to `from` and the result must equal `to`, so an undo that
// would leave the file different from the one before the edit is refused instead of guessed.
import { applyEdits, index, propOf, touched, EditError } from './model.js';

const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const strip = ({ id, ...rest }) => rest; // the sidecar id is not part of the file
export const sameDoc = (a, b) => canonical(strip(a)) === canonical(strip(b));

const flatVariants = (doc) => {
  const out = new Map();
  for (const [axis, vals] of Object.entries(doc.variants || {})) for (const [value, nodes] of Object.entries(vals))
    for (const [node, st] of Object.entries(nodes)) for (const [prop, v] of Object.entries(st)) out.set(JSON.stringify([axis, value, node, prop]), v);
  return out;
};

export function diffToEdits(from, to) {
  if (!from || !to) return null;
  if (from.name !== to.name) return null;
  let cur = structuredClone(from);
  const edits = [];
  const emit = (e) => { cur = applyEdits(cur, [e]); edits.push(e); };
  try {
    // 1. settings and variant axes
    for (const p of to.props) {
      const c = propOf(cur, p.name);
      if (!c) emit({ op: 'addProp', name: p.name, type: p.type, ...(p.options && { options: [...p.options] }), ...(p.default !== undefined && { default: p.default }) });
      else if (c.type !== p.type) return null;
    }
    for (const p of to.props) {
      if (p.type !== 'enum') continue;
      let c = propOf(cur, p.name);
      for (const o of p.options) if (!c.options.includes(o)) { emit({ op: 'addVariant', axis: p.name, value: o }); c = propOf(cur, p.name); }
      if (c.default !== p.default) {
        for (const [node, st] of Object.entries(cur.variants[p.name]?.[p.default] || {})) for (const prop of Object.keys(st)) emit({ op: 'set', path: `${node}.${prop}`, variant: { [p.name]: p.default }, value: null });
        emit({ op: 'setDefault', name: p.name, value: p.default });
      }
    }
    for (const p of to.props) {
      if (p.type === 'enum') continue;
      if (propOf(cur, p.name).default !== p.default) emit({ op: 'setDefault', name: p.name, value: p.default ?? null });
    }

    // 2. the tree: insert what is new, move what sits in the wrong place
    const shell = (n) => ({ id: n.id, tag: n.tag, style: { ...n.style }, ...(n.text !== undefined && !n.children.length && { text: n.text }), ...(n.attrs && { attrs: { ...n.attrs } }) });
    const visit = (tn) => {
      tn.children.forEach((tc, i) => {
        const { byId, parentOf } = index(cur);
        const at = byId.get(tn.id);
        if (at.text !== undefined || at.textProp) emit({ op: 'set', path: `${tn.id}.text`, value: null });
        const cn = byId.get(tc.id);
        if (!cn) emit({ op: 'insert', parent: tn.id, index: i, node: shell(tc) });
        else {
          if (cn.tag !== tc.tag) throw new EditError(0, 'a node changed its tag');
          const p = parentOf.get(tc.id);
          if (p.id !== tn.id || p.children.findIndex((c) => c.id === tc.id) !== i) emit({ op: 'move', id: tc.id, parent: tn.id, index: i });
        }
        visit(tc);
      });
    };
    visit(to.root);

    // 3. delete what is gone
    const want = index(to).byId;
    for (const id of [...index(cur).byId.keys()]) if (!want.has(id) && index(cur).byId.has(id)) emit({ op: 'delete', id });

    // 4. text, attributes and base styles of every node
    for (const [id, tn] of want) {
      const cn = index(cur).byId.get(id);
      if (tn.textProp) { if (cn.textProp !== tn.textProp) emit({ op: 'bindText', id, prop: tn.textProp }); }
      else if (tn.text !== undefined) { if (cn.text !== tn.text || cn.textProp) emit({ op: 'set', path: `${id}.text`, value: tn.text }); }
      else if (cn.text !== undefined || cn.textProp) emit({ op: 'set', path: `${id}.text`, value: null });
      for (const a of ['src', 'alt']) if (cn.attrs?.[a] !== tn.attrs?.[a]) emit({ op: 'set', path: `${id}.@${a}`, value: tn.attrs?.[a] ?? null });
      for (const k of new Set([...Object.keys(cn.style), ...Object.keys(tn.style)])) if (cn.style[k] !== tn.style[k]) emit({ op: 'set', path: `${id}.${k}`, value: tn.style[k] ?? null, ...(!(k in cn.style) && { at: Object.keys(tn.style).indexOf(k) }) });
    }

    // 5. variant overrides
    const a = flatVariants(cur), b = flatVariants(to);
    const keptValue = (axis, value) => propOf(to, axis)?.options?.includes(value);
    for (const key of a.keys()) if (!b.has(key)) {
      const [axis, value, node, prop] = JSON.parse(key);
      if (keptValue(axis, value)) emit({ op: 'set', path: `${node}.${prop}`, variant: { [axis]: value }, value: null });
    }
    for (const [key, v] of b) if (a.get(key) !== v) {
      const [axis, value, node, prop] = JSON.parse(key);
      emit({ op: 'set', path: `${node}.${prop}`, variant: { [axis]: value }, value: v, ...(!(prop in (cur.variants[axis]?.[value]?.[node] || {})) && { at: Object.keys(to.variants[axis][value][node]).indexOf(prop) }) });
    }

    // 6. what only the old document had
    for (const p of to.props) {
      if (p.type !== 'enum') continue;
      for (const o of propOf(cur, p.name).options) if (!p.options.includes(o)) emit({ op: 'removeVariant', axis: p.name, value: o });
    }
    for (const p of [...cur.props]) if (!propOf(to, p.name)) emit({ op: 'removeProp', name: p.name });
  } catch (e) {
    if (e instanceof EditError) return null;
    throw e;
  }
  return sameDoc(cur, to) ? edits : null;
}

// The keys a step must still own for its undo to be safe. Finer than touched(): an insert or a move concerns the node it adds or
// moves, not its parent's whole child list, so a sibling someone else adds next to it does not block (or trap) the undo.
export function undoKeys(edits) {
  const keys = new Set();
  for (const e of edits) {
    if (e?.op === 'insert') keys.add(`node:${e.node?.id}`);
    else if (e?.op === 'move') keys.add(`node:${e.id}`);
    else for (const k of touched([e])) keys.add(k);
  }
  return keys;
}
