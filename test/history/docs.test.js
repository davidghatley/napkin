// INS-04: `node src/docs.js --dir <components> --out <dir>` writes a static catalog: props table, rendered variant grid, usage lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempRepo, ROOT } from '../helpers/harness.js';
import { readComponent } from '../../src/tsx/read.js';
import { variantGrid } from '../../src/model.js';
import { usageFor } from '../../src/usage.js';

test('INS-04: napkin docs writes a self-contained catalog with every cell rendered and a usage line for each', { timeout: 120000 }, () => {
  const { compDir, fileOf } = tempRepo(['Button', 'Card', 'Chip']);
  const out = mkdtempSync(join(tmpdir(), 'napkin-docs-'));
  const log = execFileSync(process.execPath, [join(ROOT, 'src', 'docs.js'), '--dir', compDir, '--out', out], { encoding: 'utf8' });
  assert.match(log, /Button \(6\), Card \(1\), Chip \(64\)/);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script/, 'static: no JavaScript');
  assert.doesNotMatch(html, /https?:\/\//, 'nothing from the network');
  for (const name of ['Button', 'Card', 'Chip']) {
    const doc = readComponent(readFileSync(fileOf(name), 'utf8')).doc;
    const cells = variantGrid(doc);
    const imgs = readdirSync(join(out, 'img', name)).filter((f) => f.endsWith('.png'));
    assert.equal(imgs.length, cells.length, `${name}: one image per cell`);
    for (const v of cells) assert.ok(html.includes(usageFor(doc, v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')), `${name}: a usage line for ${JSON.stringify(v)}`);
    for (const p of doc.props) assert.match(html, new RegExp(`<td><code>${p.name}</code></td>`), `${name}: props row ${p.name}`);
    for (const f of imgs) assert.deepEqual(readFileSync(join(out, 'img', name, f)).subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  assert.ok(existsSync(join(out, 'fonts', 'inter-latin-wght-normal.woff2')));
  const cat = JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8'));
  assert.equal(cat.find((c) => c.name === 'Button').cellList[0].usage, '<Button label="Button" />');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'components/Button.tsx', 'components/Card.tsx'], { cwd: join(compDir, '..'), encoding: 'utf8' }), '', 'component files untouched');
  if (process.env.DOCS_OUT) execFileSync('cp', ['-r', out + '/.', process.env.DOCS_OUT]);
});
