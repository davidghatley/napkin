// Critic round on the components lane: chips read "All" when nothing is filtered, an override row names the base value it resets to,
// a read-only file says "read-only: line N: reason" (and the panel shows it disabled), the first prop only breaks the signature the prettier way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lab } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';
import { openStore } from '../src/store.js';
import { newComponentSource } from '../src/tsx/write.js';
import { changedLines } from './helpers/lab.js';
import { centerOf } from './helpers/input.js';

const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');

test('matrix chips: nothing filtered = All is pressed and no value chip is', { timeout: 90000 }, async () => {
  const L = await lab({ Chip: fx('Chip') });
  try {
    const q = L.q, id = await L.id('Chip');
    assert.equal(await q(`document.querySelectorAll('.mchip:not(.mall)[aria-pressed=true]').length`), 0);
    assert.equal(await q(`document.querySelectorAll('.mall[aria-pressed=true]').length`), 3);
    const a = JSON.parse(await q(`JSON.stringify(napkin.find('Chip').doc.props.filter((p) => p.type === 'enum').map((p) => [p.name, p.options]))`))[0];
    await q(`document.querySelector('.mchip[data-axis=${a[0]}][data-value=${a[1][1]}]').click()`);
    assert.equal(await q(`[...document.querySelectorAll('.mchip[data-axis=${a[0]}][aria-pressed=true]')].map((b) => b.textContent).join()`), a[1][1]);
    assert.equal(await q(`document.querySelector('.mall[data-axis=${a[0]}]').getAttribute('aria-pressed')`), 'false');
    await q(`document.querySelector('.mall[data-axis=${a[0]}]').click()`);
    assert.equal(await q(`document.querySelectorAll('figure.cell:not(.mhide)').length`), 64);
    assert.equal(await q(`document.querySelectorAll('.mchip:not(.mall)[aria-pressed=true]').length`), 0);
    void id;
  } finally { await L.close(); }
});

test('an overridden row names the base value it would reset to', { timeout: 90000 }, async () => {
  const L = await lab({ Button: fx('Button') });
  try {
    await L.select('Button', 'root', { size: 'sm', state: 'default' });
    await L.browser.waitFor(`!!document.querySelector('#src-basev-padding')`);
    assert.equal(await L.q(`document.querySelector('#src-basev-padding').textContent`), 'base 8px 16px');
    assert.equal(await L.q(`document.querySelector('#src-chip-padding').textContent`), 'size=sm');
  } finally { await L.close(); }
});

test('a read-only file refuses with "read-only: line N: reason", and its panel says so, disabled', { timeout: 90000 }, async () => {
  const L = await lab({ Free: 'export function Free() { return <div className="x">hi</div>; }\n', Edited: fx('Button').replace(/Button/g, 'Edited') });
  try {
    // a file that is valid TSX but outside the dialect: from the start, and after a hand edit takes it out of the dialect
    writeFileSync(join(L.compDir, 'Edited.tsx'), 'export function Edited() { return <div className="x">hi</div>; }\n');
    await sleep(600);
    for (const n of ['Free', 'Edited']) {
      const r = JSON.parse(await L.q(`napkin.sendEdits(napkin.find('${n}').component, [{ op: 'set', path: 'root.padding', value: 4 }]).then(JSON.stringify)`));
      assert.match(r.error, /^read-only: line \d+: /, n);
      assert.doesNotMatch(r.error, /has a syntax error/);
    }
    const c = await centerOf(L.browser, `document.querySelector('section[data-name=Free] .cmp-head h3')`);
    await L.io.click(c.x, c.y); await sleep(200);
    assert.match(await L.q(`document.querySelector('#sel-readonly').textContent`), /^read-only: line 1: /);
    assert.equal(await L.q(`document.querySelectorAll('#panel input:not([disabled]), #panel select:not([disabled])').length`), 0);
  } finally { await L.close(); }
});

test('the first prop on a fresh component opens the empty interface and fills the signature, and nothing more', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-sig-')), file = join(dir, 'Tile.tsx');
  writeFileSync(file, newComponentSource('Tile'));
  const store = await openStore(file), before = readFileSync(file, 'utf8');
  const { revision } = await store.read();
  const r = await store.apply({ baseRevision: revision, edits: [{ op: 'addProp', name: 'badge', type: 'boolean', default: true }], by: 'test' });
  assert.ok(r.ok, r.error);
  const after = readFileSync(file, 'utf8');
  assert.deepEqual(changedLines(before, after), { added: 4, removed: 2 }); // `interface TileProps {}` becomes a three-line block; the signature line is replaced by one line
  assert.match(after, /export function Tile\(\{ badge = true \}: TileProps\) \{/);
  await store.close();
});
