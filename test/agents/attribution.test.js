// AGT-05 attribution, AGT-06 stale recovery, AGT-09 activity feed data, AGT-10 clash payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../src/store.js';
import { connectCanvas } from '../../src/canvas-client.js';
import { tempRepo, startServer, startMcp, waitFor, fixture } from '../helpers/harness.js';
import { http, evidence, session } from '../helpers/agents.js';

test('AGT-05: every revision is attributed (david, agent names, file) and the history endpoint lists them', async () => {
  const { compDir, fileOf } = tempRepo();
  const server = await startServer(compDir);
  const T = await session(server.url, 'david');
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  const david = await connectCanvas(server.url, { by: 'david' });
  try {
    const set = (path, value) => [{ op: 'set', path, value }];
    const c = david.state('Card');
    let rev = (await david.sendEdits(c.component, c.revision, set('title.fontWeight', 500))).revision;
    const a = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: set('title.color', 'red') });
    rev = a.data.revision;
    // an HTTP client gets a name from its session; an anonymous one is refused (no "unknown" revisions)
    assert.equal((await http(server.url, '/api/components/Card/edits', { method: 'POST', body: { baseRevision: rev, by: 'david', edits: set('body.fontSize', 14) } })).status, 401);
    const api = await session(server.url, 'api-client');
    assert.equal((await http(server.url, '/api/components/Card/edits', { method: 'POST', token: api, body: { baseRevision: rev, by: 'someone-else', edits: set('body.fontSize', 14) } })).status, 200);
    // a hand edit (external write) is "file"
    writeFileSync(fileOf('Card'), readFileSync(fileOf('Card'), 'utf8').replace('fontSize: 14', 'fontSize: 15'));
    await waitFor(async () => (await http(server.url, '/api/components/Card/history')).json.history.length >= 5, 4000);
    const h = (await http(server.url, '/api/components/Card/history')).json.history;
    assert.deepEqual(h.map((x) => x.by), ['file', 'api-client', 'scout', 'david', 'file']);
    assert.ok(h.every((x) => typeof x.by === 'string' && x.by && x.summary && x.at > 0 && Array.isArray(x.keys)), 'every revision has by, summary, time and keys');
    assert.match(h[3].summary, /title\.fontWeight = 500/);
    assert.deepEqual(h.map((x) => x.revision), [5, 4, 3, 2, 1]);
    assert.equal((await http(server.url, '/api/components/Card/history?limit=2')).json.history.length, 2);
    assert.equal((await http(server.url, '/api/components/Nope/history')).status, 404);
    // rejected and dry-run attempts make no revision
    await mcp.call('apply_edits', { component: 'Card', baseRevision: 1, edits: set('title.fontWeight', 1) });
    await mcp.call('apply_edits', { component: 'Card', baseRevision: h[0].revision, edits: set('title.fontWeight', 1), dryRun: true });
    assert.equal((await http(server.url, '/api/components/Card/history')).json.history.length, 5);
  } finally { david.close(); mcp.stop(); await server.stop(); }
});

test('AGT-05 in the store: no revision is ever unattributed, whatever the caller passes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-attr-'));
  copyFileSync(fixture('Card'), join(dir, 'Card.tsx'));
  const store = await openStore(join(dir, 'Card.tsx'));
  try {
    let rev = (await store.read()).revision;
    for (const by of [undefined, '', null, 'david', 'agent-7']) {
      const r = await store.apply({ baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 100 + rev }], by });
      assert.equal(r.ok, true); rev = r.revision;
    }
    const hist = store.history(100);
    assert.equal(hist.length, 6);
    assert.ok(hist.every((h) => h.by), JSON.stringify(hist.map((h) => h.by)));
  } finally { await store.close(); }
});

test('AGT-09: every apply reaches SSE listeners within 200 ms with by, component and summary', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const T = await session(server.url, 'david'), S = await session(server.url, 'scout');
  const watcher = await connectCanvas(server.url, { by: 'david' });
  const frames = []; watcher.onChange((f) => { if (f.type === 'change') frames.push({ ...f, seen: performance.now() }); });
  try {
    const lags = [];
    let rev = watcher.state('Card').revision;
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await http(server.url, '/api/components/Card/edits', { method: 'POST', token: i % 2 ? S : T, body: { baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 100 + i }] } });
      assert.equal(r.status, 200); rev = r.json.revision;
      const f = (await waitFor(() => frames.find((x) => x.revision === rev), 1000, 2)).value;
      lags.push(f.seen - t0);
      assert.equal(f.by, i % 2 ? 'scout' : 'david'); assert.equal(f.component, watcher.state('Card').component);
      assert.equal(f.summary, `title.fontWeight = ${100 + i}`);
    }
    assert.ok(Math.max(...lags) < 200, `max lag ${Math.max(...lags).toFixed(0)} ms`);
  } finally { watcher.close(); await server.stop(); }
});

test('AGT-10: a same-property clash error carries both values (theirs that landed, yours that did not), who, and the revision', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-clash-'));
  copyFileSync(fixture('Button'), join(dir, 'Button.tsx'));
  const store = await openStore(join(dir, 'Button.tsx'));
  try {
    const rev = (await store.read()).revision;
    const variant = { size: 'sm' };
    assert.equal((await store.apply({ baseRevision: rev, by: 'david', edits: [{ op: 'set', path: 'root.padding', value: '1px', variant }] })).ok, true);
    const r = await store.apply({ baseRevision: rev, by: 'scout', edits: [{ op: 'set', path: 'root.padding', value: '2px', variant }, { op: 'set', path: 'label.fontWeight', value: 700 }] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.stale, [{ key: 'root.padding@size=sm', value: '1px', yours: '2px', revision: rev + 1, by: 'david' }]);
    assert.equal(r.currentRevision, rev + 1);
    // base-style clash and a removed value (null)
    const r2 = await store.apply({ baseRevision: rev + 1, by: 'david', edits: [{ op: 'set', path: 'root.gap', value: null }] });
    const r3 = await store.apply({ baseRevision: rev + 1, by: 'scout', edits: [{ op: 'set', path: 'root.gap', value: 99 }] });
    assert.deepEqual(r3.stale.map(({ key, value, yours, by }) => ({ key, value, yours, by })), [{ key: 'root.gap', value: null, yours: 99, by: 'david' }]);
    // a deleted node: the clash says it is gone
    await store.apply({ baseRevision: r2.revision, by: 'david', edits: [{ op: 'delete', id: 'label' }] });
    const r4 = await store.apply({ baseRevision: r2.revision, by: 'scout', edits: [{ op: 'set', path: 'label.fontWeight', value: 100 }] });
    assert.equal(r4.ok, false); assert.equal(r4.stale[0].by, 'david');
    // an unknown base revision still answers with the current one
    const r5 = await store.apply({ baseRevision: 9999, by: 'scout', edits: [{ op: 'set', path: 'root.gap', value: 1 }] });
    assert.match(r5.error, /^stale revision/); assert.equal(typeof r5.currentRevision, 'number');
    // ...and it is not empty: every key of yours that changed since the oldest kept revision is listed, with who and the current value
    assert.equal(r5.stale[0].key, 'root.gap'); assert.ok(r5.stale[0].by && r5.stale[0].revision > 1);
    assert.equal(r5.oldestRevision, 1); assert.ok(r5.changedKeys.includes('root.gap') && r5.changedKeys.includes('root.padding@size=sm'));
    // an unknown base on a key nobody touched: stale is empty but changedKeys still says what moved
    const r6 = await store.apply({ baseRevision: 'nope', by: 'scout', edits: [{ op: 'set', path: 'root.display', value: 'grid' }] });
    assert.deepEqual(r6.stale, []); assert.ok(r6.changedKeys.length > 0);
  } finally { await store.close(); }
});

test('AGT-06: 100 races, each recovered with exactly one retry built from the stale error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-race-'));
  copyFileSync(fixture('Card'), join(dir, 'Card.tsx'));
  const store = await openStore(join(dir, 'Card.tsx'));
  const keys = ['title.fontWeight', 'title.fontSize', 'title.color', 'body.fontSize', 'image.height', 'card.padding'];
  const scripted = async (i) => {
    const key = keys[i % keys.length];
    const mine = [{ op: 'set', path: key, value: `agent-${i}` }];
    const base = (await store.read()).revision;                                  // the agent reads
    const theirs = await store.apply({ baseRevision: base, by: 'david', edits: [{ op: 'set', path: key, value: `human-${i}` }] }); // someone changes the same key meanwhile
    assert.equal(theirs.ok, true);
    const first = await store.apply({ baseRevision: base, by: 'scout', edits: mine });   // the agent's attempt: stale
    assert.equal(first.ok, false, 'attempt 1 must be stale');
    assert.ok(first.stale.length === 1 && first.stale[0].key === key && first.stale[0].value === `human-${i}`, 'error names the key and the current value');
    const retry = await store.apply({ baseRevision: first.currentRevision, by: 'scout', edits: mine }); // one retry, from the error alone
    return retry.ok;
  };
  try {
    let recovered = 0;
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) if (await scripted(i)) recovered++;
    // The same loop over HTTP and MCP for a few races, and a concurrent one: two agents racing the same key.
    const { compDir } = tempRepo();
    const server = await startServer(compDir);
  const T = await session(server.url, 'david');
    const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
    let overMcp = 0;
    try {
      for (let i = 0; i < 10; i++) {
        const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
        const c = (await http(server.url, '/api/components/Card')).json;
        await http(server.url, '/api/components/Card/edits', { method: 'POST', token: T, body: { baseRevision: c.revision, by: 'david', edits: [{ op: 'set', path: 'title.fontWeight', value: 200 + i }] } });
        const a = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 700 }] });
        assert.equal(a.isError, true);
        const b = await mcp.call('apply_edits', { component: 'Card', baseRevision: a.data.currentRevision, edits: [{ op: 'set', path: 'title.fontWeight', value: 700 }] });
        if (!b.isError) overMcp++;
      }
    } finally { mcp.stop(); await server.stop(); }
    assert.equal(recovered, 100);
    assert.equal(overMcp, 10);
    evidence('AGT-06', [
      'AGT-06 stale errors let a scripted agent recover in one retry (generated by: EVIDENCE=1 node --test test/agents/attribution.test.js)',
      'race: the agent reads revision R; someone else sets the same key (6 different keys, rotating); the agent applies on R and gets { ok:false, error:"stale revision ...", stale:[{key,value,yours,revision,by}], currentRevision };',
      'the agent retries once with baseRevision = currentRevision (edits unchanged).',
      `store level: ${recovered}/100 recovered with exactly 1 retry (${(performance.now() - t0).toFixed(0)} ms total); every first attempt was stale and named the key and the other writer's current value.`,
      `over HTTP + MCP (real server, stdio client): ${overMcp}/10 recovered with 1 retry.`,
      'bar: 100/100',
    ].join('\n'));
  } finally { await store.close(); }
});
