// Preload for the kill tests (node --import this-file). With KILL_AT=n it counts the file-writing calls of the commit
// protocol (open, write, fsync, close, rename, link) and sends SIGKILL to its own process at the n-th one, before it
// runs (KILL_PHASE=before) or right after it (after). That puts a kill at every step of "temp file, flush, rename".
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const at = Number(process.env.KILL_AT || 0);
const phase = process.env.KILL_PHASE || 'before';
let n = 0;
for (const name of ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'linkSync']) {
  const orig = fs[name];
  fs[name] = function (...args) {
    n++;
    if (at && n === at && phase === 'before') process.kill(process.pid, 'SIGKILL');
    const r = orig.apply(this, args);
    if (at && n === at && phase === 'after') process.kill(process.pid, 'SIGKILL');
    return r;
  };
}
syncBuiltinESMExports();
