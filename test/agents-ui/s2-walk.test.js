// Scene S2 re-walked after the whole-product critic (WPC-03, WPC-09, WPC-12): claude is a PROPOSE agent (napkin.json), a real
// src/mcp.js process over stdio, and the canvas is headless Chromium. Four proposals: create Tooltip, then three edits to it.
// You accept 3 (the creation included) and reject 1; the rejected one never touches the file; claude is told about each answer.
//   EVIDENCE=1 EVIDENCE_OUT=docs/evidence node --test test/agents-ui/s2-walk.test.js   -> docs/evidence/SCN-2.txt, s2w-*.png
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { openAgents, sleep, waitFor } from './helpers.js';
import { startMcp } from '../helpers/harness.js';
import { evidence } from '../helpers/agents.js';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

test('S2 walk: a propose-mode agent builds a Tooltip; accept 3 of 4, the rejected one never touched the file', { timeout: 170000 }, async (t) => {
  const p = await openAgents(['Button', 'Card']);
  const { q, browser } = p;
  const lines = [], t0 = Date.now();
  const log = (s) => lines.push(`+${String(Date.now() - t0).padStart(5)} ms  ${s}`);
  writeFileSync(join(dirname(p.compDir), 'napkin.json'), JSON.stringify({ agents: { claude: 'propose', you: 'write' } }));
  const claude = await startMcp(p.server.url, { NAPKIN_AGENT: 'claude', NAPKIN_PRESENCE_MS: '4000' });
  const tip = `${p.compDir}/Tooltip.tsx`;
  const button = p.fileOf('Button');
  const view = async (name) => { await q(`(() => { const r = napkin.stage.componentRect(napkin.find('${name}').component); napkin.view.flyTo({ x: r.x, y: r.y, w: r.w * 2.4, h: r.h }, { pad: 110, max: 2 }); })()`); await sleep(450); };
  try {
    log('napkin.json agents = { claude: "propose", you: "write" }; claude is src/mcp.js over stdio, NAPKIN_AGENT=claude');
    // 1. the propose agent asks for a Tooltip
    const made = await claude.call('create_component', { name: 'Tooltip' });
    assert.equal(made.isError, false, made.text); assert.equal(made.data.proposed, true);
    const p1 = made.data.proposal.id;
    assert.equal(existsSync(tip), false);
    log(`claude create_component Tooltip -> proposal ${p1}; Tooltip.tsx does not exist`);
    await browser.waitFor(`napkin.proposals.list().length === 1`);
    await q(`napkin.proposals.pick(${JSON.stringify(p1)})`);
    await browser.waitFor(`!!document.querySelector('.ghost-new [data-n="root"]')`);
    log(`tray: "${await q(`document.querySelector('#pt-toggle').textContent.trim()`)}"; canvas shows the ghost frame: "${await q(`document.querySelector('.ghost-new .gn-flag').textContent`)}"`);
    await p.shot('s2w-1-ghost-frame');
    const early = await claude.call('apply_edits', { component: 'Tooltip', baseRevision: 1, edits: [{ op: 'set', path: 'root.padding', value: 4 }], propose: true });
    assert.equal(early.isError, true);
    log(`claude tries to edit it before it exists -> refused: ${early.text.slice(0, 160)}`);

    // 2. you tune Button while the proposal waits
    await p.select('Button', 'root', { size: 'md', state: 'default' });
    await browser.waitFor(`!!document.querySelector('#panel #padding')`);
    await browser.type('#padding', '18');
    await waitFor(() => /padding: 18\b/.test(readFileSync(button, 'utf8')), 3000);
    log('you set Button padding = 18 in the panel (Button.tsx changed; Tooltip.tsx still absent)');

    // 3. accept the creation
    await q(`document.querySelector('.pitem[data-id="${p1}"] .p-accept').click()`);
    await waitFor(() => existsSync(tip), 4000);
    await browser.waitFor(`!!napkin.find('Tooltip')`);
    const hist1 = await p.history('Tooltip');
    log(`ACCEPT #1 (create): Tooltip.tsx written; history r${hist1.at(-1).revision} by ${hist1.at(-1).by}, approved by ${hist1.at(-1).approvedBy}`);
    const s1 = (await claude.call('subscribe', { waitMs: 3000 })).data.resolved;
    log(`claude subscribe -> resolved: ${JSON.stringify(s1.map((r) => ({ proposal: r.proposal, outcome: r.outcome, by: r.by })))}`);
    assert.equal(s1[0].outcome, 'accepted');

    // 4. claude proposes three edits to the now-real Tooltip
    const rev = (await claude.call('read_component', { component: 'Tooltip' })).data.revision;
    const work = [
      ['padding', [{ op: 'set', path: 'root.padding', value: '6px 10px' }]],
      ['background', [{ op: 'set', path: 'root.background', value: '#1c1f27' }]],
      ['border (will be rejected)', [{ op: 'set', path: 'root.border', value: '6px dashed #ff00ff' }]],
    ];
    const ids = [];
    for (const [name, edits] of work) {
      const r = await claude.call('apply_edits', { component: 'Tooltip', baseRevision: rev, edits, propose: true });
      assert.equal(r.data.proposed, true, r.text); ids.push(r.data.proposal.id);
      log(`claude proposed "${name}": ${r.data.proposal.summary}`);
      await sleep(100);
    }
    await browser.waitFor(`napkin.proposals.list().length === 3`);
    const box = (await q(`napkin.presence.boxes().filter((x) => x.agent === 'claude')`))[0];
    log(`presence: claude's outline on ${box ? 'Tooltip · ' + box.node : 'NOTHING'}; #presence "${await q(`document.querySelector('#presence')?.textContent.trim()`)}"`);
    assert.ok(box, 'presence shows where claude works');
    await view('Tooltip'); await p.shot('s2w-2-presence-and-tray');

    // 5. accept two, reject the third
    for (const id of ids.slice(0, 2)) { await q(`document.querySelector('.pitem[data-id="${id}"] .p-accept').click()`); await sleep(600); }
    await waitFor(() => /background/.test(readFileSync(tip, 'utf8')) && /padding: '6px 10px'/.test(readFileSync(tip, 'utf8')), 4000);
    log('ACCEPT #2 padding, ACCEPT #3 background: both in Tooltip.tsx');
    const shaBefore = sha(tip);
    await q(`document.querySelector('.pitem[data-id="${ids[2]}"] .p-reject').click()`);
    await browser.waitFor(`napkin.proposals.list().length === 0`);
    assert.equal(sha(tip), shaBefore);
    assert.doesNotMatch(readFileSync(tip, 'utf8'), /ff00ff/);
    log(`REJECT #4 border: Tooltip.tsx sha before = after = ${shaBefore.slice(0, 12)}; "ff00ff" appears in no file`);
    const s2 = (await claude.call('subscribe', { waitMs: 3000 })).data.resolved;
    log(`claude subscribe -> resolved: ${JSON.stringify(s2.map((r) => ({ proposal: r.proposal, outcome: r.outcome, by: r.by, rejected: r.rejected })))}`);
    assert.deepEqual(s2.map((r) => r.outcome).sort(), ['accepted', 'accepted', 'rejected']);
    const hist = await p.history('Tooltip');
    const landed = hist.filter((h) => h.by === 'claude');
    assert.equal(landed.length, 3); assert.ok(landed.every((h) => h.approvedBy === 'you'));
    log(`Tooltip history: ${hist.map((h) => `r${h.revision} ${h.by}${h.approvedBy ? ' (approved by ' + h.approvedBy + ')' : ''}`).reverse().join(', ')}`);
    await view('Tooltip'); await p.shot('s2w-3-done');
    log('VERDICT: 4 proposals (create + 3 edits), 3 accepted, 1 rejected; rejected never in the file; agent told of every answer');
  } finally {
    evidence('SCN-2', `S2 "An agent builds a Tooltip in propose mode while you tune Button" re-walk (WPC-03, WPC-09, WPC-12).\n  EVIDENCE=1 EVIDENCE_OUT=docs/evidence node --test test/agents-ui/s2-walk.test.js\n\n${lines.join('\n')}`);
    claude.stop(); await p.close();
  }
});
