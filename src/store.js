// Variant A store: ONE process owns the component. It keeps the document and an integer
// revision counter in memory, plus a short history of which keys each revision changed.
// Every writer (canvas, agent, file) goes through apply(), which is serialised by a promise
// queue, so there are no lock files. External writes (git restore, an editor) are picked up
// by a directory watcher and become a new revision with by "file".
import { readFileSync, writeFileSync, renameSync, watch } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { codecFor } from './codecs.js';

// Syntax errors from the parser carry loc.line but not "line N:" in the message; dialect errors already do.
const reason = (e) => (e.loc?.line && !/^line \d+/.test(e.message) ? `line ${e.loc.line}: ${e.message}` : e.message);

const HISTORY = 500; // revisions remembered for rebasing; older bases are "stale revision"

export async function openStore(file) {
  const codec = codecFor(file);
  const { applyEdits, touched, conflicts, diffKeys, EditError } = codec;
  const events = new EventEmitter();
  let text = readFileSync(file, 'utf8');
  // A file napkin can't read fully opens read-only, with the reason (decision 0003, INV-06).
  let doc = null, state = null, readOnly = null;
  try { ({ doc, state } = codec.load(text, file)); } catch (e) { readOnly = reason(e); }
  let revision = 1;
  const history = [{ revision, keys: new Set() }];
  let queue = Promise.resolve();
  let broken = null; // the error of a hand edit the last good doc could not absorb (F22), else null
  const problem = (error) => { broken = error; events.emit('problem', { error }); };

  const commit = (next, keys, by, edits, origin) => {
    doc = next; revision += 1;
    history.push({ revision, keys });
    if (history.length > HISTORY) history.shift();
    events.emit('change', { revision, by, edits, origin, doc });
  };

  const writeFile = (t) => {
    const tmp = join(dirname(file), `.${basename(file)}.tmp-${process.pid}`);
    writeFileSync(tmp, t); renameSync(tmp, file); text = t;
  };

  // dryRun: validate and produce the would-be file without writing or committing (F19).
  function applyNow({ baseRevision, edits, by = 'unknown', origin, dryRun = false }) {
    if (readOnly) return { ok: false, error: `read-only: ${readOnly}` };
    const base = history.find((h) => h.revision === baseRevision);
    if (!base) return { ok: false, error: `stale revision: ${baseRevision} is not a known revision (current ${revision})` };
    let keys;
    try { keys = touched(edits); } catch { return { ok: false, error: 'invalid edit #0: edits must be an array' }; }
    for (const h of history) {
      if (h.revision > baseRevision && conflicts(keys, h.keys)) {
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
      let loaded; try { loaded = codec.load(t, file); } catch (e) { problem(reason(e)); return; } // half-written or broken: keep the last good doc
      if (broken) problem(null);
      const keys = doc ? diffKeys(doc, loaded.doc) : new Set(['file']);
      text = t; state = loaded.state; readOnly = null;
      commit(loaded.doc, keys, 'file', undefined, undefined);
    });
  });

  return {
    events,
    async read() { await queue; return { revision, doc, source: text, ...(readOnly && { readOnly }), ...(broken && { problem: broken }) }; },
    apply(req) { const p = queue.then(() => applyNow(req)); queue = p.catch(() => {}); return p; },
    async close() { watcher.close(); await queue; },
  };
}
