import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
test('1,000 mixed canvas items have bounded live contexts and useful settled cards', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-perf-')),
    files = join(dir, 'files');
  mkdirSync(files);
  const names = [
    'settings.json',
    'color.png',
    'tone.wav',
    'observations.csv',
    'pyramid.obj',
    'bytes.bin',
    'readme.md',
    'sample.parquet',
    'garden.zip',
    'turn.mp4',
    'garden.workflow.json',
    'triangle.glb',
  ];
  for (let i = 0; i < 1000; i++) {
    const name = names[i % names.length];
    copyFileSync(
      resolve('test/kinds/samples', name),
      join(files, `${String(i).padStart(4, '0')}-${name}`),
    );
  }
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } }),
    browser = await launchChromium();
  t.after(async () => {
    await browser.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const started = performance.now();
  await browser.goto(server.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 30000);
  const openMs = performance.now() - started;
  await browser.waitFor('napkin.state.components.total===1000');
  await browser.eval('new Promise(r=>setTimeout(r,300))');
  console.log('Open ms', openMs);
  const cards = await browser.eval(
    '({live:document.querySelectorAll(".kind-frame:not(.doc-next)").length,compact:document.querySelectorAll(".kind-compact").length,blank:[...document.querySelectorAll(".kind-compact")].filter(e=>!e.children.length).length})',
  );
  assert.ok(cards.live <= 40);
  assert.equal(cards.live + cards.compact, 1000);
  assert.equal(cards.blank, 0);
  await browser.send('Performance.enable');
  const before = (await browser.send('Performance.getMetrics')).metrics;
  const frameMs = await browser.eval(
    `new Promise(resolve=>{const times=[];let prior=performance.now(),i=0;function tick(now){times.push(now-prior);prior=now;const v=napkin.view.get();napkin.view.set({...v,x:v.x+(i%2?3:-3)},{gesture:true});if(++i<45)requestAnimationFrame(tick);else resolve(times.slice(5).sort((a,b)=>a-b)[38]);}requestAnimationFrame(tick);})`,
  );
  const after = (await browser.send('Performance.getMetrics')).metrics;
  console.log(
    JSON.stringify({
      openMs,
      frameP95: frameMs,
      cards,
      work: after
        .filter((m) => /Duration|Nodes$/.test(m.name))
        .map((m) => [m.name, m.value - (before.find((b) => b.name === m.name)?.value || 0)]),
    }),
  );
  assert.ok(openMs < 2000, `1,000 mixed items opened in ${openMs.toFixed(0)} ms`);
  // Frame intervals are locked to the 60 Hz display (16.67 ms), so a 0.1 ms overshoot is vsync jitter, not work.
  // The strict budget is checked on the work itself: main-thread time per frame must leave most of the interval free.
  const task = after.find((m) => m.name === 'TaskDuration').value - before.find((m) => m.name === 'TaskDuration').value,
    perFrame = (task * 1000) / 45;
  console.log('main-thread ms per frame', perFrame.toFixed(2));
  assert.ok(frameMs < 17.2, `panning 1,000 items spaced frames ${frameMs.toFixed(1)} ms apart at p95`);
  assert.ok(perFrame < 8.4, `panning 1,000 items used ${perFrame.toFixed(1)} ms of main-thread time per frame (half the 16.7 ms budget)`);
  // the folder opens on readable cards, not a map too small to read
  const z = await browser.eval('napkin.view.get().z');
  assert.ok(z >= 0.25, `opening zoom ${z}`);
});
