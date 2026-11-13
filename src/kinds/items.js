import {
  readdirSync,
  statSync,
  realpathSync,
  readFileSync,
  existsSync,
  watch,
} from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { writeItemValue, removeItemRecipe, writeItemLayout } from '../commit.js';
import { context, detectKind, decodeText, kinds } from './registry.js';
import { explainError } from '../errors.js';
import { window, LIMIT } from './readers.js';
import { validate } from './controls.js';
import { stateRoot } from '../doc/folder.js';
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'bower_components',
  'vendor',
  'target',
]);
const digest = (b) => createHash('sha256').update(b).digest('hex').slice(0, 20);
export class ItemError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function openItems(
  root,
  { broadcast = () => {}, stateDir = stateRoot(), watchFiles = false } = {},
) {
  root = realpathSync(root);
  const cache = new Map(),
    history = new Map();
  let listed = null,
    last = 0;
  const watchers = new Map(),
    pending = new Set();
  let timer;
  function watchDir(dir) {
    if (!watchFiles || watchers.has(dir)) return;
    try {
      const w = watch(dir, { persistent: false }, (_, name) => {
        if (!name || String(name).startsWith('.')) return;
        pending.add(
          relative(root, join(dir, String(name)))
            .split(sep)
            .join('/'),
        );
        clearTimeout(timer);
        timer = setTimeout(() => {
          last = 0;
          broadcast({ type: 'items-changed', paths: [...pending] });
          pending.clear();
        }, 40);
      });
      w.on('error', () => {});
      watchers.set(dir, w);
    } catch {}
  }
  const state = join(stateDir, digest(Buffer.from(root))),
    layoutFile = join(state, 'kind-layout.json');
  // Item edit history survives a restart: steps are kept next to the layout, paths relative to the folder.
  const undoFile = join(state, 'kind-undo.json');
  const toDisk = () => {
    const out = {};
    let budget = 8 * 1024 * 1024;
    for (const [id, steps] of history)
      out[id] = steps
        .slice()
        .reverse()
        .filter((st) => (budget -= (st.after?.length || 0) + (st.before?.length || 0)) > 0)
        .reverse()
        .map((st) => ({ target: relative(root, st.target).split(sep).join('/'), before: st.before?.toString('base64') ?? null, after: st.after.toString('base64'), revision: st.revision, by: st.by }));
    return out;
  };
  const saveHistory = () => {
    try {
      writeItemLayout(undoFile, toDisk());
    } catch {}
  };
  try {
    for (const [id, steps] of Object.entries(JSON.parse(readFileSync(undoFile, 'utf8'))))
      history.set(id, steps.map((st) => ({ target: resolve(root, st.target), before: st.before === null ? null : Buffer.from(st.before, 'base64'), after: Buffer.from(st.after, 'base64'), revision: st.revision, by: st.by })));
  } catch {}
  let frames = {};
  try {
    frames = JSON.parse(readFileSync(layoutFile, 'utf8'));
  } catch {}
  function setLayout(id, value) {
    get(id);
    const next = {};
    for (const k of ['x', 'y']) {
      if (typeof value[k] !== 'number' || !Number.isFinite(value[k]) || Math.abs(value[k]) > 1e7)
        throw new ItemError('Position must be finite canvas coordinates. Next: send numeric x and y.');
      next[k] = Math.round(value[k]);
    }
    frames[id] = next;
    writeItemLayout(layoutFile, frames);
    return { ok: true };
  }
  function abs(path) {
    const p = resolve(root, path);
    if (!p.startsWith(root + sep) || path.split(/[\\/]/).some((x) => x.startsWith('.')))
      throw new ItemError('No item at that path. Next: list GET /api/items and use a current id.', 404);
    let real;
    try {
      real = realpathSync(p);
    } catch {
      throw new ItemError('Item no longer exists. Next: list GET /api/items and use a current id.', 404);
    }
    if (!real.startsWith(root + sep)) throw new ItemError('Item is outside the opened folder. Next: use a path inside the folder.', 404);
    return real;
  }
  function scan() {
    const files = [];
    function walk(d, depth) {
      watchDir(d);
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (depth < 12 && !SKIP.has(e.name)) walk(p, depth + 1);
        } else if (e.isFile() || e.isSymbolicLink()) {
          const path = relative(root, p).split(sep).join('/');
          try {
            if (statSync(abs(path)).isFile()) files.push(path);
          } catch {}
        }
      }
    }
    walk(root, 0);
    listed = files.sort();
    last = Date.now();
    return listed;
  }
  function get(id) {
    if (typeof id !== 'string') throw new ItemError('Send an item id', 400);
    const file = abs(id),
      st = statSync(file);
    if (!st.isFile()) throw new ItemError('This item is not a file. Next: choose a file item.', 404);
    // "Open as": a recipe may name a kind, for a file whose name and contents give no hint.
    let override = null,
      sidecar = '';
    try {
      const rs = statSync(file + '.napkin-recipe.json');
      sidecar = `:${rs.size}:${rs.mtimeMs}`;
      if (rs.size < 65536) {
        const asked = JSON.parse(readFileSync(file + '.napkin-recipe.json', 'utf8')).kind;
        override = kinds().find((k) => k.id === asked) || null;
      }
    } catch {}
    const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs ?? st.mtimeMs}:${st.ctimeMs}${sidecar}`;
    let cached = cache.get(id);
    if (!cached || cached.key !== key) {
      const head = window(file),
        ctx = context(id, head, st.size),
        definition = override || detectKind(ctx);
      ctx.kind = definition.id;
      ctx.definition = definition;
      ctx.file = file;
      let meta;
      try {
        meta = definition.metadata(ctx) || {};
      } catch (e) {
        meta = { error: explainError(e) };
      }
      cached = {
        key,
        definition,
        item: {
          id,
          path: id,
          kind: definition.id,
          mime: typeof definition.mime === 'function' ? definition.mime(ctx) : definition.mime,
          bytes: st.size,
          meta,
        },
      };
      cache.set(id, cached);
    }
    cached.item.meta.family ??= cached.definition.family;
    cached.item.meta.modifiedAt = st.mtimeMs;
    return { ...cached.item, file, definition: cached.definition, key };
  }
  function items() {
    if (!listed || Date.now() - last > 250) scan();
    const out = [];
    for (const p of listed) {
      try {
        const x = get(p);
        out.push({
          id: x.id,
          path: x.path,
          kind: x.kind,
          mime: x.mime,
          bytes: x.bytes,
          meta: x.meta,
        });
      } catch {}
    }
    return out;
  }
  function ctx(id) {
    const item = get(id),
      recipeFile = item.file + '.napkin-recipe.json';
    let recipeBytes = null,
      recipe = {};
    if (existsSync(recipeFile)) {
      // Recipes cannot escape through a symlink either.
      abs(id + '.napkin-recipe.json');
      if (statSync(recipeFile).size > LIMIT) throw new ItemError('Recipe exceeds 1 MiB. Next: delete the recipe file or shrink it.');
      recipeBytes = readFileSync(recipeFile);
      try {
        recipe = JSON.parse(recipeBytes);
      } catch {
        throw new ItemError('Recipe is not valid JSON. Next: fix or delete the .napkin-recipe.json file.', 422);
      }
    }
    const head = window(item.file, 0, Math.min(LIMIT, item.bytes));
    const revision = digest(
      Buffer.concat([Buffer.from(item.key), head, recipeBytes || Buffer.alloc(0)]),
    );
    return {
      ...context(item.path, head, item.bytes),
      ...item,
      head,
      text: decodeText(head),
      recipe,
      recipeBytes,
      recipeFile,
      revision,
    };
  }
  function controls(id) {
    const c = ctx(id);
    return {
      revision: c.revision,
      sections: c.definition
        .controls(c)
        .map((s) => ({ ...s, controls: s.controls.map(({ target, ...control }) => control) })),
    };
  }
  function control(id, name, value, baseRevision, by) {
    const c = ctx(id);
    if (baseRevision !== c.revision)
      throw new ItemError('The item changed. Read its controls and retry.', 409);
    const ctrl = c.definition
      .controls(c)
      .flatMap((s) => s.controls)
      .find((x) => x.id === name);
    if (!ctrl) throw new ItemError('No control with that id. Next: read GET /api/controls/<id> and use a listed control id.', 404);
    validate(ctrl, value);
    const result = c.definition.apply(c, ctrl, value);
    if (!result || (result.source === undefined && !result.recipe))
      throw new ItemError('Kind did not return an edit. Next: check the kind\'s apply function returns bytes.');
    let target, before, after;
    if (result.source !== undefined) {
      if (c.bytes > LIMIT)
        throw new ItemError('Source editing is limited to 1 MiB; use a format adapter', 413);
      target = c.file;
      before = readFileSync(target);
      after = Buffer.from(result.source);
    } else {
      target = c.recipeFile;
      before = c.recipeBytes;
      after = Buffer.from(JSON.stringify(result.recipe, null, 2) + '\n');
    }
    if (before?.equals(after)) throw new ItemError('The value is already set', 400);
    writeItemValue(target, after, {
      ...(before === null ? { exclusive: true } : { guard: before.toString('utf8') }),
      check: () => {
        if (ctx(id).revision !== baseRevision)
          throw new ItemError('The item changed while saving. Next: read the controls again and retry on the new revision.', 409);
      },
    });
    cache.delete(id);
    last = 0;
    const revision = ctx(id).revision;
    const steps = history.get(id) || [];
    steps.push({ target, before, after, revision, by });
    while (steps.length > 50) steps.shift();
    history.set(id, steps);
    saveHistory();
    changed(id, revision);
    return { ok: true, revision };
  }
  function undo(id, by) {
    const steps = history.get(id) || [],
      step = steps.at(-1);
    if (!step) throw new ItemError('No item edit to undo. Next: make an edit first.', 404);
    if (step.by !== by) throw new ItemError('The latest item edit belongs to another caller. Next: ask that caller to undo it.', 409);
    const c = ctx(id);
    if (
      c.revision !== step.revision ||
      !existsSync(step.target) ||
      !readFileSync(step.target).equals(step.after)
    )
      throw new ItemError('The item changed after that edit. Undo would overwrite it. Next: read the item again and retry.', 409);
    const check = () => { if (ctx(id).revision !== step.revision) throw new ItemError('The item changed while undoing. Next: read the item again and retry.',409); };
    if (step.before === null) removeItemRecipe(step.target, check);
    else writeItemValue(step.target, step.before, {guard:step.after.toString('utf8'),check});
    steps.pop();
    cache.delete(id);
    last = 0;
    const revision = ctx(id).revision;
    if (steps.length) steps.at(-1).revision = revision;
    saveHistory();
    changed(id, revision);
    return { ok: true, revision };
  }
  function changed(id, revision) {
    broadcast({ type: 'item-change', item: id, revision });
  }
  function recipe(id) {
    const file = get(id).file + '.napkin-recipe.json';
    if (!existsSync(file)) return {};
    abs(id + '.napkin-recipe.json');
    if (statSync(file).size > LIMIT) throw new ItemError('Recipe exceeds 1 MiB. Next: delete the recipe file or shrink it.');
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  return {
    root,
    items,
    get,
    context: ctx,
    recipe,
    controls,
    control,
    undo,
    abs,
    layout: () => ({ ...frames }),
    setLayout,
    invalidate() {
      last = 0;
    },
    close() {
      clearTimeout(timer);
      for (const w of watchers.values()) w.close();
    },
  };
}
