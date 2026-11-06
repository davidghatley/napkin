// Moments 9 and 10 walked in a real browser: the film strip of time (scrub, preview, restore as one undo step, git frames,
// lazy thumbnails, light and dark, axe) and Copy gives real code (exact bytes + exact rules on the clipboard, paste back
// through insert). Screenshots: EVIDENCE_OUT=docs/evidence node --test test/time/journey.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cli, hashes } from '../helpers/open.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';
import { sleep, ROOT } from '../helpers/harness.js';

const AXE = readFileSync(join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const PAGE = (title, color) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Card</title><link rel="stylesheet" href="card.css"></head>
<body>
<div class="card">
  <h2>${title}</h2>
  <p class="note" style="color:${color}">Fresh bread, every morning.</p>
  <a class="cta" href="#">Order</a>
</div>
</body></html>
`;
const CSS = `:root { --accent: #3459e2; }
.card {
  font: 16px/1.4 system-ui, sans-serif;
  width: 320px;
  padding:   24px;
  border: 1px solid #ccd;
  border-radius: 12px;
  background: #fff;
}
.card h2 { margin: 0 0 8px; }
.note { margin: 0 0 12px; }
.cta { display: inline-block; padding: 8px 16px; background: var(--accent); color: #fff; border-radius: 6px; text-decoration: none; }
.cta:hover { filter: brightness(1.1); }
@media (max-width: 400px) { .card { padding: 8px } }
.unused { color: red }
`;
async function setup({ width = 1440, height = 900 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-time-j-'));
  writeFileSync(join(dir, 'card.html'), PAGE('Fresh', 'navy'));
  writeFileSync(join(dir, 'card.css'), CSS);
  const sh = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', ...a], { stdio: 'ignore' });
  sh('init', '-q'); sh('add', 'card.html', 'card.css'); sh('commit', '-q', '-m', 'first card');
  writeFileSync(join(dir, 'card.html'), PAGE('Fresh bread', 'navy')); sh('commit', '-q', '-am', 'longer title');
  const state = mkdtempSync(join(tmpdir(), 'napkin-time-state-'));
  const s = await cli(dir, [], { NAPKIN_STATE_DIR: state });
  const browser = await launchChromium({ width, height });
  await browser.goto(s.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 15000);
  await browser.waitFor(`!!document.querySelector('.doc-frame')`, 15000);
  await sleep(300);
  return { dir, s, browser, io: input(browser), sh, stop: async () => { await browser.close(); await s.stop(); } };
}
const file = (dir) => readFileSync(join(dir, 'card.html'), 'utf8');
const nodeOf = (browser, tag) => browser.eval(`(async () => { const t = await (await fetch('/api/component/card.html')).json(); const f = (l) => { for (const n of l) { if (n.tag === ${JSON.stringify(tag)}) return n.node; const x = f(n.children); if (x) return x; } return null; }; return f(t.tree); })()`);
const select = (browser, node) => browser.eval(`napkin.select({ component: 'card.html', node: ${JSON.stringify(node)}, variant: {} })`);
// an edit through the page's own session: the write path the panel uses
const setText = (browser, tag, value) => browser.eval(`(async () => { const t = await (await fetch('/api/component/card.html')).json(); const f = (l) => { for (const n of l) { if (n.tag === ${JSON.stringify(tag)}) return n.node; const x = f(n.children); if (x) return x; } return null; }; const r = await napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: 'card.html', baseRevision: t.revision, edits: [{ op: 'text', node: f(t.tree), value: ${JSON.stringify(value)} }] }) }); return (await r.json()).ok; })()`);
const theme = (browser, want) => browser.eval(`(() => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); if (cur !== ${JSON.stringify(want)}) document.querySelector('#theme-toggle').click(); return document.documentElement.dataset.theme; })()`);
const shot = async (browser, name) => { if (!process.env.EVIDENCE_OUT) return; mkdirSync(process.env.EVIDENCE_OUT, { recursive: true }); writeFileSync(join(process.env.EVIDENCE_OUT, name), await browser.screenshot()); };
const copyEvent = (browser) => browser.eval(`(() => { const dt = new DataTransfer(); const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }); document.dispatchEvent(ev); return { prevented: ev.defaultPrevented, plain: dt.getData('text/plain'), html: dt.getData('text/html') }; })()`);
const pasteEvent = (browser, plain, html = '') => browser.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(plain)}); ${html ? `dt.setData('text/html', ${JSON.stringify(html)});` : ''} const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.dispatchEvent(ev); return ev.defaultPrevented; })()`);

const tiles = (browser) => browser.eval(`JSON.stringify([...document.querySelectorAll('#time .tm-tile')].map((n) => ({ source: n.dataset.source, sel: n.getAttribute('aria-selected'), label: n.getAttribute('aria-label') })))`).then(JSON.parse);
const previewText = (browser) => browser.eval(`document.querySelector('.time-preview')?.contentDocument?.querySelector('h2')?.textContent ?? null`);
const liveText = (browser) => browser.eval(`document.querySelector('.doc-frame')?.contentDocument?.querySelector('h2')?.textContent ?? null`);
const previewReady = (browser) => browser.waitFor(`document.querySelector('.time-preview')?.dataset.ready === '1'`);
const cardPad = (browser, which) => browser.eval(`getComputedStyle(document.querySelector(${JSON.stringify(which)}).contentDocument.querySelector('.card')).paddingTop`);
const cssRule = (browser, value) => browser.eval(`(async () => { const t = await (await fetch('/api/component/card.html')).json(); const r = await napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: 'card.html', baseRevision: t.revision, edits: [{ op: 'rule', file: 'card.css', selector: '.card', index: 0, prop: 'padding', value: ${JSON.stringify(value)} }] }) }); return (await r.json()).ok; })()`);

test('M9 a film strip of time: CSS edits are frames, scrub the versions, before and after, restore every file as a single undo step', { timeout: 170000 }, async () => {
  const t = await setup();
  const { browser, io, dir } = t;
  try {
    const before = hashes(dir);
    // four edits: a heading, a paragraph, a stylesheet rule and the heading again (different things, so none merge into a run)
    assert.equal(await setText(browser, 'h2', 'Fresh bread daily'), true);
    assert.equal(await setText(browser, 'p', 'Hot from the oven.'), true);
    const afterP = file(dir), cssBefore = readFileSync(join(dir, 'card.css'), 'utf8');
    assert.equal(await cssRule(browser, '36px'), true);
    assert.equal(await setText(browser, 'h2', 'Bakery'), true);
    await browser.waitFor(`document.querySelector('.doc-frame')?.contentDocument?.querySelector('h2')?.textContent === 'Bakery'`);
    const newest = file(dir), cssNewest = readFileSync(join(dir, 'card.css'), 'utf8');

    // 1. Select the component's heading and press H: the strip opens, "Now" is picked; every frame says what changed
    await select(browser, await nodeOf(browser, 'h2'));
    await io.key('h');
    await browser.waitFor(`!document.querySelector('#time').hidden && document.querySelectorAll('#time .tm-tile').length >= 6`);
    const tl = await tiles(browser);
    assert.deepEqual(tl.map((x) => x.source), ['git', 'git', 'napkin', 'napkin', 'napkin', 'now'], 'two commits (the file as first seen IS the second commit), three edits, Now');
    assert.equal(tl.at(-1).sel, 'true');
    assert.match(tl[0].label, /first card/); assert.match(tl[1].label, /Fresh \u2192 Fresh bread/, 'the commit says what it changed too');
    assert.match(tl[2].label, /bread → bread daily/);
    assert.match(tl[3].label, /Fresh bread, every mornin\u2026 \u2192 Hot from the oven\./);
    assert.match(tl[4].label, /padding 24px → 36px/, 'a stylesheet edit is a frame of this component');
    assert.match(tl[5].label, /Now\. Fresh bread daily → Bakery/);

    // 2. Scrub: the frame on the canvas shows each older version, drawn from that version's own files (stylesheet included)
    assert.equal(await cardPad(browser, '.doc-frame'), '36px');
    await io.key('ArrowLeft');                       // the stylesheet edit: padding 36, heading 'Fresh bread daily'
    await previewReady(browser);
    assert.equal(await previewText(browser), 'Fresh bread daily');
    assert.equal(await cardPad(browser, '.time-preview'), '36px');
    await io.key('ArrowLeft');                       // before it: padding back to 24, the paragraph edited
    await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('.card') && getComputedStyle(document.querySelector('.time-preview').contentDocument.querySelector('.card')).paddingTop === '24px'`);
    assert.equal(await liveText(browser), 'Bakery', 'the live frame waits underneath, untouched');
    assert.equal(file(dir), newest, 'previewing writes nothing');
    assert.equal(readFileSync(join(dir, 'card.css'), 'utf8'), cssNewest);

    // 3. The cue is in screen pixels: an outline round the frame and a label, the same size when the canvas is zoomed far out
    const cue = async () => JSON.parse(await browser.eval(`JSON.stringify((() => { const c = document.querySelector('#time-cue'), p = c.querySelector('.tc-pill'), cell = document.querySelector('.doc-cell').getBoundingClientRect(), r = c.getBoundingClientRect(); return { hidden: c.hidden, text: p.textContent, border: getComputedStyle(c).borderTopWidth, font: getComputedStyle(p).fontSize, aroundCell: r.left <= cell.left && r.top <= cell.top && r.right >= cell.right && r.bottom >= cell.bottom, chip: !document.querySelector('#time-cue-chip').hidden }; })())`));
    let c0 = await cue();
    assert.equal(c0.hidden, false); assert.match(c0.text, /Earlier version .* not saved/); assert.equal(c0.border, '2px'); assert.equal(c0.aroundCell, true); assert.equal(c0.chip, true);
    await browser.eval(`napkin.view.set({ ...napkin.view.get(), z: 0.25 })`);
    await sleep(300);
    c0 = await cue();
    assert.equal(c0.border, '2px'); assert.equal(c0.font, '11.5px'); assert.equal(c0.aroundCell, true, 'it follows the frame at 25% zoom');
    await shot(browser, 'time-strip-fit-all-light.png');
    await browser.eval(`napkin.view.set({ x: 360, y: 220, z: 1 })`); await sleep(200);

    // 4. Before and after: B shows the version before this change, B again after it
    assert.match(await browser.eval(`document.querySelector('.tm-tile[aria-selected="true"]').getAttribute('aria-label')`), /Hot from the oven/);
    await io.key('b');
    await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('p')?.textContent.startsWith('Fresh bread, every morning')`);
    assert.equal(await browser.eval(`document.querySelector('#time-info').textContent`), 'Before this change');
    assert.match((await cue()).text, /^Before this change/);
    await shot(browser, 'time-strip-before-light.png');
    await io.key('b');
    await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('p')?.textContent === 'Hot from the oven.'`);

    // 5. Thumbnails are cropped to the heading (the selected element) and differ where the versions do
    await browser.waitFor(`document.querySelectorAll('#time .tm-thumb iframe[data-ready]').length >= 4`, 20000);
    const th = JSON.parse(await browser.eval(`JSON.stringify([...document.querySelectorAll('#time .tm-tile')].map((n) => { const f = n.querySelector('iframe[data-ready]'); if (!f) return null; const h = f.contentDocument.querySelector('h2'); const m = new DOMMatrix(getComputedStyle(f).transform); return { h2: h?.textContent, k: m.a, w: h ? Math.round(h.getBoundingClientRect().width * m.a) : 0 }; }))`));
    const seen = th.filter(Boolean);
    assert.ok(seen.every((x) => x.k > 0.35), `thumbnails scaled to the heading: ${JSON.stringify(seen)}`);
    assert.ok(new Set(seen.map((x) => x.h2)).size >= 3, 'the thumbnails show different headings');

    // 6. Escape closes the strip and leaves the selection (and the canvas) alone
    const sel0 = await browser.eval(`JSON.stringify(napkin.state.selection)`);
    await io.key('Escape');
    await browser.waitFor(`document.querySelector('#time').hidden`);
    assert.equal(await browser.eval(`JSON.stringify(napkin.state.selection)`), sel0, 'the selection is still there');
    assert.equal(await browser.eval(`!!document.querySelector('.time-preview') || !document.querySelector('#time-cue').hidden`), false);

    // 7. Restore the version before the stylesheet edit: every file of it is put back, as one edit, and one undo gives all of it back
    await io.key('h');
    await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 6`);
    await io.key('ArrowLeft'); await io.key('ArrowLeft');
    await browser.waitFor(`document.querySelector('#time .tm-tile[aria-selected="true"]')?.dataset.i === '3'`);
    await previewReady(browser);
    await io.key('Enter');
    await browser.waitFor(`document.querySelector('#hint')?.textContent.startsWith('Restored the version')`);
    assert.equal(file(dir), afterP, 'the HTML is that version\'s');
    assert.equal(readFileSync(join(dir, 'card.css'), 'utf8'), cssBefore, 'and so is the stylesheet');
    const hist = await (await fetch(new URL('api/component/card.html/history', t.s.url))).json();
    assert.match(hist.history[0].summary, /^Restored the version from/); assert.equal(hist.history.length, 5, 'four edits and ONE restore');
    await io.key('z', { meta: true, ctrl: true });
    for (let i = 0; i < 100 && (file(dir) !== newest || readFileSync(join(dir, 'card.css'), 'utf8') !== cssNewest); i++) await sleep(50);
    assert.equal(file(dir), newest); assert.equal(readFileSync(join(dir, 'card.css'), 'utf8'), cssNewest, 'one undo gave both files back byte for byte');

    // 8. A git version restores too: the first commit
    await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 6`);
    await io.key('Home');
    await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('h2')?.textContent === 'Fresh'`);
    const firstCommit = execFileSync('git', ['-C', dir, 'show', 'HEAD~1:card.html']).toString();
    await io.key('Enter');
    await browser.waitFor(`document.querySelector('#hint')?.textContent.startsWith('Restored the version')`);
    assert.equal(file(dir), firstCommit);
    assert.deepEqual(Object.keys(hashes(dir)).sort(), Object.keys(before).sort(), 'no file was added to the folder');
    assert.equal(execFileSync('git', ['-C', dir, 'log', '--oneline']).toString().trim().split('\n').length, 2, 'git history untouched');
  } finally { await t.stop(); }
});

test('M9 a boundary where a stylesheet was applied: never a stop, versions before it say they are made of other files', { timeout: 120000 }, async () => {
  const t = await setup();
  const { browser, io, dir } = t;
  try {
    assert.equal(await setText(browser, 'h2', 'Fresh bread daily'), true);          // before the ask-once answer
    writeFileSync(join(dir, 'extra.css'), '.card { outline: 1px solid teal; }\n');
    await sleep(500);
    assert.equal(await browser.eval(`napkin.fetch('/api/styles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applied: ['extra.css'] }) }).then((r) => r.ok)`), true);
    await sleep(500);
    assert.equal(await setText(browser, 'p', 'Hot from the oven.'), true);
    await select(browser, await nodeOf(browser, 'h2'));
    await io.key('h');
    await browser.waitFor(`document.querySelectorAll('#time .tm-boundary').length === 1`);
    assert.match(await browser.eval(`document.querySelector('#time .tm-boundary').textContent`), /Stylesheets applied: extra\.css/);
    const kinds = await browser.eval(`JSON.stringify([...document.querySelectorAll('#time .tm-track > *')].map((n) => n.classList.contains('tm-boundary') ? 'boundary' : n.dataset.source))`);
    const row = JSON.parse(kinds), at = row.indexOf('boundary');
    assert.ok(at > 0 && at < row.length - 1, kinds);
    // walk left from Now past the boundary: it is never selected, and the version beyond says what it is made of
    const seen = [];
    for (let i = 0; i < at + 1; i++) { await io.key('ArrowLeft'); seen.push(await browser.eval(`document.querySelector('#time .tm-tile[aria-selected="true"]')?.dataset.i`)); }
    assert.ok(!seen.includes(String(at)), `the boundary is never a stop: ${seen} (boundary at ${at})`);
    assert.match(await browser.eval(`document.querySelector('#time-info').textContent`), /other files than now/);
    await previewReady(browser);
    assert.equal(await browser.eval(`!!document.querySelector('.time-preview').contentDocument.querySelector('link[href*="extra.css"]')`), false, 'drawn with its own files');
    await io.key('Enter');
    await browser.waitFor(`document.querySelector('#hint')?.textContent.startsWith('Restored')`);
    assert.deepEqual(await browser.eval(`fetch('/api/styles').then((r) => r.json()).then((j) => j.applied)`), ['extra.css'], 'the applied stylesheets are untouched');
  } finally { await t.stop(); }
});

test('M9 the frame is never hidden by the strip: it is brought into view above it', { timeout: 120000 }, async () => {
  const t = await setup();
  const { browser, io } = t;
  try {
    await setText(browser, 'h2', 'Fresh bread daily');
    await select(browser, await nodeOf(browser, 'h2'));
    await browser.eval(`napkin.view.set({ x: 300, y: 600, z: 0.25 })`); await sleep(200);   // small, and where the strip will be
    await io.key('h');
    await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 3`);
    await io.key('ArrowLeft'); await previewReady(browser); await sleep(500);
    const m = JSON.parse(await browser.eval(`JSON.stringify((() => { const c = document.querySelector('.doc-cell').getBoundingClientRect(), s = document.querySelector('#time').getBoundingClientRect(); return { above: c.bottom <= s.top, top: c.top >= document.querySelector('#stage').getBoundingClientRect().top }; })())`));
    assert.deepEqual(m, { above: true, top: true });
    assert.ok(await browser.eval(`napkin.view.get().z`) >= 0.5, 'the first scrub brings the frame up to a size you can read');
    // Tab order: the track, then Before, Fit, Restore (then Close)
    const order = [];
    await browser.eval(`document.querySelector('#time-track').focus()`);
    for (let i = 0; i < 4; i++) { await io.key('Tab'); order.push(await browser.eval(`document.activeElement.id`)); }
    assert.deepEqual(order, ['time-flip', 'time-fit', 'time-restore', 'time-close'], 'Tab walks Before, Fit, Restore, Close');
  } finally { await t.stop(); }
});

test('M9 thumbnails are lazy: a long history never draws more than the strip shows', { timeout: 170000 }, async () => {
  const t = await setup();
  const { browser, io } = t;
  try {
    for (let i = 0; i < 40; i++) await setText(browser, i % 2 ? 'p' : 'h2', `Version ${i}`);
    await select(browser, await nodeOf(browser, 'h2'));
    await io.key('h');
    await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 40`);
    await browser.waitFor(`document.querySelectorAll('#time .tm-thumb iframe[data-ready]').length >= 3`, 15000);
    const n = await browser.eval(`document.querySelectorAll('#time .tm-thumb iframe').length`);
    const total = await browser.eval(`document.querySelectorAll('#time .tm-tile').length`);
    assert.ok(n < total / 2, `${n} thumbnails drawn for ${total} frames (only those in view)`);
    assert.equal(await browser.eval(`[...document.querySelectorAll('#time .tm-thumb iframe')].every((f) => /allow-same-origin/.test(f.getAttribute('sandbox')) && !/allow-scripts/.test(f.getAttribute('sandbox')))`), true, 'an HTML file\'s thumbnails run no scripts');
    const ms = await browser.eval(`(async () => { const t0 = performance.now(); for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame); return performance.now() - t0; })()`);
    assert.ok(ms < 1500, `20 animation frames took ${Math.round(ms)} ms with the strip open`);
    await io.key('Home');
    await browser.waitFor(`document.querySelector('#time .tm-thumb iframe[data-ready]')`, 15000);
    assert.ok(await browser.eval(`document.querySelectorAll('#time .tm-thumb iframe').length`) < total / 2);
  } finally { await t.stop(); }
});

test('M9 the strip in light and dark: axe finds nothing serious, nothing moves, Cmd-K reaches it', { timeout: 170000 }, async () => {
  const t = await setup();
  const { browser, io } = t;
  try {
    await setText(browser, 'h2', 'Fresh bread, hot');
    for (const th of ['light', 'dark']) {
      await select(browser, await nodeOf(browser, 'h2'));
      await theme(browser, th);
      assert.equal(await browser.eval(`document.documentElement.dataset.theme`), th);
      const stageBox = await browser.eval(`JSON.stringify(document.querySelector('#stage').getBoundingClientRect())`);
      if (th === 'light') { await io.key('k', { meta: true, ctrl: true }); await browser.waitFor(`!document.querySelector('#quick').hidden`); await browser.send('Input.insertText', { text: 'versions' }); await sleep(150); assert.match(await browser.eval(`document.querySelector('#q-list').textContent`), /film strip/i); await io.key('Enter'); }
      else await io.key('h');
      await browser.waitFor(`!document.querySelector('#time').hidden && document.querySelectorAll('#time .tm-tile').length >= 3`);
      await io.key('ArrowLeft');
      await previewReady(browser);
      await sleep(600);
      assert.equal(await browser.eval(`JSON.stringify(document.querySelector('#stage').getBoundingClientRect())`), stageBox, 'opening the strip does not move the stage (no layout shift)');
      await browser.eval(AXE);
      const found = JSON.parse(await browser.eval(`axe.run(document, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').slice(0, 160)) }))))`));
      assert.deepEqual(found.filter((v) => v.impact === 'serious' || v.impact === 'critical'), [], `${th}: ${JSON.stringify(found)}`);
      await shot(browser, `time-strip-${th}.png`);
      await io.key('Escape');
      await browser.waitFor(`document.querySelector('#time').hidden`);
      assert.equal(await browser.eval(`!!document.querySelector('.time-preview')`), false);
    }
  } finally { await t.stop(); }
});

test('M10 copy gives real code: the element\'s exact bytes and the exact CSS rules with file:line, as text and HTML; paste inserts it through one edit', { timeout: 170000 }, async () => {
  const t = await setup();
  const { browser, io, dir } = t;
  try {
    const p = await nodeOf(browser, 'p'), a = await nodeOf(browser, 'a'), card = await nodeOf(browser, 'div');
    await select(browser, a);
    await browser.waitFor(`napkin.copyCode && true`);
    await sleep(500);
    // the real chord: Cmd-C reaches the copy event; the toast says what was copied
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2, commands: ['copy'] });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 });
    await browser.waitFor(`/^Copied the <a> from card\\.html:\\d+, with 2 CSS rules/.test(document.querySelector('#hint').textContent)`);
    const got = await copyEvent(browser);
    assert.equal(got.prevented, true);
    assert.equal(got.html, '<a class="cta" href="#">Order</a>', 'text/html is the element\'s own markup');
    const css = readFileSync(join(dir, 'card.css'), 'utf8');
    const lines = css.split('\n');
    const rule = (from, to) => lines.slice(from - 1, to).join('\n');
    assert.ok(got.plain.startsWith('<a class="cta" href="#">Order</a>\n\n/* napkin: the CSS that applies */\n'), got.plain);
    assert.ok(got.plain.includes(`/* card.css:12 */\n${rule(12, 12)}`), 'the .cta rule, exact, with its file and line');
    assert.ok(got.plain.includes(`/* card.css:13 */\n${rule(13, 13)}`), 'the :hover rule applies too');
    assert.ok(!got.plain.includes('.unused'), 'a rule that does not match is left out');
    assert.ok(!got.plain.includes('.card h2'), 'and so is one for another element');
    assert.match(got.plain, /\/\* custom properties used: --accent \(card\.css:1\) \*\//);

    // a rule in an @media the frame answers to is included only when it applies; the card has two rules
    await select(browser, card);
    await sleep(500);
    const whole = await copyEvent(browser);
    assert.ok(whole.plain.startsWith(`<div class="card">\n  <h2>Fresh bread</h2>`), 'the element is its exact bytes, children and indentation included');
    assert.ok(whole.plain.includes(`/* card.css:2 */\n${rule(2, 8)}`), 'the multi-line rule keeps its odd spacing');
    assert.ok(!whole.plain.includes('max-width: 400px'), 'the narrow-screen rule does not apply at 640 px');

    // paste back: select the card, paste the link: one insert, appended as the last child, nothing else changed
    const html0 = file(dir);
    await select(browser, card);
    await sleep(300);
    assert.equal(await pasteEvent(browser, got.plain, got.html), true, 'napkin took the paste');
    await browser.waitFor(`document.querySelector('#hint').textContent.startsWith('Pasted the <a> into <div>')`);
    const after = file(dir);
    assert.notEqual(after, html0);
    assert.equal((after.match(/class="cta"/g) || []).length, 2);
    const hist = await (await fetch(new URL('api/component/card.html/history', t.s.url))).json();
    assert.equal(hist.history.length, 1, 'one edit');
    assert.equal(readFileSync(join(dir, 'card.css'), 'utf8'), css, 'the stylesheet is untouched');
    // one undo gives the file back exactly
    await io.key('z', { meta: true, ctrl: true });
    for (let i = 0; i < 100 && file(dir) !== html0; i++) await sleep(50);
    assert.equal(file(dir), html0, 'one undo gives the file back exactly');

    // text that is not markup is left alone
    await pasteEvent(browser, 'just some words'); await sleep(300);
    assert.equal(file(dir), html0, 'plain words are not code: nothing is inserted');
  } finally { await t.stop(); }
});

test('M9 at 1280x720 the strip fits: nothing overflows, the canvas keeps room', { timeout: 120000 }, async () => {
  const t = await setup({ width: 1280, height: 720 });
  const { browser, io } = t;
  try {
    await setText(browser, 'h2', 'Fresh bread, hot');
    for (const th of ['light', 'dark']) {
      await select(browser, await nodeOf(browser, 'h2')); await theme(browser, th);
      await io.key('h');
      await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 3`);
      await io.key('ArrowLeft'); await previewReady(browser); await sleep(500);
      const m = JSON.parse(await browser.eval(`JSON.stringify((() => { const r = document.querySelector('#time').getBoundingClientRect(), h = document.querySelector('.tm-head'), s = document.querySelector('#stage').getBoundingClientRect(); return { right: r.right <= s.right, headFits: h.scrollWidth <= h.clientWidth, height: r.height, stage: s.height, restoreVisible: document.querySelector('#time-restore').getBoundingClientRect().right <= r.right }; })())`));
      assert.deepEqual([m.right, m.headFits, m.restoreVisible], [true, true, true], JSON.stringify(m));
      assert.ok(m.height < m.stage * 0.3, `the strip takes under 30% of the canvas (${m.height} of ${m.stage})`);
      await shot(browser, `time-strip-1280-${th}.png`);
      await io.key('Escape'); await io.key('Escape');
      await browser.waitFor(`document.querySelector('#time').hidden`);
    }
  } finally { await t.stop(); }
});
