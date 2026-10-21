// A stdio proxy in front of src/mcp.js for the "stale retry" eval task. After the agent's first read_component
// result goes out, it makes a hand edit to the file (RACE_FROM -> RACE_TO), as if a person had edited it, and
// writes RACE_FLAG. The agent's later edit on the old revision is then stale and must be retried.
// Test tooling only: nothing in src/ knows about it.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [mcpPath] = process.argv.slice(2);
const { RACE_FILE, RACE_FROM, RACE_TO, RACE_FLAG } = process.env;
const child = spawn(process.execPath, [mcpPath], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
const names = new Map(); let raced = false;
createInterface({ input: process.stdin }).on('line', (line) => {
  try { const m = JSON.parse(line); if (m.method === 'tools/call') names.set(m.id, m.params?.name); } catch {}
  child.stdin.write(line + '\n');
}).on('close', () => child.stdin.end());
createInterface({ input: child.stdout }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return process.stdout.write(line + '\n'); }
  if (!raced && m.id !== undefined && names.get(m.id) === 'read_component' && !m.result?.isError) {
    raced = true;
    writeFileSync(RACE_FILE, readFileSync(RACE_FILE, 'utf8').replace(RACE_FROM, RACE_TO));
    writeFileSync(RACE_FLAG, 'raced\n');
    setTimeout(() => process.stdout.write(line + '\n'), 400); // let the MCP's file watcher see the edit first
  } else process.stdout.write(line + '\n');
});
child.on('exit', () => process.exit(0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
