// The single authority (decision 0002). Opens a folder of component files (src/workspace.js),
// serves the canvas page and its modules, bundles each component for the browser (F04), and
// pushes every change over SSE.
//   node src/server.js --dir <components dir> --port <n>      (no --dir: a temp copy of fixtures/)
//   node src/server.js --file <one .tsx> --port <n>           (a one-file folder)
import { explainError } from './errors.js';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openWorkspace } from './workspace.js';
import { createApi } from './api.js';
import { cleanPrivate } from './atomic.js';
import { createComponent, createProjectConfig, writeTokens, removeDemoWorkspace } from './commit.js';
import { createPresence } from './presence.js';
import { nodeOfEdit } from './model.js';
import { acquireWorkspaceLock, LockError } from './lock.js';
import { resolveAsset, TYPES as IMAGE_TYPES } from './assets.js';
import { openFolder } from './doc/folder.js';
import { createDocRoutes } from './doc/routes.js';
import { agentPermission } from './api.js';

const { values: args } = parseArgs({ options: { dir: { type: 'string' }, root: { type: 'string' }, file: { type: 'string' }, port: { type: 'string', default: '4810' }, recursive: { type: 'boolean' }, 'no-sidecars': { type: 'boolean' }, 'next-port': { type: 'boolean' }, 'watch-parent': { type: 'string' }, stream: { type: 'boolean' } } });
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let dir, only, demoDir;
// exit also covers startup failures and ordinary process.exit(), after shutdown
// has released the workspace. Never remove a caller-supplied --dir or --file.
process.once('exit', () => { if (demoDir) removeDemoWorkspace(demoDir); });
// Signals during async startup still take the normal exit cleanup path.
let shutdown = () => process.exit(0);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => shutdown());
// WPC-25: SIGKILL of the launching CLI cannot be caught, so the server watches it: when --watch-parent <pid> is gone
// (or we were re-parented), it shuts down as if told to, so a dead terminal never leaves an orphan holding the lock.
if (args['watch-parent']) {
  const parent = Number(args['watch-parent']);
  const gone = () => { if (process.ppid !== parent) return true; try { process.kill(parent, 0); return false; } catch (e) { return e.code !== 'EPERM'; } };
  setInterval(() => { if (gone()) { shutdown(); setTimeout(() => process.exit(0), 3000).unref(); } }, 500).unref();
}
if (args.file) { dir = dirname(resolve(args.file)); only = resolve(args.file); }
else if (args.dir) dir = resolve(args.dir);
else { // a throwaway copy of the fixtures, so playing with the canvas never edits the repo
  dir = demoDir = mkdtempSync(join(tmpdir(), 'napkin-fixtures-'));
  for (const d of readdirSync(join(ROOT, 'fixtures'))) for (const f of readdirSync(join(ROOT, 'fixtures', d))) if (f.endsWith('.tsx')) createComponent(join(dir, f), readFileSync(join(ROOT, 'fixtures', existsSync(join(ROOT, 'fixtures/tokens/themed', f)) ? 'tokens/themed' : d, existsSync(join(ROOT, 'fixtures/tokens/themed', f)) ? '' : '', f), 'utf8')); // the demo's components use the demo's tokens, so both themes read well
  writeTokens(join(dir, 'tokens.json'), readFileSync(join(ROOT, 'fixtures/tokens/demo-tokens.json'), 'utf8'), { file: join(dir, 'tokens.css'), text: readFileSync(join(ROOT, 'fixtures/tokens/demo-tokens.css'), 'utf8') });
  createProjectConfig(join(dir, 'napkin.json'), JSON.stringify({ tokens: { source: 'tokens.json', css: 'tokens.css' } }) + '\n');
  console.log(`napkin: editing a temp copy of fixtures/ in ${dir}`);
}
if (!existsSync(dir)) { console.error(`napkin: no such folder: ${dir}. Next: choose an existing --dir or run node src/cli.js init.`); process.exit(1); }
let lock; // one writer per folder: a fallback MCP or another server may hold it (AGT-08)
try { lock = acquireWorkspaceLock(dir, { writeSidecars: !args['no-sidecars'] }); } catch (e) { if (e instanceof LockError) { console.error(`napkin: ${e.message}`); process.exit(1); } throw e; }
if (!args['no-sidecars']) process.once('exit', () => cleanPrivate(dir)); // WPC-37: after the lock is released (its exit hook ran first), tidy what napkin left
// The document engine (decision 0014) opens the whole folder as it is: HTML, CSS and any TSX/JSX, behind the engine
// contract (/api/files, /api/component, /view, /api/edit, /api/undo, /api/styles). The TSX-dialect workspace below
// keeps serving the canvas's dialect components (variants, props, sidecars) as before.
const docRoot = resolve(args.root || (only ? dirname(only) : dir));
const docs = openFolder(docRoot);
const ws = await openWorkspace(dir, { only, recursive: args.recursive, writeSidecars: !args['no-sidecars'], progressive: args.stream });
const clients = new Set();
const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const broadcast = (obj) => { const f = frame(obj); for (const res of clients) res.write(f); };
// Presence (AGT-03): what each agent is editing now, with a stable colour per name (src/presence.js). Agents: SSE connections that say ?by=agent&name=<who>.
const presence = createPresence({ broadcast });
// A proposal is work in progress too: show the agent on its node while it proposes.
const PEOPLE = new Set(['you', 'file', 'git', 'unknown']);
const tint = (by) => (PEOPLE.has(by) || !by ? {} : presence.color(by)); // agents get their presence colour on every frame that names them
const api = createApi(ws, { dir, colorOf: tint, inFolder: !args['no-sidecars'], broadcast: (f) => {
  if (f.type === 'proposal') {
    broadcast({ ...f, proposal: { ...f.proposal, ...tint(f.proposal.by) } });
    if (!f.proposal.adoption && !f.proposal.create && !f.proposal.updated) presence.set(f.proposal.by, { component: f.component, node: nodeOfEdit(f.proposal.edits?.[0]), variant: f.proposal.edits?.[0]?.variant ?? null });
  } else broadcast(f);
} });
ws.events.on('tokens', t => broadcast({ type: 'tokens', ...t }));
ws.events.on('progress', p => broadcast({ type: 'progress', ...p }));
ws.events.on('change', (c) => {
  broadcast({ type: 'change', ...c, ...tint(c.by) });
  // An agent that wrote through the API (not MCP) still shows: the change names who and where. Accepting its proposal is your act, not its work.
  if (c.by && !PEOPLE.has(c.by) && !c.approvedBy && c.edits?.length) presence.set(c.by, { component: c.component, node: nodeOfEdit(c.edits[0]), variant: c.edits[0].variant ?? null, ttl: 700 }); // an apply ends the agent's presence on that node <= 1 s later, whatever ttl it declared before
});
ws.events.on('problem', (p) => broadcast({ type: 'problem', ...p }));
ws.events.on('canvas', (c) => broadcast({ type: 'canvas', ...c }));
ws.events.on('removed', (r) => broadcast({ type: 'removed', ...r }));
ws.events.on('preview', (c) => broadcast({ type: 'preview', ...c }));
ws.events.on('build', (b) => broadcast({ type: 'build', ...b }));
ws.events.on('slots', (s) => broadcast({ type: 'slots', ...s }));
ws.events.on('added', async ({ component, by, summary }) => {
  const e = ws.find(component);
  if (e) broadcast({ type: 'added', ...(await ws.snapshot(e)), ...(by && { by, summary }) });
});

const docRoutes = createDocRoutes(docs, { identify: (t) => api.identify(t), permission: (name) => agentPermission(dir, name), broadcast, legacy: (id) => !!ws.find(id),
  legacyNewest: (verb, by) => { let at = null; for (const x of ws.entries()) { const t = x.store[verb + 'Top']?.(by); if (t && (at === null || t.at > at)) at = t.at; } return at; } });
const json = (res, code, body) => { if (body?.error) body.error = explainError(body.error); res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const STATIC = { '/': 'public/index.html', '/brand/napkin-favicon.svg': 'public/brand/napkin-favicon.svg', '/brand/napkin-glyph.svg': 'public/brand/napkin-glyph.svg', '/src/canvas-client.js': 'src/canvas-client.js', '/src/model.js': 'src/model.js', '/src/token-math.js': 'src/token-math.js', '/src/errors.js': 'src/errors.js', '/src/usage.js': 'src/usage.js', '/src/layout.js': 'src/layout.js', '/src/color.js': 'src/color.js', '/src/html-import.js': 'src/html-import.js', '/src/html-entities.js': 'src/html-entities.js', '/src/css-props.js': 'src/css-props.js', '/src/layout.js': 'src/layout.js', '/src/color.js': 'src/color.js' };
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
const send = (res, file) => {
  res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()], 'cache-control': 'no-store' });
  res.end(readFileSync(join(ROOT, file)));
};

// Only this machine's own canvas may talk to us: Host must be loopback on our port, and Origin (when a browser sends one) the canvas's own origin.
// This stops a web page open in your browser (or a DNS-rebinding name) from writing. It is not a defence against programs running as you.
// Opt-in: NAPKIN_ALLOW_HOST=name.ts.net[,other] also accepts those hostnames (e.g. behind `tailscale serve` on a private tailnet; they get full write access).
const EXTRA = (process.env.NAPKIN_ALLOW_HOST || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const bare = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '');
const allowedHost = (h) => { const p = server.address()?.port; return h === `127.0.0.1:${p}` || h === `localhost:${p}` || EXTRA.includes(bare(h)); };
const guard = (req) => allowedHost(req.headers.host) && (req.headers.origin === undefined || req.headers.origin === `http://${req.headers.host}` || (allowedHost(req.headers.origin.replace(/^https?:\/\//, '')) && (req.headers.origin.startsWith('http://') || EXTRA.includes(bare(req.headers.origin.replace(/^https?:\/\//, ''))))));

const server = createServer(async (req, res) => {
  if (!guard(req)) return json(res, 403, { ok: false, error: 'forbidden: napkin only answers its own canvas on 127.0.0.1 or localhost' });
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/runtime.js') { // the one shared copy of React the component bundles import (see src/bundle.js)
      const r = await ws.runtime(url.searchParams.get('module'));
      if (!r) return json(res, 404, { ok: false, error: 'unknown runtime module' });
      res.writeHead(200, { 'content-type': TYPES.js, 'cache-control': 'public, max-age=3600' });
      return res.end(r.code);
    }
    if (req.method === 'GET' && STATIC[path]) return send(res, STATIC[path]);
    if (await docRoutes(req, res, url)) return;
    if (req.method === 'GET' && /^\/fonts\/[a-z-]+\.woff2$/.test(path)) { res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=86400' }); return res.end(readFileSync(join(ROOT, 'public' + path))); }
    if (req.method === 'GET' && /^\/canvas\/[a-z-]+\.(js|css)$/.test(path)) return send(res, 'public' + path);

    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      clients.add(res);
      res.write(frame({ type: 'progress', ...ws.progress() }));
      for (const e of ws.entries()) res.write(frame({ type: 'state', ...(await ws.snapshot(e)) }));
      const isAgent = url.searchParams.get('by') === 'agent';
      const who = (url.searchParams.get('name') || 'agent').slice(0, 40);
      if (isAgent) presence.connect(who);
      res.write(frame(presence.agentsFrame()));
      for (const f of presence.frames()) res.write(frame(f));
      res.write(frame({ type: 'ready' }));
      clients.add(res);
      if (isAgent) broadcast(presence.agentsFrame());
      req.on('close', () => {
        clients.delete(res);
        if (isAgent) { presence.disconnect(who); broadcast(presence.agentsFrame()); }
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/presence') {
      let body = ''; for await (const chunk of req) body += chunk;
      let msg; try { msg = JSON.parse(body); } catch { return json(res, 400, { ok: false, error: 'body is not JSON' }); }
      const who = api.identify(/^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1]);
      if (!who) return json(res, 401, { ok: false, error: 'identity required: send "Authorization: Bearer <token>" (POST /api/session { as } gives you one)' });
      const e = ws.find(String(msg?.component ?? ''));
      if (!e) return json(res, 404, { ok: false, error: 'not found' });
      const label = typeof msg.label === 'string' && msg.label.trim() ? msg.label.slice(0, 120) : null;
      if (label) presence.set(who, { component: e.id, node: typeof msg.node === 'string' ? msg.node : null, variant: msg.variant && typeof msg.variant === 'object' ? msg.variant : null, label, ttl: msg.ttl });
      else presence.clear(who);
      return json(res, 200, { ok: true });
    }

    // The bundle for one component; waits for the build that follows the latest revision. ?rev=N only busts caches.
    const b = path.match(/^\/bundle\/([^/]+)\.js$/);
    if (req.method === 'GET' && b) {
      const e = ws.find(decodeURIComponent(b[1]));
      if (!e) return json(res, 404, { ok: false, error: 'not found' });
      const r = await ws.bundle(e);
      if (!r.ok) return json(res, 500, { ok: false, error: r.error });
      res.writeHead(200, { 'content-type': TYPES.js, 'cache-control': 'no-store', 'x-napkin-build-ms': r.ms.toFixed(1) });
      return res.end(r.code);
    }

    // The bundle of a pending proposal's result, for the ghost cells (nothing is written).
    const bp = path.match(/^\/bundle-proposal\/([^/]+)\.js$/);
    if (req.method === 'GET' && bp) {
      const p = api.proposals.get(decodeURIComponent(bp[1]));
      const e = p?.create ? { file: join(dir, `${p.name}.tsx`), name: p.name } : p && ws.find(p.component); // a new component has no entry yet: bundle its would-be source under its would-be name
      if (!e) return json(res, 404, { ok: false, error: 'no such proposal' });
      let source = p.source;
      const only = url.searchParams.get('only'); // "0,2": show just those edits (a dry run on the proposal's base; nothing is written)
      if (only !== null && !p.adoption) {
        const idx = only.split(',').map(Number);
        if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= p.edits.length)) return json(res, 400, { ok: false, error: `only must list edit numbers from 0 to ${p.edits.length - 1}` });
        const d = await e.store.apply({ baseRevision: p.baseRevision, edits: p.edits.filter((_, i) => idx.includes(i)), by: p.by, dryRun: true });
        if (!d.ok) return json(res, 409, { ok: false, error: d.error });
        source = d.source;
      }
      const r = await ws.bundleText(e, source);
      if (!r.ok) return json(res, 500, { ok: false, error: r.error });
      res.writeHead(200, { 'content-type': TYPES.js, 'cache-control': 'no-store' });
      return res.end(r.code);
    }

    // The bundle of a past revision, for the history panel's read-only preview.
    const ba = path.match(/^\/bundle-at\/([^/]+)\.js$/);
    if (req.method === 'GET' && ba) {
      const e = ws.find(decodeURIComponent(ba[1]));
      if (!e) return json(res, 404, { ok: false, error: 'not found' });
      const r = await ws.bundleAt(e, url.searchParams.get('revision'));
      if (!r.ok) return json(res, r.error.includes('history') ? 404 : 500, { ok: false, error: r.error });
      res.writeHead(200, { 'content-type': TYPES.js, 'cache-control': 'no-store' });
      return res.end(r.code);
    }

    // Images a component refers to by a relative src ("assets/ab12cd34.png"): served from the components folder or the repo, images only.
    if (req.method === 'GET' && IMAGE_TYPES[path.split('.').pop().toLowerCase()] && !path.startsWith('/api/')) {
      const a = resolveAsset(dir, decodeURIComponent(path.slice(1)));
      if (a) { res.writeHead(200, { 'content-type': a.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' }); return res.end(readFileSync(a.abs)); }
      return json(res, 404, { ok: false, error: `no image at ${path.slice(1)}` });
    }

    // Components, edits, proposals, history, search, render, guide (src/api.js).
    if (path.startsWith('/api/')) {
      let body = req.napkinBody ?? ''; if (req.napkinBody === undefined && req.method !== 'GET' && req.method !== 'HEAD') for await (const chunk of req) body += chunk;
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      const r = await api.handle({ method: req.method, path, query: url.searchParams, body, token });
      if (r?.bytes) { res.writeHead(r.status, { 'content-type': r.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' }); return res.end(r.bytes); }
      if (r?.png) { res.writeHead(r.status, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-napkin-render-ms': r.ms.toFixed(1) }); return res.end(r.png); }
      if (r) return json(res, r.status, r.json);
    }
    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) { console.error(err); json(res, 500, { ok: false, error: String(err.message) }); }
});

let listenPort = Number(args.port);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && args['next-port'] && listenPort > 0 && listenPort < 65535) { server.listen(++listenPort, '127.0.0.1'); return; }
  console.error(`napkin: port ${listenPort}: ${e.message}. Next: choose another --port.`);
  ws.close().then(() => { lock.release(); process.exit(1); });
});
server.listen(listenPort, '127.0.0.1', () => {
  console.log(`napkin canvas: http://127.0.0.1:${server.address().port}/`);
  if (args.stream) ws.ready.then(async () => { if (!server.listening) return; console.log(await ws.report()); });
});
let stopping = false;
shutdown = () => { if (stopping) return; stopping = true; for (const c of clients) c.end(); server.close(); docs.close(); api.close().then(() => ws.close()).then(() => { lock.release(); process.exit(0); }); };
