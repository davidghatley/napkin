// Whole-file row access for delimited and line-record text, with bounded memory.
// One streaming pass records the byte offset of every STEP-th record; a window then reads only
// from the nearest recorded offset. Quoted line breaks (CSV) are tracked across chunks.
import { openSync, closeSync, readSync } from 'node:fs';
import { decodeText } from './registry.js';
import { delimited, LIMIT } from './readers.js';
const STEP = 500,
  CHUNK = 1 << 20,
  cache = new Map();
// UTF-16 files are indexed by 16-bit unit: a unit index times two is the byte offset, whatever surrogate pairs do.
export function utf16(head) {
  if (head[0] === 0xff && head[1] === 0xfe) return { be: false, bom: 2 };
  if (head[0] === 0xfe && head[1] === 0xff) return { be: true, bom: 2 };
  const n = Math.min(head.length, 400) & ~1;
  let odd = 0, even = 0;
  for (let i = 0; i < n; i++) if (head[i] === 0) (i & 1 ? odd++ : even++);
  if (n >= 4 && odd > n / 4 && odd > even * 3) return { be: false, bom: 0 };
  if (n >= 4 && even > n / 4 && even > odd * 3) return { be: true, bom: 0 };
  return null;
}
export function indexable(head) {
  return true;
}
export function buildIndex(file, key, { quotes, bytes, skipBlank, enc = null, delimiter = ',' }) {
  const W = enc ? 2 : 1,
    D = delimiter.charCodeAt(0),
    id = file + key + quotes + W + D;
  if (cache.has(id)) return cache.get(id);
  const starts = [enc ? enc.bom : 0],
    buf = Buffer.alloc(CHUNK),
    fd = openSync(file, 'r');
  let count = 0,
    pos = enc ? enc.bom : 0,
    state = 0, // the same field states as delimited(): 0 field start, 1 unquoted, 2 quoted, 3 quote inside quoted
    lineBytes = 0,
    prevCR = false;
  const end = () => {
    if (skipBlank && lineBytes === 0) return;
    count++;
    if (count % STEP === 0) starts.push(pos + W);
    lineBytes = 0;
  };
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n < W) break;
      for (let i = 0; i + W <= n; i += W, pos += W) {
        const b = enc ? (enc.be ? (buf[i] << 8) | buf[i + 1] : buf[i] | (buf[i + 1] << 8)) : buf[i];
        if (quotes) {
          if (state === 2) state = b === 0x22 ? 3 : 2;
          else if (state === 3 && b === 0x22) state = 2;
          else if (b === 0x22 && state === 0) state = 2;
          else state = b === D || b === 0x0a || b === 0x0d ? 0 : 1;
        }
        const quote = state === 2;
        if (!quote && b === 0x0a) {
          if (prevCR) {
            // the pair CR LF is one break; the record already ended at the CR
            prevCR = false;
            if (count % STEP === 0 && count > 0 && starts.at(-1) === pos) starts[starts.length - 1] = pos + W;
            continue;
          }
          end();
        } else if (!quote && b === 0x0d) {
          prevCR = true;
          end();
          continue;
        } else lineBytes++;
        prevCR = false;
      }
    }
    if (lineBytes > 0) count++;
  } finally {
    closeSync(fd);
  }
  const result = { starts, total: count, bytes, enc };
  cache.set(id, result);
  while (cache.size > 24) cache.delete(cache.keys().next().value);
  return result;
}
// Records [first, first + count) as arrays (delimited) or raw lines (line mode).
export function readRecords(file, index, first, count, { delimiter, quotes }) {
  const slot = Math.min(index.starts.length - 1, Math.floor(first / STEP)),
    skip = first - slot * STEP,
    fd = openSync(file, 'r');
  try {
    let text = '',
      at = index.starts[slot];
    // Read forward until the window holds enough complete records.
    for (let guard = 0; guard < 8; guard++) {
      const b = Buffer.alloc(Math.min(CHUNK, Math.max(0, index.bytes - at))),
        n = b.length ? readSync(fd, b, 0, b.length, at) : 0;
      if (!n) break;
      const piece = n === b.length ? b : b.subarray(0, n);
      // Cut at the last line end so a multi-byte character is never split.
      const enc = index.enc;
      let cut = -1;
      if (enc) {
        for (let k = (piece.length & ~1) - 2; k >= 0; k -= 2) {
          const u = enc.be ? (piece[k] << 8) | piece[k + 1] : piece[k] | (piece[k + 1] << 8);
          if (u === 0x0a || u === 0x0d) { cut = k + 1; break; }
        }
      } else cut = Math.max(piece.lastIndexOf(0x0a), piece.lastIndexOf(0x0d));
      const whole = at + n >= index.bytes;
      text += enc
        ? new TextDecoder(enc.be ? 'utf-16be' : 'utf-16le').decode(whole || cut < 0 ? piece.subarray(0, piece.length & ~1) : piece.subarray(0, cut + 1))
        : decodeText(whole || cut < 0 ? piece : piece.subarray(0, cut + 1));
      at += whole || cut < 0 ? n : cut + 1;
      const seen = quotes ? delimited(text, delimiter, { offset: 0, limit: 0 }).total : (text.match(/[^\r\n]+/g) || []).length;
      if (seen >= skip + count + 1 || whole) break;
    }
    if (quotes) return delimited(text, delimiter, { offset: skip, limit: count });
    return (text.match(/[^\r\n]+/g) || []).slice(skip, skip + count);
  } finally {
    closeSync(fd);
  }
}
export { LIMIT };
