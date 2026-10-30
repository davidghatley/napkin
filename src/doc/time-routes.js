// HTTP for the film strip (moment 9) and Copy gives real code (moment 10). Mounted by routes.js in its own block.
//   GET  /api/component/<id>/film                    { git, now, frames: [{ id, ids, count, source, at, by, summary, what, where, same, beforeId }] } newest first
//   GET  /api/component/<id>/film/<frame>/diff       { removed, added, first }  lines between that version and the files now
//   GET  /view/<id>?version=<frame>&width=W          the component as that version of ITS FILES drew it (read-only; nothing is written)
//   GET  /vraw/<id>/<frame>/<path>                   a file of that version (a file the version has no copy of is the folder's own)
//   POST /api/component/<id>/film/restore { frame }  every file of that version is put back: one edit, one undo step; 409 with the reason when it would undo someone else's work
//   GET  /api/component/<id>/copy?node=N&rule=file:start-end&var=--name   the element's source and the CSS rules' exact text
import { extname } from 'node:path';
import { htmlView } from './view.js';
import { L } from './source.js';
import { parseHtml } from './html.js';
import { createFilm, FilmError } from './history.js';
import { copyPayload } from './copy.js';
import { DocError } from './folder.js';
import { explainError } from '../errors.js';

const TYPES = { '.css': 'text/css', '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const enc = encodeURIComponent;

export function createTimeRoutes(engine, { tsx, who, json, body, fail }) {
  const film = createFilm(engine);
  film.sweep(); // a removed component's film goes when the folder opens, not on the first look at the strip
  const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof FilmError) throw new DocError(/Next:/.test(e.message) ? e.message : explainError(e.message), e.status); throw e; } };
  return async function handle(req, res, url) {
    const path = url.pathname, method = req.method;
    if (method === 'GET' && path.startsWith('/view/') && url.searchParams.has('version')) {
      const comp = engine.component(decodeURIComponent(path.slice('/view/'.length)));
      const snap = guard(() => film.snapshotOf(comp.id, url.searchParams.get('version')));
      let v;
      if (comp.kind === 'html') {
        const fake = (p) => { const buf = snap.files.get(p); const e = { buf, s: L(buf), rev: 'version' }; if (p === comp.path) e.html = parseHtml(e.s); return e; };
        v = htmlView({ read: (p) => (snap.files.has(p) ? fake(p) : engine.read(p)), applied: () => (snap.frame.applied ?? engine.applied()).filter((p) => snap.files.has(p)) }, comp, { prefix: `/vraw/${enc(comp.id)}/${enc(snap.frame.id)}/` });
      } else v = await tsx.view(comp, snap.files);
      res.writeHead(v.status || 200, { 'content-type': v.type, 'cache-control': 'no-store' });
      return res.end(v.body), true;
    }
    const raw = method === 'GET' && /^\/vraw\/([^/]+)\/([^/]+)\/(.+)$/.exec(path);
    if (raw) {
      const rel = decodeURIComponent(raw[3]);
      const snap = guard(() => film.snapshotOf(decodeURIComponent(raw[1]), decodeURIComponent(raw[2])));
      const bytes = snap.files.get(rel);
      // A stylesheet the version does not have is not part of it: never the live one. (Images, fonts and the like are the folder's own.)
      if (!bytes && /\.css$/i.test(rel)) { res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' }); return res.end('/* not part of this version */\n'), true; }
      if (!bytes) { res.writeHead(302, { location: '/raw/' + rel.split('/').map(enc).join('/'), 'cache-control': 'no-store' }); return res.end(), true; }
      res.writeHead(200, { 'content-type': TYPES[extname(rel).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(bytes), true;
    }
    const m = /^\/api\/component\/([^/]+)\/(film|copy)(?:\/([^/]+)(?:\/(diff))?)?$/.exec(path);
    if (!m) return false;
    const id = decodeURIComponent(m[1]), comp = engine.component(id);
    if (m[2] === 'copy') {
      if (method !== 'GET') return fail(res, 405, 'method not allowed: use GET'), true;
      const rules = url.searchParams.getAll('rule').map((r) => { const x = /^(.+):(\d+)-(\d+)$/.exec(r); return x ? { file: x[1], start: +x[2], end: +x[3] } : null; }).filter(Boolean);
      return json(res, 200, copyPayload(engine, id, url.searchParams.get('node'), rules, url.searchParams.getAll('var'))), true;
    }
    if (method === 'GET' && !m[3]) return json(res, 200, { ok: true, component: comp.id, file: comp.path, ...guard(() => film.list(comp.id)) }), true;
    if (method === 'GET' && m[4] === 'diff') return json(res, 200, { ok: true, ...guard(() => film.diff(comp.id, m[3])) }), true;
    if (method === 'POST' && m[3] === 'restore') {
      const b = await body(req); const by = who(req);
      if (typeof b?.frame !== 'string') throw new DocError('send { frame }. Next: take the frame id from the strip', 400);
      const plan = guard(() => film.restorePlan(comp.id, b.frame));
      const when = new Date(plan.frame.at).toLocaleString('en-GB', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      if (!plan.files.length) return json(res, 200, { ok: true, noop: true, changed: [], component: comp.id }), true;
      return json(res, 200, { ...engine.restore(comp.id, { files: plan.files, by, summary: plan.frame.short ? `Restored commit ${plan.frame.short}` : `Restored the version from ${when}` }), ...(plan.kept.length && { kept: plan.kept }) }), true;
    }
    return fail(res, 404, 'not found: use /film, /film/<frame>/diff, /film/restore or /copy'), true;
  };
}
