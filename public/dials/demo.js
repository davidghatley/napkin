import { Dials, registerControl, registerFigure } from "./dials.js";
import { samples, gallery, lampRig } from "./schemas.js";
import { el } from "./dom.js";
import { stillLife, adjust } from "./kit.js";
import { framesAt, motionAt } from "./motion.js";
import { contrast, parseColor } from "./color.js";
import { schedule, hash } from "./figures.js";
const panels = [],
  events = [];
window.dialsDemo = { panels, samples, events, Dials, registerControl, registerFigure, gallery, lampRig };
const eventOut = document.querySelector("#event");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const SVG = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/* Subjects: the thing each panel's values make, drawn live above the instrument. */
const subjects = {
  color(node, get) {
    node.classList.add("subject-color");
    const card = el("div", { class: "card" }),
      aa = el("div", { class: "aa", text: "Aa" }),
      cta = el("span", { class: "cta", text: "Continue" }),
      meta = el("span", { class: "meta" });
    card.append(aa, meta, cta);
    card.style.gridTemplateAreas = "\"aa meta\" \"aa cta\"";
    aa.style.gridArea = "aa";
    meta.style.gridArea = "meta";
    cta.style.gridArea = "cta";
    node.append(card);
    return () => {
      const ink = get("ink"),
        sh = get("shadow");
      node.style.background = get("gradient");
      aa.style.color = ink;
      cta.style.background = ink;
      cta.style.opacity = get("opacity");
      card.style.boxShadow = `${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread}px ${sh.color}`;
      try {
        meta.textContent = `${contrast(parseColor(ink, node), [1, 0, 0, 1]).toFixed(2)} : 1 on white`;
      } catch {
        meta.textContent = "";
      }
    };
  },
  typography(node, get) {
    node.classList.add("subject-type");
    const copy = el("div", { class: "copy" }),
      caption = el("div", { class: "caption" }),
      inner = el("div", { class: "inner" }, copy, caption),
      box = el("div", { class: "box" }, inner);
    node.append(box);
    return () => {
      const t = get("typeface"),
        [top, right, bottom, left] = get("spacing");
      Object.assign(copy.style, {
        fontFamily: t.family,
        fontSize: `${t.size}px`,
        fontWeight: t.weight,
        letterSpacing: `${t.tracking}px`,
        lineHeight: t.lineHeight,
        textAlign: get("align"),
        fontVariationSettings: `"wght" ${t.weight}`,
      });
      copy.textContent = t.text;
      caption.textContent = get("copy");
      caption.style.textAlign = get("align");
      inner.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    };
  },
  motion(node, get) {
    node.classList.add("subject-motion");
    const svg = svgEl("svg", { "aria-hidden": "true" }),
      track = svgEl("path", { stroke: "var(--frame)", "stroke-dasharray": "2 4" }),
      ghosts = svgEl("g"),
      block = svgEl("rect", { width: 28, height: 28, rx: 3, fill: "var(--accent)" }),
      clock = svgEl("text", { x: 12, y: 20, "font-size": 11, fill: "var(--muted)" });
    svg.append(track, ghosts, block, clock);
    node.append(svg);
    let start = performance.now(),
      raf = 0,
      visible = true;
    const geometry = () => {
      const w = node.clientWidth || 400,
        h = node.clientHeight || 152,
        frames = get("path"),
        reach = Math.max(1, ...frames.map((f) => Math.abs(Number(/translateX\((-?[\d.]+)/.exec(f.transform)?.[1] || 0)))),
        k = Math.min(1, (w - 96) / reach);
      return { w, h, k, x0: 34, y: h / 2 + 6 };
    };
    const place = (g, t) => {
      const v = get("ease"),
        p = framesAt(get("path"), t, v);
      return { x: g.x0 + p.x * g.k, opacity: p.opacity };
    };
    const ghost = () => {
      const g = geometry();
      track.setAttribute("d", `M${g.x0} ${g.y + 22}H${g.w - 24}`);
      ghosts.replaceChildren();
      for (let i = 0; i <= 10; i++) {
        const p = place(g, i / 10);
        ghosts.append(
          svgEl("rect", {
            x: p.x - 14,
            y: g.y - 14,
            width: 28,
            height: 28,
            rx: 3,
            fill: "none",
            stroke: "var(--accent)",
            "stroke-opacity": 0.12 + (i / 10) * 0.3,
            "stroke-dasharray": "2 2",
            transform: `rotate(${get("rotation")} ${p.x} ${g.y})`,
          }),
          svgEl("path", { d: `M${p.x} ${g.y + 19}V${g.y + 25}`, stroke: "var(--muted)", "stroke-width": i % 5 ? 1 : 1.5 }),
        );
      }
    };
    const frame = (now) => {
      raf = 0;
      const v = get("ease"),
        total = (v.duration || 1000) + (v.delay || 0) + 500,
        loop = get("loop");
      let ms = now - start;
      if (loop) ms %= total;
      const t = reduced.matches ? 1 : Math.min(1, Math.max(0, ms - (v.delay || 0)) / (v.duration || 1000));
      const g = geometry(),
        p = place(g, t);
      block.setAttribute("x", p.x - 14);
      block.setAttribute("y", g.y - 14);
      block.setAttribute("opacity", p.opacity);
      block.setAttribute("transform", `rotate(${get("rotation") * motionAt(t, { mode: "bezier", bezier: [0.4, 0, 0.2, 1] })} ${p.x} ${g.y})`);
      clock.textContent = `${Math.round(t * (v.duration || 1000))} ms`;
      if (visible && !reduced.matches && (loop || ms < total)) raf = requestAnimationFrame(frame);
    };
    // The subject grows when its panel folds to a dial; redraw the ghost at the new size.
    new ResizeObserver(() => ghost()).observe(node);
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    }).observe(node);
    return (control) => {
      ghost();
      if (control !== "loop" || get("loop")) start = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    };
  },
  image(node, get) {
    node.classList.add("subject-image");
    const src = stillLife(320, 180),
      original = src.getContext("2d").getImageData(0, 0, 320, 180),
      canvas = Object.assign(document.createElement("canvas"), { width: 320, height: 180 }),
      g = canvas.getContext("2d"),
      out = g.createImageData(320, 180);
    canvas.setAttribute("aria-hidden", "true");
    node.append(canvas);
    return () => {
      const v = get("levels");
      adjust(original, out, v, get("enabled"));
      g.putImageData(out, 0, 0);
      const crop = [v.cropTop || 0, v.cropRight || 0, v.cropBottom || 0, v.cropLeft || 0];
      canvas.style.clipPath = `inset(${crop.map((n) => `${n * 100}%`).join(" ")} round ${get("radius")}px)`;
    };
  },
  data(node, get) {
    node.classList.add("subject-data");
    const svg = svgEl("svg", { "aria-hidden": "true" });
    node.append(svg);
    const control = samples.find((s) => s.id === "data").schema.sections[0].controls[0],
      rows = control.data;
    return () => {
      const e = get("channels"),
        mark = get("mark"),
        r0 = get("pointSize"),
        labels = get("labels"),
        w = node.clientWidth || 400,
        h = node.clientHeight || 152,
        pad = { l: 28, r: 12, t: 12, b: 20 };
      svg.replaceChildren();
      const num = (f) => rows.map((d) => d[f]).filter((n) => typeof n === "number"),
        scale = (f, a, b) => {
          const xs = num(f),
            lo = Math.min(...xs),
            hi = Math.max(...xs);
          return (n) => a + ((n - lo) / (hi - lo || 1)) * (b - a);
        },
        X = e.x ? scale(e.x, pad.l, w - pad.r) : () => w / 2,
        Y = e.y ? scale(e.y, h - pad.b, pad.t) : () => h / 2,
        S = e.size ? scale(e.size, r0 * 0.5, r0 * 1.6) : () => r0,
        groups = [...new Set(rows.map((d) => d[e.color]))],
        palette = ["var(--accent)", "var(--text)", "#c2410c"],
        C = (d) => (e.color ? palette[groups.indexOf(d[e.color]) % 3] : palette[0]);
      svg.append(svgEl("path", { d: `M${pad.l} ${pad.t}V${h - pad.b}H${w - pad.r}`, stroke: "var(--frame)", fill: "none" }));
      const axis = (text, x, y, anchor) => {
        const t = svgEl("text", { x, y, "font-size": 10.5, fill: "var(--muted)", "text-anchor": anchor });
        t.textContent = text;
        svg.append(t);
      };
      axis(e.x || "", w - pad.r, h - 6, "end");
      axis(e.y || "", pad.l + 4, pad.t + 8, "start");
      const sorted = [...rows].sort((a, b) => a[e.x] - b[e.x]);
      if (mark === "line")
        for (const gname of e.color ? groups : [null]) {
          const pts = sorted.filter((d) => !e.color || d[e.color] === gname);
          svg.append(svgEl("path", { d: pts.map((d, i) => `${i ? "L" : "M"}${X(d[e.x]).toFixed(1)} ${Y(d[e.y]).toFixed(1)}`).join(""), stroke: C(pts[0]), fill: "none", "stroke-width": 1.5 }));
        }
      for (const d of rows) {
        if (mark === "bar") {
          const bw = Math.max(2, (w - pad.l - pad.r) / rows.length - 2);
          svg.append(svgEl("rect", { x: X(d[e.x]) - bw / 2, y: Y(d[e.y]), width: bw, height: h - pad.b - Y(d[e.y]), fill: C(d), opacity: 0.85 }));
        } else if (mark === "point")
          svg.append(svgEl("circle", { cx: X(d[e.x]), cy: Y(d[e.y]), r: S(d[e.size] ?? 1), fill: C(d), "fill-opacity": 0.8 }));
        if (labels && d[e.x] % 4 === 1) axis(String(Math.round(d[e.y])), X(d[e.x]) + 5, Y(d[e.y]) - 5, "start");
      }
    };
  },
  generation(node, get) {
    node.classList.add("subject-gen");
    const tiles = el("div", { class: "tiles", "aria-hidden": "true" }),
      line = el("p");
    node.append(tiles, line);
    // A stand-in for a sampler's output: the seed's noise, smoothed by steps and pushed by guidance.
    const paint = (canvas, seed, steps, cfg) => {
      const n = 32,
        g = canvas.getContext("2d"),
        img = g.createImageData(n, n),
        r = hash(seed),
        field = Array.from({ length: n * n }, () => r()),
        passes = Math.round(Math.min(14, steps / 2.5));
      for (let p = 0; p < passes; p++)
        for (let i = 0; i < n * n; i++) {
          const x = i % n,
            y = (i / n) | 0,
            at = (dx, dy) => field[((y + dy + n) % n) * n + ((x + dx + n) % n)];
          field[i] = (at(0, 0) * 2 + at(1, 0) + at(-1, 0) + at(0, 1) + at(0, -1)) / 6;
        }
      const lo = Math.min(...field),
        hi = Math.max(...field),
        k = 0.6 + cfg / 12;
      const ink = [31, 69, 211],
        paper = [244, 241, 232],
        deep = [14, 18, 48];
      for (let i = 0; i < n * n; i++) {
        let t = (field[i] - lo) / (hi - lo || 1);
        t = Math.min(1, Math.max(0, 0.5 + (t - 0.5) * k * 1.6));
        const c = t < 0.5 ? deep.map((d, j) => d + (ink[j] - d) * t * 2) : ink.map((d, j) => d + (paper[j] - d) * (t - 0.5) * 2);
        img.data.set([...c, 255], i * 4);
      }
      g.putImageData(img, 0, 0);
    };
    return () => {
      const s = get("sampling"),
        count = Math.min(6, get("batch")),
        seed = get("seed");
      while (tiles.children.length > count) tiles.lastElementChild.remove();
      while (tiles.children.length < count)
        tiles.append(Object.assign(document.createElement("canvas"), { width: 32, height: 32 }));
      [...tiles.children].forEach((c, i) => {
        c.style.imageRendering = s.steps < 12 ? "pixelated" : "auto";
        paint(c, seed + i * 7919, s.steps * (s.denoise ?? 1), s.cfg);
      });
      line.replaceChildren(
        el("b", { text: `${get("batch")} × ${s.steps} steps` }),
        ` · ${s.scheduler} · cfg ${s.cfg} · “${get("prompt")}”`,
      );
      void schedule;
    };
  },
};

for (const sample of samples) {
  const card = el(
    "article",
    { class: "study", id: `sample-${sample.id}` },
    el(
      "div",
      { class: "study-head" },
      el("h2", { text: sample.title }),
      el("p", { text: sample.file }),
    ),
  );
  const subject = el("div", { class: "subject", role: "img", "aria-label": `${sample.title}: live result of the values below` }),
    mount = el("div", { class: "study-mount" });
  card.append(subject, mount);
  document.querySelector("#studies").append(card);
  let draw = () => {};
  const panel = new Dials(mount, {
    theme: "light",
    studio: "viewport",
    label: sample.title,
    onDepth: (id, depth) => card.classList.toggle("is-studio", depth === 3),
    onChange: (event) => {
      events.push(event);
      if (events.length > 200) events.shift();
      eventOut.value = `${sample.title} / ${event.control} · ${event.phase}`;
    },
  });
  panel.addEventListener("paint", (e) => draw(e.detail.control));
  panel.render(sample.schema);
  draw = subjects[sample.id]?.(subject, (id) => panel.get(id)) || (() => {});
  requestAnimationFrame(() => draw());
  // Subjects drawn to their box redraw when the box changes size (a folded panel gives them room).
  if (sample.id === "data") new ResizeObserver(() => draw()).observe(subject);
  panels.push(panel);
}
// A plugin follows exactly the built-in edit lifecycle and draws its own figure.
registerControl("pulse", {
  mount(ctx) {
    const input = el("input", {
      type: "range",
      min: 0,
      max: 1,
      step: 0.01,
      "aria-label": ctx.control.label,
    });
    input.addEventListener("input", () => {
      ctx.begin("plugin");
      ctx.change(Number(input.value));
    });
    input.addEventListener("change", () => ctx.commit());
    return {
      element: input,
      update: (v) => {
        input.value = v;
      },
    };
  },
});
registerFigure("pulse", (node, c, value) => {
  const bars = Array.from({ length: 12 }, (_, i) => {
    const h = 3 + Math.abs(Math.sin(i * 0.9)) * 16 * value;
    return `<rect x="${4 + i * 6}" y="${12 - h / 2}" width="3" height="${h}" rx="1.5" fill="var(--d-accent)"/>`;
  }).join("");
  node.innerHTML = `<svg viewBox="0 0 76 24" width="76" height="24" aria-hidden="true">${bars}</svg>`;
});
const catalogue = structuredClone(gallery);
catalogue.sections[0].controls.push({
  id: "plugin",
  type: "pulse",
  label: "Plugin pulse",
  value: 0.7,
  depth: 1,
  figure: "pulse",
});
const galleryPanel = new Dials(document.querySelector("#gallery"), { theme: "light" }).render(catalogue);
window.dialsDemo.galleryPanel = galleryPanel;
const theme = document.querySelector("#theme");
theme.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  for (const p of [...panels, galleryPanel]) {
    p.root.dataset.theme = next;
    for (const s of p.sections.values()) s.lab?.update?.();
  }
  theme.textContent = next === "light" ? "Dark" : "Light";
});
const depthButtons = [...document.querySelectorAll(".depth-all [data-depth]")];
const markDepth = (d) => depthButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.depth === String(d))));
markDepth(2);
for (const b of depthButtons)
  b.addEventListener("click", () => {
    panels.forEach((p) => [...p.sections.keys()].forEach((id) => p.setDepth(id, Number(b.dataset.depth))));
    markDepth(b.dataset.depth);
  });
document.querySelector("#help").addEventListener("click", () => panels[0].help());
const pick = document.querySelector("#schema-pick"),
  source = document.querySelector("#schema-source");
const show = (i) => {
  source.textContent = JSON.stringify(samples[i].schema, null, 2);
  [...pick.children].forEach((b, j) => {
    b.setAttribute("aria-checked", String(i === j));
    b.tabIndex = i === j ? 0 : -1;
  });
};
samples.forEach((s, i) => {
  const b = el("button", { type: "button", role: "radio", text: s.title });
  b.addEventListener("click", () => show(i));
  pick.append(b);
});
pick.addEventListener("keydown", (e) => {
  const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!dir) return;
  e.preventDefault();
  const i = [...pick.children].findIndex((b) => b.getAttribute("aria-checked") === "true"),
    next = (i + dir + samples.length) % samples.length;
  show(next);
  pick.children[next].focus();
});
show(0);
document.querySelector("#performance").addEventListener("click", async () => {
  const mount = el("div");
  mount.style.cssText = "position:fixed;left:-2000px;width:360px";
  document.body.append(mount);
  const panel = new Dials(mount),
    schema = {
      sections: [
        {
          id: "large",
          label: "Large panel",
          controls: Array.from({ length: 200 }, (_, i) => ({
            id: `n${i}`,
            type: "number",
            label: `Value ${i}`,
            value: i,
            min: 0,
            max: 1000,
            step: 1,
            depth: 1,
          })),
        },
      ],
    };
  const swaps = [];
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    panel.render(schema);
    mount.getBoundingClientRect();
    swaps.push(performance.now() - start);
    await new Promise(requestAnimationFrame);
  }
  swaps.sort((a, b) => a - b);
  document.querySelector("#performance-result").value =
    `200 controls · median ${swaps[6].toFixed(1)}ms · p95 ${swaps[11].toFixed(1)}ms`;
  panel.destroy();
  mount.remove();
});
