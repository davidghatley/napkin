// LAY-08: the colour picker's maths and the "keep the file's format" rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, formatColor, toOklch, fromOklch, fileSpace, colorsIn } from '../../src/color.js';

test('parse and format round-trip every format the file may use', () => {
  for (const t of ['#2236b0', '#2236b080', 'rgb(34, 54, 176)', 'rgba(34, 54, 176, 0.5)', 'rgb(34 54 176 / 0.5)', 'hsl(230 67% 42%)', 'oklch(0.4 0.18 265)']) {
    const p = parseColor(t);
    assert.ok(p, t);
    assert.equal(formatColor(p, p.space, p), t.replace('0.4 0.18 265', '0.4 0.18 265'), `${t} keeps its format`);
  }
  assert.equal(parseColor('#fff').r, 255);
  assert.equal(parseColor('papayawhip'), null);
});
test('oklch is a faithful round trip, and hex to rgb to oklch agree', () => {
  for (const hex of ['#ff0000', '#2236b0', '#e8b04b', '#808080']) {
    const c = parseColor(hex), o = toOklch(c), back = fromOklch(o.l, o.c, o.h);
    assert.ok(Math.abs(back.r - c.r) < 1.5 && Math.abs(back.g - c.g) < 1.5 && Math.abs(back.b - c.b) < 1.5, hex);
  }
  assert.match(formatColor(parseColor('#ff0000'), 'oklch'), /^oklch\(0\.628 0\.258 29\./);
});
test('a file that uses rgb() keeps rgb(): new colours follow the file', () => {
  const node = (style, children = []) => ({ id: 'a', tag: 'div', style, children });
  assert.equal(fileSpace({ root: node({ background: 'rgb(1, 2, 3)', color: 'rgb(4, 5, 6)', border: '1px solid #fff' }), variants: {} }), 'rgb');
  assert.equal(fileSpace({ root: node({ margin: 0 }), variants: {} }), 'hex');
  assert.deepEqual(colorsIn('1px solid rgba(0, 0, 0, .2)'), ['rgba(0, 0, 0, .2)']);
});
