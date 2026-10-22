// Canvas lane, round 1: the design panel (FEEL-02). Human labels, scrubbable numbers, an alignment matrix, Hug / Fill / Fixed,
// colour swatches and the Advanced escape hatch. Every control still writes through ctx.sendEdits: small diffs, one batch each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readComponent } from '../src/tsx/read.js';
import { getValue } from '../src/model.js';
import { tempRepo, startServer, sleep, waitFor } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';
import { input, centerOf } from './helpers/input.js';

test('the design panel reads like a design tool and every control is one small edit', { timeout: 120000 }, async (t) => {
  const { fileOf, git } = tempRepo(['Button', 'Card']);
  const server = await startServer(join2(fileOf('Button')));
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  const q = (e) => browser.eval(e);
  const doc = () => readComponent(readFileSync(fileOf('Button'), 'utf8')).doc;
  // revisions are content hashes: "one revision" is counted as one more entry in the history
  const hist = async (n) => (await (await fetch(new URL(`api/components/${n}/history?limit=500`, server.url))).json()).history;
  const rev = async (n = 'Button') => (await hist(n)).length;
  const settled = async (n, k) => { const t0 = Date.now(); while ((await hist(n)).length < k && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20)); await browser.waitFor(`napkin.find('${n}').revision === '${(await hist(n))[0].revision}'`); };
  const lines = () => git('diff', '--numstat', '--', 'components/Button.tsx').trim();
  const original = readFileSync(fileOf('Button'), 'utf8');
  // back to the committed file; waits until the server has read it and the canvas has drawn it
  const reset = async () => {
    git('checkout', '--', 'components/Button.tsx');
    await waitFor(async () => (await (await fetch(new URL('api/components/Button', server.url))).json()).source === original, 4000);
    const now = (await (await fetch(new URL('api/components/Button', server.url))).json()).revision; // the page must show exactly the revision the server holds now
    await browser.waitFor(`document.querySelector('section[data-name="Button"]').dataset.revision === '${now}' && napkin.find('Button').revision === '${now}'`);
    await sleep(120);
  };
  const root = `document.querySelector('section[data-name="Button"] .cell').querySelector('[data-n="root"]')`;
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    await browser.eval(`napkin.select({ component: napkin.find('Button').component, node: 'root', variant: { size: 'md', state: 'default' } })`);
    await browser.waitFor(`document.querySelector('#borderRadius')`);
    await sleep(150);

    await t.test('labels are human words, in sections, with units', async () => {
      assert.equal(await q(`document.querySelector('label[for=borderRadius]').textContent`), 'Radius');
      assert.equal(await q(`document.querySelector('label[for=fontSize]').textContent`), 'Size');
      assert.equal(await q(`document.querySelector('label[for=lineHeight]').textContent`), 'Line height');
      assert.deepEqual(JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('details.sec > summary')].map((s) => s.textContent))`)).slice(0, 6), ['Layout', 'Size', 'Appearance', 'Fill', 'Stroke', 'Text']);
      const visible = await q(`[...document.querySelectorAll('#panel .flabel:not(.mono)')].map((l) => l.textContent).filter((x) => /[a-z][A-Z]/.test(x)).length`);
      assert.equal(visible, 0, 'no camelCase property names among the design labels');
      assert.equal(await q(`document.querySelector('#borderRadius').closest('.fbox').querySelector('.unit').textContent`), 'px');
    });

    await t.test('dragging a label scrubs the number: DOM preview while dragging, one edit on release', async () => {
      const r0 = await rev();
      const l = await centerOf(browser, `document.querySelector('label[data-scrub=borderRadius]')`);
      await io.move(l.x, l.y); await io.press(l.x, l.y);
      await io.move(l.x + 10, l.y, { buttons: 1 }); await io.move(l.x + 20, l.y, { buttons: 1 });
      assert.equal(await q(`getComputedStyle(${root}).borderTopLeftRadius`), '16px', 'the cell shows 16 while dragging');
      assert.equal(await q(`document.querySelector('#borderRadius').value`), '16');
      assert.equal(await rev(), r0, 'nothing written yet');
      await io.release(l.x + 20, l.y);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.borderRadius'), 16);
      assert.equal(lines(), '1\t1\tcomponents/Button.tsx');
      await reset();
    });

    await t.test('Escape during a scrub cancels it', async () => {
      const r0 = await rev();
      const l = await centerOf(browser, `document.querySelector('label[data-scrub=borderRadius]')`);
      await io.move(l.x, l.y); await io.press(l.x, l.y); await io.move(l.x + 30, l.y, { buttons: 1 });
      await io.key('Escape');
      await io.release(l.x + 30, l.y);
      await sleep(250);
      assert.equal(await rev(), r0);
      assert.equal(await q(`getComputedStyle(${root}).borderTopLeftRadius`), '6px');
    });

    await t.test('arrow keys nudge a number and a pause commits one edit', async () => {
      const r0 = await rev();
      await q(`document.querySelector('#gap').focus()`);
      for (let i = 0; i < 3; i++) await io.key('ArrowUp');
      await io.key('ArrowUp', { shift: true });
      await settled('Button', r0 + 1);
      await sleep(300);
      assert.equal(await rev(), r0 + 1, 'one revision for the burst');
      assert.equal(getValue(doc(), 'root.gap'), 21);
      assert.equal(lines(), '1\t1\tcomponents/Button.tsx');
      await reset();
    });

    await t.test('segmented controls and the 3x3 alignment matrix', async () => {
      let r0 = await rev();
      await q(`document.querySelector('#seg-flexDirection-column').click()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.flexDirection'), 'column');
      assert.equal(lines(), '1\t0\tcomponents/Button.tsx', 'one added line');
      await browser.waitFor(`document.querySelector('#seg-flexDirection-column').getAttribute('aria-checked') === 'true'`);
      await reset();
      r0 = await rev();
      assert.equal(await q(`document.querySelector('#align-11').getAttribute('aria-pressed')`), 'false');
      await q(`document.querySelector('#align-22').click()`); // bottom right, direction row: justify flex-end, align flex-end
      await settled('Button', r0 + 1);
      await sleep(150);
      assert.equal(await rev(), r0 + 1, 'both properties in one batch');
      assert.equal(getValue(doc(), 'root.justifyContent'), 'flex-end');
      assert.equal(getValue(doc(), 'root.alignItems'), 'flex-end');
      await browser.waitFor(`document.querySelector('#align-22').getAttribute('aria-pressed') === 'true'`);
      await reset();
    });

    await t.test('Hug / Fill / Fixed', async () => {
      let r0 = await rev();
      await q(`document.querySelector('#size-width-fill').click()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.width'), '100%');
      r0 = await rev();
      await q(`document.querySelector('#size-width-fixed').click()`);
      await settled('Button', r0 + 1);
      const w = getValue(doc(), 'root.width');
      assert.equal(typeof w, 'number'); assert.ok(w > 40);
      await browser.waitFor(`document.querySelector('#size-width-fixed').getAttribute('aria-checked') === 'true'`);
      r0 = await rev();
      await q(`document.querySelector('#size-width-hug').click()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.width'), 'auto');
      await browser.waitFor(`document.querySelector('#size-width-hug').getAttribute('aria-checked') === 'true'`);
      await reset();
    });

    await t.test('a colour swatch picks a colour and writes one property', async () => {
      await browser.waitFor(`!!document.querySelector('#pick-background')`); // (the panel redraws a moment after a reset)
      const r0 = await rev();
      await q(`(() => { const p = document.querySelector('#pick-background'); p.value = '#ff3b30'; p.dispatchEvent(new Event('input', { bubbles: true })); p.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.background'), '#ff3b30');
      assert.equal(lines(), '1\t1\tcomponents/Button.tsx');
      await browser.waitFor(`document.querySelector('#background').value === '#ff3b30'`);
      await reset();
    });

    await t.test('Advanced: all CSS lists everything the design controls do not cover, and still edits', async () => {
      assert.equal(await q(`document.querySelector('details.adv').open`), false);
      assert.equal(await q(`!!document.querySelector('details.adv #cursor')`), true, 'cursor is in there');
      await q(`document.querySelector('details.adv > summary').click()`);
      await browser.waitFor(`document.querySelector('details.adv').open`);
      const r0 = await rev();
      await browser.type('#cursor', 'default');
      await settled('Button', r0 + 1); // (the canvas previews while you type, so the pixels can lead the file)
      await browser.waitFor(`getComputedStyle(${root}).cursor === 'default'`);
      assert.equal(getValue(doc(), 'root.cursor'), 'default');
      assert.equal(lines(), '1\t1\tcomponents/Button.tsx');
      await reset();
    });

    await t.test('override dots and Reset work from the design controls', async () => {
      await browser.eval(`napkin.select({ component: napkin.find('Button').component, node: 'root', variant: { size: 'sm', state: 'default' } })`);
      await browser.waitFor(`document.querySelector('#sel-variant')?.textContent === 'size=sm · state=default'`);
      await q(`(() => { const s = document.querySelector('#scope'); s.value = 'variant'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await browser.waitFor(`document.querySelector('#sel-target').textContent === 'override size=sm'`);
      assert.equal(await q(`!!document.querySelector('#dot-padding')`), true);
      assert.equal(await q(`!!document.querySelector('#dot-borderRadius')`), false);
      const r0 = await rev();
      await browser.type('#borderRadius', '20');
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.borderRadius', { size: 'sm' }), 20);
      assert.equal(getValue(doc(), 'root.borderRadius'), 6, 'base untouched');
      await browser.waitFor(`document.querySelector('#dot-borderRadius')`);
      await q(`document.querySelector('#reset-borderRadius').click()`);
      await browser.waitFor(`!document.querySelector('#dot-borderRadius')`);
      assert.equal(getValue(doc(), 'root.borderRadius', { size: 'sm' }), undefined);
      await reset();
    });
    assert.deepEqual(browser.consoleLines.filter((l) => /error/i.test(l)), [], 'no console errors');
  } finally { await browser.close(); await server.stop(); }
});

import { dirname } from 'node:path';
function join2(f) { return dirname(f); }
