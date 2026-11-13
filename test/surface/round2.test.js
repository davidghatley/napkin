// Surface round 2: keys pressed while the page is waking are not lost, a typed # replaces the selection, dial depth is one
// 32 px row, the instrument panel stays below the element panel, Ctrl+Z undoes an instrument change of a component, and a
// number with no range of its own gets a figure that moves with one step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CSS = `.card { padding: 12px; gap: 8px; }\n:root { --tint: #3366cc; }\n`;

test('surface round 2: early keys, typed #, dial rows, panel order, Ctrl+Z, number figure', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-surface-r2-')), files = join(dir, 'files');
  mkdirSync(files);
  writeFileSync(join(files, 'a.css'), CSS);
  writeFileSync(join(files, 'big.csv'), 'name,value\nx,664675\ny,2\n');
  writeFileSync(join(files, 'notes.md'), '# Notes\n\n' + 'A long line of words that makes the source value long. '.repeat(20) + '\n');
  copyFileSync(join(ROOT, 'fixtures/Button/Button.tsx'), join(files, 'Button.tsx'));
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } }), b = await launchChromium({ width: 1400, height: 900 });
  t.after(async () => { await b.close(); await server.stop(); rmSync(dir, { recursive: true, force: true }); });
  const io = input(b);
  const typeText = async (text) => { for (const ch of text) await b.send('Input.insertText', { text: ch }); };
  const palette = async (text) => { await io.key('k', { ctrl: true }); await b.waitFor('!document.querySelector("#quick").hidden'); await typeText(text); await sleep(60); await io.key('Enter'); await sleep(150); };

  // Keys pressed before the page has woken: Ctrl+K and the words after it reach the palette.
  await b.goto(server.url); // returns at the load event: the canvas's modules may not have run yet
  await io.key('k', { ctrl: true });
  for (const ch of 'Select a.css') { const vk = ch.toUpperCase().charCodeAt(0); await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, windowsVirtualKeyCode: vk }); await b.send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch, windowsVirtualKeyCode: vk }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: vk }); } // as a remote-control tool sends them: '.' arrives with the code of Delete
  await io.key('Enter');
  await b.waitFor('document.body.dataset.ready === "1"', 20000);
  await b.waitFor('!!document.querySelector(\'[data-controls-for="a.css"] [data-control-id]\')', 30000);

  // A '#' sent with the virtual-key code of End (what remote-control tools send) replaces the selection like any character.
  await palette('Select a.css');
  const colour = (await (await fetch(server.url + 'api/controls/a.css')).json()).sections.flatMap((s) => s.controls).find((c) => c.type === 'color');
  assert.ok(colour, 'a.css has a colour control');
  await palette('Control ' + colour.label);
  await io.key('a', { ctrl: true });
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '#', code: 'Digit3', windowsVirtualKeyCode: 35 });
  await b.send('Input.dispatchKeyEvent', { type: 'char', text: '#', key: '#', windowsVirtualKeyCode: 35 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '#', code: 'Digit3', windowsVirtualKeyCode: 35 });
  await typeText('c0ffee');
  assert.equal(await b.eval('document.activeElement.value'), '#c0ffee', 'the typed # replaced the selected value');
  await io.key('Enter');
  await b.waitFor(`fetch('/api/controls/a.css').then(r=>r.json()).then(j=>j.sections.flatMap(s=>s.controls).find(c=>c.id===${JSON.stringify(colour.id)}).value==='#c0ffee')`, 5000);

  // Dial depth is one 32 px row even for a long source value; bench depth gives it the full width.
  await palette('Select notes.md');
  await b.waitFor('!!document.querySelector(\'[data-controls-for="notes.md"] [data-control-id="source"]\')', 8000);
  await palette('Dial Source');
  const h = await b.eval(`document.querySelector('[data-control-id="source"]').getBoundingClientRect().height`);
  assert.ok(Math.abs(h - 32) <= 1, `dial is one 32 px row (${h})`);
  await palette('Bench Source');
  const wide = await b.eval(`(()=>{const t=document.querySelector('[data-control-id="source"] textarea').getBoundingClientRect(),r=document.querySelector('[data-control-id="source"]').getBoundingClientRect();return t.width/r.width})()`);
  assert.ok(wide > 0.8, `a long value has the row's width at bench depth (${wide})`);

  // A number with no range of its own: one step moves the figure.
  await palette('Select big.csv');
  await b.waitFor('!!document.querySelector(\'[data-controls-for="big.csv"] [data-control-id]\')', 8000);
  const cells = (await (await fetch(server.url + 'api/controls/big.csv')).json()).sections.flatMap((s) => s.controls).filter((c) => typeof c.value === 'number');
  const big = cells.find((c) => c.value === 664675);
  assert.ok(big, 'the csv has the large cell');
  const fig = () => b.eval(`document.querySelector('[data-control-id=${JSON.stringify(big.id)}] .d-figure').innerHTML`);
  await palette('Control ' + big.label);
  const before = await fig();
  await io.key('a', { ctrl: true }); await typeText('664676'); await io.key('Enter'); await sleep(200);
  assert.notEqual(await fig(), before, 'the figure moved with one step');

  // A component: the element panel comes first, the instrument panel below it; Ctrl+Z undoes the instrument change.
  await palette('Select Button.tsx');
  await b.waitFor('!!document.querySelector(\'#instruments [data-control-id]\')', 8000);
  const order = await b.eval(`(()=>{const p=document.querySelector('#panel'),i=document.querySelector('#instruments');return p.compareDocumentPosition(i)&Node.DOCUMENT_POSITION_FOLLOWING?'panel-first':'instruments-first'})()`);
  assert.equal(order, 'panel-first');
  const zoom = (await (await fetch(server.url + 'api/controls/Button.tsx')).json()).sections.flatMap((s) => s.controls).find((c) => typeof c.value === 'number');
  const original = readFileSync(join(files, 'Button.tsx'), 'utf8');
  if (zoom) {
    await palette('Control ' + zoom.label);
    await io.key('a', { ctrl: true }); await typeText(String(zoom.value + 3)); await io.key('Enter'); await sleep(300);
    await b.eval('document.activeElement.blur()');
    await io.key('z', { ctrl: true });
    await b.waitFor(`fetch('/api/controls/Button.tsx').then(r=>r.json()).then(j=>j.sections.flatMap(s=>s.controls).find(c=>c.id===${JSON.stringify(zoom.id)}).value===${zoom.value})`, 5000);
    assert.equal(readFileSync(join(files, 'Button.tsx'), 'utf8'), original, 'undo restored the file');
  }
});
