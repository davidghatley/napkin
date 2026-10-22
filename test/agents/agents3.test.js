// Agents round 3b: WPC-19 (subscribe never loses a resolved event to other traffic), WPC-20 (proposals and the agent's session survive a
// server restart), WPC-21 (a name clash with a pending create proposal is marked and told at once; Accept never overwrites).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, startMcp, sleep } from '../helpers/harness.js';
import { http, session, sha } from '../helpers/agents.js';

const setup = async () => {
  const r = tempRepo();
  writeFileSync(join(r.dir, 'napkin.json'), JSON.stringify({ agents: { claude: 'propose', david: 'write', '*': 'write' } }));
  const server = await startServer(r.compDir);
  const T = await session(server.url, 'david');
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'claude' });
  return { ...r, server, T, mcp };
};
const rev = async (url, c) => (await http(url, `/api/components/${c}`)).json.revision;
const edit = async (url, c, token, value) => { const { revision, doc } = (await http(url, `/api/components/${c}`)).json; return http(url, `/api/components/${c}/edits`, { method: 'POST', token, body: { baseRevision: revision, edits: [{ op: 'set', path: `${doc.root.id}.padding`, value }] } }); };

test('WPC-19: unrelated changes pending never hide or cut short a resolved event (changes and resolved come back together)', async () => {
  const { server, T, mcp } = await setup();
  try {
    const a = await mcp.call('apply_edits', { component: 'Button', baseRevision: await rev(server.url, 'Button'), edits: [{ op: 'set', path: 'root.padding', value: '11px' }], propose: true });
    assert.equal(a.data.proposed, true, a.text);
    // the person edits an unrelated component, then accepts the proposal while the agent is already waiting
    const ed = await edit(server.url, 'Card', T, '9px'); assert.equal(ed.status, 200, JSON.stringify(ed.json));
    await sleep(100);
    const waiting = mcp.call('subscribe', { waitMs: 5000 });
    await sleep(120);
    const acc = await http(server.url, `/api/proposals/${a.data.proposal.id}/accept`, { method: 'POST', token: T, body: {} });
    assert.equal(acc.status, 200, JSON.stringify(acc.json));
    const sub = await waiting;
    assert.equal(sub.data.resolved.length, 1, JSON.stringify(sub.data));
    assert.equal(sub.data.resolved[0].outcome, 'accepted');
    assert.ok(sub.data.changes.some((c) => c.component.includes('Card') || c.summary), 'the unrelated change is returned too');

    // and when the answer landed before the poll, with more unrelated traffic after it
    const b = await mcp.call('apply_edits', { component: 'Button', baseRevision: await rev(server.url, 'Button'), edits: [{ op: 'set', path: 'root.padding', value: '12px' }], propose: true });
    await http(server.url, `/api/proposals/${b.data.proposal.id}/accept`, { method: 'POST', token: T, body: {} });
    await edit(server.url, 'Card', T, '8px');
    const sub2 = await mcp.call('subscribe', { waitMs: 3000 });
    assert.deepEqual(sub2.data.resolved.map((r) => [r.proposal, r.outcome]), [[b.data.proposal.id, 'accepted']], JSON.stringify(sub2.data));
    const none = await mcp.call('subscribe', {});
    assert.deepEqual([none.data.changes.length, none.data.resolved.length], [0, 0], 'drained');
  } finally { mcp.stop(); await server.stop(); }
});

test('WPC-20: proposals survive a server restart (listed, acceptable, never in a tracked file) and the running MCP process carries on', async () => {
  const { server, T, mcp, compDir, dir, git, fileOf } = await setup();
  let s2;
  try {
    const e = await mcp.call('apply_edits', { component: 'Button', baseRevision: await rev(server.url, 'Button'), edits: [{ op: 'set', path: 'root.padding', value: '13px' }], propose: true });
    const c = await mcp.call('create_component', { name: 'Tooltip' });
    assert.equal(e.data.proposed && c.data.proposed, true);
    await sleep(50);
    const saved = join(compDir, '.napkin', 'proposals.json');
    assert.equal(existsSync(saved), true, 'saved under the private .napkin folder');
    assert.equal(readFileSync(join(compDir, '.napkin', '.gitignore'), 'utf8'), '*\n');
    assert.equal(git('status', '--porcelain', 'components').trim(), '', 'nothing under components/ is tracked or shows as untracked');

    const port = new URL(server.url).port;
    await server.stop();
    s2 = await startServer(compDir, { port: Number(port) });
    const T2 = await session(s2.url, 'david');
    const list = (await http(s2.url, '/api/proposals')).json;
    assert.deepEqual(list.map((p) => p.id).sort(), [e.data.proposal.id, c.data.proposal.id].sort());
    assert.equal((await fetch(new URL(`bundle-proposal/${c.data.proposal.id}.js`, s2.url))).status, 200, 'the ghost still draws');

    // the agent's old token is dead; its next MCP call works anyway
    const comps = await mcp.call('list_components');
    assert.equal(comps.isError, false, comps.text);
    assert.equal((await http(s2.url, `/api/proposals/${e.data.proposal.id}/accept`, { method: 'POST', token: T2, body: {} })).status, 200);
    assert.match(readFileSync(fileOf('Button'), 'utf8'), /13px/);
    assert.equal((await http(s2.url, `/api/proposals/${c.data.proposal.id}/accept`, { method: 'POST', token: T2, body: {} })).status, 200);
    assert.equal(existsSync(join(compDir, 'Tooltip.tsx')), true);
    // the agent hears how they were answered, over the new connection
    const sub = await mcp.call('subscribe', { waitMs: 4000 });
    assert.ok(sub.data.resolved.length >= 1, JSON.stringify(sub.data));
    const prop = await mcp.call('apply_edits', { component: 'Button', baseRevision: await rev(s2.url, 'Button'), edits: [{ op: 'set', path: 'root.padding', value: '3px' }], propose: true });
    assert.equal(prop.isError, false, prop.text);
    // empty after resolution
    assert.equal((await http(s2.url, '/api/proposals')).json.length, 1);
    void dir;
  } finally { mcp.stop(); await server.stop(); await s2?.stop(); }
});

test('WPC-20: a call made while the server is down is retried until it is back (no identity error reaches the agent)', async () => {
  const { server, mcp, compDir } = await setup();
  let s2;
  try {
    assert.equal((await mcp.call('list_components')).isError, false);
    const port = Number(new URL(server.url).port);
    await server.stop();
    const pending = mcp.call('list_components');
    await sleep(600);
    s2 = await startServer(compDir, { port });
    const r = await pending;
    assert.equal(r.isError, false, r.text);
  } finally { mcp.stop(); await server.stop(); await s2?.stop(); }
});

test('WPC-21: a create proposal whose name is taken meanwhile is marked at once with a reason, the agent is told, and Accept never overwrites', async () => {
  const { server, T, mcp, fileOf, compDir } = await setup();
  try {
    const made = await mcp.call('create_component', { name: 'Tooltip' });
    const id = made.data.proposal.id;
    assert.equal((await http(server.url, '/api/proposals')).json[0].clash, undefined);
    const mine = await http(server.url, '/api/components', { method: 'POST', token: T, body: { name: 'Tooltip' } });
    assert.equal(mine.status, 201, JSON.stringify(mine.json));
    const file = join(compDir, 'Tooltip.tsx');
    const before = sha(file);
    await sleep(150);
    const p = (await http(server.url, '/api/proposals')).json.find((x) => x.id === id);
    assert.match(p.clash, /Tooltip now exists/); assert.match(p.clash, /not overwrite/);
    const sub = await mcp.call('subscribe', { waitMs: 3000 });
    const blocked = sub.data.resolved.find((r) => r.proposal === id);
    assert.deepEqual([blocked.outcome, blocked.final], ['blocked', false], JSON.stringify(sub.data));
    assert.match(blocked.reason, /now exists/);
    const acc = await http(server.url, `/api/proposals/${id}/accept`, { method: 'POST', token: T, body: {} });
    assert.equal(acc.status, 409);
    assert.equal(sha(file), before, 'the person\'s component is untouched');
    // removing the clash clears the mark
    await http(server.url, '/api/components/Tooltip', { method: 'DELETE', token: T });
    void fileOf;
  } finally { mcp.stop(); await server.stop(); }
});
