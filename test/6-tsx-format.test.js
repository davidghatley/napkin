// First build M1 (F01, F02, F03 on TSX, decision 0003): components are React .tsx files that
// napkin reads and writes without noise, and anything it can't write faithfully is read-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { tsxCodec } from '../src/codecs.js';
import { readComponent } from '../src/tsx/read.js';
import { newComponentSource } from '../src/tsx/write.js';
import { applyEdits, resolveStyle, variantGrid, index, EditError } from '../src/model.js';
import { ROOT } from './helpers/harness.js';

const fixture = (name) => join(ROOT, 'fixtures', name, `${name}.tsx`);

function repoWith(name) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-tsx-'));
  mkdirSync(join(dir, 'components'));
  const file = join(dir, 'components', `${name}.tsx`);
  copyFileSync(fixture(name), file);
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('add', '.');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  return { dir, file, git };
}
const numstat = (git) => git('diff', '--numstat', '--', 'components').trim().split('\n').filter(Boolean).filter((l) => l.endsWith('.tsx'));

test('load then save with no edits is byte-identical (Card, Button, a new component)', () => {
  for (const text of [readFileSync(fixture('Card'), 'utf8'), readFileSync(fixture('Button'), 'utf8'), newComponentSource('Badge')]) {
    const { doc, state } = tsxCodec.load(text);
    assert.equal(tsxCodec.save(state, doc, doc).text, text);
  }
});

test('one base property change is a one-line diff, and the result is still the same component', async () => {
  const { file, git } = repoWith('Button');
  const store = await openStore(file);
  try {
    const { revision } = await store.read();
    const r = await store.apply({ baseRevision: revision, by: 'canvas', edits: [{ op: 'set', path: 'root.borderRadius', value: 10 }] });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(numstat(git), [`1\t1\tcomponents/Button.tsx`]);
    assert.equal(readComponent(readFileSync(file, 'utf8')).doc.root.style.borderRadius, 10);
  } finally { await store.close(); }
});

test('one variant override change is a one-line diff', async () => {
  const { file, git } = repoWith('Button');
  const store = await openStore(file);
  try {
    const { revision } = await store.read();
    const r = await store.apply({ baseRevision: revision, by: 'agent', edits: [{ op: 'set', path: 'root.padding', value: '2px 6px', variant: { size: 'sm' } }] });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(numstat(git), [`1\t1\tcomponents/Button.tsx`]);
  } finally { await store.close(); }
});

test('a base change reaches every variant without an override, and overrides keep their value', () => {
  const { doc } = readComponent(readFileSync(fixture('Button'), 'utf8'));
  const grid = variantGrid(doc);
  assert.equal(grid.length, 6); // size md/sm/lg x state default/hover
  const next = applyEdits(doc, [{ op: 'set', path: 'root.borderRadius', value: 12 }, { op: 'set', path: 'root.background', value: '#123456' }]);
  for (const v of grid) {
    const st = resolveStyle(next, 'root', v);
    assert.equal(st.borderRadius, 12, JSON.stringify(v));
    assert.equal(st.background, v.state === 'hover' ? '#16181d' : '#123456', JSON.stringify(v));
  }
});

test('a rejected batch changes nothing; a stale edit is refused; edits to different keys from one base both land', async () => {
  const { file, git } = repoWith('Button');
  const store = await openStore(file);
  try {
    const before = readFileSync(file, 'utf8');
    const { revision } = await store.read();
    const bad = await store.apply({ baseRevision: revision, edits: [{ op: 'set', path: 'root.gap', value: 4 }, { op: 'set', path: 'nope.gap', value: 4 }] });
    assert.match(bad.error, /^invalid edit #1/);
    assert.equal(readFileSync(file, 'utf8'), before);
    const a = await store.apply({ baseRevision: revision, by: 'canvas', edits: [{ op: 'set', path: 'root.borderRadius', value: 9 }] });
    const b = await store.apply({ baseRevision: revision, by: 'agent', edits: [{ op: 'addVariant', axis: 'size', value: 'xl' }] });
    assert.equal(a.ok && b.ok, true, a.error || b.error);
    const stale = await store.apply({ baseRevision: revision, edits: [{ op: 'set', path: 'root.borderRadius', value: 3 }] });
    assert.match(stale.error, /^stale revision/);
    const { doc } = readComponent(readFileSync(file, 'utf8'));
    assert.equal(doc.root.style.borderRadius, 9);
    assert.deepEqual(doc.props.find((p) => p.name === 'size').options, ['md', 'sm', 'lg', 'xl']);
    assert.ok(git('diff', '--', 'components/Button.tsx').includes("size?: 'md' | 'sm' | 'lg' | 'xl';"));
  } finally { await store.close(); }
});

test('a file outside the dialect opens read-only and is never rewritten', async () => {
  const { file } = repoWith('Button');
  const hand = readFileSync(file, 'utf8').replace("const v = { size, state };", "const [on] = useState(false);\n  const v = { size, state };");
  writeFileSync(file, hand);
  const store = await openStore(file);
  try {
    const r = await store.read();
    assert.match(r.readOnly, /line \d+: the component body may only define `v` and return JSX/);
    const w = await store.apply({ baseRevision: r.revision, edits: [{ op: 'set', path: 'root.gap', value: 1 }] });
    assert.match(w.error, /^read-only: /);
    assert.equal(readFileSync(file, 'utf8'), hand);
  } finally { await store.close(); }
});

test('the sidecar keeps a stable component id across reopen (F09)', async () => {
  const { file } = repoWith('Card');
  const s1 = await openStore(file); const id1 = (await s1.read()).doc.id; await s1.close();
  assert.ok(existsSync(file.replace(/\.tsx$/, '.napkin.json')));
  const s2 = await openStore(file); const id2 = (await s2.read()).doc.id; await s2.close();
  assert.match(id1, /^cmp_card_/);
  assert.equal(id1, id2);
});

// A small seeded PRNG so failures reproduce.
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test('200 random edits keep the file parseable, in the dialect, and equal to the model', () => {
  const rand = rng(20261020);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const PROPS = ['padding', 'gap', 'borderRadius', 'background', 'color', 'fontSize', 'margin', 'width'];
  const VALUES = [0, 4, 8, 12, 16, '1px solid #000', '#2236b0', '50%', 'auto', '8px 16px', -2];
  const TAGS = ['div', 'span', 'img', 'p', 'button', 'small'];
  let text = readFileSync(fixture('Button'), 'utf8');
  let { doc, state } = tsxCodec.load(text);
  let n = 0, applied = 0;
  while (applied < 200 && n < 2000) {
    n++;
    const nodes = [...index(doc).byId.values()];
    const holders = nodes.filter((x) => x.text === undefined && !x.textProp && x.tag !== 'img');
    const leaves = nodes.filter((x) => !x.children.length && x.tag !== 'img');
    const axesNow = doc.props.filter((p) => p.type === 'enum');
    const kind = pick(['set', 'set', 'set', 'override', 'override', 'insert', 'delete', 'move', 'text', 'bind', 'variant', 'removeVariant', 'attr', 'unset']);
    let edit;
    if (kind === 'set') edit = { op: 'set', path: `${pick(nodes).id}.${pick(PROPS)}`, value: pick(VALUES) };
    else if (kind === 'unset') { const x = pick(nodes); const k = Object.keys(x.style)[0]; if (!k) continue; edit = { op: 'set', path: `${x.id}.${k}`, value: null }; }
    else if (kind === 'override') {
      const a = pick(axesNow); if (!a) continue; const val = pick(a.options.filter((o) => o !== a.default)); if (!val) continue;
      edit = { op: 'set', path: `${pick(nodes).id}.${pick(PROPS)}`, value: rand() < 0.2 ? null : pick(VALUES), variant: { [a.name]: val } };
    } else if (kind === 'insert') {
      if (!holders.length) continue;
      const tag = pick(TAGS);
      edit = { op: 'insert', parent: pick(holders).id, index: 0, node: { id: `n${n}`, tag, ...(tag !== 'img' && rand() < 0.5 ? { text: pick(['Hi', 'Buy now', 'a < b', "it's", '']) } : {}), ...(rand() < 0.5 ? { style: { padding: pick(VALUES) } } : {}) } };
    } else if (kind === 'delete') { const x = pick(nodes.filter((y) => y.id !== doc.root.id)); if (!x) continue; edit = { op: 'delete', id: x.id }; }
    else if (kind === 'move') { const x = pick(nodes.filter((y) => y.id !== doc.root.id)); if (!x || !holders.length) continue; edit = { op: 'move', id: x.id, parent: pick(holders).id }; }
    else if (kind === 'text') { if (!leaves.length) continue; edit = { op: 'set', path: `${pick(leaves).id}.text`, value: pick(['Go', 'Save {draft}', 'x & y', '  padded ', 'Done']) }; }
    else if (kind === 'bind') { if (!leaves.length) continue; edit = { op: 'bindText', id: pick(leaves).id, prop: rand() < 0.3 ? null : pick(['label', 'hint', 'title']) }; }
    else if (kind === 'variant') edit = { op: 'addVariant', axis: pick(['size', 'state', 'tone']), value: `v${n}` };
    else if (kind === 'removeVariant') { const a = pick(axesNow); if (!a) continue; const val = pick(a.options.filter((o) => o !== a.default)); edit = { op: 'removeVariant', axis: a.name, value: val }; }
    else if (kind === 'attr') { const imgs = nodes.filter((x) => x.tag === 'img'); if (!imgs.length) continue; edit = { op: 'set', path: `${pick(imgs).id}.@${pick(['src', 'alt'])}`, value: rand() < 0.2 ? null : pick(['/a.png', 'An "icon"', '']) }; }
    let next;
    try { next = applyEdits(doc, [edit]); } catch (e) { if (e instanceof EditError) continue; throw e; }
    const saved = tsxCodec.save(state, doc, next);
    const reread = readComponent(saved.text).doc;
    const { id, ...expected } = next;
    assert.deepEqual(reread, expected, `edit ${applied}: ${JSON.stringify(edit)}\n${saved.text}`);
    assert.doesNotMatch(saved.text, /\n\s*\n\s*\n/, `edit ${applied} left a double blank line`);
    ({ text } = saved); state = saved.state; doc = next; applied++;
  }
  assert.equal(applied, 200);
});
