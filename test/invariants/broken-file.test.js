// INV-01: while the file on disk does not parse (a hand edit in progress) napkin writes nothing over it: store.apply, HTTP edits,
// MCP apply_edits, rename and delete are refused with the line, the bytes stay, and once the file is fixed everything works again.
// A dry run may still check an edit against the last good document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openStore } from '../../src/store.js';
import { tempRepo, startServer, startMcp, waitFor } from '../helpers/harness.js';
import { session } from '../helpers/agents.js';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const EDIT = [{ op: 'set', path: 'title.fontSize', value: '31px' }];
const REFUSED = /^Card\.tsx has a syntax error at line \d+; fix it \(or undo the hand edit\), then retry\. napkin won't overwrite your text\.$/;

test('INV-01: a hand edit with a syntax error is never overwritten: store, HTTP, MCP, rename and delete all refuse', async () => {
  const { compDir, fileOf } = tempRepo(['Card', 'Button']);
  const file = fileOf('Card');
  const good = readFileSync(file, 'utf8');
  const broken = good.replace("<h3 data-n=\"title\"", "<h3 data-n=\"title\" {{{");
  const store = await openStore(file);
  const { revision } = await store.read();
  writeFileSync(file, broken);
  await waitFor(async () => (await store.read()).problem);
  const before = sha(file);
  const r = await store.apply({ baseRevision: revision, edits: EDIT, by: 'agent' });
  assert.equal(r.ok, false); assert.match(r.error, REFUSED);
  const dry = await store.apply({ baseRevision: revision, edits: EDIT, dryRun: true });
  assert.equal(dry.ok, true, 'a dry run still validates against the last good document');
  assert.equal(sha(file), before);
  await store.close();

  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    const token = await session(server.url, 'david');
    const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const call = async (path, init = {}) => { const res = await fetch(new URL(path, server.url), { ...init, headers: h }); return { status: res.status, json: await res.json() }; };
    await waitFor(async () => (await call('api/components/Card')).json.problem !== undefined || true);
    const rev = (await call('api/components/Card')).json.revision;
    const e1 = await call('api/components/Card/edits', { method: 'POST', body: JSON.stringify({ baseRevision: rev, edits: EDIT }) });
    assert.equal(e1.status, 409); assert.match(e1.json.error, REFUSED);
    const m = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: EDIT });
    assert.equal(m.isError, true); assert.match(m.text, /syntax error at line \d+/);
    assert.equal(e1.status, 409);
    const rn = await call('api/components/Card/rename', { method: 'POST', body: JSON.stringify({ name: 'Cardy' }) });
    assert.equal(rn.status, 409); assert.match(rn.json.error, REFUSED);
    const del = await call('api/components/Card', { method: 'DELETE' });
    assert.equal(del.status, 409); assert.match(del.json.error, REFUSED);
    assert.equal(sha(file), before, 'sha256 of the broken file is unchanged');
    assert.ok(existsSync(file) && !existsSync(fileOf('Cardy')));
    // fix the file: writes work again
    writeFileSync(file, good);
    await waitFor(async () => (await call('api/components/Card')).json.source === good);
    const rev2 = (await call('api/components/Card')).json.revision;
    const ok = await call('api/components/Card/edits', { method: 'POST', body: JSON.stringify({ baseRevision: rev2, edits: EDIT }) });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  } finally { mcp.stop(); await server.stop(); }
});
