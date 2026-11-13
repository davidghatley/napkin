import { fontInfo } from './fontinfo.js';
import { parseGltf, parseObj } from './gltf.js';
import { flattenScene } from '../../public/canvas/model-view.js';
import { decodeText } from './registry.js';
import { delimited, table, zipDirectory, parquetMeta, window } from './readers.js';
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
  // The card draws a chart from its own specification, so the spec travels with the metadata.
  if (family === 'chart' && j) result.spec = j;
  if (family === 'model' && ctx.bytes <= 4 * 1024 * 1024) {
    try {
      const scene =
        ctx.kind === 'obj'
          ? parseObj(text, ctx.bytes > b.length)
          : parseGltf(ctx, () => j ?? JSON.parse(decodeText(window(ctx.file, 0, 4 * 1024 * 1024))));
      result.mesh = flattenScene(scene, 500);
      result.mesh.animated = scene.animations.length > 0;
    } catch (e) {
      result.previewNote = e.message;
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
  if (family === 'font' && ctx.file) {
    const info = fontInfo(ctx.file);
    if (info) Object.assign(result, { glyphs: info.glyphs, tables: info.tables });
  }
  if (family === 'pdf') {
    result.documentText = [...text.matchAll(/\(([^()]{3,160})\)\s*Tj/g)]
      .slice(0, 8)
      .map((m) => m[1]);
  }
  return result;
}
