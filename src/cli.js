#!/usr/bin/env node
import { explainError } from './errors.js';
// The checkout's local command; never installs or publishes anything.
import { existsSync, statSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createComponent, createProjectConfig } from './commit.js';
import { newComponentSource } from './tsx/write.js';
import { starterSource } from './adopt.js';
import { SERVER_FLAGS } from './node-flags.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function connection(url) {
  return `Canvas: ${url}\nPaste into .mcp.json for Claude Code:\n${JSON.stringify({ mcpServers: { napkin: { command: 'node', args: [join(ROOT, 'src/mcp.js')], env: { NAPKIN_URL: url, NAPKIN_AGENT: 'claude' } } } }, null, 2)}`;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: 'string', default: '4810' }, 'write-sidecars': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command, folder = '.', ...extra] = positionals;
  if (values.help || !command) { console.log('Usage: node src/cli.js init [dir]\n       node src/cli.js open [dir] [--port 4810] [--write-sidecars]\nRun these commands from this checkout.'); return; }
  if (!['init', 'open'].includes(command) || extra.length) throw new Error(`unknown command ${positionals.join(' ')}. Next: run node src/cli.js --help.`);
  const dir = resolve(folder);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`port ${values.port} is invalid. Next: use --port 4810 or --port 0.`);
  if (command === 'init') {
    if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty. Next: choose an empty folder for node src/cli.js init, or use node src/cli.js open ${JSON.stringify(dir)}.`);
    mkdirSync(join(dir, 'components'), { recursive: true });
    createComponent(join(dir, 'components/Welcome.tsx'), starterSource('Welcome'));
    createProjectConfig(join(dir, 'napkin.json'), JSON.stringify({ components: 'components' }, null, 2) + '\n');
    console.log(`Created ${dir}/napkin.json and components/Welcome.tsx.\nNext: run node src/cli.js open ${JSON.stringify(dir)} to start.`);
    return;
  }
  if (!existsSync(dir)) throw new Error(`folder ${dir} does not exist. Next: choose a repository folder or run node src/cli.js init ${JSON.stringify(dir)}.`);
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is a file. Next: choose a repository folder for node src/cli.js open.`);
  let components = dir, external = !existsSync(join(dir, 'napkin.json'));
  if (!external) {
    let config; try { config = JSON.parse(readFileSync(join(dir, 'napkin.json'), 'utf8')); } catch (e) { throw new Error(`${dir}/napkin.json: ${e.message}. Next: fix its JSON and run node src/cli.js open again.`); }
    if (config.components !== undefined && typeof config.components !== 'string') throw new Error(`${dir}/napkin.json: components must be a folder path string. Next: set components to \"components\" and retry.`);
    components = resolve(dir, config.components || 'components');
    if (!existsSync(components)) throw new Error(`${components} does not exist (napkin.json). Next: create the components folder or correct the components path.`);
  }
  // Decision 0013: napkin writes nothing into the folder except the edits you make, napkin.json or not. Sidecars are
  // written only when asked for (--write-sidecars).
  const sidecars = !!values['write-sidecars'];
  if (!sidecars) console.log('Opening without sidecar writes. Frame positions stay in this session; component edits and accepted adoptions still write the selected TSX file.');
  const args = [...SERVER_FLAGS, join(ROOT, 'src/server.js'), '--dir', components, '--root', dir, '--port', String(port), '--recursive', '--next-port', '--stream', '--watch-parent', String(process.pid), ...(!sidecars ? ['--no-sidecars'] : [])];
  const child = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'inherit'] });
  let printed = false, buffer = '';
  child.stdout.on('data', (b) => {
    buffer += b;
    const url = buffer.match(/napkin canvas: (http:\/\/127.0.0.1:\d+\/)/)?.[1];
    if (url && !printed) { printed = true; process.stdout.write(String(b) + connection(url) + '\n'); }
    else process.stdout.write(b);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => { process.exitCode = code || 0; });
}

main().catch((e) => { console.error(`napkin: ${explainError(e.message, { next: 'run node src/cli.js --help, correct the path or option, and retry.' })}`); process.exitCode = 1; });
