// FEEL-02 / LAY-01 / LAY-07 panel geometry and hierarchy, at the default 1440x900: nothing truncates, section titles outrank labels,
// editable values are not italic, Min / Max is disclosed, the alignment matrix is big and shows its axis, Text hides on non-text nodes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lab, tsx } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';

const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');
const FLOW = tsx('Flow', { id: 'stage', tag: 'div', style: { display: 'flex', gap: 8, padding: 12, width: 300, height: 120 }, kids: [{ id: 'a', tag: 'div', style: { width: 60, height: 30, background: '#e8b04b' } }] });

test('the panel at default width: no truncated labels, clear hierarchy, quiet inherited values', { timeout: 120000 }, async (t) => {
  const L = await lab({ Card: fx('Card'), Button: fx('Button'), Flow: FLOW }, { theme: 'light' });
  const { q } = L;
  try {
    const probes = [['Card', 'title'], ['Card', 'card'], ['Card', 'image'], ['Button', 'root'], ['Flow', 'stage'], ['Flow', 'a']];
    await t.test('no label, value or heading is cut off, on six different nodes', async () => {
      for (const [c, n] of probes) {
        await L.select(c, n, c === 'Button' ? { size: 'md', state: 'default' } : {});
        await sleep(150);
        const cut = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#panel .lt, #panel summary, #panel .sectitle, #panel .fbox input:not([type=color]), #panel .minibtn, #panel .togbtn, #panel .seg button')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => (e.id || e.className || e.tagName) + ':' + (e.textContent || e.value || '').trim().slice(0, 20)))`));
        assert.deepEqual(cut, [], `${c}.${n}`);
      }
    });
    await t.test('section titles are clearly heavier than field labels, and secondary text keeps its contrast', async () => {
      await L.select('Card', 'card');
      const r = JSON.parse(await q(`JSON.stringify((() => { const h = getComputedStyle(document.querySelector('#panel details.sec > summary')), l = getComputedStyle(document.querySelector('#panel .pfx')), v = getComputedStyle(document.querySelector('#panel .unit')); return { h: Number(h.fontWeight), hs: parseFloat(h.fontSize), l: Number(l.fontWeight), ls: parseFloat(l.fontSize), unit: v.color, label: l.color }; })())`));
      assert.ok(r.h >= 700 && r.l <= 450 && r.hs > r.ls, `title ${r.h}/${r.hs}px vs label ${r.l}/${r.ls}px`);
      const lum = (c) => { const [R, G, B] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
      const bg = lum('rgb(243, 244, 246)'), ratio = (c) => (bg + 0.05) / (lum(c) + 0.05);
      assert.ok(ratio(r.label) >= 4.5, `label contrast ${ratio(r.label).toFixed(1)}`);
      assert.ok(ratio(r.unit) >= 4.5, `unit contrast ${ratio(r.unit).toFixed(1)}`);
    });
    await t.test('an editable value is never italic; an inherited one is only a different grey, with a hint line', async () => {
      await L.select('Card', 'title');
      assert.equal(await q(`[...document.querySelectorAll('#panel input')].some((i) => getComputedStyle(i).fontStyle === 'italic')`), false);
      assert.equal(await q(`document.querySelector('#fontSize').closest('.fbox').classList.contains('inherited') || document.querySelector('#fontSize').closest('.fbox').classList.contains('computed')`), false, 'the title sets its own size');
      assert.equal(await q(`document.querySelector('#letterSpacing').closest('.fbox').classList.contains('inherited')`), true);
      assert.match(await q(`document.querySelector('.typehint').textContent`), /Grey values come from the parent/);
      assert.equal(await q(`document.querySelector('#panel .inh.arrow')`), null, 'no cryptic arrows');
      assert.ok((await q(`Number(document.querySelector('#lineHeight').value)`)) > 10, 'line height shows the resolved number');
    });
    await t.test('Min / Max sits behind a toggle; W and H stay prominent', async () => {
      await L.select('Flow', 'a');
      assert.equal(await q(`!!document.querySelector('#maxWidth')`), false);
      await q(`document.querySelector('#limits-toggle').click()`);
      await L.browser.waitFor(`!!document.querySelector('#maxWidth')`);
      assert.equal(await q(`document.querySelector('#limits-toggle').getAttribute('aria-expanded')`), 'true');
      await L.edit('Flow', [{ op: 'set', path: 'a.maxWidth', value: 90 }]);
      await L.select('Flow', 'stage'); await L.select('Flow', 'a');
      assert.equal(await q(`!!document.querySelector('#maxWidth')`), true, 'open by itself when a limit is set');
      await L.edit('Flow', [{ op: 'set', path: 'a.maxWidth', value: null }]);
      await L.select('Flow', 'a');
      await q(`document.querySelector('#limits-toggle').click()`); // back to the default for the next checks
      await L.browser.waitFor(`!document.querySelector('#maxWidth')`);
    });
    await t.test('the alignment matrix is large, its axis arrow follows the direction, and Auto is explained as space between', async () => {
      await L.select('Flow', 'stage');
      const m = JSON.parse(await q(`JSON.stringify((() => { const b = document.querySelector('#align-00').getBoundingClientRect(); return { w: b.width, h: b.height }; })())`));
      assert.ok(m.w >= 28 && m.h >= 22, `cells ${m.w} x ${m.h}`);
      assert.equal(await q(`document.querySelector('.axisarrow').dataset.dir`), 'row');
      await q(`document.querySelector('#seg-flexDirection-column').click()`);
      await L.browser.waitFor(`document.querySelector('.axisarrow')?.dataset.dir === 'column'`);
      assert.match(await q(`document.querySelector('#align-00').title`), /top to bottom/);
      assert.match(await q(`document.querySelector('#gap-auto').title`), /^Space between/);
    });
    await t.test('common nodes scan in one screen; the richest stay within 1.2 screens; the order follows the node kind', async () => {
      // Migrated: the element panel's own height is judged (#panel); the file's instrument panel now sits under it in the same column.
      const fit = async (c, n, v = {}) => { await L.select(c, n, v); await sleep(120); return JSON.parse(await q(`JSON.stringify({ h: document.querySelector('#panel').getBoundingClientRect().height, c: document.querySelector('#inspector').clientHeight, first: [...document.querySelectorAll('#panel details.sec, #panel .sec.empty')].map((d) => d.dataset.sec).slice(0, 3), open: [...document.querySelectorAll('#panel details.sec[open]')].map((d) => d.dataset.sec) })`)); };
      for (const [c, n] of [['Card', 'title'], ['Card', 'image'], ['Flow', 'stage'], ['Flow', 'a']]) { const r = await fit(c, n); assert.ok(r.h <= r.c, `${c}.${n}: ${r.h} > ${r.c}`); }
      for (const [c, n, v] of [['Card', 'card'], ['Button', 'root', { size: 'md', state: 'default' }]]) { const r = await fit(c, n, v); assert.ok(r.h <= r.c * 1.2, `${c}.${n}: ${r.h} vs ${r.c}`); }
      assert.equal((await fit('Card', 'title')).first[0], 'type', 'text first');
      assert.equal((await fit('Flow', 'stage')).first[0], 'layout', 'a frame starts with its layout');
      assert.equal((await fit('Flow', 'a')).first[0], 'size', 'a plain box starts with its size');
      assert.equal((await fit('Card', 'image')).first[0], 'size');
      const rare = await fit('Card', 'card');
      assert.ok(!rare.open.includes('props') && !rare.open.includes('variants') && !rare.open.includes('type') && !rare.open.includes('advanced'), `rarely used sections start closed: ${rare.open}`);
    });
    await t.test('a section the person opens or closes stays that way, across selections and a reload', async () => {
      await L.select('Flow', 'stage');
      await L.q(`document.querySelector('[data-sec=appearance] > summary').click()`);
      await L.browser.waitFor(`!document.querySelector('[data-sec=appearance]').open`);
      await L.select('Card', 'title'); await L.select('Flow', 'a');
      assert.equal(await q(`document.querySelector('[data-sec=appearance]').open`), false);
      await L.browser.goto(L.server.url);
      await L.browser.waitFor('document.body.dataset.ready === "1"');
      await L.select('Flow', 'a');
      assert.equal(await q(`document.querySelector('[data-sec=appearance]').open`), false, 'remembered after a reload');
      await L.q(`document.querySelector('[data-sec=appearance] > summary').click()`);
    });
    await t.test('the axis arrow sits inside the matrix frame', async () => {
      await L.select('Flow', 'stage');
      const r = JSON.parse(await q(`JSON.stringify((() => { const f = document.querySelector('.amwrap').getBoundingClientRect(), a = document.querySelector('.axisarrow').getBoundingClientRect(), m = document.querySelector('.amatrix').getBoundingClientRect(); return { inA: a.left >= f.left && a.right <= f.right && a.top >= f.top && a.bottom <= f.bottom, inM: m.left >= f.left && m.right <= f.right && m.top >= f.top && m.bottom <= f.bottom, bg: getComputedStyle(document.querySelector('.amwrap')).backgroundColor }; })())`));
      assert.equal(r.inA && r.inM, true);
    });
    await t.test('Text is not offered on a frame with no text, but is on text and on nodes that set type', async () => {
      await L.select('Flow', 'stage');
      assert.equal(await q(`!!document.querySelector('[data-sec=type]')`), false);
      await L.select('Card', 'title');
      assert.equal(await q(`!!document.querySelector('[data-sec=type]')`), true);
      await L.select('Button', 'root', { size: 'md', state: 'default' });
      assert.equal(await q(`!!document.querySelector('[data-sec=type]')`), true);
    });
  } finally { await L.close(); }
});

test('FEEL-02: a very dark swatch keeps a visible outline in dark chrome', { timeout: 60000 }, async () => {
  const D = tsx('Dark', { id: 'root', tag: 'div', style: { width: 80, height: 40, background: '#222222', border: '2px solid rgba(0, 0, 0, 0.1)' } });
  const L = await lab({ Dark: D }, { theme: 'dark' });
  try {
    await L.select('Dark', 'root');
    const r = JSON.parse(await L.q(`JSON.stringify((() => { const s = getComputedStyle(document.querySelector('#panel .swatch')); const bg = getComputedStyle(document.querySelector('#inspector')).backgroundColor; return { shadow: s.boxShadow, bg }; })())`));
    const ring = r.shadow.match(/rgba?\(([^)]*)\)/)[1].split(',').map(Number), bg = r.bg.match(/\d+/g).slice(0, 3).map(Number);
    const a = ring[3] ?? 1, eff = [0, 1, 2].map((i) => ring[i] * a + bg[i] * (1 - a));
    const lum = (c) => { const [R, G, B] = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
    const ratio = (x, y) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05);
    assert.ok(ratio(eff, bg) >= 3, `outline against the panel ${ratio(eff, bg).toFixed(2)}:1 (${r.shadow})`);
    assert.ok(ratio(eff, [34, 34, 34]) >= 3, 'and against a #222 fill');
  } finally { await L.close(); }
});
