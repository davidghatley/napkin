import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";

test(
  "all directions, themes and flagship depths have named keyboard surfaces",
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
      for (const direction of ["a", "b", "c"]) {
        await browser.goto(server.url + "?dir=" + direction);
        await browser.waitFor("dialsDemo.panels.length===6");
        await browser.eval(source);
        // The source inspector and complete control catalogue participate in every audit.
        await browser.eval('document.querySelector(".catalog").open=true');
        for (const theme of ["light", "dark"]) {
          if (theme === "dark")
            await browser.eval('document.querySelector("#theme").click()');
          for (const studio of ["bench", "color", "motion"]) {
            await browser.eval(
              'dialsDemo.panels[0].setDepth("pigment",2);dialsDemo.panels[2].setDepth("time",2)',
            );
            if (studio === "color")
              await browser.eval('dialsDemo.panels[0].open("ink")');
            if (studio === "motion")
              await browser.eval('dialsDemo.panels[2].open("ease")');
            await new Promise((resolve) => setTimeout(resolve, 180));
            const violations = await browser.eval(
              "axe.run(document).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))",
            );
            results.push({ direction, theme, studio, violations });
            await t.test(`${direction} / ${theme} / ${studio}`, () =>
              assert.deepEqual(violations, []),
            );
          }
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
