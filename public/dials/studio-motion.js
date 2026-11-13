// The motion studio. The response is a drawing you drag: bezier handles on the curve, a
// spring's peak and its settle point, the delay and the end. Keyframes are diamonds on a
// timed track. A spacing chart shows how the element travels, and the code it writes
// (transition, @keyframes, WAAPI) is editable and reads back into the panel.
import { el } from "./dom.js";
import { clamp, same } from "./values.js";
import { analyze, motionAt, framesAt, sortFrames, toEasing } from "./motion.js";
import { translateOf } from "./figures.js";
import { s, fx, block, hero, field, chips, handle, fitSvg, keyHint } from "./kit.js";

const PRESETS = [
  { label: "Gentle", v: { mode: "spring", stiffness: 120, damping: 20, mass: 1, velocity: 0 } },
  { label: "Snappy", v: { mode: "spring", stiffness: 380, damping: 30, mass: 1, velocity: 0 } },
  { label: "Bouncy", v: { mode: "spring", stiffness: 170, damping: 9, mass: 1, velocity: 0 } },
  { label: "Heavy", v: { mode: "spring", stiffness: 140, damping: 22, mass: 3, velocity: 0 } },
  { label: "Ease out", v: { mode: "bezier", bezier: [0.16, 1, 0.3, 1] } },
  { label: "In-out", v: { mode: "bezier", bezier: [0.65, 0, 0.35, 1] } },
];
const P = { l: 46, r: 14, t: 18, b: 28 };

export function motionStudio(ctx, host) {
  const panel = ctx.panel,
    section = ctx.section,
    find = (...types) => section.controls.find((c) => types.includes(c.type));
  const mc = find("motion", "spring", "bezier"),
    kc = find("keyframes");
  const M = mc && asMotion(panel.context(mc.id), mc.type),
    K = kc && panel.context(kc.id);
  host.classList.add("k-studio", "km");
  host.dataset.layout = "own";
  host.dataset.studio = "motion";
  const mv = () => ({ mode: "spring", duration: 1000, delay: 0, bezier: [0.25, 0.1, 0.25, 1], stiffness: 170, damping: 20, mass: 1, velocity: 0, ...(M ? M.get() : {}) });
  const frames = () => (K ? sortFrames(K.get()) : [{ offset: 0, transform: "translateX(0px)" }, { offset: 1, transform: "translateX(100px)" }]);
  const editM = (fn, src = "studio-motion") => {
    if (!M) return;
    M.begin(src);
    M.change(fn(mv()));
    M.commit();
  };
  const cleanup = [];

  /* ---------- response: the curve you drag ---------- */
  const rsvg = s("svg", { class: "k-svg km-response", "aria-label": "Response curve. Drag the handles." }),
    rGrid = s("path", { class: "km-grid" }),
    rDelay = s("rect", { class: "km-delay" }),
    rCut = s("rect", { class: "km-cut" }),
    rArms = s("path", { class: "km-arm" }),
    rCurve = s("path", { class: "km-curve" }),
    rSettle = s("line", { class: "km-settle" }),
    rNow = s("line", { class: "km-now" }),
    rLabels = s("g", {}),
    chip = s("g", { class: "km-chip", visibility: "hidden" }),
    chipBox = s("rect", { rx: 3, height: 20 }),
    chipText = s("text", { y: 14 });
  chip.append(chipBox, chipText);
  rsvg.append(rGrid, rDelay, rCut, rArms, rSettle, rCurve, rNow, rLabels);
  let rs = { w: 1, h: 1 },
    span = 1600,
    yLo = -0.1,
    yHi = 1.2,
    frozen = false;
  const X = (ms) => P.l + (ms / span) * (rs.w - P.l - P.r),
    Y = (y) => P.t + ((yHi - y) / (yHi - yLo)) * (rs.h - P.t - P.b),
    iX = (px) => ((px - P.l) / (rs.w - P.l - P.r || 1)) * span,
    iY = (py) => yHi - ((py - P.t) / (rs.h - P.t - P.b || 1)) * (yHi - yLo);
  cleanup.push(fitSvg(rsvg, (w, h) => ((rs = { w, h }), draw())).destroy);
  const showChip = (x, y, text) => {
    chipText.textContent = text;
    rsvg.append(chip);
    // Measured, not estimated: the chip always holds its whole text.
    let tw = 0;
    try {
      tw = chipText.getComputedTextLength();
    } catch {}
    const w = Math.ceil(tw || text.length * 7) + 16;
    const cx = clamp(x + 12, 2, rs.w - w - 2),
      cy = clamp(y - 30, 2, rs.h - 24);
    chip.setAttribute("transform", `translate(${fx(cx)} ${fx(cy)})`);
    chipBox.setAttribute("width", w);
    chipText.setAttribute("x", 7);
    chip.setAttribute("visibility", "visible");
    rsvg.append(chip);
  };
  const hideChip = () => chip.setAttribute("visibility", "hidden");
  // A handle that shows its numbers in a chip while hovered, focused or dragged.
  const rHandle = (label, cls, move, keys, tip) => {
    let held = false;
    const h = handle(rsvg, {
      label,
      r: 5.5,
      cls,
      start: () => {
        held = frozen = true;
        M?.begin("studio-curve");
      },
      move: (x, y, e) => {
        M?.change(move(x, y, e, mv()));
        const p = h.pos;
        showChip(p[0], p[1], tip(mv()));
      },
      end: () => {
        held = frozen = false;
        M?.commit();
        hideChip();
        draw();
      },
      cancel: () => {
        held = frozen = false;
        M?.cancel();
        hideChip();
      },
      keys: (dx, dy, e) => {
        editM((v) => keys(dx, dy, v, e), "studio-curve-key");
        showChip(h.pos[0], h.pos[1], tip(mv()));
      },
    });
    h.pos = [0, 0];
    const at = h.at;
    h.at = (x, y) => {
      h.pos = [x, y];
      at(x, y);
    };
    h.node.addEventListener("pointerenter", () => showChip(h.pos[0], h.pos[1], tip(mv())));
    h.node.addEventListener("pointerleave", () => !held && document.activeElement !== h.node && hideChip());
    h.node.addEventListener("focus", () => showChip(h.pos[0], h.pos[1], tip(mv())));
    h.node.addEventListener("blur", () => !held && hideChip());
    cleanup.push(h.destroy);
    return h;
  };
  const r3 = (n) => Number(n.toFixed(3));
  const bez = [0, 1].map((i) =>
    rHandle(
      i ? "Second bezier handle" : "First bezier handle",
      "km-bez",
      (x, y, _e, v) => {
        const b = [...v.bezier];
        b[i * 2] = r3(clamp((iX(x) - v.delay) / v.duration, 0, 1));
        b[i * 2 + 1] = r3(clamp(iY(y), -1, 2));
        return { ...v, bezier: b };
      },
      (dx, dy, v) => {
        const b = [...v.bezier];
        b[i * 2] = r3(clamp(b[i * 2] + dx * 0.01, 0, 1));
        b[i * 2 + 1] = r3(clamp(b[i * 2 + 1] - dy * 0.01, -1, 2));
        return { ...v, bezier: b };
      },
      (v) => `x ${fx(v.bezier[i * 2], 2)}  y ${fx(v.bezier[i * 2 + 1], 2)}`,
    ),
  );
  // The spring's first peak: across sets when it arrives (stiffness), up and down sets how far it overshoots (damping).
  const springFrom = (v, peakMs, overshoot) => {
    const os = clamp(overshoot, 0.002, 0.9),
      lnos = Math.log(os),
      z = -lnos / Math.sqrt(Math.PI ** 2 + lnos ** 2),
      wd = Math.PI / clamp(peakMs / 1000, 0.03, 5),
      w = wd / Math.sqrt(1 - z * z),
      k = v.mass * w * w;
    return { ...v, stiffness: Number(clamp(k, 1, 2000).toFixed(1)), damping: Number(clamp(2 * z * Math.sqrt(k * v.mass), 0.1, 200).toFixed(2)) };
  };
  const peak = rHandle(
    "Spring peak: across for timing, up and down for overshoot",
    "km-peak is-accent",
    (x, y, _e, v) => springFrom(v, iX(x) - v.delay, iY(y) - 1),
    (dx, dy, v) => {
      const a = analyze(v);
      return springFrom(v, a.peakMs + dx * 10, a.overshoot / 100 - dy * 0.01);
    },
    (v) => {
      const a = analyze(v);
      return `peak ${a.peakMs} ms  +${fx(a.overshoot, 1)}%  k ${fx(v.stiffness, 0)} d ${fx(v.damping, 1)}`;
    },
  );
  const delayH = rHandle(
    "Delay",
    "km-edge",
    (x, _y, _e, v) => ({ ...v, delay: Math.round(clamp(iX(x), 0, 3000) / 10) * 10 }),
    (dx, _dy, v) => ({ ...v, delay: Math.round(clamp(v.delay + dx * 10, 0, 3000)) }),
    (v) => `delay ${v.delay} ms`,
  );
  const endH = rHandle(
    "Duration",
    "km-edge",
    (x, _y, _e, v) => ({ ...v, duration: Math.round(clamp(iX(x) - v.delay, 50, 6000) / 10) * 10 }),
    (dx, _dy, v) => ({ ...v, duration: Math.round(clamp(v.duration + dx * 10, 50, 6000)) }),
    (v) => `duration ${v.duration} ms`,
  );
  const mode = chips("Response", [{ value: "spring", label: "Spring" }, { value: "bezier", label: "Bezier" }], (m) => editM((v) => ({ ...v, mode: m }), "studio-mode"));

  /* ---------- path: keyframes on a timed track ---------- */
  const ksvg = s("svg", { class: "k-svg km-track", "aria-label": "Keyframes. Drag a diamond; double-click the track to add one." }),
    kGrid = s("path", { class: "km-grid" }),
    kPath = s("path", { class: "km-path" }),
    kNow = s("line", { class: "km-now" }),
    kLabels = s("g", {});
  ksvg.append(kGrid, kLabels, kPath, kNow);
  let ks = { w: 1, h: 1 },
    diamonds = [],
    kfrozen = null;
  const lo = kc?.min ?? -40,
    hi = kc?.max ?? 240;
  const KX = (o) => P.l + o * (ks.w - P.l - P.r),
    KY = (px) => 12 + ((hi - px) / (hi - lo || 1)) * (ks.h - 12 - 26),
    iKX = (x) => clamp((x - P.l) / (ks.w - P.l - P.r || 1), 0, 1),
    iKY = (y) => hi - ((y - 12) / (ks.h - 38 || 1)) * (hi - lo);
  cleanup.push(fitSvg(ksvg, (w, h) => ((ks = { w, h }), draw())).destroy);
  const setFrame = (list, i, offset, px) => {
    const f = list.map((x) => ({ ...x }));
    const first = i === 0,
      last = i === f.length - 1;
    if (!first && !last) f[i].offset = r3(clamp(offset, f[i - 1].offset + 0.01, f[i + 1].offset - 0.01));
    f[i].transform = withX(f[i].transform, Math.round(clamp(px, lo, hi)));
    return f;
  };
  const buildDiamonds = () => {
    diamonds.forEach((d) => d.destroy());
    diamonds = frames().map((_, i) => {
      const h = handle(ksvg, {
        label: `Keyframe ${i + 1}`,
        r: 6,
        cls: "km-key",
        start: () => {
          kfrozen = frames().length;
          K.begin("studio-keyframe");
        },
        move: (x, y, e) => {
          const f = frames();
          const px = e.shiftKey ? translateOf(f[i]) : iKY(y);
          K.change(setFrame(f, i, iKX(x), px));
        },
        end: () => {
          kfrozen = null;
          K.commit();
        },
        cancel: () => {
          kfrozen = null;
          K.cancel();
        },
        keys: (dx, dy) => {
          const f = frames();
          K.begin("studio-keyframe-key");
          K.change(setFrame(f, i, f[i].offset + dx * 0.01, translateOf(f[i]) - dy));
          K.commit();
        },
      });
      h.node.append(s("path", { class: "km-diamond", d: "M0 -6.5L6.5 0L0 6.5L-6.5 0Z" }));
      h.node.addEventListener("keydown", (e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && frames().length > 2 && i > 0 && i < frames().length - 1) {
          e.preventDefault();
          K.set(frames().filter((_, j) => j !== i));
          requestAnimationFrame(() => diamonds[Math.min(i, diamonds.length - 1)]?.node.focus());
        }
      });
      return h;
    });
  };
  ksvg.addEventListener("dblclick", (e) => {
    if (!K || e.target.closest(".k-handle")) return;
    const r = ksvg.getBoundingClientRect(),
      o = iKX(e.clientX - r.left),
      f = frames();
    if (f.some((x) => Math.abs(x.offset - o) < 0.02)) return;
    const here = framesAt(f, o, mv());
    K.set(sortFrames([...f, { offset: r3(o), transform: `translateX(${Math.round(here.x)}px)`, opacity: Number(here.opacity.toFixed(2)) }]));
  });

  /* ---------- loop range: two handles under the response; preview plays only that part ---------- */
  // Stored on a motion value as loopRange [from, to] (fractions of one iteration). A bare bezier or
  // spring control has no room for it, so there it lives with the studio.
  let localRange = null;
  const range = () => {
    const r = mv().loopRange ?? localRange;
    return Array.isArray(r) && r[1] > r[0] ? r : [0, 1];
  };
  const setRange = (a, b) => {
    const r = [r3(clamp(a, 0, 1)), r3(clamp(b, 0, 1))];
    if (r[1] - r[0] < 0.02) return;
    const whole = r[0] === 0 && r[1] === 1;
    if (M && mc.type === "motion")
      editM((v) => {
        const { loopRange: _, ...rest } = v;
        return whole ? rest : { ...rest, loopRange: r };
      }, "studio-loop");
    else (localRange = whole ? null : r), draw();
  };
  const rBand = s("rect", { class: "km-loop" }),
    kBand = s("rect", { class: "km-loop" });
  rsvg.insertBefore(rBand, rCurve);
  ksvg.insertBefore(kBand, kPath);
  const loopEdge = (which) => {
    const h = handle(rsvg, {
      label: which ? "Loop range end" : "Loop range start",
      r: 5,
      cls: "km-loop-edge",
      move: (x) => {
        const v = mv(),
          u = (iX(x) - v.delay) / v.duration,
          [a, b] = range();
        setRange(which ? a : Math.min(u, b - 0.02), which ? Math.max(u, a + 0.02) : b);
      },
      keys: (dx) => {
        const [a, b] = range();
        setRange(which ? a : a + dx * 0.01, which ? b + dx * 0.01 : b);
      },
    });
    h.node.append(s("path", { class: "km-loop-flag", d: which ? "M0 -9V9M0 -9H-7L0 -3" : "M0 -9V9M0 -9H7L0 -3" }));
    return h;
  };
  const loopA = loopEdge(0),
    loopB = loopEdge(1);
  cleanup.push(loopA.destroy, loopB.destroy);
  const loopNote = el("button", { type: "button", class: "km-loop-reset" });
  loopNote.addEventListener("click", () => setRange(0, 1));

  /* ---------- lanes: one row per animated value in the keyframes ---------- */
  const fnOf = (name) => (k) => {
    const m = new RegExp(`${name}\\(\\s*(-?[\\d.]+)`).exec(k.transform || "");
    return m ? Number(m[1]) : name === "scale" ? 1 : 0;
  };
  const withFn = (t = "", name, val) =>
    new RegExp(`${name}\\(`).test(t) ? t.replace(new RegExp(`${name}\\([^)]*\\)`), `${name}(${val})`) : `${t ? t + " " : ""}${name}(${val})`;
  const laneDefs = () => {
    const f = frames(),
      has = (name) => f.some((k) => new RegExp(`${name}\\(`).test(k.transform || ""));
    const out = [{ key: "opacity", label: "Opacity", lo: 0, hi: 1, get: (k) => k.opacity ?? 1, put: (k, v) => ({ ...k, opacity: Number(clamp(v, 0, 1).toFixed(2)) }), fmt: (v) => fx(v, 2), step: 0.01 }];
    if (has("rotate")) out.push({ key: "rotate", label: "Rotate", lo: -180, hi: 180, get: fnOf("rotate"), put: (k, v) => ({ ...k, transform: withFn(k.transform, "rotate", `${Math.round(v)}deg`) }), fmt: (v) => `${Math.round(v)}°`, step: 1 });
    if (has("scale")) out.push({ key: "scale", label: "Scale", lo: 0, hi: 2, get: fnOf("scale"), put: (k, v) => ({ ...k, transform: withFn(k.transform, "scale", Number(clamp(v, 0, 4).toFixed(2))) }), fmt: (v) => `${fx(v, 2)}×`, step: 0.01 });
    // Any other number a keyframe carries gets a lane too, scaled to the values it holds.
    const keys = [...new Set(f.flatMap((k) => Object.keys(k)))].filter((k) => !["offset", "opacity", "transform", "easing", "composite"].includes(k) && f.some((x) => Number.isFinite(x[k])));
    for (const key of keys) {
      const sc = keyable().find((c) => cssKey(c) === key);
      if (sc) {
        const lo = Number.isFinite(sc.min) ? sc.min : Math.min(0, ...f.map((k) => k[key]).filter(Number.isFinite)),
          hi = Number.isFinite(sc.max) ? sc.max : Math.max(1, ...f.map((k) => k[key]).filter(Number.isFinite)) * 1.25,
          unit = sc.unit === "deg" ? "°" : sc.unit || "";
        out.push({ key, control: sc, label: sc.label || sc.id, lo, hi, get: (k) => (Number.isFinite(k[key]) ? k[key] : panel.get(sc.id)), put: (k, v) => ({ ...k, [key]: Number(v.toFixed(sc.step && sc.step >= 1 ? 0 : 2)) }), fmt: (v) => `${fx(v, sc.step && sc.step >= 1 ? 0 : 2)}${unit}`, step: sc.step || (hi - lo) / 100 });
        continue;
      }
      const vals = f.map((k) => k[key]).filter(Number.isFinite),
        lo = Math.min(0, ...vals),
        hi = Math.max(1, ...vals) * 1.25;
      out.push({ key, label: key.replace(/[A-Z]/g, (m) => " " + m.toLowerCase()), lo, hi, get: (k) => (Number.isFinite(k[key]) ? k[key] : 0), put: (k, v) => ({ ...k, [key]: Number(v.toFixed(2)) }), fmt: (v) => fx(v, 2), step: (hi - lo) / 100 });
    }
    return out;
  };
  /** A lane's value at u, eased per segment like the x track. */
  const laneAt = (lane, f, u, v) => {
    if (!f.length) return lane.get({});
    if (u <= f[0].offset) return lane.get(f[0]);
    for (let i = 1; i < f.length; i++)
      if (u <= f[i].offset) {
        const a = lane.get(f[i - 1]),
          b = lane.get(f[i]),
          e = motionAt((u - f[i - 1].offset) / (f[i].offset - f[i - 1].offset || 1), v);
        return a + (b - a) * e;
      }
    return lane.get(f.at(-1));
  };
  const lanesBox = el("div", { class: "km-lanes" });
  // Any number in this section can be keyed on the timeline: its value is stored in each keyframe
  // under the control's id, drawn as a lane with the control's own range, and read out as it plays.
  // Stored as a custom property (--rotation), valid in CSS @keyframes and in WAAPI keyframes.
  const cssKey = (c) => "--" + String(c.id).replace(/[^\w-]/g, "-");
  const keyable = () => section.controls.filter((c) => c !== kc && ["number", "range", "angle"].includes(c.type));
  const keyRow = el("div", { class: "km-key-row" });
  const paintKeyRow = () => {
    const f = frames(),
      free = keyable().filter((c) => !f.some((k) => Number.isFinite(k[cssKey(c)])));
    keyRow.replaceChildren(
      ...(free.length ? [el("span", { class: "km-key-label", text: "Key a value on this timeline" })] : []),
      ...free.map((c) =>
        el("button", {
          type: "button",
          class: "kx-btn",
          text: `+ ${c.label || c.id}`,
          "aria-label": `Key ${c.label || c.id} on the timeline, starting from its value now`,
          onclick: () => {
            const now = panel.get(c.id);
            K.begin("studio-key-control");
            K.change(frames().map((k) => ({ ...k, [cssKey(c)]: now })));
            K.commit();
          },
        }),
      ),
    );
  };
  const unkey = (id) => {
    K.begin("studio-unkey-control");
    K.change(frames().map(({ [id]: _drop, ...k }) => k));
    K.commit();
  };
  let lanes = [],
    laneSig = "";
  const buildLanes = () => {
    lanes.forEach((l) => (l.diamonds.forEach((d) => d.destroy()), l.fit()));
    lanes = laneDefs().map((def) => {
      const svg = s("svg", { class: "k-svg km-lane-svg", "aria-label": `${def.label} lane. Drag a diamond up or down.` }),
        grid = s("path", { class: "km-grid" }),
        line = s("path", { class: "km-path" }),
        text = s("g", {});
      svg.append(grid, text, line);
      const lane = { def, svg, grid, line, text, size: { w: 1, h: 1 }, diamonds: [] };
      lane.LY = (val) => 6 + ((def.hi - val) / (def.hi - def.lo || 1)) * (lane.size.h - 12);
      lane.iLY = (y) => def.hi - ((y - 6) / (lane.size.h - 12 || 1)) * (def.hi - def.lo);
      lane.fit = fitSvg(svg, (w, h) => ((lane.size = { w, h }), draw())).destroy;
      lane.diamonds = frames().map((_, i) => {
        const h = handle(svg, {
          label: `${def.label} at keyframe ${i + 1}`,
          r: 5,
          cls: "km-key",
          start: () => ((kfrozen = frames().length), K.begin("studio-lane")),
          move: (_x, y) => K.change(frames().map((k, j) => (j === i ? def.put(k, clamp(lane.iLY(y), def.lo, def.hi)) : k))),
          end: () => ((kfrozen = null), K.commit()),
          cancel: () => ((kfrozen = null), K.cancel()),
          keys: (_dx, dy) => {
            K.begin("studio-lane-key");
            K.change(frames().map((k, j) => (j === i ? def.put(k, clamp(def.get(k) - dy * def.step, def.lo, def.hi)) : k)));
            K.commit();
          },
        });
        h.node.append(s("path", { class: "km-diamond", d: "M0 -5L5 0L0 5L-5 0Z" }));
        return h;
      });
      return lane;
    });
    lanesBox.replaceChildren(
      ...lanes.map((l) => {
        l.readout = el("output", { class: "km-lane-now" });
        return el("div", { class: "km-lane-row" + (l.def.control ? " is-control" : "") }, el("div", { class: "km-lane-head" }, el("span", { class: "km-lane-name", text: l.def.label }), l.readout, l.def.control ? el("button", { type: "button", class: "kx-btn km-unkey", text: "Remove lane", "aria-label": `Stop keying ${l.def.label}`, onclick: () => unkey(l.def.key) }) : null), l.svg);
      }),
      keyRow,
    );
  };
  cleanup.push(() => lanes.forEach((l) => (l.diamonds.forEach((d) => d.destroy()), l.fit())));

  /* ---------- spacing chart: where the element is, every 50 ms ---------- */
  const gsvg = s("svg", { class: "k-svg km-ghost", "aria-label": "Spacing chart: one tick for every 50 ms of travel" }),
    gLane = s("line", { class: "km-lane" }),
    gTicks = s("path", { class: "km-ticks" }),
    gStart = s("rect", { class: "km-ghost-start", width: 26, height: 26, rx: 4 }),
    gEnd = s("rect", { class: "km-ghost-end", width: 26, height: 26, rx: 4 }),
    gNow = s("rect", { class: "km-block", width: 26, height: 26, rx: 4 }),
    gText = s("g", {});
  gsvg.append(gLane, gTicks, gStart, gEnd, gNow, gText);
  let gs = { w: 1, h: 1 };
  cleanup.push(fitSvg(gsvg, (w, h) => ((gs = { w, h }), draw())).destroy);
  const GX = (px) => P.l + 13 + ((px - lo) / (hi - lo || 1)) * (gs.w - P.l - P.r - 26);
  const clock = el("output", { class: "km-clock" }),
    play = el("button", { type: "button", class: "km-play", "aria-pressed": "true", text: "Pause" });
  let playing = !matchMedia("(prefers-reduced-motion: reduce)").matches,
    t0 = performance.now(),
    tNow = 1,
    raf = 0;
  play.addEventListener("click", () => {
    playing = !playing;
    t0 = performance.now() - tNow * total();
    loop();
  });
  const total = () => {
    const v = mv();
    return v.delay + v.duration + 500;
  };
  const loop = () => {
    cancelAnimationFrame(raf);
    play.textContent = playing ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(playing));
    if (!playing) return placeNow();
    const tick = (now) => {
      if (!host.isConnected) return;
      const v = mv(),
        [a, b] = range();
      if (a === 0 && b === 1) tNow = ((now - t0) % total()) / total();
      else {
        const len = (b - a) * v.duration;
        tNow = (v.delay + a * v.duration + ((now - t0) % len)) / total();
      }
      placeNow();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  function placeNow() {
    const v = mv(),
      ms = tNow * total(),
      u = clamp((ms - v.delay) / v.duration, 0, 1),
      at = framesAt(frames(), u, v);
    gNow.setAttribute("x", GX(at.x) - 13);
    gNow.setAttribute("y", gs.h / 2 - 13);
    gNow.style.opacity = String(0.25 + 0.75 * at.opacity);
    const f = frames(),
      rot = f.some((k) => /rotate\(/.test(k.transform || "")) ? laneAt({ get: fnOf("rotate") }, f, u, v) : 0;
    // Every lane reads out its value at the playhead: keyed controls show what they would be now.
    for (const l of lanes) if (l.readout) l.readout.textContent = `${l.def.fmt(laneAt(l.def, f, u, v))} at ${Math.round(ms)} ms`;
    gNow.setAttribute("transform", rot ? `rotate(${fx(rot, 1)} ${fx(GX(at.x))} ${fx(gs.h / 2)})` : "");
    const nx = X(Math.min(ms, span));
    rNow.setAttribute("x1", nx);
    rNow.setAttribute("x2", nx);
    rNow.setAttribute("y1", P.t);
    rNow.setAttribute("y2", rs.h - P.b);
    const kx = KX(u);
    kNow.setAttribute("x1", kx);
    kNow.setAttribute("x2", kx);
    kNow.setAttribute("y1", 8);
    kNow.setAttribute("y2", ks.h - 22);
    clock.textContent = `${String(Math.round(ms)).padStart(4, " ")} ms`;
  }

  /* ---------- side: hero, presets, fields, code ---------- */
  const big = hero("Settles in");
  const presetGlyph = (v) => {
    const g = s("svg", { width: 56, height: 40, viewBox: "0 0 56 40", "aria-hidden": "true" });
    const mm = { duration: 1000, delay: 0, ...v };
    let d = "";
    for (let i = 0; i <= 40; i++) {
      const x = i / 40,
        y = motionAt(x, mm);
      d += `${i ? "L" : "M"}${fx(6 + x * 44)} ${fx(33 - clamp(y, -0.2, 1.4) * 24)}`;
    }
    g.append(s("path", { d: "M6 9H50", class: "km-pre-guide" }), s("path", { d, class: "km-pre-curve" }));
    return g;
  };
  const presets = chips("Presets", PRESETS.map((p) => ({ value: p.label, label: p.label })), (label) => {
    const p = PRESETS.find((x) => x.label === label);
    editM((v) => ({ ...v, ...structuredClone(p.v) }), "preset");
  }, { glyph: (label) => presetGlyph(PRESETS.find((x) => x.label === label).v) });
  presets.node.classList.add("km-presets");
  const F = (label, key, min, max, step, digits, unit = "") =>
    field(M || ctx, { label, min, max, step, digits, unit, get: (v) => ({ ...mv(), ...v })[key], put: (v, n) => ({ ...v, [key]: n }) });
  const B = (label, i, min, max) =>
    field(M || ctx, { label, min, max, step: 0.01, digits: 2, get: (v) => (v.bezier || [0.25, 0.1, 0.25, 1])[i], put: (v, n) => ({ ...v, bezier: Object.assign([...(v.bezier || [0.25, 0.1, 0.25, 1])], { [i]: n }) }) });
  const springFields = [F("Stiffness", "stiffness", 1, 1000, 1, 0), F("Damping", "damping", 0.1, 100, 0.1, 1), F("Mass", "mass", 0.1, 10, 0.1, 1), F("Velocity", "velocity", -50, 50, 0.1, 1)],
    bezierFields = [B("x1", 0, 0, 1), B("y1", 1, -1, 2), B("x2", 2, 0, 1), B("y2", 3, -1, 2)],
    timeFields = [F("Duration", "duration", 50, 6000, 10, 0, "ms"), F("Delay", "delay", 0, 3000, 10, 0, "ms")];
  const fieldsAll = [...springFields, ...bezierFields, ...timeFields];
  const shapeBox = el("div", { class: "k-fields" });
  const timeBox = el("div", { class: "k-fields" }, ...timeFields.map((f) => f.node));

  // Code: three tabs, editable; what you type reads back into the panel.
  let tab = "keyframes",
    typing = false,
    readTimer = 0;
  const codeTabs = chips("Code", [{ value: "transition", label: "Transition" }, { value: "keyframes", label: "@keyframes" }, { value: "waapi", label: "WAAPI" }], (t) => {
    tab = t;
    typing = false;
    draw();
  });
  const code = el("textarea", { class: "km-code", spellcheck: "false", rows: 9, "aria-label": "Motion code. Edit it to change the panel." }),
    codeNote = el("output", { class: "km-code-note" }),
    copy = el("button", { type: "button", class: "km-copy", text: "Copy" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.value);
      codeNote.textContent = "Copied.";
    } catch {
      code.select();
      codeNote.textContent = "Selected; press Ctrl C.";
    }
  });
  code.addEventListener("input", () => {
    typing = true;
    clearTimeout(readTimer);
    readTimer = setTimeout(() => {
      try {
        const read = panel.applyMotionCode(section.id, code.value);
        code.removeAttribute("aria-invalid");
        delete codeNote.dataset.state;
        codeNote.textContent = `Read back: ${read.motion?.mode === "spring" ? `spring ${read.motion.stiffness}/${read.motion.damping}` : read.motion?.bezier ? `bezier ${read.motion.bezier.join(", ")}` : "timing"}${read.frames ? `, ${read.frames.length} keyframes` : ""}.`;
      } catch (err) {
        code.setAttribute("aria-invalid", "true");
        codeNote.textContent = `Not read. ${err.message} The panel keeps the last motion that read cleanly.`;
        codeNote.dataset.state = "bad";
      }
    }, 250);
  });
  code.addEventListener("blur", () => {
    typing = false;
    draw();
  });
  code.addEventListener("keydown", (e) => e.stopPropagation());

  /* ---------- rail: the numbers, secondary ---------- */
  const table = el("table", { class: "km-table" });
  ctx.rail.append(
    block("Keyframes", table),
    keyHint(["Arrows", "move the focused handle or diamond"], ["Shift", "fine · Alt coarse"], ["Delete", "removes a middle keyframe"], ["Dbl-click", "the track adds one"]),
  );

  host.append(
    el(
      "div",
      { class: "k-main" },
      el("section", { class: "k-block" }, el("div", { class: "km-head" }, el("h3", { class: "k-title", text: "Response" }), el("div", { class: "km-playbar" }, loopNote, mode.node)), rsvg),
      kc ? el("section", { class: "k-block" }, el("h3", { class: "k-title" }, `${kc.label}`, el("small", { text: "offset across, translateX up" })), ksvg, lanesBox) : null,
      el("section", { class: "k-block" }, el("div", { class: "km-head" }, el("h3", { class: "k-title" }, "Spacing", el("small", { text: "one tick per 50 ms" })), el("div", { class: "km-playbar" }, clock, play)), gsvg),
    ),
    el(
      "div",
      { class: "k-side" },
      big.node,
      block("Presets", presets.node),
      el("section", { class: "k-block" }, el("h3", { class: "k-title", text: "Shape" }), shapeBox, timeBox),
      el("section", { class: "k-block" }, el("div", { class: "km-head" }, codeTabs.node, copy), code, codeNote),
    ),
  );

  /* ---------- drawing ---------- */
  let shownTab = null,
    shownMode = null,
    shownCount = -1;
  function draw() {
    const v = mv(),
      f = frames(),
      a = analyze(v),
      spring = v.mode === "spring";
    if (shownMode !== v.mode) {
      shownMode = v.mode;
      shapeBox.replaceChildren(...(spring ? springFields : bezierFields).map((x) => x.node));
    }
    if (K && shownCount !== f.length && kfrozen === null) {
      shownCount = f.length;
      buildDiamonds();
    }
    mode.set(v.mode);
    presets.set(PRESETS.find((p) => Object.entries(p.v).every(([k, x]) => same(x, v[k])))?.label ?? null);
    for (const x of fieldsAll) x.update();
    const settle = Number.isFinite(a.settleMs) ? a.settleMs : v.duration;
    big.set(Number.isFinite(a.settleMs) ? String(a.settleMs) : "never", "ms", spring ? (a.fits ? `fits ${v.duration} ms` : `cut at ${v.duration} ms`) : `${fx(a.overshoot, 1)}% over`, spring && !a.fits ? "bad" : "");
    // Response plot.
    if (!frozen) {
      span = Math.max(v.delay + v.duration, v.delay + (spring ? settle : 0)) * 1.08 + 40;
      let mn = 0,
        mx = 1;
      for (let i = 0; i <= 120; i++) {
        const y = motionAt(i / 120, v);
        mn = Math.min(mn, y);
        mx = Math.max(mx, y);
      }
      if (!spring) {
        mn = Math.min(mn, v.bezier[1], v.bezier[3]);
        mx = Math.max(mx, v.bezier[1], v.bezier[3]);
      }
      yLo = mn - 0.12;
      yHi = mx + 0.14;
    }
    if (rs.w > 10) {
      const step = niceStep(span);
      let g = `M${X(0)} ${Y(0)}H${rs.w - P.r}M${X(0)} ${Y(1)}H${rs.w - P.r}`;
      rLabels.replaceChildren();
      for (let ms = 0; ms <= span; ms += step) {
        g += `M${X(ms)} ${rs.h - P.b}v4`;
        rLabels.append(s("text", { x: X(ms), y: rs.h - P.b + 16, "text-anchor": "middle", text: ms === 0 ? "0" : `${ms}` }));
      }
      rLabels.append(s("text", { x: rs.w - P.r, y: rs.h - 2, "text-anchor": "end", text: "ms" }));
      for (const [y, t] of [[0, "start"], [1, "end"]]) rLabels.append(s("text", { x: P.l - 8, y: Y(y) + 3.5, "text-anchor": "end", text: t }));
      if (a.overshoot > 0.5) {
        const py = 1 + a.overshoot / 100;
        rLabels.append(s("text", { x: P.l - 8, y: Y(py) + 3.5, "text-anchor": "end", class: "k-strong", text: `+${fx(a.overshoot, 0)}%` }));
        g += `M${X(0)} ${Y(py)}H${rs.w - P.r}`;
      }
      rGrid.setAttribute("d", g);
      rDelay.setAttribute("x", X(0));
      rDelay.setAttribute("y", P.t);
      rDelay.setAttribute("width", Math.max(0, X(v.delay) - X(0)));
      rDelay.setAttribute("height", rs.h - P.t - P.b);
      if (v.delay > 0) rLabels.append(s("text", { x: X(0) + 4, y: Y(0) + 14, text: `delay ${v.delay}` }));
      const cutOn = spring && !a.fits;
      rCut.style.display = cutOn ? "" : "none";
      rCut.setAttribute("x", X(v.delay + v.duration));
      rCut.setAttribute("y", P.t);
      rCut.setAttribute("width", Math.max(0, rs.w - P.r - X(v.delay + v.duration)));
      rCut.setAttribute("height", rs.h - P.t - P.b);
      let d = `M${X(0)} ${Y(0)}H${X(v.delay)}`;
      const n = 160,
        end = spring ? Math.max(v.duration, settle) : v.duration;
      for (let i = 0; i <= n; i++) {
        const ms = (i / n) * end,
          y = spring ? motionAt(ms / v.duration, v) : motionAt(ms / v.duration, v);
        d += `L${fx(X(v.delay + ms), 1)} ${fx(Y(y), 1)}`;
      }
      rCurve.setAttribute("d", d);
      for (const h of bez) h.node.style.display = spring ? "none" : "";
      peak.node.style.display = spring ? "" : "none";
      if (!spring) {
        const p1 = [X(v.delay + v.bezier[0] * v.duration), Y(v.bezier[1])],
          p2 = [X(v.delay + v.bezier[2] * v.duration), Y(v.bezier[3])];
        rArms.setAttribute("d", `M${X(v.delay)} ${Y(0)}L${p1}M${X(v.delay + v.duration)} ${Y(1)}L${p2}`);
        bez[0].at(...p1);
        bez[1].at(...p2);
        bez[0].text(`x ${v.bezier[0]}, y ${v.bezier[1]}`);
        bez[1].text(`x ${v.bezier[2]}, y ${v.bezier[3]}`);
        rSettle.style.display = "none";
      } else {
        rArms.setAttribute("d", "");
        const pk = a.overshoot > 0.2 ? [a.peakMs, 1 + a.overshoot / 100] : [settle, motionAt(settle / v.duration, v)];
        peak.at(X(v.delay + pk[0]), Y(pk[1]));
        peak.text(`peak at ${a.peakMs} ms, ${fx(a.overshoot, 1)}% over`);
        rSettle.style.display = "";
        const sx = X(v.delay + settle);
        rSettle.setAttribute("x1", sx);
        rSettle.setAttribute("x2", sx);
        rSettle.setAttribute("y1", P.t);
        rSettle.setAttribute("y2", rs.h - P.b);
        rLabels.append(s("text", { x: sx + 5, y: rs.h - P.b - 6, class: "k-strong", text: `settles ${settle}` }));
      }
      delayH.at(X(v.delay), Y(0));
      delayH.text(`${v.delay} ms`);
      endH.at(X(v.delay + v.duration), Y(spring ? motionAt(1, v) : 1));
      endH.text(`${v.duration} ms`);
    }
    // Loop range.
    {
      const [a, b] = range(),
        whole = a === 0 && b === 1,
        xa = X(v.delay + a * v.duration),
        xb = X(v.delay + b * v.duration);
      for (const [band, x0, x1, y0, y1] of [
        [rBand, xa, xb, P.t, rs.h - P.b],
        [kBand, KX(a), KX(b), 8, ks.h - 26],
      ]) {
        band.setAttribute("x", fx(x0));
        band.setAttribute("width", fx(Math.max(0, x1 - x0)));
        band.setAttribute("y", fx(y0));
        band.setAttribute("height", fx(Math.max(0, y1 - y0)));
        band.style.display = whole ? "none" : "";
      }
      loopA.at(xa, rs.h - P.b);
      loopB.at(xb, rs.h - P.b);
      const ms = (u) => Math.round(v.delay + u * v.duration);
      loopA.text(`${ms(a)} ms`);
      loopB.text(`${ms(b)} ms`);
      loopNote.textContent = whole ? "Loop: whole" : `Loop ${ms(a)}–${ms(b)} ms · Whole`;
      loopNote.disabled = whole;
      loopNote.title = whole ? "Drag the flags under the curve to loop part of it" : "Play the whole motion again";
    }
    // Lanes.
    if (K) {
      const sig = laneDefs().map((d) => d.key).join() + ":" + f.length;
      if (sig !== laneSig && kfrozen === null) {
        laneSig = sig;
        buildLanes();
      }
      paintKeyRow();
      for (const lane of lanes) {
        const { def, size } = lane;
        if (size.w < 10) continue;
        lane.grid.setAttribute("d", `M${P.l} ${lane.LY(def.lo)}H${size.w - P.r}M${P.l} ${lane.LY(def.hi)}H${size.w - P.r}`);
        lane.text.replaceChildren(
          s("text", { x: P.l - 8, y: lane.LY(def.hi) + 4, "text-anchor": "end", text: def.fmt(def.hi) }),
          s("text", { x: P.l - 8, y: lane.LY(def.lo) + 1, "text-anchor": "end", text: def.fmt(def.lo) }),
        );
        let d = "";
        for (let i = 0; i <= 120; i++) {
          const u = i / 120;
          d += `${i ? "L" : "M"}${fx(KX(u) * 1, 1)} ${fx(lane.LY(laneAt(def, f, u, v)), 1)}`;
        }
        lane.line.setAttribute("d", d);
        f.forEach((k, i) => {
          const val = def.get(k);
          lane.diamonds[i]?.at(KX(k.offset), lane.LY(clamp(val, def.lo, def.hi)));
          lane.diamonds[i]?.text(`${def.label} ${def.fmt(val)} at ${fx(k.offset * 100, 0)}%`);
        });
      }
    }
    // Keyframe track.
    if (K && ks.w > 10) {
      let g = "";
      kLabels.replaceChildren();
      for (let i = 0; i <= 10; i++) {
        const x = KX(i / 10);
        g += `M${x} ${ks.h - 26}v${i % 5 ? 3 : 6}`;
        if (i % 5 === 0) kLabels.append(s("text", { x, y: ks.h - 8, "text-anchor": "middle", text: `${Math.round(v.delay + (i / 10) * v.duration)} ms` }));
      }
      for (const px of niceTicks(lo, hi, 4)) {
        g += `M${P.l} ${KY(px)}H${ks.w - P.r}`;
        kLabels.append(s("text", { x: P.l - 8, y: KY(px) + 3.5, "text-anchor": "end", text: `${px}` }));
      }
      kLabels.append(s("text", { x: P.l - 8, y: 10, "text-anchor": "end", text: "px" }));
      kGrid.setAttribute("d", g);
      let d = "";
      for (let i = 0; i <= 200; i++) {
        const u = i / 200;
        d += `${i ? "L" : "M"}${fx(KX(u), 1)} ${fx(KY(framesAt(f, u, v).x), 1)}`;
      }
      kPath.setAttribute("d", d);
      f.forEach((k, i) => {
        diamonds[i]?.at(KX(k.offset), KY(translateOf(k)));
        diamonds[i]?.text(`${fx(k.offset * 100, 0)}%, ${translateOf(k)} px, opacity ${k.opacity ?? 1}`);
      });
      table.replaceChildren(
        el("tr", {}, el("th", { text: "At" }), el("th", { text: "x" }), el("th", { text: "Opacity" })),
        ...f.map((k) => el("tr", {}, el("td", { text: `${Math.round(v.delay + k.offset * v.duration)} ms` }), el("td", { text: `${translateOf(k)} px` }), el("td", { text: fx(k.opacity ?? 1, 2) }))),
      );
    }
    // Spacing chart.
    if (gs.w > 10) {
      const mid = gs.h / 2;
      gLane.setAttribute("x1", GX(lo));
      gLane.setAttribute("x2", GX(hi));
      gLane.setAttribute("y1", mid + 24);
      gLane.setAttribute("y2", mid + 24);
      let t = "";
      for (let ms = 0; ms <= v.duration; ms += 50) {
        const x = GX(framesAt(f, ms / v.duration, v).x);
        t += `M${fx(x, 1)} ${mid + 18}v12`;
      }
      gTicks.setAttribute("d", t);
      const x0 = framesAt(f, 0, v).x,
        x1 = framesAt(f, 1, v).x;
      gStart.setAttribute("x", GX(x0) - 13);
      gEnd.setAttribute("x", GX(x1) - 13);
      for (const r of [gStart, gEnd]) r.setAttribute("y", mid - 13);
      gText.replaceChildren(
        s("text", { x: GX(x0), y: mid - 20, "text-anchor": "middle", text: `before · ${x0} px` }),
        s("text", { x: GX(x1), y: mid - 20, "text-anchor": "middle", text: `after · ${Math.round(x1)} px` }),
      );
      placeNow();
    }
    // Code.
    codeTabs.set(tab);
    // Code that did not read stays in the box with its note until it is fixed or the tab changes.
    if (!typing && (!code.hasAttribute("aria-invalid") || shownTab !== tab)) {
      shownTab = tab;
      code.value = panel.motionCode(section.id)[tab];
      code.removeAttribute("aria-invalid");
      delete codeNote.dataset.state;
      codeNote.textContent = tab === "transition" ? `Easing: ${toEasing(v).length > 60 ? "linear() with " + toEasing(v).split(",").length + " stops" : toEasing(v)}` : "Edit the code; the panel follows.";
    }
  }
  let pending = 0;
  const later = () => {
    if (!pending) pending = requestAnimationFrame(() => ((pending = 0), draw()));
  };
  const onPaint = (e) => {
    if (section.controls.some((c) => c.id === e.detail?.control)) later();
  };
  panel.addEventListener("paint", onPaint);
  draw();
  loop();
  return {
    update: later,
    destroy() {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(pending);
      clearTimeout(readTimer);
      panel.removeEventListener("paint", onPaint);
      cleanup.forEach((d) => d());
      diamonds.forEach((d) => d.destroy());
      fieldsAll.forEach((x) => x.destroy());
    },
  };
}
function withX(transform = "", x) {
  return /translateX\(/.test(transform) ? transform.replace(/translateX\([^)]*\)/, `translateX(${x}px)`) : `translateX(${x}px)${transform ? " " + transform : ""}`;
}
function niceStep(span) {
  const raw = span / 6,
    p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw);
}
function niceTicks(lo, hi, n) {
  const st = niceStep(((hi - lo) * 6) / n),
    out = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) out.push(v);
  return out;
}

/** A bezier control may hold just its four numbers, a spring control just its physics: show both as a motion. */
function asMotion(ctx, type) {
  if (type === "motion") return ctx;
  const wasArray = Array.isArray(ctx.get());
  return {
    ...ctx,
    get: () => {
      const v = ctx.get();
      return Array.isArray(v) ? { mode: "bezier", bezier: v, duration: 1000, delay: 0 } : { mode: type, ...v };
    },
    change: (v) => ctx.change(wasArray ? v.bezier : v),
  };
}
