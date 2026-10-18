// Shared test harness. Every variant must satisfy test/CONTRACT.md; these helpers only use that contract.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE = join(ROOT, 'fixtures', 'Card', 'Card.json');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A temp git repo with the Card fixture committed. Returns the path to its Card.json.
export function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-test-'));
  mkdirSync(join(dir, 'components'));
  const file = join(dir, 'components', 'Card.json');
  copyFileSync(FIXTURE, file);
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('add', 'components/Card.json');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  return { dir, file, git };
}

export async function waitFor(fn, timeout = 3000, step = 10) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) { const v = await fn(); if (v) return { value: v, ms: performance.now() - t0 }; await sleep(step); }
  throw new Error('waitFor timed out');
}

export async function startServer(file) {
  const proc = spawn(process.execPath, [join(ROOT, 'src', 'server.js'), '--file', file, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const url = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start: ' + out)), 5000);
    const on = (d) => { out += d; const m = out.match(/napkin canvas: (http:\/\/127\.0\.0\.1:\d+\/)/); if (m) { clearTimeout(t); res(m[1]); } };
    proc.stdout.on('data', on); proc.stderr.on('data', (d) => (out += d));
    proc.on('exit', (c) => rej(new Error(`server exited ${c}: ${out}`)));
  });
  return { url, proc, output: () => out, stop: () => new Promise((r) => { proc.once('exit', r); proc.kill('SIGTERM'); setTimeout(r, 1000); }) };
}

// Scripted MCP client over stdio: newline-delimited JSON-RPC 2.0.
export async function startMcp(file, napkinUrl) {
  const proc = spawn(process.execPath, [join(ROOT, 'src', 'mcp.js'), '--file', file], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NAPKIN_URL: napkinUrl } });
  let buf = ''; let id = 0; const pending = new Map(); const notifications = []; let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  proc.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) notifications.push({ ...msg, at: performance.now() });
    }
  });
  const request = (method, params) => new Promise((res, rej) => {
    const i = ++id; const t = setTimeout(() => rej(new Error(`mcp ${method} timed out; stderr: ${stderr}`)), 5000);
    pending.set(i, (m) => { clearTimeout(t); res(m); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
  });
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'napkin-test-agent', version: '0' } });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const call = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args });
    if (r.error) throw new Error(r.error.message);
    const text = r.result.content?.[0]?.text ?? '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.result.isError, text, data };
  };
  return { proc, init, request, call, notifications, stderr: () => stderr, stop: () => { proc.stdin.end(); proc.kill('SIGTERM'); } };
}
