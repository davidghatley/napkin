// Canvas lane, round 1: the look. axe-core on light and dark chrome (FEEL-03), a 4x4x4 variant matrix whose headers are
// legible at fit (CAN-06), and the evidence screenshots (set EVIDENCE_OUT=docs/evidence to write them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, startServer, sleep } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';
import { input, centerOf } from './helpers/input.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const sec = (name) => `document.querySelector('section[data-name="${name}"]')`;
const node = (name, n) => `${sec(name)}.querySelector('.mount [data-n="${n}"]')`;

async function axeRun(browser) {
  await browser.eval(AXE);
  return JSON.parse(await browser.eval(`axe.run(document, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\\n').slice(0, 3).join(' | ')) }))))`));
}

test('FEEL-03 axe-core: no serious or critical violations in light or dark chrome', { timeout: 90000 }, async (t) => {
  const { compDir } = tempRepo(['Card', 'Button', 'Chip']);
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    await sleep(300);
    for (const theme of ['light', 'dark']) {
      await browser.eval(`(() => { const want = '${theme}'; const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== want) document.querySelector('#theme-toggle').click(); return document.documentElement.dataset.theme; })()`);
      assert.equal(await browser.eval(`document.documentElement.dataset.theme`), theme);
      await browser.eval(`napkin.select(null)`);
      await sleep(100);
      for (const [state, setup] of [
        ['nothing selected', async () => {}],
        ['a node selected (design panel open)', async () => { const c = await centerOf(browser, node('Button', 'root')); await io.click(c.left + 5, c.y); await browser.waitFor(`napkin.state.selection?.node === 'root'`); }],
        ['quick open showing', async () => { await io.key('k', { ctrl: true }); await browser.waitFor(`!document.querySelector('#quick').hidden`); await browser.send('Input.insertText', { text: 'chip' }); await sleep(100); }],
      ]) {
        await setup();
        const found = await axeRun(browser);
        const bad = found.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        t.diagnostic(`${theme}, ${state}: ${found.length} findings, ${bad.length} serious or critical${found.length ? ' (' + found.map((v) => `${v.id}:${v.impact}`).join(', ') + ')' : ''}`);
        assert.deepEqual(bad, [], `${theme} / ${state}: ${JSON.stringify(bad, null, 1)}`);
      }
      await io.key('Escape');
    }
  } finally { await browser.close(); await server.stop(); }
});

test('CAN-06 the 4x4x4 Chip matrix: axes across and down, a third as groups, headers legible at fit', { timeout: 60000 }, async (t) => {
  const { compDir } = tempRepo(['Chip']);
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    await sleep(300);
    const info = JSON.parse(await browser.eval(`JSON.stringify((() => {
      const z = napkin.view.get().z, ls = Number(document.querySelector('#world').dataset.ls);
      const eff = (el) => parseFloat(getComputedStyle(el).fontSize) * el.getBoundingClientRect().width / el.offsetWidth;
      const sizes = (sel) => [...document.querySelectorAll(sel)].map(eff);
      const text = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
      const groups = [...document.querySelectorAll('.group')].map((g) => ({
        cols: [...g.querySelectorAll('.colhead span')].map((e) => e.textContent.trim()), rows: [...g.querySelectorAll('.rowhead span')].map((e) => e.textContent.trim()), cells: g.querySelectorAll('.cell').length, title: g.querySelector('.gchip')?.textContent.trim() }));
      // do neighbouring headers collide?
      const clash = [...document.querySelectorAll('.mgrid')].some((g) => { const hs = [...g.querySelectorAll('.colhead span')].map((e) => e.getBoundingClientRect()); return hs.some((a, i) => hs.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5)); });
      const f = document.querySelector('.frame').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
      return { z, ls, groups, minCol: Math.min(...sizes('.colhead span')), minRow: Math.min(...sizes('.rowhead span')), minChip: Math.min(...sizes('.gchip')), clash, fits: f.left >= s.left && f.right <= s.right && f.top >= s.top && f.bottom <= s.bottom, cells: document.querySelectorAll('.cell').length, captions: document.querySelectorAll('.cell figcaption').length, firstCaption: document.querySelector('.cell figcaption').textContent };
    })())`));
    t.diagnostic(`fit at ${(info.z * 100).toFixed(0)}%: smallest header text on screen ${info.minCol.toFixed(1)} / ${info.minRow.toFixed(1)} / ${info.minChip.toFixed(1)} px (cols / rows / group chips)`);
    assert.equal(info.cells, 64);
    assert.equal(info.groups.length, 4);
    for (const g of info.groups) { assert.equal(g.cells, 16); assert.deepEqual(g.cols, ['md', 'xs', 'sm', 'lg']); assert.deepEqual(g.rows, ['neutral', 'info', 'ok', 'warn']); }
    assert.deepEqual(info.groups.map((g) => g.title), ['look plain', 'look soft', 'look solid', 'look line']);
    assert.ok(info.fits, 'fit shows the whole matrix');
    assert.ok(info.minCol >= 10 && info.minRow >= 10 && info.minChip >= 10, 'every header is at least 10 px tall on screen at fit');
    assert.equal(info.clash, false, 'no header runs into its neighbour');
    assert.equal(info.captions, 64, 'every cell keeps its caption (shown from about 90% zoom)');
    assert.equal(info.firstCaption, 'size=md · tone=neutral · look=plain');
    // first axis across, second down: the md/neutral cell is top-left of its group, xs is to its right
    const pos = JSON.parse(await browser.eval(`JSON.stringify(['{"size":"md","tone":"neutral","look":"plain"}', '{"size":"xs","tone":"neutral","look":"plain"}', '{"size":"md","tone":"info","look":"plain"}', '{"size":"md","tone":"neutral","look":"soft"}'].map((k) => { const r = [...document.querySelectorAll('.cell')].find((c) => c.dataset.variant === k).getBoundingClientRect(); return [r.left, r.top]; }))`));
    assert.ok(pos[1][0] > pos[0][0] && Math.abs(pos[1][1] - pos[0][1]) < 1, 'size runs across');
    assert.ok(pos[2][1] > pos[0][1] && Math.abs(pos[2][0] - pos[0][0]) < 1, 'tone runs down');
    assert.ok(pos[3][0] > pos[0][0] + 100 || pos[3][1] > pos[0][1] + 100, 'look is a separate group');
    // zoomed in, the captions appear and wrap inside their cells
    await browser.eval(`(() => { const b = napkin.view.stageBox(); napkin.view.zoomAt(b.left + 200, b.top + 200, 1.2); })()`);
    await sleep(100);
    assert.equal(await browser.eval(`getComputedStyle(document.querySelector('.cell figcaption')).visibility`), 'visible');
  } finally { await browser.close(); await server.stop(); }
});

test('evidence screenshots (EVIDENCE_OUT=docs/evidence)', { skip: !process.env.EVIDENCE_OUT, timeout: 120000 }, async () => {
  const out = join(ROOT, process.env.EVIDENCE_OUT);
  mkdirSync(out, { recursive: true });
  const { compDir } = tempRepo(['Card', 'Button', 'Chip']);
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  const shot = async (name) => writeFileSync(join(out, name), await browser.screenshot());
  const theme = (want) => browser.eval(`(() => { const want = ${JSON.stringify(want)}; const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== want) document.querySelector('#theme-toggle').click(); return true; })()`);
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    await sleep(400);
    await theme('light');
    // a real working state: Button size=sm selected, in override mode
    await browser.eval(`napkin.select({ component: napkin.find('Button').component, node: 'root', variant: { size: 'sm', state: 'hover' } })`);
    await browser.waitFor(`document.querySelector('#sel-variant')?.textContent === 'size=sm · state=hover'`);
    await sleep(200);
    await shot('canvas-light.png');
    await theme('dark');
    await sleep(100);
    await shot('canvas-dark.png');
    await theme('light');
    // the variant override scope
    await browser.eval(`document.querySelector('#target-variant').click()`);
    await sleep(150);
    await browser.type('#borderRadius', '14');
    await browser.waitFor(`document.querySelector('#dot-borderRadius')`);
    await sleep(200);
    await shot('canvas-panel-override.png');
    // the Chip matrix at fit
    await browser.eval(`napkin.select(null)`);
    await browser.eval(`(() => { const id = napkin.find('Chip').component; napkin.nav.focus(id, undefined, { animate: false }); })()`);
    await sleep(300);
    await shot('canvas-matrix-4x4x4.png');
    await browser.eval(`napkin.nav.unfocus({ animate: false })`);
    // quick open
    await io.key('k', { ctrl: true });
    await browser.waitFor(`!document.querySelector('#quick').hidden`);
    await browser.send('Input.insertText', { text: 'lab' });
    await sleep(150);
    await shot('canvas-quick-open.png');
    await io.key('Escape');
    // multi-select with Mixed values and the layers tree
    await browser.eval(`napkin.view.fitAll({ animate: false })`);
    await sleep(100);
    const a = await centerOf(browser, node('Card', 'title')), b = await centerOf(browser, node('Card', 'body'));
    await io.click(a.x, a.y); await io.click(b.x, b.y, { shift: true });
    await browser.waitFor(`napkin.state.selections.length === 2`);
    await sleep(150);
    await shot('canvas-multi-select.png');
    // measuring
    await io.key('Escape');
    await io.click(a.x, a.y);
    const img = await centerOf(browser, node('Card', 'image'));
    await io.down('Alt', { alt: true, code: 'AltLeft' });
    await io.move(img.x, img.y, { alt: true });
    await sleep(150);
    await shot('canvas-measure.png');
    await io.up('Alt', { code: 'AltLeft' });
  } finally { await browser.close(); await server.stop(); }
});
