// The JSON API for components, proposals, history, search and render. One router used by
// src/server.js (over HTTP) and by src/mcp.js when it runs without a canvas server (called directly).
//   const api = createApi(ws, { broadcast, dir });   await api.handle({ method, path, query, body }) -> { status, json } | { status, png } | null
// Writes all go through store.apply (INV-05). Proposals live in memory only and never touch a file.
import { explainError } from './errors.js';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { writePrivate, privateDir, sweepTmp } from './atomic.js';
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

export function createApi(ws, { broadcast: emitFrame = () => {}, dir = ws.dir, canPropose = true, colorOf = () => ({}) } = {}) {
  const sessions = new Map(); // token -> name
  const renderer = createRenderer();

  // Proposals survive a restart (WPC-20): they are kept in <dir>/.napkin/proposals.json (private, self-ignoring, written atomically,
  // never a tracked file). Every change to the set, and every proposal frame that follows an in-place edit of one, schedules a write.
  // A folder with a napkin.json is a napkin project: its proposals live in <dir>/.napkin (private, self-ignoring). A folder napkin merely
  // opened keeps its promise to leave no trace: its proposals go to napkin's own state dir, outside the repo (NAPKIN_STATE_DIR, else
  // $XDG_STATE_HOME/napkin, else ~/.local/state/napkin), under a hash of the folder's real path.
  const isProject = () => [dir, dirname(dir)].some((d) => existsSync(join(d, 'napkin.json')));
  const stateFolder = () => join(process.env.NAPKIN_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'napkin'), createHash('sha256').update(realpathSync(dir)).digest('hex').slice(0, 24));
  const place = () => (isProject() ? { folder: join(dir, '.napkin'), project: true } : { folder: stateFolder(), project: false });
  const pfile = () => join(place().folder, 'proposals.json');
  let dirty = false;
  const persist = () => {
    if (!canPropose || dirty) return;
    dirty = true;
    queueMicrotask(() => { dirty = false; try { const { folder, project } = place(); if (project) privateDir(dir); writePrivate(folder, 'proposals.json', JSON.stringify({ v: 1, proposals: [...proposals.values()], answered, seen })); } catch (e) { console.error(`napkin: could not save proposals: ${e.message}`); } });
  };
  const proposals = new (class extends Map { set(k, v) { super.set(k, v); persist(); return this; } delete(k) { const r = super.delete(k); persist(); return r; } })(); // id -> proposal
  // How the person answered recent proposals, kept (and saved) for a while so an agent that was disconnected at that moment (a restart,
  // a dropped stream) still hears: GET /api/proposals/answered?by=<name>&since=<ms>.
  const answered = [];
  const seen = {}; // agent name -> time of the last answer it has acknowledged, so a fresh MCP process hears what came while none ran
  const broadcast = (f) => {
    if (f.type === 'proposal-part' || f.type === 'proposal-resolved') { f.at ??= Date.now(); answered.push(f); while (answered.length > 100 || (answered[0] && answered[0].at < Date.now() - 864e5)) answered.shift(); }
    emitFrame(f);
    if (f.type === 'proposal' || f.type === 'proposal-part' || f.type === 'proposal-resolved') persist();
  };
  if (canPropose) {
    sweepTmp(place().folder); // leftovers of an interrupted private write
    try { const saved = JSON.parse(readFileSync(pfile(), 'utf8')); answered.push(...(saved.answered ?? [])); Object.assign(seen, saved.seen ?? {}); for (const p of saved.proposals ?? []) if (p?.id && p.by) Map.prototype.set.call(proposals, p.id, p); } catch { /* none saved, or unreadable: start empty */ }
  }

  // A pending create proposal whose name has been taken since (the person made it meanwhile): marked at once, the agent is told, and Accept
  // still never overwrites (ws.create refuses an existing name).
  const resolving = new Set();
  function refreshClashes({ quiet = false } = {}) {
    for (const p of proposals.values()) {
      if (!p.create || resolving.has(p.id)) continue;
      let why;
      try { ws.checkCreate(p.create.name, p.create.rootTag); } catch (err) { if (err instanceof CreateError && err.status === 409) why = `A component named ${p.create.name} now exists (it was created after this proposal). Accepting would not overwrite it, so it will be refused. Reject this proposal; the agent can propose another name.`; }
      if (why === p.clash) continue;
      if (why) p.clash = why; else delete p.clash;
      persist();
      if (quiet) continue;
      broadcast({ type: 'proposal', component: p.component, proposal: p });
      if (why) broadcast({ type: 'proposal-clash', id: p.id, component: p.component, proposedBy: p.by, name: p.name, summary: p.summary, reason: why });
    }
  }
  ws.events.on('added', () => refreshClashes());
  ws.events.on('removed', () => { if (!closing) refreshClashes(); });
  refreshClashes({ quiet: true });

  // A proposal whose component is gone can never land.
  let closing = false; // closing the workspace announces every component as removed: that is not a deletion, and proposals must survive it
  ws.events.on('removed', ({ component }) => {
    if (closing) return;
    for (const p of [...proposals.values()]) if (p.component === component) { proposals.delete(p.id); broadcast(resolvedFrame(p, 'reject', undefined, { reason: 'component removed' })); }
  });

  const publicProposal = (p) => ({ ...p, ...colorOf(p.by) }); // + the agent's presence colour (color, ink) so the tray and the feed match the outline
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
      summary: summarize(msg.edits), lines: msg.edits.map((x) => summarize([x])), at: Date.now(), doc: dry.doc, source: dry.source,
    };
    proposals.set(p.id, p);
    broadcast({ type: 'proposal', component: e.id, proposal: p });
    return res(200, { ok: true, proposed: true, proposal: { id: p.id, component: p.component, baseRevision: p.baseRevision, by: p.by, summary: p.summary } });
  }

  // A propose-mode agent's create_component: a proposal for a component that does not exist. Nothing is written until the person
  // accepts (then ws.create makes the file, by the agent, approved by the person). While it is pending the component has no id and no
  // file, so edits to it are refused with a message that says so (pendingCreate); the agent proposes them once it is accepted.
  const pendingCreate = (name) => [...proposals.values()].find((p) => p.create && p.create.name.toLowerCase() === String(name).toLowerCase());
  function proposeCreate(msg, by) {
    if (!canPropose) return fail(409, 'propose needs a running napkin canvas server: nobody could review the proposal here. Start the canvas (node src/server.js) or create it directly if you are allowed to.');
    let pre;
    try { pre = ws.previewCreate(msg.name, msg.rootTag); }
    catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
    const dup = pendingCreate(msg.name);
    if (dup) return fail(409, `component "${msg.name}" is already proposed (${dup.id}, by ${dup.by}). Next: wait for its resolved event, then read_component.`);
    const rootTag = msg.rootTag || 'div';
    const p = { id: 'prp_' + randomBytes(5).toString('hex'), component: `new:${msg.name}`, name: msg.name, create: { name: msg.name, rootTag },
      baseRevision: 0, currentRevision: 0, edits: [], by, summary: `create component ${msg.name}`, lines: [`create component ${msg.name} (${rootTag})`], at: Date.now(), ...pre };
    proposals.set(p.id, p);
    broadcast({ type: 'proposal', component: p.component, proposal: p });
    return res(200, { ok: true, proposed: true, proposal: { id: p.id, component: p.component, name: p.name, by: p.by, summary: p.summary } });
  }
  const pendingMessage = (p) => `component "${p.name}" is only proposed so far (${p.id}): it has no file until the person accepts it. Next: wait for its resolved event (subscribe), then read_component and propose your edits.`;

  // What a proposal ended as, for the agent that made it: every part resolved earlier plus how the rest ended.
  const lineList = (p) => (p.lines ?? (p.edits || []).map((x) => summarize([x])));
  function outcomeOf(p, finalAction) {
    const accepted = [], rejected = [];
    for (const part of p.parts ?? []) (part.status === 'accepted' ? accepted : rejected).push(...part.lines);
    (finalAction === 'accept' ? accepted : rejected).push(...lineList(p));
    return { outcome: accepted.length && rejected.length ? 'partly' : accepted.length ? 'accepted' : 'rejected', accepted, rejected };
  }
  const resolvedFrame = (p, finalAction, by, extra = {}) => ({ type: 'proposal-resolved', id: p.id, component: p.component, status: finalAction === 'accept' ? 'accepted' : 'rejected', by, proposedBy: p.by, summary: p.asked ?? p.summary, ...outcomeOf(p, finalAction), ...extra });

  // Accept or reject some of a proposal's edits: only: [0, 2] (indexes into its edits). Each part must be valid alone, because the rest
  // stays proposed on the new revision; edits that depend on each other (insert, then set on it) are taken together.
  async function resolvePart(p, action, by, only) {
    const e = ws.find(p.component);
    if (!e) { proposals.delete(p.id); return fail(404, 'the component no longer exists'); }
    p.asked ??= p.summary;
    const keep = p.edits.filter((_, i) => !only.includes(i)), take = p.edits.filter((_, i) => only.includes(i));
    for (const [name, part] of [['those edits', take], ['the other edits', keep]]) {
      const d = await e.store.apply({ baseRevision: p.baseRevision, edits: part, by: p.by, dryRun: true });
      if (!d.ok && !/^stale revision/.test(d.error)) return fail(409, `${name} cannot stand alone: ${d.error} Next: ${action} all of the proposal, or pick edits that do not depend on each other.`);
    }
    let revision;
    if (action === 'accept') {
      const r = await e.store.apply({ baseRevision: p.baseRevision, edits: take, by: p.by }, { approvedBy: by });
      if (!r.ok) return res(409, { ...r, proposal: p.id });
      revision = r.revision; p.baseRevision = r.revision;
    }
    (p.parts ??= []).push({ status: action === 'accept' ? 'accepted' : 'rejected', lines: take.map((x) => summarize([x])) });
    const partFrame = { type: 'proposal-part', id: p.id, component: p.component, status: action === 'accept' ? 'accepted' : 'rejected', by, proposedBy: p.by, summary: p.asked, edits: take.map((x) => summarize([x])), remaining: keep.map((x) => summarize([x])), ...(revision !== undefined && { revision }) };
    p.edits = keep; p.lines = keep.map((x) => summarize([x])); p.summary = summarize(keep);
    const dry = await e.store.apply({ baseRevision: p.baseRevision, edits: keep, by: p.by, dryRun: true });
    if (dry.ok) { p.currentRevision = dry.revision; p.doc = dry.doc; p.source = dry.source; }
    p.updated = true;
    broadcast(partFrame);
    broadcast({ type: 'proposal', component: p.component, proposal: p });
    return res(200, { ok: true, status: action === 'accept' ? 'accepted' : 'rejected', ...(revision !== undefined && { revision }), remaining: keep.length });
  }

  async function resolve(id, action, by, only) {
    const p = proposals.get(id);
    if (!p) return fail(404, `no such proposal "${id}"`);
    if (only !== undefined) {
      if (p.adoption || p.create || !Array.isArray(only) || !only.length || only.some((i) => !Number.isInteger(i) || i < 0 || i >= p.edits.length) || new Set(only).size !== only.length) return fail(400, `only must list distinct edit numbers from 0 to ${p.edits.length - 1} (an adoption or a new component is taken whole)`);
      if (only.length < p.edits.length) return resolvePart(p, action, by, only);
    }
    if (action === 'reject') {
      proposals.delete(id);
      broadcast(resolvedFrame(p, 'reject', by));
      return res(200, { ok: true, status: 'rejected' });
    }
    if (p.create) {
      let made;
      resolving.add(id);
      try { made = await ws.create(p.create.name, p.create.rootTag, { by: p.by, approvedBy: by }); }
      catch (err) { resolving.delete(id); if (err instanceof CreateError) return res(409, { ok: false, error: explainError(`${err.message}. The proposal stays so it can be rejected.`), proposal: id }); throw err; }
      resolving.delete(id);
      proposals.delete(id);
      const revision = (await ws.find(made.id).store.read()).revision;
      broadcast(resolvedFrame(p, 'accept', by, { revision, created: made.id }));
      return res(200, { ok: true, status: 'accepted', revision, component: made.id });
    }
    const e = ws.find(p.component);
    if (!e) { proposals.delete(id); return fail(404, 'the component no longer exists'); }
    const r = await e.store.apply({ baseRevision: p.baseRevision, edits: p.edits, by: p.by, origin: undefined, ...(p.adoption && { [ADOPTION]: { before: p.before, source: p.source } }) }, { approvedBy: by }); // history records who approved it
    if (!r.ok) return res(409, { ...r, proposal: id }); // stale (or invalid now): the proposal stays so it can be rejected
    proposals.delete(id);
    broadcast(resolvedFrame(p, 'accept', by, { revision: r.revision }));
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
    if (seg[0] === 'tokens') {
      if (method === 'GET') return res(200, ws.tokens.read());
      if (method === 'POST') {
        const g = guard('edit_token'); if (g) return g;
        const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
        const r = ws.tokens.write({ ...msg, by: caller });
        return res(r.ok ? 200 : /stale revision/.test(r.error) ? 409 : 400, r);
      }
      return fail(405, 'method not allowed');
    }
    if (seg[0] === 'guide' && method === 'GET') return res(200, { ok: true, guide: GUIDE });
    if (seg[0] === 'activity' && method === 'GET') return res(200, { ok: true, activity: ws.activity(Number(query.get('limit') || 50)).map((a) => ({ ...a, ...colorOf(a.by) })) });
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
      if (method === 'GET' && seg.length === 2 && seg[1] === 'answered') {
        const by = query.get('by'), ack = Number(query.get('ack') || 0);
        if (ack && by && ack > (seen[by] ?? 0)) { seen[by] = ack; persist(); }
        if (query.has('ack') && !query.has('since')) return res(200, []);
        const since = query.has('since') ? Number(query.get('since')) : (seen[by] ?? 0); // no since: everything this agent has not acknowledged (within the log)
        return res(200, answered.filter((f) => f.proposedBy === by && f.at > since));
      }
      if (method === 'POST' && seg.length === 3 && (seg[2] === 'accept' || seg[2] === 'reject')) { const g = guard(`${seg[2]} a proposal`); if (g) return g; const m = msgOf(); return resolve(seg[1], seg[2], caller, m?.only); }
      return fail(405, 'method not allowed');
    }

    if (seg[0] !== 'components') return null;

    if (seg.length === 1) {
      if (method === 'GET') return res(200, await ws.summary());
      if (method === 'POST') {
        const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
        const n = needId(); if (n) return n;
        if (agentPermission(dir, caller) === 'propose' || (msg.propose && agentPermission(dir, caller) !== 'read')) return proposeCreate(msg, caller);
        const g = deny('create_component'); if (g) return g;
        try { return res(201, { ok: true, ...(await ws.create(msg.name, msg.rootTag, { by: caller, ...(typeof msg.source === 'string' && { source: msg.source }), ...(typeof msg.folder === 'string' && { folder: msg.folder }) })) }); }
        catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
      }
      return fail(405, 'method not allowed');
    }

    const e = ws.find(seg[1]);
    if (!e) { const pc = pendingCreate(seg[1]); return pc ? fail(409, pendingMessage(pc)) : fail(404, `component "${seg[1]}" not found`); }
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
      if (!canPropose) return fail(409, 'propose needs a running napkin canvas server. Next: run node src/cli.js open to review an adoption.');
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
    // Decision 0004: who this component uses and who uses it; the text a slot shows on the canvas (sidecar only); extract a subtree into a new component.
    if (sub === 'graph' && method === 'GET') return res(200, { ok: true, component: e.id, ...ws.graph(e) });
    if (sub === 'slot-preview' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard('slot_preview'); if (g) return g;
      try { return res(200, { ok: true, slots: ws.setSlotPreview(e, msg.prop, msg.text ?? null, { by: caller }) }); }
      catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
    }
    if (sub === 'extract' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard('extract_component'); if (g) return g;
      try { return res(201, { ok: true, ...(await ws.extractComponent(e.id, { id: msg.id, name: msg.name, by: caller })) }); }
      catch (err) { if (err instanceof CreateError) return fail(err.status, err.message); throw err; }
    }
    // LAY-11: a variant cell's preview width, in the sidecar only. { variant: { size: 'sm' }, width: 320 | null }
    if (sub === 'preview' && method === 'POST') {
      const msg = msgOf(); if (!msg) return fail(400, 'body is not JSON');
      const g = guard('preview_width'); if (g) return g;
      try { return res(200, { ok: true, preview: ws.setPreview(e, msg.variant, msg.width, { by: caller }) }); }
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
      try { const { png, ms } = await renderer.render(ws, e, variant, query.get('theme') || undefined); return { status: 200, png, ms }; }
      catch (err) { if (err instanceof RenderError) return fail(422, err.message); throw err; }
    }
    return fail(405, 'method not allowed');
  }

  return { handle, proposals, renderer, session, identify, async close() { closing = true; await renderer.close(); } };
}
