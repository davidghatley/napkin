// NAPKIN_ALLOW_HOST opts one extra hostname into the Host/Origin guard (a private tailnet behind `tailscale serve`); everything else stays refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { tempRepo, ROOT } from '../helpers/harness.js';
import { join } from 'node:path';

const get = (port, headers) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, path: '/', headers }, (x) => { x.resume(); res(x.statusCode); }); r.on('error', rej); r.end(); });
test('only the allowed extra host passes the guard', async () => {
  const { compDir } = tempRepo(['Button']);
  const proc = spawn(process.execPath, [join(ROOT, 'src/server.js'), '--dir', compDir, '--port', '0'], { env: { ...process.env, NAPKIN_ALLOW_HOST: 'box.tail.ts.net' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((r) => proc.stdout.on('data', (d) => { const m = /127\.0\.0\.1:(\d+)/.exec(String(d)); if (m) r(Number(m[1])); }));
    assert.equal(await get(port, { host: `127.0.0.1:${port}` }), 200);
    assert.equal(await get(port, { host: 'box.tail.ts.net:8444', origin: 'https://box.tail.ts.net:8444' }), 200);
    assert.equal(await get(port, { host: 'evil.example' }), 403);
    assert.equal(await get(port, { host: 'box.tail.ts.net', origin: 'https://evil.example' }), 403);
  } finally { proc.kill('SIGTERM'); }
});
