import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
test('a focused file card stays live, and an HTML page with the wrong extension stays on the canvas', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-focus-')),
    files = join(dir, 'files');
  mkdirSync(files);
  for (const n of ['turn.mp4', 'observations.csv', 'tone.wav', 'textured.gltf']) copyFileSync(resolve('test/kinds/samples', n), join(files, n));
  writeFileSync(join(files, 'renamed.bin'), '<!doctype html><html><body><h1 id="hi">Renamed page</h1></body></html>');
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } }),
    browser = await launchChromium({ width: 1300, height: 820 });
  t.after(async () => {
    await browser.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await browser.goto(server.url);
  await browser.waitFor('document.body.dataset.ready === "1" && document.querySelectorAll(".item-card").length >= 4', 20000);
  // The renamed page has exactly one card, and that card draws the page.
  assert.equal(await browser.eval('document.querySelectorAll(\'.item-card[data-item-id="renamed.bin"]\').length'), 1);
  // Focus each kind of card the way a keyboard user does, then use it.
  for (const id of ['turn.mp4', 'observations.csv', 'renamed.bin']) {
    await browser.goto(server.url + '#' + encodeURIComponent(id));
    await browser.waitFor('document.body.dataset.ready === "1" && document.body.dataset.focus', 20000);
    const st = await browser.eval(`(()=>{const c=document.querySelector('.item-card[data-item-id="${id}"]');const s=getComputedStyle(c);return {focused:c.dataset.focused,opacity:s.opacity,events:s.pointerEvents}})()`);
    assert.equal(st.focused, '1', id);
    assert.equal(st.opacity, '1', id + ' dimmed while focused');
    assert.notEqual(st.events, 'none', id + ' cannot be clicked while focused');
    // Focused, the card is a live viewer: the renamed page is drawn in a sandboxed frame inside it.
    if (id === 'renamed.bin')
      await browser.waitFor(
        `(()=>{const f=document.querySelector('.item-card[data-item-id="renamed.bin"] iframe');try{return !!f?.contentDocument?.querySelector('iframe')?.srcdoc?.includes('Renamed page')}catch{return false}})()`,
        10000,
      );
  }
  // A 3D card starts on the light drawing and becomes the real 3D runtime once it is focused.
  await browser.goto(server.url + '#textured.gltf');
  await browser.waitFor(
    `(()=>{const f=document.querySelector('.item-card[data-item-id="textured.gltf"] iframe');try{return f?.contentDocument?.querySelector('canvas.model')?.dataset.renderer==='webgl'}catch{return false}})()`,
    15000,
  );
});
