// The diff budget per edit type (FMT-02, DREAM Fig. 4.12), as a function of the model before and after one edit.
// budget(edit, before, after) -> { add, del }: the most lines `git diff --numstat` may show for that one op.
// Counts are of the structures the dialect prints: one property = 1 line, an object block = 2 lines (open and close) + its
// entries, an element with children = 2 lines + its children, a leaf element = 1 line.
import { index } from '../../src/model.js';

const nprops = (o) => Object.keys(o || {}).length;
// (a leaf with text is 3 lines the way napkin writes it: prettier puts the text of a two-attribute element on its own line)
const hasText = (n) => n.text !== undefined || !!n.textProp;
export const jsxLines = (n) => (n.children.length ? 2 + n.children.reduce((a, c) => a + jsxLines(c), 0) : hasText(n) ? 3 : 1);
const subtree = (n) => [n, ...n.children.flatMap(subtree)];
// base: one block per node that has styles
export const baseLines = (doc) => [...index(doc).byId.values()].reduce((a, n) => a + (nprops(n.style) ? 2 + nprops(n.style) : 0), 0);
// variants: axis block > value block > node block > properties
export const variantLines = (doc) => Object.values(doc.variants || {}).reduce((a, vals) => a + 2 + Object.values(vals).reduce((b, nodes) => b + 2 + Object.values(nodes).reduce((c, st) => c + 2 + nprops(st), 0), 0), 0);
const axes = (doc) => doc.props.filter((p) => p.type === 'enum').map((p) => p.name);
const pos = (n) => Math.max(n, 0);

// Extra lines a tag takes because its attributes are one per line (it did not fit in 80 columns).
const extraTag = (text, id) => tagLines(text, id) - 1;

// Lines the opening tag of element `id` takes in the text: 1 when it is on one line, more when each attribute has its own line.
export function tagLines(text, id) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`data-n="${id}"`));
  if (at < 0) return 1;
  if (/^\s*<\w+ /.test(lines[at])) return 1;
  let end = at;
  while (end < lines.length && !/^\s*\/?>$/.test(lines[end])) end++;
  return end - at + 2; // `<tag`, the attributes, and the closing `>` or `/>`
}

// Lines element `id` (with everything inside it) takes in the text, found by its data-n.
export function elementLines(text, id) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`data-n="${id}"`));
  if (at < 0) return 1;
  const start = /^\s*<\w+ /.test(lines[at]) ? at : at - 1;
  const indent = lines[start].match(/^\s*/)[0];
  let j = start;
  if (/(<\/\w+>|\/>)$/.test(lines[start].trimEnd()) && lines[start].trim().startsWith('<')) return 1; // the whole element on one line
  for (; j < lines.length; j++) {
    const t = lines[j].trimEnd();
    if (j > start && t.startsWith(indent) && t.slice(indent.length).startsWith('/>') && lines[j].match(/^\s*/)[0] === indent) return j - start + 1; // broken self-closing tag
    if (j > start && lines[j].match(/^\s*/)[0] === indent && /^<\//.test(t.trim())) return j - start + 1; // closing tag at the same indent
  }
  return 1;
}
// Lines the interface member `name` takes: 1, or more when a long union of values is split one per line.
export function memberLines(text, name) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^\\s+${name}\\?:`).test(l));
  if (at < 0) return 1;
  let end = at;
  while (end < lines.length && !lines[end].endsWith(';')) end++;
  return end - at + 1;
}
const layoutCost = (b, a) => (b === 1 && a === 1 ? { add: 1, del: 1 } : b === 1 || a === 1 ? { add: a, del: b } : { add: Math.max(a - b, 0) + 1, del: Math.max(b - a, 0) + 1 });

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
export function budget(edit, before, after, ctx) {
  const pB = ctx.sigBefore, pA = ctx.sigAfter;
  let b = budgetOf(edit, before, after, pB, pA, ctx);
  // `interface P {}` <-> `interface P {` + members + `}`: the same merged-line effect for the props interface
  const noProps = (d) => d.props.length === 0;
  if (noProps(before) !== noProps(after)) b = noProps(after) ? { add: b.add + 1, del: b.del + 2 } : { add: b.add + 2, del: b.del + 1 };
  const wasEmpty = variantLines(before) === 0, isEmpty = variantLines(after) === 0;
  if (wasEmpty === isEmpty) return b;
  return isEmpty ? { add: b.add + 1, del: b.del + 2 } : { add: b.add + 2, del: b.del + 1 }; // `= {};` <-> `= {` + block + `};`
}

function budgetOf(edit, before, after, pB, pA, ctx) {
  const pc = paramsCost(pB, pA);
  const dB = baseLines(after) - baseLines(before);
  const dV = variantLines(after) - variantLines(before);
  const A = index(before).byId, Z = index(after).byId;
  const wasLeaf = (doc, id) => { const n = index(doc).byId.get(id); return n && !n.children.length; };
  switch (edit.op) {
    case 'set': {
      const [id, prop] = edit.path.split('.');
      if (prop.startsWith('@')) return { add: tagLines(ctx.textAfter, id), del: tagLines(ctx.textBefore, id) }; // a tag that crosses 80 columns changes layout
      if (prop === 'text') { // changing text is one line; adding or clearing it turns `<x />` into three lines or back
        const had = hasText(A.get(id)), has = hasText(Z.get(id));
        return { add: had && has ? 1 : has ? 3 + extraTag(ctx.textAfter, id) : 1, del: had && has ? 1 : had ? 3 + extraTag(ctx.textBefore, id) : 1 };
      }
      if (edit.variant) {
        const [[axis, val]] = Object.entries(edit.variant);
        const had = before.variants?.[axis]?.[val]?.[id]?.[prop] !== undefined;
        return { add: pos(dV) + (had && edit.value !== null ? 1 : 0), del: pos(-dV) + (had && edit.value !== null ? 1 : 0) };
      }
      const had = A.get(id).style[prop] !== undefined;
      return { add: pos(dB) + (had && edit.value !== null ? 1 : 0), del: pos(-dB) + (had && edit.value !== null ? 1 : 0) };
    }
    case 'setDefault': return pc; // one line, or the whole parameter list when it now fits on one line (or no longer does)
    case 'addProp': return { add: 1 + pc.add, del: pc.del }; // an interface member + the parameter list
    case 'removeProp': return { add: pc.add, del: 1 + pc.del };
    case 'bindText': {
      if (edit.prop === null) return hasText(Z.get(edit.id)) ? { add: 1, del: 1 } : { add: 1, del: 3 }; // unbinding a setting with no default leaves an empty element
      const line = hasText(A.get(edit.id)) ? { add: 1, del: 1 } : { add: 3 + extraTag(ctx.textAfter, edit.id), del: 1 }; // the element: its text line, or `<x />` becoming three lines
      const fresh = !before.props.some((p) => p.name === edit.prop);
      return fresh ? { add: line.add + 1 + pc.add, del: line.del + pc.del } : line; // (+ a new prop: interface member and parameter list)
    }
    case 'addVariant': {
      const fresh = !before.props.some((p) => p.name === edit.axis);
      if (!fresh) { const m = layoutCost(memberLines(ctx.textBefore, edit.axis), memberLines(ctx.textAfter, edit.axis)); return m; } // the union line (split when long)
      return { add: 2 + pc.add, del: 1 + pc.del }; // fresh axis: interface member, parameters, `const v` line
    }
    case 'removeVariant': {
      const gone = axes(before).length !== axes(after).length;
      const mB = memberLines(ctx.textBefore, edit.axis), mA = memberLines(ctx.textAfter, edit.axis);
      return gone ? { add: pc.add + 1, del: mB + 1 + pc.del + pos(-dV) } : { add: layoutCost(mB, mA).add, del: layoutCost(mB, mA).del + pos(-dV) };
    }
    case 'insert': {
      const parentLeaf = wasLeaf(before, edit.parent);
      const sub = elementLines(ctx.textAfter, edit.node.id);
      return { add: sub + (parentLeaf ? 2 + extraTag(ctx.textAfter, edit.parent) : 0) + pos(dB), del: (parentLeaf ? 1 : 0) + pos(-dB) };
    }
    case 'delete': {
      const parent = index(before).parentOf.get(edit.id);
      const sub = elementLines(ctx.textBefore, edit.id);
      const nowLeaf = parent.children.length === 1;
      return { add: nowLeaf ? 1 + extraTag(ctx.textAfter, parent.id) : 0, del: sub + (nowLeaf ? 2 + extraTag(ctx.textBefore, parent.id) : 0) + pos(-dB) + pos(-dV) };
    }
    case 'move': {
      const n = A.get(edit.id), from = index(before).parentOf.get(edit.id);
      const sub = elementLines(ctx.textBefore, edit.id);
      const fromLeaf = from.children.length === 1 && from.id !== edit.parent;
      const toLeaf = wasLeaf(before, edit.parent) && from.id !== edit.parent;
      return { add: sub + (toLeaf ? 2 + extraTag(ctx.textAfter, edit.parent) : 0) + (fromLeaf ? 1 + extraTag(ctx.textAfter, from.id) : 0), del: sub + (fromLeaf ? 2 + extraTag(ctx.textBefore, from.id) : 0) + (toLeaf ? 1 : 0) };
    }
    default: return { add: Infinity, del: Infinity };
  }
}
export { subtree };
