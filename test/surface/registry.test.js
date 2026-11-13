// The surface's one registry: key spelling, the key map /api/keys serves, arrangement groups and the board routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { normalizeKeys, eventChord } from '../../public/canvas/keynames.js';
import { ACTIONS } from '../../public/canvas/actions.js';
import { keyMap, arrange, createSurfaceRoutes } from '../../src/surface/routes.js';

test('keys are spelled one way: modifiers Ctrl, Alt, Shift, Meta, then the key; sequences by spaces', () => {
  assert.equal(normalizeKeys('alt+y'), 'Alt+Y');
  assert.equal(normalizeKeys('shift+ctrl+k'), 'Ctrl+Shift+K');
  assert.equal(normalizeKeys('a k'), 'A K');
  assert.equal(normalizeKeys('Shift+Right'), 'Shift+ArrowRight');
  assert.equal(normalizeKeys('f5'), 'F5');
  assert.equal(normalizeKeys('?'), '?');
  assert.equal(normalizeKeys(''), null);
  assert.equal(eventChord({ key: 'y', code: 'KeyY', altKey: true }), 'Alt+Y');
  assert.equal(eventChord({ key: '¥', code: 'KeyY', altKey: true }), 'Alt+Y', 'a layout symbol under Alt is read by its physical key');
  assert.equal(eventChord({ key: '?', code: 'Slash', shiftKey: true }), '?', 'a shifted symbol carries its Shift');
  assert.equal(eventChord({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: true }), 'Shift+ArrowRight');
  assert.equal(eventChord({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), null);
});

test('every command has a palette phrase or a binding, and the key map lists the bindings in force', () => {
  const map = keyMap({});
  const ids = new Set(ACTIONS.map((a) => a.id));
  assert.equal(ids.size, ACTIONS.length, 'command ids are unique');
  for (const c of map.commands) assert.ok(c.palette || map.bindings.some((b) => b.command === c.id), c.id);
  for (const b of map.bindings) assert.equal(normalizeKeys(b.keys), b.keys, `${b.command} keys are in canonical spelling`);
  const phrases = ['Select <path>', 'Control <label>', 'Dial <label>', 'Bench <label>', 'Studio <label>', 'Reset <label>', 'Arrange by kind', 'Arrange by folder', 'Arrange by date', 'Arrange by similarity', 'Arrange by tag', 'Arrange by status', 'Arrange by run', 'Arrange by meta.<column>', 'Present', 'Compare variants <path>', 'Approve <proposal>', 'Reject <proposal>', 'Generate <workflow>', 'Open folder <path>', 'Group <name>', 'Rebind <command> to <keys>'];
  for (const p of phrases) assert.ok(ACTIONS.some((a) => a.phrase === p), p);
  assert.equal(map.bindings.find((b) => b.command === 'arrange-kind').keys, 'A K');
  const rebound = keyMap({ 'arrange-kind': 'Alt+Y' });
  assert.equal(rebound.bindings.find((b) => b.command === 'arrange-kind').keys, 'Alt+Y');
  assert.ok(map.bindings.some((b) => b.keys === 'Ctrl+K') && map.bindings.some((b) => b.keys === '?'), 'the palette and the map are bindings too');
});

test('arrange partitions items by the value the data implies', () => {
  const list = [{ id: 'a.png', path: 'a.png', kind: 'png', meta: { modifiedAt: Date.UTC(2026, 0, 2) } }, { id: 'b/c.png', path: 'b/c.png', kind: 'png', meta: {} }, { id: 'd.csv', path: 'd.csv', kind: 'csv', meta: { status: 'draft' } }];
  assert.deepEqual(arrange(list, 'kind').map((g) => [g.name, g.items]), [['csv', ['d.csv']], ['png', ['a.png', 'b/c.png']]]);
  assert.deepEqual(arrange(list, 'folder').map((g) => g.name).sort(), ['(top level)', 'b']);
  assert.ok(arrange(list, 'status').some((g) => g.name === 'draft'));
  assert.ok(arrange(list, 'date').some((g) => g.name === '2026-01-02'));
  assert.deepEqual(arrange(list, 'manual'), []);
});

test('board routes: selection, groups, arrangement, presentation, rebinding and section depth, persisted per folder', async () => {
  const state = mkdtempSync(join(tmpdir(), 'napkin-surface-')), dir = mkdtempSync(join(tmpdir(), 'napkin-surface-dir-'));
  const items = [{ id: 'x.html', path: 'x.html', kind: 'html', meta: {} }, { id: 'y.png', path: 'y.png', kind: 'png', meta: {} }];
  const controls = { revision: 'r1', sections: [{ id: 'source', label: 'File values', controls: [{ id: 'css:1', label: 'Gap', type: 'number', value: 4, depth: 1 }, { id: 'src', label: 'Source', type: 'textarea', value: '', depth: 2 }] }] };
  const make = () => createSurfaceRoutes({ items: { items: () => items, controls: () => structuredClone(controls) }, dir, identify: (t) => (t === 'tok' ? 'you' : null), stateDir: state });
  let routes = make();
  const server = createServer(async (req, res) => { const url = new URL(req.url, 'http://x'); if (!(await routes(req, res, url))) { res.writeHead(404); res.end('{}'); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, token = 'tok') => { const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  try {
    assert.equal((await call('/api/board', { selection: ['x.html'] }, 'nope')).status, 401, 'a write needs an identity');
    await call('/api/board', { selection: ['x.html', 'y.png'] });
    assert.deepEqual((await call('/api/board')).selection, ['x.html', 'y.png']);
    await call('/api/board', { group: { name: 'Pair', items: ['x.html', 'y.png'] } });
    await call('/api/board', { arrange: { by: 'kind' } });
    const board = await call('/api/board');
    assert.equal(board.arrange.by, 'kind');
    assert.deepEqual(board.groups.filter((g) => !g.manual).map((g) => g.name), ['html', 'png']);
    assert.deepEqual(board.groups.find((g) => g.manual).items, ['x.html', 'y.png']);
    assert.equal((await call('/api/board', { arrange: { by: 'colour' } })).status, 400);
    await call('/api/board', { presentation: true });
    assert.equal((await call('/api/board')).presentation, true);
    await call('/api/board', { compare: { item: 'x.html', variants: [{ tone: 'a' }, { tone: 'b' }] } });
    assert.equal((await call('/api/board')).compare.variants.length, 2);
    const keys = await call('/api/keys', { command: 'arrange-kind', keys: 'alt+y' });
    assert.ok(keys.bindings.some((b) => b.command === 'arrange-kind' && b.keys === 'Alt+Y'));
    assert.equal((await call('/api/keys', { command: 'no-such-thing', keys: 'Alt+Y' })).status, 404);
    await call('/api/board', { depth: { item: 'x.html', section: 'source', depth: 3 } });
    const schema = await call('/api/controls/x.html');
    assert.deepEqual(schema.sections[0].controls.map((c) => [c.depth, c.nativeDepth]), [[3, 1], [3, 2]], 'the depth the section was opened at, and the depth each control was declared with');
    // A fresh process for the same folder reads the arrangement, the groups, the rebinding and the depths back.
    routes = make();
    const again = await call('/api/board');
    assert.equal(again.arrange.by, 'kind');
    assert.ok(again.groups.some((g) => g.name === 'Pair'));
    assert.deepEqual(again.selection, [], 'what is on screen is not kept across restarts');
    assert.equal(again.presentation, false);
    assert.ok((await call('/api/keys')).bindings.some((b) => b.command === 'arrange-kind' && b.keys === 'Alt+Y'));
    assert.equal((await call('/api/controls/x.html')).sections[0].controls[0].depth, 3);
  } finally {
    server.close();
    rmSync(state, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  }
});
