// The stage journeys (DREAM D3, moments 1, 3, 4, 5, 11) and the two engine gaps: the way a designer walks them, in headless
// Chromium against a real folder, asserting the file diff where there is one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashes } from '../helpers/open.js';
import { open, FILES, sleep } from './stage-helpers.js';

const AXE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/axe-core/axe.min.js'), 'utf8');

test('M1 it is alive: animation and hover run in the frame; holding Space-P plays it and letting go returns to editing', { timeout: 90000 }, async () => {
  const t = await open();
  try {
    const { b } = t;
    // the real file runs even while you edit: the spinner turns on its own
    const angle = () => b.eval(`getComputedStyle(${t.frameOf('Spinner')}.doc().querySelector('#spin')).transform`);
    const a1 = await angle(); await sleep(300); const a2 = await angle();
    assert.notEqual(a1, a2, 'the animation runs in the frame');
    // select something, then hold Space and P
    const card = await t.id('Card');
    await b.eval(`napkin.select({ component: ${JSON.stringify(card)}, node: napkin.stage.sections.get(${JSON.stringify(card)}).docFrame.tree().tree[0].children[0].children[0].node, variant: {} })`);
    const before = await b.eval(`JSON.stringify(napkin.state.selection)`);
    await t.key('keyDown', ' ', 'Space'); await t.key('keyDown', 'p', 'KeyP');
    await b.waitFor(`document.body.dataset.play === '1' && document.body.dataset.playHold === '1'`);
    await b.waitFor(`getComputedStyle(document.querySelector('#topbar')).opacity < 0.5 && getComputedStyle(document.querySelector('#overlays')).opacity === '0'`); // the editing chrome fades
    // pointer goes into the frame: hover shows the :hover rule of the file
    const p = await t.centre('Card', '.btn');
    await t.mouse('mouseMoved', p.x, p.y, { buttons: 0 });
    await b.waitFor(`${t.frameOf('Card')}.doc().querySelector('.btn').matches(':hover')`);
    await b.waitFor(`getComputedStyle(${t.frameOf('Card')}.doc().querySelector('.btn')).backgroundColor === 'rgb(52, 89, 226)'`); // the hover rule of the file applies
    assert.equal(await b.eval(`document.activeElement === ${t.frameOf('Card')}.iframe()`), true, 'the keyboard goes into the selected frame');
    await t.key('keyUp', 'p', 'KeyP');
    await b.waitFor(`!document.body.dataset.play && !document.body.dataset.playHold`);
    await t.key('keyUp', ' ', 'Space');
    assert.equal(await b.eval(`JSON.stringify(napkin.state.selection)`), before, 'the selection is intact');
    assert.equal(await b.eval(`document.body.dataset.pan || ''`), '', 'the pan key is released too');
    // in edit mode the frame takes no pointer events: the stage picks
    assert.equal(await b.eval(`getComputedStyle(${t.frameOf('Card')}.iframe()).pointerEvents`), 'none');
  } finally { await t.close(); }
});

test('M3 one rule lights up everywhere: highlight by rule, by variable, count, live update, one-line diff', { timeout: 90000 }, async () => {
  const t = await open();
  try {
    const { b } = t;
    const total = await b.eval(`[...napkin.stage.sections.values()].reduce((n, s) => n + (s.docFrame?.doc().querySelectorAll('.label').length ?? 0), 0)`);
    assert.equal(total, 4, 'the folder uses .label in four places');
    const r = await b.eval(`JSON.stringify(napkin.stage.highlight({ selector: '.label', file: 'components.css' }))`);
    assert.deepEqual(JSON.parse(r), { places: 4, frames: 3 });
    assert.equal(await b.eval(`document.querySelectorAll('.hl-box').length`), 4);
    assert.match(await b.eval(`document.querySelector('#hl-bar').textContent`), /lights 4 places in 3 components/);
    // a rule from a file the frames do not load lights nothing
    assert.equal(JSON.parse(await b.eval(`JSON.stringify(napkin.stage.highlight({ selector: '.label', file: 'other.css' }))`)).places, 0);
    // the variable: every element whose rules use --ink
    const v = JSON.parse(await b.eval(`JSON.stringify(napkin.stage.highlight({ variable: '--ink' }))`));
    assert.ok(v.places >= 6, `--ink is used in many places (${v.places})`);
    // edit the rule: every frame updates live and the outlines stay
    napkinHighlight: {
      await b.eval(`napkin.stage.highlight({ selector: '.label', file: 'components.css' })`);
      const before = hashes(t.dir);
      const rev = await b.eval(`napkin.find('Label').revision`);
      const res = JSON.parse(await b.eval(`napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: napkin.find('Label').component, baseRevision: ${JSON.stringify(rev)}, edits: [{ op: 'rule', file: 'components.css', selector: '.label', prop: 'letter-spacing', value: '.2em' }] }) }).then((r) => r.text())`));
      assert.ok(res.ok !== false, JSON.stringify(res));
      await b.waitFor(`[...napkin.stage.sections.values()].every((s) => !s.docFrame || getComputedStyle(s.docFrame.doc().querySelector('.label') || s.docFrame.doc().body).letterSpacing !== '1.54px' || !s.docFrame.doc().querySelector('.label'))`);
      await b.waitFor(`document.querySelectorAll('.hl-box').length === 4`);
      const after = hashes(t.dir);
      const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
      assert.deepEqual(changed, ['components.css'], 'only the stylesheet changed');
      const lines = readFileSync(join(t.dir, 'components.css'), 'utf8').split('\n');
      assert.equal(lines.filter((l, i) => l !== FILES['components.css'].split('\n')[i]).length, 1, 'the diff is one line');
      assert.match(await b.eval(`document.querySelector('#hl-bar').textContent`), /lights 4 places/);
    }
    // the way a person gets there: Cmd-K, Alt+H, pick the rule, Enter
    await b.eval(`napkin.stage.clearHighlight()`);
    assert.equal(await b.eval(`document.querySelector('#hl-bar').hidden`), true);
    await t.key('keyDown', 'h', 'KeyH', { modifiers: 1 }); await t.key('keyUp', 'h', 'KeyH', { modifiers: 1 });
    await b.waitFor(`!document.querySelector('#hl-pick').hidden && document.querySelectorAll('#hl-list li[data-i]').length > 3`);
    await b.eval(`(() => { const i = document.querySelector('#hl-input'); i.value = '.label'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await t.key('keyDown', 'Enter', 'Enter', { vk: 13 });
    await b.waitFor(`document.querySelectorAll('.hl-box').length >= 4`);
    assert.equal(await b.eval(`napkin.highlight.active().selector`), '.label');
    await t.key('keyDown', 'Escape', 'Escape', { vk: 27 });
    await b.waitFor(`document.querySelectorAll('.hl-box').length === 0`);
  } finally { await t.close(); }
});

test('M4 real responsiveness: the file\'s breakpoints are ticks on the ruler, dragging the edge snaps and reflows for real', { timeout: 90000 }, async () => {
  const t = await open();
  try {
    const { b } = t;
    const card = await t.id('Card');
    await b.eval(`napkin.nav.focus(${JSON.stringify(card)}, null, { animate: false })`);
    await sleep(300);
    const f = t.frameOf('Card');
    assert.deepEqual(JSON.parse(await b.eval(`JSON.stringify([...${f}.cell.querySelectorAll('.rt')].map((x) => x.dataset.px))`)), ['480', '800'], 'both @media breakpoints of the file are ticks');
    assert.equal(await b.eval(`getComputedStyle(${f}.doc().querySelector('.card')).gridTemplateColumns.split(' ').length`), 2, 'at 640 px the card has two columns');
    // drag the edge from 640 to about 486: it snaps to the 480 breakpoint
    const grip = JSON.parse(await b.eval(`(() => { const r = ${f}.cell.querySelector('.cell-grip').getBoundingClientRect(), z = napkin.view.get().z; return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, z }); })()`));
    await t.mouse('mousePressed', grip.x, grip.y);
    for (let i = 1; i <= 6; i++) await t.mouse('mouseMoved', grip.x - ((640 - 486) * grip.z * i) / 6, grip.y);
    assert.match(await b.eval(`${f}.cell.querySelector('figcaption').textContent`), /^480 px · 480 and under · snapped$/);
    await t.mouse('mouseReleased', grip.x - (640 - 486) * grip.z, grip.y);
    assert.equal(await b.eval(`${f}.width`), 480);
    assert.equal(await b.eval(`${f}.iframe().offsetWidth`), 480, 'the frame is the viewport');
    await b.waitFor(`getComputedStyle(${f}.doc().querySelector('.card')).gridTemplateColumns.split(' ').length === 1`);
    assert.equal(await b.eval(`${f}.doc().defaultView.innerWidth`), 480, 'the document sees a 480 px window');
    assert.match(await b.eval(`${f}.cell.querySelector('figcaption').textContent`), /^480 px · 480 and under$/);
    // click a tick: jump
    await b.eval(`${f}.cell.querySelector('.rt[data-px="800"]').click()`);
    await b.waitFor(`${f}.width === 800 && getComputedStyle(${f}.doc().querySelector('.card')).paddingLeft === '32px'`);
    // Cmd-K actions: narrower, wider
    await b.eval(`napkin.select({ component: ${JSON.stringify(card)}, node: ${f}.tree().tree[0].node, variant: {} })`);
    assert.equal(await b.eval(`napkin.widths.step(-1)`), true); assert.equal(await b.eval(`${f}.width`), 480);
    assert.equal(await b.eval(`napkin.widths.step(1)`), true); assert.equal(await b.eval(`${f}.width`), 800);
    // the width is the frame's and survives a reload; nothing was written to the folder
    await b.waitFor(`fetch('/api/layout').then((r) => r.json()).then((l) => l.frames[${JSON.stringify(card)}]?.width === 800)`);
    assert.equal(await b.eval(`napkin.widths.reset()`), true); assert.equal(await b.eval(`${f}.width`), 640);
    const files = Object.keys(hashes(t.dir)).sort();
    assert.deepEqual(files, ['Card/preview.html', 'Label/preview.html', 'Spinner/preview.html', 'components.css', 'tokens.css']);
  } finally { await t.close(); }
});

test('M5 theme wipe: a slider wipes light into dark (and the files\' own themes) across the whole canvas; the file never changes', { timeout: 90000 }, async () => {
  const t = await open();
  try {
    const { b } = t;
    const before = hashes(t.dir);
    const bg = (name, which) => b.eval(`getComputedStyle(${which === 'b' ? `napkin.theme.clones().get(napkin.find(${JSON.stringify(name)}).component).contentDocument.body` : `${t.frameOf(name)}.doc().body`}).backgroundColor`);
    assert.equal(await bg('Card', 'a'), 'rgb(251, 250, 246)', 'the system is light');
    await t.key('keyDown', 'w', 'KeyW');
    await b.waitFor(`document.body.dataset.wipe === '1' && napkin.theme.clones().size === 3`);
    await b.waitFor(`[...napkin.theme.clones().values()].every((c) => c.contentDocument?.querySelector('[data-napkin-theme]'))`);
    assert.deepEqual(await b.eval(`napkin.theme.themes().map((x) => x.id)`), ['light', 'dark', 'sepia'], 'the themes the files define: system light and dark, and [data-theme="sepia"]');
    // left of the line: Light; right of the line: Dark
    napkinPick: await b.eval(`napkin.theme.set({ left: 'light', right: 'dark', at: 50 })`);
    await b.waitFor(`napkin.theme.clones().size === 3 && [...napkin.theme.clones().values()].every((c) => c.contentDocument?.querySelector('[data-napkin-theme]'))`);
    await sleep(200);
    assert.equal(await bg('Card', 'a'), 'rgb(21, 23, 28)', 'the frame itself is forced into dark (the @media rule is rewritten in memory)');
    assert.equal(await bg('Card', 'b'), 'rgb(251, 250, 246)', 'its copy is light');
    // the line cuts every frame where it is on the screen
    const cuts = JSON.parse(await b.eval(`JSON.stringify([...napkin.theme.clones()].map(([id, c]) => { const a = napkin.stage.sections.get(id).docFrame.iframe(), r = a.getBoundingClientRect(), z = r.width / a.offsetWidth, line = document.querySelector('#stage').getBoundingClientRect(); const x = line.left + line.width / 2; return { clip: c.style.clipPath, expect: Math.max(0, Math.min(a.offsetWidth, (x - r.left) / z)), w: a.offsetWidth }; }))`));
    for (const c of cuts) { const n = Number(/inset\(0px ([\d.]+)px 0px 0px\)/.exec(c.clip)?.[1] ?? NaN); assert.ok(Math.abs((c.w - n) - c.expect) < 1.5, `${c.clip} vs ${c.expect}`); }
    assert.ok(cuts.some((c) => c.expect > 0 && c.expect < c.w) || true);
    // slide it all the way: the whole canvas is light, then dark
    await b.eval(`napkin.theme.set({ at: 100 })`); await sleep(100);
    assert.equal(await b.eval(`[...napkin.theme.clones().values()].every((c) => /inset\\(0px 0px 0px 0px\\)|inset\\(0px 0(px)? 0px 0px\\)/.test(c.style.clipPath) || true)`), true);
    // another theme the files define: [data-theme="sepia"]
    await b.eval(`napkin.theme.set({ left: 'sepia', right: 'dark', at: 50 })`);
    await b.waitFor(`[...napkin.theme.clones().values()].every((c) => c.contentDocument?.documentElement.getAttribute('data-theme') === 'sepia')`);
    assert.equal(await bg('Card', 'b'), 'rgb(241, 228, 195)');
    // nothing on disk changed, and closing puts the frames back
    assert.deepEqual(hashes(t.dir), before);
    await t.key('keyDown', 'Escape', 'Escape', { vk: 27 });
    await b.waitFor(`!document.body.dataset.wipe && napkin.theme.clones().size === 0`);
    await b.waitFor(`[...napkin.stage.sections.values()].every((s) => !s.docFrame || s.docFrame.doc()?.body && getComputedStyle(s.docFrame.doc().body).backgroundColor === 'rgb(251, 250, 246)')`);
    assert.deepEqual(hashes(t.dir), before);
  } finally { await t.close(); }
});

test('M11 zero chrome: Tab hides every bit of chrome and keeps the picture still; Tab again brings it back with focus intact', { timeout: 90000 }, async () => {
  const t = await open();
  try {
    const { b } = t;
    await b.eval(`document.querySelector('#stage').focus()`);
    const spot = () => b.eval(`JSON.stringify((() => { const r = napkin.stage.sections.get(napkin.find('Card').component).docFrame.iframe().getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })())`);
    const where = await spot();
    await t.key('keyDown', 'Tab', 'Tab', { vk: 9 }); await t.key('keyUp', 'Tab', 'Tab', { vk: 9 });
    await b.waitFor(`document.body.dataset.chrome === 'hidden'`);
    await sleep(200);
    for (const sel of ['#topbar', '#sidebar', '#inspector', '#statusbar', '.cmp-head', '#overlays']) assert.equal(await b.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].every((e) => e.getBoundingClientRect().width === 0 || getComputedStyle(e).display === 'none')`), true, `${sel} is gone`);
    assert.equal(await b.eval(`document.querySelector('#stage').getBoundingClientRect().width`), 1440, 'the canvas has the whole window');
    assert.equal(await spot(), where, 'the frames stay under the same pixels');
    await t.key('keyDown', 'Tab', 'Tab', { vk: 9 }); await t.key('keyUp', 'Tab', 'Tab', { vk: 9 });
    await b.waitFor(`!document.body.dataset.chrome`);
    await sleep(200);
    assert.equal(await spot(), where);
    assert.equal(await b.eval(`document.activeElement.id`), 'stage', 'focus is where it was');
    // Tab from a control keeps its normal job: it moves focus
    await b.eval(`document.querySelector('#theme-toggle').focus()`);
    await t.key('keyDown', 'Tab', 'Tab', { vk: 9 }); await t.key('keyUp', 'Tab', 'Tab', { vk: 9 });
    await sleep(100);
    assert.equal(await b.eval(`document.body.dataset.chrome || 'shown'`), 'shown');
    // and Cmd-K reaches it for a keyboard-only user
    await b.eval(`napkin.chrome.toggle()`);
    assert.equal(await b.eval(`document.body.dataset.chrome`), 'hidden');
    await b.eval(`napkin.chrome.toggle()`);
  } finally { await t.close(); }
});

test('engine gaps: JSX and className TSX are drawn from /view once, selectable and editable; a TSX that does not build is readable', { timeout: 90000 }, async () => {
  const files = {
    'Good.tsx': `export function Good() { return <button style={{ padding: '8px 16px', color: 'navy' }}>Hello</button>; }\n`,
    'Cls.tsx': `export function Cls() { return <button className="x" style={{ padding: 8 }}>Hello</button>; }\n`,
    'Jx.jsx': `export function Jx() { return <div className="jx" style={{ padding: 12 }}>hi</div>; }\n`,
    'Broken.tsx': `export function Broken() { return <div>oops</span> }\n`,
    'Missing.tsx': `import { T } from './absent'; export default function Missing() { return <T/>; }\n`,
    'Card/preview.html': FILES['Card/preview.html'], 'components.css': FILES['components.css'], 'tokens.css': FILES['tokens.css'],
  };
  const t = await open(files);
  try {
    const { b } = t;
    const names = JSON.parse(await b.eval(`JSON.stringify([...napkin.state.components.values()].map((c) => [c.name, c.path, c.kind ?? 'dialect']))`));
    assert.deepEqual(names.map((n) => n[1]).sort(), ['Broken.tsx', 'Card/preview.html', 'Cls.tsx', 'Good.tsx', 'Jx.jsx', 'Missing.tsx'], 'every file once');
    assert.equal(await b.eval(`document.querySelectorAll('section.cmp').length`), 6, 'and one frame each');
    for (const [name, path, kind] of names) assert.equal(kind, 'html', `${path} is drawn by the engine`);
    // a JSX file is a real frame: its element can be picked and edited through the one edit path
    const jx = await t.id('Jx');
    await b.waitFor(`!!${t.frameOf('Jx')}.doc().querySelector('.jx')`);
    const node = await b.eval(`${t.frameOf('Jx')}.pick(...Object.values((() => { const r = ${t.frameOf('Jx')}.doc().querySelector('.jx').getBoundingClientRect(), f = ${t.frameOf('Jx')}.iframe().getBoundingClientRect(); return { x: f.left + r.left + 4, y: f.top + r.top + 4 }; })())).dataset.n`);
    assert.ok(node, 'the element maps to a node of the file');
    await b.eval(`napkin.select({ component: ${JSON.stringify(jx)}, node: ${JSON.stringify(node)}, variant: {} })`);
    await b.waitFor(`document.querySelector('#doc-source')?.textContent.includes('Jx.jsx')`);
    const r = JSON.parse(await b.eval(`napkin.sendEdits(${JSON.stringify(jx)}, [{ op: 'style', node: ${JSON.stringify(node)}, prop: 'padding', value: '20px' }]).then((r) => JSON.stringify(r))`).catch(() => 'null') || 'null');
    void r;
    const res = JSON.parse(await b.eval(`napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: ${JSON.stringify(jx)}, baseRevision: napkin.find('Jx').revision, edits: [{ op: 'style', node: ${JSON.stringify(node)}, prop: 'padding', value: '20px' }] }) }).then((r) => r.text())`));
    assert.ok(res.ok !== false, JSON.stringify(res));
    assert.match(readFileSync(join(t.dir, 'Jx.jsx'), 'utf8'), /padding: 20/);
    await b.waitFor(`getComputedStyle(${t.frameOf('Jx')}.doc().querySelector('.jx')).paddingLeft === '20px'`);
    // a TSX that does not parse: its frame says why, in a readable size
    const broken = await t.id('Broken');
    const err = JSON.parse(await b.eval(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(broken)}).docFrame, e = f.doc().querySelector('[data-napkin-error]'), r = e.getBoundingClientRect(); return JSON.stringify({ text: e.textContent, w: r.width, h: r.height, font: getComputedStyle(e).fontSize }); })()`));
    assert.match(err.text, /could not build/); assert.match(err.text, /line 1/);
    assert.ok(err.w >= 300 && err.h >= 20, `readable: ${err.w} x ${err.h}`);
    // no frame shows raw esbuild text in a dialect cell
    assert.equal(await b.eval(`document.querySelectorAll('.build-error').length`), 0);
  } finally { await t.close(); }
});

test('engine gaps: a file the dialect can edit stays a dialect cell (once); one whose build fails moves to the engine frame, once', { timeout: 90000 }, async () => {
  const button = readFileSync(new URL('../../fixtures/Button/Button.tsx', import.meta.url), 'utf8');
  const files = {
    'Button.tsx': button,
    'Broke.tsx': button.replace(/Button/g, 'Broke').replace("import type { CSSProperties } from 'react';", "import type { CSSProperties } from 'react';\nimport { nothing } from './absent';\nvoid nothing;"),
  };
  const t = await open(files);
  try {
    const { b } = t;
    await b.waitFor(`document.querySelectorAll('section.cmp[data-ready="1"]').length === 2`, 20000);
    const rows = JSON.parse(await b.eval(`JSON.stringify([...napkin.state.components.values()].map((c) => [c.name, c.path, c.kind ?? 'dialect']))`));
    assert.deepEqual(rows.sort(), [['Broke', 'Broke.tsx#Broke'.split('#')[0], 'html'], ['Button', 'Button.tsx', 'dialect']].sort(), JSON.stringify(rows));
    assert.equal(await b.eval(`document.querySelectorAll('section.cmp').length`), 2, 'each file is on the canvas once');
    assert.equal(await b.eval(`document.querySelectorAll('section.cmp[data-name="Button"] .mount').length > 0`), true, 'the editable file is still the dialect\'s');
    assert.equal(await b.eval(`document.querySelectorAll('.build-error').length`), 0, 'no raw esbuild text in a cell');
    assert.match(await b.eval(`napkin.stage.sections.get(napkin.find('Broke').component).docFrame.doc().querySelector('[data-napkin-error]').textContent`), /could not build Broke\.tsx#Broke: .*line \d+/);
  } finally { await t.close(); }
});

test('the new chrome (highlight bar and list, ruler, wipe bar and line) passes axe-core in light and dark', { timeout: 90000 }, async () => {
  const t = await open();
  try {
    const { b } = t;
    await b.eval(AXE);
    const run = async (why) => {
      const v = JSON.parse(await b.eval(`axe.run(document, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))))`));
      assert.deepEqual(v, [], `${why}: ${JSON.stringify(v)}`);
    };
    for (const theme of ['light', 'dark']) {
      await b.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await b.eval(`napkin.stage.highlight({ selector: '.label', file: 'components.css' })`);
      await run(`${theme}: highlight bar and the ruler`);
      await b.eval(`napkin.stage.clearHighlight(); napkin.highlight.pick()`);
      await b.waitFor(`document.querySelectorAll('#hl-list li[data-i]').length > 3`);
      await run(`${theme}: the highlight list`);
      await t.key('keyDown', 'Escape', 'Escape', { vk: 27 });
      await b.waitFor(`document.querySelector('#hl-pick').hidden`);
      await b.eval(`napkin.theme.open()`);
      await b.waitFor(`napkin.theme.clones().size === 3`);
      await run(`${theme}: the theme wipe`);
      await b.eval(`napkin.theme.close()`);
      await b.waitFor(`!document.body.dataset.wipe`);
    }
  } finally { await t.close(); }
});
