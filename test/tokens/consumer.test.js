import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { buildApp } from '../../examples/consumer-app/build.mjs';

test('TOK-02: plain consumer-app imports token CSS; bound Button is pixel-identical', { timeout: 30000 }, async t => {
  const { dir, compDir, file } = tempRepo(['Button']);
  cpSync(join(ROOT, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
  writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}');
  const source = readFileSync(file, 'utf8').replace("label = 'Button'", "label = 'Pay md'").replace("padding: '8px 16px'", "padding: 'var(--space-4)'").replace("background: '#2236b0'", "background: 'var(--accent)'").replace("color: '#f9f9f5'", "color: 'var(--on-accent)'").replace('borderRadius: 6', "borderRadius: 'var(--radius-medium)'").replace('fontSize: 15', "fontSize: 'var(--body-font-size)'");
  writeFileSync(file, source);
  assert.doesNotMatch(source, /from.*napkin/);
  const out = mkdtempSync(join(tmpdir(), 'napkin-token-consumer-'));
  await buildApp(compDir, out);
  assert.match(readFileSync(join(out, 'app.css'), 'utf8'), /--space-4/);
  const staticServer = createServer((req, res) => {
    const file = req.url === '/' ? 'index.html' : req.url.slice(1);
    try { res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(readFileSync(join(out, file))); } catch { res.end(); }
  });
  await new Promise(r => staticServer.listen(0, '127.0.0.1', r));
  const appURL = 'http://127.0.0.1:' + staticServer.address().port;
  const server = await startServer(compDir);
  try {
    const render = Buffer.from(await (await fetch(new URL('api/components/Button/render', server.url))).arrayBuffer());
    let same = 0;
    for (let i = 0; i < 3; i++) {
      const b = await launchChromium({ width: 1600, height: 1200 });
      try {
        await b.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
        await b.goto(appURL);
        await b.waitFor('!!document.querySelector("button")');
        // Put the existing app cell at the renderer's integer coordinates; retain the app's real CSS and React.
        await b.eval(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pay md'); const host = document.createElement('div'); host.style.cssText='position:absolute;left:16px;top:16px'; host.append(button); document.body.replaceChildren(host); document.body.style.cssText='margin:0;color:#1c1f27'; })()`);
        await b.eval('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
        const box = await b.eval(`(() => { const r=document.querySelector('button').getBoundingClientRect(); return {x:r.x,y:r.y,width:Math.ceil(r.width),height:Math.ceil(r.height),scale:1}; })()`);
        const shot = Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', clip: box, captureBeyondViewport: true })).data, 'base64');
        if (shot.equals(render)) same++;
      } finally { await b.close(); }
    }
    t.diagnostic(`${same}/3 PNGs byte-identical; ordinary CSS variables, no napkin runtime`);
    assert.equal(same, 3);
    if (process.env.EVIDENCE) writeFileSync(join(ROOT, 'docs/evidence/TOK-02.txt'), `Re-run: EVIDENCE=1 node --test test/tokens/consumer.test.js\n${same}/3 PNGs byte-identical (0 differing pixels), actual examples/consumer-app build with imported token CSS and bound Button.\nNo napkin runtime import in component or app.\n`);
  } finally { await server.stop(); await new Promise(r => staticServer.close(r)); }
});
