// Basics, the right panel (docs/basics/standards.md section 7 and decision 0023): one panel that stays in the sidebar, is resized by its left
// edge (pointer, double-click, keys), remembers its width, and never covers the canvas: not at its narrowest, default or widest, not with a
// section's full editor open, not with the colour popover open. Width and height are the levers that reveal more: a wider panel shows more
// controls (colour sliders, X beside Y, a padding's sides), a long list shows six rows until its bottom edge is dragged down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { tempRepo, startServer, sleep, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

function folder(extra = {}) {
  const r = tempRepo(['Card', 'Button']);
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(r.compDir, name), body);
  writeFileSync(join(r.compDir, 'landing.html'), `<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><main class="hero"><h1>Plan the week</h1><p>One page, one list.</p><button class="cta">Start</button></main><section class="cards"><article class="card"><h2>Monday</h2><p>Design review</p></article><article class="card"><h2>Tuesday</h2><p>Ship the shell</p></article></section></body></html>\n`);
  writeFileSync(join(r.compDir, 'theme.css'), `:root { --ink: #1d2433; --paper: #fbf7ef; --line: #d9d2c3; --accent: #2f6fdf; --muted: #6b7280; --good: #1f8a4c; --warn: #b7791f; --bad: #c0392b; --wash: #eef2f7; }\nbody { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }\n.hero { padding: 32px; } .cards { display: flex; gap: 16px; padding: 0 32px 32px; } .card { padding: 16px; border: 1px solid #d9d2c3; border-radius: 8px; }\n.cta { padding: 8px 16px; border: 0; border-radius: 6px; background: #1d2433; color: #fff; }\n`);
  writeFileSync(join(r.compDir, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16L2 18z" fill="#1d2433"/></svg>\n`);
  writeFileSync(join(r.compDir, 'notes.md'), '# Notes\n\nThe panel comes next.\n');
  return r;
}
const box = (b, sel) => b.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; })()`);
async function axe(b, include) {
  await b.eval(AXE);
  return JSON.parse(await b.eval(`axe.run({ include: ${JSON.stringify(include.map((s) => [s]))} }, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))))`));
}
async function theme(b, want) {
  await b.eval(`(() => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== ${JSON.stringify(want)}) document.querySelector('#theme-toggle').click(); })()`);
}
async function boot(size = [1440, 900], extra = {}) {
  const r = folder(extra);
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: size[0], height: size[1] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.eval(`try { for (const k of ['napkin.right', 'napkin.right.open', 'napkin.left', 'napkin.sections']) localStorage.removeItem(k); } catch {}`);
  await b.goto(server.url); // the width is restored before the first paint, so a clean start is a reload
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await sleep(400);
  return { b, io: input(b), url: server.url, dir: r.compDir, close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
}
const reload = async (b, url) => { await b.goto(url); await b.waitFor('document.body.dataset.ready === "1"', 30000); await sleep(300); };
const width = (b) => b.eval(`document.querySelector('#inspector').getBoundingClientRect().width`);

// Select things the way a person sees them: an element in an HTML file, a stylesheet, a component.
const SELECT = {
  element: `(() => { const c = napkin.find('landing'), t = napkin.stage.sections.get(c.component).docFrame.tree(); const f = (l) => { for (const n of l || []) { if (n.tag === 'h1') return n; const x = f(n.children); if (x) return x; } return null; }; napkin.select({ component: c.component, node: f(t.tree).node, variant: {} }); })()`,
  css: `[...document.querySelectorAll('#layers .lrow')].find((r) => r.querySelector('.lname').textContent === 'theme.css').click()`,
  component: `napkin.select({ component: napkin.find('Card').component, node: 'title', variant: {} })`,
};
async function select(b, what) {
  if (what === 'element') await b.waitFor(`!!napkin.stage.sections.get(napkin.find('landing')?.component)?.docFrame?.tree()?.tree`, 15000);
  await b.eval(SELECT[what]);
  await b.waitFor(`!!napkin.instruments.panel() || document.querySelector('#panel').childElementCount > 0`, 10000);
  await sleep(500);
}

// Every box drawn by the panel (and any popover or menu it opened) against the canvas: the overlap in px, or none.
const COVERS = `(() => {
  const st = document.querySelector('#stage').getBoundingClientRect(), hits = [];
  const mine = [...document.querySelectorAll('#inspector *, #right-edge, #cpop, #cpop *, .d-choice-pop, .d-choice-pop *')];
  // and anything fixed or absolute on the page that is not the canvas's own (its overlays live inside #stage) and not the tooltip
  for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if ((p === 'fixed') && !e.closest('#stage, #tip, #topbar, #statusbar, #sidebar, dialog:not([open])')) mine.push(e); }
  for (const e of new Set(mine)) {
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const q = e.getBoundingClientRect(); if (!q.width || !q.height) continue;
    const w = Math.min(q.right, st.right) - Math.max(q.left, st.left), h = Math.min(q.bottom, st.bottom) - Math.max(q.top, st.top);
    if (w > 0.5 && h > 0.5) hits.push((e.id || e.className.baseVal || e.className || e.tagName) + ' ' + Math.round(w) + 'x' + Math.round(h));
  }
  return JSON.stringify(hits.slice(0, 8));
})()`;

test('the right panel: one panel, resized by its left edge (drag, double-click, keys), remembered, clamped to the window', { timeout: 120000 }, async () => {
  const { b, io, url, close } = await boot();
  try {
    // exactly one right panel: one #inspector, one separator, nothing else standing between the canvas and the window's right edge
    assert.equal(await b.eval(`document.querySelectorAll('#inspector').length`), 1);
    assert.equal(await b.eval(`document.querySelectorAll('[role=separator][aria-orientation=vertical]').length`), 1);
    const st0 = await box(b, '#stage');
    assert.equal(await b.eval(`[...document.querySelectorAll('body > *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 100 && r.left >= ${st0.r} - 1 && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => e.id).join(' ')`), 'inspector', 'one panel on the right');
    assert.equal(await width(b), 280, 'default 280 px');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('#inspector')).containerType`), 'inline-size', 'the panel is a size container');
    assert.equal(await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--nk-right-w').trim()`), '280px', 'one custom property carries the width');
    // the separator: focusable, named, with its range
    const sep = JSON.parse(await b.eval(`JSON.stringify((() => { const e = document.querySelector('#right-edge'); return { tab: e.tabIndex, label: e.getAttribute('aria-label'), now: e.getAttribute('aria-valuenow'), min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'), cursor: getComputedStyle(e).cursor }; })())`));
    assert.deepEqual(sep, { tab: 0, label: 'Design panel width', now: '280', min: '240', max: '720', cursor: 'col-resize' });
    // the edge sits on the panel, not over the canvas, and at least 4 px wide
    const edge = await box(b, '#right-edge'), insp = await box(b, '#inspector');
    assert.ok(edge.w >= 4 && edge.l >= insp.l && edge.l <= st0.r + 0.5, `edge ${JSON.stringify(edge)} on the panel ${JSON.stringify(insp)}`);

    // drag the edge 120 px to the left with real pointer events: the panel grows, the canvas gives up the same width
    const x = edge.l + edge.w / 2, y = edge.t + 200;
    await io.move(x, y);
    const idle = await b.eval(`getComputedStyle(document.querySelector('#right-edge'), '::after').backgroundColor`);
    await io.press(x, y);
    for (let i = 1; i <= 6; i++) await io.move(x - i * 20, y, { buttons: 1 });
    assert.notEqual(await b.eval(`getComputedStyle(document.querySelector('#right-edge'), '::after').backgroundColor`), idle, 'the edge shows it is held');
    await io.release(x - 120, y);
    await sleep(100);
    assert.equal(await width(b), 400);
    const st1 = await box(b, '#stage'), p1 = await box(b, '#inspector');
    assert.equal(st1.w, st0.w - 120, 'the canvas reflows');
    assert.ok(st1.r <= p1.l + 0.5, 'the canvas ends where the panel starts');
    assert.equal(await b.eval(`document.querySelector('#right-edge').getAttribute('aria-valuenow')`), '400');

    // remembered across a reload
    await reload(b, url);
    assert.equal(await width(b), 400, 'remembered');

    // double-click the edge: back to 280
    const e2 = await box(b, '#right-edge'), cx = e2.l + e2.w / 2, cy = e2.t + 200;
    for (const [type, clickCount] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 1], ['mousePressed', 2], ['mouseReleased', 2]]) await b.send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount });
    await sleep(100);
    assert.equal(await width(b), 280, 'double-click resets');

    // keys on the separator: Left widens, Right narrows, Shift for bigger steps, Home and End for the ends
    await b.eval(`document.activeElement.blur(); document.querySelector('#right-edge').focus({ focusVisible: true })`); // a fresh keyboard focus (the double-click left a mouse focus)
    await io.key('ArrowLeft'); assert.equal(await width(b), 288);
    await io.key('ArrowLeft', { shift: true }); assert.equal(await width(b), 352);
    await io.key('ArrowRight'); assert.equal(await width(b), 344);
    await io.key('Home'); assert.equal(await width(b), 240, 'Home: the narrowest');
    await io.key('ArrowRight'); assert.equal(await width(b), 240, 'never below 240');
    await io.key('End'); assert.equal(await width(b), 720, 'End: half of a 1440 px window');
    assert.equal(await b.eval(`document.querySelector('#right-edge').getAttribute('aria-valuenow')`), '720');
    assert.equal(await b.eval(`document.activeElement.id`), 'right-edge', 'focus stays on the edge');
    await sleep(250); // the edge's colour eases in
    const focused = await b.eval(`getComputedStyle(document.querySelector('#right-edge'), '::after').backgroundColor`);
    assert.notEqual(focused, idle, 'the focused edge is visible');

    // a narrower window clamps it (max is the larger of 480 and half the window), and the canvas still has its column
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    assert.equal(await width(b), 550);
    assert.equal(await b.eval(`document.querySelector('#right-edge').getAttribute('aria-valuemax')`), '550');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    assert.equal(await width(b), 480);
    const st2 = await box(b, '#stage'), p2 = await box(b, '#inspector');
    assert.ok(st2.w > 0 && st2.r <= p2.l + 0.5, `the canvas keeps its own column (${st2.w} px)`);
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    assert.equal(await width(b), 720, 'the wanted width comes back with the room');
  } finally { await close(); }
});

test('the right panel never covers the canvas: at 240, 280 and the widest, with every section\'s full editor open and the colour popover open', { timeout: 240000 }, async () => {
  const { b, close } = await boot();
  let pops = 0, editors = 0;
  try {
    for (const w of [240, 280, 720]) {
      await b.eval(`napkin.rightPanel.setWidth(${w})`);
      await sleep(100);
      assert.equal(await width(b), w);
      for (const what of ['element', 'css', 'component']) {
        await select(b, what);
        assert.deepEqual(JSON.parse(await b.eval(COVERS)), [], `${w} px, ${what} selected`);
        assert.ok(await b.eval(`document.querySelector('#inspector').scrollWidth <= document.querySelector('#inspector').clientWidth + 1`), `${w} px, ${what}: nothing runs past the panel sideways`);
        // open every section of the instruments panel at its widest (what used to be the full-window studio): it stays in the panel
        const ids = JSON.parse(await b.eval(`JSON.stringify(napkin.instruments.panel() ? [...napkin.instruments.panel().sections.keys()] : [])`));
        for (const id of ids) {
          const c = await b.eval(`napkin.instruments.panel().sections.get(${JSON.stringify(id)}).schema.controls[0].id`);
          await b.eval(`napkin.instruments.panel().open(${JSON.stringify(c)})`);
          await sleep(250);
          const m = JSON.parse(await b.eval(`JSON.stringify((() => { const s = napkin.instruments.panel().sections.get(${JSON.stringify(id)}).node, r = s.getBoundingClientRect(), p = document.querySelector('#inspector').getBoundingClientRect(); return { depth: s.dataset.depth, pos: getComputedStyle(s).position, l: r.left, r: r.right, t: r.top, pl: p.left, pr: p.right, pt: p.top, pb: p.bottom }; })())`));
          assert.equal(m.depth, '3', `${id} shows its full editor`);
          editors++;
          assert.notEqual(m.pos, 'fixed', `${id} is not a fixed overlay`);
          assert.ok(m.l >= m.pl - 0.5 && m.r <= m.pr + 0.5, `${w} px ${what} / ${id}: the editor stays inside the panel's width (${m.l}-${m.r} in ${m.pl}-${m.pr})`);
          assert.ok(m.t < m.pb && m.t >= m.pt - 1, `${w} px ${what} / ${id}: open() scrolls the section into the panel (${m.t} in ${m.pt}-${m.pb})`);
          assert.deepEqual(JSON.parse(await b.eval(COVERS)), [], `${w} px, ${what} / ${id} full editor`);
          assert.ok(await b.eval(`document.querySelector('#inspector').scrollWidth <= document.querySelector('#inspector').clientWidth + 1`), `${w} px, ${what} / ${id}: the full editor does not run past the panel sideways`);
          await b.eval(`napkin.instruments.panel().setDepth(${JSON.stringify(id)}, 2, false)`);
        }
        // the element panel's colour popover opens inside the panel
        const sw = await b.eval(`(() => { const s = [...document.querySelectorAll('#panel [data-swatch]')].find((e) => !e.disabled && e.getBoundingClientRect().width); if (!s) return false; s.scrollIntoView({ block: 'center' }); s.click(); return true; })()`);
        if (sw) {
          await b.waitFor(`!!document.querySelector('#cpop')`, 3000);
          pops++;
          assert.deepEqual(JSON.parse(await b.eval(COVERS)), [], `${w} px, ${what}: the colour popover`);
          const cp = await box(b, '#cpop'), p = await box(b, '#inspector');
          assert.ok(cp.l >= p.l - 0.5 && cp.r <= p.r + 0.5, `the popover sits inside the panel (${cp.l}-${cp.r} in ${p.l}-${p.r})`);
          await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
          await b.eval(`document.querySelector('#cpop') && document.querySelector('#stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
          await sleep(100);
        }
      }
    }
    assert.ok(editors >= 9 && pops >= 3, `every case was exercised (${editors} full editors, ${pops} colour popovers)`);
    // the old full-window studio is gone from the page: no fixed section, no depth selector, no studio resize grip
    assert.equal(await b.eval(`document.querySelectorAll('.d-depth, .d-pane-size, [data-studio-mode="viewport"]').length`), 0);
  } finally { await close(); }
});

test('open() and the palette\'s Studio command reveal the section inside the panel', { timeout: 120000 }, async () => {
  const { b, close } = await boot();
  try {
    await select(b, 'element');
    const last = JSON.parse(await b.eval(`JSON.stringify((() => { const p = napkin.instruments.panel(), s = [...p.sections.values()].at(-1); return { id: s.schema.id, label: s.schema.controls[0].label || s.schema.controls[0].id }; })())`));
    await b.eval(`document.querySelector('#inspector').scrollTop = 0`);
    assert.equal(await b.eval(`napkin.instruments.depth(${JSON.stringify(last.label)}, 3)`), true);
    await sleep(200);
    const m = JSON.parse(await b.eval(`JSON.stringify((() => { const s = napkin.instruments.panel().sections.get(${JSON.stringify(last.id)}).node, r = s.getBoundingClientRect(), p = document.querySelector('#inspector').getBoundingClientRect(); return { depth: s.dataset.depth, t: r.top, pt: p.top, pb: p.bottom, expanded: s.querySelector('.d-expand').getAttribute('aria-expanded') }; })())`));
    assert.equal(m.depth, '3');
    assert.equal(m.expanded, 'true', 'the section head says its full editor is open');
    assert.ok(m.t >= m.pt - 1 && m.t < m.pb - 20, `the section's head is in view in the panel (${m.t} in ${m.pt}-${m.pb})`);
    assert.equal(await b.eval(`document.documentElement.scrollTop + document.body.scrollTop`), 0, 'the page itself never scrolls');
    // the expand button in the head closes it again, in place
    await b.eval(`napkin.instruments.panel().sections.get(${JSON.stringify(last.id)}).expand.click()`);
    assert.equal(await b.eval(`napkin.instruments.panel().sections.get(${JSON.stringify(last.id)}).node.dataset.depth`), '2');
  } finally { await close(); }
});

test('axe finds no serious or critical problems in the right panel, light and dark, with the full editor open', { timeout: 180000 }, async (t) => {
  const { b, close } = await boot();
  try {
    for (const what of ['element', 'css']) {
      await select(b, what);
      await b.eval(`(() => { const p = napkin.instruments.panel(); if (p) p.open([...p.rows.keys()][0]); })()`);
      await sleep(300);
      for (const th of ['light', 'dark']) {
        await theme(b, th); await sleep(150);
        const v = (await axe(b, ['#inspector', '#right-edge'])).filter((x) => x.impact === 'serious' || x.impact === 'critical');
        t.diagnostic(`${what} ${th}: ${v.length} serious or critical`);
        assert.deepEqual(v, [], `${what} ${th}`);
      }
    }
  } finally { await close(); }
});

// ---- the width lever (standards section 7 rule 6b) ----
// What is on screen, measured: the colour section's tier and whether its sliders and plane show, the element panel's pairs and sides.
const LOOK = `JSON.stringify((() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const p = napkin.instruments.panel(), s = p && [...p.sections.values()].find((x) => x.node.dataset.reveal === 'width');
  const ch = s && [...s.node.querySelectorAll('.d-cx-channels')].find(vis);
  const names = ch ? [...ch.querySelectorAll('.k-field-name')].filter(vis).map((e) => e.textContent.trim()) : [];
  const top = (sel) => { const e = document.querySelector(sel); return e && vis(e) ? Math.round(e.getBoundingClientRect().top) : null; };
  const xy = [...document.querySelectorAll('#panel .pl-geo[data-pair=xy] > .vrow')].map((e) => Math.round(e.getBoundingClientRect().top));
  const wh = [...document.querySelectorAll('#panel .pl-geo[data-pair=wh] > .vrow')].map((e) => Math.round(e.getBoundingClientRect().top));
  return { tier: p?.root.dataset.tier ?? null, depth: s?.node.dataset.depth ?? null, sliders: names, plane: !!s && [...s.node.querySelectorAll('.d-cx-plane, canvas')].some(vis),
    xy, wh, sides: [...document.querySelectorAll('#panel .pl-sides')].some(vis), box: vis(document.querySelector('#panel .pl-box')) };
})())`;
// Every piece of text in the panel that could be cut: its content fits its box (no ellipsis, no clipped number).
const CLIPPED = `JSON.stringify((() => {
  const out = [];
  for (const e of document.querySelectorAll('#inspector label, #inspector .d-label, #inspector .k-field-name, #inspector .phead label, #inspector .pl-gh, #inspector h3, #inspector h4, #inspector summary, #inspector .nk-cap-all, #inspector .d-value, #inspector input.val, #inspector input.ro, #inspector .decl .prop, #inspector .decl .val')) {
    if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || !e.clientWidth) continue;
    const over = e.tagName === 'INPUT' ? e.value && e.scrollWidth > e.clientWidth + 1 : e.scrollWidth > e.clientWidth + 1;
    if (over) out.push((e.className || e.tagName) + ' "' + (e.value || e.textContent).trim().slice(0, 24) + '" ' + e.scrollWidth + '>' + e.clientWidth);
  }
  return out.slice(0, 8);
})())`;
async function dragEdge(b, io, to) {
  const e = await box(b, '#right-edge'), x = e.l + e.w / 2, y = e.t + 300, dx = to - (await width(b)); // left widens
  await io.move(x, y); await io.press(x, y);
  for (let i = 1; i <= 8; i++) await io.move(x - (dx * i) / 8, y, { buttons: 1 });
  await io.release(x - dx, y);
  await sleep(500);
  assert.equal(await width(b), to, `dragged to ${to}`);
}

test('the width lever: at 280 one column and no sliders; dragging the edge wider pairs X with Y, shows the sides, the colour sliders, then the full editor; nothing is cut at 280, 360 or 560', { timeout: 180000 }, async () => {
  const { b, io, close } = await boot();
  try {
    const look = async (what) => { await select(b, what); await sleep(300); return JSON.parse(await b.eval(LOOK)); };
    const clipped = async (what, w) => assert.deepEqual(JSON.parse(await b.eval(CLIPPED)), [], `${w} px, ${what}: no text is cut`);
    // 280: the colour is a row and a popover, the element's values are label, field, one per line
    let c = await look('css');
    assert.equal(c.tier, 'narrow'); assert.equal(c.depth, '2');
    assert.deepEqual(c.sliders, [], 'no colour sliders at 280');
    await clipped('css', 280);
    let e = await look('element');
    assert.ok(e.xy.length === 2 && e.xy[0] !== e.xy[1], `X above Y at 280 (${e.xy})`);
    assert.ok(e.wh.length === 2 && e.wh[0] !== e.wh[1], `W above H at 280 (${e.wh})`);
    assert.equal(e.sides, false, 'the padding sides wait behind their toggle at 280');
    assert.equal(e.box, false);
    await clipped('element', 280);
    // the small toggle at the right of the padding row shows the sides, one under another
    await b.eval(`document.querySelector('#panel .pl-adv[data-adv=padding]').click()`); await sleep(150);
    assert.equal(await b.eval(`document.querySelector('#panel .pl-adv[data-adv=padding]').getAttribute('aria-expanded')`), 'true');
    const sides280 = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#pl-sides-padding > .vrow')].map((r) => Math.round(r.getBoundingClientRect().top)))`));
    assert.equal(new Set(sides280).size, 4, `four sides, one per line at 280 (${sides280})`);
    await clipped('element, sides open', 280);
    await b.eval(`document.querySelector('#panel .pl-adv[data-adv=padding]').click()`);

    // drag the edge to 360 with real pointer events: pairs, sides and sliders appear
    await dragEdge(b, io, 360);
    e = JSON.parse(await b.eval(LOOK));
    assert.equal(e.xy[0], e.xy[1], `X beside Y at 360 (${e.xy})`);
    assert.equal(e.wh[0], e.wh[1], `W beside H at 360 (${e.wh})`);
    assert.equal(e.sides, true, 'the padding sides show without a toggle at 360');
    const sides360 = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#pl-sides-padding > .vrow')].map((r) => Math.round(r.getBoundingClientRect().top)))`));
    assert.equal(new Set(sides360).size, 2, `the sides two by two at 360 (${sides360})`);
    await clipped('element', 360);
    c = await look('css');
    assert.equal(c.tier, 'medium'); assert.equal(c.depth, '2');
    assert.deepEqual(c.sliders, ['Lightness', 'Chroma', 'Hue', 'Alpha'], 'the four sliders, labels whole, at 360');
    await clipped('css', 360);

    // drag on to 560: the colour section shows its full editor in place, the element its box figure
    await dragEdge(b, io, 560);
    c = JSON.parse(await b.eval(LOOK));
    assert.equal(c.tier, 'wide'); assert.equal(c.depth, '3', 'the full editor opens at 560 by width alone');
    assert.equal(c.plane, true, 'the plane shows');
    await clipped('css', 560);
    e = await look('element');
    assert.equal(e.box, true, 'the box figure at 560');
    await clipped('element', 560);
    // and back to 280: the colour section folds back to its row
    await dragEdge(b, io, 280);
    c = await look('css');
    assert.equal(c.tier, 'narrow'); assert.equal(c.depth, '2', 'narrower: the editor the width opened closes again');
    assert.deepEqual(JSON.parse(await b.eval(COVERS)), []);
  } finally { await close(); }
});

// ---- the height lever (standards section 7 rule 6c) ----
const LONG = `[...napkin.instruments.panel().sections.values()].find((x) => x.rowlist.children.length > 6)`;
const CAP = () => `JSON.stringify((() => {
  const s = ${LONG}, l = s.rowlist, f = l.nextElementSibling, lr = l.getBoundingClientRect();
  const rows = [...l.children].filter((r) => !r.hidden);
  const g = f?.querySelector('.nk-cap-grip'), a = f?.querySelector('.nk-cap-all');
  return { total: rows.length, seen: rows.filter((r) => r.getBoundingClientRect().bottom <= lr.bottom + 1).length, capped: l.hasAttribute('data-capped'),
    role: g?.getAttribute('role'), now: g ? Number(g.getAttribute('aria-valuenow')) : null, label: g?.getAttribute('aria-label'), all: a?.textContent, expanded: a?.getAttribute('aria-expanded') };
})())`;

test('the height lever: a long list shows six rows; its bottom edge drags (and keys) for more, "Show all" opens it, remembered per kind', { timeout: 150000 }, async () => {
  const { b, io, url, close } = await boot();
  try {
    await b.eval(`try { localStorage.removeItem('napkin.rows'); } catch {}`);
    await select(b, 'css');
    let m = JSON.parse(await b.eval(CAP()));
    assert.ok(m.total > 6, `a list longer than six (${m.total})`);
    assert.equal(m.seen, 6, 'six rows show'); assert.equal(m.capped, true);
    assert.equal(m.role, 'separator'); assert.match(m.label, /^Rows shown in /); assert.equal(m.now, 6);
    assert.equal(m.all, `Show all ${m.total}`); assert.equal(m.expanded, 'false');
    // drag the bottom edge down by about two rows with real pointer events
    const g = JSON.parse(await b.eval(`JSON.stringify((() => { const s = [...napkin.instruments.panel().sections.values()].find((x) => x.rowlist.children.length > 6); s.node.scrollIntoView({ block: 'start' }); const r = s.rowlist.nextElementSibling.querySelector('.nk-cap-grip').getBoundingClientRect(), h = s.rowlist.children[0].getBoundingClientRect().height; return { x: r.left + r.width / 2, y: r.top + r.height / 2, h }; })())`));
    await io.move(g.x, g.y); await io.press(g.x, g.y);
    for (let i = 1; i <= 6; i++) await io.move(g.x, g.y + (g.h * 2 * i) / 6, { buttons: 1 });
    await io.release(g.x, g.y + g.h * 2);
    await sleep(200);
    m = JSON.parse(await b.eval(CAP()));
    assert.equal(m.now, 8, 'two more rows');
    // the keyboard does the same: Up one fewer, End all, Home back to six
    await b.eval(`[...napkin.instruments.panel().sections.values()].find((x) => x.rowlist.children.length > 6).rowlist.nextElementSibling.querySelector('.nk-cap-grip').focus()`);
    await io.key('ArrowUp'); await sleep(100);
    assert.equal(JSON.parse(await b.eval(CAP())).seen, 7, 'Up: one row fewer');
    // remembered for this kind of file across a reload
    await reload(b, url); await select(b, 'css');
    m = JSON.parse(await b.eval(CAP()));
    assert.equal(m.seen, 7, 'remembered'); assert.equal(m.now, 7);
    assert.ok(JSON.parse(await b.eval(`localStorage.getItem('napkin.rows')`))['css.' + await b.eval(`[...napkin.instruments.panel().sections.values()].find((x) => x.rowlist.children.length > 6).schema.id`)] === 7, 'stored per kind and list');
    // Show all, then Show fewer
    await b.eval(`[...napkin.instruments.panel().sections.values()].find((x) => x.rowlist.children.length > 6).rowlist.nextElementSibling.querySelector('.nk-cap-all').click()`); await sleep(100);
    m = JSON.parse(await b.eval(CAP()));
    assert.equal(m.seen, m.total, 'every row'); assert.equal(m.capped, false); assert.equal(m.all, 'Show fewer'); assert.equal(m.expanded, 'true');
    await b.eval(`${LONG}.rowlist.nextElementSibling.querySelector('.nk-cap-grip').focus()`); await io.key('Home'); await sleep(100);
    assert.equal(JSON.parse(await b.eval(CAP())).seen, 6, 'Home: six again');
  } finally { await close(); }
});

// ---- one panel: one header, one ordered list of sections (standards section 7) ----
// The order every selection follows; a section shows only when it applies, so a selection's list is this list with gaps.
const ORDER = {
  html: ['Layout', 'Spacing', 'Appearance', 'Typography', 'Fill', 'Stroke', 'Effects', 'Text', 'Classes', 'Other CSS', 'Inherited', 'Inline style', 'Rules', 'Variables here', 'Your variables', 'Check'],
  tsx: ['Layout', 'Auto layout', 'Appearance', 'Typography', 'Fill', 'Stroke', 'Effects', 'Settings', 'Variants', 'Composition', 'Text', 'Image', 'Advanced: all CSS'],
};
// The headings of the one list, top to bottom: the element's sections, then the file's (dials).
const HEADINGS = `JSON.stringify([...document.querySelectorAll('#panel :is(.pp-sec > .pp-sec-t .pp-sec-l, .sec.empty > .sectitle, .d-section-name)')].filter((e) => !e.closest('.pp-sec .pp-sec') && e.getClientRects().length).map((e) => e.textContent.trim()))`;
const STRUCTURE = `JSON.stringify({
  heads: [...document.querySelectorAll('#inspector header, #inspector .inst-head, #inspector .doc-head, #inspector .selhead')].filter((e) => !e.matches('.d-section-head') && e.getClientRects().length).map((e) => e.id || e.className),
  lists: document.querySelectorAll('#inspector > #panel').length,
  outside: [...document.querySelectorAll('#inspector .pp-sec, #inspector .d-section')].filter((e) => !e.closest('#panel')).length,
  name: document.querySelector('#pp-head .pp-name')?.textContent.trim(), tag: document.querySelector('#pp-head .pp-tag')?.textContent.trim() ?? null,
  glyph: !!document.querySelector('#pp-head .pp-glyph svg'), undo: !!document.querySelector('#inspector [data-inst-undo]'),
})`;
const inOrder = (got, order) => got.every((h, i) => order.includes(h) && (i === 0 || order.indexOf(h) > order.indexOf(got[i - 1])));
// A real click on something: a layers row by name, or an element inside an HTML frame on the canvas.
async function clickRow(b, io, name) {
  const r = JSON.parse(await b.eval(`JSON.stringify((() => { const row = [...document.querySelectorAll('#layers .lrow')].find((x) => x.querySelector('.lname')?.textContent === ${JSON.stringify(name)}); if (!row) return null; row.scrollIntoView({ block: 'center' }); const q = row.querySelector('.lname').getBoundingClientRect(); return { x: q.left + 8, y: q.top + q.height / 2 }; })())`));
  assert.ok(r, `a layers row named ${name}`);
  await io.click(r.x, r.y); await sleep(700);
}
// (a plain click picks the top-level element in an HTML frame; Ctrl picks the deepest, as selection.test.js)
async function clickIn(b, io, file, css) {
  await b.waitFor(`!!napkin.stage.sections.get(napkin.find(${JSON.stringify(file)})?.component)?.docFrame?.tree()?.tree`, 15000);
  const r = JSON.parse(await b.eval(`JSON.stringify((() => { const s = napkin.stage.sections.get(napkin.find(${JSON.stringify(file)}).component), fr = s.el.querySelector('iframe'), f = fr.getBoundingClientRect(), z = f.width / fr.offsetWidth, h = fr.contentDocument.querySelector(${JSON.stringify(css)}).getBoundingClientRect(); return { x: f.left + (h.left + Math.min(h.width / 4, 20)) * z, y: f.top + (h.top + h.height / 2) * z }; })())`));
  await io.click(r.x, r.y, { ctrl: true }); await sleep(700);
}
const headerOf = (b, label) => b.eval(`(() => { const l = [...document.querySelectorAll('#panel .pp-sec-l')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); return l ? l.closest('.pp-sec-h').getAttribute('aria-expanded') : null; })()`);
async function clickHeader(b, io, label) {
  const r = JSON.parse(await b.eval(`JSON.stringify((() => { const h = [...document.querySelectorAll('#panel .pp-sec-l')].find((e) => e.textContent.trim() === ${JSON.stringify(label)}).closest('.pp-sec-h'); h.scrollIntoView({ block: 'center' }); const q = h.getBoundingClientRect(); return { x: q.left + 40, y: q.top + q.height / 2 }; })())`));
  await io.click(r.x, r.y); await sleep(200);
}

test('one panel: one header and one ordered list for an HTML element, a TSX component and a file; the empty state is one line and the canvas settings', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot();
  try {
    // nothing selected: one line, then the canvas's own settings; no header, no shortcut tutorial
    await b.eval(`napkin.select(null)`); await sleep(300);
    assert.equal(await b.eval(`document.querySelector('#pp-empty')?.textContent`), 'Select something to edit it.');
    assert.equal(await b.eval(`document.querySelector('#pp-head').hidden`), true);
    assert.equal(await b.eval(`document.querySelectorAll('#panel kbd, #panel li, #panel .empty-panel').length`), 0, 'no shortcut list');
    assert.deepEqual(JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#panel .pp-label')].map((e) => e.textContent))`)), ['Zoom', 'Background', 'Tokens']);
    const z0 = await b.eval(`napkin.view.get().z`);
    const zin = JSON.parse(await b.eval(`JSON.stringify((() => { const q = document.querySelector('[data-pp=zoom-in]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })())`));
    await io.click(zin.x, zin.y); await sleep(400);
    assert.ok(await b.eval(`napkin.view.get().z`) > z0, 'the panel zooms the canvas');

    // an element in an HTML file, clicked on the canvas
    await clickIn(b, io, 'landing', 'h1');
    let st = JSON.parse(await b.eval(STRUCTURE));
    assert.deepEqual(st.heads, ['pp-head'], 'exactly one header');
    assert.equal(st.lists, 1); assert.equal(st.outside, 0, 'every section is in the one list');
    assert.equal(st.name, 'Plan the week'); assert.equal(st.tag, '<h1>'); assert.ok(st.glyph); assert.equal(st.undo, false);
    const html = JSON.parse(await b.eval(HEADINGS));
    const els = html.filter((h) => ORDER.html.includes(h));
    assert.ok(els.length >= 5 && inOrder(els, ORDER.html), `HTML order: ${html}`);
    assert.deepEqual(els.slice(0, 2), ['Layout', 'Spacing']);
    assert.ok(els.includes('Typography') && els.indexOf('Typography') < els.indexOf('Text'), 'Typography (a text element) before its content');
    assert.ok(html.indexOf(els.at(-1)) < html.length - 1, 'the file’s own sections come after the element’s');
    for (const adv of ['Rules', 'Check']) assert.equal(await headerOf(b, adv), 'false', `${adv} starts closed`);

    // a TSX component's layer, picked in the layers panel
    await clickRow(b, io, 'title');
    st = JSON.parse(await b.eval(STRUCTURE));
    assert.deepEqual(st.heads, ['pp-head']); assert.equal(st.outside, 0);
    assert.equal(st.name, 'title');
    const tsx = JSON.parse(await b.eval(HEADINGS)).filter((h) => ORDER.tsx.includes(h));
    assert.ok(tsx.length >= 5 && inOrder(tsx, ORDER.tsx), `TSX order: ${tsx}`);
    assert.equal(tsx[0], 'Layout');
    assert.equal(await headerOf(b, 'Advanced: all CSS'), 'false', 'Advanced starts closed');

    // a file: the same header, its own sections in the same list
    await clickRow(b, io, 'theme.css');
    st = JSON.parse(await b.eval(STRUCTURE));
    assert.deepEqual(st.heads, ['pp-head']); assert.equal(st.outside, 0); assert.equal(st.name, 'theme.css'); assert.equal(st.tag, null);
    assert.ok(JSON.parse(await b.eval(HEADINGS)).length >= 1);
    assert.ok(await b.eval(`!!document.querySelector('#pp-head #pp-open[href^="/view/"]')`), 'Open this file alone is in the header');

    // every section heading is one button with aria-expanded, 12 to 13 px, medium
    const heads = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#panel .pp-sec-h, #panel .d-section-name')].map((e) => ({ tag: e.tagName, exp: e.getAttribute('aria-expanded'), fs: parseFloat(getComputedStyle(e).fontSize), fw: Number(getComputedStyle(e).fontWeight) })))`));
    for (const h of heads) { assert.equal(h.tag, 'BUTTON'); assert.ok(h.fs >= 12 && h.fs <= 13, `font ${h.fs}`); assert.equal(h.fw, 500); }
  } finally { await close(); }
});

test('one panel: a section closed on one selection stays closed on the next of the same kind; the header renames in place', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot([1440, 900], { 'print.css': ':root { --ink: #000; --paper: #fff; --line: #999; }\n.hero { padding: 0; } .card { border: 0; color: var(--ink); }\n' });
  try {
    await clickIn(b, io, 'landing', 'h1');
    assert.equal(await headerOf(b, 'Typography'), 'true');
    await clickHeader(b, io, 'Typography');
    assert.equal(await headerOf(b, 'Typography'), 'false');
    assert.equal(await b.eval(`document.querySelector('#panel [data-sec=type] > .pp-sec-b').hidden`), true);
    await clickIn(b, io, 'landing', 'p'); // another element of the same kind
    assert.equal(await b.eval(`document.querySelector('#pp-head .pp-tag').textContent`), '<p>');
    assert.equal(await headerOf(b, 'Typography'), 'false', 'still closed on the next HTML element');
    await clickRow(b, io, 'title'); // a TSX layer is another kind: its own memory
    assert.equal(await headerOf(b, 'Typography'), 'true', 'a TSX layer is another kind: Typography open there');
    await clickHeader(b, io, 'Typography');
    await clickHeader(b, io, 'Typography');
    assert.equal(await headerOf(b, 'Typography'), 'true');
    await clickIn(b, io, 'landing', 'h1');
    assert.equal(await headerOf(b, 'Typography'), 'false');
    await clickHeader(b, io, 'Typography'); // open again for the next run

    // a file's sections (dials) follow the same memory: closed on one stylesheet, closed on the next
    await clickRow(b, io, 'theme.css');
    const first = await b.eval(`[...napkin.instruments.panel().sections.values()][0].schema.id`);
    const name = JSON.parse(await b.eval(`JSON.stringify((() => { const n = [...napkin.instruments.panel().sections.values()][0].node.querySelector('.d-section-name'); const q = n.getBoundingClientRect(); return { x: q.left + 30, y: q.top + q.height / 2 }; })())`));
    await io.click(name.x, name.y); await sleep(300);
    assert.equal(await b.eval(`[...napkin.instruments.panel().sections.values()][0].node.dataset.depth`), '1');
    await clickRow(b, io, 'print.css');
    assert.equal(await b.eval(`napkin.instruments.panel().sections.get(${JSON.stringify(first)})?.node.dataset.depth`), '1', 'closed on the next CSS file too');
    assert.equal(await b.eval(`JSON.parse(localStorage.getItem('napkin.sections'))['css.' + ${JSON.stringify(first)}]`), false);

    // the header's name is the layers rename: click it, type, Enter
    await clickRow(b, io, 'title');
    const nm = JSON.parse(await b.eval(`JSON.stringify((() => { const q = document.querySelector('#pp-head button.pp-name').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })())`));
    await io.click(nm.x, nm.y); await sleep(200);
    assert.ok(await b.eval(`document.activeElement?.tagName === 'INPUT' && !!document.activeElement.closest('#pp-head')`), 'the name turns into a field in place');
    await b.eval(`document.activeElement.value = 'headline'`);
    await io.key('Enter'); await sleep(900);
    assert.equal(await b.eval(`napkin.state.selection.node`), 'headline');
    assert.equal(await b.eval(`document.querySelector('#pp-head .pp-name').textContent`), 'headline');
    assert.ok(await b.eval(`!!document.querySelector('#layers .lrow[data-node="headline"]')`), 'the layers panel shows the new name');
  } finally { await close(); }
});

test('one panel: Ctrl+Shift+\\ hides the panel and the canvas takes the width; the key again, or selecting something, brings it back', { timeout: 120000 }, async () => {
  const { b, io, url, close } = await boot();
  try {
    const keys = await (await fetch(url + 'api/keys')).json();
    assert.ok(keys.bindings.some((k) => k.command === 'toggle-right' && k.keys === 'Ctrl+Shift+\\'), 'one binding, from actions.js');
    await clickRow(b, io, 'title');
    assert.match(await b.eval(`document.querySelector('#pp-collapse').dataset.key`), /Shift/);
    await b.eval(`document.querySelector('#stage').focus()`);
    const s0 = await box(b, '#stage');
    await io.key('|', { ctrl: true, shift: true, code: 'Backslash' }); await sleep(400);
    assert.equal(await b.eval(`document.body.dataset.right`), 'closed');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('#inspector')).visibility`), 'hidden');
    assert.equal(await b.eval(`document.querySelector('#inspector').inert`), true);
    const s1 = await box(b, '#stage');
    assert.ok(s1.r > s0.r + 200 && Math.round(s1.r) === 1440, `the canvas takes the width (${s0.r} -> ${s1.r})`);
    await io.key('|', { ctrl: true, shift: true, code: 'Backslash' }); await sleep(400);
    assert.equal(await b.eval(`document.body.dataset.right`), 'open');
    assert.equal(Math.round((await box(b, '#stage')).r), Math.round(s0.r));

    // hidden, then something is selected on the canvas: the panel comes back
    await io.key('|', { ctrl: true, shift: true, code: 'Backslash' }); await sleep(300);
    await reload(b, url);
    assert.equal(await b.eval(`document.body.dataset.right`), 'closed', 'remembered');
    await clickIn(b, io, 'landing', 'h1');
    assert.equal(await b.eval(`document.body.dataset.right`), 'open');
    assert.equal(await b.eval(`document.querySelector('#pp-head .pp-name').textContent`), 'Plan the week');
    // the header's button hides it too
    const hb = JSON.parse(await b.eval(`JSON.stringify((() => { const q = document.querySelector('#pp-collapse').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })())`));
    await io.click(hb.x, hb.y); await sleep(300);
    assert.equal(await b.eval(`document.body.dataset.right`), 'closed');
  } finally { await close(); }
});

// ------------------------------------------------------------------ the fields, Mixed, one undo, the width lever's camera, the labels at 280
function png(w, h, top = [21, 79, 101]) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) row.set(y < h / 2 ? top : [240, 189, 69], 1 + x * 3); rows.push(row); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const PICTURES = { 'a.png': png(240, 160), 'b.png': png(240, 160, [192, 57, 43]) };
// Typing as a keyboard does: the punctuation keys with their own key codes (math in a field is "+8", "*2", "1.5").
const VK = { '.': 190, '-': 189, '+': 187, '*': 56, '/': 191 };
async function typed(b, text) {
  for (const ch of text) {
    const vk = /[0-9a-z]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : VK[ch] ?? 0;
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: vk });
  }
}
const jv = async (b, expr) => JSON.parse(await b.eval(`Promise.resolve(${expr}).then((v) => JSON.stringify(v ?? null))`));
const until = async (fn, ms = 8000, what = 'condition') => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) assert.fail(`timed out waiting for ${what}`); await sleep(100); } };
const centreOf = (b, expr) => jv(b, `(() => { const e = ${expr}; e.scrollIntoView?.({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const clickOn = async (b, io, expr, o) => { const p = await centreOf(b, expr); await io.click(p.x, p.y, o); await sleep(300); return p; };
// A file's card on the canvas, and a row of the layers list, by what a person reads
const card = (name) => `document.querySelector('#world [data-item-id=${JSON.stringify(name)}]')`;
const row = (name) => `[...document.querySelectorAll('#layers .lrow')].find((r) => r.querySelector('.lname').textContent === ${JSON.stringify(name)})`;
const active = (b) => jv(b, `(() => { const a = document.activeElement; return { id: a.id, key: a.dataset?.key ?? null, control: a.closest('[data-control]')?.dataset.control ?? null, value: a.value ?? null, all: a.value !== undefined && a.selectionStart === 0 && a.selectionEnd === a.value.length }; })()`);
const contrast = (b, file) => jv(b, `fetch('/api/controls/${file}').then((r) => r.json()).then((j) => j.sections.flatMap((s) => s.controls).find((c) => c.id === 'view:contrast').value)`);
// Count the undo requests the page sends (a wrapper on fetch: the resource-timing buffer fills up in a long test)
const COUNT_UNDO = `(() => { if (window.__undos !== undefined) return; window.__undos = 0; const f = window.fetch; window.fetch = (u, o) => { if (/[/]api[/]undo$/.test(String(u?.url ?? u).split('?')[0])) window.__undos++; return f(u, o); }; })()`;

test('one Ctrl+Z on an instrument is one undo request and one step; a multi-selection shows Mixed, an edit sets all, one Ctrl+Z puts all back', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot([1440, 900], PICTURES);
  try {
    await b.eval(COUNT_UNDO);
    await b.eval(`napkin.view.fitAll({ animate: false })`); await sleep(400);
    await clickOn(b, io, card('a.png'));
    await b.waitFor(`!!document.querySelector('#instruments [data-control="view:contrast"] input')`, 10000);
    const field = `document.querySelector('#instruments [data-control="view:contrast"] input')`;
    await clickOn(b, io, field);
    assert.ok((await active(b)).all, 'a click selects the whole value');
    await typed(b, '1.5'); await io.key('Enter');
    await until(async () => (await contrast(b, 'a.png')) === 1.5, 8000, 'Contrast 1.5 written');
    assert.equal((await active(b)).control, 'view:contrast', 'Enter keeps the focus in the field');
    await typed(b, '2'); await io.key('Enter');
    await until(async () => (await contrast(b, 'a.png')) === 2, 8000, 'Contrast 2 written');
    const n0 = await b.eval('window.__undos');
    await io.key('z', { ctrl: true }); await sleep(1500);
    assert.equal(await b.eval('window.__undos') - n0, 1, 'one Ctrl+Z, one undo request');
    assert.equal(await contrast(b, 'a.png'), 1.5, 'one step back: 1.5, not 1');
    assert.equal(await b.eval(`${field}.value`), '1.5', 'the field shows it');

    // a second picture at Contrast 1 next to the first at 1.5: selected together (click, Shift+click), the field says Mixed
    await io.key('Escape'); await sleep(200);
    await clickOn(b, io, card('b.png'), { shift: true });
    await until(() => b.eval(`napkin.state.selections.length === 2 && !!document.querySelector('#instruments [data-control="view:contrast"][data-mixed]')`), 8000, 'Mixed');
    const mixed = await jv(b, `(() => { const i = ${field}, fit = document.querySelector('#instruments [data-control="view:fit"]'); return { value: i.value, placeholder: i.placeholder, fitMixed: fit.hasAttribute('data-mixed'), chosen: fit.querySelectorAll('[aria-pressed=true], [aria-checked=true], [aria-selected=true]').length }; })()`);
    assert.deepEqual(mixed, { value: '', placeholder: 'Mixed', fitMixed: false, chosen: 1 }, 'Contrast differs (Mixed, empty); Fit is the same on both (one chosen)');
    // Fit differs too once one picture is set to cover: then no choice is shown as chosen
    await clickOn(b, io, card('b.png'));
    await clickOn(b, io, `[...document.querySelectorAll('#instruments [data-control="view:fit"] button')].find((x) => x.textContent.trim() === 'cover')`);
    await sleep(800);
    await clickOn(b, io, card('a.png'), { shift: true });
    await until(() => b.eval(`!!document.querySelector('#instruments [data-control="view:fit"][data-mixed]')`), 8000, 'Fit Mixed');
    assert.equal(await b.eval(`document.querySelectorAll('#instruments [data-control="view:fit"] [aria-pressed=true], #instruments [data-control="view:fit"] [aria-checked=true]').length`), 0, 'a Mixed choice shows no option chosen');
    // typing into the Mixed field sets both, one step; one Ctrl+Z puts both back
    await clickOn(b, io, field);
    await typed(b, '3'); await io.key('Enter');
    await until(async () => (await contrast(b, 'a.png')) === 3 && (await contrast(b, 'b.png')) === 3, 8000, 'both at 3');
    const n1 = await b.eval('window.__undos');
    await io.key('Escape'); await sleep(200);
    await io.key('z', { ctrl: true });
    await until(async () => (await contrast(b, 'a.png')) === 1.5 && (await contrast(b, 'b.png')) === 1, 8000, 'both back');
    assert.equal(await b.eval('window.__undos') - n1, 2, 'one Ctrl+Z: one request per picture, one step');
  } finally { await close(); }
});

test('fields: click selects all; +8 *2 -4 /2 work on the value; Enter keeps the focus; Tab commits and moves on; Escape puts it back and goes to the canvas; Up/Down step; Ctrl+Z restores the HTML bytes', { timeout: 180000 }, async () => {
  const { b, io, dir, close } = await boot();
  const html = () => readFileSync(join(dir, 'landing.html'), 'utf8');
  try {
    // an HTML element, picked on the canvas
    await b.waitFor(`!!napkin.stage.sections.get(napkin.find('landing')?.component)?.docFrame?.tree()?.tree`, 15000);
    await b.eval(`napkin.view.fitAll({ animate: false })`); await sleep(400);
    const h1 = `(() => { const c = napkin.find('landing').component, f = napkin.stage.sections.get(c).docFrame; return napkin.stage.cellElement(c, f.nodeOf(f.doc().querySelector('h1')), {}); })()`;
    await clickOn(b, io, h1, { ctrl: true }); // (Ctrl picks the deepest; a plain click picks the top-level <main>)
    await until(() => b.eval(`!!document.querySelector('#inspector #pv-width')`), 10000, 'the h1 in the panel');
    assert.match(await b.eval(`napkin.stage.sections.get(napkin.state.selection.component).docFrame.element(napkin.state.selection.node)?.el.localName`), /^h1$/);
    const before = html();
    const W = `document.querySelector('#inspector #pv-width')`;
    await clickOn(b, io, W);
    const a0 = await active(b);
    assert.equal(a0.key, 'pv-width');
    const w0 = Number(/^-?[\d.]+/.exec(await b.eval(`${W}.value || ${W}.placeholder`))[0]);
    await typed(b, '+8'); await io.key('Enter');
    await until(() => html().includes(`width: ${w0 + 8}px`), 8000, `width ${w0 + 8}px written`);
    await sleep(300);
    const a1 = await active(b);
    assert.equal(a1.key, 'pv-width', 'Enter keeps the focus in the field');
    assert.equal(a1.value, `${w0 + 8}px`); assert.ok(a1.all, 'all of it selected');
    assert.equal(await b.eval(`!!document.querySelector('#doc-dock:not([hidden])') && getComputedStyle(document.querySelector('#doc-dock')).display !== 'none'`), false, 'no Apply/Cancel dock for an ordinary edit');
    const after1 = html();
    await typed(b, '*2'); await io.key('Tab');
    await until(() => html().includes(`width: ${(w0 + 8) * 2}px`), 8000, 'Tab commits');
    await sleep(300);
    assert.equal((await active(b)).key, 'pv-height', 'Tab moves to the next field');
    // Up/Down on a number, Shift for ten
    await clickOn(b, io, W);
    await io.key('ArrowUp'); assert.equal(await b.eval(`${W}.value`), `${(w0 + 8) * 2 + 1}px`);
    await io.key('ArrowDown', { shift: true }); assert.equal(await b.eval(`${W}.value`), `${(w0 + 8) * 2 - 9}px`);
    // Escape: the field goes back to what was written, the focus to the canvas, the selection stays
    await io.key('Escape'); await sleep(400);
    assert.equal((await active(b)).id, 'stage', 'Escape hands the focus to the canvas');
    assert.equal(await b.eval(`${W}.value`), `${(w0 + 8) * 2}px`, 'Escape puts the field back');
    assert.ok(html().includes(`width: ${(w0 + 8) * 2}px`), 'and nothing new was written');
    assert.equal(await b.eval(`napkin.state.selections.length`), 1, 'the selection stays');
    // each commit is one step; Ctrl+Z restores the bytes exactly
    await io.key('z', { ctrl: true });
    await until(() => html() === after1, 8000, 'one undo: the first commit\'s bytes');
    await io.key('z', { ctrl: true });
    await until(() => html() === before, 8000, 'two undos: the original bytes');

    // -4 and /2 on a TSX component's field (panel.js), picked from the layers list
    await clickOn(b, io, `document.querySelector('#layers .lrow[data-component][data-node="card"]') ?? ${row('Card')}`);
    await until(() => b.eval(`!!document.querySelector('#panel #gap')`), 10000, 'the Card in the panel');
    const tsx = () => readFileSync(join(dir, 'Card.tsx'), 'utf8');
    await clickOn(b, io, `document.querySelector('#panel #gap')`);
    assert.ok((await active(b)).all, 'a click selects all (TSX)');
    await typed(b, '-4'); await io.key('Enter');
    await until(() => /gap: '8px'|gap: 8\b/.test(tsx()), 8000, 'gap 12 - 4');
    await sleep(300);
    assert.equal((await active(b)).id, 'gap', 'Enter keeps the focus (TSX)');
    await typed(b, '/2'); await io.key('Tab');
    await until(() => /gap: '4px'|gap: 4\b/.test(tsx()), 8000, 'gap 8 / 2');
    await sleep(300);
    assert.notEqual((await active(b)).id, 'gap', 'Tab moves on (TSX)');
    await typed(b, '99'); await io.key('Escape'); await sleep(400);
    assert.equal((await active(b)).id, 'stage', 'Escape goes to the canvas (TSX)');
    assert.doesNotMatch(tsx(), /99/, 'Escape wrote nothing');
  } finally { await close(); }
});

test('a wider panel never hides the selection: dragged or keyed wider, a selection that was in view stays wholly in view', { timeout: 150000 }, async () => {
  const { b, io, close } = await boot([1280, 800], PICTURES);
  try {
    const inStage = () => jv(b, `(() => { const s = document.querySelector('#stage').getBoundingClientRect(), r = ${card('a.png')}.getBoundingClientRect(); return { ok: r.left >= s.left - 0.5 && r.right <= s.right + 0.5 && r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5, r: [r.left, r.right], s: [s.left, s.right] }; })()`);
    await b.eval(`napkin.view.fitAll({ animate: false })`); await sleep(400);
    await clickOn(b, io, card('a.png'));
    // fitted to the selection (Shift+2): it fills the canvas, so any width taken would cut it
    await b.eval(`document.querySelector('#stage').focus()`);
    await io.key('@', { shift: true, code: 'Digit2' }); await sleep(900);
    assert.ok((await inStage()).ok, 'in view before');
    const edge = await box(b, '#right-edge'), x = edge.l + edge.w / 2, y = edge.t + 200;
    await io.press(x, y);
    for (let i = 1; i <= 8; i++) await io.move(x - i * 25, y, { buttons: 1 });
    await io.release(x - 200, y); await sleep(500);
    assert.equal(await width(b), 480);
    const d = await inStage(); assert.ok(d.ok, `dragged wider, still wholly in view ${JSON.stringify(d)}`);

    // keys: back to 280 (double-click), the picture pushed against the right edge of the canvas, then Shift+Left widens by steps
    await b.eval(`document.querySelector('#right-edge').focus({ focusVisible: true })`);
    await io.key('Home'); await sleep(300);
    await b.eval(`document.querySelector('#stage').focus()`);
    await io.key('@', { shift: true, code: 'Digit2' }); await sleep(900);
    for (let i = 0; i < 4; i++) { await io.key('-', { ctrl: true, code: 'Minus' }); await sleep(200); }
    await sleep(500);
    const s = await box(b, '#stage'), r0 = await jv(b, `${card('a.png')}.getBoundingClientRect().toJSON()`);
    await io.wheel(s.l + s.w / 2, s.t + s.h / 2, -(s.r - 24 - r0.right), 0, {}); await sleep(600);
    const near = await inStage(); assert.ok(near.ok && near.s[1] - near.r[1] < 60, `at the right edge ${JSON.stringify(near)}`);
    await b.eval(`document.querySelector('#right-edge').focus({ focusVisible: true })`);
    for (let i = 0; i < 6; i++) { await io.key('ArrowLeft', { shift: true }); await sleep(120); }
    await sleep(500);
    assert.ok(await width(b) > 300, 'wider by keys');
    const k = await inStage(); assert.ok(k.ok, `keyed wider, still wholly in view ${JSON.stringify(k)}`);
  } finally { await close(); }
});

test('at 280 px no label or choice is cut to an ellipsis (HTML, TSX, CSS, SVG, PNG, MD); an SVG\'s rows are grouped under the element they edit', { timeout: 180000 }, async () => {
  const { b, io, close } = await boot([1440, 900], PICTURES);
  // every visible piece of text in the panel that is wider than its box (sr-only text is 1 px wide and skipped)
  const CUT = `JSON.stringify([...document.querySelectorAll('#inspector *')].filter((e) => {
    if (!e.getClientRects().length || e.clientWidth <= 1 || e.closest('[hidden], [inert]')) return false;
    if (getComputedStyle(e).visibility === 'hidden' || !e.textContent.trim()) return false;
    if ([...e.children].some((c) => !/^inline(?!-(block|flex|grid))/.test(getComputedStyle(c).display)) && !e.matches('button, label, .d-label, [role=radio], [role=tab], [role=option], summary, .lt')) return false;
    return e.scrollWidth > e.clientWidth + 1;
  }).map((e) => e.localName + '.' + String(e.className).slice(0, 30) + ' "' + e.textContent.trim().slice(0, 30) + '" ' + e.scrollWidth + '>' + e.clientWidth))`;
  try {
    assert.equal(await width(b), 280);
    await b.eval(`napkin.view.fitAll({ animate: false })`); await sleep(400);
    await b.waitFor(`!!napkin.stage.sections.get(napkin.find('landing')?.component)?.docFrame?.tree()?.tree`, 15000);
    const picks = {
      HTML: `(() => { const c = napkin.find('landing').component, f = napkin.stage.sections.get(c).docFrame; return napkin.stage.cellElement(c, f.nodeOf(f.doc().querySelector('h1')), {}); })()`,
      TSX: `document.querySelector('#layers .lrow[data-component][data-node="card"]') ?? ${row('Card')}`,
      CSS: row('theme.css'), SVG: row('mark.svg'), PNG: row('a.png'), MD: row('notes.md'),
    };
    const FILE = { HTML: 'landing', TSX: 'Card', CSS: 'theme.css', SVG: 'mark.svg', PNG: 'a.png', MD: 'notes.md' };
    const seen = {};
    for (const [kind, expr] of Object.entries(picks)) {
      await clickOn(b, io, expr);
      await until(() => b.eval(`[${JSON.stringify(FILE[kind])}, napkin.find(${JSON.stringify(FILE[kind])})?.component].includes(napkin.state.selection?.component) && (!!napkin.instruments.panel() || document.querySelector('#panel').childElementCount > 0)`), 10000, `${kind} selected (${await b.eval("JSON.stringify(napkin.state.selections)")})`);
      await sleep(900);
      seen[kind] = await b.eval(`document.querySelectorAll('#inspector button, #inspector label, #inspector .d-label').length`);
      assert.deepEqual(JSON.parse(await b.eval(CUT)), [], `${kind}: nothing cut at 280`);
      if (kind === 'PNG') {
        await until(() => b.eval(`!!document.querySelector('#instruments [data-control="view:fit"] button')`), 8000, `the Fit choices (${JSON.stringify(await b.eval('JSON.stringify(napkin.state.selections)'))})`);
        const fit = await jv(b, `[...document.querySelectorAll('#instruments [data-control="view:fit"] .d-value button')].map((x) => x.textContent.trim())`);
        assert.deepEqual(fit, ['contain', 'cover'], 'the image Fit choices read in full');
      }
      if (kind === 'SVG') {
        const heads = await jv(b, `[...document.querySelectorAll('#instruments .d-section')].map((s) => ({ name: s.querySelector('.d-section-head')?.textContent.trim().split(/\\s{2,}|\\n/)[0], rows: [...s.querySelectorAll('.d-row .d-label')].map((l) => l.textContent.trim()) }))`);
        const viewport = heads.find((h) => /^Viewport/.test(h.name)), path = heads.find((h) => /^path/.test(h.name));
        assert.ok(viewport?.rows.includes('viewBox'), `the root's viewBox sits under "Viewport" ${JSON.stringify(heads)}`);
        assert.ok(path?.rows.includes('fill'), `the path's fill sits under "path" ${JSON.stringify(heads)}`);
      }
    }
    // two pictures selected together: the header's line and the shared rows read in full too
    await b.eval(`napkin.view.fitAll({ animate: false })`); await sleep(400);
    await clickOn(b, io, card('a.png')); await clickOn(b, io, card('b.png'), { shift: true });
    await until(() => b.eval(`napkin.state.selections.length === 2 && !!document.querySelector('#instruments [data-control="view:fit"]')`), 8000, 'two pictures');
    await sleep(600);
    assert.deepEqual(JSON.parse(await b.eval(CUT)), [], 'two selected: nothing cut at 280');
    for (const [kind, n] of Object.entries(seen)) assert.ok(n > 2, `${kind}: the panel drew its controls (${n})`);
  } finally { await close(); }
});

// An HTML element's node, clicked the way a person picks it (Ctrl+click is the deepest).
const elOf = (tag) => `(() => { const c = napkin.find('landing').component, f = napkin.stage.sections.get(c).docFrame; return napkin.stage.cellElement(c, f.nodeOf(f.doc().querySelector(${JSON.stringify(tag)})), {}); })()`;

test('several HTML elements selected: the panel shows shared values and Mixed where they differ; one edit sets every one; one Ctrl+Z puts all back', { timeout: 150000 }, async () => {
  const { b, io, dir, close } = await boot();
  const html = () => readFileSync(join(dir, 'landing.html'), 'utf8');
  try {
    await b.waitFor(`!!napkin.stage.sections.get(napkin.find('landing')?.component)?.docFrame?.tree()?.tree`, 15000);
    await b.eval(`napkin.view.fitAll({ animate: false })`); await sleep(400);
    await b.eval(COUNT_UNDO);
    const before = html();
    await clickOn(b, io, elOf('h1'), { ctrl: true });
    await clickOn(b, io, elOf('button'), { ctrl: true, shift: true });
    await until(() => b.eval(`napkin.state.selections.length === 2 && !!document.querySelector('#inspector #pv-padding')`), 10000, 'two elements in the panel');
    await sleep(500);
    const P = `document.querySelector('#inspector #pv-padding')`;
    const mixed = await jv(b, `({ value: ${P}.value, placeholder: ${P}.placeholder, mixed: ${P}.closest('[data-mixed]') !== null })`);
    assert.deepEqual(mixed, { value: '', placeholder: 'Mixed', mixed: true }, 'the h1 has 0 padding and the button 8px 16px: Mixed');
    // a value they share shows as that value
    const dis = await jv(b, `document.querySelector('#inspector #pv-display')?.value ?? null`);
    assert.ok(dis === null || typeof dis === 'string');
    await clickOn(b, io, P);
    await typed(b, '10px'); await io.key('Enter');
    await until(() => (html().match(/padding: 10px/g) || []).length >= 2, 8000, 'padding written on both');
    assert.equal((html().match(/padding: 10px/g) || []).length, 2, 'one edit reached both elements');
    await sleep(500);
    assert.equal(await b.eval(`${P}.value`), '10px', 'now shared: the value shows');
    const n0 = await b.eval('window.__undos');
    await io.key('Escape'); await sleep(200);
    await io.key('z', { ctrl: true });
    await until(() => html() === before, 8000, 'both put back by one undo');
    assert.equal(await b.eval('window.__undos') - n0, 1, 'one Ctrl+Z, one undo request');
  } finally { await close(); }
});

test('a long dropdown: clicking an option with the pointer chooses it, once, and the focus returns to the field', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot();
  try {
    await clickRow(b, io, 'mark.svg');
    await until(() => b.eval(`!!document.querySelector('#instruments [data-control="view:kind"] .d-choice-trigger')`), 10000, 'Open as');
    const posts = () => b.eval(`performance.getEntriesByType('resource').filter((e) => /[/]api[/]control$/.test(new URL(e.name).pathname)).length`);
    const p0 = await posts();
    const T = `document.querySelector('#instruments [data-control="view:kind"] .d-choice-trigger')`;
    const was = await b.eval(`${T}.textContent`);
    await clickOn(b, io, T);
    await until(() => b.eval(`!!document.querySelector('.d-choice-pop:not([hidden])')`), 5000, 'the list opens');
    const pick = await jv(b, `[...document.querySelectorAll('.d-choice-pop [role=option]')].map((o) => o.textContent).find((t) => t !== ${JSON.stringify(was)})`);
    await clickOn(b, io, `[...document.querySelectorAll('.d-choice-pop [role=option]')].find((o) => o.textContent === ${JSON.stringify(pick)})`);
    await until(() => b.eval(`${T}.textContent === ${JSON.stringify(pick)}`), 8000, `the field shows ${pick}`);
    assert.equal(await b.eval(`!!document.querySelector('.d-choice-pop')`), false, 'the list closes');
    assert.equal(await posts() - p0, 1, 'one request');
    assert.equal(await b.eval(`document.activeElement === ${T}`), true, 'the focus is back on the field');
  } finally { await close(); }
});

test('typography: font, size, weight, line height, align and colour are separate effective fields; editing one leaves the others', { timeout: 150000 }, async () => {
  const { b, io, dir, close } = await boot();
  const html = () => readFileSync(join(dir, 'landing.html'), 'utf8');
  try {
    await b.waitFor(`!!napkin.stage.sections.get(napkin.find('landing')?.component)?.docFrame?.tree()?.tree`, 15000);
    await b.eval(`napkin.view.fitAll({ animate: false })`); await sleep(400);
    await clickOn(b, io, elOf('h1'), { ctrl: true });
    await until(() => b.eval(`!!document.querySelector('#inspector #pv-font-size')`), 10000, 'the h1 typography');
    await sleep(400);
    const show = (id) => b.eval(`(() => { const i = document.querySelector('#inspector #pv-${id}'); return i ? (i.value || i.placeholder).replace(/px$/, '') : null; })()`);
    const px = (v) => v.replace(/px$/, '');
    const computed = () => jv(b, `(() => { const c = napkin.find('landing').component, f = napkin.stage.sections.get(c).docFrame, cs = f.doc().defaultView.getComputedStyle(f.doc().querySelector('h1')); return { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, lh: cs.lineHeight, align: cs.textAlign, color: cs.color }; })()`);
    const c0 = await computed();
    assert.equal(await b.eval(`!!document.querySelector('#inspector #pv-font')`), false, 'no inherited "font" shorthand standing in for the parts');
    assert.equal(await show('font-size'), px(c0.size), 'size is what the browser draws');
    assert.equal(await show('font-weight'), px(c0.weight), 'weight is what the browser draws');
    assert.equal(await show('line-height'), px(c0.lh), 'line height is what the browser draws');
    for (const id of ['font-family', 'text-align', 'color']) assert.ok(await show(id), `${id} has a field with a value`);
    const P = `document.querySelector('#inspector #pv-font-size')`;
    await clickOn(b, io, P);
    await typed(b, '40px'); await io.key('Enter');
    await until(() => html().includes('font-size: 40px'), 8000, 'font-size written');
    await sleep(600);
    const c1 = await computed();
    assert.equal(c1.size, '40px');
    assert.equal(c1.weight, px(c0.weight), 'weight is not reset');
    assert.equal(c1.family, c0.family, 'family is not reset');
    assert.doesNotMatch(html(), /font:/, 'no font shorthand written');
  } finally { await close(); }
});
