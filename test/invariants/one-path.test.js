// INV-05: one commit path. A preload (test/helpers/fs-spy.mjs) records every write to a component .tsx made by a real
// server while the HTTP API, the MCP tools and a new-component request are used. Each write must come from
// store.apply (applyNow in src/store.js) or, for a brand-new file, createComponentFile in src/store.js (exclusive create,
// never replaces; workspace.create calls it). Anything else is "outside". The spy is shown to catch a rogue writer.
// A static check also keeps raw file-writing calls out of src/ except in src/atomic.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, tempRepo, startServer, startMcp, sleep } from '../helpers/harness.js';
import { session } from '../helpers/agents.js';

const SPY = join(ROOT, 'test', 'helpers', 'fs-spy.mjs');
const readLog = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// The only writer is src/commit.js: writeComponent (called from store.apply) and createComponent (a new file, exclusive).
const classify = (e) => (/at writeComponent \(file:\/\/.*\/src\/commit\.js/.test(e.stack) && /at (?:applyNow|applyOnce) \(file:\/\/.*\/src\/store\.js/.test(e.stack) ? 'apply' : /at createComponent \(file:\/\/.*\/src\/commit\.js/.test(e.stack) ? 'create' : 'outside');

test('INV-05: .tsx writes by a running server come only from store.apply (and createComponentFile for a new file)', async () => {
  const { compDir, fileOf } = tempRepo(['Card', 'Button']);
  const logFile = join(mkdtempSync(join(tmpdir(), 'napkin-spy-')), 'writes.jsonl');
  const server = await startServer(compDir, { execArgv: ['--import', SPY], env: { NAPKIN_SPY_LOG: logFile } });
  const mcp = await startMcp(server.url);
  const token = await session(server.url, 'david');
  const api = async (path, init = {}) => (await fetch(new URL(path, server.url), { ...init, headers: { ...(init.body && { 'content-type': 'application/json' }), authorization: `Bearer ${token}` } })).json();
  try {
    const rev = async (c) => (await api(`api/components/${c}`)).revision;
    // HTTP, three edits to different files and properties
    let ok = 0;
    for (const [c, edit] of [['Card', { op: 'set', path: 'title.fontSize', value: '30px' }], ['Button', { op: 'set', path: 'root.gap', value: 3 }], ['Card', { op: 'set', path: 'body.text', value: 'Hello' }]]) {
      const r = await api(`api/components/${c}/edits`, { method: 'POST', body: JSON.stringify({ baseRevision: await rev(c), edits: [edit], by: 'canvas' }) });
      assert.equal(r.ok, true, r.error); ok++;
    }
    // MCP
    assert.equal((await mcp.call('apply_edits', { component: 'Button', baseRevision: await rev('Button'), edits: [{ op: 'set', path: 'label.fontWeight', value: 700 }] })).isError, false); ok++;
    assert.equal((await mcp.call('add_variant', { component: 'Button', baseRevision: await rev('Button'), axis: 'size', value: 'xl', overrides: { root: { padding: '14px 28px' } } })).isError, false); ok++;
    // things that must not write a component file at all
    const before = readFileSync(fileOf('Card'), 'utf8');
    const dry = await mcp.call('apply_edits', { component: 'Card', baseRevision: await rev('Card'), dryRun: true, edits: [{ op: 'set', path: 'title.color', value: 'red' }] });
    assert.equal(dry.isError, false);
    const moved = await api('api/components/Card/canvas', { method: 'POST', body: JSON.stringify({ x: 50, y: 60 }) });
    assert.equal(moved.ok, true);
    const bad = await api('api/components/Card/edits', { method: 'POST', body: JSON.stringify({ baseRevision: 'nope', edits: [{ op: 'set', path: 'title.color', value: 'red' }] }) });
    assert.equal(bad.ok, false);
    // a new component
    const made = await api('api/components', { method: 'POST', body: JSON.stringify({ name: 'Badge' }) });
    assert.equal(made.ok, true, made.error);
    // an outside (hand) edit, made by this test process, not by the server
    const logged = readLog(logFile).length;
    writeFileSync(fileOf('Card'), readFileSync(fileOf('Card'), 'utf8').replace("title = 'From napkin to component'", "title = 'By hand'"));
    await sleep(700);
    assert.equal(readLog(logFile).length, logged, 'absorbing a hand edit writes no component file');

    const entries = readLog(logFile);
    const kinds = entries.map(classify);
    const count = (k) => kinds.filter((x) => x === k).length;
    console.log(`INV-05: ${entries.length} component writes recorded: ${count('apply')} from store.apply, ${count('create')} from createComponentFile, ${count('outside')} outside`);
    assert.equal(count('outside'), 0, JSON.stringify(entries.filter((e) => classify(e) === 'outside')));
    assert.equal(count('apply'), ok, 'one write per applied batch');
    assert.equal(count('create'), 1);
    assert.deepEqual(entries.filter((e) => classify(e) === 'create').map((e) => e.fn), ['linkSync'], 'a create is exclusive (link fails if the file exists)');
    assert.ok(entries.filter((e) => classify(e) === 'apply').every((e) => e.fn === 'renameSync'), 'an apply replaces the file by rename');
    assert.equal(readFileSync(fileOf('Card'), 'utf8').includes("title = 'By hand'"), true);
    assert.notEqual(before, undefined);
  } finally { mcp.stop(); await server.stop(); }
});

test('INV-05: the spy is not blind: a rogue writer is classified "outside"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-rogue-'));
  const logFile = join(dir, 'w.jsonl');
  const script = join(dir, 'rogue.mjs');
  writeFileSync(script, `import fs from 'node:fs'; import { appendFileSync } from 'node:fs';
function sneaky() { fs.writeFileSync(${JSON.stringify(join(dir, 'A.tsx'))}, 'x'); }
sneaky();
appendFileSync(${JSON.stringify(join(dir, 'B.tsx'))}, 'y');
const fd = fs.openSync(${JSON.stringify(join(dir, 'C.tsx'))}, 'w'); fs.closeSync(fd);
fs.renameSync(${JSON.stringify(join(dir, 'C.tsx'))}, ${JSON.stringify(join(dir, 'D.tsx'))});
const fd2 = fs.openSync(${JSON.stringify(join(dir, 'D.tsx'))}, 'r+'); fs.writeSync(fd2, 'q'); fs.closeSync(fd2);
fs.unlinkSync(${JSON.stringify(join(dir, 'B.tsx'))});
fs.rmSync(${JSON.stringify(join(dir, 'A.tsx'))});
await fs.promises.writeFile(${JSON.stringify(join(dir, 'E.tsx'))}, 'z');
`);
  execFileSync(process.execPath, ['--import', SPY, script], { env: { ...process.env, NAPKIN_SPY_LOG: logFile } });
  const entries = readLog(logFile);
  for (const fn of ['writeFileSync', 'appendFileSync', 'openSync', 'renameSync', 'promises.writeFile', 'writeSync', 'unlinkSync', 'rmSync']) assert.ok(entries.some((e) => e.fn === fn), `the spy saw ${fn}`);
  assert.equal(new Set(entries.map((e) => e.path.split('/').pop())).size, 5, 'A.tsx B.tsx C.tsx D.tsx E.tsx');
  assert.ok(entries.every((e) => classify(e) === 'outside'));
  assert.ok(entries.every((e) => classify(e) === 'outside'));
});

test('INV-05: static check: only src/atomic.js, src/commit.js and src/lock.js touch files; everything else calls commit.js', () => {
  const WRITERS = /(?<![\w.])(?:(?:fs|promises)\.)?(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|copyFileSync|copyFile|createWriteStream|cpSync|truncateSync|linkSync|symlinkSync|unlinkSync|unlink|rmSync|rm|rmdirSync|writeSync|ftruncateSync)\s*\(/;
  // atomic.js does the writing and commit.js is the only caller for component and sidecar files (it also removes them); lock.js only creates and removes the lock file under .napkin/.
  const ALLOWED = ['src/atomic.js', 'src/commit.js', 'src/lock.js', 'src/render-png.js', 'src/assets.js', 'src/docs.js', 'src/chromium.js']; // render-png only removes its own temporary Chromium profile folder; assets.js saves media files (never a .tsx); docs.js copies fonts into the docs output folder
  const offenders = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js') && !ALLOWED.some((a) => p.endsWith(a))) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (!/async rename\(/.test(l) && WRITERS.test(l.replace(/\/\/.*/, ''))) offenders.push(`${p.slice(ROOT.length + 1)}:${i + 1}: ${l.trim()}`); }); } };
  walk(join(ROOT, 'src'));
  assert.deepEqual(offenders, []);
});
