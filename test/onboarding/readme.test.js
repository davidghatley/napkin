import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { ROOT, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { readComponent } from '../../src/tsx/read.js';

test('ONB-01/05: README quickstart runs in a clean clone; npm ci to first render within 60s', { timeout: 60000 }, async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'napkin-readme-')), clone = join(parent, 'checkout');
  let proc, browser;
  try {
    execFileSync('git', ['clone', '--quiet', '--local', '--no-hardlinks', ROOT, clone]);
    // The lead has not committed this lane yet. Overlay only the reviewable project
    // files so this test verifies the actual working tree, never stale HEAD code.
    for (const name of ['src', 'public', 'README.md', 'package.json', 'package-lock.json']) cpSync(join(ROOT, name), join(clone, name), { recursive: true });
    const readme = readFileSync(join(clone, 'README.md'), 'utf8');
    const block = readme.match(/<!-- quickstart:start -->\s*```sh\n([\s\S]*?)```\s*<!-- quickstart:end -->/);
    assert.ok(block, 'README needs an extractable quickstart command block');
    const commands = block[1].trim().split('\n').filter((s) => s.trim() && !s.startsWith('#'));
    assert.equal(commands.length, 3);
    const started = performance.now();
    for (const command of commands.slice(0, -1)) execFileSync('bash', ['-eu', '-c', command], { cwd: clone, stdio: 'pipe', timeout: 45000 });
    assert.equal(readComponent(readFileSync(join(clone, 'my-napkin/components/Welcome.tsx'), 'utf8')).doc.name, 'Welcome');
    assert.equal(JSON.parse(readFileSync(join(clone, 'package.json'))).bin.napkin, 'src/cli.js');
    // The checkout bin also resolves without fetching a published package.
    const npx = execFileSync('npx', ['--no-install', 'napkin', '--help'], { cwd: clone, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(parent, 'npm-cache') } });
    assert.match(npx, /Usage: napkin/);
    // Substitute only the test's random port. No other README command is changed.
    proc = spawn('bash', ['-eu', '-c', 'exec ' + commands.at(-1) + ' --port 0'], { cwd: clone, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; proc.stdout.on('data', (b) => output += b); proc.stderr.on('data', (b) => output += b);
    const { value: url } = await waitFor(() => { if (proc.exitCode !== null) throw new Error(output); return output.includes('NAPKIN_AGENT') && output.match(/napkin canvas: (http:\/\/127.0.0.1:\d+\/)/)?.[1]; }, 15000);
    const snippet = output.match(/Paste into .mcp.json for Claude Code:\n(\{[\s\S]*?\n\})/);
    const mcp = JSON.parse(snippet[1]).mcpServers.napkin;
    assert.equal(mcp.command, 'node'); assert.equal(mcp.args[0], join(clone, 'src/mcp.js')); assert.equal(mcp.env.NAPKIN_URL, url); assert.equal(mcp.env.NAPKIN_AGENT, 'claude');
    browser = await launchChromium(); await browser.goto(url); await browser.waitFor('document.body.dataset.ready === "1" && !!document.querySelector(".mount [data-n]")');
    assert.equal(await browser.eval('document.querySelectorAll(".cell").length'), 3);
    assert.match(await browser.eval('document.querySelector(".mount").textContent'), /Make something/);
    const ms = performance.now() - started;
    assert.ok(ms <= 60000, `first render ${ms}ms`); t.diagnostic(`npm ci → first render: ${ms.toFixed(0)}ms; npx resolved locally; snippet parsed`);
    if (process.env.EVIDENCE) { mkdirSync(join(ROOT, 'docs/evidence'), { recursive: true }); writeFileSync(join(ROOT, 'docs/evidence/ONB-01-05.txt'), `Command: EVIDENCE=1 node --test test/onboarding/readme.test.js\nREADME commands: ${JSON.stringify(commands)}\nnpm ci to first render: ${ms.toFixed(0)} ms\nLocal npx command and absolute MCP snippet validated.\n`); }
  } finally {
    if (browser) await browser.close();
    if (proc) { proc.kill('SIGTERM'); await waitFor(() => proc.exitCode !== null, 5000).catch(() => {}); }
    rmSync(parent, { recursive: true, force: true });
  }
});

test('ONB-01: occupied requested port falls forward; init refuses existing files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-init-'));
  const busy = createServer(); await new Promise((r) => busy.listen(0, '127.0.0.1', r));
  let proc;
  try {
    const init = execFileSync(process.execPath, [join(ROOT, 'src/cli.js'), 'init', dir], { encoding: 'utf8' });
    assert.match(init, /run napkin open .* to start/);
    assert.doesNotMatch(init, /Canvas:|\.mcp\.json|NAPKIN_AGENT/);
    assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'src/cli.js'), 'init', dir], { stdio: 'pipe' }), /not empty/);
    const port = busy.address().port;
    proc = spawn(process.execPath, [join(ROOT, 'src/cli.js'), 'open', dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; proc.stdout.on('data', (b) => out += b); proc.stderr.on('data', (b) => out += b);
    await waitFor(() => out.includes('NAPKIN_AGENT') && out.match(/napkin canvas:/), 15000);
    assert.equal((init + out).match(/Paste into \.mcp\.json/g)?.length, 1);
    const used = Number(out.match(/napkin canvas: http:\/\/127.0.0.1:(\d+)/)[1]); assert.ok(used > port);
  } finally { busy.close(); if (proc) { proc.kill('SIGTERM'); await waitFor(() => proc.exitCode !== null, 5000); } rmSync(dir, { recursive: true, force: true }); }
});
