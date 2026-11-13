// A Vega-Lite interpreter: it executes the specification (data, transforms, scales, stacking, marks,
// axes, legends, layers, concatenation, facets and repeats) and returns SVG. What it cannot run is
// listed in `notes` and shown to the reader, never silently replaced by something else.
const PALETTE = ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#eeca3b', '#b279a2', '#ff9da6', '#9d755d', '#bab0ac'];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- expressions (a safe subset of the Vega expression language) --------------------------------
const FNS = {
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, log: Math.log,
  exp: Math.exp, pow: Math.pow, min: Math.min, max: Math.max, sin: Math.sin, cos: Math.cos,
  isValid: (v) => v !== null && v !== undefined && !Number.isNaN(v),
  isNaN: Number.isNaN, toNumber: Number, toString: String, lower: (s) => String(s).toLowerCase(),
  upper: (s) => String(s).toUpperCase(), length: (s) => s?.length ?? 0, year: (d) => new Date(d).getUTCFullYear(),
  month: (d) => new Date(d).getUTCMonth(), date: (d) => new Date(d).getUTCDate(), day: (d) => new Date(d).getUTCDay(),
  hours: (d) => new Date(d).getUTCHours(),
  indexof: (s, t) => String(s).indexOf(t), substring: (s, a, b) => String(s).substring(a, b),
  test: (re, s) => { try { return new RegExp(re).test(s); } catch { return false; } },
  PI: Math.PI, E: Math.E,
};
function compileExpr(src) {
  const text = String(src);
  if (!/^[\w\s.'"<>=!&|+\-*/%()?:,[\]$\\^]*$/.test(text) || text.length > 600) throw new Error('unsupported expression');
  // Every bare name must be datum or an allowed function; property names follow a dot.
  for (const m of text.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""').matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g))
    if (!['datum', 'true', 'false', 'null', 'undefined'].includes(m[2]) && !Object.hasOwn(FNS, m[2])) throw new Error('unsupported expression');
  if (/\.(constructor|__proto__|prototype)|\[\s*['"](constructor|__proto__|prototype)/.test(text)) throw new Error('unsupported expression');
  const names = Object.keys(FNS),
    f = new Function('datum', ...names, `return (${text});`);
  return (datum) => f(datum, ...names.map((n) => FNS[n]));
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function predicate(p) {
  if (typeof p === 'string') return compileExpr(p);
  if (p.and) { const l = p.and.map(predicate); return (d) => l.every((f) => f(d)); }
  if (p.or) { const l = p.or.map(predicate); return (d) => l.some((f) => f(d)); }
  if (p.not) { const f = predicate(p.not); return (d) => !f(d); }
  const get = (d) => { const v = d[p.field]; return p.timeUnit ? timeValue(v, p.timeUnit) : v; };
  const dt = (v) => (v && typeof v === 'object' && v.year !== undefined ? Date.UTC(v.year, (v.month ?? 1) - 1, v.date ?? 1) : v);
  if ('equal' in p) return (d) => { const v = get(d), e = dt(p.equal); return v === e || (v instanceof Date ? +v === +new Date(e) : false); };
  if ('lt' in p) return (d) => get(d) < dt(p.lt);
  if ('lte' in p) return (d) => get(d) <= dt(p.lte);
  if ('gt' in p) return (d) => get(d) > dt(p.gt);
  if ('gte' in p) return (d) => get(d) >= dt(p.gte);
  if (p.range) return (d) => { const v = get(d); return v >= dt(p.range[0]) && v <= dt(p.range[1]); };
  if (p.oneOf) return (d) => p.oneOf.includes(get(d));
  if ('valid' in p) return (d) => (get(d) !== null && get(d) !== undefined && !Number.isNaN(get(d))) === p.valid;
  throw new Error('unsupported filter');
}

// ---- time ------------------------------------------------------------------------------------------
function timeValue(v, unit) {
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t),
    y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const u = unit.replace(/^utc/, '');
  if (u === 'year') return Date.UTC(y, 0, 1);
  if (u === 'quarter' || u === 'yearquarter') return Date.UTC(y, Math.floor(mo / 3) * 3, 1);
  if (u === 'month' || u === 'yearmonth') return u === 'month' ? Date.UTC(2012, mo, 1) : Date.UTC(y, mo, 1);
  if (u === 'week' || u === 'yearweek') return Date.UTC(y, mo, d.getUTCDate() - d.getUTCDay());
  if (u === 'day') return Date.UTC(2012, 0, 1 + d.getUTCDay());
  if (u === 'date' || u === 'yearmonthdate') return u === 'date' ? Date.UTC(2012, 0, d.getUTCDate()) : Date.UTC(y, mo, d.getUTCDate());
  if (u === 'hours' || u === 'yearmonthdatehours') return u === 'hours' ? Date.UTC(2012, 0, 1, d.getUTCHours()) : Date.UTC(y, mo, d.getUTCDate(), d.getUTCHours());
  if (u === 'minutes') return Date.UTC(2012, 0, 1, 0, d.getUTCMinutes());
  if (u === 'seconds') return Date.UTC(2012, 0, 1, 0, 0, d.getUTCSeconds());
  return t;
}
function timeLabel(ms, unit) {
  const d = new Date(ms);
  const u = (unit || '').replace(/^utc/, '');
  if (u === 'year') return String(d.getUTCFullYear());
  if (u === 'month') return MONTHS[d.getUTCMonth()];
  if (u === 'day') return DAYS[d.getUTCDay()];
  if (u === 'date') return String(d.getUTCDate());
  if (u === 'hours') return String(d.getUTCHours()).padStart(2, '0') + ':00';
  if (u === 'quarter' || u === 'yearquarter') return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  if (u === 'yearmonth') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (u === 'yearmonthdate') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return d.toISOString().slice(0, 10);
}
function timeTicks(lo, hi, count) {
  const span = hi - lo, day = 864e5;
  const steps = [['sec', 1e3], ['min', 6e4], ['hour', 36e5], ['day', day], ['week', 7 * day], ['month', 30 * day], ['quarter', 91 * day], ['year', 365 * day]];
  const want = span / Math.max(2, count);
  let [unit, size] = steps.find(([, s]) => s >= want) || [steps.at(-1)[0], 365 * day];
  if (unit === 'year' && want > 365 * day) size = niceStep(want / (365 * day)) * 365 * day;
  const out = [],
    start = new Date(lo);
  let t;
  if (unit === 'year') {
    const stepY = Math.max(1, Math.round(size / (365 * day)));
    let y = Math.ceil(start.getUTCFullYear() / stepY) * stepY;
    for (; Date.UTC(y, 0, 1) <= hi; y += stepY) out.push(Date.UTC(y, 0, 1));
  } else if (unit === 'month' || unit === 'quarter') {
    const stepM = unit === 'quarter' ? 3 : Math.max(1, Math.round(want / (30 * day)));
    let y = start.getUTCFullYear(), m = Math.ceil(start.getUTCMonth() / stepM) * stepM;
    for (t = Date.UTC(y, m, 1); t <= hi; m += stepM, t = Date.UTC(y, m, 1)) if (t >= lo) out.push(t);
  } else {
    t = Math.ceil(lo / size) * size;
    for (; t <= hi; t += size) out.push(t);
  }
  return { ticks: out.slice(0, 40), unit };
}
function tickLabel(ms, unit) {
  const d = new Date(ms);
  if (unit === 'year') return String(d.getUTCFullYear());
  if (unit === 'month' || unit === 'quarter') return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MONTHS[d.getUTCMonth()];
  if (unit === 'week' || unit === 'day') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.toISOString().slice(11, 16);
}

// ---- numbers ---------------------------------------------------------------------------------------
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function linearTicks(lo, hi, count = 6) {
  if (lo === hi) return { ticks: [lo], lo, hi };
  const step = niceStep((hi - lo) / count), a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (let v = a; v <= b + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)));
  return { ticks: out, lo: a, hi: b, step };
}
function formatNumber(v, fmt) {
  if (typeof v !== 'number') return String(v);
  if (fmt) {
    const m = /^(,?)(?:\.(\d+))?([fse%dg]?)$/.exec(fmt);
    if (m) {
      const [, comma, digits, kind] = m,
        n = digits === undefined ? undefined : Number(digits);
      if (kind === '%') return (v * 100).toFixed(n ?? 0) + '%';
      if (kind === 's') {
        const a = Math.abs(v), units = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']], u = units.find(([s]) => a >= s);
        return u ? Number((v / u[0]).toPrecision(n ?? 3)) + u[1] : String(Number(v.toPrecision(n ?? 3)));
      }
      const s = kind === 'e' ? v.toExponential(n ?? 2) : kind === 'd' ? Math.round(v).toString() : v.toFixed(n ?? 0);
      return comma ? Number(s).toLocaleString('en-US', { minimumFractionDigits: s.split('.')[1]?.length || 0, maximumFractionDigits: 20 }) : s;
    }
  }
  const a = Math.abs(v);
  if (a >= 1e4) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(Number(v.toPrecision(6)));
}

// ---- data ------------------------------------------------------------------------------------------
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"' && !cell) q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1 || r[0] !== '').map((r) =>
    Object.fromEntries(head.map((k, i) => [k, r[i] === '' || r[i] === undefined ? null : /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(r[i]) ? Number(r[i]) : r[i]])));
}
async function dataRows(spec, ctx) {
  const d = spec.data;
  if (!d) return null;
  if (d.values !== undefined) {
    if (typeof d.values === 'string') return d.format?.type === 'csv' ? parseDelimited(d.values, ',') : JSON.parse(d.values);
    return d.values.map((v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : { data: v }));
  }
  if (d.name) {
    const set = ctx.datasets?.[d.name];
    if (!set) { ctx.notes.add(`Dataset "${d.name}" is not in this file`); return []; }
    return set.map((v) => ({ ...v }));
  }
  if (d.url) {
    if (!ctx.load) { ctx.notes.add('External data cannot be loaded here'); return []; }
    try {
      const text = await ctx.load(d.url);
      const type = d.format?.type || (/\.tsv$/i.test(d.url) ? 'tsv' : /\.csv$/i.test(d.url) ? 'csv' : 'json');
      const rows = type === 'csv' ? parseDelimited(text, ',') : type === 'tsv' ? parseDelimited(text, '\t') : JSON.parse(text);
      return (d.format?.property ? rows[d.format.property] : rows).map((v) => ({ ...v }));
    } catch (e) {
      ctx.notes.add(`Data file ${d.url} could not be read: ${e.message}`);
      return [];
    }
  }
  if (d.sequence) {
    const out = [], { start, stop, step = 1, as = 'data' } = d.sequence;
    for (let v = start; v < stop; v += step) out.push({ [as]: v });
    return out;
  }
  ctx.notes.add('This data source type is not supported');
  return [];
}

// ---- transforms ------------------------------------------------------------------------------------
const OPS = {
  count: (v) => v.length,
  valid: (v) => v.filter((x) => x !== null && x !== undefined).length,
  distinct: (v) => new Set(v).size,
  sum: (v) => v.reduce((a, b) => a + (+b || 0), 0),
  mean: (v) => { const n = v.filter(Number.isFinite); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; },
  average: (v) => OPS.mean(v),
  median: (v) => { const n = v.filter(Number.isFinite).sort((a, b) => a - b); return n.length ? (n[(n.length - 1) >> 1] + n[n.length >> 1]) / 2 : null; },
  min: (v) => { const n = v.filter((x) => x !== null && x !== undefined); return n.length ? n.reduce((a, b) => (b < a ? b : a)) : null; },
  max: (v) => { const n = v.filter((x) => x !== null && x !== undefined); return n.length ? n.reduce((a, b) => (b > a ? b : a)) : null; },
  q1: (v) => quantile(v, 0.25), q3: (v) => quantile(v, 0.75),
  variance: (v) => { const n = v.filter(Number.isFinite), m = OPS.mean(n); return n.length > 1 ? n.reduce((a, b) => a + (b - m) ** 2, 0) / (n.length - 1) : null; },
  stdev: (v) => { const x = OPS.variance(v); return x === null ? null : Math.sqrt(x); },
};
function quantile(v, q) {
  const n = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!n.length) return null;
  const p = (n.length - 1) * q, i = Math.floor(p);
  return n[i] + (n[Math.min(n.length - 1, i + 1)] - n[i]) * (p - i);
}
function aggregateRows(rows, groupby, ops) {
  const groups = new Map();
  for (const r of rows) {
    const k = JSON.stringify(groupby.map((g) => r[g]));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].map((g) => {
    const out = {};
    for (const key of groupby) out[key] = g[0][key];
    for (const o of ops) out[o.as] = (OPS[o.op] || OPS.count)(o.field ? g.map((r) => r[o.field]) : g);
    return out;
  });
}
function binInfo(rows, field, bin) {
  const opt = bin === true ? {} : bin,
    vals = rows.map((r) => r[field]).filter(Number.isFinite);
  if (!vals.length) return { step: 1, start: 0 };
  const lo = opt.extent?.[0] ?? Math.min(...vals), hi = opt.extent?.[1] ?? Math.max(...vals),
    max = opt.maxbins ?? 10;
  const step = opt.step ?? niceStep((hi - lo || 1) / max);
  return { step, start: Math.floor(lo / step) * step };
}
function runTransforms(rows, transforms, ctx) {
  for (const t of transforms || []) {
    try {
      if (t.filter !== undefined) { const f = predicate(t.filter); rows = rows.filter((r) => f(r)); }
      else if (t.calculate !== undefined) { const f = compileExpr(t.calculate); rows = rows.map((r) => ({ ...r, [t.as]: f(r) })); }
      else if (t.aggregate) rows = aggregateRows(rows, t.groupby || [], t.aggregate.map((a) => ({ op: a.op, field: a.field, as: a.as || `${a.op}_${a.field}` })));
      else if (t.bin) {
        const as = Array.isArray(t.as) ? t.as : [t.as || `bin_${t.field}`, `${t.as || `bin_${t.field}`}_end`];
        const { step, start } = binInfo(rows, t.field, t.bin);
        rows = rows.map((r) => {
          const v = r[t.field];
          if (!Number.isFinite(v)) return { ...r, [as[0]]: null, [as[1]]: null };
          const a = start + Math.floor((v - start) / step) * step;
          return { ...r, [as[0]]: a, [as[1]]: a + step };
        });
      } else if (t.timeUnit) rows = rows.map((r) => ({ ...r, [t.as]: timeValue(r[t.field], t.timeUnit) }));
      else if (t.fold) rows = rows.flatMap((r) => t.fold.map((k) => ({ ...r, [t.as?.[0] ?? 'key']: k, [t.as?.[1] ?? 'value']: r[k] })));
      else if (t.window) {
        // Running and ranked windows over the existing row order.
        const groups = new Map();
        rows.forEach((r) => { const k = JSON.stringify((t.groupby || []).map((g) => r[g])); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
        const sort = t.sort?.[0];
        const frame = t.frame || [null, 0];
        const out = [];
        for (const g of groups.values()) {
          if (sort) g.sort((a, b) => (sort.order === 'descending' ? -1 : 1) * cmp(a[sort.field], b[sort.field]));
          g.forEach((r, i) => {
            const n = { ...r };
            for (const w of t.window) {
              const a = frame[0] === null ? 0 : Math.max(0, i + frame[0]), b = frame[1] === null ? g.length - 1 : Math.min(g.length - 1, i + frame[1]);
              if (w.op === 'row_number') n[w.as] = i + 1;
              else if (w.op === 'rank') n[w.as] = i + 1;
              else n[w.as] = (OPS[w.op] || OPS.count)(g.slice(a, b + 1).map((x) => x[w.field]));
            }
            out.push(n);
          });
        }
        rows = out;
      } else if (t.sample) rows = rows.slice(0, t.sample);
      else if (t.joinaggregate) {
        const groups = new Map();
        rows.forEach((r) => { const k = JSON.stringify((t.groupby || []).map((g) => r[g])); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
        rows = rows.map((r) => {
          const g = groups.get(JSON.stringify((t.groupby || []).map((x) => r[x]))), n = { ...r };
          for (const o of t.joinaggregate) n[o.as || `${o.op}_${o.field}`] = (OPS[o.op] || OPS.count)(o.field ? g.map((x) => x[o.field]) : g);
          return n;
        });
      } else ctx.notes.add(`The "${Object.keys(t)[0]}" transform is not run`);
    } catch (e) {
      ctx.notes.add(`A transform was skipped (${e.message})`);
    }
  }
  return rows;
}

// ---- encodings and scales ---------------------------------------------------------------------------
const CHANNELS = ['x', 'y', 'x2', 'y2', 'color', 'fill', 'stroke', 'size', 'opacity', 'text', 'theta', 'radius', 'detail', 'order', 'tooltip', 'shape', 'strokeWidth', 'xOffset', 'yOffset'];
function normalizeEncoding(enc, mark, ctx) {
  const out = {};
  for (const ch of CHANNELS) {
    let e = enc?.[ch];
    if (!e) continue;
    if (Array.isArray(e)) e = e[0];
    if (typeof e === 'string') e = { field: e };
    e = { ...e };
    if (e.type === 'ordinal' || e.type === 'nominal' || e.type === 'quantitative' || e.type === 'temporal') {}
    else if (e.aggregate || e.bin) e.type = e.bin ? 'quantitative' : 'quantitative';
    else if (e.timeUnit) e.type = 'temporal';
    else if (e.field === undefined && 'value' in e) e.type = 'value';
    else if (e.field !== undefined || e.datum !== undefined) {
      e.type = e.type || 'nominal';
    }
    if (e.field === undefined && e.aggregate === 'count') e.field = '__records';
    if (e.field === 'repeat') ctx.notes.add('A repeat reference was not resolved');
    if (e.type === 'geojson' || e.type === 'latitude' || e.type === 'longitude') ctx.notes.add('Geographic projections are not drawn');
    out[ch] = e;
  }
  return out;
}
function encKey(e) {
  if (e.field === undefined) return null;
  if (e.aggregate) return e.aggregate === 'count' ? '__count' : `${e.aggregate}_${e.field}`;
  if (e.bin) return `bin_${e.field}`;
  if (e.timeUnit) return `${e.timeUnit}_${e.field}`;
  return e.field;
}
function encTitle(e) {
  if (e.axis?.title !== undefined) return e.axis.title;
  if (e.title !== undefined) return e.title;
  if (e.field === undefined) return '';
  if (e.aggregate === 'count') return 'Count of Records';
  if (e.aggregate) return `${e.aggregate[0].toUpperCase()}${e.aggregate.slice(1)} of ${e.field}`;
  if (e.bin) return `${e.field} (binned)`;
  if (e.timeUnit) return `${e.field} (${e.timeUnit})`;
  return e.field;
}
// Encoding-level aggregate, bin and timeUnit become columns before drawing.
function prepare(rows, enc) {
  const specials = Object.values(enc).filter((e) => e.aggregate || e.bin || e.timeUnit);
  if (!specials.length) return rows;
  let out = rows;
  for (const e of Object.values(enc)) {
    if (e.bin) {
      const { step, start } = binInfo(out, e.field, e.bin);
      const key = encKey(e);
      out = out.map((r) => {
        const v = r[e.field];
        if (!Number.isFinite(v)) return { ...r, [key]: null, [key + '_end']: null };
        const a = start + Math.floor((v - start) / step) * step;
        return { ...r, [key]: a, [key + '_end']: a + step };
      });
    } else if (e.timeUnit) {
      const key = encKey(e);
      out = out.map((r) => ({ ...r, [key]: timeValue(r[e.field], e.timeUnit) }));
    }
  }
  const aggs = Object.values(enc).filter((e) => e.aggregate);
  if (aggs.length) {
    const group = [...new Set(Object.entries(enc).filter(([ch, e]) => !e.aggregate && encKey(e) && ch !== 'tooltip' && ch !== 'order').flatMap(([, e]) => [encKey(e), ...(e.bin ? [encKey(e) + '_end'] : [])]))];
    if (aggs.some((e) => e.field === '__records')) out = out.map((r) => ({ ...r, __records: 1 }));
    const ops = aggs.map((e) => ({ op: e.aggregate, field: e.field === '__records' ? null : e.field, as: encKey(e) }));
    out = aggregateRows(out, group, ops);
  }
  return out;
}
function toNum(v, type) {
  if (v === null || v === undefined) return null;
  if (type === 'temporal') { const t = typeof v === 'number' ? v : v instanceof Date ? +v : Date.parse(v); return Number.isFinite(t) ? t : null; }
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
const discrete = (e) => e && (e.type === 'ordinal' || e.type === 'nominal' || (e.type === 'temporal' && e.timeUnit && !e.scale?.type));

function buildScale(units, ch, size, ctx) {
  const parts = units.flatMap((u) => [u.enc[ch], ch === 'x' || ch === 'y' ? u.enc[ch + '2'] : null].map((e, i) => (e ? { e, u, second: i === 1 } : null))).filter(Boolean);
  const main = parts.find((p) => !p.second && p.e.type !== 'value')?.e;
  if (!main && !parts.length) return null;
  const e = main || parts[0].e;
  const sc = { ch, e, title: encTitle(e), size };
  if (discrete(main)) {
    const vals = new Map();
    for (const { e: x, u, second } of parts) {
      if (second || !discrete(x)) continue;
      const k = encKey(x);
      for (const r of u.rows) {
        const v = r[k];
        if (v === null || v === undefined) continue;
        vals.set(v, true);
      }
    }
    let domain = [...vals.keys()];
    const sort = main.sort ?? (main.scale?.domain);
    if (main.scale?.domain) domain = main.scale.domain.filter((v) => vals.has(v) || true);
    else if (main.sort === 'descending' || main.sort === '-y') domain.sort((a, b) => cmp(b, a));
    else if (main.sort === null) { /* data order */ }
    else if (main.sort && main.sort.field) {
      const f = main.sort.field, op = main.sort.op || 'sum', k = encKey(main);
      const agg = new Map();
      for (const p of parts) for (const r of p.u.rows) if (!agg.has(r[k])) agg.set(r[k], []), agg.get(r[k]).push(r[f]); else agg.get(r[k]).push(r[f]);
      domain.sort((a, b) => (main.sort.order === 'descending' ? -1 : 1) * cmp(OPS[op](agg.get(a) || []), OPS[op](agg.get(b) || [])));
    } else if (main.type === 'temporal' || domain.every((v) => typeof v === 'number')) domain.sort(cmp);
    else if (!sort) domain.sort(cmp);
    sc.kind = 'band';
    sc.domain = domain;
    const pad = ctx.step ? 0 : 0;
    sc.step = ctx.step ?? size / Math.max(1, domain.length);
    sc.size = ctx.step ? ctx.step * domain.length : size;
    sc.band = sc.step * (main.scale?.paddingInner !== undefined ? 1 - main.scale.paddingInner : 0.9);
    sc.at = (v) => { const i = domain.indexOf(v); return i < 0 ? null : (i + 0.5) * sc.step; };
    sc.label = (v) => (main.type === 'temporal' ? timeLabel(v, main.timeUnit) : String(v));
    return sc;
  }
  // continuous
  let lo = Infinity, hi = -Infinity;
  const type = e.type === 'temporal' ? 'temporal' : 'quantitative';
  for (const { e: x, u } of parts) {
    if (x.type === 'value') { continue; }
    const keys = x.datum !== undefined ? null : [encKey(x), ...(x.bin ? [encKey(x) + '_end'] : [])];
    if (keys) for (const r of u.rows) for (const k of keys) { const v = toNum(r[k], x.type); if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    else { const v = toNum(x.datum, x.type); if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (u.stacked && (x === u.enc.y || x === u.enc.x) && u.stackSpan) { lo = Math.min(lo, u.stackSpan[0]); hi = Math.max(hi, u.stackSpan[1]); }
  }
  if (!Number.isFinite(lo)) return null;
  const scale = e.scale || {};
  const zero = scale.zero ?? (type === 'quantitative' && !e.bin && !scale.domain && scale.type !== 'log');
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (scale.domain && scale.domain.length === 2) { lo = toNum(scale.domain[0], type) ?? lo; hi = toNum(scale.domain[1], type) ?? hi; }
  sc.kind = scale.type === 'log' ? 'log' : scale.type === 'sqrt' ? 'sqrt' : type;
  if (lo === hi) { lo -= 1; hi += 1; }
  if (sc.kind === 'log') { lo = Math.max(lo, 1e-9); }
  if (scale.nice !== false && !scale.domain && sc.kind !== 'temporal') {
    if (sc.kind === 'log') { lo = 10 ** Math.floor(Math.log10(lo)); hi = 10 ** Math.ceil(Math.log10(hi)); }
    else { const n = linearTicks(lo, hi, ch === 'y' ? 6 : 8); lo = n.lo; hi = n.hi; }
  }
  sc.lo = lo; sc.hi = hi;
  const f = sc.kind === 'log' ? Math.log10 : sc.kind === 'sqrt' ? Math.sqrt : (v) => v;
  sc.at = (v) => { const n = toNum(v, type); if (n === null) return null; if (sc.kind === 'log' && n <= 0) return null; const t = (f(n) - f(lo)) / ((f(hi) - f(lo)) || 1); return t * size; };
  sc.size = size;
  sc.band = 0;
  if (sc.kind === 'temporal') {
    const t = timeTicks(lo, hi, ch === 'y' ? 6 : 8);
    sc.ticks = t.ticks.map((v) => ({ v, text: tickLabel(v, t.unit) }));
  } else if (sc.kind === 'log') {
    sc.ticks = [];
    for (let p = Math.ceil(Math.log10(lo)); p <= Math.floor(Math.log10(hi)); p++) sc.ticks.push({ v: 10 ** p, text: formatNumber(10 ** p, scale.format || e.axis?.format) });
  } else {
    const t = sc.kind === 'sqrt' ? linearTicks(lo, hi, 6) : linearTicks(lo, hi, ch === 'y' ? 6 : 8);
    sc.ticks = t.ticks.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).map((v) => ({ v, text: formatNumber(v, e.axis?.format || e.format) }));
  }
  return sc;
}
function colorScale(units, ch) {
  const parts = units.map((u) => ({ e: u.enc[ch], u })).filter((p) => p.e && p.e.type !== 'value');
  if (!parts.length) return null;
  const e = parts[0].e, k = encKey(e);
  if (discrete(e) || e.type === 'nominal' || e.type === 'ordinal') {
    const seen = new Set();
    for (const p of parts) for (const r of p.u.rows) if (r[encKey(p.e)] != null) seen.add(r[encKey(p.e)]);
    let domain = e.scale?.domain || [...seen];
    if (!e.scale?.domain) domain = domain.sort(cmp);
    const range = e.scale?.range || PALETTE;
    return { discrete: true, domain, title: encTitle(e), at: (v) => range[Math.max(0, domain.indexOf(v)) % range.length], enc: e };
  }
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) for (const r of p.u.rows) { const v = toNum(r[encKey(p.e)], p.e.type); if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (e.scale?.domain) { lo = e.scale.domain[0]; hi = e.scale.domain[1]; }
  if (!Number.isFinite(lo)) return null;
  const ramp = e.scale?.range && e.scale.range.length >= 2 ? e.scale.range : ['#deebf7', '#08519c'];
  const mix = (a, b, t) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (!/^#[\da-f]{6}$/i.test(a) || !/^#[\da-f]{6}$/i.test(b)) return t < 0.5 ? a : b;
    const x = p(a), y = p(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  const at = (v) => { const n = toNum(v, e.type); if (n === null) return '#ccc'; const t = Math.max(0, Math.min(1, (n - lo) / ((hi - lo) || 1))); const seg = (ramp.length - 1) * t, i = Math.min(ramp.length - 2, Math.floor(seg)); return mix(ramp[i], ramp[i + 1], seg - i); };
  return { discrete: false, lo, hi, ramp, title: encTitle(e), at, enc: e };
}
function numScale(units, ch, range) {
  const parts = units.map((u) => ({ e: u.enc[ch], u })).filter((p) => p.e && p.e.type !== 'value');
  if (!parts.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const p of parts) for (const r of p.u.rows) { const v = toNum(r[encKey(p.e)], p.e.type); if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!Number.isFinite(lo)) return null;
  const r = parts[0].e.scale?.range || range;
  return (v) => { const n = toNum(v, parts[0].e.type); return n === null ? r[0] : r[0] + ((n - lo) / ((hi - lo) || 1)) * (r[1] - r[0]); };
}

// ---- stacking ----------------------------------------------------------------------------------------
function stackUnit(u, sx, sy) {
  const { mark, enc } = u;
  if (!['bar', 'area', 'rect'].includes(mark)) return;
  if (mark === 'rect') return;
  const vert = enc.y && enc.y.type === 'quantitative' && !enc.y2 && !enc.y.bin && (!enc.x || enc.x.type !== 'quantitative' || enc.x.bin);
  const horiz = enc.x && enc.x.type === 'quantitative' && !enc.x2 && !enc.x.bin && enc.y && enc.y.type !== 'quantitative';
  const axis = vert ? 'y' : horiz ? 'x' : null;
  if (!axis) return;
  const val = enc[axis], cat = enc[axis === 'y' ? 'x' : 'y'];
  const opt = val.stack !== undefined ? val.stack : cat?.stack;
  const hasGroup = enc.color || enc.fill || enc.detail;
  if (opt === null || opt === false || (!hasGroup && opt === undefined)) return;
  if (!hasGroup && !opt) return;
  const vk = encKey(val), ck = cat ? encKey(cat) : null;
  const groups = new Map();
  for (const r of u.rows) {
    const k = ck ? JSON.stringify(r[ck]) : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let lo = 0, hi = 0;
  const gk = encKey(enc.color || enc.fill || enc.detail || {}) ;
  for (const g of groups.values()) {
    const total = g.reduce((a, r) => a + Math.max(0, toNum(r[vk]) || 0), 0);
    g.sort((a, b) => cmp(a[gk], b[gk]));
    let acc = 0;
    for (const r of g) {
      const v = toNum(r[vk]) || 0;
      const a = acc, b = acc + v;
      acc = b;
      r.__s0 = opt === 'normalize' && total ? a / total : a;
      r.__s1 = opt === 'normalize' && total ? b / total : b;
      lo = Math.min(lo, r.__s0); hi = Math.max(hi, r.__s1);
    }
  }
  u.stacked = axis;
  u.stackSpan = [lo, hi];
  if (opt === 'normalize') val.axis = { ...(val.axis || {}), format: val.axis?.format || '%' };
}

// ---- drawing -------------------------------------------------------------------------------------------
function legendSvg(c, x, y) {
  if (!c) return { svg: '', h: 0 };
  let out = `<text class="vl-title" x="${x}" y="${y}" font-weight="600">${esc(c.title)}</text>`;
  if (c.discrete) {
    c.domain.slice(0, 20).forEach((v, i) => {
      out += `<rect x="${x}" y="${y + 8 + i * 16}" width="10" height="10" rx="2" fill="${esc(c.at(v))}"/><text x="${x + 16}" y="${y + 17 + i * 16}">${esc(String(v).slice(0, 18))}</text>`;
    });
    return { svg: out, h: 16 + Math.min(20, c.domain.length) * 16 };
  }
  const id = 'g' + Math.abs(Math.round(x * 31 + y * 7 + c.lo)),
    stops = Array.from({ length: 6 }, (_, i) => `<stop offset="${i * 20}%" stop-color="${esc(c.at(c.hi - ((c.hi - c.lo) * i) / 5))}"/>`).join('');
  out += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs><rect x="${x}" y="${y + 8}" width="12" height="90" fill="url(#${id})"/><text x="${x + 18}" y="${y + 17}">${formatNumber(c.hi)}</text><text x="${x + 18}" y="${y + 104}">${formatNumber(c.lo)}</text>`;
  return { svg: out, h: 116 };
}
function symbolPath(shape, cx, cy, area) {
  const r = Math.sqrt(area) / 2;
  switch (shape) {
    case 'square': return `M${cx - r},${cy - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    case 'diamond': return `M${cx},${cy - r * 1.3}L${cx + r * 1.3},${cy}L${cx},${cy + r * 1.3}L${cx - r * 1.3},${cy}z`;
    case 'triangle-up': return `M${cx},${cy - r * 1.2}L${cx + r * 1.1},${cy + r}L${cx - r * 1.1},${cy + r}z`;
    case 'cross': return `M${cx - r},${cy}h${2 * r}M${cx},${cy - r}v${2 * r}`;
    default: return `M${cx - r * 1.13},${cy}a${r * 1.13},${r * 1.13} 0 1 0 ${r * 2.26},0a${r * 1.13},${r * 1.13} 0 1 0 ${-r * 2.26},0`;
  }
}
function drawUnit(u, X, Y, C, size, opacityScale) {
  const { mark: m, enc, rows } = u;
  const mk = typeof u.markDef === 'object' ? u.markDef : {};
  const type = m;
  const xk = enc.x ? encKey(enc.x) : null, yk = enc.y ? encKey(enc.y) : null;
  const colorEnc = enc.color || enc.fill, strokeEnc = enc.stroke;
  const fillOf = (r) => (colorEnc ? (colorEnc.type === 'value' ? colorEnc.value : C.color ? C.color.at(r[encKey(colorEnc)]) : PALETTE[0]) : mk.color || mk.fill || PALETTE[0]);
  const strokeOf = (r) => (strokeEnc ? (strokeEnc.type === 'value' ? strokeEnc.value : C.stroke ? C.stroke.at(r[encKey(strokeEnc)]) : PALETTE[0]) : mk.stroke || null);
  const opac = (r) => (enc.opacity ? (enc.opacity.type === 'value' ? enc.opacity.value : opacityScale ? opacityScale(r[encKey(enc.opacity)]) : 1) : mk.opacity ?? undefined);
  const attrs = (r, filled) => `${filled ? `fill="${esc(fillOf(r))}"` : `fill="none"`} ${filled ? (strokeOf(r) ? `stroke="${esc(strokeOf(r))}"` : '') : `stroke="${esc(strokeOf(r) || fillOf(r))}" stroke-width="${mk.strokeWidth ?? 2}"`} ${opac(r) !== undefined ? `opacity="${opac(r)}"` : ''}`;
  const tip = (r) => {
    const fields = new Set();
    const t = Array.isArray(u.rawTooltip) ? u.rawTooltip : null;
    for (const e of t || Object.values(enc)) if (e && e.field) fields.add(e.field);
    const parts = [...Object.values(enc)].filter((e) => e.field && (!t || t.some((x) => x.field === e.field))).map((e) => `${encTitle(e) || e.field}: ${formatCell(r[encKey(e)], e)}`);
    return `<title>${esc([...new Set(parts)].join('\n'))}</title>`;
  };
  const px = (r, e = enc.x, s = X) => {
    if (!e) return null;
    if (e.type === 'value') return e.value;
    if (!s) return null;
    return e.datum !== undefined ? s.at(e.datum) : s.at(r[encKey(e)]);
  };
  const pos = (r, ch) => {
    const e = enc[ch], s = ch === 'x' || ch === 'x2' ? X : Y;
    if (!e) return null;
    if (e.type === 'value') return typeof e.value === 'number' ? e.value : null;
    if (e.datum !== undefined) return s?.at(e.datum) ?? null;
    return s ? s.at(r[encKey(e)]) : null;
  };
  let out = '';
  const w = X?.size ?? size.w, h = Y?.size ?? size.h;
  const items = rows;
  if (['point', 'circle', 'square', 'tick'].includes(type)) {
    const big = enc.size ? numScale([u], 'size', type === 'tick' ? [8, 20] : [20, 300]) : null;
    for (const r of items) {
      let x = pos(r, 'x'), y = pos(r, 'y');
      if (x === null && !enc.x) x = w / 2;
      if (y === null && !enc.y) y = h / 2;
      if (x === null || y === null) continue;
      if (X?.kind === 'band' && mk.xOffset) x += mk.xOffset;
      const area = enc.size ? (enc.size.type === 'value' ? enc.size.value : big(r[encKey(enc.size)])) : mk.size ?? (type === 'point' ? 30 : 60);
      if (type === 'tick') {
        const horizontalTick = Y?.kind === 'band';
        const len = X?.kind === 'band' || Y?.kind === 'band' ? (horizontalTick ? Y.band : X.band) : 18;
        out += horizontalTick ? `<line x1="${num(x)}" x2="${num(x)}" y1="${num(y - len / 2)}" y2="${num(y + len / 2)}" stroke="${esc(fillOf(r))}" stroke-width="${mk.thickness ?? 1}" ${opac(r) !== undefined ? `opacity="${opac(r)}"` : ''}>${tip(r)}</line>` : `<line x1="${num(x - len / 2)}" x2="${num(x + len / 2)}" y1="${num(y)}" y2="${num(y)}" stroke="${esc(fillOf(r))}" stroke-width="${mk.thickness ?? 1}" ${opac(r) !== undefined ? `opacity="${opac(r)}"` : ''}>${tip(r)}</line>`;
        continue;
      }
      const shape = enc.shape && C.shape ? C.shape(r[encKey(enc.shape)]) : type === 'square' ? 'square' : mk.shape || 'circle';
      const filled = type !== 'point' || mk.filled === true;
      out += `<path d="${symbolPath(shape, num(x), num(y), area)}" ${attrs(r, filled)}>${tip(r)}</path>`;
    }
  } else if (type === 'bar' || type === 'rect') {
    const ybar = Y?.kind === 'band' && X && X.kind !== 'band' ? 'h' : 'v';
    for (const r of items) {
      let x0, x1, y0, y1;
      const xe = enc.x, ye = enc.y;
      // x extent
      if (X?.kind === 'band') { const c = X.at(r[xk]); if (c === null) continue; const bw = (type === 'rect' ? X.step : X.band); const sub = mk.__sub; x0 = c - bw / 2; x1 = c + bw / 2; }
      else if (xe?.bin) { x0 = X.at(r[xk]); x1 = X.at(r[xk + '_end']); }
      else if (enc.x2) { x0 = pos(r, 'x'); x1 = pos(r, 'x2'); }
      else if (X) { const v = u.stacked === 'x' ? r.__s1 : r[xk]; const z = u.stacked === 'x' ? r.__s0 : 0; x1 = X.at(v); x0 = u.stacked === 'x' ? X.at(z) : X.at(Math.max(X.lo, Math.min(0, X.hi))); if (x1 === null) continue; }
      else { x0 = 0; x1 = w; }
      if (Y?.kind === 'band') { const c = Y.at(r[yk]); if (c === null) continue; const bw = (type === 'rect' ? Y.step : Y.band); y0 = c - bw / 2; y1 = c + bw / 2; }
      else if (ye?.bin) { y0 = Y.at(r[yk]); y1 = Y.at(r[yk + '_end']); }
      else if (enc.y2) { y0 = pos(r, 'y'); y1 = pos(r, 'y2'); }
      else if (Y) { const v = u.stacked === 'y' ? r.__s1 : r[yk]; y1 = Y.at(v); y0 = u.stacked === 'y' ? Y.at(r.__s0) : Y.at(Math.max(Y.lo, Math.min(0, Y.hi))); if (y1 === null) continue; }
      else { y0 = h; y1 = 0; }
      if ([x0, x1, y0, y1].some((v) => v === null || v === undefined || Number.isNaN(v))) continue;
      const rx = Math.min(x0, x1), ry = Math.min(y0, y1), rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
      out += `<rect class="mark" x="${num(rx)}" y="${num(ry)}" width="${num(Math.max(type === 'rect' ? 0 : 0.5, rw - (xe?.bin && type === 'bar' ? 1 : 0)))}" height="${num(Math.max(0, rh))}" rx="${mk.cornerRadius ?? 0}" ${attrs(r, true)}>${tip(r)}</rect>`;
    }
  } else if (type === 'line' || type === 'area' || type === 'trail') {
    const groupKeys = [enc.color, enc.fill, enc.stroke, enc.detail, enc.shape].filter((e) => e && e.field).map(encKey);
    const groups = new Map();
    for (const r of items) { const k = JSON.stringify(groupKeys.map((g) => r[g])); (groups.get(k) || groups.set(k, []).get(k)).push(r); }
    const along = X && X.kind !== 'band' ? 'x' : Y && Y.kind !== 'band' && X?.kind === 'band' ? 'x' : X ? 'x' : 'y';
    const orderKey = enc.order ? encKey(enc.order) : null;
    for (const g of groups.values()) {
      const pts = g.map((r) => ({ r, x: pos(r, 'x'), y: pos(r, 'y'), y0: u.stacked === 'y' ? Y.at(r.__s0) : null, yy: u.stacked === 'y' ? Y.at(r.__s1) : null }));
      const sortBy = orderKey ? (p) => p.r[orderKey] : (p) => p.x;
      if (!enc.order || true) pts.sort((a, b) => cmp(sortBy(a), sortBy(b)));
      let segs = [[]];
      for (const p of pts) {
        const y = type === 'area' && u.stacked === 'y' ? p.yy : p.y;
        if (p.x === null || y === null) { if (segs.at(-1).length) segs.push([]); continue; }
        segs.at(-1).push({ ...p, y });
      }
      const interp = mk.interpolate || 'linear';
      const colorV = g[0] ? fillOf(g[0]) : PALETTE[0];
      for (const s of segs.filter((s) => s.length)) {
        let d = '';
        s.forEach((p, i) => {
          if (!i) d += `M${num(p.x)},${num(p.y)}`;
          else if (interp.startsWith('step')) d += interp === 'step-after' ? `H${num(p.x)}V${num(p.y)}` : interp === 'step-before' ? `V${num(p.y)}H${num(p.x)}` : `H${num((s[i - 1].x + p.x) / 2)}V${num(p.y)}H${num(p.x)}`;
          else d += `L${num(p.x)},${num(p.y)}`;
        });
        if (type === 'area') {
          const base = (p) => (u.stacked === 'y' ? p.y0 : Y.at(Math.max(Y.lo, Math.min(0, Y.hi))));
          const back = s.slice().reverse().map((p) => `L${num(p.x)},${num(base(p))}`).join('');
          out += `<path d="${d}${back}Z" fill="${esc(colorV)}" fill-opacity="${mk.opacity ?? 0.7}" stroke="${mk.line ? esc(colorV) : 'none'}"/>`;
        } else out += `<path class="series" d="${d}" fill="none" stroke="${esc(strokeEnc ? strokeOf(g[0]) : colorV)}" stroke-width="${mk.strokeWidth ?? 2}" stroke-linejoin="round" ${mk.strokeDash ? `stroke-dasharray="${mk.strokeDash.join(' ')}"` : ''} ${mk.opacity !== undefined ? `opacity="${mk.opacity}"` : ''}/>`;
        if (mk.point) for (const p of s) out += `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="3.2" fill="${esc(colorV)}">${tip(p.r)}</circle>`;
        else if (type === 'line') for (const p of s) out += `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="9" fill="transparent">${tip(p.r)}</circle>`;
      }
    }
  } else if (type === 'rule') {
    const rowsR = items.length ? items : [{}];
    for (const r of rowsR) {
      const x = pos(r, 'x'), y = pos(r, 'y'), x2 = pos(r, 'x2'), y2 = pos(r, 'y2');
      const stroke = strokeOf(r) || (colorEnc ? fillOf(r) : mk.color || 'currentColor'), dash = mk.strokeDash ? `stroke-dasharray="${mk.strokeDash.join(' ')}"` : '';
      const base = `stroke="${esc(stroke)}" stroke-width="${mk.size ?? mk.strokeWidth ?? 1}" ${dash}`;
      let line = '';
      if (x !== null && y !== null) line = `<line x1="${num(x)}" x2="${num(x2 ?? x)}" y1="${num(y)}" y2="${num(y2 ?? y)}" ${base}/>`;
      else if (x !== null) line = `<line x1="${num(x)}" x2="${num(x2 ?? x)}" y1="${num(y2 !== null ? 0 : 0)}" y2="${num(y2 ?? h)}" ${base}/>`;
      else if (y !== null) line = `<line x1="0" x2="${num(x2 ?? w)}" y1="${num(y)}" y2="${num(y2 ?? y)}" ${base}/>`;
      out += line.replace('/>', `>${tip(r)}</line>`);
    }
  } else if (type === 'text') {
    for (const r of items) {
      let x = pos(r, 'x'), y = pos(r, 'y');
      if (x === null && !enc.x) x = w / 2;
      if (y === null && !enc.y) y = h / 2;
      if (x === null || y === null) continue;
      const te = enc.text, t = te ? (te.type === 'value' ? te.value : formatCell(r[encKey(te)], te)) : mk.text ?? '';
      const align = mk.align || 'center', base = mk.baseline || 'middle';
      out += `<text x="${num(x + (mk.dx || 0))}" y="${num(y + (mk.dy || 0))}" text-anchor="${align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'}" dominant-baseline="${base === 'top' ? 'hanging' : base === 'bottom' ? 'text-bottom' : 'central'}" font-size="${mk.fontSize ?? 11}" fill="${esc(colorEnc ? fillOf(r) : mk.color || 'currentColor')}" ${mk.angle ? `transform="rotate(${mk.angle} ${num(x)} ${num(y)})"` : ''}>${esc(t)}</text>`;
    }
  } else if (type === 'arc') {
    const tk = enc.theta ? encKey(enc.theta) : null;
    const total = items.reduce((a, r) => a + Math.max(0, toNum(r[tk]) || 0), 0) || 1;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 4, r0 = mk.innerRadius ?? 0;
    let a = -Math.PI / 2;
    const sorted = enc.order ? items.slice().sort((p, q) => cmp(p[encKey(enc.order)], q[encKey(enc.order)])) : items;
    for (const r of sorted) {
      const v = Math.max(0, toNum(r[tk]) || 0), da = (v / total) * Math.PI * 2;
      if (da <= 0) continue;
      const b = a + da, big = da > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${num(cx + rad * Math.cos(ang))},${num(cy + rad * Math.sin(ang))}`;
      out += da >= Math.PI * 2 - 1e-6
        ? `<circle cx="${num(cx)}" cy="${num(cy)}" r="${R}" ${attrs(r, true)}>${tip(r)}</circle>`
        : `<path d="M${p(r0, a)}${r0 ? '' : ''}${r0 ? `L${p(R, a)}A${R},${R} 0 ${big} 1 ${p(R, b)}L${p(r0, b)}A${r0},${r0} 0 ${big} 0 ${p(r0, a)}` : `L${p(R, a)}A${R},${R} 0 ${big} 1 ${p(R, b)}`}Z" ${attrs(r, true)} stroke="#fff" stroke-width="1">${tip(r)}</path>`;
      a = b;
    }
  } else {
    return null;
  }
  return out;
}
function formatCell(v, e) {
  if (v === null || v === undefined) return '';
  if (e?.type === 'temporal') return e.timeUnit ? timeLabel(v, e.timeUnit) : new Date(v).toISOString().slice(0, 10);
  if (typeof v === 'number') return formatNumber(v, e?.format || e?.axis?.format);
  return String(v);
}

// ---- layout of one view -------------------------------------------------------------------------------
async function collectUnits(spec, inh, ctx) {
  const encoding = { ...(inh.encoding || {}), ...(spec.encoding || {}) };
  const own = async () => {
    const base = spec.data ? (await dataRows(spec, ctx)) || [] : (inh.rows || []).map((r) => ({ ...r }));
    return runTransforms(base, spec.transform, ctx);
  };
  if (spec.layer) {
    const rows = await own(),
      out = [];
    for (const child of spec.layer) out.push(...(await collectUnits(child, { rows, encoding }, ctx)));
    return out;
  }
  if (!spec.mark) {
    ctx.notes.add('A layer without a mark was skipped');
    return [];
  }
  const rows = await own();
  const markDef = typeof spec.mark === 'string' ? { type: spec.mark } : { ...spec.mark },
    type = markDef.type;
  const SUPPORTED = ['bar', 'line', 'point', 'circle', 'square', 'area', 'rule', 'text', 'tick', 'rect', 'arc'];
  if (!SUPPORTED.includes(type)) {
    ctx.notes.add(`The "${type}" mark is not drawn`);
    return [];
  }
  if (spec.params || spec.selection) ctx.notes.add('Interactive parameters and selections are not run; the first state is drawn');
  const enc = normalizeEncoding(encoding, type, ctx);
  return [{ mark: type, markDef, enc, rows: prepare(rows, enc) }];
}
function layoutView(units, opts, ctx) {
  // pass 1: stack, so scales include totals
  const plotW = opts.width, plotH = opts.height;
  for (const u of units) stackUnit(u);
  const xHost = units.find((u) => u.enc.x && discrete(u.enc.x));
  const step = opts.step;
  let X = buildScale(units, 'x', plotW, { step: step?.x }), Y = buildScale(units, 'y', plotH, { step: step?.y });
  const hasDiscrete = (X?.kind === 'band') || (Y?.kind === 'band');
  const C = { color: colorScale(units, 'color') || colorScale(units, 'fill'), stroke: colorScale(units, 'stroke') };
  if (units.some((u) => u.enc.shape && u.enc.shape.field)) {
    const k = units.find((u) => u.enc.shape).enc.shape, vals = [...new Set(units.flatMap((u) => u.rows.map((r) => r[encKey(k)])))];
    const shapes = ['circle', 'square', 'cross', 'diamond', 'triangle-up'];
    C.shape = (v) => shapes[vals.indexOf(v) % shapes.length];
  }
  const size = { w: X?.size ?? plotW, h: Y?.size ?? plotH };
  const opacityScale = numScale(units, 'opacity', [0.2, 1]);
  let body = '';
  // grid + axes
  let axes = '';
  const grid = (units.every((u) => !['text', 'arc'].includes(u.mark)));
  const drawAxis = (S, vertical) => {
    if (!S) return '';
    const e = S.e, axisCfg = e.axis;
    if (axisCfg === null) return '';
    const title = S.title;
    let g = '';
    if (S.kind === 'band') {
      const every = Math.max(1, Math.ceil(S.domain.length / (vertical ? 40 : Math.max(2, Math.floor(S.size / 46)))));
      const longest = Math.max(...S.domain.map((v) => S.label(v).length));
      const rotate = !vertical && longest * 6 > S.step * every && S.step < 70 && every === 1;
      S.domain.forEach((v, i) => {
        if (i % every) return;
        const c = S.at(v), text = S.label(v);
        g += vertical
          ? `<line x1="-4" x2="0" y1="${num(c)}" y2="${num(c)}" class="vl-tick"/><text x="-8" y="${num(c)}" text-anchor="end" dominant-baseline="central">${esc(text.slice(0, 22))}</text>`
          : `<line x1="${num(c)}" x2="${num(c)}" y1="0" y2="4" class="vl-tick"/><text x="${num(c)}" y="${rotate ? 10 : 16}" text-anchor="${rotate ? 'end' : 'middle'}" ${rotate ? `transform="rotate(-45 ${num(c)} 10)"` : ''}>${esc(text.slice(0, rotate ? 16 : Math.max(4, Math.floor((S.step * every) / 6))))}</text>`;
      });
    } else {
      for (const t of S.ticks || []) {
        const p = S.at(t.v);
        if (p === null) continue;
        if (vertical) {
          if (grid && axisCfg?.grid !== false) body = `<line x1="0" x2="${size.w}" y1="${num(size.h - p)}" y2="${num(size.h - p)}" class="vl-grid"/>` + body;
          g += `<line x1="-4" x2="0" y1="${num(size.h - p)}" y2="${num(size.h - p)}" class="vl-tick"/><text x="-8" y="${num(size.h - p)}" text-anchor="end" dominant-baseline="central">${esc(t.text)}</text>`;
        } else {
          if (grid && axisCfg?.grid === true) body = `<line y1="0" y2="${size.h}" x1="${num(p)}" x2="${num(p)}" class="vl-grid"/>` + body;
          g += `<line x1="${num(p)}" x2="${num(p)}" y1="0" y2="4" class="vl-tick"/><text x="${num(p)}" y="16" text-anchor="middle">${esc(t.text)}</text>`;
        }
      }
    }
    if (title) g += vertical ? `<text class="vl-title" transform="translate(-44 ${size.h / 2}) rotate(-90)" text-anchor="middle">${esc(title)}</text>` : `<text class="vl-title" x="${size.w / 2}" y="${S.kind === 'band' && !vertical ? 44 : 38}" text-anchor="middle">${esc(title)}</text>`;
    return g;
  };
  // Y scale outputs bottom-up; flip into screen coords for drawing.
  const flipY = Y && Y.kind !== 'band' ? { ...Y, at: (v) => { const p = Y.at(v); return p === null ? null : size.h - p; } } : Y;
  const Yd = Y && Y.kind === 'band' ? Y : flipY;
  if (Yd && Yd.kind === 'band') { /* band y reads top to bottom */ }
  // X for continuous also needs its size
  let marks = '';
  for (const u of units) {
    const drawn = drawUnit(u, X, Yd, C, size, opacityScale);
    if (drawn === null) { ctx.notes.add(`The "${u.mark}" mark is not drawn`); continue; }
    marks += drawn;
  }
  const flippedAxisY = Y && Y.kind !== 'band' ? { ...Y } : Y;
  const xAxis = drawAxis(X, false);
  const yAxis = Y && Y.kind === 'band' ? drawAxis(Y, true) : drawAxis(flippedAxisY, true);
  const baseline = X && X.kind !== 'band' && Y && Y.kind !== 'band' ? '' : '';
  axes = `<g class="vl-axis" transform="translate(0 ${size.h})">${X ? `<line x1="0" x2="${size.w}" class="vl-domain"/>` : ''}${xAxis}</g><g class="vl-axis">${Y ? `<line y1="0" y2="${size.h}" class="vl-domain"/>` : ''}${yAxis}</g>`;
  const legends = [legendSvg(C.color, 0, 0), legendSvg(C.stroke, 0, 0)].filter((l) => l.svg);
  let legendBlock = '', legendH = 0;
  for (const l of legends) {
    legendBlock += `<g transform="translate(0 ${legendH})">${l.svg}</g>`;
    legendH += l.h + 14;
  }
  return { size, body, marks, axes, legends: legendBlock, hasLegend: legends.length > 0, legendH, empty: !units.some((u) => u.rows.length) };
}
const css = `.vl text{font:11px system-ui,sans-serif;fill:currentColor}.vl .vl-title{font-weight:600}.vl .vl-big{font-size:15px;font-weight:700}.vl .vl-grid{stroke:currentColor;stroke-opacity:.14}.vl .vl-domain,.vl .vl-tick{stroke:currentColor;stroke-opacity:.55}`;
// One complete chart (unit or layered) as an SVG group of known size.
async function renderUnit(spec, inh, ctx) {
  const units = await collectUnits(spec, inh, ctx);
  const width = typeof spec.width === 'number' ? spec.width : typeof inh.width === 'number' ? inh.width : 420,
    height = typeof spec.height === 'number' ? spec.height : typeof inh.height === 'number' ? inh.height : 260;
  const lay = layoutView(units, { width, height, step: { x: spec.width?.step ?? inh.width?.step, y: spec.height?.step ?? inh.height?.step } }, ctx);
  const left = 62,
    top = 12,
    right = lay.hasLegend ? 120 : 16;
  const svg = `<g class="vl-unit"><g transform="translate(${left} ${top})"><g class="vl-body">${lay.body}</g><g class="vl-marks">${lay.marks}</g>${lay.axes}<g transform="translate(${lay.size.w + 18} 0)">${lay.legends}</g></g></g>`;
  return { svg, width: left + lay.size.w + right, height: top + lay.size.h + 52, empty: lay.empty };
}
function replaceRepeat(spec, map) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      if (v.repeat && Object.keys(v).length === 1 && map[v.repeat] !== undefined) return map[v.repeat];
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(spec);
}
const wrapCells = (cells, cols, gap = 28) => {
  let y = 0, x = 0, rowH = 0, maxW = 0, out = '';
  cells.forEach((c, i) => {
    if (i && i % cols === 0) { y += rowH + gap; x = 0; rowH = 0; }
    out += `<g transform="translate(${x} ${y})">${c.svg}</g>`;
    x += c.width + gap;
    rowH = Math.max(rowH, c.height);
    maxW = Math.max(maxW, x - gap);
  });
  return { svg: out, width: maxW, height: y + rowH, empty: cells.every((c) => c.empty) };
};
async function renderAny(spec, inh, ctx, depth = 0) {
  if (depth > 6) throw new Error('nested too deeply');
  const rows = async () => runTransforms(spec.data ? (await dataRows(spec, ctx)) || [] : (inh.rows || []).map((r) => ({ ...r })), spec.transform, ctx);
  const next = { encoding: { ...(inh.encoding || {}), ...(spec.encoding || {}) }, width: spec.width ?? inh.width, height: spec.height ?? inh.height };
  const heading = typeof spec.title === 'string' ? spec.title : spec.title?.text;
  const head = (r) => (heading ? { ...r, svg: `<text class="vl-big" x="4" y="16">${esc(heading)}</text><g transform="translate(0 28)">${r.svg}</g>`, height: r.height + 28, width: Math.max(r.width, 200) } : r);
  if (spec.hconcat || spec.vconcat || spec.concat) {
    const list = spec.hconcat || spec.vconcat || spec.concat,
      shared = await rows(),
      cells = [];
    for (const c of list) cells.push(await renderAny(c, { ...next, rows: shared, encoding: {} }, ctx, depth + 1));
    return head(wrapCells(cells, spec.hconcat ? 1000 : spec.concat ? spec.columns || 2 : 1));
  }
  if (spec.repeat) {
    const rep = spec.repeat,
      shared = await rows(),
      cells = [];
    if (Array.isArray(rep)) {
      for (const f of rep) cells.push(await renderAny(replaceRepeat(spec.spec, { repeat: f }), { ...next, rows: shared }, ctx, depth + 1));
      return head(wrapCells(cells, spec.columns || 2));
    }
    const rs = rep.row || [null],
      cs = rep.column || [null];
    for (const r of rs) for (const c of cs) cells.push(await renderAny(replaceRepeat(spec.spec, { row: r, column: c }), { ...next, rows: shared }, ctx, depth + 1));
    return head(wrapCells(cells, cs.length));
  }
  if (spec.facet) {
    const f = spec.facet,
      rowF = f.row?.field || null,
      colF = f.column?.field || f.field || null,
      data = await rows();
    const colVals = colF ? [...new Set(data.map((r) => r[colF]))].sort(cmp) : [null],
      rowVals = rowF ? [...new Set(data.map((r) => r[rowF]))].sort(cmp) : [null],
      cols = f.field ? f.columns || Math.min(3, colVals.length) : colVals.length,
      cells = [];
    for (const rv of rowVals)
      for (const cv of colVals) {
        const subset = data.filter((r) => (rowF ? r[rowF] === rv : true) && (colF ? r[colF] === cv : true));
        cells.push(
          await renderAny(
            { ...spec.spec, title: [rowF && `${rowF}: ${rv}`, colF && `${colF}: ${cv}`].filter(Boolean).join(' · ') },
            { ...next, rows: subset, width: spec.spec.width ?? Math.max(120, Math.floor(420 / Math.max(1, cols)) - 60), height: spec.spec.height ?? 160 },
            ctx,
            depth + 1,
          ),
        );
      }
    return head(wrapCells(cells, cols));
  }
  return head(await renderUnit(spec, { ...next, rows: inh.rows }, ctx));
}
export async function renderVegaLite(spec, { load, datasets } = {}) {
  const ctx = { notes: new Set(), load, datasets: { ...(spec.datasets || {}), ...(datasets || {}) } };
  if (spec.params) ctx.notes.add('Interactive parameters are not run; the first state is drawn');
  const result = await renderAny(spec, {}, ctx),
    pad = 14,
    bg = spec.background ? `<rect width="100%" height="100%" fill="${esc(spec.background)}"/>` : '';
  const svg = `<svg class="chart vl" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(result.width + pad * 2)} ${Math.ceil(result.height + pad * 2)}" role="img" aria-label="${esc((typeof spec.title === 'string' ? spec.title : spec.title?.text) || 'Chart')}"><style>${css}</style>${bg}<g transform="translate(${pad} ${pad})">${result.svg}</g></svg>`;
  return { svg, notes: [...ctx.notes], empty: result.empty };
}
