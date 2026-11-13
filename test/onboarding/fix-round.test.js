import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createComponent } from '../../src/commit.js';
import { classifySource, formatReport } from '../../src/scan.js';
import { proposeAdoption } from '../../src/adopt.js';
import { readComponent } from '../../src/tsx/read.js';
import { openWorkspace } from '../../src/workspace.js';
import { createApi } from '../../src/api.js';
import { cli, simple } from '../helpers/open.js';
import { http, session } from '../helpers/agents.js';
import { launchChromium } from '../helpers/cdp.js';

const foreign = `import styles from './button.module.css';
import { forwardRef, useState, createContext } from 'react';
const Context = createContext(null);
function helper() { return 1; }
export default forwardRef(function Button({ ...props }, ref) {
  const [on] = useState(false);
  return <div {...props} className={cn(styles.root)}>{on ? <b /> : null}{[1].map(x => <i />)}</div>;
});`;
test('OPN-01/04: scan reports every blocking construct at its own line and counts files', () => {
  const row = classifySource(foreign, 'ui/button.tsx');
  for (const [name, line] of [['CSS modules', 1], ['context', 3], ['extra helper functions', 4], ['default export', 5], ['forwardRef', 5], ['rest or spread props', 5], ['hooks', 6], ['className or cn() styling', 7], ['conditional rendering', 7], ['map', 7], ['styles outside const base', 7]]) {
    assert.ok(row.constructs?.some(c => c.name === name && c.line === line), `${name}: ${JSON.stringify(row)}`);
  }
  assert.doesNotMatch(row.reason, /FunctionDeclaration|VariableDeclaration|ExportDefaultDeclaration/);
  assert.match(formatReport([row, { ...row, file: 'other.tsx' }]), /hooks.*2 files/);
});
test('OPN-03: faithful defaults and literal styles convert cleanly; refusal names real causes', () => {
  const p = proposeAdoption(`export function Hello({ label = 'Hello', large = false }: { label?: string; large?: boolean }) { return <button style={{ color: 'navy', padding: 8 }}>{label}</button>; }`, 'ui/Hello.tsx');
  const { doc } = readComponent(p.source);
  assert.equal(doc.props.find(p => p.name === 'label').default, 'Hello');
  assert.doesNotMatch(p.source, /return\s*\(\(|"(?:root|color|padding)":/);
  const constants = proposeAdoption(`const card = { color: 'navy', padding: 8 }; export function Card() { const inset = { margin: -2 }; return <div style={card}><span style={inset}>Hello</span></div>; }`, 'ui/Card.tsx');
  assert.equal(readComponent(constants.source).doc.root.style.color, 'navy');
  assert.equal(readComponent(constants.source).doc.root.children[0].style.margin, -2);
  assert.throws(() => proposeAdoption(foreign, 'ui/button.tsx'), /CSS modules.*context.*extra helper functions.*default export.*forwardRef.*hooks/s);
});
test('OPN-03: accepting adoption independently invalidates the existing bundle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-rebundle-'));
  createComponent(join(dir, 'Greeting.tsx'), simple);
  const ws = await openWorkspace(dir, { writeSidecars: false }), api = createApi(ws);
  try {
    const entry = ws.find('Greeting'), before = await ws.bundle(entry);
    assert.equal(before.ok, true);
    const token = api.session('you').json.token;
    const p = await api.handle({ method: 'POST', path: '/api/components/Greeting/adoption', body: {}, token });
    const accepted = await api.handle({ method: 'POST', path: `/api/proposals/${p.json.proposal.id}/accept`, body: {}, token });
    assert.equal(accepted.status, 200);
    const after = await ws.bundle(entry);
    assert.equal(after.ok, true);
    assert.notEqual(after.code, before.code);
    assert.match(after.code, /data-n/);
    const bad = await api.handle({ method: 'POST', path: '/api/components/Greeting/edits', body: '{', token });
    assert.doesNotMatch(bad.json.error, /\[.*tsx\]/);
    const missing = await api.handle({ method: 'POST', path: '/api/proposals/missing-id/accept', body: {}, token });
    assert.match(missing.json.error, /missing-id/);
  } finally { await api.close(); await ws.close(); rmSync(dir, { recursive: true, force: true }); }
});
// Rewritten for decision 0013 (lead ruling 2026-10-30): was a dialect cell with a `.build-error` card, now the file's /view frame, which says why it could
// not be built inside the frame; each error stays inside its own measured frame, the frames do not overlap, duplicate names show their paths; intent unchanged.
test('OPN-02: build errors stay within measured frames; duplicate names include paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-errors-ui-'));
  for (const name of ['a', 'b', 'c', 'd']) { mkdirSync(join(dir, name)); createComponent(join(dir, name, 'accordion.tsx'), `import { X } from './missing'; export function Accordion() { return <X />; }`); }
  const s = await cli(dir), b = await launchChromium({ width: 1440, height: 960 });
  try {
    await b.goto(s.url); await b.waitFor('document.body.dataset.ready === "1"');
    await b.waitFor(`[...napkin.stage.sections.values()].filter((s) => s.docFrame?.doc()?.querySelector('[data-napkin-error]')?.textContent).length === 4`);
    const result = await b.eval(`(() => {
      const frames = [...document.querySelectorAll('.cmp')];
      return frames.map(el => { const df = napkin.stage.sections.get(el.dataset.component).docFrame, f = el.querySelector('.frame').getBoundingClientRect(), e = el.querySelector('.card-state')?.getBoundingClientRect() ?? df.element(df.tree().tree[0]?.node)?.getBoundingClientRect() ?? (() => { const p = df.doc().querySelector('[data-napkin-error]').getBoundingClientRect(), fr = df.iframe().getBoundingClientRect(); return new DOMRect(fr.left + p.left, fr.top + p.top, p.width, p.height); })(); return { title: el.querySelector('h3').textContent + ' ' + el.querySelector('.cmp-path').textContent + ' | ' + el.querySelector('.cmp-title').title, text: el.textContent + df.doc().body.textContent, bounded: e.left >= f.left - 1 && e.right <= f.right + 1 && e.top >= f.top - 1 && e.bottom <= f.bottom + 1, x:f.x, y:f.y, r:f.right, b:f.bottom }; });
    })()`);
    // the label: folder/name, then the file, quieter; the whole path is the tooltip
    for (const r of result) { assert.equal(r.bounded, true); assert.match(r.title, /^([abcd])\/Accordion accordion\.tsx \| \1\/accordion\.tsx$/); assert.ok(!r.text.includes(dir)); assert.match(r.text, /could not build [abcd]\/accordion\.tsx.*line \d+/); }
    for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) { const a = result[i], c = result[j]; assert.ok(a.r <= c.x || c.r <= a.x || a.b <= c.y || c.b <= a.y); }
    assert.match(await b.eval('document.querySelector("#layers").textContent'), /Accordion · a\/accordion.tsx/);
    // (was: click the card's <summary> and it opens) now: focus a broken frame and its whole reason is there, whole, readable and inside the stage
    await b.eval(`napkin.nav.focus(napkin.find('Accordion').component, null, { animate: false }); true`);
    // (the reason is drawn by the card's error state, card-state.js: the first line on the card, the whole text in its tooltip)
    await b.waitFor(`(() => { const df = napkin.stage.sections.get(napkin.find('Accordion').component).docFrame, e = df.cell.querySelector('.card-state'); const r = e.getBoundingClientRect(), z = r.width / e.offsetWidth, s = document.querySelector('#stage').getBoundingClientRect(); return [...e.children].every((c) => c.scrollWidth <= c.clientWidth + 1) && parseFloat(getComputedStyle(e).fontSize) * z >= 6 && r.left >= s.left - 1 && r.right <= s.right + 1 && /Could not resolve "\\.\\/missing"/.test(e.innerText) && /Could not resolve/.test(e.title); })()`);
    assert.match(await b.eval(`napkin.stage.sections.get(napkin.find('Accordion').component).docFrame.doc().querySelector('[data-napkin-error]').textContent`), /Could not resolve "\.\/missing"/);
  } finally { await b.close(); await s.stop(); rmSync(dir, { recursive: true, force: true }); }
});
test('OPN big repo: address precedes scan and arrives within two seconds; progress streams', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-large-'));
  for (let i = 0; i < 3674; i++) createComponent(join(dir, `Item${i}.tsx`), `export function Item${i}() { return <div />; }`);
  const start = Date.now(), s = await cli(dir);
  try {
    assert.ok(Date.now() - start < 2000, `address took ${Date.now() - start} ms`);
    assert.ok(s.output().indexOf('napkin canvas:') < s.output().indexOf('TSX files:') || !s.output().includes('TSX files:'));
    const stream = await fetch(new URL('api/events', s.url));
    const reader = stream.body.getReader();
    let text = '';
    while (!text.includes('"type":"progress"')) { const r = await reader.read(); assert.equal(r.done, false); text += new TextDecoder().decode(r.value); }
    await reader.cancel();
  } finally { await s.stop(); rmSync(dir, { recursive: true, force: true }); }
});

// Rewritten for decision 0013 (lead ruling 2026-10-30): was dialect bundles fetched on reveal and a `.mount` inside the stage, now /view iframes that do not
// load until their frame is revealed, and the revealed frame's document inside the stage; intent unchanged.
test('OPN: offscreen previews bundle on reveal, and refreshed errors keep real frame bounds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-lazy-'));
  for (let i = 0; i < 60; i++) createComponent(join(dir, `Item${String(i).padStart(2, '0')}.tsx`), `export function Item${i}() { return <div style={{ width: 450, height: 240 }}>Preview ${i}</div>; }`);
  const s = await cli(dir), b = await launchChromium({ width: 1440, height: 960 });
  try {
    await b.goto(s.url); await b.waitFor('napkin.state.components.size === 60 && document.body.dataset.ready === "1"');
    // A frame far from the view that changes waits to be revealed. (Whether any are waiting right after load depends on how fast the page draws them, so make one wait.)
    await b.eval('napkin.view.set({ x: 80, y: 120, z: 1 }); true');
    writeFileSync(join(dir, 'Item59.tsx'), `export function Item59() { return <div style={{ width: 450, height: 240 }}>Preview 59, edited</div>; }`);
    await b.waitFor('[...napkin.stage.sections.values()].some(s => s.pending)');
    const loaded = await b.eval('document.querySelectorAll("iframe.doc-frame").length');
    assert.ok(loaded < 60, `frames far off screen do not load until revealed (${loaded} of 60 have an iframe)`);
    const pending = await b.eval('[...napkin.stage.sections.entries()].filter(([,s]) => s.pending).map(([id]) => id)');
    assert.ok(pending.length > 0);
    const id = pending[0];
    await b.eval(`napkin.stage.reveal(${JSON.stringify(id)}); true`);
    await b.waitFor(`!!napkin.stage.sections.get(${JSON.stringify(id)}).docFrame?.doc()?.body?.textContent.includes('Preview')`);
    assert.equal(await b.eval(`napkin.stage.sections.get(${JSON.stringify(id)}).pending`), false);
    await b.waitFor(`(() => { const el = napkin.stage.sections.get(${JSON.stringify(id)}).docFrame.iframe(), r = el.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom; })()`);
  } finally { await b.close(); await s.stop(); rmSync(dir, { recursive: true, force: true }); }
});

// Rewritten for decision 0013 (lead ruling 2026-10-30): was a read-only dialect cell (`.mount`) before the adoption, now the file's /view frame; after Accept the
// canvas shows the adopted file without a reload (the file is now one the dialect edits, so it is drawn once, as a cell) and fetches one fresh bundle; intent unchanged.
test('OPN-03: the live canvas fetches a fresh bundle after adoption Accept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-canvas-adopt-'));
  createComponent(join(dir, 'Greeting.tsx'), simple);
  const s = await cli(dir), b = await launchChromium({ width: 1440, height: 960 });
  try {
    await b.goto(s.url); await b.waitFor('document.body.dataset.ready === "1" && napkin.stage.sections.get(napkin.find("Greeting")?.component)?.docFrame?.doc()?.body?.textContent.includes("Hello")');
    assert.equal(await b.eval('!!document.querySelector(".mount [data-n]")'), false, 'before: the /view frame of the file as it is');
    await b.eval('window.bundleFetches = []; const fetchBefore = window.fetch; window.fetch = (...args) => { if (String(args[0]).startsWith("/bundle/")) bundleFetches.push(args[0]); return fetchBefore(...args); }; true');
    const token = await session(s.url, 'you');
    const p = await http(s.url, '/api/components/Greeting/adoption', { method: 'POST', token, body: {} });
    assert.equal(p.status, 200);
    const accepted = await http(s.url, `/api/proposals/${p.json.proposal.id}/accept`, { method: 'POST', token, body: {} });
    assert.equal(accepted.status, 200);
    await b.waitFor('!!document.querySelector(".mount [data-n=root]")');
    assert.equal(await b.eval('bundleFetches.length'), 1);
    assert.equal(await b.eval('document.querySelectorAll("section.cmp").length'), 1, 'the file is on the canvas once');
    assert.equal(await b.eval('document.querySelector(".mount").textContent'), 'Hello');
    assert.equal(await b.eval('document.querySelector(".badge").hidden'), true);
  } finally { await b.close(); await s.stop(); rmSync(dir, { recursive: true, force: true }); }
});
