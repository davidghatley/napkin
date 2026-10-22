// AGT-03 on the canvas: avatar stack, a coloured outline and name tag per agent on its node, two agents told apart, a fading trail,
// and presence that clears <= 1 s after the agent stops or disconnects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAgents, sleep, waitFor } from './helpers.js';
import { evidence } from '../helpers/agents.js';

test('presence on the canvas', { timeout: 120000 }, async (t) => {
  const p = await openAgents(['Button', 'Card', 'Chip']);
  const { q, browser } = p;
  const boxes = () => q('napkin.presence.boxes()');
  const rectOf = (comp, node) => q(`(() => { const r = document.querySelector('section.cmp[data-name="${comp}"] .mount [data-n="${node}"]').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  try {
    await t.test('the top bar always has you; agents join the stack and the tooltip says how many', async () => {
      assert.equal(await q(`document.querySelectorAll('#avatars .av').length`), 1);
      assert.equal(await q(`document.querySelector('#avatars .av.you').title`), 'You');
      await p.agent('scout'); await p.agent('claude');
      await browser.waitFor(`document.querySelectorAll('#avatars .av').length === 3`);
      assert.equal(await q(`document.querySelector('#avatars .av').getBoundingClientRect().width`), 24, 'avatars are 24 px');
      assert.deepEqual(await q(`[...document.querySelectorAll('#avatars .av-name')].map((e) => e.textContent)`), ['scout', 'claude'], 'with one or two agents the names are written out');
      assert.equal(await q(`[...document.querySelectorAll('#avatars .av-name')].every((e) => e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().right <= document.querySelector('#avatars').getBoundingClientRect().right + 1)`), true, 'and visible inside the stack');
      assert.equal(await q(`(() => { const s = document.querySelector('.slot').getBoundingClientRect(), a = document.querySelector('#avatars').getBoundingClientRect(), y = document.querySelector('#avatars .av.you').getBoundingClientRect(); return a.left >= s.left - 1 && a.right <= s.right + 1 && y.left >= s.left; })()`), true, 'the stack fits its slot: you are not clipped');
      assert.match(await q(`document.querySelector('#avatars').getAttribute('aria-label')`), /You and 2 agents: scout, claude/);
      const colors = await q(`[...document.querySelectorAll('#avatars .av[data-agent]:not(.you)')].map((e) => [e.dataset.agent, getComputedStyle(e).backgroundColor])`);
      assert.equal(colors.length, 2); assert.notEqual(colors[0][1], colors[1][1], 'two colours');
      const r = await q(`(() => { const r = document.querySelector('#avatars').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await p.io.move(r.x, r.y);
      await browser.waitFor(`!document.querySelector('#avatar-tip').hidden`);
      assert.match(await q(`document.querySelector('#avatar-tip').textContent`), /^2 agents/);
      await p.shot('presence-avatars');
      await p.io.move(5, 300);
    });

    await t.test('outline and name tag sit on the node the agent is editing; two agents on one node are told apart', async () => {
      const scout = await p.agent('scout'), claude = await p.agent('claude');
      await scout.presence('Button', 'label', { ttl: 8000 });
      await claude.presence('Button', 'label', { ttl: 8000 });
      await browser.waitFor(`napkin.presence.boxes().length === 2`);
      await sleep(250);
      const bs = await boxes();
      const node = await rectOf('Button', 'label');
      for (const b of bs) {
        assert.ok(Math.abs(b.rect.left - node.left) <= 1.5 && Math.abs(b.rect.top - node.top) <= 1.5 && Math.abs(b.rect.width - node.width) <= 1.5, `${b.agent}'s box covers the node: ${JSON.stringify([b.rect, node])}`);
      }
      assert.deepEqual(bs.map((b) => b.slot).sort(), [0, 1], 'second agent on the same node is offset');
      const style = await q(`[...document.querySelectorAll('.pbox')].map((b) => ({ agent: b.dataset.agent, outline: getComputedStyle(b).outlineColor, offset: getComputedStyle(b).outlineOffset, tag: b.querySelector('.pname').textContent, tagBg: getComputedStyle(b.querySelector('.ptag')).backgroundColor, tagTop: b.querySelector('.ptag').getBoundingClientRect().top }))`);
      assert.deepEqual(style.map((s) => s.tag).sort(), ['claude', 'scout']);
      assert.notEqual(style[0].outline, style[1].outline, 'different outline colours');
      assert.notEqual(style[0].offset, style[1].offset, 'different outline offsets');
      assert.notEqual(style[0].tagTop, style[1].tagTop, 'name tags do not overlap');
      assert.equal(style[0].tagBg, style[0].outline); // the tag wears the outline colour
      await p.shot('presence-two-agents');
      assert.equal((await q(`document.querySelector('#presence').textContent`)).includes('scout'), true, 'the words are there for a screen reader');
    });

    await t.test('name tags of two agents on nested nodes never sit on each other', async () => {
      const scout = await p.agent('scout'), claude = await p.agent('claude');
      await scout.presence('Button', 'root', { ttl: 8000 });
      await claude.presence('Button', 'label', { ttl: 8000 });
      await browser.waitFor(`napkin.presence.boxes().length === 2 && napkin.presence.boxes().every((b) => b.node)`);
      await sleep(250);
      const tags = await q(`[...document.querySelectorAll('.pbox')].map((b) => { const r = b.querySelector('.ptag').getBoundingClientRect(); return { agent: b.dataset.agent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })`);
      assert.equal(tags.length, 2);
      const [a, c] = tags;
      assert.equal(a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top, false, `tags overlap: ${JSON.stringify(tags)}`);
      await scout.presence('Button', 'label', { ttl: 100 }); await claude.presence('Button', 'label', { ttl: 100 });
      await sleep(300);
    });

    await t.test('moving between nodes leaves a fading trail', async () => {
      const scout = await p.agent('scout');
      await scout.presence('Button', 'root', { ttl: 8000 });
      await browser.waitFor(`napkin.presence.boxes().find((b) => b.agent === 'scout')?.node === 'root'`);
      await scout.presence('Card', 'title', { ttl: 8000 });
      await browser.waitFor(`napkin.presence.boxes().find((b) => b.agent === 'scout')?.node === 'title'`);
      await sleep(150);
      const early = await q(`({ lines: document.querySelectorAll('#presence-trail line').length, rects: document.querySelectorAll('#presence-trail rect').length, op: Number(document.querySelector('#presence-trail line')?.style.opacity) })`);
      assert.ok(early.lines >= 1 && early.rects >= 1, `trail drawn: ${JSON.stringify(early)}`);
      await sleep(1400);
      const later = await q(`Number(document.querySelector('#presence-trail line')?.style.opacity ?? 0)`);
      assert.ok(later < early.op, `the trail fades (${early.op} -> ${later})`);
      await sleep(1500);
      assert.equal(await q(`document.querySelectorAll('#presence-trail line').length`), 0, 'the trail is gone after about 2.6 s');
    });

    await t.test('presence clears <= 1 s after the agent stops, and at once when it disconnects', async () => {
      const scout = await p.agent('scout');
      await p.q(`window.__gone = {}; new MutationObserver(() => { for (const n of ['scout', 'claude']) if (!document.querySelector('.pbox[data-agent="' + n + '"]') && !window.__gone[n] && window.__seen?.[n]) window.__gone[n] = Date.now(); for (const n of ['scout', 'claude']) if (document.querySelector('.pbox[data-agent="' + n + '"]')) { (window.__seen ??= {})[n] = true; delete window.__gone[n]; } }).observe(document.querySelector('#presence-layer'), { childList: true, subtree: true, attributes: true }); true`);
      await sleep(900); // let the earlier 8 s presences from this test file lapse? they are explicit; replace them with default-ttl ones
      const edits = (v) => [{ op: 'set', path: 'root.padding', value: v }];
      const r = await scout.apply('Button', edits('19px'));
      assert.equal(r.ok, true, JSON.stringify(r));
      const landed = Date.now();
      await browser.waitFor(`!!document.querySelector('.pbox[data-agent="scout"]')`, 2000);
      await browser.waitFor(`!document.querySelector('.pbox[data-agent="scout"]')`, 3000);
      const gone = await q(`window.__gone.scout`);
      const ms = gone - landed;
      assert.ok(ms <= 1000, `cleared ${ms} ms after the agent's last edit`);
      p.clearMs = ms;
      // a declared ttl of 4 s does not keep presence after an apply
      await scout.presence('Button', 'root', { ttl: 4000 });
      await browser.waitFor(`!!document.querySelector('.pbox[data-agent="scout"]')`);
      const r2 = await scout.apply('Button', edits('20px'));
      assert.equal(r2.ok, true);
      const t1 = Date.now();
      await browser.waitFor(`!document.querySelector('.pbox[data-agent="scout"]')`, 3000);
      assert.ok(Date.now() - t1 <= 1000, `cleared ${Date.now() - t1} ms after an apply (declared ttl 4000)`);
      // disconnect while editing
      const claude = await p.agent('claude');
      await claude.presence('Chip', 'root', { ttl: 8000 });
      await browser.waitFor(`!!document.querySelector('.pbox[data-agent="claude"]')`);
      const t0 = Date.now(); claude.disconnect();
      await browser.waitFor(`!document.querySelector('.pbox[data-agent="claude"]')`, 2000);
      const gone2 = await q(`window.__gone.claude`);
      assert.ok(gone2 - t0 <= 1000, `cleared ${gone2 - t0} ms after disconnect`);
      await browser.waitFor(`document.querySelectorAll('#avatars .av').length === 2`);
      evidence('AGT-03', `Re-run: EVIDENCE=1 node --test test/agents-ui/presence.test.js\nPresence cleared ${ms} ms after the agent's last edit and ${gone2 - t0} ms after it disconnected (bar: <= 1000 ms).\nTwo agents on one node: distinct colours, outline offsets and stacked name tags.`);
      console.log(`# presence clear: ${ms} ms after the last edit, ${gone2 - t0} ms after disconnect`);
    });
  } finally { await p.close(); }
});
