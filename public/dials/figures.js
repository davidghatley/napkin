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
  if (kind === "color" || kind === "gradient") {
    b = `<rect x="2" y="3" width="60" height="18" rx="3" fill="${kind === "color" ? esc(v) : "var(--d-accent)"}"/>`;
  } else if (["motion", "spring", "bezier"].includes(kind))
    b =
      P("M2 3V22H62", line) +
      P(path(curvePoints(v, 30).map(([x, y]) => [2 + x * 60, 21 - y * 17])));
  else if (kind === "angle")
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
  else if (["text", "typography"].includes(kind)) {
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
    const axes = ["x", "y", "color", "size"];
    b = axes
      .map(
        (k, i) =>
          `<rect x="${i * 16 + 1}" y="${v[k] ? 3 : 16}" width="12" height="${v[k] ? 18 : 5}" fill="${v[k] ? a : line}"/><text x="${i * 16 + 7}" y="15" font-size="8" text-anchor="middle" fill="${v[k] ? "var(--d-on-accent)" : ink}">${k[0]}</text>`,
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
  else {
    // Two compound paths keep the same sixteen ticks without sixteen DOM nodes.
    const ticks = ["", ""];
    for (let i = 0; i < 16; i++)
      ticks[i / 15 <= norm ? 1 : 0] += `M${i * 4 + 2} ${i % 4 ? 12 : 7}V21`;
    b = `<path d="${ticks[0]}" stroke="${line}" stroke-width="2"/><path d="${ticks[1]}" stroke="${a}" stroke-width="2"/>`;
  }
  return `<svg viewBox="0 0 64 24" width="64" height="24" aria-hidden="true">${b}</svg>`;
}
export function drawFigure(el, c, v) {
  el.innerHTML = figureMarkup(c, v);
  if (c.type === "gradient") {
    el.querySelector("rect")?.setAttribute("fill", "transparent");
    el.style.background = v;
    el.style.borderRadius = "3px";
  }
}
