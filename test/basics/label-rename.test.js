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
