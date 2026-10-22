// PRF-02, PRF-04: what keeps a frame cheap at 200 components. These are structural checks (the timings are bench/perf.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCorpus } from '../../bench/corpus.js';
import { startServer, sleep } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';

test('a far frame keeps its box but not its contents; a pan restyles nothing; a render is announced once; typing previews', async (t) => {
  const { dir } = generateCorpus(50);
  const server = await startServer(dir), b = await launchChromium({ width: 1440, height: 900 });
  t.after(async () => { await b.close(); await server.stop(); rmSync(dir, { recursive: true, force: true }); });
  await b.goto(server.url);
  await b.waitFor('napkin.state.components.size === 50 && document.body.dataset.ready === "1" && document.querySelectorAll(".cell .mount > *").length >= 100');
  await b.eval('napkin.view.set({ x: 80, y: 120, z: 1 }); true');
  await b.waitFor('document.querySelectorAll(".cmp[data-cull]").length > 10');

  await t.test('culled frames: size kept, matrix not laid out; sections placed with left/top', async () => {
    const r = await b.eval(`(() => { const sec = document.querySelector('.cmp[data-cull]'); const frame = sec.querySelector('.frame'); const box = frame.getBoundingClientRect();
      return { display: getComputedStyle(frame.firstElementChild).display, w: box.width, h: box.height, want: [parseFloat(sec.style.getPropertyValue('--w')), parseFloat(sec.style.getPropertyValue('--h'))], transform: sec.style.transform, left: sec.style.left }; })()`);
    assert.equal(r.display, 'none');
    assert.ok(Math.abs(r.w - r.want[0]) < 1 && Math.abs(r.h - r.want[1]) < 1, `box ${r.w}x${r.h}, measured ${r.want}`);
    assert.equal(r.transform, ''); assert.match(r.left, /px$/);
    const shown = await b.eval(`document.querySelector('.cmp:not([data-cull]) .frame').firstElementChild && getComputedStyle(document.querySelector('.cmp:not([data-cull]) .frame').firstElementChild).display`);
    assert.notEqual(shown, 'none');
  });

  await t.test('panning sets no custom property on #stage (that would restyle every element under it)', async () => {
    await b.eval('napkin.view.panBy(-300, -200); true');
    const style = await b.eval(`document.querySelector('#stage').getAttribute('style') || ''`);
    assert.doesNotMatch(style, /--tx|--ty|--gz/);
    assert.match(style, /background-position/);
  });

  await t.test('one render event per component render', async () => {
    await b.eval(`window.__renders = []; napkin.on('render', (f) => __renders.push(f.component)); true`);
    const id = await b.eval(`napkin.find('Specimen000').component`);
    await b.eval('napkin.view.set({ x: 80, y: 120, z: 1 }); true');
    const file = join(dir, 'Specimen000.tsx');
    writeFileSync(file, readFileSync(file, 'utf8').replace("label = 'Specimen 0'", "label = 'Edited'"));
    await b.waitFor(`[...document.querySelectorAll('section[data-component="${id}"] .mount [data-n=label]')].every((n) => n.textContent === 'Edited')`);
    await sleep(300);
    assert.equal(await b.eval(`__renders.filter((c) => c === ${JSON.stringify(id)}).length`), 1);
  });

  await t.test('typing in a style field moves the canvas before anything is written, and Escape puts it back', async () => {
    await b.eval(`(() => { const root = document.querySelector('section[data-name="Specimen000"] .mount [data-n="root"]'); root.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
    await b.waitFor('document.querySelector("#padding")');
    await b.eval(`(() => { const e = document.querySelector('#padding'); for (let d = e.closest('details'); d; d = d.parentElement.closest('details')) d.open = true; e.focus(); e.select(); return true; })()`);
    await b.send('Input.insertText', { text: '31px' });
    await b.waitFor(`getComputedStyle(document.querySelector('section[data-name="Specimen000"] .mount [data-n="root"]')).paddingLeft === '31px'`, 1000);
    assert.equal(await b.eval(`napkin.find('Specimen000').doc.root.style.padding`), '8px', 'nothing was written yet');
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.waitFor(`getComputedStyle(document.querySelector('section[data-name="Specimen000"] .mount [data-n="root"]')).paddingLeft === '8px'`, 1000);
  });
});
