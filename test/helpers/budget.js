// The diff budget per edit type (FMT-02, DREAM Fig. 4.12), as a function of the model before and after one edit.
// budget(edit, before, after) -> { add, del }: the most lines `git diff --numstat` may show for that one op.
// Counts are of the structures the dialect prints: one property = 1 line, an object block = 2 lines (open and close) + its
// entries, an element with children = 2 lines + its children, a leaf element = 1 line.
import { index } from '../../src/model.js';

const nprops = (o) => Object.keys(o || {}).length;
// (a leaf with text is 3 lines the way napkin writes it: prettier puts the text of a two-attribute element on its own line)
const hasText = (n) => n.text !== undefined || !!n.textProp || !!n.slot;
export const jsxLines = (n) => (n.children.length ? 2 + n.children.reduce((a, c) => a + jsxLines(c), 0) : hasText(n) ? 3 : 1);
const subtree = (n) => [n, ...n.children.flatMap(subtree)];
// base: one block per node that has styles
export const baseLines = (doc) => [...index(doc).byId.values()].reduce((a, n) => a + (nprops(n.style) ? 2 + nprops(n.style) : 0), 0);
// variants: axis block > value block > node block > properties
export const variantLines = (doc) => Object.values(doc.variants || {}).reduce((a, vals) => a + 2 + Object.values(vals).reduce((b, nodes) => b + 2 + Object.values(nodes).reduce((c, st) => c + 2 + nprops(st), 0), 0), 0);
const axes = (doc) => doc.props.filter((p) => p.type === 'enum').map((p) => p.name);
const pos = (n) => Math.max(n, 0);
// the `ReactNode` specifier comes with the first slot prop and goes with the last one
const nodeSpec = (b, a) => b.props.some((p) => p.type === 'node') !== a.props.some((p) => p.type === 'node');


// --- what the layout must be, worked out from the models and prettier's 80 columns, never from the text napkin printed ---
const WIDTH = 80;
const indentOfElement = (text, id) => {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`data-n="${id}"`));
  if (at < 0) return '';
  return (/^\s*(<\w+ |\{\w+ && <\w+ )/.test(lines[at]) ? lines[at] : lines[at - 1]).match(/^\s*/)[0];
};
// Where an element sits, worked out from the text BEFORE the edit: an element that exists keeps its indentation; a new one is one
// step inside its parent (the step this file uses from `return` to its root element).
function unitOfText(text) {
  const lines = text.split(/\r?\n/);
  const r = lines.findIndex((l) => /^\s*return \($/.test(l));
  if (r < 0) return /^\t/m.test(text) ? '\t' : '  ';
  const a = lines[r].match(/^\s*/)[0], b = lines[r + 1].match(/^\s*/)[0];
  return b.slice(a.length) || '  ';
}
function indentOfNode(ctx, doc, id) {
  if (ctx.textBefore.includes(`data-n="${id}"`)) return indentOfElement(ctx.textBefore, id);
  const parent = index(doc).parentOf.get(id);
  return parent ? indentOfNode(ctx, doc, parent.id) + unitOfText(ctx.textBefore) : '  ';
}
const hasContent = (n) => n.children.length > 0 || hasText(n);
// Lines an element's opening tag takes: 1, or one per attribute plus the two ends when `<tag attrs>` does not fit.
const instVal = (v) => (typeof v === 'string' ? `"${v}"` : v && typeof v === 'object' ? `{${v.prop}}` : `{${v}}`);
const openText = (node) => node.instance ? `<${node.tag} data-n="${node.id}"` + Object.entries(node.instance.props).map(([k, v]) => ` ${k}=${instVal(v)}`).join('') + ' />' : `<${node.tag} data-n="${node.id}" style={s('${node.id}', v)}` + ['src', 'alt'].filter((k) => node.attrs?.[k] !== undefined).map((k) => ` ${k}="${node.attrs[k]}"`).join('') + (hasContent(node) ? '>' : ' />');
function predictTagLines(node, indent) {
  const attrs = node.instance ? 1 + Object.keys(node.instance.props).length : 2 + ['src', 'alt'].filter((k) => node.attrs?.[k] !== undefined).length;
  const open = openText(node);
  return indent.length + open.length > WIDTH ? attrs + 2 : 1;
}
const predictExtra = (ctx, doc, node) => predictTagLines(node, indentOfNode(ctx, doc, node.id)) - 1;
// Lines an element and its whole subtree take in the text napkin writes for a new or rebuilt element.
function predictElementLines(ctx, doc, node) {
  const tag = predictTagLines(node, indentOfNode(ctx, doc, node.id));
  if (node.children.length) return tag + 1 + node.children.reduce((a, c) => a + predictWrapped(ctx, doc, c), 0);
  return hasText(node) ? tag + 2 : tag;
}
// The signature: one line when `export function Name({ a, b = 'x' }: NameProps) {` fits, else one prop per line. A layout a person
// chose (not the one prettier would give the old list) is kept when only a default or a name changed.
const fitsSig = (doc) => {
  const items = doc.props.map((p) => (p.default === undefined ? p.name : `${p.name} = ${typeof p.default === 'string' ? `'${p.default}'` : p.default}`));
  return `export function ${doc.name}(${items.length ? `{ ${items.join(', ')} }` : '{}'}: ${doc.name}Props) {`.length <= WIDTH;
};
const sigLines = (doc) => (fitsSig(doc) || !doc.props.length ? 1 : doc.props.length + 2);
function predictSig(before, after, pB) {
  const consistent = (pB === 1) === fitsSig(before) || !before.props.length;
  return before.props.length === after.props.length && !consistent ? pB : sigLines(after);
}
// An interface member: one line, or `name?:` + one line per value when the union does not fit.
function predictMember(text, doc, name) {
  const p = doc.props.find((x) => x.name === name);
  if (!p) return 1;
  const m = text.split(/\r?\n/).find((l) => new RegExp(`^\\s+${name}\\?:`).test(l));
  const indent = m ? m.match(/^\s*/)[0] : '  ';
  const one = `${indent}${name}?: ${p.options.map((o) => `'${o}'`).join(' | ')};`;
  return one.length <= WIDTH ? 1 : p.options.length + 1;
}
const returnLinesFor = (doc, indent) => (hasContent(doc.root) ? 3 : `${indent}return <${doc.root.tag} data-n="${doc.root.id}" style={s('${doc.root.id}', v)} />;`.length <= WIDTH ? 1 : 3);

// Lines of the text that contain the word (a prop name or a variant value).
const namingLines = (text, word) => text.split(/\r?\n/).filter((l) => new RegExp(`(^|[^\\w-])${word.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(l)).length;

// Extra lines a tag takes because its attributes are one per line (it did not fit in 80 columns).
const extraTag = (text, id) => tagLines(text, id) - 1;

// Lines the opening tag of element `id` takes in the text: 1 when it is on one line, more when each attribute has its own line.
export function tagLines(text, id) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`data-n="${id}"`));
  if (at < 0) return 1;
  if (/^\s*(<\w+ |\{\w+ && <\w+ )/.test(lines[at])) return 1;
  let end = at;
  while (end < lines.length && !/^\s*\/?>$/.test(lines[end])) end++;
  return end - at + 2; // `<tag`, the attributes, and the closing `>` or `/>`
}

// Lines element `id` (with everything inside it) takes in the text, found by its data-n.
export function elementLines(text, id) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`data-n="${id}"`));
  if (at < 0) return 1;
  if (/^\s*\{\w+ && <.*\}$/.test(lines[at])) return 1; // `{flag && <x />}` on one line
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
// 2 when the element sits inside `{flag && (` ... `)}` (the wrapper's own two lines), else 0.
export function wrapExtra(text, id) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`data-n="${id}"`));
  if (at < 0) return 0;
  const start = /^\s*<\w+ /.test(lines[at]) ? at : at - 1;
  return /&& \($/.test(lines[start - 1] || '') ? 2 : 0;
}
// Lines of element `id` with its wrapper, in the text before the edit.
const withWrap = (text, id) => elementLines(text, id) + wrapExtra(text, id);
// Lines of a node with its `{flag && ...}` wrapper as napkin lays it out: one line when it all fits, else the element lines + 2.
function predictWrapped(ctx, doc, node) {
  const L = predictElementLines(ctx, doc, node);
  if (!node.when) return L;
  let indent = indentOfNode(ctx, doc, node.id);
  if (ctx.textBefore.includes(`data-n="${node.id}"`) && wrapExtra(ctx.textBefore, node.id)) indent = indent.slice(0, indent.length - unitOfText(ctx.textBefore).length); // (the element sits one step inside its wrapper)
  const one = L === 1 && !hasContent(node) && indent.length + `{${node.when} && ${openText(node)}}`.length <= WIDTH;
  if (one) return 1;
  if (!node.children.length && !hasContent(node)) return 2 + predictTagLines(node, indent + unitOfText(ctx.textBefore)); // (the element moves one step in: its own tag may stop fitting)
  return L + 2;
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

// Lines the `return` statement takes: 1 for `return <x />;`, more with the parentheses.
export function returnLines(text) {
  const lines = text.split(/\r?\n/);
  const from = lines.findIndex((l) => l.startsWith('export function'));
  const at = from + lines.slice(from).findIndex((l) => /^\s*return\b/.test(l));
  let end = at;
  while (end < lines.length && !lines[end].trimEnd().endsWith(';')) end++;
  return end - at + 1;
}
// `const variants = {` ... `};` and `const variants = {};` share their first line: going between empty and not costs the merged line on one side and two lines on the other.
// Lines the model says a node's blocks take (its base block and its override blocks).
const modelBlockLines = (doc, id) => (nprops(index(doc).byId.get(id)?.style) ? 2 + nprops(index(doc).byId.get(id).style) : 0) + Object.values(doc.variants || {}).reduce((a, vals) => a + Object.values(vals).reduce((b, nodes) => b + (nodes[id] ? 2 + nprops(nodes[id]) : 0), 0), 0);
// Lines of every `id: {` ... `}` block in the text (a node's base block and its override blocks), comments and all.
function blockLines(text, id) {
  const lines = text.split(/\r?\n/);
  let total = 0;
  lines.forEach((l, i) => {
    const m = l.match(new RegExp(`^(\\s*)['"]?${id}['"]?: \\{\\s*$`));
    if (!m) return;
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^${m[1]}\\},?\\s*(//.*|/\\*.*\\*/)?\\s*$`).test(lines[j])) j++;
    total += j - i + 1;
  });
  return total;
}
// A hand-written object with no trailing comma: appending an entry also changes the line before it (a comma).
const commaless = (text) => /[^,;{\s]\r?\n\s*\}[,;]?\r?\n/.test(text);
// `import { X } from './X';` lines come and go with the first and last use of a component
const usedComponents = (doc) => new Set([...index(doc).byId.values()].filter((n) => n.instance).map((n) => n.instance.component));
export function budget(edit, before, after, ctx) {
  const b0 = budgetWithSlack(edit, before, after, ctx), ub = usedComponents(before), ua = usedComponents(after);
  const b = { add: b0.add + [...ua].filter((c) => !ub.has(c)).length, del: b0.del + [...ub].filter((c) => !ua.has(c)).length };
  const A = index(before).byId;
  const appends = (edit.op === 'set' && edit.value !== null && !edit.path.split('.')[1].startsWith('@') && edit.path.split('.')[1] !== 'text' && (edit.variant ? before.variants?.[Object.keys(edit.variant)[0]]?.[Object.values(edit.variant)[0]]?.[edit.path.split('.')[0]]?.[edit.path.split('.')[1]] === undefined : A.get(edit.path.split('.')[0])?.style[edit.path.split('.')[1]] === undefined))
    || (edit.op === 'insert' && Object.keys(edit.node.style || {}).length > 0);
  // adding a property to a block written on one line (`id: { a: 1, b: 2 },`) changes that line
  const nodeId = edit.op === 'set' ? edit.path.split('.')[0] : null;
  const compact = nodeId && new RegExp(`^\\s*['"]?${nodeId}['"]?: \\{ .*\\}`, 'm').test(ctx.textBefore);
  if (appends && compact) return { add: b.add + 1, del: b.del + 1 };
  if (compact && edit.op === 'set' && edit.value === null && !edit.variant) return { add: b.add + 1, del: b.del }; // removing one of the entries leaves the (shorter) line behind
  return appends && commaless(ctx.textBefore) ? { add: b.add + 1, del: b.del + 1 } : b;
}
function budgetWithSlack(edit, before, after, ctx) {
  const pB = ctx.sigBefore, pA = predictSig(before, after, pB); // (the signature the file has now; the one the rules give next)
  let b = budgetOf(edit, before, after, pB, pA, ctx);
  const rB = returnLines(ctx.textBefore), rA = returnLinesFor(after, ctx.textBefore.match(/^([ \t]*)return\b/m)?.[1] ?? '  '); // `return <x />;` <-> `return (` ... `);`
  if (rB === 1 && rA > 1) b = { add: b.add + 2, del: b.del };
  if (rB > 1 && rA === 1) b = { add: b.add, del: b.del + 2 };
  // `interface P {}` <-> `interface P {` + members + `}`: the same merged-line effect for the props interface
  const noProps = (d) => d.props.length === 0;
  if (noProps(before) !== noProps(after)) b = noProps(after) ? { add: b.add + 1, del: b.del + 2 } : { add: b.add + 2, del: b.del + 1 };
  const bEmpty = baseLines(before) === 0, bNow = baseLines(after) === 0; // `const base = {};` <-> `{` + blocks + `};` (the same merged-line effect)
  if (bEmpty !== bNow) b = bNow ? { add: b.add + 1, del: b.del + 2 } : { add: b.add + 2, del: b.del + 1 };
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
      if (prop === '@when') { // the element gets or loses its wrapper: one line when it all fits, else the element is indented inside `{flag && (` ... `)}`
        const nb = withWrap(ctx.textBefore, id), keep = elementLines(ctx.textBefore, id);
        let na = predictWrapped(ctx, after, Z.get(id));
        if (keep > 1) na = Math.max(na, edit.value ? keep + 2 : keep); // an element a person laid out over several lines keeps its layout
        return { add: na, del: nb };
      }
      if ((prop.startsWith('prop:') || (prop.startsWith('@') && prop !== '@slot' && prop !== '@when')) && Z.get(id).when) { // inside `{flag && ...}` the wrapper changes form when the tag stops (or starts) fitting on the line
        const was = wrapExtra(ctx.textBefore, id) > 0, na = predictWrapped(ctx, after, Z.get(id));
        if (was !== (na > 1)) return { add: na, del: withWrap(ctx.textBefore, id) };
      }
      if (prop.startsWith('prop:')) return { add: 1 + predictExtra(ctx, after, Z.get(id)), del: tagLines(ctx.textBefore, id) }; // an instance's prop: its tag line (or the whole tag when the layout changes)
      if (prop.startsWith('@') && prop !== '@slot') return { add: 1 + predictExtra(ctx, after, Z.get(id)), del: tagLines(ctx.textBefore, id) }; // a tag that crosses 80 columns changes layout
      if (prop === 'text' || prop === '@slot') { // changing text is one line; adding or clearing it turns `<x />` into three lines or back
        const had = hasText(A.get(id)), has = hasText(Z.get(id));
        if (Z.get(id).when && had !== has) return { add: predictWrapped(ctx, after, Z.get(id)), del: withWrap(ctx.textBefore, id) };
        return { add: had && has ? 1 : has ? 3 + predictExtra(ctx, after, Z.get(id)) : 1 + predictExtra(ctx, after, Z.get(id)), del: had && has ? 1 : had ? 3 + extraTag(ctx.textBefore, id) : 1 };
      }
      if (edit.variant) {
        const [[axis, val]] = Object.entries(edit.variant);
        const had = before.variants?.[axis]?.[val]?.[id]?.[prop] !== undefined;
        return { add: pos(dV) + (had && edit.value !== null ? 1 : 0), del: Math.max(pos(-dV), pos(-dV) > 1 ? (blockLines(ctx.textBefore, id) + (pos(-dV) > blockLines(ctx.textBefore, id) ? blockLines(ctx.textBefore, val) - blockLines(ctx.textBefore, id) : 0)) : 0) + (had && edit.value !== null ? 1 : 0) };
      }
      const had = A.get(id).style[prop] !== undefined;
      const emptied = pos(-dB) > 1 ? blockLines(ctx.textBefore, id) : 0; // the last property of a node takes its whole block (comments inside it too)
      return { add: pos(dB) + (had && edit.value !== null ? 1 : 0), del: Math.max(pos(-dB), emptied) + (had && edit.value !== null ? 1 : 0) };
    }
    case 'renameProp': case 'renameVariant': { // only the lines that name it (and the parameter list, if the new name makes it break or fit on one line)
      const n = namingLines(ctx.textBefore, edit.name ?? edit.value);
      // a longer or shorter name can make a `{flag && <x />}` line (or an instance tag) stop fitting, or fit again
      let flipAdd = 0, flipDel = 0;
      if (edit.op === 'renameProp') for (const z of Z.values()) {
        if (z.children.length || hasText(z) || !(z.when === edit.to || (z.instance && Object.values(z.instance.props).some((v) => v && v.prop === edit.to)))) continue;
        const d = predictWrapped(ctx, after, z) - withWrap(ctx.textBefore, z.id);
        flipAdd += pos(d); flipDel += pos(-d);
      }
      if (flipAdd || flipDel) return pA === pB ? { add: n + flipAdd, del: n + flipDel } : { add: n + pA - 1 + flipAdd, del: n + pB - 1 + flipDel };
      return pA === pB ? { add: n, del: n } : { add: n + pA - 1, del: n + pB - 1 };
    }
    case 'rename': { const n = namingLines(ctx.textBefore, edit.id); return { add: n, del: n }; } // a node id: every line that names it (data-n, base key, override keys)
    case 'setDefault': return pc; // one line, or the whole parameter list when it now fits on one line (or no longer does)
    case 'addProp': { const r = { add: 1 + pc.add, del: pc.del }; return nodeSpec(before, after) ? { add: r.add + 1, del: r.del + 1 } : r; } // (+ the `ReactNode` word in the react import) // an interface member + the parameter list
    case 'removeProp': { const r = { add: pc.add, del: 1 + pc.del }; return nodeSpec(before, after) ? { add: r.add + 1, del: r.del + 1 } : r; }
    case 'bindText': {
      if (edit.prop === null) return hasText(Z.get(edit.id)) ? { add: 1, del: 1 } : { add: 1, del: 3 }; // unbinding a setting with no default leaves an empty element
      const line = hasText(A.get(edit.id)) ? { add: 1, del: 1 } : Z.get(edit.id).when ? { add: predictWrapped(ctx, after, Z.get(edit.id)), del: withWrap(ctx.textBefore, edit.id) } : { add: 3 + predictExtra(ctx, after, Z.get(edit.id)), del: 1 }; // the element: its text line, or `<x />` becoming three lines
      const fresh = !before.props.some((p) => p.name === edit.prop);
      return fresh ? { add: line.add + 1 + pc.add, del: line.del + pc.del } : line; // (+ a new prop: interface member and parameter list)
    }
    case 'addVariant': {
      const fresh = !before.props.some((p) => p.name === edit.axis);
      if (!fresh && memberLines(ctx.textBefore, edit.axis) > 1) return { add: 2, del: 1 }; // a union written one value per line: the new value's line, and the old last line loses its `;`
      if (!fresh) { const m = layoutCost(memberLines(ctx.textBefore, edit.axis), predictMember(ctx.textBefore, after, edit.axis)); return m; } // the union line (split when long)
      return { add: 2 + pc.add, del: 1 + pc.del }; // fresh axis: interface member, parameters, `const v` line
    }
    case 'removeVariant': {
      const gone = axes(before).length !== axes(after).length;
      const mB = memberLines(ctx.textBefore, edit.axis), mA = predictMember(ctx.textBefore, after, edit.axis);
      const nodesModel = (vals) => Object.values(vals || {}).reduce((a, st) => a + 2 + Object.keys(st).length, 0);
      const valueModel = before.variants?.[edit.axis]?.[edit.value] ? 2 + nodesModel(before.variants[edit.axis][edit.value]) : 0;
      const axisModel = gone ? 2 + Object.values(before.variants?.[edit.axis] || {}).reduce((a, v) => a + 2 + nodesModel(v), 0) : 0;
      const actual = blockLines(ctx.textBefore, edit.value) + (gone ? blockLines(ctx.textBefore, edit.axis) : 0);
      const gone2 = pos(-dV) + Math.max(0, actual - valueModel - axisModel + (gone ? valueModel : 0)); // (+ comment lines written inside the removed blocks)
      if (!gone && mB > 1) return { add: 2, del: 2 + gone2 }; // (a value's line in a one-per-line union)
      return gone ? { add: pc.add + 1, del: mB + 1 + pc.del + gone2 } : { add: layoutCost(mB, mA).add, del: layoutCost(mB, mA).del + gone2 };
    }
    case 'insert': {
      const parentLeaf = wasLeaf(before, edit.parent);
      const sub = predictElementLines(ctx, after, Z.get(edit.node.id));
      if (parentLeaf && Z.get(edit.parent).when) return { add: predictWrapped(ctx, after, Z.get(edit.parent)) - 1 + sub + pos(dB), del: withWrap(ctx.textBefore, edit.parent) + pos(-dB) };
      return { add: sub + (parentLeaf ? 2 + predictExtra(ctx, after, Z.get(edit.parent)) : 0) + pos(dB), del: (parentLeaf ? 1 : 0) + pos(-dB) };
    }
    case 'delete': {
      const parent = index(before).parentOf.get(edit.id);
      const sub = withWrap(ctx.textBefore, edit.id);
      const nowLeaf = parent.children.length === 1;
      const leafWhen = nowLeaf && Z.get(parent.id).when;
      return { add: leafWhen ? predictWrapped(ctx, after, Z.get(parent.id)) : nowLeaf ? 1 + predictExtra(ctx, after, Z.get(parent.id)) : 0, del: (leafWhen ? withWrap(ctx.textBefore, parent.id) : sub + (nowLeaf ? 2 + extraTag(ctx.textBefore, parent.id) : 0)) + pos(-dB) + pos(-dV) + Math.max(0, subtreeIds(A.get(edit.id)).reduce((a, i) => a + blockLines(ctx.textBefore, i) - modelBlockLines(before, i), 0)) }; // (+ comment lines written inside the removed blocks)
    }
    case 'move': {
      const n = A.get(edit.id), from = index(before).parentOf.get(edit.id);
      const sub = withWrap(ctx.textBefore, edit.id);
      const fromLeaf = from.children.length === 1 && from.id !== edit.parent;
      const toLeaf = wasLeaf(before, edit.parent) && from.id !== edit.parent;
      const toWhen = toLeaf && Z.get(edit.parent).when, fromWhen = fromLeaf && Z.get(from.id).when;
      const addTo = toWhen ? predictWrapped(ctx, after, Z.get(edit.parent)) : sub + (toLeaf ? 2 + predictExtra(ctx, after, Z.get(edit.parent)) : 0);
      const addFrom = fromWhen ? predictWrapped(ctx, after, Z.get(from.id)) : fromLeaf ? 1 + predictExtra(ctx, after, Z.get(from.id)) : 0;
      const delFrom = fromWhen ? withWrap(ctx.textBefore, from.id) - sub : fromLeaf ? 2 + extraTag(ctx.textBefore, from.id) : 0;
      return { add: addTo + addFrom, del: sub + delFrom + (toLeaf ? 1 : 0) };
    }
    default: return { add: Infinity, del: Infinity };
  }
}
const subtreeIds = (n) => subtree(n).map((x) => x.id);
export { subtree };
