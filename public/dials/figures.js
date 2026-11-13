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
const px = (n) => Number(n.toFixed(3));
const span = (c) => ((c.max ?? 100) - (c.min || 0) || 1);
export const fraction = (c, n) => clamp((n - (c.min || 0)) / span(c), 0, 1);
/** Hardware figures are HTML so their caps, grooves and ticks can use real depth. They are the grab surface. */
function hardware(c, v, kind) {
  const n = typeof v === "number" ? v : 0;
  if (c.type === "angle" || kind === "angle") {
    const full = span(c) >= 359,
      p = fraction(c, n),
      sweep = full ? 360 : 270,
      a = full ? (n - (c.min || 0)) / span(c) * 360 + ((c.min || 0) < 0 ? 180 : 0) : -135 + p * 270,
      count = full ? 24 : 19,
      ticks = Array.from({ length: count }, (_, i) => {
        const t = full ? (i / count) * 360 : -135 + (i / (count - 1)) * 270,
          big = full ? i % 6 === 0 : i % 3 === 0,
          lit = full ? false : t <= a + 0.01;
        return `<i class="${big ? "big" : ""}${lit ? " lit" : ""}" style="--t:${px(t)}deg"></i>`;
      }).join("");
    return `<span class="d-knob" data-sweep="${sweep}" style="--a:${px(a)}deg">${ticks}<b class="d-knob-cap"><u></u></b></span>`;
  }
  if (kind === "boolean")
    return `<span class="d-switch" data-on="${!!v}"><i class="d-switch-led"></i><b class="d-switch-cap"></b></span>`;
  if (kind === "vector") {
    const lo = c.min ?? -1,
      hi = c.max ?? 1,
      x = clamp((v[0] - lo) / (hi - lo), 0, 1),
      y = clamp((v[1] - lo) / (hi - lo), 0, 1);
    return `<span class="d-pad" style="--x:${px(x)};--y:${px(1 - y)}"><i class="d-pad-h"></i><i class="d-pad-v"></i><b class="d-puck"></b></span>`;
  }
  if (kind === "color") {
    return `<span class="d-chip" style="--c:${esc(v)}"><b>Aa</b></span>`;
  }
  if (kind === "gradient")
    return `<span class="d-chip d-chip-grad" style="background:${esc(v)}"></span>`;
  if (kind === "shadow") {
    const s = (k) => px((v[k] || 0) / 3);
    return `<span class="d-card-demo"><b style="box-shadow:${s("x")}px ${s("y")}px ${px((v.blur || 0) / 3)}px ${px((v.spread || 0) / 3)}px ${esc(v.color || "#0004")}"></b></span>`;
  }
  const finite = Number.isFinite(c.min) && Number.isFinite(c.max);
  if (
    finite &&
    typeof v === "number" &&
    (["range", "number", "default", "opacity", "seed", "unit"].includes(kind) || kind === c.type) &&
    !["seed", "motion", "spring", "bezier", "color", "text", "boolean"].includes(c.type)
  ) {
    const p = fraction(c, n),
      zero = (c.min ?? 0) < 0 && (c.max ?? 1) > 0 ? fraction(c, 0) : 0,
      lo = Math.min(p, zero),
      hi = Math.max(p, zero),
      steps = finite && c.step ? Math.round(span(c) / c.step) : 0,
      detents = steps > 1 && steps <= 24 ? steps : 20;
    return `<span class="d-fader${kind === "opacity" ? " d-fader-alpha" : ""}" style="--p:${px(p)};--lo:${px(lo)};--hi:${px(hi)};--n:${detents}"><i class="d-fader-groove"></i><i class="d-fader-fill"></i><b class="d-fader-cap"></b></span>`;
  }
  return null;
}
export function figureMarkup(c, v) {
  const n = typeof v === "number" ? v : 0,
    norm = clamp(
      (n - (c.min || 0)) / ((c.max ?? 100) - (c.min || 0) || 1),
      0,
      1,
    ),
    a = "var(--d-accent)",
    line = "var(--d-line)",
    ink = "var(--d-text)";
  const P = (d, stroke = a, fill = "none") =>
    `<path d="${d}" stroke="${stroke}" fill="${fill}" stroke-width="1.5"/>`;
  let b = "";
  const kind =
    typeof c.figure === "string" ? c.figure : c.figure?.type || c.type;
  const hw = hardware(c, v, kind);
  if (hw) return hw;
  if (["motion", "spring", "bezier"].includes(kind)) {
    const pts = curvePoints(v, 48).map(([x, y]) => [6 + x * 92, clamp(25 - y * 20, 1.5, 28.5)]),
      last = pts.at(-1);
    return `<svg class="d-curve" viewBox="0 0 104 30" preserveAspectRatio="none" aria-hidden="true"><path d="M6 25H98M6 5H98" stroke="${line}" stroke-width="1" stroke-dasharray="1 3" vector-effect="non-scaling-stroke" fill="none"/><path d="${path(pts)}" stroke="${a}" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><path d="M${last[0]} ${last[1]}h.01" stroke="${a}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  } else if (kind === "angle")
    b =
      `<circle cx="30" cy="12" r="10" fill="none" stroke="${line}"/>` +
      P(
        `M30 12L${30 + 10 * Math.cos((n * Math.PI) / 180)} ${12 - 10 * Math.sin((n * Math.PI) / 180)}`,
      ) +
      `<circle cx="30" cy="12" r="2" fill="${a}"/>`;
  else if (kind === "boolean")
    b = P(v ? "M4 16L18 6L32 16L46 6L60 16" : "M4 16H60", v ? a : line);
  else if (kind === "vector") {
    const x =
        clamp((v[0] - (c.min ?? -1)) / ((c.max ?? 1) - (c.min ?? -1)), 0, 1) *
          56 +
        4,
      y =
        22 -
        clamp((v[1] - (c.min ?? -1)) / ((c.max ?? 1) - (c.min ?? -1)), 0, 1) *
          20;
    b =
      P("M2 12H62M32 2V22", line) +
      P(`M32 12L${x} ${y}`) +
      `<circle cx="${x}" cy="${y}" r="3" fill="${a}"/>`;
  } else if (kind === "spacing") {
    const [t, r, bt, l] = v;
    b = `<rect x="7" y="2" width="50" height="20" fill="none" stroke="${line}"/><rect x="${7 + Math.min(l, 20) / 2}" y="${2 + Math.min(t, 12) / 2}" width="${50 - Math.min(l + r, 60) / 2}" height="${20 - Math.min(t + bt, 28) / 2}" fill="${a}" opacity=".5"/>`;
  } else if (kind === "shadow")
    b = `<rect x="${14 + (v.x || 0) / 4}" y="${4 + (v.y || 0) / 4}" width="32" height="15" rx="${Math.min(8, (v.blur || 0) / 3)}" fill="${a}" opacity=".3"/><rect x="14" y="4" width="32" height="15" fill="var(--d-surface)" stroke="${ink}"/>`;
  else if (kind === "text" && typeof v === "string") {
    // Words as bars: the figure grows with the amount of text and wraps like a paragraph.
    const words = v.trim().split(/\s+/).filter(Boolean);
    let x = 3,
      y = 5;
    b = words
      .slice(0, 18)
      .map((w) => {
        const len = Math.min(26, 3 + w.length * 2.2);
        if (x + len > 61) {
          x = 3;
          y += 6;
        }
        const r = y < 20 ? `<rect x="${x}" y="${y}" width="${len}" height="3" rx="1" fill="${a}"/>` : "";
        x += len + 3;
        return r;
      })
      .join("") || P("M2 21H62", line);
  } else if (["text", "typography"].includes(kind)) {
    const text = typeof v === "string" ? v : "Ag";
    b =
      `<text x="3" y="19" fill="${ink}" font-family="sans-serif" font-size="${typeof v === "object" ? clamp(v.size || 20, 10, 24) : 18}" font-weight="${v?.weight || 400}" letter-spacing="${v?.tracking || 0}">${esc(text.slice(0, 5) || "Aa")}</text>` +
      P("M2 21H62", line);
  } else if (kind === "image") {
    const gamma = v.gamma || 1;
    b = P(
      path(
        Array.from({ length: 24 }, (_, i) => {
          const x = i / 23;
          return [
            2 + x * 60,
            22 -
              clamp(
                (x - (v.black || 0)) /
                  ((v.white ?? 1) - (v.black || 0) || 0.01),
                0,
                1,
              ) **
                (1 / gamma) *
                20,
          ];
        }),
      ),
    );
  } else if (kind === "encoding") {
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
    const px = (p) => (v.x ? 6 + p[0] * 54 : 33),
      py = (p) => (v.y ? 3 + p[1] * 14 : 10),
      series = ["var(--d-accent)", "var(--d-text)"];
    b =
      P("M4 2V19H62", line) +
      pts
        .map(
          (p, i) =>
            `<circle cx="${px(p).toFixed(1)}" cy="${py(p).toFixed(1)}" r="${v.size ? 1.2 + ((i * 5) % 7) * 0.45 : 2.2}" fill="${v.color ? series[i % 2] : a}" opacity="${v.x || v.y ? 0.9 : 0.35}"/>`,
        )
        .join("");
  } else if (kind === "sampler")
    b = P(
      path(
        schedule(v.steps, v.scheduler, v.shift).map((y, i, arr) => [
          2 + (i / (arr.length - 1)) * 60,
          22 - y * 20,
        ]),
      ),
    );
  else if (kind === "seed") {
    let seed = n >>> 0;
    b = Array.from({ length: 20 }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return `<rect x="${i * 3}" y="${seed % 2 ? 2 : 12}" width="2" height="10" fill="${a}"/>`;
    }).join("");
  } else if (["select", "segmented"].includes(kind))
    b = (c.options || [])
      .map(
        (o, i, arr) =>
          `<rect x="${(i * 62) / arr.length + 1}" y="6" width="${60 / arr.length - 2}" height="12" rx="2" fill="${JSON.stringify(typeof o === "object" ? o.value : o) === JSON.stringify(v) ? a : line}"/>`,
      )
      .join("");
  else if (["file", "asset"].includes(kind))
    b = P("M18 2H37L47 12V22H18ZM37 2V12H47", v ? a : line);
  else if (kind === "radius")
    b = `<rect x="12" y="2" width="40" height="20" rx="${Math.min(10, Math.max(0, n / 3))}" fill="none" stroke="${a}" stroke-width="2"/>`;
  else if (kind === "opacity")
    b = Array.from(
      { length: 6 },
      (_, i) =>
        `<rect x="${i * 10 + 2}" y="4" width="8" height="16" fill="${a}" opacity="${(clamp(n / (c.max || 1), 0, 1) * (i + 1)) / 6}"/>`,
    ).join("");
  else if (typeof v === "string")
    b =
      `<text x="3" y="16" font-size="11" fill="${ink}" font-family="monospace">${esc(v.slice(0, 9) || "empty")}</text>` +
      P("M2 21H62", line);
  else if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
    const hi = Math.max(1e-9, ...v.map(Math.abs));
    b = v
      .slice(0, 12)
      .map(
        (x, i, arr) =>
          `<rect x="${2 + (i * 60) / arr.length}" y="${22 - (Math.abs(x) / hi) * 19}" width="${Math.max(2, 60 / arr.length - 2)}" height="${(Math.abs(x) / hi) * 19}" fill="${a}"/>`,
      )
      .join("");
  } else if (v && typeof v === "object")
    b = Object.keys(v)
      .slice(0, 6)
      .map(
        (k, i) =>
          `<rect x="${2 + i * 10}" y="${4 + (i % 3) * 4}" width="8" height="14" fill="${a}" opacity="${0.35 + 0.1 * (i % 5)}"/>`,
      )
      .join("");
  else {
    // Two compound paths keep the same sixteen ticks without sixteen DOM nodes.
    const ticks = ["", ""];
    for (let i = 0; i < 16; i++)
      ticks[i / 15 <= norm ? 1 : 0] += `M${i * 4 + 2} ${i % 4 ? 12 : 7}V21`;
    b = `<path d="${ticks[0]}" stroke="${line}" stroke-width="2"/><path d="${ticks[1]}" stroke="${a}" stroke-width="2"/>`;
  }
  return `<svg viewBox="0 0 64 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${b}</svg>`;
}
// Update in place when the figure keeps its shape, so caps and needles can travel instead of jump.
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return a.replaceWith(b);
  if (a.nodeType === 3) {
    if (a.data !== b.data) a.data = b.data;
    return;
  }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of b.attributes) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  if (a.childNodes.length !== b.childNodes.length) return a.replaceChildren(...b.childNodes);
  const from = [...a.childNodes],
    to = [...b.childNodes];
  from.forEach((child, i) => morph(child, to[i]));
}
let scratch;
export function drawFigure(el, c, v) {
  scratch ||= document.createElement("template");
  scratch.innerHTML = figureMarkup(c, v);
  const next = scratch.content,
    first = next.firstElementChild;
  el.classList.toggle("is-plate", !!first?.matches("svg,.d-chip,.d-card-demo"));
  el.classList.toggle("is-knob", !!first?.matches(".d-knob"));
  el.classList.toggle("is-switch", !!first?.matches(".d-switch"));
  if (el.childNodes.length !== next.childNodes.length) return el.replaceChildren(next);
  const from = [...el.childNodes],
    to = [...next.childNodes];
  from.forEach((child, i) => morph(child, to[i]));
}
