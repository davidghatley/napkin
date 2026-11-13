// The sampler studio: the noise schedule drawn with the other schedulers behind it, the steps a
// partial denoise skips, how much noise each step removes, and the seeds a batch will use.
import { el } from "./dom.js";
import { clamp } from "./values.js";
import { schedule } from "./figures.js";
import { s, fx, block, hero, field, chips, handle, fitSvg, keyHint } from "./kit.js";

const CURVES = ["karras", "linear", "cosine"];
const P = { l: 40, r: 16, t: 14, b: 26 };

/**
 * A seed drawn as itself: its 32 bits, most significant first, as a 4 × 8 grid of filled and empty
 * cells in the canvas's text colour. It is not a picture of the image the seed would make; that
 * needs the generator (a host shows real outputs).
 */
export function paintSeed(canvas, seed) {
  const n = canvas.width,
    g = canvas.getContext("2d"),
    bits = ((Math.max(0, Math.floor(Number(seed) || 0)) >>> 0).toString(2)).padStart(32, "0"),
    ink = (canvas.isConnected && getComputedStyle(canvas).color) || "#222",
    cell = n / 8;
  g.clearRect(0, 0, n, n);
  for (let i = 0; i < 32; i++) {
    const x = (i % 8) * cell,
      y = Math.floor(i / 8) * cell * 2 + cell / 2;
    g.fillStyle = ink;
    g.strokeStyle = ink;
    g.globalAlpha = bits[i] === "1" ? 0.9 : 0.35;
    if (bits[i] === "1") g.fillRect(x + 1, y, cell - 2, cell);
    else g.strokeRect(x + 1.5, y + 0.5, cell - 3, cell - 1);
  }
  g.globalAlpha = 1;
}

export function samplerStudio(ctx, host) {
  host.classList.add("k-studio", "kx");
  host.dataset.layout = "own";
  const panel = ctx.panel;
  const v0 = () => ({ steps: 28, cfg: 7, shift: 1, scheduler: "karras", seed: 0, locked: true, denoise: 1, ...ctx.get() });
  const batch = () => (panel?.rows?.has("batch") ? clamp(panel.get("batch"), 1, 8) : 4);
  const edit = (fn, src = "studio-sampler") => {
    ctx.begin(src);
    ctx.change(fn(v0()));
    ctx.commit();
  };
  const cleanup = [];

  /* ---- the schedule ---- */
  const svg = s("svg", { class: "k-svg kx-plot", "aria-label": "Noise level at each step" }),
    grid = s("path", { class: "km-grid" }),
    skip = s("rect", { class: "kx-skip" }),
    ghosts = s("g", {}),
    curve = s("path", { class: "kx-curve" }),
    dots = s("path", { class: "kx-dots" }),
    labels = s("g", {});
  svg.append(grid, skip, ghosts, curve, dots, labels);
  let size = { w: 1, h: 1 };
  cleanup.push(fitSvg(svg, (w, h) => ((size = { w, h }), draw())).destroy);
  const X = (i, n) => P.l + (i / n) * (size.w - P.l - P.r),
    Y = (sg) => P.t + (1 - sg) * (size.h - P.t - P.b),
    iU = (x) => clamp((x - P.l) / (size.w - P.l - P.r || 1), 0, 1);
  const H = (label, cls, move, keys) => {
    const h = handle(svg, {
      label,
      r: 5.5,
      cls,
      start: () => ctx.begin("studio-sampler"),
      move: (x, y) => ctx.change(move(x, y, v0())),
      end: () => ctx.commit(),
      cancel: () => ctx.cancel(),
      keys: (dx, dy) => edit((v) => keys(dx, dy, v), "studio-sampler-key"),
    });
    cleanup.push(h.destroy);
    return h;
  };
  let dragSpan = 0;
  const stepsH = H(
    "Steps: drag the last step across",
    "km-edge",
    (x, _y, v) => ({ ...v, steps: Math.round(clamp(iU(x) * (dragSpan || v.steps), 1, 150)) }),
    (dx, _dy, v) => ({ ...v, steps: Math.round(clamp(v.steps + dx, 1, 150)) }),
  );
  stepsH.node.addEventListener("pointerdown", () => (dragSpan = Math.max(40, v0().steps * 1.6)));
  stepsH.node.addEventListener("pointerup", () => (dragSpan = 0));
  const denoiseH = H(
    "Denoise: where sampling starts",
    "is-accent",
    (x, _y, v) => ({ ...v, denoise: Number(clamp(1 - iU(x), 0, 1).toFixed(2)) }),
    (dx, _dy, v) => ({ ...v, denoise: Number(clamp(v.denoise - dx * 0.01, 0, 1).toFixed(2)) }),
  );
  const shiftH = H(
    "Time shift: drag the middle of the curve up or down",
    "",
    (_x, y, v) => {
      // At the middle step, sigma = s*shift / (1 + (shift-1)*s); solve for shift.
      const base = schedule(2, v.scheduler, 1)[1],
        want = clamp(1 - (y - P.t) / (size.h - P.t - P.b || 1), 0.02, 0.98);
      return { ...v, shift: Number(clamp((want * (1 - base)) / (base * (1 - want)), 0.1, 10).toFixed(2)) };
    },
    (_dx, dy, v) => ({ ...v, shift: Number(clamp(v.shift - dy * 0.05, 0.1, 10).toFixed(2)) }),
  );

  /* ---- per step ladder ---- */
  const ladder = s("svg", { class: "k-svg kx-ladder", "aria-label": "Noise removed by each step" }),
    bars = s("g", {}),
    ladderText = s("g", {});
  ladder.append(bars, ladderText);
  let ls = { w: 1, h: 1 };
  cleanup.push(fitSvg(ladder, (w, h) => ((ls = { w, h }), draw())).destroy);

  /* ---- seed tiles ---- */
  const tiles = el("div", { class: "kx-tiles" });
  const lock = el("button", { type: "button", class: "kx-btn", "aria-pressed": "true" }),
    roll = el("button", { type: "button", class: "kx-btn", text: "New seed" });
  lock.addEventListener("click", () => edit((v) => ({ ...v, locked: !v.locked }), "seed-lock"));
  roll.addEventListener("click", () => {
    const seed = Math.floor(Math.random() * 4294967295);
    edit((v) => ({ ...v, seed }), "seed-roll");
    if (panel?.rows?.has("seed")) panel.context("seed").set(seed);
  });

  /* ---- side ---- */
  const big = hero("Model evaluations");
  const glyph = (name) => {
    const g = s("svg", { width: 56, height: 40, viewBox: "0 0 56 40", "aria-hidden": "true" });
    const pts = schedule(20, name, 1);
    g.append(s("path", { class: "km-pre-curve", d: pts.map((sg, i) => `${i ? "L" : "M"}${fx(6 + (i / 20) * 44)} ${fx(34 - sg * 26)}`).join("") }));
    return g;
  };
  const sched = chips("Scheduler", CURVES.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })), (c) => edit((v) => ({ ...v, scheduler: c }), "scheduler"), { glyph });
  sched.node.classList.add("km-presets", "kx-scheds");
  const F = (label, key, min, max, step, digits) => field(ctx, { label, min, max, step, digits, get: (v) => ({ ...v0(), ...v })[key], put: (v, n) => ({ ...v, [key]: key === "steps" || key === "seed" ? Math.round(n) : n }) });
  const fields = [F("Steps", "steps", 1, 150, 1, 0), F("Guidance", "cfg", 0, 30, 0.1, 1), F("Time shift", "shift", 0.1, 10, 0.01, 2), F("Denoise", "denoise", 0, 1, 0.01, 2)],
    seedField = F("Seed", "seed", 0, 4294967295, 1, 0);
  const stats = el("div", { class: "k-stats" });
  ctx.rail.append(
    block("This run", stats),
    keyHint(["Arrows", "move the focused handle"], ["Shift", "fine · Alt coarse"], ["Enter", "on a bar types a number"]),
  );
  host.append(
    el(
      "div",
      { class: "k-main" },
      el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Noise schedule", el("small", { text: "sigma at each step; the other schedulers dashed" })), svg),
      el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Per step", el("small", { text: "noise each step removes" })), ladder),
    ),
    el(
      "div",
      { class: "k-side" },
      big.node,
      block("Scheduler", sched.node),
      el("section", { class: "k-block" }, el("h3", { class: "k-title", text: "Run" }), el("div", { class: "k-fields" }, ...fields.map((f) => f.node))),
      el(
        "section",
        { class: "k-block" },
        el("div", { class: "km-head" }, el("h3", { class: "k-title", text: "Seed" }), el("div", { class: "km-playbar" }, lock, roll)),
        el("div", { class: "k-fields k-one" }, seedField.node),
        tiles,
      ),
    ),
  );

  function draw() {
    const v = v0(),
      n = Math.max(1, Math.round(v.steps)),
      sig = schedule(n, v.scheduler, v.shift),
      start = Math.round(n * (1 - v.denoise));
    sched.set(v.scheduler);
    for (const f of [...fields, seedField]) f.update();
    const evals = Math.max(0, n - start) * (v.cfg > 1 ? 2 : 1);
    big.set(String(evals), "", v.cfg > 1 ? "guidance doubles each step" : "one pass per step", "quiet");
    lock.textContent = v.locked ? "Seed locked" : "Seed free";
    lock.setAttribute("aria-pressed", String(!!v.locked));
    if (size.w > 10) {
      let g = "";
      labels.replaceChildren();
      for (const q of [0, 0.5, 1]) {
        g += `M${P.l} ${Y(q)}H${size.w - P.r}`;
        labels.append(s("text", { x: P.l - 8, y: Y(q) + 3.5, "text-anchor": "end", text: q === 1 ? "σ max" : String(q) }));
      }
      const every = n > 60 ? 10 : n > 24 ? 5 : n > 10 ? 2 : 1;
      for (let i = 0; i <= n; i += every) {
        g += `M${X(i, n)} ${size.h - P.b}v4`;
        labels.append(s("text", { x: X(i, n), y: size.h - P.b + 16, "text-anchor": "middle", text: String(i) }));
      }
      labels.append(s("text", { x: size.w - P.r, y: size.h - 1, "text-anchor": "end", text: "step" }));
      grid.setAttribute("d", g);
      ghosts.replaceChildren();
      for (const name of CURVES.filter((c) => c !== v.scheduler)) {
        const o = schedule(n, name, v.shift);
        ghosts.append(s("path", { class: "kx-ghost", d: o.map((sg, i) => `${i ? "L" : "M"}${fx(X(i, n), 1)} ${fx(Y(sg), 1)}`).join("") }));
        const mid = Math.round(n * 0.3);
        ghosts.append(s("text", { class: "kx-ghost-label", x: X(mid, n) + 6, y: Y(o[mid]) - 6, text: name }));
      }
      curve.setAttribute("d", sig.map((sg, i) => `${i ? "L" : "M"}${fx(X(i, n), 1)} ${fx(Y(sg), 1)}`).join(""));
      dots.setAttribute("d", sig.map((sg, i) => (i >= start ? `M${fx(X(i, n), 1)} ${fx(Y(sg), 1)}h0` : "")).join(""));
      skip.setAttribute("x", P.l);
      skip.setAttribute("y", P.t);
      skip.setAttribute("width", Math.max(0, X(start, n) - P.l));
      skip.setAttribute("height", size.h - P.t - P.b);
      if (start > 0) labels.append(s("text", { x: P.l + 6, y: size.h - P.b - 8, text: `${start} kept from the source` }));
      stepsH.at(X(n, n), Y(sig[n]));
      stepsH.text(`${n} steps`);
      denoiseH.at(X(start, n), P.t);
      denoiseH.text(`denoise ${v.denoise}`);
      const mi = Math.round(n / 2);
      shiftH.at(X(mi, n), Y(sig[mi]));
      shiftH.text(`shift ${v.shift}`);
    }
    if (ls.w > 10) {
      bars.replaceChildren();
      ladderText.replaceChildren();
      const drops = sig.slice(1).map((sg, i) => sig[i] - sg),
        max = Math.max(...drops, 0.001),
        bw = (ls.w - P.l - P.r) / n,
        base = ls.h - 20;
      drops.forEach((d, i) => {
        const h = Math.max(1, (d / max) * (base - 6));
        bars.append(s("rect", { class: i < start ? "kx-bar is-skipped" : "kx-bar", x: fx(P.l + i * bw + bw * 0.15), y: fx(base - h), width: fx(Math.max(1, bw * 0.7)), height: fx(h) }));
      });
      const every = n > 60 ? 10 : n > 24 ? 5 : n > 10 ? 2 : 1;
      for (let i = 0; i < n; i += every) ladderText.append(s("text", { x: P.l + (i + 0.5) * bw, y: ls.h - 4, "text-anchor": "middle", text: String(i + 1) }));
      ladderText.append(s("text", { x: P.l - 8, y: base, "text-anchor": "end", text: "0" }));
      ladderText.append(s("text", { x: P.l - 8, y: 10, "text-anchor": "end", text: fx(max, 2) }));
    }
    const count = batch();
    while (tiles.children.length > count) tiles.lastElementChild.remove();
    while (tiles.children.length < count) {
      const c = Object.assign(document.createElement("canvas"), { width: 40, height: 40 });
      tiles.append(el("figure", { class: "kx-tile" }, c, el("figcaption")));
    }
    [...tiles.children].forEach((f, i) => {
      const seed = (v.seed + i) >>> 0;
      paintSeed(f.firstChild, seed);
      f.lastChild.textContent = String(seed);
    });
    stats.replaceChildren(
      ...[
        ["Runs", `${n - start} of ${n}`],
        ["Starts at", `σ ${fx(sig[start], 3)}`],
        ["Batch", `${count} images`],
      ].map(([k, t]) => el("div", { class: "k-stat" }, el("span", { text: k }), el("b", { text: t }))),
    );
  }
  draw();
  return {
    update: draw,
    destroy: () => {
      cleanup.forEach((d) => d());
      [...fields, seedField].forEach((f) => f.destroy());
    },
  };
}
