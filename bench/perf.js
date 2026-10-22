// CPU-only, real Chromium page, real server. Run all: node bench/perf.js; one row: --id PRF-02.
// Built first by Codex on the old core; rebuilt on the current canvas (shared React runtime, session tokens, hash revisions).
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
if (process.argv.includes('--gpu')) process.env.NAPKIN_GPU = '1'; // GPU raster (run through ~/anime-pipeline/tools/gpu_run: the GPU is shared)
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

export async function setup200() {
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
export async function focusTarget(b) {
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

// PRF-04: a scripted five-second pan with Ctrl-wheel zoom steps, measured from a Chromium trace (Tracing domain) and from requestAnimationFrame.
// Input is sent without waiting for each acknowledgement (a person's wheel does not wait either), one event every 16 ms, about 300 land.
const CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'benchmark', 'cc', 'viz', 'toplevel'];
export async function traceWhile(b, work) {
  const events = []; let complete;
  const off = b.onEvent((m) => {
    if (m.method === 'Tracing.dataCollected') events.push(...m.params.value);
    if (m.method === 'Tracing.tracingComplete') complete?.();
  });
  const done = new Promise((r) => { complete = r; });
  await b.send('Tracing.start', { traceConfig: { includedCategories: CATS, recordMode: 'recordAsMuchAsPossible' }, transferMode: 'ReportEvents' });
  let out;
  try { out = await work(); } finally { await b.send('Tracing.end'); await done; off(); }
  return { events, out };
}
const quantile = (xs, q) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)] : NaN; };
const TICK = 1000 / 60;
export function analyseTrace(events, t0, t1) {
  // The renderer main thread, and the frames the compositor produced inside the window [t0, t1] (trace microseconds).
  const mains = new Set(events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
  const tasks = events.filter((e) => e.ph === 'X' && e.name === 'RunTask' && mains.has(`${e.pid}:${e.tid}`) && e.ts >= t0 && e.ts <= t1).map((e) => e.dur / 1000);
  // A frame is one PipelineReporter (BeginFrame to presentation) that wanted an update. Its duration is 16.7 ms when it made its vsync.
  const open = new Map(), paired = [];
  for (const e of events.filter((x) => x.name === 'PipelineReporter').sort((x, y) => x.ts - y.ts)) {
    const key = `${e.pid}:${e.id2?.local ?? e.id}`;
    if (e.ph === 'b') open.set(key, e);
    else if (e.ph === 'e' && open.has(key)) { const b = open.get(key); open.delete(key); paired.push({ b, end: e.ts, ms: (e.ts - b.ts) / 1000 }); }
  }
  const frames = paired.filter(({ b }) => b.ts >= t0 && b.ts <= t1)
    .map(({ b, end, ms }) => ({ state: b.args?.frame_reporter?.state ?? 'unknown', ms, end, miss: !!b.args?.frame_reporter?.has_missing_content }))
    .filter((f) => f.state !== 'STATE_NO_UPDATE_DESIRED' && f.ms > 0);
  if (process.env.DBG) { const m0 = events.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'wheel').map((e) => e.ts); const base = Math.min(...m0); console.log('long', events.filter((e) => e.ph === 'X' && e.name === 'RunTask' && mains.has(`${e.pid}:${e.tid}`) && e.dur > 16700 && e.ts >= t0 && e.ts <= t1).map((e) => `${((e.ts - base) / 1000).toFixed(0)}:${(e.dur / 1000).toFixed(0)}`).join(' ')); { const w0 = base + (+process.env.DBG0 || 0) * 1000, w1 = base + (+process.env.DBG1 || 0) * 1000, nm = {}; for (const e of events) { if (e.ph !== 'X' || e.ts < w0 || e.ts > w1 || !mains.has(`${e.pid}:${e.tid}`)) continue; (nm[e.name] ??= { n: 0, d: 0 }); nm[e.name].n++; nm[e.name].d += e.dur / 1000; } if (process.env.DBG1) { const pc = {}; for (const e of events) { if (e.ts < w0 || e.ts > w1 || e.ph !== 'X' || e.name !== 'Paint') continue; const k = `${(e.args?.data?.clip ?? []).slice(0, 8).map((n) => Math.round(n)).join(',')} node=${e.args?.data?.nodeId} layer=${e.args?.data?.layerId}`; pc[k] = (pc[k] ?? 0) + 1; } console.log('paints', JSON.stringify(Object.entries(pc).sort((a, b) => b[1] - a[1]).slice(0, 6))); } if (process.env.DBG1) console.log('win', Object.entries(nm).sort((a, b) => b[1].d - a[1].d).slice(0, 12).map(([k, v]) => `${k} n=${v.n} ${v.d.toFixed(0)}ms`).join(' | ')); }
  if (process.env.DBG4) { const th = +process.env.DBG4 * 1000, L = events.filter((e) => e.ph === 'X' && e.name === 'RunTask' && mains.has(`${e.pid}:${e.tid}`) && e.dur > th && e.ts >= t0 && e.ts <= t1), base = Math.min(...events.filter((e) => e.name === 'EventDispatch').map((e) => e.ts)); console.log('L', L.length); for (const l of L.slice(0, 14)) { const kids = events.filter((e) => e.ph === 'X' && e.pid === l.pid && e.tid === l.tid && e.ts >= l.ts && e.ts + e.dur <= l.ts + l.dur + 1 && e.name !== 'RunTask' && e.name !== 'ThreadControllerImpl::RunTask' && e.dur > 600).sort((a, b) => b.dur - a.dur).slice(0, 6).map((e) => `${e.name}:${(e.dur / 1000).toFixed(1)}`); console.log('task', ((l.ts - base) / 1000).toFixed(0), (l.dur / 1000).toFixed(1), kids.join(' ')); } }
  if (process.env.DBG2) { const L = events.filter((e) => e.ph === 'X' && e.name === 'RunTask' && mains.has(`${e.pid}:${e.tid}`) && e.dur > 16700 && e.ts >= t0 && e.ts <= t1), nm = {}; for (const e of events) { if (e.ph !== 'X' || !mains.has(`${e.pid}:${e.tid}`) || e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') continue; if (!L.some((l) => e.ts >= l.ts && e.ts + e.dur <= l.ts + l.dur + 1)) continue; (nm[e.name] ??= { n: 0, d: 0 }); nm[e.name].n++; nm[e.name].d += e.dur / 1000; } console.log('inlong', L.length, Object.entries(nm).sort((a, b) => b[1].d - a[1].d).slice(0, 14).map(([k, v]) => `${k} n=${v.n} ${v.d.toFixed(0)}ms`).join(' | ')); }
  console.log('dropped', paired.filter(({ b }) => b.ts >= t0 && b.ts <= t1 && b.args?.frame_reporter?.state === 'STATE_DROPPED').map(({ b }) => ((b.ts - base) / 1000).toFixed(0)).join(' ')); }
  const states = {}; for (const f of frames) states[f.state] = (states[f.state] ?? 0) + 1;
  frames.sort((x, y) => x.end - y.end);
  for (let i = frames.length - 1; i > 0; i--) if (frames[i].end - frames[i - 1].end < 2000) frames.splice(i, 1); // a presented frame can be reported twice (a compositor update and a late main-thread one): count the vsync once; PRESENTED_PARTIAL is reported separately
  if (process.env.DBG) { const b0 = Math.min(...events.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'wheel').map((e) => e.ts)); console.log('missed@', frames.slice(1).map((f, i) => [(f.end - b0) / 1000, (f.end - frames[i].end) / 1000]).filter(([, g]) => g >= 25).map(([t, g]) => `${t.toFixed(0)}:${g.toFixed(0)}`).join(' ')); }
  if (process.env.DBG3) console.log('states', JSON.stringify(frames.reduce((a, f) => (a[f.state] = (a[f.state] ?? 0) + 1, a), {})), 'first gaps', frames.slice(1, 30).map((f, i) => ((f.end - frames[i].end) / 1000).toFixed(0)).join(' '));
  if (process.env.DBG5) { const g = frames.slice(1).map((f, i) => (f.end - frames[i].end) / 1000); const h = {}; for (const x of g) { const k = Math.round(x); h[k] = (h[k] ?? 0) + 1; } console.log('hist', JSON.stringify(h)); const b0 = Math.min(...events.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'wheel').map((e) => e.ts)); console.log('late', frames.slice(1).map((f, i) => [(f.end - b0) / 1000, (f.end - frames[i].end) / 1000]).filter(([, g]) => g > +(process.env.DBG6 || 19)).slice(0, 30).map(([t, g]) => `${t.toFixed(0)}:${g.toFixed(0)}`).join(' ')); }
  if (process.env.DBG7) { const big = frames.slice(1).map((f, i) => ({ a: frames[i].end, b: f.end })).filter((g) => g.b - g.a > (+process.env.DBG9 || 150000)); for (const g of big.slice(2, 5)) { const nm = {}; for (const e of events) { if (e.ph !== 'X' || e.ts < g.a || e.ts > g.b) continue; const k = `${e.name}@${e.tid === undefined ? '' : (mains.has(`${e.pid}:${e.tid}`) ? 'main' : 'other')}`; (nm[k] ??= { n: 0, d: 0 }); nm[k].n++; nm[k].d += e.dur / 1000; } console.log('gap', (g.b - g.a) / 1000, Object.entries(nm).sort((x, y) => y[1].d - x[1].d).slice(0, 12).map(([k, v]) => `${k} n=${v.n} ${v.d.toFixed(0)}ms`).join(' | ')); } }
  if (process.env.DBG8) { const big = frames.slice(1).map((f, i) => ({ a: frames[i].end, b: f.end })).filter((g) => g.b - g.a > 150000)[0]; if (big) { const b0 = Math.min(...events.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'wheel').map((e) => e.ts)); const rel = (t) => ((t - b0) / 1000).toFixed(0); console.log('gapwin', rel(big.a), rel(big.b)); console.log(' wheels', events.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'wheel' && e.ts > big.a - 50000 && e.ts < big.b + 20000).map((e) => rel(e.ts) + ':' + (e.dur / 1000).toFixed(1)).join(' ')); console.log(' reporters', events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b' && e.ts > big.a - 40000 && e.ts < big.b + 30000).map((e) => rel(e.ts) + ':' + (e.args?.frame_reporter?.state ?? '?').replace('STATE_', '')).join(' ')); console.log(' draws', events.filter((e) => e.name === 'Display::DrawAndSwap' && e.ph === 'X' && e.ts > big.a - 40000 && e.ts < big.b + 30000).map((e) => rel(e.ts)).join(' ')); console.log(' bmf', events.filter((e) => e.name === 'ProxyMain::BeginMainFrame' && e.ph === 'X' && e.ts > big.a - 40000 && e.ts < big.b + 30000).map((e) => rel(e.ts) + ':' + (e.dur / 1000).toFixed(0)).join(' ')); } }
  const gaps = frames.slice(1).map((f, i) => (f.end - frames[i].end) / 1000); // presentation to presentation: 16.7 ms when every vsync made a frame, 33.3 after a missed one
  
  // Draw-to-draw intervals as a cross-check: they carry the compositor's scheduling jitter, so only whole missed vsyncs are counted from them.
  const draws = events.filter((e) => e.name === 'Display::DrawAndSwap' && e.ph === 'X' && e.ts >= t0 && e.ts <= t1).map((e) => e.ts / 1000).sort((x, y) => x - y);
  const dgaps = draws.slice(1).map((t, i) => t - draws[i]);
  return {
    frames: gaps.length, frameP50: quantile(gaps, 0.5), frameP95: quantile(gaps, 0.95), frameMax: Math.max(...gaps, 0), frameMean: gaps.reduce((a, x) => a + x, 0) / Math.max(1, gaps.length),
    frameP95Vsync: quantile(gaps.map((x) => Math.max(1, Math.round(x / TICK)) * TICK), 0.95), // each interval rounded to whole vsyncs: removes the +/- 2 ms the software compositor adds to presentation times
    framesMissed: gaps.filter((x) => x >= 1.5 * TICK).length, frames25: gaps.filter((x) => x >= 25).length, frames33: gaps.filter((x) => x >= 33).length,
    framesOver177: gaps.filter((x) => x > 17.7).length,
    framesDropped: states.STATE_DROPPED ?? 0, framesPartial: states.STATE_PRESENTED_PARTIAL ?? 0, framesMissingContent: frames.filter((f) => f.miss).length,
    drawCount: draws.length, drawIntervalP95: quantile(dgaps, 0.95), drawIntervalMax: Math.max(...dgaps, 0), missedVsyncs: dgaps.reduce((a, x) => a + Math.max(0, Math.round(x / TICK) - 1), 0),
    mainTasks: tasks.length, longTasks: tasks.filter((x) => x > TICK).length, longTaskMax: Math.max(...tasks, 0), longTasksOver50: tasks.filter((x) => x >= 50).length,
    pipelineStates: states,
  };
}
// Zoom: a Ctrl-wheel zoom step in place of every twelfth scroll event (a step is one notch, about 1.27x; alternately in and out).
// Pan: scroll events along a Lissajous path (about 750 px tall and 70 px wide; the components form one tall column), so the view stays over them and every frame has something to redraw.
// The corpus is packed by the stage while the view is zoomed out to fit everything, which makes one tall column. A real canvas is a grid: lay the 200 components out in
// rows of the width that makes the whole a rough square, with the stage's own gaps, before measuring.
export async function gridLayout(b) {
  return b.eval(`(() => {
    const ids = [...napkin.stage.sections.keys()], S = napkin.stage.sections, GX = 120, GY = 210;
    const w = (id) => Math.max(S.get(id).size.w, 160), h = (id) => S.get(id).size.h;
    const area = ids.reduce((a, id) => a + (w(id) + GX) * (h(id) + GY), 0), width = Math.round(Math.sqrt(area * 1.25));
    let x = 0, y = 0, rowH = 0;
    for (const id of ids) { if (x && x + w(id) > width) { x = 0; y += rowH + GY; rowH = 0; } napkin.stage.moveTo(id, x, y); x += w(id) + GX; rowH = Math.max(rowH, h(id)); }
    // select the component nearest the middle of the grid, so a square tour from it stays over components
    const cx = width / 2, cy = (y + rowH) / 2; let best = null, bd = 1e18;
    for (const id of ids) { const p = S.get(id).pos, d = Math.hypot(p.x + w(id) / 2 - cx, p.y + h(id) / 2 - cy); if (d < bd) { bd = d; best = id; } }
    const c = napkin.state.components.get(best);
    napkin.select({ component: best, node: c.doc.root.id, variant: {} });
    return { width, height: y + rowH, selected: c.name };
  })()`);
}
// Counts from geometry only (no layout), so sampling during a run does not disturb it.
const SAMPLER = `window.__s = { sel: [0, 0], onMax: 0, onMin: 1e9, drawnMax: 0, seen: new Set(), n: 0 };
window.__tick = setInterval(() => { const v = napkin.view.get(), bx = napkin.view.stageBox(), S = napkin.stage.sections, q = window.__s; let on = 0, drawn = 0;
  const vis = (r) => r.x * v.z + v.x < bx.width && (r.x + r.w) * v.z + v.x > 0 && r.y * v.z + v.y < bx.height && (r.y + r.h) * v.z + v.y > 0;
  for (const [id, sec] of S) { if (!sec.culled) { drawn++; q.seen.add(id); } if (sec.pos && sec.size.w && vis({ x: sec.pos.x, y: sec.pos.y, w: sec.size.w, h: sec.size.h })) on++; }
  const c = napkin.state.selection?.component, sc = c && S.get(c); q.sel[sc && sc.pos && vis({ x: sc.pos.x, y: sc.pos.y, w: sc.size.w, h: sc.size.h }) ? 0 : 1]++;
  q.onMax = Math.max(q.onMax, on); q.onMin = Math.min(q.onMin, on); q.drawnMax = Math.max(q.drawnMax, drawn); q.n++; }, 100); true`;
// mode: 'hold' scrolls back and forth about 370 px around the selection (it stays on screen); 'sweep' travels in a square (25 px per event, a side every 1.25 s, about 7,500 px in all) so components are
// un-culled and rasterised continuously. zoomSteps: every twelfth event is a Ctrl-wheel zoom step (one notch, 1.27x; alternately in and out), anchored on the stage centre.
async function motionRun(b, { mode, zoomSteps, z0 = 0.3, grid }) {
  const speed = Math.min(25, 0.4 * Math.min(grid.width, grid.height) * z0 / 78); // px per event: a side of the square is 78 events, and the tour stays inside the grid
  await b.eval(`(()=>{ const r = napkin.stage.componentRect(napkin.state.selection.component), bx = napkin.view.stageBox(), z = ${z0}; napkin.view.set({ z, x: bx.width / 2 - (r.x + r.w / 2) * z, y: bx.height / 2 - (r.y + r.h / 2) * z }); return 1 })()`);
  await sleep(900);
  const before = await b.eval('napkin.view.get()');
  await b.eval(`window.__path = 0; { let last = napkin.view.get(); napkin.on('view', (v) => { window.__path += Math.hypot(v.x - last.x, v.y - last.y) + Math.abs(v.z - last.z) * 1000; last = v; }); } window.__frames = []; window.__stop = false; (() => { let prev; const tick = (t) => { if (prev !== undefined) __frames.push(t - prev); prev = t; if (!__stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })(); ${SAMPLER}`);
  const sb = await b.eval('(() => { const r = napkin.view.stageBox(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()'), mx = sb.x, my = sb.y;
  const dirs = [[0, speed], [speed, 0], [0, -speed], [-speed, 0]];
  const { events, out } = await traceWhile(b, async () => {
    const sent = [], started = performance.now();
    let n = 0;
    while (performance.now() - started < 5000) {
      const e = performance.now() - started, zoom = zoomSteps && n % 12 === 0, up = (n / 12) % 2 === 0; // steps alternate in and out, so the view stays over components (a second in a row of zoom-in leaves the gaps between frames on screen: nothing to draw, so no frames)
      const [dx, dy] = mode === 'sweep' ? dirs[Math.floor(e / 1250) % 4] : [Math.cos(e / 270) * 18, Math.cos(e / 400) * 18];
      sent.push(b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mx, y: my, deltaX: zoom ? 0 : dx, deltaY: zoom ? (up ? -120 : 120) : dy, modifiers: zoom ? 2 : 0 }));
      n++;
      const next = started + n * 16; await sleep(Math.max(0, next - performance.now()));
    }
    await Promise.all(sent);
    await sleep(500); // the settle after the last event is inside the trace but outside the measured window
    return { wheelEvents: n };
  });
  const inputs = events.filter((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'wheel').map((e) => e.ts);
  const w0 = Math.min(...inputs), w1 = Math.max(...inputs);
  const trace = analyseTrace(events, w0, w1 + 100000);
  const samples = (await b.eval('clearInterval(window.__tick); window.__stop = true; window.__frames.slice(1)')).filter((x) => x > 0);
  const q = await b.eval('(() => { const q = window.__s; return { sel: q.sel, onMax: q.onMax, onMin: q.onMin, drawnMax: q.drawnMax, seen: q.seen.size, n: q.n } })()');
  const after = await b.eval('napkin.view.get()');
  const path = await b.eval('window.__path');
  const tail = analyseTrace(events, w1 + 100000, w1 + 600000);
  return { ...stats(samples), rafOver177: samples.filter((x) => x > 17.7).length, rafSamples: samples.length, trace, settleTailLongestTaskMs: tail.longTaskMax, selectionOnScreenShare: q.sel[0] / Math.max(1, q.sel[0] + q.sel[1]), componentsOnScreenMin: q.onMin, componentsOnScreenMax: q.onMax, componentsDrawnMax: q.drawnMax, componentsDrawnDuringRun: q.seen, wheelEvents: out.wheelEvents, wheelsHandled: inputs.length, before, after, path, moved: path > 200 };
}
// The floor: the same trace analysis on a page that does nothing but move a translate3d every frame, in a Chromium of its own started now, so the machine is as busy as it is for the runs.
async function floorRun(wheel = false) {
  const b = await launchChromium({ width: 1440, height: 900 });
  try {
    const page = wheel
      ? '<body style="margin:0;background:#fff"><div id=d style="width:200px;height:200px;background:#369;will-change:transform"></div><script>let x=0,y=0,q=0;addEventListener("wheel",(e)=>{e.preventDefault();x+=e.deltaX;y+=e.deltaY;d.style.transform="translate3d("+x+"px,"+y+"px,0)"},{passive:false})</script>'
      : '<body style="margin:0;background:#fff"><div id=d style="width:200px;height:200px;background:#369;will-change:transform"></div><script>let x=0;(function f(){x=(x+3)%800;d.style.transform="translate3d("+x+"px,100px,0)";requestAnimationFrame(f)})()</script>';
    await b.goto('data:text/html,' + encodeURIComponent(page));
    await sleep(500);
    const { events } = await traceWhile(b, async () => {
      if (!wheel) return sleep(5000);
      const sent = [], started = performance.now(); let n = 0;
      while (performance.now() - started < 5000) { const e = performance.now() - started; sent.push(b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: Math.cos(e / 270) * 18, deltaY: Math.cos(e / 400) * 18, modifiers: 0 })); n++; await sleep(Math.max(0, started + n * 16 - performance.now())); }
      await Promise.all(sent);
    });
    const ts = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b').map((e) => e.ts);
    return analyseTrace(events, Math.min(...ts) + 600000, Math.max(...ts) - 600000);
  } finally { await b.close(); }
}
const machine = () => { const n = (cmd) => { try { return execFileSync('sh', ['-c', cmd], { encoding: 'utf8' }).trim(); } catch { return null; } }; return { loadavg: n("cut -d' ' -f1-3 /proc/loadavg"), chromiumProcesses: Number(n('pgrep -c chrom') ?? NaN), cpus: n('nproc') }; };
async function motion({ browser: b, cells }) {
  const gpuMode = !!process.env.NAPKIN_GPU, gpu = await b.gpuInfo().then((i) => ({ gpuCompositing: i.gpu.featureStatus.gpu_compositing, rasterization: i.gpu.featureStatus.rasterization, renderer: i.gpu.auxAttributes?.glRenderer })).catch((e) => ({ error: String(e) }));
  if (gpuMode) assert.ok(gpu.rasterization?.startsWith('enabled') && gpu.gpuCompositing === 'enabled' && /NVIDIA/.test(gpu.renderer ?? ''), `GPU raster is not on: ${JSON.stringify(gpu)}`);
  const m0 = machine(), floor = await floorRun(), floorWheel = await floorRun(true);
  const grid = await gridLayout(b);
  await sleep(500);
  const pan = await motionRun(b, { mode: 'hold', zoomSteps: false, grid }), zoom = await motionRun(b, { mode: 'hold', zoomSteps: true, grid }), sweep = await motionRun(b, { mode: 'sweep', zoomSteps: true, grid }), overview = await motionRun(b, { mode: 'sweep', zoomSteps: true, z0: 0.1, grid });
  const m1 = machine();
  // The bar is the raw p95 <= 16.7 ms. The software compositor adds jitter to presentation times, so the reading is also given against the trivial page measured in the same run (floor): pass is raw p95 <= 16.7, or raw p95 within 1 ms of the floor's raw p95.
  // And at most 2% of frames >= 25 ms (a missed vsync) or dropped, in each run.
  const bar = Math.max(16.7, floor.frameP95 + 1);
  const ok = (r) => r.moved && r.trace.frames > 250 && r.trace.frameP95 <= bar && r.trace.frames25 <= r.trace.frames * 0.02 && r.trace.framesDropped <= r.trace.frames * 0.02;
  const pass = [pan, zoom, sweep, overview].every(ok);
  const line = (n, r) => { const t = r.trace; return `${n}: raw p95 ${t.frameP95.toFixed(2)} ms (whole-vsync ${t.frameP95Vsync.toFixed(2)}), frames >=25 ms ${t.frames25}/${t.frames} (${(100 * t.frames25 / t.frames).toFixed(1)}%), >=33 ms ${t.frames33}, max ${t.frameMax.toFixed(1)} ms, dropped ${t.framesDropped}, ${t.longTasks} long tasks (max ${t.longTaskMax.toFixed(1)} ms), ${r.componentsOnScreenMin}-${r.componentsOnScreenMax} components on screen, ${r.componentsDrawnMax} un-culled (${r.componentsDrawnDuringRun} different ones over the run), selection on screen ${(100 * r.selectionOnScreenShare).toFixed(0)}%`; };
  const head = `floor (trivial translate3d page, same run): raw p95 ${floor.frameP95.toFixed(2)} ms, max ${floor.frameMax.toFixed(1)}, ${floor.frames25} frames >=25 ms; bar max(16.7, floor + 1) = ${bar.toFixed(2)} ms; same page driven by the same wheel events: raw p95 ${floorWheel.frameP95.toFixed(2)} ms, max ${floorWheel.frameMax.toFixed(1)}, ${floorWheel.frames25} frames >=25 ms; machine load ${m0.loadavg} before / ${m1.loadavg} after, ${m0.chromiumProcesses} chromium processes at start`;
  return record('PRF-04', { pass, cells, mode: gpuMode ? 'gpu' : 'cpu', gpu, grid, floor, floorWheel, bar, machineBefore: m0, machineAfter: m1, pan, panWithZoom: zoom, sweepWithZoom: sweep, overviewSweepWithZoom: overview, method: 'The 200 components are laid out as a grid (about square) first, as a real canvas is. Five seconds of real CDP wheel events (Input.dispatchMouseEvent, one every 16 ms, not waiting for each acknowledgement; about 300 are sent) while a Chromium trace (Tracing domain: devtools.timeline, frame, cc, viz) records. Frame time = the time between the presentations of consecutive frames that wanted an update (compositor PipelineReporter events inside the window). Counts of components on screen and un-culled come from geometry sampled every 100 ms without layout. Four runs: "pan" (30% zoom, selection centred, scrolling about 370 px back and forth: selection stays on screen), "pan+zoom" (the same with every twelfth event a Ctrl-wheel zoom step), "sweep+zoom" (30%, 25 px per event around a square of about 7,500 px of travel, with zoom steps: components are un-culled and rasterised continuously), "overview" (the sweep from 10% zoom). A floor run (a page that only moves a translate3d, own Chromium, same run) gives the compositor jitter of this machine at this moment. Pass, every run: raw p95 <= max(16.7, floor + 1) ms and at most 2% of frames >= 25 ms or dropped. CPU raster (--disable-gpu). The benchmark never gives the page a transform.' }, `${pass ? 'PASS' : 'FAIL'} (${gpuMode ? 'GPU raster: ' + gpu.renderer : 'CPU raster'}): ${head} | ${line('pan', pan)} | ${line('pan+zoom', zoom)} | ${line('sweep+zoom', sweep)} | ${line('overview 10% sweep+zoom', overview)}.`, `node bench/perf.js --id PRF-04${gpuMode ? ' --gpu' : ''}`, { suffix: gpuMode ? '.gpu' : '' });
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
  const { values } = parseArgs({ options: { id: { type: 'string' }, gpu: { type: 'boolean' } } });
  const results = await runPerf({ id: values.id }); if (results.some((r) => !r.pass)) process.exitCode = 1;
}
