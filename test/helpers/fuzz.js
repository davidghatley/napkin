// Seeded random edits against a model, shared by the fuzz tests (FMT-05, INV-03) and the corpus generator.
// randomEdit(doc, rand, n) returns { kind, edit } or null when the dice picked something that can't apply here.
import { applyEdits, index, EditError, checkInstances, pruneSwapped, instancePropFits } from '../../src/model.js';

// A small seeded PRNG so failures reproduce.
export function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const PROPS = ['padding', 'gap', 'borderRadius', 'background', 'color', 'fontSize', 'margin', 'width'];
const VALUES = [0, 4, 8, 12, 16, '1px solid #000', '#2236b0', '50%', 'auto', '8px 16px', -2];
const TAGS = ['div', 'span', 'img', 'p', 'button', 'small'];
const NEW_KINDS = ['addNum', 'addSlot', 'setWhen', 'setWhen', 'setSlot', 'setNum'];
const INSTANCE_KINDS = ['insertInst', 'insertInst', 'swapInst', 'instProp', 'instProp'];
const KINDS = ['set', 'set', 'set', 'override', 'override', 'insert', 'delete', 'move', 'text', 'bind', 'variant', 'removeVariant', 'attr', 'unset', 'addProp', 'removeProp', 'setDefault', 'insert', 'insert', 'cleartext', 'renameProp', 'renameVariant', 'renameNode'];

// ctx.siblings: { Name: doc } of components in the same folder that may be used as instances (with decision 0004's other constructs always on).
export const lookupOf = (siblings) => (siblings ? (name) => (siblings[name] ? { doc: siblings[name], reaches: () => false } : null) : null);
export function randomEdit(doc, rand, n, ctx = {}) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const nodes = [...index(doc).byId.values()];
  const holders = nodes.filter((x) => x.text === undefined && !x.textProp && !x.slot && !x.instance && x.tag !== 'img');
  const leaves = nodes.filter((x) => !x.children.length && x.tag !== 'img' && !x.instance && (x.id !== doc.root.id || nodes.length > 3));
  const axesNow = doc.props.filter((p) => p.type === 'enum');
  const sib = Object.keys(ctx.siblings || {});
  const kind = pick(sib.length ? [...KINDS, ...NEW_KINDS, ...INSTANCE_KINDS] : [...KINDS, ...NEW_KINDS]);
  let edit = null;
  if (kind === 'set') edit = { op: 'set', path: `${pick(nodes).id}.${pick(PROPS)}`, value: pick(VALUES) };
  else if (kind === 'unset') { const x = pick(nodes); const k = Object.keys(x.style)[0]; if (k) edit = { op: 'set', path: `${x.id}.${k}`, value: null }; }
  else if (kind === 'override') {
    const a = pick(axesNow);
    const val = a && pick(a.options.filter((o) => o !== a.default));
    if (val) edit = { op: 'set', path: `${pick(nodes).id}.${pick(PROPS)}`, value: rand() < 0.2 ? null : pick(VALUES), variant: { [a.name]: val } };
  } else if (kind === 'insert') {
    if (holders.length) {
      const tag = pick(TAGS);
      edit = { op: 'insert', parent: pick(holders).id, index: 0, node: { id: `n${n}`, tag, ...(tag !== 'img' && rand() < 0.5 ? { text: pick(['Hi', 'Buy now', 'a < b', "it's", '']) } : {}), ...(rand() < 0.5 ? { style: { padding: pick(VALUES) } } : {}) } };
    }
  } else if (kind === 'cleartext') { const x = pick(nodes.filter((y) => y.text !== undefined || y.textProp)); if (x) edit = { op: 'set', path: `${x.id}.text`, value: null }; }
  else if (kind === 'delete') { const x = nodes.length > 4 && pick(nodes.filter((y) => y.id !== doc.root.id)); if (x) edit = { op: 'delete', id: x.id }; }
  else if (kind === 'move') { const x = pick(nodes.filter((y) => y.id !== doc.root.id)); if (x && holders.length) edit = { op: 'move', id: x.id, parent: pick(holders).id }; }
  else if (kind === 'text') { if (leaves.length) edit = { op: 'set', path: `${pick(leaves).id}.text`, value: pick(['Go', 'Save {draft}', 'x & y', '  padded ', 'Done']) }; }
  else if (kind === 'bind') { if (leaves.length) edit = { op: 'bindText', id: pick(leaves).id, prop: rand() < 0.3 ? null : pick(['label', 'hint', 'title']) }; }
  else if (kind === 'variant') edit = { op: 'addVariant', axis: pick(['size', 'state', 'tone']), value: `v${n}` };
  else if (kind === 'removeVariant') { const a = pick(axesNow); const val = a && pick(a.options.filter((o) => o !== a.default)); if (val) edit = { op: 'removeVariant', axis: a.name, value: val }; }
  else if (kind === 'attr') { const imgs = nodes.filter((x) => x.tag === 'img'); if (imgs.length) edit = { op: 'set', path: `${pick(imgs).id}.@${pick(['src', 'alt'])}`, value: rand() < 0.2 ? null : pick(['/a.png', 'An "icon"', '']) }; }
  else if (kind === 'addProp') {
    const type = pick(['string', 'boolean', 'number']);
    edit = { op: 'addProp', name: `p${n}`, type, ...(rand() < 0.6 ? { default: type === 'string' ? pick(['Hi', 'a b']) : type === 'number' ? pick([0, 3, 12, -1]) : rand() < 0.5 } : {}) };
  } else if (kind === 'removeProp') { const p = pick(doc.props.filter((x) => x.type !== 'enum')); if (p) edit = { op: 'removeProp', name: p.name }; }
  else if (kind === 'setDefault') {
    const p = pick(doc.props);
    if (p && p.type !== 'node') edit = { op: 'setDefault', name: p.name, value: p.type === 'string' ? pick(['Go', 'Save', 'x y']) : p.type === 'boolean' ? rand() < 0.5 : p.type === 'number' ? pick([1, 2, 40]) : pick(p.options) };
  }
  if (kind === 'renameProp') { const p = pick(doc.props); if (p) edit = { op: 'renameProp', name: p.name, to: `r${n}` }; }
  else if (kind === 'renameVariant') { const a = pick(axesNow); const val = a && pick(a.options); if (val) edit = { op: 'renameVariant', axis: a.name, value: val, to: `w${n}` }; }
  else if (kind === 'renameNode') { const x = pick(nodes); if (x) edit = { op: 'rename', id: x.id, to: `m${n}` }; }
  else if (kind === 'addNum') edit = { op: 'addProp', name: `c${n}`, type: 'number', ...(rand() < 0.7 ? { default: pick([0, 1, 5, 12]) } : {}) };
  else if (kind === 'addSlot') edit = { op: 'addProp', name: rand() < 0.3 && !doc.props.some((p) => p.name === 'children') ? 'children' : `s${n}`, type: 'node' };
  else if (kind === 'setWhen') {
    const flags = doc.props.filter((p) => p.type === 'boolean'), x = pick(nodes.filter((y) => y.id !== doc.root.id));
    if (x && (flags.length || x.when)) edit = { op: 'set', path: `${x.id}.@when`, value: x.when && rand() < 0.5 ? null : pick(flags)?.name ?? null };
  } else if (kind === 'setSlot') {
    const slots = doc.props.filter((p) => p.type === 'node'), x = pick(nodes.filter((y) => !y.children.length && !y.instance && y.tag !== 'img'));
    if (x && (slots.length || x.slot)) edit = { op: 'set', path: `${x.id}.@slot`, value: x.slot && rand() < 0.4 ? null : pick(slots)?.name ?? null };
  } else if (kind === 'setNum') { const p = pick(doc.props.filter((x) => x.type === 'number')); if (p) edit = { op: 'setDefault', name: p.name, value: pick([0, 7, 99]) }; }
  else if (kind === 'insertInst' && holders.length) {
    const name = pick(sib), t = ctx.siblings[name];
    const props = {};
    for (const tp of t.props) {
      if (rand() < 0.5) continue;
      const mine = doc.props.filter((q) => instancePropFits(doc, { prop: q.name }, tp));
      if (mine.length && rand() < 0.3) props[tp.name] = { prop: pick(mine).name };
      else if (tp.type === 'string') props[tp.name] = pick(['Buy', "it's", 'a b']);
      else if (tp.type === 'number') props[tp.name] = pick([1, 5, -2]);
      else if (tp.type === 'boolean') props[tp.name] = rand() < 0.5;
      else if (tp.type === 'enum') props[tp.name] = pick(tp.options);
    }
    const flags = doc.props.filter((p) => p.type === 'boolean');
    edit = { op: 'insertInstance', parent: pick(holders).id, index: rand() < 0.5 ? 0 : undefined, id: `i${n}`, component: name, props, ...(flags.length && rand() < 0.3 ? { when: pick(flags).name } : {}) };
  } else if (kind === 'swapInst') { const x = pick(nodes.filter((y) => y.instance)); if (x) edit = { op: 'swapInstance', id: x.id, component: pick(sib) }; }
  else if (kind === 'instProp') {
    const x = pick(nodes.filter((y) => y.instance));
    const t = x && ctx.siblings[x.instance.component];
    const tp = t && pick(t.props.filter((q) => q.type !== 'node'));
    if (tp) {
      const mine = doc.props.filter((q) => instancePropFits(doc, { prop: q.name }, tp));
      const value = rand() < 0.2 ? null : mine.length && rand() < 0.3 ? { prop: pick(mine).name } : tp.type === 'string' ? pick(['Pay', 'x']) : tp.type === 'number' ? pick([2, 9]) : tp.type === 'boolean' ? rand() < 0.5 : pick(tp.options);
      edit = { op: 'set', path: `${x.id}.prop:${tp.name}`, value };
    }
  }
  return edit ? { kind, edit } : null;
}

// Draws until one edit is valid for `doc`; returns { kind, edit, next } or null after `tries` misses.
export function nextValidEdit(doc, rand, n, tries = 50, ctx = {}) {
  for (let i = 0; i < tries; i++) {
    const r = randomEdit(doc, rand, n * 100 + i, ctx);
    if (!r) continue;
    try {
      const lookup = lookupOf(ctx.siblings);
      const next = pruneSwapped(applyEdits(doc, [r.edit]), [r.edit], lookup);
      if (lookup && checkInstances(next, lookup)) continue;
      return { ...r, next };
    } catch (e) { if (!(e instanceof EditError)) throw e; }
  }
  return null;
}
