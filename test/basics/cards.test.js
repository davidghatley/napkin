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
function folder(extra = {}) {
  const r = tempRepo(['Card']);
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(r.compDir, name), body);
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
  const pr = p.getBoundingClientRect(), shown = pr.width > 0 && ps.display !== 'none' && ps.visibility !== 'hidden' && pr.right <= tr.right + 0.5; // drawn, and not cut off by the label's edge
  return { id: s.dataset.name, name: h.textContent, ext: shown ? p.textContent : '', family: hs.fontFamily, size: hs.fontSize, weight: hs.fontWeight, color: hs.color,
    extFamily: ps.fontFamily, extSize: ps.fontSize, extColor: ps.color, mono, gap: fr.top - tr.bottom, left: tr.left - fr.left,
    shadow: fs.boxShadow, radius: fs.borderRadius, frame: { l: fr.left, t: fr.top, w: fr.width, h: fr.height }, z: napkin.view.get().z };
}))`).then(JSON.parse);
const accent = (b) => b.eval(`(() => { const e = document.createElement('i'); e.style.color = 'var(--nk-accent)'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
const ink = (b, v) => b.eval(`(() => { const e = document.createElement('i'); e.style.color = 'var(${v})'; document.querySelector('#stage').append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);

// One server and one browser for a test: the folder above, opened, every card drawn.
async function boot(size = [1440, 900], extra = {}, count = Object.keys(KINDS).length) {
  const r = folder(extra);
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: size[0], height: size[1] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`document.querySelectorAll('#world > section[data-component][data-ready]:not([data-awaiting])').length >= ${count}`, 30000);
  await b.waitFor(`[...napkin.stage.sections.values()].filter((s) => s.docFrame && !s.item).every((s) => s.docFrame.iframe())`, 30000);
  await sleep(600);
  const io = input(b);
  await io.move(4, size[1] - 10); // the pointer rests on the status bar, away from every card
  return { b, io, dir: r.compDir, close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
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

// Empty and failed cards: an editable component of empty frames (the frame tool's dashed frame, nothing in it), a component that returns nothing,
// a TSX that does not parse, a PNG that is not one and an SVG that does not parse.
const BLANK = `import type { CSSProperties } from 'react';
export interface BlankProps {}
type Styles = Record<string, CSSProperties>;
const base: Styles = {
  root: { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, boxSizing: 'border-box' },
  frame1: { display: 'flex', flexDirection: 'column', gap: 8, padding: 8, boxSizing: 'border-box', border: '1px dashed #9a927f', minWidth: 48, minHeight: 32, width: 208, height: 48 },
};
const variants: Record<string, Record<string, Styles>> = {};
function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}
export function Blank({}: BlankProps) {
  const v = {};
  return (
    <div data-n="root" style={s('root', v)}>
      <div data-n="frame1" style={s('frame1', v)} />
    </div>
  );
}
`;
const STATES = {
  'Blank.tsx': BLANK,
  'Nothing.tsx': 'export default function Nothing() { return null; }\n',
  'Broken.tsx': 'export default function Broken() {\n  return <div>oops</div\n}\n',
  'broken.png': 'not a png at all',
  'broken.svg': '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"</svg>\n',
};

test('cards: an empty component and a failed render say so plainly, on the same surface under the same label', { timeout: 150000 }, async (t) => {
  const { b, dir, close } = await boot([1440, 900], STATES);
  const idOf = (name) => b.eval(`(napkin.find(${JSON.stringify(name)}) || {}).component || ${JSON.stringify(name)}`);
  try {
    await b.waitFor(`document.querySelectorAll('#world .card-state').length >= 5`, 30000);
    await sleep(300);
    const ids = { blank: await idOf('Blank'), nothing: await idOf('Nothing'), broken: await idOf('Broken'), png: 'broken.png', svg: 'broken.svg' };
    for (const th of ['light', 'dark']) {
      await theme(b, th); await sleep(300);
      const ok = (await cards(b)).find((c) => c.id === 'notes.md'); // a healthy card's label, for comparison
      const look = (id) => b.eval(`JSON.stringify((() => {
        const s = document.querySelector('#world > section[data-component="${id}"]'), f = s.querySelector(':scope > .frame'), st = s.querySelector('.card-state');
        const fr = f.getBoundingClientRect(), sr = st?.getBoundingClientRect(), h = s.querySelector('.cmp-title h3'), hs = getComputedStyle(h);
        const title = st?.querySelector('.card-state-title'), detail = st?.querySelector('.card-state-detail');
        const cell = st?.parentElement, cs = cell && getComputedStyle(cell), ifr = cell?.querySelector(':scope > iframe.doc-frame');
        const inside = (r) => r.width > 0 && r.height > 0 && r.left >= fr.left - 0.5 && r.right <= fr.right + 0.5 && r.top >= fr.top - 0.5 && r.bottom <= fr.bottom + 0.5;
        const kids = st ? [...st.querySelectorAll('*')] : [];
        return { state: st?.dataset.state, text: st?.innerText.replace(/\\s+/g, ' ').trim(), full: st?.title || '', inside: !!sr && inside(sr) && kids.every((e) => inside(e.getBoundingClientRect())),
          fits: kids.every((e) => e.scrollWidth <= e.clientWidth + 1), w: f.offsetWidth, h: f.offsetHeight,
          family: getComputedStyle(st || s).fontFamily, sizes: kids.map((e) => getComputedStyle(e).fontSize), mono: kids.some((e) => /mono/i.test(getComputedStyle(e).fontFamily)),
          titleColor: title && getComputedStyle(title).color, detailColor: (detail || st) && getComputedStyle(detail || st).color,
          label: { family: hs.fontFamily, size: hs.fontSize, weight: hs.fontWeight, color: hs.color, gap: fr.top - s.querySelector('.cmp-title').getBoundingClientRect().bottom },
          shadow: getComputedStyle(f).boxShadow, radius: getComputedStyle(f).borderRadius, bg: getComputedStyle(st || f).backgroundColor,
          cellBorder: cs ? [cs.borderTopStyle, cs.borderTopColor] : null, iframeShown: !!ifr && getComputedStyle(ifr).visibility !== 'hidden' };
      })())`).then(JSON.parse);
      const tok = (v) => b.eval(`(() => { const e = document.createElement('i'); e.style.color = 'var(${v})'; e.style.colorScheme = 'light'; document.querySelector('#world').append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
      const danger = await tok('--nk-danger-ink'), muted = await tok('--nk-ink-muted');
      const all = {};
      for (const [k, id] of Object.entries(ids)) {
        const c = all[k] = await look(id), what = `${th} ${k}`;
        // the same label and surface as a healthy card
        assert.deepEqual([c.label.family, c.label.size, c.label.weight, c.label.color], [ok.family, ok.size, ok.weight, ok.color], `${what}: the label is the cards' label`);
        assert.ok(Math.abs(c.label.gap - 4) <= 0.5, `${what}: 4 px under the label (${c.label.gap})`);
        assert.equal(c.radius, '0px', what); assert.equal(c.shadow, ok.shadow, `${what}: the cards' one edge`);
        // the words: inside the card, in the chrome's type (Inter 11 or 12 px), never monospace, never cut sideways
        assert.ok(c.inside, `${what}: the state is drawn inside the card`); assert.ok(c.fits, `${what}: no line runs out of its box`);
        assert.match(c.family, /Inter/, what); assert.equal(c.mono, false, `${what}: no monospace`);
        for (const z of c.sizes) assert.ok(['11px', '12px'].includes(z), `${what}: type ${c.sizes}`);
      }
      // empty: named, quiet, centred words; no chrome dashed box around it; the empty page is not shown
      assert.equal(all.blank.state, 'empty'); assert.equal(all.blank.text, 'Empty frame', `${th}: the frame-only component names itself`);
      assert.ok(all.blank.cellBorder[1] === 'rgba(0, 0, 0, 0)' || all.blank.cellBorder[0] === 'none', `${th}: no dashed cell around the empty frame (${all.blank.cellBorder})`);
      assert.equal(all.blank.detailColor, muted, `${th}: the empty line is muted`);
      assert.equal(all.nothing.state, 'empty'); assert.match(all.nothing.text, /^Renders nothing/, th);
      assert.equal(all.nothing.iframeShown, false, `${th}: the empty page is not drawn as a blank box`);
      assert.ok(all.nothing.w <= 240 && all.nothing.h <= 64, `${th}: compact (${all.nothing.w} x ${all.nothing.h})`);
      // failed: what failed in danger ink, then the first line of why; the whole text is the tooltip; one size for every error card
      for (const [k, title, why] of [['broken', 'Build error', /^Line \d+: .+/], ['png', 'Image error', /PNG/], ['svg', 'SVG error', /line 1/i]]) {
        const c = all[k], what = `${th} ${k}`;
        assert.equal(c.state, 'error', what);
        assert.ok(c.text.startsWith(title), `${what}: ${c.text}`); assert.match(c.text.slice(title.length).trim(), why, what);
        assert.doesNotMatch(c.text, /napkin could not|Next:|\n|at \w+ \(/, `${what}: one plain line, no stack: ${c.text}`);
        assert.equal(c.titleColor, danger, `${what}: danger ink`); assert.equal(c.detailColor, muted, `${what}: the reason is muted`);
        assert.equal(c.iframeShown, false, `${what}: no broken page or picture shown`);
        assert.deepEqual([c.w, c.h], [all.broken.w, all.broken.h], `${what}: one error card size`);
      }
      assert.match(all.broken.full, /could not build .*line \d+/, 'the whole build error is the tooltip');
      const v = await axe(b, ['#stage']);
      t.diagnostic(`${th}: ${v.length} serious or critical violations with the state cards`);
      assert.deepEqual(v, [], th);
    }
    // fixed and saved: the error card goes and the component is drawn again
    writeFileSync(join(dir, 'Broken.tsx'), 'export default function Broken() {\n  return <div style={{ padding: 16 }}>fixed</div>;\n}\n');
    await b.waitFor(`[...document.querySelectorAll('#world > section[data-component]')].some((s) => /^Broken/.test(s.dataset.component) && !s.querySelector('.card-state') && s.querySelector('iframe.doc-frame')?.contentDocument?.body?.innerText.includes('fixed'))`, 30000);
  } finally { await close(); }
});

// ------------------------------------------------------------------------------------------------ the opening arrangement and fit
// A folder like the view-basics specimen: two components called Orbit (a .jsx and a .tsx), pictures that share a name, notes as Markdown and text.
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const CLASH = {
  'Orbit.jsx': 'export default function Orbit({tone="gold"}){return <button style={{background:tone==="gold"?"#f0bd45":"#154f65",padding:24}}>Launch 731</button>}\n',
  'Orbit.tsx': 'type Props = { tone?: "gold" | "blue" };\nexport default function Orbit({tone="gold"}: Props){return <button style={{background:tone==="gold"?"#f0bd45":"#154f65",padding:24}}>Launch 731</button>}\n',
  'spectrum.png': png(320, 200), 'spectrum.gif': GIF,
  'spectrum.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 16 10"><rect width="16" height="10" fill="#154f65"/></svg>\n',
  'notes.txt': 'Orbit 731\nA bright circle.\n',
};
const CLASH_COUNT = Object.keys(KINDS).length + Object.keys(CLASH).length;
// What the screen shows: the visible canvas (between the side panels, under the top bar, over the status bar) and every card's box, its label included.
const sight = (b) => b.eval(`JSON.stringify((() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const shown = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  const stage = R(document.querySelector('#stage')), side = document.querySelector('#sidebar'), insp = document.querySelector('#inspector');
  const area = { l: Math.max(stage.l, shown(side) ? R(side).r : 0), r: Math.min(stage.r, shown(insp) ? R(insp).l : innerWidth),
    t: Math.max(stage.t, R(document.querySelector('#topbar')).b), b: Math.min(stage.b, R(document.querySelector('#statusbar')).t) };
  const cards = [...document.querySelectorAll('#world > section[data-component]')].filter(shown).map((s) => {
    const f = R(s.querySelector(':scope > .frame')), t = s.querySelector('.cmp-title'), tr = R(t), h = t.querySelector('h3'), p = t.querySelector('.cmp-path'), pr = p.getBoundingClientRect();
    const ext = pr.width > 0 && shown(p) && pr.right <= tr.r + 0.5 && pr.left >= tr.l - 0.5 ? p.textContent : ''; // the extension as drawn: there, not hidden, not cut off
    return { id: s.dataset.component, l: Math.min(f.l, tr.l), r: Math.max(f.r, tr.r), t: Math.min(f.t, tr.t), b: Math.max(f.b, tr.b), text: h.textContent + ext, ext, path: p.textContent, cut: h.scrollWidth > h.clientWidth + 0.5 };
  });
  return { area, cards, z: napkin.view.get().z, sideOpen: shown(side) };
})())`).then(JSON.parse);
function framed(g, what) {
  assert.ok(g.cards.length >= CLASH_COUNT, `${what}: every card is drawn (${g.cards.length})`);
  const { area } = g, ext = { l: Math.min(...g.cards.map((c) => c.l)), r: Math.max(...g.cards.map((c) => c.r)), t: Math.min(...g.cards.map((c) => c.t)), b: Math.max(...g.cards.map((c) => c.b)) };
  for (const c of g.cards) assert.ok(c.l >= area.l - 0.5 && c.r <= area.r + 0.5 && c.t >= area.t - 0.5 && c.b <= area.b + 0.5,
    `${what}: ${c.id} is inside the visible canvas (card ${JSON.stringify([c.l, c.t, c.r, c.b].map(Math.round))}, canvas ${JSON.stringify([area.l, area.t, area.r, area.b].map(Math.round))})`);
  const m = { l: ext.l - area.l, r: area.r - ext.r, t: ext.t - area.t, b: area.b - ext.b };
  assert.ok(Math.abs(m.l - m.r) <= 2, `${what}: even margins left and right (${m.l.toFixed(1)} / ${m.r.toFixed(1)})`);
  assert.ok(Math.abs(m.t - m.b) <= 2, `${what}: even margins top and bottom (${m.t.toFixed(1)} / ${m.b.toFixed(1)})`);
  assert.ok(Math.min(m.l, m.t) >= 16, `${what}: nothing touches the canvas edge (${JSON.stringify(m)})`);
  assert.ok(g.z <= 1, `${what}: never above 100% (${g.z})`);
  if (g.z < 1) assert.ok(Math.min(m.l, m.t) <= 80, `${what}: fitted, not floating small in the middle (${JSON.stringify(m)}, ${g.z})`);
  for (let i = 0; i < g.cards.length; i++) for (let j = i + 1; j < g.cards.length; j++) {
    const a = g.cards[i], c = g.cards[j];
    assert.ok(!(a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b), `${what}: ${a.id} and ${c.id} do not overlap`);
  }
  return m;
}
// every label as drawn is different: its extension is there (not hidden, not cut off) and, at a fit, its name is not cut either
const unique = (g, what, { whole = true } = {}) => {
  for (const c of g.cards) {
    if (c.path) assert.equal(c.ext, c.path, `${what}: ${c.id} shows its extension (${c.path})`);
    if (whole) assert.ok(!c.cut, `${what}: ${c.id}'s name is not cut`);
  }
  const seen = new Map();
  for (const c of g.cards) { assert.ok(!seen.has(c.text), `${what}: "${c.text}" names both ${seen.get(c.text)} and ${c.id}`); seen.set(c.text, c.id); }
};
const shift1 = async (b, io) => { await io.key('!', { shift: true, code: 'Digit1' }); await sleep(900); };

for (const size of [[1440, 900], [1280, 720]]) {
  test(`cards: at ${size.join('x')} the folder opens with every card in view, evenly framed, and Shift+1 frames it the same with either panel state`, { timeout: 150000 }, async () => {
    const { b, io, close } = await boot(size, CLASH, CLASH_COUNT);
    try {
      // right after open, no key pressed
      const first = await sight(b);
      assert.ok(first.sideOpen, 'the left panel is open');
      framed(first, `${size} first view`);
      unique(first, `${size} first view`);
      // Shift+1: the same picture
      await shift1(b, io);
      const fit = await sight(b);
      framed(fit, `${size} Shift+1`);
      unique(fit, `${size} Shift+1`);
      assert.ok(Math.abs(fit.z - first.z) < 0.01, `the first view is the fit (${first.z} / ${fit.z})`);
      // the left panel collapsed (Ctrl+\\): Shift+1 uses the room it leaves
      await io.key('\\', { ctrl: true, code: 'Backslash' }); await sleep(300);
      await shift1(b, io);
      const wide = await sight(b);
      assert.equal(wide.sideOpen, false, 'the left panel is collapsed');
      framed(wide, `${size} Shift+1, left panel collapsed`);
      assert.ok(wide.z >= fit.z - 1e-6, `more room, no smaller (${fit.z} -> ${wide.z})`);
      await io.key('\\', { ctrl: true, code: 'Backslash' }); await sleep(300);
      await shift1(b, io);
      framed(await sight(b), `${size} Shift+1, left panel open again`);
    } finally { await close(); }
  });
}

test('cards: labels keep their extension at every zoom, so same-named files stay apart; the label is 11 px with a 4 px gap on screen at 25%, 100% and 300%', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot([1280, 720], CLASH, CLASH_COUNT);
  try {
    // zoomed out with the keyboard, past the old 40% cut-off where the extension went
    await shift1(b, io);
    await io.move(600, 360);
    for (let i = 0; i < 8 && (await b.eval('napkin.view.get().z')) > 0.2; i++) { await io.key('-'); await sleep(60); }
    await sleep(500);
    for (const g of [await sight(b)]) {
      assert.ok(g.z < 0.4, `zoomed out (${g.z})`);
      // (far out a narrow card's name is cut first, "Or… .jsx"; the extension stays)
      unique(g, `at ${Math.round(g.z * 100)}%`, { whole: false });
      const want = ['Orbit.jsx', 'Orbit.tsx', 'spectrum.png', 'spectrum.gif', 'spectrum.svg', 'notes.md', 'notes.txt'];
      for (const w of want) assert.ok(g.cards.some((c) => c.text === w), `"${w}" keeps its extension at ${Math.round(g.z * 100)}%: ${g.cards.map((c) => c.text)}`);
    }
    const label = () => b.eval(`JSON.stringify([...document.querySelectorAll('#world > section[data-component]:not([data-awaiting])')].map((s) => {
      const t = s.querySelector('.cmp-title'), h = t.querySelector('h3'), tr = t.getBoundingClientRect(), fr = s.querySelector(':scope > .frame').getBoundingClientRect();
      return { id: s.dataset.component, px: parseFloat(getComputedStyle(h).fontSize) * tr.height / t.offsetHeight, gap: fr.top - tr.bottom };
    }))`).then(JSON.parse);
    for (const z of [0.25, 1, 3]) {
      // the zoom from the keyboard's steps would not land on these: set it, as Shift+0 and the presets do
      await b.eval(`(() => { const r = napkin.view.rectToWorld(document.querySelector('section[data-component="notes.md"] > .frame').getBoundingClientRect()); return napkin.view.set({ x: 200 - r.x * ${z}, y: 200 - r.y * ${z}, z: ${z} }); })()`);
      await sleep(500);
      for (const l of await label()) {
        assert.ok(Math.abs(l.px - 11) <= 0.25, `${l.id} at ${z * 100}%: the label is drawn at 11 px (${l.px.toFixed(2)})`);
        assert.ok(Math.abs(l.gap - 4) <= 0.5, `${l.id} at ${z * 100}%: 4 px under it (${l.gap.toFixed(2)})`);
      }
    }
  } finally { await close(); }
});

// The status bar (brief item 3; standards sections 1 and 10): quiet counts of what the folder holds, the drawers as toggle buttons,
// a real zoom control with presets, every control 24 px with a ring the window never cuts, two weights, no monospace, no key-hint row.
test('status bar: counts, drawer toggles and a zoom control with presets, each with a name, a 24 px target, a whole focus ring and its states', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot();
  const bar = () => b.eval(`JSON.stringify((() => {
    const vw = innerWidth, vh = innerHeight, out = [];
    for (const e of document.querySelectorAll('#statusbar button')) {
      if (!e.getBoundingClientRect().width) continue;
      e.focus({ preventScroll: true });
      const r = e.getBoundingClientRect(), s = getComputedStyle(e), ring = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
      out.push({ id: e.id, name: (e.getAttribute('aria-label') || e.textContent).trim(), w: r.width, h: r.height, fv: e.matches(':focus-visible'), style: s.outlineStyle,
        ring: { l: r.left - ring, t: r.top - ring, r: r.right + ring, b: r.bottom + ring }, inside: r.left - ring >= 0 && r.top - ring >= 0 && r.right + ring <= vw && r.bottom + ring <= vh });
    }
    document.activeElement.blur();
    const type = [...document.querySelectorAll('#statusbar, #statusbar *')].filter((e) => e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => ({ n: e.id || e.className?.baseVal || e.className || e.tagName, family: getComputedStyle(e).fontFamily, weight: getComputedStyle(e).fontWeight }));
    return { out, type };
  })())`).then(JSON.parse);
  const z = () => b.eval('napkin.view.get().z');
  const level = () => b.eval(`document.querySelector('#zoom-level').textContent`);
  const menuOpen = () => b.eval(`!document.querySelector('#zoom-menu').hidden && document.querySelector('#zoom-level').getAttribute('aria-expanded') === 'true'`);
  const active = () => b.eval(`document.activeElement.id || document.activeElement.textContent.trim()`);
  const centre = async (sel) => JSON.parse(await b.eval(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
  const item = async (label) => JSON.parse(await b.eval(`JSON.stringify((() => { const i = [...document.querySelectorAll('#zoom-menu .nk-mi')].find((x) => x.querySelector('.nk-ml').textContent === ${JSON.stringify(label)}); const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
  try {
    await b.waitFor(`document.querySelectorAll('#drawer-tabs button').length >= 7`, 10000);
    // counts: the files, as a person counts them; a selection adds itself
    const total = await b.eval('napkin.state.components.total');
    assert.equal(total, await b.eval(`document.querySelectorAll('#world > section[data-component]').length`), 'every file is a card');
    assert.equal(await b.eval(`document.querySelector('#counts').textContent`), `${total} files`);
    const card = await centre('#world > section[data-component="notes.md"] .cmp-title');
    await io.click(card.x, card.y); await sleep(300);
    assert.equal(await b.eval(`document.querySelector('#counts').textContent`), `${total} files · 1 selected`);
    await b.eval('napkin.select(null)'); await io.move(4, 896); await sleep(200);
    assert.equal(await b.eval(`document.querySelector('#counts').textContent`), `${total} files`);
    // no key-hint row at rest: the keys are in the empty panel and the key map
    assert.equal(await b.eval(`document.querySelector('#statusbar .hints').textContent.trim()`), '');
    assert.doesNotMatch(await b.eval(`document.querySelector('#statusbar').innerText`), /fit all|fit selection|focus/i);

    // every control: a name, at least 24 x 24, and the keyboard ring whole inside the window (Tab first, so focus is the keyboard's)
    await io.key('Tab'); await sleep(100);
    const { out, type } = await bar();
    assert.deepEqual(out.map((c) => c.id), ['open-code', 'open-history', 'open-tokens', 'open-inspect', 'open-assets', 'open-changes', 'open-activity', 'zoom-out', 'zoom-level', 'zoom-in', 'zoom-fit']);
    for (const c of out) {
      assert.ok(c.name, `${c.id} has a name`);
      assert.ok(c.w >= 24 && c.h >= 24, `${c.id} is ${c.w}x${c.h}`);
      assert.ok(c.fv && c.style === 'solid', `${c.id} shows the ring on keyboard focus`);
      assert.ok(c.inside, `${c.id}: the ring ${JSON.stringify(c.ring)} stays in the window`);
    }
    for (const t of type) {
      assert.doesNotMatch(t.family, /mono/i, `${t.n}: no monospace in the bar`);
      assert.ok(['400', '600'].includes(t.weight), `${t.n}: weight ${t.weight}`);
    }

    // drawers are toggle buttons: pressed while their drawer is open
    const code = await centre('#open-code');
    assert.equal(await b.eval(`document.querySelector('#open-code').getAttribute('aria-pressed')`), 'false');
    await io.click(code.x, code.y); await sleep(300);
    assert.equal(await b.eval(`document.querySelector('#open-code').getAttribute('aria-pressed')`), 'true');
    assert.equal(await b.eval(`document.querySelectorAll('#drawer-tabs [aria-pressed="true"]').length`), 1);
    await io.click(code.x, code.y); await sleep(300);
    assert.equal(await b.eval(`document.querySelector('#open-code').getAttribute('aria-pressed')`), 'false');

    // the percentage opens the presets with the pointer; a preset changes the zoom and the percentage
    const lvl = await centre('#zoom-level');
    await io.click(lvl.x, lvl.y); await sleep(250);
    assert.ok(await menuOpen(), 'a click opens the presets');
    const menu = JSON.parse(await b.eval(`JSON.stringify((() => { const m = document.querySelector('#zoom-menu'), s = getComputedStyle(m); return { role: m.getAttribute('role'), radius: s.borderRadius,
      shadow: s.boxShadow, rows: [...m.querySelectorAll('.nk-mi')].map((i) => [i.querySelector('.nk-ml').textContent, i.querySelector('.nk-mk')?.textContent || '']), bottom: m.getBoundingClientRect().bottom, top: document.querySelector('#statusbar').getBoundingClientRect().top }; })())`));
    assert.equal(menu.role, 'menu'); assert.equal(menu.radius, '8px');
    assert.equal((menu.shadow.match(/-?[\d.]+px/g) || []).join(' '), '0px 4px 16px 0px', `the one menu shadow (${menu.shadow})`);
    assert.deepEqual(menu.rows, [['Zoom to fit', 'Shift 1'], ['Zoom to selection', 'Shift 2'], ['Zoom to 50%', ''], ['Zoom to 100%', 'Shift 0'], ['Zoom to 200%', '']]);
    assert.ok(menu.bottom <= menu.top, 'the presets open above the bar');
    for (const th of ['light', 'dark']) { await theme(b, th); await sleep(250); assert.deepEqual(await axe(b, ['#statusbar', '#zoom-menu']), [], `${th}: axe, presets open`); }
    const p200 = await item('Zoom to 200%');
    await io.click(p200.x, p200.y); await sleep(700);
    assert.ok(!(await menuOpen()), 'choosing closes the presets');
    assert.ok(Math.abs((await z()) - 2) < 1e-6, `200% (${await z()})`); assert.equal(await level(), '200%');

    // with the keyboard: Enter opens on the first item, Escape closes and gives the focus back; arrows and Enter choose
    await b.eval(`document.querySelector('#zoom-level').focus()`);
    await io.key('Enter'); await sleep(250);
    assert.ok(await menuOpen(), 'Enter opens the presets'); assert.equal(await active(), 'Zoom to fitShift 1');
    await io.key('Escape'); await sleep(150);
    assert.ok(!(await menuOpen()), 'Escape closes'); assert.equal(await active(), 'zoom-level', 'the focus is back on the percentage');
    await io.key('Enter'); await sleep(250);
    await io.key('ArrowDown'); assert.equal(await active(), 'Zoom to 50%', 'Down skips the dimmed Zoom to selection');
    await io.key('Enter'); await sleep(700);
    assert.ok(Math.abs((await z()) - 0.5) < 1e-6, `50% (${await z()})`); assert.equal(await level(), '50%');
    assert.equal(await active(), 'zoom-level');

    // minus: dimmed at the smallest zoom, and a click there does nothing
    const minus = await centre('#zoom-out');
    for (let i = 0; i < 30 && (await b.eval(`document.querySelector('#zoom-out').getAttribute('aria-disabled')`)) !== 'true'; i++) { await io.click(minus.x, minus.y); await sleep(40); }
    assert.equal(await b.eval(`document.querySelector('#zoom-out').getAttribute('aria-disabled')`), 'true', 'minus is disabled at the minimum');
    assert.equal(await level(), '5%');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('#zoom-out')).opacity`), '0.4', 'and looks it');
    const at = await z(); await io.click(minus.x, minus.y); await sleep(200);
    assert.equal(await z(), at, 'no zoom past the minimum');
    assert.equal(await b.eval(`document.querySelector('#zoom-in').getAttribute('aria-disabled')`), 'false');

    // axe on the bar at rest, light and dark
    for (const th of ['light', 'dark']) { await theme(b, th); await sleep(250); assert.deepEqual(await axe(b, ['#statusbar']), [], `${th}: axe on the bar`); }
  } finally { await close(); }
});

// ------------------------------------------------------------------------------------------------ canvas, Layers and panel agree (standards 5.9, 5.10)
const secOf = (b, name) => b.eval(`document.querySelector('#world > section[data-name="${name}"]')?.dataset.component`);
const hoverState = (b, id) => b.eval(`JSON.stringify((() => { const o = document.querySelector('#overlay-hover'), r = o.getBoundingClientRect(), f = document.querySelector('#world > section[data-component="${id}"] > .frame').getBoundingClientRect();
  return { shown: getComputedStyle(o).display !== 'none', fit: Math.max(Math.abs(r.left - f.left), Math.abs(r.top - f.top), Math.abs(r.width - f.width), Math.abs(r.height - f.height)) }; })())`).then(JSON.parse);
const rowState = (b, id) => b.eval(`JSON.stringify((() => { const rows = [...document.querySelectorAll('#layers .lrow')].filter((r) => r.dataset.component === ${JSON.stringify(id)}), on = rows.filter((r) => r.getAttribute('aria-selected') === 'true');
  const armed = (() => { const e = document.createElement('i'); e.style.color = 'var(--nk-armed)'; document.querySelector('#layers').append(e); const c = getComputedStyle(e).color; e.remove(); return c; })();
  return { rows: rows.length, on: on.length, shown: on.length > 0 && on.every((r) => getComputedStyle(r).backgroundColor === armed), others: [...document.querySelectorAll('#layers .lrow[aria-selected="true"]')].filter((r) => r.dataset.component !== ${JSON.stringify(id)}).length }; })())`).then(JSON.parse);
const labelAt = (b, id) => b.eval(`JSON.stringify((() => { const r = document.querySelector('#world > section[data-component="${id}"] .cmp-title h3').getBoundingClientRect(); return { x: r.left + Math.min(6, r.width / 2), y: r.top + r.height / 2 }; })())`).then(JSON.parse);
const panelText = (b) => b.eval(`document.querySelector('#inspector').innerText.replace(/\\s+/g, ' ')`);

test('cards: a Layers file row outlines its card on hover; a card selected on the canvas is the selected row and the panel; no hover outline while dragging', { timeout: 180000 }, async () => {
  const { b, io, close } = await boot();
  try {
    for (const name of Object.keys(KINDS)) {
      const id = await secOf(b, name);
      assert.ok(id, `a card for ${name}`);
      // hover its file row: the card is outlined on the canvas
      const row = JSON.parse(await b.eval(`JSON.stringify((() => { const r = [...document.querySelectorAll('#layers .lrow.lcomp')].find((x) => x.dataset.component === ${JSON.stringify(id)}); r.scrollIntoView({ block: 'nearest' }); const q = r.querySelector('.lname').getBoundingClientRect(); return { x: q.left + 4, y: q.top + q.height / 2 }; })())`));
      await io.move(row.x, row.y); await sleep(200);
      const h = await hoverState(b, id);
      assert.ok(h.shown && h.fit <= 1, `${name}: hovering its Layers row outlines the card (${JSON.stringify(h)})`);
      await io.move(4, 890); await sleep(100);
      assert.ok(!(await hoverState(b, id)).shown, `${name}: the outline goes with the pointer`);
      // click its label on the canvas: the card, its row and the panel say the same thing
      await b.eval('napkin.view.fitAll()'); await sleep(400);
      const l = await labelAt(b, id);
      await io.click(l.x, l.y); await sleep(400);
      assert.ok(await b.eval(`napkin.state.selections.length === 1 && napkin.state.selection.component === ${JSON.stringify(id)}`), `${name}: selected from its label (${await b.eval(`JSON.stringify([napkin.state.selections, document.elementFromPoint(${l.x}, ${l.y})?.outerHTML.slice(0, 120)])`)})`);
      const rs = await rowState(b, id);
      assert.ok(rs.on >= 1 && rs.shown, `${name}: its Layers row is selected and looks it (${JSON.stringify(rs)})`);
      assert.equal(rs.others, 0, `${name}: no other row is selected`);
      assert.ok((await panelText(b)).includes(name.replace(/\.\w+$/, '')), `${name}: the panel names it: ${(await panelText(b)).slice(0, 120)}`);
      await io.move(4, 890); await io.key('Escape'); await sleep(200);
    }
    // drag an unselected card by its label: no hover outline while it moves; it comes back when the pointer is let go
    await b.eval('napkin.view.fitAll()'); await sleep(400);
    const id = await secOf(b, 'notes.md'), l = await labelAt(b, id);
    await io.move(l.x, l.y); await sleep(150);
    assert.ok((await hoverState(b, id)).shown, 'the label hovers the card');
    await io.press(l.x, l.y);
    for (let i = 1; i <= 6; i++) { await io.move(l.x + i * 10, l.y + i * 6, { buttons: 1 }); await sleep(40); }
    assert.ok(!(await hoverState(b, id)).shown, 'no hover outline while dragging');
    await io.release(l.x + 60, l.y + 36); await sleep(200);
    assert.ok((await hoverState(b, id)).shown, 'the hover outline is back once the pointer is let go');
    // a marquee over the cards: no hover outline while it is drawn
    await io.move(4, 890); await sleep(100);
    const box = JSON.parse(await b.eval(`JSON.stringify(napkin.view.stageBox())`));
    await b.eval(`napkin.view.set({ x: 60, y: 60, z: 0.5 })`); await sleep(400);
    const x0 = box.left + box.width - 12, y0 = box.top + box.height - 12;
    await io.move(x0, y0); await io.press(x0, y0);
    let seen = false;
    for (let i = 1; i <= 10; i++) { await io.move(x0 - i * box.width / 12, y0 - i * box.height / 12, { buttons: 1 }); await sleep(30); seen ||= await b.eval(`getComputedStyle(document.querySelector('#overlay-hover')).display !== 'none'`); }
    await io.release(x0 - box.width * 10 / 12, y0 - box.height * 10 / 12); await sleep(150);
    assert.ok(!seen, 'no hover outline while a marquee is drawn');
  } finally { await close(); }
});

test('cards: an empty, a failed and a throwing component are selectable from their label and their row; Shift 2 fits the state card; the panel names the file', { timeout: 180000 }, async () => {
  const STATE3 = { 'Nothing.tsx': STATES['Nothing.tsx'], 'Broken.tsx': STATES['Broken.tsx'], 'Thrower.tsx': 'export default function Thrower() { throw new Error("boom"); }\n' };
  const { b, io, close } = await boot([1440, 900], STATE3);
  try {
    await b.waitFor(`['Nothing', 'Broken', 'Thrower'].every((n) => document.querySelector('#world > section[data-name="' + n + '"] .card-state'))`, 30000);
    await sleep(300);
    for (const name of ['Nothing', 'Broken', 'Thrower']) {
      const id = await secOf(b, name);
      // from the label
      await b.eval(`napkin.view.fitAll()`); await sleep(400);
      const l = await labelAt(b, id);
      await io.click(l.x, l.y); await sleep(400);
      assert.ok(await b.eval(`napkin.state.selections.length === 1 && napkin.state.selection.component === ${JSON.stringify(id)}`), `${name}: selected from its label (${await b.eval('JSON.stringify(napkin.state.selections)')})`);
      const sel = JSON.parse(await b.eval(`JSON.stringify((() => { const o = document.querySelector('#overlay-select'), r = o.getBoundingClientRect(), f = document.querySelector('#world > section[data-component="${id}"] > .frame').getBoundingClientRect(); return { shown: getComputedStyle(o).display !== 'none', fit: Math.max(Math.abs(r.left - f.left), Math.abs(r.top - f.top), Math.abs(r.width - f.width), Math.abs(r.height - f.height)) }; })())`));
      assert.ok(sel.shown && sel.fit <= 1, `${name}: the card is outlined as selected (${JSON.stringify(sel)})`);
      const rs = await rowState(b, id);
      assert.ok(rs.on >= 1 && rs.shown, `${name}: its row is selected (${JSON.stringify(rs)})`);
      assert.ok((await panelText(b)).includes(name), `${name}: the panel names the file: ${(await panelText(b)).slice(0, 160)}`);
      // Shift 2: the state card fills the view
      await io.key('@', { shift: true, code: 'Digit2' }); await sleep(900);
      const fit = JSON.parse(await b.eval(`JSON.stringify((() => { const f = document.querySelector('#world > section[data-component="${id}"] > .frame').getBoundingClientRect(), s = napkin.view.stageBox(); return { inside: f.left >= s.left - 1 && f.right <= s.right + 1 && f.top >= s.top - 1 && f.bottom <= s.bottom + 1, share: Math.max(f.width / s.width, f.height / s.height), text: document.querySelector('#world > section[data-component="${id}"] .card-state p:last-child').getBoundingClientRect().height }; })())`));
      assert.ok(fit.inside && fit.share > 0.3, `${name}: Shift 2 frames the state card (${JSON.stringify(fit)})`);
      assert.ok(fit.text >= 14, `${name}: its words are readable after the fit (${fit.text})`);
      await io.move(4, 890); await io.key('Escape'); await sleep(200);
      // from the row
      await b.eval(`napkin.view.fitAll()`); await sleep(400);
      const row = JSON.parse(await b.eval(`JSON.stringify((() => { const r = [...document.querySelectorAll('#layers .lrow.lcomp')].find((x) => x.dataset.component === ${JSON.stringify(id)}); r.scrollIntoView({ block: 'nearest' }); const q = r.querySelector('.lname').getBoundingClientRect(); return { x: q.left + 4, y: q.top + q.height / 2 }; })())`));
      await io.click(row.x, row.y); await sleep(400);
      assert.ok(await b.eval(`napkin.state.selections.length === 1 && napkin.state.selection.component === ${JSON.stringify(id)}`), `${name}: selected from its row`);
      assert.ok((await rowState(b, id)).on >= 1, `${name}: the row shows it`);
      await io.move(4, 890); await io.key('Escape'); await sleep(200);
    }
  } finally { await close(); }
});

test('cards: a keyboard selection rings the card label, a pointer selection does not; the rename field is 24 px with the field focus', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot();
  try {
    const acc = await accent(b);
    const ring = (id) => b.eval(`JSON.stringify((() => { const t = document.querySelector('#world > section[data-component="${id}"] .cmp-title'), s = getComputedStyle(t); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, offset: s.outlineOffset }; })())`).then(JSON.parse);
    const md = await secOf(b, 'notes.md');
    // a pointer click on the row: selected, no ring on the label
    const row = JSON.parse(await b.eval(`JSON.stringify((() => { const r = [...document.querySelectorAll('#layers .lrow.lcomp')].find((x) => x.dataset.component === ${JSON.stringify(md)}); r.scrollIntoView({ block: 'nearest' }); const q = r.querySelector('.lname').getBoundingClientRect(); return { x: q.left + 4, y: q.top + q.height / 2 }; })())`));
    await io.click(row.x, row.y); await sleep(300);
    assert.equal(await b.eval('napkin.state.selection?.component'), md);
    assert.equal((await ring(md)).style, 'none', 'a pointer selection draws no ring on the label');
    // ArrowDown in Layers: the next file is selected from the keyboard, and its label carries the ring
    await io.key('ArrowDown'); await sleep(400);
    const next = await b.eval('napkin.state.selection?.component');
    assert.notEqual(next, md, 'ArrowDown moved the selection');
    const r = await ring(next);
    assert.deepEqual([r.style, r.width, r.color, r.offset], ['solid', '2px', acc, '2px'], `the keyboard selection rings its label (${JSON.stringify(r)})`);
    assert.equal((await ring(md)).style, 'none', 'the ring left the previous label');
    // a pointer click on a label: no ring
    await b.eval('napkin.view.fitAll()'); await sleep(400);
    const html = await secOf(b, 'landing'), l = await labelAt(b, html);
    await io.click(l.x, l.y); await sleep(300);
    assert.equal(await b.eval('napkin.state.selection?.component'), html);
    assert.equal((await ring(html)).style, 'none', 'a label click draws no ring');
    assert.equal((await ring(next)).style, 'none');
    // rename in place: the field is at least 24 px high, in the chrome's type, with the field focus (2 px accent)
    await b.eval(`napkin.view.set({ ...napkin.view.get(), z: 1 })`); await sleep(400);
    const l2 = await labelAt(b, html);
    await io.dblclick(l2.x, l2.y); await sleep(300);
    const f = JSON.parse(await b.eval(`JSON.stringify((() => { const i = document.querySelector('.nk-rename'); if (!i) return null; const s = getComputedStyle(i), r = i.getBoundingClientRect(); return { h: r.height, focused: document.activeElement === i, family: s.fontFamily, size: s.fontSize, outline: [s.outlineStyle, s.outlineWidth, s.outlineColor], radius: s.borderRadius }; })())`));
    assert.ok(f, 'double-click opens the rename field');
    assert.ok(f.h >= 24 - 0.5, `the rename field is at least 24 px high (${f.h})`);
    assert.ok(f.focused, 'and has the focus');
    assert.match(f.family, /Inter/); assert.equal(f.size, '12px', 'field type');
    assert.deepEqual(f.outline, ['solid', '2px', acc], 'the shared field focus ring');
    assert.equal(f.radius, '4px');
    await io.key('Escape'); await sleep(200);
  } finally { await close(); }
});

test('status bar: the zoom presets close when the canvas moves or the tool changes; Enter on a preset runs only the preset', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot();
  try {
    const open = () => b.eval(`!document.querySelector('#zoom-menu').hidden`);
    const lvl = JSON.parse(await b.eval(`JSON.stringify((() => { const r = document.querySelector('#zoom-level').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
    const box = JSON.parse(await b.eval(`JSON.stringify(napkin.view.stageBox())`));
    await io.click(lvl.x, lvl.y); await sleep(250);
    assert.ok(await open(), 'the presets open');
    await io.wheel(box.left + box.width / 2, box.top + box.height / 2, 0, 120); await sleep(300);
    assert.ok(!(await open()), 'scrolling the canvas closes the presets');
    await io.click(lvl.x, lvl.y); await sleep(250);
    assert.ok(await open());
    await b.eval(`document.querySelector('#zoom-menu').focus()`);
    await io.key('f'); await sleep(250);
    assert.ok(!(await open()), 'changing the tool closes the presets');
    await io.key('v'); await sleep(150);
    // with a card selected, Enter on a preset zooms and does not also focus the card
    const id = await secOf(b, 'notes.md'), l = await labelAt(b, id);
    await io.click(l.x, l.y); await sleep(300);
    await b.eval(`document.querySelector('#zoom-level').focus()`);
    await io.key('Enter'); await sleep(250);
    await io.key('ArrowDown'); await io.key('ArrowDown'); await io.key('ArrowDown'); await sleep(100);
    assert.equal(await b.eval(`document.activeElement.querySelector('.nk-ml')?.textContent`), 'Zoom to 100%');
    await io.key('Enter'); await sleep(700);
    assert.ok(Math.abs((await b.eval('napkin.view.get().z')) - 1) < 1e-6, 'the preset ran');
    assert.equal(await b.eval('document.body.dataset.focus || ""'), '', 'Enter did not also focus the selected card');
  } finally { await close(); }
});
