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
