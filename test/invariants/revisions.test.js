// HIS-04: revisions are content hashes, so they survive a server restart. A client that read a revision before the restart
// can still commit when the file is unchanged; if the file changed while the server was down, the revision is stale.
// Revisions stay opaque to clients: these tests only compare them for equality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../src/store.js';
import { tempRepo, startServer, fixture } from '../helpers/harness.js';
import { session } from '../helpers/agents.js';

const SET = (v) => [{ op: 'set', path: 'root.gap', value: v }];

test('HIS-04: a revision from before a store restart commits if the file is unchanged', async () => {
  const { file } = tempRepo(['Button']);
  const s1 = await openStore(file);
  const r0 = (await s1.read()).revision;
  const a = await s1.apply({ baseRevision: r0, edits: SET(3), by: 'client' });
  assert.equal(a.ok, true, a.error);
  const held = a.revision;
  assert.notEqual(held, r0);
  await s1.close();
  const s2 = await openStore(file);
  try {
    assert.equal((await s2.read()).revision, held, 'the same bytes give the same revision after a restart');
    const b = await s2.apply({ baseRevision: held, edits: SET(5), by: 'client' });
    assert.equal(b.ok, true, b.error);
    // the revision before that is no longer known to the restarted store
    const old = await s2.apply({ baseRevision: r0, edits: SET(6), by: 'client' });
    assert.match(old.error, /^stale revision/);
  } finally { await s2.close(); }
});

test('HIS-04: the same bytes have the same revision in different folders; content that comes back is the same revision', async () => {
  const a = tempRepo(['Button']), b = tempRepo(['Button']);
  const sa = await openStore(a.file), sb = await openStore(b.file);
  try {
    const r = (await sa.read()).revision;
    assert.equal((await sb.read()).revision, r);
    const there = await sa.apply({ baseRevision: r, edits: SET(99), by: 'x' });
    const back = await sa.apply({ baseRevision: there.revision, edits: [{ op: 'set', path: 'root.gap', value: 8 }], by: 'x' });
    assert.equal(back.revision, r, 'back to the original bytes is the original revision');
    // a client holding the original revision, editing a different key, still lands
    const other = await sa.apply({ baseRevision: r, edits: [{ op: 'set', path: 'label.color', value: '#fff' }], by: 'y' });
    assert.equal(other.ok, true, other.error);
  } finally { await sa.close(); await sb.close(); }
});

test('HIS-04: through a real server restart: the pre-restart revision commits; after a change made while it was down it is stale', async () => {
  const { compDir, fileOf } = tempRepo(['Card']);
  const api = async (server, path, init = {}) => { const token = await session(server.url, 'david'); return fetch(new URL(path, server.url), { ...init, headers: { ...(init.body && { 'content-type': 'application/json' }), authorization: `Bearer ${token}` } }).then((r) => r.json()); };
  let server = await startServer(compDir);
  const held = (await api(server, 'api/components/Card')).revision;
  const first = await api(server, 'api/components/Card/edits', { method: 'POST', body: JSON.stringify({ baseRevision: held, edits: [{ op: 'set', path: 'title.fontSize', value: '30px' }], by: 'canvas' }) });
  assert.equal(first.ok, true, first.error);
  await server.stop();

  server = await startServer(compDir);
  const again = (await api(server, 'api/components/Card')).revision;
  assert.equal(again, first.revision, 'revision survives the restart');
  const second = await api(server, 'api/components/Card/edits', { method: 'POST', body: JSON.stringify({ baseRevision: first.revision, edits: [{ op: 'set', path: 'body.color', value: '#222' }], by: 'canvas' }) });
  assert.equal(second.ok, true, second.error);
  await server.stop();

  // someone edits the file by hand while the server is down
  writeFileSync(fileOf('Card'), readFileSync(fileOf('Card'), 'utf8').replace("title = 'From napkin to component'", "title = 'Edited while down'"));
  server = await startServer(compDir);
  try {
    const stale = await api(server, 'api/components/Card/edits', { method: 'POST', body: JSON.stringify({ baseRevision: second.revision, edits: [{ op: 'set', path: 'body.color', value: '#444' }], by: 'canvas' }) });
    assert.equal(stale.ok, false);
    assert.match(stale.error, /^stale revision/);
    const now = (await api(server, 'api/components/Card')).revision;
    const fresh = await api(server, 'api/components/Card/edits', { method: 'POST', body: JSON.stringify({ baseRevision: now, edits: [{ op: 'set', path: 'body.color', value: '#444' }], by: 'canvas' }) });
    assert.equal(fresh.ok, true, fresh.error);
  } finally { await server.stop(); }
});
