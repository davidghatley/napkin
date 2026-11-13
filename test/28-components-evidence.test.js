// Components lane screenshots (1440x900). Only runs with EVIDENCE_OUT=docs/evidence; otherwise it is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lab } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';

const OUT = process.env.EVIDENCE_OUT;
const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');

test('components evidence screenshots', { skip: !OUT, timeout: 240000 }, async () => {
  mkdirSync(OUT, { recursive: true });
  const L = await lab({ Button: fx('Button'), Card: fx('Card'), Chip: fx('Chip') }, { theme: 'light' });
  const { q, browser } = L;
  const shot = async (name) => { await sleep(250); const f = join(OUT, `components-${name}.png`); writeFileSync(f, await browser.screenshot()); assert.ok(statSync(f).size < 300 * 1024, `${name} is ${statSync(f).size} bytes`); };
  const secs = (open) => q(`document.querySelectorAll('#panel .pp-sec').forEach((d) => { d.open = ${JSON.stringify(open)}.includes(d.dataset.sec); })`);
  try {
    await L.edit('Button', [{ op: 'describeProp', name: 'label', text: 'The words on the button' }, { op: 'describeProp', name: 'size', text: 'How big it is' }, { op: 'addProp', name: 'disabled', type: 'boolean', default: false }]);
    await L.select('Button', 'root', { size: 'md', state: 'default' });
    await secs(['props']); await q(`document.querySelector('[data-sec=props]').scrollIntoView()`);
    await shot('props');
    await L.select('Button', 'root', { size: 'sm', state: 'default' });
    await secs(['sources', 'variants']); await q(`document.querySelector('[data-sec=sources]').scrollIntoView()`);
    await shot('sources');
    await q(`document.querySelector('[data-sec=variants]').scrollIntoView()`);
    await shot('variants');
    // matrix
    await L.select('Chip', 'root');
    const id = await L.id('Chip');
    const dims = JSON.parse(await q(`JSON.stringify(napkin.find('Chip').doc.props.filter((p) => p.type === 'enum').map((p) => [p.name, p.options]))`));
    await q(`napkin.view.fitSelection?.({ animate: false }); napkin.nav.focus(${JSON.stringify(id)}, null, { animate: false })`);
    await q(`document.querySelector('.mchip[data-axis=${dims[0][0]}][data-value=${dims[0][1][1]}]').click()`);
    await q(`document.querySelector('.group .gtoggle').click()`);
    await shot('matrix');
    await q(`napkin.nav.unfocus({ animate: false }); napkin.matrix.showAll(${JSON.stringify(id)}); napkin.matrix.expandAll(${JSON.stringify(id)})`);
    // composition
    await L.edit('Card', [{ op: 'insertInstance', parent: 'card', id: 'cta', component: 'Button', props: { label: 'Buy now' } }, { op: 'addProp', name: 'children', type: 'node' }, { op: 'insert', parent: 'card', node: { id: 'extra', tag: 'div' } }, { op: 'set', path: 'extra.@slot', value: 'children' }]);
    await L.select('Card', 'cta');
    await q(`document.querySelectorAll('#panel .pp-sec').forEach((d) => { d.open = d.dataset.sec === 'compose'; }); napkin.nav.focus(napkin.find('Card').component, 'cta', { animate: false })`);
    await shot('compose');
    // play
    await q(`napkin.play.set(true)`);
    await shot('play');
    await q(`napkin.play.set(false)`);
  } finally { await L.close(); }
});
