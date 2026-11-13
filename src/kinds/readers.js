// Bounded random-access readers. No reader may allocate from an untrusted length without a cap.
import { openSync, closeSync, readSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
export const LIMIT = 1024 * 1024;
export function window(file, start = 0, length = 65536) {
  const size = statSync(file).size;
  start = Math.max(0, Math.min(size, start));
  length = Math.max(0, Math.min(length, 8 * LIMIT, size - start));
  const b = Buffer.alloc(length),
    fd = openSync(file, 'r');
  try {
    const n = readSync(fd, b, 0, length, start);
    return b.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}
export function delimited(text, delimiter = ',', { offset = 0, limit = Infinity } = {}) {
  const rows = [];
  let row = [],
    cell = '',
    quote = false,
    count = 0;
  const push = () => {
    if (count++ >= offset && rows.length < limit) rows.push(row);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quote = false;
      else cell += c;
    } else if (c === '"' && !cell) quote = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      push();
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    push();
  }
  Object.defineProperty(rows, 'total', { value: count });
  return rows;
}
export const scalar = (v) =>
  v === '' || v === null
    ? null
    : typeof v !== 'string'
      ? v
      : /^(true|false)$/.test(v)
        ? v === 'true'
        : /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v) && Number.isFinite(Number(v))
          ? Number(v)
          : v;
export function table(rows, headers) {
  const keys = headers || [...new Set(rows.flatMap((r) => Object.keys(r || {})))].slice(0, 64);
  const data = rows.slice(0, 120).map((r) => keys.map((k) => scalar(r?.[k] ?? null)));
  const columns = keys.map((name, i) => {
    const values = data.map((r) => r[i]).filter((v) => v !== null),
      nums = values.filter((v) => typeof v === 'number');
    const type =
      nums.length === values.length && values.length
        ? 'number'
        : values.every((v) => typeof v === 'boolean') && values.length
          ? 'boolean'
          : values.length &&
              values.every(
                (v) =>
                  typeof v === 'string' &&
                  /^\d{4}-\d\d-\d\d/.test(v) &&
                  Number.isFinite(Date.parse(v)),
              )
            ? 'date'
            : 'string';
    const counts = new Map();
    for (const v of values) {
      const s = String(v);
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    const min = nums.length ? Math.min(...nums) : null,
      max = nums.length ? Math.max(...nums) : null;
    const bins = Array(16).fill(0);
    for (const n of nums)
      bins[max === min ? 0 : Math.min(15, Math.floor(((n - min) / (max - min)) * 16))]++;
    return {
      name,
      type,
      missing: data.length - values.length,
      min,
      max,
      bins: type === 'number' ? bins : [...counts.values()].sort((a, b) => b - a).slice(0, 16),
      distinct: counts.size,
    };
  });
  return { columns, rows: data, sampled: data.length };
}
export function zipDirectory(file) {
  const size = statSync(file).size,
    tail = window(file, Math.max(0, size - 65557), 65557);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('ZIP end directory is missing. Next: open the file in its own application; napkin still shows its metadata and bytes.');
  const count = tail.readUInt16LE(end + 10),
    length = tail.readUInt32LE(end + 12),
    offset = tail.readUInt32LE(end + 16);
  if (length > 8 * LIMIT || count === 65535)
    throw new Error('ZIP64 or a directory over 8 MiB needs an archive adapter. Next: open the file in its own application; napkin still shows its metadata and bytes.');
  const b = window(file, offset, length),
    entries = [];
  for (let at = 0; at + 46 <= b.length && entries.length < count;) {
    if (b.readUInt32LE(at) !== 0x02014b50) break;
    const n = b.readUInt16LE(at + 28),
      x = b.readUInt16LE(at + 30),
      c = b.readUInt16LE(at + 32);
    entries.push({
      name: b.toString('utf8', at + 46, at + 46 + n),
      method: b.readUInt16LE(at + 10),
      compressed: b.readUInt32LE(at + 20),
      bytes: b.readUInt32LE(at + 24),
      offset: b.readUInt32LE(at + 42),
      encrypted: !!(b.readUInt16LE(at + 8) & 1),
    });
    at += 46 + n + x + c;
  }
  return entries;
}
export function zipEntry(file, entry) {
  if (entry.bytes > LIMIT || entry.compressed > LIMIT || entry.encrypted)
    throw new Error('Preview is limited to unencrypted entries under 1 MiB. Next: open the file in its own application; napkin still shows its metadata and bytes.');
  const h = window(file, entry.offset, 30);
  if (h.length < 30 || h.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid ZIP entry. Next: open the file in its own application; napkin still shows its metadata and bytes.');
  const b = window(
    file,
    entry.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28),
    entry.compressed,
  );
  if (entry.method === 0) return b;
  if (entry.method === 8) return inflateRawSync(b, { maxOutputLength: LIMIT });
  throw new Error('This ZIP compression method has no preview decoder. Next: open the file in its own application; napkin still shows its metadata and bytes.');
}
