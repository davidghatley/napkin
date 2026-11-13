import { test } from "node:test";
import assert from "node:assert/strict";
import { expression, validateSchema } from "../../public/dials/values.js";
import {
  rgbToLab,
  labToLinear,
  gamma,
  labToLch,
  lchToLab,
  gamutChroma,
  inGamut,
  contrast,
  apca,
  paletteFromPixels,
} from "../../public/dials/color.js";
import { springAt, bezierAt, keyframeAt } from "../../public/dials/motion.js";
import { schedule } from "../../public/dials/figures.js";
test("arithmetic respects precedence, units, precision and bounds; rejects execution", () => {
  assert.equal(expression("12px*1.5", { unit: "px" }), 18);
  assert.equal(expression("(2 + 3)*4 - 6/2"), 17);
  assert.equal(expression("1.2s + 50ms", { unit: "ms" }), 1250);
  assert.equal(expression("0.5turn", { unit: "deg" }), 180);
  assert.equal(expression("50%", { unit: "%" }), 50);
  assert.equal(expression("50%", { min: 0, max: 1 }), 0.5);
  assert.equal(expression("50%", { unit: "px", min: 0, max: 200, step: 1 }), 100);
  assert.equal(expression("150%", { unit: "px", value: 12 }), 18);
  assert.equal(expression("-2 * -3"), 6);
  assert.equal(expression("999", { max: 100 }), 100);
  assert.equal(expression(".26", { step: 0.1 }), 0.3);
  for (const s of [
    "alert(1)",
    "1/0",
    "2px+3s",
    "2**3",
    "NaN",
    "1;fetch(1)",
    "(1+2",
  ])
    assert.throws(() => expression(s, { unit: "px" }), s);
});
test("color round trips, boundary and contrast have independent reference values", () => {
  const red = rgbToLab([1, 0, 0]);
  assert.ok(Math.abs(red[0] - 0.627955) < 0.00001);
  assert.ok(Math.abs(red[1] - 0.224863) < 0.00001);
  for (const rgb of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.23, 0.45, 0.77],
  ]) {
    const out = labToLinear(rgbToLab(rgb)).map(gamma);
    out.forEach((v, i) => assert.ok(Math.abs(v - rgb[i]) < 0.00001));
  }
  const redLch = labToLch(red);
  lchToLab(redLch)
    .slice(0, 3)
    .forEach((v, i) => assert.ok(Math.abs(v - red[i]) < 0.000001));
  const white = [1, 0, 0, 1],
    black = [0, 0, 0, 1];
  assert.equal(contrast(white, black), 21);
  assert.equal(contrast(white, white), 1);
  assert.ok(apca(black, white) > 105 && apca(black, white) < 107);
  assert.ok(apca(white, black) < -107);
  for (const H of [0, 60, 120, 180, 240, 300]) {
    const c = gamutChroma(0.6, H);
    assert.ok(inGamut([0.6, c, H]));
    assert.ok(!inGamut([0.6, c + 0.001, H]));
    assert.ok(gamutChroma(0.6, H, "p3") >= c - 0.001);
  }
  const palette = paletteFromPixels(
    new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0,
    ]),
  );
  assert.equal(palette.length, 2);
  assert.ok(Math.abs(palette[0][0] - red[0]) < 0.00001);
});
test("motion preserves timing endpoints, overshoot, damping and keyframe interpolation", () => {
  assert.equal(bezierAt(0), 0);
  assert.equal(bezierAt(1), 1);
  assert.ok(Math.abs(bezierAt(0.5, [0, 0, 1, 1]) - 0.5) < 0.00001);
  for (const damping of [8, 20, 40]) {
    assert.ok(
      Math.abs(springAt(0, { stiffness: 100, damping, mass: 1 })) < 1e-8,
    );
    assert.ok(
      Math.abs(springAt(10, { stiffness: 100, damping, mass: 1 }) - 1) < 1e-6,
    );
  }
  assert.ok(springAt(0.3, { stiffness: 170, damping: 8, mass: 1 }) > 1);
  assert.equal(
    keyframeAt(0.25, [
      { time: 0, value: 0 },
      { time: 0.5, value: 0.8 },
      { time: 1, value: 1 },
    ]),
    0.4,
  );
  for (const scheduler of ["linear", "karras", "cosine"]) {
    const a = schedule(28, scheduler, 1.3);
    assert.equal(a.length, 29);
    assert.equal(a[0], 1);
    assert.equal(a.at(-1), 0);
    assert.ok(a.every((n, i) => !i || n <= a[i - 1]));
  }
});
test("schemas reject ambiguous IDs and malformed values before rendering", () => {
  const doc = {
    sections: [{ id: "s", controls: [{ id: "n", type: "number", value: 1 }] }],
  };
  validateSchema(doc);
  assert.throws(() =>
    validateSchema({
      sections: [
        { id: "s", controls: [{ id: "n", type: "number", value: NaN }] },
      ],
    }),
  );
  assert.throws(() =>
    validateSchema({
      sections: [
        {
          id: "s",
          controls: [
            { id: "n", type: "number", value: 1 },
            { id: "n", type: "number", value: 2 },
          ],
        },
      ],
    }),
  );
});
