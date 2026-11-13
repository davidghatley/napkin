import { statSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  window,
  delimited,
  table,
  parquetMeta,
  parquetTable,
  zipDirectory,
  zipEntry,
  LIMIT,
} from './readers.js';
import { arrowTable } from './arrow.js';
import { sqliteRows } from './sqlite.js';
const exec = promisify(execFile),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
const serial = (o) => JSON.stringify(o).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028');
export function renderViewer(ctx) {
  const seed = {
    id: ctx.id,
    path: ctx.path,
    kind: ctx.kind,
    family: ctx.definition.family,
    mime: ctx.mime,
    bytes: ctx.bytes,
    meta: ctx.meta,
    recipe: ctx.recipe,
  };
  return `<!doctype html><html lang="en" data-napkin-kind="${esc(ctx.kind)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ctx.path)}</title><link rel="stylesheet" href="/canvas/kind-viewer.css"></head><body><main id="viewer" data-viewer="${esc(ctx.definition.family)}" aria-label="${esc(ctx.path)}"><div class="loading"><strong>${esc(ctx.path.split('/').at(-1))}</strong><span>${esc(ctx.kind)} · ${ctx.bytes.toLocaleString()} bytes</span></div></main><script id="item" type="application/json">${serial(seed)}</script><script type="module" src="/canvas/kind-viewer.js"></script></body></html>`;
}
function jsonData(ctx) {
  if (ctx.bytes > LIMIT)
    throw new Error('JSON preview is limited to the first 1 MiB; use JSONL for streaming records');
  return JSON.parse(ctx.text);
}
function wavPeaks(ctx) {
  const b = window(ctx.file, 0, 8 * LIMIT);
  let at = 12,
    format,
    channels,
    rate,
    bits,
    start,
    length;
  while (at + 8 <= b.length) {
    const type = b.toString('ascii', at, at + 4),
      n = b.readUInt32LE(at + 4);
    if (type === 'fmt ' && n >= 16) {
      format = b.readUInt16LE(at + 8);
      channels = b.readUInt16LE(at + 10);
      rate = b.readUInt32LE(at + 12);
      bits = b.readUInt16LE(at + 22);
    }
    if (type === 'data') {
      start = at + 8;
      length = n;
      break;
    }
    at += 8 + n + (n & 1);
  }
  if (start === undefined || ![1, 3].includes(format) || ![8, 16, 24, 32].includes(bits))
    return null;
  const frame = (channels * bits) / 8,
    frames = Math.floor(Math.min(length, b.length - start) / frame),
    peaks = Array(240).fill(0);
  for (let i = 0; i < frames; i += Math.max(1, Math.floor(frames / 40000))) {
    const p = start + i * frame;
    const v =
      format === 3 && bits === 32
        ? b.readFloatLE(p)
        : bits === 8
          ? (b[p] - 128) / 128
          : b.readIntLE(p, bits / 8) / 2 ** (bits - 1);
    const j = Math.min(239, Math.floor((i / frames) * 240));
    peaks[j] = Math.max(peaks[j], Math.abs(v));
  }
  return {
    peaks,
    duration: length / frame / rate,
    sampledSeconds: frames / rate,
    channels,
    sampleRate: rate,
  };
}
const audioCache = new Map();
async function audio(ctx) {
  const key = ctx.file + ctx.key;
  if (audioCache.has(key)) return audioCache.get(key);
  let result = ctx.kind === 'wav' ? wavPeaks(ctx) : null;
  if (!result) {
    try {
      const { stdout } = await exec(
        'ffmpeg',
        [
          '-v',
          'error',
          '-i',
          ctx.file,
          '-t',
          '60',
          '-ac',
          '1',
          '-ar',
          '800',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { encoding: 'buffer', maxBuffer: 512 * 1024, timeout: 5000 },
      );
      const peaks = Array(240).fill(0),
        n = stdout.length / 4;
      for (let i = 0; i < n; i++) {
        const j = Math.min(239, Math.floor((i / n) * 240));
        peaks[j] = Math.max(peaks[j], Math.abs(stdout.readFloatLE(i * 4)));
      }
      result = { peaks, sampledSeconds: n / 800 };
    } catch {
      result = {
        peaks: [],
        note: 'Decoded waveform unavailable. Playback uses the browser codec.',
      };
    }
  }
  audioCache.set(key, result);
  while (audioCache.size > 30) audioCache.delete(audioCache.keys().next().value);
  return result;
}
function model(ctx) {
  let vertices = [],
    faces = [];
  if (ctx.kind === 'obj') {
    for (const line of ctx.text.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v') vertices.push(parts.slice(1, 4).map(Number));
      if (parts[0] === 'f')
        faces.push(
          parts.slice(1).map((v) => {
            const n = Number(v.split('/')[0]);
            return n < 0 ? vertices.length + n : n - 1;
          }),
        );
      if (vertices.length > 50000 || faces.length > 50000) break;
    }
    return { vertices, faces, limited: ctx.bytes > LIMIT };
  }
  let gltf, bin;
  if (ctx.kind === 'glb') {
    const b = window(ctx.file, 0, 8 * LIMIT);
    if (b.length < 20) throw new Error('Truncated GLB. Next: open the model or archive in its own application, or request a smaller entry.');
    const n = b.readUInt32LE(12);
    if (n > LIMIT) throw new Error('GLB JSON exceeds 1 MiB. Next: open the model or archive in its own application, or request a smaller entry.');
    gltf = JSON.parse(b.toString('utf8', 20, 20 + n).trim());
    const p = 20 + n;
    if (p + 8 <= b.length) bin = b.subarray(p + 8, p + 8 + b.readUInt32LE(p));
  } else gltf = jsonData(ctx);
  const buffers = (gltf.buffers || []).map((b, i) => {
    if (i === 0 && bin) return bin;
    if (b.byteLength > 8 * LIMIT) throw new Error('Model buffer exceeds 8 MiB preview limit. Next: open the model or archive in its own application, or request a smaller entry.');
    if (b.uri?.startsWith('data:'))
      return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
    if (!b.uri || /^(?:https?:|\/)/.test(b.uri))
      throw new Error('Model buffer must be in the opened folder. Next: open the model or archive in its own application, or request a smaller entry.');
    return window(ctx.resolveRelative(b.uri), 0, 8 * LIMIT);
  });
  const accessor = (index) => {
    const a = gltf.accessors[index],
      v = gltf.bufferViews[a.bufferView],
      b = buffers[v.buffer],
      dim = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type],
      width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    if (!dim || !width) throw new Error('Unsupported model accessor. Next: open the model or archive in its own application, or request a smaller entry.');
    const read = (p) => (a.componentType === 5126 ? b.readFloatLE(p) : b.readUIntLE(p, width));
    return Array.from({ length: Math.min(a.count, 50000) }, (_, i) =>
      Array.from({ length: dim }, (_, j) =>
        read(
          (v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || dim * width) + j * width,
        ),
      ),
    );
  };
  for (const mesh of gltf.meshes || [])
    for (const p of mesh.primitives || []) {
      if (p.attributes?.POSITION === undefined) continue;
      const vs = accessor(p.attributes.POSITION),
        base = vertices.length;
      vertices.push(...vs);
      const idx = p.indices === undefined ? vs.map((_, i) => i) : accessor(p.indices).flat();
      for (let i = 0; i + 2 < idx.length; i += 3)
        faces.push(idx.slice(i, i + 3).map((n) => n + base));
    }
  return { vertices, faces };
}
export async function previewData(ctx, query = new URLSearchParams()) {
  const family = ctx.definition.family,
    offset = Math.max(0, Math.trunc(Number(query.get('offset') ?? ctx.recipe.rowOffset ?? 0) || 0)),
    count = Math.min(120, Math.max(1, Number(ctx.recipe.pageSize) || 80));
  if (family === 'audio') return audio(ctx);
  if (family === 'model') return model(ctx);
  if (family === 'zip') {
    const entries = zipDirectory(ctx.file);
    const name = query.get('entry');
    if (name !== null) {
      const e = entries.find((e) => e.name === name);
      if (!e) throw new Error('No archive entry with that name. Next: open the model or archive in its own application, or request a smaller entry.');
      const b = zipEntry(ctx.file, e);
      return {
        name,
        text: b.toString('utf8'),
        hex: b.subarray(0, 4096).toString('hex'),
        binary: b.includes(0),
      };
    }
    return { entries };
  }
  if (family === 'parquet') {
    const meta = parquetMeta(ctx.file);
    try {
      return {
        ...parquetTable(ctx.file, Math.max(0, Number(query.get('group')) || 0)),
        createdBy: meta.createdBy,
      };
    } catch (e) {
      return {
        columns: meta.schema
          .filter((s) => s[1] !== undefined)
          .map((s) => ({
            name: s[4]?.toString(),
            type: ['boolean', 'int32', 'int64', 'int96', 'float', 'double', 'bytes', 'fixed'][s[1]],
            bins: [],
          })),
        rows: [],
        total: meta.rows,
        groups: meta.groups.length,
        note: e.message,
      };
    }
  }
  if (family === 'arrow') return arrowTable(ctx.file, offset, count);
  if (family === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(ctx.file, {
      readOnly: true,
      enableDoubleQuotedStringLiterals: false,
    });
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((r) => r.name);
      const name = query.get('table') || tables[0];
      if (!tables.includes(name)) return { tables, ...table([]) };
      const quoted = '"' + name.replaceAll('"', '""') + '"',
        rows = sqliteRows(db, name, count, offset);
      const total = db.prepare(`SELECT count(*) AS n FROM ${quoted}`).get().n;
      return {
        tables,
        name,
        offset,
        total,
        ...table(
          rows.map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [
                k,
                typeof v === 'bigint'
                  ? String(v)
                  : v instanceof Uint8Array
                    ? Buffer.from(v).toString('hex')
                    : v,
              ]),
            ),
          ),
        ),
      };
    } finally {
      db.close();
    }
  }
  if (family === 'table') {
    let rows,
      headers,
      total = 0;
    const b = window(ctx.file, 0, 8 * LIMIT),
      sample = b.toString('utf8'),
      truncated = b.length < ctx.bytes;
    const text = truncated ? sample.slice(0, Math.max(0, sample.lastIndexOf('\n') + 1)) : sample;
    if (ctx.kind === 'csv' || ctx.kind === 'tsv') {
      const delimiter = ctx.kind === 'tsv' ? '\t' : ',';
      headers = delimited(text, delimiter, { limit: 1 })[0] || [];
      const r = delimited(text, delimiter, { offset: offset + 1, limit: count });
      total = Math.max(0, r.total - 1);
      rows = r.map((a) => Object.fromEntries(headers.map((k, i) => [k, a[i] ?? null])));
    } else {
      rows = [];
      for (const match of text.matchAll(/[^\r\n]+/g)) {
        if (total >= offset && rows.length < count) {
          try {
            rows.push(JSON.parse(match[0]));
          } catch {
            rows.push({ invalid: match[0] });
          }
        }
        total++;
      }
    }
    return { ...table(rows, headers), offset, total: truncated ? null : total, truncated };
  }
  if (family === 'binary') {
    const start = Math.max(0, Number(query.get('offset') ?? ctx.recipe.offset) || 0),
      b = window(ctx.file, start, 4096);
    return {
      offset: start,
      hex: b.toString('hex'),
      strings: [...b.toString('latin1').matchAll(/[\x20-\x7e]{4,}/g)]
        .map((m) => ({ offset: start + m.index, text: m[0] }))
        .slice(0, 100),
    };
  }
  if (['json', 'chart', 'animation', 'notebook', 'graph'].includes(family))
    return { data: jsonData(ctx) };
  if (family === 'timeline') {
    const lines = ctx.text.split(/\r?\n/).filter(Boolean);
    let data;
    try {
      const j = JSON.parse(ctx.text);
      data = Array.isArray(j) ? j : j.events || [j];
    } catch {
      data = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { message: l };
        }
      });
    }
    return { events: data.slice(-150), limited: ctx.bytes > LIMIT };
  }
  return { text: ctx.text, limited: ctx.bytes > LIMIT };
}
