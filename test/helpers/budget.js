// The diff budget per edit type (FMT-02, DREAM Fig. 4.12), as a function of the model before and after one edit.
// budget(edit, before, after) -> { add, del }: the most lines `git diff --numstat` may show for that one op.
// Counts are of the structures the dialect prints: one property = 1 line, an object block = 2 lines (open and close) + its
// entries, an element with children = 2 lines + its children, a leaf element = 1 line.
import { index } from '../../src/model.js';

const nprops = (o) => Object.keys(o || {}).length;
export const jsxLines = (n) => (n.children.length ? 2 + n.children.reduce((a, c) => a + jsxLines(c), 0) : 1);
const subtree = (n) => [n, ...n.children.flatMap(subtree)];
// base: one block per node that has styles
export const baseLines = (doc) => [...index(doc).byId.values()].reduce((a, n) => a + (nprops(n.style) ? 2 + nprops(n.style) : 0), 0);
// variants: axis block > value block > node block > properties
export const variantLines = (doc) => Object.values(doc.variants || {}).reduce((a, vals) => a + 2 + Object.values(vals).reduce((b, nodes) => b + 2 + Object.values(nodes).reduce((c, st) => c + 2 + nprops(st), 0), 0), 0);
const axes = (doc) => doc.props.filter((p) => p.type === 'enum').map((p) => p.name);
const pos = (n) => Math.max(n, 0);

// Lines the component's signature takes in the file: from `export function` to the `{` that opens the body.
export function signatureLines(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('export function'));
  let end = start;
  while (end < lines.length && !/\) \{$/.test(lines[end])) end++;
  return end - start + 1;
}
// What changing the destructured parameter list costs: a change inside one layout is 1/1, a switch between the
// one-line and the one-per-line layout rewrites the list (the layout follows prettier's 80 columns when the names change).
function paramsCost(pB, pA) {
  if (pB === 1 && pA === 1) return { add: 1, del: 1 };
  if (pB === 1 || pA === 1) return { add: pA, del: pB };
  return { add: Math.max(pA - pB, 0) + 1, del: Math.max(pB - pA, 0) + 1 };
}

// `const variants = {` ... `};` and `const variants = {};` share their first line: going between empty and not costs the merged line on one side and two lines on the other.
export function budget(edit, before, after, pB = 1, pA = 1) {
  let b = budgetOf(edit, before, after, pB, pA);
  // `interface P {}` <-> `interface P {` + members + `}`: the same merged-line effect for the props interface
  const noProps = (d) => d.props.length === 0;
  if (noProps(before) !== noProps(after)) b = noProps(after) ? { add: b.add + 1, del: b.del + 2 } : { add: b.add + 2, del: b.del + 1 };
  const wasEmpty = variantLines(before) === 0, isEmpty = variantLines(after) === 0;
  if (wasEmpty === isEmpty) return b;
  return isEmpty ? { add: b.add + 1, del: b.del + 2 } : { add: b.add + 2, del: b.del + 1 }; // `= {};` <-> `= {` + block + `};`
}

function budgetOf(edit, before, after, pB, pA) {
  const pc = paramsCost(pB, pA);
  const dB = baseLines(after) - baseLines(before);
  const dV = variantLines(after) - variantLines(before);
  const A = index(before).byId, Z = index(after).byId;
  const wasLeaf = (doc, id) => { const n = index(doc).byId.get(id); return n && !n.children.length; };
  switch (edit.op) {
    case 'set': {
      const [id, prop] = edit.path.split('.');
      if (prop === 'text' || prop.startsWith('@')) return { add: 1, del: 1 };
      if (edit.variant) {
        const [[axis, val]] = Object.entries(edit.variant);
        const had = before.variants?.[axis]?.[val]?.[id]?.[prop] !== undefined;
        return { add: pos(dV) + (had && edit.value !== null ? 1 : 0), del: pos(-dV) + (had && edit.value !== null ? 1 : 0) };
      }
      const had = A.get(id).style[prop] !== undefined;
      return { add: pos(dB) + (had && edit.value !== null ? 1 : 0), del: pos(-dB) + (had && edit.value !== null ? 1 : 0) };
    }
    case 'setDefault': return { add: 1, del: 1 };
    case 'addProp': return { add: 1 + pc.add, del: pc.del }; // an interface member + the parameter list
    case 'removeProp': return { add: pc.add, del: 1 + pc.del };
    case 'bindText': {
      if (edit.prop === null) return { add: 1, del: 1 };
      const fresh = !before.props.some((p) => p.name === edit.prop);
      return fresh ? { add: 2 + pc.add, del: 1 + pc.del } : { add: 1, del: 1 }; // the element's line (+ a new prop)
    }
    case 'addVariant': {
      const fresh = !before.props.some((p) => p.name === edit.axis);
      return fresh ? { add: 2 + pc.add, del: 1 + pc.del } : { add: 1, del: 1 }; // fresh axis: interface member, parameters, `const v` line
    }
    case 'removeVariant': {
      const gone = axes(before).length !== axes(after).length;
      return gone ? { add: pc.add + 1, del: 2 + pc.del + pos(-dV) } : { add: 1, del: 1 + pos(-dV) };
    }
    case 'insert': {
      const parentLeaf = wasLeaf(before, edit.parent);
      const sub = jsxLines(Z.get(edit.node.id));
      return { add: sub + (parentLeaf ? 2 : 0) + pos(dB), del: (parentLeaf ? 1 : 0) + pos(-dB) };
    }
    case 'delete': {
      const parent = index(before).parentOf.get(edit.id);
      const sub = jsxLines(A.get(edit.id));
      const nowLeaf = parent.children.length === 1;
      return { add: nowLeaf ? 1 : 0, del: sub + (nowLeaf ? 2 : 0) + pos(-dB) + pos(-dV) };
    }
    case 'move': {
      const n = A.get(edit.id), from = index(before).parentOf.get(edit.id);
      const sub = jsxLines(n);
      const fromLeaf = from.children.length === 1 && from.id !== edit.parent;
      const toLeaf = wasLeaf(before, edit.parent) && from.id !== edit.parent;
      return { add: sub + (toLeaf ? 2 : 0) + (fromLeaf ? 1 : 0), del: sub + (fromLeaf ? 2 : 0) + (toLeaf ? 1 : 0) };
    }
    default: return { add: Infinity, del: Infinity };
  }
}
export { subtree };
