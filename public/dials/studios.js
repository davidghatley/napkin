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
import { motionStudio as motionLab } from "./studio-motion.js";
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
      const L = (typeof color === "string" ? parseColor(color) : color)[0];
      b.style.setProperty("--ink", L > 0.68 ? "#16181d" : "#ffffff");
    } catch {}
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
    sampleSmall = el("p", { text: "Small text reads like this at twelve pixels." }),
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
  const channels = fields(channelCtx, [
    ["Lightness", "l", 0, 1, 0.001],
    ["Chroma", "c", 0, 0.5, 0.001],
    ["Hue", "h", 0, 360, 1, "deg"],
    ["Alpha", "a", 0, 1, 0.01],
  ]);
  channels.node.classList.add("d-cx-channels");
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
    channels.node,
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
    el("div", { class: "d-deep d-cx-strips" }, hue.node, alpha.node),
    ramps,
    harmonies,
  );
  host.append(el("div", { class: "d-cx" }, main, side));
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
function motionStudio(ctx, host) {
  const rawContext = ctx;
  ctx = {
    ...ctx,
    get: () => ({
      mode: ctx.control.type === "spring" ? "spring" : "bezier",
      bezier: [0.25, 0.1, 0.25, 1],
      duration: 1000,
      delay: 0,
      stiffness: 170,
      damping: 20,
      mass: 1,
      velocity: 0,
      range: [0, 1],
      ...rawContext.get(),
    }),
  };
  const css = (node, name, fallback) =>
    getComputedStyle(node).getPropertyValue(name).trim() || fallback;
  const sans = () => getComputedStyle(host).fontFamily || "sans-serif";
  // The curve is the studio: value up, time across, the delay drawn before it starts.
  const GW = 600,
    GH = 230,
    BASE = 0.84,
    SPAN = 0.62;
  const plot = canvas(
      "Motion curve. Drag a bezier handle to reshape it; the handle fields below hold the same numbers.",
      GW,
      GH,
      false,
    ),
    velocity = canvas("Velocity of the response over time, in change per second", GW, 48, false),
    ghost = canvas(
      "Ghost trail: where the moving element is at equal steps in time, now above and before below",
      GW,
      44,
      false,
    ),
    lanes = () => {
      const v = ctx.get();
      return [
        {
          id: "response",
          label: "Response",
          min: -0.5,
          max: 1.5,
          unit: "",
          keys: v.keyframes || [
            { time: 0, value: 0 },
            { time: 1, value: 1 },
          ],
        },
        ...laneControls.map((c) => {
          const now = ctx.panel.get(c.id);
          return {
            id: c.id,
            label: c.label || c.id,
            min: c.min ?? Math.min(0, now),
            max: c.max ?? Math.max(100, now),
            unit: c.unit || "",
            keys: v.tracks?.[c.id] || [
              { time: 0, value: now },
              { time: 1, value: now },
            ],
          };
        }),
      ];
    },
    laneControls = (ctx.section?.controls || []).filter(
      (c) => c.id !== ctx.control.id && ["number", "angle"].includes(c.type),
    ),
    timeline = canvas(
      "Timeline with a loop range and one lane of keys per instrument. Arrow keys move the playhead, [ and ] set the loop range, K adds a key.",
      600,
      24 + 56 * (1 + laneControls.length),
    ),
    track = el("input", {
      type: "range",
      min: 0,
      max: 1000,
      value: 0,
      "aria-label": "Timeline playhead",
    }),
    time = el("output", { class: "d-mx-time" });
  const ease = (v) => ({
    ...v,
    mode: "bezier",
    bezier: [0.25, 0.1, 0.25, 1],
    delay: 0,
  });
  const sameCurve = (p, q) =>
    JSON.stringify([p.mode, p.bezier, p.stiffness, p.damping, p.mass, p.velocity]) ===
    JSON.stringify([q.mode, q.bezier, q.stiffness, q.damping, q.mass, q.velocity]);
  // The ghost starts as the standard CSS ease (or linear when the response already is ease),
  // then follows the response as it was before your last edit until you pin one yourself.
  let reference = sameCurve(ease(ctx.get()), ctx.get())
      ? { ...ease(ctx.get()), bezier: [0, 0, 1, 1] }
      : ease(ctx.get()),
    pinned = false,
    lastCommitted = clone(ctx.get()),
    playhead = 0,
    playing = false,
    start = 0,
    raf = 0,
    dead = false,
    dragHandle = 0,
    exportTab = 0;
  const tag = (tone) => {
    const t = el("span", { class: "d-mx-tag", hidden: "" });
    if (tone) t.dataset.tone = tone;
    return t;
  };
  const tags = {
      settle: tag(),
      peak: tag(),
      delay: tag("muted"),
      ghost: tag("muted"),
      speed: tag("muted"),
    },
    ruler = el("div", { class: "d-mx-ruler", "aria-hidden": "true" }),
    graph = el(
      "div",
      { class: "d-mx-graph" },
      plot,
      el("div", { class: "d-mx-tags" }, tags.settle, tags.peak, tags.delay, tags.ghost),
    );
  const mode = choice(
    "Response",
    [
      { value: "bezier", text: "Bezier" },
      { value: "spring", text: "Spring" },
    ],
    (value) => ctx.set({ ...ctx.get(), mode: value }),
  );
  const presetCurves = {
    Ease: [0.25, 0.1, 0.25, 1],
    Swift: [0.2, 0.8, 0.2, 1],
    Linear: [0, 0, 1, 1],
    Overshoot: [0.3, 1.5, 0.6, 1],
  };
  const presetButtons = Object.entries(presetCurves).map(([label, bezier]) => {
    const pts = curvePoints({ mode: "bezier", bezier })
      .filter((_, i, a) => i % 4 === 0 || i === a.length - 1)
      .map(([x, y]) => `${(4 + x * 40).toFixed(1)},${(26 - y * 18).toFixed(1)}`)
      .join(" ");
    const b = button("", `${label} curve`, () => ctx.set({ ...ctx.get(), mode: "bezier", bezier }));
    b.innerHTML = `<svg viewBox="0 0 48 32" width="48" height="32" aria-hidden="true"><path d="M4 26H44M4 8H44" stroke="var(--d-line)" fill="none"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>${label}</span>`;
    b.dataset.curve = JSON.stringify(bezier);
    return b;
  });
  const presets = el("div", { class: "d-mx-presets d-deep" }, ...presetButtons);
  const numbers = fields(ctx, [
    ["Duration", "duration", 1, 60000, 1, "ms"],
    ["Delay", "delay", 0, 60000, 1, "ms"],
    ["Stiffness", "stiffness", 1, 2000, 1],
    ["Damping", "damping", 0.1, 200, 0.1],
    ["Mass", "mass", 0.01, 20, 0.01],
    ["Velocity", "velocity", -20, 20, 0.1],
  ]);
  const handles = fields(ctx, [
    ["Handle 1 x", ["bezier", 0], 0, 1, 0.01],
    ["Handle 1 y", ["bezier", 1], -3, 3, 0.01],
    ["Handle 2 x", ["bezier", 2], 0, 1, 0.01],
    ["Handle 2 y", ["bezier", 3], -3, 3, 0.01],
  ]);
  const playGlyph = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>',
    pauseGlyph = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor"/></svg>';
  const play = button("", "Play motion preview", () => {
    playing = !playing;
    play.innerHTML = playing ? pauseGlyph : playGlyph;
    play.setAttribute("aria-pressed", String(playing));
    if (playing) {
      const v = ctx.get(),
        [r0, r1] = v.range || [0, 1];
      if (playhead < r0 || playhead >= r1) playhead = r0;
      start = performance.now() - (playhead - r0) * ((v.duration || 1000) + (v.delay || 0));
      raf = requestAnimationFrame(tick);
    } else cancelAnimationFrame(raf);
  });
  play.classList.add("d-mx-play");
  play.innerHTML = playGlyph;
  play.setAttribute("aria-pressed", "false");
  const keyframes = el("div", { class: "d-keyframes" }),
    add = button("Add key", "Add keyframe at playhead", () => {
      const v = ctx.get(),
        frames = [
          ...(v.keyframes || [
            { time: 0, value: 0 },
            { time: 1, value: 1 },
          ]),
        ];
      frames.push({
        time: Number(playhead.toFixed(3)),
        value: Number(motionAt(playhead, v).toFixed(3)),
      });
      frames.sort((a, b) => a.time - b.time);
      ctx.set({ ...v, keyframes: frames });
    });
  const pin = button("Keep as before", "Keep the current response as the before ghost", () => {
    reference = clone(ctx.get());
    pinned = true;
    draw();
    renderCompare(ctx.get());
  });
  const rangeFields = fields(ctx, [
    ["Loop in", ["range", 0], 0, 1, 0.01],
    ["Loop out", ["range", 1], 0, 1, 0.01],
  ]);
  const compare = el("div", { class: "d-compare", role: "table", "aria-label": "Response measurements" });
  const applyTracks = button(
    "Apply at playhead",
    "Set the other instruments to their values at the playhead",
    () => {
      for (const lane of lanes().slice(1)) ctx.panel.transact(lane.id, keyframeAt(playhead, lane.keys));
    },
  );
  const readouts = el("output", { class: "d-note d-lane-values" });
  const exportSpecs = [
    ["CSS easing", (v) => toEasing(v)],
    ["CSS transition", (v) => toTransition(v)],
    [
      "Web Animations",
      (v) => {
        const tracks = {};
        for (const lane of lanes().slice(1))
          tracks[lane.id] = lane.keys.map((k) => ({ ...k, unit: lane.unit }));
        return toWaapi(v, v.tracks ? tracks : {}, "element");
      },
    ],
  ].map(([label, make]) => {
    const code = el("code", {
      class: "d-export",
      tabindex: 0,
      role: "group",
      "aria-label": label + " code",
    });
    const block = el("div", { class: "d-export-block" }, code);
    return { label, code, make, block };
  });
  const exportTabs = exportSpecs.map((x, i) => {
    const b = button(["Easing", "Transition", "WAAPI"][i], `Show ${x.label}`, () => {
      exportTab = i;
      paintExports();
    });
    return b;
  });
  const copy = button("Copy", "Copy the code shown", async () => {
    const text = exportSpecs[exportTab].code.textContent;
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select to copy";
    }
    setTimeout(() => (copy.textContent = "Copy"), 1400);
  });
  copy.classList.add("d-copy");
  const paintExports = () =>
    exportSpecs.forEach((x, i) => {
      x.block.hidden = i !== exportTab;
      exportTabs[i].setAttribute("aria-pressed", String(i === exportTab));
    });
  const outputs = el(
    "div",
    { class: "d-exports d-deep" },
    el("header", { class: "d-mx-export-tabs" }, ...exportTabs, copy),
    ...exportSpecs.map((x) => x.block),
  );
  paintExports();
  const section = (title, cls, extra, ...kids) =>
    el(
      "div",
      { class: `d-mx-section ${cls}` },
      el("header", {}, el("h3", { text: title }), ...(extra ? [extra] : [])),
      ...kids,
    );
  handles.node
    .querySelectorAll(".d-field > span")
    .forEach((n, i) => (n.textContent = ["x1", "y1", "x2", "y2"][i]));
  const bezierOnly = section("Handles", "d-deep", null, handles.node);
  const timelineWrap = el(
    "div",
    { class: "d-mx-timeline d-deep" },
    el("div", { class: "d-mx-caption" }, el("h3", { text: "Timeline" }), readouts, rangeFields.node),
    timeline,
    el("div", { class: "d-track" }, track),
  );
  rangeFields.node.classList.add("d-mx-loop");
  const main = el(
    "div",
    { class: "d-mx-main" },
    el(
      "div",
      { class: "d-mx-graph-wrap" },
      graph,
      ruler,
      el("div", { class: "d-mx-band" }, velocity, tags.speed),
      el("div", { class: "d-mx-band" }, ghost),
    ),
    timelineWrap,
    outputs,
  );
  const keyHead = el(
    "div",
    { class: "d-keyframes-head", "aria-hidden": "true" },
    el("i"),
    el("span", { text: "Time" }),
    el("span", { text: "Value" }),
    el("i"),
  );
  const side = el(
    "div",
    { class: "d-mx-side" },
    el("div", { class: "d-mx-bar d-deep" }, play, time, mode),
    presets,
    section("Timing", "d-mx-numbers", null, numbers.node),
    section("Measured", "d-deep d-mx-measured", pin, compare),
    bezierOnly,
    section("Keys", "d-deep", el("div", { class: "d-mx-keyacts" }, add, applyTracks), keyHead, keyframes),
  );
  host.append(el("div", { class: "d-mx" }, main, side));
  track.addEventListener("input", () => {
    playhead = Number(track.value) / 1000;
    draw();
  });
  const delayOf = (m) => (m.delay || 0) / ((m.duration || 1000) + (m.delay || 0));
  ctx.surface(plot, {
    start: (e) => {
      if (ctx.get().mode === "spring") return;
      ctx.begin("bezier-handle");
      const v = ctx.get(),
        r = plot.getBoundingClientRect(),
        x = (e.clientX - r.left) / r.width,
        y = (e.clientY - r.top) / r.height,
        p = v.bezier,
        d0 = delayOf(v),
        hx = (n) => d0 + (1 - d0) * n;
      dragHandle =
        Math.hypot(x - hx(p[0]), y - (BASE - p[1] * SPAN)) <
        Math.hypot(x - hx(p[2]), y - (BASE - p[3] * SPAN))
          ? 0
          : 2;
    },
    move: (e) => {
      if (ctx.get().mode === "spring") return;
      const r = plot.getBoundingClientRect(),
        v = ctx.get(),
        d1 = delayOf(v);
      v.bezier[dragHandle] = Number(
        clamp(((e.clientX - r.left) / r.width - d1) / (1 - d1), 0, 1).toFixed(3),
      );
      v.bezier[dragHandle + 1] = Number(
        clamp((BASE - (e.clientY - r.top) / r.height) / SPAN, -3, 3).toFixed(3),
      );
      ctx.change(v);
    },
    end: () => ctx.commit(),
    cancel: () => ctx.cancel(),
  });
  for (const cv of [plot, ghost, velocity, timeline]) cv.addEventListener("d-resize", () => draw());
  function tick(now) {
    if (dead || !playing) return;
    const v = ctx.get(),
      total = (v.duration || 1000) + (v.delay || 0),
      [r0, r1] = v.range || [0, 1],
      span = Math.max(0.01, r1 - r0);
    playhead = r0 + (((now - start) / total) % span);
    track.value = playhead * 1000;
    draw();
    raf = requestAnimationFrame(tick);
  }
  const place = (t, x, y, text) => {
    t.hidden = !text;
    if (!text) return;
    t.textContent = text;
    t.style.left = `${x * 100}%`;
    t.style.top = `${y * 100}%`;
  };
  function draw() {
    if (dead) return;
    const v = ctx.get(),
      g = plot.getContext("2d"),
      w = plot.width,
      h = plot.height,
      a = accent(host),
      line = css(plot, "--d-line", "#e3e5ea"),
      rule = css(plot, "--d-rule", "#c9cdd6"),
      muted = css(plot, "--d-muted", "#4f5663"),
      faint = css(plot, "--d-faint", "#626a79"),
      text = css(plot, "--d-text", "#1c1f27"),
      surface = css(plot, "--d-surface", "#fbfbfc"),
      font = sans(),
      total = (v.duration || 1000) + (v.delay || 0);
    g.clearRect(0, 0, w, h);
    const Y = (y) => h * (BASE - y * SPAN),
      xyFor = (m) => ([x, y]) => [(delayOf(m) + (1 - delayOf(m)) * x) * w, Y(y)],
      xy = xyFor(v),
      d = delayOf(v);
    // Quiet scaffolding: tenths of the time span, and the start and end values.
    g.lineWidth = 1;
    g.strokeStyle = line;
    g.beginPath();
    for (let i = 1; i < 10; i++) {
      const x = Math.round((i * w) / 10) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    g.stroke();
    g.strokeStyle = rule;
    g.beginPath();
    g.moveTo(0, Math.round(Y(0)) + 0.5);
    g.lineTo(w, Math.round(Y(0)) + 0.5);
    g.moveTo(0, Math.round(Y(1)) + 0.5);
    g.lineTo(w, Math.round(Y(1)) + 0.5);
    g.stroke();
    g.font = `500 10.5px ${font}`;
    g.fillStyle = faint;
    g.textBaseline = "bottom";
    g.textAlign = "right";
    if (plot.clientWidth > 420) {
      g.fillText("end", w - 4, Y(1) - 3);
      g.fillText("start", w - 4, Y(0) - 3);
    }
    if (d) {
      g.fillStyle = a;
      g.globalAlpha = 0.07;
      g.fillRect(0, 0, d * w, h);
      g.globalAlpha = 1;
    }
    // Before: dashed, in the muted ink.
    g.beginPath();
    if (delayOf(reference)) g.moveTo(0, Y(0));
    curvePoints(reference).forEach((p, i) => {
      const [x, y] = xyFor(reference)(p);
      i || delayOf(reference) ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = muted;
    g.globalAlpha = 0.7;
    g.lineWidth = 1.25;
    g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    // Now: the response itself.
    const pts = curvePoints(v);
    g.beginPath();
    if (d) g.moveTo(0, Y(0));
    pts.forEach((p, i) => {
      const [x, y] = xy(p);
      i || d ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = a;
    g.lineWidth = 2.25;
    g.lineJoin = "round";
    g.stroke();
    if (v.mode !== "spring") {
      const p = v.bezier || [0.25, 0.1, 0.25, 1];
      g.beginPath();
      g.moveTo(...xy([0, 0]));
      g.lineTo(...xy([p[0], p[1]]));
      g.moveTo(...xy([1, 1]));
      g.lineTo(...xy([p[2], p[3]]));
      g.strokeStyle = text;
      g.lineWidth = 1;
      g.stroke();
      for (let i = 0; i < 4; i += 2) {
        g.beginPath();
        g.arc(...xy([p[i], p[i + 1]]), 5.5, 0, Math.PI * 2);
        g.fillStyle = surface;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = text;
        g.stroke();
      }
    }
    // Measurements drawn where they happen.
    const m = analyze(v),
      at = (ms) => d + (1 - d) * clamp(ms / (v.duration || 1000), 0, 1);
    if (Number.isFinite(m.settleMs)) {
      const sx = at(m.settleMs) * w;
      g.strokeStyle = text;
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(Math.round(sx) + 0.5, Y(1));
      g.lineTo(Math.round(sx) + 0.5, h);
      g.stroke();
      g.setLineDash([]);
      place(
        tags.settle,
        clamp(at(m.settleMs), 0.06, 0.94),
        0.97,
        m.fits ? `settles ${m.settleMs} ms` : `settles ${m.settleMs} ms, past the end`,
      );
    } else place(tags.settle, 0.9, 0.97, "never settles");
    if (m.overshoot >= 0.5) {
      const px = at(m.peakMs),
        py = Y(1 + m.overshoot / 100);
      g.beginPath();
      g.arc(px * w, py, 3.5, 0, Math.PI * 2);
      g.fillStyle = a;
      g.fill();
      place(tags.peak, clamp(px, 0.06, 0.94), py / h, `+${m.overshoot.toFixed(1)}%`);
    } else place(tags.peak, 0, 0, "");
    place(tags.delay, 0, 0.02, d ? `waits ${v.delay} ms` : "");
    place(tags.ghost, 0.5, 0.02, "");
    // Playhead with the value it reads.
    const t = clamp((playhead - d) / (1 - d), 0, 1),
      value = motionAt(t, v),
      key = keyframeAt(t, v.keyframes),
      phx = playhead * w;
    g.fillStyle = text;
    g.fillRect(Math.round(phx) - 0.5, 0, 1, h);
    g.beginPath();
    g.arc(phx, Y(value), 4, 0, Math.PI * 2);
    g.fillStyle = text;
    g.fill();
    ruler.replaceChildren(
      ...[0, 0.25, 0.5, 0.75, 1].map((f) =>
        el("span", { text: `${Math.round(f * total)}${f === 1 ? " ms" : ""}`, style: `left:${f * 100}%` }),
      ),
    );
    drawVelocity(v);
    drawGhost(v, t);
    drawTimeline(v);
    time.replaceChildren(
      `${Math.round(playhead * total)}`,
      el("small", { text: `of ${total} ms` }),
    );
    time.setAttribute(
      "aria-label",
      `${Math.round(playhead * total)} of ${total} ms; response ${value.toFixed(3)}, keyframe ${key.toFixed(3)}`,
    );
  }
  function drawVelocity(v) {
    const g = velocity.getContext("2d"),
      w = velocity.width,
      h = velocity.height,
      a = accent(host),
      N = 160,
      seconds = (v.duration || 1000) / 1000,
      sample = Array.from({ length: N + 1 }, (_, i) =>
        i ? ((motionAt(i / N, v) - motionAt((i - 1) / N, v)) * N) / seconds : 0,
      ),
      peak = Math.max(0.001, ...sample.map(Math.abs)),
      d = delayOf(v),
      X = (i) => (d + (1 - d) * (i / N)) * w,
      mid = h * 0.7;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = css(velocity, "--d-rule", "#c9cdd6");
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, Math.round(mid) + 0.5);
    g.lineTo(w, Math.round(mid) + 0.5);
    g.stroke();
    g.beginPath();
    g.moveTo(X(0), mid);
    sample.forEach((n, i) => g.lineTo(X(i), mid - (n / peak) * (h * 0.62)));
    g.lineTo(X(N), mid);
    g.closePath();
    g.fillStyle = a;
    g.globalAlpha = 0.16;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = a;
    g.lineWidth = 1.25;
    g.stroke();
    g.font = `500 10.5px ${sans()}`;
    g.fillStyle = css(velocity, "--d-faint", "#626a79");
    g.textBaseline = "top";
    g.textAlign = "right";
    g.fillText(`speed, peak ${peak.toFixed(1)} per second`, w - 4, h - 10);
  }
  // Spacing: the element's position at equal steps in time, like an animator's spacing chart.
  function drawGhost(v, t) {
    const g = ghost.getContext("2d"),
      w = ghost.width,
      h = ghost.height,
      a = accent(host),
      muted = css(ghost, "--d-muted", "#4f5663"),
      text = css(ghost, "--d-text", "#1c1f27"),
      N = 24,
      X = (p) => 56 + clamp(p, -0.1, 1.2) * (w - 80);
    g.clearRect(0, 0, w, h);
    g.font = `500 10.5px ${sans()}`;
    g.textBaseline = "middle";
    for (const [m, y, color, label] of [
      [v, 13, a, "now"],
      [reference, 33, muted, "before"],
    ]) {
      g.strokeStyle = css(ghost, "--d-line", "#e3e5ea");
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(X(0), y + 0.5);
      g.lineTo(X(1), y + 0.5);
      g.stroke();
      g.fillStyle = color;
      for (let i = 0; i <= N; i++) {
        g.fillRect(Math.round(X(motionAt(i / N, m))) - 0.5, y - 5, 1.5, 11);
      }
      g.textAlign = "left";
      g.fillStyle = color;
      g.fillText(label, 2, y);
    }
    g.beginPath();
    g.arc(X(motionAt(t, v)), 13, 4.5, 0, Math.PI * 2);
    g.fillStyle = text;
    g.fill();
  }
  const W = 600,
    RULER = 24,
    LANE = 56,
    PAD = 12;
  const tx = (t) => PAD + t * (W - 2 * PAD),
    xt = (x) => clamp((x - PAD) / (W - 2 * PAD), 0, 1);
  const laneY = (i) => RULER + i * LANE;
  const laneValueY = (lane, i, value) =>
    laneY(i) + LANE - 9 - clamp((value - lane.min) / (lane.max - lane.min || 1), 0, 1) * (LANE - 21);
  function drawTimeline(v) {
    const g = timeline.getContext("2d"),
      H = timeline.height,
      a = accent(host),
      muted = css(timeline, "--d-muted", "#4f5663"),
      faint = css(timeline, "--d-faint", "#626a79"),
      line = css(timeline, "--d-line", "#e3e5ea"),
      text = css(timeline, "--d-text", "#1c1f27"),
      surface = css(timeline, "--d-surface", "#fbfbfc"),
      total = (v.duration || 1000) + (v.delay || 0),
      [r0, r1] = v.range || [0, 1],
      list = lanes(),
      font = sans();
    g.clearRect(0, 0, W, H);
    g.textBaseline = "middle";
    // Outside the loop the lanes dim; inside they keep full ink.
    g.fillStyle = css(timeline, "--d-well", "#f3f4f6");
    g.fillRect(0, RULER, tx(r0), H - RULER);
    g.fillRect(tx(r1), RULER, W - tx(r1), H - RULER);
    g.fillStyle = a;
    g.globalAlpha = 0.14;
    g.fillRect(tx(r0), 15, tx(r1) - tx(r0), 5);
    g.globalAlpha = 1;
    g.strokeStyle = line;
    g.lineWidth = 1;
    for (let i = 0; i <= 20; i++) {
      const x = Math.round(tx(i / 20)) + 0.5;
      g.beginPath();
      g.moveTo(x, i % 10 === 0 ? 4 : i % 2 ? 19 : 14);
      g.lineTo(x, RULER);
      g.stroke();
    }
    g.font = `500 10px ${font}`;
    g.fillStyle = faint;
    for (let i = 0; i <= 4; i++) {
      const x = tx(i / 4);
      g.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
      g.fillText(`${Math.round((i / 4) * total)}`, x + (i === 0 ? 4 : i === 4 ? -4 : 0), 7);
    }
    g.fillStyle = a;
    for (const [t, dir] of [
      [r0, 1],
      [r1, -1],
    ]) {
      g.beginPath();
      g.moveTo(tx(t), 21);
      g.lineTo(tx(t) + dir * 7, 21);
      g.lineTo(tx(t), 13);
      g.closePath();
      g.fill();
    }
    list.forEach((lane, i) => {
      const top = laneY(i);
      g.strokeStyle = line;
      g.beginPath();
      g.moveTo(0, top + 0.5);
      g.lineTo(W, top + 0.5);
      g.stroke();
      g.font = `600 10.5px ${font}`;
      g.fillStyle = muted;
      g.textAlign = "left";
      g.fillText(lane.label, PAD + 10, top + 10);
      const sorted = [...lane.keys].sort((p, q) => p.time - q.time);
      g.beginPath();
      for (let k = 0; k <= 96; k++) {
        const t = k / 96,
          y = laneValueY(lane, i, keyframeAt(t, sorted));
        k ? g.lineTo(tx(t), y) : g.moveTo(tx(t), y);
      }
      g.strokeStyle = a;
      g.globalAlpha = 0.55;
      g.lineWidth = 1.25;
      g.stroke();
      g.globalAlpha = 1;
      for (const k of lane.keys) {
        const x = tx(k.time),
          y = laneValueY(lane, i, k.value);
        g.beginPath();
        g.moveTo(x, y - 5.5);
        g.lineTo(x + 5.5, y);
        g.lineTo(x, y + 5.5);
        g.lineTo(x - 5.5, y);
        g.closePath();
        g.fillStyle = surface;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = text;
        g.stroke();
      }
    });
    // Playhead: a small flag on the ruler and a hairline through the lanes.
    const px = tx(playhead);
    g.fillStyle = text;
    g.fillRect(Math.round(px) - 0.5, RULER - 6, 1, H);
    g.beginPath();
    g.moveTo(px - 5, RULER - 12);
    g.lineTo(px + 5, RULER - 12);
    g.lineTo(px + 5, RULER - 7);
    g.lineTo(px, RULER - 3);
    g.lineTo(px - 5, RULER - 7);
    g.closePath();
    g.fill();
  }
  function hit(e) {
    const r = timeline.getBoundingClientRect(),
      x = ((e.clientX - r.left) / r.width) * W,
      y = ((e.clientY - r.top) / r.height) * timeline.height,
      v = ctx.get(),
      [r0, r1] = v.range || [0, 1];
    if (y < RULER) {
      if (Math.abs(x - tx(r0)) < 9 && Math.abs(x - tx(r0)) <= Math.abs(x - tx(r1)))
        return { kind: "range", index: 0, x, y };
      if (Math.abs(x - tx(r1)) < 9) return { kind: "range", index: 1, x, y };
      return { kind: "scrub", x, y };
    }
    const i = clamp(Math.floor((y - RULER) / LANE), 0, laneControls.length),
      lane = lanes()[i];
    let best = -1,
      bestD = 15;
    lane.keys.forEach((k, j) => {
      const dist = Math.hypot(tx(k.time) - x, laneValueY(lane, i, k.value) - y);
      if (dist < bestD) {
        best = j;
        bestD = dist;
      }
    });
    return best >= 0 ? { kind: "key", lane: i, index: best, x, y } : { kind: "scrub", lane: i, x, y };
  }
  let gesture = null;
  ctx.surface(timeline, {
    start: (e) => {
      gesture = hit(e);
      if (gesture.kind !== "scrub") ctx.begin("timeline-" + gesture.kind);
    },
    move: (e) => {
      if (!gesture) return;
      const r = timeline.getBoundingClientRect(),
        x = ((e.clientX - r.left) / r.width) * W,
        y = ((e.clientY - r.top) / r.height) * timeline.height,
        v = ctx.get();
      if (gesture.kind === "scrub") {
        playhead = xt(x);
        track.value = playhead * 1000;
        draw();
      } else if (gesture.kind === "range") {
        const range = [...(v.range || [0, 1])],
          t = Number(xt(x).toFixed(3));
        range[gesture.index] = gesture.index ? Math.max(t, range[0] + 0.02) : Math.min(t, range[1] - 0.02);
        ctx.change({ ...v, range });
      } else {
        const lane = lanes()[gesture.lane],
          keys = clone(lane.keys),
          key = keys[gesture.index],
          norm = clamp(1 - (y - laneY(gesture.lane) - 12) / (LANE - 21), 0, 1);
        key.time = Number(xt(x).toFixed(3));
        key.value = Number((lane.min + norm * (lane.max - lane.min)).toFixed(3));
        ctx.change(laneWrite(lane, keys, v));
      }
    },
    end: () => {
      if (gesture && gesture.kind === "key") {
        const lane = lanes()[gesture.lane],
          keys = clone(lane.keys).sort((p, q) => p.time - q.time);
        ctx.change(laneWrite(lane, keys, ctx.get()));
      }
      if (gesture && gesture.kind !== "scrub") ctx.commit();
      gesture = null;
    },
    cancel: () => {
      if (gesture && gesture.kind !== "scrub") ctx.cancel();
      gesture = null;
    },
  });
  const laneWrite = (lane, keys, v) =>
    lane.id === "response"
      ? { ...v, keyframes: keys }
      : { ...v, tracks: { ...(v.tracks || {}), [lane.id]: keys } };
  timeline.addEventListener("dblclick", (e) => {
    const h = hit(e);
    if (h.lane === undefined && h.kind !== "key") return;
    const lane = lanes()[h.lane];
    if (h.kind === "key") {
      if (lane.keys.length > 2)
        ctx.set(laneWrite(lane, lane.keys.filter((_, j) => j !== h.index), ctx.get()));
      return;
    }
    addKey(h.lane, xt(h.x));
  });
  function addKey(laneIndex, t) {
    const lane = lanes()[laneIndex],
      v = ctx.get(),
      value = laneIndex === 0 ? motionAt(t, v) : keyframeAt(t, lane.keys),
      keys = [...lane.keys, { time: Number(t.toFixed(3)), value: Number(value.toFixed(3)) }].sort(
        (p, q) => p.time - q.time,
      );
    ctx.set(laneWrite(lane, keys, v));
  }
  timeline.addEventListener("keydown", (e) => {
    const v = ctx.get(),
      step = e.shiftKey ? 0.1 : 0.01;
    let handled = true;
    if (e.key === "ArrowLeft") playhead = clamp(playhead - step, 0, 1);
    else if (e.key === "ArrowRight") playhead = clamp(playhead + step, 0, 1);
    else if (e.key === "Home") playhead = 0;
    else if (e.key === "End") playhead = 1;
    else if (e.key === "[") ctx.set({ ...v, range: [Math.min(playhead, v.range[1] - 0.02), v.range[1]] });
    else if (e.key === "]") ctx.set({ ...v, range: [v.range[0], Math.max(playhead, v.range[0] + 0.02)] });
    else if (e.key === "\\") ctx.set({ ...v, range: [0, 1] });
    else if (e.key.toLowerCase() === "k") addKey(0, playhead);
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    track.value = playhead * 1000;
    draw();
  });
  const fmt = (ms) => (Number.isFinite(ms) ? `${ms} ms` : "never");
  function renderCompare(v) {
    const now = analyze(v),
      before = analyze(reference),
      rows = [
        ["Settle", fmt(now.settleMs), fmt(before.settleMs)],
        ["Overshoot", `${now.overshoot.toFixed(1)}%`, `${before.overshoot.toFixed(1)}%`],
        ["Peak at", fmt(now.peakMs), fmt(before.peakMs)],
        ["Fits duration", now.fits ? "yes" : `no, ${fmt(now.settleMs)}`, before.fits ? "yes" : "no"],
      ];
    compare.replaceChildren(
      el(
        "div",
        { class: "d-compare-row d-compare-title", role: "row" },
        el("span", { role: "columnheader", text: "Measure" }),
        el("span", { role: "columnheader", text: "Now" }),
        el("span", { role: "columnheader", text: "Before" }),
      ),
      ...rows.map(([k, a, b]) =>
        el(
          "div",
          { class: "d-compare-row", role: "row" },
          el("span", { role: "rowheader", text: k }),
          el("strong", { role: "cell", text: a }),
          el("span", { role: "cell", text: b }),
        ),
      ),
    );
  }
  let lastKeys = "";
  function update() {
    if (dead) return;
    const v = ctx.get();
    mode.querySelector(".d-choice").value = v.mode || "bezier";
    for (const b of presetButtons)
      b.setAttribute(
        "aria-pressed",
        String(v.mode !== "spring" && b.dataset.curve === JSON.stringify(v.bezier)),
      );
    numbers.update();
    handles.update();
    rangeFields.update();
    bezierOnly.hidden = v.mode === "spring";
    const spring = v.mode === "spring";
    numbers.node.querySelectorAll(".d-field").forEach((f, i) => {
      f.dataset.inactive = String(spring ? i === 0 : i >= 2);
    });
    const ks = JSON.stringify(v.keyframes);
    if (ks !== lastKeys) {
      lastKeys = ks;
      const frames = v.keyframes || [
        { time: 0, value: 0 },
        { time: 1, value: 1 },
      ];
      if (keyframes.children.length === frames.length) {
        frames.forEach((f, i) => {
          const inputs = keyframes.children[i].querySelectorAll("input");
          if (inputs[0] !== document.activeElement) inputs[0].value = f.time;
          if (inputs[1] !== document.activeElement) inputs[1].value = f.value;
        });
      } else {
        keyframes.replaceChildren();
        frames.forEach((f, i) => {
          const timeInput = el("input", {
              type: "text",
              inputmode: "decimal",
              value: f.time,
              "aria-label": `Key ${i + 1} time`,
            }),
            valueInput = el("input", {
              type: "text",
              inputmode: "decimal",
              value: f.value,
              "aria-label": `Key ${i + 1} value`,
            });
          for (const [input, key] of [
            [timeInput, "time"],
            [valueInput, "value"],
          ]) {
            input.addEventListener("focus", () => ctx.begin("keyframe"));
            input.addEventListener("blur", () => ctx.commit());
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                ctx.commit();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                ctx.cancel();
                input.value = ctx.get().keyframes[i][key];
                input.blur();
              }
            });
            input.addEventListener("input", () => {
              const list = clone(
                  ctx.get().keyframes || [
                    { time: 0, value: 0 },
                    { time: 1, value: 1 },
                  ],
                ),
                n = Number(input.value);
              if (!input.value.trim() || !Number.isFinite(n)) return;
              list[i][key] = key === "time" ? clamp(n, 0, 1) : n;
              ctx.change({ ...ctx.get(), keyframes: list });
            });
          }
          const go = button("", `Scrub to key ${i + 1}`, () => {
            playhead = ctx.get().keyframes?.[i]?.time ?? f.time;
            track.value = playhead * 1000;
            draw();
          });
          go.innerHTML =
            '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
          const remove = button("", `Remove key ${i + 1}`, () =>
            ctx.set({
              ...ctx.get(),
              keyframes: (ctx.get().keyframes || []).filter((_, j) => j !== i),
            }),
          );
          remove.innerHTML =
            '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4"/></svg>';
          keyframes.append(el("div", { class: "d-key" }, go, timeInput, valueInput, remove));
        });
      }
    }
    for (const x of exportSpecs) x.code.textContent = x.make(v);
    renderCompare(v);
    readouts.value = lanes()
      .slice(1)
      .map((l) => `${l.label} ${Number(keyframeAt(playhead, l.keys).toFixed(2))}${l.unit}`)
      .join("   ");
    draw();
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
    stop = () => {
      play.disabled = reduced.matches;
      if (reduced.matches) {
        playing = false;
        cancelAnimationFrame(raf);
        play.innerHTML = playGlyph;
        playhead = 1;
        track.value = 1000;
        draw();
      }
    };
  reduced.addEventListener("change", stop);
  if (reduced.matches) {
    play.disabled = true;
    play.title = "Preview is still under reduced motion";
    playhead = 1;
  }
  return {
    update,
    commit() {
      const now = clone(ctx.get());
      if (
        !pinned &&
        (!sameCurve(now, lastCommitted) ||
          now.delay !== lastCommitted.delay ||
          now.duration !== lastCommitted.duration)
      ) {
        reference = lastCommitted;
        renderCompare(now);
        draw();
      }
      lastCommitted = now;
    },
    destroy: () => {
      dead = true;
      cancelAnimationFrame(raf);
      reduced.removeEventListener("change", stop);
    },
  };
}
function typeStudio(ctx, host) {
  host.append(heading("Type specimen"));
  const specimen = el("div", {
      class: "d-type-specimen",
      contenteditable: "true",
      role: "textbox",
      "aria-label": "Live type specimen",
      spellcheck: false,
    }),
    measure = el("output", { class: "d-note" });
  const typeContext = {
    ...ctx,
    change: (v) => {
      if (v.weight !== ctx.get().weight && v.axes?.wght !== undefined)
        v.axes = { ...v.axes, wght: v.weight };
      ctx.change(v);
    },
  };
  const nums = fields(typeContext, [
    ["Size", "size", 6, 240, 1, "px"],
    ["Weight", "weight", 100, 1000, 10],
    ["Tracking", "tracking", -10, 30, 0.1, "px"],
    ["Line height", "lineHeight", 0.5, 3, 0.05],
  ], { sliders: true });
  const axisDefinitions = (ctx.control.axes || []).length
    ? ctx.control.axes
    : [{ tag: "wght", label: "Weight", min: 100, max: 900, default: 400 }];
  const axisCtx = {
    ...ctx,
    get: () => ({
      ...Object.fromEntries(axisDefinitions.map((a) => [a.tag, a.default])),
      ...(ctx.get().weight !== undefined ? { wght: ctx.get().weight } : {}),
      ...ctx.get().axes,
    }),
    change: (axes) =>
      ctx.change({
        ...ctx.get(),
        axes,
        ...(axes.wght !== undefined ? { weight: axes.wght } : {}),
      }),
  };
  const axes = fields(
    axisCtx,
    axisDefinitions.filter((a) => a.tag !== "wght").map((a) => [
      a.label || a.tag,
      a.tag,
      a.min,
      a.max,
      a.step || 1,
    ]),
    { sliders: true },
  );
  const family = el("input", {
    type: "text",
    "aria-label": "Font family",
    value: ctx.get().family || "system-ui",
  });
  family.addEventListener("change", () =>
    ctx.set({ ...ctx.get(), family: family.value }),
  );
  specimen.addEventListener("focus", () => ctx.begin("specimen"));
  specimen.addEventListener("input", () =>
    ctx.change({ ...ctx.get(), text: specimen.textContent }),
  );
  specimen.addEventListener("blur", () => ctx.commit());
  specimen.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      ctx.cancel();
      specimen.textContent = ctx.get().text || "";
      specimen.blur();
    }
  });
  const glyphs = el("div", { class: "d-glyphs", "aria-hidden": "true" }),
    waterfall = el("div", { class: "d-waterfall", "aria-hidden": "true" }),
    strips = el("div", { class: "d-type-side" });
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&@#?!%")
    glyphs.append(el("span", { text: ch }));
  const lines = [12, 16, 24, 36, 56].map((n) =>
    el("div", {}, el("small", { text: `${n}` }), el("span", { text: n > 40 ? "Sphinx of black" : n > 30 ? "Sphinx of black quartz" : "Sphinx of black quartz, judge my vow" })),
  );
  lines.forEach((l, i) => (l.lastChild.style.fontSize = `${[12, 16, 24, 36, 56][i]}px`));
  waterfall.append(...lines);
  const stripHosts = axisDefinitions.map((a) => {
    const row = el("div", { class: "d-axis-strip", role: "group", "aria-label": `${a.label || a.tag} across its range` }),
      stops = Array.from({ length: 7 }, (_, i) => Math.round(a.min + ((a.max - a.min) * i) / 6));
    const tiles = stops.map((n) => {
      const tile = el("button", { type: "button", "aria-pressed": "false", "aria-label": `${a.label || a.tag} ${n}` },
        el("span", { text: "Ag" }), el("small", { text: String(n) }));
      tile.firstChild.style.fontVariationSettings = `"${a.tag}" ${n}`;
      if (a.tag === "wght") tile.firstChild.style.fontWeight = n;
      tile.addEventListener("click", () => axisCtx.change({ ...axisCtx.get(), [a.tag]: n }));
      row.append(tile);
      return [tile, n];
    });
    strips.append(el("div", {}, el("h4", { text: `${a.label || a.tag} across its range` }), row));
    return { a, tiles };
  });
  const lab = el(
    "div",
    { class: "d-type-lab" },
    specimen,
    el("div", {}, el("h4", { text: "Size ladder" }), waterfall),
  );
  strips.append(el("div", {}, el("h4", { text: "Character set" }), glyphs));
  host.append(
    lab,
    measure,
    nums.node,
    el(
      "div",
      { class: "d-studio-only" },
      heading("Axes"),
      el("label", { class: "d-tool" }, el("span", { text: "Family" }), family),
      axes.node,
    ),
    strips,
  );
  return {
    update() {
      const v = ctx.get();
      if (document.activeElement !== specimen || !ctx.isEditing())
        specimen.textContent = v.text || "The shape of\nthings to come.";
      specimen.style.fontFamily = v.family || "system-ui";
      specimen.style.fontSize = `${v.size || 32}px`;
      specimen.style.fontWeight = v.weight || 400;
      specimen.style.letterSpacing = `${v.tracking || 0}px`;
      const settings = Object.entries(v.axes || {})
        .map(([tag, n]) => `"${tag.replace(/[^\w]/g, "")}" ${Number(n)}`)
        .join(",");
      for (const face of [glyphs, waterfall]) {
        face.style.fontFamily = specimen.style.fontFamily;
        face.style.fontWeight = specimen.style.fontWeight;
        face.style.letterSpacing = `${v.tracking || 0}px`;
        face.style.fontVariationSettings = settings;
      }
      for (const { a, tiles } of stripHosts) {
        const cur = (v.axes || {})[a.tag] ?? (a.tag === "wght" ? v.weight : a.default);
        let best = tiles[0];
        for (const t of tiles) if (Math.abs(t[1] - cur) < Math.abs(best[1] - cur)) best = t;
        for (const t of tiles) {
          t[0].setAttribute("aria-pressed", String(t === best));
          t[0].firstChild.style.fontFamily = specimen.style.fontFamily;
        }
      }
      specimen.style.lineHeight = v.lineHeight || 1.2;
      specimen.style.fontVariationSettings = Object.entries(v.axes || {})
        .map(([tag, n]) => `"${tag.replace(/[^\w]/g, "")}" ${Number(n)}`)
        .join(",");
      measure.value = `${v.size}px · ${v.weight} weight · ${(v.size * (v.lineHeight || 1.2)).toFixed(1)}px leading`;
      nums.update();
      axes.update();
    },
  };
}
function encodingStudio(ctx, host) {
  host.append(
    heading("Encoding shelf"),
  );
  const plot = canvas(
      "Chart preview from the selected field encodings",
      600,
      340,
      false,
    ),
    shelf = el("div", { class: "d-encoding" }),
    table = el("div", { class: "d-data-table", role: "table", "aria-label": "Source rows" }),
    tableNote = el("output", { class: "d-note" }),
    legend = el("div", { class: "d-legend" }),
    data = ctx.control.data || [],
    fieldsList = ctx.control.fields || Object.keys(data[0] || {}),
    selects = [];
  for (const channel of ["x", "y", "color", "size"]) {
    const select = choiceBox(
      `${channel} field`,
      fieldsList.map((f) => (typeof f === "object" ? f.name : f)),
      (value) => ctx.set({ ...ctx.get(), [channel]: value }),
      { none: "None" },
    );
    selects.push([channel, select]);
    shelf.append(
      el("div", { class: "d-shelf-slot" }, el("b", { text: channel }), select),
    );
  }
  const mark = choice("Mark", ["point", "bar", "line"], (v) =>
      ctx.set({ ...ctx.get(), mark: v }),
    ),
    stats = el("output", { class: "d-note" });
  host.append(
    plot,
    legend,
    stats,
    shelf,
    el("div", { class: "d-tools d-studio-only" }, mark),
    el("div", { class: "d-studio-only" }, heading("Rows"), table, tableNote),
  );
  plot.addEventListener("d-resize", () => update());
  function update() {
    const v = ctx.get();
    selects.forEach(([k, s]) => (s.value = v[k] || ""));
    if (data.length) {
      const cols = fieldsList.map((f) => (typeof f === "object" ? f.name : f)),
        roles = Object.fromEntries(["x", "y", "color", "size"].filter((k) => v[k]).map((k) => [v[k], k]));
      table.style.setProperty("--cols", cols.length);
      tableNote.textContent = data.length > 9 ? `First 9 of ${data.length} rows` : `${data.length} rows`;
      table.replaceChildren(
        el("div", { role: "row", class: "d-data-head" }, ...cols.map((c) => el("span", { role: "columnheader", text: roles[c] ? `${c} · ${roles[c]}` : c, class: roles[c] ? "is-used" : "" }))),
        ...data.slice(0, 9).map((row) =>
          el("div", { role: "row" }, ...cols.map((c) => el("span", { role: "cell", class: roles[c] ? "is-used" : "", text: typeof row[c] === "number" ? Number(row[c].toFixed(2)).toString() : String(row[c]) }))),
        ),
      );
    }
    mark.querySelector(".d-choice").value = v.mark || "point";
    const g = plot.getContext("2d"),
      w = plot.width,
      h = plot.height;
    grid(g, w, h);
    if (!data.length) {
      stats.textContent =
        "Supply control.data rows and control.fields to draw this chart";
      return;
    }
    const scale = (key, range) => {
      const vals = data.map((d) => d[key]),
        nums = vals.every((n) => typeof n === "number"),
        cats = [...new Set(vals)];
      if (nums) {
        const min = Math.min(...vals),
          max = Math.max(...vals);
        return (n) => ((n - min) / (max - min || 1)) * range;
      }
      return (n) => (cats.indexOf(n) / Math.max(1, cats.length - 1)) * range;
    };
    const x = scale(v.x, w - 42),
      y = scale(v.y, h - 36),
      color = scale(v.color, 1),
      size = scale(v.size, 1);
    g.strokeStyle = accent(host);
    g.lineWidth = 2;
    g.beginPath();
    data.forEach((row, i) => {
      const px =
          22 + (v.x ? x(row[v.x]) : (i / (data.length - 1 || 1)) * (w - 42)),
        py = h - 18 - (v.y ? y(row[v.y]) : 0),
        r = v.size ? 3 + size(row[v.size]) * 8 : 4;
      g.fillStyle = v.color
        ? cssLch([0.65, 0.14, 220 + color(row[v.color]) * 130, 1])
        : accent(host);
      if (v.mark === "bar") g.fillRect(px - 4, py, 8, h - 18 - py);
      else if (v.mark === "line") {
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      } else {
        g.moveTo(px + r, py);
        g.arc(px, py, r, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
      }
    });
    if (v.mark === "line") g.stroke();
    {
      const span = (key) => {
          const vals = data.map((d) => d[key]);
          return vals.every((n) => typeof n === "number")
            ? [Math.min(...vals), Math.max(...vals)]
            : null;
        },
        muted = getComputedStyle(plot).getPropertyValue("--d-muted").trim() || "#777";
      g.fillStyle = muted;
      g.font = `500 10.5px ${getComputedStyle(host).fontFamily}`;
      g.textBaseline = "alphabetic";
      const xs = v.x && span(v.x),
        ys = v.y && span(v.y);
      if (xs) {
        g.textAlign = "left";
        g.fillText(`${v.x} ${Number(xs[0].toFixed(1))}`, 4, h - 4);
        g.textAlign = "right";
        g.fillText(String(Number(xs[1].toFixed(1))), w - 4, h - 4);
      }
      if (ys) {
        g.textAlign = "left";
        g.fillText(`${v.y} ${Number(ys[1].toFixed(1))}`, 4, 12);
      }
      const bits = [];
      if (v.color) {
        const vals = data.map((d) => d[v.color]),
          cats = [...new Set(vals)];
        if (vals.every((n) => typeof n === "number"))
          bits.push(el("span", {}, `${v.color} ${Number(Math.min(...vals).toFixed(1))} to ${Number(Math.max(...vals).toFixed(1))}`));
        else
          for (const cat of cats) {
            const dot = el("i");
            dot.style.background = cssLch([0.65, 0.14, 220 + (cats.indexOf(cat) / Math.max(1, cats.length - 1)) * 130, 1]);
            bits.push(el("span", {}, dot, `${v.color} ${cat}`));
          }
      }
      if (v.size) {
        const vals = data.map((d) => d[v.size]);
        if (vals.every((n) => typeof n === "number"))
          bits.push(el("span", {}, `size ${v.size} ${Math.min(...vals)} to ${Math.max(...vals)}`));
      }
      legend.replaceChildren(...bits);
    }
    stats.value = `${data.length} rows · x: ${v.x || "index"} · y: ${v.y || "none"} · color: ${v.color || "fixed"} · size: ${v.size || "fixed"}`;
  }
  return { update };
}
function samplerStudio(ctx, host) {
  host.append(heading("Sampler"));
  const plot = canvas("Sigma schedule at each sampling step", 400, 160, false),
    guidance = canvas(
      "Guidance study: unconditioned prediction plus guidance times the conditional difference",
      400,
      48,
      false,
    ),
    seedStrip = el("div", {
      class: "d-seed-strip",
      role: "img",
      "aria-label": "Seed fingerprint",
    }),
    cells = el("div", { class: "d-step-cells" }),
    table = el("div", { class: "d-sched-table", role: "table", "aria-label": "Sigma at each step" }),
    seedGrid = el("div", { class: "d-seed-grid", "aria-hidden": "true" }),
    stats = el("output", { class: "d-note" }),
    f = fields(ctx, [
      ["Steps", "steps", 1, 150, 1],
      ["Guidance", "cfg", 0, 30, 0.1],
      ["Time shift", "shift", 0.1, 10, 0.1],
      ["Seed", "seed", 0, 4294967295, 1],
      ["Denoise", "denoise", 0, 1, 0.01],
    ]);
  const scheduler = choice(
      "Scheduler",
      ["karras", "linear", "cosine"],
      (value) => ctx.set({ ...ctx.get(), scheduler: value }),
    ),
    lock = button("Lock seed", "Lock or unlock seed", () =>
      ctx.set({ ...ctx.get(), locked: !ctx.get().locked }),
    ),
    random = button("Randomize", "Choose a random seed", () => {
      if (ctx.get().locked) return;
      ctx.set({
        ...ctx.get(),
        seed: crypto.getRandomValues(new Uint32Array(1))[0],
      });
    });
  host.append(
    plot,
    cells,
    stats,
    table,
    el(
      "div",
      { class: "d-studio-only" },
      heading("Guidance", "u + cfg × (c − u)"),
      guidance,
      seedStrip,
      seedGrid,
    ),
    f.node,
    el("div", { class: "d-tools" }, scheduler, lock, random),
  );
  const api = {
    update() {
      const v = ctx.get();
      f.update();
      scheduler.querySelector(".d-choice").value = v.scheduler;
      lock.textContent = v.locked ? "Seed locked" : "Seed unlocked";
      lock.setAttribute("aria-pressed", String(!!v.locked));
      random.disabled = !!v.locked;
      const points = schedule(v.steps, v.scheduler, v.shift).map(
          (n) => n * (v.denoise ?? 1),
        ),
        g = plot.getContext("2d");
      grid(g, 400, 160);
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.strokeStyle = getComputedStyle(host).getPropertyValue("--d-muted").trim() || "#888";
      for (const other of ["karras", "linear", "cosine"]) {
        if (other === v.scheduler) continue;
        g.beginPath();
        schedule(v.steps, other, v.shift).forEach((n, i, all) => {
          const x = (i / (all.length - 1)) * 400,
            y = 150 - n * (v.denoise ?? 1) * 140;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.font = `500 10.5px ${getComputedStyle(host).fontFamily}`;
        g.fillText(other, 6, 150 - schedule(v.steps, other, v.shift)[Math.floor(v.steps / 2)] * (v.denoise ?? 1) * 140 - 4);
      }
      g.setLineDash([]);
      g.strokeStyle = accent(host);
      g.lineWidth = 2;
      g.beginPath();
      points.forEach((n, i) =>
        i
          ? g.lineTo((i / (points.length - 1)) * 400, 150 - n * 140)
          : g.moveTo(0, 150 - n * 140),
      );
      g.stroke();
      g.fillStyle = accent(host);
      points.forEach((n, i) => {
        g.beginPath();
        g.arc(
          (i / (points.length - 1)) * 400,
          150 - n * 140,
          2,
          0,
          Math.PI * 2,
        );
        g.fill();
      });
      const gg = guidance.getContext("2d"),
        tip = 30 + (v.cfg || 0) * 10;
      grid(gg, 400, 48);
      gg.strokeStyle = accent(host);
      gg.fillStyle = accent(host);
      gg.lineWidth = 2;
      gg.beginPath();
      gg.moveTo(30, 24);
      gg.lineTo(tip, 24);
      gg.stroke();
      gg.beginPath();
      gg.moveTo(tip, 24);
      gg.lineTo(tip - 5, 20);
      gg.lineTo(tip - 5, 28);
      gg.closePath();
      gg.fill();
      gg.font = `500 10.5px ${getComputedStyle(host).fontFamily}`;
      gg.fillText("u", 27, 42);
      gg.fillText("c", 38, 14);
      gg.fillText(String(v.cfg), Math.max(45, tip + 8), 27);
      let seed = v.seed >>> 0;
      seedStrip.replaceChildren(
        ...Array.from({ length: 32 }, (_, i) => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const cell = el("i");
          cell.style.opacity = (seed >>> 24) / 255;
          return cell;
        }),
      );
      seedGrid.replaceChildren(
        ...Array.from({ length: 128 }, () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const cell = el("i");
          cell.style.opacity = (seed >>> 24) / 255;
          return cell;
        }),
      );
      table.replaceChildren(
        ...points
          .slice(1)
          .map((n, i) => [n, i])
          .filter(([, i], _, all) => all.length <= 12 || i % Math.ceil(all.length / 12) === 0 || i === all.length - 1)
          .map(([n, i]) => {
          const bar = el("i");
          bar.style.width = `${n * 100}%`;
          return el(
            "div",
            { role: "row" },
            el("span", { role: "cell", text: String(i + 1) }),
            el("span", { role: "cell", text: n.toFixed(4) }),
            el("span", { role: "cell", "aria-label": `sigma ${n.toFixed(4)}` }, bar),
          );
        }),
      );
      cells.replaceChildren(
        ...points.slice(1).map((n, i) => {
          const c = el("i", { title: `Step ${i + 1}: sigma ${n.toFixed(4)}` });
          c.style.opacity = 0.15 + 0.85 * (1 - n);
          return c;
        }),
      );
      stats.value = `${v.steps} evaluations · guidance ${v.cfg} · seed ${v.seed} · denoise ${v.denoise ?? 1}`;
    },
  };
  for (const cv of [plot, guidance])
    cv.addEventListener("d-resize", () => api.update());
  return api;
}
function generalStudio(ctx, host) {
  const c = ctx.control,
    preview = el("div", { class: `d-general-preview d-general-${c.type}` }),
    fns = [];
  host.append(
    heading(
      c.label || c.id,
      c.description || "Adjust the same value at a larger scale",
    ),
    preview,
  );
  if (c.type === "vector") {
    const pad = canvas(
      "2D vector pad. Arrow keys move x and y; Shift fine.",
      280,
      180,
    );
    preview.append(pad);
    const put = (e) => {
      const r = pad.getBoundingClientRect(),
        v = ctx.get(),
        min = c.min ?? -1,
        max = c.max ?? 1;
      v[0] = Number(
        (
          min +
          clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min)
        ).toFixed(3),
      );
      v[1] = Number(
        (
          max -
          clamp((e.clientY - r.top) / r.height, 0, 1) * (max - min)
        ).toFixed(3),
      );
      ctx.change(v);
    };
    ctx.surface(pad, {
      start: () => ctx.begin("vector-pad"),
      move: put,
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
    });
    pad.addEventListener("keydown", (e) => {
      const d = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [1, 1],
        ArrowDown: [1, -1],
      }[e.key];
      if (!d) return;
      e.preventDefault();
      const v = ctx.get();
      v[d[0]] = clamp(
        v[d[0]] + d[1] * (c.step || 0.01) * (e.shiftKey ? 0.1 : 1),
        c.min ?? -1,
        c.max ?? 1,
      );
      ctx.set(v);
    });
    const f = fields(
      { ...ctx, get: () => ({ v: ctx.get() }), change: (o) => ctx.change(o.v) },
      [
        ["X", ["v", 0], c.min ?? -1, c.max ?? 1, c.step || 0.01],
        ["Y", ["v", 1], c.min ?? -1, c.max ?? 1, c.step || 0.01],
      ],
    );
    host.append(f.node);
    pad.addEventListener("d-resize", () => fns.forEach((fn) => fn()));
    fns.push(() => {
      f.update();
      const v = ctx.get(),
        g = pad.getContext("2d"),
        min = c.min ?? -1,
        max = c.max ?? 1;
      grid(g, 280, 180);
      g.fillStyle = accent(host);
      g.beginPath();
      g.arc(
        ((v[0] - min) / (max - min)) * 280,
        ((max - v[1]) / (max - min)) * 180,
        5,
        0,
        Math.PI * 2,
      );
      g.fill();
    });
  } else if (c.type === "spacing") {
    const box = el(
      "div",
      { class: "d-box-model" },
      el("div", { text: "Content" }),
    );
    preview.append(box);
    const f = fields(
      { ...ctx, get: () => ({ v: ctx.get() }), change: (o) => ctx.change(o.v) },
      ["Top", "Right", "Bottom", "Left"].map((label, i) => [
        label,
        ["v", i],
        0,
        200,
        1,
        "px",
      ]),
    );
    host.append(f.node);
    fns.push(() => {
      f.update();
      box.style.padding = ctx
        .get()
        .map((v) => `${Math.min(v, 80)}px`)
        .join(" ");
    });
  } else if (c.type === "shadow") {
    const square = el("div", { class: "d-shadow-object", text: "napkin" });
    preview.append(square);
    const f = fields(ctx, [
      ["X", "x", -100, 100, 1, "px"],
      ["Y", "y", -100, 100, 1, "px"],
      ["Blur", "blur", 0, 100, 1, "px"],
      ["Spread", "spread", -50, 100, 1, "px"],
    ]);
    host.append(f.node);
    fns.push(() => {
      f.update();
      const v = ctx.get();
      square.style.boxShadow = `${v.x}px ${v.y}px ${v.blur}px ${v.spread || 0}px ${v.color || "#0004"}`;
    });
  } else if (c.type === "gradient") {
    const inputs = [
      el("input", {
        type: "color",
        "aria-label": "Gradient start",
        value: "#3459e2",
      }),
      el("input", {
        type: "color",
        "aria-label": "Gradient end",
        value: "#ee5228",
      }),
      el("input", {
        type: "range",
        min: 0,
        max: 360,
        value: 90,
        "aria-label": "Gradient angle",
      }),
    ];
    for (const input of inputs)
      input.addEventListener("input", () => {
        ctx.begin("gradient");
        ctx.change(
          `linear-gradient(${inputs[2].value}deg, ${inputs[0].value}, ${inputs[1].value})`,
        );
      });
    for (const input of inputs)
      input.addEventListener("change", () => ctx.commit());
    host.append(el("div", { class: "d-tools" }, ...inputs));
    fns.push(() => {
      preview.style.background = ctx.get();
    });
  } else if (["asset", "file"].includes(c.type)) {
    let objectUrl;
    const input = filePick(`Choose ${c.label || "asset"}`, "", (file) => {
      ctx.set(file.name);
      ctx.panel?.emit("asset", { control: c.id, file });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (file.type.startsWith("image/")) {
        objectUrl = URL.createObjectURL(file);
        preview.style.backgroundImage = `url("${objectUrl}")`;
      }
    });
    host.append(input);
    fns.push(() => {
      preview.textContent = ctx.get() || "Choose a local file";
    });
    return {
      update: () => fns.forEach((fn) => fn()),
      destroy: () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
    };
  } else if (["number", "range", "angle", "seed"].includes(c.type)) {
    const range = el("input", {
      type: "range",
      min: c.min ?? 0,
      max: c.max ?? 100,
      step: c.step || 1,
      "aria-label": c.label,
    });
    range.addEventListener("input", () => {
      ctx.begin("range");
      ctx.change(Number(range.value));
    });
    range.addEventListener("change", () => ctx.commit());
    host.append(range);
    fns.push(() => {
      range.value = ctx.get();
      preview.textContent =
        c.type === "angle" ? "↗" : `${ctx.get()}${c.unit || ""}`;
      if (c.type === "angle")
        preview.style.transform = `rotate(${-ctx.get() + 45}deg)`;
      if (c.figure === "radius") preview.style.borderRadius = `${ctx.get()}px`;
    });
  } else if (c.type === "text") {
    const text = el("textarea", { "aria-label": c.label });
    text.addEventListener("focus", () => ctx.begin("text"));
    text.addEventListener("input", () => ctx.change(text.value));
    text.addEventListener("blur", () => ctx.commit());
    host.append(text);
    fns.push(() => {
      preview.textContent = ctx.get();
      if (document.activeElement !== text) text.value = ctx.get();
    });
  } else if (c.type === "boolean") {
    const toggle = button("", "Toggle " + c.label, () => ctx.set(!ctx.get()));
    toggle.setAttribute("role", "switch");
    host.append(toggle);
    fns.push(() => {
      preview.textContent = ctx.get() ? "Enabled" : "Disabled";
      preview.style.opacity = ctx.get() ? 1 : 0.3;
      toggle.textContent = ctx.get() ? "On" : "Off";
      toggle.setAttribute("aria-checked", String(ctx.get()));
    });
  } else if (["select", "segmented"].includes(c.type)) {
    const opts = c.options || [];
    host.append(
      el(
        "div",
        { class: "d-presets" },
        ...opts.map((o) =>
          button(
            typeof o === "object" ? o.label : o,
            `${c.label}: ${typeof o === "object" ? o.label : o}`,
            () => ctx.set(typeof o === "object" ? o.value : o),
          ),
        ),
      ),
    );
    fns.push(() => (preview.textContent = String(ctx.get())));
  } else fns.push(() => (preview.textContent = JSON.stringify(ctx.get())));
  return { update: () => fns.forEach((fn) => fn()) };
}
export function createStudio(panel, section, host, rail = document.createElement("div")) {
  const c =
    section.controls.find((c) => c.id === section.studioControl) ||
    section.controls.find(
      (c) => c.type === (section.studio || section.controls[0]?.type),
    ) ||
    section.controls[0];
  if (!c) return {};
  host.dataset.studio = ["motion", "spring", "bezier", "keyframes"].includes(c.type)
    ? "motion"
    : c.type;
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
  else if (c.type === "keyframes" || (c.type === "motion" && !section.controls.some((x) => ["bezier", "spring"].includes(x.type))))
    lab = motionLab(ctx, host);
  else if (["motion", "bezier", "spring"].includes(c.type))
    lab = motionStudio(ctx, host);
  else if (c.type === "typography") lab = typeStudio(ctx, host);
  else if (c.type === "image") lab = imageStudio(ctx, host);
  else if (c.type === "encoding") lab = encodingStudio(ctx, host);
  else if (c.type === "sampler") lab = samplerStudio(ctx, host);
  else lab = generalStudio(ctx, host);
  // Two columns in a wide studio: the main figure and its direct tools on the left, the rest on the right.
  if (!["motion", "color"].includes(host.dataset.studio) && host.dataset.layout !== "own") {
    const kids = [...host.children].filter((k) => !k.matches(".d-lab-head")),
      heroSelector = ".d-plot, .d-stage, .d-color-main, .d-type-specimen, .d-type-ruler, .d-step-cells, .d-type-lab, .d-sched-table, .d-color-plates",
      main = el("div", { class: "d-col d-col-main" }),
      side = el("div", { class: "d-col d-col-side" });
    for (const k of kids)
      (k.matches(heroSelector) ||
      (host.dataset.studio === "color" && k.matches(".d-tools"))
        ? main
        : side
      ).append(k);
    host.append(main, side);
  }
  const onValue = (e) => {
    if (e.detail.control === c.id && e.detail.phase === "commit")
      lab.commit?.();
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
