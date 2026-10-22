// WPC-22 (a create proposal is a ghost frame with its real cells on arrival, placed like a new component; the tray row is not clipped)
// and WPC-21 on the page (the row marks a name clash as soon as it exists; Accept never overwrites).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openAgents, sleep } from './helpers.js';
import { http, session } from '../helpers/agents.js';

for (const [width, height] of [[1440, 900], [1280, 720]]) {
  test(`create proposal: ghost frame with real cells on arrival, no overlap, tray row readable at ${width}x${height}`, { timeout: 120000 }, async () => {
    const p = await openAgents(['Button', 'Card', 'Chip'], { width, height });
    const { q, browser } = p;
    try {
      const claude = await p.agent('claude');
      const r = (await http(p.server.url, '/api/components', { method: 'POST', token: claude.token, body: { name: 'Tooltip', propose: true } })).json;
      assert.equal(r.proposed, true, JSON.stringify(r));
      await browser.waitFor(`napkin.proposals.list().length === 1 && !!document.querySelector('.ghost-new [data-n="root"]')`); // nobody clicked anything
      await sleep(900); // a ghost placed off screen is flown to once
      const g = await q(`(() => {
        const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const ghost = document.querySelector('.ghost-new'), frame = rect(ghost.querySelector('.gn-frame')), stage = rect(document.querySelector('#stage'));
        const others = [...document.querySelectorAll('section.cmp')].map((s) => rect(s.querySelector('.frame')));
        const hit = others.some((o) => frame.l < o.r && frame.r > o.l && frame.t < o.b && frame.b > o.t);
        const cell = ghost.querySelector('.cell .mount');
        const clip = (e) => e && e.scrollWidth > e.clientWidth + 1;
        const row = document.querySelector('.pitem');
        return { inStage: frame.l >= stage.l && frame.t >= stage.t && frame.r <= stage.r && frame.b <= stage.b, hit, cellW: rect(cell).w, cellH: rect(cell).h,
          flag: ghost.querySelector('.gn-flag').textContent, dashed: getComputedStyle(ghost.querySelector('.gn-frame')).outlineStyle,
          clipped: [row.querySelector('.pi-comp'), row.querySelector('.pi-age'), row.querySelector('.pi-edits li span'), row.querySelector('.pi-main')].map(clip),
          age: row.querySelector('.pi-age').textContent, comp: row.querySelector('.pi-comp').textContent, line: row.querySelector('.pi-edits li span').textContent,
          lineH: rect(row.querySelector('.pi-edits li span')).h, buttons: [...row.querySelectorAll('.pi-btns button')].map((b) => { const r = b.getBoundingClientRect(); return r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.width > 0; }) };
      })()`);
      assert.equal(g.inStage, true, JSON.stringify(g));
      assert.equal(g.hit, false, 'the ghost does not sit on another component');
      assert.ok(g.cellW > 20 && g.cellH > 10, 'its real cell is rendered');
      assert.match(g.flag, /claude's proposal · new component Tooltip · not written/);
      assert.equal(g.dashed, 'dashed');
      assert.deepEqual(g.clipped, [false, false, false, false], JSON.stringify(g));
      assert.equal(g.comp, 'Tooltip'); assert.match(g.age, /^(now|\d+s)$/); assert.match(g.line, /^create component Tooltip \(div\)$/);
      assert.ok(g.buttons.every(Boolean), 'row buttons are on screen');
      // it is only a preview: no file, and the hide button works
      await q(`document.querySelector('.pitem .p-show').click()`);
      await browser.waitFor(`!document.querySelector('.ghost-new')`);
      await q(`document.querySelector('.pitem .p-show').click()`);
      await browser.waitFor(`!!document.querySelector('.ghost-new [data-n="root"]')`);
      if (width === 1440) { await sleep(200); await p.shot('agents3-ghost'); }
    } finally { await p.close(); }
  });
}

test('a name clash shows on the tray row at once with a plain reason; Accept never overwrites the person\'s component', { timeout: 120000 }, async () => {
  const p = await openAgents(['Button', 'Card']);
  const { q, browser } = p;
  try {
    const claude = await p.agent('claude');
    await http(p.server.url, '/api/components', { method: 'POST', token: claude.token, body: { name: 'Tooltip', propose: true } });
    await browser.waitFor(`napkin.proposals.list().length === 1`);
    assert.equal(await q(`!!document.querySelector('.pi-clash')`), false);
    const me = await session(p.server.url, 'you');
    const made = await http(p.server.url, '/api/components', { method: 'POST', token: me, body: { name: 'Tooltip' } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    await browser.waitFor(`!!document.querySelector('.pitem .pi-clash')`); // before anyone presses Accept
    assert.match(await q(`document.querySelector('.pitem .pi-clash').textContent`), /Name taken\. A component named Tooltip now exists/);
    const before = readFileSync(`${p.compDir}/Tooltip.tsx`, 'utf8');
    await q(`document.querySelector('.pitem .p-accept').click()`);
    await browser.waitFor(`napkin.proposals.state.errors.size === 1 && !!document.querySelector('.pitem .pi-stale:not(.pi-clash)')`); // the refused Accept's own message
    assert.equal(readFileSync(`${p.compDir}/Tooltip.tsx`, 'utf8'), before, 'the existing component is untouched');
    assert.equal(await q(`napkin.proposals.list().length`), 1, 'the proposal stays so it can be rejected');
    await browser.waitFor(`!document.querySelector('.pitem .p-reject').disabled`);
    await q(`document.querySelector('.pitem .p-reject').click()`);
    await browser.waitFor(`napkin.proposals.list().length === 0`);
  } finally { await p.close(); }
});

test('several quick create proposals: every ghost is on screen on arrival and every flag shows the whole component name', { timeout: 120000 }, async () => {
  const p = await openAgents(['Button', 'Card', 'Chip']);
  const { q, browser } = p;
  try {
    const claude = await p.agent('claude');
    const names = ['Tooltip', 'NotificationBadgeWithCounter', 'Popover', 'Breadcrumbs', 'SegmentedControlGroup'];
    await Promise.all(names.map((name) => http(p.server.url, '/api/components', { method: 'POST', token: claude.token, body: { name, propose: true } })));
    await browser.waitFor(`document.querySelectorAll('.ghost-new [data-n="root"]').length === ${names.length}`);
    await sleep(1200);
    const g = await q(`(() => { const stage = document.querySelector('#stage').getBoundingClientRect();
      return [...document.querySelectorAll('.ghost-new')].map((e) => { const f = e.querySelector('.gn-frame').getBoundingClientRect(), fl = e.querySelector('.gn-flag');
        return { inStage: f.left >= stage.left && f.top >= stage.top && f.right <= stage.right && f.bottom <= stage.bottom, flagOk: fl.scrollWidth <= fl.clientWidth + 1 && fl.scrollHeight <= fl.clientHeight + 1, text: fl.textContent }; }); })()`);
    assert.equal(g.length, names.length);
    for (const x of g) { assert.equal(x.inStage, true, JSON.stringify(g)); assert.equal(x.flagOk, true, JSON.stringify(x)); }
    for (const n of names) assert.ok(g.some((x) => x.text.includes(`new component ${n} ·`)), n);
  } finally { await p.close(); }
});
