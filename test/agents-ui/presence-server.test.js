// AGT-03 (server side): presence frames carry the agent, a stable colour, the node and variant; two agents get two colours;
// presence clears <= 1 s after the last edit and at once on disconnect. AGT-04: partial accept/reject by edit number, ghost bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectCanvas } from '../../src/canvas-client.js';
import { tempRepo, startServer, startMcp, waitFor, sleep } from '../helpers/harness.js';
import { sha, http, session } from '../helpers/agents.js';

const PAD = (v) => [{ op: 'set', path: 'root.padding', value: v }];

test('presence frames: agent, colour, node; two agents differ; clears within a second', async () => {
  const { compDir } = tempRepo(['Button', 'Card']);
  const server = await startServer(compDir);
  const watcher = await connectCanvas(server.url, { by: 'you' });
  const frames = []; watcher.onChange((f) => { if (f.type === 'presence' || f.type === 'agents') frames.push({ ...f, t: performance.now() }); });
  const scout = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  const claude = await startMcp(server.url, { NAPKIN_AGENT: 'claude' });
  try {
    await waitFor(() => frames.find((f) => f.type === 'agents' && f.agents.length === 2));
    const roster = frames.filter((f) => f.type === 'agents').at(-1);
    assert.deepEqual(roster.agents.map((a) => a.name).sort(), ['claude', 'scout']);
    assert.notEqual(roster.agents[0].color, roster.agents[1].color, 'two agents, two colours');
    assert.match(roster.agents[0].color, /^#[0-9a-f]{6}$/);

    const rb = (await scout.call('read_component', { component: 'Button' })).data.revision;
    const rc = (await claude.call('read_component', { component: 'Card' })).data.revision;
    await Promise.all([
      scout.call('apply_edits', { component: 'Button', baseRevision: rb, edits: PAD('21px') }),
      claude.call('apply_edits', { component: 'Card', baseRevision: rc, edits: [{ op: 'set', path: 'title.fontWeight', value: 800 }] }),
    ]);
    const on = (n) => frames.find((f) => f.type === 'presence' && f.agent === n && f.label);
    await waitFor(() => on('scout') && on('claude'));
    const s = on('scout'), c = on('claude');
    assert.equal(s.node, 'root'); assert.equal(c.node, 'title');
    assert.notEqual(s.component, c.component);
    assert.equal(s.color, roster.agents.find((a) => a.name === 'scout').color, 'the same colour in the roster and in presence');
    assert.match(s.label, /scout/);

    // cleared <= 1 s after the last edit landed
    const done = performance.now();
    const off = (await waitFor(() => frames.find((f) => f.type === 'presence' && f.agent === 'scout' && f.label === null && f.t > done - 400), 3000)).value;
    assert.ok(off.t - done < 1000, `cleared ${(off.t - done).toFixed(0)} ms after the last edit`);

    // an agent that disconnects mid-presence clears at once
    await scout.call('apply_edits', { component: 'Button', baseRevision: (await scout.call('read_component', { component: 'Button' })).data.revision, edits: PAD('22px') });
    await waitFor(() => frames.filter((f) => f.type === 'presence' && f.agent === 'scout' && f.label).length >= 2);
    const t0 = performance.now(); scout.stop();
    const gone = (await waitFor(() => frames.find((f) => f.type === 'presence' && f.agent === 'scout' && f.label === null && f.t > t0), 3000)).value;
    assert.ok(gone.t - t0 < 400, `cleared ${(gone.t - t0).toFixed(0)} ms after disconnect`);
    await waitFor(() => frames.filter((f) => f.type === 'agents').at(-1).agents.length === 1);
  } finally { watcher.close(); claude.stop(); scout.stop(); await server.stop(); }
});

test('a colour is stable for a name across reconnects; presence needs an identity', async () => {
  const { compDir } = tempRepo(['Button']);
  const server = await startServer(compDir);
  try {
    const colorOf = async (name) => {
      const w = await connectCanvas(server.url, { by: 'agent', identify: false, name });
      let roster; w.onChange((f) => { if (f.type === 'agents') roster = f; });
      await waitFor(() => roster, 2000).catch(() => {});
      const mine = (roster ?? { agents: [] }).agents.find((a) => a.name === name);
      w.close(); await sleep(150);
      return mine?.color;
    };
    const a = await colorOf('scout'), b = await colorOf('scout');
    assert.ok(a, 'got a colour'); assert.equal(a, b);
    const r = await http(server.url, '/api/presence', { method: 'POST', body: { component: 'Button', label: 'x' } });
    assert.equal(r.status, 401);
  } finally { await server.stop(); }
});

test('AGT-04: accept or reject some edits of a proposal; the rest stays proposed; the ghost bundle is served', async () => {
  const { compDir, fileOf } = tempRepo(['Button']);
  const server = await startServer(compDir);
  const you = await session(server.url, 'you');
  const scout = await session(server.url, 'scout');
  try {
    const file = fileOf('Button'), before = sha(file);
    const rev = (await http(server.url, '/api/components/Button')).json.revision;
    const edits = [{ op: 'set', path: 'root.padding', value: '40px' }, { op: 'set', path: 'label.fontWeight', value: 900 }, { op: 'set', path: 'root.borderRadius', value: 2 }];
    const pr = await http(server.url, '/api/components/Button/edits', { method: 'POST', token: scout, body: { baseRevision: rev, edits, propose: true } });
    const id = pr.json.proposal.id;
    const [p] = (await http(server.url, '/api/proposals')).json;
    assert.equal(p.lines.length, 3); assert.match(p.lines[1], /label\.fontWeight = 900/);
    const bundle = await fetch(new URL(`bundle-proposal/${id}.js`, server.url));
    assert.equal(bundle.status, 200); assert.match(await bundle.text(), /40px/);
    assert.equal(sha(file), before, 'drawing the ghost writes nothing');

    // reject edit 1 only: file untouched, two edits remain
    let r = await http(server.url, `/api/proposals/${id}/reject`, { method: 'POST', token: you, body: { only: [1] } });
    assert.equal(r.json.remaining, 2); assert.equal(sha(file), before);
    let left = (await http(server.url, '/api/proposals')).json[0];
    assert.deepEqual(left.edits.map((e) => e.path), ['root.padding', 'root.borderRadius']);
    // accept edit 0 only: lands as scout, approved by you; edit 1 of the rest stays
    r = await http(server.url, `/api/proposals/${id}/accept`, { method: 'POST', token: you, body: { only: [0] } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.remaining, 1);
    const after = (await import('node:fs')).readFileSync(file, 'utf8');
    assert.match(after, /padding: '40px'/); assert.doesNotMatch(after, /fontWeight: 900/); assert.doesNotMatch(after, /borderRadius: 2\b/);
    const top = (await http(server.url, '/api/components/Button/history')).json.history[0];
    assert.equal(top.by, 'scout'); assert.equal(top.approvedBy, 'you');
    left = (await http(server.url, '/api/proposals')).json[0];
    assert.equal(left.edits.length, 1); assert.equal(left.baseRevision, r.json.revision);
    // bad indexes
    assert.equal((await http(server.url, `/api/proposals/${id}/accept`, { method: 'POST', token: you, body: { only: [5] } })).status, 400);
    // the last edit, whole
    r = await http(server.url, `/api/proposals/${id}/reject`, { method: 'POST', token: you, body: {} });
    assert.equal(r.json.status, 'rejected');
    assert.equal((await http(server.url, '/api/proposals')).json.length, 0);
  } finally { await server.stop(); }
});

test('presence: an apply ends presence <= 1 s whatever ttl was declared; no ttl lasts over 3 s', async () => {
  const { compDir } = tempRepo(['Button']);
  const server = await startServer(compDir);
  const watcher = await connectCanvas(server.url, { by: 'you' });
  const frames = []; watcher.onChange((f) => { if (f.type === 'presence') frames.push({ ...f, t: performance.now() }); });
  try {
    const tok = await session(server.url, 'scout');
    const say = (ttl) => http(server.url, '/api/presence', { method: 'POST', token: tok, body: { component: 'Button', node: 'root', label: 'scout: editing', ttl } });
    await say(4000);
    await waitFor(() => frames.find((f) => f.label));
    const rev = (await http(server.url, '/api/components/Button')).json.revision;
    const r = await http(server.url, '/api/components/Button/edits', { method: 'POST', token: tok, body: { baseRevision: rev, edits: PAD('13px') } });
    assert.equal(r.status, 200);
    const done = performance.now();
    const off = (await waitFor(() => frames.find((f) => f.label === null && f.t > done - 50), 3000)).value;
    assert.ok(off.t - done < 1000, `cleared ${(off.t - done).toFixed(0)} ms after the apply (declared ttl 4000)`);
    // no apply: a 10 s ttl is capped at 3 s
    frames.length = 0;
    const t0 = performance.now();
    await say(10000);
    const gone = (await waitFor(() => frames.find((f) => f.label === null), 5000)).value;
    const ms = gone.t - t0;
    assert.ok(ms >= 2700 && ms <= 3600, `ttl 10000 lasted ${ms.toFixed(0)} ms`);
  } finally { watcher.close(); await server.stop(); }
});

test('the ghost bundle can show one edit only', async () => {
  const { compDir } = tempRepo(['Button']);
  const server = await startServer(compDir);
  try {
    const tok = await session(server.url, 'scout');
    const rev = (await http(server.url, '/api/components/Button')).json.revision;
    const pr = await http(server.url, '/api/components/Button/edits', { method: 'POST', token: tok, body: { baseRevision: rev, propose: true, edits: [{ op: 'set', path: 'root.padding', value: '41px' }, { op: 'set', path: 'root.borderRadius', value: 17 }] } });
    const id = pr.json.proposal.id;
    const get = async (q) => { const r = await fetch(new URL(`bundle-proposal/${id}.js${q}`, server.url)); return { status: r.status, text: await r.text() }; };
    const one = await get('?only=1');
    assert.equal(one.status, 200); assert.match(one.text, /17/); assert.doesNotMatch(one.text, /41px/);
    assert.equal((await get('?only=7')).status, 400);
  } finally { await server.stop(); }
});
