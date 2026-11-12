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

// Rewritten for decision 0013 (lead ruling 2026-10-30): was a read-only dialect file refused as a whole ("read-only: line N: reason", panel disabled),
// now a /view frame that refuses one spot at a time ("line N: reason") and whose panel shows that spot disabled; intent unchanged.
test('a file outside the dialect refuses the spot computed in code with "line N: reason", its panel says so, disabled; the rest edits', { timeout: 90000 }, async () => {
  const SRC = (n) => `export function ${n}({ label }) { return <div className="x">hi {label}</div>; }\n`;
  const L = await lab({ Free: SRC('Free'), Edited: fx('Button').replace(/Button/g, 'Edited') });
  try {
    // a file that is valid TSX but outside the dialect: from the start, and after a hand edit takes it out of the dialect
    writeFileSync(join(L.compDir, 'Edited.tsx'), SRC('Edited'));
    await sleep(600);
    for (const n of ['Free', 'Edited']) {
      // Free is read-only from the start (a /view frame); Edited was in the dialect and a hand edit took it out: the dialect keeps its last good cell and says why,
      // and the file's own edit path (the engine's) refuses and accepts the same way for both.
      const id = `${n}.tsx#${n}`;
      const tree = JSON.parse(await L.q(`fetch('/api/component/' + encodeURIComponent(${JSON.stringify(id)})).then((r) => r.text())`)), node = tree.tree[0].node;
      const post = (edits) => L.q(`napkin.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: ${JSON.stringify(id)}, baseRevision: ${JSON.stringify(tree.revision)}, edits: ${JSON.stringify(edits)} }) }).then((r) => r.json()).then(JSON.stringify)`).then(JSON.parse);
      const before = readFileSync(join(L.compDir, `${n}.tsx`), 'utf8');
      const r = await post([{ op: 'text', node, run: 1, value: 'z' }]);
      assert.equal(r.ok, false, n);
      assert.match(r.error, /line \d+/, n); assert.match(r.error, /computed in code/, n);
      assert.doesNotMatch(r.error, /has a syntax error/);
      assert.equal(readFileSync(join(L.compDir, `${n}.tsx`), 'utf8'), before, 'nothing written');
      const ok = await post([{ op: 'style', node, prop: 'padding', value: '4px' }]); // the editable spots of the same file work
      assert.ok(ok.ok !== false, JSON.stringify(ok));
      const was = before.split('\n'), now = readFileSync(join(L.compDir, `${n}.tsx`), 'utf8').split('\n');
      assert.equal(now.filter((l, i) => l !== was[i]).length, 1, `${n}: one line changed`);
    }
    const c = await centerOf(L.browser, `document.querySelector('section[data-name=Free] .cmp-head h3')`);
    await L.io.click(c.x, c.y); await sleep(300);
    await L.browser.waitFor(`document.querySelector('#panel .doc-run[disabled]')`);
    assert.match(await L.q(`document.querySelector('#panel .doc-run[disabled]').title`), /Computed in code/);
    assert.equal(await L.q(`document.querySelectorAll('#panel .doc-run:not([disabled])').length`), 1, 'the other run stays editable');
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
