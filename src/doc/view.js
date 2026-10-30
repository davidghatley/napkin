// /view: one component as its own document, the way a browser draws the file (decision 0014). This is also what a
// canvas frame shows (an iframe of this URL), so the canvas, the reference and the file opened directly agree.
//   HTML: the file's own bytes. Only two things are added, at the top of <head>: the folder's applied stylesheets
//         (contract ruling 3: first, so the file's own CSS wins) and a <base> so its relative URLs resolve as on disk.
//   TSX/JSX: a plain page (doctype, UTF-8, the applied stylesheets, <div id="root">) that renders the component with
//         no props (contract ruling 5), bundled by esbuild with the folder's own node_modules first.
// The query's width and theme are the frame's: the browser (or the canvas's iframe) supplies both; nothing is rewritten.
import { join, dirname, posix } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { headInsertAt, attrOf, parseHtml } from './html.js';
import { fromL } from './source.js';
import { explainError } from '../errors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const href = (path) => '/raw/' + path.split('/').map(encodeURIComponent).join('/');
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function htmlView(engine, comp) {
  const entry = engine.read(comp.path);
  const s = entry.s;
  const parsed = entry.html || (entry.html = parseHtml(s));
  const at = headInsertAt(s, parsed);
  // data-napkin marks what napkin added, so the canvas's element map skips it (it draws nothing by itself)
  const links = engine.applied().map((p) => `<link rel="stylesheet" href="${href(p)}" data-napkin>`).join('');
  const dir = posix.dirname(comp.path);
  const hasBase = parsed.nodes.some((n) => n.name === 'base' && attrOf(n, 'href'));
  const base = hasBase ? '' : `<base href="${href(dir === '.' ? '' : dir + '/')}" data-napkin>`;
  const body = Buffer.concat([entry.buf.subarray(0, at), Buffer.from(links + base, 'utf8'), entry.buf.subarray(at)]);
  // The charset the file declares is the one the browser uses when it opens the file; say the same over HTTP.
  const meta = parsed.nodes.find((n) => n.name === 'meta' && attrOf(n, 'charset'));
  const httpEquiv = parsed.nodes.find((n) => n.name === 'meta' && /content-type/i.test(attrOf(n, 'http-equiv')?.value || ''));
  const charset = meta ? fromL(attrOf(meta, 'charset').value).trim() : /charset=([\w-]+)/i.exec(fromL(attrOf(httpEquiv || { attrs: [] }, 'content')?.value || ''))?.[1];
  return { type: `text/html${charset ? `; charset=${charset}` : ''}`, body };
}

// TSX: one esbuild bundle per (file, export), kept until any file of the folder changes.
export function createTsxViews(engine) {
  const cache = new Map(); // key -> { code, error }
  let esbuild = null;
  const load = async () => (esbuild ||= await import('esbuild'));
  engine.events.on('change', () => cache.clear());
  engine.events.on('files', () => cache.clear());
  // `over` (the film strip): the file's bytes from an earlier version, bundled in place of the file on disk and never cached.
  async function bundle(comp, over = null) {
    const key = `${comp.path}#${comp.name}`;
    if (!over && cache.has(key)) return cache.get(key);
    const { build } = await load();
    const folder = engine.root;
    const modDir = existsSync(join(folder, 'node_modules/react')) ? join(folder, 'node_modules') : join(ROOT, 'node_modules');
    const exportName = comp.isDefault ? 'default' : comp.name;
    const contents = `import * as M from ${JSON.stringify(engine.abs(comp.path))};
import { createElement, Component } from 'react';
import { createRoot } from 'react-dom/client';
const C = M[${JSON.stringify(exportName)}] ?? M.default;
class Guard extends Component { constructor(p) { super(p); this.state = { e: null }; } static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e) { window.__napkinError = String(e && e.message || e); } render() { return this.state.e ? null : this.props.children; } }
if (typeof C !== 'function' && !(C && typeof C === 'object' && C.$$typeof)) window.__napkinError = 'no export named ' + ${JSON.stringify(exportName)};
else createRoot(document.getElementById('root')).render(createElement(Guard, null, createElement(C)));
`;
    let out;
    try {
      const r = await build({
        stdin: { contents, resolveDir: folder, loader: 'jsx', sourcefile: 'napkin-view.jsx' }, bundle: true, format: 'iife', jsx: 'automatic', write: false, logLevel: 'silent',
        nodePaths: [join(folder, 'node_modules'), join(ROOT, 'node_modules')],
        alias: { react: join(modDir, 'react'), 'react-dom': join(modDir, 'react-dom') },
        define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl', '.png': 'dataurl' },
        ...(over && { plugins: [{ name: 'napkin-version', setup(b) { const me = engine.abs(comp.path); b.onLoad({ filter: /\.[jt]sx$/ }, (a) => (a.path === me ? { contents: over.toString('utf8'), loader: a.path.endsWith('.tsx') ? 'tsx' : 'jsx', resolveDir: dirname(me) } : undefined)); } }] }),
      });
      out = { code: r.outputFiles[0].text };
    } catch (e) { out = { error: explainError((e.errors?.[0]?.text || e.message).slice(0, 400), { next: 'fix the import or the code it names, then save; napkin builds it again.' }), file: e.errors?.[0]?.location?.file }; }
    if (!over) cache.set(key, out);
    return out;
  }
  async function view(comp, over = null) {
    const links = engine.applied().map((p) => `<link rel="stylesheet" href="${href(p)}">`).join('');
    const b = comp.broken && !over ? { error: explainError(comp.broken, { next: 'fix the syntax error, then save; napkin reads it again.' }) } : await bundle(comp, over);
    if (b.error) {
      // The frame still draws: it says why the component could not be built (the canvas shows the same page).
      return { type: 'text/html; charset=utf-8', status: 200, body: Buffer.from(`<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div id="root"></div><pre data-napkin-error style="white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:#b42318;margin:8px">napkin could not build ${escHtml(comp.id)}: ${escHtml(b.error)}</pre></body></html>`) };
    }
    const code = b.code.replace(/<\/script/gi, '<\\/script');
    return { type: 'text/html; charset=utf-8', status: 200, body: Buffer.from(`<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div id="root"></div><script>${code}</script></body></html>`) };
  }
  return { view, bundle };
}
