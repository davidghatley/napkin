// Screenshot everything a person can open: every sample at every depth, every studio tab of
// every section (one shot per control), the palette and the key map, and a panel the library
// was never written for (the lamp rig) in a 560 px host. Light and dark, 1x and 2x.
// node test/dials/shots.mjs <outdir> [filter]   (filter: substring of the file name)
import { mkdirSync, writeFileSync } from "node:fs";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
const out = process.argv[2] || "shots",
  filter = process.argv[3] || "",
  scales = (process.env.SCALES || "1,2").split(",").map(Number),
  themes = (process.env.THEMES || "light,dark").split(",");
mkdirSync(out, { recursive: true });
const server = await serve(),
  browser = await launchChromium({ width: 1440, height: 900 });
const names = ["color", "typography", "motion", "image", "data", "generation"];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let count = 0;
try {
  for (const scale of scales) {
    for (const theme of themes) {
      await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: scale, mobile: false });
      await browser.goto(server.url);
      await browser.waitFor("window.dialsDemo&&dialsDemo.panels.length===6");
      await browser.eval("document.fonts.ready.then(()=>true)");
      if (theme === "dark") await browser.eval('document.querySelector("#theme").click()');
      const want = (name) => !filter || `${name}-${theme}-${scale}x`.includes(filter);
      const shot = async (name, wait = 300) => {
        if (!want(name)) return;
        await pause(wait);
        writeFileSync(`${out}/${name}-${theme}-${scale}x.png`, await browser.screenshot());
        count++;
      };
      const all = (d) => browser.eval(`dialsDemo.panels.forEach(p=>[...p.sections.keys()].forEach(id=>p.setDepth(id,${d},false)));scrollTo(0,0);true`);
      await all(1);
      await shot("dials");
      await all(2);
      await shot("benches");
      await browser.eval("scrollTo(0,document.body.scrollHeight);true");
      await shot("benches-lower");
      // Every studio tab: one shot per control of every section.
      for (const [i, name] of names.entries()) {
        const ids = await browser.eval(`dialsDemo.panels[${i}].schema.sections[0].controls.map(c=>c.id)`);
        for (const [n, id] of ids.entries()) {
          const file = `studio-${name}-${n + 1}-${id}`;
          if (!want(file)) continue;
          await browser.eval(`(()=>{scrollTo(0,0);dialsDemo.panels[${i}].open(${JSON.stringify(id)});return true})()`);
          await shot(file, 380);
        }
        await browser.eval(`(()=>{const p=dialsDemo.panels[${i}];p.setDepth([...p.sections.keys()][0],2,false);return true})()`);
      }
      // The palette (empty and typed) and the key map.
      if (want("palette") || want("keys")) {
        await browser.eval(`(()=>{scrollTo(0,0);const p=dialsDemo.panels[0];p.rows.get("opacity").label.focus();p.palette();return true})()`);
        await shot("palette");
        await browser.eval(`(()=>{const i=document.querySelector("dialog[open] input");i.value="wash";i.dispatchEvent(new Event("input"));return true})()`);
        await shot("palette-typed");
        await browser.eval(`(()=>{const i=document.querySelector("dialog[open] input");i.value="reset op";i.dispatchEvent(new Event("input"));return true})()`);
        await shot("palette-reset");
        await browser.eval(`document.querySelector("dialog[open]").close();true`);
        await browser.eval(`(()=>{dialsDemo.panels[2].help();return true})()`);
        await shot("keys");
        await browser.eval(`document.querySelector("dialog[open]").close();true`);
      }
      // A panel the library has never seen, in a 560 px host: bench, then every tab.
      const host = `(()=>{let h=document.querySelector("#shot-host");if(!h){h=document.createElement("div");h.id="shot-host";h.style.cssText="position:fixed;left:24px;top:24px;width:560px;height:852px;z-index:500;background:var(--paper,#f5f4ef);overflow:auto;box-shadow:0 0 0 100vmax rgb(0 0 0 / .35)";document.body.append(h);}
        h.replaceChildren();const p=new dialsDemo.Dials(h,{theme:${JSON.stringify(theme)}}).render(dialsDemo.lampRig);window.shotPanel=p;return true})()`;
      if (want("custom")) {
        await browser.eval(host);
        await shot("custom-bench");
        const ids = await browser.eval(`dialsDemo.lampRig.sections[0].controls.map(c=>c.id)`);
        for (const [n, id] of ids.entries()) {
          const file = `custom-${n + 1}-${id}`;
          if (!want(file)) continue;
          await browser.eval(`(()=>{shotPanel.open(${JSON.stringify(id)});document.querySelector("#shot-host").scrollTo(0,0);return true})()`);
          await shot(file, 380);
        }
        await browser.eval(`document.querySelector("#shot-host").remove();true`);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`${count} screenshots in ${out}`);
