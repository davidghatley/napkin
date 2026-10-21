// INS-01 code strip, INS-02 inspect, INS-03 copy usage, and the page side of the assets lane (AST-01..04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, sleep, waitFor, ROOT } from './page.js';
import { launchChromium } from '../helpers/cdp.js';
import { png } from './png.js';
import { http } from '../helpers/agents.js';

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('code strip, inspect, usage and assets on the page', { timeout: 175000 }, async (t) => {
  const p = await open(['Button', 'Card', 'Chip']);
  const { q, io, browser } = p;
  const text = (sel) => q(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
  const exceptions = [];
  browser.send('Runtime.enable');
  try {
    await p.select('Button', 'root', { size: 'md', state: 'default' });

    await t.test('INS-01: the strip shows the live TSX, highlights the selected node, and a click on a line selects its node', async () => {
      await q(`document.querySelector('#open-code').click()`);
      await browser.waitFor(`document.querySelectorAll('#code-lines .cl').length > 40`);
      assert.equal(await q(`document.querySelector('#code-lines').dataset.node`), 'root');
      const hl = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#code-lines .cl.hl')].map((l) => l.textContent.replace(/^\\d+/, '')))`));
      assert.ok(hl.some((l) => l.includes('data-n="root"')), 'the JSX element of root is highlighted');
      assert.ok(hl.some((l) => l.includes('data-n="label"')) && hl.some((l) => l.includes('</button>')), 'through its children and closing tag');
      const styleHl = await q(`document.querySelectorAll('#code-lines .cl.hl-style').length`);
      assert.ok(styleHl > 5, 'and its style entries');
      await p.select('Button', 'label', { size: 'md', state: 'default' });
      const label = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#code-lines .cl.hl')].map((l) => l.textContent.replace(/^\\d+/, '')))`));
      assert.equal(label.length, 1); assert.match(label[0], /<span data-n="label"/);
      // click a line: the Card's title line, found by text, selects that node (in Card, after switching the strip)
      await p.select('Card', 'card', {});
      await browser.waitFor(`document.querySelector('.c-name').textContent === 'Card.tsx'`);
      await q(`(() => { const l = [...document.querySelectorAll('#code-lines .cl')].find((x) => x.textContent.includes('<h3 data-n="title"')); l.click(); })()`);
      await browser.waitFor(`napkin.state.selection?.node === 'title'`);
      assert.equal(await q(`napkin.state.selection.component === napkin.find('Card').component`), true);
      // a line inside a style block selects the node whose block it is
      await q(`(() => { const l = [...document.querySelectorAll('#code-lines .cl')].find((x) => /fontSize: '22px'/.test(x.textContent)); l.click(); })()`);
      await browser.waitFor(`napkin.state.selection?.node === 'title'`);
      await p.shot('code');
    });

    await t.test('INS-01: the strip follows every edit within 100 ms (whole page: send, write, frame, strip)', async () => {
      await p.select('Button', 'root', { size: 'md', state: 'default' });
      await browser.waitFor(`document.querySelector('.c-name').textContent === 'Button.tsx'`);
      const e2e = [], paint = [];
      for (let i = 0; i < 12; i++) {
        const v = `${20 + i}px ${40 + i}px`;
        const ms = await q(`(async () => { const t0 = performance.now(); const p = napkin.sendEdits(napkin.find('Button').component, [{ op: 'set', path: 'root.padding', value: '${v}' }]); const strip = document.querySelector('#code-lines'); while (!strip.textContent.includes("padding: '${v}'")) await new Promise((r) => requestAnimationFrame(r)); const done = performance.now() - t0; await p; return [done, napkin.code.perf.painted - napkin.code.perf.frame]; })()`);
        e2e.push(ms[0]); paint.push(ms[1]);
        await sleep(60);
      }
      t.diagnostic(`code strip after an edit: end to end median ${median(e2e).toFixed(1)} ms, max ${Math.max(...e2e).toFixed(1)} ms; frame to painted median ${median(paint).toFixed(2)} ms, max ${Math.max(...paint).toFixed(2)} ms`);
      assert.ok(Math.max(...e2e) < 100, `every update under 100 ms (max ${Math.max(...e2e).toFixed(1)})`);
      // a hand edit of the file shows up too
      p.git('checkout', '--', 'components/Button.tsx');
      await browser.waitFor(`!document.querySelector('#code-lines').textContent.includes("padding: '31px 51px'")`, 3000);
    });

    await t.test('INS-02: inspect shows the computed CSS of any cell, matching getComputedStyle 100%, with where each value comes from', async () => {
      await q(`document.querySelector('#open-inspect').click()`);
      let rows = 0, mismatches = [];
      const variants = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('section[data-name="Button"] figure.cell')].map((c) => JSON.parse(c.dataset.variant)))`));
      assert.equal(variants.length, 6);
      for (const node of ['root', 'label']) for (const v of variants) {
        await p.select('Button', node, v);
        await browser.waitFor(`document.querySelectorAll('#i-table tr[data-prop]').length > 5 && document.querySelector('#i-cell').value === ${JSON.stringify(JSON.stringify(v))}`);
        const res = JSON.parse(await q(`JSON.stringify((() => {
          const sec = document.querySelector('section[data-name="Button"]');
          const cell = [...sec.querySelectorAll('figure.cell')].find((c) => c.dataset.variant === ${JSON.stringify(JSON.stringify(v))});
          const el = cell.querySelector('.mount [data-n="${node}"]'), cs = getComputedStyle(el);
          return [...document.querySelectorAll('#i-table tr[data-prop]')].map((tr) => ({ prop: tr.dataset.prop, shown: tr.querySelector('.i-val').textContent, real: cs.getPropertyValue(tr.dataset.prop), from: tr.dataset.from }));
        })())`));
        for (const r of res) { rows++; if (r.shown !== r.real) mismatches.push({ node, v, ...r }); }
      }
      t.diagnostic(`inspect: ${rows} rows over 12 node/cell pairs, ${mismatches.length} differ from getComputedStyle`);
      assert.ok(rows > 100); assert.deepEqual(mismatches, [], '100% match');
      // provenance
      const from = async (node, v, prop) => { await p.select('Button', node, v); await browser.waitFor(`!!document.querySelector('#i-table tr[data-prop="${prop}"]')`); return q(`document.querySelector('#i-table tr[data-prop="${prop}"]').dataset.from`); };
      assert.equal(await from('root', { size: 'sm', state: 'default' }, 'padding'), 'size=sm', 'the sm override wins');
      assert.equal(await from('root', { size: 'md', state: 'default' }, 'padding'), 'base');
      assert.equal(await from('root', { size: 'md', state: 'hover' }, 'background-color'), 'state=hover');
      assert.equal(await from('root', { size: 'lg', state: 'hover' }, 'font-size'), 'size=lg');
      assert.equal(await from('root', { size: 'md', state: 'default' }, 'display'), 'base');
      assert.equal(await from('label', { size: 'sm', state: 'default' }, 'font-size'), 'inherited from root (size=sm)', 'a child takes the parent\'s value down');
      assert.equal(await from('label', { size: 'md', state: 'default' }, 'font-weight'), 'base');
      assert.equal(await from('label', { size: 'md', state: 'default' }, 'text-transform'), 'inherited from the page');
      await p.select('Button', 'root', { size: 'sm', state: 'hover' });
      await sleep(150);
      // the cell picker looks at another cell of the same node
      await q(`(() => { const s = document.querySelector('#i-cell'); s.value = ${JSON.stringify(JSON.stringify({ size: 'lg', state: 'default' }))}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await browser.waitFor(`document.querySelector('#i-table tr[data-prop="padding"]')?.querySelector('.i-val').textContent === '12px 24px'`);
      await p.shot('inspect');
    });

    await t.test('INS-03: Copy usage gives the JSX for the cell, and pasted into a consumer app it renders that cell (pixel diff 0)', async () => {
      await p.select('Button', 'root', { size: 'sm', state: 'hover' });
      await browser.waitFor(`document.querySelector('#i-cell').value === ${JSON.stringify(JSON.stringify({ size: 'sm', state: 'hover' }))}`);
      const usage = await text('#i-usage');
      assert.equal(usage, '<Button size="sm" state="hover" label="Button" />');
      await q(`document.querySelector('#i-copy').click()`);
      await sleep(200);
      assert.equal(await q(`napkin.copied`), usage);
      // the consumer app: the same line, the same component folder, no napkin code
      const dir = mkdtempSync(join(tmpdir(), 'napkin-consumer-'));
      writeFileSync(join(dir, 'App.tsx'), `import { createRoot } from 'react-dom/client';\nimport { flushSync } from 'react-dom';\nimport { Button } from '@components/Button';\nflushSync(() => createRoot(document.getElementById('m')!).render(${usage}));\n`);
      await build({ entryPoints: [join(dir, 'App.tsx')], bundle: true, format: 'iife', jsx: 'automatic', alias: { '@components': p.compDir }, nodePaths: [join(ROOT, 'node_modules')], outfile: join(dir, 'app.js'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
      writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><style>* { box-sizing: border-box; } body { color: #1c1f27; margin: 0; }</style><div id="m" style="position:absolute;left:16px;top:16px"></div><script src="app.js"></script>`);
      const app = await launchChromium({ width: 1600, height: 1200 });
      try {
        await app.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
        await app.goto(`file://${join(dir, 'index.html')}`);
        await app.waitFor(`!!document.querySelector('#m button')`);
        const box = JSON.parse(await app.eval(`JSON.stringify((() => { const r = document.querySelector('#m').firstElementChild.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())`));
        const shot = Buffer.from((await app.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: Math.ceil(box.w), height: Math.ceil(box.h), scale: 1 }, captureBeyondViewport: true })).data, 'base64');
        const rendered = Buffer.from(await (await fetch(new URL(`api/components/Button/render?variant=${encodeURIComponent(JSON.stringify({ size: 'sm', state: 'hover' }))}`, p.server.url))).arrayBuffer());
        t.diagnostic(`consumer cell ${shot.length} bytes, napkin render ${rendered.length} bytes`);
        assert.ok(shot.equals(rendered), 'identical pixels');
      } finally { await app.close(); }
      await q(`napkin.drawer.close()`);
    });

    await t.test('AST-01/04: dropping an image file on an image slot copies it to assets/<sha8>.<ext> and changes one line; twice is one file', async () => {
      // a slot, committed, so the diff shows only the drop
      await p.you('Card', [{ op: 'insert', parent: 'card', index: 0, node: { id: 'photo', tag: 'img', attrs: { src: '', alt: 'photo' }, style: { width: '100%', height: '40px' } } }]);
      await p.settled('Card');
      p.git('add', 'components/Card.tsx'); p.git('-c', 'user.name=t', '-c', 'user.email=t@e.invalid', 'commit', '-qm', 'slot');
      const bytes = png([30, 140, 90], 60, 20), sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
      const drop = (b64) => q(`(async () => {
        const bin = atob(${JSON.stringify(b64)}), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([a], 'green.png', { type: 'image/png' }));
        const img = document.querySelector('section[data-name="Card"] .mount img[data-n="photo"]');
        const r = img.getBoundingClientRect();
        img.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 3, clientY: r.top + 3 }));
        img.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 3, clientY: r.top + 3 }));
        return true; })()`);
      await drop(bytes.toString('base64'));
      await waitFor(() => /assets\//.test(p.read('Card')), 4000);
      assert.match(p.read('Card'), new RegExp(`src=["']assets/${sha8}\\.png["']`));
      assert.match(p.git('diff', '--numstat', '--', 'components/Card.tsx'), /^1\t1\t/);
      assert.deepEqual(readdirSync(join(p.compDir, 'assets')), [`${sha8}.png`]);
      await p.settled('Card');
      await browser.waitFor(`(() => { const i = document.querySelector('section[data-name="Card"] .mount img[data-n="photo"]'); return i && i.complete && i.naturalWidth === 60; })()`, 4000);
      // the same image again (a fresh File, same bytes): still one file, no second copy
      await drop(bytes.toString('base64'));
      await sleep(500);
      assert.deepEqual(readdirSync(join(p.compDir, 'assets')), [`${sha8}.png`], 'stored once');
      assert.match(await text('#hint'), /Already stored: assets\//);
    });

    await t.test('AST-02: the Assets tab lists every image in the repo and an asset dragged onto the canvas becomes an <img>', async () => {
      mkdirSync(join(p.dir, 'public'), { recursive: true });
      writeFileSync(join(p.dir, 'public', 'logo.png'), png([200, 60, 60], 32, 32));
      writeFileSync(join(p.dir, 'public', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="#36c"/></svg>');
      await q(`document.querySelector('#open-assets').click()`);
      const listed = (await http(p.server.url, '/api/assets')).json.assets.map((a) => a.path);
      assert.ok(listed.includes('public/logo.png') && listed.includes('public/mark.svg') && listed.some((x) => x.startsWith('components/assets/')));
      await browser.waitFor(`document.querySelectorAll('#a-grid .asset').length === ${listed.length}`);
      const shown = JSON.parse(await q(`JSON.stringify([...document.querySelectorAll('#a-grid .asset')].map((a) => a.dataset.path))`));
      assert.deepEqual(shown.sort(), [...listed].sort(), 'every asset listed');
      await browser.waitFor(`[...document.querySelectorAll('#a-grid .asset img')].every((i) => i.complete && i.naturalWidth > 0)`, 4000);
      await p.shot('assets');
      // drag the svg onto the Card's body text node: it cannot hold an img, so the new <img> goes into its parent
      const before = p.read('Card');
      await q(`(() => {
        const dt = new DataTransfer(); dt.setData('application/x-napkin-asset', 'public/mark.svg');
        const el = document.querySelector('section[data-name="Card"] .mount [data-n="body"]'), r = el.getBoundingClientRect();
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + 2 }));
      })()`);
      await waitFor(() => p.read('Card') !== before, 4000);
      assert.match(p.read('Card'), /<img data-n="image1"[^>]*src="assets\/[0-9a-f]{8}\.svg"/);
      assert.equal(readdirSync(join(p.compDir, 'assets')).filter((f) => f.endsWith('.svg')).length, 1);
      await q(`napkin.drawer.close()`);
    });

    await t.test('AST-03: a missing asset shows a badge with its path, and nothing crashes', async () => {
      await p.you('Card', [{ op: 'set', path: 'photo.@src', value: 'assets/does-not-exist.png' }]);
      await p.settled('Card');
      await browser.waitFor(`!!document.querySelector('section[data-name="Card"] .asset-badge')`, 4000);
      assert.equal(await text('section[data-name="Card"] .asset-badge'), 'missing: assets/does-not-exist.png');
      assert.equal(await q(`document.querySelector('section[data-name="Card"] .asset-badge').dataset.path`), 'assets/does-not-exist.png');
      assert.equal(await q(`document.body.dataset.ready`), '1');
      assert.equal(await q(`document.querySelectorAll('section.cmp[data-ready="1"]').length`), 3, 'every component still drew');
      // fixing the src clears the badge
      await p.you('Card', [{ op: 'set', path: 'photo.@src', value: null }]);
      await p.settled('Card');
      await browser.waitFor(`!document.querySelector('section[data-name="Card"] .asset-badge')`, 4000);
    });

    assert.deepEqual(browser.consoleLines.filter((l) => /uncaught|exception|TypeError|ReferenceError/i.test(l)), [], 'no page errors');
  } finally { await p.close(); }
});
