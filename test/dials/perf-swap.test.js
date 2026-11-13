// The swap gate: a 200-control panel of eight mixed types (number, range, angle, boolean, select,
// colour, gradient, motion; 25 of each, nothing padded), mounted on screen above the page, swapped
// for a different schema 40 times. Each swap is timed from the start of render() to the end of the
// first frame after it (the animation frame callback, then the task after paint). p95 < 50 ms.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchChromium } from "../helpers/cdp.js";
import { serve } from "./serve.js";
import { swapProbe } from "./perf-swap.mjs";

test("a visible mixed 200-control panel swaps to its first painted frame with p95 under 50 ms", { timeout: 120000 }, async () => {
  const server = await serve(),
    browser = await launchChromium({ width: 1440, height: 900 });
  try {
    await browser.goto(server.url);
    await browser.waitFor("dialsDemo.panels.length===6");
    await browser.eval("document.fonts.ready.then(()=>true)");
    const result = JSON.parse(await browser.eval(swapProbe(40)));
    // The probe counts what it mounted: 200 rows of eight types, 900 px wide, on top of the page.
    assert.equal(result.controls, 200);
    assert.equal(result.types, 8);
    assert.equal(result.reps, 40);
    assert.ok(result.width === 900 && result.height >= 800 && result.onTop, `panel on screen and on top: ${JSON.stringify(result)}`);
    assert.ok(result.p95 < 50, `mixed visible swap p95 ${result.p95} ms (median ${result.median}, max ${result.max})`);
  } finally {
    await browser.close();
    await server.close();
  }
});
