// Start headless Chromium so it can't outlive the node process that started it.
// A killed test runner (timeout, Ctrl+C) used to leave browsers running; a small shell watchdog
// now stops the browser as soon as its owner's pid is gone, and a normal exit kills it directly.
import { spawn } from 'node:child_process';

const WATCH = 'c=; "$@" & c=$!; while kill -0 "$OWNER" 2>/dev/null && kill -0 "$c" 2>/dev/null; do sleep 1; done; kill "$c" 2>/dev/null; wait "$c" 2>/dev/null';
const live = new Set();
process.once('exit', () => { for (const p of live) { try { process.kill(-p.pid); } catch { try { p.kill(); } catch {} } } });

export function spawnChromium(args) {
  const bin = process.env.CHROMIUM || 'chromium';
  const proc = spawn('sh', ['-c', WATCH, 'napkin-chromium', bin, ...args], {
    stdio: 'ignore', detached: true, env: { ...process.env, OWNER: String(process.pid) },
  });
  live.add(proc);
  proc.on('exit', () => live.delete(proc));
  // kill() stops the watchdog's whole process group: the shell and the browser.
  const kill = proc.kill.bind(proc);
  proc.kill = (sig = 'SIGTERM') => { try { process.kill(-proc.pid, sig); return true; } catch { return kill(sig); } };
  return proc;
}
