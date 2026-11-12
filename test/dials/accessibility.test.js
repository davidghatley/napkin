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
