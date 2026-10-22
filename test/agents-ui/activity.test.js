// AGT-09 on the canvas: the Activity tab lists every apply, create, rename, delete and undo by who, live (<= 200 ms), click to focus the node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAgents, sleep, waitFor } from './helpers.js';
import { http, evidence } from '../helpers/agents.js';

test('activity feed on the canvas', { timeout: 120000 }, async (t) => {
  const p = await openAgents(['Button', 'Card', 'Chip']);
  const { q, browser, io } = p;
  const rows = () => q(`[...document.querySelectorAll('#a-list .arow')].map((r) => ({ by: r.dataset.by, how: r.dataset.how, kind: r.dataset.kind, node: r.dataset.node, component: r.dataset.component, text: r.textContent }))`);
  try {
    await p.agent('scout');
    await q(`document.querySelector('#open-activity').click()`);
    await browser.waitFor(`!!document.querySelector('#pane-activity') && !document.querySelector('#pane-activity').hidden`);

    await t.test('every apply is listed within 200 ms, by who, with its summary and time', async () => {
      const scout = await p.agent('scout');
      const t0 = Date.now();
      const r = await scout.apply('Button', [{ op: 'set', path: 'label.fontWeight', value: 700 }]);
      assert.equal(r.ok, true, JSON.stringify(r));
      // when the row reached the page, measured by the page's own clock against the revision's timestamp
      await browser.waitFor(`document.querySelectorAll('#a-list .arow[data-by="scout"]').length === 1`, 2000);
      const hit = await q(`(() => { const row = napkin.activity.rows()[0]; return { at: row.at, seenAt: Date.now() }; })()`);
      assert.ok(hit.seenAt - hit.at <= 200, `row listed ${hit.seenAt - hit.at} ms after the edit landed`);
      console.log(`# activity: scout's apply listed ${hit.seenAt - hit.at} ms after it landed (${Date.now() - t0} ms incl. the request)`);
      evidence('AGT-09', `Re-run: EVIDENCE=1 node --test test/agents-ui/activity.test.js\nAn agent's apply was listed in the Activity tab ${hit.seenAt - hit.at} ms after it landed (bar: <= 200 ms).\nApply, create, rename, delete and undo rows by who; click or Enter focuses the node.`);
      const [first] = await rows();
      assert.equal(first.by, 'scout'); assert.match(first.text, /label\.fontWeight = 700/); assert.match(first.text, /Button · label · r[0-9a-f]{7}\d\d:\d\d:\d\d/); assert.match(first.text, /\d\d:\d\d:\d\d · (now|\d+s ago)/);
      assert.equal(first.node, 'label');
      const dot = await q(`getComputedStyle(document.querySelector('#a-list .arow .adot')).backgroundColor`);
      assert.notEqual(dot, 'rgba(0, 0, 0, 0)');
    });

    await t.test('you, create, rename, delete and undo all show', async () => {
      await p.you('Button', [{ op: 'set', path: 'root.padding', value: '30px' }]);
      await p.settled('Button');
      const scout = await p.agent('scout');
      assert.equal((await http(p.server.url, '/api/components', { method: 'POST', token: scout.token, body: { name: 'Tooltip' } })).status, 201);
      await browser.waitFor(`!!napkin.find('Tooltip')`);
      const tip = await q(`napkin.find('Tooltip').component`);
      assert.equal((await http(p.server.url, `/api/components/${tip}/rename`, { method: 'POST', token: scout.token, body: { name: 'Hint' } })).status, 200);
      await io.key('z', { ctrl: true }); // you undo your own padding edit
      await browser.waitFor(`napkin.activity.rows().some((r) => r.how === 'undo' && r.by === 'you')`);
      assert.equal((await http(p.server.url, `/api/components/${tip}`, { method: 'DELETE', token: scout.token })).status, 200);
      await browser.waitFor(`napkin.activity.rows().some((r) => r.kind === 'removed')`);
      const all = await rows();
      assert.ok(all.some((r) => r.by === 'you' && /root\.padding/.test(r.text) && r.how === 'edit'), 'your edit');
      assert.ok(all.some((r) => r.by === 'scout' && r.kind === 'added' && /created Tooltip/.test(r.text)), 'create');
      assert.ok(all.some((r) => r.by === 'scout' && /rename/i.test(r.text)), 'rename');
      assert.ok(all.some((r) => r.by === 'you' && r.how === 'undo' && /undo/.test(r.text)), 'undo');
      assert.ok(all.some((r) => r.by === 'scout' && r.kind === 'removed'), 'delete');
      // agents only
      await q(`document.querySelector('#a-agents-only').click()`);
      assert.ok((await rows()).every((r) => r.by !== 'you'));
      await q(`document.querySelector('#a-agents-only').click()`);
    });

    await t.test('a reload reads the same list back from the server', async () => {
      const n = (await rows()).length;
      await browser.goto(p.server.url);
      await browser.waitFor('document.body.dataset.ready === "1"');
      await q(`document.querySelector('#open-activity').click()`);
      await browser.waitFor(`document.querySelectorAll('#a-list .arow').length >= ${Math.min(n, 6)}`);
      const back = await rows();
      assert.ok(back.some((r) => r.by === 'scout' && /label\.fontWeight/.test(r.text)));
      assert.ok(back.some((r) => r.how === 'undo' && r.by === 'you'));
    });

    await t.test('click a row to select and fly to its node; Enter does the same from the keyboard', async () => {
      await q(`napkin.select(null)`);
      await q(`document.querySelector('#a-list .arow[data-by="scout"][data-node="label"]').click()`);
      await browser.waitFor(`napkin.state.selection?.node === 'label' && napkin.state.selection.component === napkin.find('Button').component`);
      await sleep(400);
      const vis = await q(`(() => { const r = document.querySelector('section.cmp[data-name="Button"] .mount [data-n="label"]').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom; })()`);
      assert.equal(vis, true, 'the node is in view');
      await q(`napkin.select(null)`);
      await q(`document.querySelector('#a-list .arow[data-by="you"][data-node="root"]').focus()`);
      await io.key('Enter');
      await browser.waitFor(`napkin.state.selection?.node === 'root'`);
      await p.shot('agents-activity');
    });
  } finally { await p.close(); }
});
