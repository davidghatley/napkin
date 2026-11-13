// The surface's own routes: the dials library for the canvas, the command registry and its bindings (/api/keys),
// the board (/api/board: selection, groups, arrangement, comparison, presentation) and the depth a person opened
// each instrument section at (folded into GET /api/controls/<id>).
//
// None of this is written into the folder: board and bindings live in napkin's state dir, under a hash of the
// folder's real path (the same place the item layout is kept), so organising a folder never dirties it.
import { readFileSync, existsSync, realpathSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, sep, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stateRoot } from '../doc/folder.js';
import { writeAtomic } from '../atomic.js';
import { explainError } from '../errors.js';
import { ACTIONS } from '../../public/canvas/actions.js';
import { normalizeKeys } from '../../public/canvas/keynames.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIALS = join(ROOT, 'public/dials');
const TYPES = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', svg: 'image/svg+xml', json: 'application/json' };
const ARRANGE = ['kind', 'folder', 'date', 'similarity', 'tag', 'status', 'run', 'manual'];
const digest = (b) => createHash('sha256').update(b).digest('hex').slice(0, 20);

class SurfaceError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

/** The bindings and palette entries the registry declares (actions.js), with the person's rebinds on top. */
export function keyMap(rebinds = {}) {
  const commands = ACTIONS.filter((a) => a.run).map((a) => ({ id: a.id, label: a.label, palette: a.palette !== false && !!(a.run || a.phrase), ...(a.phrase && { phrase: a.phrase }), ...(a.about && { about: a.about }) }));
  const bindings = [];
  for (const a of ACTIONS) {
    const keys = rebinds[a.id] ?? (a.command ? a.keys : null);
    if (keys) bindings.push({ command: a.id, label: a.label, keys, ...(rebinds[a.id] && { rebound: true }) });
  }
  // The fixed keys of the canvas itself (the palette, the map) are bindings too, so the map is complete.
  for (const [id, keys] of [['quick', 'Ctrl+K'], ['help', '?']]) if (!bindings.some((b) => b.command === id)) bindings.push({ command: id, label: ACTIONS.find((a) => a.id === id).label, keys: rebinds[id] ?? keys });
  return { bindings, commands };
}

// Groups the data implies for one arrangement. Values come from the item (kind, folder, date) or its metadata.
function valueOf(item, by) {
  const m = item.meta || {};
  const pick = (name) => m[name] ?? m.front?.[name] ?? m.frontMatter?.[name] ?? m.provenance?.[name];
  if (by === 'kind') return item.kind;
  if (by === 'folder') return posix.dirname(item.path) === '.' ? '(top level)' : posix.dirname(item.path);
  if (by === 'date') { const t = Number(m.modifiedAt); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : 'Undated'; }
  if (by === 'tag') { const t = pick('tags') ?? pick('tag'); return Array.isArray(t) ? (t[0] ?? 'Untagged') : t ?? 'Untagged'; }
  if (by === 'status') return pick('status') ?? 'No status';
  if (by === 'run') return pick('run') ?? m.run?.name ?? 'No run';
  if (by === 'similarity') return m.similarity ?? m.tone ?? m.family ?? 'other';
  if (by.startsWith('meta.')) { const k = by.slice(5), v = pick(k) ?? m.table?.columns?.find((c) => c.name === k)?.top; return v === undefined || v === null ? `No ${k}` : String(v); }
  return null;
}
export function arrange(list, by) {
  if (!by || by === 'manual') return [];
  const groups = new Map();
  for (const item of list) {
    const v = String(valueOf(item, by));
    if (!groups.has(v)) groups.set(v, { id: `arrange:${by}:${v}`, name: v, items: [] });
    groups.get(v).items.push(item.id);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createSurfaceRoutes({ items, dir, openFolder, identify, permission = () => 'write', stateDir = stateRoot() }) {
  let root = dir;
  try { root = realpathSync(dir); } catch {}
  const folder = join(stateDir, digest(Buffer.from(root)));
  const file = join(folder, 'surface.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const board = {
    arrange: { by: ARRANGE.includes(saved.arrange?.by) || /^meta\.[\w.-]+$/.test(saved.arrange?.by || '') ? saved.arrange.by : 'manual' },
    groups: Array.isArray(saved.groups) ? saved.groups : [], // the person's own named groups
    views: Array.isArray(saved.views) ? saved.views : [],
    depths: saved.depths && typeof saved.depths === 'object' ? saved.depths : {},
    rebinds: saved.rebinds && typeof saved.rebinds === 'object' ? saved.rebinds : {},
    palettes: saved.palettes && typeof saved.palettes === 'object' ? saved.palettes : {}, // colours kept in a colour studio: item -> control -> [colour]
    selection: [], compare: null, presentation: false, // what is on screen now: not kept across restarts
  };
  const persist = () => { mkdirSync(folder, { recursive: true }); writeAtomic(file, JSON.stringify({ arrange: board.arrange, groups: board.groups, views: board.views, depths: board.depths, rebinds: board.rebinds, palettes: board.palettes }, null, 1)); };
  const list = () => { try { return items.items(); } catch { return []; } };
  const known = () => new Set(list().map((x) => x.id));
  function view() {
    const ids = known();
    const arranged = arrange(list(), board.arrange.by);
    const manual = board.groups.map((g) => ({ ...g, items: g.items.filter((id) => ids.has(id)), manual: true }));
    return { ok: true, arrange: { ...board.arrange }, groups: [...arranged, ...manual], views: board.views, selection: [...board.selection], compare: board.compare, presentation: board.presentation };
  }
  // A board write sent by a key press must be visible to a read that starts while it is still arriving.
  let inflight = 0;
  const waiters = new Set();
  const settled = () => inflight ? new Promise((r) => { waiters.add(r); setTimeout(r, 300); }) : null;
  const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    let b = '';
    for await (const c of req) { b += c; if (b.length > 1 << 20) throw new SurfaceError('Request exceeds 1 MiB. Next: send a smaller body.', 413); }
    try { return JSON.parse(b || '{}'); } catch { throw new SurfaceError('Send valid JSON.'); }
  }
  function who(req) {
    const by = identify?.(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]);
    if (!by) throw new SurfaceError('Identity required. Next: POST /api/session { as } and send the bearer token.', 401);
    if (permission(by) === 'read') throw new SurfaceError('This caller is read-only. Next: ask the person to grant write in napkin.json.', 403);
    return by;
  }
  const strings = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');

  function patch(m) {
    let save = false;
    if (m.selection !== undefined) { if (!strings(m.selection)) throw new SurfaceError('selection is a list of item ids. Next: send { selection: ["path"] }.'); board.selection = [...new Set(m.selection)].slice(0, 5000); }
    if (m.presentation !== undefined) board.presentation = !!m.presentation;
    if (m.compare !== undefined) {
      if (m.compare !== null && (typeof m.compare?.item !== 'string' || !Array.isArray(m.compare.variants))) throw new SurfaceError('compare is { item, variants: [...] } or null. Next: send that shape.');
      board.compare = m.compare && { item: m.compare.item, variants: m.compare.variants.slice(0, 64) };
    }
    if (m.arrange !== undefined) {
      const by = String(m.arrange?.by ?? '');
      if (!ARRANGE.includes(by) && !/^meta\.[\w. -]+$/.test(by)) throw new SurfaceError(`Arrange by one of ${ARRANGE.join(', ')} or meta.<column>. Next: use one of those names.`);
      board.arrange = { by }; save = true;
    }
    if (m.group !== undefined) { // add one named group: { name, items }
      const name = String(m.group?.name ?? '').trim();
      if (!name || !strings(m.group?.items) || !m.group.items.length) throw new SurfaceError('group is { name, items: [ids] } with at least one item. Next: send that shape.');
      const id = 'group:' + digest(Buffer.from(name + Date.now() + Math.random())).slice(0, 10);
      board.groups = board.groups.filter((g) => g.name !== name).concat({ id, name, items: [...new Set(m.group.items)], ...(m.group.pinned && { pinned: m.group.pinned }) });
      save = true;
    }
    if (m.groups !== undefined) {
      if (!Array.isArray(m.groups)) throw new SurfaceError('groups is a list. Next: send an array.');
      board.groups = m.groups.filter((g) => !String(g.id || '').startsWith('arrange:')).map((g) => ({ id: String(g.id || 'group:' + digest(Buffer.from(String(g.name) + Math.random())).slice(0, 10)), name: String(g.name || 'Group'), items: strings(g.items) ? g.items : [], ...(g.groups && { groups: g.groups }), ...(g.pinned && { pinned: g.pinned }) }));
      save = true;
    }
    if (m.views !== undefined) { if (!Array.isArray(m.views)) throw new SurfaceError('views is a list. Next: send an array.'); board.views = m.views.slice(0, 100); save = true; }
    if (m.depth !== undefined) { // { item, section, depth }
      const { item, section, depth } = m.depth || {};
      if (typeof item !== 'string' || typeof section !== 'string' || ![1, 2, 3].includes(depth)) throw new SurfaceError('depth is { item, section, depth: 1|2|3 }. Next: send that shape.');
      (board.depths[item] ||= {})[section] = depth; save = true;
    }
    if (m.palette !== undefined) { // { item, control, palette: [colour] }
      const { item, control, palette } = m.palette || {};
      if (typeof item !== 'string' || typeof control !== 'string' || !strings(palette)) throw new SurfaceError('palette is { item, control, palette: [colours] }. Next: send that shape.');
      const all = (board.palettes[item] ||= {});
      if (palette.length) all[control] = palette.slice(0, 64); else delete all[control];
      if (!Object.keys(all).length) delete board.palettes[item];
      save = true;
    }
    if (save) persist();
  }

  return async (req, res, url) => {
    const path = url.pathname;
    // An instrument write (POST /api/control, POST /api/undo; served by the item routes) or a board write still arriving
    // is waited for by the reads that follow it.
    if (req.method === 'POST' && (path === '/api/control' || path === '/api/undo')) { inflight++; let done = false; const end = () => { if (done) return; done = true; inflight--; if (!inflight) { for (const w of waiters) w(); waiters.clear(); } }; res.on('finish', end); res.on('close', end); return false; }
    try {
      if (req.method === 'GET' && path.startsWith('/dials/')) {
        const rel = decodeURIComponent(path.slice(7));
        const abs = resolve(DIALS, rel), ext = rel.split('.').pop();
        if (!abs.startsWith(DIALS + sep) || !TYPES[ext] || rel.split('/').some((p) => p.startsWith('.')) || !existsSync(abs)) return false;
        res.writeHead(200, { 'content-type': TYPES[ext], 'cache-control': ext === 'woff2' ? 'public, max-age=86400' : 'no-store' });
        res.end(readFileSync(abs));
        return true;
      }
      if (path === '/api/keys') {
        if (req.method === 'GET') return json(res, 200, { ok: true, ...keyMap(board.rebinds) }), true;
        if (req.method === 'POST') {
          const m = await body(req); who(req);
          const a = ACTIONS.find((x) => x.id === m.command) || ACTIONS.find((x) => x.label.toLowerCase() === String(m.command || '').toLowerCase().trim());
          if (!a) throw new SurfaceError('No command by that name. Next: read GET /api/keys and use a listed command id.', 404);
          if (m.keys === null || m.keys === '') delete board.rebinds[a.id];
          else {
            const keys = normalizeKeys(m.keys);
            if (!keys) throw new SurfaceError('Those keys cannot be read. Next: write a chord such as Alt+Y, or a sequence such as "A K".');
            board.rebinds[a.id] = keys;
          }
          persist();
          return json(res, 200, { ok: true, command: a.id, ...keyMap(board.rebinds) }), true;
        }
        throw new SurfaceError('method not allowed. Next: use GET or POST.', 405);
      }
      if (path === '/api/folder') {
        if (req.method === 'GET') return json(res, 200, { ok: true, folder: dir }), true;
        if (req.method !== 'POST') throw new SurfaceError('method not allowed. Next: use GET or POST.', 405);
        const m = await body(req); who(req);
        if (!openFolder) throw new SurfaceError('This napkin cannot switch folders. Next: run napkin open <folder>.', 501);
        try { return json(res, 200, { ok: true, ...(await openFolder(m.folder)) }), true; }
        catch (e) { throw Object.assign(new SurfaceError(explainError(e.message), e.status || 400), { status: e.status || 400 }); }
      }
      if (path === '/api/board') {
        if (req.method === 'GET') { await settled(); return json(res, 200, view()), true; }
        if (req.method === 'POST') {
          inflight++;
          try { const m = await body(req); who(req); patch(m); }
          finally { inflight--; if (!inflight) { for (const w of waiters) w(); waiters.clear(); } }
          return json(res, 200, view()), true;
        }
        throw new SurfaceError('method not allowed. Next: use GET or POST.', 405);
      }
      // The schema with the depth each section was last opened at on the canvas.
      if (req.method === 'GET' && path.startsWith('/api/controls/') && items?.controls) {
        const id = decodeURIComponent(path.slice(14));
        await settled();
        const schema = items.controls(id), depths = board.depths[id];
        // A section the person opened at a depth reports that depth for its controls; nativeDepth keeps the one they were declared with.
        if (depths) for (const s of schema.sections || []) if (depths[s.id]) { s.depth = depths[s.id]; for (const c of s.controls) { c.nativeDepth = c.depth; c.depth = depths[s.id]; } }
        const kept = board.palettes[id];
        if (kept) for (const sec of schema.sections || []) for (const c of sec.controls) if (kept[c.id]) c.palette = kept[c.id];
        return json(res, 200, schema), true;
      }
    } catch (e) {
      json(res, e.status || 400, { ok: false, error: explainError(e) });
      return true;
    }
    return false;
  };
}
