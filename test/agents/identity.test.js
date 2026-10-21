// AGT-05 / AGT-11: the server decides who is calling from a bearer token, never from the request body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectCanvas } from '../../src/canvas-client.js';
import { tempRepo, startServer, startMcp, waitFor } from '../helpers/harness.js';
import { sha, http, session } from '../helpers/agents.js';

const EDIT = (v) => [{ op: 'set', path: 'title.fontWeight', value: v }];
const config = (dir, agents) => writeFileSync(join(dir, 'napkin.json'), JSON.stringify({ agents }));

test('anonymous callers fail closed on every write route; reads and dry-runs stay open', async () => {
  const { compDir, fileOf } = tempRepo();
  const server = await startServer(compDir);
  try {
    const before = [sha(fileOf('Card')), sha(fileOf('Button'))];
    const rev = (await http(server.url, '/api/components/Card')).json.revision;
    const asks = [
      ['POST', '/api/components/Card/edits', { baseRevision: rev, edits: EDIT(1) }],
      ['POST', '/api/components/Card/edits', { baseRevision: rev, edits: EDIT(1), by: 'david' }], // a claimed name is nothing
      ['POST', '/api/components/Card/edits', { baseRevision: rev, edits: EDIT(1), propose: true }],
      ['POST', '/api/components', { name: 'Nope' }],
      ['POST', '/api/components/Card/rename', { name: 'Nope' }],
      ['DELETE', '/api/components/Button'],
      ['DELETE', '/api/components/Button?by=david'],
      ['POST', '/api/proposals/prp_x/accept', {}],
    ];
    for (const [method, path, body] of asks) {
      const r = await http(server.url, path, { method, body });
      assert.equal(r.status, 401, `${method} ${path}: ${JSON.stringify(r.json)}`);
      assert.match(r.json.error, /identity required/);
    }
    assert.equal((await http(server.url, '/api/components/Card/edits', { method: 'POST', token: 'made-up', body: { baseRevision: rev, edits: EDIT(1) } })).status, 401, 'a bad token is no identity');
    assert.deepEqual([sha(fileOf('Card')), sha(fileOf('Button'))], before, 'nothing changed');
    assert.equal((await http(server.url, '/api/components/Card/edits', { method: 'POST', body: { baseRevision: rev, edits: EDIT(1), dryRun: true } })).status, 200, 'dry-run is a read');
    assert.equal((await http(server.url, '/api/components')).status, 200);
  } finally { await server.stop(); }
});

test('spoofing: a read-only agent cannot become someone else by writing a name in the body, or take a name that has a token', async () => {
  const { dir, compDir, fileOf } = tempRepo();
  config(dir, { looker: { mode: 'read', token: 'looker-secret' }, builder: { mode: 'write', token: 'builder-secret' }, '*': 'read' });
  const server = await startServer(compDir);
  try {
    const before = sha(fileOf('Card'));
    const rev = (await http(server.url, '/api/components/Card')).json.revision;
    const looker = await session(server.url, 'looker', 'looker-secret');
    for (const claim of ['builder', 'other', 'david', undefined]) {
      const r = await http(server.url, '/api/components/Card/edits', { method: 'POST', token: looker, body: { baseRevision: rev, edits: EDIT(7), by: claim } });
      assert.equal(r.status, 403, `by:${claim} -> ${JSON.stringify(r.json)}`);
    }
    assert.equal((await http(server.url, '/api/components/Button', { method: 'DELETE', token: looker })).status, 403);
    assert.equal(sha(fileOf('Card')), before);
    // taking a protected name without its token is refused
    assert.equal((await http(server.url, '/api/session', { method: 'POST', body: { as: 'builder' } })).status, 403);
    assert.equal((await http(server.url, '/api/session', { method: 'POST', body: { as: 'builder', token: 'wrong' } })).status, 403);
    assert.equal((await http(server.url, '/api/session', { method: 'POST', body: { as: '*' } })).status, 400);
    // an unlisted name gets the "*" default (here read), so minting a fresh name does not escape the restriction
    const other = await session(server.url, 'other');
    assert.equal((await http(server.url, '/api/components/Card/edits', { method: 'POST', token: other, body: { baseRevision: rev, edits: EDIT(7) } })).status, 403);
    // the configured token is itself a bearer; by comes from the token, whatever the body says
    const w = await http(server.url, '/api/components/Card/edits', { method: 'POST', token: 'builder-secret', body: { baseRevision: rev, edits: EDIT(8), by: 'looker' } });
    assert.equal(w.status, 200, JSON.stringify(w.json));
    assert.equal((await http(server.url, '/api/components/Card/history')).json.history[0].by, 'builder');
  } finally { await server.stop(); }
});

test('MCP identity: NAPKIN_TOKEN gets the configured name; the wrong or missing token for a protected name is refused', async () => {
  const { dir, compDir, fileOf } = tempRepo();
  config(dir, { scout: { mode: 'write', token: 's3cret' } });
  const server = await startServer(compDir);
  const good = await startMcp(server.url, { NAPKIN_AGENT: 'scout', NAPKIN_TOKEN: 's3cret' });
  const bad = await startMcp(server.url, { NAPKIN_AGENT: 'scout', NAPKIN_TOKEN: 'nope' });
  const none = await startMcp(server.url, { NAPKIN_AGENT: 'scout', NAPKIN_NO_FALLBACK: '1' });
  try {
    const rev = (await good.call('read_component', { component: 'Card' })).data.revision;
    assert.equal((await good.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(555) })).isError, false);
    assert.equal((await http(server.url, '/api/components/Card/history')).json.history[0].by, 'scout');
    const before = sha(fileOf('Card'));
    for (const m of [bad, none]) {
      const r = await m.call('apply_edits', { component: 'Card', baseRevision: rev + 1, edits: EDIT(1) });
      assert.equal(r.isError, true); assert.match(r.text, /token|session|refused/i);
    }
    assert.equal(sha(fileOf('Card')), before);
  } finally { good.stop(); bad.stop(); none.stop(); await server.stop(); }
});

test('create, rename and delete are attributed: history, SSE frames and the activity log carry by and a summary', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  const watcher = await connectCanvas(server.url, { by: 'you' });
  const frames = []; watcher.onChange((f) => frames.push(f));
  try {
    assert.equal((await mcp.call('create_component', { name: 'Badge' })).isError, false);
    const added = (await waitFor(() => frames.find((f) => f.type === 'added' && f.name === 'Badge'))).value;
    assert.equal(added.by, 'scout'); assert.equal(added.summary, 'created Badge');
    const h1 = (await http(server.url, '/api/components/Badge/history')).json.history;
    assert.deepEqual([h1[0].by, h1[0].summary], ['scout', 'created Badge']);
    // the person edits it (identity "you"), then the agent renames it: the revision continues
    const b = watcher.state('Badge');
    const you = await watcher.sendEdits(b.component, b.revision, [{ op: 'set', path: 'root.color', value: 'red' }]);
    assert.equal(you.ok, true);
    assert.equal((await mcp.call('rename_component', { component: 'Badge', name: 'Chip' })).isError, false);
    const renamed = (await waitFor(() => frames.find((f) => f.type === 'added' && f.name === 'Chip'))).value;
    assert.deepEqual([renamed.by, renamed.summary], ['scout', 'renamed Badge to Chip']);
    const h2 = (await http(server.url, '/api/components/Chip/history')).json.history;
    assert.deepEqual([h2[0].by, h2[0].summary, h2[0].revision], ['scout', 'renamed Badge to Chip', you.revision + 1]);
    assert.equal((await mcp.call('delete_component', { component: 'Chip' })).isError, false);
    const removed = (await waitFor(() => frames.find((f) => f.type === 'removed' && f.summary === 'deleted Chip'))).value;
    assert.equal(removed.by, 'scout');
    const act = (await http(server.url, '/api/activity')).json.activity;
    assert.deepEqual(act.slice(0, 4).map((a) => `${a.by}: ${a.summary}`), ['scout: deleted Chip', 'scout: renamed Badge to Chip', 'scout: renamed Badge to Chip', 'you: root.color = "red"']);
    assert.ok(act.every((a) => a.by && a.summary));
    // the canvas client's default identity is "you", not "canvas"
    assert.equal((await http(server.url, '/api/components/Card/history')).json.history.every((x) => x.by !== 'canvas' && x.by !== 'unknown'), true);
  } finally { watcher.close(); mcp.stop(); await server.stop(); }
});

test('propose-only agents cannot accept or reject proposals; the person can', async () => {
  const { dir, compDir, fileOf } = tempRepo();
  config(dir, { suggester: 'propose' });
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'suggester' });
  try {
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const p = (await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT(900) })).data.proposal;
    const mine = await session(server.url, 'suggester');
    const before = sha(fileOf('Card'));
    assert.equal((await http(server.url, `/api/proposals/${p.id}/accept`, { method: 'POST', token: mine, body: {} })).status, 403, 'it cannot approve itself');
    assert.equal(sha(fileOf('Card')), before);
    assert.equal((await http(server.url, `/api/proposals/${p.id}/accept`, { method: 'POST', token: await session(server.url, 'you'), body: {} })).status, 200);
  } finally { mcp.stop(); await server.stop(); }
});
