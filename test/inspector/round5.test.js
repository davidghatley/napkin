// Round 5: a font shorthand loses to a longhand after it; "no change" by meaning; a running animation; a typed
// !important; the wording of an inline variable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, readAll, sleep } from './helpers.js';

const HEAD = '<!doctype html><html><head><meta charset="utf-8">';
const snapshot = (a, comp, node) => a.q(`JSON.stringify((() => { const el = napkin.stage.sections.get(${JSON.stringify(comp)}).docFrame.element(${JSON.stringify(node)}).el; const cs = getComputedStyle(el), out = {}; for (const p of cs) out[p] = cs.getPropertyValue(p); return out; })())`).then(JSON.parse);
const differ = (x, y) => Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k] && !/^(transition|animation)/.test(k));
const gone = async (a) => { await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000); await sleep(900); };
const page = (css, body) => ({ 'c.css': css, 'p.html': `${HEAD}<link rel="stylesheet" href="c.css"></head><body>${body}</body></html>\n` });

test('round 5: font then font-variant-numeric in one rule: the font row says partly overridden', { timeout: 60000 }, async () => {
  const a = await open({ files: page('.ss-label { font: 500 11px/16px monospace; color: #333; font-variant-numeric: tabular-nums; }\n', '<span class="ss-label" id="x">NO 1</span>') });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    const row = await a.q(`document.querySelector('.vrow[data-prop="font"]').innerText.replace(/\\s+/g, ' ')`);
    assert.match(row, /partly overridden/); assert.match(row, /font-variant-numeric/);
    assert.equal(await a.q(`document.querySelector('.vrow[data-prop="font-variant-numeric"] .pstate')`), null, 'the longhand itself is whole');
  } finally { await a.close(); }
});

test('round 5: the same value said differently is no change (#f00 over red, 0px over 0)', { timeout: 60000 }, async () => {
  const a = await open({ files: page('.t { color: red; padding: 0; margin: 4px; }\n', '<p class="t" id="x">Hi</p>') });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    for (const [prop, typed] of [['color', '#f00'], ['padding', '0px'], ['margin', '4.0px']]) {
      await a.typeIn(`#pv-${prop}`, typed); await sleep(300);
      assert.equal(await a.q(`!!document.querySelector('#doc-staged .scope')`), false, `${prop}: ${typed} stages nothing`);
      assert.match(await a.q(`document.querySelector('#hint').textContent`), new RegExp(`No change: ${prop} is already`));
    }
    await a.typeIn('#pv-color', '#f01');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
  } finally { await a.close(); }
});

test('round 5: a running animation that sets the property is named', { timeout: 60000 }, async () => {
  const a = await open({ files: page('@keyframes pulse { from { color: red } to { color: blue } }\n.t { color: green; animation: pulse 60s linear infinite; }\n', '<p class="t" id="x">Hi</p>') });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    await a.typeIn('#pv-color', 'navy');
    await a.browser.waitFor(`/animation pulse controls color/.test(document.querySelector('#doc-staged .scopenote')?.textContent || '')`, 8000);
    assert.equal(await a.q(`document.querySelector('#doc-apply').disabled`), false, 'Apply stays available');
  } finally { await a.close(); }
});

test('round 5: a typed !important is accepted: validated, written as the flag, preview equals Apply', { timeout: 90000 }, async () => {
  const a = await open({ files: page('.t { color: green; padding: 4px; }\n', '<p class="t" id="x">Hi</p>') });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    // class scope
    await a.typeIn('#pv-color', 'blue !important');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope') && [...napkin.stage.sections.values()].some((s) => s.docFrame.doc()?.querySelector('style[data-napkin-preview]'))`);
    await a.io.key('c', { alt: true, code: 'KeyC' }); await sleep(700);
    assert.equal(await a.q(`document.querySelector('#doc-apply').disabled`), false);
    assert.match(await a.q(`document.querySelector('#doc-diff').innerText.replace(/\\s+/g, ' ')`), /color: blue !important;/);
    const previewed = await snapshot(a, 'p.html', n.node);
    await a.io.key('Enter'); await gone(a);
    assert.equal(readAll(a.dir)['c.css'], '.t { color: blue !important; padding: 4px; }\n');
    assert.deepEqual(differ(previewed, await snapshot(a, 'p.html', n.node)), []);
    // element scope, on a value that an !important rule would otherwise beat
    await a.typeIn('#pv-padding', '9px !important');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    await a.io.key('e', { alt: true, code: 'KeyE' }); await sleep(700);
    await a.io.key('Enter'); await gone(a);
    assert.match(readAll(a.dir)['p.html'], /<p class="t" id="x" style="padding: 9px !important">/);
    // the reason is true for a variable
    await a.typeIn('#pv-color', 'red !important'); await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    assert.match(await a.q(`document.querySelector('#doc-staged [data-scope=variable]').title`), /not a variable yet|!important cannot go on a variable/);
  } finally { await a.close(); }
});

test('round 5: a variable set inline says which element it is set on', { timeout: 60000 }, async () => {
  const a = await open({ files: page('.t { color: var(--c); }\n', '<div style="--c: red"><p class="t" id="x">Hi</p></div><p class="t" id="y" style="--c: blue">Yo</p>') });
  try {
    const x = await a.node('p.html', (n) => n.attrs.id === 'x'), y = await a.node('p.html', (n) => n.attrs.id === 'y');
    await a.select('p.html', x.node);
    assert.match(await a.q(`document.querySelector('.decl[data-ro="--c"]').innerText.replace(/\\s+/g, ' ')`), /set inline on an ancestor/);
    await a.select('p.html', y.node);
    assert.match(await a.q(`document.querySelector('.decl[data-ro="--c"]').innerText.replace(/\\s+/g, ' ')`), /set inline on this element/);
  } finally { await a.close(); }
});
