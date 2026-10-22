// Real page + two concurrent HTTP agents. Every edit goes through the server/store.apply.
import { parseArgs } from 'node:util';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { generateCorpus } from './corpus.js';
import { launchChromium } from '../test/helpers/cdp.js';
import { startServer, sleep } from '../test/helpers/harness.js';
import { session } from '../test/helpers/agents.js';
import { readComponent } from '../src/tsx/read.js';
import { rssMB, record, trackErrors, allDrawn, sourceHashes } from './common.js';

export async function runSoak({ duration = 1800, size = 200, interval = 1000, seed = 1729, diagnose = false } = {}) {
  const startedWithHashes = sourceHashes();
  const corpus = generateCorpus(size), server = await startServer(corpus.dir, diagnose ? { execArgv: ['--inspect=0'] } : {});
  // --diagnose: also ask the server's V8 for a collection each minute, to tell a retained heap from a slack one. It changes RSS, so such a run is never the REL-04 record.
  let inspector;
  if (diagnose) {
    let url; for (let i = 0; i < 50 && !url; i++) { url = /ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/.exec(server.output())?.[0]; if (!url) await sleep(100); }
    const ws = new WebSocket(url); await new Promise((r) => { ws.onopen = r; });
    let id = 0; const pending = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
    inspector = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  }
  const browser = await launchChromium({ width: 1440, height: 900 });
  const errors = trackErrors(browser), samples = [];
  let operations = 0, staleRetries = 0, validationCount = 0;
  let randomState = seed >>> 0;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296);
  const tokens = {};
  for (const agent of ['agent-a', 'agent-b', 'warmup']) tokens[agent] = await session(server.url, agent);
  const request = async (path, body, agent) => (await fetch(new URL(path, server.url), body ? { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[agent]}` }, body: JSON.stringify(body) } : {})).json();
  const validate = () => { for (const file of corpus.files) readComponent(readFileSync(file, 'utf8')); validationCount += size; };
  const edit = async (agent) => {
    const name = `Specimen${String(Math.floor(random() * size)).padStart(3, '0')}`;
    const field = Math.floor(random() * 3);
    const edits = field === 0 ? [{ op: 'set', path: 'root.gap', value: Math.floor(random() * 24) }]
      : field === 1 ? [{ op: 'set', path: 'root.padding', value: `${Math.floor(random() * 32)}px` }]
        : [{ op: 'setDefault', name: 'label', value: `${agent} ${operations}` }];
    let current = await request(`api/components/${name}`);
    let result = await request(`api/components/${name}/edits`, { baseRevision: current.revision, edits }, agent);
    if (!result.ok && /^stale revision/.test(result.error)) {
      staleRetries++; current = await request(`api/components/${name}`);
      result = await request(`api/components/${name}/edits`, { baseRevision: current.revision, edits }, agent);
    }
    if (!result.ok) throw new Error(result.error);
    operations++;
    // The page must draw the accepted revision, or a later one when another agent's edit to the same component overtook it
    // (revisions are content hashes: ask the server for the newest and wait for the page to show it).
    const deadline = performance.now() + 5000;
    for (;;) {
      const latest = (await request(`api/components/${name}`)).revision;
      // The page has the revision; a frame that is drawn (not waiting to scroll into view) shows it.
      if (await browser.eval(`(() => { const c = napkin.find(${JSON.stringify(name)}), sec = napkin.stage.sections.get(c.component); return c.revision === ${JSON.stringify(latest)} && (sec.pending || sec.el.dataset.revision === ${JSON.stringify(latest)}); })()`)) break;
      if (performance.now() > deadline) throw new Error(`the page did not draw ${name} at ${latest}`);
      await sleep(15);
    }
  };
  let result;
  try {
    await browser.goto(server.url); await browser.waitFor(allDrawn(size), 30000);
    // Establish a steady baseline after the same parser/writer/build/paint path has warmed up.
    for (let i = 0; i < 100; i++) await edit('warmup');
    console.log('Warmup complete; starting timed soak.');
    await sleep(1000);
    const baseline = rssMB(server.proc.pid), started = performance.now();
    samples.push({ seconds: 0, rssMB: baseline, heapMB: (await browser.send('Runtime.getHeapUsage')).usedSize / 2 ** 20 });
    const checkpoint = setInterval(async () => {
      try {
        validate();
        const sample = { seconds: (performance.now() - started) / 1000, rssMB: rssMB(server.proc.pid), heapMB: (await browser.send('Runtime.getHeapUsage')).usedSize / 2 ** 20, operations };
        if (inspector) { const before = await inspector('Runtime.getHeapUsage'); sample.heapBeforeGCMB = before.usedSize / 2 ** 20; sample.heapTotalBeforeGCMB = before.totalSize / 2 ** 20; await inspector('HeapProfiler.collectGarbage'); sample.heapAfterGCMB = (await inspector('Runtime.getHeapUsage')).usedSize / 2 ** 20; sample.rssAfterGCMB = rssMB(server.proc.pid); }
        samples.push(sample);
        console.log(`soak ${sample.seconds.toFixed(0)}s / ${duration}s: ${operations} edits, RSS ${sample.rssMB.toFixed(1)} MB, errors ${errors.length}${inspector ? `, heap before GC ${sample.heapBeforeGCMB.toFixed(1)} used / ${sample.heapTotalBeforeGCMB.toFixed(1)} total MB; after GC: heap ${sample.heapAfterGCMB.toFixed(1)} MB, RSS ${sample.rssAfterGCMB.toFixed(1)} MB` : ''}`);
        writeFileSync(join('/tmp', `napkin-soak-${process.pid}.json`), JSON.stringify({ duration, samples, errors, operations }));
      } catch (e) { errors.push({ type: 'checkpoint', detail: e.message }); }
    }, 60000);
    try {
      await Promise.all(['agent-a', 'agent-b'].map(async (agent) => {
        while (performance.now() - started < duration * 1000) {
          try { await edit(agent); } catch (e) { errors.push({ type: agent, detail: e.message }); }
          await sleep(Math.min(interval, Math.max(0, duration * 1000 - (performance.now() - started))));
        }
      }));
    } finally { clearInterval(checkpoint); }
    const elapsedSeconds = (performance.now() - started) / 1000;
    validate();
    samples.push({ seconds: elapsedSeconds, rssMB: rssMB(server.proc.pid), heapMB: (await browser.send('Runtime.getHeapUsage')).usedSize / 2 ** 20, operations });
    const peak = Math.max(...samples.map((s) => s.rssMB));
    const growthPercent = (peak / baseline - 1) * 100;
    const pass = errors.length === 0 && growthPercent <= 20 && elapsedSeconds >= duration;
    result = record(diagnose ? `REL-04-diagnose-${duration}s` : duration >= 1800 ? 'REL-04' : `REL-04-${duration}s`, { pass, sourceHashes: startedWithHashes, duration, elapsedSeconds, size, cells: corpus.cells, interval, seed, operations, staleRetries, validationCount, baselineRSSMB: baseline, peakRSSMB: peak, growthPercent, samples, errors, method: '200 real components, full grids; 100 warmup edits then timed soak; two HTTP agents pick seeded random valid set/setDefault edits; each accepted revision or a newer coalesced revision must draw; all files parsed each minute and at end; RSS growth uses maximum sampled server RSS vs warmed baseline. esbuild child RSS is separate from server RSS.' }, `${pass ? 'PASS' : 'FAIL'}: ${elapsedSeconds.toFixed(3)} s, ${operations} edits (includes 100 warmup), ${errors.length} errors, peak RSS growth ${growthPercent.toFixed(3)}%, ${validationCount} successful file parses.`, `node bench/soak.js --duration ${duration} --size ${size} --interval ${interval} --seed ${seed}`);
  } finally { await browser.close(); await server.stop(); rmSync(corpus.dir, { recursive: true, force: true }); }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { duration: { type: 'string', default: '1800' }, size: { type: 'string', default: '200' }, interval: { type: 'string', default: '1000' }, seed: { type: 'string', default: '1729' }, diagnose: { type: 'boolean', default: false } } });
  const { diagnose, ...numbers } = values;
  const options = { ...Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, Number(v)])), diagnose };
  if (Object.entries(options).some(([k, v]) => k !== "diagnose" && (!Number.isFinite(v) || v <= 0))) throw new Error("options must be positive numbers");
  const result = await runSoak(options); if (!result.pass) process.exitCode = 1;
}
