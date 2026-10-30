// Pan and zoom frame times on a folder: node tools/stage-perf.mjs <folder> [repo-root]   (repo-root: run another checkout's napkin, e.g. the baseline)
// Drives napkin.view.panBy / zoomAt as gestures for ~6 s and reports the p50 and p95 of requestAnimationFrame deltas.
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { launchChromium } from '../test/helpers/cdp.js';
const folder = resolve(process.argv[2]), root = resolve(process.argv[3] || '.');
const proc = spawn(process.execPath, [join(root, 'src/cli.js'), 'open', folder, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NAPKIN_STATE_DIR: '/tmp/claude-1000/perf-state' } });
let out = ''; proc.stdout.on('data', (d) => (out += d)); proc.stderr.on('data', (d) => (out += d));
const url = await new Promise((res, rej) => { const t = setInterval(() => { const m = out.match(/napkin canvas: (http:\/\/127.0.0.1:\d+\/)/); if (m) { clearInterval(t); res(m[1]); } }, 100); setTimeout(() => rej(new Error(out)), 20000); });
const b = await launchChromium({ width: 1440, height: 900 });
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
async function run(label, setup) {
  await b.goto(url); await b.waitFor('document.body.dataset.ready === "1"', 30000);
  if (await b.eval(`!!document.querySelector('#ask-styles')`)) await b.eval(`document.querySelector('#ask-styles-apply').click()`);
  await new Promise((r) => setTimeout(r, 3000));
  await b.eval(`napkin.view.set({ x: 30, y: 70, z: 0.62 }, { animate: false })`); await new Promise((r) => setTimeout(r, 800));
  if (setup) await setup();
  const { d, c } = JSON.parse(await b.eval(`(async () => {
    const d = [], c = []; let last = performance.now();
    const frame = () => new Promise((r) => requestAnimationFrame((t) => { d.push(t - last); last = t; r(); }));
    for (let i = 0; i < 240; i++) {
      const t0 = performance.now();
      if (i % 40 < 20) napkin.view.panBy(-14, -5, { gesture: true }); else napkin.view.panBy(14, 5, { gesture: true });
      if (i % 6 === 0) napkin.view.zoomAt(720, 450, napkin.view.get().z * (i % 12 === 0 ? 1.04 : 1 / 1.04), { gesture: true });
      c.push(performance.now() - t0);
      await frame();
    }
    return JSON.stringify({ d: d.slice(5), c: c.slice(5) });
  })()`));
  console.log(`${label.padEnd(34)} frames ${d.length}  p50 ${pct(d, 0.5).toFixed(1)} ms  p95 ${pct(d, 0.95).toFixed(1)} ms  max ${Math.max(...d).toFixed(1)} ms | handler work per step p50 ${pct(c, 0.5).toFixed(2)} ms p95 ${pct(c, 0.95).toFixed(2)} ms`);
}
try {
  const mine = await b.goto(url).then(() => b.eval('!!window.napkin?.theme'));
  await run(mine ? 'stage layers present, idle' : 'baseline (no stage layers)');
  if (mine) {
    await run('highlight .ss-label active', () => b.eval(`napkin.stage.highlight({ selector: '.ss-label', file: 'components.css' })`));
    await run('theme wipe open (2 copies/frame)', async () => { await b.eval(`napkin.theme.open()`); await b.waitFor(`napkin.theme.clones().size > 5`, 30000); await new Promise((r) => setTimeout(r, 2500)); });
  }
} finally { await b.close(); proc.kill('SIGTERM'); }
