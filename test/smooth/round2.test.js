// Defects a whole-product walk found on the main paths, each walked here with real input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, sleep, FILES } from '../inspector/helpers.js';

const NOTE = 'Note/preview.html', PILL = 'Pill/preview.html';
const q2 = JSON.stringify(NOTE);
const THREE = { ...FILES, 'Other/preview.html': FILES[PILL].replace('Pill preview', 'Other'), 'Wide/preview.html': FILES[PILL].replace('Pill preview', 'Wide') };
const css = (a) => readFileSync(join(a.dir, 'components.css'), 'utf8');

test('1. Cmd-K on an HTML component selects it, says nothing about read-only', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    await a.q(`napkin.quick.open()`);
    await a.browser.send('Input.insertText', { text: 'Pill' }); await sleep(200);
    await a.io.key('Enter'); await sleep(400);
    assert.equal(await a.q(`napkin.state.selection.component`), PILL);
    assert.doesNotMatch(await a.q(`document.querySelector('#hint').textContent`), /read-only/);
  } finally { await a.close(); }
});

test('2. a widened frame keeps its grip on top, neighbours make way and come back', { timeout: 60000 }, async () => {
  const a = await open({ files: THREE, width: 1280, height: 720 });
  try {
    const f = (n) => `napkin.stage.sections.get(${JSON.stringify(n)})`;
    await sleep(1500); // the frames settle after the stylesheets are answered
    await a.q(`napkin.select({ component: ${q2}, node: napkin.stage.rootNode(${q2}), variant: {} })`);
    const others = ['Other/preview.html', PILL, 'Wide/preview.html'];
    const pos0 = await a.q(`JSON.stringify(${JSON.stringify(others)}.map((n) => ${f('n').replace('"n"', 'n')}.pos))`);
    await a.q(`${f(NOTE)}.docFrame.commitWidth(1500)`); await sleep(500);
    const overlap = await a.q(`(() => { const r = (n) => { const s = napkin.stage.sections.get(n); return { x: s.pos.x, y: s.pos.y, w: s.size.w, h: s.size.h }; }; const A = r(${q2}); return ${JSON.stringify(others)}.filter((n) => { const B = r(n); return A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y; }); })()`);
    assert.deepEqual(overlap, [], 'nothing under the wide frame');
    await a.q(`napkin.view.flyTo(napkin.stage.componentRect(${q2}), { pad: 80, max: 0.4 })`); await sleep(700);
    const hit = await a.q(`(() => { const g = ${f(NOTE)}.docFrame.grip.getBoundingClientRect(); return document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2)?.className; })()`);
    assert.match(String(hit), /cell-grip/);
    await a.q(`${f(NOTE)}.docFrame.commitWidth(640)`); await sleep(500);
    assert.equal(await a.q(`JSON.stringify(${JSON.stringify(others)}.map((n) => ${f('n').replace('"n"', 'n')}.pos))`), pos0, 'they go back');
  } finally { await a.close(); }
});

test('3. staging always ends clean: a click elsewhere or Esc, wherever the focus is', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    const body = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__body');
    const clean = async () => {
      assert.equal(await a.q(`[...napkin.stage.sections.values()].some((s) => s.docFrame?.doc()?.querySelector('style[data-napkin-preview]'))`), false, 'no preview');
      assert.equal(await a.q(`[...document.querySelectorAll('.cmp-note')].every((n) => n.hidden)`), true, 'no note');
      assert.notEqual(await a.q(`document.querySelector('#statusbar .hints').dataset.legend`), 'staged');
      assert.equal(await a.q(`napkin.inspector.state()`), null);
    };
    const stage = async () => { await a.select(NOTE, tag.node); await a.typeIn('#pv-padding', '7px'); await a.browser.waitFor(`[...napkin.stage.sections.values()].some((s) => s.docFrame?.doc()?.querySelector('style[data-napkin-preview]'))`, 8000); };
    await stage();
    await a.select(NOTE, body.node); await sleep(300);
    await clean();
    assert.match(await a.q(`document.querySelector('#hint').textContent`), /Cancelled padding/);
    await stage();
    await a.q(`document.activeElement.blur(); document.querySelector('#stage').focus()`);
    await a.io.key('Escape'); await sleep(300);
    await clean();
    assert.ok(await a.q(`!!napkin.state.selection`), 'one Esc cancels the edit and keeps the selection');
    await stage();
    await a.q(`napkin.select(null)`); await sleep(300);
    await clean();
  } finally { await a.close(); }
});

test('4. the rule row of a value made of a variable is clickable; the variable has its own line', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    const r = await a.q(`JSON.stringify((() => { const row = document.querySelector('.vrow[data-prop="padding"]'), b = row.querySelector('[data-lit-sel]').getBoundingClientRect(), v = row.querySelector('[data-lit-var]').getBoundingClientRect(); return { rule: b, v, top: document.elementFromPoint(b.left + 3, b.top + b.height / 2).closest('[data-lit-sel],[data-lit-var]')?.dataset.litSel }; })())`);
    const { rule, v, top } = JSON.parse(r);
    assert.ok(top, 'the rule is what is under the pointer');
    assert.ok(v.top >= rule.bottom - 1, 'the variable is on its own line');
    await a.io.move(rule.left + 3, rule.top + rule.height / 2); await sleep(250);
    assert.ok(await a.q(`document.querySelectorAll('.hl-box').length > 0 && document.querySelector('#hl-side').hidden`), 'hover gives the quiet outline');
  } finally { await a.close(); }
});

test('7. in play Esc from inside a frame leaves play, P in a field types; Replay exists', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    await a.q(`napkin.play.set(true)`); await sleep(150);
    assert.ok(await a.q(`!!document.querySelector('#play-replay')`));
    const f = `napkin.stage.sections.get(${JSON.stringify(PILL)}).docFrame`;
    await a.q(`(() => { const d = ${f}.doc(); const i = d.createElement('input'); i.id = 'zz'; d.body.append(i); ${f}.iframe().contentWindow.focus(); i.focus(); })()`);
    await a.q(`${f}.doc().querySelector('#zz').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true }))`);
    assert.ok(await a.q(`napkin.play.active()`), 'P in a text field stays in play');
    await a.q(`${f}.doc().querySelector('#zz').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await a.q(`napkin.play.active()`), false);
  } finally { await a.close(); }
});

test('8. class scope defaults to the rule that paints the selected element', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag'); // the RULE tag: .ss-note--rule .ss-note__tag wins background
    await a.select(NOTE, tag.node);
    await a.typeIn('#pv-background', 'green');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .opt.on')`);
    assert.match(await a.q(`document.querySelector('#doc-staged [data-scope=class]').innerText`), /\.ss-note--rule \.ss-note__tag/);
    await a.io.key('Enter');
    await sleep(500);
    assert.match(css(a), /\.ss-note--rule \.ss-note__tag \{ background: green/);
  } finally { await a.close(); }
});

test('9 and 10. the change counts every line; a variable says the highlight\'s number', { timeout: 60000 }, async () => {
  const a = await open({ files: { ...FILES, 'components.css': `${FILES['components.css']}${Array.from({ length: 9 }, (_, i) => `.x${i} { letter-spacing: .14em; }`).join('\n')}\n` } });
  try {
    await a.q(`napkin.stage.highlight({ selector: '.ss-note__tag', file: 'components.css' })`);
    await a.browser.waitFor(`!!document.querySelector('.hl-decl input[data-prop="letter-spacing"]')`);
    await a.typeIn('.hl-decl input[data-prop="letter-spacing"]', '.2em');
    await a.io.key('Enter');
    await a.browser.waitFor(`!!document.querySelector('#hl-same-all')`, 8000);
    await a.q(`document.querySelector('#hl-same-all').click()`);
    await a.browser.waitFor(`/^10 lines/.test(document.querySelector('#hl-side .hl-change header span').textContent)`, 8000);
    assert.match(await a.q(`document.querySelector('#hl-side .hl-change').textContent`), /4 more changed lines/);
    assert.equal(css(a).match(/letter-spacing: \.2em/g).length, 10);
    assert.doesNotMatch(await a.q(`document.querySelector('#hl-side .hl-change').textContent`), /already applies/);
    await a.q(`napkin.stage.clearHighlight()`);
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    await a.typeIn('#pv-padding', 'var(--space-1) 15px'); await sleep(200); await a.q(`napkin.inspector.scope('variable')`);
    await a.browser.waitFor(`napkin.highlight.active()?.variable && new RegExp(napkin.highlight.places() + ' uses').test(document.querySelector('#doc-staged [data-scope=variable]').innerText)`, 8000);
  } finally { await a.close(); }
});

test('11. a variable with a theme definition shows both and writes either or both; the picker previews and Esc closes only it', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    await a.typeIn('#pv-background', 'var(--ink)'); await sleep(200); await a.q(`napkin.inspector.cancel()`);
    const body = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__body');
    await a.select(NOTE, body.node);
    // the picker
    const pick = a.q(`document.querySelector('.ivchip[data-var="--cobalt"]').click()`); await pick;
    await a.browser.waitFor(`!!document.querySelector('dialog.ivask[open]')`);
    await a.browser.waitFor(`[...napkin.stage.sections.values()].some((s) => s.docFrame?.doc()?.querySelector('style[data-napkin-preview]'))`, 8000);
    await a.io.key('Escape'); await sleep(300);
    assert.equal(await a.q(`!!document.querySelector('dialog.ivask')`), false);
    assert.ok(await a.q(`!!napkin.state.selection`), 'the selection behind it stays');
    assert.equal(await a.q(`[...napkin.stage.sections.values()].some((s) => s.docFrame?.doc()?.querySelector('style[data-napkin-preview]'))`), false);
    // both definitions of --paper: edit the variable through a value of body? --ink on the tag's color
    await a.select(NOTE, tag.node);
    await a.typeIn('#pv-color', 'var(--paper)'); await sleep(100); await a.q(`napkin.inspector.cancel()`);
  } finally { await a.close(); }
});

test('12. layers: nothing blank over the tree, the selected row in view, other files closed, runs named', { timeout: 60000 }, async () => {
  const a = await open({ files: { ...FILES, 'Grid/preview.html': `<!doctype html><html><body><div class="grid">${'<i></i>'.repeat(16)}</div><svg><path d="M0 0"/><path d="M1 1"/></svg></body></html>` } });
  try {
    assert.equal(await a.q(`getComputedStyle(document.querySelector('#log')).display === 'none' || !document.querySelector('#changes').open`), true);
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node); await sleep(150);
    const g = 'Grid/preview.html';
    await a.q(`napkin.select({ component: ${JSON.stringify(g)}, node: napkin.stage.rootNode(${JSON.stringify(g)}), variant: {} })`); await sleep(200);
    assert.equal(await a.q(`[...document.querySelectorAll('#layers .lnode')].some((r) => r.dataset.component === ${q2})`), false, 'the other file closed');
    await a.q(`document.querySelector('#layers .lnode[aria-expanded="false"] .twirl, #layers .lnode.primary .twirl').click()`); await sleep(150);
    const names = await a.q(`[...document.querySelectorAll('#layers .lnode .lname')].map((n) => n.textContent)`);
    assert.ok(names.includes('i ×16'), names.join());
    assert.ok(await a.q(`(() => { const r = document.querySelector('#layers .primary').getBoundingClientRect(), l = document.querySelector('#layers').getBoundingClientRect(); return document.elementFromPoint(r.left + 40, r.top + 5)?.closest('.lrow') === document.querySelector('#layers .primary') && r.bottom <= l.bottom; })()`));
  } finally { await a.close(); }
});

test('14. a gap is a gap and handed-out space is space; Alt+Shift measures the parent', { timeout: 60000 }, async () => {
  const a = await open({ files: { ...FILES, 'Sp/preview.html': `<!doctype html><html><head><style>.r{display:flex;justify-content:space-between;gap:4px 16px}</style></head><body><div class="r"><b>a</b><b>b</b></div></body></html>` } });
  try {
    const sp = 'Sp/preview.html', row = await a.node(sp, (n) => n.attrs.class === 'r');
    await a.q(`napkin.view.fitAll({ animate: false })`); await sleep(300);
    const p = await a.pagePoint(sp, row.node);
    await a.io.down('Alt'); await a.io.move(p.x, p.y, { alt: true });
    await a.browser.waitFor(`!!document.querySelector('#inspect-overlay > .im-read')`);
    const read = await a.q(`document.querySelector('#inspect-overlay > .im-read').innerText`);
    assert.match(read, /gap 4 16/); assert.match(read, /space \d/);
    await a.io.up('Alt');
  } finally { await a.close(); }
});
void writeFileSync;
