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
// o.ctrl: Ctrl+right-click, which picks the deepest element as Ctrl+click does (a plain one picks what a click there would)
async function rclick(io, p, o = {}) { if (await isOpen(io.b)) await io.key('Escape'); // (a menu still open from before: closed first, so the point is not on it)
  await io.move(p.x, p.y, o); await io.press(p.x, p.y, { ...o, button: 'right' }); await io.release(p.x, p.y, { ...o, button: 'right' }); await sleep(250); }
const centre = (b, expr) => j(b, `(() => { const r = (${expr}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const el = (node) => `napkin.stage.cellElement(${JSON.stringify(LANDING)}, ${JSON.stringify(node)}, {})`;
const node = (b, sel) => b.eval(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame, d = f.doc(); const e = d.querySelector(${JSON.stringify(sel)}); return f.nodeOf(e); })()`);
const emptyCanvas = (b) => j(b, `(() => { const s = document.querySelector('#stage').getBoundingClientRect(); for (let y = s.top + 48; y < s.bottom - 48; y += 12) for (let x = s.left + 48; x < s.right - 48; x += 12) { const e = document.elementFromPoint(x, y); if (e && e.closest('#stage') && !e.closest('.cmp, .item-card, #ctxmenu, button, [data-nodrag], .proposal, .sel-box, #presence')) return { x, y }; } return null; })()`);
const selection = (b) => j(b, `napkin.state.selections.map((s) => s.component + '|' + s.node + (s.card ? ' card' : ''))`);
// The key map as a person reads it (the ? sheet, opened and read from its DOM): each command's keys and each other key's line.
async function readSheet(b) {
  await b.eval(`napkin.shortcuts.open()`);
  const rows = await j(b, `Object.fromEntries([...document.querySelectorAll('#shortcuts .shortcut[data-command]')].map((e) => [e.dataset.command, e.querySelector('.km-keys').textContent]).concat([...document.querySelectorAll('#shortcuts .shortcut[data-action]')].map((e) => [e.dataset.action, e.querySelector('dd').textContent])))`);
  await b.eval(`napkin.shortcuts.close()`);
  assert.ok(Object.keys(rows).length > 20, 'the key map lists the keys');
  return rows;
}
// A key-map line in the menu's spelling: the first of its alternatives ("Delete / Backspace"), Ctrl/Cmd as Ctrl (Linux).
const spelled = (line) => line.replace(/Ctrl\/Cmd/g, 'Ctrl').split(/ \/ | or | · /)[0].replace(/ on .*$/, '').replace(/\s*\+\s*/g, ' ').trim();
// Each key at the right of the open menu (and its submenu) is the one the key map shows for the same command.
async function keysMatchSheet(b, sheet) {
  const pairs = await j(b, `[...document.querySelectorAll('#ctxmenu [data-action], #ctxmenu-sub [data-action]')].map((e) => [e.dataset.action, e.querySelector('.nk-mk')?.textContent ?? ''])`);
  for (const [id, shown] of pairs) {
    if (!shown) continue;
    assert.ok(sheet[id] !== undefined, `${id}: shows ${shown} and the key map lists it`);
    assert.equal(shown, spelled(sheet[id]), `${id}: the menu's key is the key map's (${sheet[id]})`);
  }
  return pairs;
}
const isOpen = (b) => b.eval(`!document.querySelector('#ctxmenu').hidden`);

test('menus: each target has its own item set, in the group order, with the registry keys and dimmed items that say why', { timeout: 180000 }, async (t) => {
  const { b, io, close } = await boot();
  try {
    const sheet = await readSheet(b);
    // empty canvas: the selection clears; paste, create, view
    await b.eval(`napkin.select({ component: napkin.find('Card').component, node: 'title', variant: {} })`);
    const empty = await emptyCanvas(b);
    assert.ok(empty, 'an empty spot on the canvas');
    await rclick(io, empty);
    let m = await menu(b);
    assert.equal(m.label, 'Canvas');
    assert.deepEqual(m.rows, ['Paste here', '---', 'Add frame', 'Add text', 'Add image', '---', 'Select all', 'Zoom to fit', 'Zoom to 100%', 'Hide layers']);
    assert.deepEqual(await selection(b), [], 'a right-click on the empty canvas clears the selection, as a click does');
    await keysMatchSheet(b, sheet);
    assert.deepEqual(m.items.map((x) => x.key), ['Ctrl V', 'F', 'T', 'I', 'Ctrl A', 'Shift 1', 'Shift 0', 'Ctrl \\'], 'Linux spells Ctrl, not the Command sign');
    const paste = m.items[0];
    assert.ok(paste.off && paste.why && paste.opacity === '0.4', `Paste here is dimmed with its reason: ${JSON.stringify(paste)}`);
    const box = await j(b, `(() => { const r = document.querySelector('#ctxmenu').getBoundingClientRect(); return { l: r.left, t: r.top }; })()`);
    assert.ok(box.l > empty.x && box.l - empty.x <= 4 && box.t > empty.y && box.t - empty.y <= 4, `opens at the pointer (${JSON.stringify(box)} vs ${JSON.stringify(empty)})`);
    t.diagnostic(`canvas: ${m.rows.join(' | ')}`);

    // a frame (an HTML file's card, by its title): the file's items (standards section 8), all of which work for an HTML file
    await rclick(io, await centre(b, `document.querySelector('section.cmp[data-component="${LANDING}"] .cmp-head')`));
    m = await menu(b);
    const FRAME = ['Copy', 'Paste inside', 'Duplicate', 'Rename', '---', 'Add frame', 'Add text', 'Add image', '---', 'Zoom to selection', 'Show code', '---', 'Delete file'];
    assert.deepEqual(m.rows, FRAME);
    assert.match((await selection(b))[0], /^landing\.html\|.* card$/, 'the frame is selected first');
    assert.deepEqual(m.items.filter((x) => x.off).map((x) => x.label), [], 'nothing on an HTML frame is dimmed');
    assert.deepEqual(m.items.map((x) => x.key), ['Ctrl C', 'Ctrl V', 'Ctrl D', 'F2', 'F', 'T', 'I', 'Shift 2', '', 'Delete']);
    await keysMatchSheet(b, sheet);
    t.diagnostic(`frame: ${m.rows.join(' | ')}`);

    // an element inside a frame (the frame is an iframe that takes no pointer events: the right-click reaches the canvas); a plain
    // right-click picks what a click would (the top-level main), Ctrl+right-click the deepest (the heading), as Ctrl+click does
    const h1 = await node(b, 'h1');
    await rclick(io, await centre(b, el(h1)));
    assert.deepEqual(await selection(b), [`${LANDING}|${await node(b, 'main')}`], 'the top-level element under the pointer is selected, the others cleared');
    await rclick(io, await centre(b, el(h1)), { ctrl: true });
    m = await menu(b);
    assert.deepEqual(await selection(b), [`${LANDING}|${h1}`], 'Ctrl: the element under the pointer itself');
    assert.deepEqual(m.rows, ['Cut', 'Copy', 'Paste here', 'Duplicate', '---', 'Select parent', 'Select children', 'Order >', 'Wrap in frame', '---', 'Create component', '---', 'Zoom to selection', 'Show code', '---', 'Delete']);
    const by = Object.fromEntries(m.items.map((x) => [x.label, x]));
    assert.ok(!by['Create component'].off, 'an element in a frame can become a component (pass 3)');
    assert.ok(by['Select children'].off && /Nothing inside/.test(by['Select children'].why), 'a heading has no elements inside');
    assert.ok(by['Wrap in frame'].off, 'wrapping HTML is not there yet: dimmed');
    assert.deepEqual([by.Cut.key, by.Copy.key, by.Duplicate.key, by['Select parent'].key, by.Delete.key], ['Ctrl X', 'Ctrl C', 'Ctrl D', 'Shift Enter', 'Delete']);
    await keysMatchSheet(b, sheet);
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
    assert.deepEqual(m.rows.filter((x) => x !== 'Collapse'), FRAME, 'the file row has the frame\'s items (and Collapse)');
    assert.ok(m.rows.includes('Collapse'), 'the file row collapses');
    await keysMatchSheet(b, sheet);
    // the same for a TSX component, reached by its card, its file row and its root layer row
    await io.key('Escape');
    const card = await b.eval(`napkin.find('Card').component`), root = await b.eval(`napkin.state.components.get(napkin.find('Card').component).doc.root.id`);
    await rclick(io, await centre(b, `document.querySelector('section.cmp[data-component="${card}"] .cmp-head h3')`));
    const tsx = (await menu(b)).rows;
    assert.deepEqual(tsx.slice(0, 4), ['Copy', 'Paste inside', 'Duplicate', 'Rename'], `a TSX frame: ${tsx.join(' | ')}`);
    assert.equal(tsx.at(-1), 'Delete file…', 'a TSX file is deleted after its dialog');
    await keysMatchSheet(b, sheet);
    for (const row of [`#layers .lcomp[data-component="${card}"]`, `#layers .lrow[data-component="${card}"][data-node="${root}"]`]) {
      await io.key('Escape');
      await b.eval(`napkin.layers.expand(${JSON.stringify(card)})`);
      await b.waitFor(`!!document.querySelector(${JSON.stringify(row)})`);
      await b.eval(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({ block: 'center' })`);
      await rclick(io, await centre(b, `document.querySelector(${JSON.stringify(row)})`));
      assert.deepEqual((await menu(b)).rows.filter((x) => x !== 'Collapse' && x !== 'Expand'), tsx, `${row}: the same items as the card`);
      await keysMatchSheet(b, sheet);
    }
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
    await rclick(io, await centre(b, el(await node(b, 'article'))), { ctrl: true });
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
    await rclick(io, await centre(b, el(await node(b, 'button.cta'))), { ctrl: true });
    await pick('Copy');
    await sleep(300);
    r0 = await rev();
    const tuesday = await b.eval(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame; return f.nodeOf(f.doc().querySelectorAll('article')[1]); })()`);
    await rclick(io, await centre(b, el(tuesday)), { ctrl: true });
    await pick('Paste here');
    await reloaded(r0);
    assert.match(html(), /<p>Ship the shell<\/p>\s*<button class="cta">Start<\/button><\/article>/, 'pasted into the card under the pointer, as its last child');
    // Order (the submenu): hover opens it after 150 ms; Bring to front makes the heading the last of its siblings
    r0 = await rev();
    await rclick(io, await centre(b, el(await node(b, 'h1'))), { ctrl: true });
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
    await rclick(io, await centre(b, el(await node(b, 'h1'))), { ctrl: true });
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

test('menus: Cut of several and Paste, Undo with the selection, Show code, the frame menu (Rename, Duplicate, Delete file)', { timeout: 240000 }, async (t) => {
  const { b, io, r, html, close } = await boot();
  const pick = async (label, from = '#ctxmenu') => { const p = await centre(b, `[...document.querySelectorAll('${from} [role=menuitem]')].find((e) => e.querySelector('.nk-ml').textContent === ${JSON.stringify(label)})`); await io.click(p.x, p.y); };
  const rev = () => b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)})?.docFrame.tree()?.revision ?? null`);
  const reloaded = async (before) => { await b.waitFor(`napkin.stage.sections.get(${JSON.stringify(LANDING)})?.docFrame.tree()?.revision !== ${JSON.stringify(before)}`, 10000); await sleep(300); };
  const head = (id) => `document.querySelector('section.cmp[data-component="${id}"] .cmp-head h3')`;
  const has = (id) => b.eval(`napkin.state.components.has(${JSON.stringify(id)})`);
  const view = () => j(b, `napkin.view.get()`);
  const exists = (name) => { try { readFileSync(join(r.compDir, name)); return true; } catch { return false; } };
  try {
    await b.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(await b.eval('location.href')).origin });
    // Cut of two elements, picked in reverse order: both go to the clipboard in the file's order, then both leave the file
    const [h1, btn] = [await node(b, 'h1'), await node(b, 'button.cta')];
    await b.eval(`napkin.selectMany([${JSON.stringify(btn)}, ${JSON.stringify(h1)}].map((node) => ({ component: ${JSON.stringify(LANDING)}, node, variant: {} })))`);
    let r0 = await rev();
    await rclick(io, await centre(b, el(btn)));
    assert.equal((await menu(b)).label, '2 selected');
    await pick('Cut');
    await reloaded(r0);
    const clip = await b.eval(`navigator.clipboard.readText()`);
    assert.match(clip, /^<h1>Plan the week<\/h1>\n<button class="cta">Start<\/button>/, `both on the clipboard, in the file's order:\n${clip}`);
    assert.doesNotMatch(html(), /<h1>|class="cta"/, 'both cut from the file');
    assert.match(html(), /<main class="hero"><p>One page, one list.<\/p><\/main>/);
    // Paste inside the second card: both come back, in order, and are the selection
    const tuesday = await b.eval(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame; return f.nodeOf(f.doc().querySelectorAll('article')[1]); })()`);
    r0 = await rev();
    await rclick(io, await centre(b, el(tuesday)), { ctrl: true });
    await pick('Paste here');
    await reloaded(r0);
    assert.match(html(), /<p>Ship the shell<\/p><h1>Plan the week<\/h1><button class="cta">Start<\/button><\/article>/, 'both pasted, in order');
    await b.waitFor(`napkin.state.selections.length === 2`, 5000);
    // Undo the paste, then undo the cut: the two are back where they were and selected again, in one step
    await b.eval(`document.activeElement?.blur()`);
    r0 = await rev(); await io.key('z', { ctrl: true }); await reloaded(r0);
    r0 = await rev(); await io.key('z', { ctrl: true }); await reloaded(r0);
    assert.match(html(), /<main class="hero"><h1>Plan the week<\/h1><p>One page, one list.<\/p><button class="cta">Start<\/button><\/main>/, 'one undo puts both back');
    await b.waitFor(`napkin.state.selections.length === 2`, 5000);
    assert.deepEqual((await selection(b)).sort(), [`${LANDING}|${h1}`, `${LANDING}|${btn}`].sort(), 'and selects them again');

    // Show code on an element: the file itself, by its name, with the element's line marked
    await b.eval(`napkin.select({ component: ${JSON.stringify(LANDING)}, node: ${JSON.stringify(h1)}, variant: {} })`);
    await rclick(io, await centre(b, el(h1)));
    await pick('Show code');
    await b.waitFor(`document.querySelector('#code-lines .cl.hl')`, 5000);
    const code = await j(b, `({ name: document.querySelector('#pane-code .c-name, .code .c-name').textContent, text: [...document.querySelectorAll('#code-lines .cl .ct')].map((e) => e.textContent).join('\\n'), hl: [...document.querySelectorAll('#code-lines .cl.hl .ct')].map((e) => e.textContent).join('\\n') })`);
    assert.equal(code.name, LANDING, 'the strip names the file');
    assert.equal(code.text, html().replace(/\n$/, ''), 'the strip shows the file as it is on disk');
    assert.match(code.hl, /<h1>Plan the week<\/h1>/, "the element's line is marked");
    // and on the frame: the same file
    await rclick(io, await centre(b, head(LANDING)));
    await pick('Show code');
    await sleep(400);
    assert.equal(await b.eval(`document.querySelector('.code .c-name').textContent`), LANDING);

    // Duplicate: the next free frame-N.html (standards 3.11) beside it; the original keeps its place and the view does not move or zoom
    await rclick(io, await centre(b, head(LANDING)));
    const v0 = await view(), p0 = await j(b, `napkin.stage.sections.get(${JSON.stringify(LANDING)}).pos`);
    await pick('Duplicate');
    await b.waitFor(`napkin.state.selection?.component === 'frame-1.html'`, 10000);
    assert.equal(readFileSync(join(r.compDir, 'frame-1.html'), 'utf8'), html(), 'a copy of the file, next to it');
    assert.deepEqual(await j(b, `napkin.stage.sections.get(${JSON.stringify(LANDING)}).pos`), p0, 'the original did not move');
    assert.deepEqual(await view(), v0, 'the view did not move or zoom');
    const p2 = await j(b, `napkin.stage.sections.get('frame-1.html').pos`);
    assert.ok(p2.y === p0.y && p2.x > p0.x, `the copy is on the same row, to the right (${JSON.stringify(p2)} vs ${JSON.stringify(p0)})`);
    t.diagnostic(`duplicate: original ${JSON.stringify(p0)}, copy ${JSON.stringify(p2)}, view ${JSON.stringify(v0)}`);
    await b.eval(`document.activeElement?.blur()`);
    await io.key('z', { ctrl: true });
    await b.waitFor(`!napkin.state.components.has('frame-1.html')`, 10000);
    assert.equal(exists('frame-1.html'), false, 'Ctrl+Z removes the copy');

    // Rename: the label becomes a field; an empty name is refused; Enter renames the file; Ctrl+Z puts the name back
    await rclick(io, await centre(b, head(LANDING)));
    await pick('Rename');
    await b.waitFor(`document.activeElement?.classList.contains('nk-rename')`, 3000);
    assert.equal(await b.eval(`document.activeElement.value`), 'landing');
    await b.eval(`(() => { const i = document.activeElement; i.value = '  '; i.dispatchEvent(new Event('input')); })()`);
    await io.key('Enter');
    await sleep(200);
    assert.equal(await b.eval(`document.querySelector('.nk-rename-msg')?.textContent`), 'A file needs a name.', 'a refused name says why, and the field stays');
    await b.eval(`(() => { const i = document.querySelector('.nk-rename'); i.value = 'plan'; i.dispatchEvent(new Event('input')); })()`);
    await io.key('Enter');
    await b.waitFor(`napkin.state.selection?.component === 'plan.html'`, 10000);
    assert.ok(exists('plan.html') && !exists(LANDING), 'the file is renamed on disk');
    assert.deepEqual(await j(b, `napkin.stage.sections.get('plan.html').pos`), p0, 'in the same place');
    await b.eval(`document.activeElement?.blur()`);
    await io.key('z', { ctrl: true });
    await b.waitFor(`napkin.state.selection?.component === ${JSON.stringify(LANDING)}`, 10000);
    assert.ok(exists(LANDING) && !exists('plan.html'), 'Ctrl+Z puts the old name back');
    // F2 on the frame does the same
    await io.key('F2');
    await b.waitFor(`document.activeElement?.classList.contains('nk-rename')`, 3000);
    await io.key('Escape');
    assert.equal(await b.eval(`!!document.querySelector('.nk-rename')`), false, 'Escape keeps the name');

    // Delete file: gone from the folder at once (no dialog), and Ctrl+Z brings it back in its place
    const before = html();
    await rclick(io, await centre(b, head(LANDING)));
    await pick('Delete file');
    await b.waitFor(`!napkin.state.components.has(${JSON.stringify(LANDING)})`, 10000);
    assert.equal(exists(LANDING), false);
    await b.eval(`document.activeElement?.blur()`);
    await io.key('z', { ctrl: true });
    await b.waitFor(`napkin.state.selection?.component === ${JSON.stringify(LANDING)}`, 10000);
    assert.equal(html(), before, 'the same bytes back');
    assert.deepEqual(await j(b, `napkin.stage.sections.get(${JSON.stringify(LANDING)}).pos`), p0, 'in the same place');
    assert.ok(await has(LANDING));
  } finally { await close(); }
});

test('menus: Escape after a hover-opened submenu closes one level; dimmed items get no fill; Ctrl+A selects all', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot();
  const focused = () => b.eval(`(() => { const e = document.activeElement; return e?.closest('[role=menuitem]') ? e.querySelector('.nk-ml').textContent : e === document.body ? 'body' : (e.id || e.tagName); })()`);
  const look = (label) => j(b, `(() => { const e = [...document.querySelectorAll('#ctxmenu [role=menuitem]')].find((x) => x.querySelector('.nk-ml').textContent === ${JSON.stringify(label)}); const s = getComputedStyle(e); return { bg: s.backgroundColor, outline: s.outlineStyle === 'none' ? 'none' : s.outlineWidth + ' ' + s.outlineStyle }; })()`);
  try {
    const h1 = await node(b, 'h1');
    await rclick(io, await centre(b, el(h1)));
    const order = await centre(b, `document.querySelector('#ctxmenu [data-sub]')`);
    await io.move(order.x, order.y);
    await b.waitFor(`!document.querySelector('#ctxmenu-sub').hidden`, 1000);
    await io.key('Escape');
    assert.equal(await b.eval(`document.querySelector('#ctxmenu-sub').hidden`), true, 'the first Escape closes the submenu');
    assert.ok(await isOpen(b), 'and only the submenu');
    assert.equal(await focused(), 'Order', 'focus is on the item that opened it');
    await io.key('Escape');
    assert.equal(await isOpen(b), false, 'the second Escape closes the menu');
    assert.equal(await focused(), 'stage', 'and focus goes back where it was (the canvas, pressed by the right-click)');

    // the pointer over a dimmed item: no fill and no ring; over a live one: the hover fill
    await rclick(io, await centre(b, el(h1)));
    const off = await centre(b, `[...document.querySelectorAll('#ctxmenu [role=menuitem]')].find((x) => x.querySelector('.nk-ml').textContent === 'Wrap in frame')`);
    await io.move(off.x, off.y); await sleep(150);
    const dim = await look('Wrap in frame');
    assert.deepEqual(dim, { bg: 'rgba(0, 0, 0, 0)', outline: 'none' }, `a dimmed item under the pointer: ${JSON.stringify(dim)}`);
    await io.press(off.x, off.y); await sleep(50);
    assert.equal((await look('Wrap in frame')).bg, 'rgba(0, 0, 0, 0)', 'no press state either');
    await io.release(off.x, off.y);
    const live = await centre(b, `[...document.querySelectorAll('#ctxmenu [role=menuitem]')].find((x) => x.querySelector('.nk-ml').textContent === 'Copy')`);
    await io.move(live.x, live.y); await sleep(150);
    assert.notEqual((await look('Copy')).bg, 'rgba(0, 0, 0, 0)', 'a live item under the pointer is filled');
    // the keyboard ring on a live item: 2 px solid, outside the item
    await io.key('ArrowDown'); await io.key('ArrowUp');
    const ring = await j(b, `(() => { const s = getComputedStyle(document.activeElement); return [s.outlineWidth, s.outlineStyle, s.outlineOffset]; })()`);
    assert.deepEqual(ring, ['2px', 'solid', '2px'], 'the focus ring: 2 px solid accent, 2 px outside');
    await io.key('Escape');

    // Ctrl+A on the canvas: every element at the selection's level (the menu and the key map say Ctrl A)
    await b.eval(`napkin.select({ component: ${JSON.stringify(LANDING)}, node: ${JSON.stringify(h1)}, variant: {} }); document.activeElement?.blur()`);
    await io.key('a', { ctrl: true });
    assert.equal((await selection(b)).length, 3, 'the heading, the paragraph and the button');
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

test('menus: a right-click picks what a click there would pick, and keeps a selection the pointer is inside', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot();
  try {
    const [main, h1, btn] = [await node(b, 'main'), await node(b, 'h1'), await node(b, 'button.cta')];
    await rclick(io, await centre(b, el(h1)));
    assert.deepEqual(await selection(b), [`${LANDING}|${main}`], 'on the heading: its top-level element, the main');
    assert.equal((await menu(b)).items.find((x) => x.label === 'Select children').off, false, "the main's menu (it has children)");
    await rclick(io, await centre(b, el(btn)));
    assert.deepEqual(await selection(b), [`${LANDING}|${main}`], 'inside the selection: the selection stays');
    await io.key('Escape');
    // a click at the same point picks the same
    await b.eval(`napkin.select(null)`);
    const p = await centre(b, el(btn));
    await io.click(p.x, p.y); await sleep(200);
    assert.deepEqual(await selection(b), [`${LANDING}|${main}`], 'a click there picks the main too');
    // Ctrl+right-click: the deepest element, as Ctrl+click
    await rclick(io, await centre(b, el(h1)), { ctrl: true });
    assert.deepEqual(await selection(b), [`${LANDING}|${h1}`], 'Ctrl: the heading itself');
    // beside the selection: its sibling, as a click picks
    await rclick(io, await centre(b, el(btn)));
    assert.deepEqual(await selection(b), [`${LANDING}|${btn}`], 'a sibling of the selected heading');
    await io.key('Escape');
  } finally { await close(); }
});

test('menus: Cut takes what it was started on; Undo and Redo bring back their own selection', { timeout: 180000 }, async () => {
  const { b, io, html, close } = await boot();
  const pick = async (label) => { const p = await centre(b, `[...document.querySelectorAll('#ctxmenu [role=menuitem]')].find((e) => e.querySelector('.nk-ml').textContent === ${JSON.stringify(label)})`); await io.click(p.x, p.y); };
  const rev = () => b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.tree()?.revision ?? null`);
  const reloaded = async (before) => { await b.waitFor(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.tree()?.revision !== ${JSON.stringify(before)}`, 10000); await sleep(300); };
  const selIs = async (want, why) => { try { await b.waitFor(`JSON.stringify(napkin.state.selections.map((s) => s.component + '|' + s.node)) === ${JSON.stringify(JSON.stringify(want))}`, 5000); } catch {} assert.deepEqual(await selection(b), want, why); };
  const tagOf = (n) => b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.node(${JSON.stringify(n)})?.tag ?? null`);
  const undo = async (redo = false) => { await b.eval(`document.activeElement?.blur()`); const r0 = await rev(); await io.key('z', { ctrl: true, shift: redo }); await reloaded(r0); };
  try {
    await b.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(await b.eval('location.href')).origin });
    const [main, sec] = [await node(b, 'main'), await node(b, 'section.cards')];
    const S = (n) => `${LANDING}|${n}`;
    // Cut the cards' section, then at once right-click the main: the section goes, the main stays and is the selection
    await rclick(io, await centre(b, el(sec)));
    assert.deepEqual(await selection(b), [S(sec)]);
    const p = await centre(b, el(main));
    let r0 = await rev();
    await pick('Cut');
    await io.move(p.x, p.y); await io.press(p.x, p.y, { button: 'right' }); await io.release(p.x, p.y, { button: 'right' });
    await reloaded(r0);
    assert.match(await b.eval(`navigator.clipboard.readText()`), /^<section class="cards">/, 'the section is on the clipboard');
    assert.match(html(), /<main class="hero">/, 'the main the second right-click picked is still in the file');
    assert.doesNotMatch(html(), /class="cards"/, 'the section Cut was started on is gone');
    await selIs([S(main)], 'and the main stays selected');
    await io.key('Escape');
    // Undo the cut: the section is back and selected; Redo: it goes, and nothing stale stays selected
    await undo();
    assert.match(html(), /class="cards"/);
    await selIs([S(sec)], 'undo selects what was cut');
    await undo(true);
    assert.doesNotMatch(html(), /class="cards"/);
    await selIs([], 'redo of a cut: nothing selected');
    await undo();
    await selIs([S(sec)]);
    // Delete the section, then the main, from the menu; two Undos: each puts back its own selection
    await rclick(io, await centre(b, el(sec)));
    r0 = await rev(); await pick('Delete'); await reloaded(r0);
    await rclick(io, await centre(b, el(main)));
    assert.deepEqual(await selection(b), [S(main)]);
    r0 = await rev(); await pick('Delete'); await reloaded(r0);
    assert.doesNotMatch(html(), /<main|class="cards"/);
    await undo();
    await selIs([S(main)], 'the first Undo brings back the main, selected');
    await undo();
    assert.match(html(), /<main class="hero">.*<section class="cards">/s);
    await selIs([S(sec)], 'the second brings back the section, selected (not the main)');
    // Duplicate the main; Undo selects the original again (not what now sits in the copy's place); Redo selects the copy
    await rclick(io, await centre(b, el(main)));
    r0 = await rev(); await pick('Duplicate'); await reloaded(r0);
    assert.equal(html().match(/<main class="hero">/g)?.length, 2);
    const copy = await b.eval(`napkin.state.selection?.node`);
    assert.notEqual(copy, main);
    assert.equal(await tagOf(copy), 'main', 'the copy is selected');
    await undo();
    assert.equal(html().match(/<main class="hero">/g)?.length, 1);
    await selIs([S(main)], 'undo of a duplicate selects the original');
    await undo(true);
    assert.equal(html().match(/<main class="hero">/g)?.length, 2);
    await selIs([S(copy)], 'redo selects the copy');
  } finally { await close(); }
});

test('menus: no dead right-click after Shift+F10 and Escape; text fields keep their menu; a dimmed item has the one focus ring', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot();
  try {
    const empty = await emptyCanvas(b);
    await b.eval(`napkin.select(null); document.activeElement?.blur()`);
    await io.key('F10', { shift: true });
    assert.ok(await isOpen(b), 'Shift+F10 opens it');
    await io.key('Escape');
    assert.equal(await isOpen(b), false);
    await io.move(empty.x, empty.y); await io.press(empty.x, empty.y, { button: 'right' }); await io.release(empty.x, empty.y, { button: 'right' });
    await sleep(100);
    assert.ok(await isOpen(b), 'a right-click right after opens the menu at once');
    await io.key('Escape');
    // a text field right after the keys: the browser's own menu, not prevented
    const main = await node(b, 'main');
    const mp = await centre(b, el(main));
    await io.click(mp.x, mp.y); await sleep(400);
    const field = `[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), textarea')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 8 && !e.closest('#stage') && getComputedStyle(e).visibility !== 'hidden' && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; })`;
    const fp = await centre(b, field);
    await b.eval(`document.activeElement?.blur()`);
    await io.key('F10', { shift: true });
    assert.ok(await isOpen(b));
    await io.key('Escape');
    await b.eval(`window.__native = null; addEventListener('contextmenu', (e) => { window.__native = !e.defaultPrevented; }, { once: true })`);
    await io.move(fp.x, fp.y); await io.press(fp.x, fp.y, { button: 'right' }); await io.release(fp.x, fp.y, { button: 'right' });
    await sleep(100);
    assert.equal(await b.eval('window.__native'), true, 'the field keeps the browser menu');
    assert.equal(await isOpen(b), false);
    // the keyboard on a dimmed item: the same ring as a live one (2 px accent, 2 px outside), and no fill
    await b.eval(`napkin.select({ component: ${JSON.stringify(LANDING)}, node: ${JSON.stringify(main)}, variant: {} }); document.activeElement?.blur()`);
    await io.key('F10', { shift: true });
    await io.key('w');
    const ring = () => j(b, `(() => { const e = document.activeElement, s = getComputedStyle(e); return { label: e.querySelector('.nk-ml').textContent, off: e.getAttribute('aria-disabled') === 'true', ring: [s.outlineWidth, s.outlineStyle, s.outlineOffset, s.outlineColor], bg: s.backgroundColor }; })()`);
    const dim = await ring();
    assert.equal(dim.label, 'Wrap in frame'); assert.ok(dim.off);
    await io.key('Home');
    const live = await ring();
    assert.equal(live.off, false);
    assert.deepEqual(live.ring.slice(0, 3), ['2px', 'solid', '2px']);
    assert.deepEqual(dim.ring, live.ring, `one ring for both: ${JSON.stringify({ dim, live })}`);
    assert.equal(dim.bg, 'rgba(0, 0, 0, 0)', 'a dimmed item still has no fill');
    await io.key('Escape');
  } finally { await close(); }
});

// ---- round 4: a command keeps what it was started on (target and revision taken when invoked), Undo restores the editing target ----
function rig(b, io) {
  const pick = async (label, from = '#ctxmenu') => { const p = await centre(b, `[...document.querySelectorAll('${from} [role=menuitem]')].find((e) => e.querySelector('.nk-ml').textContent === ${JSON.stringify(label)})`); await io.click(p.x, p.y); };
  const rev = () => b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.tree()?.revision ?? null`);
  const reloaded = async (before) => { await b.waitFor(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.tree()?.revision !== ${JSON.stringify(before)}`, 10000); await sleep(300); };
  const selIs = async (want, why) => { try { await b.waitFor(`JSON.stringify(napkin.state.selections.map((s) => s.component + '|' + s.node)) === ${JSON.stringify(JSON.stringify(want))}`, 5000); } catch {} assert.deepEqual(await selection(b), want, why); };
  const undo = async (redo = false) => { await b.eval(`document.activeElement?.blur()`); const r0 = await rev(); await io.key('z', { ctrl: true, shift: redo }); await reloaded(r0); };
  return { pick, rev, reloaded, selIs, undo };
}

test('menus: Paste writes where it was started, even when another right-click lands while the clipboard is read', { timeout: 180000 }, async () => {
  const { b, io, html, close } = await boot();
  const { pick, rev, reloaded } = rig(b, io);
  try {
    await b.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(await b.eval('location.href')).origin });
    const [h1, main, sec] = [await node(b, 'h1'), await node(b, 'main'), await node(b, 'section.cards')];
    await rclick(io, await centre(b, el(h1)), { ctrl: true });
    await pick('Copy');
    await sleep(300);
    // the clipboard answers slowly: time enough for a second right-click to change the selection first
    await b.eval(`(() => { const slow = (f) => async (...a) => { await new Promise((r) => setTimeout(r, 600)); return f(...a); }; navigator.clipboard.read = slow(navigator.clipboard.read.bind(navigator.clipboard)); navigator.clipboard.readText = slow(navigator.clipboard.readText.bind(navigator.clipboard)); })()`);
    await rclick(io, await centre(b, el(main)));
    assert.deepEqual(await selection(b), [`${LANDING}|${main}`]);
    const p = await centre(b, el(sec)), r0 = await rev();
    await pick('Paste here');
    await io.move(p.x, p.y); await io.press(p.x, p.y, { button: 'right' }); await io.release(p.x, p.y, { button: 'right' });
    await reloaded(r0);
    const text = html();
    assert.equal(text.match(/<h1>/g)?.length, 2, 'one copy was pasted');
    assert.match(text, /<main class="hero">(?:(?!<\/main>).)*<h1>Plan the week<\/h1>(?:(?!<\/main>).)*<h1>Plan the week<\/h1>(?:(?!<\/main>).)*<\/main>/s, 'it went into the main whose menu was used');
    assert.doesNotMatch(text, /<section class="cards">(?:(?!<\/section>).)*<h1>/s, 'not into the section picked meanwhile');
  } finally { await close(); }
});

test('menus: Undo of Order and of Paste puts back the selection the step began with (by object, not by position)', { timeout: 180000 }, async () => {
  const { b, io, html, close } = await boot();
  const { pick, rev, reloaded, selIs, undo } = rig(b, io);
  const tagOf = (n) => b.eval(`napkin.stage.sections.get(${JSON.stringify(LANDING)}).docFrame.node(${JSON.stringify(n)})?.tag ?? null`);
  try {
    await b.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(await b.eval('location.href')).origin });
    const S = (n) => `${LANDING}|${n}`;
    const [h1, btn] = [await node(b, 'h1'), await node(b, 'button.cta')];
    // Order > Bring to front on the heading: it moves last; Undo puts it back first and it is the selection (not the button now at its place)
    await rclick(io, await centre(b, el(h1)), { ctrl: true });
    await selIs([S(h1)]);
    const sub = await centre(b, `document.querySelector('#ctxmenu [data-sub]')`);
    await io.click(sub.x, sub.y); await sleep(100);
    let r0 = await rev();
    await pick('Bring to front', '#ctxmenu-sub'); await reloaded(r0);
    assert.match(html(), /<p>One page, one list.<\/p><button class="cta">Start<\/button><h1>Plan the week<\/h1>/, 'the heading is last');
    await undo();
    assert.match(html(), /<main class="hero"><h1>Plan the week<\/h1><p>/, 'the heading is first again');
    await selIs([S(h1)], 'Undo selects the heading, not what now sits at its old place');
    assert.equal(await tagOf(h1), 'h1');
    await undo(true);
    assert.equal(await tagOf(await b.eval(`napkin.state.selection?.node`)), 'h1', 'Redo selects the heading where it went');
    await undo();
    // Copy the heading; Paste here on the button; Undo: the button is selected again
    await rclick(io, await centre(b, el(h1)), { ctrl: true });
    await pick('Copy'); await sleep(300);
    await rclick(io, await centre(b, el(btn)), { ctrl: true });
    await selIs([S(btn)]);
    r0 = await rev(); await pick('Paste here'); await reloaded(r0);
    assert.equal(html().match(/<h1>/g)?.length, 2);
    await undo();
    assert.equal(html().match(/<h1>/g)?.length, 1, 'the paste is undone');
    await selIs([S(btn)], 'Undo of a paste selects the element it was pasted onto');
  } finally { await close(); }
});

test('menus: Order stays open while the pointer travels diagonally to a command, across the rows between', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot();
  try {
    const h1 = await node(b, 'h1');
    await rclick(io, await centre(b, el(h1)), { ctrl: true });
    const start = await centre(b, `document.querySelector('#ctxmenu [data-sub]')`);
    await io.move(start.x, start.y); await sleep(400);
    assert.equal(await b.eval(`!document.querySelector('#ctxmenu-sub').hidden`), true, 'hovering Order opens it');
    const goal = await centre(b, `[...document.querySelectorAll('#ctxmenu-sub [role=menuitem]')].find((e) => e.querySelector('.nk-ml').textContent === 'Send to back')`);
    // the neighbouring row (Wrap in frame, below) is crossed on the way: 20 real moves, 30 ms apart
    const crossed = new Set();
    for (let i = 1; i <= 20; i++) {
      const x = start.x + (goal.x - start.x) * i / 20, y = start.y + (goal.y - start.y) * i / 20;
      await io.move(Math.round(x), Math.round(y)); await sleep(30);
      crossed.add(await b.eval(`document.elementFromPoint(${Math.round(x)}, ${Math.round(y)})?.closest('[role=menuitem]')?.querySelector('.nk-ml')?.textContent ?? ''`));
    }
    assert.ok(crossed.has('Wrap in frame'), `the path crosses the row below Order (${[...crossed]})`);
    assert.equal(await b.eval(`!document.querySelector('#ctxmenu-sub').hidden`), true, 'the submenu is still open when the pointer arrives');
    assert.equal(await b.eval(`document.elementFromPoint(${goal.x}, ${goal.y}).closest('[role=menuitem]').querySelector('.nk-ml').textContent`), 'Send to back');
    // and a pointer that goes to the neighbouring row and stays there closes it
    const wrap = await centre(b, `[...document.querySelectorAll('#ctxmenu [role=menuitem]')].find((e) => e.querySelector('.nk-ml').textContent === 'Wrap in frame')`);
    await io.move(start.x - 10, start.y); await io.move(wrap.x - 20, wrap.y); await sleep(700);
    assert.equal(await b.eval(`document.querySelector('#ctxmenu-sub').hidden`), true, 'a pointer that rests on another row closes it');
  } finally { await close(); }
});
