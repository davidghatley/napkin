// Round 2: the preview is the file's result; inherited values; keyboard order; no false off-scale flags on the real
// secret-sauce components; the source lines and labels never wrap or truncate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, readAll, sleep } from './helpers.js';
import { assembleCorpus } from '../../bench/corpus.js';
import { join } from 'node:path';

const sides = (a, comp, sel) => a.q(`JSON.stringify((() => { const el = napkin.stage.sections.get(${JSON.stringify(comp)}).docFrame.doc().querySelector(${JSON.stringify(sel)}); const cs = getComputedStyle(el); return ['top', 'right', 'bottom', 'left'].map((s) => cs.getPropertyValue('padding-' + s)); })())`).then(JSON.parse);

test('round 2: the preview shows what Apply will make, a longhand that still wins included', { timeout: 90000 }, async () => {
  const files = {
    'c.css': '.card { padding: 8px; }\n.card.big { padding-left: 20px; }\n',
    'p.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="c.css"></head><body><div class="card big" id="x">Hi</div></body></html>\n',
  };
  const a = await open({ files });
  try {
    const n = await a.node('p.html', (x) => x.attrs.id === 'x');
    await a.select('p.html', n.node);
    assert.deepEqual(await sides(a, 'p.html', '#x'), ['8px', '8px', '8px', '20px']);
    await a.typeIn('#pv-padding', '10px');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'class');
    const note = await a.q(`document.querySelector('#doc-staged .scopenote').textContent`);
    assert.match(note, /padding-left still wins from \.card\.big/, 'said plainly');
    const preview = await sides(a, 'p.html', '#x');
    assert.deepEqual(preview, ['10px', '10px', '10px', '20px'], 'the longhand still wins in the preview');
    await a.io.key('Enter');
    await a.browser.waitFor(`!document.querySelector('#doc-staged .scope')`, 8000);
    await a.browser.waitFor(`document.querySelectorAll('style[data-napkin-preview]').length === 0`);
    await sleep(600);
    assert.deepEqual(await sides(a, 'p.html', '#x'), preview, 'after Apply the page is what the preview showed');
    assert.equal(readAll(a.dir)['c.css'], '.card { padding: 10px; }\n.card.big { padding-left: 20px; }\n');
  } finally { await a.close(); }
});

test('round 2: inherited values are listed with a link that selects the ancestor; rows never truncate or wrap', { timeout: 90000 }, async () => {
  const files = {
    'c.css': '.card.dark { color: var(--fg); font: 14px/20px serif; }\n:root { --fg: #123456; }\n.pill { padding: 2px; }\n',
    'p.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="c.css"></head><body><div class="card dark" id="c"><p><span class="pill" id="s">Hi</span></p></div></body></html>\n',
  };
  const a = await open({ files });
  try {
    const span = await a.node('p.html', (x) => x.attrs.id === 's'), card = await a.node('p.html', (x) => x.attrs.id === 'c');
    await a.select('p.html', span.node);
    const inh = JSON.parse(await a.q(`JSON.stringify([...document.querySelectorAll('#doc-inherited .vrow')].map((r) => ({ label: r.querySelector('.lbl').textContent, link: r.querySelector('.plink')?.textContent.trim(), value: r.querySelector('.ro').textContent })))`));
    assert.ok(inh.some((r) => r.label === 'color' && /\.card\.dark c\.css:1/.test(r.link) && r.value === 'var(--fg)'), JSON.stringify(inh));
    assert.ok(inh.some((r) => r.label === 'font' && /\.card\.dark/.test(r.link) && /14px\/20px/.test(r.value)), 'the font shorthand on the ancestor is one row');
    assert.equal(await a.q(`/Nothing styles/.test(document.querySelector('#doc-values').innerText)`), false);
    await a.q(`document.querySelector('#doc-inherited .plink').click()`);
    await a.browser.waitFor(`!!document.querySelector('#panel .doc-head[data-node="${card.node}"] ~ .doc-body')`);
    // server and canvas agree on what is inherited
    const srv = (await (await fetch(`${a.app.url}api/component/p.html/rules?node=${span.node}`)).json()).node.inherited;
    assert.deepEqual(srv.map((r) => [r.prop, r.from]).sort(), [['color', card.node], ['font', card.node]].sort());
  } finally { await a.close(); }
});

test('round 2: tab order is field, scope, Apply; one Tab stop per strip with arrows between chips', { timeout: 90000 }, async () => {
  const a = await open();
  try {
    const n = await a.node('Note/preview.html', (x) => x.tag === 'span' && x.attrs.class === 'ss-note__tag');
    await a.select('Note/preview.html', n.node);
    // a field focused by a script, then a chip clicked: the binding still stages
    await a.q(`document.querySelector('#pv-padding').focus()`);
    await a.q(`document.querySelector('#doc-vars').scrollIntoView()`);
    const c = await a.center('.ivchip[data-var="--space-2"]');
    await a.io.click(c.x, c.y);
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    assert.equal(await a.q(`napkin.inspector.state().prop`), 'padding');
    await a.io.key('Escape');
    // type a value; one Tab reaches the scope, the next Apply, and Shift+Tab goes back to the field
    await a.typeIn('#pv-padding', 'var(--space-1) 16');
    await a.browser.waitFor(`!!document.querySelector('#doc-staged .scope')`);
    await a.io.key('Tab');
    assert.equal(await a.q(`document.activeElement.dataset.scope`), 'class');
    await a.io.key('ArrowDown');
    assert.equal(await a.q(`napkin.inspector.state().scope`), 'variable');
    await a.io.key('Tab');
    assert.equal(await a.q(`document.activeElement.id`), 'doc-apply');
    await a.io.key('Tab');
    assert.equal(await a.q(`document.activeElement.id`), 'doc-cancel');
    await a.q(`document.querySelector('[data-scope=variable]').focus()`);
    await a.io.key('Tab', { shift: true });
    assert.equal(await a.q(`document.activeElement.id`), 'pv-padding');
    await a.io.key('Escape');
    // strips: one tab stop each, arrows move
    assert.equal(await a.q(`document.querySelectorAll('#doc-vars .ivchip[tabindex="0"]').length === document.querySelectorAll('#doc-vars .ivstrip').length`), true);
    await a.q(`document.querySelector('.ivchip[tabindex="0"]').focus()`);
    const first = await a.q(`document.activeElement.dataset.var`);
    await a.io.key('ArrowRight');
    assert.notEqual(await a.q(`document.activeElement.dataset.var`), first);
    assert.equal(await a.q(`document.querySelectorAll('#doc-vars .ivchip[tabindex="0"]').length === document.querySelectorAll('#doc-vars .ivstrip').length`), true);
  } finally { await a.close(); }
});

const real = (() => { try { return join(assembleCorpus().dir, 'ss-ds'); } catch { return null; } })();
test('round 2: on the real Note and the primary button nothing is flagged by mistake; lines are single and labels whole', { skip: !real, timeout: 120000 }, async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const files = {}; (function walk(d, rel) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p, r); else if (/\.(css|html)$/.test(e.name)) files[r] = readFileSync(p, 'utf8'); } })(real, '');
  const a = await open({ files, dir: real, theme: 'light' });
  try {
    const note = 'components/Note/preview.html', ctl = 'components/Controls/preview.html';
    for (const [id, pred] of [[note, (x) => x.attrs.class === 'ss-note__body'], [note, (x) => x.attrs.class === 'ss-note__tag'], [ctl, (x) => /ss-button--primary/.test(x.attrs.class || '')]]) {
      const n = await a.node(id, pred);
      await a.select(id, n.node);
      assert.equal(await a.q(`document.querySelectorAll('.vrow.off').length`), 0, `${id} ${n.attrs.class}: no flags: ${await a.q(`[...document.querySelectorAll('.pflag')].map((f) => f.innerText).join(' | ')`)}`);
      // every source line fits on one line; every label is whole
      const bad = await a.q(`JSON.stringify([...document.querySelectorAll('#doc-values .pfrom')].filter((l) => l.scrollHeight > l.clientHeight + 1).map((l) => l.textContent))`).then(JSON.parse);
      assert.deepEqual(bad, [], 'source lines are one line');
      assert.equal(await a.q(`[...document.querySelectorAll('#doc-values .phead label')].every((l) => l.scrollWidth <= l.clientWidth + 1)`), true, 'labels whole');
    }
    // the primary button: border is marked partly overridden, by the cobalt border-color
    const btn = await a.node(ctl, (x) => /ss-button--primary/.test(x.attrs.class || ''));
    await a.select(ctl, btn.node);
    const row = await a.q(`document.querySelector('.vrow[data-prop="border"]').innerText.replace(/\\s+/g, ' ')`);
    assert.match(row, /partly overridden/); assert.match(row, /border-color from \.ss-button--primary components\.css:\d+/);
    // the variable strips wrap inside the panel: no chip is cut by the panel edge, and no nested scroller
    await a.q(`document.querySelector('#doc-vars').scrollIntoView()`);
    const clip = await a.q(`(() => { const p = document.querySelector('#inspector').getBoundingClientRect(); return [...document.querySelectorAll('.ivchip')].filter((c) => { const r = c.getBoundingClientRect(); return r.right > p.right + 0.5 || r.left < p.left - 0.5; }).length; })()`);
    assert.equal(clip, 0);
    assert.equal(await a.q(`getComputedStyle(document.querySelector('#doc-vars-body')).overflowY`), 'visible');
  } finally { await a.close(); }
});
