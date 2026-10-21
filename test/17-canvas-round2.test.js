// Canvas lane, round 2: compound panel controls (stroke, shadow, fill alpha, per-side padding and per-corner radius, font names),
// the layers row menu and focus, plain-language errors, deep links to missing nodes, the selection hint, and the far-zoom axis strip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readComponent } from '../src/tsx/read.js';
import { getValue } from '../src/model.js';
import { tempRepo, startServer, sleep, waitFor } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';
import { input, centerOf } from './helpers/input.js';

test('round 2: compound controls, layer menu, hints', { timeout: 150000 }, async (t) => {
  const { fileOf, git } = tempRepo(['Button', 'Card', 'Chip']);
  const server = await startServer(dirname(fileOf('Button')));
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  const q = (e) => browser.eval(e);
  const doc = (n = 'Button') => readComponent(readFileSync(fileOf(n), 'utf8')).doc;
  // revisions are content hashes: "one revision" is counted as one more entry in the history
  const hist = async (n) => (await (await fetch(new URL(`api/components/${n}/history?limit=500`, server.url))).json()).history;
  const rev = async (n = 'Button') => (await hist(n)).length;
  const settled = async (n, k) => { const t0 = Date.now(); while ((await hist(n)).length < k && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20)); await browser.waitFor(`napkin.find('${n}').revision === '${(await hist(n))[0].revision}'`); };
  const original = Object.fromEntries(['Button', 'Card'].map((n) => [n, readFileSync(fileOf(n), 'utf8')]));
  const reset = async (n = 'Button') => {
    git('checkout', '--', `components/${n}.tsx`);
    await waitFor(async () => (await (await fetch(new URL(`api/components/${n}`, server.url))).json()).source === original[n], 4000);
    await browser.waitFor(`document.querySelector('section[data-name="${n}"]').dataset.revision === String(napkin.find('${n}').revision)`);
    await sleep(150);
  };
  const select = async (n, node, variant = {}) => { await q(`napkin.select({ component: napkin.find('${n}').component, node: '${node}', variant: ${JSON.stringify(variant)} })`); await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('${node}')`); await sleep(100); };
  const numstat = (n = 'Button') => git('diff', '--numstat', '--', `components/${n}.tsx`).trim();
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    await select('Button', 'root', { size: 'md', state: 'default' });

    await t.test('Stroke: width, style and colour are one border line; opacity goes into the hex', async () => {
      let r0 = await rev();
      await browser.type('#stroke-w', '4');
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.border'), '4px solid #16181d');
      assert.equal(numstat(), '1\t1\tcomponents/Button.tsx');
      r0 = await rev();
      await q(`(() => { const s = document.querySelector('#stroke-s'); s.value = 'dashed'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.border'), '4px dashed #16181d');
      r0 = await rev();
      await browser.type('#stroke-a', '50');
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.border'), '4px dashed #16181d80');
      await reset();
    });

    await t.test('Stroke sides write one side property', async () => {
      await q(`document.querySelector('#side-Top').click()`);
      await browser.waitFor(`document.querySelector('#add-stroke')`);
      const r0 = await rev();
      await q(`document.querySelector('#add-stroke').click()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.borderTop'), '1px solid #1f2937');
      await reset();
      await q(`document.querySelector('#side-all').click()`);
    });

    await t.test('Fill: alpha is part of the hex, the eye hides it, minus removes it, plus brings it back', async () => {
      let r0 = await rev();
      await browser.type('#fill-a', '50');
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.background'), '#2236b080');
      r0 = await rev();
      await q(`document.querySelector('#eye-fill').click()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.background'), 'transparent');
      await q(`document.querySelector('#eye-fill').click()`);
      await settled('Button', r0 + 2);
      assert.equal(getValue(doc(), 'root.background'), '#2236b080');
      r0 = await rev();
      await browser.waitFor(`document.querySelector('#remove-fill')`);
      await q(`document.querySelector('#remove-fill').click()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.background'), undefined);
      await browser.waitFor(`document.querySelector('#add-fill')`);
      await q(`document.querySelector('#add-fill').click()`);
      await settled('Button', r0 + 2);
      assert.equal(getValue(doc(), 'root.background'), '#d9d9d9');
      await reset();
    });

    await t.test('Shadow: x, y, blur, spread and colour are one boxShadow line', async () => {
      let r0 = await rev();
      await q(`document.querySelector('#add-effects').click()`);
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.boxShadow'), '0px 2px 6px 0px #00000040');
      r0 = await rev();
      await browser.type('#shadow-blur', '14');
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.boxShadow'), '0px 2px 14px 0px #00000040');
      assert.equal(numstat(), '1\t0\tcomponents/Button.tsx', 'one added line');
      await reset();
    });

    await t.test('Padding per side and radius per corner write the shorthand', async () => {
      await q(`document.querySelector('#pad-sides').click()`);
      await browser.waitFor(`document.querySelector('#pad-t')`);
      assert.equal(await q(`document.querySelector('#pad-r').value`), '16');
      let r0 = await rev();
      await browser.type('#pad-t', '20');
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.padding'), '20px 16px 8px 16px');
      await reset();
      await q(`document.querySelector('#rad-sides').click()`);
      await browser.waitFor(`document.querySelector('#rad-tl')`);
      r0 = await rev();
      await browser.type('#rad-tl', '0');
      await settled('Button', r0 + 1);
      assert.equal(getValue(doc(), 'root.borderRadius'), '0px 6px 6px 6px');
      await reset();
    });

    await t.test('one colour field (swatch | hex | %) with the eye and minus after it; swatches have an outline', async () => {
      assert.equal(await q(`document.querySelector('#background').closest('.colorbox').contains(document.querySelector('#fill-a'))`), true);
      assert.equal(await q(`!!document.querySelector('#background').closest('.crow').querySelector('#eye-fill') && !!document.querySelector('#remove-fill')`), true);
      assert.notEqual(await q(`getComputedStyle(document.querySelector('.swatch')).boxShadow`), 'none');
      assert.equal(await q(`document.querySelector('#side-Top').title`), 'Top');
      assert.equal(await q(`document.querySelector('#side-all').title`), 'All sides');
    });

    await t.test('absent fill, stroke and shadow are chips in one Add row, not empty sections', async () => {
      await select('Card', 'title');
      assert.equal(await q(`document.querySelectorAll('.addrow .addchip').length`), 3);
      assert.equal(await q(`!!document.querySelector('[data-sec=fill]')`), false);
      assert.equal(await q(`[...document.querySelectorAll('details.sec')].slice(0, 1).map((d) => d.dataset.sec)[0]`), 'type', 'a text node starts with Text');
      assert.equal(await q(`document.querySelector('[data-sec=layout]').open`), false, 'Layout starts collapsed on a text node');
      await select('Button', 'root', { size: 'md', state: 'default' });
    });

    await t.test('one unit convention: a px string shows as a number plus px, and keeps its spelling', async () => {
      await select('Card', 'card');
      assert.equal(await q(`document.querySelector('#borderRadius').value`), '12');
      assert.equal(await q(`document.querySelector('#borderRadius').closest('.fbox').querySelector('.unit').textContent`), 'px');
      const r0 = await rev('Card');
      await browser.type('#borderRadius', '20');
      await settled('Card', r0 + 1);
      assert.equal(getValue(doc('Card'), 'card.borderRadius'), '20px');
      await reset('Card');
      await select('Button', 'root', { size: 'md', state: 'default' });
    });

    await t.test('equal field heights and scrub labels advertise themselves', async () => {
      const hs = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#panel .fbox')].map((e) => Math.round(e.getBoundingClientRect().height)))`));
      assert.ok(hs.length > 8 && new Set(hs).size === 1, `fbox heights ${[...new Set(hs)]}`);
      assert.equal(await q(`getComputedStyle(document.querySelector('label[data-scrub=borderRadius]')).cursor`), 'ew-resize');
    });

    await t.test('width and height are one row each, and "Auto" has no unit', async () => {
      assert.equal(await q(`document.querySelector('#width').closest('.sizerow').contains(document.querySelector('#size-width-fixed'))`), true);
      assert.equal(await q(`!!document.querySelector('#width').closest('.fbox').querySelector('.unit')`), false);
      assert.equal(await q(`document.querySelector('#width').placeholder`), 'Auto');
    });

    await t.test('the scope is one compact row; the explanation hides behind an info button', async () => {
      assert.equal(await q(`document.querySelector('#target-note').hidden`), true);
      await q(`document.querySelector('#scope-info').click()`);
      await browser.waitFor(`document.querySelector('#target-note').hidden === false`);
      await q(`document.querySelector('#scope-info').click()`);
    });

    await t.test('fonts read as a name, and a picked family keeps the fallback stack', async () => {
      await select('Card', 'card');
      assert.equal(await q(`document.querySelector('#fontFamily').value`), 'Georgia');
      await q(`document.querySelector('#fontFamily').focus()`);
      await browser.waitFor(`!document.querySelector('#fontpop').hidden`);
      assert.ok(await q(`document.querySelectorAll('#fontpop button').length > 5`), 'a list of faces to pick from');
      assert.match(await q(`document.querySelector('#fontpop button[data-font="Georgia"]').style.fontFamily`), /Georgia/, 'each name is drawn in its own face');
      await q(`document.querySelector('#fontFamily').blur()`);
      const r0 = await rev('Card');
      await browser.type('#fontFamily', 'Inter Var');
      await settled('Card', r0 + 1);
      assert.equal(getValue(doc('Card'), 'card.fontFamily'), '"Inter Var", serif');
      await reset('Card');
    });

    await t.test('layers: a click keeps keyboard focus, so F2 renames at once; a taken id says so plainly', async () => {
      await reset('Card').catch(() => {});
      await browser.goto(server.url); await browser.waitFor('document.body.dataset.ready === "1"'); await sleep(200);
      const row = (n, node) => `document.querySelector('#layers [data-component="' + napkin.find('${n}').component + '"][data-node="${node}"]')`;
      const r = await centerOf(browser, row('Card', 'body'));
      await io.click(r.x, r.y);
      await browser.waitFor(`napkin.state.selection?.node === 'body'`);
      await sleep(150);
      assert.equal(await q(`document.activeElement?.dataset.node`), 'body', 'the clicked row still has focus after the tree redraws');
      await io.key('F2');
      await browser.waitFor(`document.activeElement?.className === 'lrename'`);
      await q(`document.activeElement.select()`);
      await browser.send('Input.insertText', { text: 'title' });
      await io.key('Enter');
      await browser.waitFor(`document.querySelector('#error').textContent !== ''`);
      assert.equal(await q(`document.querySelector('#error').textContent`), 'That id is already used');
      assert.equal(await q(`document.activeElement?.dataset.node`), 'body', 'focus is back on the row');
    });

    await t.test('layers: the eye hides a node with one visibility line and a hidden node stays marked', async () => {
      const row = (node) => `document.querySelector('#layers [data-component="' + napkin.find('Card').component + '"][data-node="${node}"]')`;
      const r0 = await rev('Card');
      await q(`${row('image')}.querySelector('.leye').click()`);
      await settled('Card', r0 + 1);
      assert.equal(getValue(doc('Card'), 'image.visibility'), 'hidden');
      await browser.waitFor(`${row('image')}.classList.contains('hidden-node') && getComputedStyle(${row('image')}.querySelector('.leye')).display !== 'none'`);
      assert.equal(await q(`getComputedStyle(document.querySelector('section[data-name="Card"] [data-n="image"]')).visibility`), 'hidden');
      await q(`${row('image')}.querySelector('.leye').click()`);
      await settled('Card', r0 + 2);
      assert.equal(getValue(doc('Card'), 'image.visibility'), undefined);
    });

    await t.test('layers: rows are 28 px, the menu says why an item is disabled, the grip shows on hover', async () => {
      const row = (node) => `document.querySelector('#layers [data-component="' + napkin.find('Card').component + '"][data-node="${node}"]')`;
      assert.equal(await q(`Math.round(${row('title')}.getBoundingClientRect().height)`), 28);
      await q(`${row('card')}.querySelector('.lmore').click()`);
      await browser.waitFor(`!document.querySelector('#lmenu').hidden`);
      assert.match(await q(`document.querySelector('#lmenu [data-do=delete]').textContent`), /root can.t be deleted/);
      await io.key('Escape');
      const c = await centerOf(browser, row('title'));
      await io.move(c.x, c.y);
      await browser.waitFor(`getComputedStyle(${row('title')}.querySelector('.lgrip')).display !== 'none'`);
    });

    await t.test('layers: the row menu renames, duplicates and deletes', async () => {
      const row = (node) => `document.querySelector('#layers [data-component="' + napkin.find('Card').component + '"][data-node="${node}"]')`;
      const c = await centerOf(browser, row('title'));
      await io.move(c.x, c.y);
      await browser.waitFor(`getComputedStyle(${row('title')}.querySelector('.lmore')).display !== 'none'`);
      let r0 = await rev('Card');
      await q(`${row('title')}.querySelector('.lmore').click()`);
      await browser.waitFor(`!document.querySelector('#lmenu').hidden`);
      await q(`document.querySelector('#lmenu [data-do=duplicate]').click()`);
      await settled('Card', r0 + 1);
      assert.deepEqual(doc('Card').root.children.map((x) => x.id), ['image', 'title', 'title2', 'body']);
      assert.equal(await q(`napkin.state.selection.node`), 'title2');
      r0 = await rev('Card');
      await browser.waitFor(`!!${row('title2')}`);
      await q(`${row('title2')}.querySelector('.lmore').click()`);
      await q(`document.querySelector('#lmenu [data-do=delete]').click()`);
      await settled('Card', r0 + 1);
      assert.deepEqual(doc('Card').root.children.map((x) => x.id), ['image', 'title', 'body']);
    });

    await t.test('selection: shift-click in another component says the selection stays within one; a link to a missing node leaves no phantom', async () => {
      await browser.goto(server.url); await browser.waitFor('document.body.dataset.ready === "1"'); await sleep(200);
      await io.key('!', { shift: true, code: 'Digit1' }); await sleep(400);
      const a = await centerOf(browser, `document.querySelector('section[data-name="Card"] .mount [data-n="title"]')`);
      const b = await centerOf(browser, `document.querySelector('section[data-name="Chip"] .mount [data-n="label"]')`);
      await io.click(a.x, a.y);
      await io.click(b.x, b.y, { shift: true });
      await browser.waitFor(`document.querySelector('#hint').textContent === 'Selection stays within one component'`);
      assert.equal(await q(`napkin.state.selections.length`), 1);
      await browser.goto(server.url + '#Button/nope'); await browser.waitFor('document.body.dataset.ready === "1"');
      await browser.waitFor(`document.body.dataset.focus === 'Button'`);
      assert.equal(await q(`napkin.state.selection?.node`), 'root', 'falls back to the component root');
      assert.equal(await q(`location.hash`), '#Button/root');
    });

    await t.test('far zoom: a compact axis strip replaces the headers and stays at least 10 px', async () => {
      await browser.goto(server.url); await browser.waitFor('document.body.dataset.ready === "1"');
      await q(`napkin.view.set({ ...napkin.view.get(), z: 0.08 })`);
      await sleep(100);
      const m = JSON.parse(await q(`JSON.stringify((() => {
        const s = document.querySelector('section[data-name="Chip"] .axes-strip'), cs = getComputedStyle(s);
        return { shown: cs.display !== 'none', text: s.textContent, px: parseFloat(cs.fontSize) * s.getBoundingClientRect().width / s.offsetWidth, hidden: getComputedStyle(document.querySelector('.colhead span')).visibility };
      })())`));
      assert.equal(m.shown, true); assert.match(m.text, /size ×4 →\s+tone ×4 ↓\s+look ×4/);
      assert.ok(m.px >= 10, `strip text is ${m.px} px`);
      assert.equal(m.hidden, 'hidden');
    });
  } finally { await browser.close(); await server.stop(); }
});
