// Write a file so a kill at any moment leaves either the old or the new content, never a truncated one:
// temp file in the same folder, fsync, rename over the target. (Same name and signature as the files lane's module.)
import { openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function writeFileAtomic(path, text) {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}
