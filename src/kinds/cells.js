// One table model for every tabular kind (CSV, TSV, JSONL, JSON records, Parquet, Arrow, SQLite).
// Truth rules, enforced here so no reader can break them:
//  - a cell travels as the exact text of the file (or of the typed value the format stores), never re-printed through Number:
//    00123 stays 00123, 9007199254740993 keeps every digit, 1.50 keeps its trailing zero;
//  - columns are positional: two headers called "value" are two columns, never one object key;
//  - a column type is a label inferred from the text (or declared by the format) and can be overridden by the recipe;
//    it decides alignment and the distribution, never what the cell shows.
const INT = /^[+-]?\d+$/,
  NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,
  BOOL = /^(?:true|false)$/i,
  DATE = /^\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?)?$/;
export const TYPES = ['integer', 'number', 'boolean', 'date', 'string'];
// The text a typed value is shown as. JavaScript prints a double as the shortest text that reads back to the same double,
// so a stored float is shown exactly as stored; integers beyond 2^53 arrive as bigint or text and keep every digit.
export function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : String(v);
  if (v instanceof Uint8Array) return hexBytes(v);
  if (v instanceof ExactNumber) return v.source;
  return jsonText(v);
}
// Nested values are written back as JSON with every number as it was read (bigint and ExactNumber unquoted).
export function jsonText(v) {
  if (v === null || v === undefined) return 'null';
  if (v instanceof ExactNumber) return v.source;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return JSON.stringify(hexBytes(v));
  if (v instanceof Date) return JSON.stringify(cellText(v));
  if (typeof v?.toJSON === 'function' && !Array.isArray(v)) v = v.toJSON();
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return '[' + Array.from(v, jsonText).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ':' + jsonText(x)).join(',') + '}';
  return JSON.stringify(v);
}
const hexBytes = (b) => '0x' + Buffer.from(b.subarray(0, 64)).toString('hex') + (b.length > 64 ? `… (${b.length} bytes)` : '');
// A leading zero (00123, 007) marks an identifier, not a quantity, so such a column is text.
const leadingZero = (s) => /^[+-]?0\d/.test(s);
export function inferType(texts) {
  let int = true,
    num = true,
    bool = true,
    date = true,
    seen = 0;
  for (const s of texts) {
    if (s === null || s === '') continue;
    seen++;
    const t = s.trim();
    if (int && !(INT.test(t) && !leadingZero(t))) int = false;
    if (num && !(NUM.test(t) && !leadingZero(t.replace(/\..*/, '')) && Number.isFinite(Number(t)))) num = false;
    if (bool && !BOOL.test(t)) bool = false;
    if (date && !(DATE.test(t) && Number.isFinite(Date.parse(t)))) date = false;
    if (!int && !num && !bool && !date) return 'string';
  }
  if (!seen) return 'string';
  return int ? 'integer' : num ? 'number' : bool ? 'boolean' : date ? 'date' : 'string';
}
// Integers compare as BigInt so the minimum and maximum of a column of 19-digit ids are exact.
const cmp = (type) =>
  type === 'integer'
    ? (a, b) => {
        const x = BigInt(a.trim()),
          y = BigInt(b.trim());
        return x < y ? -1 : x > y ? 1 : 0;
      }
    : type === 'number'
      ? (a, b) => Number(a) - Number(b)
      : type === 'date'
        ? (a, b) => Date.parse(a) - Date.parse(b)
        : null;
function stats(texts, type) {
  const values = texts.filter((s) => s !== null && s !== ''),
    counts = new Map();
  for (const s of values) counts.set(s, (counts.get(s) || 0) + 1);
  const base = { missing: texts.length - values.length, distinct: counts.size, min: null, max: null, bins: [] };
  const order = cmp(type);
  if (order && values.length) {
    let lo = values[0],
      hi = values[0];
    for (const s of values) {
      if (order(s, lo) < 0) lo = s;
      if (order(s, hi) > 0) hi = s;
    }
    // min and max are cells of the file, shown as written.
    base.min = lo;
    base.max = hi;
    // The histogram is only a picture; its bin positions may use floating point.
    const at = (s) => (type === 'date' ? Date.parse(s) : Number(s)),
      a = at(lo),
      z = at(hi),
      bins = Array(16).fill(0);
    for (const s of values) bins[z === a ? 0 : Math.min(15, Math.floor(((at(s) - a) / (z - a)) * 16))]++;
    base.bins = bins;
  } else if (type === 'boolean') {
    const t = values.filter((s) => /^true$/i.test(s.trim())).length;
    base.bins = [values.length - t, t];
  } else base.bins = [...counts.values()].sort((a, b) => b - a).slice(0, 16);
  return base;
}
// names: column names in file order (duplicates and blanks allowed). rows: arrays of cells in the same order.
// declared: optional per-column type from the format's own schema. overrides: optional {index|name: type} from the recipe.
export function tableWindow(names, rows, { declared = [], overrides = {}, maxColumns = 256 } = {}) {
  const width = Math.min(maxColumns, Math.max(names.length, ...rows.map((r) => r.length), 0)),
    cells = rows.map((r) => Array.from({ length: width }, (_, i) => cellText(r[i]))),
    columns = [];
  for (let i = 0; i < width; i++) {
    const texts = cells.map((r) => r[i]),
      name = names[i] ?? '',
      inferred = declared[i] || inferType(texts),
      chosen = overrides[i] ?? overrides[name],
      type = TYPES.includes(chosen) ? chosen : inferred;
    columns.push({ index: i, name, type, ...(declared[i] ? { declared: declared[i] } : {}), ...(chosen && type === chosen ? { overridden: true } : {}), ...stats(texts, statType(type)) });
  }
  return { columns, rows: cells, sampled: cells.length, ...(width < Math.max(names.length, ...rows.map((r) => r.length), 0) ? { columnsCut: width } : {}) };
}
// A declared type such as "int64" or "float" maps onto the five distribution shapes.
function statType(t) {
  if (TYPES.includes(t)) return t;
  if (/bool/i.test(t)) return 'boolean';
  if (/^(u?int|integer|bigint|smallint|tinyint)/i.test(t)) return 'integer';
  if (/float|double|real|decimal|numeric/i.test(t)) return 'number';
  if (/date|time/i.test(t)) return 'date';
  return 'string';
}
// Records (JSON objects) become positional rows: the union of keys in first-seen order.
export function recordsToRows(records) {
  const names = [],
    at = new Map();
  for (const r of records)
    if (r && typeof r === 'object' && !Array.isArray(r))
      for (const k of Object.keys(r)) if (!at.has(k)) at.set(k, names.push(k) - 1);
  return {
    names,
    rows: records.map((r) => {
      const row = Array(names.length).fill(null);
      if (r && typeof r === 'object' && !Array.isArray(r)) for (const [k, v] of Object.entries(r)) row[at.get(k)] = v;
      else row[0] = r;
      return row;
    }),
  };
}
// JSON numbers keep the digits written in the file: the parser hands each number's source text to the reviver.
// A number that does not read back to the same text (a 19-digit id, 1.50, 1e2) is kept as that text.
export function parseExact(text) {
  return JSON.parse(text, function (key, value, context) {
    if (typeof value === 'number' && context && typeof context.source === 'string' && String(value) !== context.source)
      return new ExactNumber(context.source);
    return value;
  });
}
export class ExactNumber {
  constructor(source) {
    this.source = source;
  }
  toJSON() {
    return this.source;
  }
}
