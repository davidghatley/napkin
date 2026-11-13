// The data studio: the chart, the rows behind it (hover one, see the other), and every field
// with its distribution. Drag a field onto a channel, or pick it on the channel's row.
import { el } from "./dom.js";
import { clamp } from "./values.js";
import { s, fx, block, hero, chips, fitSvg, keyHint } from "./kit.js";

const CHANNELS = [
  ["x", "x"],
  ["y", "y"],
  ["color", "Colour"],
  ["size", "Size"],
];
const PALETTE = ["#1f45d3", "#c27c0e", "#0f8b8d", "#c43d6b", "#6b5bd2"];
const P = { l: 44, r: 14, t: 28, b: 30 };

export function encodingStudio(ctx, host) {
  host.classList.add("k-studio", "kd");
  host.dataset.layout = "own";
  const c = ctx.control,
    panel = ctx.panel,
    data = c.data || [],
    names = (c.fields || Object.keys(data[0] || {})).map((f) => (typeof f === "object" ? f.name : f));
  const numeric = (f) => data.length > 0 && data.every((r) => typeof r[f] === "number");
  const v0 = () => ({ mark: "point", ...ctx.get() });
  const markOf = () => (panel?.rows?.has("mark") ? panel.get("mark") : v0().mark);
  const sizeOf = () => (panel?.rows?.has("pointSize") ? panel.get("pointSize") : 5);
  const labelsOn = () => (panel?.rows?.has("labels") ? !!panel.get("labels") : false);
  const assign = (channel, field) => {
    ctx.begin("studio-shelf");
    const v = v0(),
      next = { ...v, [channel]: field };
    // A field can sit on x or y but not both; swap them instead.
    if ((channel === "x" || channel === "y") && field) {
      const other = channel === "x" ? "y" : "x";
      if (v[other] === field) next[other] = v[channel];
    }
    ctx.change(next);
    ctx.commit();
  };
  let hot = -1;
  const cleanup = [];

  /* ---- chart ---- */
  const svg = s("svg", { class: "k-svg kd-chart", role: "img" }),
    grid = s("path", { class: "km-grid" }),
    marks = s("g", {}),
    text = s("g", {}),
    tip = s("g", { class: "km-chip", visibility: "hidden" }),
    tipBox = s("rect", { rx: 3, height: 20 }),
    tipText = s("text", { y: 14, x: 7 });
  tip.append(tipBox, tipText);
  svg.append(grid, marks, text, tip);
  let size = { w: 1, h: 1 };
  cleanup.push(fitSvg(svg, (w, h) => ((size = { w, h }), draw())).destroy);

  /* ---- table ---- */
  const table = el("table", { class: "km-table kd-table" }),
    tableWrap = el("div", { class: "kd-table-wrap", tabindex: 0, role: "region", "aria-label": "Source rows" }, table);
  table.addEventListener("pointerover", (e) => {
    const tr = e.target.closest("tr[data-i]");
    setHot(tr ? Number(tr.dataset.i) : -1);
  });
  table.addEventListener("pointerleave", () => setHot(-1));

  /* ---- side: hero, channels, fields ---- */
  const big = hero("Correlation of x and y");
  const slots = CHANNELS.map(([channel, label]) => {
    const pick = chips(`${label} field`, [{ value: "", label: "None" }, ...names.map((n) => ({ value: n, label: n }))].filter((o) => channel === "color" || channel === "size" || o.value), (f) => assign(channel, f || undefined));
    const row = el("div", { class: "kd-slot", "data-channel": channel }, el("b", { class: "kd-slot-name", text: label }), pick.node);
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("is-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("is-over");
      const f = e.dataTransfer.getData("text/plain");
      if (names.includes(f)) assign(channel, f);
    });
    return { channel, pick, row };
  });
  const markChips = chips(
    "Mark",
    [
      { value: "point", label: "Points" },
      { value: "bar", label: "Bars" },
      { value: "line", label: "Line" },
    ],
    (m) => {
      if (panel?.rows?.has("mark")) panel.context("mark").set(m);
      else assign("mark", m);
    },
    {
      glyph: (m) => {
        const g = s("svg", { width: 56, height: 36, viewBox: "0 0 56 36", "aria-hidden": "true" });
        const ys = [24, 14, 19, 8, 12];
        if (m === "point") ys.forEach((y, i) => g.append(s("circle", { cx: 10 + i * 9, cy: y, r: 2.6, class: "kd-glyph-fill" })));
        else if (m === "bar") ys.forEach((y, i) => g.append(s("rect", { x: 7 + i * 9, y, width: 6, height: 30 - y, class: "kd-glyph-fill" })));
        else g.append(s("path", { d: ys.map((y, i) => `${i ? "L" : "M"}${10 + i * 9} ${y}`).join(""), class: "km-pre-curve" }));
        return g;
      },
    },
  );
  markChips.node.classList.add("km-presets", "kx-scheds");
  const fieldTiles = names.map((n) => {
    const spark = s("svg", { class: "kd-spark", viewBox: "0 0 100 26", preserveAspectRatio: "none", "aria-hidden": "true" }),
      tag = el("span", { class: "kd-tag" }),
      tile = el("div", { class: "kd-field", draggable: "true", tabindex: 0, role: "button", "aria-label": `${n}. Press x, y, c or s to place it.` }, el("b", { text: n }), tag, spark);
    tile.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", n);
      e.dataTransfer.effectAllowed = "link";
    });
    tile.addEventListener("keydown", (e) => {
      const ch = { x: "x", y: "y", c: "color", s: "size" }[e.key.toLowerCase()];
      if (!ch) return;
      e.preventDefault();
      e.stopPropagation();
      assign(ch, n);
    });
    const vals = data.map((r) => r[n]);
    if (numeric(n)) {
      const lo = Math.min(...vals),
        hi = Math.max(...vals),
        bins = new Array(12).fill(0);
      for (const x of vals) bins[Math.min(11, Math.floor(((x - lo) / (hi - lo || 1)) * 12))]++;
      const m = Math.max(...bins);
      bins.forEach((b, i) => spark.append(s("rect", { x: i * (100 / 12) + 0.6, y: 26 - (b / m) * 24, width: 100 / 12 - 1.2, height: (b / m) * 24, class: "kd-spark-bar" })));
      tile.title = `${n}: ${fx(lo, 2)} to ${fx(hi, 2)}`;
    } else {
      const cats = [...new Set(vals)],
        counts = cats.map((k) => vals.filter((x) => x === k).length),
        m = Math.max(...counts);
      cats.forEach((k, i) => spark.append(s("rect", { x: i * (100 / cats.length) + 1, y: 26 - (counts[i] / m) * 24, width: 100 / cats.length - 2, height: (counts[i] / m) * 24, fill: PALETTE[i % PALETTE.length] })));
      tile.title = `${n}: ${cats.length} groups`;
    }
    return { n, tile, tag };
  });
  const stats = el("div", { class: "k-stats" });
  ctx.rail.append(
    block("Fields", el("div", { class: "kd-fields" }, ...fieldTiles.map((f) => f.tile))),
    keyHint(["Drag", "a field onto a channel"], ["x y c s", "place the focused field"], ["Arrows", "move along a channel's choices"]),
  );
  host.append(
    el(
      "div",
      { class: "k-main" },
      el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Chart", el("small", { class: "kd-legend" })), svg),
      el("section", { class: "k-block" }, el("h3", { class: "k-title" }, "Rows", el("small", { text: "hover a row to find its mark" })), tableWrap),
    ),
    el("div", { class: "k-side" }, big.node, stats, el("section", { class: "k-block" }, el("h3", { class: "k-title", text: "Channels" }), ...slots.map((x) => x.row)), block("Mark", markChips.node)),
  );
  const legend = host.querySelector(".kd-legend");

  function scales(v) {
    const ext = (f) => {
      const vals = data.map((r) => r[f]);
      return numeric(f) ? [Math.min(...vals), Math.max(...vals)] : [...new Set(vals)];
    };
    const xs = v.x ? ext(v.x) : [0, 1],
      ys = v.y ? ext(v.y) : [0, 1],
      cats = v.color && !numeric(v.color) ? ext(v.color) : [],
      ss = v.size && numeric(v.size) ? ext(v.size) : null;
    const W = size.w - P.l - P.r,
      H = size.h - P.t - P.b;
    const xNum = v.x && numeric(v.x),
      yNum = v.y && numeric(v.y);
    const yLo = Math.min(0, ys[0]);
    const X = (r) => (xNum ? P.l + ((r[v.x] - xs[0]) / (xs[1] - xs[0] || 1)) * W : P.l + ((xs.indexOf(r[v.x]) + 0.5) / xs.length) * W),
      Y = (r) => (yNum ? P.t + (1 - (r[v.y] - yLo) / (ys[1] - yLo || 1)) * H : P.t + ((ys.indexOf(r[v.y]) + 0.5) / ys.length) * H),
      C = (r) => (cats.length ? PALETTE[cats.indexOf(r[v.color]) % PALETTE.length] : PALETTE[0]),
      R = (r) => (ss ? 2 + ((r[v.size] - ss[0]) / (ss[1] - ss[0] || 1)) * sizeOf() * 1.4 : sizeOf());
    return { xs, ys, yLo, cats, X, Y, C, R, xNum, yNum, W, H };
  }
  function draw() {
    const v = v0(),
      mark = markOf();
    for (const sl of slots) sl.pick.set(v[sl.channel] ?? "");
    markChips.set(mark);
    for (const f of fieldTiles) {
      const on = CHANNELS.filter(([ch]) => v[ch] === f.n).map(([ch]) => (ch === "color" ? "c" : ch === "size" ? "s" : ch));
      f.tag.textContent = on.join(" ");
      f.tile.classList.toggle("is-used", on.length > 0);
    }
    // Hero: Pearson r for two numeric fields.
    if (v.x && v.y && numeric(v.x) && numeric(v.y)) {
      const n = data.length,
        mx = data.reduce((a, r) => a + r[v.x], 0) / n,
        my = data.reduce((a, r) => a + r[v.y], 0) / n;
      let sxy = 0,
        sxx = 0,
        syy = 0;
      for (const r of data) {
        sxy += (r[v.x] - mx) * (r[v.y] - my);
        sxx += (r[v.x] - mx) ** 2;
        syy += (r[v.y] - my) ** 2;
      }
      const rr = sxy / Math.sqrt(sxx * syy || 1),
        a = Math.abs(rr);
      big.set(fx(rr, 2), "r", `${a > 0.7 ? "strong" : a > 0.4 ? "moderate" : "weak"} ${rr >= 0 ? "rise" : "fall"}`, a > 0.4 ? "" : "quiet");
    } else big.set("n/a", "", "needs two numeric fields", "quiet");
    stats.replaceChildren(
      ...[
        ["Rows", String(data.length)],
        ["Fields", String(names.length)],
        ["Mark", mark],
      ].map(([k, t]) => el("div", { class: "k-stat" }, el("span", { text: k }), el("b", { text: t }))),
    );
    // Table.
    const cols = names;
    table.replaceChildren(
      el("tr", {}, ...cols.map((n) => el("th", { text: n + (CHANNELS.find(([ch]) => v[ch] === n) ? ` · ${CHANNELS.find(([ch]) => v[ch] === n)[1]}` : "") }))),
      ...data.map((r, i) => el("tr", { "data-i": i, class: i === hot ? "is-hot" : "" }, ...cols.map((n) => el("td", { text: typeof r[n] === "number" ? fx(r[n], 2) : String(r[n]) })))),
    );
    if (size.w < 10) return;
    const sc = scales(v);
    svg.setAttribute("aria-label", `${mark} chart of ${v.y || "nothing"} against ${v.x || "nothing"}${v.color ? ", coloured by " + v.color : ""}`);
    let g = "";
    text.replaceChildren();
    for (let i = 0; i <= 4; i++) {
      const y = P.t + (i / 4) * sc.H;
      g += `M${P.l} ${y}H${size.w - P.r}`;
      if (sc.yNum) text.append(s("text", { x: P.l - 8, y: y + 3.5, "text-anchor": "end", text: fx(sc.ys[1] - (i / 4) * (sc.ys[1] - sc.yLo), 1) }));
    }
    if (sc.xNum) for (let i = 0; i <= 5; i++) text.append(s("text", { x: P.l + (i / 5) * sc.W, y: size.h - P.b + 16, "text-anchor": "middle", text: fx(sc.xs[0] + (i / 5) * (sc.xs[1] - sc.xs[0]), 1) }));
    text.append(s("text", { x: size.w - P.r, y: size.h - 1, "text-anchor": "end", class: "k-strong", text: v.x || "" }), s("text", { x: P.l, y: P.t - 14, class: "k-strong", text: v.y ? "↑ " + v.y : "" }));
    grid.setAttribute("d", g);
    marks.replaceChildren();
    const order = data.map((r, i) => i).sort((a, b) => data[a][v.x] - data[b][v.x]);
    if (mark === "line") {
      const groups = sc.cats.length ? sc.cats : [null];
      for (const k of groups) {
        const pts = order.filter((i) => k === null || data[i][v.color] === k);
        marks.append(s("path", { class: "kd-line", stroke: k === null ? PALETTE[0] : sc.C(data[pts[0]]), d: pts.map((i, j) => `${j ? "L" : "M"}${fx(sc.X(data[i]), 1)} ${fx(sc.Y(data[i]), 1)}`).join("") }));
      }
    }
    data.forEach((r, i) => {
      const x = sc.X(r),
        y = sc.Y(r),
        col = sc.C(r);
      let m;
      if (mark === "bar") {
        const bw = Math.max(2, (sc.W / data.length) * 0.7),
          y0 = sc.yNum ? P.t + (1 - (0 - sc.yLo) / (sc.ys[1] - sc.yLo || 1)) * sc.H : P.t + sc.H;
        m = s("rect", { x: fx(x - bw / 2), y: fx(Math.min(y, y0)), width: fx(bw), height: fx(Math.abs(y0 - y)), fill: col });
      } else m = s("circle", { cx: fx(x), cy: fx(y), r: fx(mark === "line" ? 2.5 : sc.R(r)), fill: col });
      m.dataset.i = i;
      m.classList.add("kd-mark");
      if (i === hot) m.classList.add("is-hot");
      marks.append(m);
      if (labelsOn() && mark !== "bar") marks.append(s("text", { x: x + 6, y: y - 6, class: "kd-label", text: String(r[names[0]]) }));
    });
    legend.textContent = sc.cats.length ? sc.cats.map((k) => `${k}`).join(" · ") : "";
    legend.replaceChildren(...sc.cats.map((k, i) => el("span", { class: "kd-key" }, el("i", { style: `background:${PALETTE[i % PALETTE.length]}` }), `${v.color} ${k}`)));
    placeTip(sc);
  }
  function placeTip(sc = scales(v0())) {
    if (hot < 0 || !data[hot]) return tip.setAttribute("visibility", "hidden");
    const v = v0(),
      r = data[hot],
      t = names.map((n) => `${n} ${typeof r[n] === "number" ? fx(r[n], 2) : r[n]}`).join("  ");
    tipText.textContent = t;
    const w = t.length * 6.2 + 14,
      x = clamp(sc.X(r) + 10, 2, size.w - w - 2),
      y = clamp(sc.Y(r) - 30, 2, size.h - 24);
    tipBox.setAttribute("width", w);
    tip.setAttribute("transform", `translate(${fx(x)} ${fx(y)})`);
    tip.setAttribute("visibility", "visible");
    void v;
  }
  function setHot(i) {
    if (i === hot) return;
    hot = i;
    for (const m of marks.querySelectorAll(".kd-mark")) m.classList.toggle("is-hot", Number(m.dataset.i) === i);
    for (const tr of table.querySelectorAll("tr[data-i]")) tr.classList.toggle("is-hot", Number(tr.dataset.i) === i);
    if (i >= 0) table.querySelector(`tr[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
    placeTip();
  }
  svg.addEventListener("pointermove", (e) => {
    const m = e.target.closest?.(".kd-mark");
    setHot(m ? Number(m.dataset.i) : -1);
  });
  svg.addEventListener("pointerleave", () => setHot(-1));
  const onPaint = (e) => {
    if (["mark", "pointSize", "labels"].includes(e.detail?.control)) draw();
  };
  panel?.addEventListener?.("paint", onPaint);
  draw();
  return {
    update: draw,
    destroy: () => {
      cleanup.forEach((d) => d());
      panel?.removeEventListener?.("paint", onPaint);
    },
  };
}
