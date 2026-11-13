// HTTP for agents (DREAM 3 D5). Mounted by src/server.js next to the item routes; each MCP tool in src/agents/tools.js
// is one of these routes.
//
//   POST /api/runs {name, plan?, goal?}                 -> { id, run }
//   GET  /api/runs | GET /api/runs/<id>                 -> { runs: [summary] } | the run (plan, steps, artifacts, questions, proposals, checkpoints)
//   POST /api/runs/<id>/steps {id, label?, status?, note?}
//   POST /api/runs/<id>/artifacts {path, content, encoding, kind?, step?, overwrite?, propose?}
//   POST /api/runs/<id>/proposals {path, content, encoding, note?, step?, replaces?} | {item, control, value, baseRevision?}
//   POST /api/runs/<id>/checkpoint {label?} | POST /api/runs/<id>/resume | POST /api/runs/<id>/status {status, note?}
//   GET  /api/runs/<id>/audit
//   POST /api/proposals/file {path, content, ...}       a proposal that belongs to no run
//   POST /api/questions {run?, text, options?}          | GET /api/questions/<id>?wait=ms | POST /api/questions/<id>/answer {answer}
//   GET  /api/review                                    what waits for the person: { proposals, questions, count }
//   GET  /api/review/<id>/content                       the bytes of a proposed file
//   POST /api/review/<id> {outcome: accepted|rejected|sent-back|comment, comment?}
//   GET  /api/event-log?since&wait&run&types&limit&peek  the durable log; without `since`, what is new for the caller
//   GET  /api/agents | GET /api/audit?run&limit | GET /api/read?item&offset&length&encoding
//   GET|POST /api/board
// Reading needs no identity. Writing needs a session (POST /api/session { as }) whose napkin.json mode is `write`;
// mode `propose` may start runs, post steps, ask, comment and propose (files it would write become proposals).
import { RunError } from './store.js';
import { explainError } from '../errors.js';
import { openSync, readSync, closeSync, statSync } from 'node:fs';

const BODY_LIMIT = 56 * 1024 * 1024;

export function createAgentRoutes({ runs, board, items, identify, permission = () => 'write' }) {
  const json = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  async function body(req) {
    if (req.napkinBody === undefined) {
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > BODY_LIMIT) throw new RunError('Request exceeds 56 MiB. Next: write large files into the folder directly.', 413); chunks.push(c); }
      req.napkinBody = Buffer.concat(chunks).toString('utf8');
    }
    if (!req.napkinBody.trim()) return {};
    try { const v = JSON.parse(req.napkinBody); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* below */ }
    throw new RunError('Send a JSON object. Next: fix the request body and retry.');
  }
  const who = (req, need = 'propose') => {
    const by = identify?.(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]);
    if (!by) throw new RunError('Identity required. Next: POST /api/session { as } and send the bearer token.', 401);
    const mode = permission(by);
    if (mode === 'read' || (need === 'write' && mode !== 'write'))
      throw new RunError(`"${by}" has ${mode} permission and this needs ${need}. Next: ask the person to change agents in napkin.json, or use propose.`, 403, { permission: mode });
    return { by, mode };
  };
  const q = (url, k) => url.searchParams.get(k) ?? undefined;
  const seg = (path) => path.split('/').slice(2).map(decodeURIComponent);

  return async (req, res, url) => {
    const path = url.pathname;
    if (!path.startsWith('/api/')) return false;
    const [a, id, c] = seg(path), m = req.method;
    try {
      // ---- runs
      if (a === 'runs') {
        if (!id && m === 'GET') return json(res, 200, { runs: runs.runs().map(runs.summary) }), true;
        if (!id && m === 'POST') { const { by } = who(req); return json(res, 200, runs.startRun(by, await body(req))), true; }
        if (id && !c && m === 'GET') return json(res, 200, runs.get(id)), true;
        if (id && c === 'audit' && m === 'GET') return json(res, 200, { events: runs.audit({ run: id, limit: Number(q(url, 'limit')) || 200 }) }), true;
        if (id && m === 'POST') {
          if (c === 'steps') { const { by } = who(req); return json(res, 200, runs.step(by, id, await body(req))), true; }
          if (c === 'artifacts') {
            const { by, mode } = who(req); const b = await body(req);
            return json(res, 200, runs.artifact(by, id, { ...b, mode })), true;
          }
          if (c === 'proposals') { const { by } = who(req); return json(res, 200, runs.propose(by, id, await body(req))), true; }
          if (c === 'checkpoint') { const { by } = who(req); return json(res, 200, runs.checkpoint(by, id, (await body(req)).label)), true; }
          if (c === 'resume') { const { by } = who(req); return json(res, 200, runs.resume(by, id)), true; }
          if (c === 'status') { const { by } = who(req); const b = await body(req); return json(res, 200, runs.setStatus(by, id, b.status, b.note)), true; }
        }
      }
      // ---- proposals and questions that belong to no run
      if (a === 'proposals' && id === 'file' && m === 'POST') { const { by } = who(req); return json(res, 200, runs.propose(by, null, await body(req))), true; }
      if (a === 'questions') {
        if (!id && m === 'POST') { const { by } = who(req); return json(res, 200, runs.ask(by, await body(req))), true; }
        if (!id && m === 'GET') { const r = runs.review(); return json(res, 200, { questions: q(url, 'status') === 'open' ? r.questions : [...r.questions] }), true; }
        if (id && !c && m === 'GET') {
          const wait = Number(q(url, 'wait'));
          if (wait > 0) return json(res, 200, await runs.waitAnswer(id, wait)), true;
          const x = runs.question(id); if (!x) throw new RunError(`no question ${JSON.stringify(id)}. Next: GET /api/review.`, 404);
          return json(res, 200, x), true;
        }
        if (id && c === 'answer' && m === 'POST') { const { by } = who(req, 'write'); return json(res, 200, runs.answer(by, id, await body(req))), true; }
      }
      // ---- the review queue
      if (a === 'review') {
        if (!id && m === 'GET') return json(res, 200, runs.review()), true;
        if (id && c === 'content' && m === 'GET') {
          const f = runs.content(id);
          res.writeHead(200, { 'content-type': f.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' });
          return res.end(f.bytes), true;
        }
        if (id && !c && m === 'POST') { const { by } = who(req, 'write'); return json(res, 200, runs.resolve(by, id, await body(req))), true; }
      }
      // ---- events, presence, audit
      if (a === 'event-log' && m === 'GET') {
        const caller = identify?.(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]) ?? null;
        const r = await runs.events(caller, { since: q(url, 'since'), wait: q(url, 'wait'), run: q(url, 'run'), types: q(url, 'types'), limit: q(url, 'limit'), peek: q(url, 'peek') === '1' });
        return json(res, 200, r), true;
      }
      if (a === 'agents' && !id && m === 'GET') return json(res, 200, { agents: runs.agents() }), true;
      if (a === 'audit' && m === 'GET') return json(res, 200, { events: runs.audit({ run: q(url, 'run'), limit: Number(q(url, 'limit')) || 200 }) }), true;
      // ---- reading an item's content (text, or a base64 window of anything)
      if (a === 'read' && m === 'GET') {
        const item = items.get(q(url, 'item') ?? '');
        const offset = Math.max(0, Number(q(url, 'offset')) || 0), length = Math.min(Math.max(Number(q(url, 'length')) || 262144, 1), 4 * 1024 * 1024);
        const fd = openSync(item.file, 'r');
        try {
          const size = statSync(item.file).size, buf = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
          readSync(fd, buf, 0, buf.length, offset);
          const wantB64 = q(url, 'encoding') === 'base64' || buf.subarray(0, 4096).includes(0);
          return json(res, 200, { id: item.id, kind: item.kind, mime: item.mime, bytes: size, offset, length: buf.length, done: offset + buf.length >= size, encoding: wantB64 ? 'base64' : 'utf8', content: buf.toString(wantB64 ? 'base64' : 'utf8') }), true;
        } finally { closeSync(fd); }
      }
      // ---- the board
      if (a === 'board' && !id) {
        if (m === 'GET') return json(res, 200, board.get()), true;
        if (m === 'POST') { const { by } = who(req, 'write'); return json(res, 200, board.set(by, await body(req))), true; }
      }
    } catch (e) {
      const status = e.status ?? (e.code === 'ENOENT' ? 404 : 400);
      const extra = e instanceof RunError ? e.extra : undefined;
      json(res, status, { ok: false, error: explainError(e), ...extra });
      return true;
    }
    return false;
  };
}
