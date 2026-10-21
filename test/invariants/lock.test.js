// REL-02: a second server on the same folder refuses to start and names the first one's PID. A lock left behind by a
// process that is gone is taken over. A different folder is not affected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
    assert.match(second.output, new RegExp(`already open in another napkin server \\(pid ${first.proc.pid}`));
    assert.match(second.output, /http:\/\/127\.0\.0\.1:\d+/, 'and says where it is');
    assert.doesNotMatch(second.output, /napkin canvas:/, 'it did not start');
    // the first one is untouched
    assert.equal((await (await fetch(new URL('api/components', first.url))).json()).length, 1);
    // a different folder starts fine at the same time
    const other = tempRepo(['Button']);
    const third = await startServer(other.compDir);
    await third.stop();
  } finally { await first.stop(); }
  assert.equal(existsSync(join(compDir, '.napkin', 'server.lock')), false, 'a clean stop removes the lock');
});

test('REL-02: a lock left by a dead process (kill -9) is taken over', async () => {
  const { compDir } = tempRepo(['Card']);
  const first = await startServer(compDir);
  const dead = first.proc.pid;
  first.proc.kill('SIGKILL');
  await new Promise((r) => first.proc.once('exit', r));
  assert.equal(JSON.parse(readFileSync(join(compDir, '.napkin', 'server.lock'), 'utf8')).pid, dead, 'the stale lock is still there');
  const next = await startServer(compDir);
  try {
    assert.equal(JSON.parse(readFileSync(join(compDir, '.napkin', 'server.lock'), 'utf8')).pid, next.proc.pid);
  } finally { await next.stop(); }
});

test('REL-02: an unreadable lock file counts as stale; a lock with a live PID that is not napkin still blocks', async () => {
  const { compDir } = tempRepo(['Card']);
  mkdirSync(join(compDir, '.napkin'), { recursive: true });
  writeFileSync(join(compDir, '.napkin', 'server.lock'), '{ not json');
  const a = await startServer(compDir);
  await a.stop();
  writeFileSync(join(compDir, '.napkin', 'server.lock'), JSON.stringify({ pid: process.pid }));
  const b = await runServer(compDir);
  assert.equal(b.code, 1);
  assert.match(b.output, new RegExp(`pid ${process.pid}`));
  void sleep;
});
