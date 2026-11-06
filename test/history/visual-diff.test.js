// INS-05: before/after images of every changed cell, working tree against HEAD; unchanged cells hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './helpers.js';

const isPng = (d) => d.startsWith('data:image/png;base64,') && Buffer.from(d.slice(22), 'base64').subarray(1, 4).toString() === 'PNG';
const label = (v) => Object.entries(v).map(([k, x]) => `${k}=${x}`).join(' ');

test('INS-05: only the cells that changed are listed, each with a before and an after image', { timeout: 120000 }, async () => {
  const r = await rig(['Button']);
  try {
    const clean = await r.call(null, 'GET', '/api/components/Button/visual-diff');
    assert.equal(clean.state, 'clean'); assert.deepEqual(clean.cells, []); assert.equal(clean.total, 6);

    // an override for size=sm only: 2 of the 6 cells (sm x default, sm x hover) look different
    await r.edit('you', 'Button', [{ op: 'set', path: 'root.padding', variant: { size: 'sm' }, value: '20px 40px' }]);
    let d = await r.call(null, 'GET', '/api/components/Button/visual-diff');
    assert.equal(d.ok, true, JSON.stringify(d).slice(0, 300));
    assert.equal(d.state, 'modified'); assert.equal(d.total, 6); assert.equal(d.unchanged, 4);
    assert.deepEqual(d.cells.map((c) => label(c.variant)).sort(), ['size=sm state=default', 'size=sm state=hover']);
    for (const c of d.cells) { assert.equal(c.status, 'changed'); assert.ok(isPng(c.before) && isPng(c.after)); assert.notEqual(c.before, c.after); }

    // a change nobody can see (the cursor) touches every cell's document but no pixel: nothing is listed
    await r.edit('you', 'Button', [{ op: 'set', path: 'root.padding', variant: { size: 'sm' }, value: '4px 10px' }, { op: 'set', path: 'root.cursor', value: 'default' }]);
    d = await r.call(null, 'GET', '/api/components/Button/visual-diff');
    assert.deepEqual(d.cells, [], 'invisible change: unchanged cells are hidden'); assert.equal(d.unchanged, 6);

    // a new variant value adds cells; they show as added, with only an after image
    await r.edit('you', 'Button', [{ op: 'addVariant', axis: 'size', value: 'xl' }]);
    d = await r.call(null, 'GET', '/api/components/Button/visual-diff');
    const added = d.cells.filter((c) => c.status === 'added');
    assert.deepEqual(added.map((c) => label(c.variant)).sort(), ['size=xl state=default', 'size=xl state=hover']);
    assert.ok(added.every((c) => c.before === undefined && isPng(c.after)));
    assert.equal(d.total, 8);
  } finally { await r.close(); }
});
