// Build-first #1 (F01): the file can be the source of truth without noisy diffs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, serialize } from '../src/format.js';
import { applyEdits } from '../src/edits.js';
import { tempRepo } from './helpers/harness.js';

test('load and save with no edits is byte-identical', () => {
  const { file } = tempRepo();
  const before = readFileSync(file);
  writeFileSync(file, serialize(parse(before.toString('utf8'))));
  assert.ok(readFileSync(file).equals(before));
});

test('setting padding once is a one-line diff', () => {
  const { file, git } = tempRepo();
  const doc = parse(readFileSync(file, 'utf8'));
  writeFileSync(file, serialize(applyEdits(doc, [{ op: 'set', path: 'card.padding', value: '24px' }])));
  assert.equal(git('diff', '--numstat').trim(), '1\t1\tcomponents/Card.json');
});
