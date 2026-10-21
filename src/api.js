// The JSON API for components, proposals, history, search and render. One router used by
// src/server.js (over HTTP) and by src/mcp.js when it runs without a canvas server (called directly).
//   const api = createApi(ws, { broadcast, dir });   await api.handle({ method, path, query, body }) -> { status, json } | { status, png } | null
// Writes all go through store.apply (INV-05). Proposals live in memory only and never touch a file.
import { explainError } from './errors.js';
import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CreateError } from './workspace.js';
import { search } from './ws-ops.js';
import { createRenderer, RenderError } from './render-png.js';
import { summarize } from './summary.js';
import { ADOPTION, proposeAdoption } from './adopt.js';
import { GUIDE } from './guide.js';
import { saveAsset, listAssets, resolveAsset, AssetError, MAX_BYTES } from './assets.js';
import { changedFiles, diffAgainstHead } from './git.js';
import { visualDiff } from './visual-diff.js';

// napkin.json { agents: { "<name>": "read"|"propose"|"write" | { mode, token? }, "*": <mode for unlisted names> } } (decision 0005).
// Who is calling is decided by the server from a bearer token, never from the request body:
//   POST /api/session { as?, token? } -> { token, name, mode }. A name listed with a token needs that token to get a session
//   (so one agent cannot take another's name); a token in napkin.json also works directly as a bearer.
const MODES = ['read', 'propose', 'write'];
// null when napkin.json has no `agents` key (everyone may write). With one, a name it does not list gets "*"'s mode, "*" defaulting to read (decision 0005, amendment).
export function agentsConfig(dir) {
  for (const d of [dir, dirname(dir)]) {
    try {
      const a = JSON.parse(readFileSync(join(d, 'napkin.json'), 'utf8'))?.agents;
      if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
      return Object.fromEntries(Object.entries(a).map(([name, v]) => {
        const mode = typeof v === 'string' ? v : v?.mode;
        return [name, { mode: MODES.includes(mode) ? mode : 'read', token: typeof v === 'object' ? v?.token : undefined }]; // an unknown word fails closed
      }));
    } catch {}
  }
  return null;
}
export const agentPermission = (dir, name) => { const c = agentsConfig(dir); return c ? (c[name] ?? c['*'] ?? { mode: 'read' }).mode : 'write'; };

const res = (status, json) => ({ status, json });
const fail = (status, error, extra) => res(status, { ok: false, error: explainError(error), ...extra });

export function createApi(ws, { broadcast = () => {}, dir = ws.dir, canPropose = true } = {}) {
  const sessions = new Map(); // token -> name
  const proposals = new Map(); // id -> proposal
  const renderer = createRenderer();

  // A proposal whose component is gone can never land.
  ws.events.on('removed', ({ component }) => {
    for (const p of [...proposals.values()]) if (p.component === component) { proposals.delete(p.id); broadcast({ type: 'proposal-resolved', id: p.id, component, status: 'rejected', reason: 'component removed' }); }
  });

  const publicProposal = (p) => p;
  // A session for a name. Names listed with a token in napkin.json need it; the name "*" cannot be claimed.
  function session(as, token) {
    const name = typeof as === 'string' ? as.trim().slice(0, 40) : '';
    if (!name || name.toLowerCase() === 'unknown') return fail(400, 'a real name is required (not empty, not "unknown"): { as: "you" }');
    if (name === '*') return fail(400, 'that name is reserved');
    const listed = agentsConfig(dir)?.[name];
    if (listed?.token && listed.token !== token) return fail(403, `"${name}" is configured with a token in napkin.json; send it as { token }`);
    const t = randomBytes(16).toString('hex');
    sessions.set(t, name);
    return res(200, { ok: true, token: t, name, mode: agentPermission(dir, name) });
  }
  const identify = (bearer) => {
    if (!bearer) return null;
    if (sessions.has(bearer)) return sessions.get(bearer);
    for (const [name, c] of Object.entries(agentsConfig(dir) ?? {})) if (c.token && c.token === bearer && name !== '*') return name;
    return null;
  };
  const parse = (body) => { if (body && typeof body === 'object') return body; try { return JSON.parse(body || '{}'); } catch { return null; } };

  async function propose(e, msg) {
    if (!canPropose) return fail(409, 'propose needs a running napkin canvas server: nobody could review the proposal here. Start the canvas (node src/server.js) or apply directly if you are allowed to.');
    const dry = await e.store.apply({ ...msg, dryRun: true });
    if (!dry.ok) return res(dry.error.startsWith('read-only') ? 403 : 409, dry);
    const p = {
      id: 'prp_' + randomBytes(5).toString('hex'), component: e.id, name: e.name,
      baseRevision: msg.baseRevision, currentRevision: dry.revision, edits: msg.edits, by: msg.by,
      summary: summarize(msg.edits), at: Date.now(), doc: dry.doc, source: dry.source,
    };
    proposals.set(p.id, p);
    broadcast({ type: 'proposal', component: e.id, proposal: p });
    return res(200, { ok: true, proposed: true, proposal: { id: p.id, component: p.component, baseRevision: p.baseRevision, by: p.by, summary: p.summary } });
  }

  async function resolve(id, action, by) {
    const p = proposals.get(id);
    if (!p) return fail(404, `no such proposal "${id}"`);
    if (action === 'reject') {
      proposals.delete(id);
      broadcast({ type: 'proposal-resolved', id, component: p.component, status: 'rejected', by });
      return res(200, { ok: true, status: 'rejected' });
    }
    const e = ws.find(p.component);
    if (!e) { proposals.delete(id); return fail(404, 'the component no longer exists'); }
    const r = await e.store.apply({ baseRevision: p.baseRevision, edits: p.edits, by: p.by, origin: undefined, ...(p.adoption && { [ADOPTION]: { before: p.before, source: p.source } }) }, { approvedBy: by }); // history records who approved it
    if (!r.ok) return res(409, { ...r, proposal: id }); // stale (or invalid now): the proposal stays so it can be rejected
    proposals.delete(id);
    broadcast({ type: 'proposal-resolved', id, component: p.component, status: 'accepted', by, revision: r.revision });
    return res(200, { ok: true, status: 'accepted', revision: r.revision });
  }

  // Image bytes arrive as { data: <base64>, ext } or as { from: <path of an image in the repo> }.
  function bytesOf(msg) {
    if (typeof msg.from === 'string') {
      const a = resolveAsset(dir, msg.from);
      if (!a) throw new AssetError(`no image at ${msg.from}. Next: choose one listed by GET /api/assets.`, 404);
      return Object.assign(readFileSync(a.abs), { ext: extname(a.abs) });
    }
    if (typeof msg.data !== 'string') throw new AssetError('send { data: <base64 bytes>, ext } or { from: <image path> }');
    if (msg.data.length > MAX_BYTES * 1.4) throw new AssetError('the image is too large. Next: send one under 8 MB.', 413);
    return Buffer.from(msg.data, 'base64');
  }
  async function stepFor(verb, e, msg, caller) {
    if (msg.component && !e) return fail(404, 'not found');
    if (!e) {
      let best = null;
      for (const x of ws.entries()) { const t = x.store[verb + 'Top'](caller); if (t && (!best || t.at > best.at)) best = { e: x, at: t.at }; }
      e = best?.e;
    }
    if (!e) return fail(409, `nothing to ${verb}`);
    const r = await e.store[verb](caller, msg.origin, { skip: msg.skip === true });
    return res(r.ok ? 200 : 409, { ...r, component: e.id });
  }
  async function handle({ method, path, query = new URLSearchParams(), body = '', token }) {
    let contextFile;
    const fail = (status, error, extra) => res(status, { ok: false, error: explainError(error, { file: /body is not JSON/.test(error) ? undefined : /invalid edit|stale revision|read-only:|line \d+:|cannot adopt|build failed|render failed/.test(error) ? contextFile : undefined }), ...extra });
    if (!path.startsWith('/api/') || path === '/api/events' || path === '/api/presence') return null;
    const seg = path.split('/').slice(2).map(decodeURIComponent);
    const msgOf = () => parse(body);
    // Every write route needs a caller the server can name (401 otherwise); `by` in a body is ignored.
    const caller = identify(token);
    const needId = () => (caller ? null : fail(401, 'identity required: send "Authorization: Bearer <token>" (POST /api/session { as } gives you one)'));
    const deny = (action) => {
      const mode = agentPermission(dir, caller);
      return mode === 'write' ? null : fail(403, `agent "${caller}" is ${mode === 'read' ? 'read-only' : 'propose-only'} (napkin.json agents): ${action} is not allowed`, { permission: mode });
    };
    const guard = (action) => needId() || deny(action);

    if (seg[0] === 'session' && method === 'POST') { const m = msgOf(); return m ? session(m.as, m.token) : fail(400, 'body is not JSON'); }
    if (seg[0] === 'guide' && method === 'GET') return res(200, { ok: true, guide: GUIDE });
    if (seg[0] === 'activity' && method === 'GET') return res(200, { ok: true, activity: ws.activity(Number(query.get('limit') || 50)) });
    if (seg[0] === 'search' && method === 'GET') return res(200, await search(ws, query.get('q')));

    // Undo and redo your own edits (HIS-01, HIS-02). No component named: the newest step of the caller's across all components.
    if ((seg[0] === 'undo' || seg[0] === 'redo') && method === 'POST' && seg.length === 1) {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard(seg[0]); if (g) return g;
      return stepFor(seg[0], msg.component ? ws.find(String(msg.component)) : null, msg, caller);
    }
    if (seg[0] === 'git' && method === 'GET') {
      const files = changedFiles(dir);
      if (!files) return res(200, { ok: true, git: false, components: [] });
      const real = (p) => { try { return realpathSync(p); } catch { return p; } };
      const byReal = new Map([...files].map(([f, st]) => [real(f), st]));
      return res(200, { ok: true, git: true, components: ws.entries().filter((e) => byReal.has(real(e.file))).map((e) => ({ component: e.id, name: e.name, state: byReal.get(real(e.file)) })) });
    }
    if (seg[0] === 'assets') {
      if (method === 'GET' && seg.length === 1) return res(200, { ok: true, assets: listAssets(dir) });
      if (method === 'GET' && seg[1] === 'file') {
        const a = resolveAsset(dir, query.get('path') ?? '');
        return a ? { status: 200, bytes: readFileSync(a.abs), type: a.type } : fail(404, `no image at ${query.get('path')}`);
      }
      if (method === 'POST' && seg.length === 1) {
        const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
        const g = guard('add_asset'); if (g) return g;
        try { const { path, created, bytes } = saveAsset(dir, bytesOf(msg), msg.ext); return res(created ? 201 : 200, { ok: true, path, created, bytes }); }
        catch (err) { if (err instanceof AssetError) return fail(err.status, err.message); throw err; }
      }
      return fail(405, 'method not allowed');
    }

    if (seg[0] === 'proposals') {
      if (method === 'GET' && seg.length === 1) {
        const c = query.get('component'), e = c && ws.find(c);
        return res(200, [...proposals.values()].filter((p) => !c || (e && p.component === e.id)).map(publicProposal));
      }
      if (method === 'POST' && seg.length === 3 && (seg[2] === 'accept' || seg[2] === 'reject')) { const g = guard(`${seg[2]} a proposal`); return g || resolve(seg[1], seg[2], caller); }
      return fail(405, 'method not allowed');
    }

    if (seg[0] !== 'components') return null;

    if (seg.length === 1) {
      if (method === 'GET') return res(200, await ws.summary());
      if (method === 'POST') {
        const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
        const g = guard('create_component'); if (g) return g;
        try { return res(201, { ok: true, ...(await ws.create(msg.name, msg.rootTag, { by: caller })) }); }
        catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
      }
      return fail(405, 'method not allowed');
    }

    const e = ws.find(seg[1]);
    if (!e) return fail(404, `component "${seg[1]}" not found`);
    contextFile = e.path || e.name + '.tsx';
    const sub = seg[2];

    if (!sub) {
      if (method === 'GET') {
        const { component, canvas, revision, doc, source, readOnly } = await ws.snapshot(e);
        return res(200, { component, canvas, revision, doc, source, ...(readOnly && { readOnly }) });
      }
      if (method === 'DELETE') {
        const g = guard('delete_component'); if (g) return g;
        try { return res(200, { ok: true, ...(await ws.delete(e.id, { by: caller })) }); }
        catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
      }
    }
    if (sub === 'adoption' && method === 'POST') {
      const n = needId(); if (n) return n;
      const mode = agentPermission(dir, caller);
      if (mode === 'read') return fail(403, `agent "${caller}" is read-only (napkin.json). Next: ask a write or propose agent to propose_adoption.`, { permission: mode });
      if (!canPropose) return fail(409, 'propose needs a running napkin canvas server. Next: run napkin open to review an adoption.');
      const r = await e.store.read();
      if (!r.readOnly) return fail(409, `${e.file} is already editable. Next: use apply_edits.`);
      let converted;
      try { converted = proposeAdoption(r.source, e.path || e.name + '.tsx'); } catch (err) { return fail(422, err.message); }
      const p = { id: 'prp_' + randomBytes(5).toString('hex'), component: e.id, name: e.name, adoption: true,
        baseRevision: r.revision, currentRevision: r.revision, before: r.source, edits: [], by: caller,
        summary: `adopt ${e.name} into the dialect`, at: Date.now(), ...converted };
      proposals.set(p.id, p); broadcast({ type: 'proposal', component: e.id, proposal: p });
      return res(200, { ok: true, proposed: true, proposal: p });
    }
    if (sub === 'edits' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'invalid edit #0: body is not JSON');
      if (!msg.dryRun) {
        const n = needId(); if (n) return n;
        const mode = agentPermission(dir, caller);
        if (mode === 'read') return fail(403, `agent "${caller}" is read-only (napkin.json agents): apply_edits is not allowed (dryRun is)`, { permission: mode });
        msg.by = caller;
        if (mode === 'propose' || msg.propose) return propose(e, msg);
      } else msg.by = caller || 'dry-run';
      const r = await e.store.apply(msg);
      return res(r.ok ? 200 : 409, r);
    }
    // Where the frame sits on the canvas: the sidecar only, never the .tsx. Same identity rules as every write.
    if (sub === 'canvas' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard('move_component'); if (g) return g;
      try { return res(200, { ok: true, canvas: ws.setCanvas(e, msg.x, msg.y, { by: caller }) }); }
      catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
    }
    if (sub === 'rename' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard('rename_component'); if (g) return g;
      try { return res(200, { ok: true, ...(await ws.rename(e.id, msg.name, { by: caller })) }); }
      catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
    }
    if ((sub === 'undo' || sub === 'redo') && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard(sub); return g || stepFor(sub, e, msg, caller);
    }
    if (sub === 'restore' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard('restore'); if (g) return g;
      if (msg.revision === undefined) return fail(400, 'send { revision }');
      const r = await e.store.restore(msg.revision, caller, msg.origin);
      return res(r.ok ? 200 : 409, r);
    }
    if (sub === 'restore-preview' && method === 'GET') {
      const over = e.store.overwrittenBy(query.get('revision'));
      return over ? res(200, { ok: true, overwrites: over }) : fail(404, `revision ${query.get('revision')} is not in the history this server keeps`);
    }
    if (sub === 'at' && method === 'GET') {
      const past = e.store.at(query.get('revision'));
      return past ? res(200, { ok: true, ...past }) : fail(404, `revision ${query.get('revision')} is not in the history this server keeps`);
    }
    if (sub === 'diff' && method === 'GET') {
      const d = diffAgainstHead(e.file);
      return res(200, d === null ? { ok: true, git: false, diff: '' } : { ok: true, git: true, diff: d });
    }
    if (sub === 'visual-diff' && method === 'GET') { const r = await visualDiff(ws, renderer, e); return res(r.ok ? 200 : 422, r); }
    if (sub === 'image' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard('set_image'); if (g) return g;
      let saved;
      try {
        const rel = typeof msg.from === 'string' && /^assets\/[^/]+$/.test(msg.from) && resolveAsset(dir, msg.from); // already in assets/: use it as it is
        saved = rel ? { path: msg.from, created: false } : saveAsset(dir, bytesOf(msg), msg.ext ?? extname(String(msg.from ?? '')));
      } catch (err) { if (err instanceof AssetError) return fail(err.status, err.message); throw err; }
      const { doc, revision } = await e.store.read();
      let edit;
      if (msg.into) {
        let n = 1; const taken = new Set(); (function walk(x) { taken.add(x.id); x.children.forEach(walk); })(doc.root);
        while (taken.has(`image${n}`)) n++;
        edit = { op: 'insert', parent: msg.into, node: { id: `image${n}`, tag: 'img', style: { maxWidth: '100%' }, attrs: { src: saved.path, alt: '' } } };
      } else if (msg.node) edit = { op: 'set', path: `${msg.node}.@src`, value: saved.path };
      else return fail(400, 'send { node } (an img to point at the image) or { into } (a node to put a new img in)');
      const r = await e.store.apply({ baseRevision: msg.baseRevision ?? revision, edits: [edit], by: caller, origin: msg.origin });
      return res(r.ok ? 200 : 409, r.ok ? { ok: true, revision: r.revision, path: saved.path, created: saved.created, doc: r.doc } : { ...r, path: saved.path });
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

  return { handle, proposals, renderer, session, async close() { await renderer.close(); } };
}
