// /view: one component as its own document, the way a browser draws the file (decision 0014). This is also what a
// canvas frame shows (an iframe of this URL), so the canvas, the reference and the file opened directly agree.
//   HTML: the file's own bytes. Only two things are added, at the top of <head>: the folder's applied stylesheets
//         (contract ruling 3: first, so the file's own CSS wins) and a <base> so its relative URLs resolve as on disk.
//   TSX/JSX: a plain page (doctype, UTF-8, the applied stylesheets, <div id="root">) that renders the component with
//         no props (contract ruling 5), bundled by esbuild with the folder's own node_modules first.
// The query's width and theme are the frame's: the browser (or the canvas's iframe) supplies both; nothing is rewritten.
import { join, dirname, posix, extname, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { headInsertAt, attrOf, parseHtml } from './html.js';
import { fromL } from './source.js';
import { explainError } from '../errors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const href = (path) => '/raw/' + path.split('/').map(encodeURIComponent).join('/');
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// A component that draws nothing with no props (a Badge or Button with no children) would be an empty box: say so, quietly, in its frame.
const EMPTY_NOTE = `(function(){
var NOTE=null,timer=0;
var MEDIA=/^(img|svg|picture|video|canvas|iframe|audio|object|embed|hr)$/;
var PROPS=['backgroundColor','backgroundImage','boxShadow','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineStyle'];
var ref=null;
function bare(){if(ref)return ref;var b=document.createElement('button');b.style.cssText='position:absolute;left:-9999px;top:0';document.body.append(b);var c=getComputedStyle(b);ref={};PROPS.forEach(function(k){ref[k]=c[k]});b.remove();return ref}
function clear(c){return c==='rgba(0, 0, 0, 0)'||c==='transparent'}
function drawn(c,isButton){
 // a box that draws something: a fill, an image, a shadow, an outline, a border with width (a button counts only what differs from a bare button)
 var r=isButton?bare():null,k;
 if(c.backgroundImage!=='none'&&(!r||c.backgroundImage!==r.backgroundImage))return true;
 if(!clear(c.backgroundColor)&&(!r||c.backgroundColor!==r.backgroundColor))return true;
 if(c.boxShadow!=='none'&&(!r||c.boxShadow!==r.boxShadow))return true;
 if(c.outlineStyle!=='none'&&(!r||c.outlineStyle!==r.outlineStyle))return true;
 var sides=['Top','Right','Bottom','Left'];
 for(k=0;k<4;k++){var w=parseFloat(c['border'+sides[k]+'Width']),st=c['border'+sides[k]+'Style'],col=c['border'+sides[k]+'Color'];if(w>0&&st!=='none'&&st!=='hidden'&&!clear(col)){if(!r||w!==parseFloat(r['border'+sides[k]+'Width'])||st!==r['border'+sides[k]+'Style']||col!==r['border'+sides[k]+'Color'])return true}}
 return false}
function pseudo(e){var p=['::before','::after'];for(var i=0;i<2;i++){var c=getComputedStyle(e,p[i]);if(c.content&&c.content!=='none'&&c.content!=='normal'&&c.display!=='none'){if(c.content.length>2)return true;var b=parseFloat(c.width)>0&&parseFloat(c.height)>0;if(b&&drawn(c,false))return true;if(drawn(c,false)&&(parseFloat(c.width)>0||parseFloat(c.height)>0))return true}}return false}
function hasContent(){
 var r=document.getElementById('root');if(!r)return true;
 var w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT),n;while((n=w.nextNode())){if(!n.nodeValue.trim())continue;var pe=n.parentElement;if(!pe||/^(style|script|noscript|template)$/.test(pe.localName))continue;if(pe.getClientRects().length&&getComputedStyle(pe).visibility!=='hidden')return true}
 var els=r.querySelectorAll('*');
 for(var i=0;i<els.length;i++){var e=els[i],t=e.localName;
  if(MEDIA.test(t))return true;
  if(/^(input|select|textarea)$/.test(t)&&e.type!=='hidden')return true;
  var c=getComputedStyle(e);if(c.display==='none'||c.visibility==='hidden')continue;
  var b=e.getBoundingClientRect();
  if(pseudo(e))return true;
  if(t==='button'){if(drawn(c,true)&&b.width>=1&&b.height>=1)return true;continue}
  if(b.width<1||b.height<1)continue;
  if(drawn(c,false))return true}
 return pseudo(r)}
function show(){if(NOTE)return;NOTE=document.createElement('p');NOTE.setAttribute('data-napkin','');NOTE.setAttribute('data-napkin-empty','');NOTE.style.cssText='margin:0;padding:10px 12px;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;color:#5b6270;background:#f3f4f6';NOTE.textContent='Renders nothing without props.';document.body.append(NOTE)}
function hide(){if(NOTE){NOTE.remove();NOTE=null}}
function check(){if(document.querySelector('[data-napkin-error]')){hide();return}if(hasContent())hide();else show()}
function later(){clearTimeout(timer);timer=setTimeout(check,120)}
setTimeout(function(){check();new MutationObserver(later).observe(document.getElementById('root')||document.body,{subtree:true,childList:true,characterData:true,attributes:true})},250);
})();`;

// `prefix`: where the folder's files are served from. A film-strip version serves its own stylesheets (time-routes.js).
export function htmlView(engine, comp, { prefix = '/raw/' } = {}) {
  const href = (path) => prefix + path.split('/').map(encodeURIComponent).join('/');
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
  // `over` (the film strip): Map(path -> bytes) of an earlier version, bundled in place of those files on disk and never cached.
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
  componentDidCatch(e) { window.__napkinError = String(e && e.message || e); }
  render() { return this.state.e ? createElement('pre', { 'data-napkin-error': '', style: { whiteSpace: 'pre-wrap', font: '12px/1.5 ui-monospace,monospace', color: '#b42318', background: '#fff', margin: 0, padding: 12, overflowWrap: 'anywhere' } }, 'napkin could not run ' + ${JSON.stringify(comp.path)} + ': ' + String(this.state.e && this.state.e.message || this.state.e)) : this.props.children; } }
if (typeof C !== 'function' && !(C && typeof C === 'object' && C.$$typeof)) window.__napkinError = 'no export named ' + ${JSON.stringify(exportName)};
else createRoot(document.getElementById('root')).render(createElement(Guard, null, createElement(C)));
`;
    let out;
    try {
      const r = await build({
        stdin: { contents, resolveDir: folder, loader: 'jsx', sourcefile: 'napkin-view.jsx' }, bundle: true, format: 'iife', jsx: 'automatic', write: false, logLevel: 'silent',
        nodePaths: [join(folder, 'node_modules'), join(ROOT, 'node_modules')],
        alias: { react: join(modDir, 'react'), 'react-dom': join(modDir, 'react-dom') },
        define: { 'process.env.NODE_ENV': '"production"' }, banner: { js: 'var process=globalThis.process||{env:{NODE_ENV:"production"}};' }, loader: { '.svg': 'dataurl', '.png': 'dataurl' },
        ...(over && { plugins: [{ name: 'napkin-version', setup(b) { const mine = new Map([...over].map(([p, buf]) => [engine.abs(p), buf])); const LOADER = { '.tsx': 'tsx', '.jsx': 'jsx', '.ts': 'ts', '.js': 'js', '.css': 'css' }; b.onLoad({ filter: /\.(tsx|jsx|ts|js|css)$/ }, (a) => (mine.has(a.path) ? { contents: mine.get(a.path).toString('utf8'), loader: LOADER[extname(a.path)], resolveDir: dirname(a.path) } : undefined)); } }] }),
      });
      out = { code: r.outputFiles[0].text };
    } catch (e) {
      const loc = e.errors?.[0]?.location; // say where, as the parse error of a broken file does: "line 3: ..."
      out = { error: explainError(`${loc?.file && loc.file !== 'napkin-view.jsx' && !relative(folder, resolve(loc.file)).startsWith('..') ? `${relative(folder, resolve(loc.file))}: ` : ''}${loc ? `line ${loc.line}: ` : ''}${(e.errors?.[0]?.text || e.message).slice(0, 400)}`, { next: 'fix the import or the code it names, then save; napkin builds it again.' }), file: e.errors?.[0]?.location?.file }; }
    if (!over) cache.set(key, out);
    return out;
  }
  async function view(comp, over = null) {
    const links = engine.applied().map((p) => `<link rel="stylesheet" href="${href(p)}">`).join('');
    const b = comp.broken && !over ? { error: explainError(comp.broken, { next: 'fix the syntax error, then save; napkin reads it again.' }) } : await bundle(comp, over);
    if (b.error) {
      // The frame still draws: it says why the component could not be built (the canvas shows the same page).
      return { type: 'text/html; charset=utf-8', status: 200, body: Buffer.from(`<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div id="root"></div><pre data-napkin-error style="white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:#b42318;background:#fff;margin:0;padding:12px;min-width:0;overflow-wrap:anywhere">napkin could not build ${escHtml(comp.id)}: ${escHtml(b.error)}</pre></body></html>`) };
    }
    const code = b.code.replace(/<\/script/gi, '<\\/script');
    // a throw while the module loads (nothing to catch it): say so in the frame too
    const onerr = `addEventListener('error',function(e){if(/ResizeObserver loop/.test(e.message||''))return;var p=document.createElement('pre');p.setAttribute('data-napkin-error','');p.style.cssText='white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:#b42318;background:#fff;margin:0;padding:12px;overflow-wrap:anywhere';p.textContent='napkin could not run '+${JSON.stringify(comp.path)}+': '+(e.message||e);document.body.append(p)});`.replace(/<\//g, '<\\/');
    return { type: 'text/html; charset=utf-8', status: 200, body: Buffer.from(`<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div id="root"></div><script>${onerr}</script><script>${code}</script><script>${EMPTY_NOTE}</script></body></html>`) };
  }
  return { view, bundle };
}
