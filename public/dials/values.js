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
export function expression(text, control = {}) {
  text = String(text).trim();
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
    const from = m[2]?.toLowerCase(),
      to = control.unit;
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
export function format(value, c = {}) {
  if (typeof value === "number")
    return `${Number(value.toFixed(5))}${c.unit || ""}`;
  return typeof value === "string" ? value : JSON.stringify(value);
}
export function parse(text, c) {
  if (numeric(c)) return expression(text, c);
  if (["text", "color", "gradient", "asset", "file"].includes(c.type))
    return text;
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("Enter a JSON value");
  }
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
