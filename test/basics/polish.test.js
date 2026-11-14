// Basics polish (docs/basics/standards.md sections 3, 5 and 10): the canvas chrome measured in a real browser, in both themes, over the
// artwork it annotates. Each test pins one finding of the round 4 audit: contrast over light and dark artwork, one label rule at low zoom,
// the chrome tokens on the distance labels and the card focus ring, a blank HTML card with a frame of its own, the drawer button's active state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const page = (bg) => `<!doctype html><html><body style="margin:0;background:${bg};width:240px;height:140px"></body></html>\n`;
async function boot(size = [1280, 720], files = {}, count = 3) {
  const r = tempRepo(['Card']);
  writeFileSync(join(r.compDir, 'white.html'), page('#fff'));
  writeFileSync(join(r.compDir, 'black.html'), page('#000'));
  for (const [n, body] of Object.entries(files)) writeFileSync(join(r.compDir, n), body);
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: size[0], height: size[1] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`document.querySelectorAll('#world > section[data-component][data-ready]:not([data-awaiting])').length >= ${count}`, 30000);
  await b.waitFor(`[...napkin.stage.sections.values()].filter((s) => s.docFrame && !s.item).every((s) => s.docFrame.iframe())`, 30000);
  await sleep(600);
  const io = input(b);
  await io.move(4, size[1] - 10);
  return { b, io, close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
}
const theme = (b, want) => b.eval(`(() => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== ${JSON.stringify(want)}) document.querySelector('#theme-toggle').click(); })()`);
const rgb = (s) => (s.match(/rgba?\(([^)]+)\)/)?.[1] ?? '').split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(Number);
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, c) => { const [x, y] = [lum(rgb(a)), lum(rgb(c))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const centre = (b, sec) => b.eval(`JSON.stringify((() => { const r = document.querySelector('section[data-component="${sec}"] > .frame').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`).then(JSON.parse);
const label = (b, sec) => b.eval(`JSON.stringify((() => { const r = document.querySelector('section[data-component="${sec}"] .cmp-title h3').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; })())`).then(JSON.parse);

test('polish: selection and measurement chrome keeps 3:1 over a white card and a black card, in both themes', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot();
  try {
    for (const th of ['light', 'dark']) {
      await theme(b, th); await sleep(900);
      const canvas = await b.eval(`getComputedStyle(document.querySelector('#stage')).backgroundColor || getComputedStyle(document.body).backgroundColor`);
      const L = await label(b, 'white.html');
      await io.click(L.x, L.y); await sleep(300);
      // the selection: the accent itself when it holds 3:1 against the artwork, else it must sit between halos that do
      const sel = JSON.parse(await b.eval(`JSON.stringify((() => { const s = getComputedStyle(document.querySelector('#overlay-select')); return { outline: s.outlineColor, shadow: s.boxShadow }; })())`));
      const halos = [...sel.shadow.matchAll(/rgba?\([^)]+\)/g)].map((m) => m[0]);
      for (const [name, art] of [['white', 'rgb(255, 255, 255)'], ['black', 'rgb(0, 0, 0)']]) {
        const direct = ratio(sel.outline, art) >= 3;
        const haloed = halos.some((h) => ratio(sel.outline, h) >= 3 && ratio(h, art) >= 3);
        assert.ok(direct || haloed, `${th}: the selection outline holds 3:1 over ${name} artwork (outline ${sel.outline} ${ratio(sel.outline, art).toFixed(2)}:1; halos ${halos})`);
      }
      // the distance: hold Alt over the other card
      const B = await centre(b, 'black.html');
      await io.down('Alt', { alt: true }); await io.move(B.x, B.y, { alt: true }); await sleep(300);
      const m = JSON.parse(await b.eval(`JSON.stringify((() => { const l = document.querySelector('.m-label'); if (!l) return null; const s = getComputedStyle(l), ln = getComputedStyle(document.querySelector('.m-line')); return { fg: s.color, bg: s.backgroundColor, edge: s.boxShadow.match(/rgba?\\([^)]+\\)/)?.[0] ?? '', line: ln.borderTopColor === 'rgba(0, 0, 0, 0)' ? ln.borderLeftColor : ln.borderTopColor }; })())`));
      assert.ok(m, `${th}: the distance label is drawn`);
      assert.ok(ratio(m.fg, m.bg) >= 4.5, `${th}: the distance text holds 4.5:1 on its badge (${m.fg} on ${m.bg}: ${ratio(m.fg, m.bg).toFixed(2)})`);
      for (const [name, art] of [['white', 'rgb(255, 255, 255)'], ['black', 'rgb(0, 0, 0)'], ['the canvas', canvas]]) {
        const lifted = ratio(m.bg, art) >= 3 || (m.edge && ratio(m.edge, art) >= 3 && ratio(m.bg, m.edge) >= 3); // the badge itself, or the badge inside an edge that does
        assert.ok(lifted, `${th}: the badge holds 3:1 over ${name} [${art}] (${m.bg} edge ${m.edge}: ${ratio(m.bg, art).toFixed(2)})`);
        assert.ok(ratio(m.line, art) >= 3, `${th}: the distance line holds 3:1 over ${name} (${m.line}: ${ratio(m.line, art).toFixed(2)})`);
      }
      await io.up('Alt'); await io.move(4, 710); await io.key('Escape'); await sleep(150);
    }
  } finally { await close(); }
});

test('polish: below 25% every card label, file cards and HTML and component cards alike, keeps one size and one gap', { timeout: 150000 }, async () => {
  const { b, close } = await boot([1280, 720], { 'notes.md': '# Notes\n\nhello\n', 'theme.css': ':root { --ink: #123; }\n', 'readme.txt': 'plain text\n' }, 6);
  try {
    const labels = () => b.eval(`JSON.stringify([...document.querySelectorAll('#world > section[data-component]:not([data-awaiting])')].map((s) => {
      const t = s.querySelector('.cmp-title'), h = t.querySelector('h3'), tr = t.getBoundingClientRect(), fr = s.querySelector(':scope > .frame').getBoundingClientRect();
      return { id: s.dataset.component, far: s.hasAttribute('data-far'), cull: s.hasAttribute('data-cull'), px: parseFloat(getComputedStyle(h).fontSize) * tr.height / t.offsetHeight, gap: fr.top - tr.bottom };
    }))`).then(JSON.parse);
    for (const z of [0.2, 0.17, 0.1, 0.07]) {
      await b.eval(`napkin.view.set({ x: 640, y: 300, z: ${z} })`); await sleep(600);
      const all = (await labels()).filter((l) => !l.far && !l.cull); // (a card a viewport away is not drawn, and its label rides unscaled)
      assert.ok(all.length >= 6, `every card is drawn (${all.length})`);
      for (const l of all) {
        assert.ok(Math.abs(l.px - 11) <= 0.25, `${l.id} at ${z * 100}%: the label is drawn at 11 px (${l.px.toFixed(2)})`);
        assert.ok(Math.abs(l.gap - 4) <= 0.5, `${l.id} at ${z * 100}%: 4 px under it (${l.gap.toFixed(2)})`);
      }
    }
  } finally { await close(); }
});
