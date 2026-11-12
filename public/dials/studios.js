import { el, button, heading, canvas, grid, pointerSurface } from "./dom.js";
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
import { motionAt, curvePoints, keyframeAt } from "./motion.js";
import { schedule } from "./figures.js";
const accent = (node) =>
  getComputedStyle(node).getPropertyValue("--d-accent").trim() || "#3459e2";
const controlValues = (panel, section) =>
  Object.fromEntries(section.controls.map((c) => [c.id, panel.get(c.id)]));
function choice(label, options, change) {
  const input = el(
    "select",
    { "aria-label": label },
    ...options.map((x) => el("option", { value: x, text: x })),
  );
  input.addEventListener("change", () => change(input.value));
  return el("label", { class: "d-tool" }, el("span", { text: label }), input);
}
function metric(name) {
  const value = el("strong", { text: "—" });
  return {
    node: el("div", { class: "d-metric" }, el("span", { text: name }), value),
    set: (text) => (value.textContent = text),
  };
}
function fields(ctx, descriptors) {
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
    box.append(
      el("label", { class: "d-field" }, el("span", { text: label }), input),
    );
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
function updateSwatches(host, label, colors, onPick) {
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
  });
}
function colorStudio(ctx, host) {
  host.append(heading("Color space", "Perceptual lightness × chroma"));
  let space = "srgb",
    planeMode = "OKLCH",
    map = "Off",
    background = "#ffffff",
    harmony = "Complement",
    cacheKey = "",
    pixels,
    history = [ctx.get()],
    frame = 0,
    dead = false;
  const plane = canvas(
      "Color plane. Left and right change chroma; up and down change lightness. Shift fine.",
      512,
      320,
    ),
    proof = el("canvas", {
      width: 200,
      height: 100,
      role: "img",
      "aria-label": "Selected color on the contrast background",
    }),
    preview = el("div", { class: "d-color-preview" }, proof);
  const wcag = metric("WCAG 2 · ratio"),
    lc = metric("APCA · experimental Lc"),
    gamut = metric("Gamut");
  const code = el("output", { class: "d-color-code" }),
    readout = el("div", { class: "d-readout" }, wcag.node, lc.node, gamut.node);
  const toolbar = el(
    "div",
    { class: "d-tools d-studio-only" },
    choice("Plane", ["OKLCH", "OKLab"], (v) => {
      planeMode = v;
      cacheKey = "";
      update();
    }),
    choice("Gamut", ["srgb", "p3"], (v) => {
      space = v;
      cacheKey = "";
      update();
    }),
    choice(
      "Contrast map",
      ["Off", "AA 4.5", "AAA 7", "APCA 60", "APCA 75"],
      (v) => {
        map = v;
        cacheKey = "";
        update();
      },
    ),
  );
  const bg = el("input", {
    value: background,
    type: "text",
    "aria-label": "Contrast background",
  });
  bg.addEventListener("change", () => {
    try {
      parseColor(bg.value, ctx.host);
      background = bg.value;
      bg.removeAttribute("aria-invalid");
      cacheKey = "";
      update();
    } catch {
      bg.setAttribute("aria-invalid", "true");
    }
  });
  toolbar.append(
    el("label", { class: "d-tool" }, el("span", { text: "Against" }), bg),
  );
  const planeWrap = el(
    "div",
    { class: "d-color-plane" },
    plane,
    el(
      "div",
      { class: "d-plot-key" },
      el("span", { text: "0 ← chroma → .4" }),
      el("span", { text: "— sRGB   ┄ P3" }),
    ),
  );
  const main = el(
    "div",
    { class: "d-color-main" },
    planeWrap,
    el("div", { class: "d-color-proof" }, preview, readout, code),
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
  const palettes = el("div", { class: "d-palettes d-studio-only" }),
    rampHost = el("div"),
    harmonyHost = el("div"),
    historyHost = el("div"),
    imageHost = el("div");
  const image = el("input", {
      type: "file",
      accept: "image/*",
      "aria-label": "Sample palette from an image",
    }),
    sampleStatus = el("output", { class: "d-note" });
  image.addEventListener("change", async () => {
    const file = image.files[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file),
        c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0, 96, 96);
      bitmap.close();
      const colors = paletteFromPixels(g.getImageData(0, 0, 96, 96).data);
      imageHost.replaceChildren(
        swatchRow("Image palette", colors, (v) => ctx.set(v)),
      );
      sampleStatus.textContent = `${colors.length} colors sampled from ${file.name}`;
    } catch {
      sampleStatus.textContent = "Could not read this image";
    }
  });
  const token = el("input", {
      placeholder: "--brand-accent",
      "aria-label": "CSS variable name",
    }),
    tokenStatus = el("output", { class: "d-note" });
  const bind = button("Bind", "Bind to CSS variable", () => {
    if (!/^--[\w-]+$/.test(token.value)) {
      tokenStatus.textContent = "Enter a CSS variable name starting with --";
      return;
    }
    try {
      ctx.set(`var(${token.value})`);
      tokenStatus.textContent = `Bound to ${token.value}`;
    } catch {
      tokenStatus.textContent = "Variable is not a color in this panel";
    }
  });
  const formats = choice(
    "Copy format",
    ["OKLCH", "OKLab", "Hex", "RGB"],
    (v) => {
      format = v;
      update();
    },
  );
  let format = "OKLCH";
  const copy = button("Copy color", "Copy formatted color", async () => {
    try {
      await navigator.clipboard.writeText(code.value);
      tokenStatus.textContent = "Color copied";
    } catch {
      tokenStatus.textContent = "Select and copy the color readout";
    }
  });
  palettes.append(
    el("div", {}, heading("Ramp", "Gamut fitted, nine stops"), rampHost),
    el(
      "div",
      {},
      heading("Harmony", "Hue relationships"),
      choice(
        "Relationship",
        ["Complement", "Analogous", "Triad", "Split"],
        (v) => {
          harmony = v;
          update();
        },
      ),
      harmonyHost,
    ),
    el(
      "div",
      {},
      heading("From an image", "Local files stay in this browser"),
      image,
      sampleStatus,
      imageHost,
    ),
    el(
      "div",
      {},
      heading(
        "Token & history",
        "Bind the value, or return to an earlier color",
      ),
      el("div", { class: "d-tools" }, token, bind),
      tokenStatus,
      historyHost,
      el("div", { class: "d-tools" }, formats, copy),
    ),
  );
  host.append(toolbar, main, channels.node, palettes);
  const pick = (e) => {
    const r = plane.getBoundingClientRect(),
      x = clamp((e.clientX - r.left) / r.width, 0, 1),
      y = clamp((e.clientY - r.top) / r.height, 0, 1),
      v = parseColor(ctx.get(), ctx.host);
    ctx.change(
      planeMode === "OKLCH"
        ? cssLch([1 - y, x * 0.4, v[2], v[3]])
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
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))
      return;
    e.preventDefault();
    const v = parseColor(ctx.get(), ctx.host),
      f = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    if (planeMode === "OKLCH") {
      if (e.key === "ArrowUp") v[0] += 0.01 * f;
      if (e.key === "ArrowDown") v[0] -= 0.01 * f;
      if (e.key === "ArrowLeft") v[1] -= 0.005 * f;
      if (e.key === "ArrowRight") v[1] += 0.005 * f;
      v[0] = clamp(v[0], 0, 1);
      v[1] = clamp(v[1], 0, 0.4);
      ctx.set(cssLch(v));
    } else {
      const lab = lchToLab(v);
      lab[e.key === "ArrowLeft" || e.key === "ArrowRight" ? 1 : 2] +=
        (e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1) * 0.005 * f;
      ctx.set(cssLab(lab));
    }
  });
  const onCommit = () => {
    const v = ctx.get();
    if (history.at(-1) !== v) {
      history.push(v);
      history = history.slice(-12);
    }
    updateHistory();
  };
  const updateHistory = () =>
    updateSwatches(historyHost, "Color history", history, (v) => ctx.set(v));
  const raster = document.createElement("canvas");
  raster.width = 192;
  raster.height = 120;
  const rasterContext = raster.getContext("2d");
  function draw() {
    frame = 0;
    if (dead) return;
    const v = parseColor(ctx.get(), ctx.host),
      back = parseColor(background, ctx.host),
      key = [
        v[2].toFixed(2),
        planeMode,
        planeMode === "OKLab" ? v[0].toFixed(3) : "",
        map,
        background,
        space,
        v[3],
      ].join("|"),
      g = plane.getContext("2d", { willReadFrequently: true }),
      w = plane.width,
      h = plane.height;
    if (key !== cacheKey) {
      const w = raster.width,
        h = raster.height;
      pixels = rasterContext.createImageData(w, h);
      const threshold = map === "AA 4.5" ? 4.5 : 7;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const lch =
            planeMode === "OKLCH"
              ? [1 - y / (h - 1), (x / (w - 1)) * 0.4, v[2], v[3]]
              : labToLch([
                  v[0],
                  (x / (w - 1) - 0.5) * 0.8,
                  (0.5 - y / (h - 1)) * 0.8,
                  v[3],
                ]);
          const color = labToLinear(lchToLab(lch)).map(gamma),
            inside = inGamut(lch, space),
            passes =
              map === "Off" ||
              (map.startsWith("APCA")
                ? Math.abs(apca(lch, back)) >= Number(map.slice(5))
                : contrast(lch, back) >= threshold),
            i = (y * w + x) * 4;
          for (let k = 0; k < 3; k++)
            pixels.data[i + k] = !passes
              ? (x + y) % 8 < 2
                ? 70
                : clamp(color[k], 0, 1) * 100
              : !inside
                ? (x + y) % 8 < 2
                  ? 145
                  : clamp(color[k], 0, 1) * 180
                : clamp(color[k], 0, 1) * 255;
          pixels.data[i + 3] = 255;
        }
      cacheKey = key;
      rasterContext.putImageData(pixels, 0, 0);
    }
    g.clearRect(0, 0, w, h);
    g.drawImage(raster, 0, 0, w, h);
    if (planeMode === "OKLCH")
      for (const [name, stroke, dash] of [
        ["srgb", "#fff", []],
        ["p3", "#111", [4, 3]],
      ]) {
        g.beginPath();
        for (let y = 0; y < h; y += 2) {
          const x = (gamutChroma(1 - y / (h - 1), v[2], name) / 0.4) * w;
          y ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.strokeStyle = stroke;
        g.lineWidth = 1.5;
        g.setLineDash(dash);
        g.stroke();
      }
    else {
      g.setLineDash([]);
      for (const [name, stroke] of [
        ["srgb", "#fff"],
        ["p3", "#111"],
      ]) {
        g.beginPath();
        for (let i = 0; i <= 180; i++) {
          const H = i * 2,
            C = gamutChroma(v[0], H, name),
            r = (H * Math.PI) / 180,
            x = ((C * Math.cos(r)) / 0.8 + 0.5) * w,
            y = (0.5 - (C * Math.sin(r)) / 0.8) * h;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.strokeStyle = stroke;
        g.stroke();
      }
    }
    g.setLineDash([]);
    const lab = lchToLab(v),
      x = planeMode === "OKLCH" ? (v[1] / 0.4) * w : (lab[1] / 0.8 + 0.5) * w,
      y = planeMode === "OKLCH" ? (1 - v[0]) * h : (0.5 - lab[2] / 0.8) * h;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.strokeStyle = "#111";
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.stroke();
  }
  function update() {
    if (dead) return;
    const v = parseColor(ctx.get(), ctx.host),
      back = parseColor(background, ctx.host),
      ratio = contrast(v, back);
    channels.update();
    preview.style.color = ctx.get();
    preview.style.background = background;
    proof.setAttribute(
      "aria-label",
      `${ctx.get()} against ${background}. WCAG ratio ${ratio.toFixed(2)}; ${ratio >= 4.5 ? "passes" : "fails"} AA for small text.`,
    );
    const proofContext = proof.getContext("2d");
    proofContext.clearRect(0, 0, 200, 100);
    proofContext.fillStyle = cssLch(v);
    proofContext.textAlign = "center";
    proofContext.font = "650 64px sans-serif";
    proofContext.fillText("Aa", 100, 69);
    proofContext.font = "10px sans-serif";
    proofContext.fillText("Small type / large type", 100, 93);
    wcag.set(
      `${ratio.toFixed(2)} : 1 · ${ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "Fail"}`,
    );
    lc.set(apca(v, back).toFixed(1));
    gamut.set(
      inGamut(v) ? "sRGB" : inGamut(v, "p3") ? "P3 only" : "Outside P3",
    );
    code.value =
      format === "Hex"
        ? toHex(v)
        : format === "OKLab"
          ? cssLab(lchToLab(v))
          : format === "RGB"
            ? `rgb(${rgb(v)
                .map((n) => Math.round(n * 255))
                .join(" ")} / ${v[3].toFixed(3)})`
            : cssLch(v);
    updateSwatches(rampHost, "Ramp", ramp(v), (color) => ctx.set(color));
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
    );
    if (!frame) frame = requestAnimationFrame(draw);
  }
  updateHistory();
  return {
    update,
    commit: onCommit,
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
      ...rawContext.get(),
    }),
  };
  host.append(heading("Motion study", "Response, not just a curve"));
  const plot = canvas(
      "Motion curve. Tab to bezier handle controls to edit the curve.",
      400,
      210,
    ),
    ghost = canvas("Ghost trail showing positions through the motion", 400, 66),
    track = el("input", {
      type: "range",
      min: 0,
      max: 1000,
      value: 0,
      "aria-label": "Timeline playhead",
    }),
    time = el("output", { class: "d-note" });
  let playhead = 0,
    playing = false,
    start = 0,
    raf = 0,
    dead = false,
    dragHandle = 0;
  const mode = choice("Response", ["bezier", "spring"], (value) =>
    ctx.set({ ...ctx.get(), mode: value }),
  );
  const presets = el(
    "div",
    { class: "d-presets" },
    ...Object.entries({
      Ease: [0.25, 0.1, 0.25, 1],
      Swift: [0.2, 0.8, 0.2, 1],
      Linear: [0, 0, 1, 1],
      Overshoot: [0.3, 1.5, 0.6, 1],
    }).map(([label, bezier]) =>
      button(label, `${label} curve`, () =>
        ctx.set({ ...ctx.get(), mode: "bezier", bezier }),
      ),
    ),
  );
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
  const play = button("Play", "Play motion preview", () => {
    playing = !playing;
    play.textContent = playing ? "Pause" : "Play";
    if (playing) {
      start =
        performance.now() -
        playhead * (ctx.get().duration + ctx.get().delay || 1000);
      raf = requestAnimationFrame(tick);
    } else cancelAnimationFrame(raf);
  });
  const keyframes = el("div", { class: "d-keyframes d-studio-only" }),
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
  const exportCode = el("output", { class: "d-export d-studio-only" });
  host.append(
    el("div", { class: "d-tools" }, mode, play),
    el("div", { class: "d-motion-plots" }, plot, ghost),
    el(
      "div",
      { class: "d-track" },
      el("span", { text: "0" }),
      track,
      el("span", { text: "1" }),
    ),
    time,
    presets,
    numbers.node,
    el(
      "div",
      { class: "d-studio-only d-motion-details" },
      heading("Bezier handles", "The same handles as the curve"),
      handles.node,
      heading("Keyframes", "Time is normalized from 0 to 1"),
      add,
      keyframes,
    ),
    exportCode,
  );
  track.addEventListener("input", () => {
    playhead = Number(track.value) / 1000;
    draw();
  });
  ctx.surface(plot, {
    start: (e) => {
      if (ctx.get().mode === "spring") return;
      ctx.begin("bezier-handle");
      const v = ctx.get(),
        r = plot.getBoundingClientRect(),
        x = (e.clientX - r.left) / r.width,
        y = (e.clientY - r.top) / r.height,
        p = v.bezier;
      dragHandle =
        Math.hypot(x - p[0], y - (0.84 - p[1] * 0.68)) <
        Math.hypot(x - p[2], y - (0.84 - p[3] * 0.68))
          ? 0
          : 2;
    },
    move: (e) => {
      if (ctx.get().mode === "spring") return;
      const r = plot.getBoundingClientRect(),
        v = ctx.get();
      v.bezier[dragHandle] = Number(
        clamp((e.clientX - r.left) / r.width, 0, 1).toFixed(3),
      );
      v.bezier[dragHandle + 1] = Number(
        clamp((0.84 - (e.clientY - r.top) / r.height) / 0.68, -3, 3).toFixed(3),
      );
      ctx.change(v);
    },
    end: () => ctx.commit(),
    cancel: () => ctx.cancel(),
  });
  function tick(now) {
    if (dead || !playing) return;
    const v = ctx.get(),
      total = (v.duration || 1000) + (v.delay || 0);
    playhead = ((now - start) % total) / total;
    track.value = playhead * 1000;
    draw();
    raf = requestAnimationFrame(tick);
  }
  function draw() {
    if (dead) return;
    const v = ctx.get(),
      g = plot.getContext("2d"),
      w = plot.width,
      h = plot.height,
      a = accent(host);
    grid(g, w, h);
    const xy = ([x, y]) => [x * w, h * (0.84 - y * 0.68)];
    g.beginPath();
    curvePoints(v).forEach((p, i) => {
      const [x, y] = xy(p);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.strokeStyle = a;
    g.lineWidth = 2;
    g.stroke();
    if (v.mode !== "spring") {
      const p = v.bezier || [0.25, 0.1, 0.25, 1];
      g.beginPath();
      g.moveTo(...xy([0, 0]));
      g.lineTo(...xy([p[0], p[1]]));
      g.moveTo(...xy([1, 1]));
      g.lineTo(...xy([p[2], p[3]]));
      g.strokeStyle = a;
      g.globalAlpha = 0.4;
      g.stroke();
      g.globalAlpha = 1;
      for (let i = 0; i < 4; i += 2) {
        g.beginPath();
        g.arc(...xy([p[i], p[i + 1]]), 5, 0, Math.PI * 2);
        g.fillStyle = a;
        g.fill();
      }
    }
    const delay = (v.delay || 0) / ((v.duration || 1000) + (v.delay || 0)),
      t = clamp((playhead - delay) / (1 - delay), 0, 1),
      value = motionAt(t, v),
      key = keyframeAt(t, v.keyframes);
    g.beginPath();
    g.moveTo(t * w, 0);
    g.lineTo(t * w, h);
    g.strokeStyle = a;
    g.setLineDash([2, 3]);
    g.stroke();
    g.setLineDash([]);
    const gg = ghost.getContext("2d");
    grid(gg, ghost.width, ghost.height);
    for (let i = 0; i <= 14; i++) {
      const p = motionAt(i / 14, v);
      gg.globalAlpha = 0.08 + (i / 14) * 0.22;
      gg.fillStyle = a;
      gg.fillRect(14 + clamp(p, -0.05, 1.1) * (ghost.width - 50), 18, 16, 30);
    }
    gg.globalAlpha = 1;
    gg.fillStyle = a;
    gg.fillRect(14 + clamp(value, -0.05, 1.1) * (ghost.width - 50), 18, 16, 30);
    gg.strokeStyle = a;
    gg.strokeRect(14 + clamp(key, -0.05, 1.1) * (ghost.width - 50), 8, 16, 10);
    time.textContent = `${Math.round(playhead * ((v.duration || 1000) + (v.delay || 0)))} ms · response ${value.toFixed(3)} · keyframe ${key.toFixed(3)}`;
  }
  let lastKeys = "";
  function update() {
    if (dead) return;
    const v = ctx.get();
    mode.querySelector("select").value = v.mode || "bezier";
    numbers.update();
    handles.update();
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
        (
          v.keyframes || [
            { time: 0, value: 0 },
            { time: 1, value: 1 },
          ]
        ).forEach((f, i) => {
          const timeInput = el("input", {
              type: "number",
              min: 0,
              max: 1,
              step: 0.01,
              value: f.time,
              "aria-label": `Key ${i + 1} time`,
            }),
            valueInput = el("input", {
              type: "number",
              step: 0.01,
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
              const frames = clone(
                  ctx.get().keyframes || [
                    { time: 0, value: 0 },
                    { time: 1, value: 1 },
                  ],
                ),
                n = Number(input.value);
              if (!Number.isFinite(n)) return;
              frames[i][key] = key === "time" ? clamp(n, 0, 1) : n;
              ctx.change({ ...ctx.get(), keyframes: frames });
            });
          }
          keyframes.append(
            el(
              "div",
              { class: "d-key" },
              button("◇", `Scrub to key ${i + 1}`, () => {
                playhead = ctx.get().keyframes?.[i]?.time ?? f.time;
                track.value = playhead * 1000;
                draw();
              }),
              timeInput,
              valueInput,
              button("×", `Remove key ${i + 1}`, () =>
                ctx.set({
                  ...ctx.get(),
                  keyframes: (ctx.get().keyframes || []).filter(
                    (_, j) => j !== i,
                  ),
                }),
              ),
            ),
          );
        });
      }
    }
    exportCode.value =
      v.mode === "spring"
        ? `spring · k ${v.stiffness} · c ${v.damping} · m ${v.mass}`
        : `cubic-bezier(${v.bezier.join(", ")}) · ${v.duration}ms · delay ${v.delay}ms`;
    draw();
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
    stop = () => {
      play.disabled = reduced.matches;
      if (reduced.matches) {
        playing = false;
        cancelAnimationFrame(raf);
        play.textContent = "Play";
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
    destroy: () => {
      dead = true;
      cancelAnimationFrame(raf);
      reduced.removeEventListener("change", stop);
    },
  };
}
function typeStudio(ctx, host) {
  host.append(heading("Type specimen", "Shape, rhythm, optical size"));
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
  ]);
  const axisDefinitions = ctx.control.axes || [];
  const axisCtx = {
    ...ctx,
    get: () => ({
      ...Object.fromEntries(axisDefinitions.map((a) => [a.tag, a.default])),
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
    axisDefinitions.map((a) => [
      a.label || a.tag,
      a.tag,
      a.min,
      a.max,
      a.step || 1,
    ]),
  );
  const family = el("input", {
    type: "text",
    "aria-label": "Font family",
    value: ctx.get().family || "system-ui",
  });
  family.addEventListener("change", () =>
    ctx.set({ ...ctx.get(), family: family.value }),
  );
  const ruler = el("div", {
    class: "d-type-ruler",
    "aria-hidden": true,
    text: "H  x  n  o  a  g  ·  0123456789",
  });
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
  host.append(
    specimen,
    ruler,
    measure,
    nums.node,
    el(
      "div",
      { class: "d-studio-only" },
      heading("Variable axes", "Declare axes and their ranges in the schema"),
      el("label", { class: "d-tool" }, el("span", { text: "Family" }), family),
      axes.node,
      el("p", {
        class: "d-note",
        text: "Axis controls use font-variation-settings. The selected font must contain the declared axes.",
      }),
    ),
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
function imageStudio(ctx, host) {
  host.append(
    heading("Image darkroom", "Levels, curves & a measured histogram"),
  );
  const preview = canvas("Image after levels, curves, crop and mask", 320, 180),
    hist = canvas(
      "Luminance histogram and tone curve. Arrows adjust middle curve point.",
      320,
      100,
    ),
    status = el("output", { class: "d-note" });
  const source = document.createElement("canvas");
  source.width = 320;
  source.height = 180;
  const s = source.getContext("2d", { willReadFrequently: true });
  // A locally drawn still life is the default source; uploads replace its pixels.
  const backdrop = s.createLinearGradient(0, 0, 320, 180);
  backdrop.addColorStop(0, "#17266c");
  backdrop.addColorStop(1, "#526bca");
  s.fillStyle = backdrop;
  s.fillRect(0, 0, 320, 180);
  s.fillStyle = "#e5ddbf";
  s.fillRect(0, 135, 320, 45);
  s.fillStyle = "#11214f";
  s.beginPath();
  s.ellipse(180, 142, 88, 12, 0, 0, Math.PI * 2);
  s.fill();
  const orange = s.createRadialGradient(145, 76, 1, 179, 100, 65);
  orange.addColorStop(0, "#ffcc56");
  orange.addColorStop(0.6, "#ed7d21");
  orange.addColorStop(1, "#792e16");
  s.fillStyle = orange;
  s.beginPath();
  s.arc(177, 95, 53, 0, Math.PI * 2);
  s.fill();
  s.fillStyle = "#749b42";
  s.beginPath();
  s.ellipse(181, 39, 22, 7, -0.4, 0, Math.PI * 2);
  s.fill();
  s.fillStyle = "#f2eee0";
  s.fillRect(34, 70, 45, 65);
  s.fillStyle = "#c9c5b6";
  s.fillRect(73, 70, 8, 65);
  let original = s.getImageData(0, 0, 320, 180),
    dead = false,
    frame = 0,
    drag = 2;
  const upload = el("input", {
    type: "file",
    accept: "image/*",
    "aria-label": "Load image for adjustment",
  });
  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    try {
      const b = await createImageBitmap(file);
      s.clearRect(0, 0, 320, 180);
      s.drawImage(b, 0, 0, 320, 180);
      b.close();
      original = s.getImageData(0, 0, 320, 180);
      status.textContent = file.name;
      update();
    } catch {
      status.textContent = "Could not read image";
    }
  });
  const f = fields(ctx, [
    ["Black", "black", 0, 0.99, 0.01],
    ["White", "white", 0.01, 1, 0.01],
    ["Gamma", "gamma", 0.1, 5, 0.01],
    ["Exposure", "exposure", -5, 5, 0.1],
    ["Saturation", "saturation", 0, 3, 0.01],
  ]);
  const crop = fields(ctx, [
    ["Crop left", "cropLeft", 0, 0.95, 0.01],
    ["Crop top", "cropTop", 0, 0.95, 0.01],
    ["Crop right", "cropRight", 0, 0.95, 0.01],
    ["Crop bottom", "cropBottom", 0, 0.95, 0.01],
    ["Mask radius", "mask", 0, 1, 0.01],
  ]);
  const curveCtx = {
    ...ctx,
    get: () => ({ points: ctx.get().curve || [0, 0.25, 0.5, 0.75, 1] }),
    change: (v) => ctx.change({ ...ctx.get(), curve: v.points }),
  };
  const curveFields = fields(
    curveCtx,
    Array.from({ length: 5 }, (_, i) => [
      `Tone ${i * 25}%`,
      ["points", i],
      0,
      1,
      0.01,
    ]),
  );
  host.append(
    preview,
    hist,
    status,
    f.node,
    el(
      "div",
      { class: "d-studio-only" },
      heading("Tone curve", "Drag a knot; Tab to enter it exactly"),
      curveFields.node,
      heading("Crop & mask", "Normalized source coordinates"),
      crop.node,
      upload,
    ),
  );
  ctx.surface(hist, {
    start: (e) => {
      ctx.begin("tone-curve");
      const r = hist.getBoundingClientRect();
      drag = clamp(Math.round(((e.clientX - r.left) / r.width) * 4), 0, 4);
    },
    move: (e) => {
      const r = hist.getBoundingClientRect(),
        v = ctx.get();
      v.curve ||= [0, 0.25, 0.5, 0.75, 1];
      v.curve[drag] = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      ctx.change(v);
    },
    end: () => ctx.commit(),
    cancel: () => ctx.cancel(),
  });
  hist.addEventListener("keydown", (e) => {
    if (!["ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const v = ctx.get();
    v.curve ||= [0, 0.25, 0.5, 0.75, 1];
    v.curve[2] = clamp(v.curve[2] + (e.key === "ArrowUp" ? 0.01 : -0.01), 0, 1);
    ctx.set(v);
  });
  function draw() {
    frame = 0;
    if (dead) return;
    const v = ctx.get(),
      g = preview.getContext("2d"),
      out = new ImageData(320, 180),
      bins = new Array(64).fill(0),
      curve = v.curve || [0, 0.25, 0.5, 0.75, 1],
      black = v.black || 0,
      white = Math.max(black + 0.001, v.white ?? 1);
    for (let i = 0; i < original.data.length; i += 4) {
      const px = (i / 4) % 320,
        py = Math.floor(i / 4 / 320),
        color = [];
      for (let k = 0; k < 3; k++) {
        let n =
          clamp(
            ((original.data[i + k] / 255) * 2 ** (v.exposure || 0) - black) /
              (white - black),
            0,
            1,
          ) **
          (1 / (v.gamma || 1));
        const p = n * 4,
          lo = Math.min(3, Math.floor(p));
        color[k] = curve[lo] + (curve[lo + 1] - curve[lo]) * (p - lo);
      }
      const l = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
      for (let k = 0; k < 3; k++)
        out.data[i + k] =
          clamp(l + (color[k] - l) * (v.saturation ?? 1), 0, 1) * 255;
      const inside =
          px >= 320 * (v.cropLeft || 0) &&
          px <= 320 * (1 - (v.cropRight || 0)) &&
          py >= 180 * (v.cropTop || 0) &&
          py <= 180 * (1 - (v.cropBottom || 0)),
        masked =
          !(v.mask > 0) ||
          Math.hypot((px - 160) / 160, (py - 90) / 90) < v.mask;
      out.data[i + 3] = inside && masked ? 255 : 30;
      if (inside && masked) bins[Math.min(63, Math.floor(l * 64))]++;
    }
    g.putImageData(out, 0, 0);
    const hg = hist.getContext("2d");
    grid(hg, 320, 100);
    const max = Math.max(...bins);
    hg.fillStyle = accent(host);
    hg.globalAlpha = 0.3;
    bins.forEach((n, i) =>
      hg.fillRect(i * 5, 100 - (n / max) * 90, 4, (n / max) * 90),
    );
    hg.globalAlpha = 1;
    hg.beginPath();
    curve.forEach((n, i) =>
      i ? hg.lineTo(i * 80, 100 - n * 100) : hg.moveTo(0, 100 - n * 100),
    );
    hg.strokeStyle = accent(host);
    hg.lineWidth = 2;
    hg.stroke();
    curve.forEach((n, i) => {
      hg.beginPath();
      hg.arc(i * 80, 100 - n * 100, 4, 0, Math.PI * 2);
      hg.fillStyle = accent(host);
      hg.fill();
    });
    status.value = `${bins.reduce((a, b) => a + b, 0).toLocaleString()} visible pixels · 64 luminance bins`;
  }
  function update() {
    f.update();
    crop.update();
    curveFields.update();
    if (!frame) frame = requestAnimationFrame(draw);
  }
  return {
    update,
    destroy: () => {
      dead = true;
      cancelAnimationFrame(frame);
    },
  };
}
function encodingStudio(ctx, host) {
  host.append(
    heading("Encoding shelf", "Fields become position, color & size"),
  );
  const plot = canvas(
      "Chart preview from the selected field encodings",
      400,
      200,
    ),
    shelf = el("div", { class: "d-encoding" }),
    data = ctx.control.data || [],
    fieldsList = ctx.control.fields || Object.keys(data[0] || {}),
    selects = [];
  for (const channel of ["x", "y", "color", "size"]) {
    const select = el(
      "select",
      { "aria-label": `${channel} field` },
      el("option", { value: "", text: "None" }),
      ...fieldsList.map((f) =>
        el("option", {
          value: typeof f === "object" ? f.name : f,
          text: typeof f === "object" ? f.name : f,
        }),
      ),
    );
    select.addEventListener("change", () =>
      ctx.set({ ...ctx.get(), [channel]: select.value }),
    );
    selects.push([channel, select]);
    shelf.append(
      el(
        "label",
        { class: "d-shelf-slot" },
        el("b", { text: channel }),
        select,
      ),
    );
  }
  const mark = choice("Mark", ["point", "bar", "line"], (v) =>
      ctx.set({ ...ctx.get(), mark: v }),
    ),
    stats = el("output", { class: "d-note" });
  host.append(
    plot,
    shelf,
    el("div", { class: "d-tools d-studio-only" }, mark),
    stats,
  );
  function update() {
    const v = ctx.get();
    selects.forEach(([k, s]) => (s.value = v[k] || ""));
    mark.querySelector("select").value = v.mark || "point";
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
    stats.value = `${data.length} rows · x: ${v.x || "index"} · y: ${v.y || "none"} · color: ${v.color || "fixed"} · size: ${v.size || "fixed"}`;
  }
  return { update };
}
function samplerStudio(ctx, host) {
  host.append(heading("Sampler", "Noise becomes a schedule"));
  const plot = canvas("Sigma schedule at each sampling step", 400, 160),
    guidance = canvas(
      "Guidance study: unconditioned prediction plus guidance times the conditional difference",
      400,
      48,
    ),
    seedStrip = el("div", {
      class: "d-seed-strip",
      "aria-label": "Seed fingerprint",
    }),
    cells = el("div", { class: "d-step-cells" }),
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
    el(
      "div",
      { class: "d-studio-only" },
      heading("Guidance", "u + cfg × (c − u), a one-dimensional study"),
      guidance,
      seedStrip,
    ),
    f.node,
    el("div", { class: "d-tools" }, scheduler, lock, random),
  );
  return {
    update() {
      const v = ctx.get();
      f.update();
      scheduler.querySelector("select").value = v.scheduler;
      lock.textContent = v.locked ? "Seed locked" : "Seed unlocked";
      lock.setAttribute("aria-pressed", String(!!v.locked));
      random.disabled = !!v.locked;
      const points = schedule(v.steps, v.scheduler, v.shift).map(
          (n) => n * (v.denoise ?? 1),
        ),
        g = plot.getContext("2d");
      grid(g, 400, 160);
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
      gg.font = "10px monospace";
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
    const input = el("input", {
      type: "file",
      "aria-label": `Choose ${c.label || "asset"}`,
    });
    let objectUrl;
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
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
export function createStudio(panel, section, host) {
  const c =
    section.controls.find((c) => c.id === section.studioControl) ||
    section.controls.find(
      (c) => c.type === (section.studio || section.controls[0]?.type),
    ) ||
    section.controls[0];
  if (!c) return {};
  host.dataset.studio = ["motion", "spring", "bezier"].includes(c.type)
    ? "motion"
    : c.type;
  const cleanup = [];
  const ctx = {
    ...panel.context(c.id, c),
    panel,
    surface: (node, handlers) => {
      cleanup.push(pointerSurface(node, handlers));
    },
  };
  let lab;
  if (c.type === "color") lab = colorStudio(ctx, host);
  else if (["motion", "bezier", "spring"].includes(c.type))
    lab = motionStudio(ctx, host);
  else if (c.type === "typography") lab = typeStudio(ctx, host);
  else if (c.type === "image") lab = imageStudio(ctx, host);
  else if (c.type === "encoding") lab = encodingStudio(ctx, host);
  else if (c.type === "sampler") lab = samplerStudio(ctx, host);
  else lab = generalStudio(ctx, host);
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
