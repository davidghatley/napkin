// First build M5: the proving demo (INTENT), end to end in headless Chromium (CPU).
// David and an agent edit a Button at the same time: David changes the base radius in the panel
// and draws an icon slot; the agent, over MCP and from the same starting revision, adds an xl size.
// Both land in components/Button.tsx, the diff is small, the canvas shows the agent while it works,
// and a separate plain React app imports Button and renders every size.
// Set DEMO_OUT=docs/demo to save screenshots, the diff and the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readComponent } from '../src/tsx/read.js';
import { variantGrid } from '../src/model.js';
import { buildApp } from '../examples/consumer-app/build.mjs';
import { tempRepo, startServer, startMcp, ROOT } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';

function serveStatic(dir) {
  const srv = createServer((req, res) => {
    const f = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
    try { const body = readFileSync(join(dir, f)); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() })));
}

test('the proving demo: David and an agent edit one Button at once; an app imports the result', { timeout: 90000 }, async () => {
  const out = process.env.DEMO_OUT ? join(ROOT, process.env.DEMO_OUT) : null;
  if (out) mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  const lines = [];
  const log = (who, msg) => { const l = `[${(performance.now() - t0).toFixed(0).padStart(5)} ms] ${who.padEnd(7)} ${msg}`; lines.push(l); };

  const { compDir, fileOf, git } = tempRepo(['Button']);
  const file = fileOf('Button');
  const server = await startServer(compDir);
  log('napkin', `canvas at ${server.url}, folder components/ (Button.tsx)`);
  const agent = await startMcp(server.url, { NAPKIN_PRESENCE_MS: '2500' });
  log('agent', `MCP connected: ${agent.init.result.serverInfo.name} ${agent.init.result.serverInfo.version}`);
  const browser = await launchChromium({ width: 1400, height: 900 });
  const q = (e) => browser.eval(e);
  const sec = `document.querySelector('section[data-name="Button"]')`;
  const cells = `[...${sec}.querySelectorAll('.cell')]`;
  let app;
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    await browser.waitFor(`!document.querySelector('#agent-status').hidden`);
    log('canvas', `"${await q(`document.querySelector('#agent-status').textContent`)}"; ${await q(`${cells}.length`)} Button variants on the grid`);
    if (out) writeFileSync(join(out, 'demo-1-before.png'), await browser.screenshot());

    // Both start from the same revision.
    const { data: start } = await agent.call('read_component', { component: 'Button' });
    log('agent', `read Button at revision ${start.revision}`);

    // Select the base cell's root in the canvas.
    await q(`${cells}.find((c) => c.dataset.variant === '{"size":"md","state":"default"}').querySelector('[data-n="root"]').click()`);
    await browser.waitFor(`document.querySelector('#sel-node')?.textContent.startsWith('root')`);

    const david = (async () => {
      await browser.type('#borderRadius', '12');
      await browser.waitFor(`getComputedStyle(${sec}.querySelector('[data-n="root"]')).borderTopLeftRadius === '12px'`);
      log('david', 'panel: Button root borderRadius 6 → 12 (base)');
      // I: draw an icon slot into the button (it lands after the label; focus back on the canvas first).
      await q('document.activeElement?.blur(), true');
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'i', code: 'KeyI', windowsVirtualKeyCode: 73, text: 'i' });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'i', code: 'KeyI', windowsVirtualKeyCode: 73 });
      const r = JSON.parse(await q(`JSON.stringify(${sec}.querySelector('[data-n="root"]').getBoundingClientRect())`));
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await browser.send('Input.dispatchMouseEvent', { type, x: r.left + 4, y: r.top + r.height / 2, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
      }
      await browser.waitFor(`!!${sec}.querySelector('[data-n="image1"]')`);
      log('david', 'tool I: image slot "image1" drawn into the button');
    })();

    const agentWork = (async () => {
      const r = await agent.call('add_variant', { component: 'Button', baseRevision: start.revision, axis: 'size', value: 'xl', overrides: { root: { padding: '14px 28px', fontSize: 20 } } });
      assert.equal(r.isError, false, r.text);
      log('agent', `add_variant size=xl (padding 14px 28px, fontSize 20) from revision ${start.revision} → revision ${r.data.revision}`);
    })();

    // While the agent works, the canvas says so.
    const seen = await browser.waitFor(`document.querySelector('#presence').textContent.includes('agent: editing Button / size=xl')`, 4000).then(() => true, () => false);
    if (seen) log('canvas', `presence: "${await q(`document.querySelector('#presence').textContent`)}"`);
    if (seen && out) writeFileSync(join(out, 'demo-2-presence.png'), await browser.screenshot());
    await Promise.all([david, agentWork]);
    assert.ok(seen, 'the canvas shows the agent presence label');

    // Both edits are in the file and on the canvas.
    await browser.waitFor(`${cells}.length === 8`);
    const doc = readComponent(readFileSync(file, 'utf8')).doc;
    assert.equal(doc.root.style.borderRadius, 12);
    assert.ok(doc.root.children.some((c) => c.id === 'image1' && c.tag === 'img'));
    assert.deepEqual(doc.props.find((p) => p.name === 'size').options, ['md', 'sm', 'lg', 'xl']);
    assert.deepEqual(doc.variants.size.xl, { root: { padding: '14px 28px', fontSize: 20 } });
    assert.equal(variantGrid(doc).length, 8);
    const xlRadius = await q(`getComputedStyle(${cells}.find((c) => c.dataset.variant === '{"size":"xl","state":"default"}').querySelector('[data-n="root"]')).borderTopLeftRadius`);
    assert.equal(xlRadius, '12px', 'the agent’s new size inherits David’s base change');
    log('canvas', `8 variants; xl cell inherits radius ${xlRadius}`);
    if (out) writeFileSync(join(out, 'demo-3-after.png'), await browser.screenshot());

    const stat = git('diff', '--numstat').trim();
    const [added, removed] = stat.split('\t').map(Number);
    assert.ok(added <= 16 && removed <= 3, `small diff, got ${stat}`);
    const diff = git('diff');
    log('git', `diff --numstat: ${stat}`);

    // A separate plain React app imports the edited Button.
    const dist = await buildApp(compDir, mkdtempSync(join(tmpdir(), 'napkin-app-')));
    app = await serveStatic(dist);
    await browser.goto(app.url);
    await browser.waitFor(`document.querySelectorAll('button[data-n="root"]').length === 8`);
    const xl = JSON.parse(await q(`JSON.stringify((() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Pay xl'); const s = getComputedStyle(b); return { padding: s.padding, radius: s.borderTopLeftRadius, icon: !!b.querySelector('img[data-n="image1"]') }; })())`));
    assert.deepEqual(xl, { padding: '14px 28px', radius: '12px', icon: true });
    log('app', `consumer app (plain React, no napkin runtime) renders 8 Buttons; "Pay xl" padding ${xl.padding}, radius ${xl.radius}, icon slot present`);
    if (out) writeFileSync(join(out, 'demo-4-consumer-app.png'), await browser.screenshot());
    log('result', 'PASS: both edits landed in Button.tsx and a separate app imports it');
    if (out) { writeFileSync(join(out, 'demo-log.txt'), lines.join('\n') + '\n'); writeFileSync(join(out, 'demo-diff.txt'), diff); }
  } finally {
    app?.close(); await browser.close(); agent.stop(); await server.stop();
  }
});
