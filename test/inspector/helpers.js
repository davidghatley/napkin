// A running napkin on a small HTML design-system folder and a headless Chromium on its canvas, for the inspector's journeys.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { cli } from '../helpers/open.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

// tokens.css, components.css and two previews that share them, in the shape of a real design-system folder.
export const FILES = {
  'tokens.css': `:root {
  --paper: #eeede7;
  --ink: #16181d;
  --vermilion: #ee5228;
  --on-vermilion: #16181d;
  --cobalt: #2236b0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius-1: 2px;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --type-body: 400 16px/24px system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #121417; --ink: #ecebe4; }
}
`,
  'components.css': `body { margin: 0; background: var(--paper); color: var(--ink); font: var(--type-body); }
.ss-note { border: 1px solid var(--ink); background: var(--paper); margin-bottom: var(--space-3); }
.ss-note__tag { display: block; padding: var(--space-1) var(--space-3); background: var(--ink); color: var(--paper); font: 600 11px/16px var(--font-mono); letter-spacing: .14em; text-transform: uppercase; }
.ss-note--rule .ss-note__tag { background: var(--vermilion); color: var(--on-vermilion); }
.ss-note__body { padding: 13px; font-size: 16px; line-height: 24px; }
.ss-pill { display: inline-block; padding: 2px 6px; border: 1px solid var(--cobalt); color: var(--cobalt); }
.ss-row { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-2); margin: var(--space-4) 0; }
.ss-faint { margin: 0; color: #aaaaaa; }
`,
  'Note/preview.html': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Note preview</title>
<link rel="stylesheet" href="../components.css">
</head>
<body>
<div class="ss-note ss-note--rule"><span class="ss-note__tag">Rule</span><div class="ss-note__body">Every repo starts with a one-page INTENT.md before any agent runs.</div></div>
<div class="ss-note ss-note--verify"><span class="ss-note__tag">Verify</span><div class="ss-note__body">A decision only David can make.</div></div>
<div class="ss-note ss-note--trap"><span class="ss-note__tag">Pitfall</span><div class="ss-note__body">A known way this plan fails.</div></div>
</body>
</html>
`,
  'Pill/preview.html': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pill preview</title>
<link rel="stylesheet" href="../components.css">
</head>
<body>
<div class="ss-row"><span class="ss-pill">Shipped</span><a href="#x">A link</a><button type="button">Go</button><button type="button" tabindex="1">First</button></div>
<p class="ss-faint">Faint words</p>
</body>
</html>
`,
};

export function writeFolder(files = FILES) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-insp-'));
  for (const [p, t] of Object.entries(files)) { mkdirSync(join(dir, dirname(p)), { recursive: true }); writeFileSync(join(dir, p), t); }
  return dir;
}
export const readAll = (dir) => { const out = {}; (function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[p.slice(dir.length + 1)] = readFileSync(p, 'utf8'); } })(dir); return out; };
// the lines that differ between two texts, as [-old, +new] pairs in order
export const lineDiff = (a, b) => { const A = a.split('\n'), B = b.split('\n'), out = []; for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) out.push([A[i], B[i]]); return out; };

export async function open({ files = FILES, dir = writeFolder(files), width = 1440, height = 900, theme, apply = ['tokens.css', 'components.css'] } = {}) {
  const app = await cli(dir);
  const browser = await launchChromium({ width, height });
  if (theme) await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // a page in a window nobody focuses still gets focus events
  await browser.goto(app.url);
  await browser.waitFor('document.body.dataset.ready === "1"');
  const q = (e) => browser.eval(e);
  await sleep(300);
  // the "ask once" question (when the folder's components use variables nothing they load defines): apply the shared sheets
  if (await q(`!!document.querySelector('#ask-styles')`)) {
    await q(`(() => { for (const i of document.querySelectorAll('#ask-styles input[type=checkbox]')) i.checked = ${JSON.stringify(apply)}.includes(i.value); document.querySelector('#ask-styles-apply').click(); })()`);
    await browser.waitFor(`!document.querySelector('#ask-styles')`);
  }
  await browser.waitFor(`document.querySelectorAll('.doc-frame').length >= ${Object.keys(files).filter((f) => f.endsWith('.html')).length}`, 15000);
  await sleep(500);
  const api = {
    app, dir, browser, q, io: input(browser), sleep,
    file: (p) => readFileSync(join(dir, p), 'utf8'),
    // the node id of the first element of a component matching a predicate over its tree node
    async node(component, pred) {
      const t = await (await fetch(`${app.url}api/component/${encodeURIComponent(component)}`)).json();
      const walk = (ns) => { for (const n of ns) { if (pred(n)) return n; const f = walk(n.children); if (f) return f; } return null; };
      return walk(t.tree);
    },
    async select(component, node) {
      await q(`napkin.select({ component: ${JSON.stringify(component)}, node: ${JSON.stringify(node)}, variant: {} })`);
      await browser.waitFor(`!!napkin.inspector && !!document.querySelector('#panel .doc-body[data-node="${node}"]')`);
      await sleep(250);
    },
    // type into a value field like a person (focus, select all, insert text); does not leave the field. A typed value is written to
    // the element on commit; these tests are about where else it can go, so the scope chooser is opened on it (at its suggested scope).
    async typeIn(selector, text, { choose = true } = {}) {
      await q(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select(); })()`);
      await browser.send('Input.insertText', { text });
      if (choose) await q(`napkin.inspector?.choose?.()`);
      await sleep(120);
    },
    async center(selector) { return JSON.parse(await q(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`)); },
    // the page position of an element inside a component's frame
    async pagePoint(component, node) { return JSON.parse(await q(`JSON.stringify((() => { const r = napkin.stage.sections.get(${JSON.stringify(component)}).docFrame.element(${JSON.stringify(node)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`)); },
    async close() { await browser.close(); await app.stop(); },
  };
  return api;
}
