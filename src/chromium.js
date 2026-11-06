// Start headless Chromium so it can't outlive the node process that started it.
// A killed test runner (timeout, Ctrl+C) used to leave browsers running; a small shell watchdog
// now stops the browser as soon as its owner's pid is gone, and a normal exit kills it directly.
import { spawn } from 'node:child_process';

// When the owner dies first, the watchdog also removes the browser profile (about 150 MB on /tmp).
const WATCH = 'c=; "$@" & c=$!; while kill -0 "$OWNER" 2>/dev/null && kill -0 "$c" 2>/dev/null; do sleep 1; done; kill "$c" 2>/dev/null; wait "$c" 2>/dev/null; if ! kill -0 "$OWNER" 2>/dev/null && [ -n "$PROFILE" ]; then case "$PROFILE" in /tmp/napkin-*|"${TMPDIR:-/tmp}"/napkin-*) rm -rf "$PROFILE";; esac; fi';
const live = new Set();
process.once('exit', () => { for (const p of live) { try { process.kill(-p.pid); } catch { try { p.kill(); } catch {} } } });

export function spawnChromium(args) {
  const bin = process.env.CHROMIUM || 'chromium';
  const proc = spawn('sh', ['-c', WATCH, 'napkin-chromium', bin, ...args], {
    stdio: 'ignore', detached: true,
    env: { ...process.env, OWNER: String(process.pid), PROFILE: (args.find((a) => a.startsWith('--user-data-dir=')) || '').slice(16) },
  });
  live.add(proc);
  proc.on('exit', () => live.delete(proc));
  // kill() stops the watchdog's whole process group: the shell and the browser.
  const kill = proc.kill.bind(proc);
  proc.kill = (sig = 'SIGTERM') => { try { process.kill(-proc.pid, sig); return true; } catch { return kill(sig); } };
  return proc;
}
