// Whole-file writes (REL-01). The bytes go to a temp file in the same folder, are flushed to disk,
// and only then renamed over the target, so a kill -9 at any moment leaves the old file or the new
// one, never half of one. Nothing else in napkin writes a component or sidecar any other way.
import { openSync, writeSync, fsyncSync, closeSync, renameSync, linkSync, unlinkSync, statSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

let counter = 0;
export const tmpName = (file) => join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${counter++}`);

function fsyncDir(dir) {
  try { const fd = openSync(dir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* not every filesystem allows it */ }
}

// writeAtomic(file, text)                 replace (or create) the file
// writeAtomic(file, text, { exclusive })  create only; throws EEXIST when the file is already there
export function writeAtomic(file, data, { exclusive = false } = {}) {
  const tmp = tmpName(file);
  let mode = 0o644;
  try { mode = statSync(file).mode & 0o777; } catch { /* new file */ }
  const buf = Buffer.from(data);
  try {
    const fd = openSync(tmp, 'wx', mode);
    try {
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    if (exclusive) linkSync(tmp, file); // fails with EEXIST instead of replacing
    else renameSync(tmp, file);
  } finally {
    if (exclusive) { try { unlinkSync(tmp); } catch { /* already gone */ } }
    else { try { unlinkSync(tmp); } catch { /* renamed away: the normal case */ } }
  }
  fsyncDir(dirname(file));
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export { alive };

// Temp files left behind by a writer that was killed. Only those of dead processes are removed.
export function cleanStaleTmp(file) {
  const prefixes = [`.${basename(file)}.tmp-`, `.${basename(file).replace(/\.tsx$/, '.napkin.json')}.tmp-`]; // the component and its sidecar
  let names; try { names = readdirSync(dirname(file)); } catch { return; }
  for (const n of names) {
    const prefix = prefixes.find((x) => n.startsWith(x));
    if (!prefix) continue;
    const pid = Number(n.slice(prefix.length).split('-')[0]);
    if (pid !== process.pid && !alive(pid)) { try { unlinkSync(join(dirname(file), n)); } catch { /* raced with another cleaner */ } }
  }
}
