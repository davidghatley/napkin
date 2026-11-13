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
  assert.equal(d.rows[0][0], String(0));
  d = await get('big.csv', `offset=${N - 100}`);
  assert.equal(d.rows.length, 80);
  assert.equal(d.rows[0][0], String(N - 100));
  assert.equal(d.rows[0][1], `line ${N - 100}`);
  d = await get('big.csv', `offset=${977 * 300}`);
  assert.equal(d.rows[0][0], String(977 * 300));
  assert.equal(d.rows[0][1], `line ${977 * 300}\nsecond line`);
  d = await get('big.csv', `offset=${N - 1}`);
  assert.equal(d.rows.at(-1)[0], String(N - 1));
  d = await get('big.jsonl', `offset=${N - 5}`);
  assert.equal(d.total, N);
  assert.equal(d.rows.at(-1)[0], String(N - 1));
  d = await get('big.jsonl', 'offset=250001');
  assert.equal(d.rows[0][0], String(250001));
});

test('UTF-16 tables larger than 8 MiB are reachable to the last row, with and without a byte order mark', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-u16-')),
    files = join(dir, 'files');
  mkdirSync(files);
  const N = 300000;
  let csv = 'id,note,value\r\n';
  for (let i = 0; i < N; i++) csv += `${i},"héllo ${i}${i % 977 === 0 ? '\nsecond' : ''}",${i * 2}\r\n`;
  const le = Buffer.from(csv, 'utf16le');
  assert.ok(le.length > 8 * 1024 * 1024);
  writeFileSync(join(files, 'wide.csv'), Buffer.concat([Buffer.from([0xff, 0xfe]), le]));
  writeFileSync(join(files, 'wide-be.tsv'), Buffer.from(csv.replaceAll(',', '\t'), 'utf16le').swap16());
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (id, q) => (await fetch(`${server.url}api/item-data/${encodeURIComponent(id)}?${q}`)).json();
  for (const id of ['wide.csv', 'wide-be.tsv']) {
    let d = await get(id, 'offset=0');
    assert.equal(d.total, N, id);
    assert.equal(d.rows[0][0], String(0));
    d = await get(id, `offset=${N - 100}`);
    assert.equal(d.rows.length, 80);
    assert.equal(d.rows[0][0], String(N - 100));
    assert.equal(d.rows[0][1], `héllo ${N - 100}`);
    d = await get(id, `offset=${977 * 200}`);
    assert.equal(d.rows[0][1], `héllo ${977 * 200}\nsecond`);
  }
});

test('Parquet rows are reachable at any offset inside a row group and at the last row', async (t) => {
  const { parquetBytes } = await import('./samples/generate.js');
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-pq-')),
    files = join(dir, 'files');
  mkdirSync(files);
  const N = 1_234_567;
  writeFileSync(join(files, 'rows.parquet'), parquetBytes(N));
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (q) => (await fetch(`${server.url}api/item-data/rows.parquet?${q}`)).json();
  for (const at of [0, 99_999, 100_000, 777_777, 1_100_001, N - 80]) {
    const d = await get(`offset=${at}`);
    assert.equal(d.total, N);
    assert.equal(d.rows[0][0], String(at), `offset ${at}`);
    assert.equal(d.rows.at(-1)[0], String(Math.min(N - 1, at + 79)));
  }
  const last = await get(`offset=${N - 1}`);
  assert.equal(last.rows[0][0], String(N - 1));
});
