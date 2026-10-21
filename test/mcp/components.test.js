// AGT-01: create_component, rename_component, delete_component, search, subscribe, apply_edits (+ stale shape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectCanvas } from '../../src/canvas-client.js';
import { tempRepo, startServer, startMcp } from '../helpers/harness.js';

test('create_component, rename_component and delete_component change the folder and the list', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    const made = await mcp.call('create_component', { name: 'Badge' });
    assert.equal(made.isError, false, made.text);
    assert.ok(existsSync(join(compDir, 'Badge.tsx')));
    const renamed = await mcp.call('rename_component', { component: 'Badge', name: 'Chip' });
    assert.equal(renamed.isError, false, renamed.text);
    assert.equal(renamed.data.id, made.data.id, 'the id survives a rename');
    assert.ok(existsSync(join(compDir, 'Chip.tsx')) && !existsSync(join(compDir, 'Badge.tsx')));
    assert.ok(existsSync(join(compDir, 'Chip.napkin.json')) && !existsSync(join(compDir, 'Badge.napkin.json')));
    const read = await mcp.call('read_component', { component: 'Chip' });
    assert.match(read.data.source, /export function Chip\(/);
    assert.equal(read.data.doc.name, 'Chip');
    const taken = await mcp.call('rename_component', { component: 'Chip', name: 'Card' });
    assert.equal(taken.isError, true); assert.match(taken.text, /already exists/);
    const bad = await mcp.call('rename_component', { component: 'Chip', name: 'chip' });
    assert.equal(bad.isError, true); assert.match(bad.text, /PascalCase/);
    // the renamed component still edits
    const r = await mcp.call('apply_edits', { component: 'Chip', baseRevision: read.data.revision, edits: [{ op: 'set', path: 'root.color', value: 'red' }] });
    assert.equal(r.isError, false, r.text);
    const del = await mcp.call('delete_component', { component: 'Chip' });
    assert.equal(del.isError, false, del.text);
    assert.ok(!existsSync(join(compDir, 'Chip.tsx')) && !existsSync(join(compDir, 'Chip.napkin.json')));
    assert.deepEqual((await mcp.call('list_components')).data.map((c) => c.name).sort(), ['Button', 'Card']);
    assert.equal((await mcp.call('read_component', { component: 'Chip' })).isError, true);
    assert.equal((await mcp.call('delete_component', { component: 'Chip' })).isError, true);
  } finally { mcp.stop(); await server.stop(); }
});

test('search finds components and nodes by name, id, tag and text', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    const byName = (await mcp.call('search', { query: 'butt' })).data.results;
    assert.ok(byName.some((x) => x.kind === 'component' && x.name === 'Button'));
    const label = (await mcp.call('search', { query: 'LABEL' })).data.results;
    assert.ok(label.some((x) => x.kind === 'node' && x.name === 'Button' && x.node === 'label' && x.match === 'id'));
    const card = (await mcp.call('read_component', { component: 'Card' })).data.doc;
    const textNode = (function find(n) { if (typeof n.text === 'string' && n.text.length > 3) return n; for (const c of n.children || []) { const f = find(c); if (f) return f; } })(card.root);
    assert.ok(textNode, 'Card has a node with literal text');
    const byText = (await mcp.call('search', { query: textNode.text.slice(1, 6) })).data.results;
    assert.ok(byText.some((x) => x.kind === 'node' && x.component === card.id && x.node === textNode.id && x.match === 'text'), JSON.stringify(byText));
    assert.deepEqual((await mcp.call('search', { query: 'zzz-nothing' })).data.results, []);
    assert.deepEqual((await mcp.call('search', { query: '' })).data.results, []);
  } finally { mcp.stop(); await server.stop(); }
});

test('subscribe returns what someone else changed, with who and a summary; waitMs waits for it', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  const person = await connectCanvas(server.url, { by: 'david' });
  try {
    await mcp.call('list_components');
    assert.deepEqual((await mcp.call('subscribe')).data.changes, []);
    const card = person.state('Card');
    setTimeout(() => person.sendEdits(card.component, card.revision, [{ op: 'set', path: 'title.fontWeight', value: 700 }]), 100);
    const got = await mcp.call('subscribe', { waitMs: 3000 });
    assert.equal(got.data.changes.length, 1);
    assert.equal(got.data.changes[0].component, card.component);
    assert.match(got.data.changes[0].summary, /title\.fontWeight = 700/);
    assert.ok(got.data.changes[0].by);
    assert.deepEqual((await mcp.call('subscribe')).data.changes, [], 'taken changes are not repeated');
    assert.ok(mcp.notifications.some((n) => n.method === 'notifications/napkin/change'), 'also pushed as a notification');
    // an agent's own edit is not reported back to it
    const mine = await mcp.call('apply_edits', { component: 'Card', baseRevision: (await mcp.call('read_component', { component: 'Card' })).data.revision, edits: [{ op: 'set', path: 'title.color', value: 'red' }] });
    assert.equal(mine.isError, false, mine.text);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual((await mcp.call('subscribe', { component: 'Card' })).data.changes, []);
  } finally { person.close(); mcp.stop(); await server.stop(); }
});

test('apply_edits: stale errors from MCP are structured JSON with the changed keys', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'scout' });
  const person = await connectCanvas(server.url, { by: 'david' });
  try {
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const card = person.state('Card');
    assert.equal((await person.sendEdits(card.component, card.revision, [{ op: 'set', path: 'title.fontWeight', value: 800 }])).ok, true);
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 600 }] });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /^stale revision/);
    assert.equal(r.data.stale[0].key, 'title.fontWeight');
    assert.equal(r.data.stale[0].value, 800);
    assert.equal(r.data.stale[0].yours, 600);
    assert.equal(r.data.stale[0].by, 'david');
    assert.equal(r.data.currentRevision, rev + 1);
    const retry = await mcp.call('apply_edits', { component: 'Card', baseRevision: r.data.currentRevision, edits: [{ op: 'set', path: 'title.fontWeight', value: 600 }] });
    assert.equal(retry.isError, false, retry.text);
    assert.equal(readFileSync(join(compDir, 'Card.tsx'), 'utf8').match(/fontWeight: (\d+)/)[1], '600');
  } finally { person.close(); mcp.stop(); await server.stop(); }
});
