// Keys lane, critic round 2 on c5f48be: every inspector control by Cmd-K (WPC-07), a demo that reads in both themes (WPC-11),
// the snap toast by keyboard and every off-token dot (WPC-13), no jargon anywhere a person reads (WPC-14), 1280x720 (WPC-15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';
import { SERVER_FLAGS } from '../../src/node-flags.js';
import { connectCanvas } from '../../src/canvas-client.js';
import { plain, stripNext, problemBanner } from '../../public/canvas/words.js';
import { explainError } from '../../src/errors.js';

async function repo(size = [1440, 900]) {
  const { dir, compDir, file, git } = tempRepo(['Button', 'Card', 'Chip']);
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  const server = await startServer(compDir), b = await launchChromium({ width: size[0], height: size[1] }), io = input(b);
  await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
  return { dir, compDir, file, git, server, b, io, close: async () => { await b.close(); await server.stop(); } };
}
const palette = async (io, b, text) => { await io.key('k', { ctrl: true }); await b.waitFor(`!document.querySelector('#quick').hidden && document.activeElement.id === 'q-input'`); for (const ch of text) await io.key(ch); await io.key('Enter'); await sleep(250); };
// A real mouse click at the control's hit-tested coordinates (an element something else covers fails here, unlike .click()).
async function mouseClick(b, io, selector) {
  await b.eval(`document.querySelectorAll('#panel details').forEach((d) => (d.open = true)); document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`); await sleep(150);
  const probe = async () => JSON.parse(await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}), r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y); window.__probe = e; return JSON.stringify({ x, y, ok: !!hit && (hit === e || e.contains(hit)), hit: hit && (hit.id || hit.className || hit.tagName) }); })()`));
  let r = await probe();
  for (let i = 0; i < 20; i++) { await sleep(120); const next = await probe(); const same = next.x === r.x && next.y === r.y; r = next; if (same) break; } // wait until the panel has stopped redrawing
  await io.move(r.x, r.y); await sleep(200); // hover first, like a person: nothing may move out from under the pointer
  const after = await probe();
  assert.ok(Math.abs(after.x - r.x) < 1 && Math.abs(after.y - r.y) < 1, `${selector} moved when hovered: ${r.x},${r.y} -> ${after.x},${after.y}`);
  assert.ok(after.ok, `${selector} is covered by ${after.hit}`);
  await io.press(after.x, after.y); await io.release(after.x, after.y);
}
const selectButton = (b, variant = { size: 'md', state: 'default' }, node = 'root') => b.eval(`napkin.select({ component: napkin.find('Button').component, node: ${JSON.stringify(node)}, variant: ${JSON.stringify(variant)} })`).then(() => sleep(250));

test('WPC-07: any inspector property in <= 5 keys, sections open, variant scope, empty-panel hint', { timeout: 150000 }, async (t) => {
  const r = await repo(); const { b, io } = r;
  try {
    await selectButton(b);
    const cases = [['rad', 'borderRadius'], ['fc', 'background'], ['fil', 'sum-fill'], ['sc', 'stroke-color'], ['str', 'sum-stroke'], ['sha', 'add-effects'], ['ali', /^align-/], ['sl', 'propdef-label'], ['gap', 'gap'], ['wei', 'fontWeight']];
    for (const [q, want] of cases) await t.test(`Cmd-K "${q}" Enter (${q.length + 2} keys) lands on ${want}`, async () => {
      await b.eval(`document.activeElement.blur()`);
      await palette(io, b, q);
      const id = await b.eval(`document.activeElement.id`);
      assert.ok(want instanceof RegExp ? want.test(id) : id === want, `"${q}" landed on "${id}"`);
      assert.equal(await b.eval(`!!document.activeElement.closest('#panel')`), true);
    });
    await t.test('the labels the ? sheet promises are in the index: Fill colour, Stroke colour, Shadow, Align, Settings label', async () => {
      const labels = await b.eval(`(napkin.quick.build(), napkin.quick.build().filter((i) => i.kind === 'property').map((i) => i.label))`);
      const lower = labels.map((x) => x.toLowerCase());
      for (const l of ['Fill Colour', 'Stroke Colour', 'Shadow', 'Align top left', 'Settings label', 'Radius', 'Gap', 'Editing']) assert.ok(lower.includes(l.toLowerCase()), `${l} in ${labels.join(', ')}`);
    });
    await t.test('a folded section opens when the search lands in it', async () => {
      await b.eval(`document.querySelector('details[data-sec="stroke"]').open = false; document.querySelector('details[data-sec="stroke"]').dispatchEvent(new Event('toggle'))`);
      await selectButton(b);
      await b.eval(`(() => { const d = document.querySelector('details[data-sec="stroke"]'); d.open = false; d.dispatchEvent(new Event('toggle')); })()`);
      await palette(io, b, 'sc');
      assert.equal(await b.eval(`document.activeElement.id`), 'stroke-color');
      assert.equal(await b.eval(`document.activeElement.closest('details').open`), true);
    });
    await t.test('with a variant cell selected, a property search lands in that variant\'s scope', async () => {
      await selectButton(b, { size: 'sm', state: 'default' });
      assert.equal(await b.eval(`document.querySelector('#scope').value`), 'base');
      await palette(io, b, 'rad');
      assert.equal(await b.eval(`document.querySelector('#scope').value`), 'variant');
      assert.equal(await b.eval(`document.activeElement.id`), 'borderRadius');
      await b.eval(`document.querySelector('#scope').value = 'base'; document.querySelector('#scope').dispatchEvent(new Event('change', { bubbles: true }))`);
    });
    await t.test('the empty panel lists Alt+I and property search', async () => {
      await b.eval(`napkin.select(null)`); await sleep(200);
      const text = await b.eval(`document.querySelector('#panel').innerText`);
      assert.match(text, /Alt\+I/); assert.match(text, /type a property/);
    });
  } finally { await r.close(); }
});

test('WPC-11: the demo reads in both themes: every text node in every cell is >= 3:1', { timeout: 120000 }, async () => {
  const proc = spawn(process.execPath, [...SERVER_FLAGS, join(ROOT, 'src/server.js'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const url = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no demo server: ' + out)), 8000); proc.stdout.on('data', (d) => { out += d; const m = out.match(/napkin canvas: (http:\/\/127\.0\.0\.1:\d+\/)/); if (m) { clearTimeout(t); res(m[1]); } }); proc.stderr.on('data', (d) => (out += d)); });
  const b = await launchChromium({ width: 1440, height: 900 });
  try {
    await b.goto(url); await b.waitFor('document.body.dataset.ready === "1"'); await sleep(500);
    const measure = `(() => {
      const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const rgba = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { c: m.slice(0, 3), a: m[3] ?? 1 }; };
      const over = (top, under) => ({ c: top.c.map((v, i) => v * top.a + under[i] * (1 - top.a)), a: 1 });
      const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) { chain.push(rgba(getComputedStyle(e).backgroundColor)); if (e.classList?.contains('frame')) break; } let acc = [255, 255, 255]; for (const l of chain.reverse()) acc = over(l, acc).c; return acc; };
      const bad = [], all = [];
      for (const cell of document.querySelectorAll('.cell')) {
        if (cell.closest('.mhide')) continue;
        for (const el of cell.querySelectorAll('.mount *')) {
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const fg = rgba(getComputedStyle(el).color), bg = bgOf(el), fgc = over(fg, bg).c;
          const [x, y] = [lum(fgc), lum(bg)].sort((p, q) => q - p); const ratio = (x + 0.05) / (y + 0.05);
          all.push(ratio); if (ratio < 3) bad.push({ comp: cell.closest('section').dataset.name, v: cell.dataset.variant, ratio: +ratio.toFixed(2) });
        }
      }
      return JSON.stringify({ n: all.length, bad });
    })()`;
    for (const theme of ['light', 'dark']) {
      await b.eval(`{ const t = document.querySelector('#token-theme'); t.value = ${JSON.stringify(theme)}; t.dispatchEvent(new Event('change')); }`); await sleep(400);
      const m = JSON.parse(await b.eval(measure));
      assert.ok(m.n >= 60, `${m.n} text nodes measured`);
      assert.deepEqual(m.bad, [], `${theme}: text under 3:1`);
    }
  } finally { await b.close(); proc.kill('SIGTERM'); }
});

test('WPC-13: the snap toast works from the keyboard; every off-token dot does something', { timeout: 150000 }, async (t) => {
  const r = await repo(); const { b, io, file } = r;
  writeFileSync(file, readFileSync(file, 'utf8').replace('borderRadius: 6', 'borderRadius: 7'));
  try {
    await b.waitFor(`napkin.find('Button').doc.root.style.borderRadius === 7`);
    for (const key of ['Enter', ' ']) await t.test(`Undo activates on ${key === ' ' ? 'Space' : key}`, async () => {
      await selectButton(b);
      await b.waitFor('!!document.querySelector("#off-token-borderRadius")');
      await b.eval('document.querySelector("#off-token-borderRadius").click()');
      await b.waitFor('document.querySelector("#borderRadius").value === "radius-medium" && !document.querySelector("#snap-toast").hidden');
      await b.eval(`document.querySelector('#snap-undo').focus()`);
      await io.key(key);
      await b.waitFor(`napkin.find('Button').doc.root.style.borderRadius === 7`);
    });
    await t.test('every off-token dot of every node snaps (toast) or opens the picker; none is inert', async () => {
      const nodes = JSON.parse(await b.eval(`JSON.stringify([...napkin.state.components.values()].flatMap((c) => { const out = []; (function w(n) { out.push([c.name, n.id]); n.children.forEach(w); })(c.doc.root); return out; }))`));
      let clicked = 0;
      for (const [c, n] of nodes) {
        await b.eval(`napkin.select({ component: napkin.find(${JSON.stringify(c)}).component, node: ${JSON.stringify(n)}, variant: Object.fromEntries((napkin.find(${JSON.stringify(c)}).doc.props || []).filter((p) => p.type === 'enum').map((p) => [p.name, p.default])) })`); await sleep(600);
        for (const prop of ['color', 'background', 'stroke-color', 'borderRadius', 'padding', 'fontSize']) {
          if (!await b.eval(`!!document.querySelector('#off-token-${prop}')`)) continue;
          await b.eval(`document.querySelector('#snap-toast') && (document.querySelector('#snap-toast').hidden = true)`);
          const before = await b.eval(`document.querySelector('#${prop}').value`);
          await mouseClick(b, io, `#off-token-${prop}`); await b.waitFor(`!!document.querySelector('#token-picker') || document.querySelector('#snap-toast')?.hidden === false`, 4000).catch(() => null); await sleep(150);
          const did = await b.eval(`({ picker: !!document.querySelector('#token-picker'), toast: document.querySelector('#snap-toast')?.hidden === false, after: document.querySelector('#${prop}')?.value })`);
          assert.ok(did.picker || (did.toast && did.after !== before), `${c}.${n} ${prop}: ${JSON.stringify({ before, ...did })}`);
          clicked++;
          await b.eval(`document.querySelector('#token-picker-close')?.click()`);
          if (did.toast) { await b.eval(`document.querySelector('#snap-undo').click()`); await sleep(300); }
        }
      }
      assert.ok(clicked >= 8, `${clicked} dots clicked`);
    });
  } finally { await r.close(); }
});

test('WPC-14: wording a person reads has no jargon: banners, connection loss, OS errors, bad values, stale edits', { timeout: 150000 }, async (t) => {
  await t.test('unit: banner, interruption, OS errors', () => {
    const banner = problemBanner('Button.tsx', 'Button.tsx: line 3: Unexpected token (3:9). Next: fix the syntax error at line 3, then save; napkin reloads it.');
    assert.match(banner, /^Button\.tsx has a syntax error at line 3\. Showing the last version that worked\. Fix the file and save\.$/);
    const lost = plain('stale revision: the connection to napkin was interrupted. Next: read the component again, then retry (the edit may have landed).');
    assert.doesNotMatch(lost, /stale|revision|Next:|retry/i); assert.match(lost, /connection/);
    assert.doesNotMatch(stripNext('stale revision: the connection to napkin was interrupted. Next: x'), /stale/i);
    for (const code of ['EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EBUSY']) {
      const raw = `${code}: nope, open '/tmp/napkin-x/.Button.tsx.tmp-123-4'`;
      for (const text of [plain(raw), stripNext(raw), plain(explainError(new Error(raw)))]) { assert.match(text, /Button\.tsx/); assert.doesNotMatch(text, /E[A-Z]{3,5}\b|\/tmp|\.tmp-|Next:/); }
    }
  });
  await t.test('no banner or inline text in the canvas source prints c.problem or a raw message', () => {
    for (const f of readdirSync(join(ROOT, 'public/canvas')).filter((x) => x.endsWith('.js') && x !== 'words.js')) {
      const src = readFileSync(join(ROOT, 'public/canvas', f), 'utf8');
      for (const line of src.split('\n')) if (/(?:textContent|text:|innerHTML)[^;\n]*\b(?:c|f|r)\.problem\b/.test(line)) assert.match(line, /problemBanner/, `${f} prints c.problem raw`);
      assert.ok(!/stale revision:/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\^stale revision[^/]*\//g, '')), `${f} writes "stale revision:" text`);
    }
    const client = readFileSync(join(ROOT, 'src/canvas-client.js'), 'utf8');
    assert.ok(/interrupted/.test(client));
  });
  const r = await repo(); const { b, io, file, compDir } = r;
  try {
    await t.test('a broken file shows a plain banner on its frame', async () => {
      const good = readFileSync(file, 'utf8');
      writeFileSync(file, good.replace('export function Button', 'export function Button ((('));
      await b.waitFor(`document.querySelector('section[data-name=Button] .problem').textContent.length > 0`, 8000);
      const text = await b.eval(`document.querySelector('section[data-name=Button] .problem').textContent`);
      assert.match(text, /^Button\.tsx has a syntax error at line \d+\. Showing the last version that worked\. Fix the file and save\.$/, text);
      writeFileSync(file, good);
      await b.waitFor(`document.querySelector('section[data-name=Button] .problem').textContent === ''`, 8000);
    });
    await t.test('values the browser would refuse are not written; the field says why', async () => {
      await selectButton(b);
      const before = readFileSync(file, 'utf8');
      for (const [id, bad] of [['background', 'banana'], ['width', 'NaN'], ['padding', 'abc def'], ['color', 'notacolor'], ['borderRadius', 'round']]) {
        await b.eval(`(() => { document.querySelectorAll('#panel details').forEach((d) => (d.open = true)); const e = document.querySelector('#${id}'); e.scrollIntoView(); e.focus(); e.select(); })()`); assert.equal(await b.eval('document.activeElement.id'), id);
        await b.send('Input.insertText', { text: bad }); await io.key('Enter'); await sleep(350);
        const msg = await b.eval(`document.querySelector('#err-style-${id}')?.textContent ?? ''`);
        assert.match(msg, new RegExp(`"${bad}" is not something`), `${id}: ${msg}`);
        assert.doesNotMatch(msg, /Next:|invalid edit|api/i);
        assert.equal(readFileSync(file, 'utf8'), before, `${id}=${bad} was written`);
        await selectButton(b);
      }
    });
    await t.test('an edit after someone changed the same property shows a message (chip or inline), never silence', async () => {
      await selectButton(b);
      await b.eval(`(() => { const e = document.querySelector('#gap'); e.scrollIntoView(); e.focus(); })()`); await sleep(100);
      writeFileSync(file, readFileSync(file, 'utf8').replace("gap: 8,", 'gap: 20,').replace("gap: '8px',", "gap: '20px',")); await sleep(900);
      await b.eval(`(() => { const e = document.querySelector('#gap'); e.focus(); e.select(); })()`);
      await b.send('Input.insertText', { text: '14' }); await io.key('Enter'); await sleep(700);
      const seen = await b.eval(`JSON.stringify({ chip: !!document.querySelector('.clash-chip'), err: document.querySelector('#err-style-gap')?.textContent ?? '', value: napkin.find('Button').doc.root.style.gap })`);
      t.diagnostic(seen);
      const s = JSON.parse(seen);
      assert.ok(s.chip || s.err, 'a chip or a message must say what happened: ' + seen);
      if (s.chip) assert.match(await b.eval(`document.querySelector('.clash-chip').textContent`), /already saved/);
      if (s.err) assert.doesNotMatch(s.err, /stale revision|Next:/);
    });
  } finally { await r.close(); }
  await t.test('a lost connection and a read-only folder read as sentences', async () => {
    const { compDir: dir2 } = tempRepo(['Button']);
    const server = await startServer(dir2);
    const client = await connectCanvas(server.url);
    try {
      const comp = client.components()[0], rev = comp.revision;
      chmodSync(dir2, 0o555);
      const denied = await client.sendEdits(comp.component, rev, [{ op: 'set', path: 'root.gap', value: 3 }]);
      chmodSync(dir2, 0o755);
      assert.equal(denied.ok, false);
      for (const text of [plain(denied.error), stripNext(denied.error)]) { assert.match(text, /Button\.tsx/, text); assert.doesNotMatch(text, /EACCES|\/tmp|\.tmp-|Next:/, text); }
      assert.doesNotMatch(denied.error, /\.tmp-|\/tmp/, 'the server message names the file, not a temp path');
      await server.stop();
      await sleep(600);
      const lost = await client.sendEdits(comp.component, rev, [{ op: 'set', path: 'root.gap', value: 4 }]);
      assert.equal(lost.ok, false);
      assert.doesNotMatch(plain(lost.error), /stale|revision|Next:/i);
    } finally { try { chmodSync(dir2, 0o755); } catch {} client.close(); try { await server.stop(); } catch {} }
  });
});

test('WPC-15: top bar and status bar fit at 1280x720 and 1440x900 (tokens configured, Chip focused)', { timeout: 150000 }, async (t) => {
  for (const [size, theme] of [[[1280, 720], 'light'], [[1280, 720], 'dark'], [[1440, 900], 'light'], [[1440, 900], 'dark']]) await t.test(`${size.join('x')} ${theme}`, async () => {
    const r = await repo(size); const { b, io } = r;
    try {
      await b.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; { const t = document.querySelector('#token-theme'); t.value = ${JSON.stringify(theme)}; t.dispatchEvent(new Event('change')); }`);
      await palette(io, b, 'Chip'); await sleep(500);
      const m = JSON.parse(await b.eval(`(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
        const top = [...document.querySelectorAll('.brand, #toolbar, #quick-open, .top-right > *')].filter((e) => e.getBoundingClientRect().width).map((e) => ({ n: e.id || e.className, ...box(e), clipped: e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' }));
        const status = [...document.querySelectorAll('#statusbar > *')].filter((e) => e.getBoundingClientRect().width).map((e) => ({ n: e.id || e.className, ...box(e), clipped: e.scrollWidth > e.clientWidth + 1 }));
        const hints = [...document.querySelectorAll('#statusbar .hints .h')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => box(e));
        const hb = box(document.querySelector('#statusbar .hints'));
        const tools = [...document.querySelectorAll('#toolbar [data-tool], #toolbar #tool-new')].map((e) => ({ name: e.getAttribute('aria-label'), w: e.getBoundingClientRect().width }));
        return JSON.stringify({ top, status, hintsFit: hints.every((h) => h.r <= hb.r + 1 && h.l >= hb.l - 1), tools, vw: innerWidth });
      })()`));
      const overlaps = (list) => list.flatMap((a, i) => list.slice(i + 1).filter((c) => a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b && c.t < a.b).map((c) => `${a.n} x ${c.n}`));
      assert.deepEqual(overlaps(m.top), [], 'top bar overlaps');
      assert.deepEqual(overlaps(m.status), [], 'status bar overlaps');
      assert.ok(m.top.every((e) => e.r <= m.vw + 1) && m.status.every((e) => e.r <= m.vw + 1), 'nothing past the window');
      assert.ok(m.top.every((e) => !e.clipped) && m.status.every((e) => !e.clipped), JSON.stringify([...m.top, ...m.status].filter((e) => e.clipped)));
      assert.ok(m.hintsFit, 'hints are whole, not cut by an ellipsis');
      assert.ok(m.tools.length === 5 && m.tools.every((x) => x.name && x.w > 20), JSON.stringify(m.tools));
      if (process.env.EVIDENCE) writeFileSync(join(ROOT, `docs/evidence/keys-${size.join('x')}-${theme}-bars.png`), await b.screenshot());
    } finally { await r.close(); }
  });
});
