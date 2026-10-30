// Harness proof only (LOCKED, never an engine): a stand-in that answers the P0 contract so the measures can be shown to
// PASS when the contract is met. It serves each HTML file as it is (plus <base> and the applied stylesheets), renders
// TSX the way the reference does, and "edits" by writing the result bench/edits.js expects (an oracle). Runs that use
// it print "official": false.
//   NAPKIN_P0_ENGINE=bench/p0-mock.js node bench/fidelity.js     (likewise edits.js, imposed.js)
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { walk, element, tagName, tsxReference, L } from './p0-lib.js';
import { EDITS, prepare } from './edits.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: 'string' } } });
const folder = positionals[1], name = basename(folder), corpus = dirname(folder);
const stateFile = join(process.env.NAPKIN_STATE_DIR || tmpdir(), 'p0-mock-' + createHash('sha256').update(folder).digest('hex').slice(0, 12) + '.json');
let applied = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).applied : [];
const undo = new Map();
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function files() {
  return walk(folder).flatMap((path) => {
    const ext = extname(path);
    if (ext === '.html') return [{ path, kind: 'html', components: [{ id: path, name: path }] }];
    if (ext === '.css') return [{ path, kind: 'css', components: [] }];
    if (ext === '.tsx' || ext === '.jsx') {
      const s = readFileSync(join(folder, path), 'utf8'), names = new Set();
      for (const m of s.matchAll(/export function ([A-Z]\w*)/g)) names.add(m[1]);
      for (const m of s.matchAll(/export \{([^}]*)\}/g)) for (const n of m[1].split(',')) { const t = n.trim(); if (/^[A-Z]/.test(t)) names.add(t); }
      return [{ path, kind: ext.slice(1), components: [...names].map((n) => ({ id: `${path}#${n}`, name: n })) }];
    }
    return [];
  });
}
const fileOf = (id) => id.split('#')[0];
function tree(path) {
  const buf = readFileSync(join(folder, path)), s = L(buf), out = [];
  for (let i = s.indexOf('<'); i >= 0; i = s.indexOf('<', i + 1)) {
    if (!/[A-Za-z]/.test(s[i + 1] || '')) continue;
    try { const e = element(s, i); out.push({ node: String(i), tag: tagName(s, i), start: i, end: e.end, children: [] }); } catch {}
  }
  return { revision: createHash('sha256').update(buf).digest('hex').slice(0, 12), tree: out };
}
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = async (req) => { let b = ''; for await (const c of req) b += c; try { return JSON.parse(b); } catch { return null; } };
const strip = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && '$node' in v ? String(v.$node) : v));

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), path = decodeURIComponent(url.pathname);
  if (path === '/api/files') return json(res, 200, { files: files() });
  if (path === '/api/styles' && req.method === 'GET') return json(res, 200, { undefinedVars: [], applied });
  if (path === '/api/styles' && req.method === 'POST') { applied = (await body(req))?.applied || []; mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify({ applied })); return json(res, 200, { ok: true }); }
  if (path.startsWith('/api/component/')) return json(res, 200, tree(fileOf(path.slice(15))));
  if (path === '/api/edit') {
    const b = await body(req), file = fileOf(b.component);
    for (const e of EDITS.filter((x) => x.folder === name)) {
      let p; try { p = prepare(corpus, e); } catch { continue; }
      if (strip(p.edit) !== JSON.stringify(b.edits[0])) continue;
      const target = join(folder, e.file);
      (undo.get(b.component) || undo.set(b.component, []).get(b.component)).push([target, readFileSync(target)]);
      writeFileSync(target, Buffer.from(p.canon, 'latin1'));
      return json(res, 200, { ok: true, revision: 'r' + Date.now() });
    }
    if (b.edits[0]?.name === 'data-bench') { // imposed.js's one edit
      const target = join(folder, file), s = readFileSync(target, 'latin1'), at = Number(b.edits[0].node), e = element(s, at);
      (undo.get(b.component) || undo.set(b.component, []).get(b.component)).push([target, readFileSync(target)]);
      let close = e.openEnd - 1; if (s[close - 1] === '/') close--;
      writeFileSync(target, Buffer.from(s.slice(0, close) + ' data-bench="one"' + s.slice(close), 'latin1'));
      return json(res, 200, { ok: true, revision: 'r' + Date.now() });
    }
    return json(res, 400, { ok: false, error: 'the mock only knows the bench edits' });
  }
  if (path === '/api/undo') { const b = await body(req), st = undo.get(b.component); const last = st?.pop(); if (!last) return json(res, 409, { ok: false }); writeFileSync(last[0], last[1]); return json(res, 200, { ok: true }); }
  if (path.startsWith('/raw/')) {
    const p = join(folder, path.slice(5));
    if (!p.startsWith(folder) || !existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); return res.end(readFileSync(p));
  }
  if (path.startsWith('/view/')) {
    const id = path.slice(6), file = fileOf(id), links = applied.map((a) => `<link rel="stylesheet" href="/raw/${a}">`).join('');
    if (file.endsWith('.html')) {
      let s = readFileSync(join(folder, file), 'utf8');
      const base = `<base href="/raw/${dirname(file) === '.' ? '' : dirname(file) + '/'}">`;
      const m = /<head[^>]*>/i.exec(s);
      s = m ? s.slice(0, m.index + m[0].length) + links + base + s.slice(m.index + m[0].length) : base + links + s;
      res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(s);
    }
    const out = mkdtempSync(join(tmpdir(), 'napkin-p0-mockref-'));
    const r = await tsxReference(join(folder, file), id.split('#')[1], folder, out, []);
    if (!r.ok) { rmSync(out, { recursive: true, force: true }); res.writeHead(500); return res.end(r.error); }
    const bundle = readFileSync(join(out, 'bundle.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
    rmSync(out, { recursive: true, force: true });
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    return res.end(`<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div id="root"></div><script>${bundle}</script></body></html>`);
  }
  json(res, 404, { ok: false });
}).listen(Number(values.port), '127.0.0.1', () => console.log(`p0 mock: http://127.0.0.1:${values.port}/`));
