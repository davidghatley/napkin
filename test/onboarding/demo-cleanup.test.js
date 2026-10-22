import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, waitFor } from '../helpers/harness.js';

for (const exit of ['SIGINT', 'SIGTERM', 'normal']) test(`WPC-17: disposable demo removes its own folder on ${exit}`, async () => {
  // Do not inherit test/helpers/cleanup.js: it used to hide the product leak.
  // For normal exit, schedule process.exit after the actual server announces
  // readiness. No signals and no test-only API in the product are needed.
  const preload = `const write = process.stdout.write.bind(process.stdout); process.stdout.write = (s, ...args) => { const r = write(s, ...args); if (String(s).includes('napkin canvas:')) setTimeout(() => process.exit(0), 200); return r; };`;
  const args = exit === 'normal' ? ['--import', 'data:text/javascript,' + encodeURIComponent(preload)] : [];
  const proc = spawn(process.execPath, [...args, join(ROOT, 'src/server.js'), '--port', '0'], { env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout.on('data', b => output += b); proc.stderr.on('data', b => output += b);
  try {
    await waitFor(() => { if (proc.exitCode !== null) throw new Error(output); return output.includes('napkin canvas:'); }, 15000);
    const dir = output.match(/temp copy of fixtures\/ in (.+)/)?.[1];
    assert.ok(dir, output);
    assert.ok(existsSync(join(dir, 'Button.tsx')));
    if (exit !== 'normal') proc.kill(exit);
    await waitFor(() => proc.exitCode !== null, 10000);
    assert.equal(proc.exitCode, 0, output);
    assert.equal(existsSync(dir), false, `${dir} leaked`);
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await waitFor(() => proc.exitCode !== null, 10000); }
  }
});
