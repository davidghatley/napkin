import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = process.env.DIALS_EVIDENCE;
const names = ["color", "typography", "motion", "image", "data", "generation"];
const S = '.d-section[data-depth=\\"3\\"]';
test("studios: drawn, dragged, typed and read back", { timeout: 240000 }, async (t) => {
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 900 }),
    errors = [];
  browser.onEvent((e) => {
    if (e.method === "Runtime.exceptionThrown") errors.push(e.params.exceptionDetails.exception?.description);
  });
  const q = (x) => browser.eval(x);
  const key = async (k, code = k, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"]) await browser.send("Input.dispatchKeyEvent", { type, key: k, code, modifiers });
  };
  const mouse = (type, x, y, extra = {}) => browser.send("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
  const drag = async (sel, dx, dy) => {
    const b = JSON.parse(await q(`(()=>{const r=document.querySelector("${sel}").getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`));
    await mouse("mouseMoved", b.x, b.y);
    await mouse("mousePressed", b.x, b.y, { buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 4; i++) await mouse("mouseMoved", b.x + (dx * i) / 4, b.y + (dy * i) / 4, { buttons: 1 });
    await mouse("mouseReleased", b.x + dx, b.y + dy, { clickCount: 1 });
    await sleep(60);
  };
  const open = (index, depth = 3) => q(`(()=>{const p=dialsDemo.panels[${index}];p.setDepth([...p.sections.keys()][0],${depth},false)})()`);
  const shot = async (name) => {
    if (!evidence) return;
    await sleep(250);
    mkdirSync(evidence, { recursive: true });
    writeFileSync(`${evidence}/${name}.png`, await browser.screenshot());
  };
  try {
    await browser.goto(server.url);
    await browser.waitFor("window.dialsDemo?.panels.length===6");
    await t.test("each studio fills the window, marks itself, and needs no sideways scroll", async () => {
      for (const [i, name] of names.entries()) {
        await open(i);
        await sleep(300);
        const m = JSON.parse(
          await q(`(()=>{const s=document.querySelector('.d-section[data-depth="3"]'),inner=s.querySelector('.d-section-inner'),r=s.getBoundingClientRect();
            return JSON.stringify({top:r.top,bottom:r.bottom,w:r.width,h:r.height,fixed:getComputedStyle(s).position,
              studioFor:s.dataset.studioFor,overflowX:inner.scrollWidth-inner.clientWidth,vw:innerWidth,vh:innerHeight,
              blanks:[...s.querySelectorAll('.k-main,.k-side,.d-cx-main,.d-cx-side')].filter(n=>n.getBoundingClientRect().height<40).length})})()`),
        );
        assert.equal(m.fixed, "fixed", name);
        assert.ok(m.top >= 0 && m.bottom <= m.vh, `${name} inside viewport`);
        assert.ok(m.w * m.h > m.vw * m.vh * 0.3, `${name} covers 30%`);
        assert.ok(m.studioFor, `${name} has data-studio-for`);
        assert.ok(m.overflowX <= 0, `${name} scrolls sideways`);
        assert.equal(m.blanks, 0, `${name} has an empty column`);
        await shot(`studio-${name}-light`);
        await open(i, 2);
      }
    });
    await t.test("no browser-native selects or range inputs inside any studio", async () => {
      for (const [i, name] of names.entries()) {
        await open(i);
        await sleep(150);
        assert.equal(await q(`document.querySelectorAll("${S} select, ${S} input[type=range]").length`), 0, name);
        await open(i, 2);
      }
    });
    await t.test("motion: bezier handles sit on the curve and drag; spring peak drags; code reads back", async () => {
      await open(2);
      await sleep(250);
      const before = await q('dialsDemo.panels[2].get("ease")');
      await drag(`${S} .km-peak`, 0, 30);
      const after = await q('dialsDemo.panels[2].get("ease")');
      assert.ok(after.damping > before.damping, `damping ${before.damping} -> ${after.damping}`);
      await q(`[...document.querySelectorAll("${S} .km-head [role=radio]")].find(b=>b.textContent==="Bezier").click()`);
      await sleep(80);
      assert.equal(await q(`[...document.querySelectorAll("${S} .km-bez")].filter(n=>n.style.display!=="none").length`), 2);
      const b0 = (await q('dialsDemo.panels[2].get("ease")')).bezier;
      await drag(`${S} .km-bez`, -20, -25);
      const b1 = (await q('dialsDemo.panels[2].get("ease")')).bezier;
      assert.notDeepEqual(b1, b0);
      await q(`document.querySelector("${S} .km-bez").focus()`);
      assert.match(await q(`document.querySelector("${S} .km-chip text").textContent`), /^x [\d.]+ {2}y -?[\d.]+$/);
      await q('window.__code=null;dialsDemo.panels[2].addEventListener("value",e=>{if(e.detail.phase==="commit"&&e.detail.code)window.__code=e.detail.code})');
      await q(`document.querySelector("${S} .km-bez").focus()`);
      await key("ArrowUp");
      const code = await q("window.__code");
      assert.match(code.keyframes, /@keyframes time/);
      assert.match(code.waapi, /animate\(/);
      assert.match(code.transition, /cubic-bezier\(/);
      await q(`[...document.querySelectorAll("${S} [role=radio]")].find(b=>b.textContent==="Transition").click()`);
      await q(`(()=>{const c=document.querySelector("${S} .km-code");c.focus();c.value=".element { transition: transform 900ms cubic-bezier(0.1, 0.2, 0.3, 0.4) 50ms; }";c.dispatchEvent(new Event("input",{bubbles:true}))})()`);
      await sleep(400);
      const read = await q('dialsDemo.panels[2].get("ease")');
      assert.deepEqual([read.duration, read.delay, read.bezier], [900, 50, [0.1, 0.2, 0.3, 0.4]]);
      await q(`document.querySelector("${S} .km-code").blur()`);
      await q('dialsDemo.panels[2].reset("ease")');
      await open(2, 2);
    });
    await t.test("motion: keyframe diamonds drag on the track, arrows move them, delete removes one", async () => {
      await open(2);
      await sleep(250);
      const f0 = await q('dialsDemo.panels[2].get("path")');
      assert.equal(await q(`document.querySelectorAll("${S} .km-key").length`), f0.length);
      await q(`document.querySelectorAll("${S} .km-key")[1].focus()`);
      await key("ArrowUp");
      const f1 = await q('dialsDemo.panels[2].get("path")');
      assert.equal(f1[1].transform, "translateX(133px)");
      await key("ArrowRight");
      assert.ok((await q('dialsDemo.panels[2].get("path")'))[1].offset > f1[1].offset);
      const kx = JSON.parse(await q(`(()=>{const r=document.querySelectorAll("${S} .km-key")[1].getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`));
      await mouse("mouseMoved", kx.x, kx.y);
      await mouse("mousePressed", kx.x, kx.y, { buttons: 1, clickCount: 1 });
      await mouse("mouseMoved", kx.x, kx.y + 20, { buttons: 1 });
      await mouse("mouseReleased", kx.x, kx.y + 20, { clickCount: 1 });
      const f2 = await q('dialsDemo.panels[2].get("path")');
      assert.ok(parseFloat(f2[1].transform.slice(11)) < 133, f2[1].transform);
      await q(`document.querySelectorAll("${S} .km-key")[1].focus()`);
      await key("Delete", "Delete");
      await sleep(80);
      assert.equal((await q('dialsDemo.panels[2].get("path")')).length, f0.length - 1);
      await q('dialsDemo.panels[2].reset("path")');
      await open(2, 2);
    });
    await t.test("image: crop handles and the tone curve drag; levels triangles move gamma", async () => {
      await open(3);
      await sleep(300);
      await drag(`${S} .ki-crop-nw`, 60, 30);
      let v = await q('dialsDemo.panels[3].get("levels")');
      assert.ok(v.cropLeft > 0.05 && v.cropTop > 0.05, JSON.stringify(v));
      const g0 = v.gamma;
      await drag(`${S} .ki-tri.is-grey`, -30, 0);
      v = await q('dialsDemo.panels[3].get("levels")');
      assert.ok(v.gamma > g0, `gamma ${g0} -> ${v.gamma}`);
      await drag(`${S} .ki-pt:nth-of-type(3)`, 0, -30);
      v = await q('dialsDemo.panels[3].get("levels")');
      assert.ok(v.curve.some((y, i) => Math.abs(y - i / 4) > 0.03), `curve ${v.curve}`);
      assert.match(await q(`document.querySelector("${S} .k-hero-num").textContent`), /^\d\.\d+$/);
      await q('dialsDemo.panels[3].reset("levels")');
      await open(3, 2);
    });
    await t.test("studio fields: arrows, typed expressions and choices change the value", async () => {
      await open(5);
      await sleep(200);
      const bar = `[...document.querySelectorAll("${S} .k-field")].find(f=>f.querySelector(".k-field-name").textContent==="Steps")`;
      await q(`${bar}.querySelector(".k-bar").focus()`);
      await key("ArrowRight");
      assert.equal((await q('dialsDemo.panels[5].get("sampling")')).steps, 29);
      await q(`(()=>{const i=${bar}.querySelector("input");i.focus();i.value="20+12";i.dispatchEvent(new Event("input",{bubbles:true}));i.blur()})()`);
      assert.equal((await q('dialsDemo.panels[5].get("sampling")')).steps, 32);
      await q(`document.querySelectorAll("${S} .kx-scheds [role=radio]")[1].click()`);
      assert.equal((await q('dialsDemo.panels[5].get("sampling")')).scheduler, "linear");
      await q('dialsDemo.panels[5].reset("sampling")');
      await open(5, 2);
    });
    await t.test("data: a field placed by key; hovering a row lights its mark", async () => {
      await open(4);
      await sleep(250);
      await q(`[...document.querySelectorAll(".d-rail .kd-field")].find(f=>f.textContent.startsWith("mass")).focus()`);
      await key("x", "KeyX");
      assert.equal((await q('dialsDemo.panels[4].get("channels")')).x, "mass");
      const row = JSON.parse(await q(`(()=>{const r=document.querySelector("${S} .kd-table tr[data-i='3']").getBoundingClientRect();return JSON.stringify({x:r.x+20,y:r.y+r.height/2})})()`));
      await mouse("mouseMoved", row.x, row.y);
      await sleep(50);
      assert.equal(await q(`document.querySelector("${S} .kd-mark.is-hot")?.dataset.i`), "3");
      await q('dialsDemo.panels[4].reset("channels")');
      await open(4, 2);
    });
    await t.test("type: the axis lab handle sets weight and size together", async () => {
      await open(1);
      await sleep(250);
      const v0 = await q('dialsDemo.panels[1].get("typeface")');
      await drag(`${S} .kt-pad .k-handle`, 40, -30);
      const v1 = await q('dialsDemo.panels[1].get("typeface")');
      assert.ok(v1.weight > v0.weight && v1.size > v0.size, `${v0.weight}/${v0.size} -> ${v1.weight}/${v1.size}`);
      assert.equal(v1.axes.wght, v1.weight);
      await q('dialsDemo.panels[1].reset("typeface")');
      await open(1, 2);
    });
    await t.test("command palette finds controls and depth commands; keys are rebindable", async () => {
      await q("dialsDemo.panels.forEach(p=>[...p.sections.keys()].forEach(id=>p.setDepth(id,2,false)))");
      await q('document.querySelector("#sample-motion [data-control=loop] .d-label").focus()');
      await key("k", "KeyK", 2);
      await sleep(100);
      assert.equal(await q('document.activeElement.getAttribute("role")'), "combobox");
      await browser.send("Input.insertText", { text: "Control Rotation" });
      assert.match(await q('document.querySelector("[role=option][aria-selected=true]").textContent'), /^Control Rotation/);
      await key("Enter");
      await sleep(100);
      assert.equal(await q('document.activeElement.closest("[data-control]")?.dataset.control'), "rotation");
      await key("k", "KeyK", 2);
      await browser.send("Input.insertText", { text: "Studio Time" });
      await key("Enter");
      await sleep(150);
      assert.equal(await q('dialsDemo.panels[2].sections.get("time").depth'), 3);
      await open(2, 2);
      await q("dialsDemo.panels[3].help()");
      await q('(()=>{const f=document.querySelector("[aria-label=\\"Keys for studio\\"]");f.value="x";f.dispatchEvent(new Event("change",{bubbles:true}))})()');
      assert.deepEqual(await q("dialsDemo.panels[3].keys.studio"), ["x"]);
      await q('document.querySelector("dialog.d-help").close()');
      await q('dialsDemo.panels[3].keys.studio=["s"]');
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
