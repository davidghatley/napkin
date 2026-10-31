// The smoothing pass: the inspector and the canvas as one thing. A rule row lights the canvas and the inspector turns to the
// rule; the scope is said on the frame; the width field and presets live in the inspector; overlays stay quiet at fit-all;
// keys do not clash. Each is walked in a browser, with the file's bytes checked where a file changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, sleep, lineDiff, FILES } from '../inspector/helpers.js';

const NOTE = 'Note/preview.html', PILL = 'Pill/preview.html';
const THREE = { ...FILES, 'Other/preview.html': FILES['Pill/preview.html'].replace('Pill preview', 'Other') };
const css = (a) => readFileSync(join(a.dir, 'components.css'), 'utf8');

test('a rule row lights every place and the inspector turns to that rule; typing previews, Enter is one line, Revert is byte exact', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    assert.equal(await a.q(`document.querySelector('#hl-side').hidden`), true);
    // a source line in the panel is the way in; it is a button
    await a.q(`document.querySelector('#doc-values .pfrom [data-lit-sel=".ss-note__tag"]').click()`);
    await a.browser.waitFor(`!document.querySelector('#hl-side').hidden && !!document.querySelector('#hl-side .hl-decl input')`);
    assert.equal(await a.q(`getComputedStyle(document.querySelector('#panel')).display`), 'none', 'the rule takes the panel');
    assert.equal(await a.q(`document.querySelector('#inspector').contains(document.querySelector('#hl-side'))`), true, 'Lights up lives in the inspector, not over the canvas');
    assert.equal(await a.q(`document.querySelectorAll('#hl-side .hl-row').length`), 3);
    assert.deepEqual(await a.q(`[...document.querySelectorAll('#hl-side .hl-n')].map((n) => n.textContent)`), ['1', '2', '3'], 'each place has its own number');
    assert.equal(await a.q(`document.querySelectorAll('.hl-box b').length`), 3);
    assert.equal(await a.q(`document.querySelector('#statusbar .hints').dataset.legend`), 'highlight');
    // type: every frame shows it, the file does not have it
    const before = css(a);
    await a.typeIn('.hl-decl input[data-prop="letter-spacing"]', '.3em');
    await a.browser.waitFor(`[...napkin.stage.sections.values()].some((s) => s.docFrame?.doc()?.querySelector('style[data-napkin-preview]')?.textContent.includes('letter-spacing: .3em'))`, 8000);
    assert.equal(css(a), before, 'typing writes nothing');
    await a.io.key('Enter');
    await a.browser.waitFor(`!!document.querySelector('#hl-side .hl-change .add')`, 8000);
    const diff = lineDiff(before, css(a));
    assert.equal(diff.length, 1, 'one line');
    assert.match(diff[0][1], /letter-spacing: \.3em/);
    assert.match(await a.q(`document.querySelector('#hl-foot').textContent`), /Keep.*Revert/s);
    await a.q(`document.querySelector('#hl-revert').click()`);
    await a.browser.waitFor(`!document.querySelector('#hl-side .hl-change')`, 8000);
    assert.equal(css(a), before, 'Revert puts the bytes back');
    // Escape: back to the element, in the panel
    await a.q(`document.activeElement?.blur?.(); document.querySelector('#stage').focus()`);
    await a.io.key('Escape');
    await a.browser.waitFor(`document.querySelector('#hl-side').hidden && getComputedStyle(document.querySelector('#panel')).display !== 'none'`);
  } finally { await a.close(); }
});

test('hovering a rule row or a variable only outlines; it never moves the view or takes the inspector', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    const v0 = await a.q(`JSON.stringify(napkin.view.get())`);
    await a.q(`napkin.stage.lightQuiet({ variable: '--ink' })`);
    await sleep(500);
    assert.ok(await a.q(`document.querySelectorAll('.hl-box').length > 0`));
    assert.equal(await a.q(`document.querySelector('#hl-side').hidden && document.querySelector('#hl-bar').hidden`), true);
    assert.equal(await a.q(`JSON.stringify(napkin.view.get())`), v0);
    await a.q(`napkin.stage.lightQuiet(null)`);
    assert.equal(await a.q(`document.querySelectorAll('.hl-box').length`), 0);
    // a chosen rule is not replaced by something under the pointer
    await a.q(`napkin.stage.highlight({ selector: '.ss-pill' })`);
    await a.q(`napkin.stage.lightQuiet({ variable: '--ink' }); napkin.stage.lightQuiet(null)`);
    assert.match(await a.q(`napkin.highlight.active().selector`), /ss-pill/);
  } finally { await a.close(); }
});

test('staging a value at fit-all brings the frame up to a legible size and says the scope on the canvas: "class scope · 1 of 3"', { timeout: 90000 }, async () => {
  const a = await open({ files: THREE });
  try {
    await a.q(`napkin.view.set({ x: 0, y: 0, z: 0.2 }, { animate: false })`); await sleep(200);
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    assert.equal(await a.q(`document.querySelector('#overlay-select').dataset.label`), 'span.ss-note__tag', 'an element is named as a designer names it, never by its path');
    await a.typeIn('#pv-padding', '4px 20px');
    await a.browser.waitFor(`/1 of 3/.test(document.querySelector('#overlay-select').dataset.label)`, 8000);
    assert.match(await a.q(`document.querySelector('#overlay-select').dataset.label`), /^span\.ss-note__tag class scope · 1 of 3$/);
    assert.match(await a.q(`[...document.querySelectorAll('.cmp-note')].find((n) => !n.hidden).textContent`), /editing · 3 places preview the change/);
    await a.browser.waitFor(`napkin.view.get().z >= 0.5`, 4000);
    assert.equal(await a.q(`document.querySelector('#statusbar .hints').dataset.legend`), 'staged');
    await a.io.key('Escape');
    await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`);
    assert.equal(await a.q(`[...document.querySelectorAll('.cmp-note')].every((n) => n.hidden)`), true);
    assert.equal(await a.q(`document.querySelector('#overlay-select').dataset.label`), 'span.ss-note__tag');
  } finally { await a.close(); }
});

test('the width field and presets are in the inspector; Enter sets it, the ruler and caption show only on the selected frame', { timeout: 90000 }, async () => {
  const a = await open({ files: { ...FILES, 'components.css': `${FILES['components.css']}@media (max-width: 480px) { .ss-note { margin: 0 } }\n`, 'Pill/preview.html': FILES['Pill/preview.html'].replace('</head>', '<style>@media (min-width: 900px) { .ss-row { gap: 1px } }</style></head>') } });
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    const shown = (sel) => a.q(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => getComputedStyle(e).visibility === 'visible' && e.getBoundingClientRect().width > 0).length`);
    assert.equal(await shown('.cell-ruler'), 1, 'one ruler');
    assert.ok(await shown('.doc-cell figcaption') <= 1, 'one caption');
    await a.q(`document.querySelector('#doc-frame-width').click()`);
    await a.browser.waitFor(`!document.querySelector('#bp-panel').hidden && !!document.querySelector('#frame-width')`);
    assert.equal(await a.q(`document.querySelector('#inspector').contains(document.querySelector('#bp-panel'))`), true);
    assert.equal(await a.q(`document.querySelector('#stage').contains(document.querySelector('#bp-strip'))`), true);
    const w = `napkin.stage.sections.get(${JSON.stringify(NOTE)}).docFrame.width`;
    await a.q(`(() => { const i = document.querySelector('#frame-width'); i.focus(); i.select(); })()`);
    await a.browser.send('Input.insertText', { text: '512' });
    await a.io.key('Enter');
    await a.browser.waitFor(`${w} === 512`);
    await a.q(`document.querySelector('#bp-panel .bp-presets button[data-px="375"]').click()`);
    await a.browser.waitFor(`${w} === 375`);
    await a.q(`document.querySelector('#stage').focus()`);
    await a.io.key('Escape');
    await a.browser.waitFor(`document.querySelector('#bp-panel').hidden`);
    assert.notEqual(await a.q(`getComputedStyle(document.querySelector('#panel')).display`), 'none');
  } finally { await a.close(); }
});

test('at fit-all contrast labels only what fails; the count stays whole; close in, every line is labelled', { timeout: 90000 }, async () => {
  const a = await open({ files: THREE });
  try {
    await a.q(`napkin.view.set({ x: 0, y: 0, z: 0.25 }, { animate: false })`); await sleep(300);
    await a.q(`napkin.inspector.toggle('contrast', true)`);
    await a.browser.waitFor(`document.querySelectorAll('#inspect-overlay .im-badge').length > 0`);
    const far = await a.q(`document.querySelectorAll('#inspect-overlay .im-badge').length`);
    const bad = await a.q(`document.querySelectorAll('#inspect-overlay .im-badge.bad').length`);
    assert.equal(far, bad, `only failures far out: ${far} labels, ${bad} failing`);
    const total = await a.q(`napkin.inspector.read().contrast.total`);
    assert.ok(total > far);
    await a.q(`napkin.view.set({ x: 0, y: 0, z: 1 }, { animate: false })`); await sleep(400);
    await a.q(`napkin.inspector.toggle('contrast', false); napkin.inspector.toggle('contrast', true)`);
    assert.ok(await a.q(`document.querySelectorAll('#inspect-overlay .im-badge').length`) > far, 'close in, the rest show');
  } finally { await a.close(); }
});

test('keys: B is before/after in the film strip, the breakpoints elsewhere, and the scope toggle while a value is staged', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    const tag = await a.node(NOTE, (n) => n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    await a.q(`document.querySelector('#stage').focus()`);
    await a.io.key('b', { code: 'KeyB' });
    await a.browser.waitFor(`!document.querySelector('#bp-panel').hidden`);
    await a.io.key('b', { code: 'KeyB' });
    await a.browser.waitFor(`document.querySelector('#bp-panel').hidden`);
    // the strip: opening it closes the other band, and B there never opens the breakpoints
    await a.q(`napkin.breakpoints.open()`);
    await a.q(`document.querySelector('#stage').focus()`);
    await a.io.key('h', { code: 'KeyH' });
    await a.browser.waitFor(`!document.querySelector('#time').hidden && document.activeElement.id === 'time-track'`);
    assert.equal(await a.q(`document.querySelector('#bp-panel').hidden`), true, 'one band at a time');
    await a.io.key('b', { code: 'KeyB' });
    await sleep(150);
    assert.equal(await a.q(`document.querySelector('#bp-panel').hidden`), true, 'B in the strip is not the breakpoints panel');
    await a.io.key('Escape');
    await a.browser.waitFor(`document.querySelector('#time').hidden`);
    // staged: B belongs to the value being edited
    await a.typeIn('#pv-padding', 'var(--space-1) 16');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .opt.on')`);
    await a.q(`document.querySelector('#doc-staged .opt.on').focus()`);
    const raw = await a.q(`napkin.inspector.state().raw`);
    await a.io.key('b', { code: 'KeyB' });
    await sleep(150);
    assert.equal(await a.q(`napkin.inspector.state().raw`), !raw, 'B toggled the variable');
    assert.equal(await a.q(`document.querySelector('#bp-panel').hidden`), true);
  } finally { await a.close(); }
});

test('Styles tab: rules and variables with their reach; a row lights it up; the tab keys move', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    await a.q(`document.querySelector('#tab-styles').click()`);
    await a.browser.waitFor(`document.querySelectorAll('#styles-list .st-row').length > 5`);
    assert.equal(await a.q(`document.querySelector('#layers').hidden`), true);
    await a.browser.waitFor(`[...document.querySelectorAll('#styles-list .st-row')].find((r) => r.dataset.raw === '.ss-note__tag')?.querySelector('.st-n').textContent === '3'`, 8000);
    await a.q(`[...document.querySelectorAll('#styles-list .st-row')].find((r) => r.dataset.raw === '.ss-note__tag').click()`);
    await a.browser.waitFor(`!document.querySelector('#hl-side').hidden`);
    assert.equal(await a.q(`napkin.highlight.places()`), 3);
    assert.equal(await a.q(`document.querySelector('#styles-list .st-row.on').dataset.raw`), '.ss-note__tag');
    await a.q(`document.querySelector('#tab-styles').focus()`);
    await a.io.key('ArrowLeft');
    assert.equal(await a.q(`document.querySelector('#layers').hidden`), false);
    void PILL;
  } finally { await a.close(); }
});
