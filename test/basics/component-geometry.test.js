// Round 4, Create component keeps what the selection measured in its frame (standards section 9, rule 5): its size, and a
// refusal in one sentence, with nothing made, where a component cannot show what the selection showed (a shape inside an
// <svg>, a table row on its own). Measured in the browser: the frame and the made component are each drawn by /view at the
// same width, with no parent width handed to the component, and the root's box is compared.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

let r, server, b, io;
const file = (name) => join(r.compDir, name);
const q = (e) => b.eval(e);
const json = async (e) => JSON.parse(await q(`Promise.resolve(${e}).then((v) => JSON.stringify(v ?? null))`));
const until = (fn, ms = 15000) => waitFor(fn, ms, 50);
const hint = () => q(`document.querySelector('#hint').textContent`);
const tsx = () => readdirSync(r.compDir).filter((n) => n.endsWith('.tsx')).sort();
const nodeOf = (frame, pred) => json(`fetch('/api/component/${frame}').then((x) => x.json()).then((d) => { const walk = (l) => { for (const n of l || []) { if ((${pred})(n)) return String(n.node); const f = walk(n.children); if (f) return f; } return null; }; return walk(d.tree); })`);
const byClass = (c) => `(n) => String(n.attrs?.class || '').split(/\\s+/).includes('${c}')`;
const byTag = (t) => `(n) => n.tag === '${t}'`;
async function make(frame, pred) {
  const node = await nodeOf(frame, pred);
  assert.ok(node, `${pred} is in ${frame}`);
  await q(`document.activeElement?.blur?.(); napkin.select({ component: '${frame}', node: '${node}', variant: {} }); 0`);
  await sleep(150);
  await io.key('k', { ctrl: true, alt: true });
}
// the box of the first element matching `sel` in the document /view draws for `id`, at a width
const box = (id, sel, width = 640) => json(`(async () => {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:${width}px;height:900px;border:0;opacity:0;pointer-events:none;z-index:-1';
  await new Promise((res) => { f.addEventListener('load', res, { once: true }); f.src = '/view/' + encodeURIComponent(${JSON.stringify(id)}) + '?width=${width}'; document.body.append(f); });
  const d = f.contentDocument; const t0 = performance.now();
  while (!d.querySelector(${JSON.stringify(sel)}) && performance.now() - t0 < 8000) await new Promise((x) => setTimeout(x, 50));
  await d.fonts?.ready; await new Promise((x) => setTimeout(x, 150));
  const e = d.querySelector(${JSON.stringify(sel)}), rc = e.getBoundingClientRect(); f.remove();
  return { w: Math.round(rc.width * 100) / 100, h: Math.round(rc.height * 100) / 100 };
})()`);
// the element as the canvas draws its frame (the box a person selected)
const inFrame = (frame, sel) => json(`(() => { const e = document.querySelector('section.cmp[data-component="${frame}"] iframe').contentDocument.querySelector(${JSON.stringify(sel)}), rc = e.getBoundingClientRect(); return { w: Math.round(rc.width * 100) / 100, h: Math.round(rc.height * 100) / 100 }; })()`);
async function same(frame, sel, pred, name) {
  const was = await inFrame(frame, sel);
  await make(frame, pred);
  await until(() => existsSync(file(`${name}.tsx`)));
  await until(async () => (await q(`String([...napkin.state.components.values()].some((c) => c.path === '${name}.tsx'))`)) === 'true' || null);
  await until(async () => (await q(`!!document.querySelector('.nk-rename')`)) === true || null);
  await io.key('Escape');
  return { was, is: await box(`${name}.tsx#${name}`, sel) };
}

before(async () => {
  r = tempRepo(['Button']);
  for (const f of ['workshop.html', 'edge-cases.html']) writeFileSync(file(f), readFileSync(new URL(`../fixtures/component/${f}`, import.meta.url)));
  server = await startServer(r.compDir, { timeout: 20000, env: { NAPKIN_ALL_KINDS: '0' } });
  b = await launchChromium({ width: 1440, height: 900 });
  io = input(b);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="workshop.html"]')?.dataset.ready && !!document.querySelector('section.cmp[data-component="edge-cases.html"]')?.dataset.ready`, 30000);
  await sleep(400);
});
after(async () => { await b?.close(); await server?.stop(); rmSync(r.dir, { recursive: true, force: true }); });

test('round 4: a card a grid row stretched keeps its height on its own', { timeout: 90000 }, async () => {
  const { was, is } = await same('workshop.html', '.forecast', byClass('forecast'), 'Forecast');
  assert.ok(was.h > 200, `the frame stretches it to the row: ${was.h}`);
  assert.deepEqual(is, was);
});

test('round 4: a table that filled its parent keeps its width, and a half-width section in a block parent keeps its width', { timeout: 90000 }, async () => {
  const t = await same('workshop.html', '.matrix', byClass('matrix'), 'Matrix');
  assert.deepEqual(t.is, t.was);
  const s = await same('edge-cases.html', '.sized', byClass('sized'), 'Sized');
  assert.deepEqual(s.is, s.was);
  const c = await same('edge-cases.html', '.cascade', byClass('cascade'), 'Cascade');
  assert.deepEqual(c.is, c.was);
});

test('round 4: a table row and a shape inside an svg are refused with a sentence, and nothing is made', { timeout: 90000 }, async () => {
  const n = tsx();
  await make('workshop.html', byTag('tr'));
  await until(async () => /part of a table/.test(await hint()) || null);
  await make('workshop.html', byTag('rect'));
  await until(async () => /inside an <svg>/.test(await hint()) || null);
  await sleep(500);
  assert.deepEqual(tsx(), n);
});
