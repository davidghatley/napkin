// A proposal's ghost cell (.ghost-layer .preview-inner) must get exactly the token variables, and theme, a live cell gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { session, http } from '../helpers/agents.js';

test('ghost cells draw with the same token variables as live cells, in every theme', { timeout: 120000 }, async () => {
  const { dir, compDir, file } = tempRepo(['Button']);
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  writeFileSync(file, readFileSync(file, 'utf8').replace("padding: '8px 16px'", "padding: 'var(--space-4)'").replace("background: '#2236b0'", "background: 'var(--accent)'"));
  const server = await startServer(compDir), b = await launchChromium({ width: 1440, height: 900 });
  try {
    await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
    await b.waitFor(`!!document.querySelector('section[data-name="Button"] .cell .mount [data-n=root]')`);
    const token = await session(server.url, 'scout');
    const rev = (await http(server.url, '/api/components/Button')).json.revision;
    // a proposal that changes nothing a pixel shows (cursor), so ghost and live must match exactly
    const r = await http(server.url, '/api/components/Button/edits', { method: 'POST', token, body: { baseRevision: rev, propose: true, edits: [{ op: 'set', path: 'root.cursor', value: 'pointer' }] } });
    assert.equal(r.json.proposed, true, JSON.stringify(r.json));
    await b.waitFor(`napkin.proposals.list().length === 1`);
    await b.eval(`document.querySelector('.pitem .p-show').click()`);
    await b.waitFor(`!!document.querySelector('.ghost-layer [data-n="root"]')`);
    const read = (sel) => b.eval(`JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(sel)}), cs = getComputedStyle(e), r = e.getBoundingClientRect(), o = {}; for (const p of cs) if (!/^(cursor|pointer-events|visibility)$/.test(p)) o[p] = cs.getPropertyValue(p); return { w: r.width, h: r.height, o }; })())`).then(JSON.parse);
    for (const mode of ['light', 'dark']) {
      await b.eval(`document.querySelector('#token-theme').value = '${mode}'; document.querySelector('#token-theme').dispatchEvent(new Event('change'))`);
      await sleep(300);
      const live = await read(`section[data-name="Button"] .cell .mount [data-n=root]`), ghost = await read(`section[data-name="Button"] .ghost-layer [data-n=root]`);
      assert.equal(await b.eval(`getComputedStyle(document.querySelector('section[data-name="Button"] .ghost-layer [data-n=root]')).getPropertyValue('--accent').trim()`), mode === 'dark' ? '#8caaff' : await b.eval(`getComputedStyle(document.querySelector('section[data-name="Button"] .cell .mount [data-n=root]')).getPropertyValue('--accent').trim()`), `${mode}: the ghost has the token`);
      assert.deepEqual([ghost.w, ghost.h], [live.w, live.h], `${mode}: same size`);
      const bad = Object.keys(live.o).filter((p) => live.o[p] !== ghost.o[p]).map((p) => `${p}: live ${live.o[p]} ghost ${ghost.o[p]}`);
      assert.deepEqual(bad, [], `${mode}: same computed style`);
    }
  } finally { await b.close(); await server.stop(); }
});

test('the create-proposal ghost frame (.ghost-new) gets the token variables and is isolated like a cell', { timeout: 120000 }, async () => {
  const { dir, compDir } = tempRepo(['Button']);
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  const server = await startServer(compDir), b = await launchChromium({ width: 1440, height: 900 });
  try {
    await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
    await b.waitFor(`!!document.querySelector('section[data-name="Button"] .cell .mount [data-n=root]')`);
    const token = await session(server.url, 'claude');
    const made = await http(server.url, '/api/components', { method: 'POST', token, body: { name: 'Tooltip', propose: true } });
    assert.equal(made.json.proposed, true, JSON.stringify(made.json));
    await b.waitFor(`napkin.proposals.list().length === 1`);
    await b.waitFor(`!!document.querySelector('.ghost-new [data-n="root"]')`); // drawn on arrival, nobody clicked Show ghost
    const val = (sel, name) => b.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).getPropertyValue('${name}').trim()`);
    for (const mode of ['light', 'dark']) {
      await b.eval(`document.querySelector('#token-theme').value = '${mode}'; document.querySelector('#token-theme').dispatchEvent(new Event('change'))`);
      await sleep(300);
      const live = await val('section[data-name="Button"] .cell .mount [data-n=root]', '--accent');
      assert.ok(live, 'the live cell has the token');
      assert.equal(await val('.ghost-new [data-n="root"]', '--accent'), live, `${mode}: the ghost frame has the same token value`);
    }
    // the ghost's cell is isolated exactly like a live cell: same reset on its .mount, nothing inherited from the editor or the frame
    const cell = (sel) => b.eval(`JSON.stringify((() => { const cs = getComputedStyle(document.querySelector(${JSON.stringify(sel)})); return { font: cs.fontFamily, size: cs.fontSize, lh: cs.lineHeight, color: cs.color, scheme: cs.colorScheme, display: cs.display }; })())`);
    assert.equal(await cell('.ghost-new .cell .mount'), await cell('section[data-name="Button"] .cell .mount'), 'the ghost .mount computes the same as a live .mount');
    // isolation: the ghost frame's component sees no editor colour or font, and no editor custom property
    assert.equal(await b.eval(`getComputedStyle(document.querySelector('.ghost-new [data-n="root"]')).color`), 'rgb(0, 0, 0)');
    const names = (sel) => b.eval(`(() => { const cs = getComputedStyle(document.querySelector(${JSON.stringify(sel)})); const out = []; for (const p of cs) if (p.startsWith('--') && !p.startsWith('--nk-')) out.push(p); return out.sort().join(); })()`);
    const live = await names('section[data-name="Button"] .cell .mount [data-n=root]');
    assert.ok(live.includes('--accent'), 'token variables are present in the live cell');
    assert.equal(await names('.ghost-new [data-n="root"]'), live, 'the ghost frame sees exactly the live cell\'s custom properties (the tokens), nothing of the editor');
  } finally { await b.close(); await server.stop(); }
});
