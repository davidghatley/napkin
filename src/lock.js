// Single-writer lock for a components folder: <dir>/.napkin/lock holds the holder's PID (AGT-08).
// A lock whose process is gone is stale and is taken over. Never held by two live processes.
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export class LockError extends Error {}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export function acquireLock(dir) {
  const folder = join(dir, '.napkin'), file = join(folder, 'lock');
  mkdirSync(folder, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { writeFileSync(file, `${process.pid}\n`, { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = parseInt(readFileSync(file, 'utf8'), 10);
      if (pid && pid !== process.pid && alive(pid)) throw new LockError(`another napkin process (pid ${pid}) is editing ${dir}; start napkin's canvas server and point NAPKIN_URL at it, or stop that process`);
      try { unlinkSync(file); } catch {}
      if (attempt === 2) throw new LockError(`could not take the lock ${file}`);
    }
  }
  let released = false;
  const release = () => { if (released) return; released = true; try { if (parseInt(readFileSync(file, 'utf8'), 10) === process.pid) unlinkSync(file); } catch {} };
  process.on('exit', release);
  return { file, release };
}
