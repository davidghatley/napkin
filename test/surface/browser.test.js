// The surface in a real browser, by keys only: Select <path> opens the instrument panel, Control <label> takes a typed
// value to the file, arrows walk the cards by position, Shift adds, Group names them, ? shows the bindings in force and a
// rebinding runs at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CSS = `.card { padding: 12px; gap: 8px; }\n:root { --tint: #3366cc; }\n`;

test('surface: palette phrases, one instrument panel, spatial focus, groups, key map and rebinding', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-surface-browser-')), files = join(dir, 'files');
  mkdirSync(files);
  writeFileSync(join(files, 'a.css'), CSS);
  writeFileSync(join(files, 'notes.md'), '# Notes\n\nOne line.\n');
  writeFileSync(join(files, 'table.csv'), 'name,value\nx,1\ny,2\n');
  writeFileSync(join(files, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c33"/></svg>');
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } }), b = await launchChromium({ width: 1400, height: 900 });
  t.after(async () => { await b.close(); await server.stop(); rmSync(dir, { recursive: true, force: true }); });
  const errors = [];
  b.onEvent((e) => { if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text); });
  const io = input(b);
  const typeText = async (text) => { for (const ch of text) await b.send('Input.insertText', { text: ch }); };
  const palette = async (text) => { await io.key('k', { ctrl: true }); await b.waitFor('!document.querySelector("#quick").hidden'); await typeText(text); await sleep(60); await io.key('Enter'); await sleep(120); };
  const board = async () => (await fetch(server.url + 'api/board')).json();
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1" && document.querySelectorAll("#world [data-item-id]").length >= 4', 20000);

  // Select <path>: the card is selected and focused, the board says so, the panel is the dials panel for it.
  await palette('Select a.css');
  await b.waitFor('!!document.querySelector(\'[data-controls-for="a.css"] [data-control-id]\')', 5000);
  assert.deepEqual((await board()).selection, ['a.css']);
  assert.equal(await b.eval('document.activeElement.dataset.itemId'), 'a.css');
  assert.equal(await b.eval('document.querySelectorAll("#instruments .d-section").length > 0'), true, 'the panel is drawn by dials');
  assert.equal(await b.eval('document.querySelector("#panel").hidden'), true, 'a file item has no second panel');

  // Control <label>: a typed value reaches the file through the panel.
  const schema = await (await fetch(server.url + 'api/controls/a.css')).json();
  const num = schema.sections.flatMap((s) => s.controls).find((c) => typeof c.value === 'number');
  assert.ok(num, 'a.css has a numeric control');
  await palette('Control ' + num.label);
  assert.equal(await b.eval(`document.activeElement.closest('[data-control-id]')?.dataset.controlId`), num.id);
  await io.key('a', { ctrl: true });
  await typeText(String(num.value + 5));
  await io.key('Enter');
  await b.waitFor(`fetch('/api/controls/a.css').then(r=>r.json()).then(j=>j.sections.flatMap(s=>s.controls).find(c=>c.id===${JSON.stringify(num.id)}).value===${num.value + 5})`, 5000);
  assert.ok(readdirSync(files).some((f) => f.startsWith('a.css') && (f !== 'a.css' || readFileSync(join(files, f), 'utf8') !== CSS)), 'the file or the recipe beside it changed');
  assert.equal(await b.eval(`document.activeElement.classList.contains('d-label')`), true, 'Enter hands focus to the label, where arrows step');
  await b.eval(`document.querySelector('[data-inst-undo]').click()`);
  await b.waitFor(`fetch('/api/controls/a.css').then(r=>r.json()).then(j=>j.sections.flatMap(s=>s.controls).find(c=>c.id===${JSON.stringify(num.id)}).value===${num.value})`, 5000);

  // Arrow keys walk the cards by position; Shift adds the next one; Group names them without touching the folder.
  await palette('Select a.css');
  const geometry = JSON.parse(await b.eval(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#world [data-item-id]')].map(e=>{const r=e.getBoundingClientRect();return[e.dataset.itemId,{x:r.x+r.width/2,y:r.y+r.height/2}]})))`));
  const cur = geometry['a.css'];
  const right = Object.entries(geometry).filter(([, p]) => p.x > cur.x + 1).sort((a, z) => (Math.hypot(a[1].x - cur.x, a[1].y - cur.y) + Math.abs(a[1].y - cur.y)) - (Math.hypot(z[1].x - cur.x, z[1].y - cur.y) + Math.abs(z[1].y - cur.y)))[0]?.[0];
  if (right) {
    await io.key('ArrowRight'); await sleep(100);
    assert.deepEqual((await board()).selection, [right], 'ArrowRight focuses the nearest card to the right');
    await io.key('ArrowLeft'); await sleep(80);
    await io.key('ArrowRight', { shift: true }); await sleep(120);
    assert.equal((await board()).selection.length, 2, 'Shift+ArrowRight adds the card');
    await b.waitFor(`document.querySelectorAll('[data-controls-many]').length === 1`, 3000);
    const before = readFileSync(join(files, 'a.css'), 'utf8');
    await palette('Group Pair of cards');
    const g = (await board()).groups.find((x) => x.name === 'Pair of cards');
    assert.equal(g?.items.length, 2);
    assert.equal(await b.eval(`[...document.querySelectorAll('[data-group-id] .bg-name')].some(e=>e.textContent==='Pair of cards')`), true, 'the group is named on the canvas');
    assert.equal(readFileSync(join(files, 'a.css'), 'utf8'), before, 'grouping leaves the folder untouched');
  }

  // Arrange by kind, the key map, and a rebinding that runs at once and is listed.
  await palette('Arrange by kind');
  assert.equal((await board()).arrange.by, 'kind');
  await b.waitFor(`document.querySelectorAll('[data-group-id]').length >= 3`, 3000);
  await io.key('?', { code: 'Slash', shift: true });
  await b.waitFor('document.querySelector("#shortcuts").open');
  const keys = await (await fetch(server.url + 'api/keys')).json();
  const text = await b.eval('document.querySelector("#shortcuts").innerText');
  assert.ok(keys.bindings.every((x) => text.includes(x.keys)), 'every binding in force is in the key map');
  await io.key('Escape');
  await palette('Arrange by folder');
  assert.equal((await board()).arrange.by, 'folder');
  await palette('Rebind arrange-kind to Alt+Y');
  await io.key('y', { alt: true }); await sleep(150);
  assert.equal((await board()).arrange.by, 'kind', 'the new binding runs');
  await io.key('?', { code: 'Slash', shift: true });
  await b.waitFor('document.querySelector("#shortcuts").open');
  assert.match(await b.eval('document.querySelector("#shortcuts").innerText'), /Alt\+Y/);
  await io.key('Escape');

  // Present takes the screen; Escape leaves and says so to the board.
  await palette('Present');
  assert.equal((await board()).presentation, true);
  assert.ok(await b.eval(`(()=>{const r=document.querySelector('[data-presenting]').getBoundingClientRect();return r.width*r.height/(innerWidth*innerHeight)})()`) >= 0.7);
  await io.key('Escape'); await sleep(120);
  assert.equal((await board()).presentation, false);
  assert.deepEqual(errors, []);
});
