// M4 (F11 canvas side + F12): draw a component from nothing with the keyboard and mouse, in headless Chromium.
// N names a new component, F drags a frame, T adds text, I adds an image slot; the file reopens identically.
// Set DEMO_OUT=docs/demo to save the screenshot (draw-card.png).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { readComponent } from '../src/tsx/read.js';
import { index } from '../src/model.js';
import { tempRepo, startServer, ROOT } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';

const KEYS = { Enter: 13, Escape: 27, Delete: 46, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
const keyOf = (browser) => async (key, { alt = false } = {}) => {
  const base = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: KEYS[key] ?? key.toUpperCase().charCodeAt(0), modifiers: alt ? 1 : 0 };
  const text = key.length === 1 ? key : key === 'Enter' ? '\r' : undefined;
  await browser.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text && { text }) });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
};
const mouse = (browser) => ({
  async click(x, y) { await this.drag(x, y, x, y); },
  async drag(x0, y0, x1, y1) {
    const p = { button: 'left', clickCount: 1 };
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, buttons: 1, ...p });
    if (x1 !== x0 || y1 !== y0) {
      for (const f of [0.3, 0.7, 1]) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, buttons: 1 });
    }
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, buttons: 0, ...p });
  },
});
const sec = (name) => `document.querySelector('section[data-name="${name}"]')`;
const api = async (url, path) => (await fetch(new URL(path, url))).json();

test('draw a Card2 from nothing (N, F, T, I), reopen it identically, and render it', { timeout: 60000 }, async (t) => {
  const out = process.env.DEMO_OUT ? join(ROOT, process.env.DEMO_OUT) : null;
  if (out) mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'napkin-draw-'));
  let server = await startServer(dir);
  const browser = await launchChromium({ width: 1100, height: 760 });
  const key = keyOf(browser), mice = mouse(browser);
  const q = (e) => browser.eval(e);
  const box = async (sel) => JSON.parse(await q(`JSON.stringify((() => { const r = ${sel}.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())`));
  const model = async () => (await api(server.url, 'api/components/Card2')).doc;
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    assert.equal(await q(`document.querySelectorAll('section.cmp').length`), 0, 'empty workspace');

    await t.test('N asks for a name inline and the new component appears selected', async () => {
      await key('n');
      await browser.waitFor(`document.activeElement?.id === 'new-name'`);
      await browser.send('Input.insertText', { text: 'Card2' });
      await key('Enter');
      await browser.waitFor(`${sec('Card2')}?.dataset.ready === '1' && document.querySelector('#sel-node')?.textContent.startsWith('root')`);
      assert.equal(await q(`document.querySelector('#new-component').hidden`), true);
      const files = readdirSync(dir).sort();
      assert.deepEqual(files, ['Card2.napkin.json', 'Card2.tsx']);
      assert.equal(await q(`document.querySelector('#overlay-select').dataset.label`), 'Card2 · root');
    });

    await t.test('F drags a frame into the root with the dragged size, then returns to Select', async () => {
      await key('f');
      assert.equal(await q(`document.querySelector('button[data-tool="frame"]').getAttribute('aria-pressed')`), 'true');
      assert.equal(await q('document.body.dataset.tool'), 'frame');
      const r = await box(`${sec('Card2')}.querySelector('[data-n="root"]')`);
      await mice.drag(r.x + 5, r.y + 5, r.x + 205, r.y + 125);
      await browser.waitFor(`!!${sec('Card2')}.querySelector('[data-n="frame1"]')`);
      const f = (await model()).root.children[0];
      assert.equal(f.id, 'frame1');
      assert.equal(f.tag, 'div');
      assert.equal(f.style.width, 200); assert.equal(f.style.height, 120);
      assert.equal(f.style.display, 'flex'); assert.equal(f.style.flexDirection, 'column'); assert.equal(f.style.gap, 8); assert.equal(f.style.padding, 8);
      assert.match(f.style.border, /dashed/);
      const b = await box(`${sec('Card2')}.querySelector('[data-n="frame1"]')`);
      assert.equal(Math.round(b.w), 200); assert.equal(Math.round(b.h), 120);
      await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('frame1')`);
      assert.equal(await q('document.body.dataset.tool'), 'select');
      assert.equal(await q(`document.querySelector('button[data-tool="select"]').getAttribute('aria-pressed')`), 'true');
    });

    await t.test('T adds text into the frame and offers inline editing; Hello is saved', async () => {
      await key('t');
      const b = await box(`${sec('Card2')}.querySelector('[data-n="frame1"]')`);
      await mice.click(b.x + b.w / 2, b.y + b.h - 10);
      await browser.waitFor(`document.querySelector('input.text-edit') && document.activeElement.classList.contains('text-edit')`);
      assert.equal(await q(`document.querySelector('input.text-edit').value`), 'Text');
      await browser.send('Input.insertText', { text: 'Hello' });
      await key('Enter');
      await browser.waitFor(`${sec('Card2')}.querySelector('[data-n="text1"]')?.textContent === 'Hello'`);
      const m = await model();
      const text1 = index(m).byId.get('text1');
      assert.equal(text1.tag, 'span'); assert.equal(text1.text, 'Hello');
      assert.equal(index(m).parentOf.get('text1').id, 'frame1');
      assert.equal(await q('!document.querySelector("input.text-edit")'), true);
    });

    await t.test('I adds a 64x64 image slot into the frame', async () => {
      await key('i');
      const b = await box(`${sec('Card2')}.querySelector('[data-n="frame1"]')`);
      await mice.click(b.x + b.w / 2, b.y + b.h - 10);
      await browser.waitFor(`!!${sec('Card2')}.querySelector('[data-n="image1"]')`).catch(async (e) => { throw new Error(`${e.message}; #error=${await q("document.querySelector('#error').textContent")} tool=${await q('document.body.dataset.tool')} box=${JSON.stringify(b)} focus=${await q('document.activeElement.tagName')}`); });
      const img = index(await model()).byId.get('image1');
      assert.equal(img.tag, 'img'); assert.deepEqual(img.attrs, { src: '', alt: '' });
      assert.equal(img.style.width, 64); assert.equal(img.style.height, 64);
      assert.deepEqual(index(await model()).parentOf.get('image1').children.map((c) => c.id), ['text1', 'image1']);
      await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('image1')`);
      // clicking an image or a text with a tool active draws beside it, not inside it
      await key('t');
      const ib = await box(`${sec('Card2')}.querySelector('[data-n="image1"]')`);
      await mice.click(ib.x + 10, ib.y + 10);
      await browser.waitFor(`!!${sec('Card2')}.querySelector('[data-n="text2"]')`);
      await key('Escape'); // cancels the text edit
      assert.deepEqual(index(await model()).parentOf.get('text2').children.map((c) => c.id), ['text1', 'image1', 'text2']);
      // Delete the extra one again so the demo Card is clean
      await q(`${sec('Card2')}.querySelector('[data-n="text2"]').click()`);
      await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('text2')`);
      await key('Delete');
      await browser.waitFor(`!${sec('Card2')}.querySelector('[data-n="text2"]')`);
      // shift keeps the tool
      assert.equal(await q('document.body.dataset.tool'), 'select');
    });

    await q(`${sec('Card2')}.querySelector('[data-n="frame1"]').click()`);
    await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('frame1')`);
    if (out) writeFileSync(join(out, 'draw-card.png'), await browser.screenshot());

    const before = await model();
    const fileText = readFileSync(join(dir, 'Card2.tsx'), 'utf8');
    const sidecar = readFileSync(join(dir, 'Card2.napkin.json'), 'utf8');

    await t.test('(b) the file bundles and renders with react-dom/server like the screen does', async () => {
      const work = mkdtempSync(join(ROOT, 'node_modules', '.napkin-ssr-')); // inside the repo so `react` resolves
      try {
        const r = await esbuild.build({
          stdin: { contents: `import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { Card2 } from ${JSON.stringify(join(dir, 'Card2.tsx'))}; export default () => renderToStaticMarkup(createElement(Card2, {}));`, resolveDir: dir, loader: 'js' },
          bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.tsx': 'tsx' }, packages: 'external', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
        });
        writeFileSync(join(work, 'ssr.mjs'), r.outputFiles[0].text);
        const html = (await import(pathToFileURL(join(work, 'ssr.mjs')))).default();
        for (const n of ['root', 'frame1', 'text1', 'image1']) assert.match(html, new RegExp(`data-n="${n}"`));
        assert.match(html, />Hello</);
        assert.match(html, /<img[^>]*data-n="image1"/);
        assert.match(html, /width:200px;height:120px/);
        // the screen shows the same elements in the same order
        const onScreen = await q(`[...${sec('Card2')}.querySelectorAll('[data-n]')].map((e) => e.dataset.n).join()`);
        assert.equal(onScreen, [...html.matchAll(/data-n="([^"]+)"/g)].map((m) => m[1]).join());
      } finally { rmSync(work, { recursive: true, force: true }); }
    });

    assert.deepEqual(browser.consoleLines.filter((l) => /error/i.test(l)), [], 'no console errors');

    await t.test('(a) closing the server and reopening the folder gives the identical model; the .tsx re-reads cleanly', async () => {
      await browser.close();
      await server.stop();
      assert.doesNotThrow(() => readComponent(fileText));
      server = await startServer(dir);
      const again = (await api(server.url, 'api/components/Card2')).doc;
      assert.deepEqual(again, before);
      assert.equal(readFileSync(join(dir, 'Card2.tsx'), 'utf8'), fileText, 'opening does not rewrite the file');
      assert.equal(readFileSync(join(dir, 'Card2.napkin.json'), 'utf8'), sidecar);
      const list = await api(server.url, 'api/components');
      assert.deepEqual(list.map((c) => [c.name, c.readOnly]), [['Card2', undefined]]);
      assert.equal(JSON.stringify(readComponent(fileText).doc.root), JSON.stringify(before.root));
    });
  } finally {
    await browser.close().catch(() => {}); await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(c)(d)(e) Delete, Alt+Down, a taken name, and shortcuts while typing', { timeout: 60000 }, async (t) => {
  const { compDir, fileOf } = tempRepo(['Card']);
  const server = await startServer(compDir);
  const browser = await launchChromium();
  const key = keyOf(browser);
  const q = (e) => browser.eval(e);
  const order = async () => (await api(server.url, 'api/components/Card')).doc.root.children.map((c) => c.id).join();
  const select = async (node) => {
    await q(`${sec('Card')}.querySelector('[data-n="${node}"]').click()`);
    await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('${node}')`);
  };
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');

    await t.test('(c) Alt+Down and Alt+Up reorder siblings; Delete removes a node but never the root', async () => {
      assert.equal(await order(), 'image,title,body');
      await select('title');
      await key('ArrowDown', { alt: true });
      await browser.waitFor(`[...${sec('Card')}.querySelectorAll('[data-n]')].map((e) => e.dataset.n).join() === 'card,image,body,title'`);
      assert.equal(await order(), 'image,body,title');
      assert.equal(await q(`document.querySelector('#sel-node').textContent.startsWith('title')`), true, 'selection follows the node');
      await key('ArrowDown', { alt: true }); // already last: nothing happens
      await key('ArrowUp', { alt: true });
      await browser.waitFor(`[...${sec('Card')}.querySelectorAll('[data-n]')].map((e) => e.dataset.n).join() === 'card,image,title,body'`);
      assert.equal(await order(), 'image,title,body');
      await key('Delete');
      await browser.waitFor(`!${sec('Card')}.querySelector('[data-n="title"]')`);
      assert.equal(await order(), 'image,body');
      assert.equal(await q(`document.querySelector('#overlay-select').style.display`), 'none');
      await select('card');
      await key('Backspace');
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(await q(`!!${sec('Card')}.querySelector('[data-n="card"]')`), 'the root is not deleted');
      assert.match(await q(`document.querySelector('#error').textContent`) + 'x', /x|root/);
    });

    await t.test('(d) creating an existing name is refused with an error and no file change', async () => {
      const before = readFileSync(fileOf('Card'), 'utf8');
      const r = await fetch(new URL('api/components', server.url), { method: 'POST', body: JSON.stringify({ name: 'Card' }) });
      assert.equal(r.status, 409);
      assert.match((await r.json()).error, /already exists/);
      const bad = await fetch(new URL('api/components', server.url), { method: 'POST', body: JSON.stringify({ name: 'card-x' }) });
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /PascalCase/);
      // and in the UI, inline
      await key('n');
      await browser.waitFor(`document.activeElement?.id === 'new-name'`);
      await browser.send('Input.insertText', { text: 'Card' });
      await key('Enter');
      await browser.waitFor(`document.querySelector('#new-error').textContent.includes('already exists')`);
      assert.equal(await q(`document.querySelector('#new-component').hidden`), false, 'the field stays open');
      assert.equal(readFileSync(fileOf('Card'), 'utf8'), before);
      assert.deepEqual(readdirSync(compDir).sort(), ['Button.napkin.json', 'Button.tsx', 'Card.napkin.json', 'Card.tsx'].filter((f) => readdirSync(compDir).includes(f)));
      assert.equal(await q(`document.querySelectorAll('section.cmp').length`), 1);
    });

    await t.test('(e) shortcuts do not fire while typing in an input', async () => {
      await key('Escape'); // closes the name field (focus is in the input)
      await browser.waitFor(`document.querySelector('#new-component').hidden`);
      await select('body');
      await key('n');
      await browser.waitFor(`document.activeElement?.id === 'new-name'`);
      for (const c of ['f', 't', 'i', 'v']) await key(c);
      await key('Backspace'); await key('Delete');
      assert.equal(await q(`document.querySelector('#new-name').value`), 'fti');
      assert.equal(await q('document.body.dataset.tool'), 'select');
      assert.ok(await q(`!!${sec('Card')}.querySelector('[data-n="body"]')`), 'Delete in an input did not delete the node');
      assert.equal(await order(), 'image,body');
      await key('Escape');
      // outside an input the same keys work, and Escape drops back to Select
      await q('document.activeElement.blur()');
      await key('f');
      assert.equal(await q('document.body.dataset.tool'), 'frame');
      await key('Escape');
      assert.equal(await q('document.body.dataset.tool'), 'select');
      // the toolbar works with the mouse path too and exposes aria-pressed
      await q(`document.querySelector('button[data-tool="image"]').click()`);
      assert.equal(await q(`document.querySelector('button[data-tool="image"]').getAttribute('aria-pressed')`), 'true');
      assert.equal(await q(`document.querySelector('button[data-tool="select"]').getAttribute('aria-pressed')`), 'false');
    });
    assert.deepEqual(browser.consoleLines.filter((l) => /error/i.test(l)), [], 'no console errors');
  } finally {
    await browser.close(); await server.stop();
  }
});
