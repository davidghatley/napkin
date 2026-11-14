// Create component, history and discovery (docs/basics/standards.md section 9): undo puts the selection back on the source
// element, redo makes the component again and selects it; the selection header carries the Create component action.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>page</title>
<style>
  body { margin: 0; padding: 32px; font: 15px/1.45 Arial, sans-serif; }
  .card { width: 280px; padding: 20px; border: 1px solid #ccd; border-radius: 10px; background: #fffdf7; color: #16202a; }
  .card h2 { margin: 0 0 6px; font-size: 18px; }
</style>
</head>
<body>
  <h1>Orbit</h1>
  <article class="card" id="promo">
    <h2>Launch window</h2>
    <p>Opens at noon.</p>
  </article>
</body>
</html>
`;
const CARD = '0.1.1';
let r, server, b, io;
const file = (name) => join(r.compDir, name);
const q = (e) => b.eval(e);
const until = (fn, ms = 10000) => waitFor(fn, ms, 50);
const select = async (node) => { await q(`napkin.select({ component: 'page.html', node: '${node}', variant: {} }); 0`); await sleep(150); };
const sel_is = (v) => `(napkin.state.selection ? napkin.state.selection.component + '|' + napkin.state.selection.node : '') === '${v}'`;
const sel = () => q(`napkin.state.selection ? napkin.state.selection.component + '|' + napkin.state.selection.node : ''`);

before(async () => {
  r = tempRepo(['Button']);
  writeFileSync(file('page.html'), PAGE);
  server = await startServer(r.compDir, { timeout: 20000, env: { NAPKIN_ALL_KINDS: '0' } });
  b = await launchChromium({ width: 1440, height: 900 });
  io = input(b);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="page.html"]')?.dataset.ready`, 20000);
  await sleep(400);
});
after(async () => { await b?.close(); await server?.stop(); rmSync(r.dir, { recursive: true, force: true }); });

test('component history: undo selects the source element again; redo makes the component again and selects it', { timeout: 90000 }, async () => {
  await select(CARD);
  await io.key('k', { ctrl: true, alt: true });
  await until(() => existsSync(file('Card.tsx')));
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename' || null);
  await io.key('Escape');
  await until(async () => (await sel()).startsWith('Card.tsx') || null);
  await q(`document.activeElement?.blur?.(); 0`);
  await io.key('z', { ctrl: true });
  await until(() => !existsSync(file('Card.tsx')));
  await until(async () => (await sel()) === `page.html|${CARD}` || null, 8000).catch(() => {});
  assert.equal(await sel(), `page.html|${CARD}`, 'undo: the element it was made from is selected again');
  await q(`document.activeElement?.blur?.(); 0`);
  await io.key('z', { ctrl: true, shift: true });
  await until(() => existsSync(file('Card.tsx')));
  await until(async () => (await sel()).startsWith('Card.tsx') || null, 8000).catch(() => {});
  assert.match(await sel(), /^Card\.tsx/, 'redo: the component is back and selected');
});

test('component header: the right panel carries a Create component action beside the selection name, with its shortcut', { timeout: 90000 }, async () => {
  await until(async () => !(await q(`!!document.querySelector('.nk-rename')`)) || null);
  await sleep(1500); // the redo of the test before finishes selecting the card it made
  await select('0.1.1.0'); // the card's heading
  const btn = `document.querySelector('#panel .selhead #make-component')`;
  await b.waitFor(`${sel_is('page.html|0.1.1.0')} && !!${btn}`, 8000);
  assert.match(await q(`${btn}.textContent`), /Create component/);
  assert.match(await q(`${btn}.querySelector('kbd')?.textContent || ''`), /Ctrl.*Alt.*K/i, 'its shortcut is shown');
  assert.equal(await q(`${btn}.getAttribute('aria-disabled')`), null, 'enabled on an element');
  await select('0'); // <html>: the whole frame
  await b.waitFor(`${btn}?.getAttribute('aria-disabled') === 'true'`, 8000);
  assert.match(await q(`${btn}.title`), /whole frame/, 'dimmed, with the reason');
  await select('0.1.1.0');
  await b.waitFor(`${sel_is('page.html|0.1.1.0')} && !!${btn} && ${btn}.getAttribute('aria-disabled') === null`, 8000);
  const x = await q(`(() => { const r = ${btn}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await io.click(x[0], x[1]);
  await until(() => existsSync(file('H2.tsx')));
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename' || null);
  await io.key('Escape');
  await until(async () => !(await q(`!!document.querySelector('.nk-rename')`)) || null);
});

test('component inspector: the made component shows the styling of its scoped style, not "no styles"', { timeout: 90000 }, async () => {
  await select(CARD);
  await io.key('k', { ctrl: true, alt: true });
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename' || null);
  await io.key('Escape');
  await until(async () => (await sel()).startsWith('Card') || null);
  await sleep(1500);
  const panel = () => q(`document.querySelector('#panel').innerText`);
  await until(async () => !/Nothing styles this element yet/.test(await panel()) || null);
  const text = await panel();
  assert.match(text, /padding/, 'its padding is listed with the values that style it');
  assert.doesNotMatch(text, /0 matching/, 'the rules of its scoped style match it');
  assert.match(text, /[1-9]\d* matching/);
});
