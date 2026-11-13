// Instruments: the full-pane studio for any control that has no flagship lab.
//
// Every instrument is built in the same frame, so a studio is finished by construction:
//   main  - the stage: the value drawn large on what it changes, and dragged there;
//           then a strip of the same drawing at other values (click one to take it).
//   side  - the readout, typed fields, the value against its default, and this session's values.
// The stage is chosen by type, then by figure, then by the shape of the value, so a type the
// library has never seen still gets an instrument from its schema alone.
import { el, pointerSurface, filePick } from "./dom.js";
import { clamp, same, format, humane, looseJson, validateValue } from "./values.js";
import { figureMarkup, choiceGlyphs, hash } from "./figures.js";
import { s, fx, block, hero, field, handle, fitSvg, keyHint, stillLife, adjust, svgPoint, ariaNum } from "./kit.js";
import { motionAt } from "./motion.js";
import { parseColor, cssLch } from "./color.js";
import { paintSeed } from "./studio-sampler.js";
import { shapeOf } from "./shapes.js";
import { shapeStages } from "./instruments-shapes.js";

const instruments = new Map();
/** Register a stage for a control type: (api) => { node, draw(v), strip?, hero?, fields?, keys? }. */
export function registerInstrument(type, make) {
  instruments.set(type, make);
  return () => instruments.delete(type);
}

/* ---------- small helpers ---------- */
const niceStep = (span, parts = 6) => {
  const raw = Math.abs(span) / parts || 1,
    p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= raw);
};
const ceilNice = (n) => {
  const a = Math.abs(n) || 1,
    p = 10 ** Math.floor(Math.log10(a));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= a);
};
/** The range of a number: declared, or inferred from the value and default. */
export function rangeOf(c = {}, v = 0, d = c.default) {
  const top = Math.max(Math.abs(v || 0), Math.abs(typeof d === "number" ? d : 0), 1);
  const min = c.min ?? (v < 0 || d < 0 ? -ceilNice(top * 2) : 0),
    max = c.max ?? ceilNice(top * 2),
    step = c.step ?? niceStep(max - min, 100);
  return { min, max, step };
}
const digitsOf = (step) => clamp(Math.max(Math.ceil(-Math.log10(step || 1)), (String(step).split(".")[1] || "").length), 0, 4);
const blendModes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
const optionValue = (o) => (o && typeof o === "object" ? o.value : o);
const optionLabel = (o) => (o && typeof o === "object" ? o.label ?? String(o.value) : String(o));
const mini = (c, v) => {
  const span = el("span", { class: "ki-mini" });
  try {
    span.innerHTML = figureMarkup(c, v);
  } catch {
    span.textContent = "";
  }
  return span;
};
const svgStage = (label) => s("svg", { class: "k-svg ki-svg", role: "group", "aria-label": label });

/** What kind of instrument a control gets. */
export function kindOfInstrument(c, v = c.value) {
  if (instruments.has(c.type)) return c.type;
  const known = {
    number: "number",
    range: "number",
    angle: "angle",
    boolean: "boolean",
    select: "choice",
    segmented: "choice",
    text: "text",
    vector: "vector",
    gradient: "gradient",
    shadow: "shadow",
    spacing: "spacing",
    seed: "seed",
    asset: "asset",
    file: "asset",
  }[c.type];
  if (known) return known;
  if (c.options?.length) return "choice";
  // A type nobody declared: the shape of its value decides (a matrix, a palette, a date...).
  const shape = shapeOf(c, v);
  if (shape === "profile") return "list";
  if (shape) return shape;
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return "text";
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")) return "vector";
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return "list";
  if (v && typeof v === "object") return "record";
  return "text";
}

/* ---------- the frame ---------- */
export function instrument(ctx, host) {
  const c = ctx.control,
    panel = ctx.panel,
    kind = kindOfInstrument(c, ctx.get());
  host.classList.add("k-studio", "ki");
  host.dataset.layout = "own";
  host.dataset.instrument = kind;
  const cleanup = [];
  const api = {
    ctx,
    c,
    panel,
    section: ctx.section,
    cleanup,
    get: () => ctx.get(),
    edit(v, source = "studio") {
      ctx.begin(source);
      ctx.change(v);
      ctx.commit();
    },
    surface(node, handlers) {
      cleanup.push(pointerSurface(node, handlers));
    },
    handle(svg, spec) {
      const h = handle(svg, {
        ...spec,
        start: (e) => (spec.start ? spec.start(e) : ctx.begin("studio-handle")),
        end: (e) => (spec.end ? spec.end(e) : ctx.commit()),
        cancel: () => ctx.cancel(),
      });
      cleanup.push(h.destroy);
      return h;
    },
    fit(svg, onSize) {
      cleanup.push(fitSvg(svg, onSize).destroy);
    },
    /** Another control in the same section, by type or figure. */
    sibling: (...types) => ctx.section?.controls.find((x) => x.id !== c.id && (types.includes(x.type) || types.includes(x.figure))),
    later: () => later(),
  };
  const make = instruments.get(kind) || stages[kind] || shapeStages[kind] || stages.text;
  const st = make(api);

  // Main: stage, then the strip.
  const stageBlock = el(
    "section",
    { class: "k-block ki-stage-block" },
    el("h3", { class: "k-title" }, st.title || c.label || c.id, el("small", { text: st.note || "" })),
    st.node,
  );
  const strip = el("div", { class: "ki-strip", role: "radiogroup", "aria-label": `${c.label || c.id} at other values` });
  const stripBlock = st.strip ? el("section", { class: "k-block ki-strip-block" }, el("h3", { class: "k-title" }, st.stripTitle || "Across the range", el("small", { text: "click one to take it" })), strip) : null;
  strip.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const cells = [...strip.children],
      i = cells.indexOf(document.activeElement),
      next = cells[(i + d + cells.length) % cells.length];
    next?.focus();
    next?.click();
  });

  // Side: readout, fields, default, session.
  const big = hero(st.heroLabel || c.label || c.id),
    long = el("output", { class: "ki-long", "aria-label": `${c.label || c.id} value` }),
    readout = el("div", { class: "ki-readout" }, big.node, long);
  const fieldsBox = st.fields?.length ? el("div", { class: "k-fields" + (st.fields.length === 1 || st.fieldsColumns === 1 ? " k-one" : "") }, ...st.fields.map((f) => f.node)) : null;
  const was = el("figure", { class: "ki-compare-cell" }),
    now = el("figure", { class: "ki-compare-cell is-now" }),
    delta = el("p", { class: "ki-delta" }),
    reset = el("button", { type: "button", class: "kx-btn ki-reset", text: "Reset to default" });
  reset.addEventListener("click", () => panel.reset(c.id));
  const session = el("ul", { class: "ki-session", "aria-label": "Earlier values this session" });
  const history = (panel._instrumentHistory ??= new Map());
  if (!history.has(c.id)) history.set(c.id, [structuredClone(ctx.get())]);
  const onValue = (e) => {
    if (e.detail.control !== c.id || e.detail.phase !== "commit") return;
    const list = history.get(c.id).filter((x) => !same(x, e.detail.value));
    list.unshift(structuredClone(e.detail.value));
    history.set(c.id, list.slice(0, 8));
    paintSession();
  };
  panel.addEventListener("value", onValue);
  cleanup.push(() => panel.removeEventListener("value", onValue));
  // The default and the session only appear when they say something: a changed value, an earlier one.
  const changedBlock = block("Changed from its default", el("div", { class: "ki-compare" }, was, now), delta, reset),
    sessionBlock = el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Earlier this session", el("small", { text: "newest first; click to go back" })), session);
  changedBlock.classList.add("ki-changed");
  host.append(
    el("div", { class: "k-main" }, stageBlock, stripBlock),
    el(
      "div",
      { class: "k-side" },
      readout,
      st.side || null,
      fieldsBox ? block(st.fieldsTitle || "Value", fieldsBox) : null,
      changedBlock,
      sessionBlock,
    ),
  );
  ctx.rail.append(
    keyHint(...(st.keys || []), ["Ctrl Z", "undo · Ctrl Shift Z redo"], ["Escape", "back to the bench"]),
  );

  const caption = (v) => st.caption?.(v) ?? format(v, c);
  let shownSession = "";
  function paintSession() {
    const now = ctx.get(),
      earlier = history.get(c.id).filter((v) => !same(v, now)),
      key = JSON.stringify(earlier);
    sessionBlock.hidden = !earlier.length;
    if (key === shownSession) return;
    shownSession = key;
    session.replaceChildren(
      ...earlier.map((v) => {
        const b = el("button", { type: "button", class: "ki-cell", "aria-label": `Go back to ${caption(v)}` }, st.mini ? st.mini(v) : mini(c, v), el("span", { class: "ki-cell-text", text: caption(v) }));
        b.addEventListener("click", () => api.edit(structuredClone(v), "studio-history"));
        return el("li", {}, b);
      }),
    );
  }
  let shownStrip = "";
  function draw() {
    const v = ctx.get();
    st.draw(v);
    st.fields?.forEach((f) => f.update());
    const h = st.hero?.(v),
      showBig = !!h && h.value !== "";
    big.node.hidden = !showBig;
    if (showBig) big.set(h.value, h.unit || "", h.note || "", h.tone || "");
    long.textContent = h ? h.long ?? "" : caption(v);
    long.hidden = !long.textContent;
    const d = c.default ?? v;
    changedBlock.hidden = same(v, d);
    paintSession();
    if (changedBlock.hidden) return paintStrip(v);
    was.replaceChildren(st.mini ? st.mini(d) : mini(c, d), el("figcaption", {}, el("span", { text: "Default" }), el("b", { text: caption(d) })));
    now.replaceChildren(st.mini ? st.mini(v) : mini(c, v), el("figcaption", {}, el("span", { text: "Now" }), el("b", { text: caption(v) })));
    delta.textContent = same(v, d) ? "At its default." : st.delta?.(v, d) ?? "Changed from its default.";
    reset.disabled = same(v, d);
    paintStrip(v);
  }
  function paintStrip(v) {
    if (st.strip) {
      const samples = st.strip(v),
        key = JSON.stringify(samples);
      if (key !== shownStrip) {
        shownStrip = key;
        strip.replaceChildren(
          ...samples.map((x) => {
            const b = el("button", { type: "button", class: "ki-cell", role: "radio", "aria-checked": "false", tabindex: -1, "aria-label": `${c.label || c.id} ${caption(x.value ?? x)}` }, st.mini ? st.mini(x.value ?? x) : mini(c, x.value ?? x), el("span", { class: "ki-cell-text", text: x.label ?? caption(x) }));
            b._value = x.value ?? x;
            b.addEventListener("click", () => api.edit(structuredClone(b._value), "studio-strip"));
            return b;
          }),
        );
      }
      let any = false;
      for (const b of strip.children) {
        const on = same(b._value, v);
        any ||= on;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      }
      if (!any && strip.firstChild) strip.firstChild.tabIndex = 0;
    }
  }
  let pending = 0;
  function later() {
    if (!pending) pending = requestAnimationFrame(() => ((pending = 0), host.isConnected && draw()));
  }
  // Stages that draw on a sibling (the image, the motion) redraw when it changes.
  const onPaint = (e) => {
    if (e.detail?.control !== c.id && ctx.section?.controls.some((x) => x.id === e.detail?.control)) later();
  };
  panel.addEventListener("paint", onPaint);
  cleanup.push(() => panel.removeEventListener("paint", onPaint));
  draw();
  return {
    update: draw,
    destroy() {
      cancelAnimationFrame(pending);
      st.destroy?.();
      st.fields?.forEach((f) => f.destroy?.());
      cleanup.forEach((d) => d());
    },
  };
}

/* ---------- a ruler you drag: shared by numbers and record lanes ---------- */
function ruler(api, svg, { label, range, get, put, unit = "", y0 = () => 0, height = 64, paint }) {
  const g = s("g", { class: "ki-ruler" }),
    ticks = s("path", { class: "ki-ticks" }),
    track = s("rect", { class: "ki-track", rx: 3, height: 6 }),
    fill = s("rect", { class: "ki-fill", rx: 3, height: 6 }),
    ghost = s("path", { class: "ki-default" }),
    text = s("g", {}),
    hit = s("rect", { class: "ki-hit" });
  g.append(hit, ticks, track, fill, ghost, text);
  svg.append(g);
  const L = 20;
  let w = 1;
  const X = (n) => L + ((n - range().min) / (range().max - range().min || 1)) * (w - 2 * L),
    iX = (x) => range().min + clamp((x - L) / (w - 2 * L || 1), 0, 1) * (range().max - range().min);
  const snap = (n) => {
    const { min, step } = range();
    return Number((Math.round((n - min) / step) * step + min).toFixed(digitsOf(step) + 1));
  };
  const h = api.handle(svg, {
    label,
    r: 8,
    move: (x, _y, e) => api.ctx.change(put(api.get(), fine(e, x))),
    typed: (n, held) => {
      const { min, max } = range(),
        next = put(api.get(), clamp(n, min, max));
      held ? api.ctx.change(next) : api.edit(next, "studio-typed");
    },
    keys: (dx, dy, e) => {
      const { min, max, step } = range(),
        k = e.key === "PageUp" || e.key === "PageDown" ? 10 : 1;
      api.edit(put(api.get(), clamp(snap(get(api.get()) + (dx - dy) * step * k), min, max)), "studio-key");
    },
  });
  // Shift is fine: the pointer moves a tenth as far.
  let anchor = null;
  const fine = (e, x) => {
    if (!e?.shiftKey) {
      anchor = null;
      return clamp(snap(iX(x)), range().min, range().max);
    }
    anchor ??= { x, n: get(api.get()) };
    return clamp(snap(anchor.n + (iX(anchor.x + (x - anchor.x) * 0.1) - iX(anchor.x))), range().min, range().max);
  };
  h.node.addEventListener("keydown", (e) => {
    const { min, max } = range();
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      api.edit(put(api.get(), e.key === "Home" ? min : max), "studio-key");
    }
  });
  api.surface(hit, {
    start: (e) => {
      api.ctx.begin("studio-ruler");
      api.ctx.change(put(api.get(), fine(e, svgPoint(svg, e).x)));
    },
    move: (e) => api.ctx.change(put(api.get(), fine(e, svgPoint(svg, e).x))),
    end: () => api.ctx.commit(),
    cancel: () => api.ctx.cancel(),
  });
  return {
    size(width) {
      w = width;
    },
    draw(v) {
      const n = get(v),
        { min, max } = range(),
        y = y0(),
        mid = y + height - 22,
        step = niceStep(max - min, Math.max(2, Math.floor((w - 2 * L) / 70)));
      hit.setAttribute("x", 0);
      hit.setAttribute("y", y);
      hit.setAttribute("width", w);
      hit.setAttribute("height", height);
      let d = "";
      text.replaceChildren();
      for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) {
        d += `M${fx(X(t), 1)} ${mid - 10}v-6`;
        text.append(s("text", { x: X(t), y: mid + 26, "text-anchor": "middle", text: `${fx(t, digitsOf(step))}${unit}` }));
      }
      for (let t = Math.ceil(min / (step / 5)) * (step / 5); t <= max + 1e-9; t += step / 5) d += `M${fx(X(t), 1)} ${mid - 10}v-3`;
      ticks.setAttribute("d", d);
      for (const r of [track, fill]) {
        r.setAttribute("x", L);
        r.setAttribute("y", mid - 3);
      }
      track.setAttribute("width", Math.max(0, w - 2 * L));
      if (paint) track.setAttribute("fill", paint);
      const zero = clamp(0, min, max);
      fill.setAttribute("x", Math.min(X(zero), X(n)));
      fill.setAttribute("width", Math.abs(X(n) - X(zero)));
      const dv = get(api.c.default ?? v);
      ghost.setAttribute("d", typeof dv === "number" ? `M${fx(X(dv), 1)} ${mid + 5}l-4 6h8z` : "");
      h.at(X(clamp(n, min, max)), mid);
      h.text(`${format(n)}${unit}`);
      h.node.setAttribute("aria-valuenow", ariaNum(n));
      h.node.setAttribute("aria-valuemin", min);
      h.node.setAttribute("aria-valuemax", max);
    },
  };
}

/* ---------- a long list of options: find by typing, pick from a dense list ---------- */
function manyChoice(api) {
  const { c } = api,
    opts = c.options || [];
  const find = el("input", { type: "search", class: "ki-text-field ki-find", "aria-label": `Find in ${opts.length} options`, placeholder: `Find in ${opts.length} options`, spellcheck: "false" });
  const list = el("div", { class: "ki-options", role: "radiogroup", "aria-label": c.label });
  const count = el("p", { class: "ki-help", "aria-live": "polite" });
  const items = opts.map((o, i) => {
    const b = el("button", { type: "button", role: "radio", class: "ki-option", tabindex: -1, "aria-checked": "false" }, el("span", { text: optionLabel(o) }), el("small", { text: String(i + 1) }));
    b.addEventListener("click", () => api.edit(optionValue(o), "studio-option"));
    list.append(b);
    return { b, o, text: optionLabel(o).toLowerCase() + " " + String(optionValue(o)).toLowerCase() };
  });
  const visible = () => items.filter((x) => !x.b.hidden);
  const filter = () => {
    const q = find.value.trim().toLowerCase();
    let n = 0;
    for (const x of items) {
      x.b.hidden = !!q && !q.split(/\s+/).every((w) => x.text.includes(w));
      if (!x.b.hidden) n++;
    }
    count.textContent = q ? `${n} of ${opts.length} match` : `${opts.length} options`;
  };
  find.addEventListener("input", filter);
  find.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      const v = visible();
      if (e.key === "Enter" && v.length) api.edit(optionValue(v[0].o), "studio-option");
      (v.find((x) => x.b.getAttribute("aria-checked") === "true") || v[0])?.b.focus();
    }
  });
  list.addEventListener("keydown", (e) => {
    const v = visible(),
      i = v.findIndex((x) => x.b === document.activeElement),
      cols = Math.max(1, Math.round(list.clientWidth / (v[0]?.b.offsetWidth || 200))),
      d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, PageDown: cols * 6, PageUp: -cols * 6 }[e.key];
    if (e.key === "Home" || e.key === "End" || d) {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === "Home" ? v[0] : e.key === "End" ? v.at(-1) : v[clamp(i + d, 0, v.length - 1)];
      if (next) {
        api.edit(optionValue(next.o), "studio-key");
        next.b.focus();
      }
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      find.focus();
    }
  });
  filter();
  return {
    node: el("div", { class: "ki-many" }, find, count, list),
    note: "type to find; arrows walk the list",
    draw(v) {
      let any = null;
      for (const x of items) {
        const on = same(optionValue(x.o), v);
        x.b.setAttribute("aria-checked", String(on));
        x.b.tabIndex = on ? 0 : -1;
        if (on) any = x;
      }
      if (!any && items[0]) items[0].b.tabIndex = 0;
      if (any && !list.contains(document.activeElement)) {
        const top = any.b.offsetTop - list.offsetTop;
        if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - 32) list.scrollTop = top - list.clientHeight / 3;
      }
    },
    hero: (v) => {
      const i = opts.findIndex((o) => same(optionValue(o), v));
      return { value: "", long: optionLabel(opts[i] ?? v), note: `${i + 1} of ${opts.length}`, tone: "quiet" };
    },
    keys: [["Type", "find an option"], ["Arrows", "walk the list"]],
    caption: (v) => optionLabel(opts.find((o) => same(optionValue(o), v)) ?? v),
  };
}

/* ---------- stages ---------- */
const stages = {
  /** One colour of an undeclared type: the palette instrument over a list of one. */
  colour(api) {
    const one = { ...api, get: () => [api.get()], edit: (v, src) => api.edit(v[0] ?? api.get(), src), ctx: { ...api.ctx, get: () => [api.ctx.get()], change: (v) => api.ctx.change(v[0] ?? api.ctx.get()) } };
    const st = shapeStages.swatches(one);
    return { ...st, draw: (v) => st.draw([v]), hero: () => ({ value: "", long: api.get(), note: "", tone: "quiet" }), caption: (v) => v, mini: (v) => st.mini([v]) };
  },
  number(api) {
    const { c } = api,
      range = () => rangeOf(c, api.get()),
      unit = c.unit || "",
      figure = typeof c.figure === "string" ? c.figure : c.figure?.type;
    const svg = svgStage(`${c.label}: drag the ruler or the drawing`),
      subject = s("g", {});
    svg.append(subject);
    let size = { w: 1, h: 1 };
    const R = ruler(api, svg, {
      label: c.label || c.id,
      range,
      unit,
      get: (v) => v,
      put: (_v, n) => n,
      y0: () => size.h - 64,
    });
    api.fit(svg, (w, h) => {
      size = { w, h };
      R.size(w);
      draw(api.get());
    });
    const image = api.sibling("image");
    let photo = null;
    // Count: a grid of tiles; click one to set the count.
    const tiles = [];
    if (figure === "count") {
      const max = Math.min(64, range().max);
      for (let i = 0; i < max; i++) {
        const t = s("rect", { class: "ki-tile", rx: 3, tabindex: -1 });
        t.addEventListener("click", () => api.edit(i + 1, "studio-tile"));
        subject.append(t);
        tiles.push(t);
      }
    }
    // Radius: a corner handle you pull along the diagonal.
    const corner =
      figure === "radius"
        ? api.handle(svg, {
            label: `${c.label}: drag the corner`,
            r: 6,
            cls: "is-accent",
            move: (x, y) => {
              const b = box();
              api.ctx.change(clamp(Math.round(Math.min(x - b.x, y - b.y)), range().min, Math.min(range().max, b.h / 2)));
            },
            typed: (n, held) => (held ? api.ctx.change(clamp(n, range().min, range().max)) : api.edit(clamp(n, range().min, range().max), "studio-typed")),
            keys: (dx, dy) => api.edit(clamp(api.get() + dx - dy, range().min, range().max), "studio-key"),
          })
        : null;
    const box = () => {
      const h = Math.max(60, size.h - 64 - 40),
        w = Math.min(size.w - 80, h * 1.6);
      return { x: (size.w - w) / 2, y: 16, w, h };
    };
    function draw(v) {
      if (size.w < 10) return;
      R.draw(v);
      const b = box(),
        p = (v - range().min) / (range().max - range().min || 1);
      subject.querySelectorAll(".ki-drawn").forEach((n) => n.remove());
      const add = (tag, attrs) => {
        const n = s(tag, { ...attrs, class: `ki-drawn ${attrs.class || ""}` });
        subject.append(n);
        return n;
      };
      if (figure === "opacity") {
        add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "url(#ki-checker)", rx: 6 });
        for (let i = 0; i < 4; i++) add("rect", { x: b.x + 24, y: b.y + 24 + i * 16, width: (b.w - 48) * [0.8, 0.95, 0.6, 0.75][i], height: 6, rx: 3, class: "ki-page-line" });
        const ink = api.sibling("color");
        add("rect", { x: b.x + b.w * 0.3, y: b.y + b.h * 0.3, width: b.w * 0.6, height: b.h * 0.55, rx: 8, class: "ki-layer", "fill-opacity": v, style: ink ? `fill:${api.panel.get(ink.id)}` : "" });
        add("text", { x: b.x + b.w * 0.6, y: b.y + b.h * 0.6, "text-anchor": "middle", class: "ki-layer-text", "fill-opacity": Math.max(v, 0.08), text: `${Math.round(v * 100)}%` });
      } else if (figure === "radius") {
        if (image && !photo) photo = stillLife(320, 180);
        if (photo) {
          const id = `ki-clip-${c.id}`;
          let defs = svg.querySelector("defs.ki-clip");
          if (!defs) svg.prepend((defs = s("defs", { class: "ki-clip" })));
          defs.replaceChildren(s("clipPath", { id }, s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: v })));
          add("image", { href: photo.toDataURL(), x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#${id})` });
          add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: v, class: "ki-outline" });
        } else add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: v, class: "ki-card" });
        add("path", { d: `M${b.x} ${b.y + v}A${v} ${v} 0 0 1 ${b.x + v} ${b.y}`, class: "ki-arc" });
        add("path", { d: `M${b.x} ${b.y - 8}h${v}`, class: "ki-dim" });
        add("text", { x: b.x + v / 2, y: b.y - 12, "text-anchor": "middle", class: "k-strong", text: `${v}${unit}` });
        corner.at(b.x + v * (1 - Math.SQRT1_2), b.y + v * (1 - Math.SQRT1_2));
        corner.text(`${v}${unit}`);
      } else if (figure === "count") {
        const n = tiles.length,
          cols = Math.ceil(Math.sqrt(n * (b.w / b.h))),
          rows = Math.ceil(n / cols),
          cell = Math.min(b.w / cols, b.h / rows),
          x0 = (size.w - cols * cell) / 2;
        tiles.forEach((t, i) => {
          t.setAttribute("x", fx(x0 + (i % cols) * cell + 3));
          t.setAttribute("y", fx(b.y + Math.floor(i / cols) * cell + 3));
          t.setAttribute("width", fx(cell - 6));
          t.setAttribute("height", fx(cell - 6));
          t.classList.toggle("is-on", i < v);
        });
      } else {
        // The value as itself: a true-scale length, a time, a share, or a proportion.
        const y = b.y + b.h / 2;
        if (unit === "px") {
          // True size on the left, the same square enlarged on the right, with its scale.
          const top = Math.max(1, range().max),
            k = Math.max(1, Math.floor(Math.min(b.h * 0.8, (size.w - 160) / 2) / top)),
            big = Math.max(1, v * k),
            bx = size.w / 2 + 20,
            by = y - (top * k) / 2;
          add("rect", { x: size.w / 2 - 60 - Math.max(1, v), y: y - Math.max(1, v) / 2, width: Math.max(1, v), height: Math.max(1, v), rx: 1, class: "ki-layer" });
          add("text", { x: size.w / 2 - 60, y: y + top / 2 + 22, "text-anchor": "end", text: "true size" });
          add("rect", { x: bx, y: by, width: top * k, height: top * k, rx: 2, class: "ki-off" });
          add("rect", { x: bx, y: by + top * k - big, width: big, height: big, rx: 2, class: "ki-layer" });
          add("path", { d: `M${bx} ${by + top * k + 10}h${big}`, class: "ki-dim" });
          add("text", { x: bx, y: by + top * k + 26, class: "k-strong", text: `${v} px, drawn ${k}× against the ${top} px maximum` });
        } else if (unit === "ms" || unit === "s") {
          const ms = unit === "s" ? v * 1000 : v,
            span = ceilNice(Math.max(ms, 1) * 1.25),
            x1 = 40 + (ms / span) * (size.w - 80);
          add("path", { d: `M40 ${y}H${size.w - 40}`, class: "ki-dim" });
          add("rect", { x: 40, y: y - 10, width: Math.max(1, x1 - 40), height: 20, rx: 2, class: "ki-layer" });
          add("text", { x: 40, y: y + 30, text: "0" });
          add("text", { x: size.w - 40, y: y + 30, "text-anchor": "end", text: `${span} ms` });
        } else if (unit === "%") {
          const r = Math.min(b.h / 2, 90),
            a = clamp(p, 0, 0.9999) * Math.PI * 2;
          add("circle", { cx: size.w / 2, cy: y, r, class: "ki-dial" });
          add("path", { d: `M${size.w / 2} ${y}V${y - r}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${fx(size.w / 2 + r * Math.sin(a))} ${fx(y - r * Math.cos(a))}Z`, class: "ki-layer" });
        } else if (unit === "K") {
          // A colour temperature: the light it names, from warm to cool.
          const t = clamp((v - 1000) / 11000, 0, 1),
            hue = 40 + t * 200,
            light = `oklch(${fx(0.78 + t * 0.12)} ${fx(0.16 - Math.abs(t - 0.45) * 0.2 + 0.02)} ${fx(hue < 120 ? 60 - (1 - t) * 20 : 250)})`;
          add("circle", { cx: size.w / 2, cy: y, r: Math.min(b.h / 2, 90), fill: light, class: "ki-lamp" });
          add("text", { x: size.w / 2, y: y + 4, "text-anchor": "middle", class: "k-strong", text: v < 3500 ? "warm" : v < 5500 ? "neutral" : "cool" });
        } else {
          const n = 24;
          for (let i = 0; i < n; i++) {
            const on = (i + 0.5) / n <= p;
            add("rect", { x: fx(40 + (i * (size.w - 80)) / n + 1), y: y - 8 - i * 1.5, width: fx((size.w - 80) / n - 3), height: 16 + i * 3, rx: 2, class: on ? "ki-layer" : "ki-off" });
          }
        }
      }
    }
    // The checkerboard that opacity sits on.
    svg.prepend(s("defs", {}, s("pattern", { id: "ki-checker", width: 16, height: 16, patternUnits: "userSpaceOnUse" }, s("rect", { width: 16, height: 16, class: "ki-check-a" }), s("rect", { width: 8, height: 8, class: "ki-check-b" }), s("rect", { x: 8, y: 8, width: 8, height: 8, class: "ki-check-b" }))));
    const { min, max, step } = range();
    const samples = () => {
      const r = range();
      return Array.from({ length: 5 }, (_, i) => Number((r.min + ((r.max - r.min) * i) / 4).toFixed(digitsOf(r.step))));
    };
    return {
      node: svg,
      title: c.label,
      note: figure === "count" ? "click a tile to set the count" : figure === "radius" ? "drag the corner or the ruler" : "drag the ruler; Shift for fine",
      draw,
      strip: samples,
      hero: (v) => ({ value: format(v), unit, note: `of ${format(max)}${unit}` , tone: "quiet" }),
      fields: [field(api.ctx, { label: c.label || c.id, min, max, step, unit, digits: digitsOf(step), get: (v) => v, put: (_v, n) => n })],
      keys: [["Arrows", "step · Shift fine · Alt coarse"], ["Home End", "minimum · maximum"]],
      delta: (v, d) => `${v > d ? "+" : ""}${format(Number((v - d).toFixed(6)))}${unit} from ${format(d)}${unit}`,
    };
  },

  angle(api) {
    const { c } = api,
      min = c.min ?? -180,
      max = c.max ?? 180,
      step = c.step ?? 1;
    const svg = svgStage(`${c.label}: drag the needle`),
      ring = s("circle", { class: "ki-dial" }),
      out = s("path", { class: "ki-dead" }),
      arc = s("path", { class: "ki-arc-fill" }),
      ticks = s("path", { class: "ki-ticks" }),
      labels = s("g", {}),
      needle = s("path", { class: "ki-needle" }),
      object = s("path", { class: "ki-object" });
    svg.append(out, ring, arc, ticks, labels, needle, object);
    let size = { w: 1, h: 1 };
    const geo = () => ({ cx: size.w / 2, cy: size.h / 2, r: Math.max(40, Math.min(size.w, size.h) / 2 - 36) });
    const at = (deg, r) => {
      const g = geo(),
        a = (deg * Math.PI) / 180;
      return [g.cx + r * Math.sin(a), g.cy - r * Math.cos(a)];
    };
    const tip = api.handle(svg, {
      label: `${c.label}: drag around the dial; Shift snaps to 15 degrees`,
      r: 8,
      cls: "is-accent",
      move: (x, y, e) => {
        const g = geo();
        let deg = (Math.atan2(x - g.cx, g.cy - y) * 180) / Math.PI;
        // Keep turning past 180 in the direction the range allows.
        if (min >= 0 && deg < 0) deg += 360;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        api.ctx.change(clamp(Math.round(deg / step) * step, min, max));
      },
      typed: (n, held) => (held ? api.ctx.change(clamp(n, min, max)) : api.edit(clamp(n, min, max), "studio-typed")),
      keys: (dx, dy) => api.edit(clamp(api.get() + (dx - dy) * step, min, max), "studio-key"),
    });
    api.fit(svg, (w, h) => ((size = { w, h }), draw(api.get())));
    const arcPath = (a0, a1, r) => {
      const [x0, y0] = at(a0, r),
        [x1, y1] = at(a1, r);
      return `M${fx(x0)} ${fx(y0)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${fx(x1)} ${fx(y1)}`;
    };
    function draw(v) {
      if (size.w < 10) return;
      const g = geo();
      ring.setAttribute("cx", g.cx);
      ring.setAttribute("cy", g.cy);
      ring.setAttribute("r", g.r);
      out.setAttribute("d", max - min < 360 ? arcPath(max, min + 360, g.r) : "");
      arc.setAttribute("d", v === 0 ? "" : arcPath(0, v, g.r));
      let d = "";
      labels.replaceChildren();
      for (let a = 0; a < 360; a += 5) {
        const [x0, y0] = at(a, g.r + 4),
          [x1, y1] = at(a, g.r + (a % 45 ? 9 : 14));
        d += `M${fx(x0)} ${fx(y0)}L${fx(x1)} ${fx(y1)}`;
        if (a % 45 === 0) {
          const [tx, ty] = at(a, g.r + 26);
          labels.append(s("text", { x: tx, y: ty + 3.5, "text-anchor": "middle", text: `${a > 180 && min < 0 ? a - 360 : a}°` }));
        }
      }
      ticks.setAttribute("d", d);
      const [nx, ny] = at(v, g.r);
      needle.setAttribute("d", `M${g.cx} ${g.cy}L${fx(nx)} ${fx(ny)}`);
      const k = g.r * 0.42;
      object.setAttribute("d", `M0 ${-k}L${k * 0.42} ${-k * 0.3}H${k * 0.16}V${k}H${-k * 0.16}V${-k * 0.3}H${-k * 0.42}Z`);
      object.setAttribute("transform", `translate(${g.cx} ${g.cy}) rotate(${v})`);
      tip.at(nx, ny);
      tip.text(`${v} degrees`);
      tip.node.setAttribute("aria-valuenow", ariaNum(v));
    }
    const quarter = [-180, -90, -45, 0, 45, 90, 135, 180, 270, 360].filter((a) => a >= min && a <= max);
    return {
      node: svg,
      note: "the arrow turns as CSS rotate() would; Shift snaps",
      draw,
      strip: () => quarter.slice(0, 7),
      hero: (v) => ({ value: format(v), unit: "°", note: v % 360 === 0 ? "upright" : `${v > 0 ? "clockwise" : "counter-clockwise"}`, tone: "quiet" }),
      fields: [field(api.ctx, { label: "Degrees", min, max, step, unit: "deg", digits: digitsOf(step), get: (v) => v, put: (_v, n) => n })],
      keys: [["Arrows", "turn by one step · Shift fine"], ["Shift drag", "snap to 15°"]],
      delta: (v, d) => `${v > d ? "+" : ""}${format(v - d)}° from ${d}°`,
    };
  },

  boolean(api) {
    const { c } = api,
      figure = typeof c.figure === "string" ? c.figure : c.figure?.type;
    const node = el("div", { class: "ki-pair", role: "radiogroup", "aria-label": c.label });
    const panes = [false, true].map((state) => {
      const art = el("div", { class: "ki-pair-art" }),
        b = el("button", { type: "button", role: "radio", class: "ki-pair-pane", "aria-label": `${c.label} ${state ? "on" : "off"}` }, art, el("span", { class: "ki-pair-name" }, el("b", { text: state ? "On" : "Off" }), el("span", { class: "ki-pair-what" })));
      b.addEventListener("click", () => api.edit(state, "studio-pair"));
      node.append(b);
      const p = { b, art, state, what: b.querySelector(".ki-pair-what"), size: null };
      const ro = new ResizeObserver(([e]) => {
        const w = Math.round(e.contentRect.width),
          h = Math.round(e.contentRect.height);
        if (!w || !h || (p.size && p.size.w === w && p.size.h === h)) return;
        p.size = { w, h };
        drawArt(p);
      });
      ro.observe(art);
      api.cleanup.push(() => ro.disconnect());
      return p;
    });
    node.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const v = !api.get();
      api.edit(v, "studio-key");
      panes[Number(v)].b.focus();
    });
    const motion = api.sibling("motion", "spring", "bezier"),
      image = api.sibling("image"),
      source = image ? stillLife(320, 180) : null;
    const drawArt = (p) => {
      const on = p.state;
      if (figure === "split" && source) {
        const cv = Object.assign(document.createElement("canvas"), { width: 320, height: 180 }),
          g = cv.getContext("2d"),
          src = source.getContext("2d").getImageData(0, 0, 320, 180),
          out = g.createImageData(320, 180);
        adjust(src, out, api.panel.get(image.id), on);
        g.putImageData(out, 0, 0);
        p.art.replaceChildren(cv);
        p.what.textContent = on ? "the darkroom settings apply" : "the source as it was";
        return;
      }
      const W = Math.max(200, p.size?.w || 240),
        H = Math.max(120, p.size?.h || 140),
        svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "ki-pair-svg", "aria-hidden": "true" });
      const g = s("g", { transform: `translate(${(W - 240 * Math.min(W / 240, H / 140)) / 2} ${(H - 140 * Math.min(W / 240, H / 140)) / 2}) scale(${Math.min(W / 240, H / 140)})` });
      svg.append(g);
      svg.append = (...kids) => g.append(...kids);
      if (figure === "loop") {
        const mv = motion ? api.panel.get(motion.id) : { mode: "bezier", bezier: [0.2, 0.8, 0.2, 1], duration: 1000 };
        let d = "";
        const passes = on ? 3 : 1;
        for (let i = 0; i <= 180; i++) {
          const t = i / 180,
            pass = Math.min(passes - 1, Math.floor(t * 3)),
            u = t * 3 - pass;
          const y = pass < passes ? motionAt(Math.min(1, u), mv) : 1;
          d += `${i ? "L" : "M"}${fx(14 + t * 212)} ${fx(110 - clamp(on || t < 1 / 3 ? y : 1, -0.2, 1.3) * 70)}`;
        }
        svg.append(s("path", { d: "M14 110H226M14 40H226", class: "ki-grid-line" }), s("path", { d, class: "ki-curve" }));
        for (let i = 1; i < 3; i++) svg.append(s("path", { d: `M${14 + i * 70.7} 24V122`, class: on ? "ki-loop-mark" : "ki-grid-line" }));
        p.what.textContent = on ? "animation-iteration-count: infinite" : "animation-iteration-count: 1";
      } else if (figure === "labels") {
        const r = hash(7);
        for (let i = 0; i < 9; i++) {
          const x = 24 + i * 23 + r() * 6,
            y = 30 + r() * 80;
          svg.append(s("circle", { cx: fx(x), cy: fx(y), r: 4, class: "ki-dot" }));
          if (on) svg.append(s("text", { x: fx(x + 6), y: fx(y - 6), text: fx(10 + (110 - y) / 3, 0) }));
        }
        p.what.textContent = on ? "each mark names its value" : "marks only";
      } else {
        svg.append(s("rect", { x: 20, y: 30, width: 200, height: 80, rx: 40, class: on ? "ki-switch-on" : "ki-switch-off" }), s("circle", { cx: on ? 180 : 60, cy: 70, r: 30, class: "ki-switch-knob" }));
        p.what.textContent = on ? "enabled" : "disabled";
      }
      p.art.replaceChildren(svg);
    };
    return {
      node,
      note: "both states side by side; click one, or arrows",
      draw(v) {
        for (const p of panes) {
          p.b.setAttribute("aria-checked", String(p.state === !!v));
          p.b.tabIndex = p.state === !!v ? 0 : -1;
          drawArt(p);
        }
      },
      hero: (v) => ({ value: v ? "On" : "Off", note: panes[Number(!!v)].what.textContent, tone: "quiet" }),
      keys: [["Arrows", "switch · Space on a pane picks it"]],
      caption: (v) => (v ? "On" : "Off"),
    };
  },

  choice(api) {
    if ((api.c.options || []).length > 12) return manyChoice(api);
    const { c } = api,
      opts = c.options || [],
      figure = typeof c.figure === "string" ? c.figure : c.figure?.type,
      glyph = choiceGlyphs[figure] || choiceGlyphs[c.id],
      blends = opts.every((o) => blendModes.includes(optionValue(o)));
    const node = el("div", { class: "ki-cards", role: "radiogroup", "aria-label": c.label });
    const cards = opts.map((o, i) => {
      const value = optionValue(o),
        art = el("div", { class: "ki-card-art" });
      if (glyph) art.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${glyph(value, 0, 24, true)}</svg>`;
      else if (blends) art.append(el("div", { class: "ki-blend" }, el("i"), el("i", { style: `mix-blend-mode:${value}` })));
      else art.append(el("span", { class: "ki-card-word", text: optionLabel(o) }));
      const b = el("button", { type: "button", role: "radio", class: "ki-card-pick", "aria-label": `${c.label}: ${optionLabel(o)}` }, art, el("span", { class: "ki-card-name" }, el("b", { text: optionLabel(o) }), i < 9 ? el("kbd", { text: String(i + 1) }) : null));
      b.addEventListener("click", () => api.edit(value, "studio-card"));
      node.append(b);
      return { b, value };
    });
    node.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : null;
      if (!d && n === null) return;
      e.preventDefault();
      e.stopPropagation();
      const i = cards.findIndex((x) => same(x.value, api.get())),
        next = cards[n ?? (i + d + cards.length) % cards.length];
      if (!next) return;
      api.edit(next.value, "studio-key");
      next.b.focus();
    });
    return {
      node,
      note: blends ? "each mode drawn on two overlapping discs" : "every option drawn; click, arrows or its number",
      draw(v) {
        let any = false;
        for (const x of cards) {
          const on = same(x.value, v);
          any ||= on;
          x.b.setAttribute("aria-checked", String(on));
          x.b.tabIndex = on ? 0 : -1;
        }
        if (!any && cards[0]) cards[0].b.tabIndex = 0;
      },
      hero: (v) => ({ value: "", long: optionLabel(opts.find((o) => same(optionValue(o), v)) ?? v), note: `${opts.findIndex((o) => same(optionValue(o), v)) + 1} of ${opts.length}`, tone: "quiet" }),
      keys: [["Arrows", "next option"], ["1 to 9", "pick by number"]],
      caption: (v) => optionLabel(opts.find((o) => same(optionValue(o), v)) ?? v),
    };
  },

  text(api) {
    const { c } = api,
      prompt = /prompt/i.test(`${c.id} ${c.label} ${c.figure || ""}`);
    const area = el("textarea", { class: "ki-editor", spellcheck: "true", "aria-label": c.label, rows: 6 });
    const specimen = el("div", { class: "ki-specimen" });
    const tokens = el("div", { class: "ki-tokens", role: "listbox", "aria-label": "Words and their weights. Arrows up and down change a word's weight." });
    let typing = false;
    area.addEventListener("focus", () => {
      typing = true;
      api.ctx.begin("studio-text");
    });
    area.addEventListener("input", () => api.ctx.change(area.value));
    area.addEventListener("blur", () => {
      typing = false;
      api.ctx.commit();
    });
    area.addEventListener("keydown", (e) => e.stopPropagation());
    // Prompt weights in the common (word:1.2) form.
    const parts = (text) => {
      const out = [],
        re = /\(([^():]+):\s*([\d.]+)\)|([^\s,.()]+)/g;
      let m;
      while ((m = re.exec(text))) out.push({ at: m.index, end: re.lastIndex, word: (m[1] || m[3]).trim(), weight: m[1] ? Number(m[2]) : 1 });
      return out;
    };
    const reweigh = (i, delta) => {
      const text = api.get(),
        p = parts(text)[i];
      if (!p) return;
      const w = Number(clamp(p.weight + delta, 0.1, 2).toFixed(1)),
        piece = w === 1 ? p.word : `(${p.word}:${w})`;
      api.edit(text.slice(0, p.at) + piece + text.slice(p.end), "studio-weight");
      requestAnimationFrame(() => tokens.children[i]?.focus());
    };
    tokens.addEventListener("keydown", (e) => {
      const i = [...tokens.children].indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        reweigh(i, e.key === "ArrowUp" ? 0.1 : -0.1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        tokens.children[clamp(i + (e.key === "ArrowRight" ? 1 : -1), 0, tokens.children.length - 1)]?.focus();
      }
    });
    const below = prompt ? block("Words", el("p", { class: "ki-help", text: "Each word's weight as a bar. Focus one and press up or down; it is written back as (word:1.2)." }), tokens) : block("Set at three sizes", specimen);
    const node = el("div", { class: "ki-text" }, area, below);
    const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
    return {
      node,
      note: prompt ? "type, or weigh words below" : "type; it is set below as it will read",
      draw(v) {
        if (!typing && document.activeElement !== area) area.value = v;
        if (prompt) {
          const list = parts(v),
            focused = [...tokens.children].indexOf(document.activeElement);
          tokens.replaceChildren(
            ...list.map((p) =>
              el(
                "span",
                { class: "ki-token", role: "option", tabindex: 0, "aria-selected": "false", "aria-label": `${p.word}, weight ${p.weight}`, style: `--w:${fx(p.weight / 2)}` },
                el("span", { text: p.word }),
                el("i"),
                el("small", { text: fx(p.weight, 1) }),
              ),
            ),
          );
          if (focused >= 0) tokens.children[focused]?.focus();
        } else
          specimen.replaceChildren(
            ...[
              ["Caption", 11],
              ["Body", 15],
              ["Display", 32],
              ["Poster", 64],
            ].map(([name, px]) => el("div", { class: "ki-set" }, el("span", { text: `${name} ${px}px` }), el("p", { style: `font-size:${px}px`, text: v || " " }))),
          );
      },
      hero: (v) => ({ value: String(words(v)), unit: words(v) === 1 ? "word" : "words", note: `${v.length} characters · ${v.split("\n").length} ${v.split("\n").length === 1 ? "line" : "lines"}`, tone: "quiet", long: v }),
      keys: prompt ? [["Up Down", "on a word: weight ±0.1"], ["Left Right", "next word"]] : [["Tab", "leaves the editor"]],
      delta: (v, d) => `${v.length - d.length >= 0 ? "+" : ""}${v.length - d.length} characters against the default.`,
    };
  },

  vector(api) {
    const { c } = api,
      lo = c.min ?? -1,
      hi = c.max ?? 1,
      step = c.step ?? 0.01;
    const svg = svgStage(`${c.label}: drag the point`),
      gridP = s("path", { class: "ki-grid-line" }),
      axes = s("path", { class: "ki-axis" }),
      cross = s("path", { class: "ki-cross" }),
      labels = s("g", {}),
      pad = s("rect", { class: "ki-pad" });
    svg.append(pad, gridP, axes, cross, labels);
    let size = { w: 1, h: 1 };
    const box = () => {
      const side = Math.max(60, Math.min(size.w - 60, size.h - 40));
      return { x: (size.w - side) / 2, y: 14, side };
    };
    const X = (n) => box().x + ((n - lo) / (hi - lo)) * box().side,
      Y = (n) => box().y + ((hi - n) / (hi - lo)) * box().side;
    const put = (x, y) => [Number(clamp(lo + ((x - box().x) / box().side) * (hi - lo), lo, hi).toFixed(digitsOf(step))), Number(clamp(hi - ((y - box().y) / box().side) * (hi - lo), lo, hi).toFixed(digitsOf(step)))];
    const dot = api.handle(svg, {
      label: `${c.label}: arrows move x and y`,
      r: 8,
      cls: "is-accent",
      move: (x, y) => api.ctx.change(put(x, y)),
      keys: (dx, dy) => {
        const v = api.get();
        api.edit([clamp(Number((v[0] + dx * step).toFixed(6)), lo, hi), clamp(Number((v[1] - dy * step).toFixed(6)), lo, hi)], "studio-key");
      },
    });
    api.surface(pad, {
      start: (e) => {
        api.ctx.begin("studio-pad");
        const p = svgPoint(svg, e);
        api.ctx.change(put(p.x, p.y));
      },
      move: (e) => {
        const p = svgPoint(svg, e);
        api.ctx.change(put(p.x, p.y));
      },
      end: () => api.ctx.commit(),
      cancel: () => api.ctx.cancel(),
    });
    api.fit(svg, (w, h) => ((size = { w, h }), draw(api.get())));
    function draw(v) {
      if (size.w < 10) return;
      const b = box();
      Object.entries({ x: b.x, y: b.y, width: b.side, height: b.side, rx: 4 }).forEach(([k, n]) => pad.setAttribute(k, n));
      let d = "";
      for (let i = 0; i <= 10; i++) d += `M${fx(b.x + (i / 10) * b.side)} ${b.y}v${b.side}M${b.x} ${fx(b.y + (i / 10) * b.side)}h${b.side}`;
      gridP.setAttribute("d", d);
      axes.setAttribute("d", lo < 0 && hi > 0 ? `M${X(0)} ${b.y}v${b.side}M${b.x} ${Y(0)}h${b.side}` : "");
      cross.setAttribute("d", `M${X(v[0])} ${b.y}v${b.side}M${b.x} ${Y(v[1])}h${b.side}`);
      labels.replaceChildren(
        s("text", { x: b.x, y: b.y + b.side + 16, text: `x ${lo}` }),
        s("text", { x: b.x + b.side, y: b.y + b.side + 16, "text-anchor": "end", text: `${hi}` }),
        s("text", { x: b.x - 8, y: b.y + 8, "text-anchor": "end", text: `y ${hi}` }),
        s("text", { x: b.x - 8, y: b.y + b.side, "text-anchor": "end", text: `${lo}` }),
      );
      dot.at(X(v[0]), Y(v[1]));
      dot.text(`x ${v[0]}, y ${v[1]}`);
    }
    const m = (lo + hi) / 2;
    const F = (label, i) => field(api.ctx, { label, min: lo, max: hi, step, digits: digitsOf(step), get: (v) => v[i], put: (v, n) => Object.assign([...v], { [i]: n }) });
    return {
      node: svg,
      note: "drag anywhere on the pad",
      draw,
      strip: () => [[lo, hi], [m, hi], [hi, hi], [lo, m], [m, m], [hi, m], [lo, lo], [m, lo], [hi, lo]].map((v) => ({ value: v, label: `${fx(v[0])}, ${fx(v[1])}` })),
      stripTitle: "Corners and middles",
      hero: (v) => ({ value: `${fx(v[0])} ${fx(v[1])}`, note: "x  y", tone: "quiet" }),
      fields: [F("X", 0), F("Y", 1)],
      keys: [["Arrows", "move the point · Shift fine"]],
    };
  },

  gradient(api) {
    const { c } = api;
    const parse = (text) => {
      const m = /^\s*(linear|radial|conic)-gradient\((.*)\)\s*$/is.exec(text || "");
      const body = m ? m[2] : "90deg, #000, #fff",
        parts = [];
      let depth = 0,
        cur = "";
      for (const ch of body) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && !depth) {
          parts.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      parts.push(cur.trim());
      let angle = 180;
      if (/^-?[\d.]+deg$/.test(parts[0])) angle = parseFloat(parts.shift());
      else if (/^to /.test(parts[0])) angle = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 }[parts.shift()] ?? 180;
      const stops = parts.map((p, i) => {
        const pm = /^(.*?)\s+(-?[\d.]+)%$/.exec(p);
        return { color: pm ? pm[1] : p, at: pm ? Number(pm[2]) : Math.round((i / Math.max(1, parts.length - 1)) * 100) };
      });
      return { kind: m ? m[1] : "linear", angle, stops };
    };
    const write = (g) => `${g.kind}-gradient(${g.kind === "linear" ? `${g.angle}deg, ` : ""}${g.stops.map((x) => `${x.color} ${x.at}%`).join(", ")})`;
    let picked = 0;
    const band = el("div", { class: "ki-band" }),
      svg = s("svg", { class: "k-svg ki-stops", "aria-label": "Stops. Drag across; double-click the band to add one; Delete removes one." });
    let size = { w: 1, h: 1 };
    api.fit(svg, (w, h) => ((size = { w, h }), draw(api.get())));
    let handles = [];
    const rebuild = (n) => {
      handles.forEach((h) => h.node.remove());
      handles = Array.from({ length: n }, (_, i) => {
        const h = api.handle(svg, {
          label: `Stop ${i + 1}: arrows move it; Delete removes it`,
          r: 9,
          start: () => {
            picked = i;
            api.ctx.begin("studio-stop");
          },
          move: (x) => {
            const g = parse(api.get());
            g.stops[i].at = Math.round(clamp(((x - 12) / (size.w - 24)) * 100, 0, 100));
            api.ctx.change(write(g));
          },
          keys: (dx) => {
            picked = i;
            const g = parse(api.get());
            g.stops[i].at = Math.round(clamp(g.stops[i].at + dx, 0, 100));
            api.edit(write(g), "studio-key");
          },
        });
        h.node.addEventListener("focus", () => {
          picked = i;
          draw(api.get());
        });
        h.node.addEventListener("keydown", (e) => {
          const g = parse(api.get());
          if ((e.key === "Delete" || e.key === "Backspace") && g.stops.length > 2) {
            e.preventDefault();
            g.stops.splice(i, 1);
            picked = 0;
            api.edit(write(g), "studio-stop-remove");
          }
        });
        return h;
      });
    };
    band.addEventListener("dblclick", (e) => {
      const r = band.getBoundingClientRect(),
        at = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 100),
        g = parse(api.get()),
        after = g.stops.findIndex((x) => x.at > at),
        i = after < 0 ? g.stops.length : after;
      g.stops.splice(i, 0, { color: `color-mix(in oklch, ${g.stops[Math.max(0, i - 1)].color}, ${g.stops[Math.min(g.stops.length - 1, i)].color})`, at });
      picked = i;
      api.edit(write(g), "studio-stop-add");
    });
    // The picked stop's colour as lightness, chroma and hue.
    const lch = () => {
      try {
        return parseColor(parse(api.get()).stops[picked]?.color || "#000", api.ctx.host);
      } catch {
        return [0.5, 0.1, 250, 1];
      }
    };
    const setLch = (i, n) => {
      const g = parse(api.get()),
        v = lch();
      v[i] = n;
      g.stops[picked].color = cssLch(v);
      return write(g);
    };
    const colorCtx = { ...api.ctx, get: () => api.get(), change: (v) => api.ctx.change(v) };
    const LF = (label, i, min, max, step) => field(colorCtx, { label, min, max, step, digits: 3, get: () => lch()[i], put: (_v, n) => setLch(i, n) });
    const fields = [LF("Lightness", 0, 0, 1, 0.01), LF("Chroma", 1, 0, 0.37, 0.005), LF("Hue", 2, 0, 360, 1), field(api.ctx, { label: "Angle", min: 0, max: 360, step: 1, unit: "deg", digits: 0, get: (v) => parse(v).angle, put: (v, n) => write({ ...parse(v), angle: n }) })];
    const node = el("div", { class: "ki-gradient" }, band, svg);
    let shown = -1;
    function draw(v) {
      const g = parse(v);
      band.style.background = v;
      if (g.stops.length !== shown) {
        shown = g.stops.length;
        rebuild(shown);
      }
      picked = Math.min(picked, g.stops.length - 1);
      g.stops.forEach((x, i) => {
        const h = handles[i];
        if (!h || size.w < 10) return;
        h.at(12 + (x.at / 100) * (size.w - 24), size.h / 2);
        h.node.querySelector(".k-handle-dot").style.fill = x.color;
        h.node.classList.toggle("is-picked", i === picked);
        h.text(`${x.color} at ${x.at}%`);
      });
    }
    return {
      node,
      note: "drag a stop; double-click the band to add one",
      draw,
      strip: (v) => [0, 45, 90, 135, 180, 225, 270].map((a) => ({ value: write({ ...parse(v), angle: a }), label: `${a}°` })),
      stripTitle: "Directions",
      mini: (v) => el("span", { class: "ki-mini ki-mini-fill", style: `background:${v}` }),
      caption: (v) => `${parse(v).angle}° · ${parse(v).stops.length} stops`,
      hero: (v) => ({ value: String(parse(v).stops.length), unit: "stops", note: `${parse(v).angle}°`, tone: "quiet", long: v }),
      fields,
      fieldsTitle: "Picked stop",
      keys: [["Arrows", "on a stop: move it"], ["Delete", "removes the focused stop"], ["Dbl-click", "the band adds a stop"]],
    };
  },

  shadow(api) {
    const { c } = api;
    const stage = el("div", { class: "ki-shadow-stage" }),
      card = el("div", { class: "ki-shadow-card" }, el("span", { text: c.label })),
      svg = s("svg", { class: "k-svg ki-shadow-svg", "aria-label": "Shadow offset and blur. Drag the dot for offset and the ring for blur." }),
      link = s("path", { class: "ki-dim" }),
      ring = s("circle", { class: "ki-ring" });
    svg.append(link, ring);
    stage.append(card, svg);
    let size = { w: 1, h: 1 };
    api.fit(svg, (w, h) => ((size = { w, h }), draw(api.get())));
    const K = 3;
    const center = () => [size.w / 2, size.h / 2];
    const offset = api.handle(svg, {
      label: "Shadow offset: arrows move it",
      r: 7,
      cls: "is-accent",
      move: (x, y) => {
        const [cx, cy] = center();
        api.ctx.change({ ...api.get(), x: Math.round((x - cx) / K), y: Math.round((y - cy) / K) });
      },
      keys: (dx, dy) => {
        const v = api.get();
        api.edit({ ...v, x: Math.round(v.x + dx), y: Math.round(v.y + dy) }, "studio-key");
      },
    });
    const blur = api.handle(svg, {
      label: "Shadow blur: arrows change it",
      r: 6,
      move: (x) => {
        const [cx] = center(),
          v = api.get();
        api.ctx.change({ ...v, blur: Math.round(clamp((x - cx - v.x * K) / K, 0, 100)) });
      },
      keys: (dx, dy) => {
        const v = api.get();
        api.edit({ ...v, blur: clamp(v.blur + dx - dy, 0, 100) }, "studio-key");
      },
    });
    const css = (v) => `${v.x}px ${v.y}px ${v.blur}px ${v.spread || 0}px ${v.color || "#0004"}`;
    function draw(v) {
      card.style.boxShadow = css(v);
      if (size.w < 10) return;
      const [cx, cy] = center(),
        ox = cx + v.x * K,
        oy = cy + v.y * K;
      link.setAttribute("d", `M${cx} ${cy}L${ox} ${oy}`);
      ring.setAttribute("cx", ox);
      ring.setAttribute("cy", oy);
      ring.setAttribute("r", Math.max(2, v.blur * K));
      offset.at(ox, oy);
      offset.text(`${v.x}, ${v.y} px`);
      blur.at(ox + Math.max(2, v.blur * K), oy);
      blur.text(`${v.blur} px blur`);
    }
    const F = (label, key, min, max) => field(api.ctx, { label, min, max, step: 1, unit: "px", digits: 0, get: (v) => v[key] ?? 0, put: (v, n) => ({ ...v, [key]: n }) });
    const colorIn = el("input", { type: "text", class: "ki-text-field", "aria-label": "Shadow colour", spellcheck: false });
    colorIn.addEventListener("change", () => {
      try {
        parseColor(colorIn.value, api.ctx.host);
        colorIn.removeAttribute("aria-invalid");
        api.edit({ ...api.get(), color: colorIn.value }, "studio-color");
      } catch {
        colorIn.setAttribute("aria-invalid", "true");
      }
    });
    colorIn.addEventListener("keydown", (e) => e.stopPropagation());
    const colorField = { node: el("label", { class: "ki-field-wide" }, el("span", { text: "Colour (any CSS colour)" }), colorIn), update: () => document.activeElement !== colorIn && (colorIn.value = api.get().color || "#0004") };
    return {
      node: stage,
      note: "drag the dot to move the shadow, the ring to soften it",
      draw,
      strip: (v) =>
        [0, 0.5, 1, 2, 3].map((k) => ({
          value: { ...v, x: Math.round((v.x || 0) * k), y: Math.round((v.y || 4) * k), blur: Math.round((v.blur || 8) * k) },
          label: k === 0 ? "flat" : `${k}×`,
        })),
      stripTitle: "Lift",
      mini: (v) => el("span", { class: "ki-mini ki-mini-shadow" }, el("i", { style: `box-shadow:${css(v)}` })),
      caption: (v) => `${v.x} / ${v.y} / ${v.blur}px`,
      hero: (v) => ({ value: String(v.blur), unit: "px blur", note: `offset ${v.x}, ${v.y}`, tone: "quiet", long: `box-shadow: ${css(v)}` }),
      fields: [F("X", "x", -100, 100), F("Y", "y", -100, 100), F("Blur", "blur", 0, 100), F("Spread", "spread", -50, 100), colorField],
      keys: [["Arrows", "on the dot: offset · on the ring: blur"]],
    };
  },

  spacing(api) {
    const { c } = api,
      sides = ["Top", "Right", "Bottom", "Left"];
    const svg = svgStage(`${c.label}: drag an edge`),
      outer = s("rect", { class: "ki-pad" }),
      bands = s("path", { class: "ki-band-fill" }),
      inner = s("rect", { class: "ki-content" }),
      text = s("g", {});
    svg.append(outer, bands, inner, text);
    let size = { w: 1, h: 1 },
      linked = false;
    api.fit(svg, (w, h) => ((size = { w, h }), draw(api.get())));
    const K = () => Math.min(4, Math.max(0.5, Math.min(size.w, size.h) / 160));
    const geo = (v) => {
      const k = K(),
        [t, r, b, l] = v.map((n) => Math.min(n, 120) * k),
        cw = Math.max(80, size.w * 0.32),
        ch = Math.max(40, size.h * 0.22),
        w = l + cw + r,
        h = t + ch + b;
      const x = (size.w - w) / 2,
        y = (size.h - h) / 2;
      return { x, y, w, h, t, r, b, l, cx: x + l, cy: y + t, cw, ch };
    };
    const setSide = (v, i, n) => (linked ? [n, n, n, n] : Object.assign([...v], { [i]: n }));
    const handles = sides.map((name, i) =>
      api.handle(svg, {
        label: `${name} inset: arrows change it`,
        r: 6,
        cls: "is-accent",
        move: (x, y) => {
          const v = api.get(),
            g = geo(v),
            k = K();
          const n = [g.cy - y, x - (g.cx + g.cw), y - (g.cy + g.ch), g.cx - x][i] / k;
          api.ctx.change(setSide(v, i, Math.round(clamp(n, 0, 400))));
        },
        keys: (dx, dy) => {
          const v = api.get(),
            d = [-dy, dx, dy, -dx][i];
          api.edit(setSide(v, i, Math.round(clamp(v[i] + d, 0, 400))), "studio-key");
        },
      }),
    );
    const linkBtn = el("button", { type: "button", class: "kx-btn", "aria-pressed": "false", text: "Sides apart" });
    linkBtn.addEventListener("click", () => {
      linked = !linked;
      linkBtn.textContent = linked ? "Sides together" : "Sides apart";
      linkBtn.setAttribute("aria-pressed", String(linked));
    });
    function draw(v) {
      if (size.w < 10) return;
      const g = geo(v);
      Object.entries({ x: g.x, y: g.y, width: g.w, height: g.h, rx: 4 }).forEach(([k, n]) => outer.setAttribute(k, n));
      Object.entries({ x: g.cx, y: g.cy, width: g.cw, height: g.ch, rx: 2 }).forEach(([k, n]) => inner.setAttribute(k, n));
      bands.setAttribute("d", `M${g.x} ${g.y}h${g.w}v${g.h}h${-g.w}Z M${g.cx} ${g.cy}v${g.ch}h${g.cw}v${-g.ch}Z`);
      const spots = [
        [g.cx + g.cw / 2, g.y],
        [g.x + g.w, g.cy + g.ch / 2],
        [g.cx + g.cw / 2, g.y + g.h],
        [g.x, g.cy + g.ch / 2],
      ];
      const labelAt = [
        [g.cx + g.cw / 2, g.y + g.t / 2 + 4],
        [g.cx + g.cw + g.r / 2, g.cy + g.ch / 2 + 4],
        [g.cx + g.cw / 2, g.cy + g.ch + g.b / 2 + 4],
        [g.x + g.l / 2, g.cy + g.ch / 2 + 4],
      ];
      text.replaceChildren(s("text", { x: g.cx + g.cw / 2, y: g.cy + g.ch / 2 + 4, "text-anchor": "middle", text: "content" }), ...v.map((n, i) => s("text", { x: labelAt[i][0], y: labelAt[i][1], "text-anchor": "middle", class: "k-strong", text: `${n}` })));
      handles.forEach((h, i) => {
        h.at(...spots[i]);
        h.text(`${sides[i]} ${v[i]} px`);
      });
    }
    const F = (i) => field(api.ctx, { label: sides[i], min: 0, max: 200, step: 1, unit: "px", digits: 0, get: (v) => v[i], put: (v, n) => setSide(v, i, n) });
    return {
      node: svg,
      note: "drag an edge; the bands are to scale",
      draw,
      side: block("Edges", linkBtn),
      strip: () => [0, 4, 8, 12, 16, 24, 32].map((n) => ({ value: [n, n, n, n], label: `${n} all round` })),
      stripTitle: "Even insets",
      caption: (v) => v.join(" "),
      hero: (v) => ({ value: v.every((n) => n === v[0]) ? String(v[0]) : `${v[0]} ${v[1]}`, unit: "px", note: v.every((n) => n === v[0]) ? "all sides" : `${v[2]} ${v[3]} below and left`, tone: "quiet", long: `padding: ${v.map((n) => `${n}px`).join(" ")}` }),
      fields: [0, 1, 2, 3].map(F),
      keys: [["Arrows", "on an edge: push it out or in"]],
    };
  },

  seed(api) {
    const { c } = api;
    const node = el("div", { class: "ki-seeds", role: "radiogroup", "aria-label": "Neighbouring seeds. Click one to take it." });
    const steps = api.sibling("sampler") ? () => api.panel.get(api.sibling("sampler").id).steps : () => 24;
    const cfg = api.sibling("sampler") ? () => api.panel.get(api.sibling("sampler").id).cfg : () => 7;
    const tiles = Array.from({ length: 12 }, (_, i) => {
      const cv = Object.assign(document.createElement("canvas"), { width: 48, height: 48 }),
        cap = el("span"),
        b = el("button", { type: "button", role: "radio", class: "ki-seed" }, cv, cap);
      b.addEventListener("click", () => api.edit(b._seed, "studio-seed"));
      node.append(b);
      return { b, cv, cap, i };
    });
    node.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const i = tiles.findIndex((t) => t.b === document.activeElement);
      tiles[clamp(i + d, 0, tiles.length - 1)].b.focus();
    });
    const roll = el("button", { type: "button", class: "kx-btn", text: "New seed" });
    roll.addEventListener("click", () => api.edit(Math.floor(Math.random() * 4294967295), "seed-roll"));
    const max = c.max ?? 4294967295;
    return {
      node,
      note: "the same settings at neighbouring seeds; the current one outlined",
      side: block("Roll", roll),
      draw(v) {
        tiles.forEach((t) => {
          const seed = clamp(v - 5 + t.i, 0, max);
          t.b._seed = seed;
          paintSeed(t.cv, seed, steps(), cfg());
          t.cap.textContent = String(seed);
          t.b.setAttribute("aria-checked", String(seed === v));
          t.b.setAttribute("aria-label", `Seed ${seed}`);
          t.b.tabIndex = seed === v ? 0 : -1;
        });
      },
      hero: (v) => ({ value: String(v), note: `of ${max}`, tone: "quiet" }),
      fields: [field(api.ctx, { label: "Seed", min: 0, max, step: 1, digits: 0, get: (v) => v, put: (_v, n) => Math.round(n) })],
      keys: [["Arrows", "walk the tiles · Enter takes one"]],
      delta: (v, d) => `${v - d > 0 ? "+" : ""}${v - d} from ${d}`,
    };
  },

  asset(api) {
    const { c } = api;
    const preview = el("div", { class: "ki-asset-preview" }),
      meta = el("dl", { class: "ki-asset-meta" });
    let objectUrl = null,
      file = null;
    const drop = filePick(`Choose ${c.label || "a file"}`, c.accept || "", (f) => {
      file = f;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
      api.panel.emit("asset", { control: c.id, file: f });
      api.edit(f.name, "studio-file");
    });
    const node = el("div", { class: "ki-asset" }, preview, drop, meta);
    const looksImage = (name) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name || "");
    return {
      node,
      note: "choose or drop a file; nothing leaves this computer",
      draw(v) {
        if (objectUrl) preview.replaceChildren(el("img", { src: objectUrl, alt: v }));
        else if (looksImage(v)) preview.replaceChildren(stillLife(480, 270));
        else preview.replaceChildren(el("div", { class: "ki-asset-doc", text: (String(v).split(".").pop() || "file").toUpperCase() }));
        meta.replaceChildren(
          ...[
            ["Name", v || "none"],
            ["Kind", file?.type || (looksImage(v) ? "image" : "file")],
            ["Size", file ? `${Math.round(file.size / 102.4) / 10} KB` : "as declared"],
          ].flatMap(([k, t]) => [el("dt", { text: k }), el("dd", { text: t })]),
        );
      },
      hero: (v) => ({ value: "", long: v || "No file", note: "", tone: "quiet" }),
      keys: [["Enter", "on the button opens the chooser"]],
      destroy: () => objectUrl && URL.revokeObjectURL(objectUrl),
    };
  },

  list(api) {
    // A list of numbers is a profile: a line through its values, each point dragged up or down,
    // or drawn across in one stroke.
    const { c } = api;
    const svg = svgStage(`${c.label}: drag across to draw the values; arrows pick and change one`),
      area = s("path", { class: "ki-profile-area" }),
      lineP = s("path", { class: "ki-profile-line" }),
      dots = s("g", {}),
      axis = s("g", {}),
      tag = s("g", { class: "ki-profile-tag" }),
      hit = s("rect", { class: "ki-hit" });
    svg.append(axis, area, lineP, dots, hit, tag);
    let size = { w: 1, h: 1 },
      focus = 0;
    const range = () => {
      const v = api.get();
      const lo = c.min ?? Math.min(0, ...v),
        hi = c.max ?? ceilNice(Math.max(1e-9, ...v.map(Math.abs)));
      return { min: lo, max: hi > lo ? hi : lo + 1 };
    };
    const stepOf = () => c.step || niceStep(range().max - range().min, 100);
    const P = { l: 48, r: 16, t: 24, b: 28 };
    const X = (i, n) => P.l + (n < 2 ? (size.w - P.l - P.r) / 2 : (i / (n - 1)) * (size.w - P.l - P.r));
    const at = (e) => {
      const p = svgPoint(svg, e),
        v = api.get(),
        { min, max } = range();
      if (!v.length) return v;
      const i = clamp(Math.round(((p.x - P.l) / (size.w - P.l - P.r || 1)) * (v.length - 1)), 0, v.length - 1),
        n = min + clamp(1 - (p.y - P.t) / (size.h - P.t - P.b), 0, 1) * (max - min);
      v[i] = Number(n.toFixed(digitsOf(stepOf()) + 1));
      focus = i;
      return v;
    };
    api.surface(hit, {
      start: (e) => {
        api.ctx.begin("studio-profile");
        api.ctx.change(at(e));
      },
      move: (e) => api.ctx.change(at(e)),
      end: () => api.ctx.commit(),
      cancel: () => api.ctx.cancel(),
    });
    svg.setAttribute("tabindex", 0);
    svg.setAttribute("role", "slider");
    svg.addEventListener("keydown", (e) => {
      const v = api.get(),
        { min, max } = range(),
        st = stepOf();
      if (!v.length) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") focus = clamp(focus + (e.key === "ArrowRight" ? 1 : -1), 0, v.length - 1);
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        v[focus] = clamp(Number((v[focus] + (e.key === "ArrowUp" ? st : -st) * (e.shiftKey ? 0.1 : e.altKey ? 10 : 1)).toFixed(6)), min, max);
        api.edit(v, "studio-key");
      } else if (e.key === "Home" || e.key === "End") focus = e.key === "Home" ? 0 : v.length - 1;
      else return;
      e.preventDefault();
      e.stopPropagation();
      draw(api.get());
    });
    api.fit(svg, (w, h) => ((size = { w, h }), draw(api.get())));
    function draw(v) {
      if (size.w < 10) return;
      focus = clamp(focus, 0, Math.max(0, v.length - 1));
      const { min, max } = range(),
        Y = (n) => P.t + (1 - (n - min) / (max - min || 1)) * (size.h - P.t - P.b),
        n = v.length,
        pts = v.map((x, i) => [X(i, n), Y(x)]),
        base = Y(clamp(0, min, max));
      Object.entries({ x: P.l - 8, y: P.t - 8, width: size.w - P.l - P.r + 16, height: size.h - P.t - P.b + 16 }).forEach(([k, x]) => hit.setAttribute(k, x));
      const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${fx(x)} ${fx(y)}`).join("");
      lineP.setAttribute("d", d);
      area.setAttribute("d", n ? `${d}L${fx(pts.at(-1)[0])} ${fx(base)}L${fx(pts[0][0])} ${fx(base)}Z` : "");
      dots.replaceChildren(...(n <= 64 ? pts.map(([x, y], i) => s("circle", { cx: fx(x), cy: fx(y), r: i === focus ? 6 : 4, class: i === focus ? "ki-profile-dot is-focus" : "ki-profile-dot" })) : []));
      const ticks = niceStep(max - min, 4),
        rows = [];
      for (let t = Math.ceil(min / ticks) * ticks; t <= max + 1e-9; t += ticks) rows.push(t);
      const every = Math.max(1, Math.ceil(n / Math.floor((size.w - P.l) / 36)));
      axis.replaceChildren(
        ...rows.flatMap((t) => [s("path", { class: "ki-grid-line", d: `M${P.l} ${fx(Y(t))}H${size.w - P.r}` }), s("text", { x: P.l - 8, y: Y(t) + 4, "text-anchor": "end", text: humane(Number(t.toFixed(6))) })]),
        ...v.map((_, i) => (i % every === 0 ? s("text", { x: X(i, n), y: size.h - 8, "text-anchor": "middle", text: String(i + 1) }) : null)).filter(Boolean),
        n ? null : s("text", { x: size.w / 2, y: size.h / 2, "text-anchor": "middle", class: "k-strong", text: "No values yet: add the first one" }),
      );
      tag.replaceChildren();
      if (n) {
        const [x, y] = pts[focus],
          label = `#${focus + 1}  ${humane(v[focus])}${c.unit || ""}`,
          w = label.length * 6.4 + 14,
          tx = clamp(x - w / 2, P.l, size.w - P.r - w);
        tag.append(s("rect", { x: fx(tx), y: fx(y - 30), width: fx(w), height: 18, rx: 3 }), s("text", { x: fx(tx + w / 2), y: fx(y - 17), "text-anchor": "middle", text: label }));
      }
      svg.setAttribute("aria-valuenow", ariaNum(v[focus] ?? 0));
      svg.setAttribute("aria-valuetext", n ? `item ${focus + 1} of ${n}: ${v[focus]}` : "no values");
    }
    const tools = el(
      "div",
      { class: "ki-actions" },
      el("button", { type: "button", class: "kx-btn", text: "Add a value", onclick: () => {
        const v = api.get();
        v.splice(focus + 1, 0, v.length ? v[focus] : clamp(0, range().min, range().max));
        focus = v.length > 1 ? focus + 1 : 0;
        api.edit(v, "studio-profile");
      } }),
      el("button", { type: "button", class: "kx-btn", text: "Remove this value", onclick: () => {
        const v = api.get();
        if (!v.length) return;
        v.splice(focus, 1);
        api.edit(v, "studio-profile");
      } }),
      el("button", { type: "button", class: "kx-btn", text: "Reverse", onclick: () => api.edit(api.get().reverse(), "studio-profile") }),
    );
    const node = api.nested ? svg : el("div", { class: "ki-profile" }, svg, tools);
    return {
      node,
      note: `${api.get().length} values; drag across to draw them`,
      draw,
      side: api.nested ? null : sourceBlock(api),
      fields: api.nested ? null : [field(api.ctx, { label: "Chosen value", min: c.min ?? -1e15, max: c.max ?? 1e15, step: c.step || 0.01, digits: 4, get: (v) => v[focus] ?? 0, put: (v, n) => (v.length ? Object.assign([...v], { [focus]: n }) : [n]) })],
      fieldsTitle: "The chosen point",
      hero: (v) => ({ value: String(v.length), unit: "values", note: v.length ? `from ${humane(Math.min(...v))} to ${humane(Math.max(...v))}` : "", tone: "quiet" }),
      keys: [["Left Right", "pick a value"], ["Up Down", "change it · Shift fine"]],
      caption: (v) => `${v.length} values`,
    };
  },

  record(api) {
    const { c } = api;
    const lanes = el("div", { class: "ki-lanes" });
    const fieldsList = [];
    const keys = Object.keys(api.get() || {});
    for (const key of keys) {
      const v0 = api.get()[key],
        name = c.keys?.[key]?.label || key;
      if (typeof v0 === "number") {
        const hint = c.keys?.[key] || {},
          r = rangeOf(hint, v0);
        const f = field(api.ctx, { label: name, min: r.min, max: r.max, step: r.step, unit: hint.unit || "", digits: digitsOf(r.step), get: (v) => v[key], put: (v, n) => ({ ...v, [key]: n }) });
        f.node.classList.add("ki-lane");
        fieldsList.push(f);
        lanes.append(f.node);
      } else if (typeof v0 === "boolean") {
        const b = el("button", { type: "button", role: "switch", class: "ki-switch" });
        b.addEventListener("click", () => api.edit({ ...api.get(), [key]: !api.get()[key] }, "studio-switch"));
        fieldsList.push({ node: b, update: () => (b.setAttribute("aria-checked", String(!!api.get()[key])), (b.textContent = api.get()[key] ? "On" : "Off")) });
        lanes.append(el("div", { class: "ki-lane ki-lane-row" }, el("span", { class: "k-field-name", text: name }), b));
      } else if (Array.isArray(v0) && v0.every((x) => typeof x === "number")) {
        const sub = stages.list({ ...api, nested: true, c: { ...c, label: name, min: c.keys?.[key]?.min, max: c.keys?.[key]?.max }, get: () => api.get()[key], ctx: { ...api.ctx, get: () => api.get()[key], change: (x) => api.ctx.change({ ...api.get(), [key]: x }) }, edit: (x, src) => api.edit({ ...api.get(), [key]: x }, src) });
        sub.node.classList.add("ki-lane-bars");
        fieldsList.push({ node: sub.node, update: () => sub.draw(api.get()[key]) });
        lanes.append(el("div", { class: "ki-lane ki-lane-stack" }, el("span", { class: "k-field-name", text: `${name} · ${v0.length} values` }), sub.node));
      } else {
        const input = el("input", { type: "text", class: "ki-text-field", "aria-label": name, spellcheck: false });
        const err = el("span", { class: "ki-error", role: "status" });
        input.addEventListener("keydown", (e) => e.stopPropagation());
        input.addEventListener("change", () => {
          try {
            const x = typeof v0 === "string" ? input.value : looseJson(input.value);
            err.textContent = "";
            input.removeAttribute("aria-invalid");
            api.edit({ ...api.get(), [key]: x }, "studio-text");
          } catch (e) {
            input.setAttribute("aria-invalid", "true");
            err.textContent = e.message;
          }
        });
        fieldsList.push({ node: input, update: () => document.activeElement !== input && (input.value = typeof api.get()[key] === "string" ? api.get()[key] : JSON.stringify(api.get()[key])) });
        lanes.append(el("label", { class: "ki-lane ki-lane-stack" }, el("span", { class: "k-field-name", text: name }), input, err));
      }
    }
    return {
      node: lanes,
      title: c.label,
      note: `${keys.length} parts, each drawn and dragged on its own lane`,
      draw: () => fieldsList.forEach((f) => f.update()),
      side: sourceBlock(api),
      hero: (v) => ({ value: String(Object.keys(v || {}).length), unit: "parts", note: c.type, tone: "quiet" }),
      keys: [["Tab", "next lane"], ["Arrows", "on a bar: change it"]],
      caption: (v) => Object.entries(v || {}).map(([k, x]) => `${k} ${typeof x === "object" ? (Array.isArray(x) ? `[${x.length}]` : "{…}") : x}`).join(" · "),
    };
  },
};

/** The value as editable source: JSON or a JavaScript literal, read tolerantly, errors in words. */
function sourceBlock(api) {
  const area = el("textarea", { class: "ki-source", spellcheck: "false", rows: 8, "aria-label": `${api.c.label} as JSON` }),
    note = el("output", { class: "ki-error" });
  area.addEventListener("keydown", (e) => e.stopPropagation());
  area.addEventListener("change", () => {
    try {
      const v = looseJson(area.value);
      validateValue(v, api.c);
      api.edit(v, "studio-source");
      area.removeAttribute("aria-invalid");
      note.textContent = "Read.";
    } catch (e) {
      area.setAttribute("aria-invalid", "true");
      note.textContent = e.message;
    }
  });
  const sync = () => {
    if (document.activeElement !== area) area.value = JSON.stringify(api.get(), null, 1).replace(/\n\s*(?=[\d\]-])/g, " ");
  };
  const unsub = api.ctx.subscribe?.(sync);
  if (unsub) api.cleanup.push(unsub);
  sync();
  return el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Source", el("small", { text: "JSON or a JS literal; leave the box to apply" })), area, note);
}
