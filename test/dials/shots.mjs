// Screenshot every sample at every depth, light and dark, 1x and 2x.
// node test/dials/shots.mjs <outdir> [filter]   (filter: substring of the shot name)
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
try {
  for (const scale of scales) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: scale, mobile: false });
    for (const theme of themes) {
      await browser.goto(server.url);
      await browser.waitFor("window.dialsDemo&&dialsDemo.panels.length===6");
      await browser.eval("document.fonts.ready.then(()=>true)");
      if (theme === "dark") await browser.eval('document.querySelector("#theme").click()');
      const shot = async (name) => {
        if (filter && !`${theme}-${name}-${scale}x`.includes(filter)) return;
        await new Promise((r) => setTimeout(r, 350));
        writeFileSync(`${out}/${name}-${theme}-${scale}x.png`, await browser.screenshot());
      };
      const all = (d) => browser.eval(`dialsDemo.panels.forEach(p=>[...p.sections.keys()].forEach(id=>p.setDepth(id,${d},false)));scrollTo(0,0);true`);
      await all(1); await shot("dials");
      await all(2); await shot("benches");
      await browser.eval("scrollTo(0,document.body.scrollHeight);true"); await shot("benches-lower");
      for (const [i, name] of names.entries()) {
        if (filter && !`${theme}-studio-${name}-${scale}x`.includes(filter)) continue;
        await browser.eval(`(()=>{scrollTo(0,0);const p=dialsDemo.panels[${i}];p.setDepth([...p.sections.keys()][0],3,false);return true})()`);
        await shot(`studio-${name}`);
        await browser.eval(`(()=>{const p=dialsDemo.panels[${i}];p.setDepth([...p.sections.keys()][0],2,false);return true})()`);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
