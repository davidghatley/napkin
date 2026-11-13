// Differential tests: many seeded ordinary and awkward files per format, read by napkin over HTTP and by a reference
// implementation, cell for cell. References: the sqlite3 command-line shell (its CSV importer and its own reading of a
// database) and Apache Arrow JS (the official writer; the files are written by it and read back by it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as A from '../../src/vendor/apache-arrow/arrow.js';
import { startServer } from '../helpers/harness.js';

const has = (cmd) => {
  try {
    execFileSync(cmd, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const SQLITE = has('sqlite3');
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
// Cell texts an ordinary spreadsheet export contains, and the awkward ones people actually meet.
const CELLS = [
  () => '00123',
  () => '007',
  () => '9007199254740993',
  () => '-9223372036854775808',
  () => '1.50',
  () => '1e3',
  () => '0',
  () => '-0',
  () => '',
  () => 'true',
  () => 'FALSE',
  () => '2026-11-12',
  () => '2026-11-12T08:30:00Z',
  () => 'Aspen',
  () => 'café ☕',
  () => 'a,b',
  () => 'say "hi"',
  () => 'line\nbreak',
  () => 'crlf\r\nbreak',
  () => ' padded ',
  () => 'q"r',
  () => '=SUM(A1)',
  () => 'NaN',
  () => 'null',
];
function csvCell(text, delim, r) {
  const needs = text.includes(delim) || /["\r\n]/.test(text) || r() < 0.1;
  // A quote in the middle of an unquoted field is text (q"r); a field that needs quoting is quoted per RFC 4180.
  if (!needs || (text === 'q"r' && r() < 0.5 && delim !== '"')) return text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function makeCsv(seed, delim) {
  const r = rng(seed),
    width = 1 + Math.floor(r() * 6),
    rows = 1 + Math.floor(r() * (r() < 0.2 ? 1500 : 40)),
    eol = r() < 0.3 ? '\r\n' : '\n',
    names = Array.from({ length: width }, (_, i) => (r() < 0.25 && i ? 'value' : pick(r, ['id', 'value', 'name', 'when', 'Ünïcode', 'a b']))),
    body = Array.from({ length: rows }, () => Array.from({ length: width }, () => pick(r, CELLS)()));
  const text = [names, ...body].map((row) => row.map((c) => csvCell(c, delim, r)).join(delim)).join(eol) + (r() < 0.8 ? eol : '');
  return { text, names, body };
}
// The sqlite3 shell's CSV importer is the reference reader: every record as an array of text, header included.
function sqliteCsv(file, width, delim) {
  const cols = Array.from({ length: width }, (_, i) => 'c' + i);
  const out = execFileSync('sqlite3', ['-batch', ':memory:', `create table t(${cols.join(',')})`, delim === '\t' ? '.mode tabs' : '.mode csv', `.import ${delim === '\t' ? '' : '--csv '}${file} t`, '.mode list', `select json_group_array(json_array(${cols.join(',')})) from (select * from t order by rowid)`], { maxBuffer: 64 << 20 });
  return JSON.parse(out.toString());
}

test('CSV and TSV: every cell napkin serves equals the sqlite3 importer, across 60 seeded files', { skip: !SQLITE && 'sqlite3 is not installed' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-diff-csv-')),
    files = [];
  for (let seed = 1; seed <= 60; seed++) {
    const delim = seed % 4 === 0 ? '\t' : ',',
      f = makeCsv(seed, delim),
      name = `f${seed}.${delim === '\t' ? 'tsv' : 'csv'}`;
    // The TSV reference (.mode tabs) has no quoting, so TSV files hold no tabs, quotes or line breaks inside cells.
    if (delim === '\t') {
      const clean = (s) => s.replace(/[\t"\r\n]/g, '_');
      const text = [f.names, ...f.body].map((row) => row.map(clean).join('\t')).join('\n') + '\n';
      writeFileSync(join(dir, name), text);
      files.push({ name, width: f.names.length, delim, rows: f.body.length });
    } else {
      writeFileSync(join(dir, name), f.text);
      files.push({ name, width: f.names.length, delim, rows: f.body.length });
    }
  }
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  let compared = 0;
  for (const f of files) {
    const ref = sqliteCsv(join(dir, f.name), f.width, f.delim),
      header = ref[0],
      rows = ref.slice(1);
    for (const offset of [0, Math.floor(rows.length / 2), Math.max(0, rows.length - 3)]) {
      const d = await (await fetch(`${server.url}api/item-data/${f.name}?offset=${offset}`)).json();
      assert.equal(d.total, rows.length, `${f.name}: row count`);
      assert.deepEqual(d.columns.map((c) => c.name), header, `${f.name}: headers, positional and duplicated as written`);
      const want = rows.slice(d.offset, d.offset + d.rows.length);
      assert.deepEqual(d.rows, want, `${f.name} at row ${offset}: cells exactly as the file holds them`);
      compared += want.length * f.width;
    }
  }
  console.log(`CSV/TSV: ${files.length} files, ${compared} cells compared with sqlite3`);
});

test('known traps: leading zeros, unsafe integers, duplicate headers and exact JSON numbers are never coerced', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-diff-traps-'));
  writeFileSync(join(dir, 'ids.csv'), 'id,value,value\n00123,11,22\n9007199254740993,1.50,-0\n');
  writeFileSync(join(dir, 'ids.jsonl'), '{"id":9007199254740993,"price":1.50,"n":1e2,"s":"00123"}\n{"id":1,"price":2,"n":3,"s":"x"}\n');
  writeFileSync(join(dir, 'ids.json'), '[{"id":12345678901234567890,"v":0.10},{"id":2,"v":3}]');
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (n) => (await fetch(`${server.url}api/item-data/${n}`)).json();
  const csv = await get('ids.csv');
  assert.deepEqual(csv.columns.map((c) => c.name), ['id', 'value', 'value']);
  assert.deepEqual(csv.rows, [['00123', '11', '22'], ['9007199254740993', '1.50', '-0']]);
  assert.equal(csv.columns[0].type, 'string', 'a column with leading zeros is an identifier, not a number');
  assert.equal(csv.columns[2].max, '22');
  const jsonl = await get('ids.jsonl');
  assert.deepEqual(jsonl.rows[0], ['9007199254740993', '1.50', '1e2', '00123']);
  const json = await get('ids.json');
  assert.deepEqual(json.rows[0], ['12345678901234567890', '0.10']);
  assert.match(json.text, /12345678901234567890/);
});

// Values and how Apache Arrow hands them back, written independently of napkin's formatter.
const expectArrow = (v) => (v === null || v === undefined ? null : typeof v === 'boolean' ? String(v) : String(v));
test('Arrow: file and stream IPC with dictionaries, nulls, many batches and 64-bit integers match Apache Arrow, across 40 seeded files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-diff-arrow-')),
    files = [];
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 7919),
      nb = 1 + Math.floor(r() * 5),
      cities = ['Aspen', 'Denver', 'Boulder', 'Ouray', 'Café'],
      sizes = Array.from({ length: nb }, () => 1 + Math.floor(r() * (r() < 0.3 ? 900 : 60))),
      nul = () => r() < 0.15;
    const make = (n) =>
      new A.Table({
        city: A.vectorFromArray(Array.from({ length: n }, () => (nul() ? null : pick(r, cities))), new A.Dictionary(new A.Utf8(), new A.Int32())),
        n: A.vectorFromArray(Array.from({ length: n }, () => (nul() ? null : Math.floor(r() * 2e9) - 1e9)), new A.Int32()),
        big: A.vectorFromArray(Array.from({ length: n }, () => (nul() ? null : BigInt(Math.floor(r() * 1e6)) * 10000000000003n - 5n)), new A.Int64()),
        x: A.vectorFromArray(Array.from({ length: n }, () => (nul() ? null : r() * 1000 - 500)), new A.Float64()),
        ok: A.vectorFromArray(Array.from({ length: n }, () => (nul() ? null : r() < 0.5)), new A.Bool()),
        label: A.vectorFromArray(Array.from({ length: n }, () => (nul() ? null : pick(r, CELLS)())), new A.Utf8()),
      });
    const format = seed % 2 ? 'file' : 'stream',
      name = `t${seed}.${format === 'file' ? 'arrow' : 'arrows'}`;
    let table;
    if (format === 'file') {
      // One dictionary for the whole column, cut into record batches: the file format allows no replacement dictionaries.
      let at = 0;
      const whole = make(sizes.reduce((x, y) => x + y, 0));
      table = new A.Table(sizes.flatMap((n) => whole.slice(at, (at += n)).batches));
    } else table = sizes.map(make).reduce((x, y) => x.concat(y)); // each batch with its own dictionary (replacements)
    const bytes = A.tableToIPC(table, format);
    writeFileSync(join(dir, name), bytes);
    // The reference is the file read back whole by Apache Arrow, not the table in memory: what the file holds is what counts.
    files.push({ name, table: A.tableFromIPC(bytes), format });
  }
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  let compared = 0;
  for (const f of files) {
    const ref = f.table,
      names = ref.schema.fields.map((x) => x.name),
      cols = names.map((_, i) => ref.getChildAt(i));
    for (const offset of [0, Math.floor(ref.numRows / 2), Math.max(0, ref.numRows - 2)]) {
      const res = await fetch(`${server.url}api/item-data/${f.name}?offset=${offset}`),
        d = await res.json();
      assert.equal(res.status, 200, `${f.name}: ${d.error}`);
      assert.equal(d.total, ref.numRows, `${f.name}: total rows over every batch`);
      assert.equal(d.batches, ref.batches.length, `${f.name}: batches`);
      assert.deepEqual(d.columns.map((c) => c.name), names);
      for (let k = 0; k < d.rows.length; k++)
        assert.deepEqual(d.rows[k], cols.map((c) => expectArrow(c.get(d.offset + k))), `${f.name} row ${d.offset + k}`);
      compared += d.rows.length * names.length;
    }
  }
  console.log(`Arrow: ${files.length} files, ${compared} cells compared with Apache Arrow`);
});

test('SQLite: rows napkin serves equal the sqlite3 shell, including 64-bit integers, reals and text that looks numeric', { skip: !SQLITE && 'sqlite3 is not installed' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-diff-sqlite-'));
  for (let seed = 1; seed <= 6; seed++) {
    const r = rng(seed * 31),
      db = new DatabaseSync(join(dir, `d${seed}.sqlite`));
    db.exec('create table t(id integer, code text, price real, note text)');
    const ins = db.prepare('insert into t values (?,?,?,?)');
    for (let i = 0; i < 50 + seed * 40; i++)
      ins.run(r() < 0.1 ? null : BigInt(Math.floor(r() * 9e8)) * 9999999967n, pick(r, ['00123', '007', 'A1', '']), r() < 0.1 ? null : Math.round(r() * 1e6) / 100, pick(r, CELLS)());
    db.close();
  }
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  for (let seed = 1; seed <= 6; seed++) {
    const file = join(dir, `d${seed}.sqlite`),
      // The shell prints integers in full and reals with 17 significant digits; both read back to the stored value.
      ref = JSON.parse(execFileSync('sqlite3', ['-batch', '-readonly', file, "select json_group_array(json_array(cast(id as text), code, price, note)) from (select * from t order by rowid)"]).toString());
    const d = await (await fetch(`${server.url}api/item-data/d${seed}.sqlite?offset=10`)).json();
    for (let k = 0; k < d.rows.length; k++) {
      const [id, code, price, note] = ref[10 + k];
      assert.equal(d.rows[k][0], id, `d${seed} row ${10 + k} id`);
      assert.equal(d.rows[k][1], code);
      assert.equal(d.rows[k][2] === null ? null : Number(d.rows[k][2]), price);
      assert.equal(d.rows[k][3], note);
    }
  }
});
