// The single authority (decision 0002). Opens a folder of component files (src/workspace.js),
// serves the canvas page and its modules, bundles each component for the browser (F04), and
// pushes every change over SSE.
//   node src/server.js --dir <components dir> --port <n>      (no --dir: a temp copy of fixtures/)
//   node src/server.js --file <one .tsx> --port <n>           (a one-file folder)
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openWorkspace } from './workspace.js';
import { createApi } from './api.js';
import { acquireLock, LockError } from './lock.js';

const { values: args } = parseArgs({ options: { dir: { type: 'string' }, file: { type: 'string' }, port: { type: 'string', default: '4810' } } });
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let dir, only;
if (args.file) { dir = dirname(resolve(args.file)); only = resolve(args.file); }
else if (args.dir) dir = resolve(args.dir);
else { // a throwaway copy of the fixtures, so playing with the canvas never edits the repo
  dir = mkdtempSync(join(tmpdir(), 'napkin-fixtures-'));
  for (const d of readdirSync(join(ROOT, 'fixtures'))) for (const f of readdirSync(join(ROOT, 'fixtures', d))) if (f.endsWith('.tsx')) copyFileSync(join(ROOT, 'fixtures', d, f), join(dir, f));
  console.log(`napkin: editing a temp copy of fixtures/ in ${dir}`);
}
if (!existsSync(dir)) { console.error(`napkin: no such folder: ${dir}`); process.exit(1); }
let lock; // one writer per folder: a fallback MCP or another server may hold it (AGT-08)
try { lock = acquireLock(dir); } catch (e) { if (e instanceof LockError) { console.error(`napkin: ${e.message}`); process.exit(1); } throw e; }
const ws = await openWorkspace(dir, { only });
const clients = new Set();
const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const broadcast = (obj) => { const f = frame(obj); for (const res of clients) res.write(f); };
// Presence (F16): what each agent says it is editing. Agents (F21): MCP subscriptions, counted.
const presence = new Map(); // component -> label
let agents = 0;

const api = createApi(ws, { broadcast, dir });
ws.events.on('change', (c) => broadcast({ type: 'change', ...c }));
ws.events.on('problem', (p) => broadcast({ type: 'problem', ...p }));
ws.events.on('removed', (r) => broadcast({ type: 'removed', ...r }));
ws.events.on('build', (b) => broadcast({ type: 'build', ...b }));
ws.events.on('added', async ({ component, by, summary }) => {
  const e = ws.find(component);
  if (e) broadcast({ type: 'added', ...(await ws.snapshot(e)), ...(by && { by, summary }) });
});

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const STATIC = { '/': 'public/index.html', '/src/canvas-client.js': 'src/canvas-client.js', '/src/model.js': 'src/model.js' };
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css' };
const send = (res, file) => {
  res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()], 'cache-control': 'no-store' });
  res.end(readFileSync(join(ROOT, file)));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && STATIC[path]) return send(res, STATIC[path]);
    if (req.method === 'GET' && /^\/canvas\/[a-z-]+\.(js|css)$/.test(path)) return send(res, 'public' + path);

    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      for (const e of ws.entries()) res.write(frame({ type: 'state', ...(await ws.snapshot(e)) }));
      res.write(frame({ type: 'agents', count: agents }));
      for (const [component, label] of presence) res.write(frame({ type: 'presence', component, label }));
      res.write(frame({ type: 'ready' }));
      clients.add(res);
      const isAgent = url.searchParams.get('by') === 'agent';
      if (isAgent) { agents++; broadcast({ type: 'agents', count: agents }); }
      req.on('close', () => {
        clients.delete(res);
        if (isAgent) { agents--; broadcast({ type: 'agents', count: agents }); }
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/presence') {
      let body = ''; for await (const chunk of req) body += chunk;
      let msg; try { msg = JSON.parse(body); } catch { return json(res, 400, { ok: false, error: 'body is not JSON' }); }
      const e = ws.find(String(msg?.component ?? ''));
      if (!e) return json(res, 404, { ok: false, error: 'not found' });
      const { component } = await ws.snapshot(e);
      const label = typeof msg.label === 'string' && msg.label.trim() ? msg.label.slice(0, 120) : null;
      if (label) presence.set(component, label); else presence.delete(component);
      broadcast({ type: 'presence', component, label });
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

    // Components, edits, proposals, history, search, render, guide (src/api.js).
    if (path.startsWith('/api/')) {
      let body = ''; if (req.method !== 'GET' && req.method !== 'HEAD') for await (const chunk of req) body += chunk;
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      const r = await api.handle({ method: req.method, path, query: url.searchParams, body, token });
      if (r?.png) { res.writeHead(r.status, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-napkin-render-ms': r.ms.toFixed(1) }); return res.end(r.png); }
      if (r) return json(res, r.status, r.json);
    }
    json(res, 404, { ok: false, error: 'not found' });
  } catch (err) { console.error(err); json(res, 500, { ok: false, error: String(err.message) }); }
});

server.listen(Number(args.port), '127.0.0.1', () => {
  console.log(`napkin canvas: http://127.0.0.1:${server.address().port}/`);
});
const stop = () => { for (const c of clients) c.end(); server.close(); api.close().then(() => ws.close()).then(() => { lock.release(); process.exit(0); }); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
