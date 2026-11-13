// Arrow IPC (file and stream formats) through Apache Arrow's own JavaScript reader (src/vendor/apache-arrow, Apache-2.0).
// napkin only finds where each message sits: one pass over the message headers (a few bytes each, bodies are skipped)
// records the schema, every dictionary batch and every record batch with its row count. A window of rows is then decoded by
// read by Arrow itself: a file through its own file reader (footer, dictionaries, random access to the batches that hold the
// rows), a stream by handing Arrow a small stream made of the schema, the dictionaries and only the batches that hold the rows.
// Dictionaries, nulls, nested types, many batches and both IPC formats are decoded by the reference implementation.
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { tableFromIPC, RecordBatchReader, Table } from '../vendor/apache-arrow/arrow.js';
import { tableWindow, cellText } from './cells.js';
const MAX_WINDOW = 256 * 1024 * 1024,
  indexes = new Map();
function bytes(fd, at, n) {
  const b = Buffer.alloc(Math.max(0, n)),
    got = n > 0 ? readSync(fd, b, 0, n, at) : 0;
  return b.subarray(0, got);
}
// The handful of FlatBuffers fields a message header needs (Message: header_type, header, bodyLength; RecordBatch: length).
function fbTable(b, p) {
  const vt = p - b.readInt32LE(p),
    size = b.readUInt16LE(vt);
  const at = (n) => {
    const slot = 4 + 2 * n;
    return slot < size && b.readUInt16LE(vt + slot) ? p + b.readUInt16LE(vt + slot) : 0;
  };
  return {
    u8: (n) => (at(n) ? b[at(n)] : 0),
    i64: (n) => (at(n) ? b.readBigInt64LE(at(n)) : 0n),
    ref: (n) => (at(n) ? fbTable(b, at(n) + b.readUInt32LE(at(n))) : null),
  };
}
function index(file) {
  const fd = openSync(file, 'r');
  try {
    const st = fstatSync(fd),
      size = st.size,
      key = `${file}:${size}:${st.mtimeMs}`;
    if (indexes.has(key)) return indexes.get(key);
    const head = bytes(fd, 0, 8),
      format = head.toString('latin1', 0, 6) === 'ARROW1' ? 'file' : 'stream';
    // A file is a stream between its leading magic and its footer.
    const footer = format === 'file' && size >= 18 && bytes(fd, size - 6, 6).toString('latin1') === 'ARROW1' ? bytes(fd, size - 10, 4).readInt32LE(0) : null,
      limit = footer !== null ? size - 10 - footer : size;
    let at = format === 'file' ? 8 : 0,
      schema = null,
      total = 0,
      ended = false;
    const dicts = [],
      batches = [];
    while (at + 4 <= limit) {
      const pre = bytes(fd, at, 8);
      let metaAt = at + 4,
        metaLen = pre.readInt32LE(0);
      if (metaLen === -1) {
        if (pre.length < 8) break;
        metaLen = pre.readInt32LE(4);
        metaAt = at + 8;
      }
      if (metaLen === 0) {
        ended = true;
        break;
      }
      if (metaLen < 0 || metaLen > 64 * 1024 * 1024) throw new Error('An Arrow message header is damaged or over 64 MiB. Next: re-export the file, or open it in its own application.');
      const meta = bytes(fd, metaAt, metaLen);
      if (meta.length < metaLen) break;
      const message = fbTable(meta, meta.readUInt32LE(0)),
        type = message.u8(1),
        body = Number(message.i64(3)),
        length = metaAt - at + metaLen + body;
      if (at + length > size) break;
      if (type === 1) schema = { at, length: metaAt - at + metaLen };
      else if (type === 2) dicts.push({ at, length, before: batches.length });
      else if (type === 3) {
        const rows = Number(message.ref(2)?.i64(0) ?? 0n);
        batches.push({ at, length, rows, start: total });
        total += rows;
      }
      at += length;
    }
    // Arrow files keep the schema in their footer (the JavaScript writer writes no schema message); streams must start with one.
    if (!schema && format === 'stream') throw new Error('This Arrow file has no schema message. Next: check that it was written completely, or open it in its own application.');
    const result = { format, schema, dicts, batches, total, size, complete: ended || at >= limit };
    indexes.set(key, result);
    while (indexes.size > 16) indexes.delete(indexes.keys().next().value);
    return result;
  } finally {
    closeSync(fd);
  }
}
// The column type as Arrow names it, in words the table header shows.
function typeName(t) {
  const s = String(t);
  if (t.dictionary) return typeName(t.dictionary) + ' (dictionary)';
  if (/^u?int/i.test(s)) return 'integer ' + s.toLowerCase();
  if (/^float/i.test(s)) return 'number ' + s.toLowerCase();
  if (/^(large)?utf8/i.test(s)) return 'string';
  if (/^bool/i.test(s)) return 'boolean';
  if (/^(date|timestamp)/i.test(s)) return 'date ' + s.toLowerCase();
  return s;
}
const valueType = (t) => (t.dictionary ? t.dictionary : t);
// Timestamps are shown in ISO form from their stored integer, so microseconds and nanoseconds keep their digits.
function arrowCell(v, type) {
  if (v === null || v === undefined) return null;
  const t = valueType(type),
    s = String(t);
  if (/^Timestamp/.test(s) && (typeof v === 'number' || typeof v === 'bigint')) {
    const unit = t.unit; // 0 s, 1 ms, 2 us, 3 ns
    if (typeof v === 'number') return new Date(v).toISOString();
    const per = [1n, 1n, 1000n, 1000000n][unit],
      ms = unit === 0 ? v * 1000n : v / per - (v % per < 0n ? 1n : 0n),
      rest = unit >= 2 ? ((v % per) + per) % per : 0n,
      iso = new Date(Number(ms)).toISOString();
    return unit >= 2 ? iso.replace('Z', String(rest).padStart(unit === 2 ? 3 : 6, '0') + 'Z') : iso;
  }
  if (/^Date/.test(s) && (typeof v === 'number' || v instanceof Date)) return new Date(Number(v)).toISOString().slice(0, 10);
  return cellText(v && typeof v === 'object' && typeof v.toJSON === 'function' && !(v instanceof Uint8Array) ? v.toJSON() : v);
}
export function arrowInfo(file) {
  const ix = index(file);
  return { total: ix.total, batches: ix.batches.length, format: ix.format, complete: ix.complete };
}
// A read-only file handle for Arrow's random-access reader, served by synchronous positioned reads.
function handle(file) {
  const fd = openSync(file, 'r'),
    size = fstatSync(fd).size;
  return {
    fd,
    async stat() {
      return { size };
    },
    async read(buffer, offset, length, position) {
      return { bytesRead: readSync(fd, buffer, offset, length, position), buffer };
    },
    async close() {},
    done: () => closeSync(fd),
  };
}
async function fileBatches(file, ix, need) {
  const h = handle(file);
  try {
    const reader = await RecordBatchReader.from(h);
    await reader.open();
    const out = [];
    for (const b of need) {
      const i = ix.batches.indexOf(b),
        batch = await reader.readRecordBatch(i);
      if (!batch || batch.numRows !== b.rows) throw new Error('its footer and its record batches disagree');
      out.push(batch);
    }
    return { schema: reader.schema, table: new Table(reader.schema, out) };
  } finally {
    h.done();
  }
}
function streamBatches(file, ix, need) {
  const fd = openSync(file, 'r');
  try {
    const last = need.length ? ix.batches.indexOf(need.at(-1)) : 0,
      parts = [bytes(fd, ix.schema.at, ix.schema.length)];
    // Every dictionary written before the last batch read, in stream order, so replacements and deltas apply as written.
    for (const d of ix.dicts) if (d.before <= last) parts.push(bytes(fd, d.at, d.length));
    for (const b of need) parts.push(bytes(fd, b.at, b.length));
    const sum = parts.reduce((n, p) => n + p.length, 0);
    if (sum > MAX_WINDOW)
      throw new Error(`the record batch that holds these rows is ${(sum / 1048576).toFixed(0)} MiB, over the 256 MiB a window may read; re-export the file with smaller record batches`);
    parts.push(Buffer.from([255, 255, 255, 255, 0, 0, 0, 0]));
    const table = tableFromIPC(Buffer.concat(parts));
    return { schema: table.schema, table };
  } finally {
    closeSync(fd);
  }
}
export async function arrowTable(file, offset = 0, count = 80) {
  const ix = index(file),
    start = Math.max(0, Math.min(offset, Math.max(0, ix.total - 1))),
    end = Math.min(ix.total, start + count),
    need = ix.batches.filter((b) => b.start < end && b.start + b.rows > start);
  if (need.reduce((n, b) => n + b.length, 0) > MAX_WINDOW)
    throw new Error('The record batch that holds these rows is over the 256 MiB a window may read. Next: re-export the file with smaller record batches.');
  let t;
  try {
    t = ix.format === 'file' ? await fileBatches(file, ix, need) : streamBatches(file, ix, need);
  } catch (e) {
    throw new Error(`Arrow could not read this file: ${e.message}. Next: open it in its own application; napkin still shows its metadata and bytes.`);
  }
  const fields = t.schema.fields,
    from = need.length ? start - need[0].start : 0,
    columns = fields.map((_, i) => t.table.getChildAt(i)),
    rows = [];
  for (let r = from; r < Math.min(t.table.numRows, from + (end - start)); r++)
    rows.push(columns.map((c, i) => arrowCell(c.get(r), fields[i].type)));
  const shaped = tableWindow(
    fields.map((f) => f.name),
    rows,
    { declared: fields.map((f) => typeName(f.type)) },
  );
  return {
    ...shaped,
    offset: start,
    rowStart: start,
    total: ix.total,
    batches: ix.batches.length,
    format: ix.format,
    ...(ix.complete ? {} : { note: 'The file ends before its last message; the rows shown are the ones written completely.' }),
  };
}
// A small file read whole (synchronously), for its card.
export function arrowSmall(file, count) {
  const fd = openSync(file, 'r');
  let t;
  try {
    t = tableFromIPC(bytes(fd, 0, fstatSync(fd).size));
  } finally {
    closeSync(fd);
  }
  const fields = t.schema.fields,
    columns = fields.map((_, i) => t.getChildAt(i)),
    rows = [];
  for (let r = 0; r < Math.min(count, t.numRows); r++) rows.push(columns.map((c, i) => arrowCell(c.get(r), fields[i].type)));
  return tableWindow(fields.map((f) => f.name), rows, { declared: fields.map((f) => typeName(f.type)) });
}
