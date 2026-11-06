// Variant A store: ONE process owns the component. It keeps the document and an integer
// revision counter in memory, plus a short history of which keys each revision changed.
// Every writer (canvas, agent, file) goes through apply(), which is serialised by a promise
// queue, so there are no lock files. External writes (git restore, an editor) are picked up
// by a directory watcher and become a new revision with by "file".
import { explainError } from './errors.js';
import { readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { writeComponent } from './commit.js';
import { cleanStaleTmp, HandSave } from './atomic.js';
import { EventEmitter } from 'node:events';
import { codecFor, readSidecar, writeSidecar } from './codecs.js';
import { summarize } from './summary.js';
import { ADOPTION } from './adopt.js';
import { classifySource } from './scan.js';
import { staleEntries } from './stale.js';
import { checkInstances, pruneSwapped } from './model.js';
import { diffToEdits, undoKeys } from './undo.js';
import { gitAttribution, primeGit } from './git.js';

// Syntax errors from the parser carry loc.line but not "line N:" in the message; dialect errors already do.
// Every reason names a line (INV-04); a file-level problem with no line of its own says line 1.
const rawReason = (e) => (/^line \d+/.test(e.message) ? e.message : `line ${e.loc?.line ?? 1}: ${e.message}`);

// WPC-16: a parser reports where it gave up, which is often the line after the edit (an unclosed tag, a missing quote). Name the first
// line the hand edit changed as well, so the banner points at what was typed. Same line: unchanged.
// Lines of `after` that are not in `before` (an LCS line diff; a pure prefix/suffix fallback for very large files).
function changedLines(before, after) {
  const x = before.split('\n'), y = after.split('\n'), out = new Set();
  let lo = 0; while (lo < x.length && lo < y.length && x[lo] === y[lo]) lo++;
  let hx = x.length, hy = y.length; while (hx > lo && hy > lo && x[hx - 1] === y[hy - 1]) { hx--; hy--; }
  const n = hx - lo, m = hy - lo;
  if (n * m > 4e6) { for (let i = lo; i < hy; i++) out.add(i + 1); return out; }
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[lo + i] === y[lo + j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0;
  while (j < m) { if (i < n && x[lo + i] === y[lo + j]) { i++; j++; } else if (i < n && L[i + 1][j] >= L[i][j + 1]) i++; else { out.add(lo + j + 1); j++; } }
  return out;
}
// The line to name: the parser's own line when the hand edit changed it, else the nearest changed line at or before it (an unclosed tag
// is reported on the line after), else the first changed line after it. Everything in the message names that line; the parser's line is secondary.
function withEditedLine(why, e, before, after) {
  const parser = e.loc?.line; if (!parser || typeof before !== 'string') return why;
  const changed = [...changedLines(before, after)].sort((a, b) => a - b);
  const reflowed = changed.length >= 0.9 * after.split('\n').filter((l) => l.trim()).length; // the whole file changed (reformatted): every line is "changed", so say where the parser stopped too
  if (!changed.length) return why;
  if (changed.includes(parser)) return reflowed ? why + ` (the parser stopped at line ${parser})` : why;
  const edited = [...changed].reverse().find((l) => l <= parser) ?? changed[0];
  return why.replace(new RegExp(`\\bline ${parser}\\b`, 'g'), `line ${edited}`) + ` (the parser stopped at line ${parser})`;
}

// Revisions are content hashes (HIS-04): the first 16 hex digits of the sha256 of the file's bytes. They survive a server restart,
// so a client holding one from before the restart can still commit when the file has not changed. Clients treat them as opaque.
export const revisionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
// The answer for every write while the file on disk does not parse (a hand edit in progress): napkin never writes over it.
export const brokenMessage = (file, why) => `${basename(file)} has a syntax error at ${/line \d+/.exec(why)?.[0] ?? 'line 1'}; fix it (or undo the hand edit), then retry. napkin won't overwrite your text.${/\(the parser stopped at line \d+\)/.exec(why)?.[0]?.replace(/^\(the/, ' The').replace(/\)$/, '.') ?? ''}`;
const POLL_MS = 400; // safety net for a missed file-system event; FMT-07 wants a hand edit seen within 1 s

const HISTORY = 500;
const FULL = 3; // the newest revisions keep their document and text in memory; older ones keep the text compressed and rebuild the document when asked (REL-04: memory flat over a long session)
const STACK = 100; // undo steps remembered per caller // revisions remembered for rebasing; older bases are "stale revision"

// start: { revision, by, summary } seeds the first history entry (create and rename record themselves there).
export async function openStore(file, start = {}) {
  const displayFile = start.displayFile || basename(file);
  let classification;
  const reason = (e, source = text, relocate = true) => { classification = classifySource(source, displayFile, { relocate }); return classification.reason || explainError(rawReason(e), { file: displayFile }); };
  const codec = codecFor(file);
  const { applyEdits, touched, conflicts, diffKeys, EditError } = codec;
  const events = new EventEmitter();
  cleanStaleTmp(file);
  let text = readFileSync(file, 'utf8');
  // A file napkin can't read fully opens read-only, with the reason (decision 0003, INV-06).
  let doc = null, state = null, readOnly = null;
  let syntaxErr = null; // the reason, while the text on disk does not even parse (a hand edit in progress): nothing may overwrite it
  try { ({ doc, state } = codec.load(text, file, start)); } catch (e) { readOnly = reason(e); if (e.loc) syntaxErr = readOnly; }
  let revision = revisionOf(text);
  let seq = 1;
  const history = [{ seq, revision, keys: new Set(), by: start.by || 'file', summary: start.summary || 'opened', at: Date.now(), kind: start.by ? 'edit' : 'open', ...(start.approvedBy && { approvedBy: start.approvedBy }), doc, text }];
  // A past revision's text and document. Old entries hold the text deflated and no document (see FULL).
  const textOf = (h) => (typeof h.text === 'string' ? h.text : Buffer.isBuffer(h.text) ? inflateSync(h.text).toString('utf8') : undefined);
  const docOf = (h) => {
    if (h.doc !== undefined) return h.doc;
    if (!h.hasDoc) return null;
    try { return codec.load(textOf(h), file, { ...start, writeSidecars: false }).doc; } catch { return null; }
  };
  // (deflateSync's output keeps the ~20 KB chunk it was built in alive: copy it into a buffer of exactly its size)
  const exact = (b) => { const out = Buffer.allocUnsafeSlow(b.length); b.copy(out); return out; };
  const age = () => {
    const h = history[history.length - 1 - FULL];
    if (!h || typeof h.text !== 'string') return;
    h.hasDoc = !!h.doc; h.doc = undefined; h.text = exact(deflateSync(h.text));
  };
  const stacks = new Map(); // caller -> { undo: [{ revision, keys, edits, summary }], redo: [...] } (HIS-01: your own edits only)
  const stackOf = (by) => { if (!stacks.has(by)) stacks.set(by, { undo: [], redo: [] }); return stacks.get(by); };
  let queue = Promise.resolve();
  try { primeGit(file); } catch {} // remembers stash texts so a later `git stash pop` is recognised
  let broken = null; // the error of a hand edit the last good doc could not absorb (F22), else null
  const problem = (error) => { broken = error ? explainError(error, { file: displayFile }) : null; events.emit('problem', { error: broken && explainError(broken, { file: displayFile }) }); };

  // meta (server-internal): { summary, kind, approvedBy, undoOf, redoOf, restoreOf }; kind 'git' is a change git made.
  const commit = (next, keys, by, edits, origin, meta = {}) => {
    doc = next; revision = revisionOf(text);
    const summary = meta.summary ?? summarize(edits), at = Date.now();
    const { summary: _s, restoreText: _r, ...extra } = meta;
    history.push({ seq: ++seq, revision, keys, by, summary, at, kind: meta.kind || (edits ? 'edit' : by), doc: next, text, ...extra });
    if (history.length > HISTORY) history.shift();
    age();
    events.emit('change', { revision, by, edits, origin, doc, summary, at, source: text, ...(meta.approvedBy && { approvedBy: meta.approvedBy }), ...(meta.kind && { kind: meta.kind }) });
  };

  const commitText = (t) => { writeComponent(file, t); text = t; }; // (the adoption path; edits write with a guard below)

  // Look at the file on disk. If someone else changed it, that becomes a revision (by "file", or "git") first.
  // Returns the reason when the file on disk can't be absorbed (half-written or outside the dialect), else null.
  function absorbDisk() {
    let t; try { t = readFileSync(file, 'utf8'); } catch { return null; }
    if (t === text) { // back to the text we hold: if that is the last good text (undo, git restore) the file is fine again
      if (broken) problem(null);
      if (state) syntaxErr = null;
      return syntaxErr;
    }
    let loaded; try { loaded = codec.load(t, file, start); } catch (e) {
      const why = readOnly ? reason(e, t) : withEditedLine(reason(e, t, false), e, text, t);
      if (readOnly) { text = t; readOnly = why; syntaxErr = e.loc ? why : null; revision = revisionOf(text); history.push({ seq: ++seq, revision, keys: new Set(['file']), by: 'file', summary: 'file changed', at: Date.now() }); if (history.length > HISTORY) history.shift(); events.emit('change', { revision, doc: null, by: 'file', summary: 'file changed' }); return syntaxErr; }
      problem(why); syntaxErr = e.loc ? why : null;
      return why; // half-written or broken: keep the last good doc, and write nothing over it
    }
    syntaxErr = null;
    if (broken) problem(null);
    const keys = doc ? diffKeys(doc, loaded.doc) : new Set(['file']);
    text = t; state = loaded.state; readOnly = null;
    const git = gitAttribution(file, t); // a checkout, restore or merge is "git", not "file"
    commit(loaded.doc, keys, git ? git.by : 'file', undefined, undefined, git ? { kind: 'git', summary: git.summary } : {});
    return null;
  }

  // The file changed on disk between our last look and the rename: nothing was replaced; look again and redo the batch.
  class Raced extends Error {}
  function applyRetrying(request, meta = {}) {
    for (let i = 0; i < 5; i++) {
      try { return applyNow(request, meta); }
      catch (e) { if (!(e instanceof Raced)) throw e; }
    }
    return { ok: false, error: 'stale revision: the file kept changing on disk while saving; read it again and retry' };
  }

  // dryRun: validate and produce the would-be file without writing or committing (F19).
  function applyNow(request, meta = {}) {
    const { baseRevision, edits, by, origin, dryRun = false } = request;
    const adoption = request[ADOPTION];
    // A hand edit that landed a moment ago must not be overwritten: take it in before judging this batch.
    const disk = adoption ? null : absorbDisk();
    if (adoption) {
      if (typeof by !== 'string' || !by.trim() || by === 'unknown') return { ok: false, error: 'by is required: every revision names a real caller. Next: supply your session identity.' };
      let diskSource; try { diskSource = readFileSync(file, 'utf8'); } catch { diskSource = null; }
      if (baseRevision !== revision || diskSource !== adoption.before) return { ok: false, error: `stale revision: ${displayFile} changed after the adoption proposal. Next: reject it and propose_adoption again.`, currentRevision: revision };
      if (!readOnly) return { ok: false, error: `invalid edit #0: ${displayFile} is already editable. Next: use apply_edits.` };
      let loaded;
      try { loaded = codec.load(adoption.source, file, { ...start, writeSidecars: dryRun ? false : start.writeSidecars }); } catch (e) { return { ok: false, error: `invalid edit #0: ${displayFile}: ${reason(e)}. Next: correct the adoption proposal.` }; }
      if (dryRun) return { ok: true, dryRun: true, revision, doc: loaded.doc, source: adoption.source };
      commitText(adoption.source); state = loaded.state; readOnly = null;
      commit(loaded.doc, new Set(['file']), by, [{ op: 'adoption' }], origin);
      return { ok: true, revision, doc };
    }
    // a hand edit that is not valid TSX is a syntax error; one that is valid but outside the dialect makes the file read-only, and says so
    if (disk && !dryRun) return { ok: false, error: /syntax error/i.test(disk) ? brokenMessage(file, disk) : `read-only: ${disk}`, problem: disk }; // (a dry run may still check the edit against the last good document)
    if (readOnly) return { ok: false, error: `read-only: ${readOnly}` };
    // every revision names a real caller (AGT-05); a dry run makes none
    if (!dryRun && (typeof by !== 'string' || !by.trim() || by.trim().toLowerCase() === 'unknown')) return { ok: false, error: 'by is required: every revision names a real caller' };
    const safeTouched = (e) => { try { return touched(e); } catch { return new Set(); } };
    // The last time this revision was current: an edit based on content that came back (A, B, A) is based on A.
    let at = -1;
    for (let i = history.length - 1; i >= 0; i--) if (history[i].revision === baseRevision) { at = i; break; }
    if (at < 0) return { ok: false, error: `stale revision: ${baseRevision} is not a known revision (current ${revision})`, currentRevision: revision, stale: staleEntries({ doc, edits, keys: safeTouched(edits), history, baseAt: 0 }), oldestRevision: history[0].revision, changedKeys: [...new Set(history.slice(1).flatMap((h) => [...h.keys]))].slice(0, 200) };
    let keys;
    try { keys = touched(edits); } catch { return { ok: false, error: 'invalid edit #0: edits must be an array' }; }
    for (const h of history.slice(at + 1)) {
      if (conflicts(keys, h.keys)) {
        const stale = staleEntries({ doc, edits, keys, history, baseAt: at });
        return { ok: false, error: `stale revision: ${(stale.length ? stale.map((s) => s.key) : [...keys]).join(', ')} changed in revision ${h.revision} (base ${baseRevision})`, currentRevision: revision, stale };
      }
    }
    let next;
    try { next = applyEdits(doc, edits); }
    catch (e) { if (e instanceof EditError) return { ok: false, error: e.message }; throw e; }
    if (start.components) { // other components this one uses: they must exist, fit and not make a cycle
      const lookup = (n) => start.components.lookup(n, file);
      next = pruneSwapped(next, edits, lookup);
      const bad = checkInstances(next, lookup);
      if (bad) return { ok: false, error: `invalid edit #0: ${bad}` };
    }
    let saved;
    try { saved = codec.save(state, doc, next); }
    catch (e) { return { ok: false, error: `invalid edit #0: could not write the file (${e.message})` }; }
    // undo, redo and restore bring back text the file really had: if that text reads as the same document, write it exactly
    if (meta.restoreText !== undefined && meta.restoreText !== saved.text) {
      try {
        const alt = codec.load(meta.restoreText, file, { ...start, writeSidecars: false });
        const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v); // (object key order is not part of the document; array order is)
        const bare = ({ id, ...rest }) => JSON.stringify(canon(rest));
        if (bare(alt.doc) === bare(next)) saved = { text: meta.restoreText, state: alt.state };
      } catch { /* not readable: keep the written text */ }
    }
    if (dryRun) { // `written` is the document read back from the text that would be written: what a reader of the file would see (the paste check renders this)
      let written; try { written = codec.load(saved.text, file, { ...start, writeSidecars: false }).doc; } catch (e) { return { ok: false, error: `invalid edit #0: the file as it would be written does not read back (${e.message})` }; }
      return { ok: true, dryRun: true, revision, doc: next, source: saved.text, written };
    }
    if (saved.text !== text) { // a batch that changes nothing leaves the file (and its mtime) alone
      try {
        // the guard link and the check catch a hand save that lands between our last look at the file and the rename
        writeComponent(file, saved.text, { guard: text, check: () => { let now; try { now = readFileSync(file, 'utf8'); } catch { return; } if (now !== text) throw new Raced(); } });
      } catch (e) {
        if (!(e instanceof HandSave)) throw e;
        absorbDisk(); // the user's text won: it is the new state of the file
        return { ok: false, error: `stale revision: ${basename(file)} changed on disk while saving; reread and retry`, currentRevision: revision, plain: true };
      }
    }
    if (saved.text === text && !meta.kind && edits.every((e) => e?.op === 'move')) { state = saved.state; return { ok: true, revision, doc, noop: true }; } // a move to the place the node already has: no new revision, nothing to undo (a set to the same value still counts as a claim on that key)
    text = saved.text; state = saved.state;
    commit(next, keys, by, edits, origin, meta);
    if (meta.kind !== 'undo' && meta.kind !== 'redo') { // an ordinary edit (or a restore) can be undone, and it ends this caller's redo line
      const st = stackOf(by);
      st.redo.length = 0; st.undo.push({ revision, seq: history.at(-1).seq, keys: undoKeys(edits), edits, summary: history.at(-1).summary });
      if (st.undo.length > STACK) st.undo.shift();
    }
    return { ok: true, revision, doc };
  }

  const refuse = (error, extra) => ({ ok: false, error: explainError(error, { file: displayFile }), ...extra });
  // Someone else's later change to one of these keys makes the step unsafe: who, which revision, which keys.
  function clash(after, keys, by, verb) {
    for (let j = after + 1; j < history.length; j++) {
      const h = history[j];
      if (h.by === by) continue;
      const hit = [...keys].filter((k) => conflicts(new Set([k]), h.keys));
      if (hit.length) return refuse(`${verb} refused: ${h.by} changed ${hit.join(', ')} in revision ${h.revision} after your edit`, { refused: { by: h.by, revision: h.revision, keys: hit } });
    }
    return null;
  }
  // Revisions are content hashes, so the same one can appear twice (A, B, A): undo and redo name a history entry by its own number.
  const whereSeq = (n) => history.findIndex((h) => h.seq === n);
  const where = (rev) => history.findLastIndex((h) => h.revision === rev || String(h.revision) === String(rev)); // revisions are opaque: equality only (a query string arrives as text); the last time one was current

  // HIS-01/02: undo the caller's own latest edit by writing the old values back, as a new revision by the caller.
  function undoNow(by, origin, skip = false) {
    if (readOnly) return refuse(`read-only: ${readOnly}`);
    // skip: drop the step that was refused (it stays in the history, but can no longer be undone) and undo the one below it
    const skipped = skip ? stacks.get(by)?.undo.pop() : null;
    const top = stacks.get(by)?.undo.at(-1);
    if (!top) return refuse('nothing to undo', skipped && { skipped: { revision: skipped.revision, summary: skipped.summary } });
    const i = whereSeq(top.seq);
    if (i < 1) return refuse('cannot undo: that revision is older than the history this server keeps');
    const c = clash(i, top.keys, by, 'undo');
    if (c) return c;
    const inverse = diffToEdits(docOf(history[i]), docOf(history[i - 1]));
    if (!inverse) return refuse('cannot undo: the edit cannot be reversed exactly');
    const undone = { revision: top.revision, summary: top.summary };
    if (!inverse.length) { stacks.get(by).undo.pop(); return { ok: true, revision, doc, noop: true, undone }; }
    const r = applyRetrying({ baseRevision: revision, edits: inverse, by, origin }, { restoreText: text === textOf(history[i]) ? textOf(history[i - 1]) : undefined, kind: 'undo', undoOf: top.revision, summary: `undo: ${top.summary}` });
    if (!r.ok) return refuse(`cannot undo: ${r.error}`);
    const st = stackOf(by); st.undo.pop(); st.redo.push({ ...top, undoRevision: revision, undoSeq: history.at(-1).seq });
    return { ...r, undone, ...(skipped && { skipped: { revision: skipped.revision, summary: skipped.summary } }) };
  }
  function redoNow(by, origin, skip = false) {
    if (readOnly) return refuse(`read-only: ${readOnly}`);
    if (skip) stacks.get(by)?.redo.pop();
    const top = stacks.get(by)?.redo.at(-1);
    if (!top) return refuse('nothing to redo');
    const i = whereSeq(top.undoSeq);
    if (i < 0) return refuse('cannot redo: that revision is older than the history this server keeps');
    const c = clash(i, top.keys, by, 'redo');
    if (c) return c;
    const orig = history[whereSeq(top.seq)];
    const r = applyRetrying({ baseRevision: revision, edits: top.edits, by, origin }, { restoreText: orig && text === textOf(history[i]) ? textOf(orig) : undefined, kind: 'redo', redoOf: top.revision, summary: `redo: ${top.summary}` });
    if (!r.ok) return refuse(`cannot redo: ${r.error}`);
    const st = stackOf(by); st.redo.pop(); st.undo.push({ revision, seq: history.at(-1).seq, keys: top.keys, edits: top.edits, summary: top.summary });
    return { ...r, redone: { revision: top.revision, summary: top.summary } };
  }
  // HIS-03: make the document what it was after `target`, as ONE new revision by the caller.
  function restoreNow(target, by, origin) {
    if (readOnly) return refuse(`read-only: ${readOnly}`);
    const t = history[where(target)], then = t && docOf(t);
    if (!then) return refuse(`revision ${target} is not in the history this server keeps`);
    const edits = diffToEdits(doc, then);
    if (!edits) return refuse('cannot restore: the difference cannot be written as edits exactly');
    if (!edits.length) return { ok: true, revision, doc, noop: true };
    return applyRetrying({ baseRevision: revision, edits, by, origin }, { restoreText: textOf(t), kind: 'restore', restoreOf: target, summary: `restore to r${target}: ${t.summary}` });
  }

  // Server-internal: a change that spanned several files failed in a later one, so this file goes back to exactly the text it had at `target`
  // (a new revision by the caller, never a rewrite of history). Undo cannot do this for renames, which it cannot reverse exactly.
  function revertNow(target, by, summary) {
    if (readOnly) return refuse(`read-only: ${readOnly}`);
    const i = where(target), t = history[i];
    if (!t?.text) return refuse(`revision ${target} is not in the history this server keeps`);
    if (t.text === text) return { ok: true, revision, doc, noop: true };
    let loaded;
    try { loaded = codec.load(t.text, file, { ...start, writeSidecars: false }); } catch (e) { return refuse(`cannot go back: ${reason(e)}`); }
    const keys = new Set(history.slice(i + 1).flatMap((h) => [...h.keys]));
    try { writeComponent(file, t.text, { guard: text, check: () => { let now; try { now = readFileSync(file, 'utf8'); } catch { return; } if (now !== text) throw new Raced(); } }); }
    catch (e) { if (e instanceof Raced || e instanceof HandSave) { absorbDisk(); return refuse(`stale revision: ${basename(file)} changed on disk while going back`); } throw e; }
    text = t.text; state = loaded.state;
    commit(loaded.doc, keys, by, undefined, undefined, { kind: 'revert', summary });
    return { ok: true, revision, doc };
  }

  const settle = () => { queue = queue.then(() => { absorbDisk(); }).catch(() => {}); };
  // The directory, not the file: an atomic rename (ours or git's) replaces the inode.
  const watcher = watch(dirname(file), (_, name) => {
    if (name && name !== basename(file)) return;
    settle();
  });
  const poll = setInterval(settle, POLL_MS);
  poll.unref();

  // Where the component sits on the canvas lives in the sidecar, never in the .tsx (FMT-02, FMT-06).
  function moveCanvas(x, y) {
    if (![x, y].every((n) => typeof n === 'number' && Number.isFinite(n))) return { ok: false, error: 'invalid canvas position: x and y must be numbers. Next: send x and y as finite numbers.' };
    const side = readSidecar(file, basename(file).replace(/\.tsx$/, ''), { identityPath: displayFile });
    const canvas = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    if (side.canvas?.x !== canvas.x || side.canvas?.y !== canvas.y) writeSidecar(file, { ...side, canvas });
    events.emit('canvas', { canvas });
    return { ok: true, canvas };
  }

  return {
    events,
    async read() { await queue; return { revision, doc, source: text, classification, ...(readOnly && { readOnly }), ...(broken && { problem: broken }) }; },
    // meta is for the server's own callers (approvedBy); HTTP bodies never reach it.
    apply(req, meta = {}) { const p = queue.then(() => { const r = applyRetrying(req, { approvedBy: meta.approvedBy, ...(meta.summary && { summary: meta.summary }) }); if (!r.ok && !r.problem && !r.plain) r.error = explainError(r.error, { file: displayFile }); return r; }); queue = p.catch(() => {}); return p; },
    // Look at the disk now; resolves null when the file is fine, else the reason it does not parse (file-level writes ask before they touch it).
    sync() { const p = queue.then(() => absorbDisk()); queue = p.catch(() => {}); return p; },
    moveCanvas(x, y) { const p = queue.then(() => moveCanvas(x, y)); queue = p.catch(() => {}); return p; },
    undo(by, origin, opts = {}) { const p = queue.then(() => undoNow(by, origin, !!opts.skip)); queue = p.catch(() => {}); return p; },
    redo(by, origin, opts = {}) { const p = queue.then(() => redoNow(by, origin, !!opts.skip)); queue = p.catch(() => {}); return p; },
    revert(target, by, summary) { const p = queue.then(() => revertNow(target, by, summary)); queue = p.catch(() => {}); return p; },
    restore(target, by, origin) { const p = queue.then(() => restoreNow(target, by, origin)); queue = p.catch(() => {}); return p; },
    // Everything a restore to `rev` would take back: the revisions after it, [{ revision, by, summary, kind }], oldest first; null if unknown.
    overwrittenBy(rev) { const i = where(rev); return i < 0 ? null : history.slice(i + 1).map((h) => ({ revision: h.revision, by: h.by, summary: h.summary, kind: h.kind })); },
    // The newest step this caller could undo or redo: { revision, at, summary } | null (to pick a component for a global undo).
    undoTop(by) { const t = stacks.get(by)?.undo.at(-1); return t ? { revision: t.revision, summary: t.summary, at: history[whereSeq(t.seq)]?.at ?? 0 } : null; },
    redoTop(by) { const t = stacks.get(by)?.redo.at(-1); return t ? { revision: t.revision, summary: t.summary, at: history[whereSeq(t.undoSeq)]?.at ?? 0 } : null; },
    // The document and file text as they were after a past revision (for preview and restore), or null.
    at(rev) { const h = history[where(rev)], d = h && docOf(h); return d ? { revision: h.revision, by: h.by, summary: h.summary, at: h.at, doc: d, source: textOf(h) } : null; },
    // Recent revisions, newest first: [{ revision, by, summary, at, keys }].
    history(limit = 50) { return history.slice(-Math.max(1, limit)).reverse().map((h) => ({ revision: h.revision, by: h.by, summary: h.summary, at: h.at, keys: [...h.keys], kind: h.kind, ...(h.approvedBy && { approvedBy: h.approvedBy }), ...(h.undoOf !== undefined && { undoOf: h.undoOf }), ...(h.redoOf !== undefined && { redoOf: h.redoOf }), ...(h.restoreOf !== undefined && { restoreOf: h.restoreOf }) })); },
    async close() { clearInterval(poll); watcher.close(); await queue; },
  };
}
