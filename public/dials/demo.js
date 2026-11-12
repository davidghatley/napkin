import { Dials, registerControl, registerFigure } from "./dials.js";
import { samples, gallery } from "./schemas.js";
import { el } from "./dom.js";
const panels = [],
  events = [];
window.dialsDemo = {
  panels,
  samples,
  events,
  Dials,
  registerControl,
  registerFigure,
  gallery,
};
const eventOut = document.querySelector("#event");
for (const sample of samples) {
  const card = el(
    "article",
    { class: "study", id: `sample-${sample.id}` },
    el(
      "div",
      { class: "study-head" },
      el(
        "div",
        {},
        el("h2", { text: sample.title }),
        el("p", { text: sample.file }),
      ),
    ),
  );
  const mount = el("div", { class: "study-mount" });
  card.append(mount);
  document.querySelector("#studies").append(card);
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
  }).render(sample.schema);
  panels.push(panel);
}
// A plugin follows exactly the built-in edit lifecycle.
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
  node.replaceChildren(el("span", { text: `${Math.round(value * 100)}%` }));
  node.style.opacity = 0.2 + value * 0.8;
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
const galleryPanel = new Dials(document.querySelector("#gallery"), {
  theme: "light",
}).render(catalogue);
window.dialsDemo.galleryPanel = galleryPanel;
const theme = document.querySelector("#theme");
theme.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  for (const p of [...panels, galleryPanel]) {
    p.root.dataset.theme = next;
    for (const s of p.sections.values()) s.lab?.update?.();
  }
  theme.textContent = next === "light" ? "Dark" : "Light";
});
for (const b of document.querySelectorAll("[data-depth]"))
  b.addEventListener("click", () =>
    panels.forEach((p) =>
      [...p.sections.keys()].forEach((id) =>
        p.setDepth(id, Number(b.dataset.depth)),
      ),
    ),
  );
document
  .querySelector("#help")
  .addEventListener("click", () => panels[0].help());
const select = document.querySelector("#schema-select"),
  source = document.querySelector("#schema-source");
samples.forEach((s, i) =>
  select.append(el("option", { value: i, text: s.title })),
);
select.addEventListener(
  "change",
  () =>
    (source.textContent = JSON.stringify(
      samples[Number(select.value)].schema,
      null,
      2,
    )),
);
select.dispatchEvent(new Event("change"));
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
