import { clamp } from "./values.js";
import { curvePoints } from "./motion.js";
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const path = (points) =>
  points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
export function schedule(steps = 24, curve = "karras", shift = 1) {
  const n = Math.max(1, Math.min(150, Math.round(steps)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = 1 - i / n,
      s =
        curve === "linear"
          ? t
          : curve === "cosine"
            ? Math.sin((t * Math.PI) / 2)
            : t ** 3;
    return (s * shift) / (1 + (shift - 1) * s);
  });
}
/** Where a number sits in its declared range, 0 to 1. */
export const position = (c, n) =>
  clamp(
    ((typeof n === "number" ? n : 0) - (c.min ?? 0)) /
      ((c.max ?? 100) - (c.min ?? 0) || 1),
    0,
    1,
  );
const A = "var(--d-accent)",
  LINE = "var(--d-rule)",
  INK = "var(--d-text)",
  SOFT = "var(--d-muted)";
const kindOf = (c) =>
  typeof c.figure === "string" ? c.figure : c.figure?.type || c.type;
// A stretched figure fills its track: x scales with the row, strokes keep their width.
const stretch = (body) =>
  `<svg class="d-fig-wide" viewBox="0 0 120 20" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
// A glyph keeps its proportions: circles stay round, corners stay true.
const glyph = (w, body) =>
  `<svg class="d-fig-glyph" viewBox="0 0 ${w} 20" width="${w}" height="20" aria-hidden="true">${body}</svg>`;
const stroke = (d, color = A, width = 1.5, extra = "") =>
  `<path d="${d}" stroke="${color}" fill="none" stroke-width="${width}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
// The meter is the row's track: a hairline range with the value filled in and a thumb at the value.
const meter = (p) =>
  `<span class="d-meter" style="--p:${p.toFixed(4)}"><i></i><b></b></span>`;
export function figureMarkup(c, v) {
  const n = typeof v === "number" ? v : 0,
    p = position(c, n),
    kind = kindOf(c);
  if (kind === "color")
    return `<span class="d-bar d-bar-color" style="--swatch:${esc(v)}"><i></i></span>`;
  if (kind === "gradient")
    return `<span class="d-bar" style="background:${esc(v)}"><i></i></span>`;
  if (["motion", "spring", "bezier"].includes(kind)) {
    const total = (v?.duration || 1000) + (v?.delay || 0),
      d = (v?.delay || 0) / total,
      pts = curvePoints(v, 40).map(([x, y]) => [
        (d + (1 - d) * x) * 120,
        17 - clamp(y, -0.2, 1.3) * 13,
      ]);
    return stretch(
      stroke("M0 17.5H120", LINE, 1) +
        stroke("M0 4H120", LINE, 1, ' stroke-dasharray="1 3"') +
        stroke(path([[0, 17], ...pts])),
    );
  }
  if (kind === "angle") {
    const r = (n * Math.PI) / 180;
    return (
      glyph(
        20,
        `<circle cx="10" cy="10" r="8" fill="none" stroke="${LINE}"/>` +
          `<path d="M10 10L${(10 + 8 * Math.cos(r)).toFixed(2)} ${(10 - 8 * Math.sin(r)).toFixed(2)}" stroke="${A}" stroke-width="1.5" stroke-linecap="round"/>` +
          `<circle cx="10" cy="10" r="1.5" fill="${A}"/>`,
      ) + meter(p)
    );
  }
  if (kind === "boolean")
    return `<span class="d-switch" data-on="${v ? "true" : "false"}"><i></i></span>`;
  if (kind === "vector") {
    const lo = c.min ?? -1,
      hi = c.max ?? 1,
      x = 2 + clamp((v[0] - lo) / (hi - lo || 1), 0, 1) * 32,
      y = 18 - clamp((v[1] - lo) / (hi - lo || 1), 0, 1) * 16;
    return glyph(
      36,
      `<rect x="0.5" y="0.5" width="35" height="19" rx="2" fill="none" stroke="${LINE}"/>` +
        `<path d="M18 1V19M1 10H35" stroke="${LINE}" stroke-dasharray="1 2"/>` +
        `<path d="M${x.toFixed(1)} 1V19M1 ${y.toFixed(1)}H35" stroke="${A}" stroke-opacity=".35"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${A}"/>`,
    );
  }
  if (kind === "spacing") {
    const [t, r, b, l] = v,
      k = (n) => clamp(n / 8, 0, 6);
    return glyph(
      36,
      `<rect x="0.5" y="0.5" width="35" height="19" rx="2" fill="${A}" fill-opacity=".14" stroke="${LINE}"/>` +
        `<rect x="${(0.5 + k(l)).toFixed(1)}" y="${(0.5 + k(t) / 2).toFixed(1)}" width="${(35 - k(l) - k(r)).toFixed(1)}" height="${(19 - k(t) / 2 - k(b) / 2).toFixed(1)}" fill="var(--d-surface)" stroke="${A}"/>`,
    );
  }
  if (kind === "shadow")
    return glyph(
      40,
      `<rect x="${(9 + (v.x || 0) / 4).toFixed(1)}" y="${(4 + (v.y || 0) / 6).toFixed(1)}" width="22" height="12" rx="2" fill="${INK}" opacity="${clamp(0.12 + (v.blur || 0) / 200, 0.12, 0.3).toFixed(2)}" style="filter:blur(${clamp((v.blur || 0) / 10, 0, 3)}px)"/>` +
        `<rect x="9.5" y="3.5" width="21" height="11" rx="2" fill="var(--d-surface)" stroke="${SOFT}"/>`,
    );
  if (kind === "text" && typeof v === "string") {
    // Words as bars: the figure grows with the amount of text and wraps like a paragraph.
    const words = v.trim().split(/\s+/).filter(Boolean);
    let x = 0,
      y = 4;
    const bars = words
      .slice(0, 22)
      .map((w) => {
        const len = Math.min(36, 3 + w.length * 3.4);
        if (x + len > 120) {
          x = 0;
          y += 6;
        }
        const r =
          y < 18
            ? `<rect x="${x.toFixed(1)}" y="${y}" width="${len.toFixed(1)}" height="3" rx="1.5" fill="${SOFT}" fill-opacity=".55"/>`
            : "";
        x += len + 3;
        return r;
      })
      .join("");
    return stretch(bars || stroke("M0 17.5H120", LINE, 1));
  }
  if (kind === "typography") {
    const size = v?.size || 16;
    return (
      `<span class="d-fig-type" style="font-family:${esc(v?.family || "inherit")};font-weight:${Number(v?.weight) || 400}">Ag</span>` +
      meter(clamp((size - 8) / 88, 0, 1))
    );
  }
  if (kind === "image") {
    const gamma = v.gamma || 1,
      pts = Array.from({ length: 32 }, (_, i) => {
        const x = i / 31;
        return [
          x * 120,
          18 -
            clamp(
              (x - (v.black || 0)) / ((v.white ?? 1) - (v.black || 0) || 0.01),
              0,
              1,
            ) **
              (1 / gamma) *
              16,
        ];
      });
    return stretch(
      `<path d="M0 18 ${path(pts).slice(1)} L120 18Z" fill="${A}" fill-opacity=".1"/>` +
        stroke(path(pts)),
    );
  }
  if (kind === "encoding") {
    // A small chart that uses exactly the channels that are bound: no x means points
    // stack on one column, no y means one row, color splits two series, size varies radius.
    const pts = [
      [0.08, 0.7],
      [0.22, 0.45],
      [0.34, 0.6],
      [0.5, 0.3],
      [0.62, 0.42],
      [0.78, 0.15],
      [0.92, 0.25],
    ];
    const px = (q) => (v.x ? 4 + q[0] * 52 : 30),
      py = (q) => (v.y ? 3 + q[1] * 14 : 10),
      series = [A, SOFT];
    return glyph(
      60,
      `<path d="M1 1V19H59" stroke="${LINE}" fill="none"/>` +
        pts
          .map(
            (q, i) =>
              `<circle cx="${px(q).toFixed(1)}" cy="${py(q).toFixed(1)}" r="${v.size ? 1.2 + ((i * 5) % 7) * 0.4 : 2}" fill="${v.color ? series[i % 2] : A}" opacity="${v.x || v.y ? 0.95 : 0.35}"/>`,
          )
          .join(""),
    );
  }
  if (kind === "sampler") {
    const s = schedule(v.steps, v.scheduler, v.shift),
      pts = s.map((y, i, arr) => [(i / (arr.length - 1)) * 120, 18 - y * 16]);
    return stretch(
      `<path d="M0 18 ${path(pts).slice(1)} L120 18Z" fill="${A}" fill-opacity=".1"/>` +
        stroke(path(pts)),
    );
  }
  if (kind === "seed") {
    let seed = n >>> 0;
    return stretch(
      Array.from({ length: 30 }, (_, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const h = 4 + (seed % 13);
        return `<rect x="${i * 4}" y="${18 - h}" width="2.6" height="${h}" fill="${SOFT}" fill-opacity=".6"/>`;
      }).join(""),
    );
  }
  if (["select", "segmented"].includes(kind)) {
    const list = c.options || [];
    return stretch(
      list
        .map(
          (o, i, arr) =>
            `<rect x="${(i * 120) / arr.length + 1}" y="15" width="${120 / arr.length - 2}" height="2" fill="${JSON.stringify(typeof o === "object" ? o.value : o) === JSON.stringify(v) ? A : LINE}"/>`,
        )
        .join(""),
    );
  }
  if (["file", "asset"].includes(kind))
    return glyph(
      16,
      `<path d="M2.5 1.5H10L13.5 5V18.5H2.5ZM10 1.5V5H13.5" fill="none" stroke="${v ? A : SOFT}"/>`,
    );
  if (kind === "radius") {
    const r = Math.min(16, n / 3);
    return (
      glyph(
        20,
        `<path d="M1.5 18.5V${(1.5 + r).toFixed(2)}A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(1.5 + r).toFixed(2)} 1.5H18.5" fill="none" stroke="${A}" stroke-width="1.5"/>`,
      ) + meter(p)
    );
  }
  if (kind === "opacity")
    return (
      `<span class="d-fig-alpha"><i style="opacity:${clamp(n / (c.max || 1), 0, 1).toFixed(3)}"></i></span>` +
      meter(p)
    );
  if (typeof v === "string") return stretch(stroke("M0 17.5H120", LINE, 1));
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
    const hi = Math.max(1e-9, ...v.map(Math.abs));
    return stretch(
      v
        .slice(0, 12)
        .map(
          (x, i, arr) =>
            `<rect x="${(i * 120) / arr.length}" y="${(18 - (Math.abs(x) / hi) * 15).toFixed(1)}" width="${Math.max(2, 120 / arr.length - 3).toFixed(1)}" height="${((Math.abs(x) / hi) * 15).toFixed(1)}" fill="${A}" fill-opacity=".7"/>`,
        )
        .join(""),
    );
  }
  if (v && typeof v === "object")
    return stretch(
      Object.keys(v)
        .slice(0, 8)
        .map(
          (k, i) =>
            `<rect x="${i * 15}" y="${4 + (i % 3) * 3}" width="12" height="${14 - (i % 3) * 3}" fill="${A}" fill-opacity="${(0.25 + 0.1 * (i % 5)).toFixed(2)}"/>`,
        )
        .join(""),
    );
  return meter(p);
}
export function drawFigure(node, c, v) {
  const kind = kindOf(c),
    first = node.firstElementChild;
  // A plain meter only moves its thumb: nothing is rebuilt while a number is scrubbed.
  if (
    node.dataset.kind === kind &&
    node.childElementCount === 1 &&
    first?.classList.contains("d-meter")
  ) {
    first.style.setProperty("--p", position(c, v).toFixed(4));
    return;
  }
  node.dataset.kind = kind;
  node.innerHTML = figureMarkup(c, v);
}
