// Round 3: the preview is the planned edit itself; an edit that cannot show says so; inherited values stage like any
// other; labels never sit on the text they measure; the dock is small.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, readAll, lineDiff, sleep } from './helpers.js';
import { assembleCorpus } from '../../bench/corpus.js';

const real = (() => { try { return join(assembleCorpus().dir, 'ss-ds'); } catch { return null; } })();
const realFiles = () => { const files = {}; (function walk(d, rel) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p, r); else if (/\.(css|html)$/.test(e.name)) files[r] = readFileSync(p, 'utf8'); } })(real, ''); return files; };
// every computed property of an element and its box, from the frame the person is looking at
const snapshot = (a, comp, node) => a.q(`JSON.stringify((() => { const el = napkin.stage.sections.get(${JSON.stringify(comp)}).docFrame.element(${JSON.stringify(node)}).el; const cs = getComputedStyle(el), out = {}; for (const p of cs) out[p] = cs.getPropertyValue(p); const r = el.getBoundingClientRect(); out.__box = [r.width, r.height].join('x'); return out; })())`).then(JSON.parse);
// (the preview holds transitions and animations still so it reads settled numbers: those are the only properties it sets itself)
const differ = (x, y) => Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k] && !/^(transition|animation)/.test(k));
const staged = (a) => a.browser.waitFor(`!!document.querySelector('#doc-staged .scope') && [...napkin.stage.sections.values()].some((s) => s.docFrame.doc()?.querySelector('style[data-napkin-preview]'))`, 8000);
const applied = async (a) => { await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000); await a.browser.waitFor(`document.querySelectorAll('.doc-frame').length > 0`); await sleep(900); };

async function previewEqualsApply(a, comp, node, prop, typed, scopeKey) {
  const before = await snapshot(a, comp, node);
  await a.typeIn(`#pv-${prop}`, typed);
  await staged(a);
  if (scopeKey) await a.io.key(scopeKey, { alt: true, code: `Key${scopeKey.toUpperCase()}` });
  await a.browser.waitFor(`[...napkin.stage.sections.values()].some((s) => s.docFrame.doc()?.querySelector('style[data-napkin-preview]'))`);
  await sleep(500);
  const previewed = await snapshot(a, comp, node);
  await a.io.key('Enter');
  await applied(a);
  const after = await snapshot(a, comp, node);
  return { before, previewed, after, same: differ(previewed, after) };
}

test('round 3: same-rule shorthand then longhand: the preview is what Apply writes (synthetic)', { timeout: 90000 }, async () => {
  const files = {
    'c.css': '.btn { border: 1px solid #000; border-bottom-width: 4px; padding: 4px; }\n',
    'p.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="c.css"></head><body><button class="btn" id="b">Go</button></body></html>\n',
  };
  const a = await open({ files });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'b');
    await a.select('p.html', n.node);
    const r = await previewEqualsApply(a, 'p.html', n.node, 'border', '3px dashed red', 'c');
    assert.notEqual(r.before.__box, r.previewed.__box, 'the preview changed something');
    assert.deepEqual(r.same, [], `computed style after the preview equals after Apply: ${r.same}`);
    assert.equal(r.after['border-bottom-width'], '4px', 'the bottom border still wins in the file, and in the preview');
    assert.equal(r.after['border-top-width'], '3px');
  } finally { await a.close(); }
});

test('round 3: the Tabs rule (border: 0 then border-bottom): preview equals Apply for every computed property', { skip: !real, timeout: 120000 }, async () => {
  const a = await open({ files: realFiles(), dir: real, theme: 'light' });
  try {
    const id = 'components/Tabs/preview.html';
    const n = await a.node(id, (x) => x.attrs.role === 'tab');
    await a.select(id, n.node);
    const r = await previewEqualsApply(a, id, n.node, 'border', '1px solid red', 'c');
    assert.deepEqual(r.same, [], `preview equals Apply: ${r.same}`);
    assert.equal(r.after['border-bottom-width'], '3px', 'the tab keeps its 3px underline');
    assert.equal(r.after.__box.split('x')[1], r.previewed.__box.split('x')[1], 'and its height');
  } finally { await a.close(); }
});

test('round 3: an element-scope colour that !important beats says so, and offers the rule that wins', { timeout: 90000 }, async () => {
  const files = {
    'c.css': '.imp { color: red !important; }\n.t { color: green; }\n',
    'p.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="c.css"></head><body><p class="imp t" id="x">Hi</p></body></html>\n',
  };
  const a = await open({ files });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    await a.typeIn('#pv-color', 'blue');
    await staged(a);
    await a.io.key('e', { alt: true, code: 'KeyE' });
    await a.browser.waitFor(`/won’t show/.test(document.querySelector('#doc-staged .scopenote').textContent)`, 6000);
    const note = await a.q(`document.querySelector('#doc-staged .scopenote').textContent`);
    assert.match(note, /won’t show: \.imp c\.css:1 wins \(!important\)/);
    assert.equal(await a.q(`getComputedStyle(napkin.stage.sections.get('p.html').docFrame.element(${JSON.stringify(n.node)}).el).color`), 'rgb(255, 0, 0)');
    await a.q(`document.querySelector('#doc-fix').click()`);
    await a.browser.waitFor(`napkin.inspector.state().scope === 'class' && !/won’t show/.test(document.querySelector('#doc-staged .scopenote').textContent)`, 6000);
    assert.match(await a.q(`document.querySelector('#doc-staged [data-scope=class]').innerText`), /\.imp/);
    const before = readAll(a.dir);
    await a.io.key('Enter'); await applied(a);
    assert.deepEqual(lineDiff(before['c.css'], readAll(a.dir)['c.css']), [['.imp { color: red !important; }', '.imp { color: blue !important; }']]);
  } finally { await a.close(); }
});

test('round 3: an inherited value stages like any other: this element, the ancestor’s rule, preview, diff, Apply', { timeout: 90000 }, async () => {
  const files = {
    'c.css': '.card.dark { color: #123456; padding: 4px; }\n',
    'p.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="c.css"></head><body><div class="card dark" id="c"><p><span id="s">Hi</span></p></div></body></html>\n',
  };
  const a = await open({ files });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 's');
    await a.select('p.html', n.node);
    await a.typeIn('#pv-color', '#aa0000');
    await staged(a);
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'class', 'it lives in a rule');
    const opts = JSON.parse(await a.q(`JSON.stringify([...document.querySelectorAll('#doc-staged .opt')].map((o) => o.innerText.replace(/\\s+/g, ' ')))`));
    assert.match(opts[1], /Rule \.card\.dark|Class \.card\.dark/);
    assert.equal(await a.q(`getComputedStyle(napkin.stage.sections.get('p.html').docFrame.element(${JSON.stringify(n.node)}).el).color`), 'rgb(170, 0, 0)', 'the preview shows it');
    await a.io.key('e', { alt: true, code: 'KeyE' });
    assert.match(await a.q(`document.querySelector('#doc-diff').innerText.replace(/\\s+/g, ' ')`), /\+ style="color: #aa0000"/);
    await a.io.key('c', { alt: true, code: 'KeyC' });
    const before = readAll(a.dir);
    await a.io.key('Enter'); await applied(a);
    assert.deepEqual(lineDiff(before['c.css'], readAll(a.dir)['c.css']), [['.card.dark { color: #123456; padding: 4px; }', '.card.dark { color: #aa0000; padding: 4px; }']]);
    assert.equal(readAll(a.dir)['p.html'], before['p.html'], 'nothing else changed');
  } finally { await a.close(); }
});

// every label rectangle against every line of text in the frames
const overlap = (a) => a.q(`JSON.stringify((() => {
  const labels = [...document.querySelectorAll('#inspect-overlay .im-label')].map((e) => e.getBoundingClientRect());
  const texts = [];
  for (const sec of napkin.stage.sections.values()) {
    const f = sec.docFrame, ifr = f.iframe(), doc = f.doc(); const fr = ifr.getBoundingClientRect(), z = fr.width / ifr.offsetWidth;
    const range = doc.createRange(), w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (!/\\S/.test(n.nodeValue)) continue; range.selectNodeContents(n); for (const r of range.getClientRects()) if (r.width > .5) texts.push({ left: fr.left + (ifr.clientLeft + r.left) * z, top: fr.top + (ifr.clientTop + r.top) * z, right: fr.left + (ifr.clientLeft + r.right) * z, bottom: fr.top + (ifr.clientTop + r.bottom) * z }); }
  }
  let worst = 0, n = 0;
  for (const l of labels) for (const t of texts) { const w = Math.min(l.right, t.right) - Math.max(l.left, t.left), h = Math.min(l.bottom, t.bottom) - Math.max(l.top, t.top); if (w > 0.5 && h > 0.5) { n++; worst = Math.max(worst, w * h); } }
  return { labels: labels.length, texts: texts.length, overlaps: n, worst };
})())`).then(JSON.parse);

test('round 3: no label sits on text: contrast and focus order on Note and Controls (real ss-ds)', { skip: !real, timeout: 120000 }, async () => {
  const a = await open({ files: realFiles(), dir: real, theme: 'light' });
  try {
    for (const [id, pred] of [['components/Note/preview.html', (x) => x.attrs.class === 'ss-note__tag'], ['components/Controls/preview.html', (x) => /ss-button--primary/.test(x.attrs.class || '')]]) {
      const n = await a.node(id, pred);
      await a.select(id, n.node);
      await a.q(`napkin.view.fitSelection({ animate: false })`); await sleep(400);
      await a.q(`napkin.inspector.toggle('contrast', true); napkin.inspector.toggle('order', true)`);
      await sleep(400);
      const r = await overlap(a);
      assert.ok(r.labels >= 3, `${id}: ${r.labels} labels drawn`);
      assert.equal(r.overlaps, 0, `${id}: ${r.overlaps} labels overlap text (worst ${Math.round(r.worst)} px²) of ${r.labels}`);
      // and with the selection’s and the hovered element’s box model (Alt)
      await a.io.down('Alt'); const p = await a.pagePoint(id, n.node); await a.io.move(p.x, p.y, { alt: true }); await sleep(400);
      const r2 = await overlap(a);
      assert.equal(r2.overlaps, 0, `${id} with Alt: ${r2.overlaps} overlap`);
      await a.io.up('Alt');
      await a.q(`napkin.inspector.toggle('contrast', false); napkin.inspector.toggle('order', false)`);
    }
  } finally { await a.close(); }
});

test('round 3: the dock is at most a quarter of the panel at 1280x720, and the file:line is never cut', { skip: !real, timeout: 120000 }, async () => {
  const a = await open({ files: realFiles(), dir: real, theme: 'light', width: 1280, height: 720 });
  try {
    const id = 'components/Note/preview.html';
    const n = await a.node(id, (x) => x.attrs.class === 'ss-note__tag');
    await a.select(id, n.node);
    const panelH = await a.q(`document.querySelector('#inspector').clientHeight`);
    // the source lines: the location is whole
    const cut = await a.q(`[...document.querySelectorAll('#doc-values .pfrom .loc')].filter((l) => l.scrollWidth > l.clientWidth + 1 || l.getBoundingClientRect().right > l.parentElement.getBoundingClientRect().right + 1).map((l) => l.textContent)`);
    assert.deepEqual(cut, []);
    await a.typeIn('#pv-padding', 'var(--space-1) 16');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    await sleep(600);
    const dock = await a.q(`document.querySelector('#doc-dock').offsetHeight`);
    assert.ok(dock <= panelH * 0.25, `dock ${dock}px of ${panelH}px`);
  } finally { await a.close(); }
});
