import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";

test(
  "every sample, theme and depth passes axe, studios included",
  { timeout: 120000 },
  async (t) => {
    const source = readFileSync(
      createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
      "utf8",
    );
    const server = await serve(),
      browser = await launchChromium({ width: 1440, height: 1100 }),
      results = [];
    try {
      await browser.goto(server.url);
      await browser.waitFor("dialsDemo.panels.length===6");
      await browser.eval(source);
      // The source inspector and complete control catalogue participate in every audit.
      await browser.eval('document.querySelector(".catalog").open=true');
      const names = ["color", "typography", "motion", "image", "data", "generation"];
      for (const theme of ["light", "dark"]) {
        if (theme === "dark")
          await browser.eval('document.querySelector("#theme").click()');
        for (const [index, name] of names.entries()) {
          for (const depth of [2, 3]) {
            await browser.eval(
              `(()=>{const p=dialsDemo.panels[${index}];const id=[...p.sections.keys()][0];p.setDepth(id,${depth},false)})()`,
            );
            await new Promise((resolve) => setTimeout(resolve, 200));
            const violations = await browser.eval(
              "axe.run(document).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))",
            );
            const studio = depth === 3 ? "studio" : "bench";
            results.push({ theme, name, studio, violations });
            await t.test(`${theme} / ${name} / ${studio}`, () =>
              assert.deepEqual(violations, []),
            );
          }
          await browser.eval(
            `(()=>{const p=dialsDemo.panels[${index}];p.setDepth([...p.sections.keys()][0],2,false)})()`,
          );
        }
      }
      if (process.env.DIALS_EVIDENCE) {
        mkdirSync(process.env.DIALS_EVIDENCE, { recursive: true });
        writeFileSync(
          process.env.DIALS_EVIDENCE + "/accessibility.json",
          JSON.stringify(results, null, 2),
        );
      }
    } finally {
      await browser.close();
      await server.close();
    }
  },
);

// Every tab of every full editor (once the studio), both themes: the six samples, the lamp rig the library was never
// written for, and every documented and hostile value shape. axe runs on the open editor, which stays inside its panel.
test("every tab of every studio passes axe in both themes", { timeout: 600000 }, async (t) => {
  const { hostileSchemas } = await import("./hostile.js");
  const source = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 1000 }),
    failures = [];
  let tabs = 0;
  try {
    await browser.goto(server.url);
    await browser.waitFor("dialsDemo.panels.length===6");
    await browser.eval(source);
    const sweep = `async (panelExpr) => {
      const p = eval(panelExpr), out = [];
      const sid = [...p.sections.keys()][0];
      for (const c of p.schema.sections[0].controls) {
        if (!p.rows.has(c.id)) continue;
        p.open(c.id);
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));
        const s = p.root.querySelector('.d-section[data-depth="3"]');
        const r = await axe.run(s, { resultTypes: ["violations"] });
        // the full editor opens in place inside its panel: never a fixed overlay, never wider than the panel
        const b = s.getBoundingClientRect(), h = p.root.getBoundingClientRect(), placed = getComputedStyle(s).position !== "fixed" && b.left >= h.left - 0.5 && b.right <= h.right + 0.5;
        out.push({ id: c.id, v: r.violations.map((v) => v.id + " " + v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")).concat(placed ? [] : ["editor outside its panel"]) });
      }
      p.setDepth(sid, 2, false);
      return out;
    }`;
    const extra = [`dialsDemo.lampRig`, ...hostileSchemas(6).map((s) => JSON.stringify(s))];
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await browser.eval('document.querySelector("#theme").click()');
      for (let i = 0; i < 6; i++) {
        for (const x of await browser.eval(`(${sweep})("dialsDemo.panels[${i}]")`)) {
          tabs++;
          if (x.v.length) failures.push(`${theme} / panel ${i} / ${x.id}: ${x.v.join("; ")}`);
        }
      }
      for (const schema of extra) {
        const res = await browser.eval(`(async()=>{const h=document.createElement("div");h.className="t-axe";h.style.cssText="position:absolute;left:0;top:0;width:1100px";document.body.append(h);window.tAxe=new dialsDemo.Dials(h).render(${schema});const r=await (${sweep})("window.tAxe");tAxe.destroy();h.remove();return r})()`);
        for (const x of res) {
          tabs++;
          if (x.v.length) failures.push(`${theme} / extra / ${x.id}: ${x.v.join("; ")}`);
        }
      }
    }
    await t.test(`${tabs} studio tabs, 0 violations`, () => assert.deepEqual(failures, []));
    assert.ok(tabs > 150, `swept ${tabs} tabs`);
  } finally {
    await browser.close();
    await server.close();
  }
});

// Every tab stop has a name, read from Chromium's own accessibility tree (not a DOM guess):
// the page as it loads, and every tab of every studio.
test("every focusable node has an accessible name, page and every studio tab", { timeout: 300000 }, async (t) => {
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 1000 }),
    unnamed = [];
  let checked = 0;
  const scan = async (where) => {
    const { nodes } = await browser.send("Accessibility.getFullAXTree");
    for (const n of nodes) {
      if (n.ignored || !n.properties?.some((p) => p.name === "focusable" && p.value.value)) continue;
      if (["RootWebArea", "generic", "none", "presentation"].includes(n.role?.value)) continue;
      checked++;
      if (!(n.name?.value || "").trim()) unnamed.push(`${where}: ${n.role?.value} #${n.backendDOMNodeId}`);
    }
  };
  try {
    await browser.goto(server.url);
    await browser.waitFor("dialsDemo.panels.length===6");
    await browser.send("Accessibility.enable");
    await scan("page");
    for (let i = 0; i < 6; i++) {
      const ids = await browser.eval(`dialsDemo.panels[${i}].schema.sections[0].controls.map(c=>c.id)`);
      for (const id of ids) {
        await browser.eval(`dialsDemo.panels[${i}].open(${JSON.stringify(id)})`);
        await new Promise((r) => setTimeout(r, 120));
        await scan(`panel ${i} / ${id}`);
        if (await browser.eval(`(()=>{const p=dialsDemo.panels[${i}],s=p.root.querySelector('.d-section[data-depth="3"]');return !s||getComputedStyle(s).position==="fixed"})()`)) unnamed.push(`panel ${i} / ${id}: the editor did not open in place`);
      }
      await browser.eval(`(()=>{const p=dialsDemo.panels[${i}];p.setDepth([...p.sections.keys()][0],2,false)})()`);
    }
    await t.test(`${checked} focusable nodes checked, none unnamed`, () => assert.deepEqual(unnamed, []));
  } finally {
    await browser.close();
    await server.close();
  }
});
