// Schemas nobody here wrote: every documented type and value shape, and hostile ones, at all
// three depths, with every studio tab opened. Fails on a thrown error, a refused panel, text
// that is cut off, a figure that is only a placeholder, or a studio that scrolls sideways.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
import { hostileSchemas, counts } from "./hostile.js";

// In the page: render one schema in a viewport-studio panel and audit it at every depth and tab.
const audit = `async (schema) => {
  const out = { problems: [], tabs: 0, rows: 0, repaired: 0 };
  const host = document.createElement("div");
  host.id = "fuzz-host";
  host.style.cssText = "position:absolute;left:0;top:0;width:420px";
  document.body.append(host);
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
  const say = (where, what) => out.problems.push(where + ": " + what);
  // Text cut off: an element with its own text, hidden overflow, no ellipsis, wider content than box.
  const clipped = (root) => {
    const bad = [];
    for (const n of root.querySelectorAll("*")) {
      if (!n.childNodes.length || ![...n.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue;
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || n.closest("[hidden], .d-sr, textarea, input")) continue;
      const r = n.getBoundingClientRect();
      if (!r.width) continue;
      const hides = /hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflow);
      if (hides && cs.textOverflow !== "ellipsis" && !cs.webkitLineClamp.match(/\\d/) && n.scrollWidth > n.clientWidth + 2) bad.push(n.className || n.tagName);
    }
    return bad;
  };
  // A figure that draws nothing but a dashed line or nothing at all.
  const placeholder = (fig) => {
    const svg = fig.querySelector("svg");
    if (!svg && !fig.textContent.trim() && !fig.querySelector("canvas, img, span")) return true;
    if (!svg) return false;
    const marks = svg.querySelectorAll("path, rect, circle, text, line, polyline, image, ellipse");
    return marks.length === 0 || (marks.length === 1 && marks[0].getAttribute("stroke-dasharray"));
  };
  let p;
  try {
    p = new dialsDemo.Dials(host, { studio: "viewport" }).render(schema);
  } catch (e) {
    say("render", e.message);
    host.remove();
    return out;
  }
  out.repaired = p.problems?.length || 0;
  const sid = schema.sections[0].id;
  for (const depth of [1, 2]) {
    p.setDepth(sid, depth, false);
    await frame();
    for (const n of clipped(host)) say("depth " + depth, "clipped " + n);
  }
  for (const row of p.rows.values()) {
    out.rows++;
    if (placeholder(row.fig)) say(row.c.id + " (" + row.c.type + ")", "row figure is a placeholder");
    if (row.c.label.length > 60 && row.label.getBoundingClientRect().height > 40) say(row.c.id, "long label grows the row");
  }
  for (const c of schema.sections[0].controls) {
    const id = p.rows.has(c.id) ? c.id : [...p.rows.keys()].find((k) => k.startsWith(c.id ?? "_none"));
    if (!id) continue;
    try {
      p.open(id);
    } catch (e) {
      say(id + " (" + c.type + ")", "open threw " + e.message);
      continue;
    }
    await frame();
    out.tabs++;
    const s = host.querySelector('.d-section[data-depth="3"]');
    if (!s) {
      say(id, "no studio");
      continue;
    }
    const lab = s.querySelector(".d-lab"),
      inner = s.querySelector(".d-section-inner");
    if (!lab.children.length) say(id + " (" + c.type + ")", "empty studio");
    if (lab.dataset.instrument === "text" && typeof p.get(id) !== "string") say(id + " (" + c.type + ")", "studio fell back to a text box");
    if (inner.scrollWidth > inner.clientWidth + 1) say(id + " (" + c.type + ")", "studio scrolls sideways by " + (inner.scrollWidth - inner.clientWidth));
    for (const n of clipped(s)) say(id + " (" + c.type + ")", "clipped " + n);
    const tab = s.querySelector('.d-studio-tabs [aria-pressed="true"]');
    if (!tab) say(id, "no current tab");
    else if (tab.scrollWidth > tab.clientWidth + 1 && getComputedStyle(tab).textOverflow !== "ellipsis") say(id, "tab name cut off");
  }
  p.setDepth(sid, 2, false);
  p.destroy();
  host.remove();
  return out;
}`;

test("schemas nobody wrote: every type and shape, every depth and studio tab", { timeout: 300000 }, async (t) => {
  const server = await serve(),
    browser = await launchChromium({ width: 1280, height: 860 }),
    errors = [];
  browser.onEvent((e) => {
    if (e.method === "Runtime.exceptionThrown") errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  });
  try {
    await browser.goto(server.url);
    await browser.waitFor("window.dialsDemo?.panels.length===6");
    const schemas = hostileSchemas();
    let tabs = 0;
    for (const [i, schema] of schemas.entries()) {
      for (const theme of ["light", "dark"]) {
        const r = await browser.eval(`(${audit})(${JSON.stringify(theme === "dark" ? { ...schema } : schema)})`);
        tabs += r.tabs;
        await t.test(`batch ${i + 1} (${schema.sections[0].controls.map((c) => c.type).join(", ")}) ${theme}`, () => {
          assert.deepEqual(r.problems, []);
          assert.equal(r.tabs, schema.sections[0].controls.length);
        });
        if (theme === "light") break; // geometry does not change with theme; axe covers both themes
      }
    }
    assert.equal(tabs, counts.documented + counts.hostile);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});

for (const width of [560, 390]) {
  test(`a studio stays usable in a ${width} px window, siblings one tap away`, { timeout: 120000 }, async () => {
    const server = await serve(),
      browser = await launchChromium({ width, height: 844 });
    try {
      await browser.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await browser.goto(server.url);
      await browser.waitFor("window.dialsDemo?.panels.length===6");
      const r = JSON.parse(
        await browser.eval(`(async()=>{const out=[];for(const p of dialsDemo.panels){const s0=p.schema.sections[0];for(const c of s0.controls){p.open(c.id);await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,150)));
          const s=p.root.querySelector('.d-section[data-depth="3"]'),tabs=s.querySelector('.d-studio-tabs'),r=s.getBoundingClientRect(),cur=tabs.querySelector('[aria-pressed="true"]'),tr=tabs.getBoundingClientRect(),cr=cur.getBoundingClientRect(),inner=s.querySelector('.d-section-inner');
          out.push({id:c.id,tabsShown:getComputedStyle(tabs).display!=='none'&&tr.height>0,tabsCount:tabs.children.length,curVisible:cr.left>=tr.left-1&&cr.right<=tr.right+1,inside:r.left>=0&&r.right<=innerWidth+1,sideways:inner.scrollWidth-inner.clientWidth,labH:s.querySelector('.d-lab').getBoundingClientRect().height});}
          p.setDepth(s0.id,2,false);}return JSON.stringify(out)})()`),
      );
      for (const x of r) {
        assert.ok(x.tabsShown, `${x.id}: tabs shown`);
        assert.ok(x.curVisible, `${x.id}: current tab scrolled into view`);
        assert.ok(x.inside, `${x.id}: studio inside the window`);
        assert.ok(x.sideways <= 0, `${x.id}: no sideways scroll (${x.sideways})`);
        assert.ok(x.labH > 200, `${x.id}: studio has room (${x.labH})`);
      }
    } finally {
      await browser.close();
      await server.close();
    }
  });
}
