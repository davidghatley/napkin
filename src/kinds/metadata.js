import { delimited, table, zipDirectory, parquetMeta } from './readers.js';
import { DatabaseSync } from 'node:sqlite';
import { arrowTable } from './arrow.js';
import { sqliteRows } from './sqlite.js';
// Small, source-derived previews let a zoomed-out folder remain useful without 1,000 browsing contexts.
export function cardMetadata(ctx, family) {
  const b = ctx.head,
    text = ctx.text,
    result = {};
  let j;
  try {
    if (ctx.bytes <= 65536) j = JSON.parse(text);
  } catch {}
  if (family === 'table') {
    let rows, headers;
    if (ctx.kind === 'csv' || ctx.kind === 'tsv') {
      const parsed = delimited(text, ctx.kind === 'tsv' ? '\t' : ',', { limit: 101 });
      if (ctx.bytes > b.length) parsed.pop();
      headers = parsed.shift() || [];
      rows = parsed
        .slice(0, 100)
        .map((r) => Object.fromEntries(headers.map((k, i) => [k, r[i] ?? null])));
    } else
      rows = text
        .split('\n')
        .filter(Boolean)
        .slice(0, 100)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    const t = table(rows, headers);
    result.table = {
      columns: t.columns.slice(0, 8),
      rows: t.rows.slice(0, 6).map((r) => r.slice(0, 8)),
    };
  }
  if (family === 'parquet') {
    const p = parquetMeta(ctx.file);
    result.table = {
      columns: p.schema
        .filter((s) => s[1] !== undefined)
        .map((s) => ({
          name: s[4]?.toString(),
          type: ['boolean', 'int32', 'int64', 'int96', 'float', 'double', 'bytes', 'fixed'][s[1]],
          bins: [],
        })),
      rows: [],
    };
    result.summary = `${p.rows.toLocaleString()} rows · ${p.groups.length} row groups`;
  }
  if (family === 'arrow') {
    const t = arrowTable(ctx.file, 0, 8);
    result.table = { columns: t.columns, rows: t.rows };
    result.summary = t.batches + ' record batches';
  }
  if (family === 'sqlite') {
    const db = new DatabaseSync(ctx.file, { readOnly: true });
    try {
      const name = db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
        )
        .get()?.name;
      if (name) {
        const rows = sqliteRows(db, name, 8);
        const t = table(
          rows.map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [
                k,
                typeof v === 'bigint'
                  ? String(v)
                  : v instanceof Uint8Array
                    ? '[' + v.length + ' bytes]'
                    : v,
              ]),
            ),
          ),
        );
        result.table = { columns: t.columns, rows: t.rows };
        result.summary = name;
      }
    } finally {
      db.close();
    }
  }
  if (family === 'zip') {
    const entries = zipDirectory(ctx.file);
    result.archive = entries.slice(0, 9).map(({ name, bytes }) => ({ name, bytes }));
    result.summary = entries.length + ' entries';
  }
  if (family === 'graph' && j) {
    const nodes = Array.isArray(j.nodes)
      ? j.nodes
      : Object.entries(j)
          .filter(([, v]) => v?.class_type)
          .map(([id, v], i) => ({
            id,
            type: v.class_type,
            pos: [(i % 3) * 220, Math.floor(i / 3) * 120],
          }));
    result.graph = {
      nodes: nodes
        .slice(0, 16)
        .map((n) => ({ id: n.id, title: n.title || n.type || n.class_type, pos: n.pos })),
      links: (j.links || []).slice(0, 30),
    };
  }
  if (family === 'notebook' && j)
    result.cells = (j.cells || []).slice(0, 5).map((c) => ({
      type: c.cell_type,
      text: (Array.isArray(c.source) ? c.source.join('') : c.source || '').slice(0, 180),
      count: c.execution_count,
    }));
  if (family === 'timeline')
    result.events = text
      .split('\n')
      .filter(Boolean)
      .slice(0, 6)
      .flatMap((line) => {
        try {
          const e = JSON.parse(line);
          return [
            {
              type: e.role || e.type || e.event,
              text:
                typeof e.content === 'string'
                  ? e.content
                  : e.message || e.text || JSON.stringify(e.content || e),
              time: e.timestamp || e.time || e.at,
            },
          ];
        } catch {
          return [];
        }
      });
  if (family === 'chart' && j) {
    const rows =
      j.data?.values || j.values || j.series?.[0]?.values || j.series?.[0]?.data || j.series || [];
    const x = j.encoding?.x?.field,
      y = j.encoding?.y?.field;
    result.chart = {
      title: j.title,
      mark: typeof j.mark === 'object' ? j.mark.type : j.mark || j.type || 'bar',
      points: Array.isArray(rows)
        ? rows
            .slice(0, 40)
            .map((v, i) => ({ x: v[x] ?? v.x ?? i, y: Number(v[y] ?? v.y ?? v.value ?? v) }))
            .filter((p) => Number.isFinite(p.y))
        : [],
    };
  }
  if (family === 'model' && ctx.kind === 'obj') {
    const vertices = [],
      faces = [];
    for (const line of text.split('\n')) {
      const p = line.trim().split(/\s+/);
      if (p[0] === 'v' && vertices.length < 2000) vertices.push(p.slice(1, 4).map(Number));
      if (p[0] === 'f' && faces.length < 1000)
        faces.push(
          p.slice(1).map((v) => {
            const n = Number(v.split('/')[0]);
            return n < 0 ? vertices.length + n : n - 1;
          }),
        );
    }
    result.mesh = { vertices, faces };
  }
  if (family === 'model' && ['glb', 'gltf'].includes(ctx.kind)) {
    let g = j,
      bin;
    if (ctx.kind === 'glb' && b.length > 20) {
      const n = b.readUInt32LE(12);
      if (n < 60000) {
        g = JSON.parse(b.toString('utf8', 20, 20 + n).trim());
        bin = b.subarray(28 + n);
      }
    }
    if (g) {
      const buffers = (g.buffers || []).map((v, i) =>
          i === 0 && bin
            ? bin
            : v.uri?.startsWith('data:')
              ? Buffer.from(v.uri.slice(v.uri.indexOf(',') + 1), 'base64')
              : null,
        ),
        vertices = [],
        faces = [];
      const accessor = (index) => {
        const a = g.accessors[index],
          view = g.bufferViews[a.bufferView],
          data = buffers[view.buffer];
        if (!data) return [];
        const dim = a.type === 'VEC3' ? 3 : 1,
          width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
        if (!width) return [];
        const out = [];
        for (let i = 0; i < Math.min(2000, a.count); i++) {
          const p =
            (view.byteOffset || 0) + (a.byteOffset || 0) + i * (view.byteStride || width * dim);
          if (p + width * dim > data.length) break;
          out.push(
            Array.from({ length: dim }, (_, n) =>
              a.componentType === 5126
                ? data.readFloatLE(p + n * width)
                : data.readUIntLE(p + n * width, width),
            ),
          );
        }
        return out;
      };
      for (const mesh of g.meshes || [])
        for (const p of mesh.primitives || []) {
          if (p.attributes?.POSITION === undefined) continue;
          const vs = accessor(p.attributes.POSITION),
            base = vertices.length;
          vertices.push(...vs);
          const idx = p.indices === undefined ? vs.map((_, i) => i) : accessor(p.indices).flat();
          for (let i = 0; i + 2 < idx.length; i += 3)
            faces.push(idx.slice(i, i + 3).map((v) => v + base));
        }
      result.mesh = { vertices, faces };
    }
  }
  if (family === 'animation' && j) {
    result.animation = {
      kind: ctx.kind,
      width: j.w,
      height: j.h,
      text: j.text,
      shapes: j.layers
        ?.flatMap((l) => l.shapes || [])
        .filter((s) => ['el', 'rc'].includes(s.ty))
        .slice(0, 10)
        .map((s) => ({ type: s.ty, size: s.s?.k, position: s.p?.k })),
      fill: j.layers?.flatMap((l) => l.shapes || []).find((s) => s.ty === 'fl')?.c?.k,
    };
  }
  if (family === 'audio' && ctx.kind === 'wav') {
    let at = 12,
      start,
      bits,
      channels,
      format;
    while (at + 24 <= b.length) {
      const tag = b.toString('ascii', at, at + 4),
        n = b.readUInt32LE(at + 4);
      if (tag === 'fmt ') {
        format = b.readUInt16LE(at + 8);
        channels = b.readUInt16LE(at + 10);
        bits = b.readUInt16LE(at + 22);
      }
      if (tag === 'data') {
        start = at + 8;
        break;
      }
      at += 8 + n + (n & 1);
    }
    if (start && format === 1 && [8, 16, 24, 32].includes(bits)) {
      const peaks = Array(100).fill(0),
        width = bits / 8,
        frames = Math.floor((b.length - start) / (width * channels));
      for (let i = 0; i < frames; i += Math.max(1, Math.floor(frames / 8000))) {
        const p = start + i * width * channels,
          v = width === 1 ? (b[p] - 128) / 128 : b.readIntLE(p, width) / 2 ** (bits - 1);
        const k = Math.min(99, Math.floor((i / frames) * 100));
        peaks[k] = Math.max(peaks[k], Math.abs(v));
      }
      result.peaks = peaks;
    }
  }
  if (family === 'binary')
    result.strings = [...b.toString('latin1').matchAll(/[\x20-\x7e]{5,}/g)]
      .slice(0, 5)
      .map((m) => m[0].slice(0, 60));
  if (family === 'pdf') {
    result.documentText = [...text.matchAll(/\(([^()]{3,160})\)\s*Tj/g)]
      .slice(0, 8)
      .map((m) => m[1]);
  }
  return result;
}
