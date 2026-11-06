// A view gesture (wheel, Ctrl-wheel zoom) moves the world by transform and defers the rest of the work, but the canvas must still be right while it lasts:
// no blank frames on screen, labels within a bounded size, handles drawn and placed, nothing shifting (PRF-04, regressions found against core).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { generateCorpus } from '../../bench/corpus.js';
import { startServer, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';

test('during a zoom gesture on 80 components: frames in view are drawn, labels stay within 1.4x, handles are drawn in place, and nothing shifts', async (t) => {
  const { dir } = generateCorpus(80);
  const server = await startServer(dir), b = await launchChromium({ width: 1440, height: 900 });
  t.after(async () => { await b.close(); await server.stop(); rmSync(dir, { recursive: true, force: true }); });
  await b.goto(server.url);
  await b.waitFor('napkin.state.components.size === 80 && document.body.dataset.ready === "1" && document.querySelectorAll(".cell .mount > *").length >= 100', 60000);
  await b.eval(`window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; (window.__src ??= []).push(e.sources.map((x) => (x.node?.id ? '#' + x.node.id : x.node?.className || x.node?.nodeName) + ':' + [x.previousRect, x.currentRect].map((r) => [r.x, r.y, r.width, r.height].map(Math.round).join(',')).join('>')).join(' | ') + ' v=' + e.value.toFixed(4)); } }).observe({ type: 'layout-shift', buffered: true }); true`);
  // a selection, with its component in the middle of the stage at 60%
  await b.eval(`(() => { const id = napkin.find('Specimen040').component, c = napkin.state.components.get(id); napkin.select({ component: id, node: c.doc.root.id, variant: {} });
    const r = napkin.stage.componentRect(id), bx = napkin.view.stageBox(), z = 0.6; napkin.view.set({ z, x: bx.width / 2 - (r.x + r.w / 2) * z, y: bx.height / 2 - (r.y + r.h / 2) * z }); return 1 })()`);
  await sleep(900);
  const probe = `(() => { const v = napkin.view.get(), st = document.getElementById('stage').getBoundingClientRect();
    const seen = [...document.querySelectorAll('section.cmp')].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > st.top && r.top < st.bottom && r.right > st.left && r.left < st.right; });
    const need = (max) => Math.round(Math.min(max, Math.max(1, 1 / v.z)) * 20) / 20;
    const ratio = (have, want) => Math.max(have / want, want / have);
    let worstLs = 1, worstLf = 1;
    for (const c of seen) { if (c.dataset.cull) continue;
      worstLs = Math.max(worstLs, ratio(parseFloat(getComputedStyle(c).getPropertyValue('--nk-ls')) || 1, need(3.2)));
      worstLf = Math.max(worstLf, ratio(parseFloat(getComputedStyle(c.querySelector('.cmp-head')).getPropertyValue('--nk-lf')) || 1, need(16))); }
    const sel = document.getElementById('overlay-select'), hdl = document.querySelectorAll('#handles .hdl-resize').length, hv = getComputedStyle(document.getElementById('handles')).visibility;
    const el = napkin.stage.selectedElement(napkin.state.selection), er = el.getBoundingClientRect(), se = document.querySelector('#handles .hdl-resize[data-h="se"]'), sr = se && se.getBoundingClientRect();
    return { z: v.z, blank: seen.filter((c) => c.dataset.cull).length, seen: seen.length, worstLs, worstLf, handles: hdl, handlesVisibility: hv, seOff: sr ? Math.hypot(sr.left + sr.width / 2 - er.right, sr.top + sr.height / 2 - er.bottom) : null,
      boxOff: Math.abs(sel.getBoundingClientRect().left - er.left) + Math.abs(sel.getBoundingClientRect().width - er.width) }; })()`;
  await b.eval('window.__cls = 0; window.__src = []; true'); // shifts from here on are the gesture's own
  const nextFrames = () => b.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const worst = { blank: 0, ls: 1, lf: 1, handlesMissing: 0, handlesHidden: 0, seOff: 0, boxOff: 0 };
  const stepsLog = [];
  // four Ctrl-wheel steps out, then four in, 40 ms apart: one gesture (the view settles 160 ms after the last)
  for (const dir of [120, -120]) for (let i = 0; i < 4; i++) {
    await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 684, y: 460, deltaX: 0, deltaY: dir, modifiers: 2 });
    await nextFrames(); await nextFrames();
    const p = await b.eval(probe); stepsLog.push(p);
    worst.blank = Math.max(worst.blank, p.blank); worst.ls = Math.max(worst.ls, p.worstLs); worst.lf = Math.max(worst.lf, p.worstLf);
    if (p.handles < 8) worst.handlesMissing++; if (p.handlesVisibility === 'hidden') worst.handlesHidden++;
    if (p.seOff !== null) worst.seOff = Math.max(worst.seOff, p.seOff); worst.boxOff = Math.max(worst.boxOff, p.boxOff);
    await sleep(20);
  }
  await sleep(700);
  const cls = await b.eval('window.__cls');
  await t.test('no frame in view is left blank', () => assert.equal(worst.blank, 0, `${worst.blank} frames in view were not drawn`));
  await t.test('every label scale stays within 1.4x of the right one (titles, chips, axis labels)', () => { assert.ok(worst.lf <= 1.45, `title scale ${worst.lf}x off`); assert.ok(worst.ls <= 1.45, `label scale ${worst.ls}x off`); });
  await t.test('the handles stay visible and on the selection corner, the outline on the selection', () => {
    assert.equal(worst.handlesMissing, 0); assert.equal(worst.handlesHidden, 0);
    assert.ok(worst.seOff <= 2, `corner handle ${worst.seOff}px off`); assert.ok(worst.boxOff <= 2, `outline ${worst.boxOff}px off`);
  });
  await t.test('the gesture shifts nothing (CLS)', () => assert.ok(cls < 0.01, `CLS ${cls}`));
});

test('from load: fit all, then zoom steps and a settle shift almost nothing on an 80-component canvas (CLS)', async (t) => {
  const { dir } = generateCorpus(80);
  const server = await startServer(dir), b = await launchChromium({ width: 1440, height: 900 });
  t.after(async () => { await b.close(); await server.stop(); rmSync(dir, { recursive: true, force: true }); });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; (window.__src ??= []).push(e.sources.map((x) => (x.node?.className || x.node?.nodeName) + ':' + [x.previousRect, x.currentRect].map((r) => [r.x, r.y, r.width, r.height].map(Math.round).join(',')).join('>')).join(' | ') + ' v=' + e.value.toFixed(4)); } }).observe({ type: 'layout-shift', buffered: true });` });
  await b.goto(server.url);
  await b.waitFor('napkin.state.components.size === 80 && document.body.dataset.ready === "1" && document.querySelectorAll(".cell .mount > *").length >= 100', 60000);
  await sleep(1200);
  await b.eval('napkin.view.fitAll({ animate: false }); true'); await sleep(900);
  for (const dir of [-120, -120, 120, 120, -120]) { await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 684, y: 460, deltaX: 0, deltaY: dir, modifiers: 2 }); await sleep(30); }
  await sleep(900);
  const cls = await b.eval('window.__cls');
  // (about 0.019 of this is the first fit at load, present in core too; restyling titles and labels with `zoom` added 0.05 more)
  assert.ok(cls < 0.03, `CLS ${cls}`);
});
