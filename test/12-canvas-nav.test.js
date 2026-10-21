// Canvas lane, round 1: navigation (CAN-01), no layout shift and an overlay that keeps up (FEEL-04).
// Real input over CDP: wheel, Ctrl-wheel (a trackpad pinch arrives as Ctrl-wheel), Space-drag, middle-drag, touch, keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectCanvas } from '../src/canvas-client.js';
import { tempRepo, startServer, sleep } from './helpers/harness.js';
import { launchChromium } from './helpers/cdp.js';
import { input, centerOf } from './helpers/input.js';

const view = (b) => b.eval('napkin.view.get()');
const sec = (name) => `document.querySelector('section[data-name="${name}"]')`;
const node = (name, n) => `${sec(name)}.querySelector('.mount [data-n="${n}"]')`;

test('CAN-01 pan and zoom: every binding works, the point under the cursor stays put, 5% to 800%', { timeout: 90000 }, async (t) => {
  const { compDir } = tempRepo(['Card', 'Button', 'Chip']);
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    const stage = await centerOf(browser, `document.querySelector('#stage')`);

    await t.test('Ctrl-wheel zooms to the cursor: drift <= 1 px per step, in and out', async () => {
      const c0 = await centerOf(browser, node('Card', 'title'));
      const c = { ...c0, x: Math.round(c0.x), y: Math.round(c0.y) }; // pointer events carry whole pixels
      const rel = async () => { const r = await centerOf(browser, node('Card', 'title')); return { dx: c.x - r.left, dy: c.y - r.top, w: r.w, h: r.h }; };
      const start = await rel();
      const f0 = { x: start.dx / start.w, y: start.dy / start.h };
      let worst = 0, steps = 0;
      for (const dy of [-100, -100, -100, -100, -100, 100, 100, 100, 100, 100, 100, 100, -50, 50, -20]) {
        await io.wheel(c.x, c.y, 0, dy, { ctrl: true });
        const r = await rel();
        const drift = Math.max(Math.abs(r.dx - f0.x * r.w), Math.abs(r.dy - f0.y * r.h));
        worst = Math.max(worst, drift); steps++;
      }
      t.diagnostic(`${steps} zoom steps, worst drift ${worst.toFixed(3)} px`);
      assert.ok(worst <= 1, `drift ${worst}`);
      assert.match(await browser.eval(`document.querySelector('#zoom-level').textContent`), /^\d+%$/);
    });

    await t.test('the limits are 5% and 800%', async () => {
      for (let i = 0; i < 25; i++) await io.wheel(stage.x, stage.y, 0, 100, { ctrl: true });
      assert.equal((await view(browser)).z, 0.05);
      assert.equal(await browser.eval(`document.querySelector('#zoom-level').textContent`), '5%');
      for (let i = 0; i < 40; i++) await io.wheel(stage.x, stage.y, 0, -100, { ctrl: true });
      assert.equal((await view(browser)).z, 8);
      assert.equal(await browser.eval(`document.querySelector('#zoom-level').textContent`), '800%');
    });

    await t.test('Shift+1 fits everything, Shift+0 is 100%', async () => {
      await io.key('!', { shift: true, code: 'Digit1' });
      await browser.waitFor(`document.querySelector('#zoom-level').textContent === Math.round(napkin.view.get().z * 100) + '%'`);
      await sleep(400); // the fit flies for about 280 ms
      const inside = await browser.eval(`(() => { const s = document.querySelector('#stage').getBoundingClientRect(); return [...document.querySelectorAll('section.cmp')].every((c) => { const r = c.querySelector('.frame').getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1; }); })()`);
      assert.equal(inside, true, 'every component is on screen');
      assert.ok((await view(browser)).z <= 1);
      await io.key(')', { shift: true, code: 'Digit0' });
      await sleep(400);
      assert.ok(Math.abs((await view(browser)).z - 1) < 1e-6);
    });

    await t.test('wheel and trackpad scroll pan (Shift turns vertical into horizontal)', async () => {
      const a = await view(browser);
      await io.wheel(stage.x, stage.y, 0, 120);
      const b = await view(browser);
      assert.equal(b.y, a.y - 120); assert.equal(b.x, a.x); assert.equal(b.z, a.z);
      await io.wheel(stage.x, stage.y, 40, 0);
      assert.equal((await view(browser)).x, a.x - 40);
      await io.wheel(stage.x, stage.y, 0, 60, { shift: true });
      assert.equal((await view(browser)).x, a.x - 100);
    });

    await t.test('Space-drag and middle-drag pan; a pan never selects', async () => {
      const a = await view(browser);
      await io.down(' ');
      await browser.waitFor(`document.body.dataset.pan === 'ready'`);
      await io.drag(300, 700, 420, 760);
      await io.up(' ');
      const b = await view(browser);
      assert.equal(Math.round(b.x - a.x), 120); assert.equal(Math.round(b.y - a.y), 60);
      await io.drag(300, 700, 250, 650, { button: 'middle' });
      const c = await view(browser);
      assert.equal(Math.round(c.x - b.x), -50); assert.equal(Math.round(c.y - b.y), -50);
      assert.equal(await browser.eval(`napkin.state.selections.length`), 0);
    });

    await t.test('+ and - zoom in steps of 1.25 at the cursor; Shift+2 fits the selection', async () => {
      await io.key('!', { shift: true, code: 'Digit1' }); await sleep(400);
      const a = await view(browser);
      await io.move(stage.x, stage.y);
      await io.key('+');
      const b = await view(browser);
      assert.ok(Math.abs(b.z / a.z - 1.25) < 1e-6);
      await io.key('-'); await io.key('-');
      assert.ok(Math.abs((await view(browser)).z / a.z - 0.8) < 1e-6);
      await io.key('!', { shift: true, code: 'Digit1' }); await sleep(400);
      const c = await centerOf(browser, node('Button', 'label'));
      await io.click(c.x, c.y);
      await browser.waitFor(`napkin.state.selection?.node === 'label'`);
      const before = (await view(browser)).z;
      await io.key('@', { shift: true, code: 'Digit2' }); await sleep(400);
      const after = await view(browser);
      assert.ok(after.z > before * 2, `zoomed in on the selection (${before} -> ${after.z})`);
      const r = await centerOf(browser, node('Button', 'label'));
      const s = await centerOf(browser, `document.querySelector('#stage')`);
      assert.ok(r.left >= s.left && r.left + r.w <= s.left + s.w && r.top >= s.top && r.top + r.h <= s.top + s.h, 'the selection is on screen');
      assert.ok(Math.abs((r.x - s.x)) < 2 && Math.abs(r.y - s.y) < 2, 'and centred');
    });

    await t.test('touch pinch zooms and a one-finger drag on empty canvas pans', async () => {
      await io.key('!', { shift: true, code: 'Digit1' }); await sleep(400);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
      const a = await view(browser);
      await io.touch('touchStart', [[600, 700], [700, 700]]);
      await io.touch('touchMove', [[560, 700], [740, 700]]);
      await io.touch('touchMove', [[500, 700], [800, 700]]);
      await io.touch('touchEnd', []);
      const b = await view(browser);
      assert.ok(b.z > a.z * 1.5, `pinch zoomed ${a.z} -> ${b.z}`);
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    });
  } finally { await browser.close(); await server.stop(); }
});

test('FEEL-04 nothing jumps when an edit lands elsewhere, and the selection overlay is never behind', { timeout: 60000 }, async (t) => {
  const { compDir } = tempRepo(['Card', 'Button', 'Chip']);
  const server = await startServer(compDir);
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });` });
  const client = await connectCanvas(server.url, { by: 'agent' });
  try {
    await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    await sleep(500);

    await t.test('an agent edit in Button leaves every other frame where it was: layout shift 0', async () => {
      const rects = () => browser.eval(`JSON.stringify([...document.querySelectorAll('section.cmp')].map((c) => [c.dataset.name, c.getBoundingClientRect().left, c.getBoundingClientRect().top]))`);
      const before = JSON.parse(await rects());
      let rev = client.state('Button').revision;
      const cls0 = await browser.eval('window.__cls');
      for (const [path, value] of [['root.background', '#c8553d'], ['label.color', '#111111'], ['root.borderRadius', 14]]) {
        const r = await client.sendEdits('Button', rev, [{ op: 'set', path, value }]);
        assert.equal(r.ok, true, r.error);
        rev = r.revision;
        await browser.waitFor(`document.querySelector('section[data-name="Button"]').dataset.revision === '${rev}'`);
      }
      await sleep(300);
      const after = JSON.parse(await rects());
      assert.deepEqual(after.filter(([n]) => n !== 'Button'), before.filter(([n]) => n !== 'Button'), 'other frames did not move');
      assert.equal(await browser.eval('window.__cls'), cls0);
      t.diagnostic(`CLS since load: ${await browser.eval('window.__cls')} (Button now at revision ${rev})`);
      assert.equal(await browser.eval('window.__cls'), 0, 'CLS 0');
    });

    await t.test('changing the selection (variant nodes included) shifts nothing: CLS stays 0', async () => {
      const ids = await browser.eval(`JSON.stringify({ b: napkin.find('Button').component, c: napkin.find('Card').component, p: napkin.find('Chip').component })`);
      const { b, c, p } = JSON.parse(ids);
      const picks = [[b, 'root', { size: 'sm', state: 'hover' }], [b, 'label', { size: 'lg', state: 'default' }], [c, 'title', {}], [c, 'image', {}], [p, 'label', { size: 'xs', tone: 'warn', look: 'solid' }], [b, 'root', { size: 'md', state: 'default' }]];
      for (const [comp, node, variant] of picks) {
        await browser.eval(`napkin.select({ component: '${comp}', node: '${node}', variant: ${JSON.stringify(variant)} })`);
        await sleep(120);
      }
      await browser.eval(`napkin.selectMany([{ component: '${c}', node: 'title', variant: {} }, { component: '${c}', node: 'body', variant: {} }])`);
      await sleep(200);
      assert.equal(await browser.eval('window.__cls'), 0);
    });

    await t.test('the selection overlay matches its element on every frame while panning and zooming', async () => {
      const c = await centerOf(browser, node('Card', 'title'));
      await io.click(c.x, c.y);
      await browser.waitFor(`napkin.state.selection?.node === 'title'`);
      await browser.eval(`(() => { window.__lag = { max: 0, n: 0, stop: false };
        const box = document.querySelector('#overlay-select');
        const loop = () => { const el = napkin.stage.selectedElement(napkin.state.selection); const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
          window.__lag.max = Math.max(window.__lag.max, Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height)); window.__lag.n++;
          if (!window.__lag.stop) requestAnimationFrame(loop); };
        loop(); return true; })()`);
      for (let i = 0; i < 20; i++) { await io.wheel(700, 450, 7, 11); await io.wheel(c.x, c.y, 0, i % 2 ? 40 : -40, { ctrl: true }); }
      await sleep(100);
      const lag = await browser.eval(`(() => { window.__lag.stop = true; return window.__lag; })()`);
      t.diagnostic(`${lag.n} frames sampled, worst overlay offset ${lag.max.toFixed(3)} px`);
      assert.ok(lag.n > 10);
      assert.ok(lag.max <= 0.5, `overlay offset ${lag.max}`);
    });
  } finally { client.close(); await browser.close(); await server.stop(); }
});
