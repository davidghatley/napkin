// Read-only git awareness (HIS-05). napkin never commits, stages, checks out or writes anything in .git:
// every call here is `git show`, `git diff`, `git status`, `git rev-parse` or a file read.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const run = (cwd, args, opts = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024, ...opts });
const tryRun = (cwd, args) => { try { return run(cwd, args); } catch { return null; } };

// The git directory that holds HEAD, index and logs/HEAD for a folder (a linked worktree has its own); null outside a repo.
export function gitDirOf(dir) {
  const out = tryRun(dir, ['rev-parse', '--absolute-git-dir']);
  return out ? out.trim() : null;
}
export const repoRoot = (dir) => { const out = tryRun(dir, ['rev-parse', '--show-toplevel']); return out ? out.trim() : null; };

const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
// The last HEAD movement: its mtime and the verb of its reflog line ("checkout", "merge", "commit" ...).
function lastHeadMove(gitDir) {
  const log = join(gitDir, 'logs', 'HEAD');
  let verb = null;
  try {
    const last = readFileSync(log, 'utf8').trimEnd().split('\n').at(-1) ?? '';
    const subject = last.split('\t')[1] ?? '';
    verb = subject.split(/[:( ]/)[0] || null;
  } catch {}
  return { at: mtime(log), verb };
}

// Texts of this file in the stash entries, remembered while they exist: `git stash pop` drops the entry it applies, so the text
// a pop writes can only be recognised from what we saw before. Primed when a store opens and refreshed after each outside change.
const stashTexts = new Map(); // git dir -> Set of file texts
export function primeGit(file) {
  const dir = dirname(resolve(file)), gitDir = gitDirOf(dir);
  if (!gitDir || !existsSync(join(gitDir, 'logs', 'refs', 'stash'))) return;
  const set = stashTexts.get(gitDir + '|' + basename(file)) ?? new Set();
  const names = tryRun(dir, ['stash', 'list', '--format=%gd']);
  for (const ref of (names ?? '').split('\n').filter(Boolean).slice(0, 20)) { const t = tryRun(dir, ['show', `${ref}:./${basename(file)}`]); if (t !== null) set.add(t); }
  stashTexts.set(gitDir + '|' + basename(file), set);
}

// Did a git command just rewrite this file? Called by the store's watcher with the text it found.
// Both must hold: a trace of git in the last `windowMs` (HEAD's reflog moved by something other than a commit, the stash moved, or the
// index was rewritten) AND the new text is one git itself wrote: the HEAD blob, the index blob, or (stash) a stash entry's blob.
// A hand edit after `git checkout -b` or `git status` matches no blob, so it stays "file".
// -> { by: 'git', summary: 'git checkout' } | null
export function gitAttribution(file, text, { windowMs = 4000, now = Date.now() } = {}) {
  const dir = dirname(resolve(file));
  const gitDir = gitDirOf(dir);
  if (!gitDir) return null;
  const name = basename(file), key = gitDir + '|' + name;
  const head = lastHeadMove(gitDir);
  const recent = (t) => t >= now - windowMs;
  const headMoved = recent(head.at) && head.verb && !/^commit/.test(head.verb);
  // the stash log vanishes with the last entry (a pop), so once a stash has been seen the folders around it count too
  const stashMoved = recent(mtime(join(gitDir, 'logs', 'refs', 'stash'))) || (stashTexts.has(key) && recent(Math.max(mtime(join(gitDir, 'logs', 'refs')), mtime(join(gitDir, 'refs')))));
  const indexMoved = recent(mtime(join(gitDir, 'index')));
  let result = null;
  if (headMoved || stashMoved || indexMoved) {
    const blobs = [tryRun(dir, ['show', `HEAD:./${name}`]), tryRun(dir, ['show', `:./${name}`])];
    const isBlob = blobs.includes(text);
    if (stashMoved && (isBlob || stashTexts.get(key)?.has(text))) result = { by: 'git', summary: 'git stash' }; // stash push also resets HEAD: say stash
    else if (headMoved && isBlob) result = { by: 'git', summary: `git ${head.verb}` };
    else if (indexMoved && isBlob) result = { by: 'git', summary: 'git checkout' };
  }
  primeGit(file); // a stash pushed just now will be gone after its pop; remember its text first
  return result;
}

// What the file at HEAD says, or null (not a repo, no commit, or the file is not tracked at HEAD).
export const headSource = (file) => tryRun(dirname(resolve(file)), ['show', `HEAD:./${basename(file)}`]);

// Files under `dir` that differ from HEAD: Map<basename, 'modified' | 'added' | 'deleted'>; null when `dir` is not in a repo.
export function changedFiles(dir) {
  if (!gitDirOf(dir)) return null;
  const out = tryRun(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  const map = new Map();
  if (out === null) return map;
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const xy = parts[i].slice(0, 2), p = parts[i].slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the next field is the old name
    const state = xy === '??' || xy[0] === 'A' ? 'added' : xy.includes('D') ? 'deleted' : 'modified';
    map.set(resolve(repoRoot(dir) || dir, p), state);
  }
  return map;
}

// A unified diff of one file against HEAD (staged and unstaged together); '' when it matches, null outside a repo.
export function diffAgainstHead(file) {
  const dir = dirname(resolve(file)), name = basename(file);
  if (!gitDirOf(dir)) return null;
  if (headSource(file) === null) {
    // not at HEAD: show the whole file as added
    try { return run(dir, ['diff', '--no-index', '--no-color', '--', '/dev/null', name]); } catch (e) { return e.stdout || ''; }
  }
  return tryRun(dir, ['diff', 'HEAD', '--no-color', '--', name]) ?? '';
}
