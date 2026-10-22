// Components lane, panel: CMP-01 props editor, CMP-02 variant axes, CMP-03 sources. Real input over CDP, one Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lab } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';
import { centerOf } from './helpers/input.js';

const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');
const file = (L, n) => readFileSync(join(L.compDir, `${n}.tsx`), 'utf8');

test('components panel: settings, axes, sources', { timeout: 180000 }, async (t) => {
  const L = await lab({ Button: fx('Button') }, { theme: 'light' });
  const { q, browser, io } = L;
  const open = async (sec) => { if (!(await q(`document.querySelector('[data-sec=${sec}]').open`))) await q(`document.querySelector('[data-sec=${sec}] > summary').click()`); await sleep(60); };
  const setField = async (sel, text) => { await q(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`); };
  const edit = async (on) => { await browser.waitFor(`!!document.querySelector('#edit-settings')`); if ((await q(`document.querySelector('#edit-settings').getAttribute('aria-pressed')`)) !== String(on)) await q(`document.querySelector('#edit-settings').click()`); await sleep(80); };
  const names = async () => (await L.doc('Button')).props.map((p) => p.name);
  const seq = async () => Number(await L.rev('Button'));
  const settle = async (before) => { await browser.waitFor(`napkin.find('Button').seq > ${before}`); await sleep(150); };
  try {
    await L.select('Button', 'root', { size: 'md', state: 'default' });

    await t.test('CMP-01: rename updates the interface, the parameter, the text node and v, as ONE revision', async () => {
      await open('props');
      await edit(true);
      const before = await seq();
      await setField('#prop-name-label', 'caption');
      await settle(before);
      assert.equal(await seq(), before + 1);
      const text = file(L, 'Button');
      assert.match(text, /caption\?: string;/);
      assert.match(text, /\{caption\}<\/span>/);
      assert.equal(/label\?/.test(text), false);
      assert.equal(await q(`document.querySelector('#prop-name-caption').value`), 'caption');
    });

    await t.test('CMP-01: a description is a /** */ comment; reorder with Down and by dragging the grip', async () => {
      assert.equal(await q(`document.querySelectorAll('#panel [id^=add-note-]').length`), 3, 'a quiet Add note link on each setting until it has a note');
      assert.equal(await q(`!!document.querySelector('#prop-desc-caption')`), false);
      await q(`document.querySelector('#add-note-caption').click()`);
      await browser.waitFor(`!!document.querySelector('#prop-desc-caption')`);
      await setField('#prop-desc-caption', 'The words on the button');
      await browser.waitFor(`document.querySelector('#prop-desc-caption')?.value === 'The words on the button'`);
      await sleep(200);
      assert.match(file(L, 'Button'), /\/\*\* The words on the button \*\/\n  caption\?: string;/);
      let b = await seq();
      await q(`document.querySelector('#prop-down-caption').click()`);
      await settle(b);
      assert.deepEqual(await names(), ['size', 'caption', 'state']);
      // drag the grip of "state" above "size"
      b = await seq();
      const g = await centerOf(browser, `document.querySelector('#grip-prop-state')`), top = await centerOf(browser, `document.querySelector('#prop-size')`);
      await io.drag(g.x, g.y, top.x, top.y - 6);
      await settle(b);
      assert.deepEqual(await names(), ['state', 'size', 'caption']);
      assert.match(file(L, 'Button'), /interface ButtonProps \{\n  state\?:/);
    });

    await t.test('CMP-01: add (string, boolean, enum), set defaults, remove', async () => {
      await edit(false);
      for (const [name, type, extra] of [['note', 'string'], ['dense', 'boolean'], ['tone', 'enum', 'calm, loud']]) {
        await q(`document.querySelector('#add-prop').click()`);
        await browser.waitFor(`!!document.querySelector('#new-prop-name')`);
        await setField('#new-prop-name', name);
        await q(`(() => { const s = document.querySelector('#new-prop-type'); s.value = '${type}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        if (extra) await setField('#new-prop-options', extra);
        const b = await seq();
        await q(`document.querySelector('#add-prop-submit').click()`);
        await settle(b);
      }
      const doc = await L.doc('Button');
      assert.deepEqual(doc.props.slice(-3).map((p) => [p.name, p.type]), [['note', 'string'], ['dense', 'boolean'], ['tone', 'enum']]);
      let b = await seq();
      assert.match(await q(`document.querySelector('#prop-caption .pdesc').textContent`), /The words on the button/, 'the description is a quiet line under the name');
      await q(`document.querySelector('#propdef-dense').click()`); await settle(b);
      assert.equal((await L.doc('Button')).props.find((p) => p.name === 'dense').default, true);
      b = await seq();
      await setField('#propdef-note', 'hi'); await settle(b);
      assert.equal((await L.doc('Button')).props.find((p) => p.name === 'note').default, 'hi');
      await edit(true);
      for (const n of ['note', 'dense', 'tone']) { b = await seq(); await q(`document.querySelector('#remove-prop-${n}').click()`); await settle(b); }
      assert.deepEqual(await names(), ['state', 'size', 'caption']);
    });

    await t.test('CMP-02: add a value, rename it (only lines naming it change), reorder it, remove it', async () => {
      await open('variants');
      const base = file(L, 'Button');
      await q(`document.querySelector('#add-value-size').click()`);
      await browser.waitFor(`!!document.querySelector('#new-value-size')`);
      await setField('#new-value-size', 'xl');
      let b = await seq(); await q(`document.querySelector('#add-value-submit-size').click()`); await settle(b);
      assert.deepEqual((await L.doc('Button')).props.find((p) => p.name === 'size').options, ['md', 'sm', 'lg', 'xl']);
      const withXl = file(L, 'Button');
      b = await seq(); await setField('#value-name-size-xl', 'huge'); await settle(b);
      const renamed = file(L, 'Button');
      const lines = (x) => new Set(x.split('\n'));
      const changed = [...lines(renamed)].filter((l) => !lines(withXl).has(l));
      assert.equal(changed.length, 1, changed.join('|')); // only the union line
      b = await seq(); await q(`document.querySelector('#value-up-size-huge').click()`); await settle(b);
      assert.deepEqual((await L.doc('Button')).props.find((p) => p.name === 'size').options, ['md', 'sm', 'huge', 'lg']);
      b = await seq(); await q(`document.querySelector('#remove-value-size-huge').click()`); await settle(b);
      assert.equal(file(L, 'Button').replace(/\s+/g, ' '), base.replace(/\s+/g, ' '));
    });

    await t.test('CMP-02: add an axis, rename it, move it, remove it', async () => {
      await q(`document.querySelector('#add-axis').click()`);
      await browser.waitFor(`!!document.querySelector('#new-axis-name')`);
      await setField('#new-axis-name', 'tone'); await setField('#new-axis-value', 'loud');
      let b = await seq(); await q(`document.querySelector('#add-axis-submit').click()`); await settle(b);
      assert.equal(await q(`document.querySelectorAll('figure.cell').length`), 12);
      assert.match(await q(`document.querySelector('#grid-size').textContent`), /state × size × tone = 12 variants/);
      b = await seq(); await setField('#axis-name-tone', 'mood'); await settle(b);
      assert.ok((await names()).includes('mood'));
      b = await seq(); await q(`document.querySelector('#axis-up-mood').click()`); await settle(b);
      assert.deepEqual(await q(`JSON.stringify([...document.querySelectorAll('#panel .acard')].map((e) => e.dataset.axis))`).then(JSON.parse), ['state', 'mood', 'size']);
      b = await seq(); await q(`document.querySelector('#remove-axis-mood').click()`); await settle(b);
      assert.equal(await q(`document.querySelectorAll('figure.cell').length`), 6);
    });

    await t.test('CMP-03: each property shows its source; Reset and Move to base are one revision each', async () => {
      await L.select('Button', 'root', { size: 'sm', state: 'default' });
      await browser.waitFor(`!!document.querySelector('#src-padding')`);
      assert.equal(await q(`document.querySelector('#src-chip-padding').textContent`), 'size=sm');
      assert.equal(await q(`document.querySelector('#src-chip-borderRadius').textContent`), 'base');
      assert.match(await q(`document.querySelector('#src-also-padding').textContent`), /size=lg/);
      assert.equal(await q(`document.querySelectorAll('#sources .dot:not(.off)').length`), 2); // padding, fontSize
      assert.match(await q(`document.querySelector('#sources-count').textContent`), /2 from variants/);
      // Move to base: padding becomes the base value; the sm override goes; lg keeps its own
      let b = await seq(); await q(`document.querySelector('#src-base-padding').click()`); await settle(b);
      assert.equal(await seq(), b + 1);
      let d = await L.doc('Button');
      assert.equal(d.root.style.padding, '4px 10px');
      assert.equal(d.variants.size.sm.root.padding, undefined);
      assert.equal(d.variants.size.lg.root.padding, '12px 24px');
      // Reset: fontSize drops back to the base value
      b = await seq(); await q(`document.querySelector('#src-reset-fontSize').click()`); await settle(b);
      d = await L.doc('Button');
      assert.equal(d.variants.size.sm, undefined);
      assert.equal(await q(`document.querySelector('#src-chip-fontSize').textContent`), 'base');
    });
  } finally { await L.close(); }
});
