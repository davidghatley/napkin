// HTTP for the document engine: the engine contract (.dream-gauntlet/plan.md) plus what the canvas needs.
//   GET  /api/files                      { files: [{ path, kind, components: [{ id, name }] }] }
//   GET  /api/component/<id>             { revision, tree: [{ node, tag, start, end, children, ... }] }
//   GET  /api/component/<id>/rules       the component's cascade: sheets and rules with file, line and byte ranges
//        ?node=<id>&width=W&theme=T      plus `node`: the rules matching that element in cascade order, each value's winner, var()s resolved
//   GET  /api/component/<id>/history     napkin's edits to it, newest first
//   GET  /api/component/<id>/source      { file, revision, source, lines: { node: [first, last] } }: the whole file (the code strip)
//   POST /api/files/duplicate { component, x?, y? }  POST /api/files/rename { component, name }   an HTML file as a whole
//   POST /api/files/trash { component } -> { trash }  POST /api/files/restore { trash }            (a frame: delete and undo)
//   GET  /view/<id>?width=W&theme=T      the component as its own document (src/doc/view.js)
//   GET  /raw/<path>                     a file of the folder, as it is (what /view's relative URLs load)
//   POST /api/edit  { component, baseRevision, edits }      -> { ok, revision } | { ok: false, error }
//                   + dryRun: true                          -> { ok, files: [{ path, text }] }: what the files would hold; nothing is written
//   POST /api/undo | /api/redo  { component }               your last edit to that component
//   GET  /api/styles  -> { undefinedVars, applied, ... }    POST /api/styles { applied }  (kept outside the folder)
// Writes need an identity (POST /api/session), as every write in napkin does.
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { DocError } from './folder.js';
import { detectKind, context as kindContext } from '../kinds/registry.js';
import { explainError } from '../errors.js';
import { htmlView, createTsxViews } from './view.js';
import { createTimeRoutes } from './time-routes.js';

const TYPES = { '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm' };

export function createDocRoutes(engine, { identify = () => null, permission = () => 'write', broadcast = () => {}, legacy = () => false, legacyNewest = () => null, itemRecipe = () => ({}) } = {}) {
  const tsx = createTsxViews(engine);
  // Doc frames never carry a `component` key: the canvas's dialect client treats that key as one of its own components.
  // (A TSX file's frame names the file only: parsing it on every dialect save would slow the dialect canvas for nothing.)
  engine.events.on('change', ({ component, ...c }) => broadcast({ type: 'doc-change', ...c, via: component ?? null, affects: /\.(html?|css)$/i.test(c.path) ? safe(() => engine.componentsUsing(c.path), []) : [] }));
  engine.events.on('files', () => broadcast({ type: 'doc-files' }));
  engine.events.on('styles', (s) => broadcast({ type: 'doc-styles', ...s }));
  const safe = (fn, d) => { try { return fn(); } catch { return d; } };

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  // Every error leaves with one next step (explainError), like every other napkin boundary.
  const fail = (res, status, error, extra = {}) => json(res, status, { ok: false, error: explainError(error), ...extra });
  const failWith = (res, e) => {
    if (e instanceof DocError) return fail(res, e.status, e.message, { ...(e.revision && { revision: e.revision }), ...(e.matches && { matches: e.matches }) });
    console.error(e); return fail(res, 500, String(e.message));
  };
  // The body is kept on the request (req.napkinBody) so a route that falls through can still read it.
  const body = async (req) => {
    if (req.napkinBody === undefined) { let b = ''; for await (const c of req) b += c; req.napkinBody = b; }
    try { return JSON.parse(req.napkinBody); } catch { throw new DocError('body is not JSON. Next: send valid JSON and retry', 400); }
  };
  const who = (req) => {
    const name = identify(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]);
    if (!name) throw new DocError('identity required: send "Authorization: Bearer <token>" (POST /api/session { as } gives you one)', 401);
    const mode = permission(name);
    if (mode !== 'write') throw new DocError(`agent "${name}" is ${mode === 'read' ? 'read-only' : 'propose-only'} (napkin.json agents): direct edits are not allowed. Next: check the caller name and permissions in napkin.json`, 403);
    return name;
  };

  // ---- time and code (moments 9 and 10): the film strip's history, restore and the copy payload (time-routes.js) ----
  const time = createTimeRoutes(engine, { tsx, who, json, body, fail });

  // Returns true when the request was one of ours.
  return async function handle(req, res, url) {
    const path = url.pathname, method = req.method;
    try {
      if (await time(req, res, url)) return true;
      if (method === 'GET' && path === '/api/files') return json(res, 200, { folder: engine.root.split('/').filter(Boolean).pop(), files: engine.files(url.searchParams.get('kinds') ? { kinds: url.searchParams.get('kinds').split(',') } : {}) }), true;
      if (path === '/api/styles') {
        if (method === 'GET') return json(res, 200, engine.styles()), true;
        if (method === 'POST') { const m = await body(req); who(req); return json(res, 200, engine.setStyles(m?.applied)), true; }
        return fail(res, 405, 'method not allowed: use GET or POST as listed in /api/guide'), true;
      }
      if (path.startsWith('/api/component/')) {
        const [enc, sub] = path.slice('/api/component/'.length).split('/');
        const id = decodeURIComponent(enc);
        if (method !== 'GET') return fail(res, 405, 'method not allowed: use GET or POST as listed in /api/guide'), true;
        if (!sub) return json(res, 200, engine.tree(id)), true;
        if (sub === 'rules') {
          const node = url.searchParams.get('node');
          return json(res, 200, node ? engine.rulesAt(id, node, { width: url.searchParams.get('width'), theme: url.searchParams.get('theme') }) : engine.rulesOf(id)), true;
        }
        if (sub === 'history') return json(res, 200, { ok: true, component: engine.component(id).id, history: engine.history(id) }), true;
        if (sub === 'source') return json(res, 200, engine.source(id)), true;
        return fail(res, 404, 'not found: use /api/component/<id>, /rules, /history or /source'), true;
      }
      if (path === '/api/layout') {
        if (method === 'GET') return json(res, 200, { ok: true, frames: engine.layout() }), true;
        const m = await body(req); who(req);
        const n = (v) => (v === undefined || v === null ? v : Number(v));
        return json(res, 200, engine.setLayout(m?.component, { x: n(m?.x), y: n(m?.y), width: n(m?.width) })), true;
      }
      const fileOp = /^\/api\/files\/(duplicate|rename|trash|restore)$/.exec(path);
      if (fileOp && method === 'POST') {
        const m = await body(req); who(req);
        const r = fileOp[1] === 'duplicate' ? engine.duplicateFile(m?.component, { x: Number(m?.x), y: Number(m?.y) })
          : fileOp[1] === 'rename' ? engine.renameFile(m?.component, m?.name)
          : fileOp[1] === 'trash' ? engine.trashFile(m?.component) : engine.restoreFile(m?.trash);
        return json(res, 200, r), true;
      }
      if (method === 'POST' && path === '/api/edit') {
        const m = await body(req);
        const by = who(req);
        if (!m || typeof m.component !== 'string') throw new DocError('send { component, baseRevision, edits }', 400);
        return json(res, 200, engine.edit(m.component, { baseRevision: m.baseRevision, edits: m.edits, by, summary: m.summary, dryRun: m.dryRun === true })), true;
      }
      const step = /^\/api\/(undo|redo)$/.exec(path) || /^\/api\/components\/([^/]+)\/(undo|redo)$/.exec(path);
      if (method === 'POST' && step) {
        // Only for the engine's components; anything else falls through to the TSX-dialect store (src/api.js). With no
        // component named, the caller's newest step in either engine is the one undone.
        const verb = step.length === 2 ? step[1] : step[2];
        const raw = await body(req).catch(() => null);
        let id = step.length === 3 ? decodeURIComponent(step[1]) : raw?.component;
        if (id === undefined || id === null) {
          const name = identify(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]);
          const mine = name && engine.latest(verb, name);
          if (!mine || (legacyNewest(verb, name) ?? -1) > mine.at) return false;
          id = mine.component;
        }
        if (typeof id !== 'string' || legacy(id) || !engine.has(id)) return false;
        const by = who(req);
        const r = verb === 'undo' ? engine.undo(id, by) : engine.redo(id, by);
        return json(res, 200, { ...r, [verb === 'undo' ? 'undone' : 'redone']: { summary: engine.history(id)[0]?.summary?.replace(/^(undo|redo): /, '') } }), true;
      }
      if (method === 'GET' && path.startsWith('/view/')) {
        const id = decodeURIComponent(path.slice('/view/'.length));
        const comp = engine.component(id);
        // ?props={...} draws a component with those props (Compare variants shows one frame per declared variant).
        let props = null; try { const q = url.searchParams.get('props'); props = q ? JSON.parse(q) : null; } catch {}
        const v = comp.kind === 'html' ? htmlView(engine, comp) : await tsx.view(comp, null, props && typeof props === 'object' && !Array.isArray(props) ? props : null);
        // The item contract identifies the document root without changing its source file.
        const source = Buffer.isBuffer(v.body) ? v.body : Buffer.from(v.body);
        const at = /<html\b/i.exec(source.toString('latin1'));
        // An animated page is still an html component; its item kind says what moves it.
        let itemKind = comp.kind;
        if (comp.kind === 'html') try { itemKind = detectKind(kindContext(comp.path, source.subarray(0, 65536), source.length)).id; } catch {}
        const marker = Buffer.from(` data-napkin-kind="${itemKind}"`);
        const doctype = /^(?:\xEF\xBB\xBF)?\s*<!doctype[^>]*>/i.exec(source.toString('latin1'));
        v.body = at
          ? Buffer.concat([source.subarray(0, at.index + 5), marker, source.subarray(at.index + 5)])
          : Buffer.concat([source.subarray(0, doctype?.[0].length || 0), Buffer.from(`<html data-napkin-kind="${itemKind}">`), source.subarray(doctype?.[0].length || 0), Buffer.from('</html>')]);
        const recipe = itemRecipe(comp.path);
        if (Number.isFinite(recipe.zoom)) v.body = Buffer.concat([v.body, Buffer.from(`<style data-napkin>html{zoom:${recipe.zoom / 100}}</style>`)]);
        res.writeHead(v.status || 200, { 'content-type': v.type, 'cache-control': 'no-store' });
        return res.end(v.body), true;
      }
      if (method === 'GET' && path.startsWith('/raw/')) {
        const rel = decodeURIComponent(path.slice('/raw/'.length));
        // a folder's dotfiles (.git/config, .env, .napkin) are not its design: never served, whatever the path says
        // the URL as the client wrote it: `new URL` has already folded ./ and ../ away, so look at the raw request line
        const asked = String(req.url || '').split(/[?#]/)[0].slice('/raw/'.length).split('/').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
        if ([...asked, ...rel.split(/[\\/]/)].some((seg) => seg.startsWith('.') || seg === '..')) return fail(res, 404, `no file ${rel} in the folder: check the path`), true;
        let p, st; try { p = engine.abs(rel); st = statSync(p); } catch { return fail(res, 404, `no file ${rel} in the folder: check the path`), true; }
        if (!st.isFile()) return fail(res, 404, `no file ${rel} in the folder: check the path`), true;
        res.writeHead(200, { 'content-type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(readFileSync(p)), true;
      }
    } catch (e) { return failWith(res, e), true; }
    return false;
  };
}
