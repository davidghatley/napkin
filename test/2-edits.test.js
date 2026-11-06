// Build-first #2 (F02 + F03), on TSX: one safe edit path for both writers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdits, getValue } from '../src/model.js';
import { readComponent } from '../src/tsx/read.js';
import { openStore } from '../src/store.js';
import { tempRepo } from './helpers/harness.js';

const onDisk = (file) => readComponent(readFileSync(file, 'utf8')).doc;

test('applyEdits: set, insert, move and delete work on a copy', () => {
  const doc = onDisk(tempRepo().file);
  const next = applyEdits(doc, [
    { op: 'set', path: 'body.text', value: 'Hi' },
    { op: 'insert', parent: 'card', index: 3, node: { id: 'cta', tag: 'button', style: {}, text: 'Open', children: [] } },
    { op: 'move', id: 'cta', parent: 'card', index: 0 },
    { op: 'delete', id: 'image' },
  ]);
  assert.equal(getValue(next, 'body.text'), 'Hi');
  assert.deepEqual(next.root.children.map((c) => c.id), ['cta', 'title', 'body']);
  assert.equal(getValue(doc, 'body.text'), 'A person and an agent edit this Card at the same time.', 'input not mutated');
});

test('a rejected batch makes no change to the file and names the edit', async () => {
  const { file } = tempRepo();
  const store = await openStore(file);
  const before = readFileSync(file, 'utf8');
  const { revision } = await store.read();
  const r = await store.apply({ baseRevision: revision, by: 'test', edits: [
    { op: 'set', path: 'card.padding', value: '40px' },
    { op: 'set', path: 'nope.color', value: 'red' },
  ] });
  assert.equal(r.ok, false);
  assert.match(r.error, /^invalid edit #1/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal((await store.read()).revision, revision);
  await store.close();
});

test('an edit against an old revision of the same property returns stale revision', async () => {
  const { file } = tempRepo();
  const store = await openStore(file);
  const { revision: r0 } = await store.read();
  assert.equal((await store.apply({ baseRevision: r0, by: 'a', edits: [{ op: 'set', path: 'card.padding', value: '20px' }] })).ok, true);
  const after = readFileSync(file, 'utf8');
  const r = await store.apply({ baseRevision: r0, by: 'b', edits: [{ op: 'set', path: 'card.padding', value: '30px' }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /^stale revision/);
  assert.equal(readFileSync(file, 'utf8'), after);
  const u = await store.apply({ baseRevision: 'no-such-revision', by: 'b', edits: [{ op: 'set', path: 'body.color', value: 'red' }] });
  assert.match(u.error, /^stale revision/);
  await store.close();
});

test('two edits to different properties from the same revision both land', async () => {
  const { file } = tempRepo();
  const store = await openStore(file);
  const { revision: r0 } = await store.read();
  const [a, b] = await Promise.all([
    store.apply({ baseRevision: r0, by: 'canvas', edits: [{ op: 'set', path: 'card.padding', value: '28px' }] }),
    store.apply({ baseRevision: r0, by: 'agent', edits: [{ op: 'set', path: 'title.fontWeight', value: 600 }] }),
  ]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.notEqual(a.revision, b.revision);
  const doc = onDisk(file);
  assert.equal(getValue(doc, 'card.padding'), '28px');
  assert.equal(getValue(doc, 'title.fontWeight'), 600);
  await store.close();
});
