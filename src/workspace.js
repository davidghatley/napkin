// A workspace is a folder of component files: one store per *.tsx (decision 0002 still holds, per file),
// one esbuild context per file (F04), and a folder watcher that picks up files added or removed while
// it runs. Everything the server needs to say about components goes through its `events`.
//   events 'change'  { component, revision, by, edits, origin, doc }   (store change, re-emitted)
//          'problem' { component, error }     a broken hand edit; error null clears it (F22)
//          'added'   { component, by?, summary? }   a file appeared (snapshot via snapshot()); by/summary when napkin made it (create, rename)
//          'removed' { component, by?, summary? }   by/summary when napkin removed it (delete, rename)
// workspace.activity(): the last 200 { at, kind: 'change'|'added'|'removed', component, name, by, summary, revision? }
import { explainError } from './errors.js';
import { watch, existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { EventEmitter } from 'node:events';
import { openStore } from './store.js';
import { readSidecar, sidecarPath } from './codecs.js';
import { createComponent, removeComponent, moveComponent, writeSidecar, removeSidecar } from './commit.js';
import { readComponent } from './tsx/read.js';
import { createBundler } from './bundle.js';
import { componentFiles, formatReport } from './scan.js';
import { newComponentSource } from './tsx/write.js';
import { TAGS, VOID } from './model.js';

// create() failures: `status` is the HTTP code the server answers with (400 bad input, 409 already exists).
export class CreateError extends Error {
  constructor(message, status = 400) { super(explainError(message)); this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; }

// Every file-level commit names a real caller (AGT-05).
// the saved frame position; reading never creates a sidecar (a deleted component must stay deleted)
const canvasOf = (e) => { try { return JSON.parse(readFileSync(sidecarPath(e.file), 'utf8')).canvas ?? { x: 0, y: 0 }; } catch { return { x: 0, y: 0 }; } };
const needBy = (by) => { if (typeof by !== 'string' || !by.trim() || by.trim().toLowerCase() === 'unknown') throw new CreateError('a caller name is required: every commit names who made it'); };

export async function openWorkspace(dir, { only, recursive = false, writeSidecars = true, progressive = false } = {}) {
  dir = resolve(dir);
  const events = new EventEmitter();
  const bundler = createBundler();
  const entries = new Map(); // id -> { id, name, file, store, built }
  let queue = Promise.resolve();
  let closing = false;
  let progress = { scanned: 0, total: 0, done: false };
  const wanted = only ? new Set([basename(only)]) : null;
  const origins = new Map();  // file -> { by, summary, revision? } for files napkin itself is about to create or move in
  const removals = new Map(); // file -> { by, summary } for files napkin itself is about to remove
  const log = [];
  const note = (x) => { log.push({ at: Date.now(), ...x }); if (log.length > 200) log.shift(); };

  const build = (e) => {
    // Builds of one component run one after another, and a bundle is always built from the file as it is on disk.
    const prev = e.built || Promise.resolve();
    e.built = prev.then(() => bundler.build(e.file, e.name, relative(dir, e.file))).then((r) => { e.lastBuild = r; events.emit('build', { component: e.id, ok: r.ok, ms: r.ms, error: r.error }); return r; });
    return e.built;
  };

  async function add(file) {
    const stem = basename(file).replace(/\.tsx$/, '');
    const origin = origins.get(file); origins.delete(file);
    const store = await openStore(file, { ...origin, writeSidecars, displayFile: relative(dir, file) });
    const id = (await store.read()).doc?.id || readSidecar(file, stem).id;
    const e = { id, file, store, name: stem, path: relative(dir, file), dirty: true };
    entries.set(id, e);
    const { doc } = await store.read();
    if (doc) e.name = doc.name;
    store.events.on('change', (c) => {
      e.name = c.doc?.name || e.name;
      e.dirty = true;
      if (e.built) { e.dirty = false; build(e); }
      note({ kind: 'change', component: id, name: e.name, by: c.by, summary: c.summary, revision: c.revision });
      events.emit('change', { component: id, ...c });
    });
    store.events.on('problem', (p) => events.emit('problem', { component: id, ...p }));
    if (!progressive) { e.dirty = false; await build(e); }
    note({ kind: 'added', component: id, name: e.name, by: origin?.by ?? 'file', summary: origin?.summary ?? 'file appeared', revision: (await store.read()).revision });
    events.emit('added', { component: id, ...(origin && { by: origin.by, summary: origin.summary }) });
  }

  async function remove(e) {
    const why = removals.get(e.file); removals.delete(e.file);
    entries.delete(e.id);
    await e.store.close();
    await bundler.dispose(e.file);
    note({ kind: 'removed', component: e.id, name: e.name, by: why?.by ?? 'file', summary: why?.summary ?? 'file removed' });
    events.emit('removed', { component: e.id, ...(why && { by: why.by, summary: why.summary }) });
  }

  const scan = () => {
    queue = queue.then(async () => {
      let files; try { files = componentFiles(dir, { recursive }).filter((f) => !wanted || wanted.has(basename(f))); } catch { files = []; }
      const have = new Set([...entries.values()].map((e) => e.file));
      for (const e of [...entries.values()]) if (!files.includes(e.file)) await remove(e);
      progress = { scanned: 0, total: files.length, done: false };
      events.emit('progress', progress);
      for (const f of files) {
        if (closing) break;
        if (!have.has(f)) { try { await add(f); } catch (err) { console.error(`napkin: could not open ${relative(dir, f)}: ${err.message}`); } }
        progress = { ...progress, scanned: progress.scanned + 1 };
        if (progress.scanned % 10 === 0) { events.emit('progress', progress); await new Promise(r => setImmediate(r)); }
      }
      progress = { ...progress, done: true }; events.emit('progress', progress);
    }).catch((err) => console.error(err));
    return queue;
  };
  const ready = progressive ? new Promise(resolve => setTimeout(() => resolve(scan()), 0)) : scan();
  if (!progressive) await ready;
  const watcher = watch(dir, { recursive }, () => { scan(); });

  const find = (idOrName) => entries.get(idOrName) || [...entries.values()].find((e) => e.name === idOrName);
  return {
    dir, events, ready, progress: () => progress,
    async report() { return formatReport(await Promise.all([...entries.values()].map(async e => { const r = await e.store.read(); return r.readOnly ? r.classification : { file: e.path, editable: true, name: e.name }; }))); },
    find,
    entries: () => [...entries.values()],
    async summary() {
      const out = [];
      for (const e of entries.values()) { const { readOnly } = await e.store.read(); out.push({ id: e.id, name: e.name, path: e.path, ...(readOnly && { readOnly }) }); }
      return out;
    },
    // What a client needs to draw one component right now.
    async snapshot(e) {
      const r = await e.store.read();
      return { component: e.id, name: e.name, path: e.path, canvas: canvasOf(e), revision: r.revision, doc: r.doc, source: r.source, ...(r.readOnly && { readOnly: r.readOnly }), ...(r.problem && { problem: r.problem }) };
    },
    async bundle(e) { if (!e.built || e.dirty) { e.dirty = false; build(e); } return e.built; },
    // CAN-02: where the component's frame sits on the canvas. Only the sidecar changes, never the .tsx.
    setCanvas(e, x, y, { by } = {}) {
      needBy(by);
      if (!writeSidecars) throw new CreateError(`${e.path}: sidecar writes are disabled. Next: reopen with --write-sidecars to save frame positions.`, 403);
      const ok = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6; // null, strings and NaN are refused, not turned into 0
      if (!ok(x) || !ok(y)) throw new CreateError('canvas x and y must be numbers');
      const side = readSidecar(e.file, e.name);
      const canvas = { x: Math.round(x), y: Math.round(y) };
      writeSidecar(sidecarPath(e.file), JSON.stringify({ ...side, canvas }, null, 2) + '\n');
      events.emit('canvas', { component: e.id, canvas });
      return canvas;
    },
    // F11/F12: write components/<Name>.tsx (and, through the store, its sidecar) for a new, empty component.
    // Resolves { id, name } once the workspace has opened it; throws CreateError for a bad or taken name.
    async create(name, rootTag = 'div', { by } = {}) {
      needBy(by);
      if (typeof name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new CreateError(`component name "${name}" must be PascalCase (letters and digits, starting with a capital)`);
      if (typeof rootTag !== 'string' || !TAGS.has(rootTag) || VOID.has(rootTag)) throw new CreateError(`root tag "${rootTag}" is not supported`);
      if (wanted) throw new CreateError('this server opened a single file, so it cannot add components');
      await queue;
      const taken = [...entries.values()].some((e) => e.name.toLowerCase() === name.toLowerCase());
      const file = join(dir, `${name}.tsx`);
      if (taken || existsSync(file)) throw new CreateError(`component "${name}" already exists`, 409);
      origins.set(file, { by, summary: `created ${name}` });
      try { createComponent(file, newComponentSource(name, rootTag)); }
      catch (err) { origins.delete(file); throw err.code === 'EEXIST' ? new CreateError(`component "${name}" already exists`, 409) : err; }
      await scan();
      const e = find(name);
      if (!e) throw new Error(explainError(`created ${name}.tsx but could not open it`));
      return { id: e.id, name: e.name };
    },
    activity: (limit = 50) => log.slice(-limit).reverse(),
    // Delete: remove the file and its sidecar through commit.js; the workspace records who and why and announces 'removed'.
    async delete(idOrName, { by } = {}) {
      needBy(by);
      const e = find(idOrName);
      if (!e) throw new CreateError('not found', 404);
      const r = await e.store.read();
      if (r.readOnly) throw new CreateError(`read-only: ${e.path}: ${r.readOnly}. Next: keep the source or propose an adoption before deleting it.`, 403);
      const { id, name, file } = e;
      removals.set(file, { by, summary: `deleted ${name}` });
      removeComponent(file); if (writeSidecars) removeSidecar(sidecarPath(file));
      if (!(await until(() => !find(id)))) throw new Error(explainError(`deleted ${name}.tsx but the workspace did not notice`));
      return { id, name };
    },
    // Rename: the file, the exported function and its Props interface; the component id stays and the revision continues.
    async rename(idOrName, newName, { by } = {}) {
      needBy(by);
      const e = find(idOrName);
      if (!e) throw new CreateError('not found', 404);
      if (!writeSidecars) throw new CreateError(`${e.path}: rename needs a saved component identity. Next: reopen with --write-sidecars to rename it.`, 403);
      if (typeof newName !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(newName)) throw new CreateError(`component name "${newName}" must be PascalCase (letters and digits, starting with a capital)`);
      const { readOnly, source, doc, revision } = await e.store.read();
      if (readOnly) throw new CreateError(`read-only: ${readOnly}`, 403);
      const old = doc.name;
      if (old === newName) return { id: e.id, name: newName };
      const file = join(dirname(e.file), `${newName}.tsx`);
      if ([...entries.values()].some((x) => x !== e && x.name.toLowerCase() === newName.toLowerCase()) || existsSync(file)) throw new CreateError(`component "${newName}" already exists`, 409);
      const text = source.replace(new RegExp(`\\bfunction ${old}\\b`), `function ${newName}`).replace(new RegExp(`\\b${old}Props\\b`, 'g'), `${newName}Props`);
      try { if (readComponent(text).doc.name !== newName) throw new Error(explainError('name not rewritten')); }
      catch (err) { throw new CreateError(`could not rename safely: ${err.message}`); }
      const side = JSON.stringify(readSidecar(e.file, e.name), null, 2) + '\n';
      const { id, file: oldFile } = e;
      origins.set(file, { by, summary: `renamed ${old} to ${newName}`, revision: revision + 1 });
      removals.set(oldFile, { by, summary: `renamed ${old} to ${newName}` });
      if (writeSidecars) writeSidecar(sidecarPath(file), side);
      moveComponent(oldFile, file, text); removeSidecar(sidecarPath(oldFile));
      if (!(await until(() => find(id)?.file === file))) throw new Error(explainError('renamed the file but the workspace did not notice'));
      return { id, name: newName };
    },
    async settled() { await queue; await Promise.all([...entries.values()].map((e) => e.built)); },
    async close() { closing = true; watcher.close(); await ready; await queue; for (const e of [...entries.values()]) await remove(e); await bundler.close(); },
  };
}
