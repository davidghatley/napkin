// INV-05 (agents lane): component .tsx files are written, created, moved and removed only from src/commit.js,
// and every one of those commits is recorded with who made it. A runtime spy on fs plus a static scan of src/.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync, readdirSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspace } from '../../src/workspace.js';
import { createApi } from '../../src/api.js';
import { ROOT, fixture, sleep } from '../helpers/harness.js';

const WRITERS = ['writeFileSync', 'writeFile', 'renameSync', 'rename', 'unlinkSync', 'unlink', 'rmSync', 'copyFileSync', 'appendFileSync', 'truncateSync', 'linkSync', 'symlinkSync'];

const SYNC = WRITERS.filter((w) => w.endsWith('Sync'));

test('static: only src/commit.js writes component files; other fs writers in src/ are listed and justified', () => {
  const ALLOWED = {
    'commit.js': 'the commit path',
    'codecs.js': 'sidecar .napkin.json only',
    'lock.js': '.napkin/lock files only',
    'render-png.js': "its own Chromium profile in the OS temp dir",
    'server.js': 'seeds a throwaway temp folder from fixtures before the workspace opens',
  };
  const found = {};
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) { const t = readFileSync(p, 'utf8'); if (/fs\/promises/.test(t) || SYNC.some((w) => new RegExp(`\\b${w}\\b`).test(t.replace(/\/\/.*$/gm, '')))) found[p.slice(join(ROOT, 'src').length + 1)] = true; } } };
  walk(join(ROOT, 'src'));
  for (const f of Object.keys(found)) assert.ok(ALLOWED[f], `src/${f} writes with fs but is not on the allow-list; route it through src/commit.js`);
  assert.ok(found['commit.js']);
});

test('runtime: every .tsx write, create, move and remove made by edits, create, rename, delete and accepted proposals comes from src/commit.js', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-onepath-'));
  for (const n of ['Card', 'Button']) copyFileSync(fixture(n), join(dir, `${n}.tsx`));
  const calls = [];
  const restore = [];
  for (const name of WRITERS) {
    if (typeof fs[name] !== 'function') continue;
    const original = fs[name];
    const m = mock.method(fs, name, function (...args) {
      const target = String(args[0]), also = typeof args[1] === 'string' ? args[1] : '';
      if (/\.tsx/.test(target) || /\.tsx/.test(also)) calls.push({ name, target, from: (new Error().stack.split('\n').slice(2).find((l) => l.includes(`${ROOT}/src/`)) || '').trim() });
      return original.apply(this, args);
    });
    restore.push(m);
  }
  syncBuiltinESMExports();
  const ws = await openWorkspace(dir);
  const api = createApi(ws, { dir });
  const frames = [];
  for (const ev of ['change', 'added', 'removed']) ws.events.on(ev, (f) => frames.push({ ev, ...f }));
  try {
    const tok = (await api.session('david')).json.token;
    const call = (method, path, body) => api.handle({ method, path, body: JSON.stringify(body ?? {}), token: tok });
    const rev = (await call('GET', '/api/components/Card')).json.revision;
    const first = await call('POST', '/api/components/Card/edits', { baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 700 }] });
    assert.equal(first.status, 200, JSON.stringify(first.json) + ' rev=' + rev + ' entries=' + ws.entries().length);
    assert.equal((await call('POST', '/api/components', { name: 'Badge' })).status, 201);
    assert.equal((await call('POST', '/api/components/Badge/rename', { name: 'Chip' })).status, 200);
    const p = (await call('POST', '/api/components/Card/edits', { baseRevision: rev + 1, edits: [{ op: 'set', path: 'title.color', value: 'red' }], propose: true })).json.proposal;
    assert.equal((await call('POST', `/api/proposals/${p.id}/accept`, {})).status, 200);
    assert.equal((await call('DELETE', '/api/components/Chip')).status, 200);
    await sleep(300);
    assert.ok(calls.length >= 8, `spy saw ${calls.length} .tsx fs calls`);
    const kinds = new Set(calls.map((c) => c.name));
    for (const k of ['writeFileSync', 'renameSync', 'unlinkSync']) assert.ok(kinds.has(k), `saw ${k}`);
    for (const c of calls) assert.match(c.from, /src\/commit\.js/, `${c.name} ${c.target} came from ${c.from || 'outside src/'}`);
    // every one of them was recorded: a frame with who and a summary
    const done = frames.filter((f) => f.by && f.by !== 'file');
    for (const ev of [['change', /title\.fontWeight = 700/], ['added', /created Badge/], ['added', /renamed Badge to Chip/], ['change', /title\.color = "red"/], ['removed', /deleted Chip/]]) {
      assert.ok(done.some((f) => f.ev === ev[0] && ev[1].test(f.summary) && f.by), `a ${ev[0]} frame says ${ev[1]} with by`);
    }
    // a commit without a name is refused everywhere
    await assert.rejects(ws.create('Nameless'), /caller name is required/);
    await assert.rejects(ws.rename('Card', 'Cardy'), /caller name is required/);
    await assert.rejects(ws.delete('Button'), /caller name is required/);
    const store = ws.find('Card').store, r0 = (await store.read()).revision;
    for (const by of [undefined, '', 'unknown']) {
      const r = await store.apply({ baseRevision: r0, edits: [{ op: 'set', path: 'title.color', value: 'blue' }], by });
      assert.equal(r.ok, false); assert.match(r.error, /real caller/);
    }
    assert.equal((await store.read()).revision, r0);
    assert.equal(done.filter((f) => f.by === 'david').length >= 4, true);
    assert.ok(frames.every((f) => f.ev === 'change' ? f.by : true), 'every change has by');
    // the workspace activity log has each action with its author
    const act = (await call('GET', '/api/activity')).json.activity;
    assert.ok(act.every((a) => a.by && a.summary), JSON.stringify(act));
    assert.ok(act.some((a) => a.kind === 'removed' && a.name === 'Chip' && a.by === 'david' && a.summary === 'deleted Chip'));
    assert.ok(!existsSync(join(dir, 'Chip.tsx')) && !existsSync(join(dir, 'Chip.napkin.json')));
  } finally { for (const m of restore) m.mock.restore(); syncBuiltinESMExports(); await api.close(); await ws.close(); }
});
