// The store: ONE process owns each component file. It keeps the document and a revision in memory,
// plus a short history of which keys each revision changed. Every writer (canvas, agent, file) goes
// through apply(), which is serialised by a promise queue. External writes (git restore, an editor)
// are picked up by a directory watcher (and a slow poll as a safety net) and become a new revision
// with by "file".
//
// Revisions are content hashes (HIS-04): the first 16 hex digits of the sha256 of the file's bytes.
// They survive a server restart: a client holding a revision from before the restart can still commit
// when the file has not changed since. Treat them as opaque strings.
//
// This module is the only place a component .tsx is written (INV-05): applyNow() for edits, and
// createComponentFile() for a brand-new file. Both go through writeAtomic (REL-01).
import { readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { codecFor, readSidecar, writeSidecar } from './codecs.js';
import { writeAtomic, cleanStaleTmp } from './atomic.js';
import { writeFileAtomic } from './atomic-write.js';

// Syntax errors from the parser carry loc.line but not "line N:" in the message; dialect errors already do.
// Every reason names a line (INV-04); a file-level problem with no line of its own says line 1.
const reason = (e) => {
  if (/^line \d+/.test(e.message)) return e.message;
  return `line ${e.loc?.line ?? 1}: ${e.message}`;
};

const HISTORY = 500; // revisions remembered for rebasing; older bases are "stale revision"
const POLL_MS = 400; // safety net for a missed file-system event; FMT-07 wants a hand edit seen within 1 s

export const revisionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// A new component file. Exclusive: never replaces a file that exists. Throws an error with code EEXIST then.
export function createComponentFile(file, text) { writeAtomic(file, text, { exclusive: true }); }

export async function openStore(file) {
  const codec = codecFor(file);
  const { applyEdits, touched, conflicts, diffKeys, EditError } = codec;
  const events = new EventEmitter();
  cleanStaleTmp(file);
  let text = readFileSync(file, 'utf8');
  // A file napkin can't read fully opens read-only, with the reason (decision 0003, INV-06).
  let doc = null, state = null, readOnly = null;
  try { ({ doc, state } = codec.load(text, file)); } catch (e) { readOnly = reason(e); }
  let revision = revisionOf(text);
  const history = [{ revision, keys: new Set() }];
  let queue = Promise.resolve();
  let broken = null; // the error of a hand edit the last good doc could not absorb (F22), else null
  const problem = (error) => { broken = error; events.emit('problem', { error }); };

  const commit = (next, keys, by, edits, origin) => {
    doc = next; revision = revisionOf(text);
    history.push({ revision, keys });
    if (history.length > HISTORY) history.shift();
    events.emit('change', { revision, by, edits, origin, doc });
  };

  // Look at the file on disk. If someone else changed it, that becomes a revision (by "file") first.
  // Returns an error string when the file on disk can't be absorbed (half-written or outside the dialect).
  function absorbDisk() {
    let t; try { t = readFileSync(file, 'utf8'); } catch { return null; }
    if (t === text) { if (broken) problem(null); return null; } // back to the last good text (e.g. git restore)
    let loaded; try { loaded = codec.load(t, file); } catch (e) { const r = reason(e); problem(r); return r; } // keep the last good doc
    if (broken) problem(null);
    const keys = doc ? diffKeys(doc, loaded.doc) : new Set(['file']);
    text = t; state = loaded.state; readOnly = null;
    commit(loaded.doc, keys, 'file', undefined, undefined);
    return null;
  }

  // dryRun: validate and produce the would-be file without writing or committing (F19).
  function applyNow({ baseRevision, edits, by = 'unknown', origin, dryRun = false }) {
    // A hand edit that landed a moment ago must not be overwritten: take it in before judging this batch.
    const disk = absorbDisk();
    if (readOnly) return { ok: false, error: `read-only: ${readOnly}` };
    if (disk) return { ok: false, error: `read-only: the file on disk is not valid right now (${disk}); fix or restore it, then try again` };
    // The last time this revision was current: an edit based on content that came back (A, B, A) is based on A.
    let at = -1;
    for (let i = history.length - 1; i >= 0; i--) if (history[i].revision === baseRevision) { at = i; break; }
    if (at < 0) return { ok: false, error: `stale revision: ${baseRevision} is not a known revision (current ${revision})` };
    let keys;
    try { keys = touched(edits); } catch { return { ok: false, error: 'invalid edit #0: edits must be an array' }; }
    for (const h of history.slice(at + 1)) {
      if (conflicts(keys, h.keys)) {
        return { ok: false, error: `stale revision: ${[...keys].join(', ')} changed in revision ${h.revision} (base ${baseRevision})` };
      }
    }
    let next;
    try { next = applyEdits(doc, edits); }
    catch (e) { if (e instanceof EditError) return { ok: false, error: e.message }; throw e; }
    let saved;
    try { saved = codec.save(state, doc, next); }
    catch (e) { return { ok: false, error: `invalid edit #0: could not write the file (${e.message})` }; }
    if (dryRun) return { ok: true, dryRun: true, revision, doc: next, source: saved.text };
    if (saved.text !== text) writeFileAtomic(file, saved.text); // a batch that changes nothing leaves the file (and its mtime) alone
    text = saved.text; state = saved.state;
    commit(next, keys, by, edits, origin);
    return { ok: true, revision, doc };
  }

  // Where the component sits on the canvas lives in the sidecar, never in the .tsx (FMT-02, FMT-06).
  function moveCanvas(x, y) {
    if (![x, y].every((n) => typeof n === 'number' && Number.isFinite(n))) return { ok: false, error: 'invalid canvas position: x and y must be numbers' };
    const side = readSidecar(file, basename(file).replace(/\.tsx$/, ''));
    const canvas = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    if (side.canvas?.x !== canvas.x || side.canvas?.y !== canvas.y) writeSidecar(file, { ...side, canvas });
    events.emit('canvas', { canvas });
    return { ok: true, canvas };
  }

  const settle = () => { queue = queue.then(() => { absorbDisk(); }).catch(() => {}); };
  // The directory, not the file: an atomic rename (ours or git's) replaces the inode.
  const watcher = watch(dirname(file), (_, name) => {
    if (name && name !== basename(file)) return;
    settle();
  });
  const poll = setInterval(settle, POLL_MS);
  poll.unref();

  return {
    events,
    async read() { await queue; return { revision, doc, source: text, ...(readOnly && { readOnly }), ...(broken && { problem: broken }) }; },
    apply(req) { const p = queue.then(() => applyNow(req)); queue = p.catch(() => {}); return p; },
    moveCanvas(x, y) { const p = queue.then(() => moveCanvas(x, y)); queue = p.catch(() => {}); return p; },
    async close() { clearInterval(poll); watcher.close(); await queue; },
  };
}
