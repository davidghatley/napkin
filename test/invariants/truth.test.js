// INV-01 (files are the truth) and REL-01 (kill -9 never leaves a partial file).
//   INV-01: a child process applies random edits as fast as it can; the parent kills it with SIGKILL at a random moment;
//           then a fresh store opens the folder. The model must equal a fresh read of the disk, the file must parse, and the
//           disk must hold exactly the file the child had committed or was in the middle of writing (old or new, never a mix).
//           TRIALS=100 for the full bar (default 12); output for the full run is in docs/evidence/INV-01.txt.
//   REL-01: a child rewrites a multi-megabyte file in a loop with writeAtomic; killed at random moments, the file is always
//           payload A or payload B exactly. A control that truncates and writes in place does tear, which shows the check can fail.
//           REL=200 for the full bar (default 20); output in docs/evidence/REL-01.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, revisionOf } from '../../src/store.js';
import { readComponent } from '../../src/tsx/read.js';
import { ROOT, fixture, sleep } from '../helpers/harness.js';
import { payload } from '../helpers/payload.js';
import { rng } from '../helpers/fuzz.js';
// kill timings come from a seeded generator (SEED=n to vary); the operating system's scheduling is still its own

const sha16 = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const shaFull = (t) => createHash('sha256').update(t).digest('hex');

// Starts a helper script, waits for "ready", lets it run for `ms`, kills it with SIGKILL, and resolves its output.
// With `selfKill` ({ at, phase }) the child kills itself at that step of the write protocol instead (test/helpers/kill-points.mjs).
async function runAndKill(script, args, ms, selfKill) {
  const execArgv = selfKill ? ['--import', join(ROOT, 'test', 'helpers', 'kill-points.mjs')] : [];
  const env = selfKill ? { ...process.env, KILL_AT: String(selfKill.at), KILL_PHASE: selfKill.phase } : process.env;
  const proc = spawn(process.execPath, [...execArgv, join(ROOT, 'test', 'helpers', script), ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '', err = '';
  proc.stdout.on('data', (d) => (out += d)); proc.stderr.on('data', (d) => (err += d));
  const closed = new Promise((r) => proc.on('close', r));
  if (selfKill) { setTimeout(() => proc.kill('SIGKILL'), 8000).unref(); await closed; return { out, err }; }
  const t0 = Date.now();
  while (!out.includes('ready') && Date.now() - t0 < 8000) { if (proc.exitCode !== null) break; await sleep(2); }
  assert.ok(out.includes('ready'), `${script} did not start: ${err}`);
  await sleep(ms);
  proc.kill('SIGKILL');
  await closed;
  return { out, err };
}

const TRIALS = Number(process.env.TRIALS || 12);
const rand = rng(Number(process.env.SEED || 1));
test(`INV-01: ${TRIALS} random SIGKILLs during edits; after restart the model is exactly what is on disk`, async () => {
  let wasOld = 0, wasNew = 0, leftovers = 0, edits = 0;
  for (let i = 0; i < TRIALS; i++) {
    const dir = mkdtempSync(join(tmpdir(), 'napkin-kill-'));
    const file = join(dir, 'Button.tsx');
    writeFileSync(file, readFileSync(fixture('Button'), 'utf8'));
    // even trials: killed from outside at a random moment; odd trials: the child kills itself at a random step of the write protocol
    const selfKill = i % 2 ? { at: 1 + Math.floor(rand() * 60), phase: rand() < 0.5 ? 'before' : 'after' } : undefined;
    const { out } = await runAndKill('edit-loop.mjs', [file, String(1000 + i)], Math.floor(rand() * 200), selfKill);
    const lines = out.trim().split('\n').filter(Boolean);
    const lastC = [...lines].reverse().find((l) => l.startsWith('C '))?.slice(2) ?? sha16(readFileSync(fixture('Button'), 'utf8'));
    const lastP = [...lines].reverse().find((l) => l.startsWith('P '))?.slice(2);
    edits += Math.max(0, lines.filter((l) => l.startsWith('C ')).length - 1);
    const tmp = readdirSync(dir).filter((n) => n.includes('.tmp-'));
    if (tmp.length) leftovers++;
    const disk = readFileSync(file, 'utf8');
    // old or new, never a mix
    assert.ok([lastC, lastP].includes(sha16(disk)), `trial ${i}: disk is neither the last committed file nor the one being written`);
    if (sha16(disk) === lastC) wasOld++; else wasNew++;
    // restart: the model equals the disk
    const store = await openStore(file);
    try {
      const r = await store.read();
      assert.equal(r.readOnly, undefined, `trial ${i}: reopened read-only: ${r.readOnly}`);
      assert.equal(r.problem, undefined);
      assert.equal(r.source, disk, `trial ${i}: source differs from disk`);
      const { id, ...model } = r.doc;
      assert.deepEqual(model, readComponent(disk).doc, `trial ${i}: model differs from a fresh read of the disk`);
      assert.equal(r.revision, revisionOf(disk));
      assert.deepEqual(readdirSync(dir).filter((n) => n.includes('.tmp-')), [], `trial ${i}: stale temp files were cleaned on open`);
    } finally { await store.close(); }
  }
  console.log(`INV-01: ${TRIALS}/${TRIALS} kill points ok (${edits} committed edits seen; ${Math.floor(TRIALS / 2)} killed by the parent at random times, ${Math.ceil(TRIALS / 2)} killed at a random step of the write protocol; disk held the last committed file ${wasOld}x and the file being written ${wasNew}x; ${leftovers} kills left a temp file behind = killed mid-write)`);
});

const REL = Number(process.env.REL || 10);
test(`REL-01: ${REL} kill -9 trials during atomic writes: the file is whole every time (control: in-place writes tear)`, async () => {
  const KB = 3000;
  const whole = new Set([shaFull(payload('A', KB)), shaFull(payload('B', KB))]);
  const dir = mkdtempSync(join(tmpdir(), 'napkin-atomic-'));
  const file = join(dir, 'big.txt');
  let leftover = 0, a = 0, b = 0;
  for (let i = 0; i < REL; i++) {
    writeFileSync(file, payload('A', KB));
    await runAndKill('atomic-loop.mjs', [file, 'atomic', String(KB)], Math.floor(rand() * 60));
    const h = shaFull(readFileSync(file, 'utf8'));
    assert.ok(whole.has(h), `trial ${i}: the file is neither payload A nor payload B`);
    if (h === shaFull(payload('A', KB))) a++; else b++;
    for (const n of readdirSync(dir)) if (n.includes('.tmp-')) { leftover++; }
    for (const n of readdirSync(dir)) if (n.includes('.tmp-')) await import('node:fs').then((fs) => fs.unlinkSync(join(dir, n)));
  }
  // control
  let torn = 0;
  const CTRL = Math.min(REL, 20);
  for (let i = 0; i < CTRL; i++) {
    writeFileSync(file, payload('A', KB));
    await runAndKill('atomic-loop.mjs', [file, 'naive', String(KB)], Math.floor(rand() * 60));
    if (!whole.has(shaFull(readFileSync(file, 'utf8')))) torn++;
  }
  console.log(`REL-01: ${REL}/${REL} atomic trials whole (A ${a}, B ${b}; ${leftover} left a temp file); control (truncate+write in place): ${torn}/${CTRL} torn`);
  assert.ok(torn > 0, 'the control should tear at least once, or this test could not tell a torn file from a whole one');
});
