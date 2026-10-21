// INS-04: `node src/docs.js --dir <components> --out <dir>` writes a static, read-only-on-the-source catalog: sidebar, a playground,
// props with JSDoc descriptions, the rendered variant matrix (big ones folded by group) and a usage line for every cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempRepo, startServer, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';
import { readComponent } from '../../src/tsx/read.js';
import { variantGrid } from '../../src/model.js';
import { usageFor } from '../../src/usage.js';
import { jsdoc } from '../../src/docs.js';

// every path under a folder with its content hash: a change, an added file or a removed one all show
const tree = (d) => { const out = []; (function walk(p) { for (const n of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = join(p, n.name); if (n.isDirectory()) walk(f); else out.push(`${f.slice(d.length)} ${createHash('sha1').update(readFileSync(f)).digest('hex')} ${statSync(f).mtimeMs}`); } })(d); return createHash('sha1').update(out.join('\n')).digest('hex') + ' ' + out.length; };

test('jsdoc: the component description and per-prop descriptions are read from the comments', () => {
  const src = `export interface XProps {\n  /** The words\n   * on the button. */\n  label?: string;\n  size?: 'a' | 'b';\n}\n\n/**\n * A thing that pays.\n * Second line.\n */\nexport function X() {}\n`;
  assert.deepEqual(jsdoc(src, 'X'), { description: 'A thing that pays. Second line.', props: { label: 'The words on the button.' } });
  assert.deepEqual(jsdoc('export function Y() {}', 'Y'), { description: '', props: {} });
});

test('INS-04: napkin docs writes a read-only, self-contained catalog with a playground and a usage line per cell', { timeout: 150000 }, async () => {
  const { compDir, fileOf } = tempRepo(['Button', 'Card', 'Chip']);
  // a description in the file's JSDoc, for Button only
  writeFileSync(fileOf('Button'), readFileSync(fileOf('Button'), 'utf8').replace('  label?: string;', '  /** What the button says. */\n  label?: string;').replace('export function Button', '/** Pays for the order. Use it once per screen. */\nexport function Button'));
  const server = await startServer(compDir); // a live server holds the folder's lock and has written its sidecars
  const out = mkdtempSync(join(tmpdir(), 'napkin-docs-'));
  try {
    const before = tree(compDir);
    const log = execFileSync(process.execPath, [join(ROOT, 'src', 'docs.js'), '--dir', compDir, '--out', out], { encoding: 'utf8' });
    assert.match(log, /Button \(6\), Card \(1\), Chip \(64\)/);
    assert.equal(tree(compDir), before, 'the components folder is byte for byte, file for file, the same after docs (no sidecars, no lock)');
  } finally { await server.stop(); }
  // and on a folder nobody has opened: still nothing written, no sidecar made
  const fresh = tempRepo(['Button']);
  const out2 = mkdtempSync(join(tmpdir(), 'napkin-docs-'));
  const b4 = tree(fresh.compDir);
  execFileSync(process.execPath, [join(ROOT, 'src', 'docs.js'), '--dir', fresh.compDir, '--out', out2]);
  assert.equal(tree(fresh.compDir), b4); assert.equal(readdirSync(fresh.compDir).filter((n) => n.includes('napkin')).length, 0, 'no .napkin.json, no .napkin/');

  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /https?:\/\//, 'nothing from the network');
  assert.match(html, /<nav aria-label="Components">/); assert.match(html, /\.comp-head \{ position: sticky/);
  assert.match(html, /Pays for the order\. Use it once per screen\./); assert.match(html, /What the button says\./);
  assert.match(html, /No description yet\. Add one in a JSDoc comment/, 'Card has none: the hint says how to add it');
  assert.match(html, /code\.line \{ width: 100%; \}/); assert.match(html, /white-space: pre; overflow-x: auto/, 'usage lines scroll, they do not wrap');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  for (const name of ['Button', 'Card', 'Chip']) {
    const doc = readComponent(readFileSync(fileOf(name), 'utf8')).doc;
    const cells = variantGrid(doc);
    const imgs = readdirSync(join(out, 'img', name)).filter((f) => f.endsWith('.png'));
    assert.equal(imgs.length, cells.length, `${name}: one image per cell`);
    for (const v of cells) assert.ok(html.includes(esc(usageFor(doc, v))), `${name}: a usage line for ${JSON.stringify(v)}`);
    for (const p of doc.props) assert.match(html, new RegExp(`<td><code>${p.name}</code>`), `${name}: props row ${p.name}`);
    assert.ok(existsSync(join(out, 'js', `${name}.js`)), `${name}: its own bundle for the playground`);
  }
  // Chip's 64 cells are folded by group: only the first of the groups is open
  const chip = html.slice(html.indexOf('id="Chip"'), html.indexOf('</section>', html.indexOf('id="Chip"')));
  const groups = chip.match(/<details class="group"[^>]*>/g);
  assert.ok(groups.length >= 4 && groups.filter((g) => g.includes(' open')).length === 1, `${groups.length} groups, one open`);
  assert.ok(existsSync(join(out, 'fonts', 'inter-latin-wght-normal.woff2')));
  const cat = JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8'));
  assert.equal(cat.find((c) => c.name === 'Button').description, 'Pays for the order. Use it once per screen.');

  // the playground runs in the page from file://: changing a control changes the live component and its usage line
  const browser = await launchChromium({ width: 1440, height: 900 });
  try {
    await browser.goto(`file://${join(out, 'index.html')}#Button`);
    await browser.waitFor(`!!document.querySelector('#Button .mount button')`);
    const w0 = await browser.eval(`document.querySelector('#Button .mount button').getBoundingClientRect().width`);
    assert.equal(await browser.eval(`document.querySelector('#Button .use').textContent`), '<Button label="Button" />');
    await browser.eval(`(() => { const s = document.querySelector('#Button select[data-prop="size"]'); s.value = 'lg'; s.dispatchEvent(new Event('input', { bubbles: true })); const t = document.querySelector('#Button input[data-prop="label"]'); t.value = 'Pay now'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.equal(await browser.eval(`document.querySelector('#Button .use').textContent`), '<Button size="lg" label="Pay now" />');
    assert.equal(await browser.eval(`document.querySelector('#Button .mount button').textContent`), 'Pay now');
    assert.ok(await browser.eval(`document.querySelector('#Button .mount button').getBoundingClientRect().width`) > w0, 'the lg size is wider');
    assert.equal(await browser.eval(`getComputedStyle(document.querySelector('#Button .comp-head')).position`), 'sticky');
    assert.deepEqual(browser.consoleLines.filter((l) => /error|exception/i.test(l)), []);
    if (process.env.DOCS_SHOT) { writeFileSync(process.env.DOCS_SHOT, await browser.screenshot()); }
  } finally { await browser.close(); }
  if (process.env.DOCS_OUT) execFileSync('cp', ['-r', out + '/.', process.env.DOCS_OUT]);
});
