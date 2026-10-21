import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { changedLines } from '../helpers/lab.js';

test('S5: names, every off-token dot, searchable picker, one-line bind/snap, every cell theme, token source editing', async () => {
  const { dir, compDir, file } = tempRepo(['Button']);
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  writeFileSync(file, readFileSync(file, 'utf8').replace("padding: '8px 16px'", "padding: '17px'").replace("borderRadius: 6", "borderRadius: 7").replace("background: '#2236b0'", "background: 'var(--accent)'").replace("color: '#f9f9f5'", "color: 'var(--on-accent)'"));
  const server = await startServer(compDir), b = await launchChromium({ width: 1440, height: 900 });
  try {
    await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
    await b.eval(`napkin.select({component: napkin.find('Button').component, node:'root', variant:{size:'md',state:'default'}})`);
    await b.waitFor('!!document.querySelector("#token-padding")');
    assert.equal(await b.eval('document.querySelector("#background").value'), 'accent');
    assert.equal(await b.eval('!!document.querySelector("#off-token-background")'), false, 'a bound colour has no off-token dot');
    for (const prop of ['padding', 'borderRadius', 'stroke-color', 'fontSize']) assert.ok(await b.eval(`!!document.querySelector('#off-token-${prop}')`), prop);
    if (process.env.EVIDENCE) {
      await b.eval('document.documentElement.dataset.theme="light"; napkin.view.fitAll({max:1});');
      writeFileSync(join(ROOT, 'docs/evidence/tokens-off-token.png'), await b.screenshot());
    }
    const before = readFileSync(file, 'utf8');
    await b.eval('document.querySelector("#token-padding").click()');
    await b.type('#token-search', 'space-4');
    assert.equal(await b.eval('document.querySelectorAll("#token-results button").length'), 1);
    await b.eval('document.querySelector("#token-results button").click()');
    await b.waitFor('document.querySelector("#padding").value === "space-4"');
    assert.deepEqual(changedLines(before, readFileSync(file, 'utf8')), { added: 1, removed: 1 });
    assert.ok(await b.eval(`(() => { const i=document.querySelector('#padding'); const c=document.createElement('canvas').getContext('2d'); c.font=getComputedStyle(i).font; return i.clientWidth >= c.measureText(i.value).width; })()`), 'token name fits inside its 28 px well');
    const beforeSnap = readFileSync(file, 'utf8');
    await b.eval('document.querySelector("#off-token-borderRadius").click()');
    await b.waitFor('document.querySelector("#borderRadius").value === "radius-medium"');
    assert.deepEqual(changedLines(beforeSnap, readFileSync(file, 'utf8')), { added: 1, removed: 1 });
    await b.eval(`document.querySelector('#token-theme').value = 'dark'; document.querySelector('#token-theme').dispatchEvent(new Event('change'))`);
    const colours = await b.eval(`Array.from(document.querySelectorAll('.cell .mount [data-n=root]'), e => getComputedStyle(e).getPropertyValue('--accent').trim())`);
    assert.equal(colours.length, 6); assert.ok(colours.every(c => c === '#8caaff'), JSON.stringify(colours));
    await b.eval('document.querySelector("#open-tokens").click()');
    await b.waitFor('!!document.querySelector("[data-token=accent] input[data-mode=dark]")');
    const tokenSource = join(dir, 'tokens/tokens.json'), prior = readFileSync(tokenSource, 'utf8');
    await b.type('[data-token=accent] input[data-mode=dark]', '#99bbee');
    await b.waitFor(`getComputedStyle(document.querySelector('.cell .mount [data-n=root]')).getPropertyValue('--accent').trim() === '#99bbee'`);
    assert.deepEqual(changedLines(prior, readFileSync(tokenSource, 'utf8')), { added: 1, removed: 1 });
    if (process.env.EVIDENCE) {
      await b.eval('napkin.drawer.close(); napkin.view.fitAll({max:1})');
      writeFileSync(join(ROOT, 'docs/evidence/tokens-panel.png'), await b.screenshot());
      await b.eval('document.querySelector("#token-padding").click()');
      writeFileSync(join(ROOT, 'docs/evidence/tokens-picker.png'), await b.screenshot());
      await b.eval('document.querySelector("#token-picker-close").click(); napkin.drawer.open("tokens")');
      writeFileSync(join(ROOT, 'docs/evidence/tokens-drawer.png'), await b.screenshot());
    }
    const beforeVariant = readFileSync(file, 'utf8');
    await b.eval(`napkin.select({component: napkin.find('Button').component, node:'root', variant:{size:'sm',state:'default'}}); const scope=document.querySelector('#scope');scope.value='variant';scope.dispatchEvent(new Event('change',{bubbles:true}));`);
    await b.eval('document.querySelector("#token-fontSize").click()');
    await b.type('#token-search', 'body-font-size');
    await b.eval('document.querySelector("#token-results button").click()');
    await b.waitFor(`napkin.find('Button').doc.variants.size.sm.root.fontSize === 'var(--body-font-size)'`);
    assert.deepEqual(changedLines(beforeVariant, readFileSync(file, 'utf8')), { added: 1, removed: 1 });
    assert.equal(await b.eval(`napkin.find('Button').doc.root.style.fontSize`), 15, 'variant binding preserves base');
  } finally { await b.close(); await server.stop(); }
});
