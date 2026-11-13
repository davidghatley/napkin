import { clamp } from "./values.js";
import { curvePoints } from "./motion.js";
/*
  Row figures. Every control draws what its value does in one well of the same size
  (W x H CSS pixels), and that drawing is the control: a drag on it sets the value
  where the pointer is (see Dials.scrub). Nothing here is decoration; each mark moves
  with the value.
*/
export const W = 76,
  H = 24;
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const f1 = (n) => Number(n.toFixed(2));
export const path = (points) =>
  points.map(([x, y], i) => `${i ? "L" : "M"}${f1(x)} ${f1(y)}`).join(" ");
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
  SOFT = "var(--d-faint)",
  PAPER = "var(--d-surface)";
export const kindOf = (c) =>
  typeof c.figure === "string" ? c.figure : c.figure?.type || c.type;
const svg = (body, cls = "") =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${body}</svg>`;
const line = (d, color = A, width = 1.5, extra = "") =>
  `<path d="${d}" stroke="${color}" fill="none" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
/** The rail every ranged figure shares: 4 px track, filled to the value, a 10 px thumb. */
export const rail = (p, x0 = 6, w = W - 12, y = 12) => {
  const x = x0 + p * w;
  return (
    `<rect class="d-track" x="${x0}" y="${y - 2}" width="${w}" height="4" rx="2" fill="${LINE}" opacity=".6"/>` +
    `<rect x="${x0}" y="${y - 2}" width="${f1(x - x0)}" height="4" rx="2" fill="${A}"/>` +
    `<circle class="d-thumb" cx="${f1(x)}" cy="${y}" r="5" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>`
  );
};
// The plain number: ticks every tenth of the range above the rail.
function ruler(p) {
  let ticks = "";
  for (let i = 0; i <= 10; i++) {
    const x = 6 + (i / 10) * (W - 12);
    ticks += `<path d="M${f1(x)} ${i % 5 ? 4 : 1.5}V7" stroke="${LINE}"/>`;
  }
  return svg(ticks + rail(p, 6, W - 12, 15));
}
const optionsOf = (c) =>
  (c.options || []).map((o) => (typeof o === "object" ? o.value : o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Choice glyphs: each option drawn as what it does; the current one in accent, underlined in ink.
const choiceGlyphs = {
  align(o, x, w, on) {
    const color = on ? A : SOFT,
      lens = [w - 7, w - 13, w - 9],
      at = (len) =>
        o === "center" ? x + (w - len) / 2 : o === "right" ? x + w - 3.5 - len : x + 3.5;
    return lens
      .map(
        (len, i) =>
          `<rect x="${f1(at(len))}" y="${5 + i * 5}" width="${f1(len)}" height="2" rx="1" fill="${color}"/>`,
      )
      .join("");
  },
  mark(o, x, w, on) {
    const color = on ? A : SOFT;
    if (o === "bar")
      return [6, 11, 8, 14]
        .map(
          (h, i) =>
            `<rect x="${f1(x + 4 + i * ((w - 8) / 4))}" y="${19 - h}" width="${f1((w - 8) / 4 - 1.5)}" height="${h}" fill="${color}"/>`,
        )
        .join("");
    if (o === "line")
      return line(`M${f1(x + 3)} 17L${f1(x + w * 0.35)} 10L${f1(x + w * 0.62)} 13L${f1(x + w - 3)} 4`, color, 1.5);
    return [
      [0.2, 0.75],
      [0.42, 0.4],
      [0.62, 0.6],
      [0.82, 0.18],
    ]
      .map(([a, b]) => `<circle cx="${f1(x + a * w)}" cy="${f1(3 + b * 15)}" r="2" fill="${color}"/>`)
      .join("");
  },
};
function choice(c, v) {
  const opts = optionsOf(c),
    n = Math.max(1, opts.length),
    w = W / n,
    glyph = choiceGlyphs[c.figure] || choiceGlyphs[c.id];
  return svg(
    opts
      .map((o, i) => {
        const on = same(o, v),
          x = i * w;
        const body = glyph
          ? glyph(o, x, w, on)
          : `<rect x="${f1(x + 2.5)}" y="5.5" width="${f1(w - 5)}" height="11" rx="2" fill="${on ? A : "none"}" stroke="${on ? A : LINE}"/>`;
        return (
          body +
          (on ? `<rect x="${f1(x + 2)}" y="${H - 2}" width="${f1(w - 4)}" height="2" fill="${INK}"/>` : "")
        );
      })
      .join(""),
  );
}
export function hash(n) {
  let s = n >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function figureMarkup(c, v) {
  const n = typeof v === "number" ? v : 0,
    p = position(c, n),
    kind = kindOf(c);
  if (kind === "color")
    return `<span class="d-fig-swatch" style="--swatch:${esc(v)}"><i></i></span>`;
  if (kind === "gradient") {
    const stops = (
      String(v).match(
        /#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|oklab|lab|lch|color)a?\([^)]*\)/gi,
      ) || []
    ).length;
    let ticks = "";
    for (let i = 0; i < stops; i++) {
      const x = 5 + (i / Math.max(1, stops - 1)) * (W - 10);
      ticks += `<path d="M${f1(x)} 17.5l3 4.5h-6Z" fill="${PAPER}" stroke="${INK}" stroke-width="1"/>`;
    }
    return (
      `<span class="d-fig-swatch d-fig-gradient" style="--swatch:${esc(v)}"><i></i></span>` +
      svg(ticks, "d-fig-over")
    );
  }
  if (kind === "shadow") {
    const s = v || {},
      k = 0.35;
    return `<span class="d-fig-shadow"><i style="box-shadow:${f1((s.x || 0) * k)}px ${f1((s.y || 0) * k)}px ${f1((s.blur || 0) * k)}px ${f1((s.spread || 0) * k)}px ${esc(s.color || "#0003")}"></i></span>`;
  }
  if (["motion", "spring", "bezier"].includes(kind)) {
    const total = (v?.duration || 1000) + (v?.delay || 0),
      d = (v?.delay || 0) / total,
      x0 = 4,
      w = W - 8,
      pts = curvePoints(v, 48).map(([x, y]) => [
        x0 + (d + (1 - d) * x) * w,
        19 - clamp(y, -0.25, 1.35) * 13,
      ]);
    return svg(
      (d > 0
        ? `<rect x="${x0}" y="3" width="${f1(d * w)}" height="18" fill="${A}" opacity=".12"/>`
        : "") +
        line(`M${x0} 6H${x0 + w}`, LINE, 1, ' stroke-dasharray="1 2.5"') +
        line(`M${x0} 19H${x0 + w}`, LINE, 1) +
        line(path([[x0, 19], ...pts]), A, 1.5),
    );
  }
  if (kind === "keyframes") {
    const frames = Array.isArray(v) ? v : [],
      xs = frames.map((f, i) =>
        Number.isFinite(f.offset) ? f.offset : i / Math.max(1, frames.length - 1),
      ),
      amounts = frames.map((f) => translateOf(f)),
      hi = Math.max(1, ...amounts.map(Math.abs)),
      pts = xs.map((x, i) => [5 + x * (W - 10), 18 - (amounts[i] / hi) * 12]);
    return svg(
      line(`M5 18H${W - 5}`, LINE, 1) +
        line(path(pts), A, 1.5) +
        pts
          .map(
            ([x, y]) =>
              `<path d="M${f1(x)} ${f1(y - 3.5)}l3.5 3.5l-3.5 3.5l-3.5 -3.5Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.25"/>`,
          )
          .join(""),
    );
  }
  if (kind === "angle") {
    const r = (n * Math.PI) / 180,
      cx = 12,
      cy = 12,
      R = 9,
      ex = cx + R * Math.cos(r),
      ey = cy - R * Math.sin(r),
      turn = ((n % 360) + 360) % 360,
      arc =
        turn === 0
          ? ""
          : `<path d="M${cx + R} ${cy}A${R} ${R} 0 ${turn > 180 ? 1 : 0} 0 ${f1(ex)} ${f1(ey)}" fill="none" stroke="${A}" stroke-width="2"/>`;
    return svg(
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${LINE}"/>` +
        arc +
        line(`M${cx} ${cy}L${f1(ex)} ${f1(ey)}`, INK, 1.5) +
        `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${INK}"/>` +
        rail(p, 30, 40),
    );
  }
  if (kind === "vector") {
    const lo = c.min ?? -1,
      hi = c.max ?? 1,
      x = 4 + clamp((v[0] - lo) / (hi - lo || 1), 0, 1) * (W - 8),
      y = H - 4 - clamp((v[1] - lo) / (hi - lo || 1), 0, 1) * (H - 8);
    return svg(
      `<path d="M${W / 2} 2V${H - 2}M2 ${H / 2}H${W - 2}" stroke="${LINE}" stroke-dasharray="1 2"/>` +
        `<path d="M${f1(x)} 1V${H - 1}M1 ${f1(y)}H${W - 1}" stroke="${A}" opacity=".5"/>` +
        `<circle class="d-thumb" cx="${f1(x)}" cy="${f1(y)}" r="4" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>`,
    );
  }
  if (kind === "spacing") {
    const [t, r, b, l] = v,
      k = (q) => clamp(q / 5, 0, 10),
      ox = 12,
      ow = W - 24;
    return svg(
      `<rect x="${ox + 0.5}" y="1.5" width="${ow - 1}" height="21" rx="1.5" fill="${A}" fill-opacity=".16" stroke="${A}" stroke-opacity=".55"/>` +
        `<rect x="${f1(ox + 1 + k(l))}" y="${f1(2 + k(t) / 1.6)}" width="${f1(Math.max(2, ow - 2 - k(l) - k(r)))}" height="${f1(Math.max(2, 20 - k(t) / 1.6 - k(b) / 1.6))}" fill="${PAPER}" stroke="${INK}"/>`,
    );
  }
  if (kind === "text" && typeof v === "string") {
    // Words as dashes: the drawing grows with the text and wraps like a paragraph.
    const words = v.trim().split(/\s+/).filter(Boolean);
    let x = 2,
      y = 5,
      out = "";
    for (const word of words.slice(0, 24)) {
      const len = Math.min(26, 3 + word.length * 2.6);
      if (x + len > W - 2) {
        x = 2;
        y += 6;
      }
      if (y > 19) break;
      out += `<rect x="${f1(x)}" y="${y}" width="${f1(len)}" height="2.5" rx="1.25" fill="${y === 5 ? INK : SOFT}"/>`;
      x += len + 3;
    }
    return svg(out || line(`M2 12H${W - 2}`, LINE, 1, ' stroke-dasharray="2 3"'));
  }
  if (kind === "typography") {
    const size = v?.size || 16,
      px = clamp(8 + (size - 8) * 0.3, 9, 21);
    return (
      `<span class="d-fig-type" style="font-family:${esc(v?.family || "inherit")};font-weight:${Number(v?.weight) || 400};font-size:${f1(px)}px">Ag</span>` +
      svg(rail(clamp((size - 8) / 88, 0, 1), 36, 34), "d-fig-over")
    );
  }
  if (kind === "image") {
    const g = v.gamma || 1,
      black = v.black || 0,
      white = v.white ?? 1,
      curve = v.curve || [0, 0.25, 0.5, 0.75, 1],
      tone = (x) => {
        const t = clamp((x - black) / (white - black || 0.01), 0, 1) ** (1 / g),
          i = Math.min(3, Math.floor(t * 4)),
          f = t * 4 - i;
        return curve[i] + (curve[i + 1] - curve[i]) * f;
      },
      r = hash(7);
    let bars = "";
    for (let i = 0; i < 24; i++) {
      const h = 2 + (Math.sin(i * 0.55) * 0.5 + 0.5) * 9 + r() * 4;
      bars += `<rect x="${f1(3 + i * 3)}" y="${f1(22 - h)}" width="2" height="${f1(h)}" fill="${SOFT}" opacity=".4"/>`;
    }
    const pts = Array.from({ length: 33 }, (_, i) => [
      3 + (i / 32) * (W - 6),
      22 - tone(i / 32) * 20,
    ]);
    return svg(bars + line(path(pts), A, 1.5));
  }
  if (kind === "encoding") {
    const pts = [
        [0.06, 0.78],
        [0.18, 0.55],
        [0.3, 0.66],
        [0.42, 0.38],
        [0.55, 0.47],
        [0.68, 0.22],
        [0.8, 0.3],
        [0.93, 0.1],
      ],
      px = (q) => (v.x ? 6 + q[0] * (W - 10) : W / 2),
      py = (q) => (v.y ? 3 + q[1] * 16 : 12),
      series = [A, INK, SOFT];
    return svg(
      `<path d="M2.5 1V21.5H${W - 1}" stroke="${LINE}" fill="none"/>` +
        pts
          .map(
            (q, i) =>
              `<circle cx="${f1(px(q))}" cy="${f1(py(q))}" r="${v.size ? f1(1.3 + ((i * 5) % 7) * 0.33) : 1.9}" fill="${v.color ? series[i % 3] : A}" opacity="${v.x || v.y ? 1 : 0.35}"/>`,
          )
          .join(""),
    );
  }
  if (kind === "sampler") {
    const s = schedule(v.steps, v.scheduler, v.shift),
      skip = Math.round((1 - (v.denoise ?? 1)) * (s.length - 1)),
      pts = s.map((y, i, arr) => [3 + (i / (arr.length - 1)) * (W - 6), 21 - y * 18]);
    return svg(
      (skip
        ? `<rect x="3" y="2" width="${f1(pts[skip][0] - 3)}" height="20" fill="${SOFT}" opacity=".18"/>`
        : "") +
        line(path(pts), A, 1.5) +
        pts
          .filter((_, i) => i >= skip && i % Math.max(1, Math.round(s.length / 10)) === 0)
          .map(([x, y]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="1.4" fill="${INK}"/>`)
          .join(""),
    );
  }
  if (kind === "seed") {
    // The seed as the noise it starts from: the same seed always draws the same field.
    const r = hash(n);
    let cells = "";
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 12; x++)
        cells += `<rect x="${2 + x * 6}" y="${1 + y * 5.5}" width="5" height="4.5" fill="${INK}" opacity="${f1(0.06 + r() * 0.7)}"/>`;
    return svg(cells);
  }
  if (kind === "count") {
    const shown = clamp(Math.round(n), 0, 16),
      out = [];
    for (let i = 0; i < 16; i++) {
      const x = 2.5 + (i % 8) * 9,
        y = i < 8 ? 2.5 : 13.5;
      out.push(
        `<rect x="${x}" y="${y}" width="7" height="8" rx="1" fill="${i < shown ? A : "none"}" stroke="${i < shown ? A : LINE}"/>`,
      );
    }
    return svg(out.join(""));
  }
  if (["select", "segmented"].includes(kind) || (c.options && choiceGlyphs[kind]))
    return choice(c, v);
  if (["file", "asset"].includes(kind)) {
    const name = String(v || ""),
      ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || "").slice(0, 4).toUpperCase();
    return svg(
      `<path d="M4.5 2.5H14L18.5 7V21.5H4.5ZM14 2.5V7H18.5" fill="${PAPER}" stroke="${name ? INK : SOFT}"/>` +
        (name
          ? `<text x="25" y="16" class="d-pixel-text" fill="${A}">${esc(ext || "FILE")}</text>`
          : `<path d="M25 12H${W - 4}" stroke="${LINE}" stroke-dasharray="2 3"/>`),
    );
  }
  if (kind === "boolean" || ["loop", "split", "labels"].includes(kind)) {
    const on = !!v;
    if (kind === "loop")
      return svg(
        on
          ? line("M6 12C6 5 16 5 22 12S38 19 44 12S60 5 66 12", A, 1.5) +
              `<path d="M63 8.5l3.5 3.5l-3.5 3.5" stroke="${A}" fill="none" stroke-width="1.5"/>` +
              line("M44 12", A)
          : line("M6 17C12 6 18 6 22 12", INK, 1.5) +
              line("M22 12H66", LINE, 1, ' stroke-dasharray="2 3"') +
              `<circle cx="22" cy="12" r="2" fill="${INK}"/>`,
      );
    if (kind === "split")
      return svg(
        `<rect x="3" y="3" width="${W - 6}" height="18" rx="2" fill="${SOFT}" opacity=".22"/>` +
          (on
            ? `<rect x="${W / 2}" y="3" width="${W / 2 - 3}" height="18" rx="2" fill="${A}"/>`
            : "") +
          line(`M${W / 2} 1V23`, INK, 1.5),
      );
    if (kind === "labels")
      return svg(
        [
          [10, 16],
          [28, 10],
          [46, 14],
          [62, 6],
        ]
          .map(
            ([x, y]) =>
              `<circle cx="${x}" cy="${y + 3}" r="2" fill="${A}"/>` +
              (on ? `<rect x="${x + 3}" y="${y - 4}" width="10" height="3" rx="1" fill="${INK}"/>` : ""),
          )
          .join(""),
      );
    return svg(
      `<circle cx="12" cy="12" r="5.5" fill="${on ? A : "none"}" stroke="${on ? A : SOFT}" stroke-width="1.5"/>` +
        (on ? `<circle cx="12" cy="12" r="9" fill="none" stroke="${A}" opacity=".35"/>` : "") +
        line(`M26 12H${W - 4}`, on ? A : LINE, on ? 2 : 1, on ? "" : ' stroke-dasharray="2 3"'),
    );
  }
  if (kind === "radius") {
    const r = clamp((n / Math.max(1, c.max ?? 64)) * 14, 0, 8.25);
    return svg(
      `<rect x="3.75" y="3.75" width="24.5" height="16.5" rx="${f1(r)}" fill="${A}" fill-opacity=".14" stroke="${A}" stroke-width="1.5"/>` +
        rail(p, 36, 34),
    );
  }
  if (kind === "opacity") {
    // Eight steps of the accent at rising opacity; the steps the value reaches are filled.
    let bars = "";
    for (let i = 0; i < 8; i++) {
      const x = 2.5 + i * 9,
        lit = (i + 0.5) / 8 <= p + 1e-9;
      bars += `<rect x="${x}" y="4.5" width="8" height="15" rx="1" fill="${A}" fill-opacity="${lit ? f1((i + 1) / 8) : 0}" stroke="${lit ? A : LINE}" stroke-opacity="${lit ? 0.4 : 1}"/>`;
    }
    return svg(bars);
  }
  if (typeof v === "string")
    return svg(line(`M2 12H${W - 2}`, LINE, 1, ' stroke-dasharray="2 3"'));
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
    const hi = Math.max(1e-9, ...v.map(Math.abs)),
      bw = (W - 4) / Math.min(12, v.length);
    return svg(
      v
        .slice(0, 12)
        .map(
          (x, i) =>
            `<rect x="${f1(2 + i * bw)}" y="${f1(21 - (Math.abs(x) / hi) * 17)}" width="${f1(Math.max(2, bw - 2))}" height="${f1((Math.abs(x) / hi) * 17)}" fill="${A}"/>`,
        )
        .join(""),
    );
  }
  if (v && typeof v === "object")
    return svg(
      Object.keys(v)
        .slice(0, 8)
        .map(
          (k, i) =>
            `<rect x="${3 + i * 9}" y="${6 + (i % 3) * 3}" width="7" height="${14 - (i % 3) * 3}" fill="${A}" fill-opacity="${f1(0.3 + 0.1 * (i % 5))}"/>`,
        )
        .join(""),
    );
  return ruler(p);
}
/** translateX amount of a keyframe record, in px. */
export const translateOf = (f) =>
  Number(/translateX\(\s*(-?[\d.]+)/.exec(f?.transform || "")?.[1] || 0);
export function drawFigure(node, c, v) {
  const kind = kindOf(c),
    html = figureMarkup(c, v);
  node.dataset.kind = kind;
  if (node._html !== html) {
    node._html = html;
    node.innerHTML = html;
  }
}
