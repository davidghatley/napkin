// WPC-03 (a propose agent's create_component is a proposal, no file until Accept) and WPC-09 (the agent learns how its proposals were answered).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, startMcp, waitFor } from '../helpers/harness.js';
import { http, session } from '../helpers/agents.js';

const setup = async () => {
  const r = tempRepo();
  writeFileSync(join(r.dir, 'napkin.json'), JSON.stringify({ agents: { claude: 'propose', david: 'write', '*': 'write' } }));
  const server = await startServer(r.compDir);
  const T = await session(server.url, 'david');
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'claude' });
  return { ...r, server, T, mcp, file: join(r.compDir, 'Tooltip.tsx') };
};

test('a propose agent creates a PROPOSAL: no file, listed with a ghost bundle; edits to it are refused until accepted; reject leaves no file', async () => {
  const { server, T, mcp, file } = await setup();
  try {
    const made = await mcp.call('create_component', { name: 'Tooltip' });
    assert.equal(made.isError, false, made.text);
    assert.equal(made.data.proposed, true);
    const id = made.data.proposal.id;
    assert.equal(existsSync(file), false, 'no file until Accept');
    const list = (await http(server.url, '/api/proposals')).json;
    assert.equal(list.length, 1);
    assert.equal(list[0].create.name, 'Tooltip'); assert.equal(list[0].by, 'claude'); assert.match(list[0].source, /TooltipProps/);
    assert.equal((await http(server.url, '/api/components')).json.some((c) => c.name === 'Tooltip'), false, 'not a component yet');
    const bundle = await fetch(new URL(`bundle-proposal/${id}.js`, server.url));
    assert.equal(bundle.status, 200, 'the ghost frame can be drawn');
    assert.equal(existsSync(file), false, 'drawing the ghost wrote nothing');

    const edit = await mcp.call('apply_edits', { component: 'Tooltip', baseRevision: 1, edits: [{ op: 'set', path: 'root.padding', value: 4 }], propose: true });
    assert.equal(edit.isError, true);
    assert.match(edit.text, /only proposed so far/); assert.match(edit.text, /accepts it/);
    const read = await mcp.call('read_component', { component: 'Tooltip' });
    assert.equal(read.isError, true);
    const dup = await mcp.call('create_component', { name: 'Tooltip' });
    assert.equal(dup.isError, true); assert.match(dup.text, /already proposed/);
    const taken = await mcp.call('create_component', { name: 'Button' });
    assert.equal(taken.isError, true); assert.match(taken.text, /already exists/);

    const rej = await http(server.url, `/api/proposals/${id}/reject`, { method: 'POST', token: T, body: {} });
    assert.equal(rej.status, 200);
    assert.equal(existsSync(file), false, 'reject leaves no file');
    // the agent is told (WPC-09)
    const sub = await mcp.call('subscribe', { waitMs: 3000 });
    assert.equal(sub.data.resolved.length, 1, JSON.stringify(sub.data));
    assert.deepEqual([sub.data.resolved[0].proposal, sub.data.resolved[0].outcome, sub.data.resolved[0].by, sub.data.resolved[0].final], [id, 'rejected', 'david', true]);
    assert.deepEqual(sub.data.resolved[0].rejected, ['create component Tooltip (div)']);
  } finally { mcp.stop(); await server.stop(); }
});

test('accepting writes the file through the normal commit path: by the agent, approved by the person; edits can be proposed afterwards', async () => {
  const { server, T, mcp, file } = await setup();
  try {
    const id = (await mcp.call('create_component', { name: 'Tooltip', rootTag: 'span' })).data.proposal.id;
    const acc = await http(server.url, `/api/proposals/${id}/accept`, { method: 'POST', token: T, body: {} });
    assert.equal(acc.status, 200, JSON.stringify(acc.json));
    assert.equal(existsSync(file), true);
    assert.match(readFileSync(file, 'utf8'), /TooltipProps/);
    const hist = (await http(server.url, '/api/components/Tooltip/history')).json.history;
    assert.equal(hist[hist.length - 1].by, 'claude'); assert.equal(hist[hist.length - 1].approvedBy, 'david');
    assert.equal(hist[hist.length - 1].summary, 'created Tooltip');
    const sub = await mcp.call('subscribe', { waitMs: 3000 });
    assert.deepEqual([sub.data.resolved[0].outcome, sub.data.resolved[0].by], ['accepted', 'david']);
    const rev = (await mcp.call('read_component', { component: 'Tooltip' })).data.revision;
    const p = await mcp.call('apply_edits', { component: 'Tooltip', baseRevision: rev, edits: [{ op: 'set', path: 'root.padding', value: 6 }], propose: true });
    assert.equal(p.data.proposed, true, p.text);
  } finally { mcp.stop(); await server.stop(); }
});

test('a rejected edit proposal and a partly answered one reach the agent: id, outcome, which edits, who', async () => {
  const { server, T, mcp } = await setup();
  try {
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const E = [{ op: 'set', path: 'title.fontWeight', value: 900 }, { op: 'set', path: 'title.color', value: '#f0f' }];
    const a = (await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: E, propose: true })).data.proposal.id;
    // edit 0 accepted, edit 1 rejected: two answers, then the proposal is gone
    assert.equal((await http(server.url, `/api/proposals/${a}/accept`, { method: 'POST', token: T, body: { only: [0] } })).status, 200);
    const part = (await mcp.call('subscribe', { waitMs: 3000 })).data.resolved;
    assert.equal(part.length, 1); assert.equal(part[0].final, false); assert.equal(part[0].outcome, 'partly accepted');
    assert.equal(part[0].accepted.length, 1); assert.equal(part[0].remaining.length, 1);
    assert.equal((await http(server.url, `/api/proposals/${a}/reject`, { method: 'POST', token: T, body: {} })).status, 200);
    const fin = (await mcp.call('subscribe', { waitMs: 3000 })).data.resolved;
    assert.equal(fin.length, 1);
    assert.deepEqual([fin[0].proposal, fin[0].outcome, fin[0].final, fin[0].by], [a, 'partly', true, 'david']);
    assert.equal(fin[0].accepted.length, 1); assert.equal(fin[0].rejected.length, 1);
    // a plain reject
    const rev2 = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const b = (await mcp.call('apply_edits', { component: 'Card', baseRevision: rev2, edits: [{ op: 'set', path: 'title.fontWeight', value: 100 }], propose: true })).data.proposal.id;
    await http(server.url, `/api/proposals/${b}/reject`, { method: 'POST', token: T, body: {} });
    const rj = (await mcp.call('subscribe', { waitMs: 3000 })).data.resolved;
    assert.deepEqual([rj[0].proposal, rj[0].outcome, rj[0].by], [b, 'rejected', 'david']);
    assert.match(rj[0].rejected[0], /fontWeight/);
  } finally { mcp.stop(); await server.stop(); }
});

test('the guide teaches propose create and resolved events', async () => {
  const { GUIDE } = await import('../../src/guide.js');
  assert.match(GUIDE, /Creating a component in propose mode/); assert.match(GUIDE, /no file exists until the person accepts/);
  assert.match(GUIDE, /resolved/); assert.match(GUIDE, /partly/);
});
