// Moment 2, edit at the right scope: every value says where it comes from; one key picks the scope of an edit
// (this element, this class, this variable); the change is shown before it is written, and the file diff is the one line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, lineDiff, readAll, sleep } from './helpers.js';

const NOTE = 'Note/preview.html';
const tag = (n) => n.tag === 'span' && n.attrs.class === 'ss-note__tag';
const rowText = (a, prop) => a.q(`document.querySelector('.vrow[data-prop="${prop}"]').innerText`);
const diffOf = (a, before) => { const now = readAll(a.dir); const out = {}; for (const f of Object.keys(now)) if (now[f] !== before[f]) out[f] = lineDiff(before[f], now[f]); return out; };

test('M2: where each value comes from, overridden values read as overridden', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    const n = await a.node(NOTE, tag);
    await a.select(NOTE, n.node);
    const bg = await rowText(a, 'background');
    assert.match(bg, /\.ss-note--rule \.ss-note__tag/, 'the rule that wins');
    assert.match(bg, /components\.css:4/, 'file and line');
    assert.match(bg, /beats[\s\S]*var\(--ink\)[\s\S]*\.ss-note__tag :3/, 'what it beats, and where that came from');
    assert.match(bg, /--vermilion[\s\S]*defined in[\s\S]*:root[\s\S]*tokens\.css:4/, 'the variable and where it is defined');
    const pad = await rowText(a, 'padding');
    assert.match(pad, /components\.css:3/); assert.match(pad, /--space-1[\s\S]*tokens\.css:7/);
    // the struck-through declaration in the rules list is the overridden one
    assert.equal(await a.q(`[...document.querySelectorAll('.rule')].find((r) => r.dataset.selector === '.ss-note__tag').querySelectorAll('.decl.over').length`), 2, 'background and color of .ss-note__tag are beaten here');
    // an element the dark theme changes: the definition that applies is the one for this media
    const dark = await open({ theme: 'dark' });
    try {
      const m = await dark.node(NOTE, tag); await dark.select(NOTE, m.node);
      assert.match(await rowText(dark, 'color'), /--on-vermilion/);
      await dark.select(NOTE, (await dark.node(NOTE, (x) => x.tag === 'body')).node);
      assert.match(await dark.q(`document.querySelector('#panel').innerText`), /--paper[\s\S]*@media \(prefers-color-scheme: dark\)/, 'body background uses the dark definition of --paper');
    } finally { await dark.close(); }
  } finally { await a.close(); }
});

test('M2: type a value, pick the scope with a key, see the one line, apply: class, element, variable', { timeout: 120000 }, async () => {
  const a = await open();
  try {
    const n = await a.node(NOTE, tag);
    const before = readAll(a.dir);
    await a.select(NOTE, n.node);

    // 16 for the sides: on the scale (--space-4), so napkin writes the variable; default scope is the class
    await a.typeIn('#pv-padding', 'var(--space-1) 16');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    const staged = await a.q(`JSON.stringify({ scope: napkin.inspector.state().scope, opts: [...document.querySelectorAll('#doc-staged .opt')].map((o) => ({ id: o.dataset.scope, on: o.classList.contains('on'), text: o.innerText.replace(/\\s+/g, ' ') })), note: document.querySelector('#doc-staged h3 .where')?.innerText, diff: [...document.querySelectorAll('#doc-diff > div')].map((d) => (d.querySelector('i') ? [d.querySelector('i').textContent, d.querySelector('u').textContent, d.title].join(' ') : d.innerText.replace(/\\s+/g, ' '))) })`).then(JSON.parse);
    assert.equal(staged.scope, 'class');
    assert.match(staged.note, /on your scale: 16px → var\(--space-4\)/);
    const [el, cls, vr] = staged.opts;
    assert.match(el.text, /Element/); assert.match(cls.text, /Class \.ss-note__tag/); assert.match(vr.text, /Variable --space-3/);
    assert.match(await a.q(`document.querySelector('#doc-staged [data-scope=class]').title`), /components\.css:3/);
    await a.browser.waitFor(`/3 uses/.test(document.querySelector('#doc-staged [data-scope=class]').innerText)`, 5000);
    assert.match(await a.q(`document.querySelector('#doc-staged [data-scope=class]').innerText.replace(/\\s+/g, ' ')`), /3 uses/);
    assert.match(await a.q(`document.querySelector('#doc-staged .scopenote').textContent`), /components\.css:3 · all three in Note/);
    assert.deepEqual(staged.diff, ['3 − padding: var(--space-1) var(--space-3);', '3 + padding: var(--space-1) var(--space-4);']);
    // before anything is written, the canvas shows the change on all three tags
    assert.equal(await a.q(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(NOTE)}).docFrame.doc(); return [...f.querySelectorAll('.ss-note__tag')].map((t) => getComputedStyle(t).paddingLeft).join() })()`), '16px,16px,16px');
    assert.deepEqual(readAll(a.dir), before, 'nothing is written until Apply');

    // Alt+E while the cursor is in the field: this element
    await a.io.key('e', { alt: true, code: 'KeyE' });
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'element');
    assert.match(await a.q(`document.querySelector('#doc-diff').innerText.replace(/\\s+/g, ' ')`), /\+ style="padding: var\(--space-1\) var\(--space-4\)"/);
    // V: this variable (the whole system)
    await a.io.key('v', { alt: true, code: 'KeyV' });
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'variable');
    assert.deepEqual(await a.q(`[...document.querySelectorAll('#doc-diff > div')].map((d) => d.innerText.replace(/\\s+/g, ' '))`), ['9 − --space-3: 12px;', '9 + --space-3: 16px;']);
    await a.io.key('c', { alt: true, code: 'KeyC' });
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'class');

    // Enter applies: exactly one line of one file changes
    await a.io.key('Enter');
    await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000);
    assert.deepEqual(diffOf(a, before), { 'components.css': [['.ss-note__tag { display: block; padding: var(--space-1) var(--space-3); background: var(--ink); color: var(--paper); font: 600 11px/16px var(--font-mono); letter-spacing: .14em; text-transform: uppercase; }', '.ss-note__tag { display: block; padding: var(--space-1) var(--space-4); background: var(--ink); color: var(--paper); font: 600 11px/16px var(--font-mono); letter-spacing: .14em; text-transform: uppercase; }']] });
    await a.browser.waitFor(`document.querySelector('.vrow[data-prop=padding] input').value === 'var(--space-1) var(--space-4)'`, 8000);

    // this element: an inline style, one line of the HTML
    const b2 = readAll(a.dir);
    await a.typeIn('#pv-color', 'red');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    await a.io.key('e', { alt: true, code: 'KeyE' });
    await a.io.key('Enter');
    await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000);
    const d2 = diffOf(a, b2);
    assert.deepEqual(Object.keys(d2), [NOTE]);
    assert.equal(d2[NOTE].length, 1);
    assert.match(d2[NOTE][0][1], /<span class="ss-note__tag" style="color: red">Rule<\/span>/);

    // this variable: the definition in tokens.css (the class edit made the tag use --space-4)
    await sleep(300);
    const b3 = readAll(a.dir);
    await a.typeIn('#pv-padding', 'var(--space-1) 20');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    await a.io.key('v', { alt: true, code: 'KeyV' });
    await a.io.key('Enter');
    await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000);
    assert.deepEqual(diffOf(a, b3), { 'tokens.css': [['  --space-4: 16px;', '  --space-4: 20px;']] });
  } finally { await a.close(); }
});

test('M2: Escape puts the value back and writes nothing; a disabled scope says why', { timeout: 60000 }, async () => {
  const a = await open();
  try {
    const n = await a.node(NOTE, (x) => x.tag === 'div' && x.attrs.class === 'ss-note__body');
    await a.select(NOTE, n.node);
    const before = readAll(a.dir);
    await a.typeIn('#pv-font-size', '18');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    const v = await a.q(`document.querySelector('#doc-staged [data-scope=variable]').title`);
    assert.match(v, /not a variable yet/);
    await a.io.key('v', { alt: true, code: 'KeyV' });
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'class', 'a disabled scope cannot be chosen');
    assert.match(await a.q(`document.querySelector('#doc-error').textContent`), /not a variable/);
    await a.io.key('Escape');
    assert.equal(await a.q(`!!document.querySelector('#doc-staged .scope')`), false);
    assert.equal(await a.q(`document.querySelector('#pv-font-size').value`), '16px');
    assert.deepEqual(readAll(a.dir), before);
    assert.equal(await a.q(`document.querySelectorAll('style[data-napkin-preview]').length`), 0, 'the preview is gone');
  } finally { await a.close(); }
});

test('M2: a variable shows the definition that applies to this element (selector and inheritance, not the last one written)', { timeout: 60000 }, async () => {
  const files = {
    'tokens.css': ':root { --a: 10px; }\n@media (max-width: 400px) { :root { --a: 1px; } }\n.theme-x { --a: 99px; }\n.card.alt { --a: 30px; }\n.later { --a: 77px; }\n',
    'c.css': '@media (max-width: 400px) { .t { padding: 2px; } }\n.t { padding: var(--a); }\n',
    'p.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="c.css"></head><body>\n<div class="card"><span class="t" id="plain">A</span></div>\n<div class="card alt"><span class="t" id="alt">B</span></div>\n<div class="theme-x"><div><span class="t" id="deep">C</span></div></div>\n</body></html>\n',
  };
  const a = await open({ files });
  try {
    const row = async (id) => { const n = await a.node('p.html', (x) => x.attrs.id === id); await a.select('p.html', n.node); return a.q(`document.querySelector('.decl[data-prop="--a"]').innerText + ' | ' + document.querySelector('.decl[data-prop="--a"] input').value`); };
    assert.match(await row('plain'), /tokens\.css:1.*\| 10px/);
    assert.match(await row('alt'), /tokens\.css:4.*\| 30px/, 'the selector that matches wins over the later .later');
    assert.match(await row('deep'), /tokens\.css:3 ↑.*\| 99px/, 'inherited from the nearest ancestor that sets it');
    // editing the variable edits that definition, nothing else
    const before = readAll(a.dir);
    await a.typeIn('.decl[data-prop="--a"] input', '31px');
    await a.io.key('Tab');
    await a.browser.waitFor(`document.querySelector('.decl[data-prop="--a"] input')?.value === '31px' && document.querySelector('.decl[data-prop="--a"] .src').textContent.startsWith('tokens.css:3')`, 8000);
    assert.deepEqual(diffOf(a, before), { 'tokens.css': [['.theme-x { --a: 99px; }', '.theme-x { --a: 31px; }']] });
    // the same selector in a media block and outside it: the scope edit lands in the one the panel showed
    await a.select('p.html', (await a.node('p.html', (x) => x.attrs.id === 'plain')).node);
    const b0 = readAll(a.dir);
    await a.typeIn('#pv-padding', '5');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    await a.io.key('c', { alt: true, code: 'KeyC' }); await a.io.key('Enter');
    await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000);
    assert.deepEqual(diffOf(a, b0), { 'c.css': [['.t { padding: var(--a); }', '.t { padding: 5px; }']] });
  } finally { await a.close(); }
});
