// LAY-02/03/04 rules as pure functions; the rendered checks are in test/19-layout-render.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizePatch, sizeMode, pinPatch, pinsOf, cellAt, placePatch, placementOf, tracks } from '../../src/layout.js';

const row = { display: 'flex' }, col = { display: 'flex', flexDirection: 'column' };
test('Fill is flex:1 along the main axis, stretch across it, 100% elsewhere', () => {
  assert.deepEqual(sizePatch({}, row, 'width', 'fill'), { flex: 1 });
  assert.deepEqual(sizePatch({}, row, 'height', 'fill'), { alignSelf: 'stretch' });
  assert.deepEqual(sizePatch({}, col, 'height', 'fill'), { flex: 1 });
  assert.deepEqual(sizePatch({ width: 120 }, col, 'width', 'fill'), { alignSelf: 'stretch', width: null });
  assert.deepEqual(sizePatch({}, { display: 'block' }, 'width', 'fill'), { width: '100%' });
  assert.deepEqual(sizePatch({}, undefined, 'width', 'fill'), { width: '100%' });
});
test('leaving Fill removes the fill lines; Hug is auto; Fixed is px', () => {
  assert.deepEqual(sizePatch({ flex: 1 }, row, 'width', 'hug'), { flex: null, width: 'auto' });
  assert.deepEqual(sizePatch({ alignSelf: 'stretch' }, row, 'height', 'fixed', 80.4), { alignSelf: null, height: 80 });
  assert.equal(sizeMode({ flex: 1 }, row, 'width'), 'fill');
  assert.equal(sizeMode({ alignSelf: 'stretch' }, row, 'height'), 'fill');
  assert.equal(sizeMode({ width: '100%' }, { display: 'block' }, 'width'), 'fill');
  assert.equal(sizeMode({ width: '40px' }, row, 'width'), 'fixed');
  assert.equal(sizeMode({}, row, 'width'), 'hug');
});
test('pins write inset CSS; centre uses 50% and a translate', () => {
  const rect = { x: 40, y: 30, w: 100, h: 60 }, p = { w: 400, h: 300 };
  assert.deepEqual(pinPatch({ h: 'min', v: 'min' }, rect, p), { position: 'absolute', left: 40, width: 100, top: 30, height: 60 });
  assert.deepEqual(pinPatch({ h: 'max', v: 'both' }, rect, p), { position: 'absolute', right: 260, width: 100, top: 30, bottom: 210 });
  const c = pinPatch({ h: 'center', v: 'center' }, { x: 150, y: 120, w: 100, h: 60 }, p);
  assert.equal(c.left, '50%'); assert.equal(c.top, '50%'); assert.equal(c.transform, 'translate(-50%, -50%)');
  assert.equal(pinPatch({ h: 'center', v: 'min' }, rect, p).left, 'calc(50% - 110px)');
  assert.deepEqual(pinsOf({ left: 1, right: 2, top: '50%' }), { h: 'both', v: 'center' });
});
test('grid: a placement is one line; cells come from track sizes', () => {
  assert.deepEqual(tracks('1fr repeat(2, 40px) auto'), ['1fr', 'repeat(2, 40px)', 'auto']);
  assert.deepEqual(cellAt([100, 100, 100], [50, 50], 10, 10, 150, 70), { col: 2, row: 2 });
  assert.deepEqual(placePatch({}, 3, 2), { gridArea: '2 / 3' });
  assert.deepEqual(placePatch({ gridColumn: '1' }, 3, 2), { gridColumn: '3', gridRow: '2' });
  assert.deepEqual(placementOf({ gridArea: '2 / 3' }), { col: 3, row: 2 });
});

test('a centre pin keeps an odd size exactly where it was (halves are kept), and min -> centre -> min is stable', () => {
  const p = { w: 400, h: 300 };
  const c = pinPatch({ h: 'center', v: 'min' }, { x: 40, y: 10, w: 101, h: 20 }, p);
  assert.equal(c.left, 'calc(50% - 109.5px)');
  assert.equal(pinPatch({ h: 'center', v: 'min' }, { x: 150, y: 10, w: 100, h: 20 }, p).left, '50%');
  // centre: left = 200 - 109.5 - 50.5 = 40, so the element is measured at x = 40 and min writes 40 again
  assert.equal(pinPatch({ h: 'min', v: 'min' }, { x: 40, y: 10, w: 101, h: 20 }, p).left, 40);
});
