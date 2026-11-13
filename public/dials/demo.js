import { Dials, registerControl, registerFigure } from "./dials.js";
import { samples, gallery, lampRig } from "./schemas.js";
import { el } from "./dom.js";
import { adjust } from "./kit.js";
import { sectionPicture, coverCanvas, missingWords } from "./sources.js";
import { contrast, parseColor } from "./color.js";
import { schedule } from "./figures.js";
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
/**
 * The demo's own picture file. The demo is the host here: it hands the panel these bytes through
 * the schema's source contract, as napkin hands over a file's bytes.
 */
function stillLife(w = 320, h = 180) {
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h }),
    g = c.getContext("2d", { willReadFrequently: true }),
    k = w / 320;
  g.scale(k, h / 180);
  const back = g.createLinearGradient(0, 0, 320, 180);
  back.addColorStop(0, "#17266c");
  back.addColorStop(1, "#526bca");
  g.fillStyle = back;
  g.fillRect(0, 0, 320, 180);
  g.fillStyle = "#e5ddbf";
  g.fillRect(0, 135, 320, 45);
  g.fillStyle = "#11214f";
  g.beginPath();
  g.ellipse(180, 142, 88, 12, 0, 0, Math.PI * 2);
  g.fill();
  const orange = g.createRadialGradient(145, 76, 1, 179, 100, 65);
  orange.addColorStop(0, "#ffcc56");
  orange.addColorStop(0.6, "#ed7d21");
  orange.addColorStop(1, "#792e16");
  g.fillStyle = orange;
  g.beginPath();
  g.arc(177, 95, 53, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#749b42";
  g.beginPath();
  g.ellipse(181, 39, 22, 7, -0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f2eee0";
  g.fillRect(34, 70, 45, 65);
  g.fillStyle = "#c9c5b6";
  g.fillRect(73, 70, 8, 65);
  return c;
}
// still-life.png, as the demo host serves it.
const stillLifeFile = { url: stillLife(640, 360).toDataURL("image/png"), name: "still-life.png", type: "image/png" };
for (const sample of samples)
  for (const s of sample.schema.sections) for (const c of s.controls) if (c.type === "asset" && c.value === "still-life.png") c.source = stillLifeFile;
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
  // The motion subject runs the CSS the panel writes, on a real element: what plays here is the
  // file's code. The faint trail is panel.motionAt(), the same model the studio's ghost uses.
  motion(node, get, panel) {
    node.classList.add("subject-motion");
    const style = el("style"),
      stage = el("div", { class: "motion-stage" }),
      rail = el("div", { class: "motion-rail" }),
      trail = el("div", { class: "motion-trail" }),
      clock = el("output", { class: "motion-clock" });
    let box = el("div", { class: "motion-box" });
    stage.append(rail, trail, box);
    node.append(style, stage, clock);
    let raf = 0,
      visible = true,
      shown = "";
    // The running animation is looked up once per new code (getAnimations() flushes style); the
    // clock then only reads its time, ten times a second.
    let last = 0,
      anim = null;
    const tick = (now) => {
      raf = 0;
      const a = now - last > 100 && anim;
      if (a) last = now;
      if (a) clock.textContent = `${Math.round(Math.max(0, Number(a.currentTime) || 0) % 100000)} ms`;
      if (visible && !reduced.matches) raf = requestAnimationFrame(tick);
    };
    const apply = () => {
      const css = panel.motionCode("time").keyframes.replace(/\.element \{/, ".subject-motion .motion-box {");
      if (css === shown) return;
      shown = css;
      style.textContent = css;
      // A fresh element starts the animation from its beginning.
      const next = box.cloneNode();
      box.replaceWith(next);
      box = next;
      const m = panel.motionModel("time").motion;
      const running = box.getAnimations();
      anim = running[0] || null;
      if (reduced.matches) for (const an of running) (an.pause(), (an.currentTime = (m.delay || 0) + (m.duration || 1000)));
      trail.replaceChildren(
        ...Array.from({ length: 11 }, (_, i) => {
          const at = panel.motionAt("time", (m.delay || 0) + (i / 10) * (m.duration || 1000)),
            g = el("i");
          Object.assign(g.style, at.style, { opacity: String(0.15 + 0.35 * at.opacity) });
          return g;
        }),
      );
      if (!raf) raf = requestAnimationFrame(tick);
    };
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(tick);
    }).observe(node);
    return () => apply();
  },
  // The picture the section names, through the same source contract the panel uses.
  image(node, get, panel) {
    node.classList.add("subject-image");
    const canvas = Object.assign(document.createElement("canvas"), { width: 320, height: 180 }),
      g = canvas.getContext("2d"),
      out = g.createImageData(320, 180),
      note = el("p", { class: "subject-note" });
    canvas.setAttribute("aria-hidden", "true");
    node.append(canvas, note);
    let original = null,
      name = null;
    const draw = () => {
      const pic = sectionPicture(panel, panel.schema.sections[0], () => draw());
      if (pic?.image && pic.name !== name) (name = pic.name), (original = coverCanvas(pic, 320, 180).getContext("2d").getImageData(0, 0, 320, 180));
      if (!pic?.image) (original = null), (name = null);
      note.hidden = !!original;
      canvas.hidden = !original;
      if (!original) {
        note.textContent = pic === undefined ? "Reading the picture…" : missingWords(get("asset"));
        return;
      }
      const v = get("levels");
      adjust(original, out, v, get("enabled"));
      g.putImageData(out, 0, 0);
      const crop = [v.cropTop || 0, v.cropRight || 0, v.cropBottom || 0, v.cropLeft || 0];
      canvas.style.clipPath = `inset(${crop.map((n) => `${n * 100}%`).join(" ")} round ${get("radius")}px)`;
    };
    return draw;
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
    // Nothing is generated on this page, so the subject shows what the batch would run: each image's
    // seed, drawn as its own 32 bits (8 across, 4 down, high bit first), and the settings it runs with.
    const bits = (canvas, seed) => {
      const g = canvas.getContext("2d"),
        img = g.createImageData(8, 4),
        on = [74, 108, 238],
        off = [32, 36, 48];
      for (let i = 0; i < 32; i++) img.data.set([...((seed >>> (31 - i)) & 1 ? on : off), 255], i * 4);
      g.putImageData(img, 0, 0);
    };
    return () => {
      const s = get("sampling"),
        count = Math.min(6, get("batch")),
        seed = get("seed") >>> 0;
      while (tiles.children.length > count) tiles.lastElementChild.remove();
      while (tiles.children.length < count)
        tiles.append(el("figure", {}, Object.assign(document.createElement("canvas"), { width: 8, height: 4 }), el("figcaption")));
      [...tiles.children].forEach((t, i) => {
        bits(t.firstChild, (seed + i) >>> 0);
        t.lastChild.textContent = `seed ${(seed + i) >>> 0}`;
      });
      line.replaceChildren(
        el("b", { text: `${get("batch")} × ${s.steps} steps` }),
        ` · ${s.scheduler} · cfg ${s.cfg} · no images made here · “${get("prompt")}”`,
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
    // The result stays in sight at every depth: above the rows at dial and bench, at the top of the
    // studio's rail (beside the rows it came with) when the studio covers the page.
    onDepth: (id, depth) => {
      card.classList.toggle("is-studio", depth === 3);
      const rail = depth === 3 && mount.querySelector(`.d-section[data-section="${CSS.escape(id)}"] .d-rail`);
      if (rail) rail.prepend(subject);
      else if (subject.parentElement !== card) card.insertBefore(subject, mount);
      subject.classList.toggle("is-anchored", !!rail);
      requestAnimationFrame(() => draw());
    },
    onChange: (event) => {
      events.push(event);
      if (events.length > 200) events.shift();
      eventOut.value = `${sample.title} / ${event.control} · ${event.phase}`;
    },
  });
  panel.addEventListener("paint", (e) => draw(e.detail.control));
  panel.render(sample.schema);
  draw = subjects[sample.id]?.(subject, (id) => panel.get(id), panel) || (() => {});
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
