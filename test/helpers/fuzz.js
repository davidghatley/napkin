// Seeded random edits against a model, shared by the fuzz tests (FMT-05, INV-03) and the corpus generator.
// randomEdit(doc, rand, n) returns { kind, edit } or null when the dice picked something that can't apply here.
import { applyEdits, index, EditError } from '../../src/model.js';

// A small seeded PRNG so failures reproduce.
export function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const PROPS = ['padding', 'gap', 'borderRadius', 'background', 'color', 'fontSize', 'margin', 'width'];
const VALUES = [0, 4, 8, 12, 16, '1px solid #000', '#2236b0', '50%', 'auto', '8px 16px', -2];
const TAGS = ['div', 'span', 'img', 'p', 'button', 'small'];
const KINDS = ['set', 'set', 'set', 'override', 'override', 'insert', 'delete', 'move', 'text', 'bind', 'variant', 'removeVariant', 'attr', 'unset', 'addProp', 'removeProp', 'setDefault', 'insert', 'insert', 'cleartext'];

export function randomEdit(doc, rand, n) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const nodes = [...index(doc).byId.values()];
  const holders = nodes.filter((x) => x.text === undefined && !x.textProp && x.tag !== 'img');
  const leaves = nodes.filter((x) => !x.children.length && x.tag !== 'img' && (x.id !== doc.root.id || nodes.length > 3));
  const axesNow = doc.props.filter((p) => p.type === 'enum');
  const kind = pick(KINDS);
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
    const type = pick(['string', 'boolean']);
    edit = { op: 'addProp', name: `p${n}`, type, ...(rand() < 0.6 ? { default: type === 'string' ? pick(['Hi', 'a b']) : rand() < 0.5 } : {}) };
  } else if (kind === 'removeProp') { const p = pick(doc.props.filter((x) => x.type !== 'enum')); if (p) edit = { op: 'removeProp', name: p.name }; }
  else if (kind === 'setDefault') {
    const p = pick(doc.props);
    if (p) edit = { op: 'setDefault', name: p.name, value: p.type === 'string' ? pick(['Go', 'Save', 'x y']) : p.type === 'boolean' ? rand() < 0.5 : pick(p.options) };
  }
  return edit ? { kind, edit } : null;
}

// Draws until one edit is valid for `doc`; returns { kind, edit, next } or null after `tries` misses.
export function nextValidEdit(doc, rand, n, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const r = randomEdit(doc, rand, n * 100 + i);
    if (!r) continue;
    try { return { ...r, next: applyEdits(doc, [r.edit]) }; } catch (e) { if (!(e instanceof EditError)) throw e; }
  }
  return null;
}
