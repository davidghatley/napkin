// AGT-07 agent eval. A fresh Claude (Sonnet) with ONLY the napkin MCP connected does ten scripted tasks
// against a temp copy of the fixtures; checkers read the files it leaves. Costs money and takes minutes,
// so it runs only with AGENT_EVAL=1:   AGENT_EVAL=1 EVIDENCE=1 node --test test/agent-eval/
// Optional: EVAL_MODEL (default sonnet), EVAL_ONLY=<task id,...>, EVAL_PARALLEL (default 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, fixture } from '../helpers/harness.js';
import { evidence } from '../helpers/agents.js';
import { TASKS } from './tasks.js';

const MODEL = process.env.EVAL_MODEL || 'sonnet';
const only = process.env.EVAL_ONLY?.split(',');
const tasks = TASKS.filter((t) => !only || only.includes(t.id));

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

async function runTask(t) {
  const work = mkdtempSync(join(tmpdir(), 'napkin-eval-'));
  const dir = join(work, 'components'); mkdirSync(dir);
  for (const n of ['Card', 'Button']) copyFileSync(fixture(n), join(dir, `${n}.tsx`));
  const cfg = join(work, 'mcp.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: { napkin: { command: process.execPath, args: [join(ROOT, 'src', 'mcp.js')], env: { NAPKIN_DIR: dir, NAPKIN_URL: 'http://127.0.0.1:1/', NAPKIN_AGENT: 'eval-agent' } } } }));
  const t0 = Date.now();
  const r = await runClaude(t.prompt, work, cfg);
  await new Promise((x) => setTimeout(x, 300)); // let the MCP process finish its last write and exit
  let verdict; try { verdict = t.check(dir); } catch (e) { verdict = { pass: false, why: `checker error: ${e.message}` }; }
  let meta = {}; try { meta = JSON.parse(r.out); } catch {}
  return { id: t.id, ...verdict, secs: ((Date.now() - t0) / 1000).toFixed(0), cost: meta.total_cost_usd, turns: meta.num_turns, note: verdict.pass ? '' : (meta.result ?? r.err).toString().slice(0, 160).replace(/\s+/g, ' ') };
}

test('agent eval: a fresh agent with only the napkin MCP completes >= 8 of 10 tasks', { skip: !process.env.AGENT_EVAL && 'set AGENT_EVAL=1 to run (spends model budget)', timeout: 3600000 }, async () => {
  const results = []; const queue = [...tasks];
  const worker = async () => { while (queue.length) results.push(await runTask(queue.shift())); };
  await Promise.all(Array.from({ length: Number(process.env.EVAL_PARALLEL || 3) }, worker));
  results.sort((a, b) => tasks.findIndex((t) => t.id === a.id) - tasks.findIndex((t) => t.id === b.id));
  const score = results.filter((r) => r.pass).length;
  const lines = [
    `AGT-07 agent eval: ${score}/${results.length}  (bar >= 8/10)`,
    `model: ${MODEL}; only the napkin MCP connected (--strict-mcp-config, --tools "", --allowedTools "mcp__napkin__*"); NO canvas server (in-process fallback, AGT-08); temp copy of fixtures per task`,
    `run: AGENT_EVAL=1 EVIDENCE=1 node --test test/agent-eval/   (${new Date().toISOString().slice(0, 10)})`,
    ...results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(16)} ${String(r.secs).padStart(4)}s  turns ${r.turns ?? '?'}  $${r.cost?.toFixed?.(3) ?? '?'}${r.pass ? '' : `  | ${r.why} | ${r.note}`}`),
    `total cost: $${results.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2)}`,
  ];
  console.log(lines.join('\n'));
  evidence('AGT-07', lines.join('\n'));
  assert.ok(score >= Math.ceil(0.8 * results.length), `${score}/${results.length}`);
});
