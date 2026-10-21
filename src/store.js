// Variant A store: ONE process owns the component. It keeps the document and an integer
// revision counter in memory, plus a short history of which keys each revision changed.
// Every writer (canvas, agent, file) goes through apply(), which is serialised by a promise
// queue, so there are no lock files. External writes (git restore, an editor) are picked up
// by a directory watcher and become a new revision with by "file".
import { readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { writeComponent } from './commit.js';
import { EventEmitter } from 'node:events';
import { codecFor } from './codecs.js';
import { summarize } from './summary.js';
import { staleEntries } from './stale.js';
import { diffToEdits } from './undo.js';
import { gitAttribution } from './git.js';

// Syntax errors from the parser carry loc.line but not "line N:" in the message; dialect errors already do.
const reason = (e) => (e.loc?.line && !/^line \d+/.test(e.message) ? `line ${e.loc.line}: ${e.message}` : e.message);

const HISTORY = 500;
const STACK = 100; // undo steps remembered per caller // revisions remembered for rebasing; older bases are "stale revision"

// start: { revision, by, summary } seeds the first history entry (create and rename record themselves there).
export async function openStore(file, start = {}) {
  const codec = codecFor(file);
  const { applyEdits, touched, conflicts, diffKeys, EditError } = codec;
  const events = new EventEmitter();
  let text = readFileSync(file, 'utf8');
  // A file napkin can't read fully opens read-only, with the reason (decision 0003, INV-06).
  let doc = null, state = null, readOnly = null;
  try { ({ doc, state } = codec.load(text, file)); } catch (e) { readOnly = reason(e); }
  let revision = start.revision ?? 1;
  const history = [{ revision, keys: new Set(), by: start.by || 'file', summary: start.summary || 'opened', at: Date.now(), kind: start.by ? 'edit' : 'open', doc, text }];
  const stacks = new Map(); // caller -> { undo: [{ revision, keys, edits, summary }], redo: [...] } (HIS-01: your own edits only)
  const stackOf = (by) => { if (!stacks.has(by)) stacks.set(by, { undo: [], redo: [] }); return stacks.get(by); };
  let queue = Promise.resolve();
  let broken = null; // the error of a hand edit the last good doc could not absorb (F22), else null
  const problem = (error) => { broken = error; events.emit('problem', { error }); };

  // meta (server-internal): { summary, kind, approvedBy, undoOf, redoOf, restoreOf }; kind 'git' is a change git made.
  const commit = (next, keys, by, edits, origin, meta = {}) => {
    doc = next; revision += 1;
    const summary = meta.summary ?? summarize(edits), at = Date.now();
    const { summary: _s, ...extra } = meta;
    history.push({ revision, keys, by, summary, at, kind: meta.kind || (edits ? 'edit' : by), doc: next, text, ...extra });
    if (history.length > HISTORY) history.shift();
    events.emit('change', { revision, by, edits, origin, doc, summary, at, source: text, ...(meta.approvedBy && { approvedBy: meta.approvedBy }), ...(meta.kind && { kind: meta.kind }) });
  };

  const writeFile = (t) => { writeComponent(file, t); text = t; };

  // dryRun: validate and produce the would-be file without writing or committing (F19).
  function applyNow({ baseRevision, edits, by, origin, dryRun = false }, meta = {}) {
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
    commit(next, keys, by, edits, origin, meta);
    if (meta.kind !== 'undo' && meta.kind !== 'redo') { // an ordinary edit (or a restore) can be undone, and it ends this caller's redo line
      const st = stackOf(by);
      st.redo.length = 0; st.undo.push({ revision, keys, edits, summary: history.at(-1).summary });
      if (st.undo.length > STACK) st.undo.shift();
    }
    return { ok: true, revision, doc };
  }

  const fail = (error, extra) => ({ ok: false, error, ...extra });
  // Someone else's later change to one of these keys makes the step unsafe: who, which revision, which keys.
  function clash(after, keys, by, verb) {
    for (let j = after + 1; j < history.length; j++) {
      const h = history[j];
      if (h.by === by) continue;
      const hit = [...keys].filter((k) => conflicts(new Set([k]), h.keys));
      if (hit.length) return fail(`${verb} refused: ${h.by} changed ${hit.join(', ')} in revision ${h.revision} after your edit`, { refused: { by: h.by, revision: h.revision, keys: hit } });
    }
    return null;
  }
  const where = (rev) => history.findIndex((h) => h.revision === rev || String(h.revision) === String(rev)); // revisions are opaque: equality only (a query string arrives as text)

  // HIS-01/02: undo the caller's own latest edit by writing the old values back, as a new revision by the caller.
  function undoNow(by, origin) {
    if (readOnly) return fail(`read-only: ${readOnly}`);
    const top = stacks.get(by)?.undo.at(-1);
    if (!top) return fail('nothing to undo');
    const i = where(top.revision);
    if (i < 1) return fail('cannot undo: that revision is older than the history this server keeps');
    const c = clash(i, top.keys, by, 'undo');
    if (c) return c;
    const inverse = diffToEdits(history[i].doc, history[i - 1].doc);
    if (!inverse) return fail('cannot undo: the edit cannot be reversed exactly');
    const undone = { revision: top.revision, summary: top.summary };
    if (!inverse.length) { stacks.get(by).undo.pop(); return { ok: true, revision, doc, noop: true, undone }; }
    const r = applyNow({ baseRevision: revision, edits: inverse, by, origin }, { kind: 'undo', undoOf: top.revision, summary: `undo: ${top.summary}` });
    if (!r.ok) return fail(`cannot undo: ${r.error}`);
    const st = stackOf(by); st.undo.pop(); st.redo.push({ ...top, undoRevision: revision });
    return { ...r, undone };
  }
  function redoNow(by, origin) {
    if (readOnly) return fail(`read-only: ${readOnly}`);
    const top = stacks.get(by)?.redo.at(-1);
    if (!top) return fail('nothing to redo');
    const i = where(top.undoRevision);
    if (i < 0) return fail('cannot redo: that revision is older than the history this server keeps');
    const c = clash(i, top.keys, by, 'redo');
    if (c) return c;
    const r = applyNow({ baseRevision: revision, edits: top.edits, by, origin }, { kind: 'redo', redoOf: top.revision, summary: `redo: ${top.summary}` });
    if (!r.ok) return fail(`cannot redo: ${r.error}`);
    const st = stackOf(by); st.redo.pop(); st.undo.push({ revision, keys: top.keys, edits: top.edits, summary: top.summary });
    return { ...r, redone: { revision: top.revision, summary: top.summary } };
  }
  // HIS-03: make the document what it was after `target`, as ONE new revision by the caller.
  function restoreNow(target, by, origin) {
    if (readOnly) return fail(`read-only: ${readOnly}`);
    const t = history[where(target)];
    if (!t?.doc) return fail(`revision ${target} is not in the history this server keeps`);
    const edits = diffToEdits(doc, t.doc);
    if (!edits) return fail('cannot restore: the difference cannot be written as edits exactly');
    if (!edits.length) return { ok: true, revision, doc, noop: true };
    return applyNow({ baseRevision: revision, edits, by, origin }, { kind: 'restore', restoreOf: target, summary: `restore to r${target}: ${t.summary}` });
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
      const git = gitAttribution(file, t); // a checkout, restore or merge is "git", not "file"
      commit(loaded.doc, keys, git ? git.by : 'file', undefined, undefined, git ? { kind: 'git', summary: git.summary } : {});
    });
  });

  return {
    events,
    async read() { await queue; return { revision, doc, source: text, ...(readOnly && { readOnly }), ...(broken && { problem: broken }) }; },
    // meta is for the server's own callers (approvedBy); HTTP bodies never reach it.
    apply(req, meta = {}) { const p = queue.then(() => applyNow(req, { approvedBy: meta.approvedBy })); queue = p.catch(() => {}); return p; },
    undo(by, origin) { const p = queue.then(() => undoNow(by, origin)); queue = p.catch(() => {}); return p; },
    redo(by, origin) { const p = queue.then(() => redoNow(by, origin)); queue = p.catch(() => {}); return p; },
    restore(target, by, origin) { const p = queue.then(() => restoreNow(target, by, origin)); queue = p.catch(() => {}); return p; },
    // The newest step this caller could undo or redo: { revision, at, summary } | null (to pick a component for a global undo).
    undoTop(by) { const t = stacks.get(by)?.undo.at(-1); return t ? { revision: t.revision, summary: t.summary, at: history[where(t.revision)]?.at ?? 0 } : null; },
    redoTop(by) { const t = stacks.get(by)?.redo.at(-1); return t ? { revision: t.revision, summary: t.summary, at: history[where(t.undoRevision)]?.at ?? 0 } : null; },
    // The document and file text as they were after a past revision (for preview and restore), or null.
    at(rev) { const h = history[where(rev)]; return h?.doc ? { revision: h.revision, by: h.by, summary: h.summary, at: h.at, doc: h.doc, source: h.text } : null; },
    // Recent revisions, newest first: [{ revision, by, summary, at, keys }].
    history(limit = 50) { return history.slice(-Math.max(1, limit)).reverse().map((h) => ({ revision: h.revision, by: h.by, summary: h.summary, at: h.at, keys: [...h.keys], kind: h.kind, ...(h.approvedBy && { approvedBy: h.approvedBy }), ...(h.undoOf !== undefined && { undoOf: h.undoOf }), ...(h.redoOf !== undefined && { redoOf: h.redoOf }), ...(h.restoreOf !== undefined && { restoreOf: h.restoreOf }) })); },
    async close() { watcher.close(); await queue; },
  };
}
