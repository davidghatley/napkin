import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';

// Geometric assertions protect the controls a person needs while choosing a token.
const placement = `(() => {
  const p = document.querySelector('#token-picker').getBoundingClientRect();
  const a = document.querySelector('#token-picker').anchor.closest('.fld').getBoundingClientRect();
  const c = document.querySelector('#panel').getBoundingClientRect();
  return { inside: p.left >= c.left && p.right <= c.right && p.top >= Math.max(0,c.top) && p.bottom <= Math.min(innerHeight,c.bottom),
    clear: p.bottom <= a.top || p.top >= a.bottom || p.right <= a.left || p.left >= a.right,
    searchVisible: document.querySelector('#token-search').getBoundingClientRect().height >= 28,
    height: p.height };
})()`;

test('Critic: picker stays in the panel and clear of its field; distant colour asks before binding', async () => {
  const { dir, compDir, file } = tempRepo(['Button']);
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  writeFileSync(file, readFileSync(file, 'utf8').replace("background: '#2236b0'", "background: 'red'").replace("padding: '8px 16px'", "padding: 0").replace('borderRadius: 6', "borderRadius: '50%'").replace('gap: 8', "gap: 'calc(4px + 4px)',\n    margin: 0").replace("color: '#f9f9f5'", "color: 'var(--custom, red)'"));
  const server = await startServer(compDir), b = await launchChromium({ width: 1440, height: 900 });
  try {
    await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
    await b.eval(`napkin.select({ component: napkin.find('Button').component, node: 'root', variant: {size:'md',state:'default'} })`);
    await b.waitFor('!!document.querySelector("#token-padding")');
    for (const prop of ['padding', 'borderRadius', 'gap', 'margin', 'color']) assert.equal(await b.eval(`!!document.querySelector('#off-token-${prop}')`), false, `${prop} is not an off-token literal`);
    for (const prop of ['padding', 'borderRadius', 'fontSize', 'background']) {
      await b.eval(`document.querySelector('#token-${prop}').scrollIntoView({block:'center'}); document.querySelector('#token-${prop}').click()`);
      const p = await b.eval(placement);
      assert.equal(p.inside, true, `${prop}: ${JSON.stringify(p)}`);
      assert.equal(p.clear, true, prop); assert.ok(p.searchVisible && p.height > 90, prop);
      await b.eval(`document.querySelector('#token-picker-close').click()`);
    }
    const before = readFileSync(file, 'utf8');
    await b.eval(`document.querySelector('#off-token-background').scrollIntoView({block:'center'}); document.querySelector('#off-token-background').click()`);
    assert.equal(readFileSync(file, 'utf8'), before, 'distant red is not auto-snapped');
    assert.equal(await b.eval(`document.querySelectorAll('#token-results button').length`), 3);
    assert.match(await b.eval(`document.querySelector('.token-choice-hint').textContent`), /distant/);
    assert.equal((await b.eval(placement)).clear, true);
    const chosen = await b.eval(`document.querySelector('#token-results button').dataset.token`);
    await b.eval(`document.querySelector('#token-results button').click()`);
    await b.waitFor(`document.querySelector('#background').value === ${JSON.stringify(chosen)}`);
    assert.ok(readFileSync(file, 'utf8').includes(`var(--${chosen})`));
    const dotGap = await b.eval(`(() => { const dot=document.querySelector('#off-token-fontSize'); dot.closest('details').open=true; dot.scrollIntoView({block:'center'}); const d=dot.getBoundingClientRect(); const p=document.querySelector('#token-fontSize').getBoundingClientRect(); return {gap:p.left-d.right, width:d.width}; })()`);
    assert.ok(dotGap.gap >= 8 && dotGap.width >= 20, JSON.stringify(dotGap));
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 650, deviceScaleFactor: 1, mobile: false });
    await b.eval(`document.querySelector('#token-fontSize').scrollIntoView({block:'center'}); document.querySelector('#token-fontSize').click()`);
    assert.equal((await b.eval(placement)).inside, true);
    assert.equal((await b.eval(placement)).clear, true);
    assert.ok(await b.eval(`document.querySelector('#theme-toggle').getBoundingClientRect().right <= innerWidth`), 'chrome switch remains visible beside Component theme');
    if (process.env.EVIDENCE) writeFileSync(join(ROOT, 'docs/evidence/tokens-picker-docked.png'), await b.screenshot());
  } finally { await b.close(); await server.stop(); }
});

test('Critic: 92 real tokens scan by family, search by name/value/usage, and show per-mode colour swatches', async () => {
  const { dir, compDir } = tempRepo(['Button']);
  cpSync(join(ROOT, 'fixtures/tokens/scale-92.json'), join(dir, 'tokens.json'));
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens.json"}}');
  const server = await startServer(compDir), b = await launchChromium({ width: 1440, height: 900 });
  try {
    await b.goto(server.url); await b.waitFor('document.body.dataset.ready === "1"');
    await b.eval(`napkin.drawer.open('tokens')`);
    assert.equal(await b.eval(`document.querySelectorAll('#token-table .token-row').length`), 92);
    assert.deepEqual(await b.eval(`Array.from(document.querySelectorAll('.token-family'), x => x.dataset.family)`), ['colour', 'spacing', 'radius', 'type', 'other']);
    assert.equal(await b.eval(`document.querySelectorAll('[data-family=colour] .token-value .token-swatch').length`), 80);
    assert.equal(await b.eval(`document.querySelectorAll('.token-info small').length`), 0);
    assert.match(await b.eval(`document.querySelector('#token-theme-label').textContent`), /Component theme/);
    assert.equal(await b.eval(`document.querySelector('#token-theme').getAttribute('aria-label')`), 'Component theme');
    assert.ok(await b.eval(`Array.from(document.querySelectorAll('.token-value-well'), w => { const s=w.querySelector('.token-swatch'), i=w.querySelector('input'); return !s || s.getBoundingClientRect().right <= i.getBoundingClientRect().left; }).every(Boolean)`));
    await b.type('#token-drawer-search', 'surface-raised');
    assert.equal(await b.eval(`document.querySelectorAll('.token-row').length`), 1);
    await b.type('#token-drawer-search', 'Normal transitions');
    assert.equal(await b.eval(`document.querySelector('.token-row').dataset.token`), 'duration-normal');
    await b.type('#token-drawer-search', 'no-such-token');
    assert.equal(await b.eval(`document.querySelector('#token-count').textContent`), '0 of 92 tokens');
    await b.type('#token-drawer-search', '');
    assert.equal(await b.eval(`document.querySelectorAll('.token-row').length`), 92);
    assert.ok(await b.eval(`document.querySelector('#pane-tokens').scrollWidth <= document.querySelector('#pane-tokens').clientWidth`), 'no horizontal overflow');
    if (process.env.EVIDENCE) writeFileSync(join(ROOT, 'docs/evidence/tokens-drawer-92.png'), await b.screenshot());
  } finally { await b.close(); await server.stop(); }
});
