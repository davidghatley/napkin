// Variant A server: the single authority. Owns the store, serves the canvas page, a small
// HTTP API that the MCP process proxies to, and an SSE stream that pushes every revision.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openStore } from './store.js';

const { values: args } = parseArgs({ options: { file: { type: 'string' }, port: { type: 'string', default: '4810' } } });
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = await openStore(resolve(args.file));
const clients = new Set();

store.events.on('change', ({ revision, by, edits, origin, doc }) => {
  const frame = `data: ${JSON.stringify({ type: 'change', component: doc.id, revision, by, edits, origin, doc })}\n\n`;
  for (const res of clients) res.write(frame);
});

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const STATIC = { '/': 'public/index.html', '/canvas.js': 'public/canvas.js', '/src/render.js': 'src/render.js', '/src/canvas-client.js': 'src/canvas-client.js' };
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript' };
const matches = (c, doc) => c === doc.id || c === doc.name;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && STATIC[path]) {
      res.writeHead(200, { 'content-type': TYPES[STATIC[path].split('.').pop()], 'cache-control': 'no-store' });
      return res.end(readFileSync(join(ROOT, STATIC[path])));
    }
    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const { revision, doc } = await store.read();
      res.write(`data: ${JSON.stringify({ type: 'state', component: doc.id, revision, doc })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const { revision, doc } = await store.read();
    if (req.method === 'GET' && path === '/api/components') return json(res, 200, [{ id: doc.id, name: doc.name }]);
    const m = path.match(/^\/api\/components\/([^/]+)(\/edits)?$/);
    if (!m || !matches(decodeURIComponent(m[1]), doc)) return json(res, 404, { ok: false, error: 'not found' });
    if (req.method === 'GET' && !m[2]) return json(res, 200, { component: doc.id, revision, doc });
    if (req.method === 'POST' && m[2]) {
      let body = ''; for await (const chunk of req) body += chunk;
      let msg; try { msg = JSON.parse(body); } catch { return json(res, 400, { ok: false, error: 'invalid edit #0: body is not JSON' }); }
      const result = await store.apply(msg);
      return json(res, result.ok ? 200 : 409, result);
    }
    json(res, 405, { ok: false, error: 'method not allowed' });
  } catch (e) { console.error(e); json(res, 500, { ok: false, error: String(e.message) }); }
});

server.listen(Number(args.port), '127.0.0.1', () => {
  console.log(`napkin canvas: http://127.0.0.1:${server.address().port}/`);
});
const stop = () => { for (const c of clients) c.end(); server.close(); store.close().then(() => process.exit(0)); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
