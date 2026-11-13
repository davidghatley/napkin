// The image studio: the picture with its crop, mask and before/after split drawn on it, and the
// tone curve drawn over the histogram it shapes. Everything is dragged on the drawings; the
// fields beside them are the same values as numbers.
import { el } from "./dom.js";
import { clamp } from "./values.js";
import { s, fx, block, hero, field, chips, handle, fitSvg, toneOf, adjust, keyHint } from "./kit.js";
import { sectionPicture, coverCanvas, holdFile, missingWords, pictureError } from "./sources.js";

const W = 480,
  H = 270,
  LINEAR = [0, 0.25, 0.5, 0.75, 1];
const LOOKS = [
  { label: "Neutral", v: { black: 0, white: 1, gamma: 1, exposure: 0, saturation: 1, curve: LINEAR } },
  { label: "Matte", v: { black: 0, white: 1, gamma: 1, exposure: 0, saturation: 0.85, curve: [0.12, 0.3, 0.52, 0.74, 0.94] } },
  { label: "Punch", v: { black: 0.05, white: 0.95, gamma: 1, exposure: 0, saturation: 1.3, curve: [0, 0.19, 0.5, 0.81, 1] } },
  { label: "Lifted", v: { black: 0, white: 1, gamma: 1.4, exposure: 0.1, saturation: 1, curve: LINEAR } },
  { label: "Mono", v: { black: 0.03, white: 0.97, gamma: 1.05, exposure: 0, saturation: 0, curve: [0, 0.22, 0.5, 0.78, 1] } },
  { label: "Low key", v: { black: 0.08, white: 1, gamma: 0.8, exposure: -0.4, saturation: 1.1, curve: LINEAR } },
];
const TONE_KEYS = ["black", "white", "gamma", "exposure", "saturation", "curve"];
const CROP = [
  ["nw", "Crop top left corner", ["cropLeft", "cropTop"]],
  ["n", "Crop top edge", ["cropTop"]],
  ["ne", "Crop top right corner", ["cropRight", "cropTop"]],
  ["e", "Crop right edge", ["cropRight"]],
  ["se", "Crop bottom right corner", ["cropRight", "cropBottom"]],
  ["s", "Crop bottom edge", ["cropBottom"]],
  ["sw", "Crop bottom left corner", ["cropLeft", "cropBottom"]],
  ["w", "Crop left edge", ["cropLeft"]],
];

export function imageStudio(ctx, host) {
  host.classList.add("k-studio", "ki");
  host.dataset.layout = "own";
  const v0 = () => ({ curve: LINEAR, ...ctx.get() });
  const put = (key) => (v, n) => ({ ...v, [key]: n });
  const enabled = () => ctx.panel?.rows?.has("enabled") ? ctx.panel.get("enabled") !== false : true;
  const edit = (fn, source = "studio-image") => {
    ctx.begin(source);
    ctx.change(fn(v0()));
    ctx.commit();
  };

  /* ---- the picture: the host's bytes for this section, or a plain note that there are none ---- */
  const assetC = ctx.section?.controls.find((x) => ["asset", "file"].includes(x.type));
  let source = null,
    split = 0.34,
    sourceName = "",
    srcData = null,
    small = null,
    dims = null,
    shownKey = null;
  const sourceW = () => dims?.[0],
    sourceH = () => dims?.[1];
  const missing = el("p", { class: "ki-missing", role: "note" });
  const loadPicture = () => {
    const got = ctx.panel ? sectionPicture(ctx.panel, ctx.section, () => (loadPicture(), render())) : null,
      name = assetC ? String(ctx.panel.get(assetC.id) || "") : "";
    const key = got ? got.name + (got.width || "") + (got.size || "") : got === undefined ? "loading" : "none:" + name;
    if (key === shownKey) return;
    shownKey = key;
    if (got && got.image) {
      source = coverCanvas(got, W, H);
      srcData = source.getContext("2d").getImageData(0, 0, W, H);
      small = coverCanvas(got, 160, 90).getContext("2d").getImageData(0, 0, 160, 90);
      sourceName = got.name;
      dims = [got.width, got.height];
      missing.hidden = true;
    } else {
      source = srcData = small = dims = null;
      sourceName = name || "no image";
      missing.hidden = false;
      missing.textContent = got === undefined ? `Reading ${name || "the image"}…` : missingWords(name, assetC && pictureError(ctx.panel, assetC, name));
    }
    paintLooks?.();
  };
  const out = new ImageData(W, H),
    pic = Object.assign(document.createElement("canvas"), { width: W, height: H }),
    picG = pic.getContext("2d");
  pic.setAttribute("role", "img");
  const over = s("svg", { class: "k-svg ki-over", "aria-label": "Crop, mask and before and after split" }),
    shade = s("path", { class: "ki-shade", "fill-rule": "evenodd" }),
    vignette = s("path", { class: "ki-vignette", "fill-rule": "evenodd" }),
    frame = s("rect", { class: "ki-frame" }),
    thirds = s("path", { class: "ki-thirds" }),
    ring = s("ellipse", { class: "ki-ring" }),
    splitLine = s("line", { class: "ki-split" }),
    beforeTag = s("text", { class: "ki-tag", text: "Before" }),
    afterTag = s("text", { class: "ki-tag", text: "After" });
  over.append(shade, vignette, thirds, frame, ring, splitLine, beforeTag, afterTag);
  const stage = el("div", { class: "ki-stage" }, pic, over, missing);
  let size = { w: 1, h: 1 };
  const fit = fitSvg(over, (w, h) => {
    size = { w, h };
    paintOverlay();
  });
  const cropHandles = CROP.map(([pos, label, keys]) => {
    const h = handle(over, {
      label,
      r: 5,
      cls: "ki-crop ki-crop-" + pos,
      start: () => ctx.begin("crop"),
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
      move: (x, y) => {
        const fxp = clamp(x / size.w, 0, 1),
          fyp = clamp(y / size.h, 0, 1),
          v = v0(),
          want = { cropLeft: fxp, cropRight: 1 - fxp, cropTop: fyp, cropBottom: 1 - fyp };
        for (const k of keys) v[k] = Number(clamp(want[k], 0, 0.95 - (v[opposite(k)] || 0)).toFixed(3));
        ctx.change(v);
      },
      keys: (dx, dy) =>
        edit((v) => {
          for (const k of keys) {
            const d = (k === "cropLeft" || k === "cropRight" ? dx : dy) * 0.01 * (k === "cropRight" || k === "cropBottom" ? -1 : 1);
            v[k] = Number(clamp((v[k] || 0) + d, 0, 0.95 - (v[opposite(k)] || 0)).toFixed(3));
          }
          return v;
        }, "crop-key"),
    });
    return { pos, keys, h };
  });
  const maskHandle = handle(over, {
    label: "Mask radius",
    r: 5,
    cls: "ki-mask",
    start: () => ctx.begin("mask"),
    end: () => ctx.commit(),
    cancel: () => ctx.cancel(),
    move: (x) => ctx.change({ ...v0(), mask: Number(clamp(Math.abs(x / size.w - 0.5) * 2, 0, 1).toFixed(3)) }),
    keys: (dx) => edit((v) => ({ ...v, mask: Number(clamp((v.mask || 0) + dx * 0.01, 0, 1).toFixed(3)) }), "mask-key"),
  });
  const splitHandle = handle(over, {
    label: "Before and after split",
    r: 7,
    cls: "ki-split-h",
    move: (x) => {
      split = clamp(x / size.w, 0, 1);
      render();
    },
    keys: (dx) => {
      split = clamp(split + dx * 0.02, 0, 1);
      render();
    },
  });
  splitHandle.node.append(s("path", { class: "ki-split-glyph", d: "M-2.5 -3 L-5 0 L-2.5 3 M2.5 -3 L5 0 L2.5 3" }));

  /* ---- the tone curve over its histogram ---- */
  const tone = s("svg", { class: "k-svg ki-tone", "aria-label": "Tone curve over the source histogram" }),
    toneGrid = s("path", { class: "ki-grid" }),
    histPath = s("path", { class: "ki-hist" }),
    ident = s("line", { class: "ki-ident" }),
    curvePath = s("path", { class: "ki-curve" }),
    levelsBar = s("rect", { class: "ki-levels", height: 6, rx: 1 }),
    gradId = "ki-grad-" + Math.random().toString(36).slice(2, 7),
    clipText = s("text", { class: "ki-clip" });
  tone.append(
    s("defs", {}, s("linearGradient", { id: gradId }, s("stop", { offset: 0, "stop-color": "#000" }), s("stop", { offset: 1, "stop-color": "#fff" }))),
    toneGrid,
    histPath,
    ident,
    curvePath,
    levelsBar,
    clipText,
  );
  levelsBar.setAttribute("fill", `url(#${gradId})`);
  let ts = { w: 1, h: 1 };
  const P = { l: 10, r: 10, t: 10, b: 34 };
  const tx = (x) => P.l + x * (ts.w - P.l - P.r),
    ty = (y) => P.t + (1 - y) * (ts.h - P.t - P.b),
    ix = (px) => clamp((px - P.l) / (ts.w - P.l - P.r || 1), 0, 1),
    iy = (py) => clamp(1 - (py - P.t) / (ts.h - P.t - P.b || 1), 0, 1);
  const tfit = fitSvg(tone, (w, h) => {
    ts = { w, h };
    paintTone();
  });
  const pointX = (v, i) => (v.black || 0) + ((v.white ?? 1) - (v.black || 0)) * (i / 4) ** (v.gamma || 1);
  const curveHandles = [0, 1, 2, 3, 4].map((i) =>
    handle(tone, {
      label: ["Curve shadows end", "Curve quarter tone", "Curve midtone", "Curve three-quarter tone", "Curve highlights end"][i],
      r: 5,
      cls: "ki-pt",
      start: () => ctx.begin("curve"),
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
      move: (_, y) => {
        const v = v0(),
          c = [...v.curve];
        c[i] = Number(iy(y).toFixed(3));
        ctx.change({ ...v, curve: c });
      },
      keys: (_, dy) =>
        edit((v) => {
          const c = [...v.curve];
          c[i] = Number(clamp(c[i] - dy * 0.01, 0, 1).toFixed(3));
          return { ...v, curve: c };
        }, "curve-key"),
    }),
  );
  const tri = (key, label, cls) => {
    const h = handle(tone, {
      label,
      r: 6,
      cls: "ki-tri " + cls,
      start: () => ctx.begin("levels"),
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
      move: (x) => ctx.change(levelAt(v0(), key, ix(x))),
      keys: (dx) => edit((v) => levelAt(v, key, (key === "gamma" ? pointX(v, 2) : v[key] ?? (key === "white" ? 1 : 0)) + dx * 0.01), "levels-key"),
    });
    h.node.append(s("path", { class: "ki-tri-shape", d: "M0 -5 L5.5 4 L-5.5 4 Z" }));
    return h;
  };
  const levelAt = (v, key, x) => {
    const b = v.black || 0,
      w = v.white ?? 1;
    if (key === "black") return { ...v, black: Number(clamp(x, 0, w - 0.02).toFixed(3)) };
    if (key === "white") return { ...v, white: Number(clamp(x, b + 0.02, 1).toFixed(3)) };
    // The grey point sits where the midtone lands: x = b + (w - b) * 0.5^gamma.
    const f = clamp((x - b) / (w - b || 1), 0.004, 0.996);
    return { ...v, gamma: Number(clamp(Math.log(f) / Math.log(0.5), 0.1, 5).toFixed(3)) };
  };
  const tris = { black: tri("black", "Black point", "is-black"), gamma: tri("gamma", "Grey point (gamma)", "is-grey"), white: tri("white", "White point", "is-white") };

  /* ---- side: hero, fields ---- */
  const big = hero("Midtone gamma");
  const readout = el("div", { class: "k-stats" });
  const mk = (label, key, min, max, step, digits, track) => field(ctx, { label, min, max, step, digits, track, get: (v) => v[key] ?? (key === "white" ? 1 : key === "saturation" ? 1 : key === "gamma" ? 1 : 0), put: put(key) });
  const tonal = [
    mk("Exposure", "exposure", -5, 5, 0.01, 2, "linear-gradient(90deg,#111,#888 50%,#fff)"),
    mk("Saturation", "saturation", 0, 3, 0.01, 2, "linear-gradient(90deg,#8a8a8a,#c8742f 33%,#ff5a00)"),
    mk("Black", "black", 0, 0.99, 0.01, 3, "linear-gradient(90deg,#000,#777)"),
    mk("White", "white", 0.01, 1, 0.01, 3, "linear-gradient(90deg,#777,#fff)"),
    mk("Gamma", "gamma", 0.1, 5, 0.01, 2),
  ];
  const cropFields = [
    mk("Left", "cropLeft", 0, 0.95, 0.01, 3),
    mk("Right", "cropRight", 0, 0.95, 0.01, 3),
    mk("Top", "cropTop", 0, 0.95, 0.01, 3),
    mk("Bottom", "cropBottom", 0, 0.95, 0.01, 3),
    mk("Mask radius", "mask", 0, 1, 0.01, 3),
  ];
  const fields = [...tonal, ...cropFields];
  const aspect = chips(
    "Crop to aspect",
    [
      { value: "free", label: "Free" },
      { value: 16 / 9, label: "16:9" },
      { value: 4 / 3, label: "4:3" },
      { value: 1, label: "1:1" },
      { value: 4 / 5, label: "4:5" },
    ],
    (r) => {
      if (r === "free") return aspect.set("free");
      edit((v) => cropTo(v, r), "crop-aspect");
    },
  );

  /* ---- source drop well ---- */
  const thumb = Object.assign(document.createElement("canvas"), { width: 112, height: 63 }),
    fileInput = el("input", { type: "file", accept: "image/*", class: "d-sr", tabindex: -1, "aria-label": "Image file" }),
    nameLine = el("span", { class: "ki-src-name" }),
    choose = el("button", { type: "button", text: "Choose an image" }),
    drop = el("div", { class: "k-drop" }, thumb, nameLine, choose, fileInput);
  choose.addEventListener("click", () => fileInput.click());
  const take = async (file) => {
    if (!file) return;
    try {
      // Check it decodes before holding it.
      (await createImageBitmap(file)).close?.();
    } catch {
      nameLine.textContent = "That file is not an image this browser can read.";
      return;
    }
    // The chosen file is held for its name: on the section's asset control, which now names it, or
    // on this image control when the section has none.
    holdFile(ctx.panel, (assetC || ctx.control).id, file);
    shownKey = null;
    if (assetC) ctx.panel.context(assetC.id).set(file.name);
    render();
  };
  fileInput.addEventListener("change", () => take(fileInput.files[0]));
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
    take(e.dataTransfer?.files?.[0]);
  });

  /* ---- rail: looks ---- */
  // Each look on the section's own picture; with no picture, the look's tone curve instead.
  const looks = LOOKS.map((look) => {
    const art = el("span", { class: "k-look-art" });
    const b = el("button", { type: "button", class: "k-look", "aria-pressed": "false" }, art, el("span", { text: look.label }));
    b.addEventListener("click", () => edit((v) => ({ ...v, ...structuredClone(look.v) }), "look"));
    return { b, look, art };
  });
  function paintLooks() {
    for (const { look, art } of looks) {
      if (small) {
        const c = Object.assign(document.createElement("canvas"), { width: 160, height: 90 }),
          d = new ImageData(160, 90);
        adjust(small, d, look.v, true);
        c.getContext("2d").putImageData(d, 0, 0);
        art.replaceChildren(c);
      } else {
        const t = toneOf({ curve: LINEAR, ...look.v });
        let d = "";
        for (let i = 0; i <= 32; i++) d += `${i ? "L" : "M"}${fx(8 + (i / 32) * 144, 1)} ${fx(82 - t(i / 32) * 74, 1)}`;
        art.replaceChildren(s("svg", { viewBox: "0 0 160 90", "aria-hidden": "true" }, s("path", { d: "M8 82H152V8", class: "ki-look-axis" }), s("path", { d, class: "ki-look-curve" })));
      }
    }
  }
  ctx.rail.append(
    block("Looks", el("div", { class: "k-looks" }, ...looks.map((x) => x.b))),
    keyHint(["Arrows", "move a focused handle or point"], ["Shift", "fine steps · Alt coarse"], ["Enter", "on a bar types a number"]),
  );

  host.append(
    el(
      "div",
      { class: "k-main" },
      block("Picture", stage),
      el("div", { class: "k-block" }, el("h3", { class: "k-title" }, "Tone curve", el("small", { text: "histogram of the source, levels below" })), tone),
    ),
    el(
      "div",
      { class: "k-side" },
      el("div", { class: "ki-hero-row" }, big.node, readout),
      block("Tone", el("div", { class: "k-fields" }, ...tonal.map((f) => f.node))),
      block("Crop and mask", aspect.node, el("div", { class: "k-fields" }, ...cropFields.map((f) => f.node))),
      block("Source", drop),
    ),
  );

  /* ---- drawing ---- */
  let hist = [];
  function render() {
    loadPicture();
    const v = v0(),
      on = enabled();
    const tk = thumb.getContext("2d");
    if (srcData) {
      hist = adjust(srcData, out, v, on);
      picG.putImageData(out, 0, 0);
      if (on && split > 0) picG.drawImage(source, 0, 0, W * split, H, 0, 0, W * split, H);
      tk.drawImage(source, 0, 0, W, H, 0, 0, 112, 63);
    } else {
      hist = [];
      picG.clearRect(0, 0, W, H);
      tk.clearRect(0, 0, 112, 63);
    }
    stage.classList.toggle("is-missing", !srcData);
    pic.setAttribute("aria-label", srcData ? `${sourceName}, ${on ? "adjusted" : "adjustments off"}` : missing.textContent);
    nameLine.textContent = sourceName;
    paintOverlay();
    paintTone();
    const g = v.gamma || 1;
    big.set(fx(g, 2), "", g > 1.02 ? "midtones lifted" : g < 0.98 ? "midtones deepened" : "neutral", g > 1.02 || g < 0.98 ? "" : "quiet");
    const t = toneOf(v),
      gain = 2 ** (v.exposure || 0),
      total = hist.reduce((a, b) => a + b, 0) || 1;
    let lo = 0,
      hi = 0;
    hist.forEach((n, i) => {
      const y = t(clamp(((i + 0.5) / hist.length) * gain, 0, 1));
      if (y <= 0.004) lo += n;
      if (y >= 0.996) hi += n;
    });
    // Kept size in the source's own pixels when known; otherwise as shares of the frame.
    const pw = source ? sourceW() : null,
      ph = source ? sourceH() : null,
      kw = 1 - (v.cropLeft || 0) - (v.cropRight || 0),
      kh = 1 - (v.cropTop || 0) - (v.cropBottom || 0),
      cw = pw ? Math.round(pw * kw) : Math.round(kw * 100),
      ch = ph ? Math.round(ph * kh) : Math.round(kh * 100);
    readout.replaceChildren(
      ...[
        ["Shadows clipped", srcData ? `${fx((lo / total) * 100, 1)}%` : "no pixels"],
        ["Highlights clipped", srcData ? `${fx((hi / total) * 100, 1)}%` : "no pixels"],
        ["Kept", pw ? `${cw} × ${ch} px` : `${cw}% × ${ch}%`],
      ].map(([k, n]) => el("div", { class: "k-stat" }, el("span", { text: k }), el("b", { text: n }))),
    );
    for (const f of fields) f.update();
    const ratio = (kw * W) / (kh * H || 1);
    aspect.set([16 / 9, 4 / 3, 1, 4 / 5].find((r) => Math.abs(r - ratio) < 0.01) ?? "free");
    for (const { b, look } of looks) b.setAttribute("aria-pressed", String(TONE_KEYS.every((k) => JSON.stringify(look.v[k]) === JSON.stringify(v[k] ?? (k === "curve" ? LINEAR : undefined)))));
  }
  function paintOverlay() {
    const v = v0(),
      { w, h } = size,
      l = (v.cropLeft || 0) * w,
      r = (1 - (v.cropRight || 0)) * w,
      t = (v.cropTop || 0) * h,
      b = (1 - (v.cropBottom || 0)) * h;
    shade.setAttribute("d", `M0 0H${w}V${h}H0Z M${l} ${t}V${b}H${r}V${t}Z`);
    frame.setAttribute("x", l);
    frame.setAttribute("y", t);
    frame.setAttribute("width", Math.max(0, r - l));
    frame.setAttribute("height", Math.max(0, b - t));
    const tw = (r - l) / 3,
      th = (b - t) / 3;
    thirds.setAttribute("d", `M${l + tw} ${t}V${b}M${l + 2 * tw} ${t}V${b}M${l} ${t + th}H${r}M${l} ${t + 2 * th}H${r}`);
    const m = v.mask || 0,
      rx = (m * w) / 2,
      ry = (m * h) / 2;
    ring.setAttribute("cx", w / 2);
    ring.setAttribute("cy", h / 2);
    ring.setAttribute("rx", rx);
    ring.setAttribute("ry", ry);
    ring.style.display = m > 0 ? "" : "none";
    vignette.setAttribute("d", m > 0 ? `M${l} ${t}H${r}V${b}H${l}Z M${w / 2 - rx} ${h / 2}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z` : "");
    maskHandle.at(w / 2 + Math.max(rx, 10), h / 2);
    maskHandle.text(m > 0 ? `${fx(m * 100, 0)}% of the frame` : "no mask");
    const px = { nw: [l, t], n: [(l + r) / 2, t], ne: [r, t], e: [r, (t + b) / 2], se: [r, b], s: [(l + r) / 2, b], sw: [l, b], w: [l, (t + b) / 2] };
    for (const { pos, keys, h: hd } of cropHandles) {
      hd.at(...px[pos]);
      hd.text(keys.map((k) => `${k.slice(4).toLowerCase()} ${fx((v[k] || 0) * 100, 1)}%`).join(", "));
    }
    const on = enabled() && split > 0,
      sx = split * w;
    for (const n of [splitLine, beforeTag, afterTag, splitHandle.node]) n.style.display = on ? "" : "none";
    splitLine.setAttribute("x1", sx);
    splitLine.setAttribute("x2", sx);
    splitLine.setAttribute("y1", 0);
    splitLine.setAttribute("y2", h);
    splitHandle.at(sx, h - 18);
    splitHandle.text(`${fx(split * 100, 0)}% shows the original`);
    beforeTag.setAttribute("x", sx - 8);
    beforeTag.setAttribute("y", 18);
    beforeTag.setAttribute("text-anchor", "end");
    afterTag.setAttribute("x", sx + 8);
    afterTag.setAttribute("y", 18);
  }
  function paintTone() {
    const v = v0(),
      { w, h } = ts;
    if (w < 10) return;
    const gx = [0.25, 0.5, 0.75].map((q) => `M${tx(q)} ${ty(0)}V${ty(1)}M${tx(0)} ${ty(q)}H${tx(1)}`).join("");
    toneGrid.setAttribute("d", gx + `M${tx(0)} ${ty(0)}H${tx(1)}V${ty(1)}H${tx(0)}Z`);
    const max = Math.max(1, ...hist);
    let d = `M${tx(0)} ${ty(0)}`;
    hist.forEach((n, i) => {
      const y = ty(0) - (Math.sqrt(n / max) * (ty(0) - ty(1))) * 0.92;
      d += `L${tx(i / hist.length)} ${y}L${tx((i + 1) / hist.length)} ${y}`;
    });
    histPath.setAttribute("d", d + `L${tx(1)} ${ty(0)}Z`);
    ident.setAttribute("x1", tx(0));
    ident.setAttribute("y1", ty(0));
    ident.setAttribute("x2", tx(1));
    ident.setAttribute("y2", ty(1));
    const t = toneOf(v);
    let c = "";
    for (let i = 0; i <= 96; i++) {
      const x = i / 96;
      c += `${i ? "L" : "M"}${fx(tx(x), 1)} ${fx(ty(t(x)), 1)}`;
    }
    curvePath.setAttribute("d", c);
    curveHandles.forEach((hd, i) => {
      hd.at(tx(pointX(v, i)), ty(v.curve[i]));
      hd.text(`output ${fx(v.curve[i] * 100, 0)}%`);
    });
    const by = h - 16;
    levelsBar.setAttribute("x", tx(0));
    levelsBar.setAttribute("y", by - 11);
    levelsBar.setAttribute("width", tx(1) - tx(0));
    tris.black.at(tx(v.black || 0), by);
    tris.black.text(fx(v.black || 0, 3));
    tris.white.at(tx(v.white ?? 1), by);
    tris.white.text(fx(v.white ?? 1, 3));
    tris.gamma.at(tx(pointX(v, 2)), by);
    tris.gamma.text(`gamma ${fx(v.gamma || 1, 2)}`);
    // Top left, clear of the level triangles along the bottom and of the curve's usual path.
    clipText.setAttribute("x", tx(0) + 4);
    clipText.setAttribute("y", 14);
    clipText.setAttribute("text-anchor", "start");
    clipText.textContent = `in ${fx(v.black || 0, 2)} · ${fx(v.gamma || 1, 2)} · ${fx(v.white ?? 1, 2)}`;
  }
  const onPaint = (e) => {
    if (e.detail?.control === "enabled" || e.detail?.control === assetC?.id) render();
  };
  ctx.panel?.addEventListener?.("paint", onPaint);
  render();
  return {
    update: render,
    destroy() {
      fit.destroy();
      tfit.destroy();
      ctx.panel?.removeEventListener?.("paint", onPaint);
      for (const f of fields) f.destroy();
      for (const { h } of cropHandles) h.destroy();
      for (const h of [maskHandle, splitHandle, ...curveHandles, ...Object.values(tris)]) h.destroy();
    },
  };
}
function opposite(k) {
  return { cropLeft: "cropRight", cropRight: "cropLeft", cropTop: "cropBottom", cropBottom: "cropTop" }[k];
}
/** Crop to an aspect ratio around the current crop's centre, as large as fits. */
function cropTo(v, ratio) {
  const cx = ((v.cropLeft || 0) + 1 - (v.cropRight || 0)) / 2,
    cy = ((v.cropTop || 0) + 1 - (v.cropBottom || 0)) / 2,
    pr = ratio / (W / H);
  let fw = 1,
    fh = 1 / pr;
  if (fh > 1) {
    fh = 1;
    fw = pr;
  }
  const l = clamp(cx - fw / 2, 0, 1 - fw),
    t = clamp(cy - fh / 2, 0, 1 - fh);
  const r3 = (n) => Number(clamp(n, 0, 0.95).toFixed(4));
  return { ...v, cropLeft: r3(l), cropRight: r3(1 - l - fw), cropTop: r3(t), cropBottom: r3(1 - t - fh) };
}
