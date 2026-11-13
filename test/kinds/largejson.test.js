// JSON files over 1 MiB are shown faithfully, read in bounded windows: every record of a big array is reachable as table rows, and every branch of
// any other big file opens to its own children, with the keys, strings and digits exactly as written. The reference is JSON.parse of the whole file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/harness.js';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TRICKY = ['plain', 'has "quotes"', 'brace } and ] bracket [ {', 'comma, inside', 'back\\slash', 'line\nbreak', 'café ☕ 日本', '\\"', ''];

test('JSON over 1 MiB: a big array of records scrolls as a table, every record exact', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-bigjson-')),
    r = rng(5);
  const rows = Array.from({ length: 14000 }, (_, i) => `{"id":${i % 7 === 0 ? '90071992547409' + String(i).padStart(2, '0') : i},"code":"${String(i).padStart(6, '0')}","note":${JSON.stringify(TRICKY[Math.floor(r() * TRICKY.length)] + ' ' + 'x'.repeat(40))},"price":${i % 3 ? '1.50' : '2e1'}}`);
  writeFileSync(join(dir, 'big.json'), '[\n' + rows.join(',\n') + '\n]\n');
  const ref = JSON.parse(readBack(join(dir, 'big.json')));
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const offset of [0, 777, 13000, 13990]) {
    const d = await (await fetch(`${server.url}api/item-data/big.json?offset=${offset}`)).json();
    assert.equal(d.large, true);
    assert.equal(d.total, ref.length);
    assert.equal(d.offset, offset);
    assert.deepEqual(d.columns.map((c) => c.name), ['id', 'code', 'note', 'price']);
    for (let k = 0; k < d.rows.length; k++) {
      const i = offset + k;
      assert.equal(d.rows[k][1], String(i).padStart(6, '0'), `row ${i} code keeps its zeros`);
      assert.equal(d.rows[k][2], ref[i].note);
      assert.equal(d.rows[k][3], i % 3 ? '1.50' : '2e1', `row ${i} price as written`);
      assert.equal(d.rows[k][0], i % 7 === 0 ? '90071992547409' + String(i).padStart(2, '0') : String(i), `row ${i} id as written`);
    }
    assert.ok(d.rows.length >= 80 || offset > 13000);
  }
});

test('JSON over 1 MiB: a big nested document opens branch by branch, with every entry reachable', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-bigjson-')),
    r = rng(11);
  const doc = {
    title: 'big',
    "key with \"quote\" and ] bracket": 1,
    list: Array.from({ length: 3000 }, (_, i) => ({ i, tag: TRICKY[Math.floor(r() * TRICKY.length)], deep: { a: [i, [i + 1]], s: 'y'.repeat(30) } })),
    blob: 'z'.repeat(1_200_000),
    empty: [],
    nothing: {},
    last: true,
  };
  writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc, null, 1));
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (q) => (await fetch(`${server.url}api/item-data/doc.json?${q}`)).json();
  const root = await get('tree=1');
  assert.equal(root.container, 'object');
  assert.deepEqual(root.entries.map((e) => e.key), Object.keys(doc));
  assert.deepEqual(root.entries.map((e) => e.kind), ['string', 'number', 'array', 'string', 'array', 'object', 'boolean']);
  assert.ok(root.entries[3].more >= 1_200_000, 'a huge string says how long it is');
  const list = await get('path=2&from=2990');
  assert.equal(list.total, 3000);
  assert.equal(list.entries.length, 10);
  assert.equal(list.entries.at(-1).index, 2999);
  const last = await get('path=2.2999');
  assert.deepEqual(last.entries.map((e) => e.key), ['i', 'tag', 'deep']);
  assert.equal(last.entries[0].text, '2999');
  assert.equal(last.entries[1].text, doc.list[2999].tag);
  const deeper = await get('path=2.2999.2.0');
  assert.deepEqual(deeper.entries.map((e) => e.text), ['2999', undefined]);
  assert.equal(deeper.entries[1].kind, 'array');
  assert.equal((await get('path=4')).total, 0);
  const bad = await fetch(`${server.url}api/item-data/doc.json?path=2.99999`);
  assert.equal(bad.status >= 400, true, 'a path that does not exist is an error, not an empty tree');
});
import { readFileSync } from 'node:fs';
function readBack(p) {
  return readFileSync(p, 'utf8');
}
