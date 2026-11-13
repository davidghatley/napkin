import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, SVG } from './helpers.js';
import { launchChromium } from '../helpers/cdp.js';

const key = (b, k, code = 'Key' + k.toUpperCase()) => b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) })
  .then(() => b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }));

test('saved views: four writers adding views from one snapshot keep all of them; a blind replace that drops one is refused', async (t) => {
  const ctl = await setup(t);
  const names = ['a', 'b', 'c', 'd'], ws = await Promise.all(names.map((n) => ctl.as(n)));
  assert.equal((await ws[0].post('/api/board', { addViews: [{ id: 'base', name: 'Base' }] })).status, 200);
  const out = await Promise.all(ws.map((w, i) => w.post('/api/board', { addViews: [{ id: `v-${names[i]}`, name: names[i] }] })));
  assert.deepEqual(out.map((r) => r.status), [200, 200, 200, 200]);
  const b = (await ws[0].get('/api/board')).json;
  assert.deepEqual(b.views.map((v) => v.id).sort(), ['base', 'v-a', 'v-b', 'v-c', 'v-d']);
  // the old way: three writers replace the list from the same snapshot; the ones that would drop a view are refused
  const blind = await Promise.all(ws.slice(0, 3).map((w, i) => w.post('/api/board', { views: [...b.views, { id: `r-${i}`, name: 'r' }].filter((v) => v.id !== 'base' || i === 0) })));
  assert.ok(blind.some((r) => r.status === 409), 'a replace that drops a saved view without baseRevision is refused');
  assert.match(blind.find((r) => r.status === 409).json.error, /addViews|baseRevision/);
  assert.equal((await ws[1].post('/api/board', { views: [], baseRevision: 0 })).status, 409, 'a stale revision is refused');
  const now = (await ws[0].get('/api/board')).json;
  assert.equal((await ws[0].post('/api/board', { views: [{ id: 'only', name: 'Only' }], baseRevision: now.revision })).status, 200);
  assert.equal((await ws[0].post('/api/board', { removeViews: ['only'] })).status, 200);
  assert.deepEqual((await ws[0].get('/api/board')).json.views, []);
  // the run section carries its progress for the canvas header
  const run = (await ws[0].post('/api/runs', { name: 'P', plan: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }] })).json.id;
  await ws[0].post(`/api/runs/${run}/steps`, { id: 'x', status: 'complete' });
  const sec = (await ws[0].get('/api/board')).json.runs.find((r) => r.run === run);
  assert.equal(sec.progress.done, 1); assert.equal(sec.progress.total, 2);
});

test('a long run reads on the canvas: one run region with progress, its groups inside it, labels apart, and Arrange by run keeps the groups', async (t) => {
  const files = {}; for (let i = 0; i < 12; i++) files[`f${i}.svg`] = SVG(i + 1);
  const ctl = await setup(t, { files });
  const browser = await launchChromium({ width: 1360, height: 820 });
  t.after(() => browser.close());
  await browser.goto(ctl.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 20000);
  assert.equal(await browser.eval('!!document.querySelector("#run-groups")'), false, 'no run, nothing added to the canvas');
  const agent = await ctl.as('claude');
  const run = (await agent.post('/api/runs', { name: 'Long study', plan: Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, label: 'Step ' + i })) })).json.id;
  for (let i = 0; i < 12; i++) await agent.post(`/api/runs/${run}/artifacts`, { path: `f${i}.svg`, content: files[`f${i}.svg`] });
  for (let i = 0; i < 12; i++) await agent.post(`/api/runs/${run}/steps`, { id: 's' + i, status: 'complete' });
  await agent.post('/api/board', { addGroups: [{ id: 'g1', name: 'First set', items: Array.from({ length: 6 }, (_, i) => `f${i}.svg`) }, { id: 'g2', name: 'Second set', items: Array.from({ length: 6 }, (_, i) => `f${i + 6}.svg`) }] });
  await browser.waitFor('document.querySelectorAll(".rg-box").length === 3', 10000);
  const geo = () => browser.eval(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, text: e.innerText }; };
    return { run: r('.rg-box[data-kind="run"]'), g1: r('.rg-box[data-group="g1"]'), g2: r('.rg-box[data-group="g2"]'), l1: r('.rg-box[data-group="g1"] .rg-label'), l2: r('.rg-box[data-group="g2"] .rg-label'), lr: r('.rg-box[data-kind="run"] .rg-label') }; })()`);
  const apart = (a, b) => a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1;
  const inside = (a, b) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1;
  const check = (g, why) => {
    assert.match(g.run.text, /Long study/, why); assert.match(g.run.text, /12 \/ 30 steps/, why);
    assert.ok(inside(g.run, g.g1) && inside(g.run, g.g2), why + ': groups are drawn inside the run');
    assert.ok(apart(g.l1, g.l2) && apart(g.lr, g.l1) && apart(g.lr, g.l2), why + ': labels do not overprint');
  };
  check(await geo(), 'as placed');
  // Arrange by run: the groups stay separate blocks
  await agent.post('/api/board', { arrange: { by: 'run' } });
  await browser.waitFor('(() => { const a = document.querySelector(\'.rg-box[data-group="g1"]\').getBoundingClientRect(), b = document.querySelector(\'.rg-box[data-group="g2"]\').getBoundingClientRect(); return a.bottom <= b.top + 1 || b.bottom <= a.top + 1; })()', 10000);
  const g = await geo(); check(g, 'arranged');
  assert.ok(apart(g.g1, g.g2), 'the two groups are two blocks, not merged');
  // the run is framed in the view without the person asking
  assert.ok(g.run.x >= -2 && g.run.x + g.run.w <= 1362, 'the run fits the width of the screen');
  writeFileSync(join(ctl.dir, 'shot.png'), await browser.screenshot());
  const shot = await browser.screenshot();
  const { mkdirSync } = await import('node:fs'); mkdirSync('docs/evidence', { recursive: true });
  writeFileSync('docs/evidence/agents3-long-run.png', shot);
});

test('a decision made in the full diff lands on the next waiting card', async (t) => {
  const ctl = await setup(t, { files: { 'a.md': Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n', 'b.md': 'bee\n' } });
  const browser = await launchChromium({ width: 1360, height: 820 });
  t.after(() => browser.close());
  await browser.goto(ctl.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 20000);
  const agent = await ctl.as('claude');
  const run = (await agent.post('/api/runs', { name: 'Edits' })).json.id;
  const p1 = (await agent.post(`/api/runs/${run}/proposals`, { path: 'a.md', content: Array.from({ length: 20 }, (_, i) => (i === 18 ? 'line eighteen' : `line ${i}`)).join('\n') + '\n' })).json.id;
  const p2 = (await agent.post(`/api/runs/${run}/proposals`, { path: 'b.md', content: 'bee changed\n' })).json.id;
  await browser.waitFor(`document.querySelector('[data-proposal-id="${p1}"]') && document.querySelector('[data-proposal-id="${p2}"]')`, 8000);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', modifiers: 1, windowsVirtualKeyCode: 82 });
  await browser.waitFor('document.activeElement?.dataset?.proposalId', 3000);
  await browser.eval(`document.querySelector('[data-proposal-id="${p1}"]').focus()`);
  await key(browser, 'd');
  await browser.waitFor('!!document.querySelector(".rdf")', 4000);
  await key(browser, 'x');
  await browser.waitFor(`document.activeElement?.dataset?.proposalId === "${p2}"`, 4000);
  await key(browser, 'x');
  await browser.waitFor(`!document.querySelector('[data-proposal-id]')`, 4000);
  await browser.waitFor("document.activeElement?.id === 'stage'", 3000); // with the queue clear the focus returns to the canvas
});
