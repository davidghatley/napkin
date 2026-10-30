// The film strip's memory (DREAM moment 9): every version of a component's file that napkin wrote or saw, kept outside the
// folder, plus the file's git history when the folder is a repository (read-only: `git log`, `git cat-file`, nothing else).
//   createFilm(engine) -> { list(path), bytes(path, frameId), diff(path, frameId), known(path) }
// Napkin's frames live in <state>/film/<hash of the path>/: frames.json (newest last) and one blob per distinct content, named
// by its sha1. They survive a restart, so "this session and before" is one list. The engine emits 'commit' (bytes before and
// after) for every write it makes, and 'change' with by:'file' when someone else saved the file.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../atomic.js';

const KEEP = 200;               // napkin frames kept per file
const MAX_BYTES = 2_000_000;    // a file bigger than this is not kept (the strip is for components)
const GIT_FRAMES = 40;
const sha1 = (b) => createHash('sha1').update(b).digest('hex');

export class FilmError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export function createFilm(engine) {
  const dir = join(engine.state, 'film');
  const mem = new Map();        // path -> { dir, frames: [oldest .. newest] }
  const slot = (path) => {
    let m = mem.get(path);
    if (m) return m;
    const d = join(dir, sha1(path).slice(0, 16));
    let frames = [];
    try { frames = JSON.parse(readFileSync(join(d, 'frames.json'), 'utf8')).frames || []; } catch { /* nothing kept yet */ }
    m = { dir: d, frames };
    mem.set(path, m);
    return m;
  };
  const save = (path) => {
    const m = slot(path);
    mkdirSync(m.dir, { recursive: true });
    writeAtomic(join(m.dir, 'frames.json'), JSON.stringify({ path, frames: m.frames }) + '\n');
  };
  const blobPath = (m, hash) => join(m.dir, hash);

  // Keep `bytes` as the newest frame of `path`, unless it is what the newest frame already holds.
  function record(path, bytes, { by = 'file', summary = '', at = Date.now() } = {}) {
    if (bytes.length > MAX_BYTES) return null;
    const m = slot(path), hash = sha1(bytes);
    if (m.frames.at(-1)?.hash === hash) return null;
    mkdirSync(m.dir, { recursive: true });
    if (!existsSync(blobPath(m, hash))) writeAtomic(blobPath(m, hash), bytes);
    const frame = { id: `n${at.toString(36)}${hash.slice(0, 6)}`, at, by, summary, hash, size: bytes.length };
    m.frames.push(frame);
    while (m.frames.length > KEEP) m.frames.shift();
    // (a dropped frame's blob stays on disk, outside the folder: napkin's own writes go through atomic.js, which never deletes)
    save(path);
    return frame;
  }
  const seen = (path) => slot(path).frames.length > 0;
  // What the file holds right now becomes the first frame when napkin has kept nothing yet ("as napkin first saw it").
  function known(path) {
    let cur; try { cur = engine.read(path).buf; } catch { return false; }
    if (!seen(path)) record(path, cur, { by: 'file', summary: 'The file as napkin first saw it' });
    else if (slot(path).frames.at(-1).hash !== sha1(cur)) record(path, cur, { by: 'file', summary: 'Edited outside napkin' }); // while napkin was closed
    return true;
  }
  engine.events.on('commit', (c) => {
    try {
      if (!seen(c.path)) record(c.path, c.before, { by: 'file', summary: 'The file as napkin first saw it', at: c.at - 1 });
      record(c.path, c.after, { by: c.by, summary: c.kind === 'edit' ? c.summary : `${c.kind}: ${c.summary}`, at: c.at });
    } catch (e) { console.error('film:', e.message); }
  });
  engine.events.on('change', (c) => {
    if (c.by !== 'file' || c.kind !== 'file') return;
    try { const cur = engine.read(c.path).buf; if (seen(c.path)) record(c.path, cur, { by: 'file', summary: 'Edited outside napkin' }); } catch { /* removed */ }
  });

  // ---------- git (read-only) ----------
  const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  const git = (args) => execFileSync('git', ['-C', engine.root, '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', ...args], { env: GIT_ENV, timeout: 5000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  let repo = null;
  const inRepo = () => (repo ??= (() => { try { return git(['rev-parse', '--is-inside-work-tree']).toString().trim() === 'true'; } catch { return false; } })());
  const gitCache = new Map();   // path -> { at, frames }
  const gitSlot = (path) => {
    const hit = gitCache.get(path);
    if (hit && Date.now() - hit.at < 5000) return hit.frames;
    let frames = [];
    if (inRepo()) {
      try {
        const out = git(['log', `--max-count=${GIT_FRAMES}`, '--no-abbrev', '--raw', '--format=%x1e%H%x1f%an%x1f%at%x1f%s', '--', './' + path]).toString('utf8');
        for (const rec of out.split('\x1e').slice(1)) {
          const [head, ...rest] = rec.split('\n');
          const [sha, author, at, subject] = head.split('\x1f');
          const line = rest.find((l) => l.startsWith(':'));
          const blob = line && /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]{40}) /.exec(line)?.[1];
          if (!blob || /^0+$/.test(blob)) continue; // the commit deleted the file
          frames.push({ id: `g${sha}`, at: Number(at) * 1000, by: author, summary: subject, source: 'git', short: sha.slice(0, 7), blob });
        }
      } catch { frames = []; }
    }
    gitCache.set(path, { at: Date.now(), frames });
    return frames;
  };
  const gitBlob = (oid) => { if (!/^[0-9a-f]{40}$/.test(oid)) throw new FilmError('not a git object. Next: pick a frame from the strip', 400); return git(['cat-file', 'blob', oid]); };
  // git hashes a blob as sha1("blob <size>\0" + bytes): the same content as the file now is found without reading anything
  const gitOid = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

  // ---------- the list and the bytes ----------
  // Frames newest first, both sources merged. `now` marks the frame the file already equals.
  function list(path) {
    known(path);
    const cur = engine.read(path).buf, curHash = sha1(cur), curOid = gitOid(cur);
    const mine = slot(path).frames.map((f) => ({ id: f.id, source: 'napkin', at: f.at, by: f.by, summary: f.summary, size: f.size, same: f.hash === curHash }));
    const theirs = gitSlot(path).map((f) => ({ id: f.id, source: 'git', at: f.at, by: f.by, summary: f.summary, short: f.short, same: f.blob === curOid }));
    return { git: inRepo(), now: { hash: curHash.slice(0, 12), size: cur.length }, frames: [...mine, ...theirs].sort((a, b) => b.at - a.at) };
  }
  function bytes(path, id) {
    known(path);
    if (/^n[0-9a-z]+$/.test(id)) {
      const m = slot(path), f = m.frames.find((x) => x.id === id);
      if (!f) throw new FilmError(`no frame ${id} in the history of ${path}. Next: reload the strip`, 404);
      try { return readFileSync(blobPath(m, f.hash)); } catch { throw new FilmError('that version is no longer kept. Next: pick a newer frame', 410); }
    }
    if (/^g[0-9a-f]{40}$/.test(id)) {
      const f = gitSlot(path).find((x) => x.id === id);
      if (!f) throw new FilmError(`no commit ${id.slice(1, 8)} touching ${path}. Next: reload the strip`, 404);
      try { return gitBlob(f.blob); } catch (e) { if (e instanceof FilmError) throw e; throw new FilmError('git could not read that version. Next: pick another frame', 502); }
    }
    throw new FilmError('not a frame id. Next: take one from the strip\'s list', 400);
  }

  // Lines changed between the file now and a version: the common start and end are trimmed, the middle is compared by
  // longest common subsequence (so a moved block counts as removed and added, like any diff).
  function diff(path, id) {
    const a = bytes(path, id).toString('utf8').split('\n'), b = engine.read(path).buf.toString('utf8').split('\n');
    let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    const x = a.slice(p, a.length - q), y = b.slice(p, b.length - q);
    let common = 0;
    if (x.length && y.length && x.length * y.length <= 4_000_000) {
      let prev = new Uint32Array(y.length + 1);
      for (let i = 1; i <= x.length; i++) { const cur = new Uint32Array(y.length + 1); for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev = cur; }
      common = prev[y.length];
    }
    // "from the version to now": lines the version has that the file lost, and lines the file gained
    return { removed: x.length - common, added: y.length - common, first: p + 1 };
  }
  return { list, bytes, diff, known, record };
}
