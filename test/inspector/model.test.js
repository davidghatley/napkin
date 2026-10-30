// The inspector's pure parts: colour and length, the strips, off-scale and nearest, contrast, scope options and their diffs, @media.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, contrast, classify, nearest, offScale, bindExact, bindPieces, kindOfProp, tokens, parseLength } from '../../public/canvas/inspector-model.js';
import { mediaMatches, parseInline } from '../../public/canvas/inspector-cascade.js';
import { normalizeTyped, varChange } from '../../public/canvas/inspector-scope.js';

const vars = { '--line-heavy': '3px', '--line-hair': '1px', '--c': '#123456', '--leading-body': '24px', '--text-sm': '14px', '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px', '--radius-1': '2px', '--ink': '#16181d', '--vermilion': '#ee5228', '--paper': 'rgb(238, 237, 231)', '--font-mono': '"IBM Plex Mono", monospace', '--type-body': '400 16px/24px system-ui' };
const g = classify(vars);

test('colour parsing and WCAG contrast', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('rgb(238, 237, 231)'), [238, 237, 231, 1]);
  assert.deepEqual(parseColor('hsl(0 100% 50%)'), [255, 0, 0, 1]);
  assert.equal(parseColor('var(--x)'), null);
  assert.equal(Math.round(contrast([0, 0, 0, 1], [255, 255, 255, 1]) * 100) / 100, 21);
  assert.equal(Math.round(contrast(parseColor('#777'), parseColor('#fff')) * 100) / 100, 4.48);
  assert.equal(Math.round(contrast(parseColor('#767676'), parseColor('#fff')) * 100) / 100, 4.54, 'the AA boundary grey');
  assert.equal(Math.round(contrast([0, 0, 0, 0.5], [255, 255, 255, 1]) * 100) / 100, 3.98, 'alpha is composited first (a half-black text is mid grey)');
});

test('the strips: swatch, scale and type', () => {
  assert.deepEqual(g.color.map((v) => v.name).sort(), ['--c', '--ink', '--paper', '--vermilion']);
  assert.deepEqual(g.space.map((v) => v.name), ['--space-1', '--space-2', '--space-3', '--space-4']);
  assert.deepEqual(g.other.map((v) => v.name), ['--line-heavy', '--line-hair'], 'a name that says nothing about spacing or type is not a scale');
  assert.deepEqual([g.size.map((v) => v.name), g.leading.map((v) => v.name)], [['--text-sm'], ['--leading-body']]);
  assert.deepEqual(g.radius.map((v) => v.name), ['--radius-1']);
  assert.deepEqual(g.type.map((v) => v.name), ['--font-mono', '--type-body']);
});

test('off scale: raw colours and lengths are flagged with the nearest variable; variables, 0, em and unknowns are not', () => {
  assert.equal(kindOfProp('padding-left'), 'space'); assert.equal(kindOfProp('border-top-left-radius'), 'radius'); assert.equal(kindOfProp('display'), null);
  assert.deepEqual(offScale('padding', '13px', g).map((o) => [o.token, o.name, o.exact]), [['13px', '--space-3', false]]);
  assert.deepEqual(offScale('padding', '1px 7px', g), [], 'under 12px a near miss is not flagged: a border or a hairline can account for the pixel');
  assert.deepEqual(offScale('padding', '5px', g), [], '5px is a pixel off --space-1 (4px), and under 12px');
  assert.deepEqual(offScale('padding', '4px 12px', g).map((o) => [o.token, o.name, o.exact]), [['4px', '--space-1', true], ['12px', '--space-3', true]]);
  assert.deepEqual(offScale('padding', 'var(--space-1) 0', g), []);
  assert.deepEqual(offScale('padding', '0.5em', g), [], 'em is relative to the text');
  assert.deepEqual(offScale('background', '#ee5329', g).map((o) => [o.name, o.exact]), [['--vermilion', false]]);
  assert.deepEqual(offScale('color', 'var(--ink)', g), []);
  assert.deepEqual(offScale('color', 'currentcolor', g), []);
  assert.equal(nearest('padding', '13px', g).name, '--space-3');
  // no false flags: a value is only offered a variable of its own group that it is close to
  assert.deepEqual(offScale('font-size', '16px', g), [], '16px is 2px from --text-sm (14px): not near enough, and not the line heights or hairlines');
  assert.deepEqual(offScale('line-height', '24px', g).map((o) => [o.name, o.exact]), [['--leading-body', true]], 'exactly a variable: said so');
  assert.deepEqual(offScale('line-height', '25px', g).map((o) => o.name), ['--leading-body']);
  assert.deepEqual(offScale('color', 'red', g), [], 'red is nowhere near the folder’s colours');
  assert.deepEqual(offScale('border', '1px solid #16181d', g).map((o) => [o.token, o.name]), [['#16181d', '--ink']], 'the hairline is a border width, not a space');
  assert.equal(nearest('border-radius', '2px', g).exact, true);
  assert.equal(nearest('border-radius', '3px', g), null, 'a pixel off, under 12px: not near');
  assert.equal(nearest('margin', '10px', { ...g, space: [] }), null, 'no space variables, nothing to offer');
});

test('typing: a bare number is pixels, an exact scale value becomes its variable', () => {
  assert.equal(normalizeTyped('padding', 'var(--space-1) 16'), 'var(--space-1) 16px');
  assert.equal(normalizeTyped('padding', '0'), '0');
  assert.equal(normalizeTyped('line-height', '1.5'), '1.5');
  assert.equal(normalizeTyped('opacity', '.5'), '.5');
  assert.equal(bindExact('padding', 'var(--space-1) 16px', g), 'var(--space-1) var(--space-4)');
  assert.equal(bindExact('padding', '15px', g), null);
  assert.deepEqual(bindPieces('background', '#16181D', g), [{ raw: '#16181D', name: '--ink' }]);
  assert.deepEqual(varChange('var(--space-1) var(--space-3)', 'var(--space-1) 16px'), { name: '--space-3', value: '16px' });
  assert.deepEqual(varChange('var(--space-3)', '16px'), { name: '--space-3', value: '16px' });
  assert.equal(varChange('12px', '16px'), null);
  assert.equal(varChange('var(--space-1) var(--space-3)', 'var(--space-1) var(--space-4)'), null, 'a variable swapped for another is not a variable edit');
  assert.deepEqual(tokens('1px solid var(--a, #fff) "x y"'), ['1px', 'solid', 'var(--a, #fff)', '"x y"']);
  assert.equal(parseLength('1.5rem'), 24);
});

test('@media and inline parsing', () => {
  const at = (q, w, extra = {}) => mediaMatches(q, { width: w, ...extra });
  assert.equal(at('(max-width: 600px)', 400), true); assert.equal(at('(max-width: 600px)', 700), false);
  assert.equal(at('screen and (min-width: 40em) and (max-width: 60em)', 800), true);
  assert.equal(at('(width >= 600px)', 600), true); assert.equal(at('(400px <= width <= 800px)', 900), false);
  assert.equal(at('print', 800), false); assert.equal(at('not print', 800), true); assert.equal(at('(min-width: 900px), (max-width: 100px)', 50), true);
  assert.equal(at('(prefers-color-scheme: dark)', 800, { dark: true }), true); assert.equal(at('(prefers-color-scheme: dark)', 800), false);
  assert.equal(at('(prefers-reduced-motion: reduce)', 800), false);
  assert.deepEqual(parseInline('a: b; background: url("x;y") !important;c:d'), [{ prop: 'a', value: 'b', important: false }, { prop: 'background', value: 'url("x;y")', important: true }, { prop: 'c', value: 'd', important: false }]);
});
