#!/usr/bin/env node
// A scripted agent that does a visible piece of work on a running napkin canvas, over MCP only: a run with a plan, six kinds of
// file, a group, tuned controls, proposals for you to review, a question for you to answer, a checkpoint and a resume.
// Watch the canvas while it runs; answer the question in the "Runs" panel (Alt+R, then 1 or 2).
//
//   node src/cli.js open ./some-folder          (prints the canvas address)
//   node tools/agent-demo.mjs http://127.0.0.1:4810/ [--pace 600] [--auto-answer]
//
// --auto-answer answers its own question and approves its proposals as "you" over HTTP, for an unattended check.
import { spawn } from 'node:child_process';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { pace: { type: 'string', default: '600' }, 'auto-answer': { type: 'boolean' }, name: { type: 'string', default: 'demo' } } });
const base = (positionals[0] || process.env.NAPKIN_URL || 'http://127.0.0.1:4810/').replace(/\/?$/, '/');
const pace = Number(values.pace);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(s);

// --- a minimal MCP client over stdio
const proc = spawn(process.execPath, [join(ROOT, 'src/mcp.js')], { env: { ...process.env, NAPKIN_URL: base, NAPKIN_AGENT: values.name, NAPKIN_NO_FALLBACK: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
let n = 0, buf = ''; const waiting = new Map();
proc.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } catch { /* not a response */ } } });
const rpc = (method, params, ms = 40000) => new Promise((res, rej) => { const id = ++n; const t = setTimeout(() => rej(new Error(`${method} timed out`)), ms); waiting.set(id, (m) => { clearTimeout(t); res(m); }); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args = {}) => {
  const m = await rpc('tools/call', { name, arguments: args });
  if (m.error) throw new Error(m.error.message);
  const text = m.result.content?.[0]?.text ?? '';
  if (m.result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

// --- things to make
const svg = (hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#0f1b2d"/><ellipse cx="160" cy="100" rx="120" ry="48" fill="none" stroke="#5b86ff" stroke-width="2" transform="rotate(-18 160 100)"/><circle cx="160" cy="100" r="26" fill="hsl(${hue} 80% 60%)"/><circle cx="250" cy="70" r="7" fill="#f6ead4"/></svg>\n`;
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 20 + (x * 200) / w; raw[o + 1] = 60 + (y * 160) / h; raw[o + 2] = 200 - (x * 120) / w; } }
  const chunk = (type, data) => { const t = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(t)); return Buffer.concat([len, t, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds = 0.6, hz = 330) {
  const rate = 8000, count = Math.floor(rate * seconds), data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 9000 * Math.min(1, (count - i) / 800)), i * 2);
  const head = Buffer.alloc(44); head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const csv = 'day,distance_km,speed_kms\n' + Array.from({ length: 12 }, (_, i) => `${i + 1},${(1.2e5 + Math.sin(i / 2) * 9000).toFixed(0)},${(29 + Math.cos(i / 2) * 1.4).toFixed(2)}`).join('\n') + '\n';
const html = '<!doctype html><title>Orbit</title><style>body{margin:0;display:grid;place-items:center;height:100vh;background:#0f1b2d;color:#f6ead4;font:20px system-ui}button{background:#5b86ff;color:#fff;border:0;border-radius:10px;padding:12px 22px;font:inherit}</style><div><h1>Orbit study</h1><button>Launch</button></div>\n';

const steps = ['Read what you have selected', 'Sketch the orbit', 'Render a frame', 'Chart the distances', 'Record a tone', 'Write the page', 'Write the notes', 'Group the work', 'Tune the sketch', 'Propose a summary', 'Ask which orbit', 'Checkpoint', 'Finish'];
let k = 0;
const step = async (run, label, status = 'complete') => { await tool('add_run_step', { run, id: `s${steps.indexOf(label)}`, status }); say(`  ${status === 'complete' ? '✓' : '…'} ${label}`); await sleep(pace); };
const start = (run, label) => tool('add_run_step', { run, id: `s${steps.indexOf(label)}`, status: 'running' });

say(`Connected to ${base} as ${values.name}`);
const { id: run } = await tool('start_run', { name: `Orbit study (${new Date().toTimeString().slice(0, 5)})`, plan: steps.map((label, i) => ({ id: `s${i}`, label })) });
say(`Started run ${run}`);
await sleep(pace);
const board = await tool('get_board');
say(`You have ${board.selection.length} item(s) selected`);
await step(run, steps[0]);

const placed = [];
const put = async (label, path, content, encoding, kind, stepLabel) => {
  await start(run, stepLabel); await sleep(pace / 2);
  const r = await tool('add_artifact', { run, path, content, encoding, kind, step: `s${steps.indexOf(stepLabel)}` });
  placed.push(r.item?.id ?? path); say(`  placed ${path} (${r.item?.kind})`);
  await step(run, stepLabel);
};
const tag = String(Date.now()).slice(-5);
await put('sketch', `orbit-${tag}/sketch.svg`, svg(42), 'utf8', 'svg', steps[1]);
await put('frame', `orbit-${tag}/frame.png`, png(160, 100).toString('base64'), 'base64', 'png', steps[2]);
await put('data', `orbit-${tag}/distances.csv`, csv, 'utf8', 'csv', steps[3]);
await put('tone', `orbit-${tag}/tone.wav`, wav().toString('base64'), 'base64', 'wav', steps[4]);
await put('page', `orbit-${tag}/orbit.html`, html, 'utf8', 'html', steps[5]);
await put('notes', `orbit-${tag}/notes.md`, '# Orbit study\n\nThe orbit is slightly eccentric. See distances.csv.\n', 'utf8', 'md', steps[6]);

await start(run, steps[7]);
await tool('set_board', { groups: [{ id: `orbit-${tag}`, name: 'Orbit study', items: placed }], arrange: { by: 'run' }, views: [] });
await step(run, steps[7]);

await start(run, steps[8]);
const sketch = placed[0];
const schema = await tool('get_controls', { item: sketch });
const fill = schema.sections.flatMap((s) => s.controls).find((c) => c.type === 'color' && /fill/.test(c.label));
if (fill) { await tool('set_control', { item: sketch, control: fill.id, value: '#f08a3c', baseRevision: schema.revision }); say(`  tuned ${fill.label} on ${sketch}`); }
await step(run, steps[8]);

await start(run, steps[9]);
const p1 = await tool('propose', { run, path: `orbit-${tag}/summary.md`, content: '# Summary\n\nPeriod 27 days; distance varies by about 7 percent.\n', note: 'A short summary for the folder' });
const p2 = await tool('propose', { run, path: `orbit-${tag}/ideas.md`, content: '- Try a second orbit at 12 degrees\n- Add the moon\n', note: 'Next ideas (optional)' });
say(`  proposed two files; review them in the Runs panel (Alt+R): approve with A, reject with X, send back with S`);
await step(run, steps[9], 'running');

await start(run, steps[10]);
const q = await tool('ask_question', { run, text: 'Which orbit shall I draw next?', options: ['Circular', 'Eccentric'], step: `s${steps.indexOf(steps[10])}` });
say(`  asked: "Which orbit shall I draw next?" and waiting for you`);
if (values['auto-answer']) {
  const s = await (await fetch(base + 'api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'you' }) })).json();
  const h = { 'content-type': 'application/json', authorization: `Bearer ${s.token}` };
  setTimeout(async () => {
    await fetch(base + `api/review/${p1.id}`, { method: 'POST', headers: h, body: JSON.stringify({ outcome: 'accepted', comment: 'Good.' }) });
    await fetch(base + `api/review/${p2.id}`, { method: 'POST', headers: h, body: JSON.stringify({ outcome: 'rejected', comment: 'Not now.' }) });
    await fetch(base + `api/questions/${q.id}/answer`, { method: 'POST', headers: h, body: JSON.stringify({ answer: 'Eccentric' }) });
  }, pace);
}
let answer;
while (!answer) { const w = await tool('wait_for_answer', { question: q.id, waitMs: 20000 }); if (w.status === 'answered') answer = w.answer; }
say(`  you said: ${answer}`);
await step(run, steps[10]);

const events = await tool('read_events', { types: 'run-proposal-resolved,run-proposal-comment' });
for (const e of events.events) say(`  ${e.outcome}: ${e.path}${e.comment ? ` (“${e.comment}”)` : ''}`);
await step(run, steps[9]);

await tool('checkpoint_run', { run, label: 'before finishing' });
await step(run, steps[11]);
const resume = await tool('resume_run', { run });
say(`  resume says next is: ${resume.next?.label}`);
await step(run, steps[12]);
await tool('set_run_status', { run, status: 'complete' });
say('Run complete.');
proc.stdin.end(); proc.kill('SIGTERM');
