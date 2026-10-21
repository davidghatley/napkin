// First build M3 (F05, F13, F14, F15): the real panel. Headless Chromium (CPU) drives it like a person.
// Set DEMO_OUT=docs/demo to save the override-mode screenshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readComponent } from '../src/tsx/read.js';
import { getValue } from '../src/model.js';
import { tempRepo, startServer, ROOT } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';

test('the panel edits base, variants, text settings, props and axes through the store', { timeout: 90000 }, async (t) => {
  const { fileOf, git } = tempRepo();
  const server = await startServer(join(fileOf('Card'), '..'));
  const browser = await launchChromium({ width: 1400, height: 1000 });
  const q = (expr) => browser.eval(expr);
  const sec = (name) => `document.querySelector('section[data-name="${name}"]')`;
  const cells = (name) => `[...${sec(name)}.querySelectorAll('.cell')]`;
  const pads = (prop) => q(`Object.fromEntries(${cells('Button')}.map((c) => [c.dataset.variant, getComputedStyle(c.querySelector('[data-n="root"]'))[${JSON.stringify(prop)}]]))`);
  const click = async (sel) => { await browser.waitFor(`document.querySelector(${JSON.stringify(sel)})`); return q(`document.querySelector(${JSON.stringify(sel)}).click()`); };
  const doc = (name) => readComponent(readFileSync(fileOf(name), 'utf8')).doc;
  const numstat = () => git('diff', '--numstat').trim();
  const selectCell = async (n, i, node) => {
    await q(`${cells(n)}[${i}].querySelector('[data-n="${node}"]').click()`);
    await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('${node}')`);
  };
  const cellIndex = async (variant) => q(`${cells('Button')}.findIndex((c) => c.dataset.variant === ${JSON.stringify(JSON.stringify(variant))})`);
  const settled = async (rev) => browser.waitFor(`${sec('Button')}.dataset.revision !== "${rev}" && document.body.dataset.ready === "1"`);
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');

    await t.test('(a) base borderRadius reaches all 6 cells with a one-line diff', async () => {
      await selectCell('Button', await cellIndex({ size: 'md', state: 'default' }), 'root');
      assert.equal(await q(`document.querySelector('#sel-target').textContent`), 'Base');
      assert.equal(await q(`document.querySelector('#borderRadius').value`), '6');
      await browser.type('#borderRadius', '10');
      await browser.waitFor(`${cells('Button')}.every((c) => getComputedStyle(c.querySelector('[data-n="root"]')).borderTopLeftRadius === '10px')`);
      assert.equal(numstat(), '1\t1\tcomponents/Button.tsx');
      assert.equal(getValue(doc('Button'), 'root.borderRadius'), 10, 'a bare number stays a number');
      // string values stay strings; empty removes
      await browser.type('#padding', '8px 20px');
      await browser.waitFor(`document.querySelector('#padding').value === '8px 20px' && ${sec('Button')}.querySelector('[data-n="root"]').style.padding === '8px 20px'`);
      assert.equal(getValue(doc('Button'), 'root.padding'), '8px 20px');
      await browser.type('#borderRadius', '');
      await browser.waitFor(`getComputedStyle(${sec('Button')}.querySelector('[data-n="root"]')).borderTopLeftRadius === '0px'`);
      assert.equal(getValue(doc('Button'), 'root.borderRadius'), undefined);
      git('checkout', '--', 'components/Button.tsx');
      await browser.waitFor(`getComputedStyle(${sec('Button')}.querySelector('[data-n="root"]')).borderTopLeftRadius === '6px'`);
    });

    await t.test('(b) an override in size=sm changes only the sm cells; dot and Reset to base', async () => {
      await selectCell('Button', await cellIndex({ size: 'md', state: 'hover' }), 'root');
      assert.equal(await q(`document.querySelector('#scope').value`), 'base');
      await selectCell('Button', await cellIndex({ size: 'sm', state: 'default' }), 'root');
      assert.equal(await q(`document.querySelector('#scope').value`), 'base', 'a new variant selection edits the base first');
      await q(`(() => { const s = document.querySelector('#scope'); s.value = 'variant'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await browser.waitFor(`document.querySelector('#sel-target').textContent === 'override size=sm'`);
      assert.equal(await q(`document.querySelector('#padding').value`), '4px 10px', 'shows the resolved value');
      assert.equal(await q(`!!document.querySelector('#dot-padding') && !!document.querySelector('#reset-padding')`), true);
      assert.equal(await q(`!!document.querySelector('#dot-borderRadius')`), false);
      await browser.type('#padding', '2px 4px');
      await browser.waitFor(`${cells('Button')}.filter((c) => getComputedStyle(c.querySelector('[data-n="root"]')).paddingTop === '2px').length === 2`);
      const p = await pads('paddingTop');
      assert.deepEqual(Object.entries(p).filter(([, v]) => v === '2px').map(([k]) => JSON.parse(k).size), ['sm', 'sm']);
      assert.equal(p['{"size":"md","state":"default"}'], '8px');
      assert.equal(getValue(doc('Button'), 'root.padding', { size: 'sm' }), '2px 4px');
      assert.equal(getValue(doc('Button'), 'root.padding'), '8px 16px', 'base untouched');
      assert.equal(await q(`document.querySelector('#padding').value`), '2px 4px');
      assert.equal(await q(`!!document.querySelector('#dot-padding')`), true);
      if (process.env.DEMO_OUT) {
        const out = join(ROOT, process.env.DEMO_OUT); mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'panel-override.png'), await browser.screenshot());
      }
      await click('#reset-padding');
      await browser.waitFor(`!document.querySelector('#dot-padding') && document.querySelector('#padding').value === '8px 16px'`);
      assert.equal(getValue(doc('Button'), 'root.padding', { size: 'sm' }), undefined);
      await browser.waitFor(`${cells('Button')}.filter((c) => getComputedStyle(c.querySelector('[data-n="root"]')).paddingTop === '8px').length === 4`);
      assert.equal((await pads('paddingTop'))['{"size":"lg","state":"default"}'], '12px', 'only lg keeps its own padding');
    });

    await t.test('override mode is unavailable on an all-base cell, and a two-axis cell lets you pick the axis', async () => {
      await selectCell('Button', await cellIndex({ size: 'md', state: 'default' }), 'root');
      assert.equal(await q(`document.querySelector('#scope option[value=variant]').disabled`), true);
      assert.match(await q(`document.querySelector('#target-note').textContent`), /all base values/);
      await selectCell('Button', await cellIndex({ size: 'sm', state: 'hover' }), 'root');
      await q(`(() => { const s = document.querySelector('#scope'); s.value = 'variant'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await browser.waitFor(`document.querySelector('#override-axis')`);
      assert.equal(await q(`document.querySelector('#override-axis').value`), 'size', 'defaults to the first non-base axis');
      await q(`(() => { const s = document.querySelector('#override-axis'); s.value = 'state'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await browser.waitFor(`document.querySelector('#override-axis').value === 'state'`);
      await browser.type('#color', 'tomato');
      await browser.waitFor(`${cells('Button')}.filter((c) => getComputedStyle(c.querySelector('[data-n="root"]')).color === 'rgb(255, 99, 71)').length === 3`);
      assert.equal(getValue(doc('Button'), 'root.color', { state: 'hover' }), 'tomato');
      git('checkout', '--', 'components/Button.tsx');
      await browser.waitFor(`${cells('Button')}.every((c) => getComputedStyle(c.querySelector('[data-n="root"]')).color !== 'rgb(255, 99, 71)')`);
    });

    await t.test('(c) adding the size value xl grows the grid to 8 cells', async () => {
      await selectCell('Button', 0, 'root');
      await click('#add-value-size');
      await browser.waitFor('document.querySelector("#new-value-size")');
      await browser.type('#new-value-size', 'xl');
      await click('#add-value-submit-size');
      await browser.waitFor(`${cells('Button')}.length === 8`);
      assert.deepEqual(doc('Button').props.find((p) => p.name === 'size').options, ['md', 'sm', 'lg', 'xl']);
      await browser.waitFor('document.querySelector("#remove-value-size-xl")');
      assert.equal(numstat().split('\n').length, 1);
      // the base value can't be removed: disabled, with the reason
      assert.equal(await q(`document.querySelector('#remove-value-size-md').disabled`), true);
      assert.match(await q(`document.querySelector('#remove-value-size-md').title`), /base/);
      await click('#remove-value-size-xl');
      await browser.waitFor(`${cells('Button')}.length === 6`);
      git('checkout', '--', 'components/Button.tsx');
      await browser.waitFor(`${cells('Button')}.length === 6 && !document.querySelector('#remove-value-size-xl')`);
    });

    await t.test('+ axis adds an axis with base "default"', async () => {
      await click('#add-axis');
      await browser.type('#new-axis-name', 'tone');
      await browser.type('#new-axis-value', 'loud');
      await click('#add-axis-submit');
      await browser.waitFor(`${cells('Button')}.length === 12`);
      assert.deepEqual(doc('Button').props.find((p) => p.name === 'tone').options, ['default', 'loud']);
      git('checkout', '--', 'components/Button.tsx');
      await browser.waitFor(`${cells('Button')}.length === 6`);
    });

    await t.test('(d) Make setting on the Card body creates a body prop and binds it', async () => {
      await q(`${sec('Card')}.querySelector('[data-n="body"]').click()`);
      await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('body')`);
      assert.match(await q(`document.querySelector('#text').value`), /A person and an agent/);
      await click('#make-setting');
      await browser.waitFor('document.querySelector("#bind-prop")');
      assert.equal(await q(`document.querySelector('#bind-prop').value`), 'body');
      await click('#bind-submit');
      await browser.waitFor(`document.querySelector('#shows')?.textContent.includes('shows body')`);
      const d = doc('Card');
      assert.equal(d.props.find((p) => p.name === 'body')?.default, 'A person and an agent edit this Card at the same time.');
      assert.deepEqual(getValue(d, 'body.text'), { prop: 'body' });
      // edit the default from the Props section, then unbind
      await browser.type('#propdef-body', 'New default');
      await browser.waitFor(`${sec('Card')}.querySelector('[data-n="body"]').textContent === 'New default'`);
      assert.equal(doc('Card').props.find((p) => p.name === 'body').default, 'New default');
      assert.deepEqual(getValue(doc('Card'), 'body.text'), { prop: 'body' });
      await click('#unbind');
      await browser.waitFor(`document.querySelector('#text')?.value === 'New default'`);
    });

    await t.test('props can be added and removed; a prop in use refuses with the error inline', async () => {
      await click('#add-prop');
      await browser.type('#new-prop-name', 'footer');
      await click('#add-prop-submit');
      await browser.waitFor('document.querySelector("#remove-prop-footer")');
      assert.equal(doc('Card').props.some((p) => p.name === 'footer'), true);
      await click('#remove-prop-footer');
      await browser.waitFor('!document.querySelector("#remove-prop-footer")');
    });

    await t.test('(e) refused edits show the error inline and leave the file unchanged', async () => {
      await selectCell('Button', 0, 'label');
      const before = readFileSync(fileOf('Button'), 'utf8');
      await click('#remove-prop-label'); // label is shown by the text node
      await browser.waitFor('document.querySelector("#err-prop-label")');
      assert.match(await q(`document.querySelector('#err-prop-label').textContent`), /^invalid edit #\d+: "label" shows label; unbind its text first/);
      assert.equal(readFileSync(fileOf('Button'), 'utf8'), before);
      // a bad value is refused next to its field
      await selectCell('Button', 0, 'root');
      await browser.type('#width', 'a;b');
      await browser.waitFor('document.querySelector("#err-style-width")');
      assert.match(await q(`document.querySelector('#err-style-width').textContent`), /invalid edit #0: unsafe value/);
      assert.equal(readFileSync(fileOf('Button'), 'utf8'), before);
      assert.equal(readFileSync(fileOf('Card'), 'utf8').includes('New default'), true);
    });

    assert.deepEqual(browser.consoleLines.filter((l) => /error/i.test(l)), [], 'no console errors');
  } finally {
    await browser.close(); await server.stop();
  }
});
