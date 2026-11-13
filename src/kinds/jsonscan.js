// Bounded reads of a JSON file too large to parse whole. The file is walked once in 1 MiB chunks, string- and depth-aware, to find where each
// child of a container starts and ends; the index (two numbers per child) is kept per file revision. A window of children is then read by byte
// range and parsed with the digits as written, so a 300 MiB array opens as fast as a small one and every entry stays reachable.
// The walk finds structure, it does not validate the file: a damaged value is shown as the text found there.
import { statSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { parseExact } from './cells.js';

const CHUNK = 1024 * 1024,
  ENTRY_READ = 64 * 1024, // an entry larger than this is summarised from its first bytes, not parsed
  INDEX_CAP = 3_000_000, // children indexed per container (a larger one says so)
  STRING_SHOWN = 2000;
const indexes = new Map();
const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
const kindOf = (c) => (c === 0x7b ? 'object' : c === 0x5b ? 'array' : c === 0x22 ? 'string' : c === 0x74 || c === 0x66 ? 'boolean' : c === 0x6e ? 'null' : 'number');

function reader(file) {
  const fd = openSync(file, 'r'),
    size = fstatSync(fd).size;
  return {
    size,
    close: () => closeSync(fd),
    read(at, n) {
      n = Math.max(0, Math.min(n, size - at));
      const b = Buffer.alloc(n);
      if (n) readSync(fd, b, 0, n, at);
      return b;
    },
  };
}
// First byte at or after `at` that is not white space (and not a UTF-8 byte-order mark at the start of the file).
function firstValue(r, at = 0) {
  for (;;) {
    const b = r.read(at, 4096);
    if (!b.length) return -1;
    for (let i = 0; i < b.length; i++) {
      if (at + i === 0 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
        i += 2;
        continue;
      }
      if (!WS.has(b[i])) return at + i;
    }
    at += b.length;
  }
}
// Children of the container that opens at `open`: [starts[], ends[], closeAt]. An entry ends at its comma or the closing bracket.
function walk(r, open) {
  const starts = [],
    ends = [];
  let depth = 0,
    inStr = false,
    esc = false,
    entryStart = -1,
    capped = false,
    close = r.size;
  for (let at = open; at < r.size; ) {
    const b = r.read(at, CHUNK);
    for (let i = 0; i < b.length; i++) {
      const c = b[i],
        pos = at + i;
      if (inStr) {
        if (esc) esc = false;
        else if (c === 0x5c) esc = true;
        else if (c === 0x22) inStr = false;
        continue;
      }
      if (depth === 1 && entryStart < 0 && !WS.has(c) && c !== 0x2c && c !== 0x5d && c !== 0x7d) entryStart = pos;
      if (c === 0x22) inStr = true;
      else if (c === 0x7b || c === 0x5b) depth++;
      else if (c === 0x7d || c === 0x5d) {
        depth--;
        if (depth === 0) {
          if (entryStart >= 0) (starts.push(entryStart), ends.push(pos));
          close = pos;
          return { starts, ends, close, capped };
        }
      } else if (c === 0x2c && depth === 1) {
        if (entryStart >= 0 && starts.length < INDEX_CAP) (starts.push(entryStart), ends.push(pos));
        else if (entryStart >= 0) capped = true;
        entryStart = -1;
      }
    }
    at += b.length;
  }
  return { starts, ends, close, capped, unclosed: true };
}
function indexOf(file, st, r, open) {
  const key = `${file}:${st.size}:${st.mtimeMs}:${open}`;
  if (!indexes.has(key)) {
    indexes.set(key, walk(r, open));
    while (indexes.size > 6) indexes.delete(indexes.keys().next().value);
  }
  return indexes.get(key);
}
const trimEnd = (b) => {
  let e = b.length;
  while (e > 0 && WS.has(b[e - 1])) e--;
  return b.subarray(0, e);
};
// Reads one entry [start, end): its key (objects) and a description of its value.
function describe(r, start, end, isObject, index) {
  const total = end - start,
    raw = trimEnd(r.read(start, Math.min(total, ENTRY_READ))),
    out = {};
  let at = 0;
  if (isObject) {
    // "key" : value. The key is a JSON string, read up to its closing quote.
    let i = 1,
      esc = false;
    for (; i < raw.length; i++) {
      if (esc) esc = false;
      else if (raw[i] === 0x5c) esc = true;
      else if (raw[i] === 0x22) break;
    }
    try {
      out.key = JSON.parse(raw.toString('utf8', 0, i + 1));
    } catch {
      out.key = raw.toString('utf8', 1, i);
    }
    at = i + 1;
    while (at < raw.length && (WS.has(raw[at]) || raw[at] === 0x3a)) at++;
  } else out.key = String(index);
  const valueStart = start + at,
    bytes = total - at;
  const v = raw.subarray(at);
  out.kind = v.length ? kindOf(v[0]) : 'null';
  out.bytes = bytes;
  out.index = index;
  const whole = total <= ENTRY_READ;
  if (out.kind === 'object' || out.kind === 'array') {
    if (whole) {
      const w = walkBuffer(v);
      out.count = w;
    }
    return { ...out, valueStart };
  }
  if (out.kind === 'string') {
    if (whole) {
      try {
        const s = JSON.parse(v.toString('utf8'));
        out.text = s.length > STRING_SHOWN ? s.slice(0, STRING_SHOWN) : s;
        if (s.length > STRING_SHOWN) out.more = s.length;
      } catch {
        out.text = v.toString('utf8', 0, STRING_SHOWN);
        out.damaged = true;
      }
    } else {
      out.text = v.toString('utf8', 1, STRING_SHOWN + 1);
      out.more = bytes;
    }
    return { ...out, valueStart };
  }
  out.text = v.toString('utf8', 0, 200).trim();
  return { ...out, valueStart };
}
// Number of children of a container held in memory.
function walkBuffer(b) {
  let depth = 0,
    inStr = false,
    esc = false,
    n = 0,
    seen = false;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === 0x5c) esc = true;
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    if (c === 0x7b || c === 0x5b) depth++;
    else if (c === 0x7d || c === 0x5d) {
      depth--;
      if (depth === 0) break;
    } else if (c === 0x2c && depth === 1) n++;
    if (depth === 1 && !WS.has(c) && c !== 0x7b && c !== 0x5b) seen = true;
  }
  return seen ? n + 1 : 0;
}

// Resolves `path` (child indexes from the root) to a span, then answers with a window of its children.
export function jsonWindow(file, path = [], from = 0, count = 200) {
  const st = statSync(file),
    r = reader(file);
  try {
    const head = r.read(0, 4);
    if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) throw new Error('This JSON file is UTF-16 and over 1 MiB. Next: save it as UTF-8, or open it in its own application.');
    let start = firstValue(r);
    if (start < 0) throw new Error('This JSON file is empty.');
    let end = r.size;
    for (const step of path) {
      const idx = indexOf(file, st, r, start),
        i = Number(step);
      if (!(i >= 0 && i < idx.starts.length)) throw new Error('That part of the file no longer exists. Next: reopen the file.');
      const d = describe(r, idx.starts[i], idx.ends[i], r.read(start, 1)[0] === 0x7b, i);
      start = d.valueStart;
      end = idx.ends[i];
    }
    const open = r.read(start, 1)[0];
    if (open !== 0x7b && open !== 0x5b) {
      const text = trimEnd(r.read(start, Math.min(end - start, ENTRY_READ))).toString('utf8');
      return { scalar: true, kind: kindOf(open), text: text.slice(0, STRING_SHOWN), bytes: end - start };
    }
    const idx = indexOf(file, st, r, start),
      isObject = open === 0x7b,
      from0 = Math.max(0, Math.min(from, idx.starts.length)),
      to = Math.min(idx.starts.length, from0 + count),
      entries = [];
    for (let i = from0; i < to; i++) entries.push(describe(r, idx.starts[i], idx.ends[i], isObject, i));
    return {
      container: isObject ? 'object' : 'array',
      total: idx.starts.length,
      capped: idx.capped || false,
      unclosed: idx.unclosed || false,
      from: from0,
      entries: entries.map(({ valueStart, ...e }) => e),
      bytes: (idx.unclosed ? r.size : idx.close + 1) - start,
    };
  } finally {
    r.close();
  }
}
// A large array of records as table rows (the entries are parsed with their digits as written); null when the root is not such an array.
export function jsonRecords(file, from = 0, count = 120) {
  const st = statSync(file),
    r = reader(file);
  try {
    const start = firstValue(r);
    if (start < 0 || r.read(start, 1)[0] !== 0x5b) return null;
    const idx = indexOf(file, st, r, start),
      objectAt = (i) => {
        const b = trimEnd(r.read(idx.starts[i], Math.min(idx.ends[i] - idx.starts[i], ENTRY_READ)));
        return b[0] === 0x7b && idx.ends[i] - idx.starts[i] <= ENTRY_READ ? b : null;
      };
    const probe = Math.min(idx.starts.length, 20);
    if (probe < 2) return null;
    for (let i = 0; i < probe; i++) if (!objectAt(i)) return null;
    const from0 = Math.max(0, Math.min(from, idx.starts.length - 1)),
      to = Math.min(idx.starts.length, from0 + count),
      records = [];
    for (let i = from0; i < to; i++) {
      const b = objectAt(i);
      let rec;
      try {
        rec = b ? parseExact(b.toString('utf8')) : { 'not a small object': `${idx.ends[i] - idx.starts[i]} bytes` };
      } catch {
        rec = { 'not JSON': trimEnd(r.read(idx.starts[i], 200)).toString('utf8') };
      }
      records.push(rec);
    }
    return { records, total: idx.starts.length, offset: from0, capped: idx.capped || false };
  } finally {
    r.close();
  }
}
