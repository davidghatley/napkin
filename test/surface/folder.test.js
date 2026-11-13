// Open folder: POST /api/folder switches the running napkin to another folder on the same port, at once, and back.
// A folder that cannot be opened leaves the current one as it was. Tokens given before the switch stay good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/harness.js';

test('Open folder switches folders in place, refuses what cannot be opened, keeps sessions', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-folder-')), a = join(dir, 'a'), b = join(dir, 'b');
  mkdirSync(a); mkdirSync(b);
  writeFileSync(join(a, 'one.css'), '.x { padding: 4px; }\n');
  writeFileSync(join(b, 'two.md'), '# Two\n');
  const server = await startServer(a, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } });
  t.after(async () => { await server.stop(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, body, token) => { const r = await fetch(server.url + path.slice(1), { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  const paths = async () => (await call('/api/items')).items.map((x) => x.path).sort();
  const { token } = await call('/api/session', { as: 'you' });
  assert.deepEqual(await paths(), ['one.css']);

  assert.equal((await call('/api/folder', { folder: b })).status, 401, 'a caller without a session cannot switch');
  const nope = await call('/api/folder', { folder: join(dir, 'missing') }, token);
  assert.equal(nope.status, 400); assert.match(nope.error, /no folder at/i); assert.match(nope.error, /Next:/);
  assert.deepEqual(await paths(), ['one.css'], 'a refused folder leaves the current one open');

  const r = await call('/api/folder', { folder: b }, token);
  assert.equal(r.ok, true);
  assert.deepEqual(await paths(), ['two.md'], 'the new folder is open on the same port');
  const board = await call('/api/board');
  assert.deepEqual(board.selection, [], 'the board is the new folder\'s');
  const still = await call('/api/folder', { folder: a }, token);
  assert.equal(still.ok, true, 'the session made before the first switch still works');
  assert.deepEqual(await paths(), ['one.css']);
});
