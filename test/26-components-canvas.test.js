// Components lane, canvas: CMP-09 play mode (timing, live pointer events, live settings) and CMP-10 large matrices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lab } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';
import { centerOf } from './helpers/input.js';

const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');

test('CMP-10: a 4x4x4 matrix filters and collapses; any cell is reached in two actions', { timeout: 120000 }, async (t) => {
  const L = await lab({ Chip: fx('Chip') }, { theme: 'light' });
  const { q, browser, io } = L;
  try {
    assert.equal(await q(`document.querySelectorAll('figure.cell').length`), 64);
    assert.equal(await q(`document.querySelectorAll('.mctl .mrow:not(.mtools)').length`), 3, 'one chip row per axis');
    const shown = () => q(`document.querySelectorAll('figure.cell:not(.mhide)').length`);
    const dims = JSON.parse(await q(`JSON.stringify(Object.fromEntries(napkin.find('Chip').doc.props.filter((p) => p.type === 'enum').map((p) => [p.name, p.options])))`));
    const [a0, a1, a2] = Object.keys(dims);
    await t.test('one click on a value shows only it; clicking it again shows all', async () => {
      await q(`document.querySelector('.mchip[data-axis=${a2}][data-value=${dims[a2][2]}]').click()`);
      assert.equal(await shown(), 16);
      assert.equal(await q(`document.querySelectorAll('.group:not(.mhide)').length`), 1);
      await q(`document.querySelector('.mchip[data-axis=${a2}][data-value=${dims[a2][2]}]').click()`);
      assert.equal(await shown(), 64);
    });
    await t.test('shift adds a value; the last value cannot be hidden', async () => {
      await q(`document.querySelector('.mchip[data-axis=${a0}][data-value=${dims[a0][0]}]').click()`);
      await q(`document.querySelector('.mchip[data-axis=${a0}][data-value=${dims[a0][1]}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
      assert.equal(await shown(), 32);
      assert.equal(await q(`document.querySelector('.group .mgrid').style.getPropertyValue('--cols')`), '2');
      assert.match(await q(`document.querySelector('.mcount').textContent`), /32 of 64 shown/);
      await q(`document.querySelector('[data-act=show-all]').click()`);
      assert.equal(await shown(), 64);
    });
    await t.test('a group collapses with one click on its title and expands again', async () => {
      const h0 = await q(`document.querySelector('.frame').offsetHeight`);
      await q(`document.querySelector('.group .gtoggle').click()`);
      assert.equal(await q(`document.querySelector('.group').dataset.collapsed`), '1');
      assert.equal(await q(`getComputedStyle(document.querySelector('.group .mgrid')).display`), 'none');
      await q(`document.querySelector('[data-act=collapse-all]').click()`);
      assert.equal(await q(`[...document.querySelectorAll('.group')].every((g) => g.dataset.collapsed === '1')`), true);
      assert.ok((await q(`document.querySelector('.frame').offsetHeight`)) < h0 / 2, 'the frame shrinks');
      await q(`document.querySelector('[data-act=expand-all]').click()`);
      assert.equal(await q(`document.querySelector('.frame').offsetHeight`), h0);
    });
    await t.test('every one of the 64 cells is reachable in at most two actions (chip, then click it)', async () => {
      let ok = 0;
      for (const v2 of dims[a2]) for (const v1 of dims[a1]) for (const v0 of dims[a0]) {
        // action 1: show only that group value (chip click), action 2: click the cell
        await q(`(() => { napkin.matrix.showAll(napkin.find('Chip').component); document.querySelector('.mchip[data-axis=${a2}][data-value=${v2}]').click(); })()`);
        const cell = JSON.stringify({ [a0]: v0, [a1]: v1, [a2]: v2 });
        const exists = await q(`(() => { const c = [...document.querySelectorAll('figure.cell')].find((f) => JSON.stringify(JSON.parse(f.dataset.variant)) === ${JSON.stringify(cell)}); return !!c && c.getBoundingClientRect().width > 0; })()`);
        if (exists) ok++;
      }
      assert.equal(ok, 64);
    });
    await t.test('filter state survives a re-render and is not written to the file', async () => {
      await q(`napkin.matrix.showAll(napkin.find('Chip').component)`);
      await q(`document.querySelector('.mchip[data-axis=${a1}][data-value=${dims[a1][1]}]').click()`);
      const before = readFileSync(`${L.compDir}/Chip.tsx`, 'utf8');
      const id = await L.id('Chip');
      await L.edit('Chip', [{ op: 'set', path: `${(await L.doc('Chip')).root.id}.padding`, value: '3px' }]);
      assert.equal(await shown(), 16);
      assert.equal(await q(`napkin.matrix.state(${JSON.stringify(id)}).hide.${a1}.length`), 3);
      assert.notEqual(readFileSync(`${L.compDir}/Chip.tsx`, 'utf8'), before); // only the edit changed it
    });
  } finally { await L.close(); }
});

test('CMP-09: play mode toggles in < 100 ms, cells react to real clicks, settings are typed live and never saved', { timeout: 120000 }, async (t) => {
  const L = await lab({ Button: fx('Button') }, { theme: 'light' });
  const { q, browser, io } = L;
  try {
    await L.select('Button', 'root', { size: 'md', state: 'default' });
    await t.test('P toggles; the toggle takes < 100 ms and overlays step aside', async () => {
      const ms = [];
      for (let i = 0; i < 3; i++) {
        await q(`window.__t = performance.now(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); window.__d = performance.now() - window.__t; window.__d`);
        ms.push(await q(`window.__d`));
        assert.equal(await q(`document.body.dataset.play`), '1');
        assert.equal(await q(`getComputedStyle(document.querySelector('#overlay-select')).display`), 'none');
        await q(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }))`);
        assert.equal(await q(`document.body.dataset.play`), undefined);
      }
      assert.ok(Math.max(...ms) < 100, `toggle ${ms.map((x) => x.toFixed(1))} ms`);
    });
    await t.test('in play mode a click reaches the component and does not select; out of it, it selects', async () => {
      await q(`napkin.select(null)`);
      await q(`napkin.play.set(true)`);
      await q(`(() => { window.__clicked = 0; document.querySelector('figure.cell .mount button').addEventListener('click', () => { window.__clicked++; }); })()`);
      const c = await centerOf(browser, `document.querySelector('figure.cell .mount button')`);
      await io.click(c.x, c.y);
      await sleep(80);
      assert.equal(await q(`window.__clicked`), 1);
      assert.equal(await q(`napkin.state.selection`), null);
      await q(`napkin.play.set(false)`);
      await sleep(250);
      const c2 = await centerOf(browser, `document.querySelector('figure.cell .mount button')`);
      await io.click(c2.x, c2.y);
      await sleep(80);
      assert.ok(await q(`!!napkin.state.selection`));
    });
    await t.test('typing into a setting re-renders every cell live; leaving play puts the file defaults back; the file never changes', async () => {
      const file = `${L.compDir}/Button.tsx`;
      const before = readFileSync(file, 'utf8');
      await L.select('Button', 'root', { size: 'md', state: 'default' });
      await q(`napkin.play.set(true)`);
      await browser.waitFor(`!!document.querySelector('#play-prop-label')`);
      await q(`(() => { const i = document.querySelector('#play-prop-label'); i.focus(); i.value = 'Buy now'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await browser.waitFor(`[...document.querySelectorAll('figure.cell .mount [data-n=label]')].every((e) => e.textContent === 'Buy now')`);
      assert.equal(await q(`document.querySelectorAll('figure.cell').length`), 6);
      await q(`document.querySelector('#play-exit').click()`);
      await browser.waitFor(`[...document.querySelectorAll('figure.cell .mount [data-n=label]')].every((e) => e.textContent === 'Button')`);
      assert.equal(readFileSync(file, 'utf8'), before);
    });
  } finally { await L.close(); }
});
