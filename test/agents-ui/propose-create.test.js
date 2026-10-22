// WPC-03 on the page (a create proposal is a ghost frame; Reject leaves no file; Accept writes it) and WPC-12 (every tray action reachable at 1440x900, also with 10 proposals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { openAgents, sleep } from './helpers.js';
import { http } from '../helpers/agents.js';

test('a create proposal is a ghost frame; reject leaves no file, accept writes it as the agent approved by you', { timeout: 120000 }, async () => {
  const p = await openAgents(['Button', 'Card']);
  const { q, browser } = p;
  const file = `${p.compDir}/Tooltip.tsx`;
  try {
    const claude = await p.agent('claude');
    const mk = async (name) => (await http(p.server.url, '/api/components', { method: 'POST', token: claude.token, body: { name, propose: true } })).json;
    const a = await mk('Tooltip'); assert.equal(a.proposed, true, JSON.stringify(a));
    await browser.waitFor(`napkin.proposals.list().length === 1`);
    assert.match(await q(`document.querySelector('.pitem .pi-comp').textContent`), /Tooltip/);
    assert.match(await q(`document.querySelector('.pitem .pi-tag').textContent`), /new component/);
    await q(`document.querySelector('.pitem .p-show').click()`);
    await browser.waitFor(`!!document.querySelector('.ghost-new [data-n="root"]')`);
    assert.match(await q(`document.querySelector('.ghost-new .gn-flag').textContent`), /claude's proposal · new component Tooltip · not written/);
    const vis = await q(`(() => { const g = document.querySelector('.ghost-new').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return g.left >= s.left && g.top >= s.top && g.right <= s.right && g.bottom <= s.bottom; })()`);
    assert.equal(vis, true, 'the ghost frame is on the canvas');
    assert.equal(existsSync(file), false, 'the ghost wrote nothing');
    await q(`document.querySelector('.pitem .p-reject').click()`);
    await browser.waitFor(`napkin.proposals.list().length === 0 && !document.querySelector('.ghost-new')`);
    assert.equal(existsSync(file), false, 'reject leaves no file');
    const b = await mk('Tooltip'); assert.equal(b.proposed, true);
    await browser.waitFor(`napkin.proposals.list().length === 1`);
    await q(`document.querySelector('.pitem .p-accept').click()`);
    await browser.waitFor(`!!napkin.find('Tooltip')`);
    assert.equal(existsSync(file), true);
    const hist = (await http(p.server.url, '/api/components/Tooltip/history')).json.history;
    assert.deepEqual([hist.at(-1).by, hist.at(-1).approvedBy], ['claude', 'you']);
  } finally { await p.close(); }
});

test('with 10 proposals every action is reachable at 1440x900, and keyboard focus scrolls a row into view', { timeout: 120000 }, async () => {
  const p = await openAgents(['Button', 'Card']);
  const { q, browser } = p;
  try {
    const claude = await p.agent('claude');
    for (let i = 0; i < 10; i++) {
      const r = await claude.apply('Button', [{ op: 'set', path: 'root.padding', value: `${10 + i}px` }], { propose: true });
      assert.equal(r.proposed, true, JSON.stringify(r));
    }
    await browser.waitFor(`napkin.proposals.list().length === 10`);
    await browser.waitFor(`document.querySelector('#proposals-tray').dataset.open === '1'`);
    const geo = () => q(`(() => { const t = document.querySelector('#proposals-tray').getBoundingClientRect(); const rows = [...document.querySelectorAll('.pitem')]; const inView = (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }; return { trayBottom: t.bottom, vh: innerHeight, head: ['#pt-accept-all', '#pt-reject-all'].every((s) => inView(document.querySelector(s))), h: rows[0].getBoundingClientRect().height, firstRowButtons: [...rows[0].querySelectorAll('.pb')].every(inView) }; })()`);
    const g = await geo();
    assert.ok(g.trayBottom <= g.vh && g.head && g.firstRowButtons, JSON.stringify(g));
    // the tray body scrolls inside the viewport: focusing the last row (keyboard) brings its Accept into the visible part of the tray
    const reach = async (i) => {
      await q(`document.querySelectorAll('.pitem')[${i}].focus()`);
      await sleep(80);
      return q(`(() => { const body = document.querySelector('#pt-body').getBoundingClientRect(); const b = document.querySelectorAll('.pitem')[${i}].querySelector('.p-accept').getBoundingClientRect(); return b.top >= body.top - 1 && b.bottom <= body.bottom + 1 && b.bottom <= innerHeight; })()`);
    };
    for (const i of [0, 3, 6, 9]) assert.equal(await reach(i), true, `row ${i + 1} Accept reachable`);
    // four proposals fit with no scrolling at all
    await q(`(async () => { for (const p of napkin.proposals.list().slice(4)) await napkin.proposals.reject(p.id); })()`);
    await browser.waitFor(`napkin.proposals.list().length === 4`);
    const fit = await q(`(() => { const b = document.querySelector('#pt-body'); return { scroll: b.scrollHeight - b.clientHeight, all: [...document.querySelectorAll('.pitem .pb')].every((e) => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }) }; })()`);
    assert.equal(fit.all, true, JSON.stringify(fit)); assert.ok(fit.scroll <= 1, `4 proposals need no wheel scroll: ${JSON.stringify(fit)}`);
  } finally { await p.close(); }
});
