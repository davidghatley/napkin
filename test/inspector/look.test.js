// The inspector at 1440x900 and 1280x720, light and dark: axe finds nothing serious or critical, and the staging,
// previewing and applying of an edit moves nothing that a person was not already moving (no layout shift).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, sleep } from './helpers.js';
import { ROOT } from '../helpers/harness.js';

const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const NOTE = 'Note/preview.html';
const shot = async (a, name) => { if (!process.env.EVIDENCE_OUT) return; mkdirSync(process.env.EVIDENCE_OUT, { recursive: true }); writeFileSync(join(process.env.EVIDENCE_OUT, `inspector-${name}.png`), await a.browser.screenshot()); };

for (const [width, height] of [[1440, 900], [1280, 720]]) for (const theme of ['light', 'dark']) {
  test(`inspector look: axe and layout shift, ${width}x${height} ${theme}`, { timeout: 120000 }, async () => {
    const a = await open({ width, height, theme });
    try {
      await a.q(`${AXE}; window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false })`);
      const tag = await a.node(NOTE, (n) => n.tag === 'span' && n.attrs.class === 'ss-note__tag');
      await a.select(NOTE, tag.node);
      await a.typeIn('#pv-padding', 'var(--space-1) 16');
      await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
      await a.browser.waitFor(`/3 uses/.test(document.querySelector('#doc-staged [data-scope=class]').innerText)`);
      await sleep(400);
      await shot(a, `m2-${theme}-${width}`);
      await a.io.key('c', { alt: true, code: 'KeyC' }); await sleep(150);
      await a.io.key('v', { alt: true, code: 'KeyV' }); await sleep(150);
      const bad = JSON.parse(await a.q(`axe.run(document, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))))`));
      assert.deepEqual(bad, [], 'axe: nothing serious or critical');
      await a.io.key('Enter');
      await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000);
      await sleep(800);
      await a.q(`document.querySelector('#doc-vars').scrollIntoView()`); await sleep(200);
      await shot(a, `m6-${theme}-${width}`);
      await a.q(`document.querySelector('#chk-contrast').click(); document.querySelector('#chk-order').click()`); await sleep(400);
      await shot(a, `m8-${theme}-${width}`);
      const bad2 = JSON.parse(await a.q(`axe.run(document, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))))`));
      assert.deepEqual(bad2, [], 'axe with the overlays on');
      assert.ok((await a.q(`window.__cls`)) < 0.0001, `layout shift ${await a.q('window.__cls')}`);
    } finally { await a.close(); }
  });
}
