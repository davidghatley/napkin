// Build-first #1 (F01), on TSX: the file can be the source of truth without noisy diffs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tsxCodec } from '../src/codecs.js';
import { openStore } from '../src/store.js';
import { tempRepo } from './helpers/harness.js';

test('load and save with no edits is byte-identical', () => {
  const { file } = tempRepo();
  const before = readFileSync(file, 'utf8');
  const { doc, state } = tsxCodec.load(before, file);
  assert.equal(tsxCodec.save(state, doc, doc).text, before);
});

test('setting padding once is a one-line diff', async () => {
  const { file, git } = tempRepo();
  const store = await openStore(file);
  try {
    const { revision } = await store.read();
    const r = await store.apply({ baseRevision: revision, by: 'test', edits: [{ op: 'set', path: 'card.padding', value: '24px' }] });
    assert.equal(r.ok, true, r.error);
    assert.equal(git('diff', '--numstat').trim(), '1\t1\tcomponents/Card.tsx');
  } finally { await store.close(); }
});
