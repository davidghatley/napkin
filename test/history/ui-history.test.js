// HIS-01..03 and HIS-05 on the canvas page: Cmd/Ctrl+Z, the refusal hint, the History tab (timeline, scrub preview, restore),
// the git dot and the Changes tab (line diff and before/after pictures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, sleep, waitFor } from './page.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const PAD = (v) => [{ op: 'set', path: 'root.padding', value: v }];

test('history on the page', { timeout: 170000 }, async (t) => {
  const p = await open(['Button', 'Card', 'Chip']);
  const { q, io, browser } = p;
  const text = (sel) => q(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
  try {
    await p.select('Button', 'root', { size: 'md', state: 'default' });
    const original = p.read('Button');

    await t.test('HIS-01: Ctrl+Z undoes your edit as a new revision by you; Shift+Ctrl+Z redoes it', async () => {
      const r = await p.you('Button', PAD('30px 60px'));
      assert.equal(r.ok, true, JSON.stringify(r));
      await p.settled('Button');
      const edited = p.read('Button');
      assert.match(edited, /padding: '30px 60px'/);
      await io.key('z', { ctrl: true });
      await waitFor(() => p.read('Button') === original, 3000);
      const top = (await p.history('Button'))[0];
      assert.equal(top.by, 'you'); assert.equal(top.kind, 'undo'); assert.equal(top.undoOf, r.revision);
      await p.settled('Button');
      assert.match(await text('#hint'), /Undid: root\.padding/);
      await io.key('z', { ctrl: true, shift: true });
      await waitFor(() => p.read('Button') === edited, 3000);
      assert.equal((await p.history('Button'))[0].kind, 'redo');
      await io.key('z', { ctrl: true }); await waitFor(() => p.read('Button') === original, 3000);
      await p.settled('Button');
    });

    await t.test('HIS-01: an agent\'s edit is not undone by your Ctrl+Z', async () => {
      const a = await p.as('scout', 'Button', [{ op: 'set', path: 'label.fontWeight', value: 900 }]);
      assert.equal(a.ok, true, JSON.stringify(a));
      await p.settled('Button');
      const n = (await p.history('Button')).length;
      await io.key('z', { ctrl: true });
      await waitFor(async () => /Can't undo: nothing to undo/.test(await text('#hint')), 3000);
      assert.equal((await p.history('Button')).length, n, 'no revision was made');
      assert.match(p.read('Button'), /fontWeight: 900/);
    });

    await t.test('HIS-02: when an agent changed the same property afterwards, undo is refused naming who and which revision', async () => {
      const mine = await p.you('Button', PAD('44px'));
      await p.settled('Button');
      const theirs = await p.as('scout', 'Button', PAD('55px'));
      assert.equal(theirs.ok, true, JSON.stringify(theirs));
      await p.settled('Button');
      const before = p.read('Button');
      await io.key('z', { ctrl: true });
      await waitFor(async () => /Can't undo: scout/.test(await text('#hint')), 3000);
      const hint = await text('#hint');
      assert.match(hint, /scout/); assert.match(hint, new RegExp(`revision ${theirs.revision}`)); assert.match(hint, /root\.padding/);
      assert.equal(p.read('Button'), before, 'the file is untouched');
      assert.ok(mine.ok);
      await p.shot('undo-refused');
    });

    await t.test('HIS-01: a field with text you have not committed keeps its own undo', async () => {
      await p.select('Button', 'root', { size: 'md', state: 'default' });
      const n = (await p.history('Button')).length;
      await q(`(() => { const i = document.querySelector('#padding'); i.focus(); i.value = '5px'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await io.key('z', { ctrl: true });
      await sleep(300);
      assert.equal((await p.history('Button')).length, n, 'the page did not undo while a field was mid-edit');
      await q(`document.activeElement.blur()`);
    });

    await t.test('HIS-03: the History tab lists who, what and when; scrubbing previews read-only; Restore is one revision', async () => {
      // three of your own edits to a fresh component state
      const names = ['10px 20px', '12px 24px', '14px 28px'];
      const revs = [];
      for (const v of names) { const r = await p.you('Button', PAD(v)); revs.push(r.revision); await p.settled('Button'); }
      await q(`document.querySelector('#open-history').click()`);
      await q(`napkin.history.show('Button')`);
      await browser.waitFor(`document.querySelectorAll('#h-list .hrow').length >= 4`);
      const rows = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#h-list .hrow')].map((r) => ({ rev: r.dataset.revision, by: r.dataset.by, kind: r.dataset.kind, sum: r.querySelector('.hsum').textContent, when: r.querySelector('time').textContent })))`));
      assert.equal(rows[0].rev, String(revs[2])); assert.equal(rows[0].by, 'you'); assert.match(rows[0].sum, /root\.padding = "14px 28px"/); assert.match(rows[0].when, /^\d\d:\d\d:\d\d · /);
      assert.ok(rows.some((r) => r.by === 'scout'), 'the agent edit is in the timeline');
      assert.ok(rows.some((r) => r.kind === 'undo'), 'and so are undo and redo');
      await p.shot('timeline');

      const live = p.read('Button'), n0 = (await p.history('Button')).length;
      // click the older row (first of the three: padding 10px 20px): a preview layer appears over every cell, old padding inside
      await q(`document.querySelector('#h-list .hrow[data-revision="${revs[0]}"]').click()`);
      await browser.waitFor(`document.querySelectorAll('section[data-name="Button"] .preview-layer').length === 6`, 5000);
      const padding = await q(`getComputedStyle(document.querySelector('section[data-name="Button"] figure.cell[data-variant=\\'{"size":"md","state":"default"}\\'] .preview-layer [data-n="root"]')).padding`);
      assert.equal(padding, '10px 20px', 'the layer shows the older state');
      const livePad = await q(`getComputedStyle(document.querySelector('section[data-name="Button"] figure.cell[data-variant=\\'{"size":"md","state":"default"}\\'] .mount [data-n="root"]')).padding`);
      assert.equal(livePad, '14px 28px', 'the live cell is untouched underneath');
      assert.match(await text('.preview-flag'), new RegExp(`Preview of r${revs[0]} · you`));
      assert.equal(p.read('Button'), live, 'previewing writes nothing'); assert.equal((await p.history('Button')).length, n0, 'and makes no revision');
      assert.equal(await q(`document.querySelector('#h-restore').disabled`), false);
      await p.shot('preview');

      // the scrubber reaches the same state; Esc leaves the preview
      await q(`(() => { const s = document.querySelector('#h-scrub'); s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(400);
      await io.key('Escape');
      await browser.waitFor(`document.querySelectorAll('.preview-layer').length === 0`);

      // Restore: exactly one new revision, the file is what it was at that revision
      await q(`document.querySelector('#h-list .hrow[data-revision="${revs[1]}"]').click()`);
      await browser.waitFor(`document.querySelectorAll('.preview-layer').length === 6`, 5000);
      await q(`document.querySelector('#h-restore').click()`);
      await waitFor(async () => (await p.history('Button')).length === n0 + 1, 4000);
      const top = (await p.history('Button'))[0];
      assert.equal(top.kind, 'restore'); assert.equal(top.by, 'you'); assert.equal(String(top.restoreOf), String(revs[1]));
      assert.match(p.read('Button'), /padding: '12px 24px'/);
      await browser.waitFor(`document.querySelectorAll('.preview-layer').length === 0`);
      await sleep(300);
      assert.equal((await p.history('Button')).length, n0 + 1, 'still exactly one');
      await q(`document.querySelector('#h-undo').click()`);
      await waitFor(() => /padding: '14px 28px'/.test(p.read('Button')), 3000);
      await q(`napkin.drawer.close()`);
    });

    await t.test('HIS-05: a dot on changed components, the line diff and before/after pictures of changed cells only', async () => {
      // Card is untouched; Button differs from HEAD (a size=sm override and a base change)
      await p.you('Button', [{ op: 'set', path: 'root.padding', variant: { size: 'sm' }, value: '18px 30px' }]);
      await p.settled('Button');
      await browser.waitFor(`!!document.querySelector('section[data-name="Button"] .git-dot')`, 4000);
      assert.equal(await q(`!!document.querySelector('section[data-name="Card"] .git-dot')`), false, 'Card is clean: no dot');
      assert.equal(await q(`document.querySelector('section[data-name="Button"] .git-dot').dataset.state`), 'modified');
      await q(`document.querySelector('#open-changes').click()`);
      await browser.waitFor(`document.querySelectorAll('#chg-pics figure.pair').length > 0`, 20000);
      const diff = await text('#chg-diff');
      assert.match(diff, /padding: '4px 10px'/); assert.match(diff, /padding: '18px 30px'/);
      const note = await text('#v-note');
      const pairs = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#chg-pics figure.pair')].map((f) => f.dataset.variant))`));
      // root.padding for md and lg was also changed earlier in this test (14px 28px is not HEAD's): so every size differs; sm only by the override
      assert.ok(pairs.length >= 2); assert.match(note, /cells? changed/);
      assert.equal(await q(`[...document.querySelectorAll('#chg-pics figure.pair')].every((f) => f.querySelectorAll('img').length === 2)`), true);
      await p.shot('changes');
      await q(`napkin.drawer.close()`);
      // nothing in this whole test ever made a commit
      assert.equal(p.git('rev-list', '--count', 'HEAD').trim(), '1');
    });

    assert.deepEqual(browser.consoleLines.filter((l) => /error|exception/i.test(l)), [], 'no page errors');
  } finally { await p.close(); }
});
