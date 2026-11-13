// Parquet differential test: 30 seeded files with several row groups, required and optional columns (nulls), 32- and 64-bit integers, doubles,
// booleans, and awkward text, stored plain, uncompressed or gzip. The reference is the value matrix the generator wrote: napkin must serve
// exactly those cells at the start, the middle, across each row-group boundary and at the last row. (The writer below shares no code with
// napkin's reader, which is the vendored hyparquet; it follows the Parquet format spec for plain-encoded v1 data pages.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
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
const vi = (n) => {
  n = BigInt(n);
  const a = [];
  while (n >= 0x80n) {
    a.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  a.push(Number(n));
  return Buffer.from(a);
};
const zz = (n) => vi(BigInt(n) >= 0n ? BigInt(n) * 2n : -BigInt(n) * 2n - 1n);
// Compact Thrift: [field id, compact type, value]; types 5 = i32, 6 = i64, 8 = string, 9 = list, 12 = struct.
const val = (t, v) =>
  t === 5 || t === 6 ? zz(v) : t === 8 ? Buffer.concat([vi(Buffer.byteLength(v)), Buffer.from(v)]) : t === 12 ? struct(v)
  : Buffer.concat([Buffer.from([(Math.min(15, v.values.length) << 4) | v.type]), ...(v.values.length >= 15 ? [vi(v.values.length)] : []), ...v.values.map((x) => val(v.type, x))]);
function struct(fields) {
  let prev = 0;
  const out = [];
  for (const [id, t, v] of fields) {
    const d = id - prev;
    out.push(Buffer.from([d > 0 && d < 16 ? (d << 4) | t : t]));
    if (!(d > 0 && d < 16)) out.push(zz(id));
    out.push(val(t, v));
    prev = id;
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}
// Column kinds: parquet physical type number, plain encoder for one value.
const COLS = {
  id: { type: 2, plain: (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; } },
  n: { type: 1, plain: (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; } },
  x: { type: 5, plain: (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; } },
  s: { type: 6, utf8: true, plain: (v) => { const t = Buffer.from(v); const l = Buffer.alloc(4); l.writeUInt32LE(t.length); return Buffer.concat([l, t]); } },
};
// Booleans are bit-packed, least significant bit first, so they are encoded for the whole page.
const plainBools = (vals) => { const b = Buffer.alloc(Math.ceil(vals.length / 8)); vals.forEach((v, i) => { if (v) b[i >> 3] |= 1 << (i & 7); }); return b; };
function defLevels(present) {
  const groups = Math.ceil(present.length / 8), bytes = Buffer.alloc(groups);
  present.forEach((p, i) => { if (p) bytes[i >> 3] |= 1 << (i & 7); });
  const body = Buffer.concat([vi((groups << 1) | 1), bytes]), len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
}
function writeParquet(spec, rowsByColumn, groupSizes, codec) {
  const parts = [Buffer.from('PAR1')], groups = [];
  let offset = 4, base = 0;
  for (const count of groupSizes) {
    const chunks = [];
    for (const c of spec) {
      const all = rowsByColumn[c.name].slice(base, base + count), present = all.map((v) => v !== null), vals = all.filter((v) => v !== null);
      const data = c.type === 0 ? plainBools(vals) : Buffer.concat(vals.map(COLS[c.name]?.plain ?? (() => Buffer.alloc(0))));
      const raw = Buffer.concat([...(c.optional ? [defLevels(present)] : []), data]), comp = codec === 2 ? gzipSync(raw) : raw;
      const header = struct([[1, 5, 0], [2, 5, raw.length], [3, 5, comp.length], [5, 12, [[1, 5, count], [2, 5, 0], [3, 5, 3], [4, 5, 3]]]]);
      parts.push(header, comp);
      chunks.push([[2, 6, offset], [3, 12, [[1, 5, c.type], [2, 9, { type: 5, values: [0, 3] }], [3, 9, { type: 8, values: [c.name] }], [4, 5, codec], [5, 6, count], [6, 6, header.length + raw.length], [7, 6, header.length + comp.length], [9, 6, offset]]]]);
      offset += header.length + comp.length;
    }
    groups.push([[1, 9, { type: 12, values: chunks }], [2, 6, 0], [3, 6, count]]);
    base += count;
  }
  const schema = [[[4, 8, 'schema'], [5, 5, spec.length]], ...spec.map((c) => [[1, 5, c.type], [3, 5, c.optional ? 1 : 0], [4, 8, c.name], ...(c.utf8 ? [[6, 5, 0]] : [])])];
  const footer = struct([[1, 5, 1], [2, 9, { type: 12, values: schema }], [3, 6, groupSizes.reduce((a, b) => a + b, 0)], [4, 9, { type: 12, values: groups }], [6, 8, 'napkin differential writer']]);
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(footer.length);
  tail.write('PAR1', 4);
  return Buffer.concat([...parts, footer, tail]);
}
const TEXTS = ['', '00123', '9007199254740993', 'Aspen', 'café ☕', 'a,b', 'say "hi"', 'line\nbreak', ' padded ', 'null', 'true', '=SUM(A1)', '日本語'];
const DOUBLES = [0, -0, 1.5, 1e21, 5e-324, -1234.5678, 0.1, 123456789.125];
const text = (v) => (v === null ? null : Object.is(v, -0) ? '-0' : String(v));

test('Parquet: 30 seeded files (row groups, nulls, 64-bit integers, gzip) serve exactly the cells that were written', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-diff-pq-')), files = [];
  for (let seed = 1; seed <= 30; seed++) {
    const r = rng(seed * 104729), pick = (a) => a[Math.floor(r() * a.length)], nul = (p) => r() < p;
    const ng = 1 + Math.floor(r() * 4), sizes = Array.from({ length: ng }, () => 1 + Math.floor(r() * (r() < 0.3 ? 400 : 30))), total = sizes.reduce((a, b) => a + b, 0);
    const optional = seed % 3 !== 0;
    const spec = [
      { name: 'id', type: 2 }, { name: 'n', type: 1, optional }, { name: 'x', type: 5, optional }, { name: 's', type: 6, utf8: true, optional }, { name: 'ok', type: 0, optional },
    ];
    const p = optional ? 0.2 : 0;
    const cols = {
      id: Array.from({ length: total }, (_, i) => (i % 5 === 0 ? BigInt(i) * 10000000000003n - 9007199254740993n : BigInt(Math.floor(r() * 1e9)) * (r() < 0.5 ? -1n : 1n))),
      n: Array.from({ length: total }, () => (nul(p) ? null : Math.floor(r() * 4e9) - 2e9)),
      x: Array.from({ length: total }, () => (nul(p) ? null : r() < 0.4 ? pick(DOUBLES) : r() * 2000 - 1000)),
      s: Array.from({ length: total }, () => (nul(p) ? null : pick(TEXTS))),
      ok: Array.from({ length: total }, () => (nul(p) ? null : r() < 0.5)),
    };
    const name = `p${seed}.parquet`;
    writeFileSync(join(dir, name), writeParquet(spec, cols, sizes, seed % 2 ? 0 : 2));
    files.push({ name, cols, sizes, total });
  }
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  let compared = 0;
  for (const f of files) {
    const edges = [0, f.total >> 1, Math.max(0, f.total - 3)];
    let at = 0;
    for (const s of f.sizes) { edges.push(Math.max(0, at + s - 2)); at += s; }
    for (const offset of new Set(edges)) {
      const res = await fetch(`${server.url}api/item-data/${f.name}?offset=${offset}`), d = await res.json();
      assert.equal(res.status, 200, `${f.name}: ${d.error}`);
      assert.equal(d.total, f.total, `${f.name}: total rows`);
      assert.equal(d.groups, f.sizes.length, `${f.name}: row groups`);
      assert.deepEqual(d.columns.map((c) => c.name), ['id', 'n', 'x', 's', 'ok']);
      assert.ok(d.rows.length > 0, `${f.name} at ${offset}: rows came back`);
      for (let k = 0; k < d.rows.length; k++) {
        const i = d.offset + k;
        assert.deepEqual(d.rows[k], ['id', 'n', 'x', 's', 'ok'].map((c) => text(f.cols[c][i])), `${f.name} row ${i}`);
        compared += 5;
      }
    }
  }
  console.log(`Parquet: ${files.length} files, ${compared} cells compared with the written values`);
});
