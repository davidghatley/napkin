// HTTP for the film strip (moment 9) and Copy gives real code (moment 10). Mounted by routes.js in its own block.
//   GET  /api/component/<id>/film                    { git, now, frames: [{ id, source: 'napkin'|'git', at, by, summary, same }] } newest first
//   GET  /api/component/<id>/film/<frame>/diff       { removed, added, first }  lines between that version and the file now
//   GET  /view/<id>?version=<frame>&width=W          the component as that version of its file drew it (read-only; nothing is written)
//   POST /api/component/<id>/film/restore { frame }  the file becomes that version: one edit, one undo step
//   GET  /api/component/<id>/copy?node=N&rule=file:start-end&var=--name   the element's source and the CSS rules' exact text
import { htmlView } from './view.js';
import { L } from './source.js';
import { parseHtml } from './html.js';
import { createFilm, FilmError } from './history.js';
import { copyPayload } from './copy.js';
import { DocError } from './folder.js';
import { explainError } from '../errors.js';

export function createTimeRoutes(engine, { tsx, who, json, body, fail }) {
  const film = createFilm(engine);
  const guard = (fn) => { try { return fn(); } catch (e) { if (e instanceof FilmError) throw new DocError(explainError(e.message), e.status); throw e; } };
  return async function handle(req, res, url) {
    const path = url.pathname, method = req.method;
    if (method === 'GET' && path.startsWith('/view/') && url.searchParams.has('version')) {
      const comp = engine.component(decodeURIComponent(path.slice('/view/'.length)));
      const bytes = guard(() => film.bytes(comp.path, url.searchParams.get('version')));
      let v;
      if (comp.kind === 'html') {
        const fake = { buf: bytes, s: L(bytes), rev: 'version' };
        fake.html = parseHtml(fake.s);
        v = htmlView({ read: (p) => (p === comp.path ? fake : engine.read(p)), applied: () => engine.applied() }, comp);
      } else v = await tsx.view(comp, bytes);
      res.writeHead(v.status || 200, { 'content-type': v.type, 'cache-control': 'no-store' });
      return res.end(v.body), true;
    }
    const m = /^\/api\/component\/([^/]+)\/(film|copy)(?:\/([^/]+)(?:\/(diff))?)?$/.exec(path);
    if (!m) return false;
    const id = decodeURIComponent(m[1]), comp = engine.component(id);
    if (m[2] === 'copy') {
      if (method !== 'GET') return fail(res, 405, 'method not allowed: use GET'), true;
      const rules = url.searchParams.getAll('rule').map((r) => { const x = /^(.+):(\d+)-(\d+)$/.exec(r); return x ? { file: x[1], start: +x[2], end: +x[3] } : null; }).filter(Boolean);
      return json(res, 200, copyPayload(engine, id, url.searchParams.get('node'), rules, url.searchParams.getAll('var'))), true;
    }
    if (method === 'GET' && !m[3]) return json(res, 200, { ok: true, component: comp.id, file: comp.path, ...guard(() => film.list(comp.path)) }), true;
    if (method === 'GET' && m[4] === 'diff') return json(res, 200, { ok: true, ...guard(() => film.diff(comp.path, m[3])) }), true;
    if (method === 'POST' && m[3] === 'restore') {
      const b = await body(req); const by = who(req);
      const frames = guard(() => film.list(comp.path)).frames;
      const f = frames.find((x) => x.id === b?.frame);
      if (!f) throw new DocError('no such frame. Next: reload the strip and pick one', 404);
      const bytes = guard(() => film.bytes(comp.path, f.id));
      const when = new Date(f.at).toLocaleString('en-GB', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return json(res, 200, engine.restore(id, { bytes, by, summary: `Restored the version from ${when}` })), true;
    }
    return fail(res, 404, 'not found: use /film, /film/<frame>/diff, /film/restore or /copy'), true;
  };
}
