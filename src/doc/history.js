// The film strip's memory (DREAM moment 9). A frame is a component's WHOLE write set at one moment: its own file plus every
// stylesheet its cascade uses (applied ones included). So a rule or variable edit is a frame of every component that uses
// that stylesheet, and scrubbing or restoring a frame means all of those files together.
// Napkin's frames live outside the folder, in <state>/film/ (frames.json per component, one blob per distinct content named by
// its git object id, ledger.json: who last wrote each file). The file's git history joins them, read-only (`git log`,
// `git cat-file`; GIT_OPTIONAL_LOCKS=0 so git never touches its own index).
//   createFilm(engine) -> { list(id), snapshotOf(id, frameId), diff(id, frameId), restorePlan(id, frameId), known(id) }
// The engine emits 'commit' (bytes before and after, per file) for every write it makes, and 'change' with by:'file' when
// someone else saved a file. Dropped frames drop their blobs; frames of components whose file is gone are cleaned away.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../atomic.js';
import { removeInState } from './state-rm.js';
import { describe } from './film-diff.js';

const KEEP = 200;               // napkin frames kept per component
const MAX_BYTES = 2_000_000;    // a file bigger than this is not kept
const GIT_FRAMES = 40;
const RUN_GAP = 10 * 60 * 1000; // edits of one thing within this are one run
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
// git's object id of a file's bytes: the one name for a content in napkin's blobs and in git
export const oidOf = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sigOf = (files) => Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, o]) => `${p}:${o}`).join('|');

export class FilmError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export function createFilm(engine) {
  const dir = join(engine.state, 'film'), blobs = join(dir, 'blobs');
  const slots = new Map();      // component id -> { dir, comp, path, frames }
  const have = new Set();       // blob oids known to be on disk
  const refs = new Map();       // oid -> number of frames holding it
  let ledger = {};              // path -> [{ at, oid, comp, by }]
  let loaded = false;
  const dirOf = (id) => join(dir, sha1(id).slice(0, 16));
  const ref = (frame, d) => {
    for (const o of Object.values(frame.files)) {
      const n = (refs.get(o) ?? 0) + d;
      if (n > 0) { refs.set(o, n); continue; }
      refs.delete(o);
      if (d < 0) { have.delete(o); try { removeInState(engine.state, join(blobs, o)); } catch (e) { console.error('film:', e.message); } }
    }
  };
  const drop = (path) => { try { removeInState(engine.state, path); } catch { /* already gone */ } };

  // Read everything napkin kept for this folder once: frames of components that are gone are removed, and blobs nothing holds.
  function load() {
    if (loaded) return; loaded = true;
    try { ledger = JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')) || {}; } catch { ledger = {}; }
    let names = []; try { names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'blobs').map((e) => e.name); } catch { /* nothing kept yet */ }
    for (const n of names) {
      let j; try { j = JSON.parse(readFileSync(join(dir, n, 'frames.json'), 'utf8')); } catch { j = null; }
      if (!j || !j.comp || !Array.isArray(j.frames) || !j.frames.every((f) => f.files) || !engine.has(j.comp)) { drop(join(dir, n)); continue; } // damaged, an older layout, or its file is gone
      slots.set(j.comp, { dir: join(dir, n), comp: j.comp, path: j.path, frames: j.frames });
      for (const f of j.frames) ref(f, 1);
    }
    try { for (const f of readdirSync(blobs)) if (/^[0-9a-f]{40}$/.test(f)) { if (refs.has(f)) have.add(f); else drop(join(blobs, f)); } } catch { /* no blobs yet */ }
  }
  const slot = (id) => {
    load();
    let s = slots.get(id);
    if (!s) { const comp = engine.component(id); s = { dir: dirOf(comp.id), comp: comp.id, path: comp.path, frames: [] }; slots.set(comp.id, s); }
    return s;
  };
  const save = (s) => { mkdirSync(s.dir, { recursive: true }); writeAtomic(join(s.dir, 'frames.json'), JSON.stringify({ comp: s.comp, path: s.path, frames: s.frames }) + '\n'); };
  const saveLedger = () => { mkdirSync(dir, { recursive: true }); writeAtomic(join(dir, 'ledger.json'), JSON.stringify(ledger) + '\n'); };
  const putBlob = (oid, bytes) => { if (have.has(oid)) return; mkdirSync(blobs, { recursive: true }); if (!existsSync(join(blobs, oid))) writeAtomic(join(blobs, oid), bytes); have.add(oid); };

  // The files a component draws from: its own, then each stylesheet of its cascade that is a file of the folder.
  function writeSet(comp) {
    const out = [comp.path];
    try { for (const sh of engine.sheetsOf(comp)) if (sh.file && !sh.external && !sh.missing && !out.includes(sh.file)) out.push(sh.file); } catch { /* unreadable */ }
    return out;
  }
  // The component's files as they are now ({ path: oid }); `over` replaces some with other bytes (the "before" of a write).
  function snapshot(comp, over = new Map()) {
    const files = {};
    for (const p of writeSet(comp)) {
      let bytes = over.get(p);
      if (!bytes) { try { bytes = engine.read(p).buf; } catch { continue; } }
      if (bytes.length > MAX_BYTES) continue;
      const oid = oidOf(bytes);
      files[p] = oid; putBlobLater(oid, bytes);
    }
    return files;
  }
  // blobs are written when a frame that holds them is recorded, not for every look at the files
  const pendingBlobs = new Map();
  function putBlobLater(oid, bytes) { if (!have.has(oid)) pendingBlobs.set(oid, bytes); }
  function record(id, files, { by = 'file', summary = '', at = Date.now() } = {}) {
    const s = slot(id), sig = sigOf(files);
    if (!Object.keys(files).length || (s.frames.length && sigOf(s.frames.at(-1).files) === sig)) return null;
    for (const o of Object.values(files)) if (pendingBlobs.has(o)) putBlob(o, pendingBlobs.get(o));
    pendingBlobs.clear();
    const frame = { id: `n${at.toString(36)}${sha1(sig).slice(0, 5)}`, at, by, summary, files };
    s.frames.push(frame); ref(frame, 1);
    while (s.frames.length > KEEP) ref(s.frames.shift(), -1);
    save(s);
    return frame;
  }
  const usersOf = (path) => { try { return engine.componentsUsing(path); } catch { return []; } };
  const quiet = (fn) => { try { return fn(); } catch (e) { console.error('film:', e.message); return null; } };

  // First time napkin looks at a component, and again if its files changed while napkin was not looking.
  function known(id) {
    const comp = engine.component(id), s = slot(comp.id), now = snapshot(comp);
    if (!s.frames.length) record(comp.id, now, { by: 'file', summary: 'The file as napkin first saw it' });
    else if (sigOf(s.frames.at(-1).files) !== sigOf(now)) record(comp.id, now, { by: 'file', summary: 'Edited outside napkin' });
    pendingBlobs.clear();
    return comp;
  }
  engine.events.on('commit', (c) => quiet(() => {
    load();
    (ledger[c.path] ||= []).push({ at: c.at, oid: oidOf(c.after), comp: c.component ?? null, by: c.by }); ledger[c.path] = ledger[c.path].slice(-100); saveLedger();
    for (const id of usersOf(c.path)) {
      let comp; try { comp = engine.component(id); } catch { continue; }
      const s = slot(comp.id);
      if (!s.frames.length) record(comp.id, snapshot(comp, new Map([[c.path, c.before]])), { by: 'file', summary: 'The file as napkin first saw it', at: c.at - 1 });
      record(comp.id, snapshot(comp), { by: c.by, summary: c.kind === 'edit' ? c.summary : `${c.kind}: ${c.summary}`, at: c.at });
      pendingBlobs.clear();
    }
  }));
  engine.events.on('change', (c) => quiet(() => {
    if (c.by !== 'file' || c.kind !== 'file') return;
    load();
    let cur; try { cur = engine.read(c.path).buf; } catch { return; }
    (ledger[c.path] ||= []).push({ at: Date.now(), oid: oidOf(cur), comp: null, by: 'file' }); ledger[c.path] = ledger[c.path].slice(-100); saveLedger();
    for (const id of usersOf(c.path)) {
      const s = slots.get(id); if (!s?.frames.length) continue;
      let comp; try { comp = engine.component(id); } catch { continue; }
      record(comp.id, snapshot(comp), { by: 'file', summary: 'Edited outside napkin' }); pendingBlobs.clear();
    }
  }));

  // ---------- git (read-only) ----------
  const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  const git = (args, input) => execFileSync('git', ['-C', engine.root, '--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', ...args], { env: GIT_ENV, timeout: 8000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'], ...(input !== undefined && { input }) });
  let repo = null;
  const inRepo = () => (repo ??= (() => { try { return git(['rev-parse', '--is-inside-work-tree']).toString().trim() === 'true'; } catch { return false; } })());
  const gitCache = new Map();   // component -> { at, key, frames }
  // Commits that touched any file of the write set, each with the file versions it had ({ path: oid }).
  function gitFrames(comp, paths) {
    const key = paths.join('|'), hit = gitCache.get(comp.id);
    if (hit && hit.key === key && Date.now() - hit.at < 5000) return hit.frames;
    const frames = [];
    if (inRepo()) {
      try {
        const out = git(['log', `--max-count=${GIT_FRAMES}`, '--format=%x1e%H%x1f%an%x1f%at%x1f%s', '--', ...paths.map((p) => './' + p)]).toString('utf8');
        const commits = out.split('\x1e').slice(1).map((r) => { const [sha, author, at, subject] = r.split('\n')[0].split('\x1f'); return { sha, author, at: Number(at) * 1000, subject }; });
        const input = commits.flatMap((c) => paths.map((p) => `${c.sha}:./${p}`)).join('\n') + '\n';
        const lines = commits.length ? git(['cat-file', '--batch-check'], input).toString('utf8').split('\n') : [];
        commits.forEach((c, i) => {
          const files = {};
          paths.forEach((p, j) => { const m = /^([0-9a-f]{40}) blob \d+$/.exec(lines[i * paths.length + j] ?? ''); if (m) files[p] = m[1]; });
          if (files[comp.path]) frames.push({ id: `g${c.sha}`, source: 'git', at: c.at, by: c.author, summary: c.subject, short: c.sha.slice(0, 7), files, ord: commits.length - i });
        });
      } catch { frames.length = 0; }
    }
    gitCache.set(comp.id, { at: Date.now(), key, frames });
    return frames;
  }
  const gitBlobs = (oids) => {
    const out = new Map(); if (!oids.length) return out;
    const buf = git(['cat-file', '--batch'], oids.join('\n') + '\n');
    for (let i = 0; i < buf.length;) {
      const nl = buf.indexOf(10, i); if (nl < 0) break;
      const m = /^([0-9a-f]{40}) blob (\d+)$/.exec(buf.toString('latin1', i, nl));
      if (!m) { i = nl + 1; continue; }
      const size = Number(m[2]); out.set(m[1], buf.subarray(nl + 1, nl + 1 + size)); i = nl + 1 + size + 1;
    }
    return out;
  };
  const blobsOf = (oids) => {
    const out = new Map(), missing = [];
    for (const o of new Set(oids)) { try { out.set(o, readFileSync(join(blobs, o))); } catch { missing.push(o); } }
    if (missing.length && inRepo()) { try { for (const [o, b] of gitBlobs(missing)) out.set(o, b); } catch { /* git cannot say */ } }
    return out;
  };

  // ---------- the list ----------
  const labelCache = new Map();
  function label(prev, cur) {
    const k = `${prev ? sigOf(prev.files) : ''}>${sigOf(cur.files)}`;
    if (labelCache.has(k)) return labelCache.get(k);
    let r = { what: '', where: '', key: null };
    if (prev) {
      const paths = [...new Set([...Object.keys(prev.files), ...Object.keys(cur.files)])].filter((p) => prev.files[p] !== cur.files[p]);
      const b = blobsOf(paths.flatMap((p) => [prev.files[p], cur.files[p]]).filter(Boolean));
      const txt = (o) => (o && b.has(o) ? b.get(o).toString('utf8') : null);
      r = paths.length ? describe(paths.map((p) => ({ path: p, a: txt(prev.files[p]), b: txt(cur.files[p]) }))) : r;
    }
    labelCache.set(k, r); if (labelCache.size > 2000) labelCache.delete(labelCache.keys().next().value);
    return r;
  }
  // Frames newest first: napkin's and git's merged (a version both have is one frame), each said in words, runs of one thing merged.
  function list(id) {
    const comp = known(id), s = slot(comp.id);
    const paths = writeSet(comp), nowSig = sigOf(snapshot(comp)); pendingBlobs.clear();
    const all = s.frames.map((f) => ({ ...f, source: 'napkin' }));
    const sigs = new Map(all.map((f) => [sigOf(f.files), f]));
    for (const g of [...gitFrames(comp, paths)].reverse()) { // oldest first, so commits of one second keep their order
      const twin = sigs.get(sigOf(g.files));
      if (!twin) { all.push(g); continue; }
      // one frame for one set of bytes: a commit napkin also made an edit of keeps the edit, the file as first seen becomes the commit
      twin.git = { short: g.short, subject: g.summary, author: g.by };
      if (twin.by === 'file' && /first saw/.test(twin.summary)) all.splice(all.indexOf(twin), 1, g);
    }
    all.sort((a, b) => a.at - b.at || (a.ord ?? Infinity) - (b.ord ?? Infinity)); // commits of one second keep their order
    const out = [];
    all.forEach((f, k) => {
      const prev = all[k - 1] ?? null, l = label(prev, f), tail = out.at(-1);
      const row = { id: f.id, ids: [f.id], count: 1, source: f.source, at: f.at, by: f.by, summary: f.summary, what: l.what, where: l.where, key: l.key, same: sigOf(f.files) === nowSig, beforeId: prev?.id ?? null, ...(f.short && { short: f.short }), ...(f.git && { git: f.git }) };
      Object.defineProperty(row, '_before', { value: prev, enumerable: false, writable: true });
      if (tail && row.source === 'napkin' && tail.source === 'napkin' && row.key && row.key === tail.key && row.by === tail.by && f.at - tail.at <= RUN_GAP) {
        const l2 = label(tail._before, f);
        Object.assign(tail, { ids: [...tail.ids, f.id], count: tail.count + 1, id: f.id, at: f.at, summary: f.summary, same: row.same, what: l2.what, where: l2.where });
      } else out.push(row);
    });
    return { git: inRepo(), now: { sig: sha1(nowSig).slice(0, 12) }, frames: out.reverse() };
  }
  const findFrame = (comp, frameId) => {
    const s = slot(comp.id);
    if (/^n[0-9a-z]+$/.test(frameId)) { const f = s.frames.find((x) => x.id === frameId); if (f) return f; }
    if (/^g[0-9a-f]{40}$/.test(frameId)) { const f = gitFrames(comp, writeSet(comp)).find((x) => x.id === frameId); if (f) return f; }
    throw new FilmError(`no version ${String(frameId).slice(0, 12)} in the history of ${comp.path}. Next: reload the strip`, 404);
  };
  // A version's files: Map(path -> Buffer)
  function snapshotOf(id, frameId) {
    const comp = known(id), f = findFrame(comp, frameId);
    const b = blobsOf(Object.values(f.files)), out = new Map();
    for (const [p, o] of Object.entries(f.files)) { if (!b.has(o)) throw new FilmError('that version is no longer kept. Next: pick a newer frame', 410); out.set(p, b.get(o)); }
    return { comp, frame: f, files: out };
  }
  // Lines that differ between a version and the files now, over all the files of the version.
  function diff(id, frameId) {
    const { comp, files } = snapshotOf(id, frameId);
    let removed = 0, added = 0, first = null;
    for (const [p, bytes] of files) {
      let now; try { now = engine.read(p).buf; } catch { continue; }
      if (now.equals(bytes)) continue;
      const a = bytes.toString('utf8').split('\n'), b = now.toString('utf8').split('\n');
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
      const x = a.slice(i, a.length - j), y = b.slice(i, b.length - j);
      let common = 0;
      if (x.length && y.length && x.length * y.length <= 4_000_000) {
        let prev = new Uint32Array(y.length + 1);
        for (let r = 1; r <= x.length; r++) { const cur = new Uint32Array(y.length + 1); for (let c = 1; c <= y.length; c++) cur[c] = x[r - 1] === y[c - 1] ? prev[c - 1] + 1 : Math.max(prev[c], cur[c - 1]); prev = cur; }
        common = prev[y.length];
      }
      removed += x.length - common; added += y.length - common; first ??= { path: p, line: i + 1 };
    }
    return { removed, added, first, component: comp.id };
  }
  // What a restore would write, or why it must not: a shared stylesheet that somebody else's edit changed since that version
  // would be undone with it.
  function restorePlan(id, frameId) {
    const { comp, frame, files } = snapshotOf(id, frameId), write = [];
    for (const [p, bytes] of files) {
      let now = null; try { now = engine.read(p).buf; } catch { /* gone: the version brings it back */ }
      if (now && now.equals(bytes)) continue;
      if (p !== comp.path && now) {
        const clobber = (ledger[p] || []).filter((e) => e.at > frame.at && e.comp !== comp.id).at(-1);
        if (clobber && usersOf(p).some((u) => u !== comp.id)) {
          const when = new Date(clobber.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          throw new FilmError(`${p} is shared, and it changed at ${when}${clobber.comp ? ` while you worked on ${clobber.comp.split('#').pop()}` : ' outside napkin'} after this version. Restoring would undo that. Next: restore a newer version, or change the rule in ${p} directly`, 409);
        }
      }
      write.push({ path: p, bytes });
    }
    return { comp, frame, files: write };
  }
  return { list, snapshotOf, diff, restorePlan, known };
}
