import { test } from "node:test";
import assert from "node:assert/strict";
import { motionCode, readMotionCode, parseEasing, toLinear, framesAt } from "../../public/dials/motion.js";

const spring = { mode: "spring", bezier: [0.22, 0.8, 0.22, 1], duration: 1200, delay: 120, stiffness: 170, damping: 14, mass: 1, velocity: 0 };
const bezier = { mode: "bezier", bezier: [0.16, 1, 0.3, 1], duration: 640, delay: 0 };
const frames = [
  { offset: 0, transform: "translateX(0px)", opacity: 0 },
  { offset: 0.55, transform: "translateX(132px)", opacity: 1 },
  { offset: 1, transform: "translateX(108px)", opacity: 1 },
];
const pick = (m) => ({ mode: m.mode, duration: m.duration, delay: m.delay, ...(m.mode === "spring" ? { stiffness: m.stiffness, damping: m.damping, mass: m.mass, velocity: m.velocity } : { bezier: m.bezier }) });

test("transition, @keyframes and WAAPI code read back to the same values", () => {
  for (const motion of [spring, bezier]) {
    const code = motionCode({ motion, frames, loop: true, rotate: 30 });
    assert.match(code.transition, /transition: transform \d+ms (linear|cubic-bezier)\(/);
    assert.match(code.keyframes, /@keyframes entrance \{/);
    assert.match(code.waapi, /element\.animate\(\[/);
    for (const kind of ["transition", "keyframes", "waapi"]) {
      const read = readMotionCode(code[kind]);
      assert.deepEqual(pick({ ...read.motion, delay: read.motion.delay ?? 0 }), pick(motion), `${motion.mode} ${kind}`);
      if (kind !== "transition") {
        assert.deepEqual(read.frames, frames, `${motion.mode} ${kind} frames`);
        assert.equal(read.iterations, Infinity);
      }
    }
    assert.equal(readMotionCode(code.keyframes).rotate, 30);
  }
});

test("a spring written only as linear() fits back close to the original", () => {
  const fit = parseEasing(toLinear(spring), spring.duration);
  assert.equal(fit.mode, "spring");
  assert.ok(Math.abs(fit.stiffness - 170) < 6, `stiffness ${fit.stiffness}`);
  assert.ok(Math.abs(fit.damping - 14) < 1, `damping ${fit.damping}`);
});

test("code written by hand is read: named easing, seconds, from/to", () => {
  const read = readMotionCode(`@keyframes slide { from { transform: translateX(0px); } to { transform: translateX(40px); } }
.card { animation: slide 0.4s ease-out 0.1s 2 both; }`);
  assert.deepEqual(read.motion, { duration: 400, delay: 100, mode: "bezier", bezier: [0, 0, 0.58, 1] });
  assert.equal(read.iterations, 2);
  assert.equal(read.frames.length, 2);
  assert.throws(() => readMotionCode("color: red;"), /No transition/);
});

test("keyframes ease each segment, as CSS and WAAPI do", () => {
  const mid = framesAt(frames, 0.55, bezier),
    end = framesAt(frames, 1, bezier);
  assert.equal(mid.x, 132);
  assert.equal(end.x, 108);
  assert.equal(framesAt(frames, 0, bezier).opacity, 0);
});
