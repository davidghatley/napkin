// REL-02: a second server on the same folder refuses to start and names the first one's PID. A lock left behind by a
// process that is gone is taken over. A different folder is not affected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
// The lock file's name is an implementation detail (this branch: .napkin/server.lock; the agents lane: .napkin/lock).
// Tests find it by looking in .napkin/ for a file with "lock" in its name.
import { readdirSync } from 'node:fs';
const lockPath = (dir) => join(dir, '.napkin', readdirSync(join(dir, '.napkin')).filter((n) => /lock/.test(n)).sort((a, b) => a.length - b.length)[0] ?? 'lock');
import { ROOT, tempRepo, startServer, sleep } from '../helpers/harness.js';

// Runs a second server to its end (it should exit by itself); resolves { code, output }.
function runServer(dir) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, 'src', 'server.js'), '--dir', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    p.stdout.on('data', (d) => (output += d)); p.stderr.on('data', (d) => (output += d));
    const t = setTimeout(() => { p.kill('SIGKILL'); }, 6000);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, output }); });
  });
}

test('REL-02: a second server on the same folder refuses to start and names the PID', async () => {
  const { compDir } = tempRepo(['Card']);
  const first = await startServer(compDir);
  try {
    const second = await runServer(compDir);
    assert.equal(second.code, 1);
    assert.match(second.output, new RegExp(`another napkin process \\(pid ${first.proc.pid}\\) is editing`));
    assert.doesNotMatch(second.output, /napkin canvas:/, 'it did not start');
    // the first one is untouched
    assert.equal((await (await fetch(new URL('api/components', first.url))).json()).length, 1);
    // a different folder starts fine at the same time
    const other = tempRepo(['Button']);
    const third = await startServer(other.compDir);
    await third.stop();
  } finally { await first.stop(); }
  assert.equal((existsSync(join(compDir, '.napkin')) ? readdirSync(join(compDir, '.napkin')) : []).filter((n) => /lock/.test(n)).length, 0, 'a clean stop removes the lock (and, WPC-37, the then-empty .napkin folder)');
});

test('REL-02: a lock left by a dead process (kill -9) is taken over', async () => {
  const { compDir } = tempRepo(['Card']);
  const first = await startServer(compDir);
  const dead = first.proc.pid;
  first.proc.kill('SIGKILL');
  await new Promise((r) => first.proc.once('exit', r));
  assert.equal(parseInt(readFileSync(lockPath(compDir), 'utf8'), 10), dead, 'the stale lock is still there');
  const next = await startServer(compDir);
  try {
    assert.equal(parseInt(readFileSync(lockPath(compDir), 'utf8'), 10), next.proc.pid);
  } finally { await next.stop(); }
});

test('REL-02: an unreadable lock file counts as stale; a lock naming any live PID still blocks', async () => {
  const { compDir } = tempRepo(['Card']);
  mkdirSync(join(compDir, '.napkin'), { recursive: true });
  const probe = await startServer(compDir); const lp = lockPath(compDir); probe.proc.kill('SIGKILL'); await new Promise((r) => probe.proc.once('exit', r));
  writeFileSync(lp, '{ not json');
  const a = await startServer(compDir);
  await a.stop();
  mkdirSync(join(compDir, '.napkin'), { recursive: true }); // WPC-37: a clean stop removes the then-empty folder
  writeFileSync(lp, `${process.pid}\n`);
  const b = await runServer(compDir);
  assert.equal(b.code, 1);
  assert.match(b.output, new RegExp(`pid ${process.pid}`));
  void sleep;
});
