import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
test('viewers execute the format: layered charts use real scales, glTF scenes keep transforms, materials and animation', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-viewers-')),
    files = join(dir, 'files');
  mkdirSync(files);
  for (const n of ['scene.gltf', 'layers.vl.json', 'tone.flac'])
    copyFileSync(resolve('test/kinds/samples', n), join(files, n));
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } }),
    browser = await launchChromium({ width: 1100, height: 800 });
  t.after(async () => {
    await browser.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  // Vega-Lite: layers, quantitative x spacing, three marks, a legend.
  await browser.goto(server.url + 'view/layers.vl.json');
  await browser.waitFor('!!document.querySelector(".chart.vl .vl-marks path")', 10000);
  const chart = await browser.eval(`(() => {
    const pts = [...document.querySelectorAll('.vl-marks path:not(.series)')].map(p => Number(/^M(-?[\\d.]+)/.exec(p.getAttribute('d'))[1]));
    return { pts, lines: document.querySelectorAll('.vl-marks path.series').length, rules: document.querySelectorAll('.vl-marks line').length, legend: document.querySelector('.chart.vl').textContent.includes('north') };
  })()`);
  assert.equal(chart.lines, 2);
  assert.equal(chart.pts.length, 6);
  assert.ok(chart.rules >= 1 && chart.legend);
  // north has t = 1, 2, 4: the gap from 2 to 4 is twice the gap from 1 to 2 only on a real linear scale.
  const [a, b, c] = chart.pts.slice(0, 3);
  assert.ok(Math.abs((c - b) / (b - a) - 2) < 0.05, JSON.stringify(chart.pts));
  // glTF: two translated red instances and a green ground, nothing like one green triangle.
  await browser.goto(server.url + 'view/scene.gltf');
  await browser.waitFor('document.querySelector("canvas.model")?.dataset.triangles > 0', 10000);
  const pixels = `(() => {
    const c = document.querySelector('canvas.model'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let red = 0, green = 0, rx0 = 1e9, rx1 = -1;
    const cols = new Array(c.width).fill(0);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] < 200) continue;
      if (d[i] > 140 && d[i + 1] < 90 && d[i + 2] < 90) { red++; cols[x]++; rx0 = Math.min(rx0, x); rx1 = Math.max(rx1, x); }
      else if (d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 15) green++;
    }
    let gaps = 0, inRun = false;
    for (let x = rx0; x <= rx1; x++) { if (cols[x] === 0) { if (!inRun) gaps++; inRun = true; } else inRun = false; }
    return { red, green, rx0, rx1, gaps };
  })()`;
  await browser.eval('document.querySelector("#spin").click(); document.querySelector("#play").setAttribute("aria-pressed","x"); document.querySelector("canvas").napkinModel.playing=false; document.querySelector("canvas").napkinModel.spin=false; document.querySelector("canvas").napkinModel.yaw=0.5');
  await browser.eval('new Promise(r => setTimeout(r, 300))');
  const still = await browser.eval(pixels);
  assert.ok(still.red > 3000, JSON.stringify(still));
  assert.ok(still.green > 3000, 'ground plane colour: ' + JSON.stringify(still));
  assert.ok(still.gaps >= 1, 'two separate red instances: ' + JSON.stringify(still));
  // Animation: moving the time scrubber turns the parent node and changes the picture.
  await browser.eval('const i=document.querySelector("#time"); i.value="0.5"; i.dispatchEvent(new Event("input"))');
  await browser.eval('new Promise(r => setTimeout(r, 300))');
  const moved = await browser.eval(pixels);
  assert.ok(moved.rx0 !== still.rx0 || moved.rx1 !== still.rx1, JSON.stringify({ still, moved }));
  // Keyboard: arrows turn the model, plus zooms, without any pointer.
  const yaw0 = await browser.eval('document.querySelector("canvas").napkinModel.yaw');
  await browser.eval('document.querySelector("canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
  assert.ok((await browser.eval('document.querySelector("canvas").napkinModel.yaw')) > yaw0);
  // A scene camera can be chosen.
  await browser.eval('const s=document.querySelector("#camera"); s.value="0"; s.dispatchEvent(new Event("change"))');
  await browser.waitFor('document.querySelector("canvas.model").dataset.camera === "0"');
  const cam = await browser.eval(pixels);
  assert.ok(cam.red > 500 && cam.green > 500, JSON.stringify(cam));
});
