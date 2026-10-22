// WPC-16: a parser gives up on the line AFTER an unclosed tag; the broken-file message names the line the hand edit changed
// (and says where the parser stopped), so the banner points at what was typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { openStore } from '../../src/store.js';
import { tempRepo, waitFor } from '../helpers/harness.js';

test('WPC-16: the banner names the edited line, and the parser line when it differs', async () => {
  const { fileOf } = tempRepo(['Card']);
  const file = fileOf('Card');
  const good = readFileSync(file, 'utf8');
  const lines = good.split('\n');
  const at = lines.findIndex((l) => l.includes('<div data-n="image"')) + 1; // 1-based line of the edit
  const store = await openStore(file);
  const { revision } = await store.read();
  lines[at - 1] = lines[at - 1].replace(' />', ' '); // an unclosed tag: the parser trips on the next line
  writeFileSync(file, lines.join('\n'));
  const problem = (await waitFor(async () => (await store.read()).problem)).value;
  assert.match(problem, new RegExp(`line ${at}\\b`), `names the edited line ${at}: ${problem}`);
  assert.match(problem, new RegExp(`parser stopped at line ${at + 1}\\b`), 'and the parser line');
  const r = await store.apply({ baseRevision: revision, edits: [{ op: 'set', path: 'title.fontSize', value: '31px' }], by: 'agent' });
  assert.match(r.error, new RegExp(`^Card\\.tsx has a syntax error at line ${at}; fix it .*The parser stopped at line ${at + 1}\\.$`));
  await store.close();
});
