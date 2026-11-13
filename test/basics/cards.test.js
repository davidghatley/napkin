// Basics: cards on the canvas (docs/basics/standards.md sections 3, 5 and 10). What a person notices about the cards of the design-core kinds
// (an HTML frame, a TSX and a JSX component, a stylesheet, an SVG, a raster picture, Markdown, text): one label style, one gap, one surface,
// pages that read as pages, hover and selection outlines of one weight. Later passes add arrangement and fit, and the status bar, here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { tempRepo, startServer, sleep, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

// A w x h PNG of horizontal colour bands, made here so the folder needs no binary fixture.
function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) row.set(y < h / 2 ? [21, 79, 101] : [240, 189, 69], 1 + x * 3); rows.push(row); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// The folder: one card of every design-core kind. `kind` names the card by what a person would call it.
const KINDS = { landing: 'html', Card: 'tsx', Badge: 'jsx', 'theme.css': 'css', 'mark.svg': 'svg', 'photo.png': 'png', 'notes.md': 'md', 'readme.txt': 'txt' };
function folder() {
  const r = tempRepo(['Card']);
  writeFileSync(join(r.compDir, 'landing.html'), `<!doctype html><html><body style="margin:0;font:16px system-ui"><main style="padding:32px"><h1>Plan the week</h1><p>One page, one list.</p></main></body></html>\n`);
  writeFileSync(join(r.compDir, 'Badge.jsx'), `export default function Badge({ label = "New" }) { return <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: 12, background: "#154f65", color: "#fff", font: "600 14px system-ui" }}>{label}</span>; }\n`);
  writeFileSync(join(r.compDir, 'theme.css'), `:root { --ink: #1d2433; --paper: #fbf7ef; }\nbody { margin: 0; color: var(--ink); background: var(--paper); }\n`);
  writeFileSync(join(r.compDir, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 20 20"><path d="M2 2h16L2 18z" fill="#1d2433"/></svg>\n`);
  writeFileSync(join(r.compDir, 'photo.png'), png(160, 100));
  writeFileSync(join(r.compDir, 'notes.md'), '# Notes\n\nThe shell comes **first**, then the cards.\n\n- one label style\n- one surface\n');
  writeFileSync(join(r.compDir, 'readme.txt'), 'Orbit 731\nA bright circle on a quiet page.\n');
  return r;
}

const theme = (b, want) => b.eval(`(() => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== ${JSON.stringify(want)}) document.querySelector('#theme-toggle').click(); })()`);
async function axe(b, include) {
  if (!(await b.eval('!!window.axe'))) await b.eval(AXE);
  return JSON.parse(await b.eval(`axe.run({ include: ${JSON.stringify(include.map((s) => [s]))} }, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))))`));
}
// Every card's anatomy as the screen shows it: the label's type and colour, the gap under it, the surface, the frame's box.
const cards = (b) => b.eval(`JSON.stringify([...document.querySelectorAll('#world > section[data-component]')].map((s) => {
  const h = s.querySelector('.cmp-title h3'), p = s.querySelector('.cmp-path'), t = s.querySelector('.cmp-title'), f = s.querySelector(':scope > .frame');
  const hs = getComputedStyle(h), ps = getComputedStyle(p), fs = getComputedStyle(f), tr = t.getBoundingClientRect(), fr = f.getBoundingClientRect();
  const mono = [...s.querySelectorAll('.cmp-head *')].filter((e) => e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden' && /mono/i.test(getComputedStyle(e).fontFamily)).map((e) => e.className);
  return { id: s.dataset.name, name: h.textContent, ext: p.hidden ? '' : p.textContent, family: hs.fontFamily, size: hs.fontSize, weight: hs.fontWeight, color: hs.color,
    extFamily: ps.fontFamily, extSize: ps.fontSize, extColor: ps.color, mono, gap: fr.top - tr.bottom, left: tr.left - fr.left,
    shadow: fs.boxShadow, radius: fs.borderRadius, frame: { l: fr.left, t: fr.top, w: fr.width, h: fr.height }, z: napkin.view.get().z };
}))`).then(JSON.parse);
const accent = (b) => b.eval(`(() => { const e = document.createElement('i'); e.style.color = 'var(--nk-accent)'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
const ink = (b, v) => b.eval(`(() => { const e = document.createElement('i'); e.style.color = 'var(${v})'; document.querySelector('#stage').append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);

// One server and one browser for a test: the folder above, opened, every card drawn.
async function boot(size = [1440, 900]) {
  const r = folder();
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: size[0], height: size[1] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`document.querySelectorAll('#world > section[data-component][data-ready]:not([data-awaiting])').length >= ${Object.keys(KINDS).length}`, 30000);
  await b.waitFor(`[...napkin.stage.sections.values()].filter((s) => s.docFrame && !s.item).every((s) => s.docFrame.iframe())`, 30000);
  await sleep(600);
  const io = input(b);
  await io.move(4, 890); // the pointer rests on the status bar, away from every card
  return { b, io, close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
}

test('cards: one label style, one gap, one surface for every design-core kind', { timeout: 120000 }, async () => {
  const { b, close } = await boot();
  try {
    for (const th of ['light', 'dark']) {
      await theme(b, th); await sleep(300);
      const all = await cards(b);
      for (const n of Object.keys(KINDS)) assert.ok(all.some((c) => c.id === n), `a card for ${n} (${KINDS[n]}): ${all.map((c) => c.id)}`);
      const rest = await ink(b, '--nk-ink-muted');
      for (const c of all) {
        const what = `${th} ${c.id}`;
        // the label: Inter, 11 px, regular, muted at rest; the extension after it in the same type; no monospace anywhere in it
        assert.match(c.family, /Inter/, what); assert.equal(c.size, '11px', what); assert.equal(c.weight, '400', what);
        assert.equal(c.color, rest, `${what}: the name is muted at rest`);
        assert.equal(c.extFamily, c.family, `${what}: the extension is in the name's family`); assert.equal(c.extSize, c.size, what);
        assert.deepEqual(c.mono, [], `${what}: no monospace in the label`);
        // the name is said once: "orbit" then ".html", never "orbit · orbit.html" or "orbit  orbit.html"
        assert.doesNotMatch(c.name, / · /, what);
        assert.ok(!c.ext || !c.name.includes(c.ext.replace(/^\./, '')) || c.ext.startsWith('.'), `${what}: "${c.name}" "${c.ext}"`);
        assert.ok(!c.ext || c.ext.startsWith('.'), `${what}: the quiet half is the extension (${c.ext})`);
        // 4 px above the top-left corner, at this zoom
        assert.ok(Math.abs(c.gap - 4) <= 0.5, `${what}: label-to-card gap ${c.gap.toFixed(2)} px`);
        assert.ok(Math.abs(c.left) <= 0.5, `${what}: the label starts at the card's left edge (${c.left})`);
        // one surface: a hairline, square corners
        assert.equal(c.radius, '0px', `${what}: square corners`);
        assert.equal((c.shadow.match(/-?[\d.]+px/g) || []).join(' '), '0px 0px 0px 1px', `${what}: one 1 px edge, no drop shadow (${c.shadow})`);
      }
      assert.equal(new Set(all.map((c) => c.color)).size, 1, 'one label colour at rest');
      assert.equal(new Set(all.map((c) => c.extColor)).size, 1, 'one extension colour');
      assert.equal(new Set(all.map((c) => c.shadow)).size, 1, `one card edge: ${[...new Set(all.map((c) => c.shadow))]}`);
      assert.ok(Math.max(...all.map((c) => c.gap)) - Math.min(...all.map((c) => c.gap)) <= 0.5, 'one gap');
    }
  } finally { await close(); }
});

test('cards: text and Markdown read as clean pages, pictures and components are sized to what they show', { timeout: 120000 }, async () => {
  const { b, close } = await boot();
  try {
    const page = (id) => b.eval(`JSON.stringify((() => {
      const s = document.querySelector('section[data-component="${id}"]'), cell = s.querySelector('.kind-cell');
      const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); if (m.length > 3 && m[3] === 0) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const dark = [...cell.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none' && (lum(getComputedStyle(e).backgroundColor) ?? 1) < 0.4).map((e) => e.className);
      const text = cell.querySelector('.kind-page'), ts = text && getComputedStyle(text);
      return { dark, strip: !!cell.querySelector('.kind-headline, .kind-stamp'), words: cell.innerText.replace(/\\s+/g, ' ').trim(), size: ts?.fontSize, family: ts?.fontFamily, pad: ts?.paddingLeft, w: s.querySelector(':scope > .frame').offsetWidth, h: s.querySelector(':scope > .frame').offsetHeight };
    })())`).then(JSON.parse);
    // at every zoom band (the dark "TXT / 27 bytes" strip used to appear zoomed out)
    for (const z of [1, 0.5, 0.2]) {
      await b.eval(`napkin.view.set({ x: 40, y: 80, z: ${z} })`); await sleep(400);
      for (const id of ['notes.md', 'readme.txt']) {
        const p = await page(id);
        assert.equal(p.strip, false, `${id} at ${z}: no kind strip or byte stamp`);
        assert.deepEqual(p.dark, [], `${id} at ${z}: nothing dark on the page`);
        assert.doesNotMatch(p.words, /\bbytes\b|^(TXT|MD)\b/, `${id} at ${z}: ${p.words}`);
      }
    }
    const md = await page('notes.md'), txt = await page('readme.txt');
    assert.match(md.words, /^Notes The shell comes first, then the cards\. one label style one surface$/, 'Markdown is drawn, not shown as source');
    assert.equal(await b.eval(`document.querySelector('section[data-component="notes.md"] strong')?.textContent`), 'first');
    for (const [id, p] of [['notes.md', md], ['readme.txt', txt]]) {
      assert.ok(parseFloat(p.size) >= 13, `${id}: readable type (${p.size})`); assert.doesNotMatch(p.family, /mono/i, id);
      assert.ok(parseFloat(p.pad) >= 16, `${id}: a page margin (${p.pad})`);
      assert.ok(p.w <= 480 && p.h <= 340 && p.h <= 200, `${id}: a short note is a small card (${p.w} x ${p.h})`);
    }
    // a picture takes its own proportions (160 x 100 drawn at 240 x 150), not a 480 x 340 box with bands of empty space
    const pic = await page('photo.png');
    assert.deepEqual([pic.w, pic.h], [240, 150]);
    // a JSX component hugs its content: the badge is not a speck in a 640 px page
    const badge = JSON.parse(await b.eval(`JSON.stringify((() => { const s = napkin.stage.sections.get(napkin.find('Badge').component), d = s.docFrame.doc(), e = d.querySelector('#root > *').getBoundingClientRect(); return { frame: s.frame.offsetWidth, content: e.width }; })())`));
    assert.ok(badge.frame < 640 && badge.frame <= Math.max(120, badge.content + 48), `the Badge card hugs its content: ${JSON.stringify(badge)}`);
  } finally { await close(); }
});

test('cards: hover is a 1 px accent outline, selection 2 px, the label turns ink; axe finds nothing serious on the canvas', { timeout: 150000 }, async (t) => {
  const { b, io, close } = await boot();
  try {
    for (const th of ['light', 'dark']) {
      await theme(b, th); await sleep(300);
      const acc = await accent(b), inkc = await ink(b, '--nk-ink');
      for (const id of ['notes.md', 'photo.png', 'theme.css', 'landing.html']) {
        const sec = `section[data-component="${id}"]`;
        // the card in the middle of the canvas, at 80%, with nothing moving
        await b.eval(`(() => { const r = napkin.view.rectToWorld(document.querySelector('${sec} > .frame').getBoundingClientRect()), box = napkin.view.stageBox(); return napkin.view.set({ x: box.width / 2 - r.x * 0.8, y: 200 - r.y * 0.8, z: 0.8 }); })()`); await sleep(400);
        const h = JSON.parse(await b.eval(`JSON.stringify(document.querySelector('${sec} .cmp-title h3').getBoundingClientRect())`));
        // hover the label: the card is outlined 1 px in the accent, exactly around it, and the name turns ink
        await io.move(h.x + 4, h.y + h.height / 2); await sleep(250);
        const hov = JSON.parse(await b.eval(`JSON.stringify((() => { const o = document.querySelector('#overlay-hover'), cs = getComputedStyle(o), r = o.getBoundingClientRect(), f = document.querySelector('${sec} > .frame').getBoundingClientRect(); return { shown: cs.display !== 'none', style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, fit: Math.max(Math.abs(r.left - f.left), Math.abs(r.top - f.top), Math.abs(r.width - f.width), Math.abs(r.height - f.height)), label: getComputedStyle(document.querySelector('${sec} .cmp-title h3')).color }; })())`));
        assert.ok(hov.shown, `${th} ${id}: hovering the label outlines the card`);
        assert.deepEqual([hov.style, hov.width, hov.color], ['solid', '1px', acc], `${th} ${id}: 1 px accent`);
        assert.ok(hov.fit <= 1, `${th} ${id}: the outline is the card's box (${hov.fit})`);
        assert.equal(hov.label, inkc, `${th} ${id}: the name turns ink on hover`);
        // click it: selected, 2 px accent, the name ink, no hover outline on top
        await io.click(h.x + 4, h.y + h.height / 2); await sleep(300);
        const sel = JSON.parse(await b.eval(`JSON.stringify((() => { const o = document.querySelector('#overlay-select'), cs = getComputedStyle(o); return { shown: cs.display !== 'none', style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, hoverOnCard: (() => { const o = document.querySelector('#overlay-hover'), r = o.getBoundingClientRect(), f = document.querySelector('${sec} > .frame').getBoundingClientRect(); return getComputedStyle(o).display !== 'none' && Math.abs(r.left - f.left) <= 1 && Math.abs(r.top - f.top) <= 1 && Math.abs(r.width - f.width) <= 1; })(), label: getComputedStyle(document.querySelector('${sec} .cmp-title h3')).color }; })())`));
        assert.ok(sel.shown, `${th} ${id}: selected`);
        assert.deepEqual([sel.style, sel.width, sel.color], ['solid', '2px', acc], `${th} ${id}: 2 px accent`);
        assert.equal(sel.label, inkc, `${th} ${id}: the name is ink while selected`);
        assert.ok(!sel.hoverOnCard, `${th} ${id}: no hover outline over the selected card`);
        await io.move(4, 890); await io.key('Escape'); await sleep(150);
      }
      const v = await axe(b, ['#stage']);
      t.diagnostic(`${th}: ${v.length} serious or critical violations on the canvas`);
      assert.deepEqual(v, [], th);
    }
  } finally { await close(); }
});
