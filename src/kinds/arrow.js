import { window, table, LIMIT } from './readers.js';
import { statSync } from 'node:fs';
// Arrow IPC file metadata is FlatBuffers. Read the footer and requested primitive vectors only.
function fb(b) {
  const i32 = (p) => b.readInt32LE(p),
    u16 = (p) => b.readUInt16LE(p),
    i64 = (p) => Number(b.readBigInt64LE(p));
  const field = (p, n) => {
    const v = p - i32(p),
      slot = v + 4 + 2 * n;
    return slot < v + u16(v) && u16(slot) ? p + u16(slot) : 0;
  };
  const ref = (p) => p + i32(p),
    vec = (p, n) => {
      const f = field(p, n);
      return f ? ref(f) : 0;
    };
  return {
    b,
    field,
    ref,
    vec,
    i64,
    string: (p, n) => {
      const v = vec(p, n);
      return v ? b.toString('utf8', v + 4, v + 4 + i32(v)) : '';
    },
    root: ref(0),
  };
}
export function arrowTable(file, offset = 0, count = 80) {
  const size = statSync(file).size,
    tail = window(file, size - 10, 10);
  if (tail.toString('ascii', 4) !== 'ARROW1')
    throw new Error('Arrow stream files need a stream adapter. Next: convert to the Arrow file format or register a kind plugin.');
  const n = tail.readUInt32LE(0);
  if (n > 8 * LIMIT) throw new Error('Arrow footer exceeds 8 MiB. Next: re-export the file with fewer batches.');
  const f = fb(window(file, size - 10 - n, n)),
    sf = f.field(f.root, 1),
    schema = f.ref(sf),
    fields = f.vec(schema, 1),
    cols = [];
  for (let i = 0; i < Math.min(64, f.b.readInt32LE(fields)); i++) {
    const p = f.ref(fields + 4 + i * 4),
      t = f.field(p, 2),
      tt = f.field(p, 3),
      type = tt ? f.ref(tt) : 0;
    cols.push({
      name: f.string(p, 0),
      type: t ? f.b[t] : 0,
      bits: type && f.field(type, 0) ? f.b.readInt32LE(f.field(type, 0)) : 32,
      signed: type && f.field(type, 1) ? !!f.b[f.field(type, 1)] : true,
    });
  }
  const blocks = f.vec(f.root, 3),
    num = f.b.readInt32LE(blocks);
  if (!num)
    return table(
      [],
      cols.map((c) => c.name),
    );
  let block = 0,
    skip = offset,
    msg,
    batch,
    buffers,
    total = 0,
    bodyAt;
  for (let i = 0; i < num; i++) {
    block = blocks + 4 + i * 24;
    const start = f.i64(block),
      ml = f.b.readInt32LE(block + 8);
    if (ml > 8 * LIMIT) throw new Error('Arrow message exceeds the read limit. Next: re-export the file with smaller batches.');
    const m = window(file, start, ml),
      prefix = m.readInt32LE(0) === -1 ? 8 : 4;
    msg = fb(m.subarray(prefix));
    const headerType = msg.field(msg.root, 1);
    if (!headerType || msg.b[headerType] !== 3)
      throw new Error('Arrow dictionary batches need an adapter. Next: export without dictionary encoding or register a kind plugin.');
    batch = msg.ref(msg.field(msg.root, 2));
    if (msg.field(batch, 3)) throw new Error('Compressed Arrow IPC needs an adapter. Next: export uncompressed or register a kind plugin.');
    const lf = msg.field(batch, 0),
      rows = lf ? msg.i64(lf) : 0;
    total += rows;
    if (skip < rows) {
      bodyAt = start + ml;
      count = Math.min(count, rows - skip);
      break;
    }
    skip -= rows;
  }
  if (bodyAt === undefined)
    return {
      ...table(
        [],
        cols.map((c) => c.name),
      ),
      total: offset,
    };
  buffers = msg.vec(batch, 2);
  let bi = 0;
  const arrays = [];
  const buf = () => {
    const p = buffers + 4 + bi++ * 16;
    return { at: bodyAt + msg.i64(p), length: msg.i64(p + 8) };
  };
  for (const col of cols) {
    if (![2, 3, 4, 5, 6, 8, 10, 19, 20].includes(col.type))
      throw new Error('Nested or dictionary Arrow values need an adapter. Next: flatten the columns or register a kind plugin.');
    const valid = buf(),
      validBits = valid.length
        ? window(file, valid.at + Math.floor(skip / 8), Math.ceil((count + (skip % 8)) / 8))
        : null;
    let values = [];
    if ([4, 5, 19, 20].includes(col.type)) {
      const offsets = buf(),
        data = buf(),
        wide = [19, 20].includes(col.type),
        width = wide ? 8 : 4,
        off = window(file, offsets.at + skip * width, (count + 1) * width),
        read = (i) => (wide ? Number(off.readBigInt64LE(i * width)) : off.readInt32LE(i * width)),
        available = Math.max(0, off.length / width - 1);
      if (available) {
        const start = read(0),
          length = read(available) - start;
        if (length > LIMIT) throw new Error('Arrow text window exceeds 1 MiB. Next: request a smaller row window.');
        const text = window(file, data.at + start, length);
        for (let i = 0; i < available; i++)
          values.push(text.toString('utf8', read(i) - start, read(i + 1) - start));
      }
    } else {
      const data = buf(),
        width =
          col.type === 6
            ? 0
            : col.type === 3
              ? [2, 4, 8][col.bits] || 4
              : col.type === 10
                ? 8
                : Math.max(1, col.bits / 8),
        b = window(
          file,
          data.at + (width ? skip * width : Math.floor(skip / 8)),
          width ? count * width : Math.ceil((count + (skip % 8)) / 8),
        );
      for (
        let i = 0;
        i < count && (width ? (i + 1) * width <= b.length : i < b.length * 8 - (skip % 8));
        i++
      ) {
        let v;
        if (col.type === 6) v = !!((b[(i + (skip % 8)) >> 3] >> ((i + (skip % 8)) & 7)) & 1);
        else if (col.type === 3)
          v = width === 8 ? b.readDoubleLE(i * width) : b.readFloatLE(i * width);
        else if (width === 8)
          v = Number(col.signed ? b.readBigInt64LE(i * 8) : b.readBigUInt64LE(i * 8));
        else v = col.signed ? b.readIntLE(i * width, width) : b.readUIntLE(i * width, width);
        values.push(v);
      }
    }
    if (validBits)
      values = values.map((v, i) =>
        (validBits[(i + (skip % 8)) >> 3] >> ((i + (skip % 8)) & 7)) & 1 ? v : null,
      );
    arrays.push(values);
  }
  return {
    ...table(
      Array.from({ length: Math.max(0, ...arrays.map((a) => a.length)) }, (_, i) =>
        Object.fromEntries(cols.map((c, j) => [c.name, arrays[j][i]])),
      ),
    ),
    offset,
    total,
    batches: num,
  };
}
