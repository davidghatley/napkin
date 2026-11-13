import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
import { traceScrub } from "./trace.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = process.env.DIALS_EVIDENCE;
test(
  "instruments: real Chromium keyboard, pointer, reconciliation, studios, accessibility and timing",
  { timeout: 180000 },
  async (t) => {
    const server = await serve(),
      browser = await launchChromium({ width: 1440, height: 1100 }),
      errors = [];
    const q = (expr) => browser.eval(expr);
    browser.onEvent((e) => {
      if (e.method === "Runtime.exceptionThrown")
        errors.push(
          e.params.exceptionDetails.exception?.description ||
            e.params.exceptionDetails.text,
        );
    });
    const key = async (key, code = key, extra = {}) => {
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        ...extra,
      });
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        ...extra,
      });
    };
    const focus = (sel) =>
      q(`document.querySelector(${JSON.stringify(sel)}).focus()`);
    const shot = async (name) => {
      if (!evidence) return;
      await sleep(220);
      mkdirSync(evidence, { recursive: true });
      writeFileSync(`${evidence}/${name}.png`, await browser.screenshot());
    };
    try {
      await browser.goto(server.url);
      await browser.waitFor("window.dialsDemo?.panels.length===6");
      await sleep(250);
      await t.test(
        "six live schemas; both themes render without overflow",
        async () => {
          assert.equal(
            await q('document.querySelectorAll(".study").length'),
            6,
          );
          assert.equal(
            await q('document.querySelectorAll("#studies .d-row").length'),
            24,
          );
          assert.equal(
            await q("document.documentElement.scrollWidth<=innerWidth"),
            true,
          );
          await shot("light-benches");
          if (evidence) {
            await browser.send("Emulation.setDeviceMetricsOverride", {
              width: 1440,
              height: 1850,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await shot("light-overview");
            await browser.send("Emulation.setDeviceMetricsOverride", {
              width: 1440,
              height: 1100,
              deviceScaleFactor: 1,
              mobile: false,
            });
          }
          await q('document.querySelector("#theme").click()');
          assert.equal(
            await q("document.documentElement.scrollWidth<=innerWidth"),
            true,
          );
          await shot("dark-benches");
          await browser.goto(server.url);
          await browser.waitFor("window.dialsDemo?.panels.length===6");
        },
      );
      await t.test(
        "units and arithmetic, invalid entry, undo/redo, counts, reset and visible focus",
        async () => {
          await browser.type("[data-control=radius] input", "12px*1.5");
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 18);
          await browser.type("[data-control=radius] input", "1/0");
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 18);
          await focus("[data-control=radius] .d-label");
          await key("3", "Digit3");
          await key("l", "KeyL");
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 21);
          assert.equal(
            await q('document.activeElement.matches(":focus-visible")'),
            true,
          );
          await key("z", "KeyZ", { modifiers: 2 });
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 18);
          await key("z", "KeyZ", { modifiers: 10 });
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 21);
          await key("r", "KeyR");
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 12);
          const events = await q(
            'dialsDemo.events.filter(e=>e.control==="radius").slice(-3).map(e=>e.phase)',
          );
          assert.deepEqual(events, ["begin", "change", "commit"]);
        },
      );
      await t.test(
        "external values preserve input identity and local drafts; conflict is explicit",
        async () => {
          await focus("[data-control=radius] input");
          await q("document.activeElement.select()");
          await browser.send("Input.insertText", { text: "20px*" });
          const before = await q(
            `(()=>{window.kept=document.activeElement;window.conflicts=[];dialsDemo.panels[3].addEventListener('conflict',e=>conflicts.push(e.detail));dialsDemo.panels[3].update({radius:44},{revision:'remote-2'});return [document.activeElement===kept,kept.value,dialsDemo.panels[3].get('radius')];})()`,
          );
          assert.equal(before[0], true);
          assert.equal(before[1], "20px*"); // an invalid draft is retained
          await key("Escape");
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 44);
          assert.equal(await q("conflicts.length"), 1);
          await q(
            `(()=>{const p=dialsDemo.panels[3];p.begin('radius','scrub');p.change('radius',22);p.update({radius:39},{revision:'remote-3'});window.dragValue=p.get('radius');p.change('radius',24);p.commit('radius');})()`,
          );
          assert.equal(await q("dragValue"), 22);
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 39);
          assert.deepEqual(await q("conflicts.at(-1).local"), 24);
        },
      );
      await t.test(
        "every built-in has a keyboard edit path and figure",
        async () => {
          await q('document.querySelector(".catalog").open=true');
          const types = await q(
            "dialsDemo.galleryPanel.schema.sections[0].controls.map(c=>c.type)",
          );
          assert.equal(new Set(types).size, 14);
          const values = {
            number: "24px",
            range: ".5",
            vector: "[0.4,0.6]",
            angle: "90deg",
            text: "A new name",
            gradient: "linear-gradient(90deg, red, blue)",
            shadow: '{"x":3,"y":5,"blur":18,"spread":0,"color":"#0004"}',
            spacing: "[12,18,12,18]",
            seed: "99",
            file: "example.svg",
          };
          for (const [id, text] of Object.entries(values)) {
            await browser.type(`#gallery [data-control=${id}] input`, text);
            assert.equal(
              await q(
                `dialsDemo.galleryPanel.rows.get(${JSON.stringify(id)}).node.classList.contains('is-modified')`,
              ),
              true,
              id,
            );
          }
          for (const id of ["boolean", "select", "segmented"]) {
            await focus(`#gallery [data-control=${id}] .d-label`);
            await key(id === "boolean" ? "ArrowLeft" : "ArrowRight");
            assert.equal(
              await q(
                `dialsDemo.galleryPanel.rows.get('${id}').node.classList.contains('is-modified')`,
              ),
              true,
              id,
            );
          }
          assert.equal(
            await q(
              '[...document.querySelectorAll(".d-row")].every(r=>r.querySelector(".d-figure").childElementCount>0)',
            ),
            true,
          );
          await q('document.querySelector(".catalog").open=false');
        },
      );
      await t.test(
        "label drag emits one group, fine/coarse modifiers and remote updates coexist",
        async () => {
          await q('document.querySelector("#sample-image").scrollIntoView()');
          const bounds = await q(
            '(()=>{const r=document.querySelector("#sample-image [data-control=radius] .d-label").getBoundingClientRect();return {x:r.x+20,y:r.y+12}})()',
          );
          await q("window.beforeEvents=dialsDemo.events.length");
          await browser.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: bounds.x,
            y: bounds.y,
            button: "left",
            clickCount: 1,
          });
          for (let i = 1; i <= 10; i++)
            await browser.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: bounds.x + i * 2,
              y: bounds.y,
              buttons: 1,
            });
          await browser.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: bounds.x + 20,
            y: bounds.y,
            button: "left",
            clickCount: 1,
          });
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 49);
          const phases = await q(
            'dialsDemo.events.slice(beforeEvents).filter(e=>e.control==="radius").map(e=>e.phase)',
          );
          assert.equal(phases[0], "begin");
          assert.equal(phases.at(-1), "commit");
          assert.equal(phases.filter((x) => x === "begin").length, 1);
        },
      );

      await t.test(
        "copy/paste and rebound keys use the same value path",
        async () => {
          await q(
            `(()=>{const p=dialsDemo.panels[3],label=p.rows.get('radius').label;window.clip=new DataTransfer();label.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:clip}));})()`,
          );
          assert.equal(await q('clip.getData("text/plain")'), "49px");
          await q(
            `(()=>{const data=new DataTransfer();data.setData('text/plain','22px*2');dialsDemo.panels[3].rows.get('radius').label.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));})()`,
          );
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 44);
          await q(
            'dialsDemo.panels[3].keys.reset=["Backspace"];dialsDemo.panels[3].keys.studio=["g"]',
          );
          await focus("#sample-image [data-control=radius] .d-label");
          await key("Backspace");
          assert.equal(await q('dialsDemo.panels[3].get("radius")'), 12);
          await key("g", "KeyG");
          assert.equal(
            await q(
              'dialsDemo.panels[3].sections.get("darkroom").studioControl',
            ),
            "radius",
          );
          await q(
            'dialsDemo.panels[3].keys.reset=["r","R"];dialsDemo.panels[3].keys.studio=["s"];dialsDemo.panels[3].open("levels",2)',
          );
        },
      );
      await t.test(
        "three depths keep nodes and studio keyboard paths; CSS color syntaxes convert",
        async () => {
          await q(
            'window.keptInput=document.querySelector("[data-control=ink] input");dialsDemo.panels[0].setDepth("pigment",1)',
          );
          await sleep(260);
          assert.equal(
            await q(
              'document.querySelector("[data-section=pigment]").getBoundingClientRect().height',
            ),
            32,
          );
          await q("window.scrollTo(0,0)");
          await shot("light-dials");
          await q('dialsDemo.panels[0].setDepth("pigment",3)');
          await sleep(200);
          assert.equal(
            await q(
              'keptInput===document.querySelector("[data-control=ink] input")',
            ),
            true,
          );
          for (const color of [
            "rebeccapurple",
            "hsl(240 80% 40%)",
            "lab(50% 30 -40)",
            "color(display-p3 1 0.2 0.1)",
            "oklch(60% .2 160)",
            "color-mix(in oklch, red, blue)",
            "var(--brand-accent)",
          ]) {
            await q(
              `dialsDemo.panels[0].update({ink:${JSON.stringify(color)}})`,
            );
          }
          await focus("#sample-color .d-pane-size");
          const width = await q(
            'dialsDemo.panels[0].sections.get("pigment").node.offsetWidth',
          );
          await key("ArrowLeft");
          assert.equal(
            await q(
              'dialsDemo.panels[0].sections.get("pigment").node.offsetWidth',
            ),
            width - 16,
          );
          await key("ArrowRight");
          await q(
            `(async()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const g=canvas.getContext('2d');g.fillStyle='red';g.fillRect(0,0,48,96);g.fillStyle='blue';g.fillRect(48,0,48,96);const blob=await new Promise(r=>canvas.toBlob(r));const data=new DataTransfer();data.items.add(new File([blob],'two-colors.png',{type:'image/png'}));const input=document.querySelector('#sample-color [aria-label="Sample palette from an image"]');input.files=data.files;input.dispatchEvent(new Event('change'));})()`,
          );
          await browser.waitFor(
            `document.querySelectorAll('#sample-color [aria-label="Image palette"] button').length===2`,
          );
          await browser.type(
            '#sample-color [aria-label="CSS variable name"]',
            "--brand-accent",
          );
          await focus('#sample-color [aria-label="Bind to CSS variable"]');
          await key("Enter");
          assert.equal(
            await q('dialsDemo.panels[0].get("ink")'),
            "var(--brand-accent)",
          );
          await focus('[aria-label^="Color plane"]');
          await key("ArrowRight");
          assert.ok(
            (await q('dialsDemo.panels[0].get("ink")')).startsWith("oklch"),
          );
          await shot("flow-color-studio-light");
          await q('document.querySelector("#theme").click()');
          await shot("flow-color-studio-dark");
          await q(
            'dialsDemo.panels[0].setDepth("pigment",2);dialsDemo.panels[2].setDepth("time",3);document.querySelector("#sample-motion").scrollIntoView()',
          );
          await sleep(220);
          await browser.type("#sample-motion [aria-label=Stiffness]", "220");
          assert.equal(
            await q('dialsDemo.panels[2].get("ease").stiffness'),
            220,
          );
          await q('document.querySelectorAll("#sample-motion .km-key")[1].focus()');
          await key("ArrowDown");
          assert.equal(
            await q('dialsDemo.panels[2].get("path")[1].transform'),
            "translateX(131px)",
          );
          await q('dialsDemo.panels[2].reset("path")');
          await shot("flow-motion-studio-dark");
          await q(
            'dialsDemo.panels[2].setDepth("time",2);document.querySelector("#theme").click();window.scrollTo(0,0)',
          );
        },
      );
      await t.test(
        "plugins receive lifecycle; invalid schemas and updates do not replace existing panel",
        async () => {
          await q(
            `window.pluginEvents=[];dialsDemo.galleryPanel.addEventListener('value',e=>pluginEvents.push(e.detail));dialsDemo.galleryPanel.transact('plugin',.3,'plugin')`,
          );
          assert.deepEqual(await q("pluginEvents.map(e=>e.phase)"), [
            "begin",
            "change",
            "commit",
          ]);
          assert.equal(
            await q(
              `(()=>{try{dialsDemo.panels[0].render({sections:[{id:'x',controls:[{id:'x',type:'number',value:'bad'}]}]});}catch{}return dialsDemo.panels[0].sections.has('pigment');})()`,
            ),
            true,
          );
          assert.equal(
            await q(
              `(()=>{const p=dialsDemo.panels[3],v=p.get('radius');try{p.update({radius:5,missing:4});}catch{}return p.get('radius')===v;})()`,
            ),
            true,
          );
        },
      );

      await t.test(
        "compound studios edit real values and retain focused controls",
        async () => {
          await q('dialsDemo.panels[1].setDepth("type",3,false)');
          await browser.type('#sample-typography [aria-label="Size"]', "42px");
          assert.equal(await q('dialsDemo.panels[1].get("typeface").size'), 42);
          await browser.type('#sample-typography [aria-label="Weight"]', "700");
          assert.equal(
            await q('dialsDemo.panels[1].get("typeface").axes.wght'),
            700,
          );
          const before = await q(
            'Array.from(document.querySelector("#sample-image canvas").getContext("2d").getImageData(170,90,1,1).data)',
          );
          await q('dialsDemo.panels[1].setDepth("type",2,false);dialsDemo.panels[3].setDepth("darkroom",3,false)');
          await browser.type('#sample-image [aria-label="Gamma"]', "1.4");
          await sleep(50);
          const after = await q(
            'Array.from(document.querySelector("#sample-image canvas").getContext("2d").getImageData(170,90,1,1).data)',
          );
          assert.notDeepEqual(after, before);
          await q('dialsDemo.panels[3].setDepth("darkroom",2,false);dialsDemo.panels[5].setDepth("sampler",3,false)');
          await browser.type('#sample-generation [aria-label="Steps"]', "31");
          assert.equal(
            await q('dialsDemo.panels[5].get("sampling").steps'),
            31,
          );
          await q('[...document.querySelectorAll("#sample-generation .kx-btn")].find(b=>/^Seed/.test(b.textContent)).focus()');
          await key(" ", "Space");
          assert.equal(
            await q('dialsDemo.panels[5].get("sampling").locked'),
            false,
          );
          await q('dialsDemo.panels[5].setDepth("sampler",2,false);dialsDemo.panels[4].setDepth("shelf",3,false)');
          await focus('#sample-data [aria-label="x field"] [aria-checked=true]');
          await key("ArrowLeft");
          assert.equal(
            await q('dialsDemo.panels[4].get("channels").x'),
            "mass",
          );
          await q(
            'dialsDemo.panels[4].setDepth("shelf",2,false);dialsDemo.panels[0].open("ink");document.querySelector("#sample-color").scrollIntoView()',
          );
          await sleep(180);
          await focus("#sample-color .d-swatches button");
          await q("window.keptSwatch=document.activeElement");
          await key("Enter");
          assert.equal(await q("document.activeElement===keptSwatch"), true);
          await q('dialsDemo.panels[2].open("ease")');
          await sleep(180);
          await q('document.querySelectorAll("#sample-motion .km-key")[1].focus();window.keptKey=document.activeElement');
          await key("ArrowUp");
          await sleep(40);
          assert.equal(await q("document.activeElement===keptKey"), true);
          assert.equal(
            await q('dialsDemo.panels[2].get("path")[1].transform'),
            "translateX(133px)",
          );
          await q('dialsDemo.panels[2].reset("path")');
          await q(
            'dialsDemo.panels[0].setDepth("pigment",2);dialsDemo.panels[2].setDepth("time",2)',
          );
        },
      );
      await t.test(
        "every control opens its own studio, including non-primary controls",
        async () => {
          await q('document.querySelector(".catalog").open=true');
          const ids = await q(
            "dialsDemo.galleryPanel.schema.sections[0].controls.map(c=>c.id)",
          );
          for (const id of ids) {
            await focus('#gallery [data-control="' + id + '"] .d-label');
            await key("s", "KeyS");
            assert.equal(
              await q(
                'dialsDemo.galleryPanel.sections.get("geometry").studioControl',
              ),
              id,
            );
            assert.equal(
              await q('dialsDemo.galleryPanel.sections.get("geometry").depth'),
              3,
            );
          }
          await q(
            'dialsDemo.galleryPanel.setDepth("geometry",2);document.querySelector(".catalog").open=false',
          );
        },
      );
      await t.test(
        "axe accessibility, reduced motion and narrow layout",
        async () => {
          const require = createRequire(import.meta.url);
          await q(readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"));
          const violations = await q(
            `axe.run(document,{rules:{'color-contrast':{enabled:true}}}).then(r=>r.violations.map(v=>({id:v.id,help:v.help,nodes:v.nodes.map(n=>n.target)})))`,
          );
          assert.deepEqual(violations, []);
          await browser.send("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-reduced-motion", value: "reduce" }],
          });
          await q('dialsDemo.panels[2].setDepth("time",3)');
          assert.equal(
            await q(
              'getComputedStyle(document.querySelector(".d-section-inner")).transitionDuration',
            ),
            "0s",
          );
          await browser.send("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
            mobile: false,
          });
          assert.equal(
            await q("document.documentElement.scrollWidth<=innerWidth"),
            true,
          );
          await shot("narrow-studio");
          await browser.send("Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 1100,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await browser.send("Emulation.setEmulatedMedia", { features: [] });
          await q('dialsDemo.panels[2].setDepth("time",2)');
        },
      );
      await t.test(
        "200-control panel swaps and scrub handler work fit their budgets",
        async () => {
          const result = await q(
            `(async()=>{const mount=document.createElement('div');mount.style.cssText='position:fixed;left:-2000px;width:360px';document.body.append(mount);const p=new dialsDemo.Dials(mount),schema={sections:[{id:'s',label:'200 controls',controls:Array.from({length:200},(_,i)=>({id:'c'+i,type:'number',label:'Value '+i,value:i,min:0,max:1000,step:1,depth:1}))}]},swaps=[],scrubs=[];for(let i=0;i<15;i++){const t=performance.now();p.render(schema);mount.getBoundingClientRect();swaps.push(performance.now()-t);await new Promise(requestAnimationFrame);}p.begin('c0');for(let i=0;i<100;i++){const t=performance.now();p.change('c0',i);mount.getBoundingClientRect();scrubs.push(performance.now()-t);}p.commit('c0');p.destroy();mount.remove();swaps.sort((a,b)=>a-b);scrubs.sort((a,b)=>a-b);return {swaps,swapP95:swaps[Math.floor(swaps.length*.95)],scrubWorkP95:scrubs[95],userAgent:navigator.userAgent};})()`,
          );
          t.diagnostic(JSON.stringify(result));
          assert.ok(result.swapP95 < 50, `swap p95 ${result.swapP95}`);
          assert.ok(
            result.scrubWorkP95 < 16.7,
            `scrub work p95 ${result.scrubWorkP95}`,
          );
          if (evidence)
            writeFileSync(
              `${evidence}/timings.json`,
              JSON.stringify(
                {
                  ...result,
                  note: "Scrub work includes DOM update and forced layout. This is not compositor presentation latency.",
                },
                null,
                2,
              ),
            );
        },
      );
      await t.test("mixed 200-control schemas swap within budget", async () => {
        const result = await q(
          `(async()=>{const mount=document.createElement('div');mount.style.cssText='position:fixed;left:-2000px;width:900px';document.body.append(mount);const p=new dialsDemo.Dials(mount),schema={sections:dialsDemo.samples.flatMap(s=>structuredClone(s.schema.sections))},times=[];schema.sections.at(-1).controls.push(...Array.from({length:176},(_,i)=>({id:'extra'+i,type:'number',label:'Parameter '+i,value:i,min:0,max:1000,step:1,depth:1})));for(let i=0;i<15;i++){const t=performance.now();p.render(schema);mount.getBoundingClientRect();times.push(performance.now()-t);await new Promise(requestAnimationFrame);}p.destroy();mount.remove();times.sort((a,b)=>a-b);return {times,p95:times[14],controls:schema.sections.reduce((n,s)=>n+s.controls.length,0)};})()`,
        );
        // The same 200 controls with the panel on screen, timed to the end of the first frame after the swap.
        const framed = await q(
          `(async()=>{const mount=document.createElement('div');mount.style.cssText='position:fixed;left:0;top:0;width:900px;height:700px;overflow:hidden;z-index:-1';document.body.append(mount);const p=new dialsDemo.Dials(mount),schema={sections:dialsDemo.samples.flatMap(s=>structuredClone(s.schema.sections))},times=[];schema.sections.at(-1).controls.push(...Array.from({length:176},(_,i)=>({id:'extra'+i,type:'number',label:'Parameter '+i,value:i,min:0,max:1000,step:1,depth:1})));for(let i=0;i<15;i++){const t=performance.now();p.render(schema);await new Promise(r=>requestAnimationFrame(()=>setTimeout(r)));times.push(performance.now()-t);}p.destroy();mount.remove();times.sort((a,b)=>a-b);return {times,p95:times[14],note:'start of render to the end of the first frame after it (animation frame callback, then the task after paint), panel on screen'};})()`,
        );
        t.diagnostic("framed " + JSON.stringify(framed));
        assert.ok(framed.p95 < 50, "on-screen swap to first frame p95 " + framed.p95);
        if (evidence)
          writeFileSync(evidence + "/framed-timings.json", JSON.stringify(framed, null, 2));
        t.diagnostic("mixed " + JSON.stringify(result));
        assert.equal(result.controls, 200);
        assert.ok(result.p95 < 50, "mixed swap p95 " + result.p95);
        if (evidence)
          writeFileSync(
            evidence + "/mixed-timings.json",
            JSON.stringify(result, null, 2),
          );
      });
      await t.test(
        "scrub input reaches software paint within a frame",
        async () => {
          await q(
            'dialsDemo.panels.forEach(p=>[...p.sections.keys()].forEach(id=>p.setDepth(id,2,false)));dialsDemo.panels[3].update({radius:30});',
          );
          const traces = {};
          for (const [name, selector] of [
            ["number", "#sample-image [data-control=radius] .d-label"],
            ["color", "#sample-color [data-control=ink] .d-label"],
            ["motion", "#sample-motion [data-control=ease] .d-label"],
            ["image", "#sample-image [data-control=levels] .d-label"],
          ]) {
            const trace = await traceScrub(browser, selector);
            traces[name] = trace;
            t.diagnostic(
              name +
                " " +
                JSON.stringify({
                  samples: trace.samples,
                  painted: trace.painted,
                  p95: trace.p95,
                  max: trace.max,
                }),
            );
            assert.equal(trace.samples, 50, name);
            assert.equal(trace.painted, 50, name);
            assert.ok(
              trace.p95 < 16.7,
              name + " software paint p95 " + trace.p95,
            );
          }
          if (evidence)
            writeFileSync(
              evidence + "/paint-timings.json",
              JSON.stringify(traces, null, 2),
            );
        },
      );
      assert.deepEqual(errors, [], "No browser exceptions");
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
