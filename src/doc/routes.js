// HTTP for the document engine: the engine contract (.dream-gauntlet/plan.md) plus what the canvas needs.
//   GET  /api/files                      { files: [{ path, kind, components: [{ id, name }] }] }
//   GET  /api/component/<id>             { revision, tree: [{ node, tag, start, end, children, ... }] }
//   GET  /api/component/<id>/rules       the component's cascade: sheets and rules with file, line and byte ranges
//   GET  /api/component/<id>/history     napkin's edits to it, newest first
//   GET  /view/<id>?width=W&theme=T      the component as its own document (src/doc/view.js)
//   GET  /raw/<path>                     a file of the folder, as it is (what /view's relative URLs load)
//   POST /api/edit  { component, baseRevision, edits }      -> { ok, revision } | { ok: false, error }
//   POST /api/undo | /api/redo  { component }               your last edit to that component
//   GET  /api/styles  -> { undefinedVars, applied, ... }    POST /api/styles { applied }  (kept outside the folder)
// Writes need an identity (POST /api/session), as every write in napkin does.
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { DocError } from './folder.js';
import { htmlView, createTsxViews } from './view.js';

const TYPES = { '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm' };

export function createDocRoutes(engine, { identify = () => null, permission = () => 'write', broadcast = () => {}, legacy = () => false } = {}) {
  const tsx = createTsxViews(engine);
  engine.events.on('change', (c) => broadcast({ type: 'doc-change', ...c, affects: safe(() => engine.componentsUsing(c.path), []) }));
  engine.events.on('files', () => broadcast({ type: 'doc-files' }));
  engine.events.on('styles', (s) => broadcast({ type: 'doc-styles', ...s }));
  const safe = (fn, d) => { try { return fn(); } catch { return d; } };

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const fail = (res, e) => {
    if (e instanceof DocError) return json(res, e.status, { ok: false, error: e.message, ...(e.revision && { revision: e.revision }), ...(e.matches && { matches: e.matches }) });
    console.error(e); return json(res, 500, { ok: false, error: String(e.message) });
  };
  // The body is kept on the request (req.napkinBody) so a route that falls through can still read it.
  const body = async (req) => {
    if (req.napkinBody === undefined) { let b = ''; for await (const c of req) b += c; req.napkinBody = b; }
    try { return JSON.parse(req.napkinBody); } catch { throw new DocError('body is not JSON', 400); }
  };
  const who = (req) => {
    const name = identify(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]);
    if (!name) throw new DocError('identity required: send "Authorization: Bearer <token>" (POST /api/session { as } gives you one)', 401);
    const mode = permission(name);
    if (mode !== 'write') throw new DocError(`agent "${name}" is ${mode === 'read' ? 'read-only' : 'propose-only'} (napkin.json agents): direct edits are not allowed`, 403);
    return name;
  };

  // Returns true when the request was one of ours.
  return async function handle(req, res, url) {
    const path = url.pathname, method = req.method;
    try {
      if (method === 'GET' && path === '/api/files') return json(res, 200, { files: engine.files() }), true;
      if (path === '/api/styles') {
        if (method === 'GET') return json(res, 200, engine.styles()), true;
        if (method === 'POST') { const m = await body(req); who(req); return json(res, 200, engine.setStyles(m?.applied)), true; }
        return json(res, 405, { ok: false, error: 'method not allowed' }), true;
      }
      if (path.startsWith('/api/component/')) {
        const [enc, sub] = path.slice('/api/component/'.length).split('/');
        const id = decodeURIComponent(enc);
        if (method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' }), true;
        if (!sub) return json(res, 200, engine.tree(id)), true;
        if (sub === 'rules') return json(res, 200, engine.rulesOf(id)), true;
        if (sub === 'history') return json(res, 200, { ok: true, component: engine.component(id).id, history: engine.history(id) }), true;
        return json(res, 404, { ok: false, error: 'not found' }), true;
      }
      if (method === 'POST' && path === '/api/edit') {
        const m = await body(req);
        const by = who(req);
        if (!m || typeof m.component !== 'string') throw new DocError('send { component, baseRevision, edits }', 400);
        return json(res, 200, engine.edit(m.component, { baseRevision: m.baseRevision, edits: m.edits, by, summary: m.summary })), true;
      }
      if (method === 'POST' && (path === '/api/undo' || path === '/api/redo')) {
        // Only for the engine's components; anything else falls through to the TSX-dialect store (src/api.js).
        const raw = await body(req).catch(() => null);
        if (!raw || typeof raw.component !== 'string' || legacy(raw.component) || !engine.has(raw.component)) return false;
        const by = who(req);
        return json(res, 200, path === '/api/undo' ? engine.undo(raw.component, by) : engine.redo(raw.component, by)), true;
      }
      if (method === 'GET' && path.startsWith('/view/')) {
        const id = decodeURIComponent(path.slice('/view/'.length));
        const comp = engine.component(id);
        const v = comp.kind === 'html' ? htmlView(engine, comp) : await tsx.view(comp);
        res.writeHead(v.status || 200, { 'content-type': v.type, 'cache-control': 'no-store' });
        return res.end(v.body), true;
      }
      if (method === 'GET' && path.startsWith('/raw/')) {
        const rel = decodeURIComponent(path.slice('/raw/'.length));
        let p, st; try { p = engine.abs(rel); st = statSync(p); } catch { return json(res, 404, { ok: false, error: `no file ${rel}` }), true; }
        if (!st.isFile()) return json(res, 404, { ok: false, error: `no file ${rel}` }), true;
        res.writeHead(200, { 'content-type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(readFileSync(p)), true;
      }
    } catch (e) { return fail(res, e), true; }
    return false;
  };
}
