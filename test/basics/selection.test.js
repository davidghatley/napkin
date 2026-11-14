// Basics, selection inside HTML frames (docs/basics/standards.md section 5): Figma's model, with real pointer and key input.
// One ladder: a click on a frame picks the frame (the scope starts at the canvas); double-click or Enter goes one level in (the
// frame's top-level element, a direct child of <body>, then deeper) and edits text at the deepest level; a click then picks at
// that level; Escape goes up one level, then to the frame, then clears; Ctrl/Cmd-click picks the deepest element; a marquee
// on empty canvas picks the frames it touches; a click on a frame's label picks the frame; tool keys wait for a pointer drag
// to end; the hover outline shows what a click would pick.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

let r, server, b, io;
const ID = 'nest.html';
const q = (e) => b.eval(e);
const json = async (e) => JSON.parse(await q(`JSON.stringify(${e})`));
const until = (fn, ms = 8000) => waitFor(fn, ms, 50);
// the selected elements, as tag names (the frame's own node map gives the tag)
const sel = () => json(`napkin.state.selections.map((s) => s.component === '${ID}' ? napkin.stage.sections.get('${ID}').docFrame.node(s.node)?.tag : s.component + ':' + s.node)`);
// an element of the frame's page, in page pixels: its centre and box
const at = (css) => json(`(() => {
  const f = document.querySelector('section.cmp[data-component="${ID}"] iframe.doc-frame'), fr = f.getBoundingClientRect(), z = fr.width / f.offsetWidth;
  const e = f.contentDocument.querySelector(${JSON.stringify(css)}).getBoundingClientRect();
  const l = fr.left + f.clientLeft * z + e.left * z, t = fr.top + f.clientTop * z + e.top * z;
  return { x: l + 8 * z, y: t + 8 * z, cx: l + e.width * z / 2, cy: t + e.height * z / 2, l, t, w: e.width * z, h: e.height * z };
})()`);
const hoverBox = () => json(`(() => { const h = document.querySelector('#overlay-hover'); if (!h || h.style.display !== 'block') return null; const r = h.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
const near = (a, e, what) => { for (const k of ['l', 't', 'w', 'h']) assert.ok(Math.abs(a[k] - e[k]) <= 2, `${what}: ${k} ${a[k]} vs ${e[k]}`); };
async function fresh() {
  await q(`napkin.tools.use('select'); napkin.select(null); document.activeElement?.blur?.(); 0`);
  await io.move(5, 450); await sleep(150);
}

before(async () => {
  r = tempRepo(['Card']);
  writeFileSync(join(r.compDir, ID), `<!doctype html><html lang="en"><head><title>nest</title></head><body style="margin: 0; width: 480px; height: 360px">`
    + `<main style="padding: 24px"><section style="padding: 16px; background: #eee"><h1 style="margin: 0">Plan the week</h1><p style="margin: 8px 0 0">One page.</p></section></main>`
    + `<footer style="padding: 12px">Foot</footer></body></html>\n`);
  server = await startServer(r.compDir, { timeout: 20000, env: { NAPKIN_ALL_KINDS: '0' } });
  b = await launchChromium({ width: 1440, height: 900 });
  io = input(b);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="${ID}"]')?.dataset.ready && !!napkin.stage.sections.get('${ID}')?.docFrame?.tree()`, 20000);
  await q(`(() => { const s = napkin.stage.sections.get('${ID}'); napkin.view.set({ x: 300 - s.pos.x, y: 200 - s.pos.y, z: 1 }); })(); 0`);
  await sleep(400);
});
after(async () => { await b?.close(); await server?.stop(); rmSync(r.dir, { recursive: true, force: true }); });

test('selection: a first click on a frame picks the frame, and the hover outline showed exactly that', { timeout: 60000 }, async () => {
  await fresh();
  const h1 = await at('h1'), page = await at('body');
  await io.move(h1.x, h1.y); await sleep(150);
  const hb = await hoverBox();
  assert.ok(hb, 'something is outlined on hover');
  near(hb, page, 'the hover outline is the whole frame, not the <main> or the <h1>');
  await io.click(h1.x, h1.y); await sleep(150);
  assert.deepEqual(await sel(), ['body'], 'the click picked the frame');
  assert.equal(await q(`!!napkin.ops.isFrame()`), true, 'it counts as the frame');
  const foot = await at('footer');
  await io.click(foot.cx, foot.cy); await sleep(150);
  assert.deepEqual(await sel(), ['body'], 'another click in the same frame keeps the frame (the scope is still the canvas)');
  // one level in, a click picks at that level: the top-level elements
  await io.dblclick(h1.x, h1.y); await sleep(200);
  assert.deepEqual(await sel(), ['main'], 'double-click goes in to the top-level element');
  await io.click(foot.cx, foot.cy); await sleep(150);
  assert.deepEqual(await sel(), ['footer'], 'a click at that level picks the other top-level element');
});

test('selection: double-click goes one level in toward the pointer; at the deepest text it edits', { timeout: 60000 }, async () => {
  await fresh();
  const h1 = await at('h1');
  await io.dblclick(h1.x, h1.y); await sleep(200);
  assert.deepEqual(await sel(), ['main'], 'one level in from the frame');
  await io.dblclick(h1.x, h1.y); await sleep(200);
  assert.deepEqual(await sel(), ['section'], 'one level in from <main>');
  assert.equal(await q(`document.activeElement?.isContentEditable ?? false`), false, 'no text edit yet');
  // the hover now previews the level of the selection: over the selected section nothing new is outlined
  await io.move(h1.x + 1, h1.y + 1); await sleep(150);
  assert.equal(await hoverBox(), null, 'a click here would pick the selected section again');
  await io.dblclick(h1.x, h1.y); await sleep(200);
  assert.deepEqual(await sel(), ['h1'], 'one more level in');
  await io.dblclick(h1.x, h1.y);
  await until(async () => q(`!!document.querySelector('section.cmp[data-component="${ID}"] iframe.doc-frame').contentDocument.querySelector('h1[contenteditable]')`));
  await io.key('Escape'); await sleep(300);
});

test('selection: Escape goes up one level, then to the frame card, then clears', { timeout: 60000 }, async () => {
  await fresh();
  const p = await at('p');
  await io.click(p.x, p.y, { ctrl: true }); await sleep(150);
  assert.deepEqual(await sel(), ['p'], 'Ctrl-click picks the deepest element');
  await io.key('Escape'); await sleep(100);
  assert.deepEqual(await sel(), ['section']);
  await io.key('Escape'); await sleep(100);
  assert.deepEqual(await sel(), ['main']);
  await io.key('Escape'); await sleep(100);
  assert.deepEqual(await sel(), ['body'], 'from the top level, the frame card');
  assert.equal(await q(`!!napkin.ops.isFrame()`), true, 'the card counts as the frame');
  await io.key('Escape'); await sleep(100);
  assert.deepEqual(await sel(), [], 'from the card, nothing');
});

test('selection: Ctrl-click and Cmd-click pick the deepest element directly; Shift-click adds at the clicked level', { timeout: 60000 }, async () => {
  await fresh();
  const h1 = await at('h1');
  await io.move(h1.x, h1.y, { ctrl: true }); await sleep(150);
  near(await hoverBox(), await at('h1'), 'with Ctrl held the hover previews the deepest element');
  await io.click(h1.x, h1.y, { meta: true }); await sleep(150);
  assert.deepEqual(await sel(), ['h1'], 'Cmd-click');
  await fresh();
  await io.dblclick(h1.x, h1.y); await sleep(200);
  assert.deepEqual(await sel(), ['main']);
  const foot = await at('footer');
  await io.click(foot.cx, foot.cy, { shift: true }); await sleep(150);
  assert.deepEqual((await sel()).sort(), ['footer', 'main'], 'Shift-click adds the top-level element');
});

test('selection: Enter picks the first child, one path at every level', { timeout: 60000 }, async () => {
  await fresh();
  const h1 = await at('h1');
  await io.click(h1.x, h1.y); await sleep(150);
  assert.deepEqual(await sel(), ['body'], 'the click picked the frame');
  await q(`document.activeElement?.blur?.(); 0`);
  await io.key('Enter'); await sleep(150);
  assert.deepEqual(await sel(), ['main'], 'Enter on the frame');
  await io.key('Enter'); await sleep(150);
  assert.deepEqual(await sel(), ['section'], 'Enter on <main>');
  await io.key('Enter'); await sleep(150);
  assert.deepEqual(await sel(), ['h1'], 'Enter on <section>');
  assert.equal(await q('document.body.dataset.focus ?? null'), null, 'Enter selects in place, it does not focus the card');
  await io.key('Escape'); await io.key('Escape'); await io.key('Escape'); await sleep(100);
  assert.deepEqual(await sel(), ['body'], 'back up at the card');
  await io.key('Enter'); await sleep(150);
  assert.deepEqual(await sel(), ['main'], 'Enter on the card picks its first element');
});

test('selection: the Layers panel, the right-click menu and Create component follow the picked element', { timeout: 60000 }, async () => {
  await fresh();
  const h1 = await at('h1');
  await io.dblclick(h1.x, h1.y); await sleep(250);
  assert.deepEqual(await sel(), ['main']);
  const rows = await json(`[...document.querySelectorAll('#layers .lrow[aria-selected="true"]')].map((r) => r.dataset.node)`);
  assert.deepEqual(rows, [await q('napkin.state.selection.node')], 'the one highlighted layer row is the picked <main>');
  // right-click an unselected element: it is picked by the same rule (its top-level element) before the menu opens
  const foot = await at('footer');
  await io.click(foot.cx, foot.cy, { button: 'right' }); await sleep(250);
  assert.deepEqual(await sel(), ['footer']);
  assert.ok(await q(`!!document.querySelector('.nk-menu:not([hidden])')`), 'the menu is open');
  await io.key('Escape'); await sleep(150);
  // Create component makes a component of the picked element
  await io.click(h1.x, h1.y); await sleep(150);
  assert.deepEqual(await sel(), ['main'], 'one level in already: a click picks the top-level element');
  await io.key('k', { ctrl: true, alt: true });
  await until(() => existsSync(join(r.compDir, 'Main.tsx')), 15000);
  await until(async () => /Main made from nest\.html/.test(await q(`document.querySelector('#hint').textContent`)) || null);
});

test('selection: tool keys wait while a pointer drag is in progress', { timeout: 60000 }, async () => {
  await q(`napkin.select(null); napkin.view.set({ x: -6000, y: -6000, z: 1 }); 0`);
  await sleep(250);
  const before = await json(`[...napkin.state.components.keys()]`);
  await io.key('f');
  await io.move(500, 300); await io.press(500, 300);
  for (let i = 1; i <= 4; i++) { await io.move(500 + 40 * i, 300 + 25 * i, { buttons: 1 }); await sleep(16); }
  await io.key('t'); await io.key('i'); await io.key('v');
  assert.equal(await q('napkin.state.tool'), 'frame', 'the tool is still Frame mid-drag');
  await io.release(660, 400);
  await until(async () => (await json(`[...napkin.state.components.keys()]`)).some((k) => !before.includes(k) && /^frame-\d+\.html$/.test(k)));
  assert.equal(await q(`!!document.querySelector('.nk-new-text')`), false, 'no text editor was made');
  assert.equal(existsSync(join(r.compDir, 'frame-1.html')), true, 'a frame file was made');
});

test('selection: a click on a frame\'s label picks the frame', { timeout: 60000 }, async () => {
  await fresh();
  // bring the label to (300, 200) on screen, measured (an earlier test's view move may still be landing), and wait until it holds still there
  const headAt = () => json(`(() => { const r = document.querySelector('section.cmp[data-component="${ID}"] .cmp-title h3').getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; })()`);
  await until(async () => {
    const h = await headAt();
    if (Math.abs(h.x - 306) < 2 && Math.abs(h.y - 200) < 8) { await sleep(150); const n = await headAt(); return (n.x === h.x && n.y === h.y) || null; }
    await q(`(() => { const v = napkin.view.get(); napkin.view.set({ x: v.x + 306 - ${h.x}, y: v.y + 200 - ${h.y}, z: v.z }); })(); 0`);
    await sleep(300); return null;
  });
  const head = await headAt();
  await io.click(head.x, head.y); await sleep(200);
  assert.deepEqual(await sel(), ['body'], 'the frame, not its first element');
  assert.equal(await q(`!!napkin.ops.isFrame()`), true);
});

test('selection: a marquee on empty canvas picks the frames it touches', { timeout: 60000 }, async () => {
  writeFileSync(join(r.compDir, 'side.html'), `<!doctype html><html lang="en"><head><title>side</title></head><body style="margin: 0; width: 200px; height: 160px"><p>Side</p></body></html>\n`);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="side.html"]')?.dataset.ready && !!napkin.stage.sections.get('side.html')?.docFrame?.tree()`, 20000);
  // the two frames side by side
  await q(`napkin.select(null); 0`);
  await sleep(300);
  await q(`(() => { const p = napkin.stage.sections.get('${ID}').pos; napkin.stage.moveTo('side.html', p.x + 700, p.y); napkin.view.set({ x: 200 - p.x, y: 200 - p.y, z: 1 }); })(); 0`);
  await sleep(500);
  const empty = (x, y) => q(`!document.elementFromPoint(${x}, ${y})?.closest('section, #overlays, .nk-menu')`);
  const box = (id) => json(`(() => { const r = napkin.stage.sections.get('${id}').frame.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
  const a = await box(ID), c = await box('side.html');
  const x0 = a.l - 60, y0 = a.t + 60;
  assert.equal(await empty(x0, y0), true, 'the press is on empty canvas');
  await io.drag(x0, y0, a.l + 50, a.t + 100);
  await sleep(200);
  assert.deepEqual(await sel(), ['body'], 'one frame touched: that frame');
  await io.click(x0, a.b + 80); await sleep(150);
  assert.deepEqual(await sel(), [], 'a click on empty canvas clears');
  await io.drag(x0, y0, c.l + 30, a.t + 100);
  await sleep(200);
  const both = await json(`napkin.state.selections.map((s) => s.component).sort()`);
  assert.deepEqual(both, ['nest.html', 'side.html'], `both frames it touched (${JSON.stringify([a, c])})`);
  assert.equal(await q(`document.querySelector('#marquee').hidden`), true, 'the marquee is gone');
});
