// napkin only ever reads a repository it opens: a full cycle (open, the Changes tab, an edit, the film strip) leaves .git/index
// exactly as it was (no refresh of its stat data), and a commit that touched a stylesheet of a component is a frame of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from '../helpers/open.js';
import { launchChromium } from '../helpers/cdp.js';
import { input } from '../helpers/input.js';
import { sleep } from '../helpers/harness.js';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-gitro-'));
  writeFileSync(join(dir, 'card.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="card.css"></head><body><div class="card"><h2>Hi</h2></div></body></html>\n');
  writeFileSync(join(dir, 'card.css'), '.card { padding: 12px; }\n');
  const sh = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', ...a], { stdio: 'ignore' });
  sh('init', '-q'); sh('add', '.'); sh('commit', '-q', '-m', 'start');
  writeFileSync(join(dir, 'card.css'), '.card { padding: 16px; }\n'); sh('commit', '-q', '-am', 'roomier card');
  // the files' stat data no longer matches the index: a plain `git status` would rewrite the index to refresh it
  const old = new Date(Date.now() - 3600_000);
  for (const f of ['card.html', 'card.css']) utimesSync(join(dir, f), old, old);
  return { dir, sh };
}
const idx = (dir) => { const p = join(dir, '.git', 'index'); return { mtime: statSync(p).mtimeMs, bytes: readFileSync(p).toString('hex') }; };

test('git: a full open, Changes tab, edit and film strip cycle leaves .git/index untouched', { timeout: 120000 }, async () => {
  const control = repo();
  const c0 = idx(control.dir);
  await sleep(30);
  execFileSync('git', ['-C', control.dir, 'status', '--porcelain'], { stdio: 'ignore' });
  assert.notDeepEqual(idx(control.dir), c0, 'control: a plain git status does refresh the index (so this test can tell)');

  const { dir } = repo();
  const before = idx(dir);
  await sleep(30);
  const s = await cli(dir);
  const browser = await launchChromium({ width: 1440, height: 900 });
  const io = input(browser);
  try {
    await browser.goto(s.url);
    await browser.waitFor('document.body.dataset.ready === "1"', 15000);
    await browser.waitFor(`!!document.querySelector('.doc-frame')`, 15000);
    await browser.eval(`napkin.drawer.open('changes')`);
    await sleep(600);
    await browser.eval(`(async () => { const t = await (await fetch('/api/component/card.html')).json(); const f = (l) => { for (const n of l) { if (n.tag === 'h2') return n.node; const x = f(n.children); if (x) return x; } }; await napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: 'card.html', baseRevision: t.revision, edits: [{ op: 'text', node: f(t.tree), value: 'Hello' }] }) }); napkin.select({ component: 'card.html', node: f(t.tree), variant: {} }); })()`);
    await sleep(400);
    await io.key('h');
    await browser.waitFor(`document.querySelectorAll('#time .tm-tile').length >= 3`);
    // the commit that only changed the stylesheet is a frame of the component
    assert.match(await browser.eval(`[...document.querySelectorAll('#time .tm-tile')].map((n) => n.getAttribute('aria-label')).join(' | ')`), /roomier card|padding 12px → 16px/);
    await io.key('ArrowLeft'); await io.key('ArrowLeft'); await sleep(500);
    await io.key('Escape');
    await sleep(400);
  } finally { await browser.close(); await s.stop(); }
  assert.deepEqual(idx(dir), before, '.git/index: same bytes and same mtime');
});
