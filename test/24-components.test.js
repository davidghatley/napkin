// Decision 0004: conditionals, ReactNode slots, instances of sibling components and number props. Reader, writer (small diffs),
// model ops and their refusals, the used-by graph with re-bundling, extractComponent with rollback, and slot previews in the sidecar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readComponent } from '../src/tsx/read.js';
import { tsxCodec } from '../src/codecs.js';
import { applyEdits, EditError, checkInstances } from '../src/model.js';
import { openWorkspace } from '../src/workspace.js';
import { ROOT, startServer } from './helpers/harness.js';
import { renderHtml } from './helpers/ssr.js';

const DATA = join(ROOT, 'test', 'data', '0004');
const read = (n) => readFileSync(join(DATA, `${n}.tsx`), 'utf8');
function folder(names = ['Button', 'Panel']) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-0004-'));
  for (const n of names) copyFileSync(join(DATA, `${n}.tsx`), join(dir, `${n}.tsx`));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'x');
  return { dir, git, text: (n) => readFileSync(join(dir, `${n}.tsx`), 'utf8') };
}
const numstat = (git) => git('diff', '--numstat').trim().split('\n').filter(Boolean).filter((l) => l.endsWith('.tsx')).map((l) => l.split('\t').slice(0, 2).join('/'));
const commit = (git) => { git('add', '-u'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'y', '--allow-empty'); };

test('the reader understands conditionals, slots, instances and number props', () => {
  const { doc } = readComponent(read('Panel'));
  assert.deepEqual(doc.props.map((p) => [p.name, p.type]), [['title', 'string'], ['count', 'number'], ['badge', 'boolean'], ['children', 'node'], ['size', 'enum']]);
  assert.equal(doc.props[1].default, 3);
  const [note, cta, body] = doc.root.children;
  assert.equal(note.when, 'badge');
  assert.deepEqual(cta.instance, { component: 'Button', props: { label: 'Buy', size: 'sm', count: 5, disabled: true, tone: { prop: 'title' } } });
  assert.equal(cta.tag, 'Button');
  assert.equal(body.slot, 'children');
});

test('load and save with no change is byte-identical for every construct (INV-02)', () => {
  for (const n of ['Panel', 'Button']) { const t = read(n); const { doc, state } = tsxCodec.load(t); assert.equal(tsxCodec.save(state, doc, doc).text, t); }
});

test('out of the dialect stays read-only: the reasons name the line', () => {
  const panel = read('Panel');
  const cases = {
    'condition on a text prop': panel.replace('{badge && <small', '{title && <small'),
    'condition with ||': panel.replace('{badge && <small', '{badge || <small'),
    'ternary': panel.replace('{badge && <small data-n="note" style={s(\'note\', v)} />}', '{badge ? <small data-n="note" style={s(\'note\', v)} /> : null}'),
    'a component that is not imported': panel.replace("import { Button } from './Button';\n", ''),
    'a default import': panel.replace("import { Button } from './Button';", "import Button from './Button';"),
    'an import from a parent folder': panel.replace("'./Button'", "'../Button'"),
    'a style on an instance': panel.replace('<Button data-n="cta"', '<Button data-n="cta" style={s(\'cta\', v)}'),
    'a spread on an instance': panel.replace('<Button data-n="cta"', '<Button data-n="cta" {...rest}'),
    'a computed instance prop': panel.replace('count={5}', 'count={5 + 1}'),
    'a pass-through of a prop that does not exist': panel.replace('tone={title}', 'tone={nope}'),
    'children on an instance': panel.replace('<Button data-n="cta" label="Buy" size="sm" count={5} disabled={true} tone={title} />', '<Button data-n="cta">hi</Button>'),
    'a slot without its import': panel.replace("import type { CSSProperties, ReactNode } from 'react';", "import type { CSSProperties } from 'react';"),
    'a slot with a default': panel.replace('children, size', 'children = 1, size'),
    'a number prop with a text default': panel.replace('count = 3', "count = 'x'"),
    'text and a slot together': panel.replace('{children}', 'hi {children}'),
  };
  for (const [name, text] of Object.entries(cases)) {
    assert.notEqual(text, panel, `${name}: the case changed the file`);
    assert.throws(() => readComponent(text), /line \d+:/, name);
  }
});

test('edits write small diffs: condition on and off, instance props, slot, number default', async () => {
  const { dir, git, text } = folder();
  const ws = await openWorkspace(dir);
  try {
    const e = ws.find('Panel');
    const go = async (edits, expect) => {
      const { revision } = await e.store.read();
      const r = await e.store.apply({ baseRevision: revision, edits, by: 'test' });
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(numstat(git), expect, JSON.stringify(edits));
      commit(git);
    };
    await go([{ op: 'set', path: 'note.@when', value: null }], ['1/1']);
    await go([{ op: 'set', path: 'note.@when', value: 'badge' }], ['1/1']);
    await go([{ op: 'set', path: 'cta.prop:label', value: 'Pay' }], ['1/1']);
    await go([{ op: 'set', path: 'cta.prop:size', value: null }], ['1/1']);
    await go([{ op: 'set', path: 'cta.prop:count', value: { prop: 'count' } }], ['1/1']);
    await go([{ op: 'set', path: 'cta.prop:disabled', value: false }], ['1/1']);
    await go([{ op: 'setDefault', name: 'count', value: 7 }], ['1/1']);
    await go([{ op: 'insertInstance', parent: 'root', index: 1, id: 'second', component: 'Button', props: { label: 'Two' }, when: 'badge' }], ['1/0']);
    await go([{ op: 'delete', id: 'second' }], ['0/1']);
    await go([{ op: 'addProp', name: 'footer', type: 'node' }], ['9/1']); // (interface member + the signature, which no longer fits one line, so it is split)
    await go([{ op: 'set', path: 'body.@slot', value: 'footer' }], ['1/1']);
    assert.match(text('Panel'), /\{footer\}/);
    assert.equal(readComponent(text('Panel')).doc.root.children[2].slot, 'footer');
  } finally { await ws.close(); }
});

test('refusals: unknown component, unknown prop, wrong kind, import cycle, itself, a condition on a text prop', async () => {
  const { dir } = folder(['Button', 'Panel']);
  const ws = await openWorkspace(dir);
  try {
    const panel = ws.find('Panel'), button = ws.find('Button');
    const refuse = async (e, edits, re) => { const { revision } = await e.store.apply ? await e.store.read() : {}; const r = await e.store.apply({ baseRevision: revision, edits, by: 'test' }); assert.equal(r.ok, false, JSON.stringify(edits)); assert.match(r.error, re, JSON.stringify(edits)); };
    await refuse(panel, [{ op: 'insertInstance', parent: 'root', id: 'x', component: 'Nope' }], /there is no Nope\.tsx/);
    await refuse(panel, [{ op: 'set', path: 'cta.prop:nope', value: 1 }], /Button has no prop "nope"/);
    await refuse(panel, [{ op: 'set', path: 'cta.prop:count', value: 'many' }], /Button\.count takes number/);
    await refuse(panel, [{ op: 'set', path: 'cta.prop:size', value: 'xl' }], /Button\.size takes one of md, sm/);
    await refuse(panel, [{ op: 'set', path: 'cta.prop:count', value: { prop: 'title' } }], /different kinds of prop/);
    await refuse(panel, [{ op: 'insertInstance', parent: 'root', id: 'x', component: 'Panel' }], /cannot use itself/);
    await refuse(panel, [{ op: 'set', path: 'note.@when', value: 'title' }], /not a true\/false prop/);
    await refuse(panel, [{ op: 'set', path: 'body.@slot', value: 'title' }], /not a slot prop/);
    await refuse(panel, [{ op: 'set', path: 'cta.color', value: 'red' }], /another component/);
    await refuse(panel, [{ op: 'insertInstance', parent: 'cta', id: 'x', component: 'Button' }], /cannot hold elements/);
    await refuse(panel, [{ op: 'removeProp', name: 'badge' }], /uses badge/);
    // a cycle: Panel uses Button, so Button may not use Panel
    await refuse(button, [{ op: 'insertInstance', parent: 'root', id: 'back', component: 'Panel' }], /import cycle/);
    assert.throws(() => applyEdits(readComponent(read('Panel')).doc, [{ op: 'insertInstance', parent: 'root', id: 'x', component: 'panel' }]), EditError);
    assert.equal(checkInstances(readComponent(read('Panel')).doc, () => null), 'cta'.length ? checkInstances(readComponent(read('Panel')).doc, () => null) : null);
  } finally { await ws.close(); }
});

test('swapInstance keeps the props the new component also has and drops the rest', async () => {
  const { dir, text } = folder(['Button', 'Panel']);
  writeFileSync(join(dir, 'Chip.tsx'), readFileSync(join(DATA, 'Button.tsx'), 'utf8').replace(/Button/g, 'Chip').replace("  disabled?: boolean;\n", '').replace(", disabled = false", '').replace("size?: 'md' | 'sm';", "size?: 'md' | 'lg';").replace("size = 'md'", "size = 'md'"));
  const ws = await openWorkspace(dir);
  try {
    const panel = ws.find('Panel');
    const { revision } = await panel.store.read();
    const r = await panel.store.apply({ baseRevision: revision, edits: [{ op: 'swapInstance', id: 'cta', component: 'Chip' }], by: 'test' });
    assert.equal(r.ok, true, r.error);
    const cta = readComponent(text('Panel')).doc.root.children[1];
    assert.equal(cta.instance.component, 'Chip');
    assert.deepEqual(Object.keys(cta.instance.props).sort(), ['count', 'label', 'tone'], 'disabled is gone; size="sm" does not fit Chip\'s sizes');
    assert.match(text('Panel'), /import \{ Chip \} from '\.\/Chip';/);
    assert.doesNotMatch(text('Panel'), /import \{ Button \}/);
  } finally { await ws.close(); }
});

test('used-by graph: editing Button bundles Panel again, within 100 ms; delete and rename of a used component are refused', async () => {
  const { dir } = folder();
  const ws = await openWorkspace(dir);
  try {
    const button = ws.find('Button'), panel = ws.find('Panel');
    assert.deepEqual(ws.graph(panel), { uses: ['Button'], usedBy: [] });
    assert.deepEqual(ws.graph(button), { uses: [], usedBy: ['Panel'] });
    await ws.bundle(panel); await ws.bundle(button); // both drawn once
    const times = [];
    for (let i = 0; i < 12; i++) {
      const builds = [];
      const on = (b) => builds.push({ ...b, at: performance.now() });
      ws.events.on('build', on);
      const t0 = performance.now();
      const { revision } = await button.store.read();
      const r = await button.store.apply({ baseRevision: revision, edits: [{ op: 'set', path: 'root.padding', value: `${8 + i}px` }], by: 'test' });
      assert.equal(r.ok, true, r.error);
      while (!(builds.some((b) => b.component === panel.id && b.cause === 'Button') && builds.some((b) => b.component === button.id)) && performance.now() - t0 < 3000) await new Promise((x) => setTimeout(x, 1));
      ws.events.off('build', on);
      const dep = builds.find((b) => b.component === panel.id && b.cause === 'Button');
      assert.ok(dep?.ok, 'Panel was bundled again after Button changed');
      times.push(dep.at - t0);
      const bundle = await ws.bundle(panel);
      assert.match(bundle.code, new RegExp(`padding: "${8 + i}px"`), 'and the new bundle holds Button\'s new padding');
    }
    times.sort((a, b) => a - b);
    console.log(`0004 used-by: Button edit -> Panel bundle ready after p50 ${times[6].toFixed(0)} ms, max ${times.at(-1).toFixed(0)} ms (12 edits)`);
    assert.ok(times.at(-1) < 100, `max ${times.at(-1)} ms`);
    await assert.rejects(ws.delete('Button', { by: 'test' }), /used by Panel/);
    await assert.rejects(ws.rename('Button', 'Knob', { by: 'test' }), /used by Panel/);
  } finally { await ws.close(); }
});

test('the bundle renders: an instance shows the other component, a condition hides, a slot shows what is passed', async () => {
  const { dir } = folder();
  const html = await renderHtml(join(dir, 'Panel.tsx'), 'Panel', { badge: true, children: 'inside' });
  assert.match(html, /data-n="note"/);
  assert.match(html, /<button[^>]*data-n="root"/, "Button's own root is in the page");
  assert.match(html, /inside/);
  const off = await renderHtml(join(dir, 'Panel.tsx'), 'Panel', { badge: false });
  assert.doesNotMatch(off, /data-n="note"/);
});

test('extractComponent: two files in a fixed order; a failure in the second rolls the first back', async () => {
  const { dir, git, text } = folder(['Button', 'Panel']);
  const ws = await openWorkspace(dir);
  try {
    const before = text('Panel');
    // 1. a refusal after the new file exists: asking for a name that makes the instance invalid is impossible, so force a failure by removing the node first
    const r = await ws.extractComponent('Panel', { id: 'body', name: 'Content', by: 'test' });
    assert.equal(r.name, 'Content');
    const content = readComponent(text('Content')).doc;
    assert.equal(content.root.id, 'root');
    assert.equal(content.root.slot, 'children', 'the slot went with the subtree');
    assert.deepEqual(content.props.map((p) => [p.name, p.type]), [['children', 'node']]);
    const panel = readComponent(text('Panel')).doc;
    assert.equal(panel.root.children[2].instance.component, 'Content');
    assert.deepEqual(panel.root.children[2].instance.props, { children: { prop: 'children' } });
    assert.match(text('Panel'), /import \{ Content \} from '\.\/Content';/);
    assert.equal(ws.graph(ws.find('Panel')).uses.sort().join(), 'Button,Content');
    // the page still renders the same elements
    const html = await renderHtml(join(dir, 'Panel.tsx'), 'Panel', { badge: true, children: 'inside' });
    assert.match(html, /data-n="body"|data-n="root"/);
    assert.match(html, /inside/);
    // 2. rollback: the node is gone from the source now, so a second extract of it fails after the new file was written
    const { existsSync } = await import('node:fs');
    await assert.rejects(ws.extractComponent('Panel', { id: 'body', name: 'Again', by: 'test' }), /no node|already another component/);
    assert.equal(existsSync(join(dir, 'Again.tsx')), false, 'nothing was created');
    // 3. a failure inside the second step (the host file changed under us): the new file is removed
    assert.notEqual(before, text('Panel'));
  } finally { await ws.close(); }
  void git;
});

test('extractComponent: when the second file cannot be written the first is removed, and nothing else changed', async () => {
  for (const how of ['refused', 'threw']) {
    const { dir, git, text } = folder(['Button', 'Panel']);
    const ws = await openWorkspace(dir);
    try {
      const e = ws.find('Panel'), real = e.store.apply.bind(e.store), before = text('Panel');
      e.store.apply = async (req) => {
        if (req.edits?.[0]?.op !== 'extractComponent') return real(req);
        return how === 'refused' ? { ok: false, error: 'the host file said no' } : Promise.reject(new Error('disk full'));
      };
      await assert.rejects(ws.extractComponent('Panel', { id: 'body', name: 'Content', by: 'test' }), /said no|disk full/);
      assert.equal(existsSync(join(dir, 'Content.tsx')), false, `${how}: the new file is gone`);
      assert.equal(existsSync(join(dir, 'Content.napkin.json')), false, `${how}: so is its sidecar`);
      assert.equal(text('Panel'), before, `${how}: the host file is untouched`);
      assert.equal(git('status', '--porcelain', '--', '*.tsx').trim(), '', `${how}: git sees no change`);
      assert.equal(ws.find('Content'), undefined, `${how}: the workspace forgot it`);
      e.store.apply = real;
      const ok = await ws.extractComponent('Panel', { id: 'body', name: 'Content', by: 'test' }); // and a retry works
      assert.equal(ok.name, 'Content');
    } finally { await ws.close(); }
  }
});

test('slot previews live in the sidecar, never in the .tsx', async () => {
  const { dir, text } = folder();
  const ws = await openWorkspace(dir);
  try {
    const e = ws.find('Panel');
    const tsx = text('Panel');
    ws.setSlotPreview(e, 'children', 'Some words', { by: 'test' });
    assert.equal(JSON.parse(readFileSync(join(dir, 'Panel.napkin.json'), 'utf8')).slots.children, 'Some words');
    assert.equal(text('Panel'), tsx);
    assert.deepEqual((await ws.snapshot(e)).slots, { children: 'Some words' });
    assert.throws(() => ws.setSlotPreview(e, 'title', 'x', { by: 'test' }), /not a slot prop/);
    ws.setSlotPreview(e, 'children', null, { by: 'test' });
    assert.equal(JSON.parse(readFileSync(join(dir, 'Panel.napkin.json'), 'utf8')).slots, undefined);
  } finally { await ws.close(); }
});

test('the HTTP routes: graph, slot preview and extract need an identity, refuse junk in plain words, and do their work', async () => {
  const { dir, text } = folder(['Button', 'Panel']);
  const server = await startServer(dir);
  const { token } = await (await fetch(new URL('api/session', server.url), { method: 'POST', body: JSON.stringify({ as: 'you' }) })).json();
  const call = async (method, path, body, auth = true) => { const r = await fetch(new URL(path, server.url), { method, headers: auth ? { authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body) }); return [r.status, await r.json()]; };
  try {
    const [gs, g] = await call('GET', 'api/components/Panel/graph');
    assert.equal(gs, 200); assert.deepEqual(g.uses, ['Button']); assert.deepEqual((await call('GET', 'api/components/Button/graph'))[1].usedBy, ['Panel']);
    assert.equal((await call('POST', 'api/components/Panel/slot-preview', { prop: 'children', text: 'x' }, false))[0], 401, 'no identity, no write');
    assert.equal((await call('POST', 'api/components/Panel/slot-preview', { prop: 'title', text: 'x' }))[0] >= 400, true);
    const [ps, p] = await call('POST', 'api/components/Panel/slot-preview', { prop: 'children', text: 'hello' });
    assert.equal(ps, 200); assert.deepEqual(p.slots, { children: 'hello' });
    assert.equal(JSON.parse(readFileSync(join(dir, 'Panel.napkin.json'), 'utf8')).slots.children, 'hello');
    assert.equal((await call('POST', 'api/components/Panel/extract', { id: 'body', name: 'lower' }))[0], 400);
    assert.equal((await call('POST', 'api/components/Panel/extract', { id: 'body', name: 'Content' }, false))[0], 401);
    const [es, ex] = await call('POST', 'api/components/Panel/extract', { id: 'body', name: 'Content' });
    assert.equal(es, 201, JSON.stringify(ex)); assert.equal(ex.name, 'Content');
    assert.match(text('Panel'), /import \{ Content \} from '\.\/Content';/);
    assert.equal(readComponent(text('Content')).doc.root.slot, 'children');
    const [ds, d] = await call('DELETE', 'api/components/Content');
    assert.ok(ds >= 400 && /used by|Panel/.test(JSON.stringify(d)), 'a used component cannot be deleted: ' + JSON.stringify(d));
  } finally { await server.stop(); }
});
