// AGT-04 on the canvas: the proposals tray, ghost before/after cells, accept/reject per proposal and per edit, accept all, stale reasons, keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openAgents, sleep, waitFor } from './helpers.js';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const PAD = (v) => [{ op: 'set', path: 'root.padding', value: v }];

test('proposals tray and ghost cells', { timeout: 170000 }, async (t) => {
  const p = await openAgents(['Button', 'Card', 'Chip']);
  const { q, browser, io } = p;
  const text = (sel) => q(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
  const btn = p.fileOf('Button'), card = p.fileOf('Card');
  const listLen = () => q('napkin.proposals.list().length');
  try {
    const scout = await p.agent('scout'), claude = await p.agent('claude');
    const base = sha(btn), baseCard = sha(card);
    const many = await scout.apply('Button', [{ op: 'set', path: 'root.padding', value: '40px' }, { op: 'set', path: 'label.fontWeight', value: 900 }, { op: 'set', path: 'root.borderRadius', value: 2 }], { propose: true });
    assert.equal(many.proposed, true, JSON.stringify(many));
    const one = await claude.apply('Card', [{ op: 'set', path: 'title.fontWeight', value: 300 }], { propose: true });
    assert.equal(one.proposed, true, JSON.stringify(one));

    await t.test('the tray lists proposals per agent: "2 proposals · claude, scout"', async () => {
      await browser.waitFor(`document.querySelector('#proposals-tray') && !document.querySelector('#proposals-tray').hidden && napkin.proposals.list().length === 2`);
      assert.equal(await q(`document.querySelector('#proposals-tray').dataset.count`), '2');
      assert.match(await text('#pt-toggle'), /2\s*proposals · claude, scout/);
      assert.deepEqual(await q(`[...document.querySelectorAll('#proposals-tray .pt-group')].map((g) => g.textContent)`), ['claude · 1', 'scout · 1']);
      // docked under the canvas, on the right: it never overlaps the stage
      const r = await q(`(() => { const t = document.querySelector('#proposals-tray').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return { overlaps: t.top < s.bottom - 1 && t.bottom > s.top && t.left < s.right && t.right > s.left, trayTop: t.top, stageBottom: s.bottom, right: Math.round(document.body.clientWidth - t.right - document.querySelector('#inspector').getBoundingClientRect().width) }; })()`);
      assert.equal(r.overlaps, false, `the tray does not cover the canvas: ${JSON.stringify(r)}`);
      assert.equal(sha(btn), base); assert.equal(sha(card), baseCard);
    });

    await t.test('picking a proposal draws ghost cells over every cell without touching live cells or the file', async () => {
      const liveBefore = await q(`document.querySelector('section.cmp[data-name="Button"] .cell .mount').innerHTML`);
      const cells = await q(`document.querySelectorAll('section.cmp[data-name="Button"] .cell').length`);
      await q(`document.querySelector('.pitem[data-by="scout"] .p-show').click()`);
      await browser.waitFor(`document.querySelectorAll('section.cmp[data-name="Button"] .ghost-layer').length === ${cells}`);
      await browser.waitFor(`!!document.querySelector('.ghost-layer [data-n="root"]')`).catch(async (e) => { console.log(await q(`document.querySelector('.ghost-layer').outerHTML`)); throw e; });
      const ghostPad = await q(`getComputedStyle(document.querySelector('section.cmp[data-name="Button"] .ghost-layer [data-n="root"]')).paddingTop`);
      const livePad = await q(`getComputedStyle(document.querySelector('section.cmp[data-name="Button"] .cell .mount [data-n="root"]')).paddingTop`);
      assert.equal(ghostPad, '40px'); assert.notEqual(livePad, '40px', 'the live cell still shows the file');
      assert.equal(await q(`document.querySelector('section.cmp[data-name="Button"] .cell .mount').innerHTML`), liveBefore, 'the live cell is untouched');
      assert.match(await text('.ghost-flag'), /scout's proposal · after · not written/);
      // the component is fully in view, and the flag is visible and not under the tray
      const vis = await q(`(() => { const st = document.querySelector('#stage').getBoundingClientRect(), tr = document.querySelector('#proposals-tray').getBoundingClientRect(); const inside = (r) => r.left >= st.left - 1 && r.right <= st.right + 1 && r.top >= st.top - 1 && r.bottom <= st.bottom + 1; const f = document.querySelector('.ghost-flag').getBoundingClientRect(); const c = document.querySelector('section.cmp[data-name="Button"] .frame').getBoundingClientRect(); const top = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2); return { frame: inside(c), flag: inside(f), covered: !!top?.closest('#proposals-tray'), underTray: f.bottom > tr.top && f.top < tr.bottom && f.right > tr.left }; })()`);
      assert.deepEqual(vis, { frame: true, flag: true, covered: false, underTray: false }, JSON.stringify(vis));
      assert.equal(sha(btn), base, 'drawing the ghost wrote nothing');
      // before | split | after
      await q(`document.querySelector('#pt-mode-split').click()`);
      await browser.waitFor(`!!document.querySelector('.ghost-divider')`);
      assert.equal(await q(`getComputedStyle(document.querySelector('.ghost-layer')).clipPath.includes('50%')`), true);
      await q(`document.querySelector('#pt-mode-before').click()`);
      await browser.waitFor(`getComputedStyle(document.querySelector('.ghost-layer')).visibility === 'hidden'`);
      await q(`document.querySelector('#pt-mode-after').click()`);
      await p.shot('agents-ghost-after');
    });

    await t.test('per-edit ghost: only edit N\'s effect is drawn', async () => {
      await q(`document.querySelector('.pitem[data-by="scout"] li[data-edit="1"] .ed-show').click()`);
      await browser.waitFor(`/edit 2 of 3/.test(document.querySelector('.ghost-flag')?.textContent ?? '')`);
      await browser.waitFor(`!!document.querySelector('section.cmp[data-name="Button"] .ghost-layer [data-n="label"]')`);
      const g = await q(`(() => { const r = document.querySelector('section.cmp[data-name="Button"] .ghost-layer [data-n="root"]'); const l = document.querySelector('section.cmp[data-name="Button"] .ghost-layer [data-n="label"]'); return { pad: getComputedStyle(r).paddingTop, radius: getComputedStyle(r).borderTopLeftRadius, weight: getComputedStyle(l).fontWeight }; })()`);
      assert.equal(g.weight, '900', 'edit 2 (fontWeight) is in the ghost');
      assert.notEqual(g.pad, '40px', 'edit 1 (padding) is not');
      assert.notEqual(g.radius, '2px', 'edit 3 (radius) is not');
      assert.equal(sha(btn), base);
      await q(`document.querySelector('.pitem[data-by="scout"] .p-show').click()`); // back to the whole proposal
      await browser.waitFor(`!/edit \\d of/.test(document.querySelector('.ghost-flag')?.textContent ?? 'x')`);
    });

    await t.test('reject one edit of a proposal: nothing written, the other two stay', async () => {
      await q(`document.querySelector('.pitem[data-by="scout"] li[data-edit="1"] .ed-reject').click()`);
      await browser.waitFor(`napkin.proposals.list().find((x) => x.by === 'scout').edits.length === 2`);
      assert.equal(sha(btn), base);
      assert.deepEqual(await q(`[...document.querySelectorAll('.pitem[data-by="scout"] .pi-edits li span')].map((s) => s.textContent)`).then((a) => a.map((x) => x.split(' ')[0])), ['root.padding', 'root.borderRadius']);
    });

    await t.test('accept one edit: it lands as scout, approved by you; the rest stays', async () => {
      await q(`document.querySelector('.pitem[data-by="scout"] li[data-edit="0"] .ed-accept').click()`);
      await waitFor(() => /padding: '40px'/.test(readFileSync(btn, 'utf8')), 3000);
      const src = readFileSync(btn, 'utf8');
      assert.doesNotMatch(src, /borderRadius: 2\b/); assert.doesNotMatch(src, /fontWeight: 900/);
      const top = (await p.history('Button'))[0];
      assert.equal(top.by, 'scout'); assert.equal(top.approvedBy, 'you');
      await browser.waitFor(`napkin.proposals.list().find((x) => x.by === 'scout').edits.length === 1`);
    });

    await t.test('reject the rest: the file stays byte-identical to what it was', async () => {
      const before = sha(btn);
      await q(`document.querySelector('.pitem[data-by="scout"] .p-reject').click()`);
      await browser.waitFor(`napkin.proposals.list().every((x) => x.by !== 'scout')`);
      assert.equal(sha(btn), before);
      assert.equal(await q(`document.querySelectorAll('.ghost-layer').length`), 0, 'the ghost is gone with the proposal');
    });

    await t.test('a stale accept says why and keeps the proposal', async () => {
      const stale = await scout.apply('Button', PAD('77px'), { propose: true });
      assert.equal(stale.proposed, true, JSON.stringify(stale));
      await browser.waitFor(`napkin.proposals.list().some((x) => x.by === 'scout')`);
      const mine = await p.you('Button', PAD('21px'));
      assert.equal(mine.ok, true, JSON.stringify(mine));
      await p.settled('Button');
      await q(`document.querySelector('.pitem[data-by="scout"] .p-accept').click()`);
      await browser.waitFor(`!!document.querySelector('.pi-stale')`);
      const msg = await text('.pi-stale');
      assert.match(msg, /Can't accept/); assert.match(msg, /root\.padding/); assert.match(msg, /21px/); assert.match(msg, /you/); assert.match(msg, /77px/);
      assert.equal(await q(`napkin.proposals.list().some((x) => x.by === 'scout')`), true, 'still listed');
      assert.doesNotMatch(readFileSync(btn, 'utf8'), /77px/);
      await p.shot('agents-stale');
      await q(`document.querySelector('.pitem[data-by="scout"] .p-reject').click()`);
      await browser.waitFor(`napkin.proposals.list().every((x) => x.by !== 'scout')`);
    });

    await t.test('keyboard: Alt+P focuses the tray, arrows move, A accepts, R rejects, Escape folds', async () => {
      await scout.apply('Button', [{ op: 'set', path: 'label.fontWeight', value: 800 }], { propose: true });
      await scout.apply('Chip', [{ op: 'set', path: 'root.opacity', value: 0.5 }], { propose: true });
      await browser.waitFor(`napkin.proposals.list().length === 3`);
      await io.key('p', { alt: true });
      await browser.waitFor(`document.activeElement?.classList.contains('pitem')`);
      const first = await q(`document.activeElement.dataset.by`);
      assert.equal(first, 'claude', 'sorted by agent name, claude first');
      await io.key('ArrowDown');
      assert.equal(await q(`document.activeElement.dataset.by`), 'scout');
      await io.key('Enter');
      await browser.waitFor(`!!document.querySelector('.ghost-layer')`);
      await io.key('a');
      await browser.waitFor(`napkin.proposals.list().length === 2`);
      assert.equal(await q(`document.activeElement?.classList.contains('pitem')`), true, 'focus moves to the next proposal');
      await io.key('r');
      await browser.waitFor(`napkin.proposals.list().length === 1`);
      await io.key('Escape');
      await browser.waitFor(`document.querySelector('#proposals-tray').dataset.open === '0'`);
      const left = await q(`napkin.proposals.list().map((x) => x.by)`);
      assert.equal(left.length, 1);
    });

    await t.test('Accept all and Reject all', async () => {
      await scout.apply('Button', [{ op: 'set', path: 'root.gap', value: 3 }], { propose: true });
      await scout.apply('Chip', [{ op: 'set', path: 'root.lineHeight', value: 1.2 }], { propose: true });
      await browser.waitFor(`napkin.proposals.list().length >= 3`);
      await q(`document.querySelector('#proposals-tray').dataset.open === '0' && document.querySelector('#pt-toggle').click(); true`);
      await browser.waitFor(`!!document.querySelector('#pt-accept-all')`);
      await q(`document.querySelector('#pt-accept-all').click()`);
      await browser.waitFor(`napkin.proposals.list().length === 0`);
      assert.equal(await q(`document.querySelector('#proposals-tray').hidden`), true, 'the tray goes away when empty');
    });
  } finally { await p.close(); }
});
