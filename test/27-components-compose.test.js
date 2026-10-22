// Components lane, composition on the canvas: CMP-04 show when, CMP-05 slots, CMP-06 instances (+ the < 100 ms edit), CMP-07 swap, CMP-08 extract.
// Needs the dialect 0004 core (merged from area/files). The consumer app is react-dom/server in Chromium; "pixel diff" is screenshot bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lab } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';
import { centerOf } from './helpers/input.js';
import { renderHtml } from './helpers/ssr.js';
import { launchChromium } from './helpers/cdp.js';

const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');
// IconButton: like Button but with an `icon` setting; shares label and size with Button.
const ICONBUTTON = fx('Button').replace(/Button/g, 'IconButton').replace("label?: string;", "label?: string;\n  tone?: string;");

test('composition on the canvas (0004 ops through the panel)', { timeout: 240000 }, async (t) => {
  const L = await lab({ Card: fx('Card'), Button: fx('Button'), IconButton: ICONBUTTON, Card2: fx('Card').replace(/Card/g, 'Card2') }, { theme: 'light' });
  const { q, browser, io } = L;
  const file = (n) => readFileSync(join(L.compDir, `${n}.tsx`), 'utf8');
  const seq = async (n = 'Card') => Number(await L.rev(n));
  const settle = async (b, n = 'Card') => { await browser.waitFor(`napkin.find('${n}').seq > ${b}`); await sleep(200); };
  const setField = async (sel, text) => { await q(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`); };
  const open = async (sec) => { if (!(await q(`document.querySelector('[data-sec=${sec}]')?.open`))) await q(`document.querySelector('[data-sec=${sec}] > summary').click()`); await sleep(60); };
  const cardEl = (n) => `document.querySelector('section[data-name=Card] figure.cell .mount [data-n="${n}"]')`;
  try {
    await L.select('Card', 'image');
    await t.test('CMP-04: "Show when" makes a setting and hides the node when it is off, rendered per cell and in the app', async () => {
      await open('compose');
      const b = await seq();
      await q(`(() => { const s = document.querySelector('#when-select'); s.value = '+new'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await settle(b);
      assert.match(file('Card'), /\{image && <div data-n="image"/);
      assert.match(file('Card'), /image\?: boolean;/);
      assert.equal(await q(`!!${cardEl('image')}`), true, 'on by default');
      await browser.waitFor(`document.querySelector('#when-select').value === 'image'`);
      // the app: both states
      const on = await renderHtml(join(L.compDir, 'Card.tsx'), 'Card', {});
      const off = await renderHtml(join(L.compDir, 'Card.tsx'), 'Card', { image: false });
      assert.match(on, /data-n="image"/); assert.doesNotMatch(off, /data-n="image"/);
      // the canvas, play mode: the checkbox hides it in every cell
      await q(`napkin.play.set(true)`);
      await browser.waitFor(`!!document.querySelector('#play-prop-image')`);
      await q(`(() => { const i = document.querySelector('#play-prop-image'); i.checked = false; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await browser.waitFor(`!${cardEl('image')}`);
      await q(`napkin.play.set(false)`);
      await browser.waitFor(`!!${cardEl('image')}`);
    });

    await t.test('CMP-05: a slot is a drop zone; its preview text is in the sidecar and never in the .tsx', async () => {
      await L.select('Card', 'card');
      await L.edit('Card', [{ op: 'insert', parent: 'card', node: { id: 'extra', tag: 'div' } }]);
      await L.select('Card', 'extra');
      await open('compose');
      let b = await seq();
      await q(`(() => { const s = document.querySelector('#slot-select'); s.value = '+children'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await settle(b);
      assert.match(file('Card'), /children\?: ReactNode;/);
      assert.match(file('Card'), /\{children\}/);
      await browser.waitFor(`${cardEl('extra')}?.dataset.slot === 'children' && ${cardEl('extra')}.dataset.empty === '1'`);
      assert.match(await q(`getComputedStyle(${cardEl('extra')}).outlineStyle`), /dashed/);
      const tsx = file('Card');
      await setField('#slot-preview', 'Words dropped here');
      await browser.waitFor(`${cardEl('extra')}?.textContent === 'Words dropped here'`);
      assert.equal(file('Card'), tsx, 'the .tsx did not change');
      assert.equal(JSON.parse(readFileSync(join(L.compDir, 'Card.napkin.json'), 'utf8')).slots.children, 'Words dropped here');
      assert.equal(file('Card').includes('Words dropped here'), false);
      // a real drop event
      await q(`(() => { const z = ${cardEl('extra')}; const dt = new DataTransfer(); dt.setData('text/plain', 'Dropped text'); z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); z.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); })()`);
      await browser.waitFor(`${cardEl('extra')}?.textContent === 'Dropped text'`);
    });

    await t.test('CMP-06: insert Button from the picker; the nested instance is selectable and its props are JSX attributes', async () => {
      await L.select('Card', 'card');
      await open('compose');
      const b = await seq();
      await q(`document.querySelector('#insert-Button').click()`);
      await settle(b);
      assert.match(file('Card'), /import \{ Button \} from '\.\/Button';/);
      assert.match(file('Card'), /<Button data-n="button" \/>/);
      await browser.waitFor(`!!${cardEl('button')}`);
      assert.equal(await q(`${cardEl('button')}.dataset.instance`), 'Button');
      // a click on the nested button selects the instance in Card (not an element of Button)
      const c = await centerOf(browser, cardEl('button'));
      await io.click(c.x, c.y);
      await sleep(120);
      assert.equal(await q(`napkin.state.selection.node`), 'button');
      await open('compose');
      await browser.waitFor(`!!document.querySelector('#inst-label')`);
      const b2 = await seq();
      await setField('#inst-label', 'Buy');
      await settle(b2);
      assert.match(file('Card'), /<Button data-n="button" label="Buy" \/>/);
      assert.equal(await q(`${cardEl('button')}.textContent`), 'Buy');
      // a size by select, a pass-through from the Card's own setting
      const b3 = await seq();
      await q(`(() => { const s = document.querySelector('#inst-size'); s.value = 'sm'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await settle(b3);
      assert.match(file('Card'), /size="sm"/);
      const b4 = await seq();
      await q(`(() => { const s = document.querySelector('#inst-label-link'); s.value = 'title'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await settle(b4);
      assert.match(file('Card'), /label=\{title\}/);
      assert.equal(await q(`${cardEl('button')}.textContent`), 'From napkin to component');
    });

    await t.test('CMP-06: a Button base edit shows in every Card in < 100 ms (and only Button.tsx changes by one line)', async () => {
      // a second Card that also uses Button, put there by dragging Card2\'s sibling...: use the op directly
      await L.edit('Card2', [{ op: 'insertInstance', parent: 'card', id: 'button', component: 'Button' }]);
      await browser.waitFor(`!!document.querySelector('section[data-name=Card2] .mount [data-n="button"]')`);
      const bgOf = (name) => `getComputedStyle(document.querySelector('section[data-name=${name}] figure.cell .mount [data-n=button]')).backgroundColor`;
      const before = file('Button'), samples = [];
      for (const [hex, rgb] of [['#112233', 'rgb(17, 34, 51)'], ['#223344', 'rgb(34, 51, 68)'], ['#334455', 'rgb(51, 68, 85)'], ['#445566', 'rgb(68, 85, 102)']]) {
        const wait = `${bgOf('Card')} === '${rgb}' && ${bgOf('Card2')} === '${rgb}'`;
        const ms = await q(`(async () => { const t0 = performance.now(); await napkin.sendEdits(napkin.find('Button').component, [{ op: 'set', path: 'root.background', value: '${hex}' }]); while (!(${wait})) { if (performance.now() - t0 > 4000) return -1; await new Promise((x) => requestAnimationFrame(x)); } return performance.now() - t0; })()`);
        assert.ok(ms > 0, `both Cards showed ${hex}`);
        samples.push(ms);
      }
      console.log('CMP-06 Button base edit -> both Cards redrawn (ms):', samples.map((x) => x.toFixed(0)).join(', '));
      samples.sort((a, b) => a - b);
      assert.ok(samples[Math.floor(samples.length / 2)] < 100, `median ${samples[2]} ms`);
      const after = file('Button');
      const gone = before.split('\n').filter((l) => !after.split('\n').includes(l)), added = after.split('\n').filter((l) => !before.split('\n').includes(l));
      assert.deepEqual([gone.length, added.length], [1, 1]);
      assert.equal(file('Card2').includes('#445566'), false);
    });

    await t.test('CMP-06: dragging a frame title onto another frame makes it an instance there', async () => {
      await L.select('Card2', 'card');
      await L.edit('Card2', [{ op: 'delete', id: 'button' }]);
      const b = await seq('Card2');
      const from = await centerOf(browser, `document.querySelector('section[data-name=Button] .cmp-head h3')`);
      const to = await centerOf(browser, `document.querySelector('section[data-name=Card2] .mount [data-n="title"]')`);
      await io.drag(from.x, from.y, to.x, to.y);
      await settle(b, 'Card2');
      assert.match(file('Card2'), /<Button data-n="button" \/>/);
      assert.match(file('Card2'), /import \{ Button \} from '\.\/Button';/);
    });

    await t.test('CMP-07: swap Button for IconButton keeps the props both have and says what it dropped', async () => {
      await L.select('Card', 'button');
      await open('compose');
      await browser.waitFor(`!!document.querySelector('#swap-select')`);
      const b = await seq();
      await q(`(() => { const s = document.querySelector('#swap-select'); s.value = 'IconButton'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await settle(b);
      const t2 = file('Card');
      assert.match(t2, /<IconButton data-n="button" label=\{title\} size="sm" \/>/);
      assert.match(t2, /import \{ IconButton \} from '\.\/IconButton';/);
      assert.equal(/import \{ Button \}/.test(t2), false);
      assert.match(await q(`document.querySelector('#hint').textContent`), /swapped for IconButton/);
    });

    await t.test('CMP-08: Make component: a new file, an instance in place, and the app renders the same pixels', async () => {
      await L.select('Card', 'title');
      await open('compose');
      const appShot = async () => {
        const html = await renderHtml(join(L.compDir, 'Card.tsx'), 'Card', {});
        const br = await launchChromium({ width: 700, height: 600 });
        try { await br.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset=utf-8><body style="margin:0">${html}`)}`); return await br.screenshot(); } finally { await br.close(); }
      };
      const before = await appShot();
      await q(`document.querySelector('#make-component').click()`);
      await browser.waitFor(`!!document.querySelector('#extract-name')`);
      await setField('#extract-name', 'Heading');
      await q(`document.querySelector('#extract-submit').click()`);
      await browser.waitFor(`!!napkin.find('Heading')`);
      await sleep(400);
      assert.ok(existsSync(join(L.compDir, 'Heading.tsx')));
      assert.match(file('Card'), /import \{ Heading \} from '\.\/Heading';/);
      assert.match(file('Card'), /<Heading data-n="title" /);
      const after = await appShot();
      assert.equal(after.equals(before), true, 'pixel diff 0 in the consumer app');
    });
  } finally { await L.close(); }
});
