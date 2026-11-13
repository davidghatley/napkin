import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = process.env.DIALS_EVIDENCE;
const names = ["color", "typography", "motion", "image", "data", "generation"];
test(
  "studios take the window, stay sharp, and the motion studio measures and exports",
  { timeout: 180000 },
  async (t) => {
    const server = await serve(),
      browser = await launchChromium({ width: 1440, height: 900 }),
      errors = [];
    browser.onEvent((e) => {
      if (e.method === "Runtime.exceptionThrown")
        errors.push(e.params.exceptionDetails.exception?.description);
    });
    const q = (x) => browser.eval(x);
    const key = async (k, code = k, modifiers = 0) => {
      for (const type of ["keyDown", "keyUp"])
        await browser.send("Input.dispatchKeyEvent", {
          type,
          key: k,
          code,
          modifiers,
        });
    };
    const open = (index, depth = 3) =>
      q(
        `(()=>{const p=dialsDemo.panels[${index}];p.setDepth([...p.sections.keys()][0],${depth},false)})()`,
      );
    const shot = async (name) => {
      if (!evidence) return;
      await sleep(250);
      mkdirSync(evidence, { recursive: true });
      writeFileSync(`${evidence}/${name}.png`, await browser.screenshot());
    };
    try {
      await browser.goto(server.url);
      await browser.waitFor("window.dialsDemo?.panels.length===6");
      await t.test(
        "each studio fills the viewport and shows all of its content without an inner scroll",
        async () => {
          for (const [i, name] of names.entries()) {
            await open(i);
            await sleep(300);
            const m = JSON.parse(
              await q(`(()=>{
                const s=document.querySelector('.d-section[data-depth="3"]'),
                  inner=s.querySelector('.d-section-inner'),r=s.getBoundingClientRect();
                return JSON.stringify({top:r.top,bottom:r.bottom,left:r.left,right:r.right,
                  fixed:getComputedStyle(s).position,
                  overflowY:inner.scrollHeight-inner.clientHeight,
                  overflowX:inner.scrollWidth-inner.clientWidth,
                  vw:document.documentElement.clientWidth,vh:innerHeight})})()`),
            );
            assert.equal(m.fixed, "fixed", name);
            assert.ok(m.top >= 0 && m.bottom <= m.vh, `${name} inside viewport`);
            assert.ok(m.right - m.left > m.vw * 0.9, `${name} is wide`);
            assert.ok(m.overflowY <= 0, `${name} scrolls by ${m.overflowY}px`);
            assert.ok(m.overflowX <= 0, `${name} scrolls sideways`);
            await shot(`studio-${name}-light`);
            await open(i, 2);
          }
          if (evidence) {
            await q('document.querySelector("#theme").click()');
            for (const [i, name] of names.entries()) {
              await open(i);
              await shot(`studio-${name}-dark`);
              await open(i, 2);
            }
            await q('document.querySelector("#theme").click()');
          }
        },
      );
      await t.test(
        "every plot backing store matches the pixels it is shown at, at 1x and 2x",
        async () => {
          for (const dpr of [1, 2]) {
            await browser.send("Emulation.setDeviceMetricsOverride", {
              width: 1440,
              height: 900,
              deviceScaleFactor: dpr,
              mobile: false,
            });
            await browser.goto(server.url);
            await browser.waitFor("window.dialsDemo?.panels.length===6");
            for (const [i, name] of names.entries()) {
              await open(i);
              await sleep(350);
              const plots = JSON.parse(
                await q(`JSON.stringify([...document.querySelectorAll('.d-section[data-depth="3"] canvas.d-plot')].filter(c=>c.clientWidth).map(c=>({label:c.getAttribute('aria-label').slice(0,30),css:c.getBoundingClientRect().width,backing:Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width').get.call(c)})))`),
              );
              assert.ok(plots.length > 0 || name === "typography", name);
              for (const p of plots)
                assert.ok(
                  p.backing >= p.css * dpr * 0.92,
                  `${dpr}x ${name}: ${p.label} shows at ${p.css}px but is drawn at ${p.backing}px`,
                );
              await open(i, 2);
            }
          }
          await browser.send("Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await browser.goto(server.url);
          await browser.waitFor("window.dialsDemo?.panels.length===6");
        },
      );
      await t.test(
        "passive plots are not tab stops; interactive ones are",
        async () => {
          await open(5);
          await sleep(200);
          assert.equal(
            await q(
              '[...document.querySelectorAll(".d-section[data-depth=\\"3\\"] canvas.d-plot-passive")].every(c=>!c.hasAttribute("tabindex"))',
            ),
            true,
          );
          assert.ok(
            await q(
              'document.querySelectorAll(".d-section[data-depth=\\"3\\"] canvas.d-plot-passive").length>=2',
            ),
          );
          await open(5, 2);
          await open(0);
          await sleep(200);
          assert.equal(
            await q(
              'document.querySelector(\'.d-section[data-depth="3"] canvas[aria-label^="Color plane"]\').tabIndex',
            ),
            0,
          );
          await open(0, 2);
        },
      );
      await t.test(
        "motion studio: measured settle and overshoot, before ghost, CSS and WAAPI export",
        async () => {
          await open(2);
          await sleep(300);
          const text = () =>
            q('document.querySelector(".d-compare").textContent');
          const first = await text();
          assert.match(first, /Settle\s*440 ms\s*980 ms/);
          assert.match(first, /Overshoot\s*13\.5%\s*0\.0%/);
          assert.match(
            await q('document.querySelector("[aria-label=\\"CSS easing code\\"]").textContent'),
            /^linear\(0, .*1\)$/,
          );
          assert.match(
            await q('document.querySelector("[aria-label=\\"Web Animations code\\"]").textContent'),
            /element\.animate\([\s\S]*"--progress"[\s\S]*easing: "linear\(/,
          );
          // Change damping; the "before" column keeps the pinned values.
          await browser.type("#sample-motion [aria-label=Damping]", "30");
          await sleep(150);
          const changed = await text();
          assert.doesNotMatch(changed, /Settle\s*440 ms\s*440 ms/);
          assert.match(changed, /Overshoot\s*[0-4]\.\d%\s*13\.5%/);
          await q(
            'document.querySelector("#sample-motion [aria-label=\\"Keep the current response as the before ghost\\"]").click()',
          );
          await sleep(100);
          assert.match(await text(), /Overshoot\s*([0-4]\.\d%)\s*\1/);
          // Bezier mode writes cubic-bezier and shows the handles.
          await q("document.activeElement.blur()");
          await q(
            'dialsDemo.panels[2].update({ease:{...dialsDemo.panels[2].get("ease"),mode:"bezier"}})',
          );
          await sleep(200);
          assert.match(
            await q('document.querySelector("[aria-label=\\"CSS easing code\\"]").textContent'),
            /^cubic-bezier\(/,
          );
          await shot("studio-motion-measured");
          await open(2, 2);
        },
      );
      await t.test(
        "motion timeline: keys, loop range, lane keys and playback stay inside the range",
        async () => {
          await q(
            'dialsDemo.panels[2].update({ease:{...dialsDemo.panels[2].get("ease"),mode:"spring",stiffness:170,damping:14}})',
          );
          await open(2);
          await sleep(300);
          const tl = '#sample-motion canvas[aria-label^="Timeline with a loop range"]';
          await q(`document.querySelector('${tl}').focus()`);
          for (let i = 0; i < 20; i++) await key("ArrowRight");
          assert.equal(
            Number(await q('document.querySelector("#sample-motion .d-track input").value')),
            200,
          );
          await key("[", "BracketLeft");
          for (let i = 0; i < 40; i++) await key("ArrowRight");
          await key("]", "BracketRight");
          const range = await q('dialsDemo.panels[2].get("ease").range');
          assert.deepEqual(range.map((n) => Number(n.toFixed(2))), [0.2, 0.6]);
          await key("k", "KeyK");
          assert.equal(await q('dialsDemo.panels[2].get("ease").keyframes.length'), 4);
          // Pointer: drag the loop-in marker on the ruler.
          const box = JSON.parse(
            await q(`(()=>{const r=document.querySelector('${tl}').getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`),
          );
          const px = (t) => box.x + ((12 + t * 576) / 600) * box.w;
          await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px(0.2), y: box.y + 5 });
          await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: px(0.2), y: box.y + 5, button: "left", buttons: 1, clickCount: 1 });
          await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px(0.3), y: box.y + 5, buttons: 1 });
          await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px(0.3), y: box.y + 5, button: "left", clickCount: 1 });
          const after = await q('dialsDemo.panels[2].get("ease").range[0]');
          assert.ok(Math.abs(after - 0.3) < 0.02, "range start " + after);
          // Drag the rotation lane key at time 1 down: a value track is written to the response value.
          const lane2y = box.y + (107 / 136) * box.h;
          await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px(1), y: lane2y });
          await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: px(1), y: lane2y, button: "left", buttons: 1, clickCount: 1 });
          await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px(1), y: lane2y - 14, buttons: 1 });
          await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px(1), y: lane2y - 14, button: "left", clickCount: 1 });
          const tracks = await q('dialsDemo.panels[2].get("ease").tracks');
          assert.ok(tracks?.rotation?.length === 2, "rotation lane keys written");
          assert.notEqual(tracks.rotation[1].value, 30);
          // Playback respects the loop range.
          await q('document.querySelector("#sample-motion [aria-label=\\"Play motion preview\\"]").click()');
          const seen = [];
          for (let i = 0; i < 25; i++) {
            seen.push(Number(await q('document.querySelector("#sample-motion .d-track input").value')));
            await sleep(70);
          }
          await q('document.querySelector("#sample-motion [aria-label=\\"Play motion preview\\"]").click()');
          assert.ok(
            seen.every((n) => n >= 295 && n <= 605),
            "playhead stayed in range " + seen.join(","),
          );
          assert.ok(new Set(seen).size > 5, "playhead moved");
          await open(2, 2);
        },
      );
      await t.test(
        "command palette finds controls and depth commands; keys are rebindable",
        async () => {
          await q("dialsDemo.panels.forEach(p=>[...p.sections.keys()].forEach(id=>p.setDepth(id,2,false)))");
          await q('document.querySelector("#sample-motion [data-control=origin] .d-label").focus()');
          await key("k", "KeyK", 2);
          await sleep(100);
          assert.equal(await q('document.activeElement.getAttribute("role")'), "combobox");
          await browser.send("Input.insertText", { text: "rotat" });
          assert.match(
            await q('document.querySelector("[role=option][aria-selected=true]").textContent'),
            /Rotation/,
          );
          await key("Enter");
          await sleep(100);
          assert.equal(
            await q('document.activeElement.closest("[data-control]")?.dataset.control'),
            "rotation",
          );
          await q('document.querySelector("#sample-motion [data-control=rotation] .d-label").focus()');
          await key("k", "KeyK", 2);
          await browser.send("Input.insertText", { text: "time studio" });
          await key("Enter");
          await sleep(150);
          assert.equal(await q('dialsDemo.panels[2].sections.get("time").depth'), 3);
          await open(2, 2);
          // Rebinding through the key map.
          await q("dialsDemo.panels[3].help()");
          await q('(()=>{const f=document.querySelector("[aria-label=\\"Keys for studio\\"]");f.value="x";f.dispatchEvent(new Event("change",{bubbles:true}))})()');
          assert.deepEqual(await q("dialsDemo.panels[3].keys.studio"), ["x"]);
          await q('document.querySelector("dialog.d-help").close()');
          await q('dialsDemo.panels[3].keys.studio=["s"]');
        },
      );
      await t.test(
        "figures: the encoding figure uses the bound channels; text figures are not clipped letters",
        async () => {
          const withBoth = await q(
            'document.querySelector("#sample-data [data-control=channels] .d-figure").innerHTML',
          );
          assert.match(withBoth, /circle/);
          assert.doesNotMatch(
            await q('document.querySelector("#sample-typography [data-control=copy] .d-figure").innerHTML'),
            /<text/,
          );
        },
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
