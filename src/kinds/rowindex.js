// Whole-file row access for delimited and line-record text, with bounded memory.
// One streaming pass records the byte offset of every STEP-th record; a window then reads only
// from the nearest recorded offset. Quoted line breaks (CSV) are tracked across chunks.
import { openSync, closeSync, readSync } from 'node:fs';
import { decodeText } from './registry.js';
import { delimited, LIMIT } from './readers.js';
const STEP = 500,
  CHUNK = 1 << 20,
  cache = new Map();
function isUtf16(head) {
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) return true;
  const n = Math.min(head.length, 400);
  let zero = 0;
  for (let i = 0; i < n; i++) if (head[i] === 0) zero++;
  return n >= 4 && zero > n / 4;
}
export function indexable(head) {
  return !isUtf16(head);
}
export function buildIndex(file, key, { quotes, bytes, skipBlank }) {
  const id = file + key + quotes;
  if (cache.has(id)) return cache.get(id);
  const starts = [0],
    buf = Buffer.alloc(CHUNK),
    fd = openSync(file, 'r');
  let count = 0,
    pos = 0,
    quote = false,
    lineBytes = 0,
    prevCR = false;
  const end = () => {
    if (skipBlank && lineBytes === 0) return;
    count++;
    if (count % STEP === 0) starts.push(pos + 1);
    lineBytes = 0;
  };
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      for (let i = 0; i < n; i++, pos++) {
        const b = buf[i];
        if (quotes && b === 0x22) quote = !quote;
        if (!quote && b === 0x0a) {
          if (prevCR) {
            // the pair CR LF is one break; the record already ended at the CR
            prevCR = false;
            if (count % STEP === 0 && count > 0 && starts.at(-1) === pos) starts[starts.length - 1] = pos + 1;
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
  const result = { starts, total: count, bytes };
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
      const cut = Math.max(piece.lastIndexOf(0x0a), piece.lastIndexOf(0x0d));
      const whole = at + n >= index.bytes;
      text += decodeText(whole || cut < 0 ? piece : piece.subarray(0, cut + 1));
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
