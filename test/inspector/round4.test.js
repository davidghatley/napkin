// Round 4: correctness. The variable-scope preview equals Apply (a variable redefined in a nested rule); sheets reached
// through @import are previewed; a value the browser would not take is not written; a no-op says so; an edit inside
// @media says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, readAll, lineDiff, sleep } from './helpers.js';

const snapshot = (a, comp, node) => a.q(`JSON.stringify((() => { const el = napkin.stage.sections.get(${JSON.stringify(comp)}).docFrame.element(${JSON.stringify(node)}).el; const cs = getComputedStyle(el), out = {}; for (const p of cs) out[p] = cs.getPropertyValue(p); const r = el.getBoundingClientRect(); out.__box = [r.width, r.height].join('x'); return out; })())`).then(JSON.parse);
const differ = (x, y) => Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k] && !/^(transition|animation)/.test(k));
const previewing = (a) => a.browser.waitFor(`!!document.querySelector('#doc-staged .scope') && [...napkin.stage.sections.values()].some((s) => s.docFrame.doc()?.querySelector('style[data-napkin-preview]'))`, 8000);
const gone = async (a) => { await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000); await sleep(900); };
const HEAD = '<!doctype html><html><head><meta charset="utf-8">';

async function equalsApply(a, comp, node, prop, typed, key) {
  await a.typeIn(`#pv-${prop}`, typed);
  await previewing(a);
  await a.io.key(key, { alt: true, code: `Key${key.toUpperCase()}` });
  await sleep(700);
  const previewed = await snapshot(a, comp, node);
  await a.io.key('Enter'); await gone(a);
  return { previewed, after: await snapshot(a, comp, node) };
}

test('round 4: a variable redefined in a nested rule: the variable-scope preview equals Apply (linked and applied sheet)', { timeout: 90000 }, async () => {
  const files = {
    'c.css': ':root{--c:red} .dk{--c:blue} .t{color:var(--c)}\n',
    'p.html': `${HEAD}<link rel="stylesheet" href="c.css"></head><body><div class="dk"><span class="t" id="x">Hi</span></div></body></html>\n`,
  };
  const a = await open({ files, apply: ['c.css'] }); // the sheet is both linked by the file and applied by napkin
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    const r = await equalsApply(a, 'p.html', n.node, 'color', 'green', 'v');
    assert.equal(r.previewed.color, 'rgb(0, 128, 0)', 'green during the preview');
    assert.deepEqual(differ(r.previewed, r.after), [], 'and every property equals the result after Apply');
    assert.equal(readAll(a.dir)['c.css'], ':root{--c:red} .dk{--c:green} .t{color:var(--c)}\n');
  } finally { await a.close(); }
});

test('round 4: a rule in an @imported sheet is previewed, and Apply equals it', { timeout: 90000 }, async () => {
  const files = {
    'base.css': '.t { color: red; padding: 4px; }\n',
    'a.css': '@import url("base.css");\n.u { margin: 0; }\n',
    'p.html': `${HEAD}<link rel="stylesheet" href="a.css"></head><body><p class="t" id="x">Hi</p></body></html>\n`,
  };
  const a = await open({ files, apply: [] });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    await a.typeIn('#pv-padding', '20px');
    await previewing(a);
    await a.io.key('c', { alt: true, code: 'KeyC' });
    await sleep(900);
    assert.doesNotMatch(await a.q(`document.querySelector('#doc-staged .scopenote').textContent`), /won’t show|something else|can’t show/);
    const previewed = await snapshot(a, 'p.html', n.node);
    assert.equal(previewed['padding-top'], '20px', 'the imported rule shows the change');
    await a.io.key('Enter'); await gone(a);
    assert.deepEqual(differ(previewed, await snapshot(a, 'p.html', n.node)), []);
    assert.equal(readAll(a.dir)['base.css'], '.t { color: red; padding: 20px; }\n');
  } finally { await a.close(); }
});

test('round 4: a value the browser would not take is not written: element and class scope', { timeout: 90000 }, async () => {
  const files = {
    'c.css': '.t { color: green; }\n',
    'p.html': `${HEAD}<link rel="stylesheet" href="c.css"></head><body><p class="t" id="x">Hi</p></body></html>\n`,
  };
  const a = await open({ files });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    const before = readAll(a.dir);
    await a.typeIn('#pv-color', 'banana');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    for (const key of ['e', 'c']) {
      await a.io.key(key, { alt: true, code: `Key${key.toUpperCase()}` });
      assert.match(await a.q(`document.querySelector('#doc-staged .scopenote').textContent`), /not a value color accepts/);
      assert.equal(await a.q(`document.querySelector('#doc-apply').disabled`), true);
      await a.io.key('Enter'); await sleep(300);
      assert.deepEqual(readAll(a.dir), before, `scope ${key}: nothing written`);
      assert.equal(await a.q(`!!document.querySelector('#doc-staged .scope')`), true, 'still staged');
    }
    // var() values are let through; a good value turns Apply back on
    await a.typeIn('#pv-color', 'var(--nope, red)');
    await a.browser.waitFor(`document.querySelector('#doc-apply').disabled === false`);
    await a.typeIn('#pv-color', 'navy');
    await a.browser.waitFor(`document.querySelector('#doc-apply').disabled === false && !/not a value/.test(document.querySelector('#doc-staged .scopenote').textContent)`);
  } finally { await a.close(); }
});

test('round 4: a value equal to the current one stages nothing and says so; an edit in @media says so', { timeout: 90000 }, async () => {
  const files = {
    'c.css': '.t { color: green; padding: 8px; }\n@media (max-width: 640px) { .t { padding: 6px; } }\n',
    'p.html': `${HEAD}<link rel="stylesheet" href="c.css"></head><body><p class="t" id="x">Hi</p></body></html>\n`,
  };
  const a = await open({ files });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    await a.typeIn('#pv-color', 'green');
    await sleep(300);
    assert.equal(await a.q(`!!document.querySelector('#doc-staged .scope')`), false);
    assert.match(await a.q(`document.querySelector('#hint').textContent`), /No change: color is already green/);
    // the frame is 640 px wide: the padding that wins is the one in the media block
    await a.typeIn('#pv-padding', '10px');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    await a.io.key('c', { alt: true, code: 'KeyC' });
    assert.match(await a.q(`document.querySelector('#doc-staged .scopenote').textContent`), /in @media \(max-width: 640px\)/);
  } finally { await a.close(); }
});
