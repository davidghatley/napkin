// Basics, the right panel (docs/basics/standards.md section 7 and decision 0023): one panel that stays in the sidebar, is resized by its left
// edge (pointer, double-click, keys), remembers its width, and never covers the canvas: not at its narrowest, default or widest, not with a
// section's full editor open, not with the colour popover open. Width and height are the levers that reveal more: a wider panel shows more
// controls (colour sliders, X beside Y, a padding's sides), a long list shows six rows until its bottom edge is dragged down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

function folder() {
  const r = tempRepo(['Card', 'Button']);
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
async function boot(size = [1440, 900]) {
  const r = folder();
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: size[0], height: size[1] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.eval(`try { localStorage.removeItem('napkin.right'); localStorage.removeItem('napkin.left'); } catch {}`);
  await b.goto(server.url); // the width is restored before the first paint, so a clean start is a reload
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await sleep(400);
  return { b, io: input(b), url: server.url, close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
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
