// Basics: right-click menus (docs/basics/standards.md section 8). What a person sees and does with real right-clicks and keys:
// the item sets per target, keys equal to the registry's, dimmed items with their reason, items that do the thing, the keyboard,
// flipping at the window's edges, closing, the browser's own menu kept in text fields, and axe on the open menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const LANDING = 'landing.html';

function folder() {
  const r = tempRepo(['Card']);
  writeFileSync(join(r.compDir, LANDING), `<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><main class="hero"><h1>Plan the week</h1><p>One page, one list.</p><button class="cta">Start</button></main><section class="cards"><article class="card"><h2>Monday</h2><p>Design review</p></article><article class="card"><h2>Tuesday</h2><p>Ship the shell</p></article></section></body></html>\n`);
  writeFileSync(join(r.compDir, 'theme.css'), `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; } .hero { padding: 32px; } .cards { display: flex; gap: 16px; padding: 0 32px 32px; } .card { padding: 16px; border: 1px solid #d9d2c3; border-radius: 8px; }\n`);
  return r;
}
async function boot(size = [1440, 900]) {
  const r = folder();
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: size[0], height: size[1] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!napkin.stage.sections.get(${JSON.stringify(LANDING)})?.docFrame?.tree()`, 20000);
  await b.eval(`napkin.view.fitAll({ animate: false })`);
  await sleep(600);
  const html = () => readFileSync(join(r.compDir, LANDING), 'utf8');
  const io = Object.assign(input(b), { b });
  return { b, io, r, html, close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
}
const j = async (b, expr) => JSON.parse(await b.eval(`Promise.resolve(${expr}).then((v) => JSON.stringify(v ?? null))`));
// The open menu as a person reads it: labels in order, rules as '---', the key at the right, dimmed items with their reason.
const MENU = `(() => { const m = document.querySelector('#ctxmenu'); if (m.hidden) return null; return { label: m.getAttribute('aria-label'), rows: [...m.children].map((e) => e.getAttribute('role') === 'separator' ? '---' : (e.querySelector('.nk-ml').textContent + (e.dataset.sub ? ' >' : ''))), items: [...m.querySelectorAll('[role=menuitem]')].map((e) => ({ id: e.dataset.action || null, label: e.querySelector('.nk-ml').textContent, key: e.querySelector('.nk-mk')?.textContent ?? '', off: e.getAttribute('aria-disabled') === 'true', why: e.title, opacity: getComputedStyle(e).opacity })) }; })()`;
const menu = (b) => j(b, MENU);
const labels = async (b) => (await menu(b))?.rows;
async function rclick(io, p) { if (await isOpen(io.b)) await io.key('Escape'); // (a menu still open from before: closed first, so the point is not on it)
  await io.move(p.x, p.y); await io.press(p.x, p.y, { button: 'right' }); await io.release(p.x, p.y, { button: 'right' }); await sleep(250); }
const centre = (b, expr) => j(b, `(() => { const r = (${expr}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const el = (node) => `napkin.stage.cellElement(${JSON.stringify(LANDING)}, ${JSON.stringify(node)}, {})`;
const node = (b, sel) => b.eval(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame, d = f.doc(); const e = d.querySelector(${JSON.stringify(sel)}); return f.nodeOf(e); })()`);
const emptyCanvas = (b) => j(b, `(() => { const s = document.querySelector('#stage').getBoundingClientRect(); for (let y = s.top + 48; y < s.bottom - 48; y += 12) for (let x = s.left + 48; x < s.right - 48; x += 12) { const e = document.elementFromPoint(x, y); if (e && e.closest('#stage') && !e.closest('.cmp, .item-card, #ctxmenu, button, [data-nodrag], .proposal, .sel-box, #presence')) return { x, y }; } return null; })()`);
const selection = (b) => j(b, `napkin.state.selections.map((s) => s.component + '|' + s.node + (s.card ? ' card' : ''))`);
// Each key at the right is the registry's: a command's binding in force (as the key map lists it), or the action's own spec, spelled by keylabel.js.
async function keysMatchRegistry(b) {
  const pairs = await j(b, `(async () => { const [{ ACTIONS }, { keyLabel }] = await Promise.all([import('/canvas/actions.js'), import('/canvas/keylabel.js')]); const bound = napkin.surface.bindings(); return [...document.querySelectorAll('#ctxmenu [data-action], #ctxmenu-sub [data-action]')].map((e) => { const a = ACTIONS.find((x) => x.id === e.dataset.action); const k = a.command ? bound.find((x) => x.command === a.id)?.keys : a.spec; return [a.id, e.querySelector('.nk-mk')?.textContent ?? '', k ? keyLabel(k) : '']; }); })()`);
  for (const [id, shown, want] of pairs) assert.equal(shown, want, `${id}: the key shown is the registry's`);
  return pairs;
}
const isOpen = (b) => b.eval(`!document.querySelector('#ctxmenu').hidden`);

test('menus: each target has its own item set, in the group order, with the registry keys and dimmed items that say why', { timeout: 180000 }, async (t) => {
  const { b, io, close } = await boot();
  try {
    // empty canvas: the selection clears; paste, create, view
    await b.eval(`napkin.select({ component: napkin.find('Card').component, node: 'title', variant: {} })`);
    const empty = await emptyCanvas(b);
    assert.ok(empty, 'an empty spot on the canvas');
    await rclick(io, empty);
    let m = await menu(b);
    assert.equal(m.label, 'Canvas');
    assert.deepEqual(m.rows, ['Paste here', '---', 'Add frame', 'Add text', 'Add image', '---', 'Select all', 'Zoom to fit', 'Zoom to 100%', 'Hide layers']);
    assert.deepEqual(await selection(b), [], 'a right-click on the empty canvas clears the selection, as a click does');
    await keysMatchRegistry(b);
    assert.deepEqual(m.items.map((x) => x.key), ['Ctrl V', 'F', 'T', 'I', 'G A', 'Shift 1', 'Shift 0', 'Ctrl \\'], 'Linux spells Ctrl, not the Command sign');
    const paste = m.items[0];
    assert.ok(paste.off && paste.why && paste.opacity === '0.4', `Paste here is dimmed with its reason: ${JSON.stringify(paste)}`);
    const box = await j(b, `(() => { const r = document.querySelector('#ctxmenu').getBoundingClientRect(); return { l: r.left, t: r.top }; })()`);
    assert.ok(box.l > empty.x && box.l - empty.x <= 4 && box.t > empty.y && box.t - empty.y <= 4, `opens at the pointer (${JSON.stringify(box)} vs ${JSON.stringify(empty)})`);
    t.diagnostic(`canvas: ${m.rows.join(' | ')}`);

    // a frame (an HTML file's card, by its title): file-level items; what HTML cannot do yet is dimmed with the reason
    await rclick(io, await centre(b, `document.querySelector('section.cmp[data-component="${LANDING}"] .cmp-head')`));
    m = await menu(b);
    assert.deepEqual(m.rows, ['Paste here', 'Rename…', '---', 'Add frame', 'Add text', 'Add image', '---', 'Zoom to selection', 'Show code', '---', 'Delete file…']);
    assert.match((await selection(b))[0], /^landing\.html\|.* card$/, 'the frame is selected first');
    const rename = m.items.find((x) => x.label === 'Rename…');
    assert.ok(rename.off && /HTML/.test(rename.why), 'renaming an HTML file: dimmed, with the reason');
    await keysMatchRegistry(b);
    t.diagnostic(`frame: ${m.rows.join(' | ')}`);

    // an element inside a frame (the frame is an iframe that takes no pointer events: the right-click reaches the canvas)
    const h1 = await node(b, 'h1');
    await rclick(io, await centre(b, el(h1)));
    m = await menu(b);
    assert.deepEqual(await selection(b), [`${LANDING}|${h1}`], 'the element under the pointer is selected, the others cleared');
    assert.deepEqual(m.rows, ['Cut', 'Copy', 'Paste here', 'Duplicate', '---', 'Select parent', 'Select children', 'Order >', 'Wrap in frame', '---', 'Create component', '---', 'Zoom to selection', 'Show code', '---', 'Delete']);
    const by = Object.fromEntries(m.items.map((x) => [x.label, x]));
    assert.equal(by['Create component'].why, 'Coming in the next pass');
    assert.ok(by['Select children'].off && /Nothing inside/.test(by['Select children'].why), 'a heading has no elements inside');
    assert.ok(by['Wrap in frame'].off, 'wrapping HTML is not there yet: dimmed');
    assert.deepEqual([by.Cut.key, by.Copy.key, by.Duplicate.key, by['Select parent'].key, by.Delete.key], ['Ctrl X', 'Ctrl C', 'Ctrl D', 'Shift Enter', 'Delete']);
    await keysMatchRegistry(b);
    t.diagnostic(`element: ${m.rows.join(' | ')}`);

    // an element of a TSX component: the dialect names its layers, so Rename is there
    await rclick(io, await centre(b, `napkin.stage.cellElement(napkin.find('Card').component, 'title', napkin.state.selection?.variant)`));
    m = await menu(b);
    assert.match((await selection(b))[0], /\|title$/);
    assert.deepEqual(m.rows.slice(0, 5), ['Cut', 'Copy', 'Paste here', 'Duplicate', 'Rename']);
    assert.equal(m.items.find((x) => x.label === 'Rename').key, 'F2');

    // several selected: right-clicking one of them keeps them all
    const [a1, a2] = await j(b, `[...napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.doc().querySelectorAll('article')].map((e) => napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.nodeOf(e))`);
    await b.eval(`napkin.selectMany([${JSON.stringify(a1)}, ${JSON.stringify(a2)}].map((node) => ({ component: ${JSON.stringify(LANDING)}, node, variant: {} })))`);
    await io.key('Escape'); // (the menu from before)
    await b.eval(`napkin.selectMany([${JSON.stringify(a1)}, ${JSON.stringify(a2)}].map((node) => ({ component: ${JSON.stringify(LANDING)}, node, variant: {} })))`);
    await rclick(io, await centre(b, el(a2)));
    m = await menu(b);
    assert.equal(m.label, '2 selected');
    assert.equal((await selection(b)).length, 2, 'a selected item keeps the whole selection');
    assert.deepEqual(m.rows, ['Cut', 'Copy', 'Duplicate', '---', 'Select parent', 'Wrap in frame', '---', 'Create component', '---', 'Zoom to selection', '---', 'Delete']);
    t.diagnostic(`several: ${m.rows.join(' | ')}`);

    // a layer row: its item's menu plus Expand / Collapse; an unselected row is selected first
    await io.key('Escape');
    const sec = a1.split('.').slice(0, -1).join('.'); // the cards' section: a row with children, not selected
    const rowSel = `#layers .lrow[data-component="${LANDING}"][data-node="${sec}"]`;
    await b.eval(`napkin.select(null); napkin.layers.expand(${JSON.stringify(LANDING)})`);
    await sleep(300);
    await b.waitFor(`!!document.querySelector(${JSON.stringify(rowSel)})`);
    await b.eval(`document.querySelector(${JSON.stringify(rowSel)}).scrollIntoView({ block: 'center' })`);
    await rclick(io, await centre(b, `document.querySelector(${JSON.stringify(rowSel)})`));
    m = await menu(b);
    assert.deepEqual(await selection(b), [`${LANDING}|${sec}`]);
    assert.ok(m.rows.includes('Collapse') || m.rows.includes('Expand'), `a row with children can open or close: ${m.rows.join(' | ')}`);
    assert.equal(m.rows.at(-1), 'Delete');
    t.diagnostic(`layer row: ${m.rows.join(' | ')}`);
    // the file's own row: the frame's menu
    await io.key('Escape');
    await b.eval(`document.querySelector('#layers .lcomp[data-component="${LANDING}"]').scrollIntoView({ block: 'center' })`);
    await rclick(io, await centre(b, `document.querySelector('#layers .lcomp[data-component="${LANDING}"]')`));
    m = await menu(b);
    assert.deepEqual(m.rows.slice(0, 2), ['Paste here', 'Rename…']);
    assert.ok(m.rows.includes('Collapse'), 'the file row collapses');
    await io.key('Escape');
  } finally { await close(); }
});

test('menus: the items do the thing (duplicate, delete, copy and paste here, order, select parent, layer collapse)', { timeout: 180000 }, async () => {
  const { b, io, html, close } = await boot();
  const pick = async (label, from = '#ctxmenu') => { const p = await centre(b, `[...document.querySelectorAll('${from} [role=menuitem]')].find((e) => e.querySelector('.nk-ml').textContent === ${JSON.stringify(label)})`); await io.click(p.x, p.y); };
  const reloaded = async (before) => { await b.waitFor(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.tree()?.revision !== ${JSON.stringify(before)}`, 10000); await sleep(300); };
  const rev = () => b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.tree().revision`);
  try {
    // Duplicate: a second Monday card right after the first, and it is the selection
    let r0 = await rev();
    await rclick(io, await centre(b, el(await node(b, 'article'))));
    await pick('Duplicate');
    await reloaded(r0);
    assert.equal(html().match(/<article class="card"><h2>Monday<\/h2>/g)?.length, 2, 'the copy is in the file');
    assert.equal(await b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.node(napkin.state.selection.node)?.tag`), 'article', 'the copy is selected');
    // Delete: it goes again
    r0 = await rev();
    await rclick(io, await centre(b, el(await b.eval('napkin.state.selection.node'))));
    await pick('Delete');
    await reloaded(r0);
    assert.equal(html().match(/<h2>Monday<\/h2>/g)?.length, 1, 'deleted from the file');
    assert.deepEqual(await selection(b), []);
    // Copy, then Paste here on another element: it lands inside the element under the pointer
    await rclick(io, await centre(b, el(await node(b, 'button.cta'))));
    await pick('Copy');
    await sleep(300);
    r0 = await rev();
    const tuesday = await b.eval(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame; return f.nodeOf(f.doc().querySelectorAll('article')[1]); })()`);
    await rclick(io, await centre(b, el(tuesday)));
    await pick('Paste here');
    await reloaded(r0);
    assert.match(html(), /<p>Ship the shell<\/p>\s*<button class="cta">Start<\/button><\/article>/, 'pasted into the card under the pointer, as its last child');
    // Order (the submenu): hover opens it after 150 ms; Bring to front makes the heading the last of its siblings
    r0 = await rev();
    await rclick(io, await centre(b, el(await node(b, 'h1'))));
    const order = await centre(b, `document.querySelector('#ctxmenu [data-sub]')`);
    await io.move(order.x, order.y);
    await sleep(60);
    assert.equal(await b.eval(`document.querySelector('#ctxmenu-sub').hidden`), true, 'not before 150 ms');
    await b.waitFor(`!document.querySelector('#ctxmenu-sub').hidden`, 1000);
    assert.deepEqual((await j(b, `[...document.querySelectorAll('#ctxmenu-sub [role=menuitem]')].map((e) => e.querySelector('.nk-ml').textContent + ' ' + (e.querySelector('.nk-mk')?.textContent ?? ''))`)), ['Bring forward Ctrl ]', 'Send backward Ctrl [', 'Bring to front Ctrl Alt ]', 'Send to back Ctrl Alt [']);
    assert.equal(await b.eval(`document.querySelector('#ctxmenu-sub [data-action="send-backward"]').getAttribute('aria-disabled')`), 'true', 'already first: Send backward is dimmed');
    const sub = await centre(b, `document.querySelector('#ctxmenu-sub [data-action="bring-to-front"]')`);
    await io.move(order.x + 40, order.y); await io.move(sub.x, sub.y);
    await io.click(sub.x, sub.y);
    await reloaded(r0);
    assert.match(html(), /<main class="hero"><p>One page, one list.<\/p><button class="cta">Start<\/button><h1>Plan the week<\/h1><\/main>/);
    // and its key works the same: Ctrl+[ sends it back one place
    r0 = await rev();
    await b.eval(`document.activeElement.blur()`);
    await io.key('[', { ctrl: true, code: 'BracketLeft' });
    await reloaded(r0);
    assert.match(html(), /<main class="hero"><p>One page, one list.<\/p><h1>Plan the week<\/h1><button class="cta">Start<\/button><\/main>/, 'Ctrl+[ is the same command');
    // Select parent: from the heading to the main
    await rclick(io, await centre(b, el(await node(b, 'h1'))));
    await pick('Select parent');
    assert.equal(await b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.node(napkin.state.selection.node).tag`), 'main');
    // Select children, then back up with Shift+Enter (the same registry command)
    const pad = await j(b, `(() => { const r = ${el('X')}.getBoundingClientRect(); return { x: Math.round(r.left + 6), y: Math.round(r.top + 6) }; })()`.replace('"X"', 'napkin.state.selection.node'));
    await rclick(io, pad); // (on the main's padding, not on one of its children)
    await pick('Select children');
    assert.equal((await selection(b)).length, 3, 'the heading, the paragraph and the button');
    await io.key('Enter', { shift: true });
    assert.equal(await b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.node(napkin.state.selection.node).tag`), 'main', 'Shift+Enter selects the parent');
    // a layer row's Expand opens it, and Collapse closes it again
    const rowSel = `#layers .lrow[data-component="${LANDING}"][data-node="${await b.eval('napkin.state.selection.node')}"]`;
    await b.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.getAttribute('aria-expanded') === 'false'`);
    await rclick(io, await centre(b, `document.querySelector(${JSON.stringify(rowSel)})`));
    await pick('Expand');
    await b.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.getAttribute('aria-expanded') === 'true'`);
    await rclick(io, await centre(b, `document.querySelector(${JSON.stringify(rowSel)})`));
    await pick('Collapse');
    await b.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.getAttribute('aria-expanded') === 'false'`);
    // Add frame arms the frame tool; Hide layers hides the panel
    const empty = await emptyCanvas(b);
    await rclick(io, empty); await pick('Add frame');
    assert.equal(await b.eval('document.body.dataset.tool'), 'frame');
    await io.key('Escape');
    await rclick(io, await emptyCanvas(b)); await pick('Hide layers');
    assert.equal(await b.eval('document.body.dataset.left'), 'closed');
    await rclick(io, await emptyCanvas(b));
    assert.equal((await labels(b)).at(-1), 'Show layers');
    await pick('Show layers');
  } finally { await close(); }
});

test('menus: the keyboard opens, moves, jumps, runs and closes; focus goes back where it was', { timeout: 180000 }, async () => {
  const { b, io, close } = await boot();
  const focused = () => b.eval(`(() => { const e = document.activeElement; return e?.closest('[role=menuitem]') ? e.querySelector('.nk-ml').textContent : e === document.body ? 'body' : (e.id || e.className || e.tagName); })()`);
  try {
    // from a layer row: Shift+F10 opens at the row with the first live item focused
    const card = await b.eval(`napkin.find('Card').component`);
    const rowSel = `#layers .lrow[data-component="${card}"][data-node="title"]`;
    await b.eval(`napkin.layers.expand(${JSON.stringify(card)}); napkin.select({ component: ${JSON.stringify(card)}, node: 'title', variant: {} })`);
    await b.waitFor(`!!document.querySelector(${JSON.stringify(rowSel)})`);
    await b.eval(`document.querySelector(${JSON.stringify(rowSel)}).focus()`);
    await io.key('F10', { shift: true });
    assert.ok(await isOpen(b));
    assert.equal(await focused(), 'Cut');
    const row = await j(b, `document.querySelector(${JSON.stringify(rowSel)}).getBoundingClientRect()`), mb = await j(b, `document.querySelector('#ctxmenu').getBoundingClientRect()`);
    assert.ok(mb.top >= row.top && mb.top <= row.bottom + 4, 'opens at the row');
    const order = (await labels(b)).filter((x) => x !== '---');
    await io.key('ArrowUp');
    assert.equal(await focused(), order.at(-1).replace(' >', ''), 'Up from the first wraps to the last');
    await io.key('ArrowDown');
    assert.equal(await focused(), 'Cut', 'Down from the last wraps to the first');
    await io.key('End'); assert.equal(await focused(), 'Delete');
    await io.key('Home'); assert.equal(await focused(), 'Cut');
    await io.key('d'); assert.equal(await focused(), 'Duplicate', 'a letter jumps to the next item that starts with it');
    await io.key('d'); assert.equal(await focused(), 'Delete', 'and again to the one after');
    // the submenu: Right opens it on its first item, Left closes it back to Order
    await io.key('o'); assert.equal(await focused(), 'Order');
    await io.key('ArrowRight');
    assert.equal(await focused(), 'Bring forward');
    await io.key('ArrowLeft');
    assert.equal(await focused(), 'Order');
    assert.equal(await b.eval(`document.querySelector('#ctxmenu-sub').hidden`), true);
    // Escape closes one level, and the focus is the row again
    await io.key('ArrowRight'); await io.key('Escape');
    assert.equal(await focused(), 'Order', 'Escape in the submenu closes only the submenu');
    await io.key('Escape');
    assert.equal(await isOpen(b), false);
    assert.equal(await b.eval(`document.activeElement === document.querySelector(${JSON.stringify(rowSel)})`), true, 'focus is back on the row');
    // the Menu key does the same; Enter runs (Rename puts the name field in the row)
    await io.key('ContextMenu', { code: 'ContextMenu' });
    assert.ok(await isOpen(b));
    await io.key('r'); assert.equal(await focused(), 'Rename');
    await io.key('Enter');
    await b.waitFor(`document.activeElement?.classList.contains('lrename')`);
    await io.key('Escape');
    // from the canvas: nothing selected opens in the middle of the canvas; Space runs an item
    await b.eval(`napkin.select(null); document.activeElement.blur()`);
    await io.key('F10', { shift: true });
    assert.equal((await menu(b)).label, 'Canvas');
    const st = await j(b, `document.querySelector('#stage').getBoundingClientRect()`), cm = await j(b, `document.querySelector('#ctxmenu').getBoundingClientRect()`);
    assert.ok(Math.abs(cm.left - (st.left + st.width / 2)) <= 4, 'the middle of the canvas');
    await io.key('z'); assert.equal(await focused(), 'Zoom to fit');
    await io.key(' ');
    assert.equal(await isOpen(b), false);
    assert.equal(await focused(), 'body', 'focus back where it was (the canvas)');
    // with a selection: at its top-left
    const h2 = await node(b, 'article h2');
    await b.eval(`napkin.select({ component: ${JSON.stringify(LANDING)}, node: ${JSON.stringify(h2)}, variant: {} })`);
    await io.key('F10', { shift: true });
    const er = await j(b, `${el(h2)}.getBoundingClientRect()`), m2 = await j(b, `document.querySelector('#ctxmenu').getBoundingClientRect()`);
    assert.ok(Math.abs(m2.left - er.left) <= 4 && Math.abs(m2.top - er.top) <= 4, `at the selection's top-left (${m2.left},${m2.top} vs ${er.left},${er.top})`);
    await io.key('Escape');
  } finally { await close(); }
});

test('menus: flip at the window edges without the pointer on an item; close on outside press, wheel, Escape; text fields keep the browser menu; axe light and dark', { timeout: 180000 }, async (t) => {
  const { b, io, close } = await boot();
  try {
    // the right panel out of the way, so the canvas reaches the window's right edge
    await b.eval(`document.body.style.setProperty('--nk-right-w', '0px')`);
    await sleep(200);
    const W = 1440, H = 900;
    for (const [name, at] of [['right', { x: W - 60, y: 300 }], ['bottom', { x: 600, y: H - 60 }], ['corner', { x: W - 60, y: H - 60 }]]) {
      const p = await j(b, `(() => { for (let d = 0; d < 400; d += 8) for (const [x, y] of [[${at.x} - d, ${at.y}], [${at.x}, ${at.y} - d]]) { const e = document.elementFromPoint(x, y); if (e?.closest('#stage') && !e.closest('button, [data-nodrag], #ctxmenu')) return { x, y }; } return null; })()`);
      assert.ok(p, `a canvas point near the ${name} edge`);
      await rclick(io, p);
      const m = await j(b, `(() => { const r = document.querySelector('#ctxmenu').getBoundingClientRect(); const e = document.elementFromPoint(${p.x}, ${p.y}); return { l: r.left, r: r.right, t: r.top, b: r.bottom, flip: document.querySelector('#ctxmenu').dataset.flip, under: !!e?.closest('#ctxmenu') }; })()`);
      t.diagnostic(`${name}: pointer ${p.x},${p.y} menu ${JSON.stringify(m)}`);
      assert.ok(m.l >= 0 && m.r <= W && m.t >= 0 && m.b <= H, `inside the window (${name})`);
      assert.equal(m.under, false, `the pointer is not on the menu after the flip (${name})`);
      if (name !== 'bottom') assert.ok(m.r <= p.x, 'flipped to the left of the pointer');
      if (name !== 'right') assert.ok(m.b <= p.y, 'flipped above the pointer');
      await io.key('Escape');
      assert.equal(await isOpen(b), false, 'Escape closes');
    }
    await b.eval(`document.body.style.removeProperty('--nk-right-w')`);
    // a press outside closes it; so does the wheel
    const empty = await emptyCanvas(b);
    await rclick(io, empty);
    assert.ok(await isOpen(b));
    await io.click(empty.x + 300 > 1000 ? empty.x - 200 : empty.x + 300, empty.y);
    assert.equal(await isOpen(b), false, 'a press outside closes it');
    await rclick(io, await emptyCanvas(b));
    assert.ok(await isOpen(b));
    await io.wheel(empty.x, empty.y, 0, 120);
    await sleep(100);
    assert.equal(await isOpen(b), false, 'the wheel closes it');
    // a text field keeps the browser's own menu (napkin does not prevent it, and opens nothing)
    await b.eval(`window.__native = null; addEventListener('contextmenu', (e) => { window.__native = !e.defaultPrevented; }, { once: true })`);
    const card = await b.eval(`napkin.find('Card').component`);
    await b.eval(`napkin.layers.expand(${JSON.stringify(card)}); napkin.select({ component: ${JSON.stringify(card)}, node: 'title', variant: {} })`);
    await b.waitFor(`!!document.querySelector('#layers .lrow[data-node="title"]')`);
    await b.eval(`napkin.layers.rename()`);
    await b.waitFor(`!!document.querySelector('.lrename')`);
    await rclick(io, await centre(b, `document.querySelector('.lrename')`));
    assert.equal(await b.eval('window.__native'), true, 'the field keeps the browser menu');
    assert.equal(await isOpen(b), false);
    await b.eval(`document.querySelector('.lrename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    // axe on the open menu (and its submenu), light and dark
    for (const th of ['light', 'dark']) {
      await b.eval(`(() => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== ${JSON.stringify(th)}) document.querySelector('#theme-toggle').click(); })()`);
      await rclick(io, await centre(b, el(await node(b, 'h1'))));
      await b.eval(`document.querySelector('#ctxmenu [data-sub]').focus()`);
      await io.key('ArrowRight');
      await sleep(250);
      await b.eval(AXE);
      const v = await j(b, `axe.run({ include: [['#ctxmenu'], ['#ctxmenu-sub']] }, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })))`);
      t.diagnostic(`${th}: ${v.length} axe violations on the open menu`);
      assert.deepEqual(v, [], th);
      await io.key('Escape'); await io.key('Escape');
    }
  } finally { await close(); }
});
