// The type studio: the specimen you edit in place, a size ladder you pick from, and a variable
// axis lab where one handle sets weight across and size up, over the faces it would make.
import { el } from "./dom.js";
import { clamp } from "./values.js";
import { s, fx, block, hero, field, chips, handle, fitSvg, keyHint } from "./kit.js";

const LADDER = [12, 14, 16, 20, 24, 32, 40, 48, 64, 80];
const WEIGHTS = [100, 300, 400, 500, 600, 700, 900];
const SMIN = 8,
  SMAX = 96;

export function typeStudio(ctx, host) {
  host.classList.add("k-studio", "kt");
  host.dataset.layout = "own";
  const c = ctx.control;
  const axis = (c.axes || []).find((a) => a.tag === "wght") || { min: 100, max: 900 };
  const v0 = () => ({ text: "Ag", family: "system-ui", size: 32, weight: 400, tracking: 0, lineHeight: 1.2, axes: {}, ...ctx.get() });
  const withWeight = (v, w) => ({ ...v, weight: w, axes: { ...(v.axes || {}), wght: w } });
  const edit = (fn, src = "studio-type") => {
    ctx.begin(src);
    ctx.change(fn(v0()));
    ctx.commit();
  };
  const cleanup = [];

  /* ---- specimen, edited in place ---- */
  const spec = el("div", { class: "kt-spec", contenteditable: "plaintext-only", spellcheck: "false", role: "textbox", "aria-multiline": "true", "aria-label": "Specimen text" });
  const specWrap = el("div", { class: "kt-spec-wrap" }, spec);
  spec.addEventListener("focus", () => ctx.begin("specimen-text"));
  spec.addEventListener("input", () => ctx.change({ ...v0(), text: spec.innerText.replace(/\n$/, "") }));
  spec.addEventListener("blur", () => ctx.commit());
  spec.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      ctx.cancel();
      spec.blur();
    }
  });

  /* ---- size ladder ---- */
  const ladder = el("div", { class: "kt-ladder", role: "radiogroup", "aria-label": "Size ladder" });
  const rungs = LADDER.map((px) => {
    const b = el("button", { type: "button", role: "radio", class: "kt-rung", tabindex: -1 }, el("span", { class: "kt-rung-px", text: String(px) }), el("span", { class: "kt-rung-ag", text: "Sphinx of black quartz" }));
    b.addEventListener("click", () => edit((v) => ({ ...v, size: px }), "size-ladder"));
    ladder.append(b);
    return { b, px };
  });
  ladder.addEventListener("keydown", (e) => {
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const i = rungs.findIndex((r) => r.b === document.activeElement),
      n = rungs[clamp(i + d, 0, rungs.length - 1)];
    n.b.focus();
    n.b.click();
  });

  /** As many whole words of the specimen as fit the rung: nothing is cut mid-word or faded out. */
  const fitWords = (node, text) => {
    const words = String(text || "Sphinx of black quartz").split(/\s+/).filter(Boolean);
    let n = words.length;
    node.textContent = words.join(" ");
    while (n > 1 && node.scrollWidth > node.clientWidth + 1) node.textContent = words.slice(0, --n).join(" ");
  };
  /* ---- in use: the setting at work in a heading over body copy ---- */
  const useHead = el("div", { class: "kt-use-head" }),
    useBody = el("p", { class: "kt-use-body", text: "Body copy stays at 15 px in the same family, so the heading's size, weight and tracking can be judged against it. Leading follows the line height you set." }),
    useNote = el("p", { class: "kt-use-note" });
  const inUse = el("div", { class: "kt-use" }, useHead, useBody, useNote);

  /* ---- axis lab: weight across, size up ---- */
  const pad = s("svg", { class: "k-svg kt-pad", "aria-label": "Weight across, size up" }),
    cells = s("g", {}),
    cross = s("path", { class: "kt-cross" }),
    padText = s("g", {});
  pad.append(cells, cross, padText);
  let ps = { w: 1, h: 1 };
  const PL = 34,
    PB = 22,
    PT = 8,
    PR = 8;
  const WX = (w) => PL + 18 + ((w - axis.min) / (axis.max - axis.min)) * (ps.w - PL - PR - 36),
    SY = (px) => PT + (1 - Math.log(px / SMIN) / Math.log(SMAX / SMIN)) * (ps.h - PT - PB),
    iW = (x) => axis.min + clamp((x - PL - 18) / (ps.w - PL - PR - 36 || 1), 0, 1) * (axis.max - axis.min),
    iS = (y) => SMIN * (SMAX / SMIN) ** clamp(1 - (y - PT) / (ps.h - PT - PB || 1), 0, 1);
  const knob = handle(pad, {
    label: "Weight and size",
    r: 7,
    cls: "is-accent",
    start: () => ctx.begin("axis-lab"),
    move: (x, y, e) => {
      const v = v0();
      ctx.change(withWeight({ ...v, size: e.shiftKey ? v.size : Math.round(iS(y)) }, e.altKey ? v.weight : Math.round(iW(x))));
    },
    end: () => ctx.commit(),
    cancel: () => ctx.cancel(),
    keys: (dx, dy) => edit((v) => withWeight({ ...v, size: Math.round(clamp(v.size - dy, 6, 240)) }, Math.round(clamp(v.weight + dx * 10, axis.min, axis.max))), "axis-key"),
  });
  cleanup.push(knob.destroy);
  cleanup.push(
    fitSvg(pad, (w, h) => {
      ps = { w, h };
      cells.replaceChildren();
      padText.replaceChildren();
      const v = v0();
      for (const wt of [100, 300, 500, 700, 900].filter((x) => x >= axis.min && x <= axis.max))
        for (const px of [10, 16, 28, 52]) {
          const t = s("text", { class: "kt-cell", x: WX(wt), y: SY(px) + px * 0.35, "text-anchor": "middle", text: "Ag" });
          t.style.fontFamily = v.family;
          t.style.fontWeight = wt;
          t.style.fontSize = `${Math.min(px, 30)}px`;
          cells.append(t);
        }
      for (const wt of [100, 400, 700, 900].filter((x) => x >= axis.min && x <= axis.max)) padText.append(s("text", { x: WX(wt), y: h - 6, "text-anchor": "middle", text: String(wt) }));
      for (const px of [8, 16, 32, 64, 96]) padText.append(s("text", { x: PL - 6, y: SY(px) + 3.5, "text-anchor": "end", text: `${px}` }));
      draw();
    }).destroy,
  );

  /* ---- side ---- */
  const big = hero("Size / weight");
  const weightChips = chips(
    "Weight steps",
    WEIGHTS.filter((w) => w >= axis.min && w <= axis.max).map((w) => ({ value: w, label: String(w) })),
    (w) => edit((v) => withWeight(v, w), "weight-chip"),
    {
      glyph: (w) => {
        const g = s("svg", { width: 40, height: 34, viewBox: "0 0 40 34", "aria-hidden": "true" });
        const t = s("text", { x: 20, y: 25, "text-anchor": "middle", class: "kt-chip-ag", text: "Ag" });
        t.style.fontWeight = w;
        g.append(t);
        return g;
      },
    },
  );
  weightChips.node.classList.add("kt-weights");
  const F = (label, key, min, max, step, digits, unit = "") => field(ctx, { label, min, max, step, digits, unit, get: (v) => ({ ...v0(), ...v })[key], put: (v, n) => (key === "weight" ? withWeight(v, Math.round(n)) : { ...v, [key]: n }) });
  const fields = [F("Size", "size", 6, 240, 1, 0, "px"), F("Weight", "weight", axis.min, axis.max, 1, 0), F("Tracking", "tracking", -10, 20, 0.1, 1, "px"), F("Line height", "lineHeight", 0.8, 2.4, 0.01, 2)];
  const glyphs = el("div", { class: "kt-glyphs", "aria-label": "Character set", role: "img" });
  ctx.rail.append(block("Character set", glyphs), keyHint(["Arrows", "move the axis handle; ladder up and down"], ["Shift", "fine · Alt coarse"], ["Type", "in the specimen to change its text"]));
  host.append(
    el(
      "div",
      { class: "k-main" },
      el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Specimen", el("small", { text: "click to edit the text" })), specWrap),
      el(
        "div",
        { class: "kt-pair" },
        block("Size ladder", ladder),
        el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Axis lab", el("small", { text: "weight across, size up" })), pad),
      ),
    ),
    el("div", { class: "k-side" }, big.node, block("Weight", weightChips.node), el("section", { class: "k-block" }, el("h3", { class: "k-title", text: "Set" }), el("div", { class: "k-fields" }, ...fields.map((f) => f.node))), block("In use", inUse)),
  );

  function draw() {
    const v = v0();
    const font = (n) => {
      n.style.fontFamily = v.family;
      n.style.fontWeight = v.weight;
      n.style.fontVariationSettings = Object.entries(v.axes || {}).map(([k, x]) => `"${k}" ${x}`).join(", ");
    };
    font(spec);
    spec.style.fontSize = `${v.size}px`;
    spec.style.letterSpacing = `${v.tracking}px`;
    spec.style.lineHeight = String(v.lineHeight);
    specWrap.style.setProperty("--lead", `${v.size * v.lineHeight}px`);
    if (document.activeElement !== spec && spec.innerText !== v.text) spec.innerText = v.text;
    for (const r of rungs) {
      font(r.b.lastChild);
      r.b.lastChild.style.fontSize = `${Math.min(r.px, 40)}px`;
      fitWords(r.b.lastChild, v.text);
      const on = r.px === v.size;
      r.b.setAttribute("aria-checked", String(on));
      r.b.tabIndex = on || (!rungs.some((x) => x.px === v.size) && r.px === 12) ? 0 : -1;
    }
    for (const n of [useHead, useBody]) n.style.fontFamily = v.family;
    useHead.style.fontWeight = v.weight;
    useHead.style.fontVariationSettings = spec.style.fontVariationSettings;
    useHead.style.fontSize = `${Math.min(v.size, 44)}px`;
    useHead.style.letterSpacing = `${v.tracking}px`;
    useHead.style.lineHeight = String(v.lineHeight);
    useHead.textContent = v.text;
    useNote.textContent = v.size > 44 ? `Heading shown at 44 px here; it is set at ${fx(v.size, 0)} px.` : `Heading at ${fx(v.size, 0)} px over 15 px body.`;
    weightChips.set(v.weight);
    for (const t of weightChips.node.querySelectorAll(".kt-chip-ag")) t.style.fontFamily = v.family;
    big.set(`${fx(v.size, 0)}/${fx(v.weight, 0)}`, "", `${fx(v.size * v.lineHeight, 1)} px leading`, "quiet");
    for (const f of fields) f.update();
    if (ps.w > 10) {
      const x = WX(clamp(v.weight, axis.min, axis.max)),
        y = SY(clamp(v.size, SMIN, SMAX));
      knob.at(x, y);
      knob.text(`${v.weight} weight, ${v.size} px`);
      cross.setAttribute("d", `M${x} ${PT}V${ps.h - PB}M${PL} ${y}H${ps.w - PR}`);
    }
    if (!glyphs.childElementCount) for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&@?!%") glyphs.append(el("span", { text: ch }));
    font(glyphs);
  }
  draw();
  return {
    update: draw,
    destroy: () => {
      cleanup.forEach((d) => d());
      fields.forEach((f) => f.destroy());
    },
  };
}
