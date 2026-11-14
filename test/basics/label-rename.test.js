// Basics polish, round 6 (docs/basics/standards.md section 3): a label is a dependable target. Selecting a card by its label must not move
// the label, so a real double-click on an unselected label opens rename at 50%, 100% and 200%; and at the minimum zoom labels keep
// the label contract (11 px, 4 px gap) or are hidden by one stated rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const page = '<!doctype html><html><body style="margin:0;background:#fff;width:240px;height:140px"><h1>Hi</h1></body></html>\n';
async function boot(files = {}, count = 3) {
  const r = tempRepo(['Card']);
  writeFileSync(join(r.compDir, 'orbit.html'), page);
  for (const [n, body] of Object.entries(files)) writeFileSync(join(r.compDir, n), body);
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: 1280, height: 720 });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`document.querySelectorAll('#world > section[data-component][data-ready]:not([data-awaiting])').length >= ${count}`, 30000);
  await b.waitFor(`[...napkin.stage.sections.values()].filter((s) => s.docFrame && !s.item).every((s) => s.docFrame.iframe())`, 30000);
  await sleep(600);
  const io = input(b);
  await io.move(4, 710);
  return { b, io, close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
}
const theme = (b, want) => b.eval(`(() => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== ${JSON.stringify(want)}) document.querySelector('#theme-toggle').click(); })()`);
const S = (id) => id === 'Card' ? 'section[data-name="Card"]' : `section[data-component="${id}"]`;
const labelBox = (b, id) => b.eval(`JSON.stringify((() => { const s = document.querySelector('${S(id)}'), r = s.querySelector('.cmp-title h3').getBoundingClientRect(), f = s.querySelector(':scope > .frame').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2, top: r.top, gap: f.top - r.bottom }; })())`).then(JSON.parse);
const place = async (b, id, z) => { await b.eval(`napkin.stage.live(document.querySelector('${S(id)}').dataset.component)`); await sleep(1200); /* (a card still waiting to draw flies the view to itself when it is first picked: let it draw first) */ await b.eval(`(() => { const r = napkin.view.rectToWorld(document.querySelector('${S(id)} > .frame').getBoundingClientRect()); return napkin.view.set({ x: 500 - r.x * ${z}, y: 340 - r.y * ${z}, z: ${z} }); })()`); await sleep(500); };

test('round 6: a real double-click on an UNSELECTED label opens rename on an HTML frame and a component card, and a file card label stays put, at 50%, 100% and 200%', { timeout: 280000 }, async () => {
  const { b, io, close } = await boot({ 'notes.md': '# Notes\n\nhello\n' }, 3);
  try {
    for (const th of ['light', 'dark']) {
      await theme(b, th); await sleep(500);
      for (const z of [1, 0.5, 2]) {
        for (const id of ['orbit.html', 'Card', 'notes.md']) {
          await place(b, id, z); await b.eval('napkin.select(null)'); await sleep(200);
          assert.equal(await b.eval(`getComputedStyle(document.querySelector('#overlay-select')).display`), 'none', `${th} ${id} at ${z * 100}%: nothing is selected`);
          let L = await labelBox(b, id); for (let i = 0; i < 20; i++) { await sleep(150); const n = await labelBox(b, id); const same = Math.abs(n.top - L.top) < 0.1; L = n; if (same) break; } // (a card that is still loading settles first)
          await io.move(L.x, L.y); await io.press(L.x, L.y); await io.release(L.x, L.y); await sleep(350); // the first click of the pair: selects
          const after = await labelBox(b, id);
          assert.ok(Math.abs(after.top - L.top) <= 0.5 && Math.abs(after.gap - L.gap) <= 0.5, `${th} ${id} at ${z * 100}%: selecting does not move the label (${L.top.toFixed(1)} to ${after.top.toFixed(1)}, gap ${L.gap.toFixed(1)} to ${after.gap.toFixed(1)})`);
          await io.dblclick(L.x, L.y); await sleep(350);
          if (id === 'notes.md') { // a file card has no rename (standards 3: only frames and components are named by their label): the double-click leaves it selected, and where it was
            assert.equal(await b.eval(`getComputedStyle(document.querySelector('#overlay-select')).display`), 'block', `${th} ${id} at ${z * 100}%: still selected after the double-click`);
            const again = await labelBox(b, id); assert.ok(Math.abs(again.top - L.top) <= 0.5, `${th} ${id} at ${z * 100}%: the label is where it was after the double-click`);
          } else assert.equal(await b.eval(`document.activeElement?.className`), 'nk-rename', `${th} ${id} at ${z * 100}%: the double-click opens rename`);
          await io.key('Escape'); await sleep(150);
        }
      }
    }
  } finally { await close(); }
});

// ---- the selected frame's width chrome: the grip, its ring, the width caption, the drag badge, the "before" note, the rename message ----
test('round 6: the width grip, its caption and the drag badge use the chrome tokens at 100% and 200%, in both themes', { timeout: 280000 }, async () => {
  const { b, io, close } = await boot({}, 2);
  try {
    for (const th of ['light', 'dark']) {
      await theme(b, th); await sleep(500);
      for (const z of [1, 2]) {
        const tag = `${th} at ${z * 100}%`;
        // the frame's right edge (the grip) at x = 800, whatever the zoom; the frame is selected by a click on its empty background
        await b.eval(`(() => { const r = napkin.view.rectToWorld(document.querySelector('${S('orbit.html')} > .frame').getBoundingClientRect()); return napkin.view.set({ x: 800 - (r.x + r.w) * ${z}, y: 300 - r.y * ${z}, z: ${z} }); })()`); await sleep(500);
        await b.eval(`(() => { const g = document.querySelector('${S('orbit.html')} .cell-grip').getBoundingClientRect(); napkin.view.panBy(800 - (g.left + g.width / 2), 0); })()`); await sleep(400);
        { const f = JSON.parse(await b.eval(`JSON.stringify((() => { const r = document.querySelector('${S('orbit.html')} > .frame').getBoundingClientRect(); return { x: Math.min(r.right - 60, 760), y: r.top + r.height * 0.9 }; })())`)); await io.click(f.x, f.y); await sleep(500); } // (empty background of the frame: selects it)
        await io.key('Shift'); await b.eval(`document.querySelector('${S('orbit.html')} .cell-grip').focus()`); await sleep(300); // (a key was the last input: the focus is a keyboard focus)
        const m = JSON.parse(await b.eval(`JSON.stringify((() => {
          const g = document.querySelector('${S('orbit.html')} .cell-grip'), gs = getComputedStyle(g), r = g.getBoundingClientRect(), cap = document.querySelector('${S('orbit.html')} figcaption'), cs = getComputedStyle(cap), cr = cap.getBoundingClientRect();
          return { w: r.width, ring: parseFloat(gs.outlineWidth) * ${z}, off: parseFloat(gs.outlineOffset) * ${z}, capPx: parseFloat(cs.fontSize) * cr.width / cap.offsetWidth, capLh: parseFloat(cs.lineHeight) * cr.width / cap.offsetWidth, capFam: cs.fontFamily,
                   dur: getComputedStyle(g, '::after').transitionDuration };
        })())`));
        assert.ok(m.w >= 24 - 0.5, `${tag}: the grip is at least 24 px wide on screen (${m.w})`);
        assert.ok(Math.abs(m.ring - 2) <= 0.3 && Math.abs(m.off - 2) <= 0.3, `${tag}: the focus ring is 2 px at a 2 px offset on screen (${m.ring} / ${m.off})`);
        assert.ok(Math.abs(m.capPx - 11) <= 0.3 && Math.abs(m.capLh - 16) <= 0.5, `${tag}: the width caption is 11/16 px on screen (${m.capPx}/${m.capLh})`);
        const sans = await b.eval(`getComputedStyle(document.querySelector('${S('orbit.html')} .cmp-title h3')).fontFamily`);
        assert.equal(m.capFam, sans, `${tag}: the caption is in the chrome face`);
        // reduced motion: no transition on the grip
        await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(200);
        assert.equal(await b.eval(`getComputedStyle(document.querySelector('${S('orbit.html')} .cell-grip'), '::after').transitionDuration`), '0s', `${tag}: no transition on the grip under reduced motion`);
        await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        // dragging: the badge and the "before" note
        const g = JSON.parse(await b.eval(`JSON.stringify((() => { const r = document.querySelector('${S('orbit.html')} .cell-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; })())`)); // (near the top of the grip: the middle of the edge is the selected element's own size handle)
        await io.move(g.x, g.y); await io.press(g.x, g.y); await io.move(g.x - 30 * z, g.y, { buttons: 1 }); await io.move(g.x - 50 * z, g.y, { buttons: 1 }); await sleep(400);
        const d = JSON.parse(await b.eval(`JSON.stringify((() => {
          const c = document.querySelector('${S('orbit.html')} .doc-cell'), cap = c.querySelector('figcaption'), cs = getComputedStyle(cap), k = cap.getBoundingClientRect() , sc = k.width / cap.offsetWidth;
          const was = c.querySelector('.cell-was'), ws = was.querySelector('span').getBoundingClientRect(), wb = was.getBoundingClientRect(), fr = c.querySelector('iframe').getBoundingClientRect();
          return { px: parseFloat(cs.fontSize) * sc, weight: cs.fontWeight, padY: parseFloat(cs.paddingTop) * sc, padX: parseFloat(cs.paddingLeft) * sc, radius: parseFloat(cs.borderTopLeftRadius) * sc, fam: cs.fontFamily,
                   wasInside: ws.top < fr.bottom - 0.5 && ws.bottom > fr.top && ws.left < fr.right && ws.right > fr.left, wasPx: parseFloat(getComputedStyle(was.querySelector('span')).fontSize) * ws.width / was.querySelector('span').offsetWidth };
        })())`));
        await io.release(g.x - 50 * z, g.y); await sleep(300);
        assert.ok(Math.abs(d.px - 11) <= 0.3, `${tag}: the drag badge text is 11 px on screen (${d.px})`);
        assert.equal(d.weight, '600', `${tag}: the badge uses the strong weight token`);
        assert.ok(Math.abs(d.padY - 0) <= 0.3 && Math.abs(d.padX - 4) <= 0.3 && Math.abs(d.radius - 4) <= 0.3, `${tag}: badge padding 0 4 and radius 4 on screen (${d.padY}, ${d.padX}, ${d.radius})`);
        assert.equal(d.fam, sans, `${tag}: the badge is in the chrome face`);
        assert.ok(Math.abs(d.wasPx - 11) <= 0.3, `${tag}: the before note is 11 px on screen (${d.wasPx})`);
        assert.equal(d.wasInside, false, `${tag}: the before note sits clear of the artwork`);
      }
    }
  } finally { await close(); }
});

test('round 6: a refused rename says so at 11/16 px', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot({ 'taken.html': page }, 3);
  try {
    await place(b, 'orbit.html', 1); await b.eval('napkin.select(null)'); await sleep(200);
    const L = await labelBox(b, 'orbit.html'); await io.dblclick(L.x, L.y); await sleep(400);
    await b.eval(`(() => { const i = document.querySelector('.nk-rename'); i.select(); document.execCommand('insertText', false, 'taken'); })()`); await io.key('Enter'); await sleep(400);
    const lh = await b.eval(`getComputedStyle(document.querySelector('.nk-rename-msg')).lineHeight + ' ' + getComputedStyle(document.querySelector('.nk-rename-msg')).fontSize`);
    assert.equal(lh, '16px 11px', 'the refusal reads at the label size and the chrome line height');
  } finally { await close(); }
});
