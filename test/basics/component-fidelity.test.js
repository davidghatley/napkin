// Basics pass 3, Create component: the component looks the same as the selection did in its frame (standards section 9,
// rule 5). Measured in the browser, not by reading the CSS: the frame and the made component are each drawn by /view at
// the same width, and every element of the selection is compared property by property, with its rendered text.
// The frames are written to be hard: selectors that name ancestors outside the selection, custom properties defined in
// terms of others, a responsive rule on an ancestor, a native button and a monospace block as the selection's root,
// white space at inline element edges, and images referenced from the frame and from a stylesheet in another folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const AUDIT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>audit</title><link rel="stylesheet" href="styles/audit.css"><style>
:root { --brand: var(--blue); --blue: #245fdb; }
body { margin: 0; padding: 24px; background: #eef2f8; font: 16px/1.5 Arial; color: #17243a; }
.shell { display: grid; grid-template-columns: 1fr; gap: 24px; }
.shell > .offer { padding: 20px; border: 2px solid #245fdb; background: white; max-width: 360px; }
.shell .offer h2 { font-size: 24px; margin: 0 0 12px; }
.offer { border-radius: 12px; color: var(--brand); }
.offer::before { content: 'FEATURED'; display: block; font-size: 11px; letter-spacing: 2px; background: #dbe8ff; }
.offer:hover { box-shadow: 0 0 0 4px orange; }
.offer .pill { display: inline-block; background: var(--brand); color: white; padding: 4px 8px; }
.offer img { width: 100%; height: 48px; object-fit: cover; }
</style></head><body><main class="shell"><article class="offer card" id="offer"><h2>Expedition kit</h2><p>A card with contextual selectors.</p><img src="assets/dot.png" alt="Dot"><a class="pill" href="#details">View details</a></article><div class="bgimage">From a stylesheet</div></main></body></html>
`;
const AUDIT_CSS = `.bgimage { width: 320px; height: 100px; background: url('../assets/dot.png') center / cover; color: white; }
@media (min-width: 300px) { .offer .pill { border: 2px solid #18233b; } }
`;
const RECEIPT = `<!doctype html><html><head><title>Receipt</title><style>
:root { --ink: #293752; }
body { margin: 0; padding: 32px; background: #f4f6fa; font: 16px/1.5 Georgia, serif; color: var(--ink); }
.receipt { width: 400px; padding: 24px; background: white; }
.codeblock { white-space: pre-wrap; padding: 16px; background: #edf1f8; }
@media (min-width: 500px) { body { font-size: 20px; color: #8f2259; } }
.download { background: #245fdb; color: white; border: 0; padding: 8px 16px; border-radius: 4px; }
</style></head><body><article class="receipt"><p class="salutation">Hello<strong> David </strong>— your order is confirmed.</p><pre class="codeblock">Line one
    Indented {items}</pre><button class="download">Download invoice</button></article></body></html>
`;
// a 2x2 PNG, so an image that loads has a natural width
const DOT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

let r, server, b, io;
const file = (name) => join(r.compDir, name);
const q = (e) => b.eval(e);
const json = async (e) => JSON.parse(await q(`Promise.resolve(${e}).then((v) => JSON.stringify(v ?? null))`));
const until = (fn, ms = 15000) => waitFor(fn, ms, 50);
const hint = () => q(`document.querySelector('#hint').textContent`);

// the element of a frame with this class, by its node id (from the server's tree of the file)
const nodeOf = (frame, cls) => json(`fetch('/api/component/${frame}').then((x) => x.json()).then((d) => { const walk = (l) => { for (const n of l || []) { if (String(n.attrs?.class || '').split(/\\s+/).includes('${cls}')) return String(n.node); const f = walk(n.children); if (f) return f; } return null; }; return walk(d.tree); })`);
async function make(frame, cls) {
  const node = await nodeOf(frame, cls);
  assert.ok(node, `${cls} is in ${frame}`);
  await q(`document.activeElement?.blur?.(); napkin.select({ component: '${frame}', node: '${node}', variant: {} }); 0`);
  await sleep(150);
  await io.key('k', { ctrl: true, alt: true });
}
// Draw a document with /view at a width and read what a person sees of the element `sel` and everything inside it.
const PROPS = ['display', 'color', 'backgroundColor', 'backgroundImage', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'whiteSpace', 'textAlign',
  'paddingTop', 'paddingLeft', 'marginTop', 'marginBottom', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius', 'objectFit', 'maxWidth'];
const seen = (id, sel, container = 0) => json(`(async () => {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:700px;border:0;opacity:0;pointer-events:none;z-index:-1';
  await new Promise((res) => { f.addEventListener('load', res, { once: true }); f.src = '/view/' + encodeURIComponent(${JSON.stringify(id)}) + '?width=800'; document.body.append(f); });
  const d = f.contentDocument; const t0 = performance.now();
  while (!d.querySelector(${JSON.stringify(sel)}) && performance.now() - t0 < 8000) await new Promise((x) => setTimeout(x, 50));
  const root = d.querySelector(${JSON.stringify(sel)});
  // the component sizes to where it is used: give it the box its parent gave it in the frame
  if (${container}) d.getElementById('root').style.width = ${container} + 'px';
  const box = (p) => { const s = f.contentWindow.getComputedStyle(p); return Math.round(p.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth)); };
  let host = root.parentElement; while (host && f.contentWindow.getComputedStyle(host).display === 'contents') host = host.parentElement;
  await Promise.all([...root.querySelectorAll('img'), ...(root.tagName === 'IMG' ? [root] : [])].map((i) => i.decode().catch(() => null)));
  await d.fonts?.ready; await new Promise((x) => setTimeout(x, 100));
  const pick = (el, pseudo) => { const s = f.contentWindow.getComputedStyle(el, pseudo); const o = { tag: el.tagName }; for (const k of ${JSON.stringify(PROPS)}) o[k] = s[k]; if (pseudo) o.content = s.content; else { const r = el.getBoundingClientRect(); o.w = Math.round(r.width); o.h = Math.round(r.height); o.text = el.innerText; } if (el.tagName === 'IMG') o.natural = el.naturalWidth; return o; };
  const out = [pick(root), pick(root, '::before'), ...[...root.querySelectorAll('*')].map((e) => pick(e))];
  const container = box(host);
  f.remove();
  return { out, container };
})()`);

before(async () => {
  r = tempRepo(['Button']);
  mkdirSync(file('styles')); mkdirSync(file('assets'));
  writeFileSync(file('audit.html'), AUDIT);
  writeFileSync(file('styles/audit.css'), AUDIT_CSS);
  writeFileSync(file('receipt.html'), RECEIPT);
  writeFileSync(file('assets/dot.png'), DOT);
  server = await startServer(r.compDir, { timeout: 20000, env: { NAPKIN_ALL_KINDS: '0' } });
  b = await launchChromium({ width: 1440, height: 900 });
  io = input(b);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="audit.html"]')?.dataset.ready && !!document.querySelector('section.cmp[data-component="receipt.html"]')?.dataset.ready`, 20000);
  await sleep(400);
});
after(async () => { await b?.close(); await server?.stop(); rmSync(r.dir, { recursive: true, force: true }); });

async function same(frame, cls, name) {
  await make(frame, cls);
  await until(() => existsSync(file(`${name}.tsx`)));
  await until(async () => (await q(`String([...napkin.state.components.values()].some((c) => c.path === '${name}.tsx'))`)) === 'true' || null);
  const was = await seen(frame, `.${cls}`), is = await seen(`${name}.tsx#${name}`, `.${cls}`, was.container);
  return { was: was.out, is: is.out, src: readFileSync(file(`${name}.tsx`), 'utf8') };
}

test('basics pass 3: selectors that name ancestors outside the selection still reach it, custom properties resolve through each other, images still load', { timeout: 90000 }, async () => {
  const { was, is, src } = await same('audit.html', 'offer', 'Offer');
  assert.equal(was[0].w, 404, 'the frame draws the card 360 wide plus padding and border (.shell > .offer)');
  assert.equal(was[0].borderTopWidth, '2px');
  assert.equal(was[0].color, 'rgb(36, 95, 219)', '--brand is var(--blue)');
  assert.ok(was.find((e) => e.tag === 'IMG').natural > 0, 'the image loads in the frame');
  assert.deepEqual(is, was);
  assert.match(src, /:hover/, 'a hover rule on the selection comes along too');
  assert.equal(readFileSync(file('audit.html'), 'utf8'), AUDIT, 'the frame is untouched');
});

test('basics pass 3: an image from a stylesheet in another folder still loads from the component', { timeout: 90000 }, async () => {
  const { was, is, src } = await same('audit.html', 'bgimage', 'Bgimage');
  assert.match(was[0].backgroundImage, /\/raw\/assets\/dot\.png/);
  assert.deepEqual(is, was);
  assert.match(src, /url\(['"]?assets\/dot\.png/, 'the url is rebased to the component file');
});

test('basics pass 3: white space at the edges of inline elements reads the same', { timeout: 90000 }, async () => {
  const { was, is, src } = await same('receipt.html', 'salutation', 'Salutation');
  assert.equal(was[0].text, 'Hello David — your order is confirmed.');
  assert.deepEqual(is, was);
  assert.doesNotMatch(src, /HelloDavid/);
});

test('basics pass 3: a native button and a monospace block keep their own type; responsive type from an ancestor comes along', { timeout: 90000 }, async () => {
  const btn = await same('receipt.html', 'download', 'Download');
  assert.notEqual(btn.was[0].fontFamily, 'Georgia, serif', 'the button draws in its native font in the frame');
  assert.deepEqual(btn.is, btn.was);
  const pre = await same('receipt.html', 'codeblock', 'Codeblock');
  assert.equal(pre.was[0].fontFamily, 'monospace');
  assert.equal(pre.was[0].color, 'rgb(143, 34, 89)', 'at 800 wide the @media rule on body colours it');
  assert.deepEqual(pre.is, pre.was);
});

test('basics pass 3: a selected frame card is refused with the whole-frame sentence and nothing is made', { timeout: 60000 }, async () => {
  const count = () => readdirSync(r.compDir).filter((n) => n.endsWith('.tsx')).length;
  const n = count();
  const shell = await nodeOf('audit.html', 'shell');
  await q(`document.activeElement?.blur?.(); napkin.select({ component: 'audit.html', node: '${shell}', variant: {}, card: true }); 0`);
  await sleep(150);
  await io.key('k', { ctrl: true, alt: true });
  await until(async () => /the whole frame cannot be a component/.test(await hint()) || null);
  await sleep(500);
  assert.equal(count(), n);
  assert.equal(existsSync(file('Shell.tsx')), false);
});

test('basics pass 3: Create component is one command: one palette entry, the key and the menu run the same id', { timeout: 60000 }, async () => {
  const found = await json(`(async () => { const { ACTIONS } = await import('/canvas/actions.js'); return ACTIONS.filter((a) => /create component/i.test(a.label + ' ' + (a.phrase || ''))).map((a) => ({ id: a.id, keys: a.keys || a.key })); })()`);
  assert.deepEqual(found, [{ id: 'make-component', keys: 'Ctrl+Alt+K' }]);
  const menu = await q(`fetch('/canvas/context-menu.js').then((x) => x.text())`);
  assert.match(menu, /'make-component'/, 'the right-click menu lists the same command');
  assert.doesNotMatch(menu, /'create-component'/);
  await q(`document.activeElement?.blur?.(); 0`);
  await io.key('k', { ctrl: true });
  await b.waitFor(`document.activeElement?.closest?.('[role=dialog], #quick') != null`, 5000);
  await q(`document.execCommand('insertText', false, 'Create component')`);
  await sleep(300);
  const rows = await json(`[...document.querySelectorAll('#quick [role=option], #quick li')].filter((e) => e.getClientRects().length && /create component/i.test(e.textContent)).map((e) => e.textContent.trim())`);
  assert.equal(rows.length, 1, `one palette row for Create component: ${JSON.stringify(rows)}`);
  await io.key('Escape');
});
