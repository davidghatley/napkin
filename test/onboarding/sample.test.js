import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, waitFor } from '../helpers/harness.js';
import { cli, hashes } from '../helpers/open.js';
import { http, session } from '../helpers/agents.js';
import { readComponent } from '../../src/tsx/read.js';
import { usageWithImport } from '../../src/usage.js';
import { launchChromium } from '../helpers/cdp.js';

test('WPC-18/06: documented sample opens 40 editable components; only a changed setting creates a sidecar', { timeout: 60000 }, async () => {
  const parent = mkdtempSync(join(tmpdir(), 'napkin-sample-')), dir = join(parent, 'sample-40');
  let server, browser;
  try {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const command = readme.match(/^node tools\/sample-repo.js \.\/sample-40$/m)?.[0];
    assert.ok(command, 'README documents the tested sample command');
    execFileSync(process.execPath, [join(ROOT, command.split(' ')[1]), dir]);
    assert.ok(existsSync(join(dir, '.git')));
    const files = readdirSync(join(dir, 'components')).filter(f => f.endsWith('.tsx'));
    assert.equal(files.length, 40);
    for (const name of ['Badge', 'Button', 'Card', 'Chip']) assert.ok(files.includes(`${name}.tsx`));
    for (const file of files) assert.doesNotThrow(() => readComponent(readFileSync(join(dir, 'components', file), 'utf8')), file);
    assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'tools/sample-repo.js'), dir], { stdio: 'pipe' }), /Destination must be empty/);
    const status = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' });
    // Configured projects keep the existing, ignored live writer lock. It is
    // removed on shutdown; it is not a component sidecar.
    const snapshot = () => Object.fromEntries(Object.entries(hashes(dir)).filter(([f]) => f !== 'components/.napkin/lock'));
    const before = snapshot(), gitBefore = status();
    server = await cli(dir, [], { NODE_OPTIONS: '' });
    await waitFor(async () => (await http(server.url, '/api/components')).json.length === 40, 15000);
    const list = (await http(server.url, '/api/components')).json;
    assert.equal(list.filter(c => !c.readOnly).length, 40);
    browser = await launchChromium(); await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1" && document.querySelectorAll("section.cmp").length === 40');
    assert.equal(await browser.eval('document.querySelectorAll("section.cmp .badge:not([hidden])").length'), 0);
    assert.deepEqual(snapshot(), before, 'open and render leave repository bytes unchanged apart from the live lock');
    assert.equal(status(), gitBefore, 'open adds no untracked paths');
    const token = await session(server.url, 'you');
    const original = (await http(server.url, '/api/components/Badge')).json;
    assert.equal((await http(server.url, '/api/components/Badge/canvas', { method: 'POST', token, body: { x: 120, y: 80 } })).status, 200);
    assert.deepEqual(readdirSync(join(dir, 'components')).filter(f => f.endsWith('.napkin.json')), ['Badge.napkin.json']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'components/Badge.napkin.json'))).id, original.component);
    assert.equal((await http(server.url, '/api/components/Card/preview', { method: 'POST', token, body: { variant: {}, width: 320 } })).status, 200);
    assert.deepEqual(readdirSync(join(dir, 'components')).filter(f => f.endsWith('.napkin.json')), ['Badge.napkin.json', 'Card.napkin.json']);
    for (const [file, hash] of Object.entries(before)) assert.equal(hashes(dir)[file], hash, file);
    await browser.close(); browser = null; await server.stop(); server = await cli(dir, [], { NODE_OPTIONS: '' });
    await waitFor(async () => (await http(server.url, '/api/components')).json.length === 40, 15000);
    const reopened = (await http(server.url, '/api/components/Badge')).json;
    assert.equal(reopened.component, original.component);
    assert.deepEqual(reopened.canvas, { x: 120, y: 80 });
    browser = await launchChromium(); await browser.goto(server.url);
    await browser.waitFor('document.body.dataset.ready === "1"');
    assert.equal(await browser.eval('napkin.find("Card").preview["{}"]'), 320, 'saved preview is restored through SSE');
  } finally { if (browser) await browser.close(); if (server) await server.stop(); rmSync(parent, { recursive: true, force: true }); }
});

test('WPC-10: Copy usage includes an import for a nested component', () => {
  const { doc } = readComponent(readFileSync(join(ROOT, 'fixtures/Button/Button.tsx'), 'utf8'));
  assert.match(usageWithImport(doc, { size: 'sm' }, 'ui/Button.tsx'), /^import \{ Button \} from "\.\/ui\/Button";\n\n<Button size="sm"/);
});
