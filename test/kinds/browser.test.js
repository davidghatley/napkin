import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
test('live viewers draw their contents and mixed items join the canvas and panel', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-browser-'));
  cpSync(resolve('test/kinds/samples'), join(dir, 'files'), { recursive: true });
  const server = await startServer(join(dir, 'files'), {
      env: { NAPKIN_STATE_DIR: join(dir, 'state') },
    }),
    browser = await launchChromium({ width: 1200, height: 780 });
  t.after(async () => {
    await browser.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const errors = [];
  browser.onEvent((e) => {
    if (e.method === 'Runtime.exceptionThrown')
      errors.push(
        e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text,
      );
  });
  const evidence = process.env.KINDS_EVIDENCE ? resolve(process.env.KINDS_EVIDENCE) : join(dir, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const checks = [
    ['color.png', 'document.querySelector("img")?.naturalWidth>0'],
    ['tone.wav', 'document.querySelectorAll(".waveform rect").length===240'],
    [
      'observations.csv',
      'document.querySelectorAll("tbody tr").length===60 && document.querySelectorAll(".hist rect").length>0',
    ],
    ['inter.woff2', 'document.fonts.check("16px specimen")'],
    [
      'pyramid.obj',
      'document.querySelector("canvas")?.getContext("2d").getImageData(300,150,300,300).data.some(v=>v>0)',
    ],
    ['study.ipynb', 'document.querySelectorAll(".nb-cell").length===2'],
    ['garden.zip', 'document.querySelectorAll(".archive nav button").length===3'],
    ['garden.workflow.json', 'document.querySelectorAll(".workflow .node").length===3'],
    ['run.jsonl', 'document.querySelectorAll(".event").length===4'],
    ['bytes.bin', 'document.querySelector(".strings")?.textContent.includes("useful string")'],
    ['growth.vl.json', '!!document.querySelector(".chart .series")'],
    ['leaf.lottie.json', '!!document.querySelector(".motion-stage svg path")'],
    ['nested.lottie.json', '!!document.querySelector(".motion-stage svg path")'],
    ['motion.css', '!!document.querySelector(".css-preview")'],
    ['turn.mp4', 'document.querySelector("video")?.videoWidth>0'],
    ['guide.pdf', '!!document.querySelector(".pdf-page canvas")'],
  ];
  for (const [name, condition] of checks) {
    await browser.goto(server.url + 'view/' + encodeURIComponent(name));
    await browser.waitFor(condition, 10000);
    if(name==='guide.pdf')await browser.eval('new Promise(r=>setTimeout(r,1000))');
    assert.equal(await browser.eval('document.querySelectorAll(".error").length'), 0, name);
    if (
      ['tone.wav', 'observations.csv', 'pyramid.obj', 'garden.workflow.json', 'guide.pdf'].includes(
        name,
      )
    )
      writeFileSync(join(evidence, name.split('.')[0] + '.png'), await browser.screenshot());
  }
  await browser.goto(server.url);
  await browser.waitFor('document.body.dataset.ready === "1"', 20000);
  const counts = await browser.eval(
    '({items:napkin.state.components.items.size,total:napkin.state.components.total,frames:document.querySelectorAll(".kind-frame").length})',
  );
  assert.ok(counts.items >= 40, JSON.stringify(counts));
  assert.ok(await browser.eval('document.querySelectorAll(".kind-compact").length>0'));
  await browser.eval('napkin.nav.focus("observations.csv")');
  await browser.waitFor('!!document.querySelector(".kind-panel [data-control]") && document.querySelector(".kind-panel").textContent.includes("File values")');
  await browser.waitFor('!!document.querySelector(".kind-frame:not(.doc-next)")');
  assert.equal(await browser.eval('napkin.state.selection.component'), 'observations.csv');
  await browser.waitFor(`document.querySelector(".kind-panel")?.textContent.includes("File values")`, 10000); const panelText = await browser.eval(`document.querySelector(".kind-panel")?.textContent.slice(0,200)`); assert.ok(
    panelText?.includes("File values"), String(panelText)
  );
  await browser.eval('napkin.nav.unfocus({animate:false});napkin.view.fitAll({animate:false})');
  writeFileSync(join(evidence, 'canvas.png'), await browser.screenshot());
  assert.deepEqual(errors, []);
  console.log('Canvas counts', counts);
});
