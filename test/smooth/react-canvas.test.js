// History (moment 9) and copy (moment 10) on a React file, from the canvas: the same walk as HTML, with a file shaped like a
// shadcn component (cn() with a plain string, a computed spread). The diff is checked on the bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from '../helpers/open.js';
import { launchChromium } from '../helpers/cdp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = `import * as React from "react"

function cn(...a: string[]) { return a.filter(Boolean).join(" ") }

export function Card({ className = "", ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="card"
      className={cn("rounded-lg border p-4", className)}
      {...props}
    >
      <h2 className="title">Fresh bread</h2>
      <p className="note">Every morning.</p>
    </section>
  )
}
`;
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-react-')), state = mkdtempSync(join(tmpdir(), 'napkin-react-state-'));
  mkdirSync(join(dir, 'ui'));
  writeFileSync(join(dir, 'ui/card.tsx'), FILE);
  const sh = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', ...a], { stdio: 'ignore' });
  sh('init', '-q'); sh('add', '.'); sh('commit', '-qm', 'first card');
  const server = await cli(dir, [], { NAPKIN_STATE_DIR: state });
  const b = await launchChromium({ width: 1440, height: 900 });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`[...napkin.stage.sections.values()].some((s) => s.docFrame?.doc()?.querySelector('h2'))`, 30000);
  const id = 'ui/card.tsx#Card', q = JSON.stringify(id);
  const nodeOf = (sel) => b.eval(`(() => { const f = napkin.stage.sections.get(${q}).docFrame; return f.nodeOf(f.doc().querySelector(${JSON.stringify(sel)})); })()`);
  const select = async (sel) => { const node = await nodeOf(sel); await b.eval(`napkin.select({ component: ${q}, node: ${JSON.stringify(node)}, variant: {} })`); await sleep(250); return node; };
  const edit = async (e) => { const r = JSON.parse(await b.eval(`napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: ${q}, baseRevision: napkin.state.components.get(${q}).revision, edits: [${JSON.stringify(e)}] }) }).then((r) => r.text())`)); await sleep(700); return r; };
  const read = () => readFileSync(join(dir, 'ui/card.tsx'), 'utf8');
  return { b, dir, id, q, select, edit, read, nodeOf, stop: async () => { await b.close(); await server.stop(); } };
}

test('a React file: versions from the canvas preview the old bytes, restore is one undo step and byte exact', { timeout: 90000 }, async () => {
  const t = await boot();
  try {
    assert.equal(await t.b.eval(`napkin.state.components.get(${t.q}).fileKind`), 'tsx');
    let node = await t.select('h2');
    assert.equal((await t.edit({ op: 'text', node, value: 'Warm bread' })).ok, true);
    const first = t.read();
    assert.deepEqual(first.split('\n').filter((l, i) => l !== FILE.split('\n')[i]), ['      <h2 className="title">Warm bread</h2>']);
    node = await t.select('h2');
    assert.equal((await t.edit({ op: 'attr', node, name: 'id', value: 'head' })).ok, true);
    const last = t.read();
    node = await t.select('h2');
    await t.b.eval(`napkin.time.open()`);
    await t.b.waitFor(`napkin.time.state().tiles.length >= 3`, 15000);
    const tiles = JSON.parse(await t.b.eval(`JSON.stringify(napkin.time.state().tiles)`));
    assert.equal(tiles[0].source, 'git', 'the commit is the oldest version');
    assert.match(tiles.at(-1).what, /^Added id head/, 'the newest change is said from the diff');
    assert.ok(tiles.every((x) => !/\(empty\)/.test(x.what)), `no "(empty)" in the words: ${tiles.map((x) => x.what)}`);
    // the first version on the canvas is drawn from its own bytes
    await t.b.eval(`napkin.time.pick(0)`);
    await t.b.waitFor(`document.querySelector('iframe.time-preview')?.dataset.ready === '1'`, 15000);
    await t.b.waitFor(`document.querySelector('iframe.time-preview').contentDocument.querySelector('h2')?.textContent === 'Fresh bread'`, 15000);
    assert.equal(t.read(), last, 'scrubbing writes nothing');
    // restore: the file is the commit again, byte for byte; one undo gives the newest text back
    const r = JSON.parse(await t.b.eval(`napkin.time.restore().then((j) => JSON.stringify(j))`));
    assert.equal(r.ok, true);
    assert.equal(t.read(), FILE);
    await t.b.waitFor(`napkin.stage.sections.get(${t.q}).docFrame.doc()?.querySelector('h2')?.textContent === 'Fresh bread'`, 15000);
    await t.b.eval(`napkin.undo()`);
    await t.b.waitFor(`napkin.stage.sections.get(${t.q}).docFrame.doc()?.querySelector('h2')?.textContent === 'Warm bread'`, 15000);
    assert.equal(t.read(), last);
  } finally { await t.stop(); }
});

test('a React file: copy gives the source lines, the browser-drawn markup as HTML, and paste is one edit with one undo', { timeout: 90000 }, async () => {
  const t = await boot();
  try {
    const parent = await t.select('section');
    const p = JSON.parse(await t.b.eval(`napkin.copyCode.payload().then((x) => JSON.stringify(x))`));
    assert.match(p.source, /^<section\n\s+data-slot="card"\n\s+className=\{cn\("rounded-lg border p-4", className\)\}/, 'the file\'s own bytes');
    assert.equal(p.line, 7);
    assert.match(p.html, /^<section data-slot="card" class="rounded-lg border p-4">/, 'as HTML: what the browser drew');
    await t.select('p');
    const leaf = JSON.parse(await t.b.eval(`napkin.copyCode.payload().then((x) => JSON.stringify(x))`));
    assert.equal(leaf.source, '<p className="note">Every morning.</p>');
    await t.select('section');
    const j = JSON.parse(await t.b.eval(`napkin.copyCode.paste(${JSON.stringify(leaf.text)}, '').then((x) => JSON.stringify(x))`));
    assert.equal(j.ok, true, JSON.stringify(j));
    await sleep(600);
    const pasted = t.read();
    assert.equal(pasted.match(/<p className="note">Every morning\.<\/p>/g).length, 2, 'the JSX went into the file as JSX');
    await t.b.waitFor(`napkin.stage.sections.get(${t.q}).docFrame.doc()?.querySelectorAll('p').length === 2`, 15000);
    await t.b.eval(`napkin.undo()`);
    await t.b.waitFor(`napkin.stage.sections.get(${t.q}).docFrame.doc()?.querySelectorAll('p').length === 1`, 15000);
    assert.equal(t.read(), FILE, 'undo is byte exact');
    void parent;
  } finally { await t.stop(); }
});
