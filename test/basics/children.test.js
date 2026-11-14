// Basics, the elements inside an HTML frame as objects on the canvas (docs/basics/standards.md sections 3.5, 3.6, 3.8, 3.9, 3.10 and 4):
// a selected child (text, image, a frame inside the frame) has eight handles; dragging it moves it, not the frame; the move or resize is
// written to the file as one undo step; the arrows nudge it. Dragging the frame by its label still moves the frame. Real pointer and key input.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

let r, server, b, io;
const ID = 'board.html';
const q = (e) => b.eval(e);
const json = async (e) => JSON.parse(await q(`JSON.stringify(${e})`));
const until = (fn, ms = 8000) => waitFor(fn, ms, 50);
const src = () => readFileSync(join(r.compDir, ID), 'utf8');
const live = `document.querySelector('section.cmp[data-component="${ID}"] iframe.doc-frame:not(.doc-next)')`;
// an element of the frame's page, in page pixels
const at = (css) => json(`(() => {
  const f = ${live}, fr = f.getBoundingClientRect(), z = fr.width / f.offsetWidth;
  const e = f.contentDocument.querySelector(${JSON.stringify(css)}).getBoundingClientRect();
  const l = fr.left + f.clientLeft * z + e.left * z, t = fr.top + f.clientTop * z + e.top * z;
  return { cx: l + e.width * z / 2, cy: t + e.height * z / 2, l, t, w: e.width * z, h: e.height * z };
})()`);
const selTag = () => q(`(() => { const s = napkin.state.selection; return s ? napkin.stage.sections.get(s.component)?.docFrame?.node(s.node)?.tag ?? null : null; })()`);
const handles = () => json(`[...document.querySelectorAll('#handles .hdl-resize')].map((d) => { const r = d.getBoundingClientRect(); return { h: d.dataset.h, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
const pos = () => json(`napkin.stage.sections.get('${ID}').pos`);
const styleOf = (tag) => (src().match(new RegExp(`<${tag}\\b[^>]*? style="([^"]*)"`)) || [])[1] || '';
const px = (tag, prop) => { const m = new RegExp(`(?:^|;\\s*)${prop}: (-?\\d+)px`).exec(styleOf(tag)); return m ? Number(m[1]) : null; };
async function pick(css) { // Ctrl-click: the element itself, whatever the scope
  await q(`napkin.tools.use('select'); napkin.select(null); document.activeElement?.blur?.(); 0`);
  const e = await at(css);
  await io.click(e.cx, e.cy, { ctrl: true }); await sleep(200);
  return e;
}
const drawn = async () => { const rev = await q(`napkin.state.components.get('${ID}').revision`); await until(async () => (await q(`document.querySelector('section.cmp[data-component="${ID}"]')?.dataset.revision`)) === String(rev) && !(await q(`!!document.querySelector('section.cmp[data-component="${ID}"] iframe.doc-next')`))); await sleep(200); };

before(async () => {
  r = tempRepo(['Card']);
  writeFileSync(join(r.compDir, ID), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>board</title>\n</head>\n<body style="margin: 0; width: 480px; height: 320px">\n`
    + `<p style="position: absolute; left: 40px; top: 30px; margin: 0; font: 16px/1.4 system-ui, sans-serif; white-space: pre">Hello</p>\n`
    + `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" alt="" style="position: absolute; left: 40px; top: 120px; width: 80px; height: 60px; display: block; object-fit: cover">\n`
    + `<div style="position: absolute; left: 240px; top: 40px; width: 100px; height: 100px; background: #f4f4f5"></div>\n`
    + `</body>\n</html>\n`);
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

test('children: a selected text inside a frame has eight handles at its corners and edges', { timeout: 60000 }, async () => {
  const p = await pick('p');
  assert.equal(await selTag(), 'p');
  await sleep(100);
  const hs = await handles();
  assert.equal(hs.length, 8, 'eight handles');
  const nw = hs.find((h) => h.h === 'nw'), se = hs.find((h) => h.h === 'se');
  assert.ok(Math.abs(nw.x - p.l) <= 2 && Math.abs(nw.y - p.t) <= 2, `the nw handle is on the text's corner (${nw.x},${nw.y} vs ${p.l},${p.t})`);
  assert.ok(Math.abs(se.x - (p.l + p.w)) <= 2 && Math.abs(se.y - (p.t + p.h)) <= 2, 'the se handle is on the opposite corner');
});

test('children: dragging the selected text moves it, not the frame; one undo puts it back', { timeout: 60000 }, async () => {
  const p = await pick('p');
  const frameAt = await pos(), before = src();
  await io.drag(p.cx, p.cy, p.cx + 60, p.cy + 40);
  await until(() => px('p', 'left') === 100 && px('p', 'top') === 70);
  assert.deepEqual(await pos(), frameAt, 'the frame stayed where it was');
  await drawn();
  assert.equal(await selTag(), 'p', 'the text is still selected');
  const moved = await at('p');
  assert.ok(Math.abs(moved.l - (p.l + 60)) <= 2 && Math.abs(moved.t - (p.t + 40)) <= 2, 'drawn where it was dropped');
  await q('document.activeElement?.blur?.(); 0');
  await io.key('z', { ctrl: true });
  await until(() => src() === before);
  await drawn();
});

test('children: an image is resized by its corner handle; the size is written to the file', { timeout: 60000 }, async () => {
  await pick('img');
  assert.equal(await selTag(), 'img');
  await sleep(100);
  const se = (await handles()).find((h) => h.h === 'se');
  assert.ok(se, 'a corner handle');
  await io.drag(se.x, se.y, se.x + 20, se.y + 10);
  await until(() => px('img', 'width') === 100 && px('img', 'height') === 70);
  assert.equal(px('img', 'left'), 40, 'the top-left corner stays');
  await drawn();
  assert.equal(await selTag(), 'img', 'the image is still selected');
});

test('children: the arrows nudge a selected frame inside a frame (1 px, Shift 10 px), and the selection stays', { timeout: 60000 }, async () => {
  await pick('div');
  assert.equal(await selTag(), 'div');
  const frameAt = await pos();
  await q('document.activeElement?.blur?.(); 0');
  await io.key('ArrowRight');
  await until(() => px('div', 'left') === 241);
  await drawn();
  await io.key('ArrowDown', { shift: true });
  await until(() => px('div', 'top') === 50);
  await drawn();
  assert.equal(await selTag(), 'div', 'still the inner frame');
  assert.deepEqual(await pos(), frameAt, 'the outer frame did not move');
});

test('children: dragging the frame by its label still moves the frame, and its file is unchanged', { timeout: 60000 }, async () => {
  await q(`napkin.select(null); 0`);
  const before = src(), from = await pos();
  const head = await json(`(() => { const r = document.querySelector('section.cmp[data-component="${ID}"] .cmp-title h3').getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; })()`);
  await io.drag(head.x, head.y, head.x + 50, head.y + 30);
  await until(async () => { const p = await pos(); return p.x === from.x + 50 && p.y === from.y + 30; });
  assert.equal(src(), before);
});
