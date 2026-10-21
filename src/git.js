// Read-only git awareness (HIS-05). napkin never commits, stages, checks out or writes anything in .git:
// every call here is `git show`, `git diff`, `git status`, `git rev-parse` or a file read.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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

// Did a git command just rewrite this file? Called by the store's watcher with the text it found.
// Evidence: HEAD moved (reflog, a verb other than commit) or the index was rewritten within `windowMs`, and, for the index case,
// the file now equals its committed or staged blob. A hand edit leaves HEAD and index alone, so it stays "file".
// -> { by: 'git', summary: 'git checkout' } | null
export function gitAttribution(file, text, { windowMs = 4000, now = Date.now() } = {}) {
  const dir = dirname(resolve(file));
  const gitDir = gitDirOf(dir);
  if (!gitDir) return null;
  const head = lastHeadMove(gitDir);
  const headMoved = head.at >= now - windowMs && head.verb && !/^commit/.test(head.verb);
  if (headMoved) return { by: 'git', summary: `git ${head.verb}` };
  const indexMoved = mtime(join(gitDir, 'index')) >= now - windowMs;
  if (!indexMoved) return null;
  const name = basename(file);
  const inHead = tryRun(dir, ['show', `HEAD:./${name}`]);
  const inIndex = tryRun(dir, ['show', `:./${name}`]);
  if (text === inHead || text === inIndex) return { by: 'git', summary: 'git checkout' };
  return null;
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
