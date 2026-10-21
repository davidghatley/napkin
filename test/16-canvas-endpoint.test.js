// The canvas position endpoint: refuses junk, writes the sidecar atomically (no temp files left, valid JSON after).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tempRepo, startServer } from './helpers/harness.js';

test('POST /canvas refuses null, strings and NaN; a good write leaves valid JSON and no temp file', async () => {
  const { fileOf } = tempRepo(['Button']);
  const dir = dirname(fileOf('Button'));
  const server = await startServer(dir);
  const post = async (body) => { const r = await fetch(new URL('api/components/Button/canvas', server.url), { method: 'POST', body: JSON.stringify(body) }); return [r.status, await r.json()]; };
  try {
    for (const bad of [{ x: null, y: 1 }, { x: 1, y: null }, { x: '5', y: 1 }, {}, { x: 1e9, y: 0 }]) assert.equal((await post(bad))[0], 400, JSON.stringify(bad));
    const [st, ok] = await post({ x: 12.4, y: -7 });
    assert.equal(st, 200); assert.deepEqual(ok.canvas, { x: 12, y: -7 });
    const side = JSON.parse(readFileSync(fileOf('Button').replace(/\.tsx$/, '.napkin.json'), 'utf8'));
    assert.deepEqual(side.canvas, { x: 12, y: -7 });
    assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
  } finally { await server.stop(); }
});
