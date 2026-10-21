// A workspace is a folder of component files: one store per *.tsx (decision 0002 still holds, per file),
// one esbuild context per file (F04), and a folder watcher that picks up files added or removed while
// it runs. Everything the server needs to say about components goes through its `events`.
//   events 'change'  { component, revision, by, edits, origin, doc }   (store change, re-emitted)
//          'problem' { component, error }     a broken hand edit; error null clears it (F22)
//          'added'   { component }            a file appeared (snapshot via snapshot())
//          'removed' { component }
//          'canvas'  { component, canvas }    the component was moved on the canvas (sidecar only)
import { readdirSync, watch, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { openStore, createComponentFile } from './store.js';
import { readSidecar } from './codecs.js';
import { createBundler } from './bundle.js';
import { newComponentSource } from './tsx/write.js';
import { TAGS, VOID } from './model.js';

// create() failures: `status` is the HTTP code the server answers with (400 bad input, 409 already exists).
export class CreateError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function openWorkspace(dir, { only } = {}) {
  dir = resolve(dir);
  const events = new EventEmitter();
  const bundler = createBundler();
  const entries = new Map(); // id -> { id, name, file, store, built }
  let queue = Promise.resolve();
  const wanted = only ? new Set([basename(only)]) : null;

  const build = (e) => {
    // Builds of one component run one after another, and a bundle is always built from the file as it is on disk.
    const prev = e.built || Promise.resolve();
    e.built = prev.then(() => bundler.build(e.file, e.name)).then((r) => { e.lastBuild = r; events.emit('build', { component: e.id, ok: r.ok, ms: r.ms, error: r.error }); return r; });
    return e.built;
  };

  async function add(file) {
    const stem = basename(file).replace(/\.tsx$/, '');
    const id = readSidecar(file, stem).id;
    const store = await openStore(file);
    const e = { id, file, store, name: stem };
    entries.set(id, e);
    const { doc } = await store.read();
    if (doc) e.name = doc.name;
    store.events.on('change', (c) => {
      e.name = c.doc.name;
      build(e);
      events.emit('change', { component: id, ...c });
    });
    store.events.on('problem', (p) => events.emit('problem', { component: id, ...p }));
    store.events.on('canvas', (c) => events.emit('canvas', { component: id, ...c }));
    await build(e);
    events.emit('added', { component: id });
  }

  async function remove(e) {
    entries.delete(e.id);
    await e.store.close();
    await bundler.dispose(e.file);
    events.emit('removed', { component: e.id });
  }

  const scan = () => {
    queue = queue.then(async () => {
      let names; try { names = readdirSync(dir); } catch { names = []; }
      const files = names.filter((n) => n.endsWith('.tsx') && !n.startsWith('.') && (!wanted || wanted.has(n))).map((n) => join(dir, n));
      const have = new Set([...entries.values()].map((e) => e.file));
      for (const e of [...entries.values()]) if (!files.includes(e.file)) await remove(e);
      for (const f of files) if (!have.has(f)) { try { await add(f); } catch (err) { console.error(`napkin: could not open ${f}: ${err.message}`); } }
    }).catch((err) => console.error(err));
    return queue;
  };
  await scan();
  const watcher = watch(dir, () => { scan(); });

  const find = (idOrName) => entries.get(idOrName) || [...entries.values()].find((e) => e.name === idOrName);
  return {
    dir, events,
    find,
    entries: () => [...entries.values()],
    async summary() {
      const out = [];
      for (const e of entries.values()) { const { readOnly } = await e.store.read(); out.push({ id: e.id, name: e.name, ...(readOnly && { readOnly }) }); }
      return out;
    },
    // What a client needs to draw one component right now.
    async snapshot(e) {
      const r = await e.store.read();
      return { component: e.id, name: e.name, revision: r.revision, doc: r.doc, source: r.source, ...(r.readOnly && { readOnly: r.readOnly }), ...(r.problem && { problem: r.problem }) };
    },
    async bundle(e) { return e.built; },
    // F11/F12: write components/<Name>.tsx for a new, empty component. The write goes through the store
    // module's createComponentFile (exclusive, atomic): the one place besides store.apply that creates a component file.
    // Resolves { id, name } once the workspace has opened it; throws CreateError for a bad or taken name.
    async create(name, rootTag = 'div') {
      if (typeof name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new CreateError(`component name "${name}" must be PascalCase (letters and digits, starting with a capital)`);
      if (typeof rootTag !== 'string' || !TAGS.has(rootTag) || VOID.has(rootTag)) throw new CreateError(`root tag "${rootTag}" is not supported`);
      if (wanted) throw new CreateError('this server opened a single file, so it cannot add components');
      await queue;
      const taken = [...entries.values()].some((e) => e.name.toLowerCase() === name.toLowerCase());
      const file = join(dir, `${name}.tsx`);
      if (taken || existsSync(file)) throw new CreateError(`component "${name}" already exists`, 409);
      try { createComponentFile(file, newComponentSource(name, rootTag)); }
      catch (err) { throw err.code === 'EEXIST' ? new CreateError(`component "${name}" already exists`, 409) : err; }
      await scan();
      const e = find(name);
      if (!e) throw new Error(`created ${name}.tsx but could not open it`);
      return { id: e.id, name: e.name };
    },
    async settled() { await queue; await Promise.all([...entries.values()].map((e) => e.built)); },
    async close() { watcher.close(); await queue; for (const e of [...entries.values()]) await remove(e); await bundler.close(); },
  };
}
