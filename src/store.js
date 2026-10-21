// Variant A store: ONE process owns the component. It keeps the document and an integer
// revision counter in memory, plus a short history of which keys each revision changed.
// Every writer (canvas, agent, file) goes through apply(), which is serialised by a promise
// queue, so there are no lock files. External writes (git restore, an editor) are picked up
// by a directory watcher and become a new revision with by "file".
import { explainError } from './errors.js';
import { readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { writeComponent } from './commit.js';
import { EventEmitter } from 'node:events';
import { codecFor } from './codecs.js';
import { summarize } from './summary.js';
import { ADOPTION } from './adopt.js';
import { staleEntries } from './stale.js';

// Syntax errors from the parser carry loc.line but not "line N:" in the message; dialect errors already do.
const rawReason = (e) => (e.loc?.line && !/^line \d+/.test(e.message) ? `line ${e.loc.line}: ${e.message}` : e.message);

const HISTORY = 500; // revisions remembered for rebasing; older bases are "stale revision"

// start: { revision, by, summary } seeds the first history entry (create and rename record themselves there).
export async function openStore(file, start = {}) {
  const reason = (e) => explainError(rawReason(e), { file });
  const codec = codecFor(file);
  const { applyEdits, touched, conflicts, diffKeys, EditError } = codec;
  const events = new EventEmitter();
  let text = readFileSync(file, 'utf8');
  // A file napkin can't read fully opens read-only, with the reason (decision 0003, INV-06).
  let doc = null, state = null, readOnly = null;
  try { ({ doc, state } = codec.load(text, file, start)); } catch (e) { readOnly = reason(e); }
  let revision = start.revision ?? 1;
  const history = [{ revision, keys: new Set(), by: start.by || 'file', summary: start.summary || 'opened', at: Date.now() }];
  let queue = Promise.resolve();
  let broken = null; // the error of a hand edit the last good doc could not absorb (F22), else null
  const problem = (error) => { broken = error ? explainError(error, { file }) : null; events.emit('problem', { error: broken && explainError(broken, { file }) }); };

  const commit = (next, keys, by, edits, origin) => {
    doc = next; revision += 1;
    const summary = summarize(edits), at = Date.now();
    history.push({ revision, keys, by, summary, at });
    if (history.length > HISTORY) history.shift();
    events.emit('change', { revision, by, edits, origin, doc, summary, at });
  };

  const writeFile = (t) => { writeComponent(file, t); text = t; };

  // dryRun: validate and produce the would-be file without writing or committing (F19).
  function applyNow(request) {
    const { baseRevision, edits, by, origin, dryRun = false } = request;
    const adoption = request[ADOPTION];
    if (adoption) {
      if (typeof by !== 'string' || !by.trim() || by === 'unknown') return { ok: false, error: 'by is required: every revision names a real caller. Next: supply your session identity.' };
      let diskSource; try { diskSource = readFileSync(file, 'utf8'); } catch { diskSource = null; }
      if (baseRevision !== revision || diskSource !== adoption.before) return { ok: false, error: `stale revision: ${file} changed after the adoption proposal. Next: reject it and propose_adoption again.`, currentRevision: revision };
      if (!readOnly) return { ok: false, error: `invalid edit #0: ${file} is already editable. Next: use apply_edits.` };
      let loaded;
      try { loaded = codec.load(adoption.source, file, { ...start, writeSidecars: dryRun ? false : start.writeSidecars }); } catch (e) { return { ok: false, error: `invalid edit #0: ${file}: ${reason(e)}. Next: correct the adoption proposal.` }; }
      if (dryRun) return { ok: true, dryRun: true, revision, doc: loaded.doc, source: adoption.source };
      writeFile(adoption.source); state = loaded.state; readOnly = null;
      commit(loaded.doc, new Set(['file']), by, [{ op: 'adoption' }], origin);
      return { ok: true, revision, doc };
    }
    if (readOnly) return { ok: false, error: `read-only: ${readOnly}` };
    // every revision names a real caller (AGT-05); a dry run makes none
    if (!dryRun && (typeof by !== 'string' || !by.trim() || by.trim().toLowerCase() === 'unknown')) return { ok: false, error: 'by is required: every revision names a real caller' };
    const safeTouched = (e) => { try { return touched(e); } catch { return new Set(); } };
    const base = history.find((h) => h.revision === baseRevision);
    if (!base) return { ok: false, error: `stale revision: ${baseRevision} is not a known revision (current ${revision})`, currentRevision: revision, stale: staleEntries({ doc, edits, keys: safeTouched(edits), history, baseRevision: 0 }), oldestRevision: history[0].revision, changedKeys: [...new Set(history.slice(1).flatMap((h) => [...h.keys]))].slice(0, 200) };
    let keys;
    try { keys = touched(edits); } catch { return { ok: false, error: 'invalid edit #0: edits must be an array' }; }
    for (const h of history) {
      if (h.revision > baseRevision && conflicts(keys, h.keys)) {
        const stale = staleEntries({ doc, edits, keys, history, baseRevision });
        return { ok: false, error: `stale revision: ${[...keys].join(', ')} changed in revision ${h.revision} (base ${baseRevision})`, currentRevision: revision, stale };
      }
    }
    let next;
    try { next = applyEdits(doc, edits); }
    catch (e) { if (e instanceof EditError) return { ok: false, error: e.message }; throw e; }
    let saved;
    try { saved = codec.save(state, doc, next); }
    catch (e) { return { ok: false, error: `invalid edit #0: could not write the file (${e.message})` }; }
    if (dryRun) return { ok: true, dryRun: true, revision, doc: next, source: saved.text };
    writeFile(saved.text); state = saved.state;
    commit(next, keys, by, edits, origin);
    return { ok: true, revision, doc };
  }

  // The directory, not the file: an atomic rename (ours or git's) replaces the inode.
  const watcher = watch(dirname(file), (_, name) => {
    if (name && name !== basename(file)) return;
    queue = queue.then(() => {
      let t; try { t = readFileSync(file, 'utf8'); } catch { return; }
      if (t === text) { if (broken) problem(null); return; } // back to the last good text (e.g. git restore)
      let loaded; try { loaded = codec.load(t, file, start); } catch (e) {
        if (readOnly) { text = t; readOnly = reason(e); revision++; history.push({ revision, keys: new Set(['file']), by: 'file', summary: 'file changed', at: Date.now() }); if (history.length > HISTORY) history.shift(); events.emit('change', { revision, doc: null, by: 'file', summary: 'file changed' }); }
        else problem(reason(e));
        return;
      } // half-written or broken: keep the last good doc
      if (broken) problem(null);
      const keys = doc ? diffKeys(doc, loaded.doc) : new Set(['file']);
      text = t; state = loaded.state; readOnly = null;
      commit(loaded.doc, keys, 'file', undefined, undefined);
    });
  });

  return {
    events,
    async read() { await queue; return { revision, doc, source: text, ...(readOnly && { readOnly }), ...(broken && { problem: broken }) }; },
    apply(req) { const p = queue.then(() => { const r = applyNow(req); if (!r.ok) r.error = explainError(r.error, { file }); return r; }); queue = p.catch(() => {}); return p; },
    // Recent revisions, newest first: [{ revision, by, summary, at, keys }].
    history(limit = 50) { return history.slice(-Math.max(1, limit)).reverse().map((h) => ({ revision: h.revision, by: h.by, summary: h.summary, at: h.at, keys: [...h.keys] })); },
    async close() { watcher.close(); await queue; },
  };
}
