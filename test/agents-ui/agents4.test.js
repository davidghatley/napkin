// WPC-26 (an agent proposal never moves the camera) and WPC-27 (the proposals tray leaves the canvas its height and paints no blank strip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAgents, sleep } from './helpers.js';
import { http } from '../helpers/agents.js';

test('WPC-26: a create proposal leaves the camera alone, says where the ghost is, and one click goes there', { timeout: 120000 }, async () => {
  const p = await openAgents(['Button', 'Card', 'Chip']);
  const { q, browser } = p;
  try {
    await q(`napkin.view.set({ x: 40, y: 40, z: 1.5 })`);
    await sleep(300);
    const before = await q(`JSON.stringify(napkin.view.get())`);
    const claude = await p.agent('claude');
    const r = (await http(p.server.url, '/api/components', { method: 'POST', token: claude.token, body: { name: 'Tooltip', propose: true } })).json;
    assert.equal(r.proposed, true, JSON.stringify(r));
    await browser.waitFor(`napkin.proposals.list().length === 1 && !!document.querySelector('.ghost-new [data-n="root"]')`);
    await sleep(1200); // a flight, if there were one, would be done by now
    assert.equal(await q(`JSON.stringify(napkin.view.get())`), before, 'the view did not move');
    const off = await q(`(() => { const g = document.querySelector('.ghost-new').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return !(g.left >= s.left && g.top >= s.top && g.right <= s.right && g.bottom <= s.bottom); })()`);
    if (off) assert.match(await q(`document.querySelector('.pitem .pi-away')?.textContent || ''`), /off screen/, 'an off-screen ghost is pointed out in the tray');
    await q(`document.querySelector('.pitem').click()`); await sleep(900);
    assert.equal(await q(`(() => { const g = document.querySelector('.ghost-new').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return g.left >= s.left && g.top >= s.top && g.right <= s.right && g.bottom <= s.bottom; })()`), true, 'one click brings it into view');
  } finally { await p.close(); }
});

for (const [width, height] of [[1440, 900], [1280, 720]]) {
  test(`WPC-27: the proposals tray keeps the canvas >=70% of its height and paints no blank strip at ${width}x${height}`, { timeout: 120000 }, async () => {
    const p = await openAgents(['Button', 'Card'], { width, height });
    const { q, browser } = p;
    try {
      const stageH = () => q(`document.querySelector('#stage').getBoundingClientRect().height`);
      const h0 = await stageH();
      const claude = await p.agent('claude');
      for (let i = 0; i < 6; i++) assert.equal((await claude.apply('Button', [{ op: 'set', path: 'root.padding', value: `${10 + i}px` }], { propose: true })).proposed, true);
      await browser.waitFor(`napkin.proposals.list().length === 6 && document.querySelector('#proposals-tray').dataset.open === '1'`);
      await sleep(300);
      assert.ok(await stageH() >= h0 * 0.75, `canvas ${await stageH()} of ${h0}`);
      const g = await q(`(() => {
        const t = document.querySelector('#proposals-tray').getBoundingClientRect(), d = document.querySelector('#dock').getBoundingClientRect();
        const head = document.querySelector('#proposals-tray .pt-head').getBoundingClientRect();
        return { trayCoversDock: Math.abs(t.width - d.width) <= 1 && Math.abs(t.height - d.height) <= 1, head: head.top >= 0 && head.bottom <= innerHeight, bottom: t.bottom <= innerHeight, rowsOk: [...document.querySelectorAll('#proposals-tray .pitem')].every((e) => e.getBoundingClientRect().width > 300) };
      })()`);
      assert.ok(g.trayCoversDock, 'nothing of the dock is left blank beside the tray: ' + JSON.stringify(g));
      assert.ok(g.head && g.bottom && g.rowsOk, JSON.stringify(g));
    } finally { await p.close(); }
  });
}
