// Ad hoc screenshots: node test/dials/shoot.mjs <outdir> <plan.json>
// plan: [{ name, width?, height?, theme?, js }]; js runs in the demo page and may return a promise.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
const [out, planFile] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planFile, "utf8"));
mkdirSync(out, { recursive: true });
const server = await serve(),
  browser = await launchChromium({ width: 1440, height: 900 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
browser.onEvent((e) => {
  if (e.method === "Runtime.exceptionThrown") errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
});
let last = "";
try {
  for (const p of plan) {
    const key = `${p.width || 1440}x${p.height || 900}/${p.theme || "light"}/${p.scale || 1}`;
    if (key !== last || p.reload) {
      await browser.send("Emulation.setDeviceMetricsOverride", { width: p.width || 1440, height: p.height || 900, deviceScaleFactor: p.scale || 1, mobile: (p.width || 1440) < 500 });
      await browser.goto(server.url);
      await browser.waitFor("window.dialsDemo&&dialsDemo.panels.length===6");
      await browser.eval("document.fonts.ready.then(()=>true)");
      if (p.theme === "dark") await browser.eval('document.querySelector("#theme").click()');
      last = key;
    }
    const r = await browser.eval(`Promise.resolve((async()=>{${p.js}})()).then(x=>JSON.stringify(x??null))`);
    await pause(p.wait ?? 350);
    writeFileSync(`${out}/${p.name}.png`, await browser.screenshot());
    if (r && r !== "null") console.log(p.name, r);
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) console.log("ERRORS", errors);
