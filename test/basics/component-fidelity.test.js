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
async function make(frame, cls, pick = (n) => n) {
  const node = pick(await nodeOf(frame, cls));
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
  // an audit's page (test/fixtures/component): an ancestor's hover, a positional rule, pre-wrap copy, a grid-sized card
  writeFileSync(file('journey.html'), readFileSync(new URL('../fixtures/component/journey.html', import.meta.url)));
  writeFileSync(file('styles/journey.css'), readFileSync(new URL('../fixtures/component/styles/journey.css', import.meta.url)));
  writeFileSync(file('assets/landscape.png'), DOT);
  server = await startServer(r.compDir, { timeout: 20000, env: { NAPKIN_ALL_KINDS: '0' } });
  b = await launchChromium({ width: 1440, height: 900 });
  io = input(b);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="audit.html"]')?.dataset.ready && !!document.querySelector('section.cmp[data-component="receipt.html"]')?.dataset.ready && !!document.querySelector('section.cmp[data-component="journey.html"]')?.dataset.ready`, 20000);
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

// the made component drawn by /view, with the elements of a page that uses it beside it: what each looks like
const drawn = (id, sel, host = '') => json(`(async () => {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:700px;border:0;opacity:0;pointer-events:none;z-index:-1';
  await new Promise((res) => { f.addEventListener('load', res, { once: true }); f.src = '/view/' + encodeURIComponent(${JSON.stringify(id)}) + '?width=800'; document.body.append(f); });
  const d = f.contentDocument; const t0 = performance.now();
  while (!d.querySelector(${JSON.stringify(sel)}) && performance.now() - t0 < 8000) await new Promise((x) => setTimeout(x, 50));
  const box = d.createElement('div'); box.id = 'host'; box.innerHTML = ${JSON.stringify(host)}; d.body.append(box);
  await new Promise((x) => setTimeout(x, 100));
  const pick = (el) => { const s = f.contentWindow.getComputedStyle(el); const r = el.getBoundingClientRect(); return { display: s.display, color: s.color, fontWeight: s.fontWeight, backgroundColor: s.backgroundColor, padding: s.padding, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, text: el.innerText }; };
  const out = { root: pick(d.querySelector(${JSON.stringify(sel)})), host: [...box.querySelectorAll('span, section')].map(pick) };
  f.remove(); return out;
})()`);
const madeAs = async (name) => { await until(() => existsSync(file(`${name}.tsx`))); await until(async () => (await q(`String([...napkin.state.components.values()].some((c) => c.path === '${name}.tsx'))`)) === 'true' || null); return `${name}.tsx#${name}`; };

test('basics pass 3: a hover on an ancestor outside stays a hover, a positional rule keeps its look, and no rule reaches the page around the component', { timeout: 120000 }, async () => {
  await make('journey.html', 'weather');
  const weather = await drawn(await madeAs('Weather'), '.weather');
  assert.equal(weather.root.backgroundColor, 'rgb(255, 255, 255)', 'at rest the forecast is white, as in the frame (.shell:hover .weather is a hover)');
  // the first span of the forecast: :nth-child(2) of its section in the frame, red and bold
  const forecast = await nodeOf('journey.html', 'weather');
  await make('journey.html', 'weather', () => `${forecast}.1`);
  const host = '<p><span>one</span><span>two</span></p><section class="weather"><h3>x</h3><span>a</span><span>b</span></section>';
  const span = await drawn(await madeAs('Span'), '.span-context > span', host);
  assert.equal(span.root.color, 'rgb(194, 29, 86)');
  assert.equal(span.root.fontWeight, '700');
  assert.equal(span.root.display, 'inline-block');
  for (const h of span.host.filter((x, i) => i < 2)) {
    assert.equal(h.display, 'inline', `a span of the page around it is untouched: ${JSON.stringify(h)}`);
    assert.equal(h.padding, '0px');
    assert.notEqual(h.color, 'rgb(194, 29, 86)');
  }
  for (const h of (await drawn('Weather.tsx#Weather', '.weather', host)).host) assert.equal(h.padding, '0px', `nor an element of the page that shares a class with it: ${JSON.stringify(h)}`);
});

test('basics pass 3: white space kept by CSS (pre-wrap) reads and measures the same', { timeout: 90000 }, async () => {
  const { was, is, src } = await same('journey.html', 'scrollcopy', 'Scrollcopy');
  assert.match(was[0].text, /First line\n {4}Keep four spaces/);
  assert.deepEqual(is, was);
  assert.match(src, /\\n {4}Keep/);
});

test('basics pass 3: a card a grid sized keeps the width it had in the frame', { timeout: 90000 }, async () => {
  const w = await json(`(() => { const d = document.querySelector('section.cmp[data-component="journey.html"] iframe').contentDocument; return Math.round(d.querySelector('.teaser').getBoundingClientRect().width * 10) / 10; })()`);
  await make('journey.html', 'teaser');
  const t = await drawn(await madeAs('Teaser'), '.teaser');
  assert.ok(w > 100 && w < 600, `the frame draws the teaser in its grid column: ${w}`);
  assert.equal(t.root.w, w, 'the same width on its own');
});

// Where the new card is on screen, against the canvas (the area Layers and the right panel leave) and the message.
const onScreen = (id) => json(`(() => { const s = document.querySelector('section.cmp[data-component=' + JSON.stringify(${JSON.stringify(id)}) + ']'); const st = document.getElementById('stage').getBoundingClientRect();
  const r = s.getBoundingClientRect(), h = document.getElementById('hint'), hr = h.textContent && h.getClientRects().length ? h.getBoundingClientRect() : null;
  const inside = r.left >= st.left && r.top >= st.top && r.right <= st.right && r.bottom <= st.bottom;
  const covered = hr ? Math.max(0, Math.min(r.right, hr.right) - Math.max(r.left, hr.left)) * Math.max(0, Math.min(r.bottom, hr.bottom) - Math.max(r.top, hr.top)) : 0;
  return { inside, covered, z: napkin.view.get().z, r: [r.left, r.top, r.right, r.bottom].map(Math.round), stage: [st.left, st.top, st.right, st.bottom].map(Math.round) }; })()`);

test('basics pass 3: from a far, zoomed-out view the new card ends wholly on the canvas, readable, and the message does not cover it', { timeout: 90000 }, async () => {
  // fit all, then far off to one side: the frame the selection is in is a speck
  await q(`napkin.view.set({ x: -4000, y: -3000, z: 0.12 }); 0`);
  await sleep(300);
  await make('journey.html', 'banner');
  const id = await madeAs('Banner');
  await sleep(2500); // past its first draw, its measure and any move the layout makes
  const at = await onScreen(id);
  assert.ok(at.inside, `the card is inside the canvas: ${JSON.stringify(at)}`);
  assert.equal(at.covered, 0, `the message covers none of it: ${JSON.stringify(at)}`);
  assert.ok(at.z >= 0.99, `shown at 100%, since it fits: ${at.z}`);
  await sleep(2500);
  assert.ok((await onScreen(id)).inside, 'and it stays shown');
});

test('basics pass 3: clicking the made component\'s file row in Layers selects its root, and the panel follows', { timeout: 90000 }, async () => {
  await make('journey.html', 'trip');
  const id = await madeAs('Trip');
  await sleep(1500);
  const trip = await nodeOf('journey.html', 'trip');
  await q(`napkin.select({ component: 'journey.html', node: '${trip}', variant: {} }); 0`);
  await sleep(200);
  const row = `document.querySelector('#layers .lrow[data-kind="component"][data-component=' + JSON.stringify(${JSON.stringify(id)}) + ']')`;
  await b.waitFor(`!!${row}`, 10000);
  await q(`${row}.scrollIntoView({ block: 'center' }); 0`);
  await sleep(150);
  const at = await json(`(() => { const r = ${row}.querySelector('.lname').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await io.click(at.x, at.y);
  await until(async () => (await q(`String(napkin.state.selection?.component || '')`)) === id || null, 5000);
  const picked = await json(`(() => { const s = napkin.state.selection, el = napkin.stage.sections.get(s.component)?.docFrame?.element(s.node)?.el; return { tag: el?.tagName, cls: el?.className }; })()`);
  assert.deepEqual(picked, { tag: 'ARTICLE', cls: 'trip card featured' }, 'its root, not the wrapper around it');
  assert.match(await q(`document.querySelector('#inspector').textContent`), /article|trip/i, 'the panel shows it');
});

const field = () => json(`(() => { const i = document.activeElement; return i?.classList?.contains('nk-rename') ? { value: i.value, selected: i.value.slice(i.selectionStart, i.selectionEnd), card: i.closest('section.cmp')?.dataset.component, dialog: [...document.querySelectorAll('dialog[open], [role=dialog]')].some((d) => d.getClientRects().length > 0) } : null; })()`);

test('basics pass 3: right after it is made the name is a field on its label, selected; Enter names the file and its export', { timeout: 90000 }, async () => {
  const count = readdirSync(r.compDir).filter((n) => n.endsWith('.tsx')).length;
  await make('journey.html', 'layout');
  await until(() => existsSync(file('Layout.tsx')));
  await until(field, 10000);
  assert.deepEqual(await field(), { value: 'Layout', selected: 'Layout', card: 'Layout.tsx#Layout', dialog: false }, 'the automatic name, selected, in place; no dialog');
  await io.type('TripGrid');
  await io.key('Enter');
  await until(() => existsSync(file('TripGrid.tsx')) && !existsSync(file('Layout.tsx')));
  const src = readFileSync(file('TripGrid.tsx'), 'utf8');
  assert.match(src, /export default function TripGrid\(\) \{/);
  assert.match(src, /className="trip-grid-context"/);
  assert.equal(readdirSync(r.compDir).filter((n) => n.endsWith('.tsx')).length, count + 1, 'renamed, not copied');
  await until(async () => (await q(`String(napkin.state.selection?.component || '')`)) === 'TripGrid.tsx#TripGrid' || null, 10000);
  // one undo takes the named component away
  await q(`document.activeElement?.blur?.(); 0`);
  await io.key('z', { ctrl: true });
  await until(() => !existsSync(file('TripGrid.tsx')));
  assert.equal(existsSync(file('Layout.tsx')), false);
});

test('basics pass 3: Escape in the name field keeps the automatic name', { timeout: 90000 }, async () => {
  await make('journey.html', 'banner'); // a second Banner: Banner2
  await until(() => existsSync(file('Banner2.tsx')));
  await until(field, 10000);
  await io.type('Nope');
  await io.key('Escape');
  await sleep(600);
  assert.equal(await field(), null, 'the field is gone');
  assert.ok(existsSync(file('Banner2.tsx')));
  assert.equal(existsSync(file('Nope.tsx')), false);
  assert.match(readFileSync(file('Banner2.tsx'), 'utf8'), /export default function Banner2\(\)/);
});

test('basics pass 3: a rename that lands before the made card was selected still ends with the renamed card selected', { timeout: 90000 }, async () => {
  // The order that broke on a loaded machine: Enter is pressed while the first loop that selects the new card is still
  // waiting; that loop then selects the card under its old name (it is still drawn until the folder rescan), and the
  // rename's own loop took that for the person moving on, so nothing was selected once the old card went away.
  // Forced here: nothing selects a Teaser card until the rename has been answered.
  await q(`window.__gate = true; const sel = napkin.select; napkin.select = function (s, ...a) { if (window.__gate && /^Teaser\\d*\\.tsx#/.test(String(s?.component))) return; return sel.call(this, s, ...a); };
    const f = napkin.fetch; napkin.fetch = async function (u, ...a) { const r = await f.call(this, u, ...a); if (/component\\/rename/.test(String(u))) window.__gate = false; return r; }; 0`);
  await make('journey.html', 'teaser'); // Teaser2
  await until(() => existsSync(file('Teaser2.tsx')));
  await until(field, 10000);
  await io.type('Gated');
  await io.key('Enter');
  await until(() => existsSync(file('Gated.tsx')) && !existsSync(file('Teaser2.tsx')));
  await until(async () => (await q(`String(napkin.state.selection?.component || '')`)) === 'Gated.tsx#Gated' || null, 10000);
  await sleep(600);
  assert.equal(await q(`String(napkin.state.selection?.component || '')`), 'Gated.tsx#Gated');
});
