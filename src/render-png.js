// render_component (AGT-02): one warm headless Chromium (CPU) draws a component's own bundle
// for one variant and returns a PNG of the component's root element. The page is a blank host;
// bundles are imported from blob URLs, so no web server is needed (works in the MCP fallback too).
import { explainError } from './errors.js';
import { spawnChromium } from './chromium.js';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { axes } from './model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The page rules a component inherits on the canvas (public/canvas/canvas.css): box model and the frame ink colour.
const HOST_CSS = '* { box-sizing: border-box; } body { color: #1c1f27; }'; // the canvas resets the font on .frame, so a component sees the browser defaults, as in an app
export class RenderError extends Error { constructor(message) { super(explainError(message, { next: "fix the named build or render problem and retry; set CHROMIUM if the browser could not start." })); } }

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'napkin-render-'));
  const proc = spawnChromium([
    '--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1600,1200', 'about:blank',
  ]);
  let dead = false; proc.on('exit', () => { dead = true; });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile) && !dead; i++) await sleep(100);
  if (!existsSync(portFile)) { rmSync(profile, { recursive: true, force: true }); throw new RenderError('could not start Chromium (set CHROMIUM to its path)'); }
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  let first = targets.find((t) => t.type === 'page');
  // One CDP connection per page; every page is a blank host with a transparent background.
  async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(explainError(msg.error.message))) : res(msg.result); }
    };
    ws.onclose = () => { dead = true; for (const { rej } of pending.values()) rej(new Error(explainError('browser closed'))); };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Runtime.evaluate', { expression: `document.head.insertAdjacentHTML('beforeend','<style>${HOST_CSS}</style>');document.body.innerHTML='<div id="m" style="position:absolute;left:16px;top:16px"></div>';document.body.style.margin='0';window.__mods=new Map();window.__un=null;true` });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new RenderError(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    return { send, evaluate, loaded: new Set(), close: () => { try { ws.close(); } catch {} } };
  }
  const pages = [];
  return {
    isDead: () => dead,
    async newPage() {
      // Each extra page gets its own window: a background tab would never fire animation frames.
      let url;
      if (first) { url = first.webSocketDebuggerUrl; first = null; }
      else {
        const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        const bws = new WebSocket(webSocketDebuggerUrl);
        await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
        const targetId = await new Promise((res, rej) => { bws.onmessage = (m) => { const j = JSON.parse(m.data); j.error ? rej(new Error(explainError(j.error.message))) : res(j.result.targetId); }; bws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true, width: 1600, height: 1200 } })); });
        bws.close();
        url = `ws://127.0.0.1:${port}/devtools/page/${targetId}`;
      }
      const p = await connect(url); pages.push(p); return p;
    },
    async close() { for (const p of pages) p.close(); proc.kill('SIGTERM'); await sleep(150); rmSync(profile, { recursive: true, force: true }); },
  };
}

// A small pool of pages in one warm Chromium, so concurrent renders do not queue behind each other.
export function createRenderer({ pages = Number(process.env.NAPKIN_RENDER_PAGES || 4) } = {}) {
  let browser = null, closed = false, made = 0;
  const idle = [], waiters = [];

  const getBrowser = async () => {
    if (closed) throw new RenderError('renderer is closed');
    if (browser) { try { const b = await browser; if (!b.isDead()) return b; } catch { browser = null; } idle.length = 0; made = 0; }
    browser = launch();
    try { return await browser; } catch (e) { browser = null; throw e; }
  };
  async function acquire() {
    const b = await getBrowser();
    if (idle.length) return idle.pop();
    if (made < pages) { made++; try { return await b.newPage(); } catch (e) { made--; throw e; } }
    return new Promise((res) => waiters.push(res));
  }
  const release = (page) => { const w = waiters.shift(); if (w) w(page); else idle.push(page); };

  // Every cell is drawn as a first paint (the page is blanked and painted empty first), because a repaint over an earlier cell rasterises
  // rounded corners with slightly different edge pixels than a fresh page does. A fresh app drawing the same cell matches byte for byte (INS-03).
  const draw = (page, job) => drawOnce(page, job);
  async function drawOnce(page, { key, code, variant }) {
    if (!page.loaded.has(key)) {
      await page.evaluate(`(async()=>{const u=URL.createObjectURL(new Blob([${JSON.stringify(code)}],{type:'text/javascript'}));window.__mods.set(${JSON.stringify(key)},await import(u));URL.revokeObjectURL(u);return true})()`);
      page.loaded.add(key);
    }
    const box = await page.evaluate(`(async()=>{
      if(window.__un){window.__un();window.__un=null}
      document.getElementById('m').replaceChildren(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); /* paint an empty page first: every cell is a first paint */
      const old=document.getElementById('m'); const el=document.createElement('div'); el.id='m'; el.setAttribute('style', old.getAttribute('style')); old.replaceWith(el); /* a new element each time: a clean raster, like a page that has drawn nothing else */
      window.__un=window.__mods.get(${JSON.stringify(key)}).mount(el, ${JSON.stringify(variant)});
      if(document.fonts&&document.fonts.ready) await document.fonts.ready;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const t=el.firstElementChild||el, r=t.getBoundingClientRect();
      return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height};
    })()`);
    const w = Math.max(1, Math.ceil(box.w)), h = Math.max(1, Math.ceil(box.h));
    const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: w, height: h, scale: 1 }, captureBeyondViewport: true });
    return Buffer.from(shot.data, 'base64');
  }

  return {
    // entry: a workspace entry; returns { png, ms }. variant: { axis: value }.
    async render(ws, entry, variant = {}) {
      const t0 = performance.now();
      try {
        const snap = await entry.store.read();
        for (const [axis, value] of Object.entries(variant)) {
          const a = (snap.doc ? axes(snap.doc) : []).find((x) => x.name === axis);
          if (!a) throw new RenderError(`no variant axis "${axis}" (axes: ${(snap.doc ? axes(snap.doc) : []).map((x) => x.name).join(', ') || 'none'})`);
          if (!a.options.includes(value)) throw new RenderError(`axis "${axis}" has no value "${value}" (values: ${a.options.join(', ')})`);
        }
        const built = await ws.bundle(entry);
        if (!built?.ok) throw new RenderError(`build failed: ${built?.error}`);
        const key = entry.id + ':' + createHash('sha1').update(built.code).digest('hex').slice(0, 12);
        const page = await acquire();
        try { const png = await draw(page, { key, code: built.code, variant }); return { png, ms: performance.now() - t0 }; }
        finally { release(page); }
      } catch (e) { throw new RenderError(explainError(e.message, { file: entry.path || entry.name + '.tsx' })); }
    },
    // Draw an arbitrary bundle (a past revision, or the file at HEAD) for one variant: -> { png, ms }.
    async renderCode(code, variant = {}) {
      const t0 = performance.now();
      const key = 'code:' + createHash('sha1').update(code).digest('hex').slice(0, 16);
      const page = await acquire();
      try { const png = await draw(page, { key, code, variant }); return { png, ms: performance.now() - t0 }; }
      finally { release(page); }
    },
    async warm() { await getBrowser(); },
    async close() { closed = true; if (browser) { const b = await browser.catch(() => null); await b?.close(); } },
  };
}
