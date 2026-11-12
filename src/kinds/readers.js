// Bounded random-access readers. No reader may allocate from an untrusted length without a cap.
import { openSync, closeSync, readSync, statSync } from 'node:fs';
import { inflateRawSync, gunzipSync, brotliDecompressSync } from 'node:zlib';
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
  if (end < 0) throw new Error('ZIP end directory is missing');
  const count = tail.readUInt16LE(end + 10),
    length = tail.readUInt32LE(end + 12),
    offset = tail.readUInt32LE(end + 16);
  if (length > 8 * LIMIT || count === 65535)
    throw new Error('ZIP64 or a directory over 8 MiB needs an archive adapter');
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
    throw new Error('Preview is limited to unencrypted entries under 1 MiB');
  const h = window(file, entry.offset, 30);
  if (h.length < 30 || h.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid ZIP entry');
  const b = window(
    file,
    entry.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28),
    entry.compressed,
  );
  if (entry.method === 0) return b;
  if (entry.method === 8) return inflateRawSync(b, { maxOutputLength: LIMIT });
  throw new Error('This ZIP compression method has no preview decoder');
}
// Thrift compact protocol, used for the Parquet footer and page headers.
export function compact(b, start = 0) {
  let at = start;
  const byte = () => {
    if (at >= b.length) throw new Error('Truncated Parquet metadata');
    return b[at++];
  };
  const vint = () => {
    let x = 0n,
      shift = 0n;
    for (let i = 0; i < 10; i++) {
      const v = byte();
      x |= BigInt(v & 127) << shift;
      if (!(v & 128)) return x;
      shift += 7n;
    }
    throw new Error('Invalid integer');
  };
  const signed = () => {
    const n = vint();
    return Number((n >> 1n) ^ -(n & 1n));
  };
  const value = (t) => {
    if (t === 1) return true;
    if (t === 2) return false;
    if (t === 3) return byte();
    if (t === 4 || t === 5 || t === 6) return signed();
    if (t === 7) {
      if (at + 8 > b.length) throw new Error('Truncated double');
      const n = b.readDoubleLE(at);
      at += 8;
      return n;
    }
    if (t === 8) {
      const n = Number(vint());
      if (n > 8 * LIMIT || at + n > b.length) throw new Error('Invalid binary length');
      const r = b.subarray(at, at + n);
      at += n;
      return r;
    }
    if (t === 9 || t === 10) {
      const h = byte(),
        n = h >> 4 === 15 ? Number(vint()) : h >> 4;
      if (n > 100000) throw new Error('Metadata list too long');
      return Array.from({ length: n }, () => value(h & 15));
    }
    if (t === 11) {
      const n = Number(vint());
      if (n > 10000) throw new Error('Metadata map too long');
      if (!n) return [];
      const h = byte();
      return Array.from({ length: n }, () => [value(h >> 4), value(h & 15)]);
    }
    if (t === 12) {
      const o = {};
      let id = 0;
      for (;;) {
        const h = byte();
        if (!h) break;
        id = h >> 4 ? id + (h >> 4) : signed();
        o[id] = value(h & 15);
      }
      return o;
    }
    throw new Error('Unknown compact type');
  };
  const result = value(12);
  return { value: result, bytes: at - start };
}
export function parquetMeta(file) {
  const size = statSync(file).size,
    tail = window(file, Math.max(0, size - 8), 8);
  if (tail.length !== 8 || tail.toString('ascii', 4) !== 'PAR1')
    throw new Error('Parquet footer is missing');
  const length = tail.readUInt32LE(0);
  if (length > 8 * LIMIT || length > size - 8) throw new Error('Parquet footer exceeds 8 MiB');
  const meta = compact(window(file, size - 8 - length, length)).value;
  return {
    rows: meta[3],
    schema: meta[2],
    groups: meta[4] || [],
    createdBy: meta[6]?.toString(),
    footer: meta,
  };
}
function snappy(b) {
  let at = 0,
    size = 0,
    s = 0;
  for (;;) {
    const n = b[at++];
    size |= (n & 127) << s;
    if (!(n & 128)) break;
    s += 7;
    if (s > 28) throw new Error('Invalid Snappy size');
  }
  if (size > 8 * LIMIT) throw new Error('Snappy page exceeds 8 MiB');
  const out = Buffer.alloc(size);
  let p = 0;
  while (at < b.length && p < size) {
    const tag = b[at++],
      kind = tag & 3;
    let n = 0,
      offset = 0;
    if (!kind) {
      n = tag >> 2;
      if (n < 60) n++;
      else {
        const bytes = n - 59;
        if (bytes > 4) throw new Error('Invalid Snappy literal');
        n = b.readUIntLE(at, bytes) + 1;
        at += bytes;
      }
      if (at + n > b.length || p + n > size) throw new Error('Truncated Snappy literal');
      b.copy(out, p, at, at + n);
      at += n;
      p += n;
    } else {
      if (kind === 1) {
        n = 4 + ((tag >> 2) & 7);
        offset = ((tag & 224) << 3) | b[at++];
      } else {
        n = 1 + (tag >> 2);
        const k = kind === 2 ? 2 : 4;
        offset = b.readUIntLE(at, k);
        at += k;
      }
      if (offset < 1 || offset > p || p + n > size) throw new Error('Invalid Snappy copy');
      for (let i = 0; i < n; i++) out[p + i] = out[p + i - offset];
      p += n;
    }
  }
  return out;
}
function unpack(b, width, count, start = 0) {
  let bit = start * 8;
  const out = [];
  for (let i = 0; i < count; i++) {
    let v = 0;
    for (let j = 0; j < width; j++, bit++) v += ((b[bit >> 3] >> (bit & 7)) & 1) * 2 ** j;
    out.push(v);
  }
  return out;
}
function hybrid(b, width, count) {
  let at = 0;
  const out = [];
  const vi = () => {
    let v = 0,
      s = 0;
    for (;;) {
      if (at >= b.length) throw new Error('Truncated RLE');
      const n = b[at++];
      v += (n & 127) * 2 ** s;
      if (!(n & 128)) return v;
      s += 7;
      if (s > 49) throw new Error('Invalid RLE');
    }
  };
  while (at < b.length && out.length < count) {
    const h = vi();
    if (!h) break;
    if (h & 1) {
      const n = (h >> 1) * 8,
        bytes = Math.ceil((n * width) / 8);
      out.push(...unpack(b.subarray(at, at + bytes), width, Math.min(n, count - out.length)));
      at += bytes;
    } else {
      const bytes = Math.ceil(width / 8),
        v = bytes ? b.readUIntLE(at, bytes) : 0;
      at += bytes;
      for (let i = 0; i < h >> 1 && out.length < count; i++) out.push(v);
    }
  }
  return out;
}
function plain(b, type, count) {
  const out = [];
  let at = 0;
  for (let i = 0; i < count && at < b.length; i++) {
    let v;
    if (type === 0) {
      v = !!((b[i >> 3] >> (i & 7)) & 1);
      if (i === count - 1) at = b.length;
    } else if (type === 1) {
      v = b.readInt32LE(at);
      at += 4;
    } else if (type === 2) {
      v = Number(b.readBigInt64LE(at));
      at += 8;
    } else if (type === 4) {
      v = b.readFloatLE(at);
      at += 4;
    } else if (type === 5) {
      v = b.readDoubleLE(at);
      at += 8;
    } else if (type === 6) {
      const n = b.readUInt32LE(at);
      at += 4;
      if (n > LIMIT || at + n > b.length) throw new Error('Invalid Parquet string');
      v = b.toString('utf8', at, at + n);
      at += n;
    } else throw new Error('This Parquet physical type needs an adapter');
    out.push(v);
  }
  return out;
}
// Read only pages needed for the requested row-group sample. Supports flat primitive V1/V2 pages.
export function parquetTable(file, groupIndex = 0) {
  const m = parquetMeta(file),
    g = m.groups[groupIndex];
  if (!g) return { ...table([]), total: m.rows };
  const cols = [],
    arrays = [];
  for (const column of (g[1] || []).slice(0, 64)) {
    const c = column[3];
    if (!c) continue;
    const name = (c[3] || []).map((x) => x.toString()).join('.');
    cols.push(name);
    const schema = m.schema.find((s) => s[4]?.toString() === name);
    if (c[3]?.length !== 1 || schema?.[3] === 2)
      throw new Error('Nested Parquet columns need an adapter');
    const offset = Math.min(c[9] ?? Infinity, c[11] ?? Infinity),
      length = Math.min(c[7] || LIMIT, 8 * LIMIT);
    const b = window(file, offset, length);
    let at = 0,
      dict = null,
      values = [];
    while (at < b.length && values.length < 120) {
      const h = compact(b, at);
      at += h.bytes;
      const p = h.value,
        n = p[3];
      if (n < 0 || n > 8 * LIMIT || at + n > b.length)
        throw new Error('Parquet page exceeds preview window');
      let page = b.subarray(at, at + n);
      at += n;
      const decode = (x) =>
        c[4] === 0
          ? x
          : c[4] === 1
            ? snappy(x)
            : c[4] === 2
              ? gunzipSync(x, { maxOutputLength: 8 * LIMIT })
              : c[4] === 4
                ? brotliDecompressSync(x, { maxOutputLength: 8 * LIMIT })
                : (() => {
                    throw new Error('This Parquet compression codec needs an adapter');
                  })();
      if (p[1] === 2) {
        dict = plain(decode(page), c[1], p[7][1]);
        continue;
      }
      if (p[1] !== 0 && p[1] !== 3) continue;
      let count,
        enc,
        defs = null;
      if (p[1] === 0) {
        page = decode(page);
        count = p[5][1];
        enc = p[5][2];
        if (schema?.[3] === 1) {
          const n = page.readUInt32LE(0);
          defs = hybrid(page.subarray(4, 4 + n), 1, Math.min(count, 120));
          page = page.subarray(4 + n);
        }
      } else {
        const ph = p[8];
        count = ph[1];
        enc = ph[4];
        const dl = ph[5],
          rl = ph[6];
        if (schema?.[3] === 1) defs = hybrid(page.subarray(rl, rl + dl), 1, Math.min(count, 120));
        const data = page.subarray(rl + dl);
        page = ph[7] === false ? data : decode(data);
      }
      const take = Math.min(count, 120 - values.length),
        nonnull = defs ? defs.slice(0, take).filter(Boolean).length : take;
      const decoded =
        enc === 0
          ? plain(page, c[1], nonnull)
          : (enc === 8 || enc === 2) && dict
            ? hybrid(page.subarray(1), page[0], nonnull).map((i) => dict[i])
            : (() => {
                throw new Error('This Parquet encoding needs an adapter');
              })();
      let j = 0;
      for (let i = 0; i < take; i++) values.push(defs && !defs[i] ? null : (decoded[j++] ?? null));
    }
    arrays.push(values);
  }
  const rows = Array.from({ length: Math.max(0, ...arrays.map((a) => a.length)) }, (_, i) =>
    Object.fromEntries(cols.map((k, j) => [k, arrays[j][i]])),
  );
  return { ...table(rows, cols), total: m.rows, groups: m.groups.length, group: groupIndex };
}
