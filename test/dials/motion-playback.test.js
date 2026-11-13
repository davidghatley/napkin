// The motion section's written code is executed in the browser and its actual motion compared with
// the panel's model (motionAt), which is also what the studio's ghost draws. Keyed lanes, loop
// ranges and the playhead are exercised by keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Runs `code` (css or waapi) on a fresh element, seeks it to each time and returns the computed
// rotate, transform matrix and opacity next to what motionAt says, normalised the same way.
const probe = (kind, times) => `(()=>{
  const p=dialsDemo.panels[2], code=p.motionCode("time"), host=document.createElement("div");
  host.style.cssText="position:fixed;left:0;top:0;width:400px;height:60px";
  const el=document.createElement("div"), ref=document.createElement("div");
  for (const e of [el, ref]) e.style.cssText="position:absolute;width:28px;height:28px";
  el.className="probe-element"; host.append(el, ref); document.body.append(host);
  let style=null;
  if (${JSON.stringify(kind)}==="css") { style=document.createElement("style"); style.textContent=code.keyframes.replace(/\\.element \\{/, ".probe-element {").replace(/@keyframes time/g, "@keyframes probe-time").replace(/animation: time /, "animation: probe-time ").replace(/, time-loop /, ", probe-time-loop "); document.head.append(style); }
  else new Function("element", code.waapi)(el);
  const anims=el.getAnimations(); anims.forEach(a=>a.pause());
  const out=${JSON.stringify(times)}.map(ms=>{
    anims.forEach(a=>a.currentTime=ms);
    const cs=getComputedStyle(el), at=p.motionAt("time", ms);
    ref.style.transform=at.style.transform; ref.style.rotate=at.style.rotate||"none"; ref.style.opacity=at.style.opacity;
    const rs=getComputedStyle(ref);
    return {ms, anims:anims.length, rotate:parseFloat(cs.rotate)||0, wantRotate:parseFloat(rs.rotate)||0, opacity:+cs.opacity, wantOpacity:+rs.opacity,
      m:new DOMMatrix(cs.transform==="none"?undefined:cs.transform).m41, wantM:new DOMMatrix(rs.transform==="none"?undefined:rs.transform).m41};
  });
  anims.forEach(a=>a.cancel()); host.remove(); style?.remove();
  return JSON.stringify(out);
})()`;

test("motion code runs as the ghost shows: keyed rotation, loop range, playhead by keys", { timeout: 120000 }, async () => {
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 1000 });
  const q = (js) => browser.eval(js);
  try {
    await browser.goto(server.url);
    await browser.waitFor("dialsDemo.panels.length===6");
    await q(`dialsDemo.panels[2].open("path")`);
    await sleep(200);
    const S = `dialsDemo.panels[2].root.querySelector('.d-section[data-depth="3"]')`;
    // Key Rotation on the timeline, then turn the last keyframe from 30 to 60 degrees with the keyboard.
    await q(`${S}.querySelector(".km-key-row button").click()`);
    await sleep(120);
    await q(`(()=>{const lane=[...${S}.querySelectorAll(".km-lane-row")].at(-1);const d=[...lane.querySelectorAll(".k-handle")].at(-1);d.focus();for(let i=0;i<30;i++)d.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}))})()`);
    await sleep(120);
    const rot = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].get("path").map(k=>k["--rotation"]))`));
    assert.deepEqual([rot[0], rot.at(-1)], [30, 60]);
    const code = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].motionCode("time"))`));
    assert.match(code.keyframes, /@property --rotation \{ syntax: "<number>"; inherits: false; initial-value: 30; \}/);
    assert.match(code.keyframes, /rotate: calc\(var\(--rotation\) \* 1deg\);/);
    assert.doesNotMatch(code.keyframes, /rotate: 30deg;/, "a keyed angle is not also written as a fixed rotate");
    assert.match(code.waapi, /CSS\.registerProperty\(\{ name: "--rotation"/);
    // Executed CSS and WAAPI match the model at points across delay, both segments and the end.
    // (1320 ms would be the next iteration's start: the section loops.)
    const times = [0, 120, 300, 600, 780, 1000, 1316];
    for (const kind of ["css", "waapi"]) {
      const rows = JSON.parse(await q(probe(kind, times)));
      for (const r of rows) {
        assert.ok(Math.abs(r.rotate - r.wantRotate) < 1, `${kind} rotate at ${r.ms} ms: ${r.rotate} vs ${r.wantRotate}`);
        assert.ok(Math.abs(r.m - r.wantM) < 1, `${kind} x at ${r.ms} ms: ${r.m} vs ${r.wantM}`);
        assert.ok(Math.abs(r.opacity - r.wantOpacity) < 0.02, `${kind} opacity at ${r.ms} ms`);
      }
      assert.ok(rows.at(-1).rotate > 59, `${kind} ends turned 60°, got ${rows.at(-1).rotate}`);
    }
    // The ghost on the spacing chart shows the same turn as the model at the playhead.
    await q(`(()=>{const h=${S}.querySelector(".km-playhead");h.focus();h.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))})()`);
    await sleep(60);
    const ghost = JSON.parse(await q(`JSON.stringify({now:+${S}.querySelector(".km-playhead").getAttribute("aria-valuenow"),rot:+${S}.querySelector(".km-ghost .km-block").dataset.rotate})`));
    assert.equal(ghost.now, 1320);
    assert.ok(Math.abs(ghost.rot - 60) < 0.5, `ghost turned ${ghost.rot}`);
    // Playhead by keys: Home, then arrows move by 1% of the duration; Insert adds a key that changes no motion.
    await q(`(()=>{const h=${S}.querySelector(".km-playhead");h.dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true}));for(let i=0;i<40;i++)h.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))})()`);
    await sleep(60);
    assert.equal(+(await q(`${S}.querySelector(".km-playhead").getAttribute("aria-valuenow")`)), 120 + 480);
    const before = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].motionAt("time",600))`)),
      count = await q(`dialsDemo.panels[2].get("path").length`);
    await q(`${S}.querySelector(".km-playhead").dispatchEvent(new KeyboardEvent("keydown",{key:"Insert",bubbles:true}))`);
    await sleep(80);
    assert.equal(await q(`dialsDemo.panels[2].get("path").length`), count + 1);
    // The new key holds exactly what was on screen at its time.
    const added = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].get("path").find(k=>Math.abs(k.offset-0.4)<0.001))`));
    assert.ok(added, "a keyframe at 40%");
    assert.ok(Math.abs(parseFloat(/translateX\(([-\d.]+)/.exec(added.transform)[1]) - before.x) < 0.05);
    assert.ok(Math.abs(added["--rotation"] - before.vars["--rotation"]) < 0.05);
    assert.ok(Math.abs(added.opacity - before.opacity) < 0.01);
    const now = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].motionAt("time",600))`));
    assert.ok(Math.abs(now.x - before.x) < 0.05 && Math.abs(now.rotate - before.rotate) < 0.05, "same pose at the key's own time");
    // A loop range changes the written code and the executed motion: after the range's end it repeats.
    await q(`(()=>{const p=dialsDemo.panels[2];p.transact("ease",{...p.get("ease"),loopRange:[0.2,0.6]})})()`);
    const ranged = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].motionCode("time"))`));
    assert.notEqual(ranged.keyframes, code.keyframes);
    assert.match(ranged.keyframes, /@keyframes time-loop \{/);
    assert.match(ranged.keyframes, /time-loop 480ms linear 840ms infinite/);
    assert.equal(ranged.waapi.match(/\.animate\(/g).length, 2, "WAAPI plays the motion, then the range on repeat");
    assert.match(ranged.waapi, /duration: 480, delay: 840, iterations: Infinity \}\);/);
    for (const kind of ["css", "waapi"]) {
      // 840 ms is the range's end; 840 + 120 plays the range from 0.2 + 0.1 again: the model at 120 + 0.3 × 1200.
      const [r] = JSON.parse(await q(probe(kind, [960])));
      const want = JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].motionAt("time", 480))`));
      assert.ok(Math.abs(r.rotate - parseFloat(want.style.rotate)) < 1, `${kind} loop rotate ${r.rotate} vs ${want.style.rotate}`);
      assert.ok(Math.abs(r.m - want.x) < 1.5, `${kind} loop x ${r.m} vs ${want.x}`);
    }
    // And the code reads back with the range and the keyed lane intact.
    await q(`dialsDemo.panels[2].applyMotionCode("time", ${JSON.stringify(ranged.keyframes)})`);
    assert.deepEqual(JSON.parse(await q(`JSON.stringify(dialsDemo.panels[2].get("ease").loopRange)`)), [0.2, 0.6]);
    await q(`dialsDemo.panels[2].applyMotionCode("time", ${JSON.stringify(code.keyframes)})`);
    assert.equal(await q(`dialsDemo.panels[2].get("ease").loopRange===undefined`), true, "code without a range clears it");
  } finally {
    await browser.close();
    await server.close();
  }
});
