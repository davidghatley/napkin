// Basics pass 2, create on the canvas (docs/basics/standards.md sections 2, 3 and 4): pick a tool, draw, the thing is there.
// A frame drawn on empty canvas is a new HTML file whose card sits where it was drawn; text on empty canvas is a frame hugging it;
// one undo takes both card and file away; the label renames the file; inside an existing HTML frame the tools insert an element.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, waitFor } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';

let r, server, b, io;
const dir = () => r.compDir;
const file = (name) => join(dir(), name);
const q = (e) => b.eval(e);
const json = async (e) => JSON.parse(await q(`JSON.stringify(${e})`));
const frames = () => json(`[...napkin.state.components.keys()].filter((k) => /^frame-\\d+\\.html$/.test(k)).sort()`);
const until = (fn, ms = 8000) => waitFor(fn, ms, 50);
// an empty stretch of canvas, at zoom 1, far from the packed cards
async function emptyCanvas() {
  await q(`napkin.select(null); napkin.view.set({ x: -6000, y: -6000, z: 1 }); 0`);
  await sleep(250);
}
const cardRect = (id) => json(`(() => { const f = document.querySelector('section.cmp[data-component="${id}"] iframe.doc-frame'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);

before(async () => {
  r = tempRepo(['Card']);
  writeFileSync(join(r.compDir, 'page.html'), `<!doctype html><html lang="en"><head><title>page</title></head><body style="margin: 0"><main style="padding: 24px"><h1>Plan the week</h1><p>One page.</p></main></body></html>\n`);
  server = await startServer(r.compDir, { timeout: 20000, env: { NAPKIN_ALL_KINDS: '0' } });
  b = await launchChromium({ width: 1440, height: 900 });
  io = input(b);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1"', 30000);
  await b.waitFor(`!!document.querySelector('section.cmp[data-component="page.html"]')?.dataset.ready`, 20000);
  await sleep(400);
});
after(async () => { await b?.close(); await server?.stop(); rmSync(r.dir, { recursive: true, force: true }); });

test('basics pass 2: a frame drawn on empty canvas is a new file, its card where it was drawn, selected, tool back to Select', { timeout: 60000 }, async () => {
  await emptyCanvas();
  await io.key('f');
  assert.equal(await q('napkin.state.tool'), 'frame');
  assert.equal(await q(`getComputedStyle(document.querySelector('#stage')).cursor`), 'crosshair', 'the cursor shows the armed tool');
  // press, drag (outline and readout follow), release
  await io.move(500, 300); await io.press(500, 300);
  for (let i = 1; i <= 6; i++) { await io.move(500 + 40 * i, 300 + 25 * i, { buttons: 1 }); await sleep(16); }
  assert.equal(await q(`document.querySelector('#draw-rect').hidden`), false, 'a live outline');
  assert.equal(await q(`document.querySelector('#draw-size').textContent`), '240 × 150', 'a size readout in canvas px');
  await io.release(740, 450);
  await until(async () => existsSync(file('frame-1.html')) && (await q(`document.querySelector('section.cmp[data-component="frame-1.html"]')?.dataset.ready === '1'`)));
  const html = readFileSync(file('frame-1.html'), 'utf8');
  assert.match(html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>frame-1<\/title>\n<\/head>\n<body style="margin: 0; width: 240px; height: 150px"><\/body>\n<\/html>\n$/, 'the minimal template');
  const rect = await cardRect('frame-1.html');
  for (const [k, want] of [['l', 500], ['t', 300], ['w', 240], ['h', 150]]) assert.ok(Math.abs(rect[k] - want) <= 1.5, `card ${k} ${rect[k]} is where it was drawn (${want})`);
  // selected as soon as its document is drawn (a frame or two after the card)
  await until(async () => (await q('napkin.state.selection?.component')) === 'frame-1.html');
  assert.equal(await q('napkin.state.tool'), 'select', 'one use, then Select');
  assert.equal(await q(`!!document.querySelector('.cmp-pending')`), false, 'no pending card left behind');
  // the position is napkin's, not the file's
  assert.doesNotMatch(html, /left|top|position/);
});

test('basics pass 2: one undo removes both card and file; redo brings both back', { timeout: 60000 }, async () => {
  await q('document.activeElement?.blur?.(); 0');
  await io.key('z', { ctrl: true });
  await until(async () => !existsSync(file('frame-1.html')) && (await frames()).length === 0);
  assert.equal(await q(`!!document.querySelector('section.cmp[data-component="frame-1.html"]')`), false, 'the card is gone');
  await io.key('z', { ctrl: true, shift: true });
  await until(async () => existsSync(file('frame-1.html')) && (await frames()).includes('frame-1.html'));
  await until(async () => !!(await cardRect('frame-1.html')));
});

test('basics pass 2: text on empty canvas makes a frame file holding the text, with the caret in it', { timeout: 60000 }, async () => {
  await emptyCanvas();
  await io.key('t');
  await io.click(400, 650);
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-new-text');
  await q(`document.execCommand('insertText', false, 'Hello napkin')`);
  await io.key('Escape');
  await until(async () => existsSync(file('frame-2.html')) && (await q(`napkin.state.selection?.component`)) === 'frame-2.html');
  assert.match(readFileSync(file('frame-2.html'), 'utf8'), /<p style="margin: 0; font: 16px\/1\.4 system-ui, sans-serif">Hello napkin<\/p>/);
  assert.equal(await q('napkin.state.tool'), 'select');
});

test('basics pass 2: text left empty leaves nothing behind', { timeout: 60000 }, async () => {
  await emptyCanvas();
  const before = await frames();
  await io.key('t');
  await io.click(900, 650);
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-new-text');
  await io.key('Escape');
  await sleep(800);
  assert.deepEqual(await frames(), before);
  assert.equal(existsSync(file('frame-3.html')), false, 'no file');
  assert.equal(await q(`!!document.querySelector('.cmp-pending, .nk-new-text')`), false, 'no trace on the canvas');
});

test('basics pass 2: double-click the label to rename the file; a taken name is refused in place', { timeout: 60000 }, async () => {
  await q(`document.querySelector('section.cmp[data-component="frame-2.html"] .cmp-title h3').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 0`);
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename');
  await q(`document.execCommand('insertText', false, 'page')`);
  await io.key('Enter');
  await sleep(150);
  assert.match(await q(`document.querySelector('.nk-rename-msg')?.textContent ?? ''`), /page\.html is already in this folder/);
  assert.equal(existsSync(file('frame-2.html')), true, 'nothing renamed');
  await q(`(() => { const i = document.querySelector('.nk-rename'); i.select(); document.execCommand('insertText', false, 'greeting'); })()`);
  await io.key('Enter');
  await until(async () => existsSync(file('greeting.html')) && !existsSync(file('frame-2.html')) && (await q(`napkin.state.components.has('greeting.html')`)));
  await until(async () => (await q(`document.querySelector('section.cmp[data-component="greeting.html"] .cmp-title h3')?.textContent`)) === 'greeting');
  // Escape cancels
  await q(`document.querySelector('section.cmp[data-component="greeting.html"] .cmp-title h3').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 0`);
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename');
  await q(`document.execCommand('insertText', false, 'nope')`);
  await io.key('Escape');
  await sleep(200);
  assert.equal(existsSync(file('nope.html')), false);
  assert.equal(await q(`!!document.querySelector('.nk-rename')`), false);
});

test('basics pass 2: a frame drawn inside an existing HTML frame inserts an element there and selects it', { timeout: 60000 }, async () => {
  await q(`napkin.select(null); napkin.view.fitRect(napkin.stage.componentRect('page.html'), { pad: 120, max: 1 }); 0`);
  await sleep(400);
  const page = await cardRect('page.html');
  const x0 = page.l + page.w - 200, y0 = page.t + 10;
  await io.key('f');
  await io.move(x0, y0); await io.press(x0, y0);
  for (let i = 1; i <= 5; i++) { await io.move(x0 + 20 * i, y0 + 12 * i, { buttons: 1 }); await sleep(16); }
  assert.equal(await q(`document.querySelector('#draw-rect').hidden`), false, 'the same outline');
  assert.match(await q(`document.querySelector('#draw-size').textContent`), /^\d+ × \d+$/, 'the same readout');
  await io.release(x0 + 100, y0 + 60);
  // (main is a block in the flow: the new box joins it at the end, at the drawn size)
  await until(async () => /<main[^>]*>[\s\S]*<div style="[^"]*width: \d+px; height: \d+px; background: #f4f4f5"><\/div><\/main>/.test(readFileSync(file('page.html'), 'utf8')));
  await until(async () => (await q(`napkin.state.selection?.component`)) === 'page.html');
  assert.ok(!existsSync(file('frame-3.html')), 'no new file');
  assert.equal(await q('napkin.state.tool'), 'select');
});

test('basics pass 2: Escape disarms; F then Enter places a default frame in the middle of the view', { timeout: 60000 }, async () => {
  await emptyCanvas();
  await io.key('i'); assert.equal(await q('napkin.state.tool'), 'image');
  await io.key('Escape'); assert.equal(await q('napkin.state.tool'), 'select');
  await io.key('f'); await io.key('Escape'); assert.equal(await q('napkin.state.tool'), 'select');
  await io.key('f'); await io.key('Enter');
  await until(async () => existsSync(file('frame-2.html')) && !!(await cardRect('frame-2.html')));
  assert.match(readFileSync(file('frame-2.html'), 'utf8'), /width: 320px; height: 180px/, 'the default size');
  assert.equal(await q('napkin.state.tool'), 'select');
});

// ---- round 2: text edited again in place, rename in place, formatting ------------------------------------------------------
const liveFrame = (id) => `document.querySelector('section.cmp[data-component="${id}"] iframe.doc-frame:not(.doc-next)')`;
// the centre of a word inside a frame, in page pixels
const wordAt = (id, word) => json(`(() => { const f = ${liveFrame(id)}; const d = f?.contentDocument; if (!d?.body) return null; const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.data.indexOf(${JSON.stringify(word)}); if (i < 0) continue; const r = d.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length}); const b = r.getBoundingClientRect(), fr = f.getBoundingClientRect(), z = fr.width / f.offsetWidth; return { x: fr.left + (b.left + b.width / 2) * z, y: fr.top + (b.top + b.height / 2) * z }; } return null; })()`);
// what a person sees while editing: the caret is in the element in the frame, and what is highlighted
const editState = (id) => json(`(() => { const f = ${liveFrame(id)}; const d = f?.contentDocument; const a = d?.activeElement; return { focused: document.activeElement === f && !!a?.isContentEditable, tag: a?.localName ?? null, selected: d?.getSelection().toString() ?? '', collapsed: d?.getSelection().isCollapsed ?? true, dialog: !!document.querySelector('dialog[open]') }; })()`);
const show = async (id) => { await q(`napkin.select(null); napkin.view.fitRect(napkin.stage.componentRect('${id}'), { pad: 160, max: 1 }); 0`); await sleep(400); };
async function newText(words, at) {
  await emptyCanvas();
  const before = await frames();
  await io.key('t');
  await io.click(at.x, at.y);
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-new-text');
  await words();
  await io.key('Escape');
  let id = null;
  await until(async () => { id = (await frames()).find((f) => !before.includes(f)); return id && existsSync(file(id)) && (await q(`napkin.state.selection?.component`)) === id && (await q(`!!${liveFrame(id)}?.contentDocument?.querySelector('p')`)); });
  return id;
}

test('round 2: double-click a word in committed text edits it with that word selected; Escape writes it; one undo restores the text exactly', { timeout: 90000 }, async () => {
  const id = await newText(() => io.type('Good morning'), { x: 300, y: 180 });
  const original = readFileSync(file(id), 'utf8');
  assert.match(original, />Good morning<\/p>/);
  const w = await wordAt(id, 'morning');
  await io.dblclick(w.x, w.y);
  await until(async () => (await editState(id)).focused);
  const s = await editState(id);
  assert.equal(s.selected, 'morning', 'the word under the pointer is selected');
  assert.equal(s.tag, 'p', 'the text itself is editable, in the frame');
  assert.equal(s.dialog, false, 'nothing over the canvas');
  await io.type('evening');
  await io.key('Escape');
  await until(async () => />Good evening<\/p>/.test(readFileSync(file(id), 'utf8')));
  await until(async () => (await q(`napkin.state.selection?.component`)) === id && (await q(`napkin.state.selection?.node`)) !== null);
  assert.equal(await q(`(() => { const s = napkin.state.selection; return napkin.stage.sections.get(s.component).docFrame.element(s.node)?.el.localName; })()`), 'p', 'the text stays selected');
  assert.equal(await q('napkin.state.tool'), 'select');
  assert.equal((await editState(id)).focused, false, 'editing is over');
  await q('document.activeElement?.blur?.(); 0');
  await io.key('z', { ctrl: true });
  await until(async () => readFileSync(file(id), 'utf8') === original);
});

test('round 2: arrows move the caret while editing, they do not move the card', { timeout: 60000 }, async () => {
  const id = (await frames()).find((f) => />Good morning<\/p>/.test(readFileSync(file(f), 'utf8')));
  await show(id);
  const card = await cardRect(id);
  const w = await wordAt(id, 'Good');
  await io.dblclick(w.x, w.y);
  await until(async () => (await editState(id)).selected === 'Good');
  await io.key('ArrowRight'); // the caret goes to the end of "Good"
  await io.key('ArrowRight'); // and past the space
  await io.type('very ');
  await io.key('Enter', { ctrl: true });
  await until(async () => />Good very morning<\/p>/.test(readFileSync(file(id), 'utf8')));
  const after = await cardRect(id);
  assert.ok(Math.abs(after.l - card.l) < 1 && Math.abs(after.t - card.t) < 1, 'the card stayed where it was');
});

test('round 2: Enter on selected text edits all of it; F2 does the same; no dialog', { timeout: 60000 }, async () => {
  await show('page.html');
  const h = await wordAt('page.html', 'Plan');
  await io.click(h.x, h.y);
  await until(async () => (await q(`(() => { const s = napkin.state.selection; return s?.component === 'page.html' && napkin.stage.sections.get('page.html').docFrame.element(s.node)?.el.localName; })()`)) === 'h1');
  await io.key('Enter');
  await until(async () => (await editState('page.html')).focused);
  assert.equal((await editState('page.html')).selected, 'Plan the week', 'all of the text is selected');
  assert.equal(await q('document.body.dataset.focus ?? null'), null, 'Enter edits the text, it does not focus the card');
  await io.type('Plan the month');
  await io.key('Escape');
  await until(async () => /<h1>Plan the month<\/h1>/.test(readFileSync(file('page.html'), 'utf8')));
  await until(async () => (await q(`(() => { const s = napkin.state.selection; return s?.component === 'page.html' && napkin.stage.sections.get('page.html').docFrame.element(s.node)?.el.localName; })()`)) === 'h1');
  // F2: the same, all selected; Escape with nothing changed writes nothing
  const before = readFileSync(file('page.html'), 'utf8');
  await io.key('F2');
  await until(async () => (await editState('page.html')).focused);
  const s = await editState('page.html');
  assert.equal(s.selected, 'Plan the month');
  assert.equal(s.dialog, false, 'F2 on text never opens a dialog');
  await io.key('Escape');
  await until(async () => !(await editState('page.html')).focused);
  await sleep(300);
  assert.equal(readFileSync(file('page.html'), 'utf8'), before, 'nothing written');
});

test('round 2: Ctrl+B in text writes bold markup to the file; Ctrl+I and Ctrl+U too; one undo takes it back', { timeout: 60000 }, async () => {
  const before = readFileSync(file('page.html'), 'utf8');
  const w = await wordAt('page.html', 'month');
  await io.dblclick(w.x, w.y);
  await until(async () => (await editState('page.html')).selected === 'month');
  await io.key('b', { ctrl: true });
  assert.equal(await q(`${liveFrame('page.html')}.contentDocument.querySelector('h1 b, h1 strong')?.textContent ?? null`), 'month', 'bold shows at once');
  await io.key('Escape');
  await until(async () => /<h1>Plan the <strong>month<\/strong><\/h1>/.test(readFileSync(file('page.html'), 'utf8')));
  // the bold run survives the commit: the frame draws it from the file
  await until(async () => (await q(`${liveFrame('page.html')}.contentDocument.querySelector('h1 strong')?.textContent ?? null`)) === 'month');
  await q('document.activeElement?.blur?.(); 0');
  await io.key('z', { ctrl: true });
  await until(async () => readFileSync(file('page.html'), 'utf8') === before);
  // new text: italic and underline while typing, and Enter makes a new line (<br>), the same as in text edited again
  const id = await newText(async () => {
    await io.type('Say ');
    await io.key('i', { ctrl: true }); await io.type('soft'); await io.key('i', { ctrl: true });
    await io.type(' and ');
    await io.key('u', { ctrl: true }); await io.type('clear'); await io.key('u', { ctrl: true });
    await io.key('Enter');
    await io.type('twice');
  }, { x: 900, y: 180 });
  assert.match(readFileSync(file(id), 'utf8'), /<p style="margin: 0; font: 16px\/1\.4 system-ui, sans-serif">Say <em>soft<\/em> and <u>clear<\/u><br>twice<\/p>/);
  // Enter in text edited again is the same new line
  const t = await wordAt(id, 'twice');
  await io.dblclick(t.x, t.y);
  await until(async () => (await editState(id)).selected === 'twice');
  await io.key('ArrowRight');
  await io.key('Enter');
  await io.type('again');
  await io.key('Escape');
  await until(async () => /<u>clear<\/u><br>twice<br>again<\/p>/.test(readFileSync(file(id), 'utf8')));
});

test('round 2: pasted text arrives as plain text, without foreign styles', { timeout: 60000 }, async () => {
  const id = (await frames()).find((f) => />Good very morning<\/p>/.test(readFileSync(file(f), 'utf8')));
  await show(id);
  const w = await wordAt(id, 'very');
  await io.dblclick(w.x, w.y);
  await until(async () => (await editState(id)).selected === 'very');
  // a paste the way the browser delivers one from another page: rich HTML and its plain text
  await q(`(() => { const f = ${liveFrame(id)}, d = f.contentDocument, dt = new DataTransfer(); dt.setData('text/html', '<span style="color: red; font-size: 40px">really</span>'); dt.setData('text/plain', 'really'); d.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })(); 0`);
  await io.key('Escape');
  await until(async () => />Good really morning<\/p>/.test(readFileSync(file(id), 'utf8')));
  assert.doesNotMatch(readFileSync(file(id), 'utf8'), /color: red|40px/);
});

test('round 2: F2 on a frame renames it in place with no dialog; F2 on a component card too', { timeout: 60000 }, async () => {
  const id = (await frames())[0];
  await show(id);
  const head = await json(`(() => { const r = document.querySelector('section.cmp[data-component="${id}"] .cmp-title h3').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await io.click(head.x, head.y);
  await until(async () => (await q('napkin.state.selection?.component')) === id);
  await io.key('F2');
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename');
  assert.equal(await q(`!!document.querySelector('dialog[open]')`), false, 'no dialog over the canvas');
  assert.equal(await q(`document.activeElement.closest('section.cmp')?.dataset.component`), id, 'the field is the frame’s own label');
  assert.equal(await q(`document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === document.activeElement.value.length`), true, 'the name is selected');
  await io.type('welcome');
  await io.key('Enter');
  await until(async () => existsSync(file('welcome.html')) && !existsSync(file(id)));
  // a component card (Card.tsx): the same field on its label, never the old dialog; Escape leaves the name as it was
  const cid = await q(`napkin.find('Card').component`);
  await show(cid);
  const card = await json(`(() => { const r = document.querySelector('section.cmp[data-component="${cid}"] .cmp-title h3').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await io.click(card.x, card.y);
  await until(async () => (await q('napkin.state.selection?.component')) === cid);
  await io.key('F2');
  await until(async () => (await q(`document.activeElement?.className`)) === 'nk-rename');
  assert.equal(await q(`!!document.querySelector('dialog[open]')`), false, 'no dialog over the canvas');
  assert.equal(await q(`document.activeElement.value`), 'Card');
  await io.key('Escape');
  await until(async () => !(await q(`!!document.querySelector('.nk-rename')`)));
  assert.equal(await q(`napkin.find('Card')?.component`), cid, 'still called Card');
});
