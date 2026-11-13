// Parquet through hyparquet (src/vendor/hyparquet, MIT): the format's own reader, not a miniature of it. Any row of the file is
// reachable: a request for rows [offset, offset+n) reads only the row groups that hold them, column chunk by column chunk,
// through byte ranges of the file. Compression codecs napkin has in Node (gzip, brotli) are plugged in; snappy ships with the reader.
import { statSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { gunzipSync, brotliDecompressSync, zstdDecompressSync } from 'node:zlib';
import { parquetMetadata, parquetReadObjects } from '../vendor/hyparquet/index.js';
import { tableWindow } from './cells.js';

const zstd = typeof zstdDecompressSync === 'function' ? { ZSTD: (input, length) => new Uint8Array(zstdDecompressSync(input, { maxOutputLength: Math.max(length, 1) + 1024 })) } : {};
const compressors = {
  GZIP: (input, length) => new Uint8Array(gunzipSync(input, { maxOutputLength: Math.max(length, 1) + 1024 })),
  ...zstd,
  BROTLI: (input, length) => new Uint8Array(brotliDecompressSync(input, { maxOutputLength: Math.max(length, 1) + 1024 })),
};
const metas = new Map();

// hyparquet asks for byte ranges through an async slice(); positioned synchronous reads on one read-only descriptor answer them.
function fileBuffer(file) {
  const fd = openSync(file, 'r'),
    size = fstatSync(fd).size;
  return {
    close: () => closeSync(fd),
    buffer: {
      byteLength: size,
      async slice(start, end = size) {
        const n = Math.max(0, Math.min(end, size) - start),
          b = Buffer.alloc(n);
        if (n) readSync(fd, b, 0, n, start);
        return b.buffer.slice(b.byteOffset, b.byteOffset + n);
      },
    },
  };
}

// The footer only (a few KiB at the end of the file), read synchronously and cached per file revision.
export function parquetInfo(file) {
  const st = statSync(file),
    key = `${file}:${st.size}:${st.mtimeMs}`;
  if (!metas.has(key)) {
    if (st.size < 12) throw new Error('Parquet footer is missing. Next: check the file is complete, or open it in its own application');
    const fd = openSync(file, 'r');
    try {
      const tail = Buffer.alloc(8);
      readSync(fd, tail, 0, 8, st.size - 8);
      const len = tail.readUInt32LE(0);
      if (tail.toString('latin1', 4) !== 'PAR1' || len + 8 > st.size) throw new Error('Parquet footer is missing. Next: check the file is complete, or open it in its own application');
      if (len > 64 * 1024 * 1024) throw new Error('Parquet footer exceeds 64 MiB. Next: open the file in its own application');
      const foot = Buffer.alloc(len + 8);
      readSync(fd, foot, 0, len + 8, st.size - len - 8);
      const metadata = parquetMetadata(foot.buffer.slice(foot.byteOffset, foot.byteOffset + foot.length));
      let at = 0;
      const starts = metadata.row_groups.map((g) => {
        const s = at;
        at += Number(g.num_rows);
        return s;
      });
      const leaves = metadata.schema.slice(1).filter((x) => !x.num_children);
      metas.set(key, { metadata, starts, rows: Number(metadata.num_rows), leaves });
      while (metas.size > 8) metas.delete(metas.keys().next().value);
    } finally {
      closeSync(fd);
    }
  }
  return metas.get(key);
}

// Values arrive typed (INT64 as bigint, timestamps as Date, byte arrays as bytes); cellText writes each as its exact text.
const declaredType = (s) => String(s.logical_type?.type || s.converted_type || s.type || '').toLowerCase();

// The 120 rows (at most) from `offset`, with the typed columns computed over that window.
export async function parquetRows(file, offset = 0, count = 120) {
  const info = parquetInfo(file),
    start = Math.max(0, Math.min(info.rows ? info.rows - 1 : 0, offset)),
    end = Math.min(info.rows, start + count),
    { close, buffer } = fileBuffer(file);
  try {
    let rows = [];
    try {
      if (start < end) rows = await parquetReadObjects({ file: buffer, metadata: info.metadata, rowStart: start, rowEnd: end, compressors, utf8: true });
    } catch (e) {
      throw new Error(`${e.message}. Next: open the file in its own application; napkin still shows its metadata and bytes.`);
    }
    // Rows come back keyed by top-level column, so the columns are read positionally from the schema's top level.
    const top = info.metadata.schema.slice(1).filter((x, i, all) => isTop(all, i)),
      out = tableWindow(
        top.map((s) => s.name),
        rows.map((r) => top.map((s) => r[s.name])),
        { declared: top.map((s) => (s.num_children ? 'nested' : declaredType(s))) },
      );
    let g = info.starts.findLastIndex((s) => s <= start);
    return {
      ...out,
      total: info.rows,
      groups: info.metadata.row_groups.length,
      group: Math.max(0, g),
      offset: start,
      rowStart: start,
      createdBy: info.metadata.created_by,
    };
  } finally {
    close();
  }
}

// The schema is a flattened tree: a node with num_children is followed by its descendants.
function isTop(all, i) {
  let at = 0;
  while (at < all.length) {
    if (at === i) return true;
    if (at > i) return false;
    at = skip(all, at);
  }
  return false;
}
function skip(all, at) {
  let n = all[at].num_children || 0;
  at++;
  while (n-- > 0) at = skip(all, at);
  return at;
}
