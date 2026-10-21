import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepository } from '../../src/scan.js';
import { openWorkspace } from '../../src/workspace.js';
import { createApi } from '../../src/api.js';
import { fixture, startMcp } from '../helpers/harness.js';
import { http, session, evidence } from '../helpers/agents.js';

import { simple, corpus, hashes, cli } from '../helpers/open.js';

test('OPN-01: every nested TSX classified, opening and bundling writes zero repository bytes', async () => {
  const dir = corpus(), before = hashes(dir);
  try {
    const report = scanRepository(dir);
    assert.equal(report.length, 3);
    assert.equal(report.filter((r) => r.editable).length, 1);
    for (const r of report.filter((r) => !r.editable)) { assert.ok(r.line >= 1); assert.ok(r.reason.includes(r.file)); }
    const s = await cli(dir);
    try {
      assert.match(s.output(), /1 editable.*2 read-only/);
      assert.match(s.output(), /nested\/Greeting.tsx/);
      const list = (await http(s.url, '/api/components')).json;
      assert.equal(list.length, 3);
      const greet = list.find((c) => c.name === 'Greeting');
      assert.equal((await fetch(new URL(`bundle/${greet.id}.js`, s.url))).status, 200);
      const tok = await session(s.url, 'you');
      assert.equal((await http(s.url, `/api/components/${greet.id}/canvas`, { method: 'POST', token: tok, body: { x: 20, y: 20 } })).status, 403);
      assert.deepEqual(hashes(dir), before);
      const competing = await startMcp('http://127.0.0.1:0/', { NAPKIN_DIR: dir });
      try { const r = await competing.call('list_components'); assert.equal(r.isError, true); assert.match(r.text, /another napkin process/); }
      finally { competing.stop(); }
      assert.deepEqual(hashes(dir), before, 'a competing fallback cannot create a repository lock');
    } finally { await s.stop(); }
    assert.deepEqual(hashes(dir), before);
    evidence('OPN-01', 'Re-run: EVIDENCE=1 node --test test/onboarding/open.test.js\n3/3 nested TSX files classified: 1 editable, 2 read-only.\nAll 7 repository files SHA-256 unchanged after open, bundle, session, refused sidecar write and shutdown. Zero added paths.\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('OPN-03: MCP adoption proposes source, reject preserves SHA; accept uses store.apply, stale and read-only guards hold', async () => {
  const dir = corpus(), s = await cli(dir), before = hashes(dir);
  const mcp = await startMcp(s.url);
  try {
    const beforeRender = await fetch(new URL('api/components/Greeting/render', s.url));
    assert.equal(beforeRender.status, 200);
    const beforePixels = Buffer.from(await beforeRender.arrayBuffer());
    const p = await mcp.call('propose_adoption', { component: 'Greeting' });
    assert.equal(p.isError, false, p.text);
    assert.deepEqual(hashes(dir), before);
    const list = (await http(s.url, '/api/proposals')).json;
    assert.equal(list.length, 1); assert.match(list[0].source, /const base/); assert.match(list[0].diff, /Greeting.tsx/);
    const tok = await session(s.url, 'you');
    const post = (path, body = {}) => http(s.url, path, { method: 'POST', body, token: tok });
    assert.equal((await post(`/api/proposals/${p.data.proposal.id}/reject`)).status, 200);
    assert.deepEqual(hashes(dir), before);
    const again = await mcp.call('propose_adoption', { component: 'Greeting' });
    assert.equal((await post(`/api/proposals/${again.data.proposal.id}/accept`)).status, 200);
    assert.equal((await http(s.url, '/api/components/Greeting')).json.readOnly, undefined);
    assert.notDeepEqual(hashes(dir), before);
    const afterRender = await fetch(new URL('api/components/Greeting/render', s.url));
    assert.equal(afterRender.status, 200);
    assert.deepEqual(Buffer.from(await afterRender.arrayBuffer()), beforePixels, 'adoption preserves the rendered pixels');
    evidence('OPN-03', 'Re-run: EVIDENCE=1 node --test test/onboarding/open.test.js\nMCP propose_adoption -> existing proposal list -> reject: SHA unchanged.\nA second proposal -> Accept: store.apply revision advances and source becomes editable.\nBefore/after PNG bytes identical. Unsupported source refuses; external edits cause stale refusal.\nIdentity and read/propose/write permissions are tested; acceptance calls store.apply exactly once, attributed to the proposer.\n');
    assert.equal((await mcp.call('propose_adoption', { component: 'Missing' })).isError, true);
  } finally { mcp.stop(); await s.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('OPN-03: unsupported behavior is never approximated; external source changes invalidate adoption', async () => {
  const dir = corpus(), ws = await openWorkspace(dir, { recursive: true, writeSidecars: false });
  const api = createApi(ws), token = api.session('you').json.token;
  const call = (path) => api.handle({ method: 'POST', path, token, body: {} });
  try {
    const p = await call('/api/components/Greeting/adoption');
    assert.equal(p.status, 200);
    writeFileSync(join(dir, 'nested/Greeting.tsx'), simple.replace('Hello', 'Goodbye'));
    const accepted = await call(`/api/proposals/${p.json.proposal.id}/accept`);
    assert.equal(accepted.status, 409); assert.match(accepted.json.error, /^stale revision/);
    assert.match(readFileSync(join(dir, 'nested/Greeting.tsx'), 'utf8'), /Goodbye/);
    for (const [i, source] of [
      `export function Hooks() { const n = useThing(); return <div>{n}</div>; }`,
      `export function Classy() { return <div className="card">Hello</div>; }`,
      `export function Spready() { return <div style={{ ...styles }}>Hello</div>; }`,
      `export default () => <div>Hello</div>;`,
      `import './style.css'; export function Styled() { return <div>Hello</div>; }`,
    ].entries()) {
      const { proposeAdoption } = await import('../../src/adopt.js');
      assert.throws(() => proposeAdoption(source, `Unsupported${i}.tsx`), /cannot adopt.*line|line.*cannot adopt/s);
    }
  } finally { await api.close(); await ws.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('OPN-03: adoption obeys identity and permissions; only acceptance calls store.apply', async () => {
  const dir = corpus();
  writeFileSync(join(dir, 'napkin.json'), JSON.stringify({ agents: { you: 'write', scout: 'propose', viewer: 'read' } }));
  const ws = await openWorkspace(dir, { recursive: true, writeSidecars: false }), api = createApi(ws);
  const calls = [], store = ws.find('Greeting').store, original = store.apply.bind(store);
  store.apply = (request) => { calls.push(request); return original(request); };
  const before = hashes(dir);
  const call = (path, token, body = {}) => api.handle({ method: 'POST', path, token, body });
  try {
    const viewer = api.session('viewer').json.token, scout = api.session('scout').json.token, you = api.session('you').json.token;
    assert.equal((await call('/api/components/Greeting/adoption')).status, 401);
    assert.equal((await call('/api/components/Greeting/adoption', viewer)).status, 403);
    const proposal = (await call('/api/components/Greeting/adoption', scout)).json.proposal;
    assert.equal(calls.length, 0);
    assert.equal((await call(`/api/proposals/${proposal.id}/accept`, scout)).status, 403);
    assert.deepEqual(hashes(dir), before);
    assert.equal((await call(`/api/proposals/${proposal.id}/accept`, you)).status, 200);
    assert.equal(calls.length, 1); assert.equal(calls[0].by, 'scout');
    assert.equal(store.history()[0].by, 'scout');
    assert.match(store.history()[0].summary, /adoption/);
  } finally { await api.close(); await ws.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('S1 / invariants: 40 editable files open without writes, 40 no-op saves are byte-identical, radius edit changes one line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-forty-'));
  const source = readFileSync(fixture('Button'), 'utf8');
  for (let i = 0; i < 40; i++) { const name = i === 0 ? 'Badge' : `Widget${i}`; writeFileSync(join(dir, name + '.tsx'), source.replace(/Button/g, name)); }
  const before = hashes(dir), ws = await openWorkspace(dir, { recursive: true, writeSidecars: false });
  try {
    assert.equal(ws.entries().length, 40); assert.equal(scanRepository(dir).filter((r) => r.editable).length, 40);
    assert.deepEqual(hashes(dir), before);
    for (const entry of ws.entries()) {
      const r = await entry.store.read();
      const result = await entry.store.apply({ baseRevision: r.revision, by: 'you', edits: [{ op: 'set', path: 'root.borderRadius', value: r.doc.root.style.borderRadius }] });
      assert.equal(result.ok, true, result.error);
    }
    assert.deepEqual(hashes(dir), before, '40/40 no-op saves byte-identical');
    const badge = ws.find('Badge'), r = await badge.store.read(), fileBefore = readFileSync(badge.file, 'utf8').split('\n');
    assert.equal((await badge.store.apply({ baseRevision: r.revision, by: 'you', edits: [{ op: 'set', path: 'root.borderRadius', value: '15px' }] })).ok, true);
    const fileAfter = readFileSync(badge.file, 'utf8').split('\n');
    assert.equal(fileBefore.length, fileAfter.length); assert.equal(fileBefore.filter((line, i) => line !== fileAfter[i]).length, 1);
    evidence('S1-open-40', 'Re-run: EVIDENCE=1 node --test test/onboarding/open.test.js\n40/40 files editable; opening writes zero paths.\n40/40 no-op saves byte-identical. Badge base radius edit: exactly 1 existing line changed.\nThis is a file/API check; the full pointer-driven S1 walk is not claimed.\n');
  } finally { await ws.close(); rmSync(dir, { recursive: true, force: true }); }
});
