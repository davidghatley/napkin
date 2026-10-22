// Minimal headless-Chromium driver over the DevTools protocol. No dependencies:
// uses Node's built-in WebSocket client. CPU only (--disable-gpu) unless NAPKIN_GPU is set (GPU raster; flags in NAPKIN_GPU_FLAGS).
import { spawnChromium } from '../../src/chromium.js';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChromium({ width = 1100, height = 700 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'napkin-chrome-'));
  const proc = spawnChromium([
    '--headless=new', ...(process.env.NAPKIN_GPU ? (process.env.NAPKIN_GPU_FLAGS || '--enable-gpu-rasterization --ignore-gpu-blocklist --use-angle=gl --use-gl=angle').split(' ') : ['--disable-gpu', '--use-angle=swiftshader']), '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${width},${height}`, 'about:blank',
  ]);
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  // the window size includes browser chrome; pin the page itself to width x height so screenshots and layouts are exact
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const consoleLines = [];
  listeners.push((m) => { if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); });
  const api = {
    send, consoleLines,
    // GPU feature status as the browser reports it (chrome://gpu): needs the browser target, not the page's.
    async gpuInfo() {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const w = new WebSocket(v.webSocketDebuggerUrl); await new Promise((res, rej) => { w.onopen = res; w.onerror = rej; });
      try { return await new Promise((res, rej) => { w.onmessage = (m) => { const d = JSON.parse(m.data); d.error ? rej(new Error(d.error.message)) : res(d.result); }; w.send(JSON.stringify({ id: 1, method: 'SystemInfo.getInfo' })); }); } finally { w.close(); }
    },
    onEvent(cb) { listeners.push(cb); return () => listeners.splice(listeners.indexOf(cb), 1); },
    async goto(url) { await send('Page.navigate', { url }); await api.waitFor('document.readyState === "complete"'); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; },
    async waitFor(expr, timeout = 5000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await api.eval(expr)) return Date.now() - t0; } catch {} await sleep(25); } throw new Error(`timed out waiting for: ${expr}`); },
    // Type into an input like a person: focus, select all, type, then Tab away (fires change).
    async type(selector, text) {
      await api.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
      await api.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select(); return true})()`);
      await send('Input.insertText', { text });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    },
    async screenshot() { const r = await send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(r.data, 'base64'); },
    async close() { try { ws.close(); } catch {} proc.kill('SIGTERM'); await sleep(200); rmSync(profile, { recursive: true, force: true }); },
  };
  return api;
}
