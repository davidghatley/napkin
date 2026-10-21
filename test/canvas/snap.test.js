// LAY-06: smart guides and snapping. Distances are canvas px; the page passes 4 / zoom so snaps happen within 4 SCREEN px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snap, constrain } from '../../src/layout.js';

const sib = { x: 100, y: 100, w: 80, h: 40, kind: 'sibling' };
const parent = { x: 0, y: 0, w: 400, h: 300, kind: 'parent' };

test('snaps to a sibling edge within the threshold and not beyond it', () => {
  const near = snap({ x: 97, y: 300, w: 50, h: 20 }, [sib], { threshold: 4 });
  assert.equal(near.dx, 3); assert.equal(near.guides[0].axis, 'x'); assert.equal(near.guides[0].at, 100);
  assert.equal(snap({ x: 95, y: 300, w: 50, h: 20 }, [sib], { threshold: 4 }).dx, 0, '5 px away stays put');
});
test('threshold is 4 screen px at any zoom', () => {
  for (const z of [0.5, 1, 2, 4]) {
    const t = 4 / z;
    assert.equal(snap({ x: 100 - t + 0.01, y: 500, w: 3, h: 10 }, [sib], { threshold: t, edges: ['l'] }).dx !== 0, true, `z=${z} inside`);
    assert.equal(snap({ x: 100 - t - 0.5 / z, y: 500, w: 3, h: 10 }, [sib], { threshold: t, edges: ['l'] }).dx, 0, `z=${z} outside`);
  }
});
test('snaps centres and right edges, and to parent edges and the parent centre', () => {
  assert.equal(snap({ x: 120, y: 500, w: 40, h: 10 }, [sib], { threshold: 4 }).dx, 0, 'centres already match (140)');
  assert.equal(snap({ x: 133, y: 500, w: 50, h: 10 }, [sib], { threshold: 4 }).dx, -3, 'right edge to 180... or centre');
  assert.equal(snap({ x: 3, y: 500, w: 50, h: 10 }, [parent], { threshold: 4 }).dx, -3, 'parent left edge');
  assert.equal(snap({ x: 176, y: 500, w: 50, h: 10 }, [parent], { threshold: 4 }).dx, -1, 'centre of the parent (200)');
});
test('falls back to a 4 or 8 px grid, and the closest line wins', () => {
  assert.equal(snap({ x: 19, y: 500, w: 5, h: 5 }, [], { threshold: 4, grid: 8 }).dx, -3);
  assert.equal(snap({ x: 18, y: 31, w: 5, h: 5 }, [], { threshold: 4, grid: 4 }).dy, 1);
  const r = snap({ x: 99, y: 0, w: 10, h: 10 }, [sib, { x: 102, y: 0, w: 10, h: 10, kind: 'sibling' }], { threshold: 4 });
  assert.equal(r.dx, 1, 'the closer of two lines');
});
test('Shift constrains to the dominant axis', () => {
  assert.deepEqual(constrain(10, 3), [10, 0]);
  assert.deepEqual(constrain(-2, 9), [0, 9]);
});
test('the grid is measured from the origin you give, so panning the view never changes where things land', () => {
  for (const ox of [0, 3.7, -120.2, 1000.9]) {
    const r = snap({ x: 53 + ox, y: 500, w: 5, h: 5 }, [], { threshold: 4, grid: 8, origin: { x: ox, y: 0 } });
    assert.ok(Math.abs(r.dx - 3) < 1e-6, `origin ${ox}: moves 3 to reach a multiple of 8 (got ${r.dx})`);
  }
});
