import { clamp } from "./values.js";
export function bezierAt(time, p = [0.25, 0.1, 0.25, 1]) {
  const f = (t, a, b) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let lo = 0,
    hi = 1,
    t = 0.5;
  for (let i = 0; i < 20; i++) {
    t = (lo + hi) / 2;
    if (f(t, p[0], p[2]) < time) lo = t;
    else hi = t;
  }
  return time <= 0 ? 0 : time >= 1 ? 1 : f(t, p[1], p[3]);
}
export function springAt(
  seconds,
  { stiffness = 170, damping = 20, mass = 1, velocity = 0 } = {},
) {
  const w = Math.sqrt(stiffness / mass),
    z = damping / (2 * Math.sqrt(stiffness * mass));
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return (
      1 -
      Math.exp(-z * w * seconds) *
        (Math.cos(wd * seconds) +
          ((z * w - velocity) / wd) * Math.sin(wd * seconds))
    );
  }
  if (Math.abs(z - 1) < 1e-5)
    return 1 - Math.exp(-w * seconds) * (1 + (w - velocity) * seconds);
  const a = -w * (z - Math.sqrt(z * z - 1)),
    b = -w * (z + Math.sqrt(z * z - 1)),
    A = (-velocity - b) / (a - b),
    B = 1 - A;
  return 1 - A * Math.exp(a * seconds) - B * Math.exp(b * seconds);
}
export function motionAt(t, v = {}) {
  return v.mode === "spring"
    ? springAt((t * (v.duration || 1000)) / 1000, v)
    : bezierAt(clamp(t, 0, 1), v.bezier);
}
export function keyframeAt(
  t,
  frames = [
    { time: 0, value: 0 },
    { time: 1, value: 1 },
  ],
) {
  const f = [...frames].sort((a, b) => a.time - b.time);
  if (!f.length) return t;
  if (t <= f[0].time) return f[0].value;
  for (let i = 1; i < f.length; i++)
    if (t <= f[i].time) {
      const a = f[i - 1],
        b = f[i];
      return (
        a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time || 1)
      );
    }
  return f.at(-1).value;
}
export const curvePoints = (v, n = 80) =>
  Array.from({ length: n + 1 }, (_, i) => [i / n, motionAt(i / n, v)]);
/**
 * Measured behaviour of a response: how long until it stays within `tolerance` of 1,
 * how far it overshoots, and when it peaks. A spring is measured in real time (up to 20 s),
 * a bezier over its own duration.
 */
export function analyze(v = {}, tolerance = 0.02) {
  const spring = v.mode === "spring",
    span = spring ? 20 : 1,
    steps = spring ? 4000 : 1000,
    ms = (x) => (spring ? x * span * 1000 : x * (v.duration || 1000));
  let peak = -Infinity,
    peakAt = 0,
    settle = 0;
  for (let i = 0; i <= steps; i++) {
    const x = i / steps,
      y = spring ? springAt(x * span, v) : bezierAt(x, v.bezier);
    if (y > peak) {
      peak = y;
      peakAt = x;
    }
    if (Math.abs(y - 1) > tolerance) settle = x;
  }
  const settleMs = settle >= 1 ? Infinity : Math.round(ms(settle));
  return {
    settleMs,
    overshoot: Math.max(0, peak - 1) * 100,
    peakMs: Math.round(ms(peakAt)),
    fits: settleMs <= (v.duration || 1000),
  };
}
/** CSS linear() easing that reproduces any response, thinned until the error stays under `error`. */
export function toLinear(v, error = 0.003, samples = 240) {
  const pts = Array.from({ length: samples + 1 }, (_, i) => [
    i / samples,
    motionAt(i / samples, v),
  ]);
  const keep = [pts[0]];
  let anchor = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[anchor],
      [x1, y1] = pts[i];
    let bad = false;
    for (let j = anchor + 1; j < i && !bad; j++)
      bad =
        Math.abs(pts[j][1] - (y0 + ((y1 - y0) * (pts[j][0] - x0)) / (x1 - x0))) >
        error;
    if (bad) {
      keep.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  keep.push(pts.at(-1));
  const n = (x) => String(Number(x.toFixed(3)));
  return `linear(${keep
    .map(([x, y], i) =>
      i === 0 || i === keep.length - 1 ? n(y) : `${n(y)} ${n(x * 100)}%`,
    )
    .join(", ")})`;
}
export const toEasing = (v) =>
  v.mode === "spring"
    ? toLinear(v)
    : `cubic-bezier(${(v.bezier || [0.25, 0.1, 0.25, 1]).map((x) => Number(Number(x).toFixed(3))).join(", ")})`;
export const toTransition = (v, property = "transform") =>
  `transition: ${property} ${v.duration || 1000}ms ${toEasing(v)} ${v.delay || 0}ms;`;
/** Web Animations call. Keyframe values drive custom properties so any element can read them. */
export function toWaapi(v, tracks = {}, name = "element") {
  const ids = new Set(Object.keys(tracks)),
    key = (k) => `{ offset: ${k.time}, "--progress": ${k.value} }`,
    frames = (v.keyframes || [
      { time: 0, value: 0 },
      { time: 1, value: 1 },
    ])
      .map(key)
      .map((line) => `  ${line},`);
  const extra = [...ids].map((id) => {
    const rows = tracks[id]
      .map((k) => `{ offset: ${k.time}, "--${id}": "${k.value}${k.unit || ""}" }`)
      .map((line) => `  ${line},`);
    return `// ${id}\n${name}.animate(\n[\n${rows.join("\n")}\n],\n{ duration: ${v.duration || 1000}, delay: ${v.delay || 0}, fill: "both" });`;
  });
  return [
    `${name}.animate(\n[\n${frames.join("\n")}\n],\n{ duration: ${v.duration || 1000}, delay: ${v.delay || 0}, easing: "${toEasing(v)}", fill: "both" });`,
    ...extra,
  ].join("\n\n");
}
/* ---------- Keyframes: sampling, code out, code in ---------- */
const translate = (f) =>
  Number(/translateX\(\s*(-?[\d.]+)/.exec(f?.transform || "")?.[1] || 0);
export const sortFrames = (frames = []) =>
  frames
    .map((f, i, all) => ({
      ...f,
      offset: Number.isFinite(f.offset) ? f.offset : i / Math.max(1, all.length - 1),
    }))
    .sort((a, b) => a.offset - b.offset);
/**
 * Where keyframed motion is at time t (0 to 1 of one iteration). As in CSS animations and
 * per-frame WAAPI easing, the response eases each segment between two frames.
 */
export function framesAt(frames, t, v = {}) {
  const f = sortFrames(frames);
  if (!f.length) return { x: 0, opacity: 1, segment: 0 };
  if (t <= f[0].offset) return { x: translate(f[0]), opacity: f[0].opacity ?? 1, segment: 0 };
  for (let i = 1; i < f.length; i++)
    if (t <= f[i].offset) {
      const a = f[i - 1],
        b = f[i],
        u = (t - a.offset) / (b.offset - a.offset || 1),
        e = motionAt(u, v),
        oa = a.opacity ?? 1,
        ob = b.opacity ?? 1;
      return {
        x: translate(a) + (translate(b) - translate(a)) * e,
        opacity: clamp(oa + (ob - oa) * e, 0, 1),
        segment: i - 1,
      };
    }
  const last = f.at(-1);
  return { x: translate(last), opacity: last.opacity ?? 1, segment: f.length - 2 };
}
const declarations = (f) =>
  Object.entries(f)
    .filter(([k]) => !["offset", "easing", "composite"].includes(k))
    .map(([k, val]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${val};`)
    .join(" ");
const pct = (o) => `${Number((o * 100).toFixed(2))}%`;
/** The spring's own parameters, carried as a custom property so our CSS reads back exactly. */
const springNote = (v) =>
  v.mode === "spring"
    ? `\n  --dials-spring: ${v.stiffness ?? 170} ${v.damping ?? 20} ${v.mass ?? 1} ${v.velocity ?? 0};`
    : "";
/** CSS: an @keyframes block and the rule that runs it. */
export function toKeyframesCSS(frames, v = {}, { name = "dials-motion", selector = ".element", iterations = 1, rotate } = {}) {
  const f = sortFrames(frames);
  return [
    `@keyframes ${name} {`,
    ...f.map((k) => `  ${pct(k.offset)} { ${declarations(k)} }`),
    `}`,
    `${selector} {`,
    `  animation: ${name} ${v.duration || 1000}ms ${toEasing(v)} ${v.delay || 0}ms ${iterations === Infinity ? "infinite" : iterations} both;${springNote(v)}${rotate !== undefined ? `\n  rotate: ${rotate}deg;` : ""}`,
    `}`,
  ].join("\n");
}
/** WAAPI: the same frames with the easing on each frame, so segments ease exactly as in CSS. */
export function toWaapiKeyframes(frames, v = {}, { name = "element", iterations = 1 } = {}) {
  const easing = toEasing(v),
    f = sortFrames(frames);
  const rows = f.map((k) => {
    const props = Object.entries(k)
      .filter(([key]) => key !== "easing")
      .map(([key, val]) => `${key}: ${typeof val === "number" ? val : JSON.stringify(val)}`);
    return `  { ${props.join(", ")}, easing: "${easing}" },`;
  });
  return `${name}.animate([\n${rows.join("\n")}\n], { duration: ${v.duration || 1000}, delay: ${v.delay || 0}, iterations: ${iterations === Infinity ? "Infinity" : iterations}, fill: "both" });`;
}
const named = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};
/** Parse linear() stops into [x, y] points, filling missing positions as CSS does. */
export function linearStops(text) {
  const body = /linear\(([^)]*)\)/.exec(text)?.[1];
  if (!body) return null;
  const raw = body.split(",").map((part) => {
    const [y, ...xs] = part.trim().split(/\s+/);
    return { y: Number(y), x: xs.length ? Number(xs[0].replace("%", "")) / 100 : null };
  });
  if (raw.some((r) => !Number.isFinite(r.y))) return null;
  if (raw[0].x === null) raw[0].x = 0;
  if (raw.at(-1).x === null) raw.at(-1).x = 1;
  for (let i = 1; i < raw.length - 1; i++)
    if (raw[i].x === null) {
      let j = i;
      while (raw[j].x === null) j++;
      const a = raw[i - 1].x,
        b = raw[j].x;
      for (let k = i; k < j; k++) raw[k].x = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    }
  return raw.map((r) => [r.x, r.y]);
}
/** Fit spring stiffness and damping to sampled points of a response (mass 1, at rest). */
export function fitSpring(points, duration = 1000) {
  const err = (k, d) => {
    let e = 0;
    for (const [x, y] of points) {
      const s = springAt((x * duration) / 1000, { stiffness: k, damping: d, mass: 1 });
      e += (s - y) ** 2;
    }
    return e;
  };
  let best = [170, 20, Infinity];
  for (let i = 0; i <= 36; i++)
    for (let j = 0; j <= 36; j++) {
      const k = 10 * 100 ** (i / 36),
        d = 1 * 100 ** (j / 36),
        e = err(k, d);
      if (e < best[2]) best = [k, d, e];
    }
  let [k, d] = best,
    sk = k * 0.2,
    sd = d * 0.2;
  for (let round = 0; round < 60; round++) {
    let moved = false;
    for (const [dk, dd] of [[sk, 0], [-sk, 0], [0, sd], [0, -sd]]) {
      const nk = k + dk,
        nd = d + dd;
      if (nk <= 0 || nd <= 0) continue;
      const e = err(nk, nd);
      if (e < best[2]) {
        best = [nk, nd, e];
        k = nk;
        d = nd;
        moved = true;
      }
    }
    if (!moved) {
      sk /= 2;
      sd /= 2;
    }
  }
  return { stiffness: Number(k.toFixed(1)), damping: Number(d.toFixed(2)), mass: 1, velocity: 0 };
}
/** Read an easing function back into a motion value (bezier, named keyword or linear()). */
export function parseEasing(text, duration = 1000) {
  const t = String(text).trim();
  const cb = /cubic-bezier\(([^)]*)\)/.exec(t);
  if (cb) {
    const b = cb[1].split(",").map(Number);
    if (b.length === 4 && b.every(Number.isFinite)) return { mode: "bezier", bezier: b };
  }
  if (/linear\(/.test(t)) {
    const pts = linearStops(t);
    if (pts) return { mode: "spring", ...fitSpring(pts, duration) };
  }
  const word = /\b(ease-in-out|ease-in|ease-out|ease|linear)\b/.exec(t)?.[1];
  if (word) return { mode: "bezier", bezier: named[word] };
  return null;
}
const ms = (token) => {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(token);
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : null;
};
/** Split a CSS value on top-level spaces (keeps cubic-bezier(...) and linear(...) whole). */
const words = (value) => {
  const out = [];
  let depth = 0,
    cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && !depth) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
/**
 * Read CSS back: a `transition`, an `animation` shorthand and/or an `@keyframes` block.
 * Returns { motion, frames, iterations, rotate } with whatever the text held.
 */
export function parseMotionCSS(text) {
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = {};
  const timing = (value) => {
    const parts = words(value.trim()),
      times = parts.map(ms).filter((n) => n !== null),
      easing = parts.find((p) => /cubic-bezier|linear\(|^ease|^linear$/.test(p));
    const motion = {};
    if (times[0] !== undefined) motion.duration = times[0];
    if (times[1] !== undefined) motion.delay = times[1];
    if (easing) Object.assign(motion, parseEasing(easing, motion.duration || 1000));
    const count = parts.find((p) => p === "infinite" || /^\d+(\.\d+)?$/.test(p));
    if (count !== undefined) out.iterations = count === "infinite" ? Infinity : Number(count);
    return motion;
  };
  const decl = (prop) => new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, "i").exec(src)?.[1];
  const anim = decl("animation"),
    trans = decl("transition");
  if (anim) out.motion = timing(anim);
  else if (trans) out.motion = timing(trans.split(",")[0]);
  const spring = decl("--dials-spring");
  if (spring && out.motion) {
    const [k, d, m, v0] = spring.trim().split(/\s+/).map(Number);
    Object.assign(out.motion, { mode: "spring", stiffness: k, damping: d, mass: m, velocity: v0 });
  }
  const rotate = decl("rotate");
  if (rotate) out.rotate = parseFloat(rotate);
  const block = /@keyframes\s+[\w-]+\s*\{([\s\S]*)\}/.exec(src);
  if (block) {
    const frames = [];
    const re = /([\d.]+%|from|to)\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(block[1]))) {
      const offset = m[1] === "from" ? 0 : m[1] === "to" ? 1 : parseFloat(m[1]) / 100,
        frame = { offset: Number(offset.toFixed(4)) };
      for (const d of m[2].split(";")) {
        const i = d.indexOf(":");
        if (i < 0) continue;
        const key = d.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
          raw = d.slice(i + 1).trim();
        if (!key) continue;
        frame[key] = /^-?[\d.]+$/.test(raw) ? Number(raw) : raw;
      }
      frames.push(frame);
    }
    if (frames.length >= 2) out.frames = frames;
  }
  return out;
}
/** Read a WAAPI call back: element.animate([frames], { duration, delay, iterations }). */
export function parseWaapi(text) {
  const src = String(text),
    list = /animate\(\s*(\[[\s\S]*?\])\s*,\s*(\{[\s\S]*?\})\s*\)/.exec(src);
  if (!list) return {};
  const json = (s) =>
    JSON.parse(
      s
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/:\s*Infinity/g, ': "Infinity"')
        .replace(/,\s*([}\]])/g, "$1"),
    );
  const frames = json(list[1]),
    options = json(list[2]),
    easing = frames.find((f) => f.easing)?.easing || options.easing,
    motion = { duration: options.duration, delay: options.delay || 0 };
  if (easing) Object.assign(motion, parseEasing(easing, motion.duration || 1000));
  return {
    motion,
    frames: frames.map(({ easing: _, ...f }) => f),
    iterations: options.iterations === "Infinity" ? Infinity : options.iterations,
  };
}
