// AGT-10 on the canvas: you start editing a property, an agent changes the same one, you commit. The store refuses yours as stale and the panel
// shows a clash chip on that property with both values and one click "Use mine" (re-applies yours on the new revision).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openAgents, sleep, waitFor } from './helpers.js';
import { centerOf } from '../helpers/input.js';

test('clash chip', { timeout: 120000 }, async (t) => {
  const p = await openAgents(['Button', 'Card']);
  const { q, browser, io } = p;
  const text = (sel) => q(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
  const startEditing = async (field) => {
    const c = await centerOf(browser, `document.querySelector('#panel #${field}')`);
    await io.click(c.x, c.y);
    await browser.waitFor(`document.activeElement?.id === '${field}'`);
  };
  const commit = async (field, value) => {
    await q(`document.querySelector('#panel #${field}').select()`);
    await browser.send('Input.insertText', { text: value });
    await io.key('Enter');
  };
  try {
    const scout = await p.agent('scout');
    await p.select('Button', 'root', { size: 'md', state: 'default' });
    await browser.waitFor(`!!document.querySelector('#panel #padding')`);

    await t.test('yours 12 · scout\'s 16 (landed), and Use mine writes yours on the new revision', async () => {
      await startEditing('padding');
      const r = await scout.apply('Button', [{ op: 'set', path: 'root.padding', value: 16 }]);
      assert.equal(r.ok, true, JSON.stringify(r));
      await p.settled('Button');
      await browser.waitFor(`document.activeElement?.id === 'padding'`); // the panel redraw keeps you in the field
      await commit('padding', '12');
      await browser.waitFor(`!!document.querySelector('#panel .clash-chip')`);
      const chip = await text('#panel .clash-chip .cc-text');
      assert.match(chip, /yours 12 · scout's 16 \(landed\)/, chip);
      // the chip sits at the top of the Layout section, where padding is, and nothing was written
      assert.equal(await q(`document.querySelector('#panel .clash-chip').closest('.sbody').querySelector('#padding') !== null`), true);
      assert.match(readFileSync(p.fileOf('Button'), 'utf8'), /padding: 16\b/);
      assert.equal(await q(`document.querySelector('#panel .field-error')?.textContent ?? ''`), '', 'no raw stale error beside it');
      assert.equal(await text('#error'), '', 'no toast either: the chip is the message');
      await p.shot('agents-clash');
      const before = (await p.history('Button')).length;
      await q(`document.querySelector('#panel .clash-chip .cc-mine').click()`);
      await waitFor(() => /padding: 12\b/.test(readFileSync(p.fileOf('Button'), 'utf8')), 3000);
      const hist = await p.history('Button');
      assert.equal(hist.length, before + 1, 'one new revision');
      assert.equal(hist[0].by, 'you'); assert.match(hist[0].summary, /root\.padding = 12/);
      await browser.waitFor(`!document.querySelector('#panel .clash-chip')`);
      assert.equal(await q(`napkin.clash.list().length`), 0);
    });

    await t.test('Keep theirs drops the chip and leaves the file alone', async () => {
      await p.settled('Button');
      await startEditing('padding');
      console.log('# base', JSON.stringify(await q(`[...napkin.clash.state.base.values()]`)), await q('napkin.find("Button").revision'));
      const r = await scout.apply('Button', [{ op: 'set', path: 'root.padding', value: 20 }]);
      assert.equal(r.ok, true, JSON.stringify(r));
      await p.settled('Button');
      await browser.waitFor(`document.activeElement?.id === 'padding'`);
      await commit('padding', '9');
      await browser.waitFor(`!!document.querySelector('#panel .clash-chip')`);
      assert.match(await text('#panel .clash-chip .cc-text'), /yours 9 · scout's 20 \(landed\)/);
      const before = readFileSync(p.fileOf('Button'), 'utf8');
      await q(`document.querySelector('#panel .clash-chip .cc-theirs').click()`);
      await browser.waitFor(`!document.querySelector('#panel .clash-chip')`);
      assert.equal(readFileSync(p.fileOf('Button'), 'utf8'), before);
      await sleep(150);
      assert.equal(await q(`document.querySelector('#panel #padding').value`), '20');
    });

    await t.test('no clash when you did not start before their change: your edit simply lands', async () => {
      await q(`document.activeElement.blur()`); await sleep(400);
      const r = await scout.apply('Button', [{ op: 'set', path: 'root.padding', value: 5 }]);
      await p.settled('Button');
      await startEditing('padding');
      await commit('padding', '7');
      await waitFor(() => /padding: 7\b/.test(readFileSync(p.fileOf('Button'), 'utf8')), 3000);
      assert.equal(await q(`document.querySelectorAll('#panel .clash-chip').length`), 0);
    });

    await t.test('a clash on a different property does not block yours', async () => {
      await startEditing('padding');
      await scout.apply('Button', [{ op: 'set', path: 'root.gap', value: 4 }]);
      await p.settled('Button');
      await browser.waitFor(`document.activeElement?.id === 'padding'`);
      await commit('padding', '11');
      await waitFor(() => /padding: 11\b/.test(readFileSync(p.fileOf('Button'), 'utf8')), 3000);
      assert.equal(await q(`document.querySelectorAll('#panel .clash-chip').length`), 0);
    });
  } finally { await p.close(); }
});
