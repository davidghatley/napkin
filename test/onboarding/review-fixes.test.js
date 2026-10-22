import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, fixture } from '../helpers/harness.js';
import { cli } from '../helpers/open.js';
import { openWorkspace } from '../../src/workspace.js';
import { writeAtomic } from '../../src/atomic.js';
import { ACTIONS } from '../../public/canvas/actions.js';

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const commitFixture = dir => {
  git(dir, 'init', '-q'); git(dir, 'add', '.');
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Test fixture');
};

test('WPC-06: copied repository and two clones have identical ids; existing sidecar ids win', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'napkin-portable-')), repo = join(parent, 'original');
  mkdirSync(join(repo, 'components/a'), { recursive: true }); mkdirSync(join(repo, 'components/b'));
  const source = readFileSync(fixture('Button'), 'utf8');
  for (const file of ['Button.tsx', 'a/Button.tsx', 'b/Button.tsx']) writeFileSync(join(repo, 'components', file), source);
  writeFileSync(join(repo, 'components/Button.napkin.json'), JSON.stringify({ id: 'cmp_existing_legacy_id', canvas: { x: 10, y: 20 } }));
  writeFileSync(join(repo, 'napkin.json'), '{"components":"components"}\n');
  try {
    commitFixture(repo);
    const copy = join(parent, 'moved-repository'), clones = ['clone-one', 'clone-two'].map(n => join(parent, n));
    cpSync(repo, copy, { recursive: true });
    for (const clone of clones) git(parent, 'clone', '--quiet', '--local', '--no-hardlinks', repo, clone);
    let expected;
    for (const dir of [repo, copy, ...clones]) {
      const ws = await openWorkspace(join(dir, 'components'), { recursive: true, writeSidecars: false, progressive: true }); await ws.ready;
      try {
        const ids = Object.fromEntries((await ws.summary()).map(c => [c.path, c.id]));
        assert.equal(Object.keys(ids).length, 3, 'duplicate names in different folders stay distinct');
        assert.equal(new Set(Object.values(ids)).size, 3);
        assert.equal(ids['Button.tsx'], 'cmp_existing_legacy_id');
        expected ??= ids; assert.deepEqual(ids, expected);
        assert.deepEqual(JSON.parse(readFileSync(join(dir, 'components/Button.napkin.json'))), { id: 'cmp_existing_legacy_id', canvas: { x: 10, y: 20 } });
        assert.equal(git(dir, 'status', '--short', '-uall'), '');
      } finally { await ws.close(); }
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('WPC-06: init + open stays git-clean while running and stopped; root ignore is untouched', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'napkin-clean-open-')), dir = join(parent, 'project');
  let server;
  try {
    execFileSync(process.execPath, [join(ROOT, 'src/cli.js'), 'init', dir]);
    const ignore = '# A user-owned ignore file\n*.log\n'; writeFileSync(join(dir, '.gitignore'), ignore);
    commitFixture(dir);
    const status = () => git(dir, 'status', '--short', '-uall');
    assert.equal(status(), '');
    server = await cli(dir, [], { NODE_OPTIONS: '' });
    assert.equal(existsSync(join(dir, 'components/.napkin/lock')), true);
    assert.equal(readFileSync(join(dir, 'components/.napkin/.gitignore'), 'utf8'), '*\n');
    assert.equal(status(), '', 'the live lock and its ignore file are invisible to git');
    await server.stop(); server = null;
    assert.equal(existsSync(join(dir, 'components/.napkin/lock')), false);
    assert.equal(status(), '');
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), ignore);
    // The other private-folder creator (guarded edits, including nested folders)
    // must ignore itself too, without relying on a server lock in that folder.
    mkdirSync(join(dir, 'components/nested'));
    const file = join(dir, 'components/nested/text.txt'); writeFileSync(file, 'before');
    writeAtomic(file, 'after', { guard: 'before' });
    assert.equal(readFileSync(join(dir, 'components/nested/.napkin/.gitignore'), 'utf8'), '*\n');
    assert.equal(status(), '?? components/nested/text.txt\n');
  } finally { if (server) await server.stop(); rmSync(parent, { recursive: true, force: true }); }
});

test('WPC-05: CLI help and recovery hints use the documented checkout command', () => {
  const parent = mkdtempSync(join(tmpdir(), 'napkin-hints-')), dir = join(parent, 'project');
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'src/cli.js'), ...args], { encoding: 'utf8' });
  try {
    const help = run('--help'); assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: node src\/cli\.js init/); assert.doesNotMatch(help.stdout, /npx/);
    const init = run('init', dir); assert.equal(init.status, 0);
    assert.match(init.stdout, /Next: run node src\/cli\.js open/);
    for (const [args, command] of [[['init', dir], 'open'], [['open', join(parent, 'missing')], 'init'], [['unknown'], '--help']]) {
      const result = run(...args); assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(`node src/cli.js ${command}`), result.stderr);
    }
    for (const name of ['cli.js', 'api.js', 'mcp.js', 'server.js']) {
      const source = readFileSync(join(ROOT, 'src', name), 'utf8');
      assert.doesNotMatch(source, /\bnapkin (?:open|init|--help)\b|npx napkin/, name);
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('WPC-05: README scan list and guide control labels match public UI', () => {
  const read = file => readFileSync(join(ROOT, file), 'utf8');
  const readme = read('README.md'), start = read('docs/guide/start-a-component.md'), variants = read('docs/guide/change-every-version.md');
  const scan = read('src/scan.js').match(/const SKIP = new Set\(\[([^\]]+)\]/)[1];
  for (const [, name] of scan.matchAll(/'([^']+)'/g)) assert.ok(readme.includes('`' + name + '`'), name);
  const openSection = readme.split('## Open an existing repository')[1].split('\n## ')[0];
  assert.equal((openSection.match(/^- /gm) || []).length, 5, 'repository scanning rules are a short list');
  const theme = read('public/canvas/tokens.js').match(/text: '(Component theme)'/)[1];
  assert.ok(readme.includes(`**${theme}**`)); assert.ok(variants.includes(`Use ${theme} in the top bar`));
  assert.equal(ACTIONS.find(a => a.id === 'token-mode').key, `Top bar: ${theme}`);
  const panel = read('public/canvas/panel.js');
  for (const label of ['Layout', 'Size', 'Appearance', 'Fill', 'Stroke', 'Shadow', 'Text', 'Image', 'Advanced: all CSS', 'Settings', 'Variants', 'Composition', 'Make setting', 'Source', 'Alt text', 'Mixed']) {
    assert.ok(start.includes(label), `guide: ${label}`); assert.ok(panel.includes(label), `UI: ${label}`);
  }
  // Audit the remaining named controls in README and the guide against the UI sources.
  for (const [doc, ui, labels] of [
    ['README.md', 'public/canvas/panel.js', ['Radius', 'Base', 'This variant']],
    ['README.md', 'public/canvas/inspect.js', ['Copy usage', 'Inspect']],
    ['docs/guide/edit-together.md', 'public/canvas/history.js', ['History', 'Restore this']],
    ['docs/guide/start-a-component.md', 'public/canvas/layers.js', ['Duplicate', 'Delete']],
    ['docs/guide/start-a-component.md', 'public/canvas/tools.js', ['New component']],
    ['docs/guide/change-every-version.md', 'public/canvas/panel.js', ['Reset to base', 'Base', 'This variant']],
  ]) for (const label of labels) { assert.ok(read(doc).includes(label), `${doc}: ${label}`); assert.ok(read(ui).includes(label), `${ui}: ${label}`); }
  assert.doesNotMatch(start, /Advanced CSS|Use Content/);
});
