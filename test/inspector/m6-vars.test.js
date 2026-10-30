// Moment 6, variables as instruments: the folder's own custom properties as swatch, scale and type strips; click one
// (or reach it by keyboard) or drag it onto an element to bind it; off-scale values are flagged with the nearest variable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, readAll, lineDiff } from './helpers.js';

const NOTE = 'Note/preview.html';
const diffOf = (a, before) => { const now = readAll(a.dir); const out = {}; for (const f of Object.keys(now)) if (now[f] !== before[f]) out[f] = lineDiff(before[f], now[f]); return out; };
const applied = (a) => a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000);

test('M6: the strips show the folder’s variables; an off-scale value is flagged and one click binds the nearest', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    const body = await a.node(NOTE, (n) => n.tag === 'div' && n.attrs.class === 'ss-note__body');
    await a.select(NOTE, body.node);
    const chips = JSON.parse(await a.q(`JSON.stringify([...document.querySelectorAll('#doc-vars .ivchip')].map((c) => ({ v: c.dataset.var, g: c.dataset.group, value: c.dataset.value, label: c.getAttribute('aria-label') })))`));
    assert.deepEqual(chips.filter((c) => c.g === 'color').map((c) => c.v).sort(), ['--cobalt', '--ink', '--on-vermilion', '--paper', '--vermilion']);
    assert.deepEqual(chips.filter((c) => c.g === 'space').map((c) => c.v), ['--space-1', '--space-2', '--space-3', '--space-4']);
    assert.deepEqual(chips.filter((c) => c.g === 'type').map((c) => c.v).sort(), ['--font-mono', '--type-body']);
    assert.equal(chips.find((c) => c.v === '--vermilion').value, '#ee5228');
    assert.equal(await a.q(`getComputedStyle(document.querySelector('.ivchip[data-var="--vermilion"] .sw')).backgroundColor`), 'rgb(238, 82, 40)');
    // typing narrows them
    await a.typeIn('#doc-vars-filter', 'space-');
    assert.equal(await a.q(`document.querySelectorAll('#doc-vars .ivchip').length`), 4);

    // padding: 11px is not on the scale; the flag is quiet and offers --space-3 (12px)
    const flag = await a.q(`document.querySelector('.prow[data-prop="padding"] .pflag')?.innerText.replace(/\\s+/g, ' ')`);
    assert.match(flag, /off your scale, nearest --space-3 12px/);
    assert.equal(await a.q(`document.querySelectorAll('.prow.off').length`), 1, 'only the off-scale value is flagged (font-size 16px has no size variable)');
    const before = readAll(a.dir);
    await a.q(`document.querySelector('.prow[data-prop="padding"] .pbind').click()`);
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'class');
    await a.io.key('Enter');
    await applied(a);
    assert.deepEqual(diffOf(a, before), { 'components.css': [['.ss-note__body { padding: 11px; font-size: 16px; line-height: 24px; }', '.ss-note__body { padding: var(--space-3); font-size: 16px; line-height: 24px; }']] });
    await a.browser.waitFor(`document.querySelectorAll('.prow.off').length === 0`, 8000);
  } finally { await a.close(); }
});

test('M6: by keyboard, a variable chip binds the value you were on and Enter applies', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.tag === 'span' && n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    const before = readAll(a.dir);
    await a.q(`document.querySelector('#pv-padding').focus()`);
    // Tab order: the chips are buttons; focus one and press Enter
    await a.q(`document.querySelector('.ivchip[data-var="--space-2"]').focus()`);
    await a.io.key('Enter');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    assert.equal(await a.q(`document.querySelector('#pv-padding').value`), 'var(--space-1) var(--space-2)', 'the variable replaced the last piece of the shorthand');
    assert.equal(await a.q(`document.activeElement.dataset.scope`), 'class', 'focus moves to the scope, so E C V and Enter work');
    await a.io.key('Enter');
    await applied(a);
    assert.deepEqual(diffOf(a, before), { 'components.css': [[(before['components.css'].split('\n')[2]), before['components.css'].split('\n')[2].replace('var(--space-1) var(--space-3)', 'var(--space-1) var(--space-2)')]] });
  } finally { await a.close(); }
});

test('M6: drag a variable onto an element; a list asks which property; the edit writes var(--x) in the scope you pick', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    const second = await a.node(NOTE, (n) => n.tag === 'div' && n.attrs.class === 'ss-note__body' && /decision/.test(n.text || ''));
    const tag = await a.node(NOTE, (n) => n.tag === 'span' && n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    const before = readAll(a.dir);
    await a.q(`document.querySelector('#doc-vars').scrollIntoView()`); // the strips are in view, as for a person dragging
    const from = await a.center('.ivchip[data-var="--cobalt"]');
    const to = await a.pagePoint(NOTE, second.node);
    await a.io.drag(from.x, from.y, to.x, to.y);
    await a.browser.waitFor(`!!document.querySelector('dialog.ivask[open]')`);
    assert.match(await a.q(`document.querySelector('dialog.ivask h2').innerText`), /Use --cobalt on/);
    assert.deepEqual(await a.q(`[...document.querySelectorAll('dialog.ivask button')].slice(0, 3).map((b) => b.value)`), ['color', 'background-color', 'border-color']);
    await a.q(`document.querySelector('dialog.ivask button[value="background-color"]').click()`);
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope') && document.querySelector('#sel-node').textContent.includes('ss-note__body')`);
    assert.equal(await a.q(`document.querySelector('#pv-background-color, .prow[data-prop="background-color"] input')?.value ?? napkin.inspector.state().prop`), 'background-color');
    assert.deepEqual(readAll(a.dir), before, 'nothing is written until Apply');
    await a.q(`napkin.inspector.scope('element')`);
    assert.match(await a.q(`document.querySelector('#doc-diff').innerText.replace(/\\s+/g, ' ')`), /\+ style="background-color: var\(--cobalt\)"/);
    await a.io.key('Enter');
    await applied(a);
    const d = diffOf(a, before);
    assert.deepEqual(Object.keys(d), [NOTE]);
    assert.equal(d[NOTE].length, 1);
    assert.match(d[NOTE][0][1], /<div class="ss-note__body" style="background-color: var\(--cobalt\)">A decision only David can make\.<\/div>/);
  } finally { await a.close(); }
});
