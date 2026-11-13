import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { diffLines, hunks, changeCount } from '../../public/canvas/run-diff.js';

test('four writers appending groups from the same snapshot: none is dropped or silently replaced', async (t) => {
  const ctl = await setup(t);
  const names = ['a', 'b', 'c', 'd'];
  const writers = await Promise.all(names.map((n) => ctl.as(n)));
  assert.equal((await writers[0].post('/api/board', { addGroups: [{ id: 'base', name: 'Base', items: [] }] })).status, 200);
  // replacing the list without a revision is refused once groups exist
  const blind = await writers[1].post('/api/board', { groups: [{ id: 'x', name: 'x', items: [] }] });
  assert.equal(blind.status, 409); assert.match(blind.json.error, /baseRevision|addGroups/);
  const out = await Promise.all(writers.map((w, i) => w.post('/api/board', { addGroups: [{ id: `g-${names[i]}`, name: names[i], items: ['seed.svg'] }] })));
  assert.deepEqual(out.map((r) => r.status), [200, 200, 200, 200]);
  const b = (await writers[0].get('/api/board')).json;
  assert.deepEqual(b.groups.map((g) => g.id).sort(), ['base', 'g-a', 'g-b', 'g-c', 'g-d']);
  // with the revision, the replace works and a stale one is refused
  const ok = await writers[0].post('/api/board', { groups: [{ id: 'only', name: 'Only', items: [] }], baseRevision: b.revision });
  assert.equal(ok.status, 200);
  assert.equal((await writers[1].post('/api/board', { groups: [], baseRevision: b.revision })).status, 409);
  // move items between groups atomically
  await writers[2].post('/api/board', { addGroups: [{ id: 'dest', name: 'Dest', items: [] }] });
  await writers[2].post('/api/board', { moveItems: { to: 'dest', items: ['seed.svg'] } });
  assert.deepEqual((await writers[2].get('/api/board')).json.groups.find((g) => g.id === 'dest').items, ['seed.svg']);
});

test('a direct control write is attributed in the run audit and the writer shows as present', async (t) => {
  const ctl = await setup(t);
  const agent = await ctl.as('claude');
  const run = (await agent.post('/api/runs', { name: 'tune' })).json.id;
  const controls = (await agent.get('/api/controls/seed.svg')).json;
  const c = controls.sections.flatMap((s) => s.controls).find((x) => x.id.startsWith('attr:') && x.type === 'text');
  const other = await ctl.as('codex');
  assert.equal((await other.post('/api/control', { item: 'seed.svg', control: c.id, value: '77', baseRevision: controls.revision })).status, 200);
  const audit = (await agent.get('/api/audit?limit=500')).json.events.filter((e) => e.type === 'item-control');
  assert.equal(audit.length, 1); assert.equal(audit[0].by, 'codex'); assert.equal(audit[0].control, c.id);
  assert.ok((await agent.get('/api/agents')).json.agents.some((a) => a.name === 'codex'), 'a control-only writer is present');
  void run;
});

test('the diff finds a change on line 40 of 40 and folds the rest', () => {
  const old = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  const next = old.replace('line 40', 'line forty');
  const lines = diffLines(old, next);
  assert.equal(changeCount(lines), 2);
  const hk = hunks(lines, 1);
  assert.equal(hk.length, 1); assert.ok(hk[0].from >= 38);
  assert.equal(changeCount(diffLines('a\nb', 'a\nb')), 0);
  assert.equal(diffLines('', 'x\ny').length, 2);
});
