// Re-run: node bench/tokens.js. CPU Chromium; actual corpus, computed values in EVERY cell, then paint.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { corpus } from './corpus.js';
import { startServer, ROOT } from '../test/helpers/harness.js';
import { launchChromium } from '../test/helpers/cdp.js';
import { changedLines } from '../test/helpers/lab.js';
const fit = !process.argv.includes('--viewport');
const dir = mkdtempSync(join(tmpdir(), 'napkin-tokens-bench-'));
const components = corpus(dir, 200, { tokens: true });
const server = await startServer(components, { timeout: 120000 }), b = await launchChromium({ width: 1440, height: 900 });
const pct = (xs, p) => [...xs].sort((a,b) => a-b)[Math.min(xs.length - 1, Math.floor(xs.length * p))].toFixed(2);
try {
  await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"', 120000);
  await b.eval(`(async () => { for (const id of napkin.state.components.keys()) await napkin.stage.render(id, true); ${fit ? 'napkin.view.fitAll({max:0.2})' : 'napkin.view.set({x:80,y:120,z:1})'}; napkin.stage.cull(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));  })()`);
  const n = await b.eval('document.querySelectorAll(".cell .mount [data-n=root]").length'); assert.equal(n, 1200);
  const visible = await b.eval(`document.querySelectorAll('section.cmp:not([data-cull])').length`);
  const componentBefore = readFileSync(join(components, 'Button000.tsx'), 'utf8');
  const theme = [], edits = [];
  // A next rAF callback runs before paint; the second callback proves that the first frame has painted.
  for (let i = 0; i < 10; i++) {
    const m = i % 2 ? 'light' : 'dark', rgb = m === 'dark' ? 'rgb(140, 170, 255)' : 'rgb(54, 93, 204)';
    const ms = await b.eval(`(async () => { const t0 = performance.now(); napkin.tokens.setMode('${m}'); const nodes = [...document.querySelectorAll('.cell .mount [data-n=root]')]; if (!nodes.every(n => getComputedStyle(n).backgroundColor === '${rgb}')) throw Error('theme did not reach all cells'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now()-t0; })()`);
    theme.push(ms);
  }
  await b.eval("napkin.tokens.setMode('light')");
  for (let i = 0; i < 10; i++) {
    const value = i % 2 ? '#365dcc' : '#446edd', rgb = i % 2 ? 'rgb(54, 93, 204)' : 'rgb(68, 110, 221)';
    const file = join(dir, 'tokens/tokens.json'), before = readFileSync(file, 'utf8');
    const ms = await b.eval(`(async () => { const t0 = performance.now(); const r = await napkin.tokens.write('accent', 'light', '${value}'); if (!r.ok) throw Error(r.error); const nodes = [...document.querySelectorAll('.cell .mount [data-n=root]')]; if (!nodes.every(n => getComputedStyle(n).backgroundColor === '${rgb}')) throw Error('edit did not reach all bound cells'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now()-t0; })()`);
    assert.deepEqual(changedLines(before, readFileSync(file, 'utf8')), { added: 1, removed: 1 }); edits.push(ms);
  }
  assert.equal(readFileSync(join(components, 'Button000.tsx'), 'utf8'), componentBefore);
  const environment = `Date: ${new Date().toISOString()}\nNode: ${process.version}; CPU Chromium (--disable-gpu), 1440x900.\nCorpus: bench/corpus.js, 200 components, ${n} mounted cells, every background bound to accent.
Viewport: ${fit ? 'fit all' : 'normal 100% zoom'}, ${visible} unculled component frames; all ${n} cells' computed colours verified, including offscreen frames.\nMeasurement: browser performance.now() through full getComputedStyle verification of all ${n} cells and two requestAnimationFrame callbacks (includes paint).\nRe-run: node bench/tokens.js${fit ? '' : ' --viewport'}\n`;
  for (const [id, xs, bar] of [['TOK-04', theme, 300], ['TOK-05', edits, 100]]) {
    const report = environment + `${id}: 10 samples ms: ${xs.map(x => x.toFixed(2)).join(', ')}\np50 ${pct(xs, .5)} ms; p95 ${pct(xs, .95)} ms; max ${Math.max(...xs).toFixed(2)} ms; bar < ${bar} ms.\n` + (id === 'TOK-05' ? 'Each source edit: exactly 1 removed / 1 added line; generated CSS updated; component source unchanged.\n' : 'All 1,200 computed background colours verified on every switch; component source unchanged.\n');
    writeFileSync(join(ROOT, `docs/evidence/${id}${fit ? '' : '-viewport'}.txt`), report); console.log(report);
    assert.ok(Math.max(...xs) < bar, `${id}: max ${Math.max(...xs)} >= ${bar}`);
  }
} finally { await b.close(); await server.stop(); }
