// The JSON API for components, proposals, history, search and render. One router used by
// src/server.js (over HTTP) and by src/mcp.js when it runs without a canvas server (called directly).
//   const api = createApi(ws, { broadcast, dir });   await api.handle({ method, path, query, body }) -> { status, json } | { status, png } | null
// Writes all go through store.apply (INV-05). Proposals live in memory only and never touch a file.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CreateError } from './workspace.js';
import { deleteComponent, renameComponent, search } from './ws-ops.js';
import { createRenderer, RenderError } from './render-png.js';
import { summarize } from './summary.js';
import { GUIDE } from './guide.js';

// napkin.json { agents: { name: 'read' | 'propose' | 'write' } }, next to the components folder or one level up (decision 0005).
export function agentPermission(dir, name) {
  for (const d of [dir, dirname(dir)]) {
    try {
      const mode = JSON.parse(readFileSync(join(d, 'napkin.json'), 'utf8'))?.agents?.[name];
      if (mode === 'read' || mode === 'propose' || mode === 'write') return mode;
      if (mode !== undefined) return 'read'; // an unknown word fails closed
    } catch {}
  }
  return 'write';
}

const res = (status, json) => ({ status, json });
const fail = (status, error, extra) => res(status, { ok: false, error, ...extra });

export function createApi(ws, { broadcast = () => {}, dir = ws.dir } = {}) {
  const proposals = new Map(); // id -> proposal
  const renderer = createRenderer();

  // A proposal whose component is gone can never land.
  ws.events.on('removed', ({ component }) => {
    for (const p of [...proposals.values()]) if (p.component === component) { proposals.delete(p.id); broadcast({ type: 'proposal-resolved', id: p.id, component, status: 'rejected', reason: 'component removed' }); }
  });

  const publicProposal = (p) => p;
  const parse = (body) => { if (body && typeof body === 'object') return body; try { return JSON.parse(body || '{}'); } catch { return null; } };

  async function propose(e, msg) {
    const dry = await e.store.apply({ ...msg, dryRun: true });
    if (!dry.ok) return res(dry.error.startsWith('read-only') ? 403 : 409, dry);
    const p = {
      id: 'prp_' + randomBytes(5).toString('hex'), component: e.id, name: e.name,
      baseRevision: msg.baseRevision, currentRevision: dry.revision, edits: msg.edits, by: msg.by || 'unknown',
      summary: summarize(msg.edits), at: Date.now(), doc: dry.doc, source: dry.source,
    };
    proposals.set(p.id, p);
    broadcast({ type: 'proposal', component: e.id, proposal: p });
    return res(200, { ok: true, proposed: true, proposal: { id: p.id, component: p.component, baseRevision: p.baseRevision, by: p.by, summary: p.summary } });
  }

  async function resolve(id, action, by) {
    const p = proposals.get(id);
    if (!p) return fail(404, 'no such proposal');
    if (action === 'reject') {
      proposals.delete(id);
      broadcast({ type: 'proposal-resolved', id, component: p.component, status: 'rejected', by });
      return res(200, { ok: true, status: 'rejected' });
    }
    const e = ws.find(p.component);
    if (!e) { proposals.delete(id); return fail(404, 'the component no longer exists'); }
    const r = await e.store.apply({ baseRevision: p.baseRevision, edits: p.edits, by: p.by, origin: undefined });
    if (!r.ok) return res(409, { ...r, proposal: id }); // stale (or invalid now): the proposal stays so it can be rejected
    proposals.delete(id);
    broadcast({ type: 'proposal-resolved', id, component: p.component, status: 'accepted', by, revision: r.revision });
    return res(200, { ok: true, status: 'accepted', revision: r.revision });
  }

  async function handle({ method, path, query = new URLSearchParams(), body = '' }) {
    if (!path.startsWith('/api/') || path === '/api/events' || path === '/api/presence') return null;
    const seg = path.split('/').slice(2).map(decodeURIComponent);
    const msgOf = () => parse(body);
    const who = (m) => m?.by || query.get('by') || 'unknown';
    const deny = (by, action) => {
      const mode = agentPermission(dir, by);
      return mode === 'write' ? null : fail(403, `agent "${by}" is ${mode === 'read' ? 'read-only' : 'propose-only'} (napkin.json agents): ${action} is not allowed`, { permission: mode });
    };

    if (seg[0] === 'guide' && method === 'GET') return res(200, { ok: true, guide: GUIDE });
    if (seg[0] === 'search' && method === 'GET') return res(200, await search(ws, query.get('q')));

    if (seg[0] === 'proposals') {
      if (method === 'GET' && seg.length === 1) {
        const c = query.get('component'), e = c && ws.find(c);
        return res(200, [...proposals.values()].filter((p) => !c || (e && p.component === e.id)).map(publicProposal));
      }
      if (method === 'POST' && seg.length === 3 && (seg[2] === 'accept' || seg[2] === 'reject')) return resolve(seg[1], seg[2], who(msgOf() || {}));
      return fail(405, 'method not allowed');
    }

    if (seg[0] !== 'components') return null;

    if (seg.length === 1) {
      if (method === 'GET') return res(200, await ws.summary());
      if (method === 'POST') {
        const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
        const d = deny(who(msg), 'create_component'); if (d) return d;
        try { return res(201, { ok: true, ...(await ws.create(msg.name, msg.rootTag)) }); }
        catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
      }
      return fail(405, 'method not allowed');
    }

    const e = ws.find(seg[1]);
    if (!e) return fail(404, 'not found');
    const sub = seg[2];

    if (!sub) {
      if (method === 'GET') {
        const { component, revision, doc, source, readOnly } = await ws.snapshot(e);
        return res(200, { component, revision, doc, source, ...(readOnly && { readOnly }) });
      }
      if (method === 'DELETE') {
        const d = deny(who(null), 'delete_component'); if (d) return d;
        try { return res(200, { ok: true, ...(await deleteComponent(ws, e.id)) }); }
        catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
      }
    }
    if (sub === 'edits' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'invalid edit #0: body is not JSON');
      msg.by = who(msg);
      const mode = agentPermission(dir, msg.by);
      if (!msg.dryRun) {
        if (mode === 'read') return fail(403, `agent "${msg.by}" is read-only (napkin.json agents): apply_edits is not allowed (dryRun is)`, { permission: mode });
        if (mode === 'propose' || msg.propose) return propose(e, msg);
      }
      const r = await e.store.apply(msg);
      return res(r.ok ? 200 : 409, r);
    }
    if (sub === 'rename' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const d = deny(who(msg), 'rename_component'); if (d) return d;
      try { return res(200, { ok: true, ...(await renameComponent(ws, e.id, msg.name)) }); }
      catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
    }
    if (sub === 'history' && method === 'GET') return res(200, { ok: true, component: e.id, history: e.store.history(Number(query.get('limit') || 50)) });
    if (sub === 'render' && method === 'GET') {
      let variant = {};
      try { variant = JSON.parse(query.get('variant') || '{}'); } catch { return fail(400, 'variant must be JSON like {"size":"sm"}'); }
      try { const { png, ms } = await renderer.render(ws, e, variant); return { status: 200, png, ms }; }
      catch (err) { if (err instanceof RenderError) return fail(422, err.message); throw err; }
    }
    return fail(405, 'method not allowed');
  }

  return { handle, proposals, renderer, async close() { await renderer.close(); } };
}
