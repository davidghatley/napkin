// Same-contract benchmark for the sync variants: latency both ways and a contention race.
// Usage: node bench/sync-bench.js [rounds]   (run from the variant's checkout)
import { readFileSync } from 'node:fs';
import { parse } from '../src/format.js';
import { getValue } from '../src/edits.js';
import { tempRepo, startServer, startMcp, waitFor } from '../test/helpers/harness.js';
import { connectCanvas } from '../src/canvas-client.js';

const N = Number(process.argv[2] || 30);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
const { file } = tempRepo();
const server = await startServer(file);
const mcp = await startMcp(file, server.url);
const canvas = await connectCanvas(server.url);
const seen = []; canvas.onChange((c) => seen.push({ ...c, at: performance.now() }));

const a2c = [], c2a = [];
for (let i = 0; i < N; i++) {
  const rd = await mcp.call('read_component', { component: 'Card' });
  const t0 = performance.now();
  const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: rd.data.revision, edits: [{ op: 'set', path: 'body.text', value: `agent ${i}` }] });
  const { value } = await waitFor(() => seen.find((c) => c.revision === r.data.revision), 2000);
  a2c.push(value.at - t0);
}
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const r = await canvas.sendEdits(canvas.state().revision, [{ op: 'set', path: 'card.gap', value: `${i}px` }]);
  const { value } = await waitFor(() => mcp.notifications.find((n) => n.params?.revision === r.revision), 2000);
  c2a.push(value.at - t0);
}
let landed = 0, stale = 0, other = [];
for (let k = 0; k < N; k++) {
  const rd = await mcp.call('read_component', { component: 'Card' });
  const base = rd.data.revision;
  const w = 100 * ((k % 9) + 1), pad = `${k + 1}px`;
  const [ag, cv] = await Promise.all([
    mcp.call('apply_edits', { component: 'Card', baseRevision: base, edits: [{ op: 'set', path: 'title.fontWeight', value: w }] }),
    canvas.sendEdits(base, [{ op: 'set', path: 'card.padding', value: pad }]),
  ]);
  if (!ag.isError && cv.ok) {
    const d = parse(readFileSync(file, 'utf8'));
    if (getValue(d, 'title.fontWeight') === w && getValue(d, 'card.padding') === pad) landed++; else other.push(`round ${k}: file missing an edit`);
  } else if (/stale/.test(ag.text) || /stale/.test(cv.error || '')) { stale++; other.push(`round ${k}: ${ag.text || ''} ${cv.error || ''}`); }
  else other.push(`round ${k}: ${ag.text} ${cv.error}`);
}
console.log(JSON.stringify({
  rounds: N,
  agent_to_canvas_ms: { p50: pct(a2c, 0.5), p95: pct(a2c, 0.95), max: Math.max(...a2c).toFixed(1) },
  canvas_to_agent_ms: { p50: pct(c2a, 0.5), p95: pct(c2a, 0.95), max: Math.max(...c2a).toFixed(1) },
  concurrent_both_landed: `${landed}/${N}`, wrongly_stale: stale, problems: other.slice(0, 5),
}, null, 2));
canvas.close(); mcp.stop(); await server.stop(); process.exit(0);
