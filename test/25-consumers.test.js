// Consumer integrity (decision 0004): changing a prop or a variant value of a component that others use keeps the others working.
// renameProp / renameVariant rewrite every consumer in the same change (host first, then the consumers in name order, rolled back
// if one cannot be written); removeProp / removeVariant are refused while a consumer passes the thing, naming the consumer and line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace } from '../src/workspace.js';
import { ROOT } from './helpers/harness.js';
import { typecheck } from './helpers/tsc.js';
import { makeCorpus } from './helpers/corpus.js';
import { openStore } from '../src/store.js';
import { index } from '../src/model.js';

const DATA = join(ROOT, 'test', 'fixtures', '0004');
function folder(names = ['Button', 'Panel']) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-cons-'));
  for (const n of names) copyFileSync(join(DATA, `${n}.tsx`), join(dir, `${n}.tsx`));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'x');
  return { dir, git, text: (n) => readFileSync(join(dir, `${n}.tsx`), 'utf8') };
}
const run = async (ws, name, edits, extra = {}) => { const e = ws.find(name); const { revision } = await e.store.read(); return e.store.apply({ baseRevision: revision, edits, by: 'test', ...extra }); };
const numstat = (git) => git('diff', '--numstat', '--', '*.tsx').trim().split('\n').filter(Boolean).map((l) => l.split('\t').slice(0, 3).join(' ')).sort();

test('renameProp rewrites the consumers: the host and Panel change together, one line each, and tsc --strict still passes', async () => {
  const { dir, git, text } = folder();
  const ws = await openWorkspace(dir);
  try {
    const r = await run(ws, 'Button', [{ op: 'renameProp', name: 'label', to: 'caption' }]);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.updated, ['Panel']);
    assert.match(text('Panel'), /caption="Buy"/);
    assert.doesNotMatch(text('Panel'), /label=/);
    assert.match(text('Button'), /caption\?: string/);
    const ns = numstat(git); // Button: the member, the parameter, nothing else; Panel: the tag (it no longer fits on one line, so prettier breaks it)
    assert.equal(ns.length, 2); assert.match(ns.find((l) => l.endsWith('Button.tsx')), /^2 2 /);
    assert.equal(typecheck([join(dir, 'Panel.tsx'), join(dir, 'Button.tsx')]).ok, true, typecheck([join(dir, 'Panel.tsx'), join(dir, 'Button.tsx')]).output);
    // history: both files name the change, attributed to the caller
    for (const n of ['Button', 'Panel']) { const h = ws.find(n).store.history(1)[0]; assert.equal(h.by, 'test'); assert.match(h.summary, /rename.*label.*caption/i, n); }
    // a pass-through prop (tone={title}) is renamed too, keeping the attribute order
    const r2 = await run(ws, 'Button', [{ op: 'renameProp', name: 'tone', to: 'shade' }]);
    assert.equal(r2.ok, true, r2.error);
    assert.match(text('Panel'), /disabled=\{true\}\s+shade=\{title\}/);
    assert.equal(typecheck([join(dir, 'Panel.tsx'), join(dir, 'Button.tsx')]).ok, true);
    // the consumer can still be edited (it was refused before: "Button has no prop label")
    assert.equal((await run(ws, 'Panel', [{ op: 'set', path: 'root.padding', value: 20 }])).ok, true);
  } finally { await ws.close(); }
});

test('renameVariant rewrites the literal values consumers pass', async () => {
  const { dir, text } = folder();
  const ws = await openWorkspace(dir);
  try {
    const r = await run(ws, 'Button', [{ op: 'renameVariant', axis: 'size', value: 'sm', to: 'small' }]);
    assert.equal(r.ok, true, r.error);
    assert.match(text('Panel'), /size="small"/);
    assert.equal(typecheck([join(dir, 'Panel.tsx'), join(dir, 'Button.tsx')]).ok, true);
  } finally { await ws.close(); }
});

test('removeProp and removeVariant are refused while a consumer passes the thing, naming the consumer and the line; nothing changes', async () => {
  const { dir, git, text } = folder();
  const ws = await openWorkspace(dir);
  try {
    const line = text('Panel').split('\n').findIndex((l) => l.includes('data-n="cta"')) + 1;
    const r = await run(ws, 'Button', [{ op: 'removeProp', name: 'label' }]);
    assert.equal(r.ok, false);
    assert.match(r.error, new RegExp(`Button\\.label is passed by Panel \\(line ${line}\\); remove it there first`));
    const v = await run(ws, 'Button', [{ op: 'removeVariant', axis: 'size', value: 'sm' }]);
    assert.equal(v.ok, false); assert.match(v.error, /Button\.size.* is passed by Panel \(line \d+\)/);
    assert.equal(git('status', '--porcelain', '--', '*.tsx').trim(), '');
    // the dry run says the same without writing
    assert.equal((await run(ws, 'Button', [{ op: 'removeProp', name: 'tone' }], { dryRun: true })).ok, false);
    // a prop nobody passes can go
    assert.equal((await run(ws, 'Button', [{ op: 'addProp', name: 'extra', type: 'string' }])).ok, true);
    assert.equal((await run(ws, 'Button', [{ op: 'removeProp', name: 'extra' }])).ok, true);
    // remove it in the consumer first, then the host agrees
    assert.equal((await run(ws, 'Panel', [{ op: 'set', path: 'cta.prop:label', value: null }])).ok, true);
    assert.equal((await run(ws, 'Button', [{ op: 'removeProp', name: 'label' }])).ok, true);
    assert.equal(typecheck([join(dir, 'Panel.tsx'), join(dir, 'Button.tsx')]).ok, true);
  } finally { await ws.close(); }
});

test('a batch is judged in order: rename then remove of the new name is refused too', async () => {
  const { dir, git } = folder();
  const ws = await openWorkspace(dir);
  try {
    const r = await run(ws, 'Button', [{ op: 'renameProp', name: 'label', to: 'caption' }, { op: 'removeProp', name: 'caption' }]);
    assert.equal(r.ok, false); assert.match(r.error, /passed by Panel/);
    assert.equal(git('status', '--porcelain', '--', '*.tsx').trim(), '');
  } finally { await ws.close(); }
});

test('if a consumer cannot be written, everything is put back and the caller is told', async () => {
  const { dir, git, text } = folder();
  const ws = await openWorkspace(dir);
  try {
    const panel = ws.find('Panel'), real = panel.store.apply.bind(panel.store);
    panel.store.apply = async (req, meta) => (req.edits?.[0]?.op === 'renameInstanceProp' ? { ok: false, error: 'the consumer said no' } : real(req, meta));
    const r = await run(ws, 'Button', [{ op: 'renameProp', name: 'label', to: 'caption' }]);
    assert.equal(r.ok, false); assert.match(r.error, /Panel.*said no|said no.*Panel/);
    assert.match(text('Button'), /label\?: string/);
    assert.equal(git('status', '--porcelain', '--', '*.tsx').trim(), '', 'both files are as they were');
    panel.store.apply = real;
    assert.equal((await run(ws, 'Button', [{ op: 'renameProp', name: 'label', to: 'caption' }])).ok, true, 'and a retry works');
  } finally { await ws.close(); }
});

test('a consumer that is read-only stops the change before anything is written', async () => {
  const { dir, git } = folder();
  writeFileSync(join(dir, 'Panel.tsx'), readFileSync(join(dir, 'Panel.tsx'), 'utf8').replace('const v = { size };', 'const v = { size }; useThing();'));
  git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'ro');
  const ws = await openWorkspace(dir);
  try {
    const r = await run(ws, 'Button', [{ op: 'renameProp', name: 'label', to: 'caption' }]);
    assert.equal(r.ok, false); assert.match(r.error, /Panel/); assert.match(r.error, /read-only|cannot be edited/);
    assert.equal(git('status', '--porcelain', '--', '*.tsx').trim(), '');
  } finally { await ws.close(); }
});

test('a shorter name is a one-line change in the consumer (the attribute is renamed in place)', async () => {
  const { dir, git } = folder();
  const ws = await openWorkspace(dir);
  try {
    const r = await run(ws, 'Button', [{ op: 'renameProp', name: 'count', to: 'num' }]);
    assert.equal(r.ok, true, r.error);
    assert.ok(numstat(git).includes('1 1 Panel.tsx'), numstat(git).join());
    assert.match(readFileSync(join(dir, 'Panel.tsx'), 'utf8'), /size="sm" num=\{5\}/);
  } finally { await ws.close(); }
});

test('moving a node to the place it already has (an only child to index 0, any child to its own index) is a no-op: ok, same revision, same bytes, no history entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-mv-'));
  let only = 0, total = 0;
  for (const file of makeCorpus(dir, 20, 5)) {
    const store = await openStore(file);
    try {
      const { doc } = await store.read();
      if (!doc) continue;
      const { byId, parentOf } = index(doc);
      for (const n of byId.values()) {
        const p = parentOf.get(n.id);
        if (!p) continue;
        for (const idx of [p.children.indexOf(n), undefined].filter((x, k) => k === 0 || p.children.at(-1) === n)) {
          const before = await store.read(), len = store.history(500).length, bytes = readFileSync(file, 'utf8');
          const r = await store.apply({ baseRevision: before.revision, edits: [{ op: 'move', id: n.id, parent: p.id, ...(idx !== undefined && { index: idx }) }], by: 'test' });
          assert.equal(r.ok, true, `${file} ${n.id}: ${r.error}`);
          assert.equal(r.revision, before.revision); assert.equal(readFileSync(file, 'utf8'), bytes); assert.equal(store.history(500).length, len, 'no revision was made');
          total++; if (p.children.length === 1) only++;
        }
      }
    } finally { await store.close(); }
  }
  assert.ok(only > 5 && total > 50, `${only} only-children, ${total} moves checked`);
});
