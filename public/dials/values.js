// Small, bounded arithmetic parser. Units are converted before evaluation; code is never executed.
export const clone = (value) => structuredClone(value);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const clamp = (n, min = -Infinity, max = Infinity) =>
  Math.max(min, Math.min(max, n));
const units = {
  px: ["length", 1],
  ms: ["time", 1],
  s: ["time", 1000],
  deg: ["angle", 1],
  rad: ["angle", 180 / Math.PI],
  turn: ["angle", 360],
  "%": ["percent", 1],
};
/** Magnitude words people type after a number: 2k, 1.5M, 3B, 1.2T. */
const magnitudes = { k: 1e3, m: 1e6, b: 1e9, g: 1e9, t: 1e12 };
export const symbolUnit = (u) => typeof u === "string" && !!u && !/^[a-z%]+$/i.test(u);
export function expression(text, control = {}) {
  text = String(text).trim();
  // A symbol unit ($, €, °, ×) may be typed before or after the number; thousands commas are read.
  if (symbolUnit(control.unit)) text = text.split(control.unit).join("").trim();
  text = text.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  if (!text || text.length > 200)
    throw new Error("Enter a number or arithmetic expression");
  const tokens =
    text.match(
      /(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?(?:[a-z]+|%)?|[()+*/-]/gi,
    ) || [];
  if (tokens.join("").toLowerCase() !== text.replace(/\s/g, "").toLowerCase())
    throw new Error("Use numbers, units and + − * /");
  let at = 0;
  const sum = () => {
    let a = product();
    while (["+", "-"].includes(tokens[at])) {
      const op = tokens[at++],
        b = product();
      a = op === "+" ? a + b : a - b;
    }
    return a;
  };
  const product = () => {
    let a = atom();
    while (["*", "/"].includes(tokens[at])) {
      const op = tokens[at++],
        b = atom();
      a = op === "*" ? a * b : a / b;
    }
    return a;
  };
  const atom = () => {
    const token = tokens[at++];
    if (token === "+" || token === "-")
      return (token === "-" ? -1 : 1) * atom();
    if (token === "(") {
      const n = sum();
      if (tokens[at++] !== ")") throw new Error("Close the parenthesis");
      return n;
    }
    const m = /^(\d*\.?\d+(?:e[+-]?\d+)?)([a-z]+|%)?$/i.exec(token || "");
    if (!m) throw new Error("Expected a number");
    let n = Number(m[1]);
    let from = m[2]?.toLowerCase();
    const to = control.unit;
    if (from && magnitudes[from] && from !== to?.toLowerCase()) {
      n *= magnitudes[from];
      from = undefined;
    }
    if (from && from !== to) {
      // A percentage means a share of the range when there is one, otherwise a share of the current value.
      if (from === "%" && to !== "%") {
        if (Number.isFinite(control.max))
          return (
            (control.min || 0) + (n / 100) * (control.max - (control.min || 0))
          );
        if (Number.isFinite(control.value)) return (n / 100) * control.value;
      }
      if (!units[from] || !units[to] || units[from][0] !== units[to][0])
        throw new Error(`Expected ${to || "a unitless value"}`);
      n *= units[from][1] / units[to][1];
    }
    return n;
  };
  const value = sum();
  if (at !== tokens.length || !Number.isFinite(value))
    throw new Error("Expression must produce a finite number");
  return quantize(value, control);
}
export function quantize(value, c) {
  const step = c.step || 0;
  const n = step
    ? Math.round((value - (c.min || 0)) / step) * step + (c.min || 0)
    : value;
  return Number(clamp(n, c.min, c.max).toFixed(8));
}
export const numeric = (c) =>
  ["number", "range", "angle", "seed"].includes(c.type);
export const scrubLimits = {
  typography: { size: [6, 240], weight: [100, 1000], lineHeight: [0.5, 3] },
  image: {
    gamma: [0.1, 5],
    black: [0, 0.99],
    white: [0.01, 1],
    exposure: [-5, 5],
    saturation: [0, 3],
  },
  sampler: {
    steps: [1, 150],
    cfg: [0, 30],
    shift: [0.1, 10],
    seed: [0, 4294967295],
    denoise: [0, 1],
  },
  motion: {
    damping: [0.1, 200],
    stiffness: [1, 2000],
    mass: [0.01, 20],
    duration: [1, 60000],
    delay: [0, 60000],
  },
  shadow: { blur: [0, 100] },
};
function validateJSON(value, depth = 0) {
  if (depth > 30) throw new Error("Value nesting exceeds 30 levels");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === undefined)
    throw new Error("Values must be finite JSON");
  for (const v of Object.values(value)) validateJSON(v, depth + 1);
}
const compactWords = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
];
/** A number as a person reads it: 12,500 · 1.5M · 2.25T. Always reads back exactly. */
export function humane(n, c = {}) {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (c.type === "seed" || c.plain || a < 10000) return String(Number(n.toFixed(5)));
  for (const [k, w] of compactWords)
    if (a >= k) {
      const short = Number((n / k).toFixed(3));
      if (Math.abs(short * k - n) <= 1e-9 * a) return `${short}${w}`;
    }
  return a < 1e21 ? n.toLocaleString("en-US", { maximumFractionDigits: 5 }) : String(n);
}
const currency = /^[$€£¥₹]$/;
export function format(value, c = {}) {
  if (typeof value === "number") {
    const u = c.unit || "",
      text = humane(value, c);
    if (currency.test(u)) return value < 0 ? `-${u}${text.slice(1)}` : `${u}${text}`;
    return `${text}${u && /[A-Z]$/.test(text) && !symbolUnit(u) ? " " : ""}${u}`;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}
export function parse(text, c) {
  if (numeric(c)) return expression(text, c);
  if (["text", "color", "gradient", "asset", "file"].includes(c.type))
    return text;
  let v;
  // Rows read JSON or a JS literal (single quotes, bare keys, trailing commas, comments).
  v = looseJson(text);
  validateValue(v, c);
  return v;
}
export function validateValue(value, c) {
  validateJSON(value);
  if (numeric(c) && (typeof value !== "number" || !Number.isFinite(value)))
    throw new Error(`${c.id}: expected a finite number`);
  if (
    numeric(c) &&
    (value < (c.min ?? -Infinity) || value > (c.max ?? Infinity))
  )
    throw new Error(`${c.id}: value outside range`);
  if (c.type === "boolean" && typeof value !== "boolean")
    throw new Error(`${c.id}: expected true or false`);
  if (
    ["text", "color", "gradient", "asset", "file"].includes(c.type) &&
    typeof value !== "string"
  )
    throw new Error(`${c.id}: expected text`);
  if (
    ["select", "segmented"].includes(c.type) &&
    !(c.options || []).some((o) =>
      same(typeof o === "object" ? o.value : o, value),
    )
  )
    throw new Error(`${c.id}: unknown option`);
  if (
    ["vector", "spacing"].includes(c.type) &&
    (!Array.isArray(value) ||
      value.length !== (c.type === "vector" ? 2 : 4) ||
      value.some((v) => typeof v !== "number" || !Number.isFinite(v)))
  )
    throw new Error(
      `${c.id}: expected ${c.type === "vector" ? "two" : "four"} numbers`,
    );
  if (
    [
      "motion",
      "spring",
      "bezier",
      "shadow",
      "typography",
      "image",
      "encoding",
      "sampler",
    ].includes(c.type) &&
    (!value || typeof value !== "object" || Array.isArray(value))
  )
    throw new Error(`${c.id}: expected an object`);
  if (c.type === "motion" || c.type === "bezier" || c.type === "spring") {
    const v = value;
    if (
      v.bezier &&
      (!Array.isArray(v.bezier) ||
        v.bezier.length !== 4 ||
        v.bezier.some((n) => !Number.isFinite(n)) ||
        v.bezier[0] < 0 ||
        v.bezier[0] > 1 ||
        v.bezier[2] < 0 ||
        v.bezier[2] > 1)
    )
      throw new Error(
        "Bezier needs four numbers; x handles must be between 0 and 1",
      );
    for (const key of ["mass", "stiffness", "damping", "duration"])
      if (key in v && (!Number.isFinite(v[key]) || v[key] <= 0))
        throw new Error(`${key} must be positive`);
    if (v.mode !== undefined && !["bezier", "spring"].includes(v.mode))
      throw new Error("Unknown motion response");
    if (
      v.loopRange !== undefined &&
      (!Array.isArray(v.loopRange) ||
        v.loopRange.length !== 2 ||
        !v.loopRange.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
        v.loopRange[0] >= v.loopRange[1])
    )
      throw new Error("loopRange needs two numbers from 0 to 1, the first smaller");
    if (
      v.keyframes !== undefined &&
      (!Array.isArray(v.keyframes) ||
        v.keyframes.some(
          (f) =>
            !f ||
            !Number.isFinite(f.time) ||
            f.time < 0 ||
            f.time > 1 ||
            !Number.isFinite(f.value),
        ))
    )
      throw new Error("Keyframes need time 0–1 and a finite value");
  }
  if (
    c.type === "image" &&
    value.curve !== undefined &&
    (!Array.isArray(value.curve) ||
      value.curve.length !== 5 ||
      value.curve.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
  )
    throw new Error("Image curve needs five output levels between 0 and 1");
  if (
    c.type === "keyframes" &&
    (!Array.isArray(value) ||
      value.length < 2 ||
      value.some(
        (f) =>
          !f ||
          typeof f !== "object" ||
          Array.isArray(f) ||
          (f.offset !== undefined &&
            (!Number.isFinite(f.offset) || f.offset < 0 || f.offset > 1)),
      ))
  )
    throw new Error("Keyframes need at least two frame records with offsets from 0 to 1");
  if (c.type === "spacing" && value.some((n) => n < 0))
    throw new Error("Insets must be nonnegative");
  if (
    c.type === "vector" &&
    value.some((n) => n < (c.min ?? -Infinity) || n > (c.max ?? Infinity))
  )
    throw new Error("Vector is outside its range");
  if (value === undefined || JSON.stringify(value)?.length > 1000000)
    throw new Error(`${c.id}: invalid value`);
}
export function validateSchema(schema) {
  if (!schema || !Array.isArray(schema.sections))
    throw new Error("Schema needs sections");
  const ids = new Set(),
    sections = new Set();
  for (const s of schema.sections) {
    if (
      typeof s.id !== "string" ||
      !s.id ||
      sections.has(s.id) ||
      !Array.isArray(s.controls)
    )
      throw new Error("Each section needs a unique id and controls");
    sections.add(s.id);
    if (s.depth !== undefined && ![1, 2, 3].includes(s.depth))
      throw new Error("Section depth must be 1, 2 or 3");
    for (const c of s.controls) {
      if (
        typeof c.id !== "string" ||
        !c.id ||
        ids.has(c.id) ||
        typeof c.type !== "string" ||
        !c.type
      )
        throw new Error("Each control needs a unique id and type");
      ids.add(c.id);
      for (const key of ["min", "max", "step"])
        if (c[key] !== undefined && !Number.isFinite(c[key]))
          throw new Error(`${key} must be finite`);
      if (c.step !== undefined && c.step <= 0)
        throw new Error("Step must be positive");
      if (c.min !== undefined && c.max !== undefined && c.min > c.max)
        throw new Error("Minimum exceeds maximum");
      if (c.depth !== undefined && ![1, 2, 3].includes(c.depth))
        throw new Error("Depth must be 1, 2 or 3");
      validateValue(c.value, c);
      if (c.default !== undefined) validateValue(c.default, c);
    }
  }
}
/**
 * Read a JSON value the way people type it: JSON, or a JavaScript literal with single
 * quotes, bare keys, trailing commas, comments and Infinity. Never evaluates code.
 * Throws an Error whose message names the line and column in plain words.
 */
export function looseJson(text) {
  const src = String(text);
  let out = "",
    i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1,
        body = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\") {
          body += src[j] + (src[j + 1] ?? "");
          j += 2;
          continue;
        }
        body += src[j] === '"' ? '\\"' : src[j] === "\n" ? "\\n" : src[j];
        j++;
      }
      if (j >= src.length) throw located(src, i, "a quote is never closed");
      out += `"${ch === '"' ? body : body.replace(/\\'/g, "'").replace(/\\`/g, "`")}"`;
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j),
        next = /^\s*:/.test(src.slice(j));
      if (next) out += `"${word}"`;
      else if (["true", "false", "null"].includes(word)) out += word;
      else if (word === "Infinity") out += '"Infinity"';
      else if (word === "undefined") out += "null";
      else throw located(src, i, `"${word}" is not a value (put text in quotes)`);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  out = out.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(out, (_k, v) => (v === "Infinity" ? Infinity : v));
  } catch (err) {
    const at = /position (\d+)/.exec(err.message);
    throw new Error(at ? `Could not read this: ${err.message.replace(/ in JSON at position \d+.*/, "")} near character ${Number(at[1]) + 1}` : `Could not read this as a value: ${err.message}`);
  }
}
function located(src, index, what) {
  const before = src.slice(0, index).split("\n");
  return new Error(`Line ${before.length}, column ${before.at(-1).length + 1}: ${what}.`);
}

/* ---------- tolerant reading of schemas nobody here wrote ---------- */
const objectDefaults = {
  motion: { mode: "bezier", bezier: [0.25, 0.1, 0.25, 1], duration: 400, delay: 0, stiffness: 170, damping: 20, mass: 1, velocity: 0 },
  shadow: { x: 0, y: 8, blur: 24, spread: 0, color: "#00000040" },
  typography: { text: "Ag", family: "system-ui", size: 32, weight: 500, tracking: 0, lineHeight: 1.2 },
  image: { black: 0, white: 1, gamma: 1, exposure: 0, saturation: 1, curve: [0, 0.25, 0.5, 0.75, 1] },
  encoding: { x: "", y: "", color: "", size: "", mark: "point" },
  sampler: { steps: 28, cfg: 7, scheduler: "karras", shift: 1, seed: 0, locked: false, denoise: 1 },
};
objectDefaults.spring = { ...objectDefaults.motion, mode: "spring" };
objectDefaults.bezier = objectDefaults.motion;
const finiteOr = (n, d) => (typeof n === "number" && Number.isFinite(n) ? n : typeof n === "string" && n.trim() !== "" && Number.isFinite(Number(n)) ? Number(n) : d);
/** Replace what JSON cannot hold (NaN, Infinity, functions, undefined) with null, deeply. */
function jsonSafe(v, depth = 0) {
  if (depth > 30) return null;
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x, depth + 1)]).filter(([, x]) => x !== undefined));
  return null;
}
/** Make one value fit its control, as closely to what was declared as possible. */
function fit(c, v) {
  const t = c.type;
  v = jsonSafe(v);
  if (numeric(c)) {
    let n = finiteOr(v, NaN);
    if (!Number.isFinite(n)) n = finiteOr(c.min, 0) > 0 ? c.min : finiteOr(c.max, 0) < 0 ? c.max : 0;
    return clamp(n, c.min ?? -Infinity, c.max ?? Infinity);
  }
  if (t === "boolean") return v === "false" || v === "0" ? false : !!v;
  if (["text", "color", "gradient", "asset", "file"].includes(t)) {
    if (typeof v === "string") return v;
    if (v === null || v === undefined) return t === "color" ? "#808080" : t === "gradient" ? "linear-gradient(90deg, #808080, #ffffff)" : "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  if (["select", "segmented"].includes(t)) {
    const opts = (c.options || []).map((o) => (o && typeof o === "object" ? o.value : o));
    return opts.find((o) => same(o, v)) ?? opts.find((o) => String(o) === String(v)) ?? opts[0] ?? null;
  }
  if (t === "vector" || t === "spacing") {
    const k = t === "vector" ? 2 : 4,
      arr = Array.isArray(v) ? v : typeof v === "number" ? [v] : v && typeof v === "object" ? Object.values(v) : [];
    const out = Array.from({ length: k }, (_, i) => finiteOr(arr[i], t === "spacing" && arr.length === 1 ? finiteOr(arr[0], 0) : 0));
    return t === "spacing" ? out.map((n) => Math.max(0, n)) : out.map((n) => clamp(n, c.min ?? -Infinity, c.max ?? Infinity));
  }
  if (objectDefaults[t]) {
    const base = structuredClone(objectDefaults[t]);
    if (["motion", "bezier", "spring"].includes(t)) {
      // A bare bezier array, a CSS keyword or a partial object all read as a response.
      if (Array.isArray(v)) v = { bezier: v };
      if (typeof v === "string") v = { bezier: { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] }[v.trim()] };
      const o = v && typeof v === "object" ? { ...base, ...v } : base;
      if (!Array.isArray(o.bezier) || o.bezier.length !== 4 || o.bezier.some((n) => !Number.isFinite(n))) o.bezier = base.bezier;
      o.bezier = o.bezier.map((n, i) => (i % 2 ? n : clamp(n, 0, 1)));
      if (!["bezier", "spring"].includes(o.mode)) o.mode = t === "spring" ? "spring" : "bezier";
      for (const k of ["mass", "stiffness", "damping", "duration"]) if (!(finiteOr(o[k], 0) > 0)) o[k] = base[k];
      for (const k of ["delay", "velocity"]) o[k] = finiteOr(o[k], 0);
      if (o.delay < 0) o.delay = 0;
      if (o.loopRange !== undefined && !(Array.isArray(o.loopRange) && o.loopRange.length === 2 && o.loopRange.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) && o.loopRange[0] < o.loopRange[1])) delete o.loopRange;
      if (o.keyframes !== undefined && !(Array.isArray(o.keyframes) && o.keyframes.every((f) => f && Number.isFinite(f.time) && f.time >= 0 && f.time <= 1 && Number.isFinite(f.value)))) delete o.keyframes;
      return o;
    }
    const o = v && typeof v === "object" && !Array.isArray(v) ? { ...base, ...v } : base;
    for (const [k, d] of Object.entries(base)) if (typeof d === "number") o[k] = finiteOr(o[k], d);
    if (t === "image" && !(Array.isArray(o.curve) && o.curve.length === 5 && o.curve.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))) o.curve = base.curve;
    return o;
  }
  if (t === "keyframes") {
    const list = Array.isArray(v) ? v.filter((f) => f && typeof f === "object" && !Array.isArray(f)).map((f) => (f.offset !== undefined && !(Number.isFinite(f.offset) && f.offset >= 0 && f.offset <= 1) ? { ...f, offset: clamp(finiteOr(f.offset, 0), 0, 1) } : f)) : [];
    return list.length >= 2 ? list : [{ offset: 0, transform: "translateX(0px)", opacity: 1 }, { offset: 1, transform: "translateX(120px)", opacity: 1 }];
  }
  // Any other type keeps any JSON it was given; nothing is left undefined.
  return v === undefined ? null : v;
}
/**
 * Read a schema the way it was meant: never throw for a value or a field a person or an
 * agent got slightly wrong. Each repaired control keeps a plain note in `invalid`, and the
 * row shows it. Only a document without a sections array is refused.
 */
export function repairSchema(schema) {
  if (!schema || typeof schema !== "object" || !Array.isArray(schema.sections)) throw new Error("Schema needs sections");
  const out = { ...jsonSafe(schema), sections: [] },
    ids = new Set(),
    sids = new Set(),
    problems = [];
  const unique = (set, id, fallback) => {
    let base = typeof id === "string" && id ? id : typeof id === "number" ? String(id) : fallback,
      next = base,
      i = 2;
    while (set.has(next)) next = `${base}-${i++}`;
    set.add(next);
    return next;
  };
  schema.sections.forEach((s0, si) => {
    if (!s0 || typeof s0 !== "object") return;
    const s = { ...s0, id: unique(sids, s0.id, `section-${si + 1}`), controls: [] };
    if (s.id !== s0.id) problems.push({ section: s.id, problem: "section id was missing or repeated" });
    if (s.depth !== undefined && ![1, 2, 3].includes(s.depth)) delete s.depth;
    (Array.isArray(s0.controls) ? s0.controls : []).forEach((c0, ci) => {
      if (!c0 || typeof c0 !== "object" || Array.isArray(c0)) return;
      const c = jsonSafe(c0),
        notes = [];
      c.id = unique(ids, c0.id, `${s.id}-${ci + 1}`);
      if (c.id !== c0.id) notes.push(c0.id ? `the id ${c0.id} was already used` : "it had no id");
      if (typeof c.type !== "string" || !c.type) {
        const v = c.value;
        c.type = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : Array.isArray(c.options) ? "select" : "text";
        if (typeof v !== "string" && c.type === "text" && v !== null && v !== undefined) c.type = "data";
        notes.push(`it had no type; read as ${c.type}`);
      }
      if (typeof c.label !== "string") c.label = c.label === undefined || c.label === null ? c.id : String(c.label);
      for (const k of ["min", "max", "step"]) {
        if (c[k] === undefined || c[k] === null) delete c[k];
        else if (!Number.isFinite(Number(c[k]))) {
          notes.push(`${k} was not a number`);
          delete c[k];
        } else c[k] = Number(c[k]);
      }
      if (c.step !== undefined && c.step <= 0) delete c.step;
      if (c.min !== undefined && c.max !== undefined && c.min > c.max) [c.min, c.max] = [c.max, c.min];
      if (c.depth !== undefined && ![1, 2, 3].includes(c.depth)) delete c.depth;
      if (c.options !== undefined && !Array.isArray(c.options)) delete c.options;
      if (c.options) c.options = c.options.filter((o) => o !== null && o !== undefined && (typeof o !== "object" || "value" in o));
      if (c.unit !== undefined && typeof c.unit !== "string") delete c.unit;
      for (const key of ["value", "default"]) {
        if (key === "default" && c0.default === undefined) continue;
        try {
          validateValue(c[key], c);
          if (key === "value" && c0.value !== c[key] && Number.isNaN(c0.value)) throw new Error();
        } catch (e) {
          const before = c0[key];
          c[key] = fit(c, before);
          try {
            validateValue(c[key], c);
          } catch {
            c[key] = null;
          }
          notes.push(`its ${key} ${before === undefined ? "was missing" : `(${short(before)}) did not fit a ${c.type}`}; showing ${short(c[key])}`);
        }
      }
      // Motion values are completed silently so every studio can read them whole.
      if (["motion", "bezier", "spring"].includes(c.type)) for (const key of ["value", "default"]) if (c[key] !== undefined) c[key] = fit(c, c[key]);
      // Other records keep their fields; a field that is not a number where a number belongs is noted and replaced.
      else if (objectDefaults[c.type])
        for (const key of ["value", "default"]) {
          if (c[key] === undefined || c[key] === null) continue;
          const fixed = fit(c, c[key]),
            bad = Object.keys(objectDefaults[c.type]).filter((k) => k in c[key] && JSON.stringify(c[key][k]) !== JSON.stringify(fixed[k]));
          if (bad.length) notes.push(`its ${key} had ${bad.map((k) => `${k} ${short(c[key][k])}`).join(", ")}; showing ${bad.map((k) => `${k} ${short(fixed[k])}`).join(", ")}`);
          c[key] = fixed;
        }
      if (notes.length) {
        c.invalid = notes.join("; ");
        problems.push({ control: c.id, problem: c.invalid });
      }
      s.controls.push(c);
    });
    out.sections.push(s);
  });
  return { schema: out, problems };
}
const short = (v) => {
  const t = v === undefined ? "nothing" : typeof v === "number" && !Number.isFinite(v) ? String(v) : JSON.stringify(v);
  return t.length > 40 ? `${t.slice(0, 37)}…` : t;
};
