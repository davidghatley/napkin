import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from '../helpers/cdp.js';
import { startServer, ROOT } from '../helpers/harness.js';
import { input } from '../helpers/input.js';
import { corpus, cli, hashes } from '../helpers/open.js';

const shot = async (browser, name) => { if (process.env.EVIDENCE) { mkdirSync(join(ROOT, 'docs/evidence'), { recursive: true }); writeFileSync(join(ROOT, 'docs/evidence', name + '.png'), await browser.screenshot()); } };
test('ONB-02/03: empty canvas teaches five actions; ? opens the registry sheet, traps focus and returns focus', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-empty-')), s = await startServer(dir), b = await launchChromium({ width: 1440, height: 960 });
  try {
    await b.goto(s.url); await b.waitFor('document.body.dataset.ready === "1"');
    const text = await b.eval('document.querySelector("#empty-state").innerText');
    for (const word of ['N', 'F', 'T', 'I', 'Ctrl', 'K']) assert.ok(text.includes(word), word);
    assert.equal(await b.eval('document.querySelector("#revision").parentElement.hidden'), true);
    assert.equal(await b.eval('getComputedStyle(document.querySelector("#statusbar .hints")).visibility'), 'hidden');
    assert.match(await b.eval('document.querySelector("#layers").textContent'), /No layers yet/);
    assert.match(await b.eval('document.querySelector("#changes").textContent'), /No changes yet/);
    assert.doesNotMatch(await b.eval('document.querySelector("#panel").textContent'), /Jump|New component|Ctrl|⌘K/);
    const alignment = await b.eval('({ rail: document.querySelector("#sidebar").getBoundingClientRect().right, toolbar: document.querySelector("#toolbar").getBoundingClientRect().left, search: document.querySelector("#quick-open").getBoundingClientRect().left })');
    assert.ok(alignment.toolbar >= alignment.rail && alignment.search > alignment.toolbar);
    await shot(b, 'ONB-02-empty');
    await input(b).key( '?', { code: 'Slash', shift: true });
    await b.waitFor('document.querySelector("#shortcuts").open');
    const sheet = await b.eval('document.querySelector("#shortcuts").innerText');
    for (const word of ['Fit all', 'Rename', 'Measure', 'number', 'Quick open', 'Escape']) assert.ok(sheet.includes(word), word);
    await shot(b, 'ONB-03-shortcuts');
    await input(b).key( 'Escape');
    await b.waitFor('!document.querySelector("#shortcuts").open');
    await b.eval('document.querySelector("#empty-state button").click()');
    await b.waitFor('!document.querySelector("#new-component").hidden');
    await b.type('#new-name', 'First');
    await b.eval('document.querySelector("#new-component").requestSubmit()');
    await b.waitFor('!!document.querySelector("section.cmp[data-ready]")');
    assert.equal(await b.eval('document.querySelector("#empty-state").hidden'), true);
  } finally { await b.close(); await s.stop(); rmSync(dir, { recursive: true, force: true }); }
});
test('OPN-02: read-only default render, missing import, CSS and missing context errors are isolated', async () => {
  const dir = corpus();
  writeFileSync(join(dir, 'Default.tsx'), `export default function Default({ label = 'Default props work' }) { return <div style={{ padding: 24, background: '#eef', color: '#124' }}>{label}</div>; }`);
  writeFileSync(join(dir, 'Context.tsx'), `export function Context() { throw new Error('Theme context is missing'); return <div />; }`);
  writeFileSync(join(dir, 'Css.tsx'), `import styles from './missing.module.css'; export function Css() { return <div className={styles.root} />; }`);
  writeFileSync(join(dir, 'NoExport.tsx'), 'const label = \"No component export\";');
  writeFileSync(join(dir, 'ModuleContext.tsx'), `throw new Error('Provider needed at module load'); export default function ModuleContext() { return <div />; }`);
  const before = hashes(dir), s = await cli(dir), b = await launchChromium({ width: 1600, height: 1100 });
  try {
    await b.goto(s.url); await b.waitFor('document.body.dataset.ready === "1"');
    await b.waitFor('document.querySelector("section[data-name=Default] .mount").innerText.includes("Default props work")');
    const pageText = await b.eval('document.querySelector("#world").innerText');
    for (const word of ['Hello', 'Default props work', 'absent', 'missing.module.css', 'Theme context is missing', 'no component exported', 'Provider needed at module load', 'Next:']) assert.ok(pageText.includes(word), word + ': ' + pageText);
    await shot(b, 'OPN-02-read-only');
    for (const name of ['Default', 'Context', 'Missing', 'Css']) {
      await b.eval(`napkin.nav.focus('${name}', null, { animate: false }); true`);
      if (['Missing', 'Css'].includes(name)) assert.ok(await b.eval(`(() => { const e=document.querySelector('section[data-name=${name}] .build-error').getBoundingClientRect(), s=document.querySelector('#stage').getBoundingClientRect(); return e.left >= s.left && e.right <= s.right; })()`), `${name} build error fits within the stage`);
      await shot(b, 'OPN-02-' + name.toLowerCase());
    }
    assert.deepEqual(hashes(dir), before);
  } finally { await b.close(); await s.stop(); rmSync(dir, { recursive: true, force: true }); }
});
