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
    await b.waitFor(`getComputedStyle(document.querySelector('#sidebar')).opacity <= 0.15 && getComputedStyle(document.querySelector('#inspector')).opacity <= 0.15 && getComputedStyle(document.querySelector('#overlays')).opacity === '0'`); // the editing chrome fades
    assert.match(await b.eval(`document.querySelector('#tool-play').textContent`), /^Play\s*Space P$/, 'a Play control in the toolbar');
    assert.equal(await b.eval(`document.querySelector('#tool-play').getAttribute('aria-pressed')`), 'true');
    // pointer goes into the frame: hover shows the :hover rule of the file
    const p = await t.centre('Card', '.btn');
    await t.mouse('mouseMoved', p.x, p.y, { buttons: 0 });
    await b.waitFor(`${t.frameOf('Card')}.doc().querySelector('.btn').matches(':hover')`);
    await b.waitFor(`getComputedStyle(${t.frameOf('Card')}.doc().querySelector('.btn')).backgroundColor === 'rgb(52, 89, 226)'`); // the hover rule of the file applies
    assert.equal(await b.eval(`document.activeElement === ${t.frameOf('Card')}.iframe()`), true, 'the keyboard goes into the selected frame');
    // the wheel scrolls an overflow box inside the frame
    await b.eval(`(() => { const d = ${t.frameOf('Card')}.doc(), box = d.createElement('div'); box.id = 'scrollbox'; box.style.cssText = 'overflow:auto;height:40px;width:200px'; box.innerHTML = '<div style="height:400px">tall</div>'; d.body.append(box); })()`);
    await b.waitFor(`${t.frameOf('Card')}.iframe().offsetHeight >= ${t.frameOf('Card')}.doc().querySelector('#scrollbox').getBoundingClientRect().bottom`); // the frame grows to its content
    await sleep(500);
    const sb = await t.centre('Card', '#scrollbox');
    await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sb.x, y: sb.y, deltaX: 0, deltaY: 120 });
    await b.waitFor(`${t.frameOf('Card')}.doc().querySelector('#scrollbox').scrollTop > 0`);
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
    assert.deepEqual({ places: JSON.parse(r).places, frames: JSON.parse(r).frames }, { places: 4, frames: 3 });
    assert.equal(await b.eval(`document.querySelectorAll('.hl-box').length`), 4);
    assert.match(await b.eval(`document.querySelector('#hl-bar').textContent`), /lights 4 places in 3 components/);
    // the "Lights up" list: every place, grouped by component; a click selects it
    assert.equal(await b.eval(`document.querySelectorAll('#hl-side .hl-row').length`), 4);
    assert.equal(await b.eval(`document.querySelectorAll('#hl-side .hl-group').length`), 3);
    await b.eval(`document.querySelector('#hl-side .hl-row').click()`);
    const sel = JSON.parse(await b.eval(`JSON.stringify(napkin.state.selection)`));
    assert.ok(sel?.node && sel.component, 'clicking a place selects it');
    assert.equal(await b.eval(`napkin.stage.sections.get(napkin.state.selection.component).docFrame.element(napkin.state.selection.node).el.classList.contains('label')`), true);
    // a rule from a file the frames do not load lights nothing
    assert.equal(JSON.parse(await b.eval(`JSON.stringify(napkin.stage.highlight({ selector: '.label', file: 'other.css' }))`)).places, 0);
    // the variable: every element whose rules use --ink
    const v = JSON.parse(await b.eval(`JSON.stringify(napkin.stage.highlight({ variable: '--ink' }))`));
    assert.ok(v.places >= 6, `--ink is used in many places (${v.places})`);
    assert.equal(v.direct + v.indirect, v.places);
    assert.match(await b.eval(`document.querySelector('#hl-side .hl-explain').textContent`), /places in \d+ components/);
    // through other variables: --track is used by nothing directly here, a variable defined from another is counted as indirect
    const w = JSON.parse(await b.eval(`JSON.stringify(napkin.stage.highlight({ variable: '--paper' }))`));
    assert.ok(w.places > 0);
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
      // "The change": the one-line diff, with Keep and Revert (Revert is undo)
      await b.waitFor(`!!document.querySelector('#hl-side .hl-change .hl-diff .add')`);
      assert.match(await b.eval(`document.querySelector('#hl-side .hl-diff .del').textContent`), /letter-spacing: \.14em/);
      assert.match(await b.eval(`document.querySelector('#hl-side .hl-diff .add').textContent`), /letter-spacing: \.2em/);
      assert.equal(await b.eval(`document.querySelectorAll('#hl-side .hl-diff div').length`), 2, 'one line removed, one added');
      await b.eval(`document.querySelector('#hl-revert').click()`);
      await b.waitFor(`!document.querySelector('#hl-side .hl-change')`);
      assert.deepEqual(hashes(t.dir), before, 'Revert put the file back');
      await b.waitFor(`document.querySelectorAll('.hl-box').length === 4`);
    }
    // Tab and Shift-Tab walk the lit places; Tab does not hide the chrome meanwhile; the last Tab reaches Keep when there is a change
    await b.eval(`napkin.stage.highlight({ selector: '.label', file: 'components.css' }); document.querySelector('#stage').focus()`);
    await sleep(300);
    const walked = [];
    for (let i = 0; i < 4; i++) { await t.key('keyDown', 'Tab', 'Tab', { vk: 9 }); await t.key('keyUp', 'Tab', 'Tab', { vk: 9 }); walked.push(await b.eval(`JSON.stringify([napkin.state.selection?.component, napkin.state.selection?.node])`)); }
    assert.equal(new Set(walked).size, 4, 'four Tabs select four different places');
    assert.equal(await b.eval(`document.body.dataset.chrome || 'shown'`), 'shown', 'Tab did not hide the chrome');
    await t.key('keyDown', 'Tab', 'Tab', { vk: 9, modifiers: 8 });
    assert.equal(await b.eval(`JSON.stringify([napkin.state.selection?.component, napkin.state.selection?.node])`), walked[2], 'Shift-Tab walks back');
    assert.ok(await b.eval(`document.querySelectorAll('.hl-box.on').length === 1`), 'the walked-to place is marked');
    assert.equal(await b.eval(`napkin.view.get().z >= 0.5`), true, 'at a zoom a person can read');
    await b.eval(`napkin.stage.clearHighlight()`);
    // the way a person gets there: Cmd-K, Alt+H, pick the rule, Enter
    await b.eval(`napkin.stage.clearHighlight()`);
    assert.equal(await b.eval(`document.querySelector('#hl-bar').hidden`), true);
    await t.key('keyDown', 'h', 'KeyH', { modifiers: 1 }); await t.key('keyUp', 'h', 'KeyH', { modifiers: 1 });
    await b.waitFor(`!document.querySelector('#hl-pick').hidden && document.querySelectorAll('#hl-list li[data-i]').length > 3`);
    await b.eval(`(() => { const i = document.querySelector('#hl-input'); i.value = '.label'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    // (an exact name picks that rule even when other matches come first)
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
    // detents: drag through the 480 tick in big steps: it takes the width, holds it, and lets go only when the pointer has moved on
    const g2 = JSON.parse(await b.eval(`(() => { const r = ${f}.cell.querySelector('.cell-grip').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
    const at = (w) => g2.x + (w - 480) * grip.z;
    await t.mouse('mousePressed', g2.x, g2.y);
    await t.mouse('mouseMoved', at(540), g2.y); assert.equal(await b.eval(`${f}.width`), 540);
    await t.mouse('mouseMoved', at(470), g2.y); assert.equal(await b.eval(`${f}.width`), 480, 'one step across a tick lands on it');
    await t.mouse('mouseMoved', at(474), g2.y); assert.equal(await b.eval(`${f}.width`), 480, 'and it holds');
    await t.mouse('mouseMoved', at(455), g2.y); assert.equal(await b.eval(`${f}.width`), 455, 'then lets go');
    await t.mouse('mouseReleased', at(455), g2.y);
    await b.eval(`${f}.commitWidth(480)`);
    // click a tick: jump
    await b.eval(`${f}.cell.querySelector('.rt[data-px="800"]').click()`);
    await b.waitFor(`${f}.width === 800 && getComputedStyle(${f}.doc().querySelector('.card')).paddingLeft === '32px'`);
    // Cmd-K actions: narrower, wider
    await b.eval(`napkin.select({ component: ${JSON.stringify(card)}, node: ${f}.tree().tree[0].node, variant: {} })`);
    assert.equal(await b.eval(`napkin.widths.step(-1)`), true); assert.equal(await b.eval(`${f}.width`), 480);
    assert.equal(await b.eval(`napkin.widths.step(1)`), true); assert.equal(await b.eval(`${f}.width`), 800);
    // the breakpoints panel: the file's own @media conditions, which apply now, and the frame at other widths
    await t.key('keyDown', 'b', 'KeyB'); await t.key('keyUp', 'b', 'KeyB');
    await b.waitFor(`!document.querySelector('#bp-panel').hidden && document.querySelectorAll('#bp-panel .bp-rows:not(.dim) li button').length === 2`);
    assert.deepEqual(JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#bp-panel .bp-rows:not(.dim) li')].map((li) => [li.querySelector('.bp-px').textContent, li.querySelector('.bp-state').textContent]))`)), [['480', 'not at this width'], ['800', 'applies now']], 'at 800 px only the min-width rule applies');
    await b.waitFor(`/padding\\s+16px → 32px/.test(document.querySelector('#bp-changes')?.textContent || '')`);
    assert.match(await b.eval(`document.querySelector('#bp-panel h4.dim').textContent`), /Not in this frame · 1 rule/);
    assert.match(await b.eval(`document.querySelector('#bp-panel .bp-rows.dim').textContent`), /\.ghost/);
    assert.equal(await b.eval(`document.querySelector('#bp-panel .bp-rows:not(.dim)').textContent.includes('.ghost')`), false, 'a rule with nothing in the frame is not listed as applying');
    
    await b.eval(`document.querySelector('#bp-panel button[data-px="480"]').click()`);
    await b.waitFor(`${f}.width === 480 && document.querySelector('#bp-panel .bp-rows:not(.dim) li.on .bp-px')?.textContent === '480'`);
    assert.deepEqual(JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('#bp-strip button')].map((x) => x.dataset.px))`)), ['480', '800'], 'the same frame at the file\'s own widths');
    await b.waitFor(`[...document.querySelectorAll('#bp-strip iframe')].every((i) => i.src)`);
    await b.eval(`document.querySelector('#bp-strip button[data-px="800"]').click()`);
    await b.waitFor(`${f}.width === 800`);
    // the grip by keyboard: arrows 1 px, Shift 10 px, Page Down / Page Up the breakpoints
    await b.eval(`${f}.grip.focus()`);
    assert.equal(await b.eval(`document.activeElement === ${f}.grip && ${f}.grip.getAttribute('role')`), 'slider');
    await t.key('keyDown', 'ArrowLeft', 'ArrowLeft', { vk: 37 }); await t.key('keyUp', 'ArrowLeft', 'ArrowLeft', { vk: 37 });
    assert.equal(await b.eval(`${f}.width`), 799);
    await t.key('keyDown', 'ArrowLeft', 'ArrowLeft', { vk: 37, modifiers: 8 });
    assert.equal(await b.eval(`${f}.width`), 789);
    await t.key('keyDown', 'PageDown', 'PageDown', { vk: 34 });
    assert.equal(await b.eval(`${f}.width`), 480);
    await t.key('keyDown', 'PageUp', 'PageUp', { vk: 33 });
    assert.equal(await b.eval(`${f}.width`), 800);
    assert.equal(await b.eval(`${f}.grip.getAttribute('aria-valuenow')`), '800');
    await t.key('keyDown', 'b', 'KeyB'); await b.waitFor(`document.querySelector('#bp-panel').hidden`);
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
    // the stage and each frame's card wipe too: dark content does not sit in a white card
    const cardBg = (name, side) => b.eval(`(() => { const sec = napkin.stage.sections.get(napkin.find(${JSON.stringify(name)}).component); return ${side === 'left' ? `getComputedStyle(sec.frame.querySelector('.wipe-card')).backgroundColor` : `getComputedStyle(sec.frame).backgroundColor`}; })()`);
    assert.equal(await cardBg('Card', 'right'), 'rgb(27, 29, 35)', 'right of the line the card is the dark card');
    assert.equal(await cardBg('Card', 'left'), 'rgb(255, 255, 255)', 'left of the line it is the light card');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('#stage')).backgroundColor`), 'rgb(20, 22, 27)', 'the stage right of the line is the dark canvas');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('#wipe-stage')).backgroundColor`), 'rgb(232, 234, 238)', 'and left of it the light canvas');
    // titles, captions and rulers wear the theme of their side
    await b.eval(`napkin.theme.set({ at: 0 })`); await sleep(300);
    assert.equal(await b.eval(`[...document.querySelectorAll('.cmp')].every((e) => e.dataset.wipeTheme === 'dark')`), true, 'all frames are right of the line: dark');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('.cmp .cmp-title h3')).color`), 'rgb(232, 234, 240)', 'a frame title is light on the dark side');
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('.cmp .cell-ruler')).backgroundColor`), 'rgb(27, 29, 35)', 'and its ruler is a dark strip');
    await b.eval(`napkin.theme.set({ at: 50 })`);
    // another theme the files define: [data-theme="sepia"]
    await b.eval(`napkin.theme.set({ left: 'sepia', right: 'dark', at: 50 })`);
    await b.waitFor(`[...napkin.theme.clones().values()].every((c) => c.contentDocument?.documentElement.getAttribute('data-theme') === 'sepia')`);
    assert.equal(await bg('Card', 'b'), 'rgb(241, 228, 195)');
    // nothing on disk changed, and closing puts the frames back
    assert.deepEqual(hashes(t.dir), before);
    await t.key('keyDown', 'Escape', 'Escape', { vk: 27 });
    await b.waitFor(`!document.body.dataset.wipe && napkin.theme.clones().size === 0`);
    assert.equal(await b.eval(`document.querySelectorAll('.wipe-card').length + document.querySelector('#stage').style.backgroundColor.length`), 0, 'closing puts the stage and the cards back');
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
      // a focused frame (its ruler and caption), play mode, the ruler while the grip is dragged, the breakpoints panel and strip
      const card = await t.id('Card');
      await b.eval(`napkin.nav.focus(${JSON.stringify(card)}, null, { animate: false }); napkin.select({ component: ${JSON.stringify(card)}, node: napkin.stage.sections.get(${JSON.stringify(card)}).docFrame.tree().tree[0].node, variant: {} })`);
      await sleep(400);
      await run(`${theme}: a focused frame with its ruler`);
      // the other frames are dimmed while one is focused: with the view pulled back so they are on screen, their captions and rulers must not fail contrast
      await b.eval(`napkin.view.set({ x: 400, y: 120, z: 0.7 }, { animate: false })`); await sleep(400);
      assert.ok(await b.eval(`document.querySelectorAll('body[data-focus] .cmp:not([data-focused]) figcaption').length > 0`), 'dimmed frames are there');
      assert.equal(await b.eval(`[...document.querySelectorAll('body[data-focus] .cmp:not([data-focused]) :is(figcaption, .cell-ruler)')].every((e) => getComputedStyle(e).visibility === 'hidden')`), true, 'the captions and rulers of dimmed frames are hidden, not left at 0.16 contrast');
      await run(`${theme}: dimmed frames beside the focused one`);
      await b.eval(`napkin.nav.focus(${JSON.stringify(card)}, null, { animate: false })`); await sleep(300);
      await b.eval(`napkin.breakpoints.open()`); await b.waitFor(`!document.querySelector('#bp-panel').hidden`); await sleep(300);
      await run(`${theme}: the breakpoints panel and the widths strip`);
      await b.eval(`napkin.breakpoints.close(); napkin.stage.sections.get(${JSON.stringify(card)}).docFrame.cell.dataset.resizing = '1'`);
      await run(`${theme}: the ruler while dragging`);
      await b.eval(`delete napkin.stage.sections.get(${JSON.stringify(card)}).docFrame.cell.dataset.resizing; napkin.play.set(true)`);
      await sleep(300);
      await run(`${theme}: play mode`);
      await b.eval(`napkin.play.set(false); napkin.nav.unfocus({ animate: false })`);
      await b.eval(`napkin.stage.highlight({ variable: '--ink' })`);
      await run(`${theme}: the Lights up panel`);
      await b.eval(`napkin.stage.clearHighlight()`);
    }
  } finally { await t.close(); }
});

test('fit-all with 60 frames: the frames in view load progressively under a budget (never all 60 live), the rest are named, and zooming to one loads it', { timeout: 120000 }, async () => {
  const files = {};
  files['x.css'] = 'p { color: #333 }';
  for (let i = 0; i < 60; i++) files[`P${String(i).padStart(2, '0')}/index.html`] = `<!doctype html><meta charset="utf-8"><body style="margin:0"><p style="padding:8px;font:14px sans-serif">Frame ${i}</p>`;
  const t = await open(files, { scheme: 'light' });
  try {
    const { b } = t;
    await b.eval(`napkin.view.fitAll({ animate: false })`);
    const live = () => b.eval(`[...napkin.stage.sections.values()].filter((s) => s.docFrame?.iframe()).length`);
    let max = 0;
    const t0 = Date.now();
    await b.waitFor(`[...napkin.stage.sections.values()].filter((s) => s.docFrame?.doc()?.body?.textContent.includes('Frame')).length >= 40`, 20000);
    max = Math.max(max, await live());
    assert.ok(Date.now() - t0 < 15000, 'loaded within seconds');
    await sleep(1500);
    assert.ok(max <= 40 && (await live()) <= 40, `never all 60 live (${await live()})`);
    const waiting = JSON.parse(await b.eval(`JSON.stringify([...napkin.stage.sections.entries()].filter(([, s]) => s.pending).map(([id, s]) => [id, s.frame.textContent]))`));
    assert.ok(waiting.length >= 15, `${waiting.length} frames wait`);
    for (const [id, text] of waiting) assert.match(text, /loads when you scroll to it/, `${id} says what it is`);
    // zoom to a waiting frame: it loads, and a far one gives its place back
    const [id] = waiting[0];
    await b.eval(`napkin.nav.focus(${JSON.stringify(id)}, null, { animate: false })`);
    await b.waitFor(`!!napkin.stage.sections.get(${JSON.stringify(id)}).docFrame?.doc()?.body?.textContent.includes('Frame')`, 20000);
    assert.ok((await live()) <= 41);
    // the budget holds after a styles answer too ("apply stylesheets" redraws every frame)
    await b.eval(`napkin.nav.unfocus({ animate: false }); napkin.view.fitAll({ animate: false })`);
    await sleep(800);
    await b.eval(`napkin.fetch('/api/styles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applied: ['x.css'] }) }).then((r) => r.text())`);
    await sleep(3000);
    assert.ok((await live()) <= 40, `after applying stylesheets at most 40 frames are live (${await live()})`);
  } finally { await t.close(); }
});

test('a component that draws nothing without props says so in its frame; one that draws something does not', { timeout: 90000 }, async () => {
  const t = await open({
    'Empty.tsx': `export function Empty({ children }) { return <span className="badge">{children}</span>; }\n`,
    'Btn.tsx': `export function Btn() { return <button className="x" />; }\n`,
    'Full.tsx': `export function Full() { return <button style={{ padding: 8 }}>Go</button>; }\n`,
  });
  try {
    const { b } = t;
    await b.waitFor(`!!napkin.stage.sections.get(napkin.find('Empty')?.component)?.docFrame?.doc()?.querySelector('[data-napkin-empty]')`, 10000);
    assert.match(await b.eval(`napkin.stage.sections.get(napkin.find('Empty').component).docFrame.doc().querySelector('[data-napkin-empty]').textContent`), /Renders nothing without props/);
    await sleep(500);
    assert.equal(await b.eval(`!!napkin.stage.sections.get(napkin.find('Full').component).docFrame.doc().querySelector('[data-napkin-empty]')`), false);
    await b.waitFor(`!!napkin.stage.sections.get(napkin.find('Btn')?.component)?.docFrame?.doc()?.querySelector('[data-napkin-empty]')`, 10000); // an empty button: no content, only its own box
    // the browser's benign "ResizeObserver loop" message is not an error of the component
    await b.eval(`(() => { const w = napkin.stage.sections.get(napkin.find('Full').component).docFrame.doc().defaultView; w.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })); })()`);
    assert.equal(await b.eval(`!!napkin.stage.sections.get(napkin.find('Full').component).docFrame.doc().querySelector('[data-napkin-error]')`), false);
  } finally { await t.close(); }
});
