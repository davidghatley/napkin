// Scene S2, "The agent builds a Tooltip while I tune the Button" (SCN-2), walked end to end in a real browser.
//   - claude (a scripted MCP client, NAPKIN_AGENT=claude, propose mode) creates a Tooltip and proposes 4 edits to it,
//   - "you" change Button's padding in the panel at the same time,
//   - presence shows on the canvas, the tray shows "4 proposals · claude", ghost cells show the result,
//   - you accept 3 and reject 1; the rejected one never touched the file.
// EVIDENCE_OUT=docs/evidence writes s2-1-presence.png, s2-2-ghost.png, s2-3-done.png; EVIDENCE=1 writes docs/evidence/s2-log.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openAgents, sleep, waitFor } from './helpers.js';
import { startMcp } from '../helpers/harness.js';
import { evidence } from '../helpers/agents.js';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

test('S2: the agent builds a Tooltip while I tune the Button', { timeout: 170000 }, async (t) => {
  const p = await openAgents(['Button', 'Card']);
  const { q, browser, io } = p;
  const t0 = Date.now(), lines = [];
  const log = (s) => { lines.push(`+${String(Date.now() - t0).padStart(5)} ms  ${s}`); };
  const claude = await startMcp(p.server.url, { NAPKIN_AGENT: 'claude', NAPKIN_PRESENCE_MS: '4000' });
  const button = p.fileOf('Button');
  // zoom to one component the way a person would (fit it), then let the 220 ms flight finish
  const look = async (name, max = 2) => { await q(`(() => { const r = napkin.stage.componentRect(napkin.find('${name}').component); napkin.view.flyTo({ x: r.x, y: r.y, w: r.w * 2.4, h: r.h }, { pad: 110, max: ${max} }); })()`); await sleep(450); };
  try {
    await browser.waitFor(`document.querySelectorAll('#avatars .av').length === 2`);
    log('claude is connected: the top bar shows you + 1 agent');

    // 1. claude creates a Tooltip (it has write permission; its edits are proposals)
    const made = await claude.call('create_component', { name: 'Tooltip' });
    assert.equal(made.isError, false, made.text);
    await browser.waitFor(`!!napkin.find('Tooltip')`);
    const tipFile = `${p.compDir}/Tooltip.tsx`;
    const rev = (await claude.call('read_component', { component: 'Tooltip' })).data.revision;
    const tipBefore = sha(tipFile);
    log(`claude created Tooltip (r${rev}); canvas now has ${await q('napkin.state.components.size')} components`);

    // 2. in parallel: claude proposes 4 edits; you tune Button's padding in the panel
    await p.select('Button', 'root', { size: 'md', state: 'default' });
    await browser.waitFor(`!!document.querySelector('#panel #padding')`);
    const proposals = [
      { name: 'background', edits: [{ op: 'set', path: 'root.background', value: '#1c1f27' }] },
      { name: 'padding', edits: [{ op: 'set', path: 'root.padding', value: '6px 10px' }] },
      { name: 'radius', edits: [{ op: 'set', path: 'root.borderRadius', value: 6 }] },
      { name: 'label', edits: [{ op: 'insert', parent: 'root', node: { id: 'label', tag: 'span', text: 'Saved', style: { color: '#ffffff', fontSize: 12 } } }] },
    ];
    const agentWork = (async () => {
      for (const pr of proposals) {
        const r = await claude.call('apply_edits', { component: 'Tooltip', baseRevision: rev, edits: pr.edits, propose: true });
        assert.equal(r.isError, false, r.text); assert.equal(r.data.proposed, true);
        log(`claude proposed "${pr.name}": ${r.data.proposal.summary}`);
        await sleep(120);
      }
      // right after the last proposal claude is still "there": look at it now
      await browser.waitFor(`napkin.presence.boxes().some((b) => b.agent === 'claude')`);
      seen = (await q(`napkin.presence.boxes().filter((x) => x.agent === 'claude')`))[0];
      await p.shot('s2-1-presence');
    })();
    let seen = null;
    await sleep(150);
    await browser.type('#padding', '18');
    log('you typed Button padding = 18 in the panel');
    await agentWork;
    await waitFor(() => /padding: 18\b/.test(readFileSync(button, 'utf8')), 3000);
    log('your padding landed in Button.tsx (no clash: a different file)');

    await t.test('presence shows where claude works', async () => {
      assert.ok(seen, 'claude was outlined while it worked');
      assert.equal(seen.component, await q(`napkin.find('Tooltip').component`));
      log(`presence: claude's outline was on Tooltip · ${seen.node} (name tag "claude")`);
    });

    await t.test('the tray shows 4 proposals · claude and the file has not changed', async () => {
      await browser.waitFor(`napkin.proposals.list().length === 4`);
      assert.match(await q(`document.querySelector('#pt-toggle').textContent`), /4\s*proposals · claude/);
      assert.equal(sha(tipFile), tipBefore, 'Tooltip.tsx is byte-identical while proposals are pending');
      log('tray: "4 proposals · claude"; Tooltip.tsx unchanged');
    });

    await t.test('ghost cells show the proposed result without touching the live cell', async () => {
      const first = await q(`napkin.proposals.list().find((x) => x.summary.includes('root.background')).id`);
      await q(`napkin.proposals.pick(${JSON.stringify(first)})`);
      await browser.waitFor(`!!document.querySelector('section.cmp[data-name="Tooltip"] .ghost-layer [data-n="root"]')`);
      const live = await q(`getComputedStyle(document.querySelector('section.cmp[data-name="Tooltip"] .cell .mount [data-n="root"]')).backgroundColor`);
      const ghost = await q(`getComputedStyle(document.querySelector('section.cmp[data-name="Tooltip"] .ghost-layer [data-n="root"]')).backgroundColor`);
      assert.notEqual(live, ghost); assert.equal(ghost, 'rgb(28, 31, 39)');
      await q(`document.querySelector('#pt-mode-split').click()`);
      await look('Tooltip');
      log(`ghost: live cell ${live}, ghost cell ${ghost}`);
      await p.shot('s2-2-ghost');
    });

    await t.test('accept 3, reject 1: the rejected edit never touched the file', async () => {
      const row = (frag) => `napkin.proposals.list().find((x) => x.summary.includes(${JSON.stringify(frag)})).id`;
      const click = async (id, cls) => q(`document.querySelector('.pitem[data-id="${await q(id)}"] .${cls}').click()`);
      // accept background and padding with the mouse, radius with the keyboard
      await click(row('root.background'), 'p-accept');
      await waitFor(() => /background/.test(readFileSync(tipFile, 'utf8')), 3000);
      log('accepted "background" (click)');
      await click(row('root.padding'), 'p-accept');
      await waitFor(() => /padding: '6px 10px'/.test(readFileSync(tipFile, 'utf8')), 3000);
      log('accepted "padding" (click)');
      // reject the label insert; keep the file's sha to prove it did not move
      const before = sha(tipFile);
      await click(row('insert label'), 'p-reject');
      await browser.waitFor(`napkin.proposals.list().length === 1`);
      assert.equal(sha(tipFile), before, 'rejecting wrote nothing');
      log('rejected "label" (click): Tooltip.tsx sha unchanged');
      // the last one by keyboard: Alt+P, then A
      await io.key('p', { alt: true });
      await browser.waitFor(`document.activeElement?.classList.contains('pitem')`);
      await io.key('a');
      await waitFor(() => /borderRadius: 6\b/.test(readFileSync(tipFile, 'utf8')), 3000);
      await browser.waitFor(`napkin.proposals.list().length === 0 && document.querySelector('#proposals-tray').hidden`);
      log('accepted "radius" (keyboard: Alt+P, A)');
      const src = readFileSync(tipFile, 'utf8');
      assert.match(src, /background/); assert.match(src, /padding: '6px 10px'/); assert.match(src, /borderRadius: 6/);
      assert.doesNotMatch(src, /Saved/); assert.doesNotMatch(src, /label/, 'the rejected insert is nowhere in the file');
      const hist = await p.history('Tooltip');
      const landed = hist.filter((h) => h.by === 'claude' && !/created/.test(h.summary));
      assert.equal(landed.length, 3);
      assert.ok(landed.every((h) => h.approvedBy === 'you'), 'every accepted revision says you approved it');
      assert.ok(hist.some((h) => h.by === 'claude' && /created Tooltip/.test(h.summary)), 'the first revision is claude creating it');
      assert.equal(hist.filter((h) => /label/.test(h.summary) && h.by === 'claude').length, 0);
      const mine = (await p.history('Button')).filter((h) => h.by === 'you');
      assert.equal(mine.length, 1); assert.match(mine[0].summary, /root\.padding = 18/);
      log(`Tooltip history: ${hist.map((h) => `r${h.revision} ${h.by}${h.approvedBy ? ' (approved by ' + h.approvedBy + ')' : ''}`).reverse().join(', ')}`);
      log(`Button history: ${(await p.history('Button')).map((h) => `r${h.revision} ${h.by}`).reverse().join(', ')}`);
    });

    await t.test('the activity feed tells the whole story', async () => {
      await q(`document.querySelector('#open-activity').click()`);
      await browser.waitFor(`document.querySelectorAll('#a-list .arow[data-by="claude"]').length >= 4`);
      const rows = await q(`[...document.querySelectorAll('#a-list .arow')].map((r) => r.textContent.replace(/\\s+/g, ' '))`);
      assert.ok(rows.some((r) => /you.*root\.padding = 18/.test(r)));
      assert.ok(rows.filter((r) => /claude/.test(r) && /approved by you/.test(r)).length === 3);
      assert.ok(rows.some((r) => /claude.*created Tooltip/.test(r)));
      await browser.waitFor(`!document.querySelector('.pbox[data-agent="claude"]')`, 6000);
      await look('Tooltip');
      log('presence cleared after claude stopped');
      await p.shot('s2-3-done');
      log(`activity rows: ${rows.length}`);
    });
  } finally {
    evidence('s2-log', `S2 "The agent builds a Tooltip while I tune the Button": re-run with\n  EVIDENCE=1 EVIDENCE_OUT=docs/evidence node --test test/agents-ui/s2.test.js\n\n${lines.join('\n')}`);
    claude.stop(); await p.close();
  }
});
