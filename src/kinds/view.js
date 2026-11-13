import { parquetInfo, parquetRows } from './parquet.js';
import { statSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { window, zipDirectory, zipEntry, LIMIT } from './readers.js';
import { tableWindow, recordsToRows, parseExact } from './cells.js';
import { decodeText } from './registry.js';
import { arrowTable } from './arrow.js';
import { sqliteRows } from './sqlite.js';
import { parseGltf, parseObj } from './gltf.js';
import { utf16, buildIndex, readRecords } from './rowindex.js';
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
// At most three decoders run at once, however many cards ask.
let running = 0;
const waiting = [];
async function limited(fn) {
  if (running >= 3) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
const audioCache = new Map();
async function audio(ctx) {
  const key = ctx.file + ctx.key;
  if (audioCache.has(key)) return audioCache.get(key);
  let result = ctx.kind === 'wav' ? wavPeaks(ctx) : null;
  if (!result) {
    try {
      // Sample rate follows the length so a long file stays within the buffer: 8 kHz for short files, down to 2 kHz.
      let seconds = 0;
      try {
        seconds = Number((await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ctx.file], { timeout: 4000 })).stdout) || 0;
      } catch {}
      const rate = seconds ? Math.max(2000, Math.min(8000, Math.floor(96e6 / 4 / seconds))) : 4000;
      const decode = (extra, timeout) => limited(() => exec(
        'ffmpeg',
        [
          '-v',
          'error',
          '-i',
          ctx.file,
          ...extra,
          '-ac',
          '1',
          '-ar',
          String(rate),
          '-f',
          'f32le',
          'pipe:1',
        ],
        { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, timeout },
      ));
      // The whole file when it decodes in time, otherwise its first minute.
      let out;
      try {
        out = (await decode([], 20000)).stdout;
      } catch {
        out = (await decode(['-t', '60'], 8000)).stdout;
      }
      const peaks = Array(240).fill(0),
        n = Math.floor(out.length / 4);
      for (let i = 0; i < n; i++) {
        const j = Math.min(239, Math.floor((i / n) * 240));
        peaks[j] = Math.max(peaks[j], Math.abs(out.readFloatLE(i * 4)));
      }
      result = { peaks, sampledSeconds: n / rate };
    } catch {
      result = {
        peaks: [],
        note: 'Decoded waveform unavailable. Playback uses the browser codec.',
      };
    }
  }
  audioCache.set(key, result);
  while (audioCache.size > 300) audioCache.delete(audioCache.keys().next().value);
  return result;
}
function model(ctx) {
  if (ctx.kind === 'obj') return parseObj(ctx.text, ctx.bytes > LIMIT);
  return parseGltf(ctx, () => {
    if (ctx.bytes > 8 * LIMIT) throw new Error('This glTF description is over 8 MiB. Next: open the model in its own application, or request a smaller entry.');
    return JSON.parse(decodeText(window(ctx.file, 0, 8 * LIMIT)));
  });
}
// A PDF page is drawn by poppler into a PNG; headless and embedded browsers have no PDF plugin.
const pdfCache = new Map();
async function pdfPage(ctx, query) {
  const key = ctx.file + ctx.key;
  let pages = pdfCache.get(key);
  try {
    if (!pages) {
      const { stdout } = await exec('pdfinfo', [ctx.file], { timeout: 5000 });
      pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]) || 1;
      pdfCache.set(key, pages);
      while (pdfCache.size > 50) pdfCache.delete(pdfCache.keys().next().value);
    }
    const page = Math.min(pages, Math.max(1, Math.trunc(Number(query.get('page') ?? ctx.recipe.page ?? 1)) || 1)),
      zoom = Math.min(400, Math.max(25, Number(ctx.recipe.zoom) || 100)),
      dpi = Math.min(300, Math.max(40, Number(query.get('dpi')) || Math.round((110 * zoom) / 100)));
    const { stdout } = await limited(() => exec(
      'pdftocairo',
      ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', ctx.file, '-'],
      { encoding: 'buffer', maxBuffer: 24 * 1024 * 1024, timeout: 10000 },
    ));
    return { pages, page, zoom, image: 'data:image/png;base64,' + stdout.toString('base64') };
  } catch (e) {
    return { pages: pages ?? null, page: 1, note: 'This PDF could not be drawn here. Open it in a PDF reader.' };
  }
}
export async function previewData(ctx, query = new URLSearchParams()) {
  const family = ctx.definition.family,
    offset = Math.max(0, Math.trunc(Number(query.get('offset') ?? ctx.recipe.rowOffset ?? 0) || 0)),
    count = Math.min(120, Math.max(1, Number(ctx.recipe.pageSize) || 80));
  if (family === 'audio') return audio(ctx);
  if (family === 'pdf') return pdfPage(ctx, query);
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
    // `group` (older callers) names a row group; `offset` is any row of the file.
    const info = parquetInfo(ctx.file);
    const at = query.get('group') !== null ? info.starts[Math.max(0, Number(query.get('group')) || 0)] ?? 0 : offset;
    return parquetRows(ctx.file, at, count);
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
      if (!tables.includes(name)) return { tables, ...tableWindow([], []) };
      const quoted = '"' + name.replaceAll('"', '""') + '"',
        got = sqliteRows(db, name, count, offset),
        total = db.prepare(`SELECT count(*) AS n FROM ${quoted}`).get().n,
        shaped = tableWindow(got.names, got.rows, { overrides: ctx.recipe.columnTypes || {} });
      // SQLite has no boolean type: a column declared INT or BOOL that only holds 0 and 1 is labelled boolean (cells still read 0 and 1).
      shaped.columns.forEach((c, i) => {
        const vals = shaped.rows.map((r) => r[i]).filter((v) => v !== null);
        if (!c.overridden && /INT|BOOL/i.test(got.declared[i]) && vals.length >= 4 && vals.every((v) => v === '0' || v === '1')) {
          c.type = 'boolean';
          c.bins = [vals.filter((v) => v === '0').length, vals.filter((v) => v === '1').length];
          c.min = c.max = null;
        }
      });
      return { tables, name, offset, total, ...shaped };
    } finally {
      db.close();
    }
  }
  if (family === 'table') {
    // Every row of the file is reachable: a one-pass index of record offsets, then bounded reads.
    const csv = ctx.kind === 'csv' || ctx.kind === 'tsv',
      delimiter = ctx.kind === 'tsv' ? '\t' : ',',
      overrides = ctx.recipe.columnTypes || {},
      index = buildIndex(ctx.file, ctx.key, { quotes: csv, delimiter, bytes: ctx.bytes, skipBlank: !csv, enc: utf16(ctx.head) });
    if (csv) {
      const headers = readRecords(ctx.file, index, 0, 1, { delimiter, quotes: true })[0] || [],
        total = Math.max(0, index.total - 1),
        at = Math.min(offset, Math.max(0, total - 1)),
        recs = total ? readRecords(ctx.file, index, at + 1, count, { delimiter, quotes: true }) : [];
      const shaped = tableWindow(headers, recs, { overrides }),
        ragged = recs.some((r) => r.length !== headers.length);
      return { ...shaped, offset: at, total, truncated: false, ...(ragged ? { note: 'Some rows in this window have a different number of cells than the header; missing cells are shown empty, extra cells get unnamed columns.' } : {}) };
    }
    const at = Math.min(offset, Math.max(0, index.total - 1)),
      lines = readRecords(ctx.file, index, at, count, { quotes: false });
    let invalid = 0;
    const records = lines.map((l) => {
      try {
        return parseExact(l);
      } catch {
        invalid++;
        return { 'not JSON': l };
      }
    });
    const { names, rows } = recordsToRows(records);
    return { ...tableWindow(names, rows, { overrides }), offset: at, total: index.total, truncated: false, ...(invalid ? { note: invalid + ' lines in this window are not JSON; they are shown as written.' } : {}) };
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
  if (family === 'json') {
    // The tree is drawn from the text itself (numbers keep the digits written in the file); a list of records is also a table.
    if (ctx.bytes > LIMIT) throw new Error('JSON preview is limited to the first 1 MiB; use JSONL for streaming records');
    const data = parseExact(ctx.text),
      list = Array.isArray(data) ? data : null;
    if (list && list.length > 1 && list.slice(0, 200).every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
      const { names, rows } = recordsToRows(list.slice(offset, offset + count));
      return { text: ctx.text, ...tableWindow(names, rows, { overrides: ctx.recipe.columnTypes || {} }), total: list.length, offset, asTable: true };
    }
    return { text: ctx.text };
  }
  if (['chart', 'animation', 'notebook', 'graph'].includes(family)) return { data: jsonData(ctx) };
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
