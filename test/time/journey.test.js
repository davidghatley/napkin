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

test('M9 a film strip of time: scrub the versions, see each on the canvas, restore one as a single undo step', { timeout: 170000 }, async () => {
  const t = await setup();
  const { browser, io, dir } = t;
  try {
    const before = hashes(dir);
    for (const v of ['Fresh bread daily', 'Fresh bread daily, hot', 'Bakery']) assert.equal(await setText(browser, 'h2', v), true);
    await browser.waitFor(`document.querySelector('.doc-frame')?.contentDocument?.querySelector('h2')?.textContent === 'Bakery'`);
    const newest = file(dir);

    // 1. Select the component's heading and press H: the strip opens under the canvas, "Now" is picked
    await select(browser, await nodeOf(browser, 'h2'));
    await io.key('h');
    await browser.waitFor(`!document.querySelector('#time').hidden && document.querySelectorAll('#time .tm-tile').length >= 5`);
    let tl = await tiles(browser);
    // oldest first: the two git commits, the file as napkin first saw it (= the second commit), three edits? (the first-seen frame equals HEAD), then Now
    assert.equal(tl.at(-1).source, 'now'); assert.equal(tl.at(-1).sel, 'true');
    assert.equal(tl.filter((x) => x.source === 'git').length, 2, 'both commits of the file are frames');
    assert.equal(tl.filter((x) => x.source === 'napkin').length, 3, 'as first seen and two edits; the newest text is Now');
    assert.match(tl[0].label, /first card/); assert.match(tl[0].label, /Ada/);
    assert.equal(await browser.eval(`document.body.dataset.timeOpen`), '1');

    // 2. Scrub with the arrow keys: the frame on the canvas shows each older version, drawn from that version's bytes
    await io.key('ArrowLeft');
    await browser.waitFor(`document.querySelector('.time-preview')?.dataset.ready === '1'`);
    assert.equal(await previewText(browser), 'Fresh bread daily, hot');
    assert.equal(await liveText(browser), 'Bakery', 'the live frame waits underneath, untouched');
    assert.equal(file(dir), newest, 'previewing writes nothing');
    await io.key('ArrowLeft'); await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('h2')?.textContent === 'Fresh bread daily'`);
    await io.key('ArrowLeft'); await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('h2')?.textContent === 'Fresh bread'`);
    await io.key('Home');
    await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('h2')?.textContent === 'Fresh'`);
    assert.match(await browser.eval(`document.querySelector('#time-info').textContent`), /Against now: \d+ lines? removed/);
    assert.equal(await browser.eval(`getComputedStyle(document.querySelector('.doc-frame')).visibility`), 'hidden');
    assert.equal(await browser.eval(`getComputedStyle(document.querySelector('.doc-cell'), '::after').content`), '"Earlier version, not saved"');
    await shot(browser, 'time-strip-light.png');

    // 3. Pointer scrub: press on a tile and drag across the strip
    const pos = JSON.parse(await browser.eval(`JSON.stringify([...document.querySelectorAll('#time .tm-tile')].map((n) => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 30]; }))`));
    await io.press(pos[3][0], pos[3][1]); await io.move(pos[2][0], pos[2][1], { buttons: 1 }); await io.release(pos[2][0], pos[2][1]);
    await browser.waitFor(`document.querySelector('#time .tm-tile[aria-selected="true"]')?.dataset.i === '2'`);

    // 4. Restore the git "first card" version: ONE new edit through the engine; the diff is the difference to that version
    await io.key('Home');
    await browser.waitFor(`document.querySelector('.time-preview')?.contentDocument?.querySelector('h2')?.textContent === 'Fresh'`);
    const firstCommit = execFileSync('git', ['-C', dir, 'show', 'HEAD~1:card.html']).toString();
    await io.key('Enter');
    await browser.waitFor(`document.querySelector('#hint')?.textContent.startsWith('Restored the version')`);
    assert.equal(file(dir), firstCommit, 'the file is exactly that commit\'s version');
    await browser.waitFor(`!document.querySelector('.time-preview') && document.querySelector('.doc-frame')?.contentDocument?.querySelector('h2')?.textContent === 'Fresh'`);
    const hist = await (await fetch(new URL('api/component/card.html/history', t.s.url))).json();
    assert.match(hist.history[0].summary, /^Restored the version from/);
    assert.equal(hist.history.length, 4, 'three edits and one restore');
    // one undo gives the newest text back, byte for byte
    await io.key('z', { meta: true, ctrl: true });
    await browser.waitFor(`document.querySelector('.doc-frame')?.contentDocument?.querySelector('h2')?.textContent === 'Bakery'`);
    assert.equal(file(dir), newest, 'one undo undid the whole restore');
    // the strip grew by the restore (and the undo) and still opens at Now
    await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 7`);

    // 5. Escape: first back to Now, then closes
    await io.key('Home'); await io.key('Escape');
    await browser.waitFor(`document.querySelector('#time .tm-tile[aria-selected="true"]')?.dataset.source === 'now' || document.querySelector('#time').hidden`);
    assert.deepEqual(Object.keys(hashes(dir)).sort(), Object.keys(before).sort(), 'no file was added to the folder');
    assert.equal(execFileSync('git', ['-C', dir, 'log', '--oneline']).toString().trim().split('\n').length, 2, 'git history untouched');
  } finally { await t.stop(); }
});

test('M9 thumbnails are lazy: a long history never draws more than the strip shows', { timeout: 170000 }, async () => {
  const t = await setup();
  const { browser, io } = t;
  try {
    for (let i = 0; i < 40; i++) await setText(browser, 'h2', `Version ${i}`);
    await select(browser, await nodeOf(browser, 'h2'));
    await io.key('h');
    await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 40`);
    await browser.waitFor(`document.querySelectorAll('#time .tm-thumb iframe[data-ready]').length >= 3`, 15000);
    const n = await browser.eval(`document.querySelectorAll('#time .tm-thumb iframe').length`);
    const total = await browser.eval(`document.querySelectorAll('#time .tm-tile').length`);
    assert.ok(n < total / 2, `${n} thumbnails drawn for ${total} frames (only those in view)`);
    assert.equal(await browser.eval(`[...document.querySelectorAll('#time .tm-thumb iframe')].every((f) => /allow-same-origin/.test(f.getAttribute('sandbox')) && !/allow-scripts/.test(f.getAttribute('sandbox')))`), true, 'an HTML file\'s thumbnails run no scripts');
    // the canvas itself is not held up: a frame renders in the time it takes with the strip closed (generous bound)
    const ms = await browser.eval(`(async () => { const t0 = performance.now(); for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame); return performance.now() - t0; })()`);
    assert.ok(ms < 1500, `20 animation frames took ${Math.round(ms)} ms with the strip open`);
    // scrolling far brings others in and drops the ones that left
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
      await browser.waitFor(`!document.querySelector('#time').hidden && document.querySelectorAll('#time .tm-tile').length >= 2`);
      await io.key('ArrowLeft');
      await browser.waitFor(`document.querySelector('.time-preview')?.dataset.ready === '1'`);
      await sleep(600);
      assert.equal(await browser.eval(`JSON.stringify(document.querySelector('#stage').getBoundingClientRect())`), stageBox, 'opening the strip does not move the stage (no layout shift)');
      await browser.eval(AXE);
      const found = JSON.parse(await browser.eval(`axe.run(document, { resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').slice(0, 160)) }))))`));
      assert.deepEqual(found.filter((v) => v.impact === 'serious' || v.impact === 'critical'), [], `${th}: ${JSON.stringify(found)}`);
      await shot(browser, `time-strip-${th}.png`);
      await io.key('Escape'); await io.key('Escape');
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
      await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 4`);
      await io.key('ArrowLeft'); await browser.waitFor(`document.querySelector('.time-preview')?.dataset.ready === '1'`); await sleep(500);
      const m = JSON.parse(await browser.eval(`JSON.stringify((() => { const r = document.querySelector('#time').getBoundingClientRect(), h = document.querySelector('.tm-head'), s = document.querySelector('#stage').getBoundingClientRect(); return { right: r.right <= s.right, headFits: h.scrollWidth <= h.clientWidth, height: r.height, stage: s.height, restoreVisible: document.querySelector('#time-restore').getBoundingClientRect().right <= r.right }; })())`));
      assert.deepEqual([m.right, m.headFits, m.restoreVisible], [true, true, true], JSON.stringify(m));
      assert.ok(m.height < m.stage * 0.3, `the strip takes under 30% of the canvas (${m.height} of ${m.stage})`);
      await shot(browser, `time-strip-1280-${th}.png`);
      await io.key('Escape'); await io.key('Escape');
      await browser.waitFor(`document.querySelector('#time').hidden`);
    }
  } finally { await t.stop(); }
});
