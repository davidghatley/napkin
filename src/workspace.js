// A workspace is a folder of component files: one store per *.tsx (decision 0002 still holds, per file),
// one esbuild context per file (F04), and a folder watcher that picks up files added or removed while
// it runs. Everything the server needs to say about components goes through its `events`.
//   events 'change'  { component, revision, by, edits, origin, doc }   (store change, re-emitted)
//          'problem' { component, error }     a broken hand edit; error null clears it (F22)
//          'added'   { component, by?, summary? }   a file appeared (snapshot via snapshot()); by/summary when napkin made it (create, rename)
//          'removed' { component, by?, summary? }   by/summary when napkin removed it (delete, rename)
//          'canvas'  { component, canvas }    the component was moved on the canvas (sidecar only)
// workspace.activity(): the last 200 { at, kind: 'change'|'added'|'removed', component, name, by, summary, revision? }
import { explainError } from './errors.js';
import { watch, existsSync, readFileSync, realpathSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { writeAtomic } from './atomic.js';
import { basename, dirname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { EventEmitter } from 'node:events';
import { openStore, brokenMessage } from './store.js';
import { readSidecar as loadSidecar, sidecarPath } from './codecs.js';
import { createComponent, removeComponent, moveComponent, writeSidecar, removeSidecar } from './commit.js';
import { readComponent } from './tsx/read.js';
import { createBundler } from './bundle.js';
import { componentFiles, formatReport } from './scan.js';
import { newComponentSource, writeComponent } from './tsx/write.js';
import { TAGS, VOID, index, extractPlan, applyEdits, EditError, nodeOfEdit } from './model.js';
import { openTokens } from './tokens.js';

// create() failures: `status` is the HTTP code the server answers with (400 bad input, 409 already exists).
export class CreateError extends Error {
  constructor(message, status = 400) { super(explainError(message)); this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; }

// Every file-level commit names a real caller (AGT-05).
// the saved frame position; reading never creates a sidecar (a deleted component must stay deleted)
const previewInSidecar = (e) => { try { return JSON.parse(readFileSync(sidecarPath(e.file), 'utf8')).preview ?? {}; } catch { return {}; } };
const slotsInSidecar = (e) => { try { return JSON.parse(readFileSync(sidecarPath(e.file), 'utf8')).slots ?? {}; } catch { return {}; } }; // preview content for ReactNode slots (sidecar only)
const canvasInSidecar = (e) => { try { return JSON.parse(readFileSync(sidecarPath(e.file), 'utf8')).canvas ?? { x: 0, y: 0 }; } catch { return { x: 0, y: 0 }; } };
const needBy = (by) => { if (typeof by !== 'string' || !by.trim() || by.trim().toLowerCase() === 'unknown') throw new CreateError('a caller name is required: every commit names who made it'); };

// Decision 0013: a folder opened without sidecar writes keeps each component's canvas settings (frame position, preview
// widths, slot texts) in napkin's state dir, keyed by the file's path, so they survive a restart and nothing is written
// into the folder. An existing sidecar is still read for what the state dir does not have.
function openSettings(dir) {
  let real = dir; try { real = realpathSync(dir); } catch { /* not there yet */ }
  const folder = join(process.env.NAPKIN_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'napkin'), createHash('sha256').update(real).digest('hex').slice(0, 24));
  const file = join(folder, 'workspace.json');
  let data = {}; try { data = JSON.parse(readFileSync(file, 'utf8')).components || {}; } catch { /* nothing saved yet */ }
  const save = () => { mkdirSync(folder, { recursive: true }); writeAtomic(file, JSON.stringify({ folder: real, components: data }, null, 2) + '\n'); };
  return {
    get: (rel) => data[rel],
    patch(rel, patch) { const next = { ...(data[rel] || {}), ...patch }; for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]; if (Object.keys(next).length) data[rel] = next; else delete data[rel]; save(); },
    move(from, to) { if (!data[from]) return; data[to] = data[from]; delete data[from]; save(); },
    remove(rel) { if (!data[rel]) return; delete data[rel]; save(); },
  };
}

export async function openWorkspace(dir, { only, recursive = false, writeSidecars = true, progressive = false } = {}) {
  dir = resolve(dir);
  const settings = writeSidecars ? null : openSettings(dir);
  const relOf = (e) => relative(dir, e.file);
  const stateHas = (e, k) => settings?.get(relOf(e))?.[k] !== undefined;
  const previewOf = (e) => (stateHas(e, 'preview') ? settings.get(relOf(e)).preview : previewInSidecar(e));
  const slotsOf = (e) => (stateHas(e, 'slots') ? settings.get(relOf(e)).slots : slotsInSidecar(e));
  const canvasOf = (e) => (stateHas(e, 'canvas') ? settings.get(relOf(e)).canvas : canvasInSidecar(e));
  // one setting of a component: into its sidecar (project mode), or into the state dir
  const saveSetting = (e, key, value) => {
    if (settings) return settings.patch(relOf(e), { [key]: value === undefined || (value && typeof value === 'object' && !Object.keys(value).length && key !== 'canvas') ? undefined : value });
    const side = readSidecar(e.file, e.name), next = { ...side, [key]: value };
    if (value === undefined || (value && typeof value === 'object' && !Object.keys(value).length && key !== 'canvas')) delete next[key];
    writeSidecar(sidecarPath(e.file), JSON.stringify(next, null, 2) + '\n');
  };
  const readSidecar = (file, name, options) => loadSidecar(file, name, { identityPath: relative(dir, file), ...options });
  const events = new EventEmitter();
  const tokens = openTokens(dir);
  tokens.events.on('change', row => { events.emit('tokens', row); });
  const bundler = createBundler();
  const entries = new Map(); // id -> { id, name, file, store, built }
  let queue = Promise.resolve();
  let closing = false;
  let progress = { scanned: 0, total: 0, done: false };
  const wanted = only ? new Set([basename(only)]) : null;
  const origins = new Map();  // file -> { by, summary, revision? } for files napkin itself is about to create or move in
  const removals = new Map(); // file -> { by, summary } for files napkin itself is about to remove
  // Components that use other components (decision 0004): who uses whom, from the documents the stores hold.
  const docs = new Map(); // file -> last good document (null while read-only)
  const usesByFile = new Map(); // file -> Set of the sibling files its instances point at
  const siblingFile = (host, name) => join(dirname(host), `${name}.tsx`);
  const instancesOf = (doc) => (doc ? [...new Set([...index(doc).byId.values()].filter((n) => n.instance).map((n) => n.instance.component))] : []);
  const setDoc = (file, doc) => { docs.set(file, doc); usesByFile.set(file, new Set(instancesOf(doc).map((n) => siblingFile(file, n)))); };
  const reaches = (from, to, seen = new Set()) => { if (from === to) return true; if (seen.has(from)) return false; seen.add(from); for (const n of usesByFile.get(from) || []) if (reaches(n, to, seen)) return true; return false; };
  const byFile = (f) => [...entries.values()].find((x) => x.file === f);
  const dependents = (file) => [...entries.values()].filter((x) => x.file !== file && reaches(x.file, file)); // everything that shows `file` somewhere inside it
  // Every component file that imports `file`, read-only ones included (a plain import scan, not the dialect's document).
  const importersOf = async (file) => {
    const target = file.replace(/\.tsx$/, ''), out = [];
    for (const x of entries.values()) {
      if (x.file === file) continue;
      const { source } = await x.store.read();
      for (const m of String(source).matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith('.') && resolve(dirname(x.file), spec).replace(/\.tsx?$/, '') === target) { out.push(x); break; }
      }
    }
    return out;
  };
  const directUsers = (file) => [...entries.values()].filter((x) => usesByFile.get(x.file)?.has(file));
  const components = { lookup(name, host) { const f = siblingFile(host, name); if (!byFile(f)) return null; return { doc: docs.get(f) || null, reaches: () => reaches(f, host) }; } };
  const graphOf = (e) => ({ uses: [...(usesByFile.get(e.file) || [])].map((f) => basename(f, '.tsx')), usedBy: directUsers(e.file).map((x) => x.name) });
  const log = [];
  const note = (x) => { log.push({ at: Date.now(), ...x }); if (log.length > 200) log.shift(); };

  // A file this component is made of changed (or a component it shows): rebuild its bundle if it was ever built, else mark it stale.
  const refresh = (e, cause) => {
    e.dirty = true;
    if (e.built) { e.dirty = false; build(e, cause); }
  };
  const build = (e, cause) => {
    // Builds of one component run one after another, and a bundle is always built from the file as it is on disk.
    const prev = e.built || Promise.resolve();
    e.built = prev.then(() => bundler.build(e.file, e.name, relative(dir, e.file))).then((r) => { e.lastBuild = r; events.emit('build', { component: e.id, ok: r.ok, ms: r.ms, error: r.error, ...(cause && { cause }) }); return r; });
    return e.built;
  };

  // --- consumer integrity (decision 0004) ---
  // A component's props and variant values are also what the components that use it pass. Renaming one rewrites those consumers in the
  // same change (the host first, then the consumers in name order; if one cannot be written the others are undone); removing one is
  // refused while a consumer still passes it.
  const SHAPE_OPS = new Set(['renameProp', 'removeProp', 'renameVariant', 'removeVariant']);
  const lineOf = (source, id) => source.split('\n').findIndex((l) => l.includes(`data-n="${id}"`)) + 1;
  const instancesIn = (doc, name) => [...index(doc).byId.values()].filter((n) => n.instance?.component === name);
  // -> { error } | { plan: [{ user, edits }], summary } | null (nothing for the consumers to do)
  async function consumerPlan(e, req) {
    const users = directUsers(e.file).sort((a, b) => a.name.localeCompare(b.name));
    if (!Array.isArray(req.edits) || !req.edits.some((x) => SHAPE_OPS.has(x?.op))) return null;
    const host = await e.store.read();
    if (!host.doc) return null;
    // a component we cannot read may still use this one: look for its import
    const mentions = new RegExp(`from\\s+['"]\\./${e.name}['"]`);
    for (const x of entries.values()) {
      if (x === e || docs.get(x.file)) continue;
      const r = await x.store.read();
      if (!r.doc && mentions.test(r.source || '')) return { error: `${e.name} is used by ${x.name}, which is read-only now (${r.readOnly || r.problem || 'it cannot be read'}). Next: fix ${x.path} first, then change ${e.name}.` };
    }
    const sims = [];
    for (const u of users) {
      const r = await u.store.read();
      if (!r.doc) return { error: `${e.name} is used by ${u.name}, which is read-only now (${r.readOnly || r.problem || 'it cannot be read'}). Next: fix ${u.path} first, then change ${e.name}.` };
      sims.push({ user: u, doc: r.doc, source: r.source, edits: [] });
    }
    let h = host.doc;
    const refuse = (what, sim, n, tail = 'remove it there first') => ({ error: `${e.name}.${what} is passed by ${sim.user.name} (line ${lineOf(sim.source, n.id)}); ${tail}. Next: ${tail.replace(/^./, (c) => c)}, then retry.` });
    for (const edit of req.edits) {
      const op = edit?.op;
      if (SHAPE_OPS.has(op)) {
        if (op === 'renameProp') for (const sim of sims) { const x = { op: 'renameInstanceProp', component: e.name, name: edit.name, to: edit.to }; if (instancesIn(sim.doc, e.name).some((n) => edit.name in n.instance.props)) { sim.edits.push(x); sim.doc = applyEdits(sim.doc, [x]); } }
        if (op === 'removeProp') for (const sim of sims) { const n = instancesIn(sim.doc, e.name).find((n) => edit.name in n.instance.props); if (n) return refuse(edit.name, sim, n); }
        if (op === 'renameVariant' || op === 'removeVariant') {
          const axis = h.props.find((p) => p.name === edit.axis);
          const wholeAxis = op === 'removeVariant' && axis && axis.options.length <= 2;
          for (const sim of sims) for (const n of instancesIn(sim.doc, e.name)) {
            const v = n.instance.props[edit.axis];
            if (v === undefined) continue;
            const own = v && typeof v === 'object' ? sim.doc.props.find((p) => p.name === v.prop) : null;
            if (wholeAxis) return refuse(edit.axis, sim, n);
            if (own?.options?.includes(edit.value)) return refuse(`${edit.axis}="${edit.value}"`, sim, n, `rename or remove ${edit.value} in ${sim.user.name}'s own ${own.name} first`);
            if (v === edit.value) {
              if (op === 'removeVariant') return refuse(`${edit.axis}="${edit.value}"`, sim, n);
              const x = { op: 'renameInstanceValue', component: e.name, axis: edit.axis, value: edit.value, to: edit.to }; sim.edits.push(x); sim.doc = applyEdits(sim.doc, [x]);
            }
          }
        }
      }
      try { h = applyEdits(h, [edit]); } catch (err) { if (err instanceof EditError) return null; throw err; } // (the store gives the real message)
    }
    const plan = sims.filter((x) => x.edits.length).map((x) => ({ user: x.user, edits: x.edits }));
    return plan.length ? { plan } : null;
  }
  // wraps a store's apply: shape changes go to the consumers too
  function withConsumers(e, raw) {
    const guarded = async (req, meta) => {
      let p;
      try { p = await consumerPlan(e, req); } catch (err) { return { ok: false, error: explainError(`invalid edit #0: ${err.message}`) }; }
      if (!p) return raw(req, meta);
      if (p.error) return { ok: false, error: explainError(`invalid edit #0: ${p.error}`) };
      if (req.dryRun) return raw(req, meta);
      const names = p.plan.map((x) => x.user.name);
      const what = req.edits.filter((x) => SHAPE_OPS.has(x?.op)).map((x) => (x.op === 'renameProp' ? `${x.name} to ${x.to}` : x.op === 'renameVariant' ? `${x.axis}=${x.value} to ${x.to}` : `${x.axis ?? x.name}`)).join(', ');
      const summary = `renamed ${e.name} ${what} (and updated ${names.join(', ')})`;
      const before = new Map([[e, (await e.store.read()).revision], ...(await Promise.all(p.plan.map(async (x) => [x.user, (await x.user.store.read()).revision])))]);
      const r = await raw(req, { ...meta, summary });
      if (!r.ok) return r;
      const done = [];
      for (const { user, edits } of p.plan) {
        let res;
        try { res = await user.store.apply({ baseRevision: (await user.store.read()).revision, edits, by: req.by, origin: req.origin }, { summary: `renamed ${e.name} ${what} (${user.name} follows)` }); }
        catch (err) { res = { ok: false, error: `${err.message}. Next: retry` }; }
        if (!res.ok) { // put everything back, newest first, the host last
          const back = `rolled back: ${user.name} could not follow ${e.name} ${what}`;
          for (const d of done.reverse()) await d.store.revert(before.get(d), req.by, back).catch(() => {});
          await e.store.revert(before.get(e), req.by, back).catch(() => {});
          return { ok: false, error: `could not update ${user.name} (${res.error}); ${e.name} was left as it was. Next: fix ${user.path}, then retry.` };
        }
        done.push(user);
      }
      return { ...r, updated: names };
    };
    // (an edit that cannot touch consumers goes straight to the store, in the same tick, so the order of queued writes is untouched)
    return (req, meta) => (Array.isArray(req?.edits) && req.edits.some((x) => SHAPE_OPS.has(x?.op)) ? guarded(req, meta) : raw(req, meta));
  }

  async function add(file) {
    const stem = basename(file).replace(/\.tsx$/, '');
    const origin = origins.get(file); origins.delete(file);
    const store = await openStore(file, { ...origin, writeSidecars, displayFile: relative(dir, file), components });
    const id = (await store.read()).doc?.id || readSidecar(file, stem).id;
    const e = { id, file, store, name: stem, path: relative(dir, file), dirty: true };
    store.apply = withConsumers(e, store.apply.bind(store));
    entries.set(id, e);
    const { doc } = await store.read();
    if (doc) e.name = doc.name;
    setDoc(file, doc);
    store.events.on('change', (c) => {
      e.name = c.doc?.name || e.name;
      setDoc(file, c.doc ?? null);
      refresh(e);
      // everything that shows this component inside it is bundled again (a component that was never drawn yet is only marked)
      for (const d of dependents(file)) refresh(d, e.name);
      note({ kind: 'change', component: id, name: e.name, by: c.by, summary: c.summary, revision: c.revision, how: c.kind || 'edit', ...(nodeOfEdit(c.edits?.[0]) && { node: nodeOfEdit(c.edits[0]) }), ...(c.approvedBy && { approvedBy: c.approvedBy }) });
      events.emit('change', { component: id, ...c });
    });
    store.events.on('problem', (p) => events.emit('problem', { component: id, ...p }));
    store.events.on('canvas', (c) => events.emit('canvas', { component: id, ...c }));
    if (!progressive) { e.dirty = false; await build(e); }
    note({ kind: 'added', component: id, name: e.name, by: origin?.by ?? 'file', summary: origin?.summary ?? 'file appeared', revision: (await store.read()).revision, ...(origin?.approvedBy && { approvedBy: origin.approvedBy }) });
    events.emit('added', { component: id, ...(origin && { by: origin.by, summary: origin.summary, ...(origin.approvedBy && { approvedBy: origin.approvedBy }) }) });
  }

  async function remove(e) {
    const why = removals.get(e.file); removals.delete(e.file);
    const orphans = dependents(e.file);
    entries.delete(e.id);
    docs.delete(e.file); usesByFile.delete(e.file);
    await e.store.close();
    await e.built?.catch(() => {}); // a build still queued would otherwise open a new esbuild context after the dispose
    await bundler.dispose(e.file);
    for (const d of orphans) refresh(d, e.name); // they now import a file that is gone: show that
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
  const createDir = () => {
    if (!recursive || !entries.size) return dir;
    const count = new Map();
    for (const x of entries.values()) count.set(dirname(x.file), (count.get(dirname(x.file)) || 0) + 1);
    const depth = (d) => relative(dir, d).split(sep).filter(Boolean).length;
    return [...count].sort((a, b) => b[1] - a[1] || depth(a[0]) - depth(b[0]) || a[0].localeCompare(b[0]))[0][0];
  };
  return {
    dir, events, tokens, ready, progress: () => progress,
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
      return { component: e.id, name: e.name, path: e.path, canvas: canvasOf(e), preview: previewOf(e), slots: slotsOf(e), ...graphOf(e), revision: r.revision, doc: r.doc, source: r.source, ...(r.readOnly && { readOnly: r.readOnly }), ...(r.problem && { problem: r.problem }) };
    },
    // Decision 0004: who a component uses and who uses it (direct), from the documents the stores hold.
    graph: (e) => graphOf(e),
    importers: importersOf,
    // The text a ReactNode slot shows on the canvas, per prop. Sidecar only (never the .tsx).
    setSlotPreview(e, prop, text, { by } = {}) {
      needBy(by);
      const slot = docs.get(e.file)?.props.find((p) => p.name === prop);
      if (!slot || slot.type !== 'node') throw new CreateError(`"${prop}" is not a slot prop of ${e.name}. Next: use the name of a ReactNode prop.`);
      if (text !== null && (typeof text !== 'string' || text.length > 500)) throw new CreateError('slot preview text must be a string of at most 500 characters, or null to clear it');
      const slots = { ...slotsOf(e) };
      if (text === null) delete slots[prop]; else slots[prop] = text;
      saveSetting(e, 'slots', slots);
      events.emit('slots', { component: e.id, slots });
      return slots;
    },
    // Extract: the node `id` of a component and everything in it become a new component (a file of its own); the node is replaced by an
    // instance of it. Two files, always in this order: (1) create <Name>.tsx, (2) replace the subtree in the source. If (2) fails the new
    // file is removed again, so a refusal leaves both files as they were.
    async extractComponent(idOrName, { id, name, by } = {}) {
      needBy(by);
      const e = find(idOrName);
      if (!e) throw new CreateError('not found', 404);
      if (wanted) throw new CreateError('this server opened a single file, so it cannot add components');
      if (typeof name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new CreateError(`component name "${name}" must be PascalCase (letters and digits, starting with a capital)`);
      const bad = await e.store.sync();
      if (bad) throw new CreateError(brokenMessage(e.file, bad), 409);
      const r = await e.store.read();
      if (r.readOnly) throw new CreateError(`read-only: ${e.path}: ${r.readOnly}`, 403);
      const file = siblingFile(e.file, name);
      if (existsSync(file) || [...entries.values()].some((x) => x.file === file || (dirname(x.file) === dirname(e.file) && x.name.toLowerCase() === name.toLowerCase()))) throw new CreateError(`component "${name}" already exists`, 409);
      let plan; try { plan = extractPlan(r.doc, id); } catch (err) { throw new CreateError(`invalid edit #0: ${err.message}`); }
      // the new file: a fresh component with the subtree as its root (renamed "root")
      const template = newComponentSource(name, plan.node.tag);
      const t = readComponent(template);
      const root = structuredClone(plan.node);
      const rename = new Map([[root.id, 'root']]);
      if (root.id !== 'root') {
        root.id = 'root';
      }
      const variants = {};
      for (const [axis, vals] of Object.entries(plan.variants)) for (const [val, nodes] of Object.entries(vals)) for (const [nid, st] of Object.entries(nodes)) ((variants[axis] ??= {})[val] ??= {})[rename.get(nid) ?? nid] = st;
      const target = { ...t.doc, props: plan.props, root, variants };
      const text = writeComponent(t.ast, t.doc, target, template);
      readComponent(text); // must read back, or nothing is created
      origins.set(file, { by, summary: `extracted ${name} from ${e.name}` });
      try { createComponent(file, text); } catch (err) { origins.delete(file); throw err.code === 'EEXIST' ? new CreateError(`component "${name}" already exists`, 409) : err; }
      await scan();
      const made = find(name);
      if (!made) { try { removeComponent(file); } catch {} throw new Error(explainError(`created ${name}.tsx but could not open it`)); }
      const rollback = async () => {
        removals.set(file, { by, summary: `rolled back extracting ${name}` });
        try { removeComponent(file); if (writeSidecars) removeSidecar(sidecarPath(file)); } catch {}
        await until(() => !find(name)).catch?.(() => {});
      };
      let result;
      try { result = await e.store.apply({ baseRevision: (await e.store.read()).revision, edits: [{ op: 'extractComponent', id, component: name }], by }); }
      catch (err) { await rollback(); throw err; }
      if (!result.ok) { await rollback(); throw new CreateError(result.error, 409); }
      return { id: e.id, component: made.id, name, node: id, revision: result.revision };
    },
    // The canvas page's bundle: React left external, drawn from the page's one shared runtime (GET /runtime.js, decision 0011).
    async bundle(e) {
      if (!e.built || e.dirty) { e.dirty = false; build(e); }
      return e.built;
    },
    // The bundle of a past revision's source (preview and visual diff); cached per component and revision.
    async bundleAt(e, rev) {
      const past = e.store.at(rev);
      if (!past) return { ok: false, error: `revision ${rev} is not in the history this server keeps. Next: pick a revision from the history list.` };
      return bundler.buildText(e.file, e.name, past.source, { shared: true });
    },
    // Standalone bundles carry their own React: for drawing outside the canvas page (render_component, visual diff).
    bundleText: (e, text) => bundler.buildText(e.file, e.name, text),
    bundleStandalone: (e) => bundler.buildStandalone(e.file, e.name, relative(dir, e.file)),
    runtime: (module) => bundler.runtime(module),
    // CAN-02: where the component's frame sits on the canvas. Only the sidecar changes, never the .tsx.
    setCanvas(e, x, y, { by } = {}) {
      needBy(by);
      const ok = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6; // null, strings and NaN are refused, not turned into 0
      if (!ok(x) || !ok(y)) throw new CreateError('canvas x and y must be numbers');
      const canvas = { x: Math.round(x), y: Math.round(y) };
      saveSetting(e, 'canvas', canvas);
      events.emit('canvas', { component: e.id, canvas });
      return canvas;
    },
    // LAY-11: preview widths for the variant cells (a cell dragged wider or narrower to watch the layout reflow). Sidecar only, never the .tsx.
    // preview = { "<variant JSON>": width px }; width null puts the cell back to its natural size.
    setPreview(e, variant, width, { by } = {}) {
      needBy(by);
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) throw new CreateError('variant must be an object like {"size":"sm"}');
      if (width !== null && !(typeof width === 'number' && Number.isFinite(width) && width >= 16 && width <= 20000)) throw new CreateError('width must be a number from 16 to 20000, or null');
      const preview = { ...previewOf(e) }, key = JSON.stringify(variant);
      if (width === null) delete preview[key]; else preview[key] = Math.round(width);
      saveSetting(e, 'preview', preview);
      events.emit('preview', { component: e.id, preview });
      return preview;
    },
    // F11/F12: write components/<Name>.tsx (and, through the store, its sidecar) for a new, empty component.
    // Resolves { id, name } once the workspace has opened it; throws CreateError for a bad or taken name.
    // Everything create() checks before it writes, so a propose-mode agent's request can be refused up front. Returns the file it would make.
    // Where a new component goes: beside the existing ones. In a folder opened recursively without a fixed components folder, that is
    // the most common directory of the component files (ties: the shallowest, then the first by name); otherwise the folder itself.
    checkCreate(name, rootTag = 'div', folder) {
      if (typeof name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new CreateError(`component name "${name}" must be PascalCase (letters and digits, starting with a capital)`);
      if (typeof rootTag !== 'string' || !TAGS.has(rootTag) || VOID.has(rootTag)) throw new CreateError(`root tag "${rootTag}" is not supported`);
      if (wanted) throw new CreateError('this server opened a single file, so it cannot add components');
      const taken = [...entries.values()].some((e) => e.name.toLowerCase() === name.toLowerCase());
      let into = createDir();
      if (folder !== undefined) { // an exact folder (bringing a deleted component back to where it was), inside this workspace
        into = resolve(dir, String(folder));
        const rel = relative(dir, into);
        if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(into)) throw new CreateError(`folder "${folder}" is not inside the components folder`);
      }
      const file = join(into, `${name}.tsx`);
      if (taken || existsSync(file)) throw new CreateError(`component "${name}" already exists`, 409);
      return file;
    },
    // The source and document a new component would start with (nothing is written): the ghost of a create proposal.
    previewCreate(name, rootTag = 'div') {
      this.checkCreate(name, rootTag);
      const source = newComponentSource(name, rootTag);
      return { source, doc: readComponent(source).doc };
    },
    // opts.approvedBy: the person who accepted a proposal to create it; recorded beside the author in history.
    async create(name, rootTag = 'div', { by, approvedBy, source, folder } = {}) {
      needBy(by);
      if (source !== undefined) { // bringing a deleted component back: the text must be this component, in the dialect
        let back; try { back = readComponent(source).doc; } catch (err) { throw new CreateError(`that source is not a napkin component: ${err.message}`); }
        if (back.name !== name) throw new CreateError(`that source is ${back.name}, not ${name}`);
      }
      this.checkCreate(name, rootTag, folder);
      await queue;
      const file = this.checkCreate(name, rootTag, folder);
      origins.set(file, { by, summary: `created ${name}`, ...(approvedBy && { approvedBy }) });
      try { createComponent(file, source ?? newComponentSource(name, rootTag)); }
      catch (err) { origins.delete(file); throw err.code === 'EEXIST' ? new CreateError(`component "${name}" already exists`, 409) : err; }
      // Explicit creation saves its identity. Scanning existing files is read-only.
      readSidecar(file, name, { create: writeSidecars });
      await scan();
      const e = find(name);
      if (!e) throw new Error(explainError(`created ${name}.tsx but could not open it`));
      return { id: e.id, name: e.name, path: e.path };
    },
    activity: (limit = 50) => [...log, ...tokens.history()].sort((a, b) => b.at - a.at).slice(0, limit),
    // Delete: remove the file and its sidecar through commit.js; the workspace records who and why and announces 'removed'.
    async delete(idOrName, { by } = {}) {
      needBy(by);
      const e = find(idOrName);
      if (!e) throw new CreateError('not found', 404);
      const bad = await e.store.sync(); // a file that does not parse holds someone's hand edit: never delete or replace it
      if (bad) throw new CreateError(brokenMessage(e.file, bad), 409);
      const r = await e.store.read();
      if (r.readOnly) throw new CreateError(`read-only: ${e.path}: ${r.readOnly}. Next: keep the source or propose an adoption before deleting it.`, 403);
      const users = [...new Set([...directUsers(e.file), ...(await importersOf(e.file))].map((x) => x.name))];
      if (users.length) throw new CreateError(`${e.name} is used by ${users.join(', ')}. Next: remove or swap those instances first.`, 409);
      const { id, name, file } = e;
      removals.set(file, { by, summary: `deleted ${name}` });
      removeComponent(file); if (writeSidecars) removeSidecar(sidecarPath(file)); else settings.remove(relative(dir, file));
      if (!(await until(() => !find(id)))) throw new Error(explainError(`deleted ${name}.tsx but the workspace did not notice`));
      return { id, name };
    },
    // Rename: the file, the exported function and its Props interface; the component id stays and the revision continues.
    async rename(idOrName, newName, { by } = {}) {
      needBy(by);
      const e = find(idOrName);
      if (!e) throw new CreateError('not found', 404);
      if (typeof newName !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(newName)) throw new CreateError(`component name "${newName}" must be PascalCase (letters and digits, starting with a capital)`);
      const bad = await e.store.sync();
      if (bad) throw new CreateError(brokenMessage(e.file, bad), 409);
      // The components that use this one get their import and tags renamed too (a swapInstance per instance, one batch per file).
      const swaps = directUsers(e.file).map((u) => ({ u, doc: docs.get(u.file) }));
      for (const x of await importersOf(e.file)) if (!swaps.some(({ u }) => u === x)) throw new CreateError(`${e.name} is imported by ${x.name}, which napkin cannot rewrite safely (it is read-only). Next: change its import of ${e.name} yourself, or rename in your editor.`, 409);
      for (const { u, doc: d } of swaps) if (!d) throw new CreateError(`${e.name} is used by ${u.name}, which is read-only, so napkin cannot update its import. Next: rename it in your editor, or make ${u.name} editable first.`, 409);
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
      settings?.move(relative(dir, oldFile), relative(dir, file));
      if (!(await until(() => byFile(file) && !byFile(oldFile)))) throw new Error(explainError('renamed the file but the workspace did not notice'));
      const now = byFile(file); // (without saved sidecars the id comes from the path, so it changes with the file)
      for (const { u } of swaps) {
        const user = byFile(u.file);
        const ids = [...index(docs.get(u.file)).byId.values()].filter((n) => n.instance?.component === old).map((n) => n.id);
        if (!user || !ids.length) continue;
        const r = await user.store.apply({ baseRevision: (await user.store.read()).revision, edits: ids.map((x) => ({ op: 'swapInstance', id: x, component: newName })), by });
        if (!r.ok) throw new CreateError(`renamed ${old} to ${newName}, but ${user.name} could not be updated: ${r.error}. Next: change its import of ${old} to ${newName} by hand.`, 409);
      }
      return { id: now.id, name: newName, path: now.path };
    },
    async settled() { await queue; await Promise.all([...entries.values()].map((e) => e.built)); },
    async close() { tokens.close(); closing = true; watcher.close(); await ready; await queue; for (const e of [...entries.values()]) await remove(e); await bundler.close(); },
  };
}
