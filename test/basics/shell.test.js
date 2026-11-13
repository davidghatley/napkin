// Basics pass 1, the shell (docs/basics/standards.md sections 1, 6 and 10): what a person notices about the top bar and the left panel.
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
  writeFileSync(join(r.compDir, 'theme.css'), `:root { --ink: #1d2433; --paper: #fbf7ef; }\nbody { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }\n.hero { padding: 32px; } .cards { display: flex; gap: 16px; padding: 0 32px 32px; } .card { padding: 16px; border: 1px solid #d9d2c3; border-radius: 8px; }\n.cta { padding: 8px 16px; border: 0; border-radius: 6px; background: #1d2433; color: #fff; }\n`);
  writeFileSync(join(r.compDir, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16L2 18z" fill="#1d2433"/></svg>\n`);
  writeFileSync(join(r.compDir, 'notes.md'), '# Notes\n\nThe shell comes first.\n');
  return r;
}
const box = (b, sel) => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; })()`);
async function axe(b, include) {
  await b.eval(AXE);
  return JSON.parse(await b.eval(`axe.run(${include ? `{ include: ${JSON.stringify(include.map((s) => [s]))} }` : 'document'}, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))))`));
}
async function theme(b, want) {
  await b.eval(`(() => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== ${JSON.stringify(want)}) document.querySelector('#theme-toggle').click(); })()`);
}
async function boot(size) {
  const r = folder();
  const server = await startServer(r.compDir, { timeout: 20000 });
  const b = await launchChromium({ width: size[0], height: size[1] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.eval(`try { localStorage.removeItem('napkin.left'); } catch {}`);
  await sleep(500);
  return { b, io: input(b), close: async () => { await b.close(); await server.stop(); rmSync(r.dir, { recursive: true, force: true }); } };
}

test('basics pass 1: the top bar has three zones in order, four tools on the centre line, one pixel mark', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot([1440, 900]);
  try {
    const bar = await box(b, '#topbar'), left = await box(b, '.bar-left'), tools = await box(b, '#toolbar'), right = await box(b, '.top-right');
    assert.equal(bar.h, 40, 'a 40 px bar');
    assert.ok(left.r <= tools.l && tools.r <= right.l, 'brand | tools | status, left to right');
    assert.ok(Math.abs((tools.l + tools.r) / 2 - 720) <= 1, `the tools sit on the window's centre line (${(tools.l + tools.r) / 2})`);
    // the left zone: the pixel glyph, the folder name, the panel button; nothing else
    assert.deepEqual(JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('.bar-left > *, .brand > :not(.sr-only)')].map((e) => e.id || e.className.baseVal || e.className))`)), ['brand', 'glyph', 'folder', 'panel-toggle']);
    const glyph = JSON.parse(await b.eval(`JSON.stringify((() => { const s = document.querySelector('.brand svg'); return { crisp: s.getAttribute('shape-rendering'), d: s.querySelector('path').getAttribute('d'), w: s.getBoundingClientRect().width }; })())`));
    assert.equal(glyph.crisp, 'crispEdges'); assert.equal(glyph.w, 15, 'three pixels a cell');
    assert.equal(glyph.d, 'M0 0h20v4H0zM0 4h16v4H0zM0 8h12v4H0zM0 12h8v4H0zM0 16h4v4H0z', 'the 5x5 folded napkin of public/brand/napkin-glyph.svg');
    assert.match(await b.eval(`document.querySelector('h1').textContent`), /^napkin: components$/);
    // the tools: Select, Frame, Text, Image, as named icon buttons; no New component, no Play
    const list = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#toolbar > *')].map((e) => ({ name: e.getAttribute('aria-label'), key: e.getAttribute('aria-keyshortcuts'), pressed: e.getAttribute('aria-pressed'), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })))`));
    assert.deepEqual(list.map((x) => `${x.name} ${x.key}`), ['Select V', 'Frame F', 'Text T', 'Image I']);
    assert.ok(list.every((x) => x.w === 32 && x.h === 32), 'one control size');
    assert.equal(await b.eval(`!!document.querySelector('#tool-new, #new-component, #tool-play')`), false);
    assert.equal(await b.eval(`document.querySelector('#toolbar').getAttribute('role')`), 'toolbar');
    assert.deepEqual(list.map((x) => x.pressed), ['true', 'false', 'false', 'false']);
    // armed: the click arms it, the bar shows it, and F / V do the same from the keyboard
    await b.eval(`document.querySelector('#toolbar [data-tool=frame]').click()`);
    assert.equal(await b.eval(`document.querySelector('#toolbar [data-tool=frame]').getAttribute('aria-pressed') + ' ' + document.body.dataset.tool`), 'true frame');
    await sleep(300); // past the 120 ms state transition
    const armed = await b.eval(`getComputedStyle(document.querySelector('#toolbar [data-tool=frame]')).backgroundColor`), rest = await b.eval(`getComputedStyle(document.querySelector('#toolbar [data-tool=text]')).backgroundColor`);
    assert.notEqual(armed, rest, 'the armed tool has a fill');
    await b.eval(`document.activeElement.blur()`);
    await io.key('v');
    assert.equal(await b.eval(`document.body.dataset.tool`), 'select');
    // one tab stop, arrows move, the tooltip names the tool and its key
    await b.eval(`document.querySelector('#toolbar [tabindex="0"]').focus()`);
    await io.key('ArrowRight');
    assert.equal(await b.eval(`document.activeElement.dataset.tool`), 'frame');
    assert.equal(await b.eval(`[...document.querySelectorAll('#toolbar button')].filter((e) => e.tabIndex === 0).length`), 1);
    await b.waitFor(`!document.querySelector('#tip').hidden`);
    assert.equal(await b.eval(`document.querySelector('#tip').textContent`), 'FrameF');
    await io.key('Escape');
    assert.equal(await b.eval(`document.querySelector('#tip').hidden`), true, 'Escape hides the tooltip');
    // the right zone: one right-aligned group, flush to the bar's padding, the tools' gap: [people] [Jump to...] [theme]; the revision only with a selection, at the left end
    const group = () => b.eval(`JSON.stringify([...document.querySelectorAll('.top-right > *, .top-right .slot > *')].filter((e) => e.getBoundingClientRect().width > 1 && getComputedStyle(e).display !== 'contents').map((e) => { const r = e.getBoundingClientRect(); return { n: e.id || e.className, l: r.left, r: r.right }; }))`).then(JSON.parse);
    let g = await group();
    assert.deepEqual(g.map((x) => x.n), ['avatars', 'quick-open', 'theme-toggle']);
    const jump = g[1].l;
    assert.equal(g.at(-1).r, 1440 - 4, 'flush to the bar padding');
    assert.deepEqual(g.slice(1).map((x, i) => x.l - g[i].r), [4, 4], 'the gap of the tools');
    assert.equal(await b.eval(`document.querySelector('#quick-open kbd').textContent`), 'Ctrl K', 'Linux says Ctrl, not the Command sign');
    assert.match(await b.eval(`document.querySelector('#panel .keys').textContent`), /Ctrl K/, 'the right-panel hints too');
    assert.doesNotMatch(await b.eval(`document.querySelector('#panel .keys').textContent + document.querySelector('#statusbar').textContent`), /[⌘⇧⌫]/);
    await b.eval(`napkin.select({ component: napkin.find('Card').component, node: 'title', variant: {} })`); await sleep(200);
    g = await group();
    assert.deepEqual(g.map((x) => x.n), ['meta', 'avatars', 'quick-open', 'theme-toggle'], 'the revision joins at the left end');
    assert.equal(g[2].l, jump, 'and Jump to... stays put');
    // the panel button follows the folder name, the tools' gap apart, open or closed
    for (const state of ['open', 'closed']) {
      const gap = await b.eval(`document.querySelector('#panel-toggle').getBoundingClientRect().left - document.querySelector('.brand').getBoundingClientRect().right`);
      assert.equal(gap, 4, `toggle after the folder name (${state})`);
      await b.eval(`napkin.shell.toggleLeft()`);
    }
    await b.eval(`document.activeElement.blur()`);
  } finally { await close(); }
});

test('basics pass 1: the left panel reads at a glance and collapses (button and Ctrl+\\); the canvas takes the width', { timeout: 120000 }, async () => {
  const { b, io, close } = await boot([1440, 900]);
  try {
    assert.equal(await b.eval(`document.querySelector('#side-title').textContent`), 'Layers');
    assert.equal(await b.eval(`!!document.querySelector('.side-tabs, [role=tab], #changes, #log')`), false, 'no tab strip, no change log');
    // file rows: bold, a type glyph each, indented children 12 px a level
    const rows = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#layers .lrow')].map((r) => ({ name: r.querySelector('.lname').textContent, level: Number(r.getAttribute('aria-level')), x: r.querySelector('.licon').getBoundingClientRect().left, weight: getComputedStyle(r.querySelector('.lname')).fontWeight, h: r.getBoundingClientRect().height, glyph: r.querySelector('.licon svg')?.innerHTML })))`));
    assert.ok(rows.length >= 6, JSON.stringify(rows.map((r) => r.name)));
    assert.ok(rows.every((r) => r.h === 28), 'one row height');
    const files = rows.filter((r) => r.level === 1);
    assert.ok(files.every((r) => r.weight === '600'), 'files are bold');
    assert.equal(new Set(files.map((r) => r.x)).size, 1, 'file glyphs line up');
    const glyphOf = (n) => files.find((r) => r.name === n).glyph;
    assert.equal(new Set(['Card', 'landing', 'theme.css', 'mark.svg', 'notes.md'].map(glyphOf)).size, 5, 'a component, a frame, a stylesheet, a vector and a text file each look different');
    for (const r of rows.filter((x) => x.level > 1)) { const parent = rows.slice(0, rows.indexOf(r)).reverse().find((p) => p.level === r.level - 1); assert.equal(r.x - parent.x, 12, `${r.name} is indented 12 px`); }
    const longest = await b.eval(`[...document.querySelectorAll('#layers .lname')].every((e) => e.scrollWidth <= e.clientWidth || getComputedStyle(e).textOverflow === 'ellipsis')`);
    assert.ok(longest, 'long names end in an ellipsis');
    // hover and selection
    await b.eval(`document.querySelector('#layers .lrow').click()`);
    assert.notEqual(await b.eval(`getComputedStyle(document.querySelector('#layers .lrow[aria-selected=true], #layers .lrow.primary') || document.querySelector('#layers .has-sel')).backgroundColor`), 'rgba(0, 0, 0, 0)');
    // collapse with the button: the panel goes, the canvas widens by its width, the picture stays put
    const stage = await box(b, '#stage'), side = await box(b, '#sidebar');
    const spot = () => b.eval(`(() => { const r = document.querySelector('section.cmp')?.getBoundingClientRect(); return r ? Math.round(r.left) : null; })()`);
    const before = await spot();
    await b.eval(`document.querySelector('#panel-toggle').click()`);
    await sleep(100);
    assert.equal(await b.eval(`document.querySelector('#panel-toggle').getAttribute('aria-expanded')`), 'false');
    assert.equal((await box(b, '#stage')).w, stage.w + side.w, 'the canvas takes the panel width');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('#sidebar')).visibility`), 'hidden');
    assert.equal(await spot(), before, 'the frames stay under the same pixels');
    // and back with Ctrl+\, remembered across a reload
    await b.eval(`document.activeElement.blur()`);
    await io.key('\\', { ctrl: true, code: 'Backslash' });
    await sleep(100);
    assert.equal((await box(b, '#stage')).w, stage.w);
    await io.key('\\', { ctrl: true, code: 'Backslash' });
    await sleep(100);
    await b.goto(await b.eval('location.href'));
    await b.waitFor('document.body.dataset.ready === "1"', 30000);
    assert.equal(await b.eval(`document.body.dataset.left`), 'closed', 'remembered');
    await b.eval(`document.querySelector('#panel-toggle').click()`);
    // Styles is off the panel's face but one palette phrase away; Escape goes back
    await b.eval(`napkin.stylesTab.show('styles')`);
    await b.waitFor(`document.querySelector('#side-title').textContent === 'Styles' && !document.querySelector('#side-back').hidden`);
    await io.key('Escape');
    await b.waitFor(`document.querySelector('#side-title').textContent === 'Layers' && !document.querySelector('#layers').hidden`);
  } finally { await close(); }
});

test('basics pass 1: axe finds nothing in the shell, light and dark, at 1440x900 and 1280x720', { timeout: 180000 }, async (t) => {
  for (const size of [[1440, 900], [1280, 720]]) {
    const { b, close } = await boot(size);
    try {
      for (const th of ['light', 'dark']) {
        await theme(b, th); await sleep(150);
        const shell = await axe(b, ['#topbar', '#sidebar']);
        t.diagnostic(`${size.join('x')} ${th}: ${shell.length} violations in the shell`);
        assert.deepEqual(shell, [], `${size.join('x')} ${th}`);
        const bar = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('.bar-left, #toolbar, .top-right > *')].filter((e) => e.getBoundingClientRect().width).map((e) => { const r = e.getBoundingClientRect(); return { n: e.id || e.className, l: r.left, r: r.right, t: r.top }; }))`));
        assert.ok(bar.every((e, i) => e.r <= size[0] && e.t < 40 && (i === 0 || e.l >= bar[i - 1].r - 0.5)), `the bar fits on one line without overlaps: ${JSON.stringify(bar)}`);
      }
    } finally { await close(); }
  }
});
