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

test('an alpha nobody touched is written back exactly; a changed alpha has two decimals', () => {
  for (const t of ['rgb(10 20 30 / 0.333)', 'rgba(10, 20, 30, 0.333)', '#12345677', 'hsl(10 20% 30% / 33.3%)', 'oklch(0.7 0.05 200 / 0.333)']) {
    const p = parseColor(t);
    assert.equal(formatColor({ r: p.r, g: p.g, b: p.b, a: p.a, ...(p.oklch ? { oklch: p.oklch } : {}) }, p.space, p), t, t);
  }
  const p = parseColor('rgb(10 20 30 / 0.333)');
  assert.equal(formatColor({ ...p, r: 11 }, 'rgb', p), 'rgb(11 20 30 / 0.333)', 'a colour-only edit keeps the alpha');
  assert.equal(formatColor({ ...p, a: 0.5 }, 'rgb', p), 'rgb(10 20 30 / 0.5)');
  assert.equal(formatColor({ ...p, a: 0.251 }, 'rgb', p), 'rgb(10 20 30 / 0.25)');
  assert.equal(formatColor(parseColor('#00000040'), 'rgb', parseColor('#00000040')), 'rgba(0, 0, 0, 0.25)', 'hex to rgb rounds to two decimals');
  const h = parseColor('#12345677');
  assert.equal(formatColor({ ...h, r: 0x22 }, 'hex', h), '#22345677');
});
