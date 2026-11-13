// Whole-file writes (REL-01). The bytes go to a temp file in the same folder, are flushed to disk,
// and only then renamed over the target, so a kill -9 at any moment leaves the old file or the new
// one, never half of one. Nothing else in napkin writes a component or sidecar any other way.
import { rmdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync, linkSync, unlinkSync, statSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
// Private lock and edit-guard files ignore themselves without changing the root .gitignore.
export function privateDir(dir) {
  const folder = join(dir, '.napkin');
  mkdirSync(folder, { recursive: true });
  const ignore = join(folder, '.gitignore');
  try { if (readFileSync(ignore, 'utf8') === '*\n') return folder; } catch {}
  writeAtomic(ignore, '*\n');
  return folder;
}

// A file in a private folder napkin owns (its state dir, or a project's .napkin): the folder is made if needed, the write is atomic.
export function writePrivate(folder, name, text) { mkdirSync(folder, { recursive: true }); writeAtomic(join(folder, name), text); }
// Remove what an interrupted atomic write left behind (.<name>.tmp-<pid>-<n>) in a private folder.
export function sweepTmp(folder) { try { for (const f of readdirSync(folder)) if (/^\..+\.tmp-\d+-\d+$/.test(f)) unlinkSync(join(folder, f)); } catch { /* no such folder */ } }

// WPC-37: on a clean stop, leave only what is documented: .napkin/proposals.json (pending proposals survive a restart) and the
// .gitignore that hides it. Empty guard/ folders, leftover temp files and a .gitignore guarding nothing are removed.
export function cleanPrivate(root) {
  const walk = (d, depth) => {
    let names; try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.name === '.napkin') tidy(p); else if (depth < 6) walk(p, depth + 1);
    }
  };
  const tidy = (folder) => {
    sweepTmp(folder);
    try { // answers an agent has already acknowledged (seen) are pruned; the file goes when no proposal and no unheard answer is left
      const f = join(folder, 'proposals.json'), j = JSON.parse(readFileSync(f, 'utf8'));
      const unheard = (j.answered ?? []).filter((a) => a.at > Date.now() - 864e5 && a.at > (j.seen?.[a.proposedBy] ?? 0));
      if (!j.proposals?.length && !unheard.length) unlinkSync(f);
      else if (unheard.length !== (j.answered ?? []).length) writeAtomic(f, JSON.stringify({ ...j, answered: unheard }));
    } catch { /* none, or not ours to judge */ }
    try { rmdirSync(join(folder, 'guard')); } catch { /* absent or not empty */ }
    try { if (readdirSync(folder).join() === '.gitignore') { unlinkSync(join(folder, '.gitignore')); rmdirSync(folder); } else if (!readdirSync(folder).length) rmdirSync(folder); } catch { /* in use */ }
  };
  tidy(join(root, '.napkin')); walk(root, 0);
}

let counter = 0;
export const tmpName = (file) => join(dirname(file), `.${basename(file)}.tmp-${process.pid}-${counter++}`);

function fsyncDir(dir) {
  try { const fd = openSync(dir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* not every filesystem allows it */ }
}

// writeAtomic(file, text)                 replace (or create) the file
// writeAtomic(file, text, { exclusive })  create only; throws EEXIST when the file is already there
// { check }: called after the temp file is on disk and just before it replaces the target; if it throws, nothing is replaced.
// { guard }: the text the caller based this write on. A hard link to the target is taken just before the rename; after the
// rename the link is read, and if it does not hold `guard` a hand save landed in that window (an in-place write shows through the
// shared inode): the user's text is renamed back over the target and HandSave is thrown. A target replaced by a rename
// (an editor's atomic save) is noticed by its inode before we rename, and nothing is replaced.
export class HandSave extends Error {}
export function writeAtomic(file, data, { exclusive = false, check, guard } = {}) {
  const tmp = tmpName(file);
  let mode = 0o644;
  try { mode = statSync(file).mode & 0o777; } catch { /* new file */ }
  const buf = Buffer.from(data);
  let guardPath = null;
  try {
    const fd = openSync(tmp, 'wx', mode);
    try {
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    check?.();
    if (guard !== undefined && !exclusive) {
      // The guard link sits beside the file like the temp file does (a hard link needs the same filesystem) and is always
      // removed below: a guarded write leaves no private folder in the folder it writes (decision 0013).
      guardPath = join(dirname(file), `.${basename(file)}.guard-${process.pid}-${counter++}`);
      try { linkSync(file, guardPath); } catch { guardPath = null; } // no target yet: nothing to guard
      if (guardPath) { let same = false; try { same = statSync(file).ino === statSync(guardPath).ino; } catch { /* target vanished */ } if (!same) throw new HandSave(''); }
    }
    if (exclusive) linkSync(tmp, file); // fails with EEXIST instead of replacing
    else renameSync(tmp, file);
    if (guardPath) {
      const seen = readFileSync(guardPath, 'utf8');
      if (seen !== guard) { renameSync(guardPath, file); guardPath = null; throw new HandSave(seen); } // the user's text wins
    }
  } finally {
    if (guardPath) { try { unlinkSync(guardPath); } catch { /* gone */ } }
    if (exclusive) { try { unlinkSync(tmp); } catch { /* already gone */ } }
    else { try { unlinkSync(tmp); } catch { /* renamed away: the normal case */ } }
  }
  fsyncDir(dirname(file));
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export { alive };

// Temp files left behind by a writer that was killed. Only those of dead processes are removed.
export function cleanStaleTmp(file) {
  const prefixes = [`.${basename(file)}.tmp-`, `.${basename(file)}.guard-`, `.${basename(file).replace(/\.tsx$/, '.napkin.json')}.tmp-`]; // the component (temp file and guard link) and its sidecar
  let names; try { names = readdirSync(dirname(file)); } catch { return; }
  for (const n of names) {
    const prefix = prefixes.find((x) => n.startsWith(x));
    if (!prefix) continue;
    const rest = n.slice(prefix.length);
    if (!/^\d+-\d+$/.test(rest)) continue; // only napkin's own names: .<file>.tmp-<pid>-<n>
    const pid = Number(rest.split('-')[0]);
    if (pid !== process.pid && !alive(pid)) { try { unlinkSync(join(dirname(file), n)); } catch { /* raced with another cleaner */ } }
  }
}

// Removing and renaming a whole file (a frame made on the canvas, then undone or renamed; src/doc/folder.js).
// removeFile clears a dead writer's leftovers beside it first. moveFile never overwrites: the hard link fails with EEXIST
// when `to` exists, and only then is `from` unlinked, so a kill at any moment leaves the file under one name or both.
export function removeFile(file) { cleanStaleTmp(file); unlinkSync(file); }
export function moveFile(from, to) { mkdirSync(dirname(to), { recursive: true }); linkSync(from, to); unlinkSync(from); }

// The same for a whole directory at once: the leftovers (.<name>.tmp-<pid>-<n>, .<name>.guard-<pid>-<n>) of a dead writer
// beside each of `names` (the files napkin maps). Anything else in the folder, and the leftovers of a live process, stay.
export function sweepDir(dir, names) {
  let found; try { found = readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const f of found) {
    const m = /^\.(.+)\.(?:tmp|guard)-(\d+)-\d+$/.exec(f);
    if (!m || !names.has(m[1])) continue;
    const pid = Number(m[2]);
    if (pid !== process.pid && !alive(pid)) { try { unlinkSync(join(dir, f)); n++; } catch { /* raced with another cleaner */ } }
  }
  return n;
}
