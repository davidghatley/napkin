// LAY-02 (Hug / Fill / Fixed, 12-case render matrix) and LAY-04 (pins behave like Figma constraints when the parent resizes, 8 cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lab, tsx } from './helpers/lab.js';
import { getValue } from '../src/model.js';

const SIZES = tsx('Sizes', { id: 'stage', tag: 'div', style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', width: 400, height: 300, boxSizing: 'border-box' }, kids: [
  { id: 'box', tag: 'div', style: { display: 'block' }, kids: [{ id: 'chip', tag: 'span', style: { display: 'block', width: 50, height: 30, background: '#e8b04b' } }] },
] });

test('LAY-02: 12 cases, every Hug / Fill / Fixed lands at the expected size, and Fill is written the right way for its parent', { timeout: 120000 }, async (t) => {
  const L = await lab({ Sizes: SIZES });
  try {
    await L.select('Sizes', 'box');
    const cases = [];
    for (const dir of ['row', 'column']) for (const prop of ['width', 'height']) for (const mode of ['hug', 'fill', 'fixed']) cases.push({ dir, prop, mode });
    assert.equal(cases.length, 12);
    let passed = 0;
    for (const { dir, prop, mode } of cases) {
      await t.test(`${dir} parent, ${prop}: ${mode}`, async () => {
        // a known starting point: the parent's direction, the child back to its content size
        await L.edit('Sizes', [
          { op: 'set', path: 'stage.flexDirection', value: dir },
          ...['width', 'height', 'flex', 'alignSelf'].map((k) => ({ op: 'set', path: `box.${k}`, value: null })),
        ]);
        await L.select('Sizes', 'box');
        const r0 = await L.rev('Sizes');
        await L.q(`document.querySelector('#size-${prop}-${mode}').click()`);
        await L.browser.waitFor(`napkin.find('Sizes').revision > ${r0}`);
        await L.browser.waitFor(`document.querySelector('section[data-name=Sizes]').dataset.revision === String(napkin.find('Sizes').revision)`);
        const size = await L.size('Sizes', 'box');
        const main = dir === 'row' ? 'width' : 'height';
        const expected = { hug: { width: 50, height: 30 }, fill: { width: 400, height: 300 }, fixed: { width: 50, height: 30 } }[mode][prop];
        assert.equal(size[prop === 'width' ? 'w' : 'h'], expected, `${prop} of the box`);
        const doc = await L.doc('Sizes');
        const style = doc.root.children[0].style;
        if (mode === 'fill' && prop === main) { assert.equal(style.flex, 1, 'main axis: flex: 1'); assert.equal(style[prop], undefined, 'no width line left over'); }
        if (mode === 'fill' && prop !== main) { assert.equal(style.alignSelf, 'stretch', 'cross axis: alignSelf: stretch'); assert.equal(style[prop], undefined); }
        if (mode === 'hug') assert.equal(style[prop], 'auto');
        if (mode === 'fixed') assert.equal(style[prop], expected);
        passed++;
      });
    }
    assert.equal(passed, 12, '12/12');
    await t.test('a block parent and the root use 100%; min and max clamp', async () => {
      await L.edit('Sizes', [{ op: 'set', path: 'stage.display', value: 'block' }, ...['width', 'height', 'flex', 'alignSelf'].map((k) => ({ op: 'set', path: `box.${k}`, value: null }))]);
      await L.select('Sizes', 'box');
      const r0 = await L.rev('Sizes');
      await L.q(`document.querySelector('#size-width-fill').click()`);
      await L.browser.waitFor(`napkin.find('Sizes').revision > ${r0}`);
      assert.equal(getValue(await L.doc('Sizes'), 'box.width'), '100%');
      await L.edit('Sizes', [{ op: 'set', path: 'box.maxWidth', value: 120 }]);
      assert.equal((await L.size('Sizes', 'box')).w, 120, 'max width clamps a fill');
      await L.edit('Sizes', [{ op: 'set', path: 'box.width', value: 10 }, { op: 'set', path: 'box.minWidth', value: 60 }, { op: 'set', path: 'box.maxWidth', value: null }]);
      assert.equal((await L.size('Sizes', 'box')).w, 60, 'min width lifts a small width');
    });
  } finally { await L.close(); }
});

const PINS = tsx('Pins', { id: 'stage', tag: 'div', style: { position: 'relative', width: 400, height: 300, boxSizing: 'border-box' }, kids: [
  { id: 'pin', tag: 'div', style: { width: 100, height: 60, background: '#2236b0' } },
] });

test('LAY-04: 8 cases, a pinned child follows its parent like a Figma constraint', { timeout: 120000 }, async (t) => {
  const L = await lab({ Pins: PINS });
  try {
    // the child sits at (40, 30), 100 x 60 inside 400 x 300; the parent then grows to 600 x 450
    const expectH = { min: { x: 40, w: 100 }, max: { x: 240, w: 100 }, both: { x: 40, w: 300 }, center: { x: 140, w: 100 } };
    const expectV = { min: { y: 30, h: 60 }, max: { y: 180, h: 60 }, both: { y: 30, h: 210 }, center: { y: 105, h: 60 } };
    const cases = [...Object.keys(expectH).map((m) => ['h', m]), ...Object.keys(expectV).map((m) => ['v', m])];
    assert.equal(cases.length, 8);
    for (const [axis, mode] of cases) {
      await t.test(`${axis === 'h' ? 'horizontal' : 'vertical'} pin: ${mode}`, async () => {
        await L.edit('Pins', [
          ...['position', 'left', 'right', 'top', 'bottom', 'transform'].map((k) => ({ op: 'set', path: `pin.${k}`, value: null })),
          { op: 'set', path: 'pin.width', value: 100 }, { op: 'set', path: 'pin.height', value: 60 }, { op: 'set', path: 'pin.marginLeft', value: 40 }, { op: 'set', path: 'pin.marginTop', value: 30 },
          { op: 'set', path: 'stage.width', value: 400 }, { op: 'set', path: 'stage.height', value: 300 },
        ]);
        await L.select('Pins', 'pin');
        let r0 = await L.rev('Pins');
        await L.q(`document.querySelector('#seg-position-absolute').click()`);
        await L.browser.waitFor(`napkin.find('Pins').revision > ${r0}`);
        await L.browser.waitFor(`document.querySelector('#pin-${axis}-${mode}')`);
        r0 = await L.rev('Pins');
        // margins would add to the pins: the panel wrote the absolute box, so clear them before measuring
        await L.edit('Pins', [{ op: 'set', path: 'pin.marginLeft', value: null }, { op: 'set', path: 'pin.marginTop', value: null }]);
        await L.select('Pins', 'pin');
        await L.q(`document.querySelector('#pin-${axis}-${mode}').click()`);
        await L.browser.waitFor(`napkin.find('Pins').revision > ${r0 + 1}`);
        await L.browser.waitFor(`document.querySelector('section[data-name=Pins]').dataset.revision === String(napkin.find('Pins').revision)`);
        const read = () => L.q(`(() => { const c = document.querySelector('section[data-name=Pins] .cell .mount'); const st = c.querySelector('[data-n=stage]'), p = c.querySelector('[data-n=pin]'); const a = st.getBoundingClientRect(), b = p.getBoundingClientRect(), z = napkin.state.zoom; return JSON.stringify({ x: (b.left - a.left) / z, y: (b.top - a.top) / z, w: b.width / z, h: b.height / z }); })()`).then(JSON.parse);
        const before = await read();
        assert.deepEqual([before.x, before.y, before.w, before.h].map(Math.round), [40, 30, 100, 60], 'the pin does not move the child when it is set');
        await L.q(`(() => { const st = document.querySelector('section[data-name=Pins] .cell .mount [data-n=stage]'); st.style.width = '600px'; st.style.height = '450px'; })()`);
        const after = await read();
        const want = axis === 'h' ? { ...{ y: 30, h: 60 }, ...expectH[mode] } : { ...{ x: 40, w: 100 }, ...expectV[mode] };
        assert.deepEqual(['x', 'y', 'w', 'h'].map((k) => Math.round(after[k])), ['x', 'y', 'w', 'h'].map((k) => want[k]), `${axis} ${mode}`);
      });
    }
  } finally { await L.close(); }
});

test('LAY-04: an odd-sized child keeps its place through min -> centre -> min (no half-pixel drift)', { timeout: 90000 }, async () => {
  const L = await lab({ Odd: tsx('Odd', { id: 'stage', tag: 'div', style: { position: 'relative', width: 400, height: 300 }, kids: [{ id: 'pin', tag: 'div', style: { position: 'absolute', left: 40, top: 30, width: 101, height: 61, background: '#2236b0' } }] }) }, { theme: 'light' });
  try {
    const read = () => L.q(`(() => { const c = document.querySelector('section[data-name=Odd] .cell .mount'); const a = c.querySelector('[data-n=stage]').getBoundingClientRect(), b = c.querySelector('[data-n=pin]').getBoundingClientRect(), z = napkin.state.zoom; return JSON.stringify({ x: (b.left - a.left) / z, y: (b.top - a.top) / z }); })()`).then(JSON.parse);
    await L.select('Odd', 'pin');
    for (const [axis, mode] of [['h', 'center'], ['h', 'min'], ['v', 'center'], ['v', 'min'], ['h', 'center'], ['v', 'center'], ['h', 'min'], ['v', 'min']]) {
      const r0 = await L.rev('Odd');
      await L.q(`document.querySelector('#pin-${axis}-${mode}').click()`);
      await L.browser.waitFor(`napkin.find('Odd').revision > ${r0} && document.querySelector('section[data-name=Odd]').dataset.revision === String(napkin.find('Odd').revision)`);
      await L.select('Odd', 'pin');
      const p = await read();
      assert.deepEqual([p.x, p.y], [40, 30], `after ${axis} ${mode}`);
    }
    const s = (await L.doc('Odd')).root.children[0].style;
    assert.deepEqual([s.left, s.top, s.width, s.height], [40, 30, 101, 61]);
  } finally { await L.close(); }
});
