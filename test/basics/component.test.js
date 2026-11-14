// Basics pass 3, component from a selection (docs/basics/standards.md section 9): select an element in an HTML frame,
// run Create component, and it is a component of its own that looks the same. No name is asked first; the frame's file
// is not touched; one undo takes the new file away again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>page</title>
<link rel="stylesheet" href="page.css">
<style>
  :root { --ink: #16202a; --paper: #fffdf7; --accent: #2f5bea; --radius: 10px; }
  body { margin: 0; padding: 32px; font: 15px/1.45 Arial, sans-serif; background: #eef0f3; }
  .card { width: 280px; padding: 20px; border-radius: var(--radius); background: var(--paper); color: var(--ink); box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
  .card h2 { margin: 0 0 6px; font-size: 18px; }
  .card .btn { display: inline-block; margin-top: 12px; padding: 6px 12px; border-radius: 6px; background: var(--accent); color: white; text-decoration: none; animation: pulse 2s infinite; }
  .hero { font-size: 40px; }
  @media (max-width: 500px) { .card { width: auto; } }
  @keyframes pulse { 50% { opacity: .7; } }
</style>
</head>
<body>
  <h1 class="hero">Orbit</h1>
  <article class="card" id="promo">
    <h2>Launch window</h2>
    <p>Opens at <b>07:31</b> &amp; closes at noon.</p>
    <a class="btn" href="#go" onclick="alert(1)">Reserve a seat</a>
  </article>
</body>
</html>
`;
const CARD = '0.1.1';

let r, server, b, io;
const file = (name) => join(r.compDir, name);
const q = (e) => b.eval(e);
const json = async (e) => JSON.parse(await q(`JSON.stringify(${e})`));
const until = (fn, ms = 10000) => waitFor(fn, ms, 50);
const hint = () => q(`document.querySelector('#hint').textContent`);
const select = async (node) => { await q(`napkin.select(${node === null ? 'null' : `{ component: 'page.html', node: '${node}', variant: {} }`}); 0`); await sleep(150); };
const make = () => io.key('k', { ctrl: true, alt: true });
// what the card looks like, read from whichever document draws it
const look = (docExpr) => json(`(() => { const d = ${docExpr}; const pick = (el, keys) => { const s = getComputedStyle(el); const o = {}; for (const k of keys) o[k] = s[k]; const r = el.getBoundingClientRect(); o.w = Math.round(r.width); o.h = Math.round(r.height); o.text = el.textContent.replace(/\\s+/g, ''); return o; };
  const card = d.querySelector('.card'); return { card: pick(card, ['fontFamily', 'fontSize', 'lineHeight', 'color', 'backgroundColor', 'paddingTop', 'borderTopLeftRadius', 'boxShadow']), h2: pick(card.querySelector('h2'), ['fontSize', 'marginBottom', 'color']), p: pick(card.querySelector('p'), ['color', 'marginTop']), btn: pick(card.querySelector('.btn'), ['backgroundColor', 'color', 'paddingLeft', 'animationName', 'display']) }; })()`);
const frameDoc = `document.querySelector('section.cmp[data-component="page.html"] iframe').contentDocument`;
const madeDoc = (id) => `(() => { const s = document.querySelector('section.cmp[data-component^="${id}"]'); const f = s.querySelector('iframe'); return f?.contentDocument?.querySelector('.card') ? f.contentDocument : s.querySelector('.card') ? s : (s.querySelector('.mount')?.shadowRoot || s); })()`;

before(async () => {
  r = tempRepo(['Button']);
  writeFileSync(file('page.html'), PAGE);
  writeFileSync(file('page.css'), '.card p { margin: 0; color: #55606b; }\n.footer { color: red; }\n');
  server = await startServer(r.compDir, { timeout: 20000, env: { NAPKIN_ALL_KINDS: '0' } });
  b = await launchChromium({ width: 1440, height: 900 });
  io = input(b);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="page.html"]')?.dataset.ready`, 20000);
  await sleep(400);
});
after(async () => { await b?.close(); await server?.stop(); rmSync(r.dir, { recursive: true, force: true }); });

test('basics pass 3: Ctrl+Alt+K on a selected element makes a component file beside the frame, named from the selection, and nothing is asked', { timeout: 60000 }, async () => {
  await select(CARD);
  await make();
  await until(() => existsSync(file('Card.tsx')));
  assert.equal(await q(`[...document.querySelectorAll('dialog[open], [role=dialog]')].some((d) => d.getClientRects().length > 0)`), false, 'no dialog opens');
  const src = readFileSync(file('Card.tsx'), 'utf8');
  assert.match(src, /^\/\/ Made from page\.html:\d+\.\n/, 'the file says where it came from');
  assert.match(src, /export default function Card\(\) \{/);
  assert.match(src, /<article className="card" id="promo">\n\s+<h2>Launch window<\/h2>\n\s+<p>Opens at <b>07:31<\/b> &amp; closes at noon\.<\/p>\n\s+<a className="btn" href="#go">Reserve a seat<\/a>\n\s+<\/article>/, 'the element reads like hand-written JSX');
  assert.doesNotMatch(src, /onclick|\.hero|\.footer/, 'no inline script, and no rule that never reached the selection');
  assert.match(src, /@keyframes pulse \{/, 'the animation it names comes along');
  assert.match(src, /@media \(max-width: 500px\) \{\n\s+:where\(\.card-context \.card\) \{ width: auto; \}/, 'inside its media query, scoped to the component');
  assert.equal(readFileSync(file('page.html'), 'utf8'), PAGE, 'the frame is byte for byte what it was');
  await b.waitFor(`!!document.querySelector('section.cmp[data-component^="Card.tsx"]')`, 10000);
  await until(async () => /Card made from page\.html/.test(await hint()) || null);
  assert.match(await hint(), /the frame is unchanged/);
  assert.match(await hint(), /Left behind: the onclick handler on <a>/, 'what could not come along is said');
  await until(async () => (await q(`String(napkin.state.selection?.component || '')`)).startsWith('Card.tsx') || null);
  // naming afterwards (standards 9, rule 4): the label is a field with the automatic name; a Ctrl+Alt command still runs from it
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename' || null);
  await make(); // the new card is selected, so the command now explains itself instead of making a copy of a copy
  await until(async () => /already a component/.test(await hint()) || null);
  assert.equal(await q(`!!document.querySelector('.nk-rename')`), false, 'the field closed, keeping the name Card');
  assert.ok(existsSync(file('Card.tsx')));
});

test('basics pass 3: the component looks the same as the selection did in its frame', { timeout: 60000 }, async () => {
  await b.waitFor(`(() => { const d = ${madeDoc('Card.tsx')}; return !!d.querySelector?.('.card .btn'); })()`, 20000);
  await sleep(300);
  const [was, is] = [await look(frameDoc), await look(madeDoc('Card.tsx'))];
  assert.deepEqual(is, was);
  assert.equal(was.card.fontFamily, 'Arial, sans-serif', 'the type it inherited from the page came with it');
  assert.equal(was.btn.backgroundColor, 'rgb(47, 91, 234)', 'and the custom properties it reads');
  assert.equal(was.btn.animationName, 'pulse');
});

test('basics pass 3: one undo removes the new file and its card; the frame is still untouched', { timeout: 60000 }, async () => {
  await q(`document.activeElement?.blur?.(); 0`);
  await io.key('z', { ctrl: true });
  await until(() => !existsSync(file('Card.tsx')));
  await b.waitFor(`!document.querySelector('section.cmp[data-component^="Card.tsx"]')`, 10000);
  assert.equal(readFileSync(file('page.html'), 'utf8'), PAGE);
});

test('basics pass 3: the palette runs it too, and a taken name gets the next free one', { timeout: 60000 }, async () => {
  writeFileSync(file('Card.tsx'), 'export default function Card() { return <div>mine</div>; }\n');
  await b.waitFor(`!!document.querySelector('section.cmp[data-component^="Card.tsx"]')`, 15000);
  await select(CARD);
  await io.key('k', { ctrl: true });
  await b.waitFor(`document.activeElement?.closest?.('[role=dialog], #quick') != null`, 5000);
  await q(`document.execCommand('insertText', false, 'Create component')`);
  await sleep(250);
  await io.key('Enter');
  await until(() => existsSync(file('Card2.tsx')));
  assert.equal(readFileSync(file('Card.tsx'), 'utf8'), 'export default function Card() { return <div>mine</div>; }\n', 'a file that was there is never overwritten');
  assert.match(readFileSync(file('Card2.tsx'), 'utf8'), /export default function Card2\(\)/);
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename' || null); // named afterwards (rule 4); Escape keeps Card2
  await io.key('Escape');
  await until(async () => !(await q(`!!document.querySelector('.nk-rename')`)) || null);
});

test('basics pass 3: when it cannot apply it says why, in a sentence, and makes nothing', { timeout: 60000 }, async () => {
  const count = () => json(`[...napkin.state.components.keys()].filter((k) => k.endsWith('.tsx')).length`);
  const n = await count();
  // the card the last test made selects itself once drawn; let that finish before this test clears the selection
  await until(async () => /^Card2/.test(await q(`napkin.state.selection?.component || ''`)) || null);
  await sleep(800);
  await select(null);
  await make();
  await until(async () => /Select an element in a frame first/.test(await hint()) || null);
  await select('0.1');
  await make();
  await until(async () => /the whole frame cannot be a component/.test(await hint()) || null);
  await q(`napkin.select({ component: 'Card.tsx#Card', node: '0', variant: {} }); 0`);
  await sleep(150);
  await make();
  await until(async () => /already a component/.test(await hint()) || null);
  assert.equal(await count(), n);
});

// round 4: the frame's file row means the whole frame however it was clicked
test('round 4: the whole-frame refusal is the same from a left-click and a right-click on the frame\'s Layers row, and nothing is made', { timeout: 60000 }, async () => {
  const count = () => json(`[...napkin.state.components.keys()].filter((k) => k.endsWith('.tsx')).length`);
  const n = await count();
  const row = `document.querySelector('#layers .lrow[data-kind="component"][data-component="page.html"]')`;
  await b.waitFor(`!!${row}`, 10000);
  await q(`${row}.scrollIntoView({ block: 'center' }); 0`);
  const at = () => json(`(() => { const r = ${row}.querySelector('.lname').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  for (const how of ['left', 'right']) {
    await select(null);
    await q(`document.querySelector('#hint').textContent = ''; document.activeElement?.blur?.(); 0`);
    const p = await at();
    if (how === 'left') await io.click(p.x, p.y);
    else { await io.move(p.x, p.y); await io.press(p.x, p.y, { button: 'right' }); await io.release(p.x, p.y, { button: 'right' }); await sleep(300); await io.key('Escape'); await sleep(200); }
    await q(`document.activeElement?.blur?.(); 0`);
    await make();
    await until(async () => /the whole frame cannot be a component/.test(await hint()) || null);
  }
  await sleep(400);
  assert.equal(await count(), n);
  assert.equal(existsSync(file('Orbit.tsx')), false);
  assert.equal(existsSync(file('Hero.tsx')), false);
});
