// LAY-09 (wrap, unwrap, duplicate, copy and paste between components), LAY-10 (paste in: images and HTML),
// LAY-07 (inline editing with an IME) and LAY-08 (colour picker, formats, eyedropper), all through the real page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lab, tsx, changedLines } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';
import { centerOf } from './helpers/input.js';

const CARD = readFileSync(new URL('../fixtures/Card/Card.tsx', import.meta.url), 'utf8');
const waitRev = (L, name, r) => L.browser.waitFor(`napkin.find(${JSON.stringify(name)}).revision > ${r} && document.querySelector('section[data-name=${JSON.stringify(name)}]').dataset.revision === String(napkin.find(${JSON.stringify(name)}).revision)`);
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const mkPaste = (L, build) => L.q(`(async () => { const dt = new DataTransfer(); ${build}; const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return true; })()`);

test('LAY-09: duplicate, wrap and unwrap from the keyboard; copy and paste between components renders pixel-identical', { timeout: 150000 }, async (t) => {
  const L = await lab({ Card: CARD }, { theme: 'light' });
  const { io, q } = L;
  try {
    await t.test('Ctrl+D duplicates the selection with fresh ids, one revision', async () => {
      await L.select('Card', 'image');
      const r0 = await L.rev('Card');
      await io.key('d', { ctrl: true });
      await waitRev(L, 'Card', r0);
      assert.equal(await L.rev('Card'), r0 + 1);
      assert.deepEqual((await L.doc('Card')).root.children.map((n) => n.id), ['image', 'image2', 'title', 'body']);
      assert.equal(await q(`napkin.state.selection.node`), 'image2', 'the copy is selected');
      await L.edit('Card', [{ op: 'delete', id: 'image2' }]);
    });
    await t.test('Ctrl+Alt+G wraps in a frame, Ctrl+Shift+G unwraps', async () => {
      await L.select('Card', 'title');
      await q(`napkin.selectMany([{ component: napkin.find('Card').component, node: 'title', variant: {} }, { component: napkin.find('Card').component, node: 'body', variant: {} }])`);
      const r0 = await L.rev('Card');
      await io.key('g', { ctrl: true, alt: true });
      await waitRev(L, 'Card', r0);
      let d = await L.doc('Card');
      assert.deepEqual(d.root.children.map((n) => n.id), ['image', 'frame1']);
      assert.deepEqual(d.root.children[1].children.map((n) => n.id), ['title', 'body']);
      assert.equal(await q(`napkin.state.selection.node`), 'frame1');
      await io.key('g', { ctrl: true, shift: true });
      await waitRev(L, 'Card', r0 + 1);
      d = await L.doc('Card');
      assert.deepEqual(d.root.children.map((n) => n.id), ['image', 'title', 'body']);
    });
    await t.test('copy the Card root, paste into another component: fresh ids, 0 px difference', async () => {
      const res = await q(`fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'you' }) }).then((r) => r.json()).then((j) => j.token)`);
      const post = (path, body) => fetch(new URL(path, L.server.url), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${res}` }, body: JSON.stringify(body) }).then((r) => r.json());
      const made = await post('/api/components', { name: 'Blank' });
      assert.equal(made.ok, true);
      await L.browser.waitFor(`!!napkin.find('Blank')?.doc && document.querySelector('section[data-name=Blank]')?.dataset.ready === '1'`);
      await L.edit('Blank', [{ op: 'set', path: 'root.display', value: 'inline-block' }, { op: 'set', path: 'root.padding', value: null }, { op: 'set', path: 'root.gap', value: null }, { op: 'set', path: 'root.flexDirection', value: null }]);
      // copy: select the Card root and fire a copy event the way the browser does
      await L.select('Card', 'card');
      await q(`window.__dt = new DataTransfer(); document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: window.__dt, bubbles: true, cancelable: true })); window.__dt.types.join()`);
      assert.match(await q(`window.__dt.types.join()`), /application\/x-napkin\+json/);
      await L.select('Blank', 'root');
      const r0 = await L.rev('Blank');
      await q(`document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: window.__dt, bubbles: true, cancelable: true }))`);
      await waitRev(L, 'Blank', r0);
      assert.equal(await L.rev('Blank'), r0 + 1, 'one revision');
      const blank = await L.doc('Blank');
      const ids = []; (function walk(n) { ids.push(n.id); n.children.forEach(walk); })(blank.root);
      assert.deepEqual(ids, ['root', 'card', 'image', 'title', 'body'], 'ids are fresh where they clash, kept where free');
      assert.equal(new Set(ids).size, ids.length);
      const png = async (name) => Buffer.from(await (await fetch(new URL(`/api/components/${name}/render?variant=%7B%7D`, L.server.url))).arrayBuffer());
      const a = await png('Card'), b = await png('Blank');
      assert.ok(a.length > 500, 'rendered something');
      assert.equal(Buffer.compare(a, b), 0, 'the pasted subtree renders pixel-identical (0 px difference)');
    });
  } finally { await L.close(); }
});

test('LAY-10: paste an image (PNG, SVG) into assets/ by hash; HTML that fits becomes nodes, HTML that does not is refused', { timeout: 120000 }, async (t) => {
  const L = await lab({ Card: CARD }, { theme: 'light' });
  const { q } = L;
  try {
    await L.select('Card', 'card');
    await t.test('a PNG from the clipboard becomes an image node and a content-hash file in assets/', async () => {
      const r0 = await L.rev('Card');
      await mkPaste(L, `const b = Uint8Array.from(atob('${PNG_B64}'), (c) => c.charCodeAt(0)); dt.items.add(new File([b], 'shot.png', { type: 'image/png' }))`);
      await waitRev(L, 'Card', r0);
      const d = await L.doc('Card');
      const img = d.root.children.at(-1);
      assert.equal(img.tag, 'img');
      assert.match(img.attrs.src, /^assets\/[0-9a-f]{16}\.png$/);
      assert.ok(existsSync(join(L.compDir, img.attrs.src)));
      assert.equal(readdirSync(join(L.compDir, 'assets')).length, 1);
      await mkPaste(L, `const b = Uint8Array.from(atob('${PNG_B64}'), (c) => c.charCodeAt(0)); dt.items.add(new File([b], 'again.png', { type: 'image/png' }))`);
      await waitRev(L, 'Card', r0 + 1);
      assert.equal(readdirSync(join(L.compDir, 'assets')).length, 1, 'the same picture is stored once');
      await L.browser.waitFor(`document.querySelector('section[data-name=Card] .cell img[src="${img.attrs.src}"]')?.complete`);
    });
    await t.test('SVG text on the clipboard becomes an .svg file', async () => {
      await L.select('Card', 'card');
      const r0 = await L.rev('Card');
      await mkPaste(L, `dt.setData('text/plain', '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')`);
      await waitRev(L, 'Card', r0);
      const img = (await L.doc('Card')).root.children.at(-1);
      assert.match(img.attrs.src, /\.svg$/);
      assert.equal(img.style.width, 24);
    });
    await t.test('an HTML snippet that fits becomes dialect nodes', async () => {
      await L.select('Card', 'card');
      const r0 = await L.rev('Card');
      await mkPaste(L, `dt.setData('text/html', '<div style="display:flex;gap:6px;padding:8px"><span style="font-weight:600">One</span><span>Two</span></div>')`);
      await waitRev(L, 'Card', r0);
      const n = (await L.doc('Card')).root.children.at(-1);
      assert.equal(n.style.display, 'flex'); assert.equal(n.children.length, 2); assert.equal(n.children[0].text, 'One');
    });
    await t.test('an HTML snippet that does not fit is refused with the reason, and nothing is written', async () => {
      const r0 = await L.rev('Card');
      await mkPaste(L, `dt.setData('text/html', '<div class="hero"><script>1</script></div>')`);
      await sleep(400);
      assert.equal(await L.rev('Card'), r0);
      assert.match(await q(`document.querySelector('#hint').textContent`), /Not pasted: .*(class|script)/);
      assert.equal(await q(`napkin.ops.last.ok`), false);
    });
  } finally { await L.close(); }
});

test('LAY-07: inline text editing works with an IME (composition is not committed early)', { timeout: 90000 }, async () => {
  const L = await lab({ Card: CARD }, { theme: 'light' });
  const { q, browser } = L;
  try {
    await L.select('Card', 'body');
    await q(`napkin.tools.editText({ component: napkin.find('Card').component, node: 'body', variant: {} })`);
    await browser.waitFor(`!!document.querySelector('.text-edit')`);
    const r0 = await L.rev('Card');
    await browser.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    await browser.waitFor(`document.querySelector('.text-edit')?.dataset.composing === '1'`);
    // Enter belongs to the IME while a composition is open
    await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'Enter', windowsVirtualKeyCode: 229 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(200);
    assert.equal(await q(`!!document.querySelector('.text-edit')`), true, 'still editing');
    assert.equal(await L.rev('Card'), r0, 'nothing written mid-composition');
    await browser.send('Input.insertText', { text: '日本' }); // the IME commits its choice
    await browser.waitFor(`!document.querySelector('.text-edit').dataset.composing`);
    assert.equal(await q(`document.querySelector('.text-edit').value`), '日本');
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitRev(L, 'Card', r0);
    assert.equal(await L.rev('Card'), r0 + 1, 'one revision');
    assert.equal((await L.doc('Card')).root.children[2].text, '日本');
    assert.match(readFileSync(join(L.compDir, 'Card.tsx'), 'utf8'), /日本/);
  } finally { await L.close(); }
});

const RGB = tsx('Swatch', { id: 'root', tag: 'div', style: { width: 120, height: 60, background: 'rgb(34, 54, 176)', border: '2px solid rgb(22, 24, 29)', color: 'rgb(255, 255, 255)' }, kids: [{ id: 'label', tag: 'span', text: 'Hi', style: {} }] });
test('LAY-08: the colour picker writes the file\'s own colour format; hex, rgb and oklch; the eyedropper where there is one', { timeout: 120000 }, async (t) => {
  const L = await lab({ Swatch: RGB }, { theme: 'light' });
  const { q, browser } = L;
  try {
    await L.select('Swatch', 'root');
    const setField = async (id, v) => { await q(`(() => { const f = document.querySelector('#cpop #${id}'); f.focus(); f.value = ${JSON.stringify(v)}; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`); };
    await t.test('the picker opens from the swatch, starting in rgb because the file uses rgb()', async () => {
      await q(`document.querySelector('#pick-btn-background').click()`);
      await browser.waitFor(`!!document.querySelector('#cpop')`);
      assert.equal(await q(`document.querySelector('#cpop [data-space][aria-checked=true]').dataset.space`), 'rgb');
      assert.ok(await q(`document.querySelectorAll('#cpop .cp-s').length >= 2`), 'the file\'s own colours are offered');
    });
    await t.test('editing a channel keeps rgb()', async () => {
      const r0 = await L.rev('Swatch');
      await setField('cp-r', '200');
      await waitRev(L, 'Swatch', r0);
      assert.equal((await L.doc('Swatch')).root.style.background, 'rgb(200, 54, 176)');
    });
    await t.test('switching tabs writes nothing; the next real edit is written in the tab\'s format; alpha is part of the value', async () => {
      let r0 = await L.rev('Swatch');
      await q(`document.querySelector('#cpop [data-space=oklch]').click()`);
      await sleep(400);
      assert.equal(await L.rev('Swatch'), r0, 'a tab only changes the display');
      assert.match(await q(`document.querySelector('#cp-ol').value`), /^0\.\d+$/);
      await setField('cp-oc', '0.1');
      await waitRev(L, 'Swatch', r0);
      assert.match((await L.doc('Swatch')).root.style.background, /^oklch\(0\.\d+ 0\.1 \d+(\.\d)?\)$/);
      r0 = await L.rev('Swatch');
      await q(`document.querySelector('#cpop [data-space=hex]').click()`);
      await sleep(400);
      assert.equal(await L.rev('Swatch'), r0, 'back to hex: still nothing written');
      await setField('cp-a', '50');
      await waitRev(L, 'Swatch', r0);
      assert.match((await L.doc('Swatch')).root.style.background, /^#[0-9a-f]{6}80$/);
    });
    await t.test('the eyedropper picks a colour when the browser has one, and is disabled otherwise', async () => {
      await q(`document.querySelector('#cpop').remove()`); // close without a commit
      await q(`delete window.EyeDropper; true`);
      await q(`document.querySelector('#pick-btn-background').click()`);
      await browser.waitFor(`!!document.querySelector('#cpop')`);
      assert.equal(await q(`document.querySelector('#cp-eye').disabled`), true, 'no EyeDropper: a disabled button with a reason');
      assert.match(await q(`document.querySelector('#cp-eye').title`), /no eyedropper/);
      await q(`document.querySelector('#cpop').remove(); window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#ff0000' }); } }; true`);
      await q(`document.querySelector('#pick-btn-background').click()`);
      await browser.waitFor(`!!document.querySelector('#cpop') && !document.querySelector('#cp-eye').disabled`);
      const r0 = await L.rev('Swatch');
      await q(`document.querySelector('#cp-eye').click()`);
      await waitRev(L, 'Swatch', r0);
      assert.match((await L.doc('Swatch')).root.style.background, /^(#ff0000|rgb\(255, 0, 0\))/);
    });
    await t.test('a new fill, stroke or shadow follows the file\'s format', async () => {
      await L.edit('Swatch', [{ op: 'set', path: 'root.background', value: null }, { op: 'set', path: 'root.border', value: null }, { op: 'set', path: 'root.color', value: 'rgb(255, 255, 255)' }]);
      await L.select('Swatch', 'root');
      const r0 = await L.rev('Swatch');
      await q(`document.querySelector('#add-fill').click()`);
      await waitRev(L, 'Swatch', r0);
      assert.equal((await L.doc('Swatch')).root.style.background, 'rgb(217, 217, 217)');
      await L.select('Swatch', 'root');
      const r1 = await L.rev('Swatch');
      await q(`document.querySelector('#add-effects').click()`);
      await waitRev(L, 'Swatch', r1);
      assert.equal((await L.doc('Swatch')).root.style.boxShadow, '0px 2px 6px 0px rgba(0, 0, 0, 0.25)', 'alpha has two decimals, no rounding noise');
    });
  } finally { await L.close(); }
});

test('LAY-01 and LAY-03 controls: wrap, space-between and grid tracks are one line each', { timeout: 120000 }, async () => {
  const L = await lab({
    Row: tsx('Row', { id: 'stage', tag: 'div', style: { display: 'flex', gap: 8, padding: 8, width: 300 }, kids: [{ id: 'a', tag: 'div', style: { width: 80, height: 30, background: '#e8b04b' } }, { id: 'b', tag: 'div', style: { width: 80, height: 30, background: '#2236b0' } }] }),
    Grid: tsx('Grid', { id: 'stage', tag: 'div', style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, width: 300 }, kids: [{ id: 'a', tag: 'div', style: { height: 30, background: '#e8b04b' } }] }),
  }, { theme: 'light' });
  const { q, browser } = L;
  const text = (n) => readFileSync(join(L.compDir, `${n}.tsx`), 'utf8');
  try {
    await L.select('Row', 'stage');
    let before = text('Row'), r0 = await L.rev('Row');
    await q(`document.querySelector('#wrap-toggle').click()`);
    await waitRev(L, 'Row', r0);
    assert.equal((await L.doc('Row')).root.style.flexWrap, 'wrap');
    assert.deepEqual(changedLines(before, text('Row')), { added: 1, removed: 0 });
    await L.select('Row', 'stage');
    before = text('Row'); r0 = await L.rev('Row');
    await q(`document.querySelector('#gap-auto').click()`);
    await waitRev(L, 'Row', r0);
    assert.equal((await L.doc('Row')).root.style.justifyContent, 'space-between');
    assert.deepEqual(changedLines(before, text('Row')), { added: 1, removed: 0 });
    await browser.waitFor(`document.querySelector('#gap-auto').getAttribute('aria-pressed') === 'true'`);
    const [x1, x2] = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('section[data-name=Row] .cell [data-n=a], section[data-name=Row] .cell [data-n=b]')].map((e) => e.getBoundingClientRect().left))`));
    assert.ok(x2 - x1 > 200 * (await q(`napkin.state.zoom`)) * 0.9, 'space-between pushed the two apart');
    await L.select('Grid', 'stage');
    before = text('Grid'); r0 = await L.rev('Grid');
    await q(`document.querySelector('#cols-add').click()`);
    await waitRev(L, 'Grid', r0);
    assert.equal((await L.doc('Grid')).root.style.gridTemplateColumns, '1fr 1fr 1fr 1fr');
    assert.deepEqual(changedLines(before, text('Grid')), { added: 1, removed: 1 });
  } finally { await L.close(); }
});

test('LAY-08: a colour-only edit keeps the alpha the file had, exactly', { timeout: 90000 }, async () => {
  const L = await lab({ Alpha: tsx('Alpha', { id: 'root', tag: 'div', style: { width: 100, height: 40, background: 'rgb(10 20 30 / 0.333)', border: '2px solid #12345677' } }) }, { theme: 'light' });
  const { browser } = L;
  try {
    await L.select('Alpha', 'root');
    let r0 = await L.rev('Alpha');
    await browser.type('#background', 'rgb(11 20 30)');
    await waitRev(L, 'Alpha', r0);
    assert.equal((await L.doc('Alpha')).root.style.background, 'rgb(11 20 30 / 0.333)');
    await L.select('Alpha', 'root');
    r0 = await L.rev('Alpha');
    await browser.type('#stroke-color', '#223456');
    await waitRev(L, 'Alpha', r0);
    assert.equal((await L.doc('Alpha')).root.style.border, '2px solid #22345677');
    await L.select('Alpha', 'root');
    r0 = await L.rev('Alpha');
    await browser.type('#fill-a', '50'); // an alpha the person changed is written with two decimals
    await waitRev(L, 'Alpha', r0);
    assert.equal((await L.doc('Alpha')).root.style.background, 'rgb(11 20 30 / 0.5)');
  } finally { await L.close(); }
});
