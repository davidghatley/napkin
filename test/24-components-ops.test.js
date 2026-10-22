// Components lane, ops: prop descriptions (JSDoc), reorder props, reorder variant values. Model + file, through the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../src/store.js';
import { applyEdits } from '../src/model.js';
import { changedLines } from './helpers/lab.js';

const src = readFileSync(new URL('../fixtures/Button/Button.tsx', import.meta.url), 'utf8');
async function open(text = src) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-cmp-'));
  const file = join(dir, 'Button.tsx');
  writeFileSync(file, text);
  return { file, store: await openStore(file) };
}
async function apply(h, edits) {
  const { revision } = await h.store.read();
  const r = await h.store.apply({ baseRevision: revision, edits, by: 'test' });
  assert.ok(r.ok, r.error);
  return r;
}

test('CMP-01 describeProp writes a /** */ line above the prop and reads it back', async () => {
  const h = await open();
  await apply(h, [{ op: 'describeProp', name: 'label', text: 'The words on the button' }]);
  const t = readFileSync(h.file, 'utf8');
  assert.match(t, /  \/\*\* The words on the button \*\/\n  label\?: string;/);
  assert.equal((await h.store.read()).doc.props[0].description, 'The words on the button');
  assert.deepEqual(changedLines(src, t), { added: 1, removed: 0 });
  await apply(h, [{ op: 'describeProp', name: 'label', text: 'Shorter' }]);
  assert.match(readFileSync(h.file, 'utf8'), /\/\*\* Shorter \*\/\n  label/);
  await apply(h, [{ op: 'describeProp', name: 'label', text: '' }]);
  assert.equal(readFileSync(h.file, 'utf8'), src);
  await h.store.close();
});

test('CMP-01 removing a described prop removes its comment too', async () => {
  const h = await open();
  await apply(h, [{ op: 'addProp', name: 'note', type: 'string', description: 'A note' }]);
  assert.match(readFileSync(h.file, 'utf8'), /\/\*\* A note \*\/\n  note\?: string;/);
  await apply(h, [{ op: 'removeProp', name: 'note' }]);
  assert.equal(readFileSync(h.file, 'utf8').split('export function')[0], src.split('export function')[0]); // (the signature line is laid out by the existing params rule)
  await h.store.close();
});

test('CMP-01 reorderProp moves the member, its comment and the parameter; undo-equivalent move back restores the bytes', async () => {
  const h = await open();
  await apply(h, [{ op: 'describeProp', name: 'size', text: 'How big' }]);
  const withDoc = readFileSync(h.file, 'utf8');
  await apply(h, [{ op: 'reorderProp', name: 'size', to: 0 }]);
  const t = readFileSync(h.file, 'utf8');
  assert.match(t, /interface ButtonProps \{\n  \/\*\* How big \*\/\n  size\?: [^\n]*\n  label\?: string;\n  state/);
  assert.match(t, /\{ size = 'md', label = 'Button', state = 'default' \}/);
  assert.match(t, /const v = \{ size, state \}/);
  assert.deepEqual((await h.store.read()).doc.props.map((p) => p.name), ['size', 'label', 'state']);
  await apply(h, [{ op: 'reorderProp', name: 'size', to: 1 }]);
  assert.equal(readFileSync(h.file, 'utf8'), withDoc);
  await h.store.close();
});

test('CMP-01 two props that look alike swap without being read as renames', () => {
  const doc = { format: 'napkin/1', name: 'X', props: [{ name: 'a', type: 'string' }, { name: 'b', type: 'string' }], root: { id: 'r', tag: 'div', style: {}, children: [] }, variants: {} };
  const out = applyEdits(doc, [{ op: 'reorderProp', name: 'b', to: 0 }]);
  assert.deepEqual(out.props.map((p) => p.name), ['b', 'a']);
  assert.throws(() => applyEdits(doc, [{ op: 'reorderProp', name: 'b', to: 5 }]), /bad position/);
});

test('CMP-02 reorderVariant moves one value: only the union line changes; the base stays the base', async () => {
  const h = await open();
  await apply(h, [{ op: 'reorderVariant', axis: 'size', value: 'lg', to: 0 }]);
  const t = readFileSync(h.file, 'utf8');
  assert.match(t, /size\?: 'lg' \| 'md' \| 'sm';/);
  assert.deepEqual(changedLines(src, t), { added: 1, removed: 1 });
  const d = (await h.store.read()).doc;
  assert.equal(d.props.find((p) => p.name === 'size').default, 'md');
  await h.store.close();
});

test('CMP-02 renaming a value touches only the lines naming it', async () => {
  const h = await open();
  await apply(h, [{ op: 'renameVariant', axis: 'size', value: 'sm', to: 'small' }]);
  const t = readFileSync(h.file, 'utf8');
  const c = changedLines(src, t);
  assert.deepEqual(c, { added: 2, removed: 2 }); // the union line and the variants key
  assert.match(t, /small: \{/);
  await h.store.close();
});
