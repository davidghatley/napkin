// 1,000 mixed files on one canvas: the folder opens fast on readable cards, and panning and zooming keep every frame (p95 < 16.7 ms) at several
// window sizes. Frames are measured from requestAnimationFrame timestamps, which Chromium quantises to the display's vsync (a perfect 60 Hz page
// reads 16.6 to 16.9 ms): each interval is counted in vsyncs, rounding UP past 2.5 ms of slack (an interval of 19.2 ms or more counts as 2 = missed a frame; 24 ms never reads as made), so "p95 < 16.7 ms" is read exactly as the
// dream means it, and a missed frame (33 ms) can never hide inside timer jitter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
const VSYNC = 1000 / 60;
const names = ['settings.json', 'color.png', 'tone.wav', 'observations.csv', 'pyramid.obj', 'bytes.bin', 'readme.md', 'sample.parquet', 'garden.zip', 'turn.mp4', 'garden.workflow.json', 'triangle.glb'];
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.ceil(a.length * 0.95) - 1];
// Real wheel input through the browser (CDP), one event every 16 ms, as a trackpad sends it: pan, or Ctrl-wheel zoom in and out.
async function gesture(browser, mode) {
  await browser.eval('window.__f=[];window.__stop=false;window.__at=performance.now();requestAnimationFrame(function k(t){__f.push(t-__at);__at=t;if(!__stop)requestAnimationFrame(k)});true');
  for (let i = 0; i < 90; i++) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 520, y: 350, deltaX: mode === 'pan' ? (i % 40 < 20 ? 24 : -24) : 0, deltaY: mode === 'pan' ? 8 : i % 20 < 10 ? -12 : 12, modifiers: mode === 'pan' ? 0 : 2 });
    await new Promise((r) => setTimeout(r, 16));
  }
  const frames = (await browser.eval('window.__stop=true;__f.slice(2)')).filter((x) => x > 0);
  return { frames, vsyncs: frames.map((x) => Math.max(1, Math.ceil(x / VSYNC - 0.15))) };
}
test('1,000 mixed canvas items open on readable cards, with bounded live frames, and pan and zoom without dropping frames', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-perf-')),
    files = join(dir, 'files');
  mkdirSync(files);
  for (let i = 0; i < 1000; i++) copyFileSync(resolve('test/kinds/samples', names[i % names.length]), join(files, `${String(i).padStart(4, '0')}-${names[i % names.length]}`));
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const report = {};
  for (const [width, height] of [[1280, 820], [1440, 900], [900, 700], [1600, 1000], [1920, 1080]]) {
    const browser = await launchChromium({ width, height }),
      size = `${width}x${height}`;
    try {
      const started = performance.now();
      await browser.goto(server.url);
      await browser.waitFor('document.body.dataset.ready === "1"', 30000);
      const openMs = performance.now() - started;
      await browser.waitFor('napkin.state.components.total===1000');
      await browser.eval('new Promise(r=>setTimeout(r,500))');
      const cards = await browser.eval(
        '({live:document.querySelectorAll(".kind-frame:not(.doc-next)").length,compact:document.querySelectorAll(".kind-compact").length,blank:[...document.querySelectorAll(".kind-compact")].filter(e=>!e.children.length).length})',
      );
      assert.ok(cards.live <= 40, `${size}: ${cards.live} live frames`);
      assert.equal(cards.live + cards.compact, 1000, size);
      assert.equal(cards.blank, 0, size);
      assert.ok(openMs < 2000, `${size}: 1,000 mixed items opened in ${openMs.toFixed(0)} ms`);
      // the folder opens on readable cards, not a map too small to read
      assert.ok((await browser.eval('napkin.view.get().z')) >= 0.25, size);
      report[size] = { openMs: Math.round(openMs), cards };
      for (const mode of ['pan', 'zoom']) {
        await browser.send('Performance.enable');
        const before = (await browser.send('Performance.getMetrics')).metrics;
        const { frames, vsyncs } = await gesture(browser, mode);
        const after = (await browser.send('Performance.getMetrics')).metrics,
          task = after.find((m) => m.name === 'TaskDuration').value - before.find((m) => m.name === 'TaskDuration').value,
          perFrame = (task * 1000) / frames.length,
          frameP95 = p95(vsyncs) * VSYNC,
          missed = vsyncs.filter((v) => v > 1).length;
        report[size][mode] = { frames: frames.length, frameP95: +frameP95.toFixed(2), rawP95: +p95(frames).toFixed(2), missed, mainThreadMsPerFrame: +perFrame.toFixed(2) };
        assert.ok(frames.length >= 60, `${size} ${mode}: only ${frames.length} frames`);
        assert.ok(frameP95 < 16.7, `${size} ${mode}: p95 frame ${frameP95.toFixed(1)} ms (${missed} of ${frames.length} frames missed their vsync)`);
        assert.ok(perFrame < 8.4, `${size} ${mode}: ${perFrame.toFixed(1)} ms of main-thread time per frame (half the 16.7 ms budget)`);
        await browser.eval('new Promise(r=>setTimeout(r,400))');
      }
    } finally {
      await browser.close();
    }
  }
  console.log(JSON.stringify(report));
});
