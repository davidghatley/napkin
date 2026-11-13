// Keys lane (whole-product walk 1): WPC-07 keyboard reach, WPC-08 Cmd-K selects, WPC-11 theme surface, WPC-13 snap toast with Undo,
// WPC-14 plain-language messages, WPC-15 no clipped labels. FEEL-05 re-walk, keyboard only, with a key counter:
//   EVIDENCE=1 node --test test/keys/keys.test.js   (writes docs/evidence/FEEL-05.txt and docs/evidence/keys-*.png)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { SIBLING_SOURCES } from '../helpers/siblings.js';
import { input } from '../helpers/input.js';
import { changedLines } from '../helpers/lab.js';
import { evidence } from '../helpers/agents.js';
import { plain } from '../../public/canvas/words.js';
import { explainError } from '../../src/errors.js';

test('WPC-14: person-facing wording never carries API or agent text', () => {
  assert.equal(plain('undo refused: nothing to undo Next: check this request against /api/guide, correct the named value, and retry.'), 'Nothing to undo yet.');
  assert.equal(plain('nothing to redo'), 'Nothing to redo yet.');
  for (const e of ['stale revision: Button.tsx changed', 'invalid edit #0: no node "x"', 'unknown thing', 'the image is too large. Next: send one under 8 MB.', 'POST /api/session failed Next: use /api/guide']) {
    const text = plain(explainError(e));
    assert.doesNotMatch(text, /Next:|\/api\/|check this request/, text);
  }
  // no toast, hint or inline error in the canvas source may print a server message without plain()
  for (const f of readdirSync(join(ROOT, 'public/canvas')).filter((x) => x.endsWith('.js') && x !== 'words.js')) { // words.js is the sanitizer itself
    const src = readFileSync(join(ROOT, 'public/canvas', f), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').split('\n').filter((l) => !/\.split\(/.test(l)).join('\n'); // stage.js cuts the agent text off with split('. Next:')
    assert.ok(!/['"`][^'"`\n]*\bNext:/.test(code), `${f} writes agent-facing "Next:" text`);
    // every inline message and banner that takes server text goes through plain() or stripNext() (no "invalid edit #n:" reaches a person)
    for (const line of src.split('\n')) if (/(?:errors?\[[^\]]*\]|errors\.\w+|\.textContent|\btext:)\s*=?\s*[^;\n]*\b(?:r|j|res|next|v|e)\??\.error\b/.test(line) && !/stripNext\(|plain\(|problemBanner\(|engineSentence\(/.test(line)) assert.fail(`${f}: server text shown without plain(): ${line.trim().slice(0, 120)}`);
    for (const m of src.matchAll(/ctx\.hint\(([^;\n]*)\)/g)) if (/\.error\b/.test(m[1])) assert.match(m[1], /plain\(/, `${f}: ctx.hint prints a raw server error: ${m[1]}`);
  }
});

const SURFACE = 'rgb(24, 32, 49)';
const luminance = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

async function repo({ extra = 0 } = {}) {
  const { dir, compDir, file, git } = tempRepo(['Button', 'Card', 'Chip']);
  writeFileSync(join(compDir, 'Badge.tsx'), SIBLING_SOURCES.Badge());
  for (let i = 0; i < extra; i++) writeFileSync(join(compDir, `Box${String(i).padStart(2, '0')}.tsx`), readFileSync(join(compDir, 'Chip.tsx'), 'utf8').replace(/Chip/g, `Box${i}`));
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  git('add', '-A'); git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'all');
  const server = await startServer(compDir), b = await launchChromium({ width: 1440, height: 900 }), io = input(b);
  await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
  return { dir, compDir, file, git, server, b, io, close: async () => { await b.close(); await server.stop(); } };
}
const palette = async (io, b, text) => { await io.key('k', { ctrl: true }); await b.waitFor(`!document.querySelector('#quick').hidden && document.activeElement.id === 'q-input'`); for (const ch of text) await io.key(ch); await io.key('Enter'); await sleep(250); };

test('WPC-07/08/15: Cmd-K reaches a layer and any property in <= 5 keys; tab order skips cells and collapse buttons; no clipped top bar', { timeout: 150000 }, async (t) => {
  const r = await repo({ extra: 20 }); const { b, io } = r;
  try {
    await t.test('WPC-08: Cmd-K "Badge" Enter selects the Badge root and the inspector shows it', async () => {
      await palette(io, b, 'Badge');
      assert.equal(await b.eval(`napkin.state.selection?.node`), 'root');
      assert.equal(await b.eval(`napkin.state.selection?.component === napkin.find('Badge').component`), true);
      assert.match(await b.eval(`document.querySelector('#panel').innerText`), /Badge/);
      assert.doesNotMatch(await b.eval(`document.querySelector('#panel').innerText`), /Nothing selected/);
    });
    await t.test('WPC-07: Cmd-K + "rad" + Enter (5 keys) puts the caret in Radius; Alt+I jumps to the inspector (1 key)', async () => {
      await b.eval(`document.activeElement.blur()`);
      await palette(io, b, 'rad');
      assert.equal(await b.eval(`document.activeElement.id`), 'borderRadius');
      await b.eval(`document.activeElement.blur()`);
      await io.key('i', { alt: true, code: 'KeyI' }); await sleep(100);
      assert.ok(await b.eval(`document.activeElement.closest('#panel') !== null`), 'Alt+I lands in the inspector');
      assert.equal(await b.eval(`(() => { napkin.select(null); return 1; })()`), 1);
      await io.key('i', { alt: true, code: 'KeyI' });
      assert.match(await b.eval(`document.querySelector('#hint').textContent`), /Select something first/);
      await palette(io, b, 'Badge');
    });
    await t.test('WPC-07: a component inside a cell is not a Tab stop; matrix bars are one roving stop', async () => {
      assert.equal(await b.eval(`[...document.querySelectorAll('.mount button, .mount input, .mount a, .mount select, .mount textarea')].filter((e) => e.tabIndex >= 0).length`), 0);
      assert.ok(await b.eval(`document.querySelectorAll('.mount button').length`) > 3, 'there are live buttons in the cells');
      await sleep(300);
      await b.eval(`napkin.select({ component: napkin.find('Chip').component, node: 'root', variant: {} })`); await sleep(200);
      const stops = JSON.parse(await b.eval(`JSON.stringify({ chip: [...document.querySelectorAll('section[data-name=Chip] .gtoggle')].filter((e) => e.tabIndex === 0).length, total: document.querySelectorAll('section[data-name=Chip] .gtoggle').length, others: [...document.querySelectorAll('section.cmp:not([data-name=Chip]) .gtoggle, section.cmp:not([data-name=Chip]) .mctl button')].filter((e) => e.tabIndex >= 0).length, rows: [...document.querySelectorAll('section[data-name=Chip] .mctl .mrow')].map((r) => [...r.querySelectorAll('button')].filter((e) => e.tabIndex === 0).length) })`));
      assert.ok(stops.total >= 4, 'Chip has collapse buttons: ' + JSON.stringify(stops));
      assert.equal(stops.chip, 1, JSON.stringify(stops));
      assert.equal(stops.others, 0, 'unselected components keep their bars out of the tab order');
      assert.ok(stops.rows.length >= 3 && stops.rows.every((n) => n === 1), JSON.stringify(stops));
      // arrows move inside the set, Tab never walks all of it
      const first = await b.eval(`document.querySelector('section[data-name=Chip] .gtoggle[tabindex="0"]').getAttribute('aria-label')`);
      await b.eval(`document.querySelector('section[data-name=Chip] .gtoggle[tabindex="0"]').focus()`);
      await io.key('ArrowRight');
      const second = await b.eval(`document.activeElement.getAttribute('aria-label')`);
      assert.notEqual(first, second); assert.equal(await b.eval(`document.activeElement.tabIndex`), 0);
      assert.equal(await b.eval(`document.activeElement.closest('section.cmp').querySelectorAll('.gtoggle[tabindex="0"]').length`), 1);
      await palette(io, b, 'Badge');
    });
    await t.test('WPC-07: a real Tab walk from the page to Radius never enters a cell or the 30 collapse buttons', async () => {
      await b.eval(`document.activeElement.blur(); document.body.focus()`);
      const path = []; let n = 0;
      for (; n < 60; n++) { await io.key('Tab'); const d = await b.eval(`(() => { const e = document.activeElement; return JSON.stringify({ id: e.id, inMount: !!e.closest('.mount'), toggle: e.classList.contains('gtoggle') }); })()`); path.push(JSON.parse(d)); if (path.at(-1).id === 'borderRadius') break; }
      assert.equal(path.at(-1).id, 'borderRadius', 'Tab reaches Radius');
      assert.equal(path.filter((p) => p.inMount).length, 0, 'no cell content in the tab order');
      assert.ok(path.filter((p) => p.toggle).length <= 1, 'at most one group bar stop');
      assert.ok(n + 1 <= 40, `${n + 1} Tabs (was 86)`);
      t.diagnostic(`Tab walk to Radius: ${n + 1} presses (walk 1: 86)`);
    });
    await t.test('WPC-07: play mode brings the cells back into the tab order, and leaving takes them out again', async () => {
      await b.eval(`document.activeElement.blur(); document.body.focus()`);
      await io.key('p'); await sleep(150);
      assert.ok(await b.eval(`[...document.querySelectorAll('.mount button')].some((e) => e.tabIndex >= 0)`), 'live in play');
      await io.key('Escape'); await sleep(700);
      assert.equal(await b.eval(`[...document.querySelectorAll('.mount button')].filter((e) => e.tabIndex >= 0).length`), 0);
    });
    await t.test('WPC-15: 1440x900 with tokens and Chip: no clipped top-bar label, filter bar inside its frame', async () => {
      await palette(io, b, 'Chip'); await b.waitFor(`!!document.querySelector('section[data-name=Chip] .mctl')`); await sleep(300);
      const m = JSON.parse(await b.eval(`(() => { const bar = document.querySelector('#topbar').getBoundingClientRect(); const kids = [...document.querySelectorAll('.top-right > *')].filter((e) => e.offsetParent !== null || e.getBoundingClientRect().width).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, l: r.left, r: r.right, clipped: e.scrollWidth > e.clientWidth + 1 }; });
        const s = document.querySelector('section[data-name=Chip]'), f = s.querySelector('.frame').getBoundingClientRect(), c = s.querySelector('.mctl').getBoundingClientRect();
        const over = [...s.querySelectorAll('.mctl *')].filter((e) => e.getBoundingClientRect().right > f.right + 1).length;
        return JSON.stringify({ bar: [bar.left, bar.right], kids, frameRight: f.right, mctlRight: c.right, over, rev: document.querySelector('#revision').textContent.length, overlap: (() => { const a = document.querySelector('#toolbar').getBoundingClientRect(), r = document.querySelector('.top-right').getBoundingClientRect(); return a.right <= r.left; })(), revClipped: document.querySelector('#revision').getBoundingClientRect().width < document.querySelector('#revision').scrollWidth }); })()`));
      assert.ok(m.kids.every((k) => !k.clipped), JSON.stringify(m.kids));
      assert.ok(m.kids.every((k, i) => k.r <= m.bar[1] + 1 && (i === 0 || k.l >= m.kids[i - 1].r - 1)), 'top-right children fit and do not overlap: ' + JSON.stringify(m.kids));
      assert.ok(!m.revClipped && m.rev === 8, 'the revision label is whole');
      assert.ok(m.overlap, 'toolbar, Jump to... and the right group do not overlap');
      assert.equal(m.over, 0, 'filter bar stays inside the frame'); assert.ok(m.mctlRight <= m.frameRight + 1);
      if (process.env.EVIDENCE) writeFileSync(join(ROOT, 'docs/evidence/keys-1440x900-chip.png'), await b.screenshot());
    });
  } finally { await r.close(); }
});

test('WPC-11/13/14: dark theme cells use the theme surface; a snap names its token and offers Undo; empty undo is plain', { timeout: 120000 }, async (t) => {
  const r = await repo(); const { b, io, file } = r;
  writeFileSync(file, readFileSync(file, 'utf8').replace('borderRadius: 6', 'borderRadius: 7').replace("background: '#2236b0'", "background: 'var(--accent)'").replace("color: '#f9f9f5'", "color: 'var(--on-accent)'"));
  try {
    await b.waitFor(`napkin.find('Button').doc.root && JSON.stringify(napkin.find('Button').doc).includes('var(--accent)')`);
    await t.test('WPC-14: Cmd-Z with nothing to undo says so in plain words', async () => {
      await b.eval(`document.body.focus()`);
      await io.key('z', { ctrl: true }); await sleep(500);
      const hint = await b.eval(`document.querySelector('#hint').textContent`);
      assert.match(hint, /Nothing to undo/i); assert.doesNotMatch(hint, /Next:|api|request/i);
    });
    await t.test('WPC-11: component theme dark: cells sit on the dark surface and every cell is readable', async () => {
      await b.eval(`document.documentElement.dataset.theme = 'light'; { const t = document.querySelector('#token-theme'); t.value = 'dark'; t.dispatchEvent(new Event('change')); }`); await sleep(300);
      const info = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('.frame')].map((f) => ({ bg: getComputedStyle(f).backgroundColor, ink: getComputedStyle(f).color })))`));
      assert.ok(info.length >= 3 && info.every((x) => x.bg === SURFACE), JSON.stringify(info));
      assert.ok(info.every((x) => contrast(rgb(x.bg), rgb(x.ink)) >= 4.5));
      const cells = JSON.parse(await b.eval(`JSON.stringify([...document.querySelectorAll('section[data-name=Button] .cell[data-variant*=\"default\"] .mount [data-n=root]')].map((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, fg: cs.color, frame: getComputedStyle(e.closest('.frame')).backgroundColor }; }))`));
      assert.ok(cells.length >= 3);
      for (const c of cells) { assert.ok(contrast(rgb(c.bg), rgb(c.frame)) >= 3 || contrast(rgb(c.fg), rgb(c.bg)) >= 3, JSON.stringify(c)); assert.ok(contrast(rgb(c.fg), rgb(c.bg)) >= 3 || /rgba\(0, 0, 0, 0\)/.test(c.bg), JSON.stringify(c)); }
      if (process.env.EVIDENCE) { await b.eval(`napkin.view.fitAll({ max: 1 })`); await sleep(300); writeFileSync(join(ROOT, 'docs/evidence/keys-dark-theme.png'), await b.screenshot()); }
      await b.eval(`const t = document.querySelector('#token-theme'); t.value = 'light'; t.dispatchEvent(new Event('change'))`); await sleep(200);
      assert.equal(await b.eval(`getComputedStyle(document.querySelector('.frame')).backgroundColor`), 'rgb(243, 245, 250)', 'light theme: the light surface');
    });
    await t.test('WPC-13: the off-token dot says where it goes, then a toast names the token and Undo restores the value', async () => {
      await b.eval(`napkin.select({component: napkin.find('Button').component, node:'root', variant:{size:'md',state:'default'}})`);
      await b.waitFor('!!document.querySelector("#off-token-borderRadius")');
      assert.match(await b.eval(`document.querySelector('#off-token-borderRadius').title`), /Snap 7 to radius-medium \(8px\)/);
      const before = readFileSync(file, 'utf8');
      await b.eval('document.querySelector("#off-token-borderRadius").click()');
      await b.waitFor('document.querySelector("#borderRadius").value === "radius-medium"');
      await b.waitFor('!document.querySelector("#snap-toast")?.hidden');
      assert.match(await b.eval(`document.querySelector('#snap-toast').textContent`), /Snapped borderRadius 7 to radius-medium \(8px\)/);
      assert.deepEqual(changedLines(before, readFileSync(file, 'utf8')), { added: 1, removed: 1 });
      await b.eval(`document.querySelector('#snap-undo').click()`);
      await b.waitFor(`document.querySelector("#borderRadius").value === "7"`);
      assert.equal(readFileSync(file, 'utf8'), before, 'Undo puts the file back exactly');
      assert.equal(await b.eval(`document.querySelector('#snap-toast').hidden`), true);
    });
  } finally { await r.close(); }
});

test('FEEL-05 re-walk: ~40 components, keyboard only, counted keys', { timeout: 180000 }, async () => {
  const r = await repo({ extra: 36 }); const { b, io, compDir, git } = r;
  const log = []; let keys = 0;
  const press = async (key, o) => { keys++; await io.key(key, o); };
  const typed = async (text) => { for (const ch of text) await press(ch); };
  const step = (what, k0) => log.push(`${String(keys - k0).padStart(3)} keys  ${what}`);
  try {
    const nComp = await b.eval(`napkin.state.components.size`);
    // 1. Cmd-K "Badge" Enter
    let k0 = keys;
    await press('k', { ctrl: true }); await b.waitFor(`!document.querySelector('#quick').hidden`); await typed('Badge'); await press('Enter'); await sleep(300);
    assert.equal(await b.eval(`napkin.state.selection?.node`), 'root'); assert.match(await b.eval(`document.querySelector('#panel').innerText`), /Badge/);
    step('Ctrl+K, B-a-d-g-e, Enter: Badge root selected, inspector shows it (walk 1: needed a second Enter)', k0);
    // 2. Cmd-K "rad" Enter focuses Radius
    k0 = keys;
    await press('k', { ctrl: true }); await b.waitFor(`!document.querySelector('#quick').hidden`); await typed('rad'); await press('Enter'); await sleep(200);
    assert.equal(await b.eval(`document.activeElement.id`), 'borderRadius');
    step('Ctrl+K, r-a-d, Enter: caret in Radius (walk 1: "Nothing matches", then 86 Tabs)', k0);
    const selectionToProperty = keys - k0;
    assert.ok(selectionToProperty <= 5);
    // 3. set 24
    k0 = keys;
    const before = readFileSync(join(compDir, 'Badge.tsx'), 'utf8');
    await typed('24'); await press('Enter'); await b.waitFor(`napkin.find('Badge').doc.root.style.borderRadius === 24`);
    step('2, 4, Enter: radius 24 written', k0);
    const cells = await b.eval(`JSON.stringify([...document.querySelectorAll('section[data-name=Badge] .cell .mount [data-n=root]')].map((e) => e.offsetWidth > 0 && getComputedStyle(e).borderRadius))`);
    assert.ok(JSON.parse(cells).every((x) => x === '24px'), cells);
    const diff = git('diff', '--stat', '--', 'components/Badge.tsx'), changed = changedLines(before, readFileSync(join(compDir, 'Badge.tsx'), 'utf8'));
    const unified = git('diff', '-U0', '--', 'components/Badge.tsx').split('\n').filter((l) => /^[+-][^+-]/.test(l));
    assert.ok(changed.added === 1 && changed.removed <= 1 && unified.length <= 2, JSON.stringify({ changed, unified }));
    // 4. the other keyboard route: Alt+I then Tab
    await b.eval(`document.activeElement.blur(); napkin.select(null)`);
    await palette(io, b, 'Badge');
    await b.eval(`document.body.focus()`);
    let k1 = 0; await io.key('i', { alt: true, code: 'KeyI' }); k1++;
    for (; k1 < 60; k1++) { if (await b.eval(`document.activeElement.id`) === 'borderRadius') break; await io.key('Tab'); }
    const altI = k1;
    // 5. Tab walk from the page (the walk-1 method)
    await b.goto(r.server.url); await b.waitFor('document.body.dataset.ready === "1"'); await sleep(500); // a fresh page, like walk 1's Tab count
    await b.eval(`napkin.select({ component: napkin.find('Badge').component, node: 'root', variant: {} })`); await sleep(200);
    let tabs = 0; const path = [];
    for (; tabs < 120; tabs++) { await io.key('Tab'); const at = await b.eval(`(() => { const e = document.activeElement; return (e.id || e.className || e.tagName) + (e.closest('section.cmp') ? ' [in ' + e.closest('section.cmp').dataset.name + ']' : ''); })()`); path.push(at); if (at === 'borderRadius') break; }
    log.push(`${String(tabs + 1).padStart(3)} Tabs  plain Tab walk from the page to Radius with Badge selected (walk 1: 86); no cell content, one stop per matrix group set`);
    log.push(`${String(altI).padStart(3)} keys  Alt+I (jump to inspector) then Tab to Radius`);
    assert.ok(tabs + 1 <= 40, `tab walk ${tabs + 1}, alt+I ${altI}: ${path.join(' | ')}`);
    evidence('FEEL-05', `FEEL-05  S1 keyboard only (no mouse events), re-walked after the keys lane (WPC-07/08/11/13/14/15).\nRe-run: EVIDENCE=1 node --test test/keys/keys.test.js\nRepo: ${nComp} components (Button, Card, Chip, Badge + 36 Chip copies), tokens configured, 1440x900 Chromium, real CDP key events.\nEvery key below is a real key press (Shift not needed for letters; typed text counts one key per character).\n\n${log.join('\n')}\n\nSelection -> any property: ${selectionToProperty} keys (bar: <= 5). Open -> Badge root selected -> Radius focused: ${log.slice(0, 2).map((l) => parseInt(l)).reduce((a, c) => a + c, 0)} keys, then 3 to set 24.\ngit diff of the whole walk: ${diff.trim().split('\n').at(-1).trim()}\n${unified.join('\n')}\nVERDICT: COMPLETED keyboard-only in ${keys} keys with no Tab flood.`);
    if (process.env.EVIDENCE) writeFileSync(join(ROOT, 'docs/evidence/keys-feel05-radius.png'), await b.screenshot());
  } finally { await r.close(); }
});
