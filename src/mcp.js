// MCP server (stdio, newline-delimited JSON-RPC 2.0). Tools talk to the napkin canvas server's HTTP API
// (NAPKIN_URL); if no server answers, they run the same API in this process on NAPKIN_DIR, holding the
// single-writer lock <dir>/.napkin/lock (AGT-08). NAPKIN_AGENT names this agent (default "agent"); the
// server's napkin.json may restrict it to read, propose or write (decision 0005).
import { explainError } from './errors.js';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectCanvas } from './canvas-client.js';
import { nodeOfEdit } from './model.js';
import { GUIDE } from './guide.js';
import { editItemSchema } from './mcp-schema.js';

const BASE = process.env.NAPKIN_URL || 'http://127.0.0.1:4810/';
const AGENT = process.env.NAPKIN_AGENT || 'agent';
const send = (msg) => { if (msg.error?.message) msg.error.message = explainError(msg.error.message); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); };

const NO_GUIDE = !!process.env.NAPKIN_NO_GUIDE; // eval control arm: the same tools with the teaching text removed
const editSchema = editItemSchema(NO_GUIDE);
const comp = { type: 'string', description: 'component name or id' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const TOOLS = [
  { name: 'list_tokens', description: 'Read every configured token, its per-mode values, resolved values, group, type, usage and source revision.', inputSchema: obj({}) },
  { name: 'propose_adoption', description: 'Propose a faithful dialect rewrite of a read-only component. Returns source and diff in a proposal; only review Accept writes it. Unsupported logic is refused.', inputSchema: obj({ component: comp }, ['component']) },
  { name: 'list_components', description: 'List the napkin components in this folder: [{ id, name, readOnly? }].', inputSchema: obj({}) },
  { name: 'read_component', description: 'Read a component: its document tree, current revision and the TSX source text (readOnly says why a file cannot be edited).', inputSchema: obj({ component: comp }, ['component']) },
  { name: 'apply_edits', description: 'Apply a batch of edits, all or nothing, against baseRevision. Fails with "stale revision" plus a stale list ({key, value, yours, revision, by}) and currentRevision if a property you touch changed since; retry once with baseRevision = currentRevision. dryRun: true validates and returns the would-be TSX source without writing. propose: true validates and holds the edits as a proposal for the person to accept or reject (nothing is written).', inputSchema: obj({ component: comp, baseRevision: {}, edits: { type: 'array', items: editSchema }, dryRun: { type: 'boolean' }, propose: { type: 'boolean' } }, ['component', 'baseRevision', 'edits']) },
  { name: 'create_component', description: 'Create a new component file components/<Name>.tsx (PascalCase name) with one root frame; it appears on the canvas. Returns { id, name }. In propose mode (or with propose: true) nothing is created: you get { proposed: true, proposal } and the person accepts or rejects the new component on the canvas; propose edits to it only after the resolved event says accepted.', inputSchema: obj({ name: { type: 'string' }, rootTag: { type: 'string' }, propose: { type: 'boolean', description: 'ask the person to approve the new component instead of creating it' } }, ['name']) },
  { name: 'add_variant', description: 'Add a value to a variant axis (creating the axis if needed, with base value "default" unless given), optionally with style overrides per node, e.g. { component: "Button", baseRevision, axis: "size", value: "xl", overrides: { root: { padding: "14px 28px" } } }. Accepts dryRun and propose like apply_edits.', inputSchema: obj({ component: comp, baseRevision: {}, axis: { type: 'string' }, value: { type: 'string' }, base: { type: 'string' }, overrides: { type: 'object' }, dryRun: { type: 'boolean' }, propose: { type: 'boolean' } }, ['component', 'baseRevision', 'axis', 'value']) },
  { name: 'rename_component', description: 'Rename a component (file, exported function and Props interface). Its id stays. Returns { id, name }.', inputSchema: obj({ component: comp, name: { type: 'string', description: 'new PascalCase name' } }, ['component', 'name']) },
  { name: 'delete_component', description: 'Delete a component file and its sidecar. Returns { id, name }. Git can bring it back.', inputSchema: obj({ component: comp }, ['component']) },
  { name: 'render_component', description: 'Render one variant cell of a component to a PNG image so you can see it. variant is { axis: value } (omit for the base cell).', inputSchema: obj({ component: comp, variant: { type: 'object', description: 'e.g. { "size": "sm", "state": "hover" }' } }, ['component']) },
  { name: 'search', description: 'Find components and nodes by name, node id, tag or text (case-insensitive substring). Returns [{ kind: "component"|"node", component, name, node?, tag?, text?, match? }].', inputSchema: obj({ query: { type: 'string' } }, ['query']) },
  { name: 'subscribe', description: 'Changes other people made since your last call (also pushed as notifications/napkin/change): { changes: [{ component, revision, by, summary }], resolved: [{ proposal, outcome: accepted|rejected|partly, accepted: [edits], rejected: [edits], by, final }] }. resolved says how the person answered your proposals (also pushed as notifications/napkin/resolved). waitMs (max 10000) waits for the first one when there is none yet; component filters.', inputSchema: obj({ component: comp, waitMs: { type: 'number' } }) },
];

const variantEdits = (a) => [
  { op: 'addVariant', axis: a.axis, value: a.value, ...(a.base ? { base: a.base } : {}) },
  ...Object.entries(a.overrides || {}).flatMap(([node, style]) => Object.entries(style).map(([prop, value]) => ({ op: 'set', path: `${node}.${prop}`, value, variant: { [a.axis]: a.value } }))),
];

// --- backends: both answer call({ method, path, query?, body? }) -> { status, json } | { status, png } ---
const origin = Math.random().toString(36).slice(2);
const pending = []; // changes by others, for the subscribe tool
const pendingResolved = []; // how the person answered this agent's proposals (WPC-09), for the subscribe tool
let waiters = [];
// A proposal of mine was accepted, rejected or answered in part: { proposal, component, outcome: accepted|rejected|partly, accepted: [edits], rejected: [edits], by (who decided), final }
const resolvedNotice = (f) => {
  const final = f.type === 'proposal-resolved';
  const n = { proposal: f.id, component: f.component, summary: f.summary, outcome: final ? f.outcome : f.status === 'accepted' ? 'partly accepted' : 'partly rejected', by: f.by ?? null, final,
    ...(final ? { accepted: f.accepted, rejected: f.rejected } : { [f.status === 'accepted' ? 'accepted' : 'rejected']: f.edits, remaining: f.remaining }),
    ...(f.revision !== undefined && { revision: f.revision }), ...(f.created && { created: f.created }), ...(f.reason && { reason: f.reason }) };
  pendingResolved.push(n); if (pendingResolved.length > 200) pendingResolved.shift();
  waiters.forEach((w) => w()); waiters = [];
  send({ method: 'notifications/napkin/resolved', params: n });
};
const notice = (ch) => {
  const n = { component: ch.component, revision: ch.revision, by: ch.by, summary: ch.summary, edits: ch.edits };
  pending.push(n); if (pending.length > 200) pending.shift();
  waiters.forEach((w) => w()); waiters = [];
  send({ method: 'notifications/napkin/change', params: n });
};

class Unreachable extends Error { constructor(message) { super(explainError(message, { next: "run napkin open and set NAPKIN_URL to its printed address." })); } }
async function makeRemote() {
  const probe = await fetch(new URL('api/components', BASE), { signal: AbortSignal.timeout(800) }).catch((e) => { throw new Unreachable(e.message); });
  if (!probe.ok) throw new Error(explainError(`napkin server answered ${probe.status}`));
  const live = await connectCanvas(BASE, { by: 'agent', identify: false, name: AGENT });
  live.onChange((ch) => {
    if (ch.type === 'change' && !ch.mine && ch.origin !== origin) notice(ch);
    else if ((ch.type === 'proposal-resolved' || ch.type === 'proposal-part') && ch.proposedBy === AGENT) resolvedNotice(ch);
  });
  const base = live.origin;
  const sess = await (await fetch(new URL('api/session', BASE), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: AGENT, token: process.env.NAPKIN_TOKEN }) })).json();
  if (!sess.ok) throw new Error(explainError(`napkin refused this agent a session: ${sess.error}`));
  return {
    mode: 'server', origin: base,
    async call({ method, path, query, body }) {
      const url = new URL(path.replace(/^\//, ''), BASE);
      if (query) url.search = query.toString();
      const r = await fetch(url, { method, headers: { authorization: `Bearer ${sess.token}`, ...(body !== undefined && { 'content-type': 'application/json' }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
      if ((r.headers.get('content-type') || '').startsWith('image/')) return { status: r.status, png: Buffer.from(await r.arrayBuffer()), ms: Number(r.headers.get('x-napkin-render-ms')) };
      return { status: r.status, json: await r.json() };
    },
    async presence(component, label, node, variant, ttl) { await fetch(new URL('api/presence', BASE), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sess.token}` }, body: JSON.stringify({ component, label, node, variant, ttl }) }).catch(() => {}); },
  };
}

async function makeLocal() {
  const dir = resolve(process.env.NAPKIN_DIR || (existsSync(join(process.cwd(), 'components')) ? join(process.cwd(), 'components') : process.cwd()));
  if (!existsSync(dir)) throw new Error(explainError(`no such folder: ${dir} (set NAPKIN_DIR)`));
  const { acquireWorkspaceLock } = await import('./lock.js');
  const { openWorkspace } = await import('./workspace.js');
  const { createApi } = await import('./api.js');
  const lock = acquireWorkspaceLock(dir);
  const ws = await openWorkspace(dir);
  const api = createApi(ws, { dir, canPropose: false }); // nobody is watching a canvas, so nobody could review a proposal
  const sess = api.session(AGENT, process.env.NAPKIN_TOKEN);
  if (sess.status !== 200) throw new Error(explainError(sess.json.error));
  const token = sess.json.token;
  ws.events.on('change', (c) => { if (c.origin !== origin) notice({ ...c, component: c.component }); });
  const stop = async () => { await api.close(); await ws.close(); lock.release(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdin.on('end', stop);
  return {
    mode: 'local', origin, dir,
    async call({ method, path, query, body }) { return (await api.handle({ method, path, query: query || new URLSearchParams(), body, token })) ?? { status: 404, json: { ok: false, error: explainError('not found') } }; },
    async presence() {},
  };
}

let backendP = null;
const backend = () => (backendP ??= makeRemote().catch((e) => { if (process.env.NAPKIN_NO_FALLBACK || !(e instanceof Unreachable)) throw e; return makeLocal(); }).catch((e) => { backendP = null; throw e; }));

// Presence (F16): say what this agent is editing while it works; clear it after a quiet moment.
// The server clears it after `ttl` ms of quiet (700 ms unless NAPKIN_PRESENCE_MS), and at once if this process disconnects.
async function presence(b, component, label, edit) {
  return b.presence(component, label, nodeOfEdit(edit), edit?.variant ?? null, Number(process.env.NAPKIN_PRESENCE_MS || 700));
}
function describe(name, a, compName) {
  if (name === 'add_variant') return `${AGENT}: editing ${compName} / ${a.axis}=${a.value}`;
  const e = a.edits?.[0];
  const node = e?.path?.split('.')[0] || e?.id || e?.parent || e?.name;
  const v = e?.variant ? ` / ${Object.entries(e.variant).map(([k, x]) => `${k}=${x}`).join(' ')}` : '';
  return `${AGENT}: editing ${compName}${node ? ` · ${node}` : ''}${v}`;
}

class ToolError extends Error { constructor(message, data) { super(explainError(message)); this.data = data; } }
const ok = (r) => { if (r.status >= 400 || r.json?.ok === false) { const { ok: _, ...rest } = r.json || {}; throw new ToolError(r.json?.error ?? `HTTP ${r.status}`, rest.stale || rest.permission ? { ok: false, ...rest } : undefined); } return r.json; };

async function callTool(name, a = {}) {
  const b = await backend();
  const c = encodeURIComponent(a.component ?? '');
  const by = AGENT;
  if (name === 'list_tokens') return ok(await b.call({ method: 'GET', path: '/api/tokens' }));
  if (name === 'list_components') return ok(await b.call({ method: 'GET', path: '/api/components' }));
  if (name === 'propose_adoption') return ok(await b.call({ method: 'POST', path: `/api/components/${c}/adoption`, body: {} }));
  if (name === 'read_component') return ok(await b.call({ method: 'GET', path: `/api/components/${c}` }));
  if (name === 'create_component') { const r = ok(await b.call({ method: 'POST', path: '/api/components', body: { name: a.name, rootTag: a.rootTag, by, propose: !!a.propose } })); return r.proposed ? { proposed: true, proposal: r.proposal } : { id: r.id, name: r.name }; }
  if (name === 'rename_component') { const r = ok(await b.call({ method: 'POST', path: `/api/components/${c}/rename`, body: { name: a.name, by } })); return { id: r.id, name: r.name }; }
  if (name === 'delete_component') { const r = ok(await b.call({ method: 'DELETE', path: `/api/components/${c}`, query: new URLSearchParams({ by }) })); return { id: r.id, name: r.name }; }
  if (name === 'search') return { results: ok(await b.call({ method: 'GET', path: '/api/search', query: new URLSearchParams({ q: a.query ?? '' }) })) };
  if (name === 'render_component') {
    const r = await b.call({ method: 'GET', path: `/api/components/${c}/render`, query: new URLSearchParams({ variant: JSON.stringify(a.variant || {}) }) });
    if (!r.png) ok(r);
    return { image: r.png, info: { component: a.component, variant: a.variant || {}, bytes: r.png.length, ms: r.ms } };
  }
  if (name === 'subscribe') {
    const deadline = Math.min(Number(a.waitMs) || 0, 10000);
    const cid = a.component ? ok(await b.call({ method: 'GET', path: `/api/components/${c}` })).component : null;
    const drain = (list) => { const out = list.filter((n) => !cid || n.component === cid || (n.created && n.created === cid)); for (const n of out) list.splice(list.indexOf(n), 1); return out; };
    let got = drain(pending), res = drain(pendingResolved);
    if (!got.length && !res.length && deadline) { await new Promise((r) => { const t = setTimeout(r, deadline); waiters.push(() => { clearTimeout(t); r(); }); }); got = drain(pending); res = drain(pendingResolved); }
    return { changes: got, resolved: res };
  }
  if (name === 'apply_edits' || name === 'add_variant') {
    const edits = name === 'add_variant' ? variantEdits(a) : a.edits;
    if (!a.dryRun) await presence(b, a.component, describe(name, a, a.component), edits?.[0]);
    const r = ok(await b.call({ method: 'POST', path: `/api/components/${c}/edits`, body: { baseRevision: a.baseRevision, edits, by, origin: b.origin, dryRun: !!a.dryRun, propose: !!a.propose } }));
    if (r.proposed) return { proposed: true, proposal: r.proposal };
    return r.dryRun ? { dryRun: true, revision: r.revision, source: r.source } : { revision: r.revision };
  }
  throw new Error(explainError(`unknown tool ${name}`));
}

const INSTRUCTIONS = NO_GUIDE ? 'napkin edits React components. Use the tools.' : `napkin edits real React components. This text is also served as the napkin://guide resource and the napkin_guide prompt.\n\n${GUIDE}`;
const PROMPT = { name: 'napkin_guide', description: 'How to edit napkin components: the dialect, edit ops with examples, propose mode and stale handling.' };

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'parse error' } }); }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications from the client
  if (method === 'initialize') {
    backend().catch(() => {});
    return send({ id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} }, serverInfo: { name: 'napkin', version: '0.2.0' }, instructions: INSTRUCTIONS } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'resources/list') return send({ id, result: { resources: NO_GUIDE ? [] : [{ uri: 'napkin://guide', name: 'napkin guide', description: PROMPT.description, mimeType: 'text/markdown' }] } });
  if (method === 'resources/read') {
    if (params?.uri !== 'napkin://guide') return send({ id, error: { code: -32002, message: `no such resource: ${params?.uri}` } });
    return send({ id, result: { contents: [{ uri: 'napkin://guide', mimeType: 'text/markdown', text: GUIDE }] } });
  }
  if (method === 'prompts/list') return send({ id, result: { prompts: NO_GUIDE ? [] : [PROMPT] } });
  if (method === 'prompts/get') {
    if (params?.name !== PROMPT.name) return send({ id, error: { code: -32602, message: `no such prompt: ${params?.name}` } });
    return send({ id, result: { description: PROMPT.description, messages: [{ role: 'user', content: { type: 'text', text: GUIDE } }] } });
  }
  if (method === 'tools/call') {
    try {
      const data = await callTool(params.name, params.arguments);
      if (data?.image) return send({ id, result: { content: [{ type: 'image', data: data.image.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(data.info) }], structuredContent: data.info } });
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: Array.isArray(data) ? { components: data } : data } });
    } catch (e) {
      const text = e.data ? JSON.stringify({ error: explainError(e.message), ...e.data }) : explainError(e.message);
      return send({ id, result: { isError: true, content: [{ type: 'text', text }], ...(e.data && { structuredContent: { error: explainError(e.message), ...e.data } }) } });
    }
  }
  send({ id, error: { code: -32601, message: `method not found: ${method}` } });
});
