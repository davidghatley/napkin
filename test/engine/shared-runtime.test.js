// PRF-01, PRF-07: the canvas page loads one copy of React for every component bundle (an import map + GET /runtime.js).
// Renderers that draw outside the page (render_component, visual diff) still get standalone bundles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { openWorkspace } from '../../src/workspace.js';
import { IMPORT_MAP, createBundler } from '../../src/bundle.js';

test('canvas bundles leave React out; standalone bundles keep it; the page import map matches', async () => {
  const { compDir } = tempRepo(['Card', 'Button']);
  const ws = await openWorkspace(compDir);
  try {
    const e = ws.find('Card');
    const shared = await ws.bundle(e), alone = await ws.bundleStandalone(e);
    assert.ok(shared.ok && alone.ok);
    assert.match(shared.code, /from "react"/);
    assert.match(shared.code, /from "react-dom\/client"/);
    assert.ok(shared.code.length < 40_000, `shared bundle is ${shared.code.length} bytes`);
    assert.ok(alone.code.length > 100_000 && !/from "react"/.test(alone.code), 'standalone carries its own React');
    const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
    const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]);
    assert.deepEqual(map, IMPORT_MAP);
    const past = await ws.bundleAt(e, (await e.store.read()).revision);
    assert.ok(past.ok && /from "react"/.test(past.code), 'the history preview shares the runtime too');
    assert.ok(!(await createBundler().buildText(e.file, e.name, (await e.store.read()).source)).code.includes('from "react"'), 'buildText stays standalone by default');
  } finally { await ws.close(); }
});

test('the page draws every component from one shared React, and the runtime route answers', async (t) => {
  const { compDir } = tempRepo(['Card', 'Button']);
  const server = await startServer(compDir);
  const b = await launchChromium();
  t.after(async () => { await b.close(); await server.stop(); });
  for (const m of ['', '?module=react-dom', '?module=react-dom/client', '?module=react/jsx-runtime']) {
    const r = await fetch(new URL(`runtime.js${m}`, server.url));
    assert.equal(r.status, 200, m); assert.match(r.headers.get('content-type'), /javascript/);
  }
  assert.equal((await fetch(new URL('runtime.js?module=left-pad', server.url))).status, 404);
  await b.goto(server.url);
  await b.waitFor('document.body.dataset.ready === "1" && document.querySelectorAll(".cell .mount > *").length === 7');
  const loads = await b.eval(`performance.getEntriesByType('resource').filter(e => e.name.includes('/runtime.js')).length`);
  assert.ok(loads <= 4, `React loaded ${loads} times`);
  const errors = await b.eval(`document.querySelectorAll('.build-error, .mount .error').length`);
  assert.equal(errors, 0);
});
