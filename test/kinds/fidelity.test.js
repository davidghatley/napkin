// Ordinary files that earlier viewers got wrong, checked in a real browser: what the viewer shows must be what the file holds,
// every part of the file must be reachable, and every file must have a card from the start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';

test('viewers show files exactly and completely: tables, JSON, Markdown, Lottie assets, module cards', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-fidelity-')),
    files = join(dir, 'files');
  mkdirSync(join(files, 'samples'), { recursive: true });
  copyFileSync(resolve('test/kinds/samples/color.png'), join(files, 'samples/color.png'));
  writeFileSync(join(files, 'duplicates.csv'), 'id,value,value\n0,11,22\n1,33,44\n');
  writeFileSync(join(files, 'identifiers.csv'), 'zip,account,amount\n00123,9007199254740993,1.50\n00456,9007199254740995,2\n');
  writeFileSync(join(files, 'object.json'), JSON.stringify({ items: Array.from({ length: 1500 }, (_, i) => ({ n: i })), note: 'end' }).replace('"note"', '"id":12345678901234567890,"note"'));
  writeFileSync(join(files, 'rich.md'), '# Review\n\n| Artifact | State |\n| --- | --- |\n| Table | Ready |\n\n- [x] Finished\n- [ ] Pending\n\n<script>window.ran=1</script>\n\n![Color](samples/color.png)\n');
  writeFileSync(
    join(files, 'external.lottie.json'),
    JSON.stringify({ v: '5.7.0', fr: 30, ip: 0, op: 90, w: 320, h: 240, layers: [{ ddd: 0, ind: 1, ty: 2, refId: 'img_0', sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [100, 100, 0] }, a: { a: 0, k: [1, 1, 0] }, s: { a: 0, k: [5000, 5000, 100] } }, ao: 0, ip: 0, op: 120, st: 0, bm: 0 }], assets: [{ id: 'img_0', w: 2, h: 2, u: 'samples/', p: 'color.png', e: 0 }] }),
  );
  writeFileSync(join(files, 'NoExport.tsx'), 'export const config = { title: "ordinary module" };\n');
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } }),
    browser = await launchChromium({ width: 1200, height: 800 });
  t.after(async () => {
    await browser.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const view = async (name, ready) => {
    await browser.goto(server.url + 'view/' + encodeURIComponent(name));
    await browser.waitFor(ready, 10000);
  };
  // Duplicate headers are separate columns; every cell is the file's text.
  await view('duplicates.csv', 'document.querySelectorAll("tbody tr").length===2');
  assert.deepEqual(await browser.eval('[...document.querySelectorAll("thead th")].map(th=>th.childNodes[0].textContent)'), ['id', 'value', 'value']);
  assert.deepEqual(await browser.eval('[...document.querySelectorAll("tbody tr")[0].cells].map(c=>c.textContent)'), ['0', '11', '22']);
  await view('identifiers.csv', 'document.querySelectorAll("tbody tr").length===2');
  assert.deepEqual(await browser.eval('[...document.querySelectorAll("tbody tr")[0].cells].map(c=>c.textContent)'), ['00123', '9007199254740993', '1.50']);
  // The 1,500th entry of a nested list is reachable, and a 20-digit number keeps its digits.
  await view('object.json', '!!document.querySelector(".json-tree details")');
  assert.ok(await browser.eval('document.querySelector(".json-tree").textContent.includes("12345678901234567890")'));
  const items = '[...document.querySelectorAll(".json-tree details")].find(d=>d.querySelector(":scope>summary .json-key").textContent==="items")';
  await browser.eval(`(()=>{const d=${items};d.open=true;})()`);
  for (let i = 0; i < 10; i++) {
    const more = await browser.eval(`(()=>{const b=${items}.querySelector(":scope>.json-more");if(!b)return false;b.click();return true})()`);
    if (!more) break;
  }
  assert.equal(await browser.eval(`${items}.querySelectorAll(":scope>details").length`), 1500);
  await browser.eval(`(()=>{const d=[...${items}.querySelectorAll(":scope>details")].at(-1);d.open=true})()`);
  await browser.waitFor(`[...${items}.querySelectorAll(":scope>details")].at(-1).textContent.includes("1499")`);
  // Markdown tables and task lists render; raw HTML does not run.
  await view('rich.md', '!!document.querySelector("article.prose")');
  assert.equal(await browser.eval('document.querySelectorAll("article.prose table td").length'), 2);
  assert.deepEqual(await browser.eval('[...document.querySelectorAll("article.prose input[type=checkbox]")].map(i=>i.checked)'), [true, false]);
  assert.equal(await browser.eval('window.ran'), undefined);
  await browser.waitFor('document.querySelector("article.prose img")?.naturalWidth>0');
  // A Lottie image layer reads its picture from next to the animation.
  await view('external.lottie.json', '!!document.querySelector(".motion-stage svg image")');
  const href = await browser.eval('document.querySelector(".motion-stage svg image").getAttribute("href")||document.querySelector(".motion-stage svg image").getAttribute("xlink:href")');
  assert.equal((await fetch(new URL(href, server.url))).status, 200, href);
  await browser.eval('new Promise(r=>setTimeout(r,400))');
  assert.equal(await browser.eval('[...document.querySelectorAll(".note")].some(n=>/could not be found|drew nothing/.test(n.textContent))'), false);
  // A TSX module with no component export gets its own card on the canvas, with its source.
  await browser.goto(server.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 20000);
  await browser.waitFor('!!document.querySelector(\'[data-item-id="NoExport.tsx"]\')', 10000);
  assert.match(await browser.eval('document.querySelector(\'[data-item-id="NoExport.tsx"]\').innerHTML'), /ordinary module/);
});

test('a folder holding only a newly registered kind shows its content and a Layers row from the start', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-only-plugin-')),
    files = join(dir, 'files'),
    plugin = join(dir, 'note.mjs');
  mkdirSync(files);
  writeFileSync(join(files, 'note.criticnote'), 'A field note about soil.\n');
  writeFileSync(
    plugin,
    `export default ({registerKind})=>registerKind({id:'critic-note',family:'note',mime:'text/plain',extensions:['.criticnote'],
detect:c=>c.ext==='.criticnote',metadata:c=>({excerpt:c.text.slice(0,160)}),
viewer:c=>'<html data-napkin-kind="critic-note"><body><article>'+c.text.replaceAll('<','&lt;')+'</article></body></html>',
controls:c=>[{id:'note',label:'Note',controls:[{id:'text',label:'Text',type:'textarea',value:c.text,depth:2}]}],apply:(c,k,v)=>({source:v})});`,
  );
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state'), NAPKIN_KIND_PLUGINS: plugin } }),
    browser = await launchChromium({ width: 1200, height: 800 });
  t.after(async () => {
    await browser.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await browser.goto(server.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 20000);
  await browser.waitFor('!!document.querySelector(\'[data-item-id="note.criticnote"]\')', 10000);
  // The card shows the file's text, as its card or as the kind's own viewer once drawn live.
  await browser.waitFor('(()=>{const el=document.querySelector(\'[data-item-id="note.criticnote"]\');let t=decodeURIComponent(el.innerHTML);try{t+=el.querySelector("iframe")?.contentDocument?.body?.textContent||""}catch{}return /A field note about soil/.test(t)})()', 10000);
  await browser.waitFor('!!document.querySelector(\'.lrow[data-component="note.criticnote"]\')', 5000);
});
