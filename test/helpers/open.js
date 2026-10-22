import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, fixture, waitFor } from './harness.js';

export const simple = `export function Greeting() { return <button style={{ padding: '8px 16px', color: 'navy' }}>Hello</button>; }\n`;
export function corpus() {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-open-'));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'Greeting.tsx'), simple);
  writeFileSync(join(dir, 'Button.tsx'), readFileSync(fixture('Button')));
  writeFileSync(join(dir, 'Missing.tsx'), `import { Thing } from './absent'; export default function Missing() { return <Thing />; }`);
  for (const name of ['node_modules', 'dist', 'build', '.git']) {
    mkdirSync(join(dir, name)); writeFileSync(join(dir, name, 'skip.tsx'), 'skip');
  }
  return dir;
}
// Proposals of a folder napkin merely opened live in napkin's own state dir, never in the repo: point it at a temp dir for every test.
process.env.NAPKIN_STATE_DIR ??= mkdtempSync(join(tmpdir(), 'napkin-state-'));
// { ignorePrivate }: for a folder that is a napkin project (has a napkin.json), whose pending proposals are kept in its private .napkin folder.
const PRIVATE_PROPOSALS = new Set(['.napkin/proposals.json', '.napkin/.gitignore']);
export function hashes(dir, { ignorePrivate = false } = {}) {
  const out = {};
  function walk(d) { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (!(ignorePrivate && PRIVATE_PROPOSALS.has(relative(dir, p)))) out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex'); } }
  walk(dir); return out;
}
export async function cli(dir, extra = [], env = {}) {
  const proc = spawn(process.execPath, [join(ROOT, 'src/cli.js'), 'open', dir, '--port', '0', ...extra], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let output = ''; proc.stdout.on('data', (b) => output += b); proc.stderr.on('data', (b) => output += b);
  try {
    const { value: url } = await waitFor(() => { if (proc.exitCode !== null) throw new Error(output); return output.match(/napkin canvas: (http:\/\/127.0.0.1:\d+\/)/)?.[1]; }, 15000);
    return { proc, url, output: () => output, stop: async () => { proc.kill('SIGTERM'); await waitFor(() => proc.exitCode !== null, 5000); } };
  } catch (e) { proc.kill('SIGTERM'); throw e; }
}
