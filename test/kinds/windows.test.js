import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../helpers/harness.js';
test('delimited and line files are reachable to their last row, beyond any prefix window', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-win-')),
    files = join(dir, 'files');
  mkdirSync(files);
  const N = 400000;
  let csv = 'id,note,value\r\n';
  for (let i = 0; i < N; i++) csv += `${i},"line ${i}${i % 977 === 0 ? '\nsecond line' : ''}",${i * 2}\r\n`;
  writeFileSync(join(files, 'big.csv'), csv);
  let lines = '';
  for (let i = 0; i < N; i++) lines += JSON.stringify({ n: i, even: i % 2 === 0 }) + (i % 3 ? '\n' : '\n\n');
  writeFileSync(join(files, 'big.jsonl'), lines);
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (id, q) =>
    (await fetch(`${server.url}api/item-data/${encodeURIComponent(id)}?${q}`)).json();
  let d = await get('big.csv', 'offset=0');
  assert.ok(d.total, JSON.stringify(d).slice(0, 300));
  assert.equal(d.total, N);
  assert.equal(d.truncated, false);
  assert.equal(d.rows[0][0], 0);
  d = await get('big.csv', `offset=${N - 100}`);
  assert.equal(d.rows.length, 80);
  assert.equal(d.rows[0][0], N - 100);
  assert.equal(d.rows[0][1], `line ${N - 100}`);
  d = await get('big.csv', `offset=${977 * 300}`);
  assert.equal(d.rows[0][0], 977 * 300);
  assert.equal(d.rows[0][1], `line ${977 * 300}\nsecond line`);
  d = await get('big.csv', `offset=${N - 1}`);
  assert.equal(d.rows.at(-1)[0], N - 1);
  d = await get('big.jsonl', `offset=${N - 5}`);
  assert.equal(d.total, N);
  assert.equal(d.rows.at(-1)[0], N - 1);
  d = await get('big.jsonl', 'offset=250001');
  assert.equal(d.rows[0][0], 250001);
});
