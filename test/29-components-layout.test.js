// Default placement: no two frames overlap, counting each frame's title row and filter bar, with at least 24 canvas px between them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lab } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';

const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');
const boxes = `(() => { const z = napkin.view.get().z; return JSON.stringify([...document.querySelectorAll('section.cmp')].map((s) => { const f = s.querySelector('.frame').getBoundingClientRect(), h = s.querySelector('.cmp-head').getBoundingClientRect(); const u = { l: Math.min(f.left, h.left), t: Math.min(f.top, h.top), r: Math.max(f.right, h.right), b: Math.max(f.bottom, h.bottom) }; return { name: s.dataset.name, ...u, z }; })); })()`;
function check(list) {
  const z = list[0].z;
  for (const a of list) for (const b of list) {
    if (a.name >= b.name) continue;
    const gapX = Math.max(b.l - a.r, a.l - b.r) / z, gapY = Math.max(b.t - a.b, a.t - b.b) / z;
    assert.ok(Math.max(gapX, gapY) >= 24 - 0.5, `${a.name} and ${b.name}: gap ${gapX.toFixed(0)} x ${gapY.toFixed(0)} canvas px`);
  }
}

test('default placement leaves room for titles and the filter bar, at fit', { timeout: 120000 }, async (t) => {
  const L = await lab({ Button: fx('Button'), Card: fx('Card'), Chip: fx('Chip') });
  try {
    await t.test('three components', async () => {
      await L.q(`napkin.view.fitAll({ animate: false })`); await sleep(300);
      check(JSON.parse(await L.q(boxes)));
    });
  } finally { await L.close(); }
  const many = {};
  for (let i = 0; i < 24; i++) many[`Item${String(i).padStart(2, '0')}`] = fx(i % 3 === 0 ? 'Chip' : i % 3 === 1 ? 'Button' : 'Card').replace(/\bChip\b|\bButton\b|\bCard\b/g, `Item${String(i).padStart(2, '0')}`);
  const M = await lab(many);
  try {
    await t.test('24 components', async () => {
      await M.q(`napkin.view.fitAll({ animate: false })`); await sleep(400);
      check(JSON.parse(await M.q(boxes)));
    });
  } finally { await M.close(); }
});
