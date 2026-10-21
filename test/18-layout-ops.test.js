// Layout lane (LAY-09): wrap, unwrap, duplicate and paste are model ops that write small, dialect-clean diffs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdits } from '../src/model.js';
import { readComponent } from '../src/tsx/read.js';
import { openStore } from '../src/store.js';
import { tempRepo } from './helpers/harness.js';

const ids = (n) => [n.id, ...n.children.flatMap(ids)];
const setup = async (names = ['Card']) => { const r = tempRepo(names); const store = await openStore(r.fileOf(names[0])); return { ...r, store, text: () => readFileSync(r.fileOf(names[0]), 'utf8') }; };
const apply = async (store, edits) => { const { revision } = await store.read(); const r = await store.apply({ baseRevision: revision, edits, by: 'test' }); assert.equal(r.ok, true, r.error); return r; };

test('wrap puts siblings in a new frame; unwrap lifts them back out (file round-trips)', async () => {
  const { store, text, file } = await setup();
  const original = text();
  await apply(store, [{ op: 'wrap', ids: ['title', 'body'], id: 'group', style: { display: 'flex', gap: 4 } }]);
  const doc = readComponent(text()).doc;
  assert.deepEqual(doc.root.children.map((c) => c.id), ['image', 'group']);
  assert.deepEqual(doc.root.children[1].children.map((c) => c.id), ['title', 'body']);
  assert.equal(doc.root.children[1].style.gap, 4);
  await apply(store, [{ op: 'unwrap', id: 'group' }]);
  const back = readComponent(text()).doc;
  assert.deepEqual(back.root.children.map((c) => c.id), ['image', 'title', 'body']);
  assert.equal(text().includes('group'), false, 'the frame and its style are gone');
  assert.equal(readComponent(original).doc.root.children.length, 3);
  await store.close(); void file;
});

test('duplicate makes a deep copy with fresh ids right after the original', async () => {
  const { store, text } = await setup();
  await apply(store, [{ op: 'wrap', ids: ['title', 'body'], id: 'group' }]);
  await apply(store, [{ op: 'duplicate', id: 'group' }]);
  const doc = readComponent(text()).doc;
  assert.deepEqual(doc.root.children.map((c) => c.id), ['image', 'group', 'group2']);
  assert.deepEqual(doc.root.children[2].children.map((c) => c.id), ['title2', 'body2']);
  assert.equal(doc.root.children[2].children[0].style.fontSize, '22px');
  assert.equal(new Set(ids(doc.root)).size, ids(doc.root).length, 'every id is unique');
  await store.close();
});

test('duplicate copies variant overrides; paste carries a subtree between components with fresh ids', async () => {
  const { store, text, fileOf } = await setup(['Button', 'Card']);
  await store.close();
  const btn = readComponent(readFileSync(fileOf('Button'), 'utf8')).doc;
  const dup = applyEdits(btn, [{ op: 'duplicate', id: 'label' }]);
  const label2 = dup.root.children.find((c) => c.id === 'label2');
  assert.ok(label2);
  const was = Object.values(btn.variants).flatMap((v) => Object.values(v)).filter((n) => n.label).length;
  const now = Object.values(dup.variants).flatMap((v) => Object.values(v)).filter((n) => n.label2).length;
  assert.equal(now, was, 'label2 inherits label\'s overrides');
  const card = readComponent(readFileSync(fileOf('Card'), 'utf8')).doc;
  const next = applyEdits(card, [{ op: 'paste', parent: 'card', tree: btn.root, variants: btn.variants }]);
  const pasted = next.root.children.at(-1);
  assert.equal(pasted.id, 'root', 'a free id is kept');
  assert.deepEqual(pasted.children.map((c) => c.id), ['label']);
  const again = applyEdits(next, [{ op: 'paste', parent: 'card', tree: btn.root }]);
  assert.equal(again.root.children.at(-1).id, 'root2');
  assert.equal(again.root.children.at(-1).children[0].id, 'label2');
  assert.deepEqual(Object.keys(next.variants), [], 'Card has no such axis, so overrides stay behind');
  // file level: the pasted subtree is valid dialect and a pure insertion
  const s2 = await openStore(fileOf('Card'));
  const before = readFileSync(fileOf('Card'), 'utf8');
  const { revision } = await s2.read();
  assert.equal((await s2.apply({ baseRevision: revision, by: 't', edits: [{ op: 'paste', parent: 'card', tree: btn.root }] })).ok, true);
  const after = readFileSync(fileOf('Card'), 'utf8');
  const parsed = readComponent(after).doc;
  assert.equal(parsed.root.children.at(-1).children[0].id, 'label');
  const removed = before.split('\n').filter((l) => !after.split('\n').includes(l));
  assert.equal(removed.length, 0, 'nothing already in the file was changed');
  await s2.close(); void text;
});

test('bad wrap, unwrap, duplicate and paste are refused with a reason', () => {
  const doc = readComponent(readFileSync(tempRepo().file, 'utf8')).doc;
  const bad = (e, re) => assert.throws(() => applyEdits(doc, [e]), re);
  bad({ op: 'duplicate', id: 'card' }, /root/);
  bad({ op: 'wrap', ids: ['card'], id: 'x' }, /root/);
  bad({ op: 'wrap', ids: ['title'], id: 'body' }, /already exists/);
  bad({ op: 'unwrap', id: 'title' }, /no elements/);
  bad({ op: 'paste', parent: 'title', tree: { id: 'a', tag: 'div', style: {} } }, /cannot hold elements/);
  bad({ op: 'paste', parent: 'card', tree: { id: 'a', tag: 'blink', style: {} } }, /not supported/);
});

test('undo and redo (the history lane) reverse wrap, unwrap, duplicate and paste byte for byte', async () => {
  const { store, text, fileOf } = await setup(['Card', 'Button']);
  const other = readComponent(readFileSync(fileOf('Button'), 'utf8')).doc.root;
  const original = text();
  const steps = [
    [{ op: 'wrap', ids: ['title', 'body'], id: 'group', style: { display: 'flex' } }],
    [{ op: 'duplicate', id: 'group' }],
    [{ op: 'paste', parent: 'card', tree: other }],
    [{ op: 'unwrap', id: 'group' }],
  ];
  const seen = [original];
  for (const edits of steps) { const { revision } = await store.read(); const r = await store.apply({ baseRevision: revision, edits, by: 'u' }); assert.equal(r.ok, true, r.error); seen.push(text()); }
  for (let i = steps.length - 1; i >= 0; i--) { const r = await store.undo('u'); assert.equal(r.ok, true, `undo step ${i}: ${r.error}`); assert.equal(text(), seen[i], `after undoing step ${i}`); }
  for (let i = 0; i < steps.length; i++) { const r = await store.redo('u'); assert.equal(r.ok, true, `redo step ${i}: ${r.error}`); assert.equal(text(), seen[i + 1], `after redoing step ${i}`); }
  await store.close();
});
