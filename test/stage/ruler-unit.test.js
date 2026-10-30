// The ruler's reading of a media query, without a browser: which widths a condition is true at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widthConditions, describe, applying } from '../../public/canvas/stage-ruler.js';

const bp = (px, kind, strict) => ({ px, rules: 1, kinds: new Set([kind]), strict: new Set(strict ? [kind] : []) });

test('(width < 640px) does not apply at 640; (max-width: 640px) and (width <= 640px) do; the caption says so', () => {
  assert.deepEqual(widthConditions('(width < 640px)'), [{ kind: 'max', px: 640, strict: true }]);
  assert.deepEqual(widthConditions('(width <= 640px)'), [{ kind: 'max', px: 640, strict: false }]);
  assert.deepEqual(widthConditions('(max-width: 40em)'), [{ kind: 'max', px: 640, strict: false }]);
  assert.deepEqual(widthConditions('(640px < width)'), [{ kind: 'min', px: 640, strict: true }]);
  assert.equal(describe([bp(640, 'max', true)], 640), '640 px');
  assert.equal(describe([bp(640, 'max', true)], 639), '639 px · under 640');
  assert.equal(describe([bp(640, 'max', false)], 640), '640 px · 640 and under');
  assert.equal(describe([bp(640, 'min', true)], 640), '640 px');
  assert.equal(describe([bp(640, 'min', true)], 641), '641 px · over 640');
  assert.equal(describe([bp(640, 'min', false)], 640), '640 px · 640 and up');
  assert.equal(applying([bp(640, 'max', true)], 640).max, undefined);
});

import { plain } from '../../public/canvas/words.js';
test('a refusal shown in the panel has no "edit #0 (class):" prefix', () => {
  assert.equal(plain('edit #0 (class): className on <p> (line 4) is computed in code: cn() has no plain class string in it. Next: check the request'), 'className on <p> (line 4) is computed in code: cn() has no plain class string in it.');
});
