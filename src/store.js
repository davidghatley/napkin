// Variant A store: ONE process owns the component. It keeps the document and an integer
// revision counter in memory, plus a short history of which keys each revision changed.
// Every writer (canvas, agent, file) goes through apply(), which is serialised by a promise
// queue, so there are no lock files. External writes (git restore, an editor) are picked up
// by a directory watcher and become a new revision with by "file".
import { readFileSync, writeFileSync, renameSync, watch } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { parse, serialize } from './format.js';
import { applyEdits, touched, conflicts, diffKeys, EditError } from './edits.js';

const HISTORY = 500; // revisions remembered for rebasing; older bases are "stale revision"

export async function openStore(file) {
  const events = new EventEmitter();
  let text = readFileSync(file, 'utf8');
  let doc = parse(text);
  let revision = 1;
  const history = [{ revision, keys: new Set() }];
  let queue = Promise.resolve();

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

  function applyNow({ baseRevision, edits, by = 'unknown', origin }) {
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
    writeFile(serialize(next));
    commit(next, keys, by, edits, origin);
    return { ok: true, revision, doc };
  }

  // The directory, not the file: an atomic rename (ours or git's) replaces the inode.
  const watcher = watch(dirname(file), (_, name) => {
    if (name && name !== basename(file)) return;
    queue = queue.then(() => {
      let t; try { t = readFileSync(file, 'utf8'); } catch { return; }
      if (t === text) return;
      let next; try { next = parse(t); } catch { return; } // half-written or broken: keep the last good doc
      const keys = diffKeys(doc, next);
      text = t;
      commit(next, keys, 'file', undefined, undefined);
    });
  });

  return {
    events,
    async read() { await queue; return { revision, doc }; },
    apply(req) { const p = queue.then(() => applyNow(req)); queue = p.catch(() => {}); return p; },
    async close() { watcher.close(); await queue; },
  };
}
