// Lead's round: a folder napkin merely opened keeps no trace of pending proposals (they live in napkin's state dir); leftovers of an
// interrupted private write are swept on start; a fresh MCP process hears answers given while none ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempRepo, startServer, startMcp, sleep } from '../helpers/harness.js';
import { hashes } from '../helpers/open.js';
import { http, session } from '../helpers/agents.js';

// while a server runs it holds its own lock in .napkin (existing behaviour, gone when it stops); nothing else may differ
const running = (dir) => Object.fromEntries(Object.entries(hashes(dir)).filter(([k]) => k !== '.napkin/lock' && k !== '.napkin/.gitignore'));
const state = () => mkdtempSync(join(tmpdir(), 'napkin-state-'));
const rev = async (url, c) => (await http(url, `/api/components/${c}`)).json.revision;
const pad = (url, v) => rev(url, 'Button').then((baseRevision) => ({ component: 'Button', baseRevision, edits: [{ op: 'set', path: 'root.padding', value: v }], propose: true }));

test('an opened folder (no napkin.json): a pending proposal leaves the folder byte-unchanged, even across a restart; it lives in the state dir', async () => {
  const { compDir } = tempRepo();
  const env = { NAPKIN_STATE_DIR: state() };
  const before = hashes(compDir);
  const s = await startServer(compDir, { env });
  let s2, mcp;
  try {
    assert.deepEqual(running(compDir), before, 'plain open writes nothing');
    mcp = await startMcp(s.url, { NAPKIN_AGENT: 'claude' });
    const a = await mcp.call('apply_edits', await pad(s.url, '13px'));
    const c = await mcp.call('create_component', { name: 'Tooltip', propose: true });
    assert.equal(a.data.proposed && c.data.proposed, true, a.text + c.text);
    await sleep(100);
    assert.deepEqual(running(compDir), before, 'with pending proposals the folder is still byte-unchanged');
    assert.equal(existsSync(join(compDir, '.napkin', 'proposals.json')), false);
    const dirs = readdirSync(env.NAPKIN_STATE_DIR);
    assert.equal(dirs.length, 1); assert.equal(existsSync(join(env.NAPKIN_STATE_DIR, dirs[0], 'proposals.json')), true);
    const port = Number(new URL(s.url).port);
    await s.stop();
    s2 = await startServer(compDir, { env, port });
    assert.equal((await http(s2.url, '/api/proposals')).json.length, 2, 'survives a restart');
    assert.deepEqual(running(compDir), before, 'still unchanged');
  } finally { mcp?.stop(); await s.stop(); await s2?.stop(); }
  assert.deepEqual(running(compDir), before, 'and after the server is gone (the lock folder is the existing lock behaviour, not proposals)');
});

test('leftover temp files of napkin\'s private writes are swept on start (project and state dir)', async () => {
  const r = tempRepo();
  writeFileSync(join(r.dir, 'napkin.json'), '{}');
  mkdirSync(join(r.compDir, '.napkin'));
  const tmp = join(r.compDir, '.napkin', '.proposals.json.tmp-999-1');
  writeFileSync(tmp, '{"half');
  const s = await startServer(r.compDir, { env: { NAPKIN_STATE_DIR: state() } });
  try { assert.equal(existsSync(tmp), false); } finally { await s.stop(); }
  // an opened folder: the same sweep in its state folder
  const r2 = tempRepo(), env = { NAPKIN_STATE_DIR: state() };
  const s2 = await startServer(r2.compDir, { env });
  const mcp = await startMcp(s2.url, { NAPKIN_AGENT: 'claude' });
  try {
    await mcp.call('create_component', { name: 'Tooltip', propose: true }); await sleep(100);
    const folder = join(env.NAPKIN_STATE_DIR, readdirSync(env.NAPKIN_STATE_DIR)[0]);
    const tmp2 = join(folder, '.proposals.json.tmp-999-2'); writeFileSync(tmp2, 'x');
    mcp.stop(); await s2.stop();
    const s3 = await startServer(r2.compDir, { env });
    try { assert.equal(existsSync(tmp2), false); assert.equal((await http(s3.url, '/api/proposals')).json.length, 1); } finally { await s3.stop(); }
  } finally { mcp.stop(); await s2.stop(); }
});

test('a fresh MCP process hears answers given while no MCP process ran, once', async () => {
  const r = tempRepo();
  writeFileSync(join(r.dir, 'napkin.json'), JSON.stringify({ agents: { claude: 'propose', david: 'write', '*': 'write' } }));
  const s = await startServer(r.compDir);
  const T = await session(s.url, 'david');
  let m1, m2, m3;
  try {
    m1 = await startMcp(s.url, { NAPKIN_AGENT: 'claude' });
    const a = await m1.call('apply_edits', await pad(s.url, '14px'));
    const b = await m1.call('create_component', { name: 'Tooltip' });
    m1.stop(); await sleep(300); // no MCP process for claude now
    await http(s.url, `/api/proposals/${a.data.proposal.id}/accept`, { method: 'POST', token: T, body: {} });
    await http(s.url, `/api/proposals/${b.data.proposal.id}/reject`, { method: 'POST', token: T, body: {} });
    m2 = await startMcp(s.url, { NAPKIN_AGENT: 'claude' });
    const sub = await m2.call('subscribe', {});
    assert.deepEqual(sub.data.resolved.map((x) => [x.proposal, x.outcome]).sort(), [[a.data.proposal.id, 'accepted'], [b.data.proposal.id, 'rejected']].sort(), JSON.stringify(sub.data));
    await sleep(200); // the acknowledgement reaches the server
    m3 = await startMcp(s.url, { NAPKIN_AGENT: 'claude' });
    assert.deepEqual((await m3.call('subscribe', {})).data.resolved, [], 'not heard twice');
  } finally { m1?.stop(); m2?.stop(); m3?.stop(); await s.stop(); }
});
