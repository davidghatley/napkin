// One server per folder (REL-02). The lock is <folder>/.napkin/server.lock holding the owner's PID.
// A lock whose PID is dead is stale and is taken over. Add `.napkin/` to .gitignore: it is machine state.
import { mkdirSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic, alive } from './atomic.js';

export class LockError extends Error {
  constructor(message, pid) { super(message); this.pid = pid; }
}

export function acquireLock(dir) {
  const stateDir = join(dir, '.napkin');
  const path = join(stateDir, 'server.lock');
  mkdirSync(stateDir, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      writeAtomic(path, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }) + '\n', { exclusive: true }); // whole or absent, never half a lock
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null;
      try { held = JSON.parse(readFileSync(path, 'utf8')); } catch { /* unreadable: treat as stale */ }
      if (held?.pid && held.pid !== process.pid && alive(held.pid)) {
        throw new LockError(`napkin: this folder is already open in another napkin server (pid ${held.pid}${held.url ? `, ${held.url}` : ''}). Stop it first, or use a different folder. Lock: ${path}`, held.pid);
      }
      try { unlinkSync(path); } catch { /* another process took it over first; loop and look again */ }
    }
  }
  if (!existsSync(path)) throw new LockError(`napkin: could not take the lock ${path}`);
  let released = false;
  const lock = {
    path,
    // Say where the server listens, so the next one can name it.
    update(extra) { writeAtomic(path, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), ...extra }) + '\n'); },
    release() {
      if (released) return; released = true;
      try { if (JSON.parse(readFileSync(path, 'utf8')).pid === process.pid) unlinkSync(path); } catch { /* already gone */ }
    },
  };
  process.on('exit', lock.release);
  return lock;
}
