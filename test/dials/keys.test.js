// The page-wide palette and copy/paste between controls of different types, in real Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";

test("Ctrl K from anywhere lists every panel; values copy and paste across types", { timeout: 120000 }, async (t) => {
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 1000 });
  const q = (js) => browser.eval(js);
  try {
    await browser.goto(server.url);
    await browser.waitFor("dialsDemo.panels.length===6");
    await t.test("Ctrl K on the page body opens one palette listing controls of all six panels", async () => {
      await q(`dialsDemo.panels[0].rows.get("opacity").label.focus()`);
      await q(`document.activeElement.blur()`);
      const r = JSON.parse(await q(`(()=>{const ev=new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true,cancelable:true});document.body.dispatchEvent(ev);
        const d=document.querySelector("dialog[open]");const i=d.querySelector("input");i.value="Control Labels";i.dispatchEvent(new Event("input"));
        const first=d.querySelector("[role=option] .d-palette-text").textContent;
        i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return JSON.stringify({prevented:ev.defaultPrevented,dialogs:document.querySelectorAll("dialog[open]").length,first})})()`));
      assert.ok(r.prevented);
      assert.equal(r.first, "Control Labels");
      await new Promise((res) => setTimeout(res, 60));
      assert.equal(await q(`document.activeElement.closest("[data-control]")?.dataset.control`), "labels", "focus moved into the data panel");
      assert.equal(await q(`dialsDemo.panels[4].root.contains(document.activeElement)`), true);
      const n = await q(`(()=>{document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true,cancelable:true}));const d=document.querySelector("dialog[open]");const i=d.querySelector("input");const ids=new Set();for(const p of dialsDemo.panels)for(const c of p.schema.sections[0].controls){i.value="Control "+c.label;i.dispatchEvent(new Event("input"));if(d.querySelector("[role=option] .d-palette-text")?.textContent==="Control "+c.label)ids.add(c.id)}d.close();return ids.size})()`);
      assert.equal(n, 24, "every control of every panel is reachable from one palette");
    });
    const copyPaste = (fromPanel, fromId, toPanel, toId) =>
      q(`(()=>{const dt=new DataTransfer();const a=dialsDemo.panels[${fromPanel}].rows.get(${JSON.stringify(fromId)}).label;a.focus();a.dispatchEvent(new ClipboardEvent("copy",{clipboardData:dt,bubbles:true,cancelable:true}));
        const b=dialsDemo.panels[${toPanel}].rows.get(${JSON.stringify(toId)}).label;b.focus();b.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));
        return JSON.stringify(dialsDemo.panels[${toPanel}].get(${JSON.stringify(toId)}))})()`);
    await t.test("a colour pasted on a gradient becomes its stops; a gradient pasted on a colour gives its first stop", async () => {
      const g = JSON.parse(await copyPaste(0, "ink", 0, "gradient"));
      assert.match(g, /^linear-gradient\(/);
      assert.ok(g.includes(JSON.parse(await q(`JSON.stringify(dialsDemo.panels[0].get("ink"))`))));
      await q(`dialsDemo.panels[0].update({gradient:"linear-gradient(90deg, #112233, #ffffff)"})`);
      assert.equal(JSON.parse(await copyPaste(0, "gradient", 0, "ink")), "#112233");
    });
    await t.test("a number pasted across panels lands inside the target's range; on a switch it reads as on or off", async () => {
      await q(`dialsDemo.panels[0].update({opacity:0.4})`);
      assert.equal(JSON.parse(await copyPaste(0, "opacity", 4, "pointSize")), 1, "0.4 clamps to the 1 px minimum");
      assert.equal(JSON.parse(await copyPaste(0, "opacity", 4, "labels")), true);
    });
    await t.test("copy works inside a studio, for the control the studio shows", async () => {
      await q(`dialsDemo.panels[2].open("rotation")`);
      await new Promise((res) => setTimeout(res, 120));
      const v = await q(`(()=>{const dt=new DataTransfer();const n=dialsDemo.panels[2].root.querySelector('.d-section[data-depth="3"] .d-lab [tabindex="0"]');n.dispatchEvent(new ClipboardEvent("copy",{clipboardData:dt,bubbles:true,cancelable:true}));return dt.getData("application/x-dials+json")})()`);
      assert.equal(JSON.parse(v).type, "angle");
      await q(`dialsDemo.panels[2].setDepth([...dialsDemo.panels[2].sections.keys()][0],2,false)`);
    });
  } finally {
    await browser.close();
    await server.close();
  }
});
