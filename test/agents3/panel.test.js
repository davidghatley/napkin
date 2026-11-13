import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setup, SVG } from './helpers.js';
import { launchChromium } from '../helpers/cdp.js';

const key = (b, k, { alt = false, code = 'Key' + k.toUpperCase() } = {}) => b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: alt ? 1 : 0, ...(alt ? {} : { text: k.length === 1 ? k : undefined }), windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 })
  .then(() => b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: alt ? 1 : 0 }));

test('the person sees runs, steps, agents, proposals and questions, and clears the queue from the keyboard', async (t) => {
  const ctl = await setup(t);
  const browser = await launchChromium({ width: 1360, height: 820 });
  t.after(() => browser.close());
  const errors = [];
  browser.onEvent((e) => { if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text); });
  await browser.goto(ctl.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 20000);
  assert.equal(await browser.eval('document.querySelector("#runs-panel").hidden'), true, 'nothing to show, nothing drawn');

  const agent = await ctl.as('claude'), you = await ctl.as('you');
  const run = (await agent.post('/api/runs', { name: 'Orbit study', plan: ['Sketch', 'Render', 'Review'].map((label, i) => ({ id: 's' + i, label })) })).json.id;
  await agent.post(`/api/runs/${run}/steps`, { id: 's0', status: 'complete' });
  await agent.post(`/api/runs/${run}/steps`, { id: 's1', status: 'running', note: 'rendering' });
  await agent.post(`/api/runs/${run}/artifacts`, { path: 'renders/orbit.svg', content: SVG(3), step: 's0' });
  const prop = (await agent.post(`/api/runs/${run}/proposals`, { path: 'notes/summary.md', content: '# Summary\n\nThe orbit is gold.\n', note: 'a first summary' })).json.id;
  const prop2 = (await agent.post(`/api/runs/${run}/proposals`, { path: 'notes/two.md', content: 'two' })).json.id;
  const q = (await agent.post('/api/questions', { run, text: 'Which orbit do you want?', options: ['gold', 'blue'] })).json.id;
  await browser.waitFor('document.querySelector("#runs-panel") && !document.querySelector("#runs-panel").hidden && document.body.innerText.includes("Which orbit do you want?") && document.body.innerText.includes("Sketch")', 8000);
  const text = await browser.eval('document.body.innerText');
  for (const need of ['Orbit study', 'claude', 'Which orbit do you want?', 'notes/summary.md', 'Sketch', 'Render', 'rendering', '3 waiting for you']) assert.ok(text.includes(need), need + ' is not on screen: ' + text.slice(0, 900));
  assert.ok(await browser.eval(`!!document.querySelector('[data-proposal-id="${prop}"]') && !!document.querySelector('[data-question-id="${q}"]')`));
  assert.equal(await browser.eval('document.querySelector(".rp-bar").getAttribute("aria-valuenow")'), '1');
  const dir = resolve('docs/evidence'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agents3-run-panel.png'), await browser.screenshot());

  // keyboard: Alt+R focuses the queue, the first card is the question; 1 picks its first option
  await key(browser, 'r', { alt: true });
  await browser.waitFor('document.activeElement?.dataset?.questionId', 3000);
  await key(browser, '1', { code: 'Digit1' });
  await browser.waitFor(`!document.body.innerText.includes("Which orbit do you want?")`, 4000);
  assert.equal((await agent.get(`/api/questions/${q}`)).json.answer, 'gold');
  // the next card is a proposal; type a note with c, then approve with a
  await browser.waitFor(`document.activeElement?.dataset?.proposalId === "${prop}"`, 3000);
  await key(browser, 'j');
  await browser.waitFor(`document.activeElement?.dataset?.proposalId === "${prop2}"`, 3000);
  await key(browser, 'k');
  await key(browser, 'c');
  await browser.send('Input.insertText', { text: 'good, keep going' });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.waitFor(`document.activeElement?.dataset?.proposalId === "${prop}"`, 3000);
  await key(browser, 'a');
  await browser.waitFor(`!document.querySelector('[data-proposal-id="${prop}"]')`, 4000);
  assert.equal(readFileSync(join(ctl.dir, 'notes/summary.md'), 'utf8'), '# Summary\n\nThe orbit is gold.\n');
  const ev = (await agent.get('/api/event-log?types=run-proposal-resolved')).json.events.find((e) => e.id === prop);
  assert.equal(ev.outcome, 'accepted'); assert.equal(ev.comment, 'good, keep going'); assert.equal(ev.by, 'you');
  // reject the second one with x
  await browser.waitFor(`document.activeElement?.dataset?.proposalId === "${prop2}"`, 3000);
  await key(browser, 'x');
  await browser.waitFor(`!document.querySelector('[data-proposal-id]')`, 4000);
  assert.ok(!existsSync(join(ctl.dir, 'notes/two.md')));
  assert.ok(await browser.eval('document.querySelector("#runs-panel").dataset.waiting === "0"'));
  // what the person selected is readable by agents
  await browser.eval(`napkin.select({ component: 'renders/orbit.svg', node: 'item', variant: {} })`);
  await browser.waitFor(`true`, 100);
  for (let i = 0; i < 40; i++) { const b = (await agent.get('/api/board')).json; if (b.selection.includes('renders/orbit.svg')) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.deepEqual((await agent.get('/api/board')).json.selection, ['renders/orbit.svg']);
  // an artifact card knows which run made it
  await browser.waitFor(`document.querySelector('[data-item-id="renders/orbit.svg"]')?.dataset.run === "${run}"`, 5000);
  writeFileSync(join(dir, 'agents3-run-panel-cleared.png'), await browser.screenshot());
  assert.deepEqual(errors, []);
  void you;
});
