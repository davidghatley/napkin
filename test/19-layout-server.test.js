// Layout lane server surface: pasted images (LAY-10) and preview widths (LAY-11), both identity-checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer } from './helpers/harness.js';
import { http, session, sha } from './helpers/agents.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('pasted images go through the shared assets route: assets/<sha8>.<ext>, served back, scripts refused', async () => {
  const { compDir, fileOf } = tempRepo(['Card']);
  const server = await startServer(compDir);
  try {
    const token = await session(server.url, 'you');
    const post = (body, tk = token) => http(server.url, '/api/assets', { method: 'POST', body, token: tk });
    assert.equal((await post({ ext: 'png', data: PNG.toString('base64') }, null)).status, 401, 'needs a session');
    const a = await post({ ext: 'png', data: PNG.toString('base64') });
    assert.equal(a.status, 201);
    assert.match(a.json.path, /^assets\/[0-9a-f]{8}\.png$/);
    assert.equal(a.json.created, true);
    const b = await post({ ext: 'png', data: PNG.toString('base64') });
    assert.equal(b.json.path, a.json.path); assert.equal(b.json.created, false, 'the same bytes are stored once');
    assert.deepEqual(readdirSync(join(compDir, 'assets')), [a.json.path.slice(7)]);
    const served = await fetch(new URL(a.json.path, server.url));
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);
    const svg = await post({ ext: 'svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>').toString('base64') });
    assert.match(svg.json.path, /\.svg$/);
    assert.equal((await post({ ext: 'svg', data: Buffer.from('<svg><script>1</script></svg>').toString('base64') })).status, 415);
    assert.equal((await post({ ext: 'png', data: Buffer.from('nope').toString('base64') })).status, 400);
    assert.equal(existsSync(fileOf('Card')), true);
  } finally { await server.stop(); }
});

test('preview widths go to the sidecar through the identity-checked route and never touch the .tsx', async () => {
  const { compDir, fileOf } = tempRepo(['Button']);
  const server = await startServer(compDir);
  try {
    const before = sha(fileOf('Button'));
    const url = '/api/components/Button/preview';
    assert.equal((await http(server.url, url, { method: 'POST', body: { variant: { size: 'sm' }, width: 200 } })).status, 401);
    const token = await session(server.url, 'you');
    const r = await http(server.url, url, { method: 'POST', token, body: { variant: { size: 'sm', state: 'default' }, width: 180.4 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.preview, { '{"size":"sm","state":"default"}': 180 });
    assert.equal(sha(fileOf('Button')), before, '.tsx unchanged');
    const side = JSON.parse(readFileSync(fileOf('Button').replace(/\.tsx$/, '.napkin.json'), 'utf8'));
    assert.equal(side.preview['{"size":"sm","state":"default"}'], 180);
    assert.ok(side.canvas, 'the position is kept');
    assert.deepEqual((await http(server.url, '/api/components/Button')).json.component && true, true);
    assert.equal((await http(server.url, url, { method: 'POST', token, body: { variant: { size: 'sm' }, width: 3 } })).status, 400);
    const gone = await http(server.url, url, { method: 'POST', token, body: { variant: { size: 'sm', state: 'default' }, width: null } });
    assert.deepEqual(gone.json.preview, {});
    assert.equal(sha(fileOf('Button')), before);
  } finally { await server.stop(); }
});
