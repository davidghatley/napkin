// Studios for value shapes no schema declared (see shapes.js): a matrix you edit as a grid,
// a palette of swatches, a date on a calendar, a link taken apart, a timecode, a set of flags,
// a list of tags, and a control that has no value yet. Each one is built in the instrument
// frame (instruments.js) and follows its contract: { node, note, draw, hero, keys, caption }.
import { el, pointerSurface } from "./dom.js";
import { clamp, same, humane, expression } from "./values.js";
import { s, fx, field, block, svgPoint } from "./kit.js";
import { parseColor, cssLch, gamutChroma, contrast } from "./color.js";
import { hostOf, timecode as timecodeRe } from "./shapes.js";

const niceStep = (span, parts = 100) => {
  const raw = Math.abs(span) / parts || 1,
    p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= raw);
};
const digitsOf = (step) => clamp(Math.max(Math.ceil(-Math.log10(step || 1)), (String(step).split(".")[1] || "").length), 0, 4);
const round = (n, step) => Number(n.toFixed(digitsOf(step) + 1));
const btn = (text, label, onClick, cls = "kx-btn") => {
  const b = el("button", { type: "button", class: cls, "aria-label": label || text, text });
  b.addEventListener("click", onClick);
  return b;
};
const stopKeys = (node) => node.addEventListener("keydown", (e) => e.stopPropagation());

/* ---------- matrix: a grid you edit, with what it does beside it ---------- */
function matrix(api) {
  const { c } = api;
  const grid = el("div", { class: "ki-matrix", role: "grid", "aria-label": `${c.label}. Arrows move between cells; type a number or press Enter to edit; Page Up and Page Down change a cell; drag a cell up or down.` });
  const sums = el("div", { class: "ki-matrix-sums" });
  const preview = s("svg", { class: "ki-matrix-preview", viewBox: "-1.6 -1.6 3.2 3.2", role: "img" });
  let focus = [0, 0],
    dims = "",
    cells = [];
  const span = (v) => {
    const flat = v.flat();
    return { lo: c.min ?? Math.min(0, ...flat), hi: c.max ?? Math.max(1, ...flat) };
  };
  const stepOf = (v) => c.step ?? niceStep(span(v).hi - span(v).lo);
  const put = (v, i, j, n) => {
    const out = v.map((r) => [...r]);
    out[i][j] = round(clamp(n, c.min ?? -Infinity, c.max ?? Infinity), stepOf(v));
    return out;
  };
  const focusCell = (i, j) => {
    const v = api.get();
    focus = [clamp(i, 0, v.length - 1), clamp(j, 0, v[0].length - 1)];
    cells[focus[0]]?.[focus[1]]?.focus();
    paintFocus();
  };
  const paintFocus = () => cells.forEach((r, i) => r.forEach((cell, j) => (cell.tabIndex = i === focus[0] && j === focus[1] ? 0 : -1)));
  // Typed entry inside the cell.
  const typeInto = (i, j, first = "") => {
    const cell = cells[i][j],
      input = el("input", { type: "text", class: "ki-matrix-input", "aria-label": `Row ${i + 1}, column ${j + 1}`, spellcheck: "false" });
    input.value = first || String(api.get()[i][j]);
    cell.replaceChildren(input);
    input.focus();
    if (!first) input.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply)
        try {
          api.edit(put(api.get(), i, j, expression(input.value, {})), "studio-typed");
        } catch {
          /* not a number: keep the cell as it was */
        }
      draw(api.get());
      focusCell(i, j);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  };
  grid.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const [i, j] = focus,
      v = api.get(),
      d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (d) focusCell(i + d[0], j + d[1]);
    else if (e.key === "Home") focusCell(i, 0);
    else if (e.key === "End") focusCell(i, v[0].length - 1);
    else if (e.key === "PageUp" || e.key === "PageDown" || e.key === "+" || e.key === "=" || e.key === "-" && e.altKey)
      api.edit(put(v, i, j, v[i][j] + (e.key === "PageDown" ? -1 : 1) * stepOf(v) * (e.shiftKey ? 0.1 : 10 ** 0)), "studio-key");
    else if (e.key === "Enter" || e.key === "F2") typeInto(i, j);
    else if (/^[0-9.-]$/.test(e.key) && !e.ctrlKey && !e.metaKey) typeInto(i, j, e.key);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  const build = (v) => {
    grid.style.setProperty("--cols", v[0].length);
    cells = v.map((row, i) => row.map((_, j) => el("div", { class: "ki-matrix-cell", role: "gridcell", tabindex: -1 })));
    grid.replaceChildren(...cells.map((r, i) => el("div", { class: "ki-matrix-row", role: "row", "aria-label": `Row ${i + 1}` }, ...r)));
    cells.forEach((r, i) =>
      r.forEach((cell, j) => {
        let y0 = 0,
          v0 = 0,
          moved = false;
        api.cleanup.push(
          pointerSurface(cell, {
            start: (e) => {
              y0 = e.clientY;
              v0 = api.get()[i][j];
              moved = false;
              focusCell(i, j);
              api.ctx.begin("studio-matrix");
            },
            move: (e) => {
              const dy = y0 - e.clientY;
              if (Math.abs(dy) > 2) moved = true;
              if (moved) api.ctx.change(put(api.get(), i, j, v0 + (dy / 2) * stepOf(api.get()) * (e.shiftKey ? 0.1 : e.altKey ? 10 : 1)));
            },
            end: () => api.ctx.commit(),
            cancel: () => api.ctx.cancel(),
          }),
        );
        cell.addEventListener("dblclick", () => typeInto(i, j));
      }),
    );
    paintFocus();
  };
  const tools = el(
    "div",
    { class: "ki-actions" },
    btn("Identity", "Set to the identity matrix", () => {
      const v = api.get();
      api.edit(v.map((r, i) => r.map((_, j) => (i === j ? 1 : 0))), "studio-matrix");
    }),
    btn("Transpose", "Swap rows and columns", () => {
      const v = api.get();
      api.edit(v[0].map((_, j) => v.map((r) => r[j])), "studio-matrix");
    }),
    btn("Add row", "Add a row of zeros", () => {
      const v = api.get();
      api.edit([...v, v[0].map(() => 0)], "studio-matrix");
    }),
    btn("Add column", "Add a column of zeros", () => api.edit(api.get().map((r) => [...r, 0]), "studio-matrix")),
    btn("Remove row", "Remove the row with the focused cell", () => {
      const v = api.get();
      if (v.length > 1) api.edit(v.filter((_, i) => i !== focus[0]), "studio-matrix");
    }),
    btn("Remove column", "Remove the column with the focused cell", () => {
      const v = api.get();
      if (v[0].length > 1) api.edit(v.map((r) => r.filter((_, j) => j !== focus[1])), "studio-matrix");
    }),
  );
  // What a 2x2 or 3x3 matrix does to the plane: a unit grid and an F, before (faint) and after.
  const glyph = [[-0.5, -0.8], [-0.5, 0.8], [0.5, 0.8], [-0.5, 0.8], [-0.5, 0.05], [0.3, 0.05]];
  const apply = (m, [x, y]) => {
    if (m.length === 2 && m[0].length === 2) return [m[0][0] * x + m[0][1] * y, m[1][0] * x + m[1][1] * y];
    const w = m[2][0] * x + m[2][1] * y + m[2][2] || 1e-9;
    return [(m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w];
  };
  const planar = (v) => (v.length === 2 && v[0].length === 2) || (v.length === 3 && v[0].length === 3);
  const previewBlock = el("figure", { class: "ki-matrix-figure" }, preview, el("figcaption", {}));
  function draw(v) {
    const key = `${v.length}x${v[0].length}`;
    if (key !== dims) {
      dims = key;
      build(v);
    }
    const { lo, hi } = span(v);
    v.forEach((row, i) =>
      row.forEach((x, j) => {
        const cell = cells[i][j];
        if (cell.querySelector("input")) return;
        const t = clamp((x - lo) / (hi - lo || 1), 0, 1);
        cell.textContent = humane(x);
        cell.style.setProperty("--heat", `${Math.round(t * 85)}%`);
        cell.classList.toggle("is-hot", t > 0.55);
        cell.setAttribute("aria-label", `Row ${i + 1}, column ${j + 1}: ${x}`);
      }),
    );
    // Row and column sums, drawn as bars beside the grid.
    const rs = v.map((r) => r.reduce((a, b) => a + b, 0)),
      cs = v[0].map((_, j) => v.reduce((a, r) => a + r[j], 0)),
      top = Math.max(1e-9, ...rs.map(Math.abs), ...cs.map(Math.abs));
    sums.replaceChildren(
      el("span", { class: "ki-sum-title", text: "Row sums" }),
      ...rs.map((x, i) => el("span", { class: "ki-sum", style: `--w:${fx(Math.abs(x) / top)}`, title: `Row ${i + 1}: ${x}` }, el("i"), el("b", { text: humane(round(x, 0.001)) }))),
      el("span", { class: "ki-sum-title", text: "Column sums" }),
      ...cs.map((x, j) => el("span", { class: "ki-sum", style: `--w:${fx(Math.abs(x) / top)}`, title: `Column ${j + 1}: ${x}` }, el("i"), el("b", { text: humane(round(x, 0.001)) }))),
    );
    previewBlock.hidden = !planar(v);
    if (planar(v)) {
      const lines = [];
      for (let k = -1; k <= 1; k += 0.5) {
        lines.push([[k, -1], [k, 1]], [[-1, k], [1, k]]);
      }
      const seg = (pts, f) => pts.map((p, i) => `${i ? "L" : "M"}${fx(f(p)[0], 3)} ${fx(-f(p)[1], 3)}`).join("");
      const id = (p) => p,
        T = (p) => apply(v, p),
        dense = (a, b) => Array.from({ length: 9 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 8, a[1] + ((b[1] - a[1]) * i) / 8]);
      preview.replaceChildren(
        s("path", { class: "ki-mx-before", d: lines.map(([a, b]) => seg([a, b], id)).join("") }),
        s("path", { class: "ki-mx-glyph-before", d: seg(glyph, id) }),
        s("path", { class: "ki-mx-after", d: lines.map(([a, b]) => seg(dense(a, b), T)).join("") }),
        s("path", { class: "ki-mx-glyph", d: seg(glyph, T) }),
      );
      const det = v.length === 2 ? v[0][0] * v[1][1] - v[0][1] * v[1][0] : v[0][0] * (v[1][1] * v[2][2] - v[1][2] * v[2][1]) - v[0][1] * (v[1][0] * v[2][2] - v[1][2] * v[2][0]) + v[0][2] * (v[1][0] * v[2][1] - v[1][1] * v[2][0]);
      preview.setAttribute("aria-label", `The plane after this matrix; determinant ${fx(det, 3)}`);
      previewBlock.querySelector("figcaption").textContent = `The plane after it (faint: before). Determinant ${fx(det, 3)}${Math.abs(det) < 1e-9 ? ", flattens the plane" : det < 0 ? ", mirrors" : ""}.`;
    }
  }
  const node = el("div", { class: "ki-matrix-stage" }, el("div", { class: "ki-matrix-wrap" }, grid, sums), previewBlock, tools);
  return {
    node,
    note: "drag a cell up or down; type into it; arrows walk the grid",
    draw,
    hero: (v) => ({ value: `${v.length}×${v[0].length}`, note: "rows × columns", tone: "quiet" }),
    keys: [["Arrows", "walk the cells"], ["Digits Enter", "type into a cell"], ["Page Up Down", "change a cell"]],
    caption: (v) => `${v.length}×${v[0].length}`,
  };
}

/* ---------- palette: swatches, their lightness line, and one colour's three numbers ---------- */
function swatches(api) {
  const { c } = api,
    root = api.panel.root;
  let sel = 0;
  const lch = (x) => {
    try {
      return parseColor(x, root);
    } catch {
      return [0.5, 0, 0, 1];
    }
  };
  const row = el("div", { class: "ki-swatches", role: "radiogroup", "aria-label": `${c.label}: arrows pick a colour` });
  const chart = s("svg", { class: "k-svg ki-svg ki-ramp-chart", role: "group", "aria-label": "Lightness of each colour; drag a dot up or down" });
  const paper = getComputedStyle(root).getPropertyValue("--d-surface") || "#fff";
  const setAt = (v, i, x) => Object.assign([...v], { [i]: x });
  const L = (v) => lch(v[sel] ?? "#808080");
  const putLch = (v, k, n) => {
    const cur = lch(v[sel] ?? "#808080");
    cur[k] = n;
    if (k !== 1) cur[1] = Math.min(cur[1], gamutChroma(cur[0], cur[2], "p3"));
    return setAt(v, sel, cssLch(cur));
  };
  const fields = [
    field(api.ctx, { label: "Lightness", min: 0, max: 1, step: 0.005, digits: 3, get: (v) => L(v)[0], put: (v, n) => putLch(v, 0, n) }),
    field(api.ctx, { label: "Chroma", min: 0, max: 0.37, step: 0.002, digits: 3, get: (v) => L(v)[1], put: (v, n) => putLch(v, 1, n) }),
    field(api.ctx, { label: "Hue", min: 0, max: 360, step: 1, unit: "deg", digits: 0, get: (v) => L(v)[2], put: (v, n) => putLch(v, 2, n) }),
  ];
  const css = el("input", { type: "text", class: "ki-text-field", "aria-label": "Chosen colour as CSS", spellcheck: "false" });
  stopKeys(css);
  css.addEventListener("change", () => {
    try {
      parseColor(css.value, root);
      api.edit(setAt(api.get(), sel, css.value.trim()), "studio-text");
      css.removeAttribute("aria-invalid");
    } catch {
      css.setAttribute("aria-invalid", "true");
    }
  });
  const tools = el(
    "div",
    { class: "ki-actions" },
    btn("Add between", "Add a colour halfway to the next one", () => {
      const v = api.get(),
        a = lch(v[sel] ?? "#808080"),
        b = lch(v[sel + 1] ?? v[sel] ?? "#ffffff"),
        dh = ((b[2] - a[2] + 540) % 360) - 180,
        mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + dh / 2 + 360) % 360, 1];
      const out = [...v];
      out.splice(sel + 1, 0, cssLch(mid));
      sel++;
      api.edit(out, "studio-palette");
    }),
    btn("Remove", "Remove the chosen colour", () => {
      const v = api.get();
      if (!v.length) return;
      api.edit(v.filter((_, i) => i !== sel), "studio-palette");
      sel = clamp(sel, 0, v.length - 2);
    }),
    btn("Move left", "Move the chosen colour left", () => {
      const v = api.get();
      if (sel < 1) return;
      [v[sel - 1], v[sel]] = [v[sel], v[sel - 1]];
      sel--;
      api.edit(v, "studio-palette");
    }),
    btn("Move right", "Move the chosen colour right", () => {
      const v = api.get();
      if (sel >= v.length - 1) return;
      [v[sel + 1], v[sel]] = [v[sel], v[sel + 1]];
      sel++;
      api.edit(v, "studio-palette");
    }),
  );
  row.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    sel = clamp(sel + d, 0, api.get().length - 1);
    draw(api.get());
    row.children[sel]?.focus();
  });
  let size = { w: 1, h: 1 },
    shown = "";
  api.fit(chart, (w, h) => ((size = { w, h }), (shown = ""), draw(api.get())));
  const P = { l: 36, r: 16, t: 14, b: 22 };
  const X = (i, n) => P.l + (n < 2 ? (size.w - P.l - P.r) / 2 : (i / (n - 1)) * (size.w - P.l - P.r)),
    Y = (l) => P.t + (1 - l) * (size.h - P.t - P.b);
  const dots = [];
  function chartDraw(v) {
    if (size.w < 10) return;
    const n = v.length;
    while (dots.length < n) {
      const i = dots.length;
      dots.push(
        api.handle(chart, {
          label: `Colour ${i + 1} lightness`,
          r: 7,
          start: () => {
            sel = i;
            api.ctx.begin("studio-ramp");
          },
          move: (_x, y) => {
            sel = i;
            api.ctx.change(putLch(api.get(), 0, clamp(1 - (y - P.t) / (size.h - P.t - P.b), 0, 1)));
          },
          keys: (_dx, dy) => {
            sel = i;
            api.edit(putLch(api.get(), 0, clamp(L(api.get())[0] - dy * 0.01, 0, 1)), "studio-key");
          },
        }),
      );
    }
    chart.querySelectorAll(".ki-ramp-line, .ki-ramp-grid, .ki-ramp-text").forEach((x) => x.remove());
    const pts = v.map((x, i) => [X(i, n), Y(lch(x)[0])]);
    const grid = s("g", { class: "ki-ramp-grid" });
    for (const l of [0, 0.25, 0.5, 0.75, 1]) grid.append(s("path", { d: `M${P.l} ${fx(Y(l))}H${size.w - P.r}`, class: "ki-grid-line" }), s("text", { x: P.l - 6, y: Y(l) + 4, "text-anchor": "end", class: "ki-ramp-text", text: `L ${l}` }));
    chart.prepend(grid);
    if (n > 1) chart.insertBefore(s("path", { class: "ki-ramp-line", d: pts.map(([x, y], i) => `${i ? "L" : "M"}${fx(x)} ${fx(y)}`).join("") }), dots[0].node);
    dots.forEach((d, i) => {
      d.node.style.display = i < n ? "" : "none";
      if (i >= n) return;
      d.at(pts[i][0], pts[i][1]);
      d.node.querySelector(".k-handle-dot").style.fill = v[i];
      d.node.classList.toggle("is-accent", i === sel);
      d.text(`${fx(lch(v[i])[0], 2)}`);
      d.node.setAttribute("aria-valuenow", fx(lch(v[i])[0], 3));
      d.node.setAttribute("aria-valuemin", 0);
      d.node.setAttribute("aria-valuemax", 1);
    });
  }
  function draw(v) {
    sel = clamp(sel, 0, Math.max(0, v.length - 1));
    const key = JSON.stringify(v) + sel;
    if (key === shown) return;
    shown = key;
    row.replaceChildren(
      ...v.map((x, i) => {
        const [l] = lch(x),
          ratio = (() => {
            try {
              return contrast(lch(x), lch(paper.trim() || "#fff"));
            } catch {
              return 1;
            }
          })();
        const b = el(
          "button",
          { type: "button", role: "radio", class: "ki-swatch", "aria-checked": String(i === sel), tabindex: i === sel ? 0 : -1, "aria-label": `Colour ${i + 1}: ${x}` },
          el("i", { style: `background:${x}` }),
          el("b", { text: x.length > 22 ? x.slice(0, 21) + "…" : x }),
          el("small", { text: `L ${fx(l, 2)} · ${fx(ratio, 1)}:1 on paper` }),
        );
        b.addEventListener("click", () => {
          sel = i;
          draw(api.get());
        });
        return b;
      }),
    );
    if (document.activeElement !== css) css.value = v[sel] ?? "";
    fields.forEach((f) => f.update());
    chartDraw(v);
  }
  const node = el("div", { class: "ki-palette" }, row, block("Lightness across the palette", chart), tools);
  return {
    node,
    note: "pick a swatch; drag its dot for lightness, or tune its three numbers",
    draw,
    fields: [...fields, { node: el("label", { class: "ki-lane ki-lane-stack" }, el("span", { class: "k-field-name", text: "As CSS" }), css), update() {} }],
    fieldsTitle: "Chosen colour",
    fieldsColumns: 1,
    hero: (v) => ({ value: String(v.length), unit: v.length === 1 ? "colour" : "colours", note: `${sel + 1} chosen`, tone: "quiet" }),
    keys: [["Left Right", "pick a swatch"], ["Up Down", "on a dot: lightness"]],
    caption: (v) => `${v.length} colours`,
    mini: (v) => el("span", { class: "ki-mini ki-mini-swatches" }, ...v.slice(0, 8).map((x) => el("i", { style: `background:${x}` }))),
  };
}

/* ---------- tags: words you add, remove and reorder ---------- */
function tags(api) {
  const { c } = api;
  const list = el("ul", { class: "ki-tags", "aria-label": `${c.label}. Delete removes a tag; Alt and arrows move it.` });
  const add = el("input", { type: "text", class: "ki-text-field", "aria-label": `Add to ${c.label}`, placeholder: "Add a tag, Enter (commas add several)", spellcheck: "false" });
  add.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Enter" || !add.value.trim()) return;
    e.preventDefault();
    const words = add.value.split(",").map((x) => x.trim()).filter(Boolean),
      v = api.get();
    api.edit([...v, ...words.filter((w) => !v.includes(w))], "studio-tags");
    add.value = "";
  });
  let focusAt = -1;
  function draw(v) {
    list.replaceChildren(
      ...v.map((t, i) => {
        const chip = el("button", { type: "button", class: "ki-tag", "aria-label": `${t}. Delete to remove; Alt and arrows to move` }, el("span", { text: t }), el("i", { "aria-hidden": "true", text: "×" }));
        chip.addEventListener("click", (e) => {
          if (e.target.tagName === "I") api.edit(api.get().filter((_, k) => k !== i), "studio-tags");
        });
        chip.addEventListener("keydown", (e) => {
          const cur = api.get();
          if (e.key === "Delete" || e.key === "Backspace") {
            focusAt = Math.min(i, cur.length - 2);
            api.edit(cur.filter((_, k) => k !== i), "studio-tags");
          } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            const j = clamp(i + (e.key === "ArrowRight" ? 1 : -1), 0, cur.length - 1);
            [cur[i], cur[j]] = [cur[j], cur[i]];
            focusAt = j;
            api.edit(cur, "studio-tags");
          } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") list.children[clamp(i + (e.key === "ArrowRight" ? 1 : -1), 0, cur.length - 1)]?.querySelector("button")?.focus();
          else return;
          e.preventDefault();
          e.stopPropagation();
        });
        return el("li", {}, chip);
      }),
    );
    if (focusAt >= 0) list.children[focusAt]?.querySelector("button")?.focus();
    focusAt = -1;
  }
  const node = el("div", { class: "ki-tags-stage" }, list, add);
  return {
    node,
    note: "type to add; Delete removes; Alt and arrows reorder",
    draw,
    hero: (v) => ({ value: String(v.length), unit: v.length === 1 ? "tag" : "tags", note: v.length ? `longest: ${v.reduce((a, b) => (b.length > a.length ? b : a), "")}` : "none yet", tone: "quiet" }),
    keys: [["Delete", "remove the focused tag"], ["Alt arrows", "move it"]],
    caption: (v) => v.join(", ") || "no tags",
  };
}

/* ---------- date and time: a calendar and a day you drag across ---------- */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateRe = /^(\d{4})-(\d{2})-(\d{2})(?:([T ])(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(.*))?$/;
function readDate(v) {
  const m = dateRe.exec(v || "");
  if (m) return { y: +m[1], mo: +m[2] - 1, d: +m[3], sep: m[4] || "", h: +(m[5] ?? 0), mi: +(m[6] ?? 0), sec: m[7] === undefined ? null : +m[7], frac: m[8] || "", zone: m[9] || "", time: !!m[4] };
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v || "");
  if (t) return { onlyTime: true, h: +t[1], mi: +t[2], sec: t[3] === undefined ? null : +t[3] };
  const now = new Date();
  return { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(), sep: "", h: 0, mi: 0, sec: null, frac: "", zone: "", time: false };
}
const p2 = (n) => String(n).padStart(2, "0");
function writeDate(x) {
  const time = `${p2(x.h)}:${p2(x.mi)}${x.sec === null ? "" : ":" + p2(x.sec)}`;
  if (x.onlyTime) return time;
  const day = `${String(x.y).padStart(4, "0")}-${p2(x.mo + 1)}-${p2(x.d)}`;
  return x.time ? `${day}${x.sep || "T"}${time}${x.frac || ""}${x.zone || ""}` : day;
}
const daysIn = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
function date(api) {
  const { c } = api;
  const cal = el("div", { class: "ki-cal", role: "grid", "aria-label": `${c.label}: arrows move by a day, Page Up and Page Down by a month` });
  const title = el("div", { class: "ki-cal-title" });
  const nav = el(
    "div",
    { class: "ki-cal-nav" },
    btn("‹", "Previous month", () => shift(0, -1), "kx-btn ki-cal-step"),
    title,
    btn("›", "Next month", () => shift(0, 1), "kx-btn ki-cal-step"),
  );
  const day = s("svg", { class: "k-svg ki-svg ki-day", role: "group", "aria-label": "Time of day; drag the handle" });
  let size = { w: 1, h: 1 };
  api.fit(day, (w, h) => ((size = { w, h }), drawDay(readDate(api.get()))));
  const P = 24;
  const hx = (mins) => P + (mins / 1440) * (size.w - 2 * P);
  const knob = api.handle(day, {
    label: "Time of day; arrows move 15 minutes, Shift 1 minute",
    r: 8,
    cls: "is-accent",
    move: (x) => {
      const x0 = readDate(api.get()),
        mins = clamp(Math.round(((x - P) / (size.w - 2 * P)) * 1440 / 5) * 5, 0, 1435);
      api.ctx.change(writeDate({ ...x0, time: true, h: Math.floor(mins / 60), mi: mins % 60 }));
    },
    keys: (dx, dy, e) => {
      const x0 = readDate(api.get()),
        mins = clamp(x0.h * 60 + x0.mi + (dx - dy) * (e.shiftKey ? 10 : 15), 0, 1439);
      api.edit(writeDate({ ...x0, time: true, h: Math.floor(mins / 60), mi: Math.round(mins) % 60 }), "studio-key");
    },
  });
  function shift(days, months) {
    const x = readDate(api.get());
    if (x.onlyTime) return;
    const t = new Date(Date.UTC(x.y, x.mo + months, 1));
    const d = clamp(x.d, 1, daysIn(t.getUTCFullYear(), t.getUTCMonth()));
    const u = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), d + days));
    api.edit(writeDate({ ...x, y: u.getUTCFullYear(), mo: u.getUTCMonth(), d: u.getUTCDate() }), "studio-calendar");
    requestAnimationFrame(() => cal.querySelector('[aria-selected="true"]')?.focus());
  }
  cal.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [-7, 0], ArrowDown: [7, 0], PageUp: [0, -1], PageDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    shift(d[0], d[1]);
  });
  function drawDay(x) {
    if (size.w < 10) return;
    day.querySelectorAll(".ki-day-art").forEach((n) => n.remove());
    const y = size.h / 2,
      g = s("g", { class: "ki-day-art" });
    // Night, dawn, day, dusk as bands; hours as ticks.
    g.append(s("rect", { x: P, y: y - 14, width: size.w - 2 * P, height: 28, rx: 4, class: "ki-day-band" }));
    g.append(s("rect", { x: hx(360), y: y - 14, width: hx(1080) - hx(360), height: 28, class: "ki-day-light" }));
    for (let hr = 0; hr <= 24; hr++) {
      g.append(s("path", { d: `M${fx(hx(hr * 60))} ${y + 16}v${hr % 6 ? 4 : 8}`, class: "ki-ticks" }));
      if (hr % 3 === 0) g.append(s("text", { x: hx(hr * 60), y: y + 36, "text-anchor": "middle", text: `${p2(hr)}:00` }));
    }
    day.prepend(g);
    knob.at(hx(x.h * 60 + x.mi), y);
    knob.text(`${p2(x.h)}:${p2(x.mi)}`);
    knob.node.setAttribute("aria-valuenow", x.h * 60 + x.mi);
    knob.node.setAttribute("aria-valuetext", `${p2(x.h)}:${p2(x.mi)}`);
  }
  const hasTime = () => {
    const x = readDate(api.get());
    return x.onlyTime || x.time || ["datetime", "datetime-local", "time"].includes(c.type);
  };
  const timeBlock = block("Time of day", day);
  function draw(v) {
    const x = readDate(v);
    cal.hidden = nav.hidden = !!x.onlyTime;
    timeBlock.hidden = !hasTime();
    if (!x.onlyTime) {
      title.textContent = `${MONTHS[x.mo]} ${x.y}`;
      const first = (new Date(Date.UTC(x.y, x.mo, 1)).getUTCDay() + 6) % 7,
        n = daysIn(x.y, x.mo),
        weeks = [];
      let week = [];
      for (let i = 0; i < first; i++) week.push(el("span", { role: "gridcell", class: "ki-cal-pad" }));
      for (let d = 1; d <= n; d++) {
        const on = d === x.d,
          b = el("button", { type: "button", role: "gridcell", class: "ki-cal-day", "aria-selected": String(on), tabindex: on ? 0 : -1, "aria-label": `${d} ${MONTHS[x.mo]} ${x.y}`, text: String(d) });
        b.addEventListener("click", () => api.edit(writeDate({ ...readDate(api.get()), d }), "studio-calendar"));
        week.push(b);
        if (week.length === 7) {
          weeks.push(week);
          week = [];
        }
      }
      if (week.length) {
        while (week.length < 7) week.push(el("span", { role: "gridcell", class: "ki-cal-pad" }));
        weeks.push(week);
      }
      cal.replaceChildren(el("div", { role: "row", class: "ki-cal-row ki-cal-head" }, ...DAYS.map((d) => el("span", { role: "columnheader", text: d }))), ...weeks.map((w) => el("div", { role: "row", class: "ki-cal-row" }, ...w)));
    }
    drawDay(x);
  }
  const node = el("div", { class: "ki-date" }, el("div", { class: "ki-cal-box" }, nav, cal), timeBlock);
  const long = (v) => {
    const x = readDate(v);
    if (x.onlyTime) return `${p2(x.h)}:${p2(x.mi)}`;
    const wd = DAYS[(new Date(Date.UTC(x.y, x.mo, x.d)).getUTCDay() + 6) % 7];
    return `${wd} ${x.d} ${MONTHS[x.mo]} ${x.y}${x.time ? `, ${p2(x.h)}:${p2(x.mi)}${x.zone === "Z" ? " UTC" : x.zone ? " " + x.zone : ""}` : ""}`;
  };
  return {
    node,
    note: "pick a day; arrows by day, Page keys by month",
    draw,
    hero: (v) => {
      const x = readDate(v);
      return x.onlyTime ? { value: `${p2(x.h)}:${p2(x.mi)}`, note: "time of day", tone: "quiet", long: v } : { value: String(x.d), unit: MONTHS[x.mo].slice(0, 3), note: String(x.y), tone: "quiet", long: `${long(v)}\n${v}` };
    },
    keys: [["Arrows", "a day · a week"], ["Page Up Down", "a month"]],
    caption: long,
  };
}

/* ---------- url: the link taken apart into parts you can change ---------- */
function url(api) {
  const { c } = api;
  const parts = el("div", { class: "ki-url-parts" });
  const params = el("div", { class: "ki-url-params" });
  const whole = el("input", { type: "text", class: "ki-text-field", "aria-label": `${c.label} as text`, spellcheck: "false" });
  stopKeys(whole);
  whole.addEventListener("change", () => api.edit(whole.value.trim(), "studio-text"));
  const parse = (v) => {
    try {
      return new URL(v);
    } catch {
      return null;
    }
  };
  const open = el("a", { class: "kx-btn ki-url-open", target: "_blank", rel: "noopener noreferrer", text: "Open in a new tab" });
  function draw(v) {
    const u = parse(v);
    if (document.activeElement !== whole) whole.value = v;
    open.href = u ? u.href : "#";
    open.hidden = !u;
    if (!u) {
      parts.replaceChildren(el("p", { class: "ki-help", text: "Not a full address yet; type one below (it needs https:// or another scheme)." }));
      params.replaceChildren();
      return;
    }
    const segs = u.pathname.split("/").filter(Boolean);
    parts.replaceChildren(
      el("span", { class: "ki-url-scheme", text: `${u.protocol}//` }),
      el("span", { class: "ki-url-host", text: u.host }),
      ...segs.flatMap((p) => [el("span", { class: "ki-url-sep", text: "/" }), el("span", { class: "ki-url-seg", text: decodeURIComponent(p) })]),
      u.hash ? el("span", { class: "ki-url-hash", text: u.hash }) : null,
    );
    const focused = params.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const entries = [...u.searchParams];
    params.replaceChildren(
      ...entries.map(([k, val], i) => {
        const input = el("input", { type: "text", class: "ki-text-field", "aria-label": `Query ${k}`, spellcheck: "false", "data-key": k });
        input.value = val;
        stopKeys(input);
        input.addEventListener("change", () => {
          const next = parse(api.get());
          if (!next) return;
          const list = [...next.searchParams];
          list[i] = [k, input.value];
          next.search = new URLSearchParams(list).toString();
          api.edit(next.href, "studio-query");
        });
        return el("label", { class: "ki-lane ki-lane-row" }, el("span", { class: "k-field-name", text: k }), input);
      }),
    );
    if (focused) params.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
  }
  const node = el("div", { class: "ki-url" }, parts, block("Query", params), el("div", { class: "ki-actions" }, open));
  return {
    node,
    note: "each part of the address, and the query as fields",
    draw,
    fields: [{ node: el("label", { class: "ki-lane ki-lane-stack" }, el("span", { class: "k-field-name", text: "Address" }), whole), update() {} }],
    fieldsTitle: "As text",
    hero: (v) => ({ value: "", long: hostOf(v), note: "", tone: "quiet" }),
    keys: [["Tab", "next part"]],
    caption: (v) => hostOf(v),
  };
}

/* ---------- timecode: four numerals you drag, on a ruler of the hour ---------- */
function timecodeStage(api) {
  const { c } = api,
    fps = c.fps ?? 24;
  const read = (v) => {
    const m = timecodeRe.exec(v || "") || [0, 0, 0, 0, 0];
    return { h: +m[1], m: +m[2], s: +m[3], f: +m[4], sep: /;/.test(v) ? ";" : ":" };
  };
  const write = (t) => `${p2(t.h)}:${p2(t.m)}:${p2(t.s)}${t.sep}${p2(t.f)}`;
  const frames = (t) => ((t.h * 60 + t.m) * 60 + t.s) * fps + t.f;
  const fromFrames = (n, sep) => {
    n = Math.max(0, Math.round(n));
    const f = n % fps,
      sec = Math.floor(n / fps);
    return { h: Math.min(99, Math.floor(sec / 3600)), m: Math.floor(sec / 60) % 60, s: sec % 60, f, sep };
  };
  const units = [
    ["h", "Hours", 3600 * fps],
    ["m", "Minutes", 60 * fps],
    ["s", "Seconds", fps],
    ["f", "Frames", 1],
  ];
  const digits = el("div", { class: "ki-tc" });
  const groups = units.map(([k, name, per]) => {
    const g = el("span", { class: "ki-tc-group", role: "slider", tabindex: 0, "aria-label": `${name}; arrows or drag up and down` });
    let y0 = 0,
      n0 = 0;
    api.cleanup.push(
      pointerSurface(g, {
        start: (e) => {
          y0 = e.clientY;
          n0 = frames(read(api.get()));
          g.focus();
          api.ctx.begin("studio-timecode");
        },
        move: (e) => api.ctx.change(write(fromFrames(n0 + Math.round((y0 - e.clientY) / 6) * per, read(api.get()).sep))),
        end: () => api.ctx.commit(),
        cancel: () => api.ctx.cancel(),
      }),
    );
    g.addEventListener("keydown", (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const t = read(api.get());
      api.edit(write(fromFrames(frames(t) + d * per * (e.altKey ? 10 : 1), t.sep)), "studio-key");
    });
    return [k, g, name];
  });
  groups.forEach(([, g], i) => digits.append(...(i ? [el("span", { class: "ki-tc-colon", text: i === 3 ? ";" : ":" })] : []), el("span", { class: "ki-tc-cell" }, g, el("small", { text: groups[i][2] }))));
  const ruler = s("svg", { class: "k-svg ki-svg ki-tc-ruler", role: "group", "aria-label": "Position in the hour" });
  let size = { w: 1, h: 1 };
  api.fit(ruler, (w, h) => ((size = { w, h }), draw(api.get())));
  const P = 24,
    hour = 3600 * fps;
  const knob = api.handle(ruler, {
    label: "Position within the hour; arrows move a second",
    r: 8,
    cls: "is-accent",
    move: (x) => {
      const t = read(api.get());
      api.ctx.change(write(fromFrames(t.h * hour + clamp((x - P) / (size.w - 2 * P), 0, 1) * (hour - 1), t.sep)));
    },
    keys: (dx, dy) => {
      const t = read(api.get());
      api.edit(write(fromFrames(frames(t) + (dx - dy) * fps, t.sep)), "studio-key");
    },
  });
  function draw(v) {
    const t = read(v);
    groups.forEach(([k, g]) => {
      g.textContent = p2(t[k]);
      g.setAttribute("aria-valuenow", t[k]);
    });
    if (size.w < 10) return;
    ruler.querySelectorAll(".ki-tc-art").forEach((n) => n.remove());
    const g = s("g", { class: "ki-tc-art" }),
      y = size.h / 2;
    g.append(s("rect", { x: P, y: y - 3, width: size.w - 2 * P, height: 6, rx: 3, class: "ki-track" }));
    const within = (frames(t) % hour) / hour;
    g.append(s("rect", { x: P, y: y - 3, width: within * (size.w - 2 * P), height: 6, rx: 3, class: "ki-fill" }));
    for (let mm = 0; mm <= 60; mm += 5) {
      const x = P + (mm / 60) * (size.w - 2 * P);
      g.append(s("path", { d: `M${fx(x)} ${y - 12}v${mm % 15 ? 4 : 8}`, class: "ki-ticks" }));
      if (mm % 15 === 0) g.append(s("text", { x, y: y + 26, "text-anchor": "middle", text: `${p2(t.h)}:${p2(mm % 60 === 0 && mm ? 59 : mm)}${mm === 60 ? ":59" : ""}` }));
    }
    ruler.prepend(g);
    knob.at(P + within * (size.w - 2 * P), y);
    knob.text(`${p2(t.m)}:${p2(t.s)}`);
  }
  return {
    node: el("div", { class: "ki-tc-stage" }, digits, block(`Within hour ${read(api.get()).h}`, ruler)),
    note: `drag a numeral up or down; ${fps} frames a second`,
    draw,
    hero: (v) => ({ value: humane(frames(read(v))), unit: "frames", note: `${fx(frames(read(v)) / fps, 2)} s at ${fps} fps`, tone: "quiet" }),
    keys: [["Up Down", "on a numeral: change it · Alt by ten"]],
    caption: (v) => v,
  };
}

/* ---------- flags: a record of switches ---------- */
function flags(api) {
  const { c } = api;
  const node = el("div", { class: "ki-flags", role: "group", "aria-label": c.label });
  const all = (on) => btn(on ? "All on" : "All off", on ? "Turn every flag on" : "Turn every flag off", () => api.edit(Object.fromEntries(Object.keys(api.get()).map((k) => [k, on])), "studio-flags"));
  const tiles = new Map();
  function draw(v) {
    for (const [k, on] of Object.entries(v)) {
      if (!tiles.has(k)) {
        const b = el("button", { type: "button", role: "switch", class: "ki-flag" }, el("i", { "aria-hidden": "true" }), el("b", { text: c.keys?.[k]?.label || k }), el("span"));
        b.addEventListener("click", () => api.edit({ ...api.get(), [k]: !api.get()[k] }, "studio-flag"));
        tiles.set(k, b);
        node.append(b);
      }
      const b = tiles.get(k);
      b.setAttribute("aria-checked", String(on));
      b.querySelector("span").textContent = on ? "On" : "Off";
    }
  }
  return {
    node: el("div", { class: "ki-flags-stage" }, node, el("div", { class: "ki-actions" }, all(true), all(false))),
    note: "each flag a switch; Space or Enter flips the focused one",
    draw,
    hero: (v) => {
      const n = Object.values(v).filter(Boolean).length;
      return { value: `${n}/${Object.keys(v).length}`, note: "on", tone: "quiet" };
    },
    keys: [["Space", "flip the focused flag"]],
    caption: (v) => Object.entries(v).filter(([, x]) => x).map(([k]) => k).join(", ") || "all off",
  };
}

/* ---------- empty: a control that has no value yet ---------- */
function empty(api) {
  const starts = [
    ["A number", 0],
    ["Some text", ""],
    ["On or off", false],
    ["A list of numbers", [0, 0.5, 1]],
    ["A list of words", []],
  ];
  const node = el(
    "div",
    { class: "ki-empty" },
    el("p", { class: "ki-empty-lead", text: "This control has no value yet." }),
    el("p", { class: "ki-help", text: "Start it as one of these, or write any JSON in Source. Its studio becomes the instrument for that shape." }),
    el("div", { class: "ki-actions" }, ...starts.map(([name, v]) => btn(name, `Start as ${name.toLowerCase()}`, () => api.edit(v, "studio-start")))),
  );
  return {
    node,
    note: "nothing to draw until there is a value",
    draw() {},
    hero: () => ({ value: "", long: "No value", note: "", tone: "quiet" }),
    keys: [["Tab", "pick a start"]],
    caption: (v) => (v === null || v === undefined ? "no value" : JSON.stringify(v)),
  };
}

export const shapeStages = { matrix, swatches, tags, date, url, timecode: timecodeStage, flags, empty };
