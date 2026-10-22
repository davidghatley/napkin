// Canvas lane, round 1: frames you can drag (CAN-02), quick open (CAN-03), the layers tree (CAN-04),
// multi-select (CAN-05), measuring (CAN-07), focus and deep links (CAN-08). Real input over CDP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { match, search } from '../public/canvas/fuzzy.js';
import { tempRepo, startServer, sleep, waitFor } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';
import { input, centerOf } from './helpers/input.js';
import { readSidecar } from '../src/codecs.js';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const sec = (name) => `document.querySelector('section[data-name="${name}"]')`;
const node = (name, n) => `${sec(name)}.querySelector('.mount [data-n="${n}"]')`;
const row = (name, n) => `document.querySelector('#layers [data-component="' + napkin.find('${name}').component + '"][data-node="${n}"]')`;
const api = async (url, p) => (await fetch(new URL(p, url))).json();

test('CAN-03 fuzzy search over 200 components stays under 50 ms (p95)', (t) => {
  const items = [];
  for (let c = 0; c < 200; c++) {
    items.push({ kind: 'component', label: `Widget${c}`, hint: 'component' });
    for (const n of ['root', 'icon', 'label', 'badge', 'title', 'body', 'footer', 'actions', 'image', 'caption']) items.push({ kind: 'node', label: `Widget${c} › ${n}`, hint: 'div' });
  }
  for (const a of ['Fit all', 'Fit selection', 'Zoom to 100%', 'New component']) items.push({ kind: 'action', label: a });
  const times = [];
  for (const q of ['w', 'wid', 'wc1', 'cap', 'w42 lab', 'fit', 'btn', 'zzzz', 'widget199 foot', 'ti', 'ac', 'new', 'img']) for (let i = 0; i < 8; i++) { const t0 = performance.now(); search(items, q, 14); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  t.diagnostic(`${items.length} items, ${times.length} queries, p95 ${p95.toFixed(2)} ms, max ${times.at(-1).toFixed(2)} ms`);
  assert.ok(p95 < 50);
  assert.equal(search(items, 'w42 lab', 3)[0].item.label, 'Widget42 › label');
  assert.deepEqual(match('chlab', 'Chip › label').at.length, 5);
  assert.equal(match('zq', 'Chip'), null);
});

test('canvas frames, quick open, layers, multi-select, measure, focus', { timeout: 150000 }, async (t) => {
  const { compDir, fileOf, git } = tempRepo(['Card', 'Button', 'Chip']);
  // These cases measure subsequent position diffs in already-saved sidecars.
  // First-save behavior is checked by onboarding/sample.test.js.
  for (const name of ['Card', 'Chip']) readSidecar(fileOf(name), name, { create: true });
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  const q = (e) => browser.eval(e);
  // revisions are content hashes: "one revision" is counted as one more entry in the history
  const hist = async (n) => (await (await fetch(new URL(`api/components/${n}/history?limit=500`, server.url))).json()).history;
  const rev = async (n = 'Button') => (await hist(n)).length;
  const settled = async (n, k) => { const t0 = Date.now(); while ((await hist(n)).length < k && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20)); await browser.waitFor(`napkin.find('${n}').revision === '${(await hist(n))[0].revision}'`); };
  const reload = async (hash = '') => { await browser.goto(server.url + hash); await browser.waitFor('document.body.dataset.ready === "1"'); };
  try {
    await reload();
    await sleep(300);

    await t.test('CAN-02 dragging a frame by its title moves it; only the sidecar changes (<= 2 lines)', async () => {
      const tsx = fileOf('Chip'), side = tsx.replace(/\.tsx$/, '.napkin.json');
      const before = { tsx: sha(tsx), side: readFileSync(side, 'utf8') };
      const at0 = JSON.parse(await q(`JSON.stringify(napkin.stage.position(napkin.find('Chip').component))`));
      const z = (await q('napkin.view.get().z'));
      const h = await centerOf(browser, `${sec('Chip')}.querySelector('.cmp-title h3')`);
      await io.drag(h.x, h.y, h.x + 120, h.y + 70);
      await waitFor(() => readFileSync(side, 'utf8') !== before.side, 3000);
      const after = readFileSync(side, 'utf8');
      assert.equal(sha(tsx), before.tsx, '.tsx is byte-identical');
      const a = before.side.split('\n'), b = after.split('\n');
      assert.equal(a.length, b.length);
      const changed = a.filter((l, i) => l !== b[i]).length;
      t.diagnostic(`sidecar lines changed: ${changed}; position ${JSON.stringify(at0)} -> ${JSON.stringify(JSON.parse(after).canvas)} at ${(z * 100).toFixed(0)}%`);
      assert.ok(changed <= 2);
      const moved = JSON.parse(after).canvas;
      assert.ok(Math.abs(moved.x - (at0.x + 120 / z)) <= 1 && Math.abs(moved.y - (at0.y + 70 / z)) <= 1, 'moved by the drag distance in canvas units');
      assert.equal(JSON.parse(after).id, JSON.parse(before.side).id);
      assert.deepEqual((await api(server.url, 'api/components/Chip')).canvas, moved);
      assert.equal(git('status', '--porcelain', '--', 'components/Chip.tsx').trim(), '', 'git sees no change to Chip.tsx');
      await reload();
      assert.deepEqual(JSON.parse(await q(`JSON.stringify(napkin.stage.position(napkin.find('Chip').component))`)), moved, 'a reload keeps it');
    });

    await t.test('CAN-02 an empty part of the frame drags it too, and the .tsx stays byte-identical', async () => {
      const tsx = fileOf('Card'), side = tsx.replace(/\.tsx$/, '.napkin.json');
      const before = { tsx: sha(tsx), side: readFileSync(side, 'utf8') };
      await io.key('!', { shift: true, code: 'Digit1' }); await sleep(400);
      const f = await centerOf(browser, `${sec('Card')}.querySelector('.frame')`);
      await io.drag(f.left + 8, f.top + 8, f.left + 8 + 40, f.top + 8 + 25);
      await waitFor(() => existsSync(side) && readFileSync(side, 'utf8') !== before.side, 3000);
      assert.equal(sha(tsx), before.tsx);
      const a = before.side.split('\n'), b = readFileSync(side, 'utf8').split('\n');
      assert.ok(a.filter((l, i) => l !== b[i]).length <= 2);
      assert.equal(await q('napkin.state.selections.length'), 0, 'dragging a frame does not select');
      const g = await centerOf(browser, `${sec('Card')}.querySelector('.frame')`);
      await io.drag(g.left + 8, g.top + 8, g.left + 8 - 40, g.top + 8 - 25); // put it back, so it does not sit on Button
      await sleep(300);
    });

    await t.test('CAN-03 Ctrl+K: fuzzy search, Enter flies there in <= 300 ms; none with reduced motion', async () => {
      await io.key('k', { ctrl: true });
      await browser.waitFor(`!document.querySelector('#quick').hidden && document.activeElement.id === 'q-input'`);
      await browser.send('Input.insertText', { text: 'chlab' });
      await browser.waitFor(`document.querySelector('#q-list [role=option]')?.textContent.includes('Chip › label')`);
      assert.match(await q(`document.querySelector('#q-list [aria-selected="true"]').textContent`), /Chip › label/);
      await q(`(() => { window.__fl = { t0: 0, ts: [] }; addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__fl.t0 = performance.now(); }, true); napkin.on('view', () => window.__fl.ts.push(performance.now())); return true; })()`);
      await io.key('Enter');
      await sleep(600);
      const fl = JSON.parse(await q('JSON.stringify(window.__fl)'));
      const dur = fl.ts.at(-1) - fl.t0;
      t.diagnostic(`flight: ${fl.ts.length} frames, ${dur.toFixed(0)} ms`);
      assert.ok(fl.ts.length > 3, 'it animates');
      assert.ok(dur <= 300, `flight took ${dur} ms`);
      assert.equal(await q(`napkin.state.selection.node`), 'label');
      assert.equal(await q(`document.querySelector('#quick').hidden`), true);
      const r = await centerOf(browser, node('Chip', 'label')), s = await centerOf(browser, `document.querySelector('#stage')`);
      assert.ok(Math.abs(r.x - s.x) < 3 && Math.abs(r.y - s.y) < 3, 'the node ends centred');
      // reduced motion: no flight
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await io.key('k', { ctrl: true });
      await browser.waitFor(`!document.querySelector('#quick').hidden`);
      await browser.send('Input.insertText', { text: 'Card' });
      await browser.waitFor(`document.querySelector('#q-list [aria-selected="true"]')?.textContent.includes('Card')`);
      await q(`window.__fl.ts = []`);
      await io.key('Enter');
      await sleep(400);
      const rm = JSON.parse(await q('JSON.stringify(window.__fl)'));
      assert.equal(rm.ts.length, 1, 'one jump, no animation');
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    });

    await t.test('CAN-03 results come in < 50 ms on 200 components in the page too', async () => {
      const ms = JSON.parse(await q(`JSON.stringify((() => {
        const C = napkin.state.components, base = [...C.values()].find((c) => c.name === 'Card');
        for (let i = 0; i < 200; i++) C.set('fake' + i, { component: 'fake' + i, name: 'Widget' + i, revision: 1, doc: { ...base.doc, root: { id: 'root', tag: 'div', style: {}, children: ['icon', 'label', 'badge', 'title', 'body', 'footer', 'actions', 'image', 'caption'].map((id) => ({ id, tag: 'span', style: {}, children: [], text: 'x' })) } } });
        napkin.quick.build();
        const times = [];
        for (const w of ['w', 'wid', 'wc1', 'cap', 'w42 lab', 'fit', 'btn', 'ti', 'ac', 'new']) for (let i = 0; i < 6; i++) { const t0 = performance.now(); napkin.quick.search(w); times.push(performance.now() - t0); }
        for (let i = 0; i < 200; i++) C.delete('fake' + i);
        times.sort((a, b) => a - b); return { n: times.length, p95: times[Math.floor(times.length * 0.95)], max: times.at(-1) }; })())`));
      t.diagnostic(`in the page: ${ms.n} queries over 2,200 items, p95 ${ms.p95.toFixed(2)} ms`);
      assert.ok(ms.p95 < 50);
    });

    await t.test('CAN-04 the layers tree mirrors the JSX and selection syncs both ways', async () => {
      await reload(); await sleep(200);
      const cardDoc = (await api(server.url, 'api/components/Card')).doc;
      const expected = []; (function walk(n, d) { expected.push([d, n.id]); n.children.forEach((c) => walk(c, d + 1)); })(cardDoc.root, 1);
      const rows = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#layers [data-component="' + napkin.find('Card').component + '"][data-node]')].map((r) => [Number(r.getAttribute('aria-level')) - 1, r.dataset.node]))`));
      assert.deepEqual(rows, expected);
      // tree -> canvas
      const r1 = await centerOf(browser, row('Card', 'title'));
      await io.click(r1.x, r1.y);
      await browser.waitFor(`napkin.state.selection?.node === 'title'`);
      assert.equal(await q(`document.querySelector('#overlay-select').dataset.label`), 'Card · title');
      // canvas -> tree
      const c = await centerOf(browser, node('Card', 'body'));
      await io.click(c.x, c.y);
      await browser.waitFor(`napkin.state.selection?.node === 'body'`);
      await browser.waitFor(`${row('Card', 'body')}.getAttribute('aria-selected') === 'true' && ${row('Card', 'title')}.getAttribute('aria-selected') === 'false'`);
    });

    await t.test('CAN-04 rename is one edit (one revision, a 2-line diff); the selection follows', async () => {
      const r0 = await rev('Card');
      const pos = await centerOf(browser, row('Card', 'title'));
      await io.click(pos.x, pos.y);
      await io.press(pos.x, pos.y); await io.release(pos.x, pos.y); // a second click
      await q(`${row('Card', 'title')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await browser.waitFor(`document.activeElement?.className === 'lrename'`);
      await q(`document.activeElement.select()`);
      await browser.send('Input.insertText', { text: 'heading' });
      await io.key('Enter');
      await settled('Card', r0 + 1);
      await sleep(200);
      assert.equal(await rev('Card'), r0 + 1, 'exactly one revision');
      assert.match(readFileSync(fileOf('Card'), 'utf8'), /data-n="heading" style=\{s\('heading', v\)\}/);
      assert.match(git('diff', '--numstat', '--', 'components/Card.tsx'), /^2\t2\t/);
      assert.equal(await q(`napkin.state.selection.node`), 'heading');
      await browser.waitFor(`!!${row('Card', 'heading')} && !${row('Card', 'title')}`);
      assert.equal(await q(`${sec('Card')}.querySelector('[data-n="heading"]').textContent`), 'From napkin to component');
    });

    await t.test('CAN-04 dragging a layer to a new place is one move (one revision)', async () => {
      const r0 = await rev('Card');
      const from = await centerOf(browser, row('Card', 'body')), to = await centerOf(browser, row('Card', 'image'));
      await io.drag(from.x, from.y, to.x, to.top + 3);
      await settled('Card', r0 + 1);
      await sleep(200);
      assert.equal(await rev('Card'), r0 + 1, 'exactly one revision');
      const order = (await api(server.url, 'api/components/Card')).doc.root.children.map((x) => x.id);
      assert.deepEqual(order, ['body', 'image', 'heading']);
      const dom = await q(`JSON.stringify([...${sec('Card')}.querySelector('[data-n="card"]').children].map((e) => e.dataset.n))`);
      assert.deepEqual(JSON.parse(dom), ['body', 'image', 'heading']);
      const tree = await q(`JSON.stringify([...document.querySelectorAll('#layers [data-component="' + napkin.find('Card').component + '"][data-node]')].map((r) => r.dataset.node))`);
      assert.deepEqual(JSON.parse(tree), ['card', 'body', 'image', 'heading']);
    });

    await t.test('CAN-05 shift-click multi-select shows Mixed; one change is one revision', async () => {
      await io.key('Escape');
      const a = await centerOf(browser, node('Card', 'heading')), b = await centerOf(browser, node('Card', 'body'));
      await io.click(a.x, a.y);
      await io.click(b.x, b.y, { shift: true });
      await browser.waitFor(`napkin.state.selections.length === 2`);
      assert.deepEqual(JSON.parse(await q(`JSON.stringify(napkin.state.selections.map((s) => s.node))`)), ['heading', 'body']);
      assert.match(await q(`document.querySelector('#sel-node').textContent`), /\+1/);
      assert.equal(await q(`document.querySelector('#fontSize').dataset.mixed`), '1', 'font sizes differ: Mixed');
      assert.equal(await q(`document.querySelector('#fontSize').placeholder`), 'Mixed');
      const r0 = await rev('Card');
      await browser.type('#opacity', '50'); // the panel shows percent
      await settled('Card', r0 + 1);
      await sleep(250);
      assert.equal(await rev('Card'), r0 + 1, 'one batch, one revision');
      const doc = (await api(server.url, 'api/components/Card')).doc;
      const byId = Object.fromEntries(doc.root.children.map((c) => [c.id, c]));
      assert.equal(byId.heading.style.opacity, 0.5); assert.equal(byId.body.style.opacity, 0.5);
      assert.equal(byId.image.style.opacity, undefined);
      assert.equal(await q(`document.querySelector('#opacity').value`), '50', 'same on both: no longer mixed');
      // shift-click again removes one
      await io.click(b.x, b.y, { shift: true });
      await browser.waitFor(`napkin.state.selections.length === 1`);
    });

    await t.test('CAN-05 a marquee on the empty canvas selects what it covers', async () => {
      await io.key('Escape');
      const card = await centerOf(browser, `${sec('Card')}.querySelector('[data-n="card"]')`);
      const frame = await centerOf(browser, `${sec('Card')}.querySelector('.frame')`);
      // from the empty canvas beside the frame, across into the card (inside a frame a drag moves the frame instead)
      await io.drag(frame.left - 30, frame.top + 20, card.left + card.w * 0.7, card.top + card.h * 0.6);
      await browser.waitFor(`napkin.state.selections.length >= 2`);
      const sels = JSON.parse(await q(`JSON.stringify(napkin.state.selections.map((s) => s.node))`));
      t.diagnostic(`marquee selected: ${sels.join(', ')}`);
      assert.ok(sels.includes('card') || sels.includes('body') || sels.includes('image'));
      assert.equal(await q(`new Set(napkin.state.selections.map((s) => s.component)).size`), 1);
      assert.equal(await q(`document.querySelectorAll('.overlay-extra').length >= 1`), true);
      await io.key('Escape');
    });

    await t.test('CAN-07 hold Alt: the distance to the hovered node matches getBoundingClientRect (+-0.5 px)', async () => {
      await io.key('2', { shift: true, code: 'Digit2' }); // nothing selected: no-op
      const a0 = await centerOf(browser, node('Card', 'heading'));
      await io.click(a0.x, a0.y);
      await browser.waitFor(`napkin.state.selection?.node === 'heading'`);
      for (const zoomKeys of [[], ['+', '+'], ['-', '-', '-', '-']]) {
        for (const k of zoomKeys) await io.key(k);
        await sleep(50);
        const A = await centerOf(browser, node('Card', 'heading')), B = await centerOf(browser, node('Card', 'image'));
        await io.move(B.x, B.y);
        await io.down('Alt', { alt: true, code: 'AltLeft' });
        await io.move(B.x + 1, B.y + 1, { alt: true });
        await io.move(B.x, B.y, { alt: true });
        await browser.waitFor(`document.querySelector('#overlay-measure').dataset.active === '1'`);
        const z = await q('napkin.view.get().z');
        const labels = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#overlay-measure .m-label')].map((l) => [l.dataset.axis, Number(l.dataset.value)]))`));
        const ay = labels.filter(([x]) => x === 'y').map(([, v]) => v), ax = labels.filter(([x]) => x === 'x').map(([, v]) => v).sort((p, r) => p - r);
        // the heading is below the image: the vertical gap is image.bottom -> heading.top
        const gapY = (A.top - (B.top + B.h)) / z;
        const insets = [Math.abs(A.left - B.left) / z, Math.abs(A.left + A.w - (B.left + B.w)) / z].filter((v) => v >= 0.01).sort((p, r) => p - r);
        t.diagnostic(`z=${z.toFixed(2)}: y ${ay} (expected ${gapY.toFixed(2)}), x ${ax} (expected ${insets.map((v) => v.toFixed(2))})`);
        assert.equal(ay.length, 1);
        assert.ok(Math.abs(ay[0] - gapY) <= 0.5, `vertical ${ay[0]} vs ${gapY}`);
        assert.equal(ax.length, insets.length);
        ax.forEach((v, i) => assert.ok(Math.abs(v - insets[i]) <= 0.5, `horizontal ${v} vs ${insets[i]}`));
        await io.up('Alt', { code: 'AltLeft' });
        await browser.waitFor(`document.querySelector('#overlay-measure').dataset.active === ''`);
      }
    });

    await t.test('CAN-08 Enter focuses a component, Esc comes back; #Component/node deep-links; a reload restores it', async () => {
      await reload(); await sleep(200);
      await io.key('!', { shift: true, code: 'Digit1' }); await sleep(400); // earlier tests left the view anywhere
      const c = await centerOf(browser, node('Button', 'root'));
      await io.click(c.left + 2, c.y); // the padding of the button, not its label
      await browser.waitFor(`napkin.state.selection?.node === 'root'`);
      const before = JSON.parse(await q('JSON.stringify(napkin.view.get())'));
      await io.key('Enter');
      await browser.waitFor(`document.body.dataset.focus === 'Button'`);
      await sleep(350);
      assert.equal(await q('location.hash'), '#Button/root');
      const focused = JSON.parse(await q('JSON.stringify(napkin.view.get())'));
      assert.ok(focused.z > before.z, 'zoomed to the component');
      assert.equal(await q(`getComputedStyle(${sec('Card')}).opacity < 0.5`), true, 'the others recede');
      // select another node: the link follows
      const l = await centerOf(browser, node('Button', 'label'));
      await io.click(l.x, l.y);
      await browser.waitFor(`location.hash === '#Button/label'`);
      // reload keeps the view
      await sleep(300);
      await reload('#Button/label');
      await browser.waitFor(`document.body.dataset.focus === 'Button'`);
      assert.equal(await q(`napkin.state.selection?.node`), 'label');
      const again = JSON.parse(await q('JSON.stringify(napkin.view.get())'));
      t.diagnostic(`focus view before reload ${JSON.stringify(focused)}, after ${JSON.stringify(again)}`);
      assert.ok(Math.abs(again.z - focused.z) < 0.01 && Math.abs(again.x - focused.x) < 2 && Math.abs(again.y - focused.y) < 2, 'same view after reload');
      // Esc: back where we were, address cleared
      await io.key('Escape');
      await sleep(350);
      assert.equal(await q('document.body.dataset.focus'), undefined);
      assert.equal(await q('location.hash'), '');
      const back = JSON.parse(await q('JSON.stringify(napkin.view.get())'));
      assert.ok(Math.abs(back.z - before.z) < 0.01 && Math.abs(back.x - before.x) < 2 && Math.abs(back.y - before.y) < 2, `back to the earlier view ${JSON.stringify(before)} vs ${JSON.stringify(back)}`);
      // a free pan survives a reload too
      await io.wheel(700, 450, 0, 150); await io.wheel(700, 450, -90, 0);
      await sleep(400);
      const panned = JSON.parse(await q('JSON.stringify(napkin.view.get())'));
      await reload();
      const restored = JSON.parse(await q('JSON.stringify(napkin.view.get())'));
      assert.ok(Math.abs(restored.x - panned.x) < 0.01 && Math.abs(restored.y - panned.y) < 0.01 && Math.abs(restored.z - panned.z) < 1e-6, 'view restored');
      // a link to a component that does not exist is ignored
      await reload('#Nope/none');
      assert.equal(await q('document.body.dataset.focus'), undefined);
    });
    await t.test('CAN-05 Delete with several selected is one batch', async () => {
      await reload(); await sleep(200);
      await io.key('!', { shift: true, code: 'Digit1' }); await sleep(400);
      const r0 = await rev('Card');
      const id = await q(`napkin.find('Card').component`);
      await q(`napkin.selectMany([{ component: '${id}', node: 'body', variant: {} }, { component: '${id}', node: 'image', variant: {} }, { component: '${id}', node: 'card', variant: {} }])`);
      await q(`document.activeElement?.blur()`);
      await io.key('Delete');
      await settled('Card', r0 + 1);
      await sleep(200);
      assert.equal(await rev('Card'), r0 + 1, 'one revision for the whole selection');
      assert.deepEqual((await api(server.url, 'api/components/Card')).doc.root.children.map((x) => x.id), ['heading'], 'body and image are gone, the root stays');
    });

    assert.deepEqual(browser.consoleLines.filter((l) => /error/i.test(l)), [], 'no console errors');
  } finally { await browser.close(); await server.stop(); }
});
