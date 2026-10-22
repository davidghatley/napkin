// REL-04: a revision's document and text are kept in full only while it is recent (FULL in src/store.js); older ones are
// compressed and rebuilt on demand. Everything that reads an old revision must still give exactly what it gave before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tempRepo } from '../helpers/harness.js';
import { openStore } from '../../src/store.js';

test('undo, restore and preview work through revisions old enough to have been compressed', async (t) => {
  const { fileOf } = tempRepo(['Button']);
  const store = await openStore(fileOf('Button'));
  t.after(() => store.close());
  const first = await store.read();
  const revisions = [first.revision], texts = [first.source];
  for (let i = 1; i <= 40; i++) {
    const { revision } = await store.read();
    const r = await store.apply({ baseRevision: revision, by: 'tester', edits: [{ op: 'set', path: 'root.padding', value: `${i}px 20px` }] });
    assert.ok(r.ok, r.error);
    revisions.push(r.revision); texts.push(readFileSync(fileOf('Button'), 'utf8'));
  }
  // revision 5 is 35 steps old: far past the 3 that stay in full
  const old = store.at(revisions[5]);
  assert.ok(old, 'an old revision is still previewable');
  assert.equal(old.source, texts[5], 'its text is exactly what the file held');
  assert.equal(old.doc.root.style.padding, '5px 20px', 'and its document is rebuilt');

  const restored = await store.restore(revisions[5], 'tester');
  assert.ok(restored.ok, restored.error);
  assert.equal(readFileSync(fileOf('Button'), 'utf8'), texts[5], 'restoring an old revision writes its exact text');

  // undo walks back through the compressed ones, one exact step at a time
  const undone = await store.undo('tester');
  assert.ok(undone.ok, undone.error);
  assert.equal(readFileSync(fileOf('Button'), 'utf8'), texts[40]);
  for (let i = 40; i > 20; i--) {
    const u = await store.undo('tester');
    assert.ok(u.ok, u.error);
    assert.equal(readFileSync(fileOf('Button'), 'utf8'), texts[i - 1], `undo back to step ${i - 1}`);
  }
  assert.equal(store.history(500).length, 1 + 40 + 1 + 1 + 20, 'every revision is still listed');
});
