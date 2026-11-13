// Any number in the motion section can be keyed on the timeline and gets its own lane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";

test("motion studio: key a section control as a lane, drag it, read it at the playhead, remove it", { timeout: 120000 }, async () => {
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 1000 });
  const q = (js) => browser.eval(js);
  try {
    await browser.goto(server.url);
    await browser.waitFor("dialsDemo.panels.length===6");
    await q(`dialsDemo.panels[2].open("path")`);
    await new Promise((r) => setTimeout(r, 200));
    const S = `dialsDemo.panels[2].root.querySelector('.d-section[data-depth="3"]')`;
    assert.deepEqual(JSON.parse(await q(`JSON.stringify([...${S}.querySelectorAll(".km-key-row button")].map(b=>b.textContent))`)), ["+ Rotation"]);
    await q(`${S}.querySelector(".km-key-row button").click()`);
    await new Promise((r) => setTimeout(r, 150));
    const rot = await q(`dialsDemo.panels[2].get("rotation")`);
    assert.ok(JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].get("path").every(k=>k["--rotation"]===${rot}))`)), "every keyframe holds the value it had");
    assert.deepEqual(JSON.parse(await q(`JSON.stringify([...${S}.querySelectorAll(".km-lane-name")].map(n=>n.textContent))`)), ["Opacity", "Rotation"]);
    // The last diamond of the Rotation lane, moved with the keyboard, changes only that keyframe.
    await q(`(()=>{const lane=[...${S}.querySelectorAll(".km-lane-row")].at(-1);const d=[...lane.querySelectorAll(".k-handle")].at(-1);d.focus();d.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}))})()`);
    await new Promise((r) => setTimeout(r, 100));
    const f = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].get("path").map(k=>k["--rotation"]))`));
    assert.equal(f[0], rot);
    assert.notEqual(f.at(-1), rot);
    assert.match(await q(`[...${S}.querySelectorAll(".km-lane-now")].at(-1).textContent`), /° at \d+ ms$/);
    // Labels sit on their own line: no lane name overlaps a diamond.
    assert.equal(await q(`[...${S}.querySelectorAll(".km-lane-row")].filter(row=>{const n=row.querySelector(".km-lane-name").getBoundingClientRect();return [...row.querySelectorAll(".k-handle")].some(h=>{const b=h.getBoundingClientRect();return b.left<n.right&&b.right>n.left&&b.top<n.bottom&&b.bottom>n.top})}).length`), 0);
    await q(`${S}.querySelector(".km-unkey").click()`);
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].get("path").every(k=>!("--rotation" in k)))`)));
  } finally {
    await browser.close();
    await server.close();
  }
});
