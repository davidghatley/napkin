import { el, button, heading, canvas, grid, pointerSurface, visible, choiceBox, filePick } from "./dom.js";
import { clamp, clone, expression, same } from "./values.js";
import {
  parseColor,
  cssLch,
  cssLab,
  labToLch,
  lchToLab,
  labToLinear,
  gamma,
  rgb,
  toHex,
  inGamut,
  gamutChroma,
  contrast,
  apca,
  ramp,
  paletteFromPixels,
} from "./color.js";
import {
  motionAt,
  curvePoints,
  keyframeAt,
  analyze,
  toEasing,
  toTransition,
  toWaapi,
} from "./motion.js";
import { schedule } from "./figures.js";
import { imageStudio } from "./studio-image.js";
import { encodingStudio as dataLab } from "./studio-data.js";
import { typeStudio as typeLab } from "./studio-type.js";
import { samplerStudio as samplerLab } from "./studio-sampler.js";
import { field as kField } from "./kit.js";
import { motionStudio as motionLab } from "./studio-motion.js";
import { instrument } from "./instruments.js";
const accent = (node) =>
  getComputedStyle(node).getPropertyValue("--d-accent").trim() || "#3459e2";
const controlValues = (panel, section) =>
  Object.fromEntries(section.controls.map((c) => [c.id, panel.get(c.id)]));
function choice(label, options, change) {
  return el(
    "div",
    { class: "d-tool" },
    el("span", { text: label }),
    choiceBox(label, options, change),
  );
}
function metric(name) {
  const value = el("strong", { text: "—" });
  return {
    node: el("div", { class: "d-metric" }, el("span", { text: name }), value),
    set: (text) => (value.textContent = text),
  };
}
function fields(ctx, descriptors, { sliders = false } = {}) {
  const updates = [];
  const box = el("div", { class: "d-lab-fields" });
  for (const desc of descriptors) {
    const [label, key, min, max, step = 1, unit = ""] = desc,
      input = el("input", {
        type: "text",
        "aria-label": label,
        inputmode: "decimal",
        spellcheck: false,
      });
    const get = () => {
      const v = ctx.get();
      return typeof key === "function" ? key(v) : v[key];
    };
    const put = (value) => {
      const v = ctx.get();
      if (Array.isArray(key)) {
        v[key[0]][key[1]] = value;
      } else v[key] = value;
      ctx.change(v);
    };
    const value = () =>
      Array.isArray(key) ? ctx.get()[key[0]][key[1]] : get();
    input.addEventListener("focus", () => ctx.begin("studio-entry"));
    input.addEventListener("input", () => {
      try {
        put(expression(input.value, { min, max, step, unit }));
        input.removeAttribute("aria-invalid");
      } catch (e) {
        input.setAttribute("aria-invalid", "true");
        input.title = e.message;
      }
    });
    const commit = () => {
      if (input.hasAttribute("aria-invalid")) {
        ctx.cancel();
        input.removeAttribute("aria-invalid");
        input.value = `${value()}${unit}`;
      } else ctx.commit();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        ctx.cancel();
        input.value = `${value()}${unit}`;
        input.blur();
      }
      if (["ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        ctx.begin("studio-key");
        const v = clamp(
          value() +
            (e.key === "ArrowUp" ? 1 : -1) *
              step *
              (e.shiftKey ? 0.1 : 1) *
              (e.altKey ? 10 : 1),
          min,
          max,
        );
        put(Number(v.toFixed(6)));
        ctx.commit();
        input.value = `${value()}${unit}`;
      }
    });
    if (!sliders)
      box.append(
        el("label", { class: "d-field" }, el("span", { text: label }), input),
      );
    if (sliders) {
      let sliding = false;
      const range = el("input", {
        type: "range",
        min,
        max,
        step: step / 10,
        "aria-label": `${label} slider`,
      });
      range.addEventListener("input", () => {
        if (!sliding) {
          sliding = true;
          ctx.begin("studio-slide");
        }
        put(Number(Number(range.value).toFixed(6)));
      });
      range.addEventListener("change", () => {
        sliding = false;
        ctx.commit();
      });
      box.classList.add("d-lab-sliders");
      box.append(
        el("label", { class: "d-field d-field-slide" }, el("span", { text: label }), range, input),
      );
      updates.push(() => {
        if (document.activeElement !== range || !sliding) range.value = value();
      });
    }
    updates.push(() => {
      if (document.activeElement !== input || !ctx.isEditing()) {
        const n = value();
        input.value = `${typeof n === "number" ? Number(n.toFixed(5)) : n}${unit}`;
      }
    });
  }
  return { node: box, update: () => updates.forEach((f) => f()) };
}
function swatchRow(label, colors, onPick) {
  const row = el("div", { class: "d-swatches", "aria-label": label });
  for (const color of colors) {
    const css = typeof color === "string" ? color : cssLch(color),
      b = button("", `${label}: ${css}`, () => onPick(css));
    b.style.background = css;
    b.title = css;
    row.append(b);
  }
  return row;
}
function updateSwatches(host, label, colors, onPick, lines) {
  let row = host.firstElementChild;
  if (!row) {
    row = swatchRow(label, [], onPick);
    host.append(row);
  }
  while (row.children.length > colors.length) row.lastElementChild.remove();
  colors.forEach((color, i) => {
    let b = row.children[i];
    if (!b) {
      b = button("", label, () => onPick(b.dataset.color));
      row.append(b);
    }
    const css = typeof color === "string" ? color : cssLch(color);
    b.dataset.color = css;
    b.style.background = css;
    b.style.setProperty("--swatch", css);
    b.title = css;
    b.setAttribute("aria-label", `${label}: ${css}`);
    try {
      // The ink with more contrast on this plate (WCAG ratio, measured, not guessed from lightness).
      const lch = typeof color === "string" ? parseColor(color) : color;
      const dark = contrast(parseColor("#16181d"), lch),
        light = contrast(parseColor("#ffffff"), lch);
      b.style.setProperty("--ink", dark >= light ? "#16181d" : "#ffffff");
      // Mid tones where neither ink reaches 4.5 : 1 set their words on a small backing.
      // (A small margin: the browser maps out-of-gamut plates slightly differently from this measure.)
      b.classList.toggle("is-mid", Math.max(dark, light) < 4.75);
    } catch {
      b.classList.add("is-mid");
    }
    if (lines) {
      let lch;
      try {
        lch = typeof color === "string" ? parseColor(color) : color;
      } catch {
        lch = null;
      }
      b.classList.add("d-plate");
      b.replaceChildren(
        ...lines(css, lch).map((t, k) => el(k ? "small" : "b", { text: t })),
      );
    }
  });
}
/** Text drawn as a picture: a specimen of a colour that may not pass, inside a role=img that states the ratio. */
function specimen(text, size, weight, cls = "") {
  const NS = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(NS, "svg"),
    t = document.createElementNS(NS, "text");
  svg.setAttribute("class", "d-specimen " + cls);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("height", String(Math.ceil(size * 1.3)));
  svg.style.setProperty("--w", String(Math.ceil(text.length * size * (weight > 500 ? 0.66 : 0.56))));
  t.setAttribute("x", "0");
  t.setAttribute("y", String(Math.round(size)));
  t.setAttribute("fill", "currentColor");
  t.setAttribute("font-size", String(size));
  t.setAttribute("font-weight", String(weight));
  t.textContent = text;
  svg.append(t);
  return svg;
}
function colorStudio(ctx, host) {
  // One plane carries the colour: lightness up, chroma across, at the current hue.
  // Readouts ride the axes at the point; the gamut edges and the contrast threshold are drawn where they fall.
  const PW = 560,
    PH = 300,
    CMAX = 0.4;
  let space = "srgb",
    planeMode = "OKLCH",
    map = "Off",
    background = String(ctx.control.background || "#ffffff"),
    harmony = "Complement",
    format = "OKLCH",
    cacheKey = "",
    history = [ctx.get()],
    frame = 0,
    dead = false;
  const css = (name, fallback) =>
    getComputedStyle(host).getPropertyValue(name).trim() || fallback;
  const plane = canvas(
    "Color plane. Left and right change chroma; up and down change lightness. Shift fine.",
    PW,
    PH,
  );
  const tagL = el("span", { class: "d-cx-tag", "data-axis": "y" }),
    tagC = el("span", { class: "d-cx-tag", "data-axis": "x" }),
    tagG = el("span", { class: "d-cx-tag", "data-axis": "g" }),
    planeWrap = el("div", { class: "d-cx-plane" }, plane, tagL, tagC, tagG),
    axisY = el("div", { class: "d-cx-axis-y", "aria-hidden": "true" }),
    axisX = el("div", { class: "d-cx-axis-x", "aria-hidden": "true" });
  const field = el("div", { class: "d-cx-field" }, axisY, planeWrap, axisX);
  const paintAxes = () => {
    if (planeMode === "OKLCH") {
      axisY.replaceChildren(
        ...[100, 75, 50, 25, 0].map((n, i) =>
          el("span", { text: i === 0 ? "L 100" : String(n), style: `top:${i * 25}%` }),
        ),
      );
      axisX.replaceChildren(
        ...[0, 0.1, 0.2, 0.3, 0.4].map((n, i) =>
          el("span", { text: i === 4 ? "C 0.4" : String(n), style: `left:${i * 25}%` }),
        ),
      );
    } else {
      axisY.replaceChildren(
        ...["+b", "", "0", "", "−b"].map((n, i) => el("span", { text: n, style: `top:${i * 25}%` })),
      );
      axisX.replaceChildren(
        ...["−a", "", "0", "", "+a"].map((n, i) => el("span", { text: n, style: `left:${i * 25}%` })),
      );
    }
  };
  // Hue and alpha are strips under the plane, each its own direct surface.
  const strip = (label, name, keyLabel) => {
    const c = canvas(keyLabel, PW, name === "hue" ? 16 : 10);
    c.setAttribute("role", "slider");
    c.setAttribute("aria-valuemin", "0");
    c.setAttribute("aria-valuemax", name === "hue" ? "360" : "100");
    c.setAttribute("aria-valuenow", "0");
    const out = el("output", { class: "d-cx-out" });
    return { c, out, node: el("div", { class: "d-cx-strip" }, el("span", { text: label }), c, out) };
  };
  const hue = strip("Hue", "hue", "Hue strip. Left and right turn the hue; Shift fine, Alt coarse."),
    alpha = strip("Alpha", "alpha", "Alpha strip. Left and right change opacity; Shift fine.");
  const bar = el(
    "div",
    { class: "d-tools d-deep" },
    choice("Plane", ["OKLCH", "OKLab"], (v) => {
      planeMode = v;
      cacheKey = "";
      paintAxes();
      update();
    }),
    choice("Gamut", ["sRGB", "P3"], (v) => {
      space = v === "P3" ? "p3" : "srgb";
      cacheKey = "";
      update();
    }),
    choice("Contrast", ["Off", "AA 4.5", "AAA 7", "APCA 60", "APCA 75"], (v) => {
      map = v;
      cacheKey = "";
      update();
    }),
  );
  // Proof: the colour as text on its background, graded in the two systems.
  const sampleBig = el("strong", { text: "Aa" }),
    // The small line is a picture of the colour as text (its ratio is read out beside it), so it is drawn, not set.
    sampleSmall = specimen("Small text reads like this at twelve pixels.", 12, 400, "d-cx-sample-line"),
    sample = el("div", { class: "d-cx-sample", role: "img" }, sampleBig, sampleSmall);
  const grade = (name) => {
    const b = el("b"),
      em = el("em"),
      label = el("span", { text: name });
    label.append(em);
    return { node: el("div", { class: "d-cx-grade" }, b, label), b, em };
  };
  const wcag = grade("WCAG 2"),
    lc = grade("APCA Lc");
  const proof = el(
    "div",
    { class: "d-cx-proof" },
    sample,
    el("div", { class: "d-cx-grades" }, wcag.node, lc.node),
  );
  const backInput = el("input", {
    type: "text",
    value: background,
    "aria-label": "Contrast background",
    spellcheck: false,
  });
  const setBackground = (v) => {
    parseColor(v, ctx.host);
    background = v;
    backInput.value = v;
    backInput.removeAttribute("aria-invalid");
    cacheKey = "";
    update();
  };
  backInput.addEventListener("change", () => {
    try {
      setBackground(backInput.value.trim());
    } catch {
      backInput.setAttribute("aria-invalid", "true");
    }
  });
  const backChips = ["#ffffff", "#f3f4f6", "#1b1d23", "#000000"].map((v) => {
    const b = button("", `Contrast against ${v}`, () => setBackground(v));
    b.style.background = v;
    b.dataset.color = v;
    return b;
  });
  const backs = el(
    "div",
    { class: "d-cx-backs" },
    el("span", { text: "Against" }),
    ...backChips,
    backInput,
  );
  const channelCtx = {
    ...ctx,
    get: () => {
      const [l, c, h, a] = parseColor(ctx.get(), ctx.host);
      return { l, c, h, a };
    },
    change: (v) => ctx.change(cssLch([v.l, v.c, v.h, v.a])),
  };
  // L, C, H and A as bars painted with what they change; drag, type or use arrows.
  const lchTrack = (fn) => (v) => `linear-gradient(90deg, ${Array.from({ length: 7 }, (_, i) => cssLch(fn(v, i / 6))).join(", ")})`;
  const kf = [
    kField(channelCtx, { label: "Lightness", min: 0, max: 1, step: 0.001, digits: 3, get: (v) => v.l, put: (v, n) => ({ ...v, l: n }), track: lchTrack((v, t) => [t, v.c, v.h, 1]) }),
    kField(channelCtx, { label: "Chroma", min: 0, max: 0.5, step: 0.001, digits: 3, get: (v) => v.c, put: (v, n) => ({ ...v, c: n }), track: lchTrack((v, t) => [v.l, t * 0.37, v.h, 1]) }),
    kField(channelCtx, { label: "Hue", min: 0, max: 360, step: 1, digits: 1, unit: "deg", get: (v) => v.h, put: (v, n) => ({ ...v, h: n }), track: lchTrack((v, t) => [v.l, Math.min(v.c, 0.15), t * 360, 1]) }),
    kField(channelCtx, { label: "Alpha", min: 0, max: 1, step: 0.01, digits: 2, get: (v) => v.a, put: (v, n) => ({ ...v, a: n }), track: (v) => `linear-gradient(90deg, ${cssLch([v.l, v.c, v.h, 0])}, ${cssLch([v.l, v.c, v.h, 1])}), repeating-conic-gradient(#c9c7bf 0 25%, #fff 0 50%) 0 0 / 8px 8px` }),
  ];
  const channels = {
    node: el("div", { class: "k-fields d-cx-channels d-deep" }, ...kf.map((x) => x.node)),
    update: () => kf.forEach((x) => x.update()),
  };
  const code = el("output", { class: "d-color-code", "aria-live": "off" }),
    copyStatus = el("output", { class: "d-note" });
  const copy = button("Copy", "Copy formatted color", async () => {
    try {
      await navigator.clipboard.writeText(code.value);
      copyStatus.textContent = "Copied";
    } catch {
      copyStatus.textContent = "Select the value to copy it";
    }
    setTimeout(() => (copyStatus.textContent = ""), 1400);
  });
  const codeBlock = el(
    "div",
    { class: "d-cx-section d-cx-code d-deep" },
    el(
      "header",
      {},
      choiceBox("Copy format", ["OKLCH", "OKLab", "Hex", "RGB"], (v) => {
        format = v;
        update();
      }),
      copyStatus,
      copy,
    ),
    code,
  );
  const section = (title, cls, ...kids) =>
    el("div", { class: `d-cx-section ${cls === "d-cx-ramp" ? "" : "d-deep "}${cls}` }, ...kids);
  const rampHost = el("div"),
    harmonyHost = el("div"),
    historyHost = el("div"),
    imageHost = el("div");
  const ramps = section(
    "Ramp",
    "d-cx-ramp",
    el("header", {}, el("h3", { text: "Ramp" })),
    rampHost,
  );
  const harmonies = section(
    "Harmony",
    "d-cx-harmony",
    el(
      "header",
      {},
      el("h3", { text: "Harmony" }),
      choiceBox("Harmony", ["Complement", "Analogous", "Triad", "Split"], (v) => {
        harmony = v;
        update();
      }),
    ),
    harmonyHost,
  );
  // Sampling, binding and history.
  const sampleStatus = el("output", { class: "d-note" }),
    eye = canvas("Sampled image. Click a pixel to use its color.", 300, 110, true);
  eye.classList.add("d-eye");
  eye.hidden = true;
  let eyeData;
  eye.addEventListener("click", (e) => {
    if (!eyeData) return;
    const r = eye.getBoundingClientRect(),
      x = Math.floor(((e.clientX - r.left) / r.width) * eyeData.width),
      y = Math.floor(((e.clientY - r.top) / r.height) * eyeData.height),
      i = (clamp(y, 0, eyeData.height - 1) * eyeData.width + clamp(x, 0, eyeData.width - 1)) * 4;
    ctx.set(toHex([eyeData.data[i] / 255, eyeData.data[i + 1] / 255, eyeData.data[i + 2] / 255]));
  });
  const image = filePick(
    "Choose an image",
    "image/*",
    async (file) => {
      try {
        const bitmap = await createImageBitmap(file),
          c = document.createElement("canvas");
        c.width = 96;
        c.height = 96;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0, 96, 96);
        const view = eye.getContext("2d");
        view.drawImage(bitmap, 0, 0, 300, 110);
        eyeData = view.getImageData(0, 0, 300, 110);
        eye.hidden = false;
        bitmap.close();
        const colors = paletteFromPixels(g.getImageData(0, 0, 96, 96).data);
        imageHost.replaceChildren(swatchRow("Image palette", colors, (v) => ctx.set(v)));
        sampleStatus.textContent = `${colors.length} colours from ${file.name}`;
      } catch {
        sampleStatus.textContent = "Could not read this image";
      }
    },
    "or drop one here",
    "Sample palette from an image",
  );
  const token = el("input", {
      placeholder: "--brand-accent",
      "aria-label": "CSS variable name",
      spellcheck: false,
    }),
    tokenStatus = el("output", { class: "d-note" });
  const bind = button("Bind", "Bind to CSS variable", () => {
    if (!/^--[\w-]+$/.test(token.value)) {
      tokenStatus.textContent = "A variable name starts with --";
      return;
    }
    try {
      ctx.set(`var(${token.value})`);
      tokenStatus.textContent = `Bound to ${token.value}`;
    } catch {
      tokenStatus.textContent = "That variable is not a colour here";
    }
  });
  const side = el(
    "div",
    { class: "d-cx-side" },
    proof,
    el("div", { class: "d-deep" }, backs),
    codeBlock,
    section(
      "Token",
      "d-cx-tokens",
      el("header", {}, el("h3", { text: "Token" }), tokenStatus),
      el("div", { class: "d-cx-token" }, token, bind),
    ),
    section(
      "Sample",
      "d-cx-image",
      el("header", {}, el("h3", { text: "From an image" }), sampleStatus),
      image,
      eye,
      imageHost,
    ),
    section(
      "History",
      "d-cx-history",
      el("header", {}, el("h3", { text: "History" })),
      historyHost,
    ),
  );
  const main = el(
    "div",
    { class: "d-cx-main" },
    bar,
    field,
    channels.node,
    ramps,
    harmonies,
  );
  host.append(el("div", { class: "d-cx" }, main, side));
  // Sampling, the token and history live in the rail, beside the rows they came from.
  ctx.rail.append(...side.querySelectorAll(".d-cx-image, .d-cx-tokens, .d-cx-history"));
  // Pairs: the colour as text on common grounds, and common text on the colour, each with its ratio.
  const pairsHost = el("div", { class: "d-cx-pairs" });
  const drawPairs = (v) => {
    const grounds = [["white", "#ffffff"], ["paper", "#f5f4ef"], ["ink", "#16161a"]];
    const tile = (fg, bg, name) => {
      const ratio = contrast(parseColor(fg, ctx.host), parseColor(bg, ctx.host));
      return el(
        "div",
        { class: "d-cx-pair", role: "img", "aria-label": `${name}: ${ratio.toFixed(2)} to 1` },
        // The specimen is the colour itself; the caption under it is set in the panel ink so it always reads.
        el("div", { class: "d-cx-pair-spec", style: `background:${bg};color:${fg}` }, specimen("Aa", 22, 700), specimen("text", 12, 400)),
        el("div", { class: "d-cx-pair-cap" }, el("span", { text: `${ratio.toFixed(1)} : 1 ${ratio >= 4.5 ? "AA" : ratio >= 3 ? "large" : "fails"}` }), el("small", { text: name })),
      );
    };
    const c = cssLch(v);
    pairsHost.replaceChildren(...grounds.map(([n, g]) => tile(c, g, `on ${n}`)), ...grounds.filter(([n]) => n !== "paper").map(([n, g]) => tile(g, c, `${n} text`)));
  };
  side.append(harmonies, section("Pairs", "d-cx-pairs-block", el("header", {}, el("h3", { text: "Pairs" }), el("small", { class: "d-note", text: "text on grounds, grounds under text" })), pairsHost));
  image.classList.add("d-cx-well");
  const dropper = el("span", { class: "d-cx-dropper", "aria-hidden": "true" });
  dropper.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M14.5 5.5l4 4M16.5 3.5a2.1 2.1 0 013 3l-2 2-3-3zM14.5 7.5L6 16l-1 3 3-1 8.5-8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  image.prepend(dropper);
  paintAxes();
  // Pointer and keys on the plane.
  const pick = (e) => {
    const r = plane.getBoundingClientRect(),
      x = clamp((e.clientX - r.left) / r.width, 0, 1),
      y = clamp((e.clientY - r.top) / r.height, 0, 1),
      v = parseColor(ctx.get(), ctx.host);
    ctx.change(
      planeMode === "OKLCH"
        ? cssLch([1 - y, x * CMAX, v[2], v[3]])
        : cssLab([v[0], (x - 0.5) * 0.8, (0.5 - y) * 0.8, v[3]]),
    );
  };
  ctx.surface(plane, {
    start: () => ctx.begin("color-plane"),
    move: pick,
    end: () => ctx.commit(),
    cancel: () => ctx.cancel(),
  });
  plane.addEventListener("keydown", (e) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const v = parseColor(ctx.get(), ctx.host),
      f = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    if (planeMode === "OKLCH") {
      if (e.key === "ArrowUp") v[0] += 0.01 * f;
      if (e.key === "ArrowDown") v[0] -= 0.01 * f;
      if (e.key === "ArrowLeft") v[1] -= 0.005 * f;
      if (e.key === "ArrowRight") v[1] += 0.005 * f;
      v[0] = clamp(v[0], 0, 1);
      v[1] = clamp(v[1], 0, CMAX);
      ctx.set(cssLch(v));
    } else {
      const lab = lchToLab(v);
      lab[e.key === "ArrowLeft" || e.key === "ArrowRight" ? 1 : 2] +=
        (e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1) * 0.005 * f;
      ctx.set(cssLab(lab));
    }
  });
  const stripDrag = (s, apply) => {
    ctx.surface(s.c, {
      start: () => ctx.begin("color-strip"),
      move: (e) => {
        const r = s.c.getBoundingClientRect(),
          t = clamp((e.clientX - r.left) / r.width, 0, 1),
          v = parseColor(ctx.get(), ctx.host);
        ctx.change(cssLch(apply(v, t)));
      },
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
    });
  };
  stripDrag(hue, (v, t) => [v[0], v[1], Number((t * 360).toFixed(1)), v[3]]);
  stripDrag(alpha, (v, t) => [v[0], v[1], v[2], Number(t.toFixed(3))]);
  const stripKeys = (s, step, apply) =>
    s.c.addEventListener("keydown", (e) => {
      const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const v = parseColor(ctx.get(), ctx.host),
        f = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      ctx.set(cssLch(apply(v, dir * step * f)));
    });
  stripKeys(hue, 1, (v, d) => [v[0], v[1], (((v[2] + d) % 360) + 360) % 360, v[3]]);
  stripKeys(alpha, 0.01, (v, d) => [v[0], v[1], v[2], clamp(v[3] + d, 0, 1)]);
  const onCommit = () => {
    const v = ctx.get();
    if (history.at(-1) !== v) {
      history.push(v);
      history = history.slice(-16);
    }
    updateHistory();
  };
  const updateHistory = () =>
    updateSwatches(historyHost, "Color history", history, (v) => ctx.set(v));
  const RW = 224,
    RH = 120,
    raster = document.createElement("canvas");
  raster.width = RW;
  raster.height = RH;
  const rasterContext = raster.getContext("2d");
  for (const c of [plane, hue.c, alpha.c]) c.addEventListener("d-resize", () => update());
  const passes = (lch, back) =>
    map === "Off" ||
    (map.startsWith("APCA")
      ? Math.abs(apca(lch, back)) >= Number(map.slice(5))
      : contrast(lch, back) >= (map === "AA 4.5" ? 4.5 : 7));
  const surfaceRgb = () => {
    try {
      return rgb(parseColor(css("--d-surface", "#fbfbfc"), host));
    } catch {
      return [0.98, 0.98, 0.99];
    }
  };
  function drawPlane(v, back) {
    const key = [
        v[2].toFixed(2),
        planeMode,
        planeMode === "OKLab" ? v[0].toFixed(3) : "",
        map,
        background,
        space,
        css("--d-surface", ""),
      ].join("|"),
      g = plane.getContext("2d"),
      w = plane.width,
      h = plane.height;
    if (key !== cacheKey) {
      const img = rasterContext.createImageData(RW, RH),
        paper = surfaceRgb();
      for (let y = 0; y < RH; y++)
        for (let x = 0; x < RW; x++) {
          const lch =
            planeMode === "OKLCH"
              ? [1 - y / (RH - 1), (x / (RW - 1)) * CMAX, v[2], 1]
              : labToLch([v[0], (x / (RW - 1) - 0.5) * 0.8, (0.5 - y / (RH - 1)) * 0.8, 1]);
          const color = labToLinear(lchToLab(lch)).map(gamma),
            inside = inGamut(lch, space),
            pass = passes(lch, back),
            i = (y * RW + x) * 4;
          // Outside the gamut the colour fades into the paper; failing contrast fades further.
          const keep = !inside ? 0.22 : pass ? 1 : 0.4;
          for (let k = 0; k < 3; k++)
            img.data[i + k] = (clamp(color[k], 0, 1) * keep + paper[k] * (1 - keep)) * 255;
          img.data[i + 3] = 255;
        }
      rasterContext.putImageData(img, 0, 0);
      cacheKey = key;
    }
    g.clearRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.drawImage(raster, 0, 0, w, h);
    const font = getComputedStyle(plane).fontFamily || "sans-serif";
    g.font = `500 10.5px ${font}`;
    g.lineWidth = 1.25;
    // Gamut edges, labelled where they leave the top.
    for (const [name, label, dash] of [
      ["srgb", "sRGB", []],
      ["p3", "P3", [3, 3]],
    ]) {
      g.beginPath();
      let labelAt = null;
      if (planeMode === "OKLCH")
        for (let y = 0; y <= h; y += 2) {
          const L = 1 - y / h,
            x = Math.min(w, (gamutChroma(L, v[2], name) / CMAX) * w);
          y ? g.lineTo(x, y) : g.moveTo(x, y);
          if (!labelAt || x > labelAt[0]) labelAt = [x, y];
        }
      else
        for (let i = 0; i <= 180; i++) {
          const H = i * 2,
            C = gamutChroma(v[0], H, name),
            r = (H * Math.PI) / 180,
            x = ((C * Math.cos(r)) / 0.8 + 0.5) * w,
            y = (0.5 - (C * Math.sin(r)) / 0.8) * h;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
          if (i === 45) labelAt = [x, y];
        }
      g.setLineDash(dash);
      g.strokeStyle = "rgb(255 255 255 / .9)";
      g.stroke();
      g.setLineDash([]);
      if (labelAt) {
        g.fillStyle = css("--d-text", "#16181d");
        g.shadowColor = css("--d-surface", "#fff");
        g.shadowBlur = 4;
        g.textBaseline = "middle";
        const tx = Math.min(labelAt[0] + 8, w - 28);
        g.fillText(label, tx, labelAt[1] + (name === "p3" ? 8 : -8));
        g.shadowBlur = 0;
      }
    }
    // The contrast threshold, drawn as the line where text starts to pass.
    if (map !== "Off" && planeMode === "OKLCH") {
      g.beginPath();
      let started = false;
      for (let x = 0; x <= w; x += 4) {
        const C = (x / w) * CMAX;
        let prev = passes([1, C, v[2], 1], back),
          yHit = null;
        for (let y = 1; y <= h; y += 2) {
          const now = passes([1 - y / h, C, v[2], 1], back);
          if (now !== prev) {
            yHit = y;
            break;
          }
          prev = now;
        }
        if (yHit === null) continue;
        started ? g.lineTo(x, yHit) : g.moveTo(x, yHit);
        started = true;
      }
      g.strokeStyle = css("--d-text", "#111");
      g.lineWidth = 1.5;
      g.stroke();
    }
    // The point, with hairline guides back to its axes.
    const lab = lchToLab(v),
      x = planeMode === "OKLCH" ? (v[1] / CMAX) * w : (lab[1] / 0.8 + 0.5) * w,
      y = planeMode === "OKLCH" ? (1 - v[0]) * h : (0.5 - lab[2] / 0.8) * h;
    g.strokeStyle = "rgb(255 255 255 / .7)";
    g.lineWidth = 1;
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(x - 9, y);
    g.moveTo(x, y + 9);
    g.lineTo(x, h);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fillStyle = cssLch([v[0], v[1], v[2], 1]);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "#fff";
    g.stroke();
    g.beginPath();
    g.arc(x, y, 8.5, 0, Math.PI * 2);
    g.lineWidth = 1;
    g.strokeStyle = "rgb(0 0 0 / .45)";
    g.stroke();
    tagL.style.top = `${(y / h) * 100}%`;
    tagC.style.left = `${(x / w) * 100}%`;
    tagG.style.left = `${(x / w) * 100}%`;
    tagG.style.top = `${(y / h) * 100}%`;
    // An axis number under a moving readout steps aside.
    const clear = (spans, at, prop) =>
      [...spans].forEach((n) => {
        n.style.visibility =
          planeMode === "OKLCH" && Math.abs(parseFloat(n.style[prop]) - at) < 8 ? "hidden" : "";
      });
    clear(axisX.children, (x / w) * 100, "left");
    clear(axisY.children, (y / h) * 100, "top");
  }
  function drawStrips(v) {
    const H = hue.c.getContext("2d"),
      w = hue.c.width,
      h = hue.c.height;
    const hues = H.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 72; i++) {
      const hh = i * 5;
      hues.addColorStop(i / 72, cssLch([v[0], Math.min(v[1], gamutChroma(v[0], hh, space)), hh, 1]));
    }
    H.fillStyle = hues;
    H.fillRect(0, 0, w, h);
    const hx = (v[2] / 360) * w;
    H.fillStyle = "#fff";
    H.fillRect(hx - 1.5, 0, 3, h);
    H.fillStyle = "rgb(0 0 0 / .5)";
    H.fillRect(hx - 2.5, 0, 1, h);
    H.fillRect(hx + 1.5, 0, 1, h);
    const A = alpha.c.getContext("2d"),
      aw = alpha.c.width,
      ah = alpha.c.height;
    for (let x = 0; x < aw; x += 5)
      for (let y = 0; y < ah; y += 5) {
        A.fillStyle = (x / 5 + y / 5) % 2 ? "#c8cbd2" : "#ffffff";
        A.fillRect(x, y, 5, 5);
      }
    const grad = A.createLinearGradient(0, 0, aw, 0);
    grad.addColorStop(0, cssLch([v[0], v[1], v[2], 0]));
    grad.addColorStop(1, cssLch([v[0], v[1], v[2], 1]));
    A.fillStyle = grad;
    A.fillRect(0, 0, aw, ah);
    const ax = v[3] * aw;
    A.fillStyle = "#fff";
    A.fillRect(ax - 1.5, 0, 3, ah);
    A.fillStyle = "rgb(0 0 0 / .5)";
    A.fillRect(ax - 2.5, 0, 1, ah);
    A.fillRect(ax + 1.5, 0, 1, ah);
  }
  function draw() {
    frame = 0;
    if (dead || !visible(plane)) return;
    const v = parseColor(ctx.get(), ctx.host),
      back = parseColor(background, ctx.host);
    drawPlane(v, back);
    if (visible(hue.c)) drawStrips(v);
  }
  const apcaGrade = (n) =>
    n >= 75 ? "body" : n >= 60 ? "content" : n >= 45 ? "large" : n >= 30 ? "spot" : "fail";
  function update() {
    if (dead) return;
    // Nothing below is seen while the studio is collapsed or scrolled away; it runs once it comes into view.
    if (!visible(plane)) return;
    const value = ctx.get(),
      v = parseColor(value, ctx.host),
      back = parseColor(background, ctx.host),
      ratio = contrast(v, back),
      Lc = apca(v, back);
    channels.update();
    drawPairs(v);
    sample.style.background = background;
    sample.style.color = cssLch(v);
    sample.setAttribute(
      "aria-label",
      `${value} on ${background}. WCAG ratio ${ratio.toFixed(2)}; ${ratio >= 4.5 ? "passes" : "fails"} AA for small text.`,
    );
    wcag.b.textContent = `${ratio.toFixed(2)} : 1`;
    const wg = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "Fail";
    wcag.em.textContent = wg;
    wcag.em.dataset.pass = String(wg !== "Fail");
    lc.b.textContent = Math.abs(Lc).toFixed(1);
    lc.em.textContent = apcaGrade(Math.abs(Lc));
    lc.em.dataset.pass = String(Math.abs(Lc) >= 45);
    tagL.textContent = planeMode === "OKLCH" ? `${Math.round(v[0] * 100)}` : "";
    tagL.hidden = planeMode !== "OKLCH";
    tagC.textContent = planeMode === "OKLCH" ? v[1].toFixed(3) : "";
    tagC.hidden = planeMode !== "OKLCH";
    tagG.textContent = inGamut(v) ? "" : inGamut(v, "p3") ? "P3 only" : "Outside P3";
    tagG.hidden = !tagG.textContent;
    hue.out.value = `${Math.round(v[2])}°`;
    alpha.out.value = `${Math.round(v[3] * 100)}%`;
    hue.c.setAttribute("aria-valuenow", String(Math.round(v[2])));
    hue.c.setAttribute("aria-valuetext", `${Math.round(v[2])} degrees`);
    alpha.c.setAttribute("aria-valuenow", String(Math.round(v[3] * 100)));
    alpha.c.setAttribute("aria-valuetext", `${Math.round(v[3] * 100)} percent`);
    backChips.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === background)));
    const n = (x, d) => String(Number(x.toFixed(d))),
      a = v[3] < 1 ? ` / ${n(v[3], 2)}` : "",
      lab = lchToLab(v);
    code.value =
      format === "Hex"
        ? toHex(v)
        : format === "OKLab"
          ? `oklab(${n(lab[0], 3)} ${n(lab[1], 3)} ${n(lab[2], 3)}${a})`
          : format === "RGB"
            ? `rgb(${rgb(v)
                .map((x) => Math.round(clamp(x, 0, 1) * 255))
                .join(" ")}${a})`
            : `oklch(${n(v[0] * 100, 1)}% ${n(v[1], 3)} ${n(v[2], 1)}${a})`;
    updateSwatches(rampHost, "Ramp", ramp(v), (color) => ctx.set(color), (c, lch) => [
      lch ? `${Math.round(lch[0] * 100)}` : c,
      lch ? `${contrast(lch, back).toFixed(1)}` : "",
    ]);
    const offsets = {
      Complement: [0, 180],
      Analogous: [-30, 0, 30],
      Triad: [0, 120, 240],
      Split: [0, 150, 210],
    }[harmony];
    updateSwatches(
      harmonyHost,
      harmony,
      offsets.map((h) => {
        const H = (v[2] + h + 360) % 360;
        return [v[0], Math.min(v[1], gamutChroma(v[0], H)), H, 1];
      }),
      (color) => ctx.set(color),
      (c, lch) => [lch ? `${Math.round(lch[2])}°` : c, lch ? `C ${lch[1].toFixed(2)}` : ""],
    );
    if (!frame) frame = requestAnimationFrame(draw);
  }
  updateHistory();
  return {
    update,
    commit: onCommit,
    depth: () => requestAnimationFrame(() => update()),
    destroy: () => {
      dead = true;
      cancelAnimationFrame(frame);
    },
  };
}
// Which studio a control opens: a flagship lab for its type, a plugin's studio, or an
// instrument built from its type, figure and value (see instruments.js). Every control of
// every section gets one, so no studio tab is ever a placeholder.
const motionTypes = ["motion", "bezier", "spring", "keyframes"];
export function createStudio(panel, section, host, rail = document.createElement("div")) {
  const c = section.controls.find((x) => x.id === section.studioControl) || section.controls[0];
  if (!c) return {};
  host.dataset.studio = motionTypes.includes(c.type) ? "motion" : c.type;
  const cleanup = [];
  const ctx = {
    ...panel.context(c.id, c),
    panel,
    section,
    rail,
    surface: (node, handlers) => {
      cleanup.push(pointerSurface(node, handlers));
    },
  };
  let lab;
  if (c.type === "color") lab = colorStudio(ctx, host);
  else if (motionTypes.includes(c.type)) lab = motionLab(ctx, host);
  else if (c.type === "typography") lab = typeLab(ctx, host);
  else if (c.type === "image") lab = imageStudio(ctx, host);
  else if (c.type === "encoding") lab = dataLab(ctx, host);
  else if (c.type === "sampler") lab = samplerLab(ctx, host);
  else lab = instrument(ctx, host);
  const onValue = (e) => {
    if (e.detail.control === c.id && e.detail.phase === "commit") lab.commit?.();
  };
  panel.addEventListener("value", onValue);
  return {
    ...lab,
    destroy: () => {
      cleanup.forEach((dispose) => dispose());
      panel.removeEventListener("value", onValue);
      lab.destroy?.();
    },
  };
}
