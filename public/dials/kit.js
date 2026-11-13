// Shared parts for studios: one field, one hero readout, one choice row, one draggable handle.
// Every studio is built from these so the six studios read as one instrument.
import { el, pointerSurface } from "./dom.js";
import { clamp, expression } from "./values.js";
export const NS = "http://www.w3.org/2000/svg";
let serial = 0;
export const uid = (p = "k") => `${p}-${++serial}`;
/** An SVG element. */
export function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs))
    if (k === "text") e.textContent = v;
    else if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k) e.append(k);
  return e;
}
export const fx = (n, d = 2) => String(Number(Number(n).toFixed(d)));
/** Pointer position in an SVG's own user units. */
export function svgPoint(svg, e) {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
/** A titled block of a studio. Titles are sentence case, never capitals. */
export function block(title, ...children) {
  return el(
    "section",
    { class: "k-block" },
    title ? el("h3", { class: "k-title", text: title }) : null,
    ...children,
  );
}
/**
 * The one hero readout of a studio, set in Stem 7: the number a person came to read
 * (a contrast ratio, a settle time, a gamma). Optional unit and verdict beside it.
 */
export function hero(label) {
  const num = el("output", { class: "k-hero-num" }),
    unit = el("span", { class: "k-hero-unit" }),
    note = el("span", { class: "k-hero-note" }),
    node = el(
      "div",
      { class: "k-hero", role: "group", "aria-label": label },
      el("span", { class: "k-hero-label", text: label }),
      el("div", { class: "k-hero-line" }, num, unit, note),
    );
  return {
    node,
    set(value, u = "", n = "", tone = "") {
      num.textContent = value;
      unit.textContent = u;
      note.textContent = n;
      note.dataset.tone = tone;
      num.setAttribute("aria-label", `${label}: ${value}${u ? " " + u : ""}${n ? ", " + n : ""}`);
    },
  };
}
/**
 * The studio field: a name, a typed value you can also drag, and a 6 px bar whose fill is the
 * value (optionally painted with what it changes, such as a hue gradient). The bar is a slider:
 * drag it, or focus it and use arrows (Shift fine, Alt coarse), Home and End.
 */
export function field(ctx, spec) {
  const {
    label,
    min = 0,
    max = 1,
    step = 0.01,
    unit = "",
    digits = 3,
    track,
    get,
    put,
  } = spec;
  const id = uid("kf"),
    name = el("span", { class: "k-field-name", id, text: label }),
    input = el("input", {
      type: "text",
      class: "k-field-input",
      "aria-labelledby": id,
      spellcheck: false,
      autocomplete: "off",
      inputmode: "decimal",
    }),
    fill = el("i"),
    thumb = el("b"),
    bar = el(
      "div",
      {
        class: "k-bar",
        role: "slider",
        tabindex: 0,
        "aria-labelledby": id,
        "aria-valuemin": min,
        "aria-valuemax": max,
      },
      fill,
      thumb,
    ),
    node = el(
      "div",
      { class: "k-field" + (track ? " k-field-painted" : "") },
      name,
      input,
      bar,
    );
  const value = () => get(ctx.get());
  const text = (n) => `${fx(n, digits)}${unit}`;
  const set = (n) => ctx.change(put(ctx.get(), clamp(Number(n.toFixed(6)), min, max)));
  const at = (e) => {
    const r = bar.getBoundingClientRect();
    return min + clamp((e.clientX - r.left) / (r.width || 1), 0, 1) * (max - min);
  };
  const snap = (n) => (step ? Math.round((n - min) / step) * step + min : n);
  const dispose = [];
  dispose.push(
    pointerSurface(bar, {
      start: () => ctx.begin("studio-bar"),
      move: (e) => set(snap(at(e))),
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
    }),
  );
  let base = 0,
    x0 = 0;
  dispose.push(
    pointerSurface(name, {
      start: (e) => {
        base = value();
        x0 = e.clientX;
        ctx.begin("studio-scrub");
      },
      move: (e) => {
        const k = (e.shiftKey ? 0.1 : 1) * (e.altKey ? 10 : 1);
        set(snap(base + Math.round((e.clientX - x0) / 2) * step * k));
      },
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
    }),
  );
  bar.addEventListener("keydown", (e) => {
    const k = (e.shiftKey ? 0.1 : 1) * (e.altKey ? 10 : 1),
      dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    let n;
    if (dir) n = value() + dir * step * k;
    else if (e.key === "Home") n = min;
    else if (e.key === "End") n = max;
    else if (e.key === "PageUp" || e.key === "PageDown")
      n = value() + (e.key === "PageUp" ? 1 : -1) * (max - min) / 10;
    else if (e.key === "Enter") {
      e.preventDefault();
      input.focus();
      input.select();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    ctx.begin("studio-key");
    set(n);
    ctx.commit();
  });
  input.addEventListener("focus", () => {
    input.value = text(value());
    ctx.begin("studio-entry");
  });
  input.addEventListener("input", () => {
    try {
      set(expression(input.value, { min, max, unit }));
      input.removeAttribute("aria-invalid");
    } catch (err) {
      input.setAttribute("aria-invalid", "true");
      input.title = err.message;
    }
  });
  const finish = () => {
    if (input.hasAttribute("aria-invalid")) {
      ctx.cancel();
      input.removeAttribute("aria-invalid");
    } else ctx.commit();
    input.value = text(value());
  };
  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      ctx.cancel();
      input.value = text(value());
      bar.focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      set(value() + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 0.1 : 1) * (e.altKey ? 10 : 1));
      input.value = text(value());
    }
  });
  return {
    node,
    bar,
    input,
    update() {
      const v = ctx.get(),
        n = value(),
        p = clamp((n - min) / (max - min || 1), 0, 1);
      node.style.setProperty("--p", p.toFixed(4));
      if (track) node.style.setProperty("--track", typeof track === "function" ? track(v) : track);
      bar.setAttribute("aria-valuenow", fx(n, digits));
      bar.setAttribute("aria-valuetext", text(n));
      if (document.activeElement !== input) input.value = text(n);
    },
    destroy: () => dispose.forEach((d) => d()),
  };
}
/**
 * A row of choices drawn as words (or small glyphs) on an underline; the current one is
 * underlined in ink. A radio group: arrows move, the choice follows focus.
 */
export function chips(label, options, onPick, { glyph } = {}) {
  const node = el("div", { class: "k-chips", role: "radiogroup", "aria-label": label });
  const items = options.map((o) => {
    const value = typeof o === "object" ? o.value : o,
      text = typeof o === "object" ? o.label : String(o);
    const b = el("button", {
      type: "button",
      role: "radio",
      class: "k-chip",
      "aria-checked": "false",
      tabindex: -1,
      title: typeof o === "object" && o.title ? o.title : text,
    });
    if (glyph) {
      b.classList.add("k-chip-glyph");
      b.append(glyph(value), el("span", { text }));
    } else b.textContent = text;
    b.addEventListener("click", () => onPick(value));
    node.append(b);
    return { b, value };
  });
  node.addEventListener("keydown", (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const i = items.findIndex((x) => x.b === document.activeElement),
      next = items[(i + dir + items.length) % items.length];
    next.b.focus();
    onPick(next.value);
  });
  return {
    node,
    set(value) {
      let any = false;
      for (const x of items) {
        const on = JSON.stringify(x.value) === JSON.stringify(value);
        any ||= on;
        x.b.setAttribute("aria-checked", String(on));
        x.b.tabIndex = on ? 0 : -1;
      }
      if (!any && items[0]) items[0].b.tabIndex = 0;
    },
  };
}
/**
 * A draggable point inside an SVG drawing. It is a focusable slider: arrows move it by
 * `step` user units (Shift fine, Alt coarse). `move(x, y, e)` receives user units.
 */
export function handle(svg, { label, r = 6, cls = "", move, start, end, cancel, keys }) {
  const g = s("g", {
    class: "k-handle " + cls,
    tabindex: 0,
    role: "slider",
    "aria-label": label,
  });
  g.append(s("circle", { class: "k-handle-hit", r: r + 7 }), s("circle", { class: "k-handle-dot", r }));
  svg.append(g);
  const dispose = pointerSurface(g, {
    start: (e) => start?.(e),
    move: (e) => {
      const p = svgPoint(svg, e);
      move(p.x, p.y, e);
    },
    end: (e) => end?.(e),
    cancel: () => cancel?.(),
  });
  g.addEventListener("keydown", (e) => {
    const k = (e.shiftKey ? 0.1 : 1) * (e.altKey ? 10 : 1),
      d = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[e.key];
    if (!d || !keys) return;
    e.preventDefault();
    e.stopPropagation();
    keys(d[0] * k, d[1] * k, e);
  });
  return {
    node: g,
    at(x, y) {
      g.setAttribute("transform", `translate(${fx(x)} ${fx(y)})`);
    },
    text(t) {
      g.setAttribute("aria-valuetext", t);
    },
    destroy: dispose,
  };
}
/** Keep an SVG's user units equal to its CSS pixels, so strokes and text stay true at any size. */
export function fitSvg(svg, onSize) {
  let w = 0,
    h = 0;
  const ro = new ResizeObserver(([entry]) => {
    const r = entry.contentRect,
      nw = Math.round(r.width),
      nh = Math.round(r.height);
    if (!nw || !nh || (nw === w && nh === h)) return;
    w = nw;
    h = nh;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    onSize(w, h);
  });
  ro.observe(svg);
  return {
    size: () => ({ w, h }),
    destroy: () => ro.disconnect(),
  };
}
/* ---------- Image ---------- */
/** The default source: a small still life drawn locally (no network, no bundled photo). */
export function stillLife(w = 320, h = 180) {
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h }),
    g = c.getContext("2d", { willReadFrequently: true }),
    k = w / 320;
  g.scale(k, h / 180);
  const back = g.createLinearGradient(0, 0, 320, 180);
  back.addColorStop(0, "#17266c");
  back.addColorStop(1, "#526bca");
  g.fillStyle = back;
  g.fillRect(0, 0, 320, 180);
  g.fillStyle = "#e5ddbf";
  g.fillRect(0, 135, 320, 45);
  g.fillStyle = "#11214f";
  g.beginPath();
  g.ellipse(180, 142, 88, 12, 0, 0, Math.PI * 2);
  g.fill();
  const orange = g.createRadialGradient(145, 76, 1, 179, 100, 65);
  orange.addColorStop(0, "#ffcc56");
  orange.addColorStop(0.6, "#ed7d21");
  orange.addColorStop(1, "#792e16");
  g.fillStyle = orange;
  g.beginPath();
  g.arc(177, 95, 53, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#749b42";
  g.beginPath();
  g.ellipse(181, 39, 22, 7, -0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f2eee0";
  g.fillRect(34, 70, 45, 65);
  g.fillStyle = "#c9c5b6";
  g.fillRect(73, 70, 8, 65);
  return c;
}
/** Levels, gamma and the five-point tone curve as one function from input to output, 0 to 1. */
export function toneOf(v = {}) {
  const black = v.black || 0,
    white = v.white ?? 1,
    g = v.gamma || 1,
    curve = v.curve || [0, 0.25, 0.5, 0.75, 1];
  return (x) => {
    const t = clamp((x - black) / (white - black || 0.001), 0, 1) ** (1 / g),
      i = Math.min(3, Math.floor(t * 4)),
      f = t * 4 - i;
    return curve[i] + (curve[i + 1] - curve[i]) * f;
  };
}
/** Apply tone, exposure and saturation to pixels. Returns the luminance histogram of the source. */
export function adjust(src, out, v = {}, enabled = true, bins = 64) {
  const tone = toneOf(v),
    lut = new Uint8ClampedArray(256),
    gain = 2 ** (v.exposure || 0),
    sat = v.saturation ?? 1,
    hist = new Array(bins).fill(0),
    a = src.data,
    b = out.data;
  for (let i = 0; i < 256; i++) lut[i] = Math.round(clamp(tone(clamp((i / 255) * gain, 0, 1)), 0, 1) * 255);
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i],
      g = a[i + 1],
      bl = a[i + 2],
      y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    hist[Math.min(bins - 1, Math.floor((y / 256) * bins))]++;
    if (!enabled) {
      b[i] = r;
      b[i + 1] = g;
      b[i + 2] = bl;
    } else {
      const R = lut[r],
        G = lut[g],
        B = lut[bl],
        Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      b[i] = Y + (R - Y) * sat;
      b[i + 1] = Y + (G - Y) * sat;
      b[i + 2] = Y + (B - Y) * sat;
    }
    b[i + 3] = a[i + 3];
  }
  return hist;
}
/** A one-line keyboard hint at the foot of the rail. */
export function keyHint(...lines) {
  return el(
    "div",
    { class: "k-hint" },
    ...lines.map(([k, t]) => el("p", {}, el("kbd", { text: k }), el("span", { text: t }))),
  );
}
