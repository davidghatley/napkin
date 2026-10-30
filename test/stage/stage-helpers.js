// Shared by the stage journey tests: a small design-system folder (tokens, components, three HTML previews, one animated, one
// dark theme, @media breakpoints), a server for it, and a headless Chromium on the canvas.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from '../helpers/open.js';
import { launchChromium } from '../helpers/cdp.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const TOKENS = `:root { --ink: #1a1a1a; --paper: #fbfaf6; --accent: #3459e2; --track: .14em; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --ink: #ece9e0; --paper: #15171c; } }
[data-theme="sepia"] { --paper: #f1e4c3; --ink: #3b2a14; }
`;
export const COMPONENTS = `body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.4 system-ui, sans-serif; }
.label { font: 500 11px/16px monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--ink); }
.card { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 16px; background: var(--paper); }
.btn { padding: 6px 12px; border: 1px solid var(--ink); background: transparent; color: var(--ink); transition: background .05s; }
.btn:hover { background: var(--accent); color: #fff; }
.spinner { width: 20px; height: 20px; background: var(--ink); animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@media (max-width: 480px) { .card { grid-template-columns: 1fr; } }
@media (min-width: 800px) { .card { padding: 32px; } }
`;
const page = (body) => `<!doctype html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="../tokens.css"><link rel="stylesheet" href="../components.css"></head>\n<body>\n${body}\n</body></html>\n`;
export const FILES = {
  'tokens.css': TOKENS,
  'components.css': COMPONENTS,
  'Card/preview.html': page('<section class="card"><span class="label">Plate 4.1</span><span class="label">Target</span><button class="btn">Play</button></section>'),
  'Label/preview.html': page('<p class="label">One rule, every place</p>'),
  'Spinner/preview.html': page('<div class="spinner" id="spin"></div><span class="label">Loading</span>'),
};
export function folder(files = FILES) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-stage-'));
  for (const [p, text] of Object.entries(files)) { const f = join(dir, p); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); }
  return dir;
}
export async function open(files, { width = 1440, height = 900, scheme = 'light' } = {}) {
  const dir = folder(files);
  const server = await cli(dir);
  const b = await launchChromium({ width, height });
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 15000);
  await b.waitFor(`[...napkin.stage.sections.values()].every((s) => !s.docFrame || s.docFrame.iframe())`, 15000);
  const frameOf = (name) => `[...napkin.stage.sections.values()].find((s) => napkin.state.components.get([...napkin.stage.sections].find(([, x]) => x === s)[0])?.name === ${JSON.stringify(name)}).docFrame`;
  const id = (name) => b.eval(`napkin.find(${JSON.stringify(name)}).component`);
  return {
    dir, server, b, id, frameOf, sleep,
    // viewport centre of an element inside a frame
    async centre(name, sel) {
      return JSON.parse(await b.eval(`(() => { const f = ${frameOf(name)}, el = f.doc().querySelector(${JSON.stringify(sel)}); const r = el.getBoundingClientRect(), fr = f.iframe().getBoundingClientRect(), z = fr.width / f.iframe().offsetWidth; return JSON.stringify({ x: fr.left + (r.left + r.width / 2) * z, y: fr.top + (r.top + r.height / 2) * z }); })()`));
    },
    async mouse(type, x, y, extra = {}) { await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra }); },
    async key(type, key, code, extra = {}) { await b.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: extra.vk ?? key.toUpperCase().charCodeAt(0), ...extra }); },
    async close() { await b.close(); await server.stop(); },
  };
}
