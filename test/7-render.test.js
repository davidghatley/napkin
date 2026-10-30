// First build M2 (F04, F07, F22, F23): the canvas draws the real component, for every variant,
// and follows the files on disk. Headless Chromium on CPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBundler } from '../src/bundle.js';
import { newComponentSource } from '../src/tsx/write.js';
import { connectCanvas } from '../src/canvas-client.js';
import { tempRepo, startServer, fixture, sleep } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';
import { session } from './helpers/agents.js';

test('esbuild bundles both fixtures and a fresh component; a rebuild is well under 100 ms', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-bundle-'));
  const bundler = createBundler();
  try {
    writeFileSync(join(dir, 'Badge.tsx'), newComponentSource('Badge'));
    for (const n of ['Card', 'Button']) copyFileSync(fixture(n), join(dir, `${n}.tsx`));
    const times = {};
    for (const n of ['Card', 'Button', 'Badge']) {
      const r = await bundler.build(join(dir, `${n}.tsx`), n);
      assert.equal(r.ok, true, r.error);
      assert.match(r.code, /export \{\s*mount/, `${n} bundle exports mount`);
      assert.match(r.code, /data-n/, `${n} bundle carries the data-n attributes`);
      assert.doesNotMatch(r.code, /from ["']napkin/, 'no runtime dependency on napkin');
      times[n] = [];
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(dir, `${n}.tsx`), readFileSync(join(dir, `${n}.tsx`), 'utf8') + `\n// edit ${i}\n`);
        const again = await bundler.build(join(dir, `${n}.tsx`), n);
        assert.equal(again.ok, true, again.error);
        times[n].push(again.ms);
      }
      const median = [...times[n]].sort((a, b) => a - b)[2];
      t.diagnostic(`${n}: first build ok, rebuild median ${median.toFixed(1)} ms (runs: ${times[n].map((x) => x.toFixed(0)).join(', ')})`);
      assert.ok(median < 100, `${n} rebuild median ${median} ms`);
    }
    writeFileSync(join(dir, 'Broken.tsx'), 'export function Broken( {');
    const bad = await bundler.build(join(dir, 'Broken.tsx'), 'Broken');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Broken\.tsx:1/);
  } finally { await bundler.close(); rmSync(dir, { recursive: true, force: true }); }
});

const COUNTER = `import { useState } from 'react';

export function Counter() {
  const [n] = useState(3);
  return <p data-n="count">count {n}</p>;
}
`;

test('the canvas follows the files: grid, live edits, broken edits, branch switch, add/remove, read-only', { timeout: 60000 }, async (t) => {
  const { compDir, fileOf, git } = tempRepo();
  writeFileSync(join(compDir, 'Counter.tsx'), COUNTER); // outside the dialect: opens read-only
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1400, height: 900 });
  const sec = (name) => `document.querySelector('section[data-name="${name}"]')`;
  const q = (expr) => browser.eval(expr);
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');

    await t.test('every component draws, and Button shows its full 6-variant grid with labels', async () => {
      assert.equal(await q(`document.querySelectorAll('section.cmp').length`), 3);
      assert.equal(await q(`${sec('Button')}.querySelectorAll('.cell').length`), 6);
      const captions = await q(`[...${sec('Button')}.querySelectorAll('figcaption')].map((c) => c.textContent)`);
      assert.deepEqual(captions.sort(), ['size=lg · state=default', 'size=lg · state=hover', 'size=md · state=default', 'size=md · state=hover', 'size=sm · state=default', 'size=sm · state=hover']);
      // each cell really renders that variant (computed styles), and keeps data-n
      const pad = await q(`Object.fromEntries([...${sec('Button')}.querySelectorAll('.cell')].map((c) => [c.dataset.variant, getComputedStyle(c.querySelector('[data-n="root"]')).paddingTop]))`);
      assert.equal(pad['{"size":"sm","state":"hover"}'], '4px');
      assert.equal(pad['{"size":"lg","state":"default"}'], '12px');
      assert.equal(pad['{"size":"md","state":"default"}'], '8px');
      assert.equal(await q(`${sec('Card')}.querySelectorAll('.cell').length`), 1);
      assert.equal(await q(`${sec('Card')}.querySelector('figcaption').textContent`), 'default');
    });

    await t.test('hover outlines, click selects and the panel names component, node and variant', async () => {
      await q(`[...${sec('Button')}.querySelectorAll('.cell')].find((c) => c.dataset.variant === '{"size":"sm","state":"hover"}').querySelector('[data-n="label"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
      assert.equal(await q(`getComputedStyle(document.querySelector('#overlay-hover')).display`), 'block');
      await q(`[...${sec('Button')}.querySelectorAll('.cell')].find((c) => c.dataset.variant === '{"size":"sm","state":"hover"}').querySelector('[data-n="label"]').click()`);
      await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('label')`);
      assert.equal(await q(`document.querySelector('#sel-component').textContent`), 'Button');
      assert.equal(await q(`document.querySelector('#sel-variant').textContent`), 'size=sm · state=hover');
      assert.equal(await q(`document.querySelector('#overlay-select').dataset.label`), 'Button · label');
      assert.equal(await q(`getComputedStyle(document.querySelector('#overlay-select')).display`), 'block');
    });

    await t.test('an external file write shows in the DOM within 1 s and keeps the selection', async () => {
      await q(`${sec('Card')}.querySelector('[data-n="title"]').click()`);
      await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('title')`);
      const file = fileOf('Card');
      const t0 = performance.now();
      writeFileSync(file, readFileSync(file, 'utf8').replace("title = 'From napkin to component'", "title = 'Changed outside'"));
      await browser.waitFor(`${sec('Card')}.querySelector('[data-n="title"]').textContent === 'Changed outside'`, 1000);
      const ms = performance.now() - t0;
      t.diagnostic(`external write -> DOM: ${ms.toFixed(0)} ms`);
      assert.ok(ms < 1000);
      assert.equal(await q(`document.querySelector('#sel-node').textContent.startsWith('title')`), true, 'selection kept');
      assert.equal(await q(`getComputedStyle(document.querySelector('#overlay-select')).display`), 'block');
      // revisions are opaque (content hashes); the page shows the one the server holds
      const served = (await (await fetch(new URL('api/components/Card', server.url))).json()).revision;
      assert.equal(await q(`${sec('Card')}.dataset.revision`), served);
    });

    await t.test('a broken hand edit keeps the last good render and reports the line', async () => {
      const file = fileOf('Card');
      writeFileSync(file, readFileSync(file, 'utf8').replace('return (', 'return (<<'));
      await browser.waitFor(`${sec('Card')}.querySelector('.problem').textContent.includes('line ')`, 2000);
      const msg = await q(`${sec('Card')}.querySelector('.problem').textContent`);
      assert.match(msg, /^Card\.tsx has a syntax error at line \d+\. Showing the last version that worked\./);
      assert.equal(await q(`${sec('Card')}.querySelector('[data-n="title"]').textContent`), 'Changed outside', 'last good render stays');
      git('restore', 'components/Card.tsx');
      await browser.waitFor(`!${sec('Card')}.querySelector('.problem').textContent && ${sec('Card')}.querySelector('[data-n="title"]').textContent === 'From napkin to component'`, 2000);
    });

    await t.test('a branch switch reloads changed components and a stale in-flight edit is rejected', async () => {
      const client = await connectCanvas(server.url);
      try {
        const base = client.state('Card').revision;
        git('checkout', '-q', '-b', 'other');
        writeFileSync(fileOf('Card'), readFileSync(fileOf('Card'), 'utf8').replace("padding: '16px'", "padding: '40px'"));
        git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qam', 'other');
        git('checkout', '-q', '-'); // back on the first branch: padding 16px again
        await browser.waitFor(`getComputedStyle(${sec('Card')}.querySelector('[data-n="card"]')).paddingTop === '16px'`, 1000);
        const t0 = performance.now();
        git('checkout', '-q', 'other');
        await browser.waitFor(`getComputedStyle(${sec('Card')}.querySelector('[data-n="card"]')).paddingTop === '40px'`, 1000);
        t.diagnostic(`branch switch -> DOM: ${(performance.now() - t0).toFixed(0)} ms`);
        const r = await client.sendEdits('Card', base, [{ op: 'set', path: 'card.padding', value: '50px' }]);
        assert.equal(r.ok, false);
        assert.match(r.error, /^stale revision/);
        git('checkout', '-q', '-');
        await browser.waitFor(`getComputedStyle(${sec('Card')}.querySelector('[data-n="card"]')).paddingTop === '16px'`, 1000);
      } finally { client.close(); }
    });

    await t.test('a file added or removed while running appears and disappears', async () => {
      const file = join(compDir, 'Badge.tsx');
      writeFileSync(file, newComponentSource('Badge'));
      const ms = await browser.waitFor(`${sec('Badge')}?.dataset.ready === '1'`, 2000);
      t.diagnostic(`new file -> DOM: ${ms} ms`);
      rmSync(file);
      await browser.waitFor(`!${sec('Badge')}`, 2000);
      assert.equal(await q(`document.querySelectorAll('section.cmp').length`), 3);
    });

    // Rewritten for decision 0013 (lead ruling 2026-10-30): was a read-only dialect cell with a badge and a whole-file refusal, now a /view frame
    // that renders the file and refuses one spot at a time ("line N: reason"); intent unchanged.
    await t.test('a file outside the dialect renders, refuses the spot that is computed in code, and edits the rest', async () => {
      const id = await q(`napkin.find('Counter').component`);
      await browser.waitFor(`!!napkin.stage.sections.get(${JSON.stringify(id)})?.docFrame?.doc()?.querySelector('p')`);
      assert.equal(await q(`napkin.stage.sections.get(${JSON.stringify(id)}).docFrame.doc().querySelector('[data-n="count"]').textContent`), 'count 3', 'it still renders');
      const node = await q(`napkin.stage.sections.get(${JSON.stringify(id)}).docFrame.tree().tree[0].node`);
      const before = readFileSync(join(compDir, 'Counter.tsx'), 'utf8');
      const edit = (edits) => q(`napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: ${JSON.stringify(id)}, baseRevision: napkin.find('Counter').revision, edits: ${JSON.stringify(edits)} }) }).then((r) => r.json()).then(JSON.stringify)`).then(JSON.parse);
      const r = await edit([{ op: 'text', node, run: 1, value: 'z' }]); // the {n} run is computed in code
      assert.equal(r.ok, false);
      assert.match(r.error, /line \d+/); assert.match(r.error, /computed in code/);
      assert.equal(readFileSync(join(compDir, 'Counter.tsx'), 'utf8'), before, 'a refused edit writes nothing');
      // selecting it: the panel shows the computed run disabled, with the reason
      await q(`napkin.select({ component: ${JSON.stringify(id)}, node: ${JSON.stringify(node)}, variant: {} })`);
      await browser.waitFor(`document.querySelector('#panel .doc-run[disabled]')`);
      assert.match(await q(`document.querySelector('#panel .doc-run[disabled]').title`), /Computed in code/);
      assert.equal(await q(`document.querySelectorAll('#panel .doc-run:not([disabled])').length`), 1, 'the editable run stays editable');
      // an editable spot in the same file works, and is a one-line diff
      const ok = await edit([{ op: 'text', node, run: 0, value: 'total' }]);
      assert.ok(ok.ok !== false, JSON.stringify(ok));
      const after = readFileSync(join(compDir, 'Counter.tsx'), 'utf8').split('\n'), was = before.split('\n');
      assert.equal(after.filter((l, i) => l !== was[i]).length, 1, 'one line changed');
      assert.match(after.join('\n'), /total \{n\}/);
    });

    assert.deepEqual(browser.consoleLines.filter((l) => /error/i.test(l)), [], 'no console errors');
  } finally {
    await browser.close(); await server.stop();
  }
});
