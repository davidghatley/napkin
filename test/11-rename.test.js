// CAN-04 support: the `rename` model op ("rename node") and its one-edit write-back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdits, EditError, touched } from '../src/model.js';
import { readComponent } from '../src/tsx/read.js';
import { openStore } from '../src/store.js';
import { tempRepo } from './helpers/harness.js';

test('rename changes one id, its variant overrides and nothing else', () => {
  const { file } = tempRepo(['Button']);
  const doc = readComponent(readFileSync(file, 'utf8')).doc;
  const next = applyEdits(doc, [{ op: 'rename', id: 'root', to: 'pill' }]);
  assert.equal(next.root.id, 'pill');
  assert.ok(next.variants.size.sm.pill, 'overrides follow the node');
  assert.equal(next.variants.size.sm.root, undefined);
  assert.deepEqual(touched([{ op: 'rename', id: 'root', to: 'pill' }]), new Set(['node:root', 'node:pill']));
  assert.throws(() => applyEdits(doc, [{ op: 'rename', id: 'root', to: 'label' }]), /already exists/);
  assert.throws(() => applyEdits(doc, [{ op: 'rename', id: 'root', to: 'Bad Id' }]), EditError);
  assert.throws(() => applyEdits(doc, [{ op: 'rename', id: 'nope', to: 'x' }]), /no node/);
});

test('rename through the store is one revision and a small diff (root: base key, variants, data-n, s())', async () => {
  const { file, git } = tempRepo(['Button']);
  const store = await openStore(file);
  const { revision } = await store.read();
  const r = await store.apply({ baseRevision: revision, by: 'test', edits: [{ op: 'rename', id: 'label', to: 'caption' }] });
  assert.equal(r.ok, true, r.error);
  assert.notEqual(r.revision, revision); // one new revision (a content hash)
  const text = readFileSync(file, 'utf8');
  assert.match(text, /<span data-n="caption" style=\{s\('caption', v\)\}>/);
  assert.equal(readComponent(text).doc.root.children[0].id, 'caption');
  assert.equal(git('diff', '--numstat').trim(), '2\t2\tcomponents/Button.tsx');
  const r2 = await store.apply({ baseRevision: r.revision, by: 'test', edits: [{ op: 'rename', id: 'root', to: 'pill' }] });
  assert.equal(r2.ok, true, r2.error);
  const t2 = readFileSync(file, 'utf8');
  assert.equal((t2.match(/pill/g) || []).length, 6, 'base key, data-n, s() call, size.sm, size.lg, state.hover');
  assert.ok(readComponent(t2).doc.variants.state.hover.pill);
  await store.close();
});
