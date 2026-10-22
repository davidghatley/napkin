// INV-03 + FMT-02: every edit type stays within its diff budget, measured with git diff --numstat on a real repo.
//   - a table of named cases with exact expectations (the numbers in docs/dialect.md);
//   - a fuzz where every op's numstat is checked against test/helpers/budget.js (OPS=200 by default, OPS=1000 for more);
//   - moving a component on the canvas changes the sidecar only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { openStore } from '../../src/store.js';
import { index } from '../../src/model.js';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempRepo } from '../helpers/harness.js';
import { makeCorpus } from '../helpers/corpus.js';
import { rng, nextValidEdit, lookupOf } from '../helpers/fuzz.js';
import { siblingDocs, writeSiblings } from '../helpers/siblings.js';
import { budget, signatureLines } from '../helpers/budget.js';
import { commentDiff, mayDropComments } from '../helpers/comments.js';

// { added, removed } for one file since the last commit; the commit is then made so the next op is measured alone.
function measure(git, rel) {
  // --minimal: with several identical lines (a file full of the same comment) git's default heuristic can show a move as a bigger edit than it is
  const out = git('diff', '--minimal', '--numstat').trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  const row = (f) => { const r = out.find((x) => x[2] === f); return r ? { add: Number(r[0]), del: Number(r[1]) } : { add: 0, del: 0 }; };
  const res = { file: row(rel), others: out.filter((x) => x[2] !== rel).map((x) => x[2]) };
  git('add', rel); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'op', '--allow-empty');
  return res;
}

const TABLE = [
  // [name, fixture, edits, expected { add, del }]
  ['set style: change a value', 'Button', [{ op: 'set', path: 'root.borderRadius', value: 12 }], [1, 1]],
  ['set style: add a property to a styled node', 'Button', [{ op: 'set', path: 'label.color', value: '#fff' }], [1, 0]],
  ['set style: remove a property', 'Button', [{ op: 'set', path: 'root.cursor', value: null }], [0, 1]],
  ['set text', 'Card', [{ op: 'set', path: 'body.text', value: 'New body copy' }], [1, 1]],
  ['set attribute', 'Card', [{ op: 'insert', parent: 'card', index: 0, node: { id: 'pic', tag: 'img' } }, { op: 'set', path: 'pic.@src', value: '/a.png' }], [1, 0]],
  ['setDefault', 'Button', [{ op: 'setDefault', name: 'label', value: 'Buy now' }], [1, 1]],
  ['addVariant: a value on an existing axis', 'Button', [{ op: 'addVariant', axis: 'size', value: 'xl' }], [1, 1]],
  ['addVariant + override: the union line and the new value block', 'Button', [{ op: 'addVariant', axis: 'size', value: 'xl' }, { op: 'set', path: 'root.padding', value: '14px 28px', variant: { size: 'xl' } }], [1 + 5, 1]],
  ['override: change an existing override', 'Button', [{ op: 'set', path: 'root.padding', value: '2px 6px', variant: { size: 'sm' } }], [1, 1]],
  ['override: a new property in an existing node block', 'Button', [{ op: 'set', path: 'root.color', value: '#fff', variant: { size: 'sm' } }], [1, 0]],
  ['override: a new node block in an existing value', 'Button', [{ op: 'set', path: 'label.color', value: '#fff', variant: { size: 'sm' } }], [3, 0]],
  ['override: a new value block', 'Button', [{ op: 'addVariant', axis: 'size', value: 'xs' }, { op: 'set', path: 'root.gap', value: 2, variant: { size: 'xs' } }], [1 + 5, 1]],
  ['override: remove one of several properties', 'Button', [{ op: 'set', path: 'root.fontSize', value: null, variant: { size: 'sm' } }], [0, 1]],
  ['rename a prop: the interface member, the parameter, the element that shows it', 'Button', [{ op: 'renameProp', name: 'label', to: 'caption' }], [3, 3]],
  ['rename a variant axis: member, parameter, `const v`, the variants key', 'Button', [{ op: 'renameProp', name: 'size', to: 'scale' }], [4, 4]],
  ['rename a variant value (not the base): the union line and the override key', 'Button', [{ op: 'renameVariant', axis: 'size', value: 'sm', to: 'small' }], [2, 2]],
  ['rename the base value of an axis: the union line and the default', 'Button', [{ op: 'renameVariant', axis: 'size', value: 'md', to: 'medium' }], [2, 2]],
  ['rename a node id: its element line and its base block key', 'Card', [{ op: 'rename', id: 'title', to: 'heading' }], [2, 2]],
  ['rename a node id that has overrides: element, base key, override keys', 'Button', [{ op: 'rename', id: 'root', to: 'frame' }], [5, 5]],
  ['move a node (its JSX line)', 'Card', [{ op: 'move', id: 'body', parent: 'card', index: 0 }], [1, 1]],
];

for (const [name, fixture, edits, [add, del]] of TABLE) {
  test(`FMT-02 budget: ${name}: +${add} / -${del}`, async () => {
    const { file, git } = tempRepo([fixture]);
    const rel = `components/${fixture}.tsx`;
    const store = await openStore(file);
    try {
      const { revision } = await store.read();
      const r = await store.apply({ baseRevision: revision, edits, by: 'test' });
      assert.equal(r.ok, true, r.error);
      const m = measure(git, rel);
      assert.deepEqual(m.file, { add, del });
      assert.deepEqual(m.others, [], 'only the component file changed');
    } finally { await store.close(); }
  });
}

test('FMT-02 budget: moving a component on the canvas changes the sidecar only', async () => {
  const { file, git, dir } = tempRepo(['Card']);
  const store = await openStore(file);
  try {
    await store.moveCanvas(1, 2);
    git('add', 'components/Card.napkin.json'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'sidecar');
    // The first move saves the sidecar; later moves keep the small diff budget.
    const tsx = readFileSync(file, 'utf8');
    const r = await store.moveCanvas(120.456, -40);
    assert.deepEqual(r, { ok: true, canvas: { x: 120.46, y: -40 } });
    const out = git('diff', '--numstat').trim().split('\n').map((l) => l.split('\t'));
    assert.deepEqual(out.map((x) => x[2]), ['components/Card.napkin.json']);
    assert.ok(Number(out[0][0]) <= 2 && Number(out[0][1]) <= 2, `sidecar diff ${out[0]}`);
    assert.equal(readFileSync(file, 'utf8'), tsx);
    assert.equal((await store.read()).revision, (await store.read()).revision);
    const bad = await store.moveCanvas('x', 1);
    assert.equal(bad.ok, false);
  } finally { await store.close(); }
});

// Comments and blank lines a person left survive every edit (the critic's four shapes).
test('FMT-02: comments and blank lines survive edits: trailing comment, blank-line group, JSX comment, comment line', async () => {
  const CASES = {
    trailing: [(t) => t.replace("padding: '16px',", "padding: '16px', // roomy"), { op: 'set', path: 'card.padding', value: '20px' }, [1, 1], ['// roomy']],
    blank: [(t) => t.replace("padding: '16px',\n", "padding: '16px',\n\n\n"), { op: 'set', path: 'card.padding', value: '20px' }, [1, 1], ["\n\n\n"]],
    jsxcomment: [(t) => t.replace('      <div data-n="image"', '      {/* hero */}\n      <div data-n="image"'), { op: 'set', path: 'title.text', value: 'Hello' }, [1, 1], ['{/* hero */}']],
    linecomment: [(t) => t.replace("    gap: '12px',", "    // spacing\n    gap: '12px',"), { op: 'set', path: 'card.gap', value: '20px' }, [1, 1], ['// spacing']],
    textTrailingJsxComment: [(t) => t.replace('A person and an agent edit this Card at the same time.</p>', 'A person and an agent edit this Card at the same time.</p> {/* tail */}').replace('      <h3 data-n="title"', '      {/* before title */}\n      <h3 data-n="title"'), { op: 'set', path: 'body.text', value: 'Plain new text, with &amp; and <b>' }, [1, 1], ['{/* tail */}', '{/* before title */}', 'Plain new text, with &amp;amp; and &lt;b&gt;']],
    textCommentBetweenAttrs: [(t) => t.replace('<p data-n="body" style={s(\'body\', v)}>', '<p\n        data-n="body" // keep me\n        style={s(\'body\', v)}\n      >'), { op: 'set', path: 'body.text', value: 'Short' }, [1, 1], ['// keep me', '>Short</p>']],
    insertBeside: [(t) => t.replace('      <div data-n="image"', '      {/* hero */}\n      <div data-n="image"'), { op: 'insert', parent: 'card', index: 1, node: { id: 'note', tag: 'small' } }, [1, 0], ['{/* hero */}']],
    deleteBeside: [(t) => t.replace('      <h3 data-n="title"', '      {/* title next */}\n      <h3 data-n="title"'), { op: 'delete', id: 'image' }, [0, 6], ['{/* title next */}']],
  };
  for (const [name, [edit, op, [add, del], keep]] of Object.entries(CASES)) {
    const { file, git } = tempRepo(['Card']);
    writeFileSync(file, edit(readFileSync(file, 'utf8')));
    git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'hand');
    const store = await openStore(file);
    try {
      const { revision } = await store.read();
      const r = await store.apply({ baseRevision: revision, edits: [op], by: 'test' });
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(measure(git, 'components/Card.tsx').file, { add, del }, name);
      for (const k of keep) assert.ok(readFileSync(file, 'utf8').includes(k), `${name}: ${JSON.stringify(k)} survived`);
    } finally { await store.close(); }
  }
});

const OPS = Number(process.env.OPS || 200);
test(`INV-03: ${OPS}-op fuzz, git diff --numstat per op, 0 ops over budget`, async () => {
  const rand = rng(1021);
  const { file, git } = tempRepo(['Button']);
  const rel = 'components/Button.tsx';
  writeSiblings(dirname(file)); // Chip and Badge sit beside it: the fuzz adds and swaps instances of them too
  const siblings = siblingDocs(), look = lookupOf(siblings);
  const store = await openStore(file, { components: { lookup: (name) => look(name) } });
  const over = [];
  const per = {};
  try {
    for (let n = 0, done = 0; done < OPS && n < OPS * 20; n++) {
      const { doc, revision, source: srcBefore } = await store.read();
      const r = nextValidEdit(doc, rand, n, 50, { siblings });
      if (!r) continue;
      const res = await store.apply({ baseRevision: revision, edits: [r.edit], by: 'fuzz' });
      assert.equal(res.ok, true, `${JSON.stringify(r.edit)}: ${res.error}`);
      const m = measure(git, rel);
      const srcAfter = (await store.read()).source;
      const b = budget(r.edit, doc, res.doc, { sigBefore: signatureLines(srcBefore), textBefore: srcBefore, textAfter: srcAfter });
      const stat = (per[r.edit.op + (r.edit.variant ? '+variant' : '')] ??= { n: 0, maxAdd: 0, maxDel: 0, budgetAdd: 0, budgetDel: 0 });
      stat.n++; stat.maxAdd = Math.max(stat.maxAdd, m.file.add); stat.maxDel = Math.max(stat.maxDel, m.file.del);
      stat.budgetAdd = Math.max(stat.budgetAdd, b.add); stat.budgetDel = Math.max(stat.budgetDel, b.del);
      if (m.file.add > b.add || m.file.del > b.del || m.others.length) over.push({ n: done, edit: r.edit, got: m.file, budget: b, others: m.others, ...(process.env.DUMP ? { before: srcBefore, after: srcAfter } : {}) });
      done++;
    }
    console.log(`INV-03: ${OPS} ops; over budget: ${over.length}`);
    console.log(JSON.stringify(per, null, 1));
    if (over.length) console.log(JSON.stringify(over.slice(0, process.env.DUMP ? 20 : 12)));
    assert.deepEqual(over.slice(0, 5), [], `${over.length} ops over budget`);
  } finally { await store.close(); }
});
// Hand-formatted files (comments on property lines and between properties, blank-line groups, JSX comments, no trailing commas, no interface semicolons, compounded indentation, tabs, CRLF, double quotes, comments, blank lines), four corpora of 20 files.
const HAND = Number(process.env.HAND_OPS || 100), HAND_FILES = Number(process.env.HAND_FILES || 20);
const HAND_SEEDS = (process.env.HAND_SEEDS || '1,2,3,777').split(',').map(Number);
for (const seed of HAND_SEEDS) {
  test(`INV-03: budgets also hold on hand-formatted files (seed ${seed}: ${HAND} ops over ${HAND_FILES} corpus files)`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'napkin-hand-'));
    mkdirSync(join(dir, 'components'));
    const files = makeCorpus(join(dir, 'components'), HAND_FILES, seed);
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('add', 'components');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'corpus');
    const rand = rng(77 + seed);
    const siblings = siblingDocs(), look = lookupOf(siblings);
    const over = [];
    let ops = 0;
    for (const file of files) {
      const rel = `components/${basename(file)}`;
      const store = await openStore(file, { components: { lookup: (name) => look(name) } });
      try {
        for (let n = 0, done = 0; done < HAND / HAND_FILES && n < 400; n++) {
          const { doc, revision, source } = await store.read();
          const r = nextValidEdit(doc, rand, n, 50, { siblings });
          if (!r) continue;
          const res = await store.apply({ baseRevision: revision, edits: [r.edit], by: 'fuzz' });
          assert.equal(res.ok, true, `${rel} ${JSON.stringify(r.edit)}: ${res.error}`);
          const m = measure(git, rel);
          const srcAfter = (await store.read()).source;
          const b = budget(r.edit, doc, res.doc, { sigBefore: signatureLines(source), textBefore: source, textAfter: srcAfter });
          if (m.file.add > b.add || m.file.del > b.del) over.push({ rel, edit: r.edit, got: m.file, budget: b, ...(process.env.DUMP ? { before: source, after: srcAfter } : {}) });
          const cd = commentDiff(source, srcAfter);
          if (cd.invented.length || (cd.lost.length && !mayDropComments(r.edit))) over.push({ rel, edit: r.edit, comments: cd });
          done++; ops++;
        }
      } finally { await store.close(); }
    }
    console.log(`INV-03 (hand-formatted, seed ${seed}): ${ops} ops; over budget: ${over.length}`);
    if (over.length) console.log(JSON.stringify(over.slice(0, process.env.DUMP ? 20 : 8)));
    assert.deepEqual(over.slice(0, 5), []);
  });
}
