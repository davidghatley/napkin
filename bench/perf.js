// CPU-only, real Chromium page, real server. Run all: node bench/perf.js; one row: --id PRF-02.
// Built first by Codex on the old core; rebuilt on the current canvas (shared React runtime, session tokens, hash revisions).
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { generateCorpus } from './corpus.js';
import { stats, record, rssMB, trackErrors, allDrawn } from './common.js';
import { launchChromium } from '../test/helpers/cdp.js';
import { startServer, startMcp, sleep } from '../test/helpers/harness.js';
import { openWorkspace } from '../src/workspace.js';

// The largest generated shape: three axes, eight cells, twelve nodes per cell.
export const EDIT = 'Specimen029';
export const LABELS = `section[data-name="${EDIT}"] .mount [data-n="label"]`;
const paint = 'Wall-clock milliseconds (performance.timeOrigin + performance.now()) from the input to the first frame after the new DOM: the new text must be in every cell of the edited component, layout is forced, then two requestAnimationFrame callbacks run. A conservative paint proxy; not a physical display measurement.';
const now = () => performance.timeOrigin + performance.now();

// Page helpers: resolve with the epoch time at which `value` has been painted into every node matching `selector`.
const PAGE = `
window.__painted = (selector, test, limit = 8000) => new Promise((resolve) => {
  const t0 = performance.now();
  const check = () => {
    const nodes = [...document.querySelectorAll(selector)];
    if (nodes.length && nodes.every(test)) { nodes[0].getBoundingClientRect(); requestAnimationFrame(() => requestAnimationFrame(() => resolve({ at: performance.timeOrigin + performance.now() }))); return; }
    if (performance.now() - t0 > limit) { resolve({ timedOut: true, at: performance.timeOrigin + performance.now() }); return; }
    requestAnimationFrame(check);
  };
  check();
});
window.__keyAt = new Promise(() => {});
true`;

async function cold() {
  const c = generateCorpus(40), samples = [], details = [];
  try {
    for (let i = 0; i < 5; i++) {
      // New process, new page/profile, no HTTP or esbuild cache. Includes server startup, excludes Chromium launch.
      const b = await launchChromium({ width: 1440, height: 900 });
      const errors = trackErrors(b);
      let server;
      try {
        const start = performance.now();
        server = await startServer(c.dir);
        await b.goto(server.url); await b.waitFor(allDrawn(40), 30000);
        await b.eval('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()');
        const ms = performance.now() - start; samples.push(ms);
        details.push({ ms, cells: await b.eval('document.querySelectorAll(".cell").length'), errors: [...errors] });
        assert.equal(errors.length, 0, JSON.stringify(errors));
      } finally { await b.close(); await server?.stop(); }
    }
  } finally { rmSync(c.dir, { recursive: true, force: true }); }
  const d = stats(samples), pass = d.p50 <= 1500;
  return record('PRF-01', { pass, ...d, details, method: 'Five cold server processes and Chromium profiles; the OS file cache is not flushed. The timer starts before the server spawns and ends after every one of the 40 sections is ready, every expected cell holds its component, zero build or render errors, and two rAF callbacks. Chromium launch excluded. The first run creates the sidecars.' }, `${pass ? 'PASS' : 'FAIL'}: p50 ${d.p50.toFixed(0)} ms (bar <= 1500 ms), p95 ${d.p95.toFixed(0)} ms, five cold opens of 40 components.`, 'node bench/perf.js --id PRF-01');
}

// A page evaluation that never settles fails the run instead of hanging it.
function guard(b, ms = 20000) {
  const run = b.eval.bind(b);
  b.eval = (expr) => Promise.race([run(expr), new Promise((_, reject) => setTimeout(() => reject(new Error(`page evaluation did not settle in ${ms} ms: ${String(expr).slice(0, 160)}`)), ms).unref())]);
}

async function setup200() {
  const corpus = generateCorpus(200);
  let server, browser, mcp;
  const close = async () => { await mcp?.stop(); await browser?.close(); await server?.stop(); rmSync(corpus.dir, { recursive: true, force: true }); };
  try {
    server = await startServer(corpus.dir);
    browser = await launchChromium({ width: 1440, height: 900 });
    const errors = trackErrors(browser);
    guard(browser);
    await browser.goto(server.url); await browser.waitFor(allDrawn(200), 60000);
    const cells = await browser.eval('document.querySelectorAll(".cell").length');
    assert.ok(cells >= 1000, `${cells} cells`); assert.equal(errors.length, 0, JSON.stringify(errors));
    await browser.eval(PAGE);
    console.log(`200 components drawn (${cells} cells)`);
    return { corpus, server, browser, errors, cells, close, mcp: async () => (mcp ??= await startMcp(server.url)) };
  } catch (e) { await close(); throw e; }
}

// Select the edited component's root as a person would, and bring the component into view at its own size (an edit off-screen is not drawn).
async function focusTarget(b) {
  await b.eval(`(()=>{ const root = document.querySelector('section[data-name="${EDIT}"] .mount [data-n="root"]'); root.dispatchEvent(new MouseEvent('click', { bubbles: true })); napkin.stage.reveal(napkin.state.selection.component); return true })()`);
  let last = '';
  for (let i = 0; i < 40; i++) { const v = JSON.stringify(await b.eval('napkin.view.get()')); if (v === last) break; last = v; await sleep(100); }
  await b.waitFor('document.querySelector("#propdef-label") && document.querySelector("#padding")');
  await b.eval(`(()=>{ for (const id of ['propdef-label', 'padding']) for (let d = document.getElementById(id).closest('details'); d; d = d.parentElement.closest('details')) d.open = true; return true })()`);
  await sleep(300);
}
// A redraw of the panel closes sections nobody toggled by hand: open the one that holds the field again, as a person would.
const field = (id) => `(() => { const e = document.querySelector('#${id}'); for (let d = e.closest('details'); d; d = d.parentElement.closest('details')) d.open = true; e.focus(); e.select(); return e; })()`;
const key = (b, k, code, vk) => b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }).then(() => b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }));

// PRF-02: type a new default for the setting `label`, Tab to commit. Timed from the Tab key event reaching the page.
async function panelTrial(b, value) {
  await b.eval(`(()=>{ const e = ${field('propdef-label')};
    window.__done = new Promise((resolve) => addEventListener('keydown', (ev) => { if (ev.key !== 'Tab') return; const start = performance.timeOrigin + ev.timeStamp; window.__painted(${JSON.stringify(LABELS)}, (n) => n.textContent === ${JSON.stringify(value)}).then((r) => resolve({ ...r, start })); }, { capture: true, once: true }));
    return true })()`);
  await b.send('Input.insertText', { text: value });
  await key(b, 'Tab', 'Tab', 9);
  const r = await b.eval('window.__done');
  return { ms: r.at - r.start, timedOut: !!r.timedOut };
}
// PRF-08: type into a style field with focus kept (no Tab, no blur); the selected node's padding must follow the typing.
async function typingTrial(b, i) {
  const px = 10 + (i % 40);
  await b.eval(`(()=>{ const e = ${field('padding')};
    window.__done = new Promise((resolve) => e.addEventListener('input', (ev) => { const start = performance.timeOrigin + ev.timeStamp; window.__painted('section[data-name="${EDIT}"] .mount [data-n="root"]', (n) => parseFloat(getComputedStyle(n).paddingLeft) === ${px}).then((r) => resolve({ ...r, start })); }, { once: true }));
    return true })()`);
  await b.send('Input.insertText', { text: `${px}px` });
  const r = await b.eval('window.__done');
  await key(b, 'Escape', 'Escape', 27); // puts the field and the canvas back
  await sleep(40);
  return { ms: r.at - r.start, timedOut: !!r.timedOut };
}
// PRF-03: an agent over MCP; timed from the call to the paint, on the same wall clock.
async function agentTrial(b, mcp, comp, value) {
  const read = await mcp.call('read_component', { component: comp });
  assert.ok(!read.isError, read.text);
  await b.eval(`window.__done = window.__painted(${JSON.stringify(LABELS)}, (n) => n.textContent === ${JSON.stringify(value)}); true`);
  const start = now();
  const r = await mcp.call('apply_edits', { component: comp, baseRevision: read.data.revision, edits: [{ op: 'setDefault', name: 'label', value }] });
  assert.ok(!r.isError, r.text);
  const p = await b.eval('window.__done');
  return { ms: p.at - start, timedOut: !!p.timedOut };
}

async function edits200(session, ids) {
  const { browser: b, cells, server, errors } = session, results = [];
  console.log('focusing the edited component');
  await focusTarget(b);
  const comp = await b.eval('napkin.state.selection.component');
  const rows = { 'PRF-02': 'panel edit (Tab commit)', 'PRF-03': 'agent edit over MCP', 'PRF-08': 'typing, focus kept' };
  for (const id of ['PRF-02', 'PRF-03', 'PRF-08']) {
    if (!ids.has(id)) continue;
    const samples = [], timeouts = [], mcp = id === 'PRF-03' ? await session.mcp() : null;
    for (let i = 0; i < 40; i++) {
      const r = id === 'PRF-02' ? await panelTrial(b, `Panel ${i}`) : id === 'PRF-03' ? await agentTrial(b, mcp, comp, `Agent ${i}`) : await typingTrial(b, i);
      if (process.env.VERBOSE) console.log(id, i, r);
      if (i < 10) continue; // ten warm-up trials (JIT, first renders) are run and not counted: 30 samples remain
      samples.push(r.ms); if (r.timedOut) timeouts.push(i);
      if (id !== 'PRF-08') await sleep(60);
    }
    const d = stats(samples), bar = id === 'PRF-08' ? 50 : 100;
    const pass = timeouts.length === 0 && (id === 'PRF-08' ? d.p95 <= bar : d.p95 < bar);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    results.push(record(id, { pass, cells, ...d, timeouts, errors: [...errors], what: rows[id], method: paint + (id === 'PRF-08' ? ' Typing stays in the padding field (no Tab, no blur); input event timestamp to the selected node showing the new padding. Escape resets between trials.' : id === 'PRF-02' ? ' Starts at the Tab key event that commits the typed setting default; ends when all eight cells of the edited component show it (POST, file write, SSE, bundle fetch, remount, paint).' : ' Starts when the MCP apply_edits call is made by a separate process; ends at paint.') + ' 40 trials, the first 10 not counted. Nearest-rank p95. Component revealed at its own size with 200 components (1,131 cells) loaded.' }, `${pass ? 'PASS' : 'FAIL'}: ${what(id)} p50 ${d.p50.toFixed(1)} ms, p95 ${d.p95.toFixed(1)} ms (bar ${id === 'PRF-08' ? '<=' : '<'} ${bar} ms); ${cells} cells; ${timeouts.length}/30 timeouts.`, `node bench/perf.js --id ${id}`));
  }
  if (ids.has('PRF-07')) {
    await b.send('HeapProfiler.collectGarbage');
    const heap = await b.send('Runtime.getHeapUsage');
    const serverRSSMB = rssMB(server.proc.pid), pageHeapMB = heap.usedSize / 2 ** 20;
    const pass = serverRSSMB <= 500 && pageHeapMB <= 400;
    results.push(record('PRF-07', { pass, cells, serverRSSMB, pageHeapMB, afterEdits: ids.size > 1, method: 'Server: /proc/PID/status VmRSS of the napkin server process (the esbuild child is a separate process, listed below). Page: Runtime.getHeapUsage usedSize after an explicit GC. With --id PRF-07 alone the sample is a freshly opened 200-component page; in a full run it follows the edit trials.', esbuildChildRSSMB: childRSS(server.proc.pid) }, `${pass ? 'PASS' : 'FAIL'}: server RSS ${serverRSSMB.toFixed(0)} MB (<= 500), page live JS heap ${pageHeapMB.toFixed(0)} MB (<= 400); ${cells} cells.`, 'node bench/perf.js --id PRF-07'));
  }
  return results;
}
const what = (id) => ({ 'PRF-02': 'panel edit to pixels', 'PRF-03': 'agent edit to pixels', 'PRF-08': 'typing to pixels' })[id];
function childRSS(pid) {
  try { return execFileSync('sh', ['-c', `for c in $(pgrep -P ${pid}); do awk '/VmRSS/{print $2}' /proc/$c/status; done`], { encoding: 'utf8' }).split('\n').filter(Boolean).reduce((a, k) => a + Number(k) / 1024, 0); } catch { return null; }
}

// PRF-04: a scripted five-second pan with real wheel events, frame intervals from requestAnimationFrame. Run twice: pan only, then pan with a Ctrl-wheel zoom step every twelfth event.
async function motionRun(b, zoomSteps) {
  await b.eval(`(()=>{ const sec = document.querySelectorAll('section.cmp')[100]; napkin.view.fitRect(napkin.stage.componentRect(sec.dataset.component), { pad: 1500, max: 0.3 }); return true })()`);
  await sleep(800);
  const before = await b.eval('napkin.view.get()');
  await b.eval(`window.__frames = []; window.__stop = false; (() => { let prev; const tick = (t) => { if (prev !== undefined) __frames.push(t - prev); prev = t; if (!__stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })(); true`);
  let wheelEvents = 0;
  const started = performance.now();
  while (performance.now() - started < 5000) {
    const e = performance.now() - started, zoom = zoomSteps && wheelEvents % 12 === 0;
    await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: Math.sin(e / 500) * 30, deltaY: zoom ? (Math.floor(e / 1000) % 2 ? 120 : -120) : (e < 2500 ? 40 : -40), modifiers: zoom ? 2 : 0 });
    wheelEvents++; await sleep(16);
  }
  const samples = (await b.eval('window.__stop = true; window.__frames.slice(1)')).filter((x) => x > 0);
  const after = await b.eval('napkin.view.get()');
  return { ...stats(samples), slowFrames: samples.filter((x) => x > 20).length, before, after, wheelEvents, moved: before.x !== after.x || before.y !== after.y };
}
async function motion({ browser: b, cells }) {
  const pan = await motionRun(b, false), zoom = await motionRun(b, true);
  const pass = pan.p95 <= 16.7 && pan.moved;
  const line = (n, r) => `${n}: p50 ${r.p50.toFixed(2)}, p95 ${r.p95.toFixed(2)} ms, ${r.slowFrames}/${r.n} frames over 20 ms`;
  return record('PRF-04', { pass, cells, pan, panWithZoom: zoom, passWithZoom: zoom.p95 <= 16.7, method: 'Real CDP wheel events for 5 s (one every 16 ms; the call returns when the page has taken the event, so about 25 land) on the 200-component canvas at 30% zoom around component 100, with a component selected; rAF timestamp intervals over the same window. "pan" is wheel-only; "panWithZoom" adds a Ctrl-wheel zoom step every twelfth event. Browser timers tick every 0.1 ms, so a steady 60 Hz reads 16.6 to 16.8. The page is never given a transform by the benchmark. Pixels are rasterised on the CPU (--disable-gpu): a zoom step re-rasterises the viewport and costs two to four vsyncs, with no main-thread task over 20 ms.' }, `${pass ? 'PASS' : 'FAIL'}: pan only: p95 ${pan.p95.toFixed(2)} ms (bar <= 16.7) | ${line('pan only', pan)} | ${line('pan with a zoom step every 12th event', zoom)}.`, 'node bench/perf.js --id PRF-04');
}

async function engine(ids) {
  const c = generateCorpus(200), ws = await openWorkspace(c.dir), results = [];
  try {
    const e = ws.find('Specimen000');
    const samples = [], buildSamples = [];
    for (let i = 1; i <= 2000; i++) { // edit #1 and edit #2000 are both kept
      const base = await e.store.read(), start = performance.now();
      const result = await e.store.apply({ baseRevision: base.revision, by: 'agent-perf', edits: [{ op: 'setDefault', name: 'label', value: `Edit ${i}` }] });
      assert.ok(result.ok, result.error);
      const built = await ws.bundle(e); assert.ok(built.ok, built.error);
      samples.push(performance.now() - start); buildSamples.push(built.ms);
    }
    if (ids.has('PRF-05')) {
      const d = stats(buildSamples), pass = d.p95 <= 50;
      results.push(record('PRF-05', { pass, ...d, method: '200-component workspace, 2,000 real store.apply edits; ws.bundle awaited after each. bundle.js ms starts before the incremental esbuild rebuild and ends when the output text is available.' }, `${pass ? 'PASS' : 'FAIL'}: p50 ${d.p50.toFixed(1)} ms, p95 ${d.p95.toFixed(1)} ms rebuild (bar <= 50 ms), 2,000 rebuilds.`, 'node bench/perf.js --id PRF-05'));
    }
    if (ids.has('PRF-06')) {
      const ratio = samples[1999] / samples[0], pass = ratio <= 2;
      const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
      results.push(record('PRF-06', { pass, ...stats(samples), firstMS: samples[0], edit2000MS: samples[1999], ratio, first100: stats(samples.slice(0, 100)), last100: stats(samples.slice(-100)), first100Mean: mean(samples.slice(0, 100)), last100Mean: mean(samples.slice(-100)), method: '200-component workspace. Wall clock from store.apply through the atomic file write and the completed esbuild bundle, for each of 2,000 edits; neither the first nor the 2,000th is discarded. No browser.' }, `${pass ? 'PASS' : 'FAIL'}: edit #1 ${samples[0].toFixed(2)} ms; edit #2000 ${samples[1999].toFixed(2)} ms; ratio ${ratio.toFixed(3)} (<= 2). Mean of the last 100 / first 100: ${(mean(samples.slice(-100)) / mean(samples.slice(0, 100))).toFixed(3)}.`, 'node bench/perf.js --id PRF-06'));
    }
  } finally { await ws.close(); rmSync(c.dir, { recursive: true, force: true }); }
  return results;
}

async function branchSwitch() {
  const c = generateCorpus(40);
  const git = (...args) => execFileSync('git', args, { cwd: c.dir, encoding: 'utf8' });
  // Git writes happen ONLY inside the generated temp repo. Never stage or commit the napkin worktree.
  git('init', '-q'); git('add', '*.tsx'); git('-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-qm', 'corpus');
  git('checkout', '-qb', 'changed');
  for (const f of c.files) writeFileSync(f, readFileSync(f, 'utf8').replace(/label = 'Specimen (\d+)'/, "label = 'Branch $1'"));
  git('-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-qam', 'all forty labels');
  git('checkout', '-q', '-');
  const server = await startServer(c.dir), b = await launchChromium({ width: 1440, height: 900 }), errors = trackErrors(b);
  try {
    await b.goto(server.url); await b.waitFor(allDrawn(40), 30000);
    await sleep(500);
    const start = performance.now(); git('checkout', '-q', 'changed');
    await b.waitFor(`document.querySelectorAll('section.cmp').length===40 && [...document.querySelectorAll('section.cmp')].every(s=>s.querySelectorAll('.mount [data-n="label"]').length && [...s.querySelectorAll('.mount [data-n="label"]')].every(n=>n.textContent.startsWith('Branch ')))`, 10000);
    await b.eval('(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()');
    const ms = performance.now() - start, pass = ms <= 2000 && errors.length === 0;
    return record('REL-05', { pass, ms, components: 40, cells: c.cells, errors, method: 'An actual git checkout in a generated temp repository changes all forty TSX files. The clock starts before the checkout and ends after every cell of all forty sections shows its new label plus two rAF callbacks.' }, `${pass ? 'PASS' : 'FAIL'}: all 40 components / ${c.cells} cells repainted ${ms.toFixed(0)} ms after the checkout (bar <= 2000).`, 'node bench/perf.js --id REL-05');
  } finally { await b.close(); await server.stop(); rmSync(c.dir, { recursive: true, force: true }); }
}

export async function runPerf({ id } = {}) {
  const all = ['PRF-01', 'PRF-02', 'PRF-03', 'PRF-04', 'PRF-05', 'PRF-06', 'PRF-07', 'PRF-08', 'REL-05'];
  if (id && !all.includes(id)) throw new Error(`unknown id ${id}`);
  const ids = new Set(id ? [id] : all), results = [];
  if (ids.has('PRF-01')) results.push(await cold());
  if (['PRF-02', 'PRF-03', 'PRF-04', 'PRF-07', 'PRF-08'].some((x) => ids.has(x))) {
    const session = await setup200();
    try { results.push(...await edits200(session, ids)); if (ids.has('PRF-04')) results.push(await motion(session)); }
    finally { await session.close(); }
  }
  if (ids.has('PRF-05') || ids.has('PRF-06')) results.push(...await engine(ids));
  if (ids.has('REL-05')) results.push(await branchSwitch());
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { id: { type: 'string' } } });
  const results = await runPerf(values); if (results.some((r) => !r.pass)) process.exitCode = 1;
}
