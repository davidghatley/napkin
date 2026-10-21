// AGT-04 (server and MCP side) review mode, and AGT-11 permissions (decision 0005).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { connectCanvas } from '../../src/canvas-client.js';
import { tempRepo, startServer, startMcp, waitFor } from '../helpers/harness.js';
import { sha, http, session } from '../helpers/agents.js';

const EDIT = (v) => [{ op: 'set', path: 'title.fontWeight', value: v }];

test('propose: held in memory, listed over HTTP, announced over SSE; reject leaves the file byte-identical', async () => {
  const { compDir, fileOf } = tempRepo();
  const card = fileOf('Card');
  const server = await startServer(compDir);
  const T = await session(server.url, 'david');
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  const watcher = await connectCanvas(server.url, { by: 'david' });
  const frames = []; watcher.onChange((f) => { if (f.type.startsWith('proposal')) frames.push(f); });
  try {
    const before = sha(card);
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(900), propose: true });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.proposed, true);
    const id = r.data.proposal.id;
    assert.equal(sha(card), before, 'a proposal never writes the file');
    const list = (await http(server.url, '/api/proposals')).json;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id); assert.equal(list[0].by, 'scout'); assert.equal(list[0].baseRevision, rev);
    assert.match(list[0].summary, /title\.fontWeight = 900/);
    assert.match(list[0].source, /fontWeight: 900/, 'carries the would-be source for before/after cells');
    assert.equal(list[0].doc.root.children.find((n) => n.id === 'title').style.fontWeight, 900);
    assert.equal((await http(server.url, '/api/proposals?component=Button')).json.length, 0);
    assert.equal((await http(server.url, '/api/proposals?component=Card')).json.length, 1);
    await waitFor(() => frames.find((f) => f.type === 'proposal'));
    assert.equal(frames.find((f) => f.type === 'proposal').proposal.id, id);
    assert.equal(frames.find((f) => f.type === 'proposal').component, list[0].component);

    const rej = await http(server.url, `/api/proposals/${id}/reject`, { method: 'POST', token: T, body: { by: 'david' } });
    assert.equal(rej.status, 200);
    assert.equal(sha(card), before, 'reject leaves the sha unchanged');
    assert.equal((await http(server.url, '/api/proposals')).json.length, 0);
    const done = (await waitFor(() => frames.find((f) => f.type === 'proposal-resolved'))).value;
    assert.deepEqual([done.id, done.status], [id, 'rejected']);
    assert.equal((await http(server.url, `/api/proposals/${id}/accept`, { method: 'POST', token: T, body: {} })).status, 404, 'a resolved proposal is gone');
    assert.equal((await http(server.url, '/api/components/Card/history')).json.history[0].by, 'file', 'no revision was made');
  } finally { watcher.close(); mcp.stop(); await server.stop(); }
});

test('accept lands through store.apply, attributed to the agent; the same file bytes as a direct apply', async () => {
  const { compDir, fileOf } = tempRepo();
  const server = await startServer(compDir);
  const T = await session(server.url, 'david');
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  const watcher = await connectCanvas(server.url, { by: 'david' });
  const frames = []; watcher.onChange((f) => frames.push(f));
  try {
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(900), propose: true });
    const expected = (await http(server.url, '/api/proposals')).json[0].source;
    const acc = await http(server.url, `/api/proposals/${r.data.proposal.id}/accept`, { method: 'POST', token: T, body: { by: 'david' } });
    assert.equal(acc.status, 200, JSON.stringify(acc.json));
    assert.equal(readFileSync(fileOf('Card'), 'utf8'), expected, 'what was proposed is what lands');
    const hist = (await http(server.url, '/api/components/Card/history')).json.history;
    assert.equal(hist[0].by, 'scout'); assert.equal(hist[0].revision, acc.json.revision);
    const change = (await waitFor(() => frames.find((f) => f.type === 'change' && f.revision === acc.json.revision))).value;
    assert.equal(change.by, 'scout');
    assert.equal((await waitFor(() => frames.find((f) => f.type === 'proposal-resolved'))).value.status, 'accepted');
  } finally { watcher.close(); mcp.stop(); await server.stop(); }
});

test('a stale accept is refused with the changed keys; the file keeps the other writer; the proposal can still be rejected', async () => {
  const { compDir, fileOf } = tempRepo();
  const server = await startServer(compDir);
  const T = await session(server.url, 'david');
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  const person = await connectCanvas(server.url, { by: 'david' });
  try {
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(900), propose: true });
    const c = person.state('Card');
    assert.equal((await person.sendEdits(c.component, c.revision, EDIT(300))).ok, true);
    const after = sha(fileOf('Card'));
    const acc = await http(server.url, `/api/proposals/${r.data.proposal.id}/accept`, { method: 'POST', token: T, body: {} });
    assert.equal(acc.status, 409);
    assert.match(acc.json.error, /^stale revision/);
    assert.equal(acc.json.stale[0].key, 'title.fontWeight');
    assert.equal(acc.json.stale[0].value, 300); assert.equal(acc.json.stale[0].yours, 900); assert.equal(acc.json.stale[0].by, 'david');
    assert.equal(sha(fileOf('Card')), after, 'a refused accept writes nothing');
    assert.equal((await http(server.url, '/api/proposals')).json.length, 1, 'still listed');
    assert.equal((await http(server.url, `/api/proposals/${r.data.proposal.id}/reject`, { method: 'POST', token: T, body: {} })).status, 200);
    // edits on other properties do not make a proposal stale
    const r2 = await mcp.call('apply_edits', { component: 'Card', baseRevision: (await mcp.call('read_component', { component: 'Card' })).data.revision, edits: [{ op: 'set', path: 'title.color', value: 'red' }], propose: true });
    const c2 = person.state('Card');
    await person.sendEdits(c2.component, c2.revision, [{ op: 'set', path: 'body.fontSize', value: 13 }]);
    assert.equal((await http(server.url, `/api/proposals/${r2.data.proposal.id}/accept`, { method: 'POST', token: T, body: {} })).status, 200);
  } finally { person.close(); mcp.stop(); await server.stop(); }
});

test('an invalid proposal is refused like an invalid edit and not held; dryRun wins over propose', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const T = await session(server.url, 'david');
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  try {
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const bad = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: [{ op: 'set', path: 'nope.color', value: 'red' }], propose: true });
    assert.equal(bad.isError, true); assert.match(bad.text, /invalid edit #0/);
    assert.equal((await http(server.url, '/api/proposals')).json.length, 0);
    const dry = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(900), propose: true, dryRun: true });
    assert.equal(dry.data.dryRun, true);
    assert.equal((await http(server.url, '/api/proposals')).json.length, 0);
  } finally { mcp.stop(); await server.stop(); }
});

test('AGT-11 permissions: read refuses writes, propose turns every apply into a proposal, unlisted writes', async () => {
  const { dir, compDir, fileOf } = tempRepo();
  writeFileSync(join(dir, 'napkin.json'), JSON.stringify({ agents: { looker: 'read', suggester: 'propose', builder: 'write', odd: 'banana', '*': 'write' } }));
  const card = fileOf('Card');
  const server = await startServer(compDir);
  const T = await session(server.url, 'david');
  const as = (name) => startMcp(server.url, { NAPKIN_AGENT: name });
  const [looker, suggester, builder, stranger, odd] = await Promise.all(['looker', 'suggester', 'builder', 'stranger', 'odd'].map(as));
  try {
    const rev = (await looker.call('read_component', { component: 'Card' })).data.revision;
    const before = sha(card);
    // read
    const denied = await looker.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(111) });
    assert.equal(denied.isError, true); assert.match(denied.text, /read-only/);
    assert.equal((await looker.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(111), propose: true })).isError, true, 'read cannot propose either');
    assert.equal((await looker.call('add_variant', { component: 'Button', baseRevision: 1, axis: 'size', value: 'xl' })).isError, true);
    assert.equal((await looker.call('create_component', { name: 'Nope' })).isError, true);
    assert.equal((await looker.call('rename_component', { component: 'Card', name: 'Nope' })).isError, true);
    assert.equal((await looker.call('delete_component', { component: 'Card' })).isError, true);
    const dry = await looker.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(111), dryRun: true });
    assert.equal(dry.isError, false, 'a read agent may dry-run'); assert.match(dry.data.source, /fontWeight: 111/);
    assert.equal((await looker.call('render_component', { component: 'Card' })).isError, false, 'and render');
    assert.equal(sha(card), before);
    assert.equal((await http(server.url, '/api/proposals')).json.length, 0);
    // propose
    const p = await suggester.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(222) });
    assert.equal(p.isError, false, p.text); assert.equal(p.data.proposed, true);
    assert.equal((await suggester.call('add_variant', { component: 'Button', baseRevision: 1, axis: 'size', value: 'xl' })).data.proposed, true);
    assert.equal(sha(card), before, 'propose-only agents never write');
    const held = (await http(server.url, '/api/proposals')).json;
    assert.deepEqual(held.map((x) => x.by), ['suggester', 'suggester']);
    assert.equal((await suggester.call('delete_component', { component: 'Card' })).isError, true);
    // an unknown permission word fails closed
    assert.equal((await odd.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(1) })).isError, true);
    // write and unlisted (here "*" is write; with no "*" it would be read, see identity.test.js)
    assert.equal((await builder.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(333) })).isError, false);
    const s = await stranger.call('apply_edits', { component: 'Card', baseRevision: (await stranger.call('read_component', { component: 'Card' })).data.revision, edits: [{ op: 'set', path: 'title.color', value: 'red' }] });
    assert.equal(s.isError, false, s.text);
    assert.deepEqual((await http(server.url, '/api/components/Card/history')).json.history.slice(0, 2).map((h) => h.by), ['stranger', 'builder']);
  } finally { for (const m of [looker, suggester, builder, stranger, odd]) m.stop(); await server.stop(); }
});
