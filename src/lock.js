// Single-writer lock for a components folder: <dir>/.napkin/lock holds the holder's PID on one line (AGT-08).
// Held by the canvas server or a fallback MCP; never by two live processes. A lock whose process is gone is
// stale. Taking over a stale lock goes through an O_EXCL mutex file (<dir>/.napkin/lock.takeover), so two
// processes that both saw the dead PID cannot both win.
import { explainError } from './errors.js';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

export class LockError extends Error { constructor(message) { super(explainError(message, { next: "stop the named napkin process, or connect to its NAPKIN_URL." })); } }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const pidIn = (file) => { try { return parseInt(readFileSync(file, 'utf8'), 10) || 0; } catch { return 0; } };
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Create `file` containing our PID, all at once: write a private temp file, then hard-link it into place
// (link fails with EEXIST if someone else got there first, and the content is never half-written).
const tryCreate = (file) => {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${process.pid}\n`);
  try { linkSync(tmp, file); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; } finally { try { unlinkSync(tmp); } catch {} }
};

export function acquireLock(dir) {
  const folder = join(dir, '.napkin'), file = join(folder, 'lock'), mutex = join(folder, 'lock.takeover');
  mkdirSync(folder, { recursive: true });
  const held = (pid) => new LockError(`another napkin process (pid ${pid}) is editing ${dir}; stop it, or point your tools at it (NAPKIN_URL) instead of starting a second writer`);
  let got = false;
  for (let attempt = 0; attempt < 200 && !got; attempt++) {
    if (tryCreate(file)) { got = true; break; }
    const pid = pidIn(file);
    if (pid && pid !== process.pid && alive(pid)) throw held(pid);
    if (pid === process.pid) { got = true; break; }
    // The holder is gone (or the file is half-written): take over under the mutex, re-checking inside it.
    if (tryCreate(mutex)) {
      try {
        const again = pidIn(file);
        if (again && alive(again) && again !== process.pid) throw held(again);
        try { unlinkSync(file); } catch {}
        got = tryCreate(file);
      } finally { try { unlinkSync(mutex); } catch {} }
    } else {
      const m = pidIn(mutex);
      if (m && !alive(m)) { try { unlinkSync(mutex); } catch {} } // the previous taker died mid-takeover
      else nap(5 + Math.random() * 10);
    }
  }
  if (!got) throw new LockError(`could not take the lock ${file}`);
  let released = false;
  const release = () => { if (released) return; released = true; try { if (pidIn(file) === process.pid) unlinkSync(file); } catch {} };
  process.on('exit', release);
  return { file, release };
}

// Every server/fallback shares this gate, including external repos that forbid
// sidecar writes. Ordinary projects also keep the documented .napkin/lock.
export function acquireWorkspaceLock(dir, { writeSidecars = true } = {}) {
  dir = resolve(dir);
  const key = createHash('sha256').update(dir).digest('hex');
  let gate, local;
  try {
    gate = acquireLock(join(tmpdir(), 'napkin-directory-locks', key));
    // Honor a legacy/direct acquireLock holder without writing in the repo.
    const pid = pidIn(join(dir, '.napkin', 'lock'));
    if (pid && pid !== process.pid && alive(pid)) throw new LockError(`another napkin process (pid ${pid}) is editing ${dir}. Next: connect to its NAPKIN_URL or stop it.`);
    if (writeSidecars) local = acquireLock(dir);
  } catch (e) {
    gate?.release();
    throw new LockError(explainError(e.message, { file: dir }));
  }
  return { file: local?.file || gate.file, release() { local?.release(); gate.release(); } };
}
