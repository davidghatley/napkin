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
