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
import { applyEdits, resolveStyle, variantGrid } from '../src/model.js';
import { ROOT } from './helpers/harness.js';
import { rng, nextValidEdit } from './helpers/fuzz.js';
import { siblingDocs } from './helpers/siblings.js';

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
    const bad = await store.apply({ baseRevision: revision, by: 'test', edits: [{ op: 'set', path: 'root.gap', value: 4 }, { op: 'set', path: 'nope.gap', value: 4 }] });
    assert.match(bad.error, /^invalid edit #1/);
    assert.equal(readFileSync(file, 'utf8'), before);
    const a = await store.apply({ baseRevision: revision, by: 'canvas', edits: [{ op: 'set', path: 'root.borderRadius', value: 9 }] });
    const b = await store.apply({ baseRevision: revision, by: 'agent', edits: [{ op: 'addVariant', axis: 'size', value: 'xl' }] });
    assert.equal(a.ok && b.ok, true, a.error || b.error);
    const stale = await store.apply({ baseRevision: revision, by: 'test', edits: [{ op: 'set', path: 'root.borderRadius', value: 3 }] });
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
    assert.match(r.readOnly, /line \d+: hooks/);
    const w = await store.apply({ baseRevision: r.revision, by: 'test', edits: [{ op: 'set', path: 'root.gap', value: 1 }] });
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

// FMT-05: the fuzz length is 200 by default (fast) and 2,000 with FUZZ=2000 (output kept in docs/evidence/FMT-05.txt).
const FUZZ = Number(process.env.FUZZ || 200);
test(`${FUZZ} random edits keep the file parseable, in the dialect, and equal to the model`, () => {
  const rand = rng(20261020);
  const siblings = siblingDocs(); // other components the fuzz may put in as instances (decision 0004)
  let text = readFileSync(fixture('Button'), 'utf8');
  let { doc, state } = tsxCodec.load(text);
  const kinds = {};
  let applied = 0;
  for (let n = 0; applied < FUZZ && n < FUZZ * 20; n++) {
    const r = nextValidEdit(doc, rand, n, 50, { siblings });
    if (!r) continue;
    const { edit, next } = r;
    const saved = tsxCodec.save(state, doc, next);
    const reread = readComponent(saved.text).doc;
    const { id, ...expected } = next;
    assert.deepEqual(reread, expected, `edit ${applied}: ${JSON.stringify(edit)}\n${saved.text}`);
    assert.doesNotMatch(saved.text, /\n\s*\n\s*\n/, `edit ${applied} left a double blank line`);
    // load -> save with no change gives the same bytes (round trip)
    const again = tsxCodec.load(saved.text);
    assert.equal(tsxCodec.save(again.state, again.doc, again.doc).text, saved.text, `edit ${applied}: no-op save changed bytes`);
    ({ text } = saved); state = saved.state; doc = next; applied++;
    kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  }
  assert.equal(applied, FUZZ);
  console.log(`fuzz: ${applied} edits applied; kinds ${JSON.stringify(kinds)}`);
});

test('setDefault changes a default in place: one-line diff, prop order kept, enum base guarded', async () => {
  const { file, git } = repoWith('Button');
  const store = await openStore(file);
  try {
    let { revision } = await store.read();
    const r = await store.apply({ baseRevision: revision, by: 'test', edits: [{ op: 'setDefault', name: 'label', value: 'Buy now' }] });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(numstat(git), [`1\t1\tcomponents/Button.tsx`]);
    assert.deepEqual(r.doc.props.map((p) => p.name), ['label', 'size', 'state']);
    const base = await store.apply({ baseRevision: r.revision, by: 'test', edits: [{ op: 'setDefault', name: 'size', value: 'sm' }] });
    assert.match(base.error, /size=sm has overrides/);
    const ok = await store.apply({ baseRevision: r.revision, by: 'test', edits: [{ op: 'addVariant', axis: 'size', value: 'xs' }, { op: 'setDefault', name: 'size', value: 'xs' }] });
    assert.equal(ok.ok, true, ok.error);
    assert.equal(readComponent(readFileSync(file, 'utf8')).doc.props[1].default, 'xs');
  } finally { await store.close(); }
});
