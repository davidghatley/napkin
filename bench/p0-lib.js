// P0 locked measures: shared harness for bench/fidelity.js (D1), bench/edits.js (D2) and bench/imposed.js (D4).
// LOCKED: builders never edit this file or the measures that import it (plan.md, "Engine contract the measures use").
// It talks to napkin only through that HTTP contract, starts Chromium only through src/chromium.js spawnChromium,
// and imports nothing else from the repo, so changing the engine or the tests cannot change what is measured.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnChromium } from '../src/chromium.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCRATCH = process.env.NAPKIN_P0_TMP || '/tmp/claude-1000';
export const TOL = 2;            // a pixel differs when any channel differs by more than 2/255
export const MAX_DIFF = 0.001;   // pass: at most 0.1% of a component's pixels differ
export const VIEW_H = 900;       // viewport height both sides lay out at, before the page is measured
export const MAX_H = 8000;       // tallest capture; a taller page is cut at 8000 px on both sides
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The locked files. Their hash is printed in every summary so a run can be tied to an unedited harness.
export const LOCKED = ['bench/p0-lib.js', 'bench/corpus.js', 'bench/fidelity.js', 'bench/edits.js', 'bench/imposed.js', 'bench/p0-mock.js', 'bench/corpus/.gitattributes', 'bench/README.md', 'src/chromium.js'];
export function lockedHash() {
  const h = createHash('sha256');
  for (const f of LOCKED) h.update(f + '\0').update(existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f)) : Buffer.alloc(0));
  const edge = join(ROOT, 'bench/corpus/edge');
  for (const f of walk(edge)) h.update('edge/' + f + '\0').update(readFileSync(join(edge, f)));
  return h.digest('hex').slice(0, 16);
}

// Every regular file under dir (relative paths, sorted), skipping .git and node_modules.
export function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}
// A snapshot of every file in a folder (bytes), to prove nothing else changed.
export function snapshot(dir) {
  const m = new Map();
  for (const f of walk(dir)) { const p = join(dir, f); m.set(f, lstatSync(p).isSymbolicLink() ? Buffer.from('symlink') : readFileSync(p)); }
  return m;
}
export function snapshotDiff(before, after) {
  const changed = [], added = [], removed = [];
  for (const [f, b] of before) { if (!after.has(f)) removed.push(f); else if (!after.get(f).equals(b)) changed.push(f); }
  for (const f of after.keys()) if (!before.has(f)) added.push(f);
  return { changed, added, removed };
}

// ---------- the summary line ----------
// The last line every measure prints is one JSON object. Exit 0 = pass, 1 = fail, 2 = the harness itself could not run.
export function finish(summary) {
  const line = { ...summary, official: !process.env.NAPKIN_P0_ENGINE, engine: relative(ROOT, ENGINE), harness: lockedHash(), at: new Date().toISOString() };
  console.log(JSON.stringify(line));
  process.exitCode = summary.error ? 2 : summary.pass ? 0 : 1;
}
export const pct = (n, d) => (d ? Math.round((n / d) * 100000) / 1000 : 0);

// ---------- napkin over the contract ----------
// The engine under test. Official runs use src/cli.js; NAPKIN_P0_ENGINE (a script that takes the same `open <folder>
// --port P`) exists only to prove the harness can pass (bench/p0-mock.js). Such runs say so and never count.
export const ENGINE = process.env.NAPKIN_P0_ENGINE ? resolve(process.env.NAPKIN_P0_ENGINE) : join(ROOT, 'src/cli.js');
export function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
// `node src/cli.js open <folder> --port P`. Ready = GET /api/files answers 200 with { files: [...] }.
// Resolves { ok, base, ms, error, stop } and never throws: a server that never becomes ready is a measured failure.
export async function startNapkin(folder, { timeout = 30000, stateDir } = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  if (stateDir) { env.NAPKIN_STATE_DIR = stateDir; env.XDG_STATE_HOME = stateDir; } // keep napkin's own state out of the user's home during a bench
  const t0 = performance.now();
  const proc = spawn(process.execPath, [ENGINE, 'open', folder, '--port', String(port)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '', exited = null;
  proc.stdout.on('data', (b) => { log = (log + b).slice(-8000); });
  proc.stderr.on('data', (b) => { log = (log + b).slice(-8000); });
  proc.on('exit', (code, sig) => { exited = { code, sig }; });
  const stop = async () => {
    if (exited) return;
    try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
    for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    if (!exited) { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} await sleep(100); }
  };
  let last = 'no answer';
  while (performance.now() - t0 < timeout) {
    if (exited) return { ok: false, base, port, stop, log, error: `napkin exited (code ${exited.code}${exited.sig ? ', ' + exited.sig : ''}) before GET /api/files answered. Output: ${tail(log)}` };
    try {
      const r = await fetch(base + '/api/files');
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      if (r.status === 200 && j && Array.isArray(j.files)) return { ok: true, base, port, stop, ms: performance.now() - t0, log: () => log, files: j.files };
      last = `GET /api/files -> ${r.status} ${text.slice(0, 160)}`;
      if (r.status !== 503) break; // the server is up but does not implement the contract
    } catch (e) { last = e.cause?.code || e.message; }
    await sleep(25);
  }
  return { ok: false, base, port, stop, log, error: `GET /api/files never returned { files: [...] } (${last}). Output: ${tail(log)}` };
}
const tail = (s) => String(typeof s === 'function' ? s() : s).trim().split('\n').slice(-3).join(' | ').slice(0, 400) || '(none)';

// One contract call. Returns { status, json, text }. If the engine answers 401 (it wants an identity), the harness
// asks for one once with POST /api/session { as: 'napkin-bench' } and retries: that handshake is not in the contract
// (see bench/README.md); it is tolerated, never required.
const tokens = new Map();
export async function call(base, method, path, body) {
  const go = async () => {
    const headers = { 'content-type': 'application/json' };
    if (tokens.get(base)) headers.authorization = `Bearer ${tokens.get(base)}`;
    try {
      const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
      return { status: r.status, json, text };
    } catch (e) { return { status: 0, json: null, text: e.cause?.code || e.message }; }
  };
  let r = await go();
  if (r.status === 401 && !tokens.has(base)) {
    const s = await fetch(base + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'napkin-bench' }) }).then((x) => x.json()).catch(() => null);
    tokens.set(base, s?.token || null);
    if (s?.token) r = await go();
  }
  return r;
}
export const brief = (r) => `${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : String(r.text).slice(0, 200)}`;

// GET /api/files, validated against the contract shape.
export async function listFiles(base) {
  const r = await call(base, 'GET', '/api/files');
  if (r.status !== 200 || !Array.isArray(r.json?.files)) return { ok: false, error: `GET /api/files -> ${brief(r)}` };
  const bad = r.json.files.find((f) => typeof f?.path !== 'string' || !['html', 'tsx', 'jsx', 'css'].includes(f.kind) || !Array.isArray(f.components) || f.components.some((c) => typeof c?.id !== 'string' || typeof c?.name !== 'string'));
  if (bad) return { ok: false, error: `GET /api/files: an entry breaks the contract shape: ${JSON.stringify(bad).slice(0, 200)}` };
  return { ok: true, files: r.json.files };
}
// GET /api/component/<id> -> { revision, tree }. Nodes are flattened for lookup by byte offset.
export async function getComponent(base, id) {
  const r = await call(base, 'GET', `/api/component/${encodeURIComponent(id)}`);
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.tree)) return { ok: false, error: `GET /api/component/${id} -> ${brief(r)}` };
  const flat = [];
  const visit = (n, parent) => { if (!n || typeof n !== 'object') return; flat.push({ ...n, parent }); for (const c of n.children || []) visit(c, n); };
  for (const n of r.json.tree) visit(n, null);
  return { ok: true, revision: r.json.revision, tree: r.json.tree, flat };
}
export const viewPath = (id, width, theme) => `/view/${encodeURIComponent(id)}?width=${width}&theme=${theme}`;

// ---------- Chromium ----------
// One headless Chromium (CPU, no GPU, scrollbars hidden) with one page, driven over CDP. Started only through spawnChromium.
export async function launchBrowser() {
  const profile = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'napkin-p0-chrome-'));
  const proc = spawnChromium(['--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--allow-file-access-from-files', '--font-render-hinting=none', '--force-color-profile=srgb',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1280,900', 'about:blank']);
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) { proc.kill(); rmSync(profile, { recursive: true, force: true }); throw new Error('Chromium did not start (set CHROMIUM to its path)'); }
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`CDP ${method} timed out`)); } }, ms);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Animation.enable');
  const evalJs = async (expression, ms) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, ms);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Load url at width x VIEW_H in the given colour scheme, with animations frozen at their start. `inject` (file URLs)
  // become <link rel=stylesheet> elements placed first in <head> before the page is measured (the reference side's
  // applied stylesheets). Then the page is resized to its own height (capped) and captured.
  // Returns { ok, png, width, height, errors, ms, error }.
  async function shoot(url, { width, theme = 'light', inject = [], beforeLoad } = {}) {
    const errors = [];
    const onEv = (m) => {
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || m.params.exceptionDetails.text);
    };
    listeners.add(onEv);
    const t0 = performance.now();
    try {
      await send('Page.navigate', { url: 'about:blank' });
      await send('Emulation.setDeviceMetricsOverride', { width, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await send('Animation.setPlaybackRate', { playbackRate: 0 });
      if (beforeLoad) await beforeLoad();
      const loaded = new Promise((res) => { const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.delete(l); res(true); } }; listeners.add(l); setTimeout(() => { listeners.delete(l); res(false); }, 20000); });
      const nav = await send('Page.navigate', { url });
      if (nav.errorText) return { ok: false, error: `navigation failed: ${nav.errorText}`, errors };
      if (!(await loaded)) return { ok: false, error: 'the page did not finish loading in 20 s', errors };
      if (inject.length) {
        await evalJs(`Promise.all(${JSON.stringify(inject)}.reverse().map((href) => new Promise((res) => {
          const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = l.onerror = res;
          const head = document.head || document.documentElement.insertBefore(document.createElement('head'), document.documentElement.firstChild);
          head.insertBefore(l, head.firstChild);
        })))`, 20000);
      }
      await settle();
      const h = await evalJs(`Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 1)`);
      const height = Math.min(Math.ceil(h), MAX_H);
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await settle();
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 60000);
      return { ok: true, png: Buffer.from(shot.data, 'base64'), width, height, errors, ms: performance.now() - t0 };
    } catch (e) {
      return { ok: false, error: e.message, errors };
    } finally { listeners.delete(onEv); }
  }
  // Fonts (every same-origin frame), images, then two animation frames.
  const settle = () => evalJs(`(async () => {
    const docs = [document]; for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch {} }
    await Promise.race([Promise.all(docs.map((d) => d.fonts ? d.fonts.ready : null)), new Promise((r) => setTimeout(r, 10000))]);
    await Promise.race([Promise.all(docs.flatMap((d) => [...d.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))), new Promise((r) => setTimeout(r, 10000))]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true; })()`, 30000);
  const close = async () => { try { ws.close(); } catch {} proc.kill('SIGTERM'); await sleep(300); rmSync(profile, { recursive: true, force: true }); };
  return { send, eval: evalJs, shoot, close };
}

// ---------- PNG decode and diff (no dependencies; Chromium writes 8-bit RGB/RGBA, non-interlaced) ----------
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width, height, depth, type, interlace; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const kind = buf.toString('latin1', off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type) || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4), line = Buffer.alloc(stride); let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) { const o = (y * width + x) * 4; out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2]; out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255; }
    prev = Buffer.from(line);
  }
  return { width, height, data: out };
}
// Pixels whose largest channel difference is more than TOL. Images of different sizes are compared over the larger
// size, and every pixel only one image covers counts as differing.
export function diffPng(pa, pb) {
  const a = decodePng(pa), b = decodePng(pb);
  const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= a.width || y >= a.height || x >= b.width || y >= b.height) { n++; continue; }
    const i = (y * a.width + x) * 4, j = (y * b.width + x) * 4;
    if (Math.max(Math.abs(a.data[i] - b.data[j]), Math.abs(a.data[i + 1] - b.data[j + 1]), Math.abs(a.data[i + 2] - b.data[j + 2]), Math.abs(a.data[i + 3] - b.data[j + 3])) > TOL) n++;
  }
  return { differing: n, total: w * h, ratio: n / (w * h), sizes: [a.width, a.height, b.width, b.height] };
}

// ---------- reference renders (the "opened directly in Chromium" side) ----------
// HTML: the file's own file:// URL, with the folder's applied stylesheets placed first in <head>.
// TSX/JSX: there is no "open directly" for TSX, so the reference is a plain React page: <!doctype html>, a UTF-8 meta,
// the applied stylesheets, <div id="root">, and the named export (or default) rendered with no props by React's
// createRoot, built by esbuild with the folder's own node_modules first. No other CSS (the browser's default
// 8 px body margin stays). A render error makes the component "no reference" with the reason.
export async function tsxReference(file, name, folder, outDir, applied) {
  const { build } = await import(join(ROOT, 'node_modules/esbuild/lib/main.js'));
  mkdirSync(outDir, { recursive: true });
  const modDir = existsSync(join(folder, 'node_modules/react')) ? join(folder, 'node_modules') : join(ROOT, 'node_modules');
  const entry = join(outDir, 'entry.jsx');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(entry, `import * as M from ${JSON.stringify(file)};
import { createElement, Component } from 'react';
import { createRoot } from 'react-dom/client';
const C = M[${JSON.stringify(name)}] ?? M.default;
class Guard extends Component { constructor(p) { super(p); this.state = { e: null }; } static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e) { window.__refError = String(e && e.message || e); } render() { return this.state.e ? null : this.props.children; } }
if (typeof C !== 'function' && !(C && typeof C === 'object' && C.$$typeof)) window.__refError = 'no export named ' + ${JSON.stringify(name)};
else createRoot(document.getElementById('root')).render(createElement(Guard, null, createElement(C)));
`);
  try {
    await build({ entryPoints: [entry], bundle: true, format: 'iife', jsx: 'automatic', outfile: join(outDir, 'bundle.js'), logLevel: 'silent',
      nodePaths: [join(folder, 'node_modules'), join(ROOT, 'node_modules')],
      alias: { react: join(modDir, 'react'), 'react-dom': join(modDir, 'react-dom') },
      define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.svg': 'dataurl', '.png': 'dataurl' } });
  } catch (e) { return { ok: false, error: `reference build failed: ${(e.errors?.[0]?.text || e.message).slice(0, 200)}` }; }
  const links = applied.map((p) => `<link rel="stylesheet" href="${'file://' + join(folder, p)}">`).join('');
  writeFileSync(join(outDir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${links}</head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);
  return { ok: true, url: 'file://' + join(outDir, 'index.html') };
}

// ---------- byte-level source helpers (offsets are bytes; strings are read as latin1 so 1 char = 1 byte) ----------
export const L = (buf) => buf.toString('latin1');
export const toL = (utf8) => Buffer.from(utf8, 'utf8').toString('latin1');
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'template']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param']);
// End of the start tag that begins at `at` (index just past '>'), skipping quoted values and {...} JSX expressions.
export function tagEnd(s, at) {
  let i = at + 1, q = null, depth = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; continue; }
    if (depth) { if (ch === '{') depth++; else if (ch === '}') depth--; else if (ch === '"' || ch === "'" || ch === '`') q = ch; continue; }
    if (ch === '"' || ch === "'") q = ch; else if (ch === '{') depth = 1; else if (ch === '>') return i + 1;
  }
  return -1;
}
export const tagName = (s, at) => /^<([A-Za-z][\w:.-]*)/.exec(s.slice(at, at + 80))?.[1] || null;
// The element that starts at byte `at`: { start, openEnd, closeStart, end, tag }.
export function element(s, at) {
  const tag = tagName(s, at); if (!tag) throw new Error(`no start tag at byte ${at}`);
  const openEnd = tagEnd(s, at);
  if (s[openEnd - 2] === '/' || VOID.has(tag.toLowerCase())) return { start: at, openEnd, closeStart: openEnd, end: openEnd, tag };
  const lower = tag.toLowerCase(); let depth = 1, i = openEnd;
  const re = new RegExp(`<!--|<(/?)(${tag.replace(/[.]/g, '\\.')})(?=[\\s/>])`, 'gi');
  re.lastIndex = i;
  for (let m; (m = re.exec(s));) {
    if (m[0] === '<!--') { re.lastIndex = s.indexOf('-->', m.index) + 3; continue; }
    if (m[2].toLowerCase() !== lower) continue;
    if (m[1]) { if (--depth === 0) return { start: at, openEnd, closeStart: m.index, end: s.indexOf('>', m.index) + 1, tag }; }
    else { const e = tagEnd(s, m.index); if (s[e - 2] !== '/') depth++; re.lastIndex = e; }
  }
  throw new Error(`no end for <${tag}> at byte ${at}`);
}
// Start offsets of every element a person could select in an HTML file: start tags inside <body> (or the whole file
// when there is no <body> tag), not counting script/style/template and not counting anything inside raw-text elements.
export function selectableStarts(buf) {
  const s = L(buf); const out = []; let i = 0, inBody = !/<body[\s>]/i.test(s);
  while (i < s.length) {
    const lt = s.indexOf('<', i); if (lt < 0) break;
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { i = s.indexOf('>', lt) + 1 || s.length; continue; }
    if (s[lt + 1] === '/') { if (/^<\/body[\s>]/i.test(s.slice(lt, lt + 8))) inBody = false; i = s.indexOf('>', lt) + 1 || s.length; continue; }
    const tag = tagName(s, lt); if (!tag) { i = lt + 1; continue; }
    const end = tagEnd(s, lt); if (end < 0) break;
    const lower = tag.toLowerCase();
    if (lower === 'body') inBody = true;
    else if (inBody && !['script', 'style', 'template', 'html', 'head', 'meta', 'link', 'title', 'base'].includes(lower)) out.push({ start: lt, tag });
    i = end;
    if (RAW.has(lower)) { const c = s.toLowerCase().indexOf(`</${lower}`, end); i = c < 0 ? s.length : c; }
  }
  return out;
}

// ---------- git (only inside corpus copies the harness made) ----------
export function git(dir, ...args) { return execFileSync('git', ['-c', 'user.name=napkin-bench', '-c', 'user.email=bench@napkin.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' }); }
export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
