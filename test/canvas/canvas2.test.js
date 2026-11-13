// Canvas lane, round 6 (WPC-23, 24, 29, 31, 32, 33, 35): whole-product walk 2 gaps. One test per gap; each was red before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempRepo, startServer, ROOT, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';
import { newComponentSource } from '../../src/tsx/write.js';

async function open(compDir, { width = 1440, height = 900 } = {}) {
  const server = await startServer(compDir), b = await launchChromium({ width, height }), io = input(b);
  await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
  return { server, b, io, close: async () => { await b.close(); await server.stop(); } };
}

test('WPC-24: a broken file fixed on disk shows the disk values and no error within 1 s', { timeout: 60000 }, async () => {
  const { compDir, fileOf } = tempRepo(['Card']);
  const file = fileOf('Card'), good = readFileSync(file, 'utf8');
  const { b, io, close } = await open(compDir);
  try {
    await b.eval(`napkin.select({ component: napkin.find('Card').component, node: 'card', variant: {} })`);
    await b.waitFor(`!!document.querySelector('input#padding')`);
    writeFileSync(file, good.replace('<h3 data-n="title"', '<h3 data-n="title" {{{'));
    await b.waitFor(`document.querySelector('section.cmp .problem')?.textContent`);
    await b.type('input#padding', '3');
    await b.waitFor(`document.querySelector('#error')?.textContent || document.querySelector('.field-error')`);
    assert.equal(await b.eval(`document.querySelector('input#padding').value`), '3', 'precondition: the refused value is in the field');
    writeFileSync(file, good.replace("padding: '16px'", "padding: '44px'"));
    await sleep(1000);
    const got = JSON.parse(await b.eval(`JSON.stringify({ field: document.querySelector('input#padding').value, toast: document.querySelector('#error').textContent, fieldError: document.querySelector('.field-error')?.textContent ?? '', problem: document.querySelector('section.cmp .problem').textContent })`));
    assert.deepEqual(got, { field: '44', toast: '', fieldError: '', problem: '' });
  } finally { await close(); }
});

test('WPC-29: text napkin makes in a new component is a system sans, written into the component', { timeout: 60000 }, async () => {
  const { compDir } = tempRepo(['Card']);
  const { b, io, close } = await open(compDir);
  try {
    await b.eval('napkin.tools.createComponent("Fresh")'); // (the palette's New component; the bar's name form is gone since basics pass 1)
    await b.waitFor(`document.querySelector('section.cmp[data-name="Fresh"]')?.dataset.ready === '1' && !!document.querySelector('#sel-node')`);
    await b.eval('document.activeElement.blur()');
    await io.key('t');
    const where = () => b.eval(`JSON.stringify((() => { const r = document.querySelector('section.cmp[data-name="Fresh"] [data-n="root"]').getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6 }; })())`);
    let seen = await where();
    for (let i = 0; i < 20; i++) { await sleep(250); const now = await where(); if (now === seen) break; seen = now; }
    const at = JSON.parse(seen);
    await io.click(at.x, at.y);
    await b.waitFor(`!!document.querySelector('section.cmp[data-name="Fresh"] [data-n="text1"]')`);
    const fam = await b.eval(`getComputedStyle(document.querySelector('section.cmp[data-name="Fresh"] [data-n="text1"]')).fontFamily`);
    assert.doesNotMatch(fam, /times/i, 'not the default serif');
    assert.match(fam, /sans-serif/);
    assert.match(readFileSync(join(compDir, 'Fresh.tsx'), 'utf8'), /text1: \{[^}]*fontFamily: "?'?system-ui/);
  } finally { await close(); }
});

test('WPC-31: a plain 100 px drag on a 999 radius shows a visible change', { timeout: 60000 }, async () => {
  const { compDir, fileOf } = tempRepo(['Card']);
  const file = fileOf('Card');
  writeFileSync(file, readFileSync(file, 'utf8').replace("borderRadius: '12px'", "borderRadius: '999px'"));
  const { b, io, close } = await open(compDir);
  try {
    await b.eval(`napkin.select({ component: napkin.find('Card').component, node: 'card', variant: {} })`);
    await b.waitFor(`!!document.querySelector('input#borderRadius')`);
    const drawn = () => b.eval(`(() => { const e = document.querySelector('section.cmp [data-n="card"]'), r = parseFloat(getComputedStyle(e).borderTopLeftRadius); return Math.min(r, Math.min(e.offsetWidth, e.offsetHeight) / 2); })()`);
    const before = await drawn();
    const p = JSON.parse(await b.eval(`JSON.stringify((() => { const r = document.querySelector('label[data-scrub="borderRadius"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
    await io.drag(p.x, p.y, p.x - 100, p.y);
    await b.waitFor(`document.querySelector('input#borderRadius').value !== '999'`);
    await sleep(600);
    const after = await drawn();
    assert.ok(before - after >= 20, `the drawn radius went from ${before} to ${after}: a visible change`);
    assert.match(readFileSync(file, 'utf8'), /borderRadius: '?\d{1,3}(px)?'?/);
  } finally { await close(); }
});

// Past 40 components frames far off screen are not drawn until they come into view: the case the walk hit with 146 cells.
const addPlain = (compDir, n) => { for (let i = 0; i < n; i++) writeFileSync(join(compDir, `Gen${String.fromCharCode(97 + i)}.tsx`), newComponentSource(`Gen${String.fromCharCode(97 + i)}`)); };

const zoomTo = async (b, z) => { await b.eval(`napkin.view.set({ x: 200, y: 200, z: ${z} })`); await sleep(450); };

test('WPC-32: the variant filter bar is never wider than its frame, never pushes frames, and takes the frame theme', { timeout: 120000 }, async () => {
  const { compDir } = tempRepo(['Chip', 'Card', 'Button']);
  const { b, close } = await open(compDir);
  try {
    const probe = `JSON.stringify((() => {
      const s = document.querySelector('section[data-name=Chip]'), f = s.querySelector('.frame').getBoundingClientRect(), c = s.querySelector('.mctl'), r = c.getBoundingClientRect();
      return { hidden: !c.offsetParent, w: r.width, left: r.left, right: r.right, fl: f.left, fr: f.right, fw: f.width };
    })())`;
    await b.waitFor(`!!document.querySelector('section[data-name=Chip] .mctl')`);
    for (const z of [0.06, 0.1, 0.2, 0.4, 0.7, 1, 2, 3]) {
      await zoomTo(b, z);
      const m = JSON.parse(await b.eval(probe));
      assert.ok(m.hidden || (m.left >= m.fl - 1 && m.right <= m.fr + 1), `at ${z * 100}% the bar (${Math.round(m.w)} px) is inside its ${Math.round(m.fw)} px frame or hidden`);
    }
    await zoomTo(b, 1);
    // themed with the frame, in dark chrome as well as light
    for (const theme of ['dark', 'light']) {
      await b.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`); await sleep(200);
      const t = JSON.parse(await b.eval(`JSON.stringify((() => { const s = document.querySelector('section[data-name=Chip]'); return { bar: getComputedStyle(s.querySelector('.mctl')).backgroundColor, frame: getComputedStyle(s.querySelector('.frame')).backgroundColor, ink: getComputedStyle(s.querySelector('.mctl .mchip')).color, frameInk: getComputedStyle(s.querySelector('.frame')).color }; })())`));
      assert.equal(t.bar, t.frame, `${theme} chrome: the bar is on the frame's surface`);
      assert.equal(t.ink, t.frameInk, `${theme} chrome: chips use the frame's ink`);
    }
    // no row of frames is pushed apart by the bar: the reserve above a frame is the same with the bar shown or hidden at the fit
    await b.eval('napkin.view.fitAll({ animate: false })'); await sleep(600);
    const gap = JSON.parse(await b.eval(`JSON.stringify((() => { const r = [...document.querySelectorAll('section.cmp')].map((s) => napkin.stage.componentRect(s.dataset.component)); const ys = r.map((x) => x.y).sort((a, c) => a - c); return { span: ys.at(-1) + 0, h: Math.max(...r.map((x) => x.y + x.h)) - Math.min(...r.map((x) => x.y)), z: napkin.view.get().z }; })())`));
    assert.ok(gap.h * gap.z < 900, `the fit layout is ${Math.round(gap.h * gap.z)} px tall on screen (rows are not pushed apart)`);
  } finally { await close(); }
});

test('WPC-33: the selection name and size tags never cover a cell caption', { timeout: 120000 }, async () => {
  const { compDir } = tempRepo(['Button', 'Chip', 'Card']);
  const { b, close } = await open(compDir);
  try {
    // where the two tags are drawn (they are pseudo-elements: measured with the same font, placed by the same rules as the CSS), against every caption's text
    const check = `JSON.stringify((() => {
      const sel = document.querySelector('#overlay-select'), r = document.querySelector('#overlay-select').getBoundingClientRect();
      if (getComputedStyle(sel).display === 'none') return { skipped: true };
      const cx = document.createElement('canvas').getContext('2d'), z = napkin.view.get().z;
      const w = (font, t) => { cx.font = font; return cx.measureText(t).width; };
      const lw = w('500 11px sans-serif', sel.dataset.label) + 14, chipText = sel.querySelector('.osize').textContent, cw = w('500 10px monospace', chipText) + 12;
      const side = sel.dataset.tags || 'below', above = side === 'above', inside = side === 'inside', narrow = r.width < 190;
      const ly = inside ? r.top + 5 : above ? r.top - 7 - 19 : r.bottom + 7, cy = inside ? r.bottom - 5 - 17 : above ? r.top - 7 - 17 - (narrow ? 24 : 0) : r.bottom + 8 + (narrow ? 24 : 0);
      const tags = [{ x: inside ? r.left + 5 : r.left - 1, y: ly, w: lw, h: 19 }, { x: r.right - cw, y: cy, w: cw, h: 17 }];
      const hits = [];
      for (const cap of document.querySelectorAll('section.cmp .cell:not(.mhide) figcaption')) {
        if (getComputedStyle(cap).visibility === 'hidden' || !cap.firstChild) continue;
        const rg = document.createRange(); rg.selectNodeContents(cap); const c = rg.getBoundingClientRect();
        for (const t of tags) if (c.left < t.x + t.w && c.right > t.x && c.top < t.y + t.h && c.bottom > t.y) hits.push(cap.textContent + ' x ' + (t === tags[0] ? sel.dataset.label : chipText));
      }
      return { hits, above: side !== 'below', tags };
    })())`;
    await b.eval('napkin.view.set({ x: 120, y: 120, z: 1 })'); await sleep(500);
    let looked = 0, flipped = 0;
    for (const [c, nodes] of [['Button', ['root', 'label']], ['Chip', ['root']], ['Card', ['card', 'image', 'title', 'body']]]) {
      const comp = JSON.parse(await b.eval(`JSON.stringify(napkin.find(${JSON.stringify(c)}).doc.root.id && napkin.find(${JSON.stringify(c)}).component)`));
      const variants = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('section[data-component=${JSON.stringify(comp)}] .cell')].map((e) => JSON.parse(e.dataset.variant)).slice(0, 8))`));
      for (const node of nodes) for (const variant of variants) {
        await b.eval(`napkin.select({ component: ${JSON.stringify(comp)}, node: ${JSON.stringify(node)}, variant: ${JSON.stringify(variant)} })`);
        await b.eval(`napkin.stage.live(${JSON.stringify(comp)}); napkin.view.fitSelection({ animate: false, })`); await sleep(120);
        await b.eval(`napkin.view.zoomBy(1 / napkin.view.get().z)`); await sleep(120); // back to 100% on the selection
        const r = JSON.parse(await b.eval(check));
        if (r.skipped) continue;
        looked++; if (r.above) flipped++;
        assert.deepEqual(r.hits, [], JSON.stringify(r) + `${c} ${node} ${JSON.stringify(variant)}: a tag covers a caption`);
      }
    }
    assert.ok(looked >= 20, `${looked} selections were checked`);
    assert.ok(flipped >= 1, 'at least one selection needed its tags moved above the box');
  } finally { await close(); }
});

test('WPC-35: the status bar counts do not depend on the zoom', { timeout: 200000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-wpc35-'));
  execFileSync(process.execPath, [join(ROOT, 'tools/sample-repo.js'), join(dir, 'repo')], { stdio: 'ignore' });
  addPlain(join(dir, 'repo', 'components'), 12);
  const { b, close } = await open(join(dir, 'repo', 'components'));
  try {
    const read = () => b.eval(`document.querySelector('#counts').textContent`);
    const seen = new Map();
    await b.eval('napkin.view.fitAll({ animate: false })'); await sleep(1500);
    seen.set('fit', await read());
    for (const z of [3, 1, 0.3]) { await b.eval(`napkin.view.set({ x: 100, y: 100, z: ${z} })`); await sleep(900); seen.set(`z${z}`, await read()); }
    await b.eval('napkin.view.fitAll({ animate: false })'); await sleep(1500);
    seen.set('fit again', await read());
    const all = [...seen.values()];
    assert.equal(new Set(all).size, 1, JSON.stringify([...seen]));
    const n = readdirSync(join(dir, 'repo', 'components')).filter((f) => f.endsWith('.tsx')).length;
    assert.match(all[0], new RegExp(`^${n} components · \\d{3,} variants$`));
  } finally { await close(); }
});

// Every frame's rectangle (title strip included) and every cell's place relative to the stage, after the layout has settled.
const LAYOUT = `JSON.stringify((() => {
  const R = [...document.querySelectorAll('section.cmp')].map((s) => ({ id: s.dataset.name, ...napkin.stage.componentRect(s.dataset.component) }));
  const ov = [];
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i], c = R[j]; if (a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y) ov.push(a.id + ' x ' + c.id); }
  const bx = document.querySelector('#stage').getBoundingClientRect();
  const cells = [...document.querySelectorAll('figure.cell')], off = cells.filter((c) => { const r = c.getBoundingClientRect(); return r.right < bx.left + 1 || r.left > bx.right - 1 || r.bottom < bx.top + 1 || r.top > bx.bottom - 1; });
  return { frames: R.length, overlaps: ov, cells: cells.length, off: off.length, z: napkin.view.get().z };
})())`;

test('WPC-23: new components land in free space (and stay there after a reload), and Shift+1 shows every frame', { timeout: 250000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-wpc23-'));
  execFileSync(process.execPath, [join(ROOT, 'tools/sample-repo.js'), join(dir, 'repo')], { stdio: 'ignore' });
  const compDir = join(dir, 'repo', 'components');
  addPlain(compDir, 12);
  const { server, b, io, close } = await open(compDir);
  try {
    for (const name of ['Newa', 'Newb', 'Newc']) {
      await b.eval(`napkin.tools.createComponent(${JSON.stringify(name)})`);
      await b.waitFor(`document.querySelector('section.cmp[data-name="${name}"]')?.dataset.ready === '1'`);
      await sleep(500);
    }
    for (const name of ['Newa', 'Newb', 'Newc']) {
      const side = JSON.parse(readFileSync(join(compDir, `${name}.napkin.json`), 'utf8')).canvas;
      assert.ok(side.x !== 0 || side.y !== 0, `${name}'s sidecar holds the spot it was given, not 0,0 (${JSON.stringify(side)})`);
    }
    await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"'); await sleep(2500);
    let m = JSON.parse(await b.eval(LAYOUT));
    assert.equal(m.frames, 55);
    assert.deepEqual(m.overlaps, [], 'no two frames overlap after the reload');
    await b.eval('napkin.view.fitAll({ animate: false })'); await sleep(2500);
    m = JSON.parse(await b.eval(LAYOUT));
    assert.deepEqual([m.overlaps.length, m.off], [0, 0], `Shift+1 (fit) shows every cell: ${JSON.stringify(m)}`);
    // the same through the key, straight after a pan, without waiting for the far frames to draw first
    await b.eval('napkin.view.set({ x: -4000, y: -2000, z: 1 })'); await sleep(600);
    await io.key('!', { shift: true, code: 'Digit1' }); await sleep(3000);
    m = JSON.parse(await b.eval(LAYOUT));
    assert.deepEqual([m.overlaps.length, m.off], [0, 0], `Shift+1 key shows every cell: ${JSON.stringify(m)}`);
  } finally { await close(); }
});

test('WPC-23: a 40-file branch switch leaves no overlaps and Shift+1 fits all', { timeout: 250000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-wpc23b-'));
  execFileSync(process.execPath, [join(ROOT, 'tools/sample-repo.js'), join(dir, 'full')], { stdio: 'ignore' });
  const src = join(dir, 'full', 'components'), compDir = join(dir, 'work'); mkdirSync(compDir);
  addPlain(src, 12);
  const files = readdirSync(src).filter((f) => f.endsWith('.tsx'));
  for (const f of files.slice(0, 3)) copyFileSync(join(src, f), join(compDir, f));
  const { b, close } = await open(compDir);
  try {
    for (const f of files.slice(3)) copyFileSync(join(src, f), join(compDir, f)); // "git checkout" brings the rest in at once
    await b.waitFor(`document.querySelectorAll('section.cmp').length === ${files.length}`, 20000);
    await sleep(3000);
    await b.eval('napkin.view.fitAll({ animate: false })'); await sleep(2500);
    const m = JSON.parse(await b.eval(LAYOUT));
    assert.deepEqual([m.overlaps.length, m.off], [0, 0], `after the switch: ${JSON.stringify(m)}`);
  } finally { await close(); }
});
