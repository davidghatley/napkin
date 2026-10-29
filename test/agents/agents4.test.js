// WPC-25 (napkin open dies with its terminal), WPC-34 (stale error names exactly the stale keys), WPC-37 (what a stopped project leaves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { tempRepo, startServer, waitFor, sleep, ROOT } from '../helpers/harness.js';
import { http, session } from '../helpers/agents.js';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const project = () => { const r = tempRepo(); writeFileSync(join(r.dir, 'napkin.json'), JSON.stringify({ components: 'components' })); return r; };
// A real `napkin open`, without the test runner's own parent-watch preload, so only napkin's own behaviour can end the server.
async function open(dir) {
  const env = { ...process.env, NODE_OPTIONS: '' };
  const proc = spawn(process.execPath, [join(ROOT, 'src/cli.js'), 'open', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = ''; proc.stdout.on('data', (b) => (out += b)); proc.stderr.on('data', (b) => (out += b));
  const { value: url } = await waitFor(() => { if (proc.exitCode !== null) throw new Error(out); return out.match(/napkin canvas: (http:\/\/127.0.0.1:\d+\/)/)?.[1]; }, 15000);
  const server = Number(spawnSync('pgrep', ['-P', String(proc.pid)], { encoding: 'utf8' }).stdout.trim().split('\n')[0]);
  assert.ok(server > 0, 'found the server child');
  return { proc, url, server, out: () => out };
}
const gone = (...pids) => waitFor(() => pids.every((p) => !alive(p)), 5000, 50);

for (const signal of ['SIGHUP', 'SIGKILL']) {
  test(`WPC-25: ${signal} of the CLI leaves no orphan within 5 s, and the next open is not refused`, { timeout: 60000 }, async () => {
    const r = project();
    const a = await open(r.dir);
    let b;
    try {
      a.proc.kill(signal);
      await gone(a.proc.pid, a.server);
      assert.equal(alive(a.server), false, 'the server did not outlive the CLI');
      b = await open(r.dir); // not "another napkin process"
      assert.match(b.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    } finally { for (const x of [a, b]) { try { if (x?.server && alive(x.server)) process.kill(x.server, 'SIGKILL'); } catch {} try { x?.proc.kill('SIGKILL'); } catch {} } if (b) { b.proc.kill('SIGTERM'); await gone(b.server).catch(() => {}); } }
  });
}

test('WPC-25: a lock left by a dead process does not block the next open', { timeout: 60000 }, async () => {
  const r = project();
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }); // exits at once: its pid is dead
  const pid = Number(dead.stdout.trim()); assert.equal(alive(pid), false);
  for (const folder of [join(r.dir, '.napkin'), join(r.compDir, '.napkin')]) { mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'lock'), `${pid}\n`); }
  const gate = join(tmpdir(), 'napkin-directory-locks', createHash('sha256').update(r.compDir).digest('hex'));
  mkdirSync(join(gate, '.napkin'), { recursive: true }); writeFileSync(join(gate, '.napkin', 'lock'), `${pid}\n`);
  const a = await open(r.dir);
  try { assert.ok(a.url); } finally { a.proc.kill('SIGTERM'); await gone(a.server); }
});

test('WPC-34: the stale error names exactly the keys in its stale list', async () => {
  const { compDir } = tempRepo(['Button']);
  const server = await startServer(compDir);
  try {
    const t = await session(server.url, 'scout'), u = await session(server.url, 'other');
    const base = (await http(server.url, '/api/components/Button')).json.revision;
    const set = (path, value) => ({ op: 'set', path, value });
    const first = await http(server.url, '/api/components/Button/edits', { method: 'POST', token: u, body: { baseRevision: base, edits: [set('root.borderRadius', 9)] } });
    assert.equal(first.json.ok, true, JSON.stringify(first.json));
    const r = await http(server.url, '/api/components/Button/edits', { method: 'POST', token: t, body: { baseRevision: base, edits: [set('root.borderRadius', 3), set('root.gap', 20)] } });
    assert.equal(r.status, 409); assert.deepEqual(r.json.stale.map((s) => s.key), ['root.borderRadius']);
    const named = r.json.error.match(/^stale revision: (.*?) changed in revision/)?.[1];
    assert.equal(named, 'root.borderRadius', r.json.error);
    assert.doesNotMatch(r.json.error, /gap/);
  } finally { await server.stop(); }
});

const left = (dir) => { const out = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p.slice(dir.length + 1)); if (e.isDirectory() && !readdirSync(p).length) out.push(p.slice(dir.length + 1) + '/'); } }; try { walk(join(dir, '.napkin')); } catch { /* none */ } return out.sort(); };
test('WPC-37: a stopped project keeps no empty guard/ folder, temp files or lone .gitignore; pending proposals (and their .gitignore) stay', async () => {
  const r = project();
  let s = await startServer(r.compDir);
  const scout = await session(s.url, 'david'), claude = await session(s.url, 'claude');
  const base = async () => (await http(s.url, '/api/components/Button')).json.revision;
  const ok = await http(s.url, '/api/components/Button/edits', { method: 'POST', token: scout, body: { baseRevision: await base(), edits: [{ op: 'set', path: 'root.gap', value: 11 }] } });
  assert.equal(ok.json.ok, true, JSON.stringify(ok.json)); // a guarded write: it makes .napkin/guard
  await s.stop();
  assert.deepEqual(left(r.dir).concat(left(r.compDir)), [], 'nothing of napkin is left after a plain stop');
  // a pending proposal must still survive a restart (WPC-20): exactly its file and the .gitignore that hides it remain
  s = await startServer(r.compDir);
  const claudeT = await session(s.url, 'claude');
  void claude;
  const pr = await http(s.url, '/api/components/Button/edits', { method: 'POST', token: claudeT, body: { baseRevision: await base(), edits: [{ op: 'set', path: 'root.gap', value: 13 }], propose: true } });
  assert.equal(pr.json.proposed, true, JSON.stringify(pr.json));
  await sleep(200); await s.stop();
  assert.deepEqual(left(r.dir).concat(left(r.compDir)).map((f) => f.replace(/^.*\.napkin/, '.napkin')).sort(), ['.napkin/.gitignore', '.napkin/proposals.json'].sort());
  s = await startServer(r.compDir);
  try { assert.equal((await http(s.url, '/api/proposals')).json.length, 1, 'it survived the restart'); } finally { await s.stop(); }
});
