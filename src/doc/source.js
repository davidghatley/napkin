// Byte-level text helpers for the document engine (decision 0014).
// Every file is read as latin1, so one character is one byte: offsets are byte offsets, and multi-byte UTF-8 passes
// through untouched. Text that came in as UTF-8 (an edit's value) is converted with toL before it is spliced in.
export const L = (buf) => buf.toString('latin1');
export const toL = (utf8) => Buffer.from(String(utf8), 'utf8').toString('latin1');
export const fromL = (latin) => Buffer.from(latin, 'latin1').toString('utf8');
export const bytesOf = (latin) => Buffer.from(latin, 'latin1');

const WS = /[ \t\r\n\f]/;
export const isWs = (ch) => ch !== undefined && WS.test(ch);
export function wsBack(s, i, floor = 0) { while (i > floor && isWs(s[i - 1])) i--; return i; }
export function wsFwd(s, i, ceil = s.length) { while (i < ceil && isWs(s[i])) i++; return i; }

// Line (1-based) of a byte offset. The line starts of the last few strings asked about are kept.
const lineCache = new Map();
export function lineOf(s, offset) {
  let starts = lineCache.get(s);
  if (!starts) {
    starts = [0]; for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) starts.push(i + 1);
    lineCache.set(s, starts); if (lineCache.size > 16) lineCache.delete(lineCache.keys().next().value);
  }
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

// A splice is { from, to, text } on the latin1 string. Splices of one change never overlap; they are applied from the end.
export function applySplices(s, splices) {
  const sorted = [...splices].sort((a, b) => b.from - a.from || b.to - a.to);
  for (let k = 1; k < sorted.length; k++) if (sorted[k].to > sorted[k - 1].from) throw new Error('internal: overlapping splices. Next: send the edits as separate batches');
  let out = s;
  for (const sp of sorted) out = out.slice(0, sp.from) + sp.text + out.slice(sp.to);
  return out;
}
// Where a position of the old text lands after the splices (a position inside a replaced span moves to its start,
// or to its end when `after`).
export function mapPos(pos, splices, after = false) {
  let delta = 0;
  for (const sp of splices) {
    if (sp.to <= pos && !(sp.to === pos && sp.from === pos && !after)) delta += sp.text.length - (sp.to - sp.from);
    else if (sp.from < pos && pos < sp.to) return sp.from + delta + (after ? sp.text.length : 0);
  }
  return pos + delta;
}

// Indentation (the whitespace from the line start) at offset i.
export function indentAt(s, i) {
  let a = i; while (a > 0 && s[a - 1] !== '\n') a--;
  let b = a; while (b < s.length && (s[b] === ' ' || s[b] === '\t')) b++;
  return s.slice(a, b);
}
// The line ending a file uses (CRLF when its first line break is CRLF).
export const eolOf = (s) => { const i = s.indexOf('\n'); return i > 0 && s[i - 1] === '\r' ? '\r\n' : '\n'; };
