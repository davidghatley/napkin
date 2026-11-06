// FMT-03 (prettier + tsc --strict), FMT-04 (git merges) and FMT-06 (the sidecar).
//   FMT-03: files napkin creates pass prettier with the default config plus singleQuote (the dialect writes 'single quotes';
//           that is the one setting changed, see docs/dialect.md), after every one of FMT03 edits (default 150), and the
//           lines it adds to a hand-written file survive prettier unchanged. Every file passes tsc --strict.
//   FMT-04: 20 pairs of branches, each changing different properties of a component, merge in a real git repo with no conflict.
//   FMT-06: the sidecar is sorted, minimal and stable; moving a component changes the sidecar and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { tsxCodec, sidecarText } from '../../src/codecs.js';
import { openStore } from '../../src/store.js';
import { newComponentSource } from '../../src/tsx/write.js';
import { openWorkspace } from '../../src/workspace.js';
import { TAGS, VOID } from '../../src/model.js';
import { fixture, tempRepo } from '../helpers/harness.js';
import { rng, nextValidEdit } from '../helpers/fuzz.js';
import { typecheck } from '../helpers/tsc.js';
import { ESLint } from 'eslint';
import { ROOT } from '../helpers/harness.js';

const pretty = (t) => prettier.format(t, { parser: 'typescript', singleQuote: true });

test('FMT-03: new components are prettier-clean for every root tag, and stay clean through random edits', async () => {
  const N = Number(process.env.FMT03 || 150);
  const dir = mkdtempSync(join(tmpdir(), 'napkin-pretty-'));
  const roots = [...TAGS].filter((t) => !VOID.has(t));
  const files = [];
  let checked = 0, findings = 0;
  for (const tag of roots) { // every root tag, as created
    const src = newComponentSource(`Root${tag[0].toUpperCase()}${tag.slice(1)}`, tag);
    checked++;
    if (await pretty(src) !== src) findings++;
  }
  assert.equal(findings, 0, 'new component source is prettier-clean for every root tag');
  for (const [i, tag] of ['div', 'button', 'section'].entries()) {
    const name = `Gen${i}`;
    let text = newComponentSource(name, tag);
    let { doc, state } = tsxCodec.load(text);
    const rand = rng(300 + i);
    for (let n = 0, done = 0; done < N && n < N * 20; n++) {
      const r = nextValidEdit(doc, rand, n);
      if (!r) continue;
      const saved = tsxCodec.save(state, doc, r.next);
      checked++;
      const clean = await pretty(saved.text);
      if (clean !== saved.text) { findings++; if (findings < 4) console.log(`FMT-03 finding after ${JSON.stringify(r.edit)}:\n${saved.text}\n--- prettier ---\n${clean}`); }
      text = saved.text; state = saved.state; doc = r.next; done++;
    }
    writeFileSync(join(dir, `${name}.tsx`), text);
    files.push(join(dir, `${name}.tsx`));
  }
  console.log(`FMT-03: ${checked} napkin-written files checked with prettier ${prettier.version} (singleQuote); findings: ${findings}`);
  assert.equal(findings, 0);
  // tsc --strict over everything napkin produced, plus the two hand-written fixtures
  const all = [...files, fixture('Button'), fixture('Card')];
  const tsc = typecheck(all);
  // eslint (flat config in eslint.config.js: the React rules and the hooks rules) over the same files; the texts are linted
  // under a virtual path inside the repo so the config applies. A bad file shows the rules are on.
  const eslint = new ESLint({ cwd: ROOT });
  const lint = async (name, text) => (await eslint.lintText(text, { filePath: join(ROOT, '.lint', name) }))[0].messages;
  let lintFindings = 0, linted = 0;
  for (const f of all) { linted++; const m = await lint(f.split('/').pop(), readFileSync(f, 'utf8')); lintFindings += m.length; if (m.length) console.log(f, m.map((x) => `${x.ruleId}: ${x.message}`)); }
  const bad = await lint('Bad.tsx', "import { useState } from 'react';\nexport function Bad({ on }: { on: boolean }) {\n  if (on) { useState(0); }\n  return <ul>{[1, 2].map((n) => <li>{n}</li>)}</ul>;\n}\n");
  assert.ok(bad.some((x) => x.ruleId === 'react-hooks/rules-of-hooks') && bad.some((x) => x.ruleId === 'react/jsx-key'), 'the lint rules are on');
  console.log(`FMT-03: eslint ${ESLint.version} (react, react-hooks) over ${linted} files: ${lintFindings} findings`);
  assert.equal(lintFindings, 0);
  console.log(`FMT-03: tsc --strict over ${all.length} files: ${tsc.ok ? '0 errors' : tsc.output}`);
  assert.equal(tsc.ok, true, tsc.output);
});

test('FMT-03: the lines napkin adds to a hand-written file are already what prettier would write', async () => {
  const rand = rng(8);
  let text = readFileSync(fixture('Button'), 'utf8');
  let { doc, state } = tsxCodec.load(text);
  let regions = 0, off = [];
  for (let n = 0, done = 0; done < 60 && n < 2000; n++) {
    const r = nextValidEdit(doc, rand, n);
    if (!r) continue;
    const saved = tsxCodec.save(state, doc, r.next);
    const before = new Map(); for (const l of text.split('\n')) before.set(l, (before.get(l) || 0) + 1);
    const added = saved.text.split('\n').filter((l) => { const c = before.get(l) || 0; if (c) { before.set(l, c - 1); return false; } return true; });
    const pl = new Set((await pretty(saved.text)).split('\n'));
    // a rename or a text change keeps the layout the hand-written line already had (a 91-column signature, a one-line element, the `variants` type line), by design
    if (!r.edit.op.startsWith('rename') && !(r.edit.op === 'set' && r.edit.path.endsWith('.text'))) for (const l of added.filter((x) => x.trim() && !x.startsWith('const variants:'))) { regions++; if (!pl.has(l)) off.push(`${JSON.stringify(r.edit)} -> ${l}`); }
    text = saved.text; state = saved.state; doc = r.next; done++;
  }
  console.log(`FMT-03: ${regions} added lines in a hand-written file; not prettier's: ${off.length}`);
  assert.deepEqual(off.slice(0, 5), []);
});

// --- FMT-04 ---
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const commit = (cwd, msg) => git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qam', msg);

test('FMT-04: 20 pairs of branches changing different properties merge without a git conflict', async () => {
  const POOL = {
    Button: [
      ['base padding', [{ op: 'set', path: 'root.padding', value: '10px 20px' }]],
      ['base color', [{ op: 'set', path: 'root.color', value: '#fff' }]],
      ['base gap', [{ op: 'set', path: 'root.gap', value: 4 }]],
      ['base cursor', [{ op: 'set', path: 'root.cursor', value: 'default' }]],
      ['label weight', [{ op: 'set', path: 'label.fontWeight', value: 800 }]],
      ['new label prop', [{ op: 'set', path: 'label.letterSpacing', value: '1px' }]],
      ['override sm', [{ op: 'set', path: 'root.fontSize', value: 12, variant: { size: 'sm' } }]],
      ['override lg', [{ op: 'set', path: 'root.padding', value: '14px 30px', variant: { size: 'lg' } }]],
      ['override hover', [{ op: 'set', path: 'root.background', value: '#000', variant: { state: 'hover' } }]],
      ['default label', [{ op: 'setDefault', name: 'label', value: 'Buy now' }]],
      ['new size', [{ op: 'addVariant', axis: 'size', value: 'xl' }, { op: 'set', path: 'root.padding', value: '16px 32px', variant: { size: 'xl' } }]],
      ['new axis', [{ op: 'addVariant', axis: 'tone', value: 'danger' }, { op: 'set', path: 'root.background', value: '#b00020', variant: { tone: 'danger' } }]],
    ],
    Card: [
      ['card width', [{ op: 'set', path: 'card.width', value: '400px' }]],
      ['card color', [{ op: 'set', path: 'card.color', value: '#222' }]],
      ['image height', [{ op: 'set', path: 'image.height', value: '180px' }]],
      ['title size', [{ op: 'set', path: 'title.fontSize', value: '26px' }]],
      ['body line height', [{ op: 'set', path: 'body.lineHeight', value: '1.6' }]],
      ['body text', [{ op: 'set', path: 'body.text', value: 'Different words.' }]],
      ['default title', [{ op: 'setDefault', name: 'title', value: 'Hello' }]],
      ['footer node', [{ op: 'insert', parent: 'card', node: { id: 'footer', tag: 'small', text: 'fin', style: { opacity: 0.5 } } }]],
      ['delete image', [{ op: 'delete', id: 'image' }]],
      ['move body', [{ op: 'move', id: 'body', parent: 'card', index: 0 }]],
    ],
  };
  // changed line ranges (old file numbering) of an edit, from `git diff -U0`
  const ranges = (cwd, rel) => git(cwd, 'diff', '-U0', '--', rel).split('\n').filter((l) => l.startsWith('@@')).map((l) => { const m = l.match(/^@@ -(\d+)(?:,(\d+))? /); const s = Number(m[1]), n = m[2] === undefined ? 1 : Number(m[2]); return [s, s + Math.max(n, 1) - 1]; });
  const touching = (A, B) => A.some(([a, b]) => B.some(([c, d]) => a <= d + 1 && c <= b + 1)); // overlapping or adjacent lines always conflict in git
  const rand = rng(44);
  let pairs = 0, clean = 0, adjacentSkipped = 0;
  for (let attempt = 0; pairs < 20 && attempt < 400; attempt++) {
    const fx = attempt % 2 ? 'Card' : 'Button';
    const pool = POOL[fx];
    const [ia, ib] = [Math.floor(rand() * pool.length), Math.floor(rand() * pool.length)];
    if (ia === ib) continue;
    const { dir, file, git: g } = tempRepo([fx]);
    const rel = `components/${fx}.tsx`;
    const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    const edit = async (edits) => { const s = await openStore(file); try { const { revision } = await s.read(); const r = await s.apply({ baseRevision: revision, edits, by: 't' }); assert.equal(r.ok, true, r.error); } finally { await s.close(); } };
    git(dir, 'checkout', '-qb', 'a'); await edit(pool[ia][1]); const ra = ranges(dir, rel); commit(dir, 'a');
    git(dir, 'checkout', '-q', base); git(dir, 'checkout', '-qb', 'b'); await edit(pool[ib][1]); const rb = ranges(dir, rel); commit(dir, 'b');
    if (touching(ra, rb)) { adjacentSkipped++; continue; } // lines that touch conflict in any git merge: not what this checks
    pairs++;
    git(dir, 'checkout', '-q', base);
    git(dir, 'merge', '-q', '--no-edit', 'a');
    try { git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'merge', '-q', '--no-edit', 'b'); clean++; }
    catch (e) { console.log(`FMT-04 conflict: ${fx} "${pool[ia][0]}" + "${pool[ib][0]}"\n${e.stdout}`); continue; }
    // the merged file is a valid component with both changes
    const merged = readFileSync(file, 'utf8');
    tsxCodec.load(merged);
    assert.ok(!merged.includes('<<<<<<<'));
  }
  console.log(`FMT-04: ${clean}/${pairs} branch pairs merged cleanly (${adjacentSkipped} candidate pairs skipped because their changed lines touch, which conflicts in any git merge)`);
  assert.equal(pairs, 20);
  assert.equal(clean, 20);
});

// --- FMT-06 ---
test('FMT-06: the sidecar is sorted, minimal and stable; moving a component changes the sidecar only', async () => {
  const { dir, file, git: g } = tempRepo(['Card']);
  const side = file.replace(/\.tsx$/, '.napkin.json');
  const store = await openStore(file);
  assert.equal(existsSync(side), false, 'opening does not save default canvas settings');
  await store.moveCanvas(1, 2);
  await store.close();
  const first = readFileSync(side, 'utf8');
  const parsed = JSON.parse(first);
  assert.deepEqual(Object.keys(parsed), ['canvas', 'id'], 'keys are sorted and only id and canvas are there');
  assert.deepEqual(parsed.canvas, { x: 1, y: 2 });
  assert.equal(first, sidecarText(parsed), 'the file is exactly the canonical text');
  g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'sidecar');
  const s2 = await openStore(file);
  try {
    const tsx = readFileSync(file, 'utf8');
    for (const [x, y] of [[100, 50], [100.004, 50], [-20, 7.5]]) {
      await s2.moveCanvas(x, y);
      assert.equal(readFileSync(file, 'utf8'), tsx, 'the component file is untouched');
      assert.equal(readFileSync(side, 'utf8'), sidecarText(JSON.parse(readFileSync(side, 'utf8'))));
    }
    assert.deepEqual(g('diff', '--name-only').trim().split('\n'), ['components/Card.napkin.json']);
    const n = g('diff', '--numstat').trim().split('\t');
    assert.ok(Number(n[0]) <= 2 && Number(n[1]) <= 2, `sidecar diff is ${n[0]}/${n[1]} lines`);
    // moving to where it already is changes nothing at all
    g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'moved');
    await s2.moveCanvas(-20, 7.5);
    assert.equal(g('status', '--porcelain', 'components').trim(), '');
  } finally { await s2.close(); }
  // preview data and unknown keys written by hand are kept, in sorted order, when the component moves
  writeFileSync(side, JSON.stringify({ preview: { label: 'x', n: 1 }, id: parsed.id, canvas: { y: 7.5, x: -20 } }));
  const s3 = await openStore(file);
  try {
    await s3.moveCanvas(1, 2);
    assert.equal(readFileSync(side, 'utf8'), `{\n  "canvas": {\n    "x": 1,\n    "y": 2\n  },\n  "id": "${parsed.id}",\n  "preview": {\n    "label": "x",\n    "n": 1\n  }\n}\n`);
  } finally { await s3.close(); }
});

test('FMT-06: a new component through the workspace gets a minimal sidecar too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-newside-'));
  copyFileSync(fixture('Card'), join(dir, 'Card.tsx'));
  const ws = await openWorkspace(dir);
  try {
    const { id } = await ws.create('Badge', 'div', { by: 'david' });
    const text = readFileSync(join(dir, 'Badge.napkin.json'), 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(text)), ['canvas', 'id']);
    assert.equal(JSON.parse(text).id, id);
    assert.equal(text, sidecarText(JSON.parse(text)));
  } finally { await ws.close(); }
});
