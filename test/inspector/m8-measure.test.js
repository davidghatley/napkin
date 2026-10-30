// Moment 8, honest measurement: Alt-hover draws the real box model and gaps from computed styles over the frame, with
// the stage's distance lines between the selection and the hovered element; contrast and focus order can be overlaid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, sleep } from './helpers.js';
import { parseColor, contrast } from '../../public/canvas/inspector-model.js';

const NOTE = 'Note/preview.html', PILL = 'Pill/preview.html';
const frameStyle = (a, comp, node, props) => a.q(`JSON.stringify((() => { const el = napkin.stage.sections.get(${JSON.stringify(comp)}).docFrame.element(${JSON.stringify(node)}).el; const cs = getComputedStyle(el); return ${JSON.stringify(props)}.map((p) => cs.getPropertyValue(p)); })())`).then(JSON.parse);

test('M8: Alt over an element draws its box model and gap from computed styles, and the distance from the selection', { timeout: 90000 }, async () => {
  const a = await open({ theme: 'light' });
  try {
    const tag = await a.node(NOTE, (n) => n.tag === 'span' && n.attrs.class === 'ss-note__tag');
    const body2 = await a.node(NOTE, (n) => n.tag === 'div' && n.attrs.class === 'ss-note__body' && /decision/.test(n.text || ''));
    const row = await a.node(PILL, (n) => n.attrs.class === 'ss-row');
    await a.select(NOTE, tag.node);

    await a.io.down('Alt');
    const p = await a.pagePoint(NOTE, body2.node);
    await a.io.move(p.x, p.y, { alt: true });
    await a.browser.waitFor(`document.querySelectorAll('#inspect-overlay > .im-padding:not(.im-dim)').length === 1`);
    const read = await a.q(`document.querySelector('#inspect-overlay > .im-read').innerText`);
    const [pad] = await frameStyle(a, NOTE, body2.node, ['padding-top']);
    assert.equal(pad, '13px');
    assert.match(read, /div\.ss-note__body/); assert.match(read, /margin 0/); assert.match(read, /padding 13/);
    assert.match(read, /× 50\b/, 'height from the layout: 24px line + 2 × 13px padding');
    // the ring is as thick as the padding, on screen (the canvas zoom is applied)
    const z = await a.q(`(() => { const f = napkin.stage.sections.get(${JSON.stringify(NOTE)}).docFrame.iframe(); return f.getBoundingClientRect().width / f.offsetWidth; })()`);
    const ring = parseFloat(await a.q(`getComputedStyle(document.querySelector('#inspect-overlay > .im-padding:not(.im-dim)')).borderTopWidth`));
    assert.ok(Math.abs(ring - 13 * z) < 1.01, `padding ring ${ring} vs ${13 * z}`);
    assert.ok(await a.q(`[...document.querySelectorAll('#inspect-overlay > .im-num.im-p')].some((n) => n.textContent === '13')`));
    // the selection → hover distance lines are the stage's own, drawn in the same hold
    assert.ok(await a.q(`document.querySelector('#overlay-measure').dataset.active === '1' && document.querySelectorAll('#overlay-measure .m-label').length > 0`), 'distance lines');
    const dist = await a.q(`[...document.querySelectorAll('#overlay-measure .m-label[data-axis=y]')].map((l) => Number(l.dataset.value))`);
    // the tag's bottom edge to the second note body's top: the 24px line of the tag, the first body and the notes' margin and borders
    const rects = await a.q(`JSON.stringify((() => { const s = napkin.stage.sections.get(${JSON.stringify(NOTE)}).docFrame; const A = s.element(${JSON.stringify(tag.node)}).el.getBoundingClientRect(), B = s.element(${JSON.stringify(body2.node)}).el.getBoundingClientRect(); return { gap: B.top - A.bottom }; })())`).then(JSON.parse);
    assert.ok(dist.some((d) => Math.abs(d - rects.gap) < 0.6), `distance ${dist} includes ${rects.gap}`);

    // a flex container: its real gap, between its children
    const rp = await a.pagePoint(PILL, row.node);
    await a.io.move(rp.x + 200, rp.y, { alt: true }); // empty space inside the row, not over a child
    await a.browser.waitFor(`document.querySelectorAll('#inspect-overlay > .im-gap').length >= 3`);
    assert.deepEqual([...new Set(await a.q(`[...document.querySelectorAll('#inspect-overlay > .im-num.im-g')].map((n) => n.textContent)`))], ['12']);
    assert.match(await a.q(`document.querySelector('#inspect-overlay > .im-read').innerText`), /margin 16 0\s+padding 8\s+gap 12/);
    await a.io.up('Alt');
    await a.browser.waitFor(`document.querySelector('#inspect-overlay').children.length === 0`);
  } finally { await a.close(); }
});

test('M8: contrast of every text element (WCAG), below AA marked; focus order numbered in tab order', { timeout: 90000 }, async () => {
  const a = await open({ theme: 'light' });
  try {
    const tag = await a.node(NOTE, (n) => n.tag === 'span' && n.attrs.class === 'ss-note__tag');
    await a.select(NOTE, tag.node);
    await a.q(`document.querySelector('#chk-contrast').click()`);
    await a.browser.waitFor(`document.querySelectorAll('#inspect-overlay .im-badge').length > 5`);
    const s = await a.q(`JSON.stringify(napkin.inspector.read().contrast)`).then(JSON.parse);
    assert.ok(s.total >= 8, `${s.total} text elements`);
    const expectRule = Math.round(contrast(parseColor('#16181d'), parseColor('#ee5228')) * 10) / 10;
    assert.ok(s.items.some((i) => i.el === 'span' && i.ratio === expectRule && i.ok), `the vermilion tag at ${expectRule}:1`);
    const faint = Math.round(contrast(parseColor('#aaaaaa'), parseColor('#eeede7')) * 10) / 10;
    const bad = s.items.filter((i) => !i.ok);
    assert.deepEqual(bad.map((i) => [i.el, i.ratio]), [['p', faint]], 'only the faint paragraph is below AA');
    assert.equal(s.fail, 1);
    assert.equal(await a.q(`document.querySelectorAll('#inspect-overlay .im-badge.bad').length`), 1);
    assert.match(await a.q(`document.querySelector('#chk-sum').textContent`), /text elements, 1 below AA/);
    assert.match(await a.q(`document.querySelector('#inspect-overlay .im-badge.bad').title`), /#aaaaaa on #eeede7: 2(\.\d)?:1, needs 4\.5:1/);
    await a.q(`document.querySelector('#chk-contrast').click()`);
    assert.equal(await a.q(`document.querySelectorAll('#inspect-overlay .im-badge').length`), 0, 'off again');

    await a.q(`document.querySelector('#chk-order').click()`);
    await a.browser.waitFor(`document.querySelectorAll('#inspect-overlay .im-order').length === 3`);
    assert.equal(await a.q(`napkin.inspector.read().order.total`), 3);
    // the button with tabindex=1 is first, wherever it sits
    const first = await a.q(`JSON.stringify((() => { const n = [...document.querySelectorAll('#inspect-overlay .im-order')].find((x) => x.textContent === '1'); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`).then(JSON.parse);
    const btn = await a.q(`JSON.stringify((() => { const f = napkin.stage.sections.get(${JSON.stringify(PILL)}).docFrame; const el = [...f.doc().querySelectorAll('button')].find((b) => b.textContent === 'First'); const fr = f.iframe().getBoundingClientRect(), r = el.getBoundingClientRect(), z = fr.width / f.iframe().offsetWidth; return { x: fr.left + r.left * z, y: fr.top + r.top * z, w: r.width * z, h: r.height * z }; })())`).then(JSON.parse);
    assert.ok(Math.hypot(first.x - (btn.x + btn.w / 2), first.y - (btn.y + btn.h / 2)) < 90, `badge 1 is beside the First button, not on it: ${JSON.stringify({ first, btn })}`);
    await a.q(`napkin.inspector.toggle('order', false)`);
    assert.equal(await a.q(`document.querySelectorAll('#inspect-overlay .im-order').length`), 0);
  } finally { await a.close(); }
});

test('M8: the checks are reachable from Cmd-K', { timeout: 60000 }, async () => {
  const a = await open({ theme: 'light' });
  try {
    for (const [words, flag] of [['contrast', 'contrast'], ['focus order', 'order']]) {
      await a.io.key('k', { ctrl: true });
      await a.browser.waitFor(`document.querySelector('#quick, [role=dialog][aria-label*=Jump], dialog[open]') && document.activeElement?.tagName === 'INPUT'`);
      await a.browser.send('Input.insertText', { text: words });
      await sleep(250);
      await a.io.key('Enter');
      await a.browser.waitFor(`napkin.inspector.read().${flag === 'order' ? 'order' : 'contrast'} !== null`, 5000);
      assert.ok(await a.q(`document.querySelectorAll('#inspect-overlay > *').length > 0`), `${words} is drawn`);
    }
  } finally { await a.close(); }
});
