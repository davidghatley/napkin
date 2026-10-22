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

test('WPC-16: one save with an earlier valid edit plus a break names the break, and the Next hint names the same line', async () => {
  const { fileOf } = tempRepo(['Card']);
  const file = fileOf('Card');
  const lines = readFileSync(file, 'utf8').split('\n');
  const valid = lines.findIndex((l) => l.includes("gap: '12px'")) + 1; // a valid change early in the file
  const at = lines.findIndex((l) => l.includes('<div data-n="image"')) + 1; // the break, parser trips on the next line
  assert.ok(valid > 0 && valid < at - 5, `${valid} ${at}`);
  const store = await openStore(file);
  lines[valid - 1] = lines[valid - 1].replace("'12px'", "'14px'");
  lines[at - 1] = lines[at - 1].replace(' />', ' ');
  writeFileSync(file, lines.join('\n'));
  const problem = (await waitFor(async () => (await store.read()).problem)).value;
  const named = [...problem.matchAll(/\bline (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(named[0], at, `the banner names the break, not the valid edit at ${valid}: ${problem}`);
  const secondary = problem.indexOf('parser stopped');
  const before = secondary < 0 ? problem : problem.slice(0, secondary);
  assert.deepEqual([...new Set([...before.matchAll(/\bline (\d+)/g)].map((m) => Number(m[1])))], [at], `banner and Next hint name one line: ${problem}`);
  assert.match(problem, new RegExp(`parser stopped at line ${at + 1}\\b`));
  await store.close();
});

test('WPC-16: when the whole file was reflowed, the banner still says where the parser stopped', async () => {
  const { fileOf } = tempRepo(['Card']);
  const file = fileOf('Card');
  const store = await openStore(file);
  const text = readFileSync(file, 'utf8').split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n').replace('<div data-n="image" style={s(\'image\', v)} />', '<div data-n="image" style={s(\'image\', v)} ');
  writeFileSync(file, text);
  const problem = (await waitFor(async () => (await store.read()).problem)).value;
  assert.match(problem, /parser stopped at line \d+/, problem);
  await store.close();
});
