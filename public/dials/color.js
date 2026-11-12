import { clamp } from "./values.js";
const mul = (m, v) => m.map((row) => row.reduce((s, n, i) => s + n * v[i], 0));
export const linear = (v) =>
  Math.abs(v) <= 0.04045
    ? v / 12.92
    : Math.sign(v) * ((Math.abs(v) + 0.055) / 1.055) ** 2.4;
export const gamma = (v) =>
  Math.abs(v) <= 0.0031308
    ? 12.92 * v
    : Math.sign(v) * (1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);
export function rgbToLab(rgb) {
  const [l, m, s] = mul(
    [
      [0.4122214708, 0.5363325363, 0.0514459929],
      [0.2119034982, 0.6806995451, 0.1073969566],
      [0.0883024619, 0.2817188376, 0.6299787005],
    ],
    rgb.map(linear),
  ).map(Math.cbrt);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function labToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
export const labToLch = ([L, a, b, alpha = 1]) => [
  L,
  Math.hypot(a, b),
  ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  alpha,
];
export const lchToLab = ([L, C, H, alpha = 1]) => [
  L,
  C * Math.cos((H * Math.PI) / 180),
  C * Math.sin((H * Math.PI) / 180),
  alpha,
];
export const cssLch = ([L, C, H, a = 1]) =>
  `oklch(${(L * 100).toFixed(3)}% ${C.toFixed(5)} ${H.toFixed(3)} / ${a.toFixed(3)})`;
export const cssLab = ([L, a, b, alpha = 1]) =>
  `oklab(${L} ${a} ${b} / ${alpha})`;
export function inGamut(lch, space = "srgb") {
  let rgb = labToLinear(lchToLab(lch));
  if (space === "p3")
    rgb = mul(
      [
        [0.82259287, 0.17753395, 0],
        [0.03319951, 0.9667835, 0],
        [0.01708535, 0.07239572, 0.91030148],
      ],
      rgb,
    );
  return rgb.every((v) => v >= -1e-5 && v <= 1.00001);
}
export function gamutChroma(L, H, space = "srgb") {
  let lo = 0,
    hi = 0.5;
  for (let i = 0; i < 16; i++) {
    const m = (lo + hi) / 2;
    if (inGamut([L, m, H], space)) lo = m;
    else hi = m;
  }
  return lo;
}
export function toHex(lch) {
  return (
    "#" +
    labToLinear(lchToLab(lch))
      .map(gamma)
      .map((v) =>
        Math.round(clamp(v, 0, 1) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("") +
    (lch[3] < 1
      ? Math.round(lch[3] * 255)
          .toString(16)
          .padStart(2, "0")
      : "")
  );
}
let probe;
export function parseColor(value, parent = document.documentElement) {
  if (!probe) {
    probe = document.createElement("span");
    probe.hidden = true;
  }
  parent.append(probe);
  try {
    probe.style.color = "";
    probe.style.color = value;
    if (!probe.style.color) throw new Error("Enter a CSS color");
    const original = getComputedStyle(probe).color;
    probe.style.color = `color-mix(in oklab, ${original}, ${original})`;
    const result = getComputedStyle(probe).color;
    const m =
      /oklab\(\s*([\d.e+-]+)(%)?\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+)(%)?)?\)/i.exec(
        result,
      );
    if (!m) throw new Error("This browser cannot convert that color to OKLab");
    return labToLch([
      Number(m[1]) / (m[2] ? 100 : 1),
      Number(m[3]),
      Number(m[4]),
      m[5] === undefined ? 1 : Number(m[5]) / (m[6] ? 100 : 1),
    ]);
  } finally {
    probe.remove();
  }
}
export const rgb = (lch) =>
  labToLinear(lchToLab(lch))
    .map(gamma)
    .map((v) => clamp(v, 0, 1));
export function contrast(fg, bg) {
  const back = rgb(bg).map((v) => v * (bg[3] ?? 1) + 1 * (1 - (bg[3] ?? 1))),
    front = rgb(fg).map(
      (v, i) => v * (fg[3] ?? 1) + back[i] * (1 - (fg[3] ?? 1)),
    );
  const Y = (r) =>
    r.map(linear).reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0);
  const a = Y(front),
    b = Y(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// APCA 0.0.98G contrast equation. Signed Lc, experimental; not WCAG 2 compliance.
export function apca(fg, bg) {
  const back = rgb(bg).map((v) => v * (bg[3] ?? 1) + 1 * (1 - (bg[3] ?? 1))),
    front = rgb(fg).map(
      (v, i) => v * (fg[3] ?? 1) + back[i] * (1 - (fg[3] ?? 1)),
    );
  const Y = (r) =>
    r.reduce(
      (s, v, i) => s + v ** 2.4 * [0.2126729, 0.7151522, 0.072175][i],
      0,
    );
  const soft = (y) => (y < 0.022 ? y + (0.022 - y) ** 1.414 : y);
  const t = soft(Y(front)),
    b = soft(Y(back));
  if (Math.abs(b - t) < 0.0005) return 0;
  const s =
    b > t ? (b ** 0.56 - t ** 0.57) * 1.14 : (b ** 0.65 - t ** 0.62) * 1.14;
  return b > t
    ? s < 0.1
      ? 0
      : (s - 0.027) * 100
    : s > -0.1
      ? 0
      : (s + 0.027) * 100;
}
export function ramp(lch, n = 9) {
  return Array.from({ length: n }, (_, i) => {
    const L = 0.97 - (i * 0.89) / (n - 1),
      C = Math.min(lch[1], gamutChroma(L, lch[2]));
    return [L, C, lch[2], 1];
  });
}
export function paletteFromPixels(data, count = 6) {
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = [data[i], data[i + 1], data[i + 2]]
      .map((v) => v >> 5)
      .join(",");
    let b = bins.get(key);
    if (!b) bins.set(key, (b = { sum: [0, 0, 0], n: 0 }));
    for (let j = 0; j < 3; j++) b.sum[j] += data[i + j];
    b.n++;
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((b) => labToLch([...rgbToLab(b.sum.map((v) => v / b.n / 255)), 1]));
}
