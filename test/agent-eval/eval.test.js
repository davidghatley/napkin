// AGT-07 agent eval. A fresh Claude (Sonnet) with ONLY the napkin MCP connected does 16 scripted tasks against a temp
// copy of the fixtures; checkers read the files it leaves. Two arms: "guided" (the guide is in the MCP instructions, as a
// resource and as a prompt; edit schemas are per-op) and "control" (NAPKIN_NO_GUIDE=1: no guide, no resource or prompt,
// a bare object schema for edits; the tool descriptions stay). Costs money and takes minutes, so it runs only with AGENT_EVAL=1:
//   AGENT_EVAL=1 EVIDENCE=1 node --test test/agent-eval/
// Optional: EVAL_MODEL (default sonnet), EVAL_ONLY=<task id,...>, EVAL_PARALLEL (default 3), EVAL_ARMS=guided,control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, fixture, startServer } from '../helpers/harness.js';
import { evidence } from '../helpers/agents.js';
import { TASKS } from './tasks.js';

const MODEL = process.env.EVAL_MODEL || 'sonnet';
const only = process.env.EVAL_ONLY?.split(',');
const tasks = TASKS.filter((t) => !only || only.includes(t.id));
const arms = (process.env.EVAL_ARMS || 'guided,control').split(',');
const median = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN; };

function runClaude(prompt, cwd, mcpConfig) {
  return new Promise((resolve) => {
    const args = ['-p', '--model', MODEL, '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__napkin__*',
      '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--setting-sources', '', '--max-budget-usd', '1.5', '--output-format', 'json', prompt];
    const p = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), 300000);
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

async function runTask(t, arm) {
  const work = mkdtempSync(join(tmpdir(), 'napkin-eval-'));
  const dir = join(work, 'components'); mkdirSync(dir);
  for (const n of ['Card', 'Button']) copyFileSync(fixture(n), join(dir, `${n}.tsx`));
  const ctx = { originalCard: readFileSync(join(dir, 'Card.tsx'), 'utf8') };
  let server = null;
  const env = { NAPKIN_DIR: dir, NAPKIN_URL: 'http://127.0.0.1:1/', NAPKIN_AGENT: 'eval-agent', ...(arm === 'control' && { NAPKIN_NO_GUIDE: '1' }) };
  let command = process.execPath, args = [join(ROOT, 'src', 'mcp.js')];
  if (t.propose) { // a real canvas server, with this agent set to "propose" in napkin.json
    writeFileSync(join(work, 'napkin.json'), JSON.stringify({ agents: { 'eval-agent': 'propose' } }));
    server = await startServer(dir); ctx.url = server.url; env.NAPKIN_URL = server.url;
  }
  if (t.race) {
    Object.assign(env, { RACE_FILE: join(dir, t.race.file), RACE_FROM: t.race.from, RACE_TO: t.race.to, RACE_FLAG: join(work, 'raced') });
    args = [join(ROOT, 'test', 'agent-eval', 'racer-proxy.js'), join(ROOT, 'src', 'mcp.js')];
  }
  const cfg = join(work, 'mcp.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: { napkin: { command, args, env } } }));
  const t0 = Date.now();
  const r = await runClaude(t.prompt, work, cfg);
  await new Promise((x) => setTimeout(x, 500)); // let the MCP process finish its last write and exit
  let verdict; try { verdict = await t.check(dir, ctx); } catch (e) { verdict = { pass: false, why: `checker error: ${e.message}` }; }
  if (server) await server.stop();
  let meta = {}; try { meta = JSON.parse(r.out); } catch {}
  return { arm, id: t.id, ...verdict, secs: ((Date.now() - t0) / 1000).toFixed(0), cost: meta.total_cost_usd, turns: meta.num_turns, note: verdict.pass ? '' : (meta.result ?? r.err).toString().slice(0, 160).replace(/\s+/g, ' ') };
}

test('agent eval: the guided arm completes >= 80% of the tasks with only the napkin MCP', { skip: !process.env.AGENT_EVAL && 'set AGENT_EVAL=1 to run (spends model budget)', timeout: 7200000 }, async () => {
  const jobs = arms.flatMap((arm) => tasks.map((t) => ({ t, arm })));
  const results = [];
  const worker = async () => { while (jobs.length) { const j = jobs.shift(); results.push(await runTask(j.t, j.arm)); } };
  await Promise.all(Array.from({ length: Number(process.env.EVAL_PARALLEL || 3) }, worker));
  const order = (r) => arms.indexOf(r.arm) * 100 + tasks.findIndex((t) => t.id === r.id);
  results.sort((a, b) => order(a) - order(b));
  const summary = (arm) => { const rs = results.filter((r) => r.arm === arm); return { arm, pass: rs.filter((r) => r.pass).length, n: rs.length, turns: median(rs.map((r) => r.turns)), secs: median(rs.map((r) => Number(r.secs))), cost: rs.reduce((s, r) => s + (r.cost || 0), 0) }; };
  const sums = arms.map(summary);
  const lines = [
    `AGT-07 agent eval, ${tasks.length} tasks per arm (bar: guided >= 80%, i.e. >= ${Math.ceil(0.8 * tasks.length)}/${tasks.length})`,
    `model: ${MODEL}; ONLY the napkin MCP connected (--strict-mcp-config, --tools "", --allowedTools "mcp__napkin__*"); temp copy of fixtures per task`,
    'tasks 1-10: set style, base colour, add variant, create, rename, insert, delete node, add prop, variant override, change override (in-process fallback, no canvas server)',
    'tasks 11-16: multi-step edit, stale retry forced mid-run (hand edit lands after the first read), propose mode (real canvas server, agent set to "propose"), move, bindText, removeVariant',
    'guided arm: guide in MCP instructions + resource + prompt, per-op oneOf edit schemas.  control arm: NAPKIN_NO_GUIDE=1 (no guide, no resource/prompt, bare-object edit schema; tool descriptions unchanged).',
    `run: AGENT_EVAL=1 EVIDENCE=1 node --test test/agent-eval/   (${new Date().toISOString().slice(0, 10)})`,
    '',
    ...sums.map((s) => `${s.arm.padEnd(8)} ${s.pass}/${s.n} passed (${(100 * s.pass / s.n).toFixed(0)}%)  median turns ${s.turns}  median time ${s.secs}s  cost $${s.cost.toFixed(2)}`),
    sums.length > 1 ? `effect of the guide: pass-rate gap ${sums[0].pass - sums[1].pass} task(s); median turns ${sums[0].turns} vs ${sums[1].turns}; median time ${sums[0].secs}s vs ${sums[1].secs}s; cost $${sums[0].cost.toFixed(2)} vs $${sums[1].cost.toFixed(2)} (tool descriptions and schemas in the control arm still teach part of the dialect)` : '',
    '',
    ...results.map((r) => `${r.arm.padEnd(8)} ${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(16)} ${String(r.secs).padStart(4)}s  turns ${r.turns ?? '?'}  $${r.cost?.toFixed?.(3) ?? '?'}${r.pass ? '' : `  | ${r.why} | ${r.note}`}`),
  ];
  console.log(lines.join('\n'));
  evidence('AGT-07', lines.join('\n'));
  const g = sums.find((s) => s.arm === 'guided');
  if (g) assert.ok(g.pass >= Math.ceil(0.8 * g.n), `guided ${g.pass}/${g.n}`);
});
