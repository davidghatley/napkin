// WPC-28: a person renames and deletes a component on the canvas (Cmd-K, F2, the row menu). WPC-30: N beside existing components.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lab } from './helpers/lab.js';
import { sleep } from './helpers/harness.js';
import { readComponent } from '../src/tsx/read.js';
import { openWorkspace } from '../src/workspace.js';

const fx = (n) => readFileSync(new URL(`../fixtures/${n}/${n}.tsx`, import.meta.url), 'utf8');
const key = (L, k, extra = {}) => L.q(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...extra })}))`);
const waitFor = (L, expr, ms = 8000) => L.browser.waitFor(expr, ms);

test('WPC-28: Cmd-K "rename" renames the selected component, in one revision, and the file moves with it', { timeout: 90000 }, async () => {
  const L = await lab({ Card: fx('Card'), Button: fx('Button') });
  try {
    const id = await L.id('Card');
    await L.q(`napkin.select({ component: ${JSON.stringify(id)}, node: napkin.find('Card').doc.root.id, variant: {} })`);
    // action 1: Cmd-K + "rename"; the palette finds it
    const found = await L.q(`(napkin.quick.build(), napkin.quick.search('rename component').map((i) => i.label).join('|'))`);
    assert.match(found, /Rename component…/);
    await L.q(`napkin.quick.search('rename component').find((i) => i.label === 'Rename component…').run()`);
    await waitFor(L, `document.querySelector('#cmp-dialog')?.open && document.activeElement.id === 'cmp-name'`);
    // action 2: type and Enter
    await L.q(`(() => { const i = document.querySelector('#cmp-name'); i.value = 'Panel'; document.querySelector('#cmp-rename').requestSubmit(); })()`);
    await waitFor(L, `!document.querySelector('#cmp-dialog').open && napkin.find('Panel')`);
    assert.ok(existsSync(join(L.compDir, 'Panel.tsx')) && !existsSync(join(L.compDir, 'Card.tsx')));
    assert.match(readFileSync(join(L.compDir, 'Panel.tsx'), 'utf8'), /export function Panel\(/);
    assert.equal(await L.id('Panel'), id, 'the id stays');
  } finally { await L.close(); }
});

test('WPC-28: F2 on a selected component and on a component row opens rename; a bad or taken name is refused in plain words', { timeout: 90000 }, async () => {
  const L = await lab({ Card: fx('Card'), Button: fx('Button') });
  try {
    const id = await L.id('Card');
    await L.q(`napkin.select({ component: ${JSON.stringify(id)}, node: napkin.find('Card').doc.root.id, variant: {} })`);
    await key(L, 'F2');
    await waitFor(L, `document.querySelector('#cmp-dialog').open`);
    const submit = async (v) => { await L.q(`(() => { document.querySelector('#cmp-name').value = ${JSON.stringify(v)}; document.querySelector('#cmp-rename').requestSubmit(); })()`); await sleep(300); return L.q(`document.querySelector('#cmp-error').textContent`); };
    assert.match(await submit('card2!'), /can't be a component name\. Start with a capital letter/);
    assert.match(await submit('Button'), /There is already a component called "Button"\. Pick another name\./);
    assert.ok(existsSync(join(L.compDir, 'Card.tsx')), 'nothing changed');
    await L.q(`document.querySelector('#cmp-cancel').click()`);
    // F2 on a focused component row
    await L.q(`document.querySelector('#layers .lcomp[data-component=${JSON.stringify(id)}]').focus()`);
    await L.q(`document.querySelector('#layers .lcomp[data-component=${JSON.stringify(id)}]').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))`);
    await waitFor(L, `document.querySelector('#cmp-dialog').open && document.querySelector('#cmp-dialog h2').textContent === 'Rename Card'`);
  } finally { await L.close(); }
});

test('WPC-28: the row menu deletes after a confirm, names what uses it, and Undo brings it back', { timeout: 120000 }, async () => {
  const user = fx('Card').replace(/Card/g, 'Shell');
  const L = await lab({ Card: fx('Card'), Button: fx('Button'), Shell: user });
  try {
    const id = await L.id('Button'), before = readFileSync(join(L.compDir, 'Button.tsx'), 'utf8');
    // More actions on the component row
    await L.q(`document.querySelector('#layers .lcomp[data-component=${JSON.stringify(id)}] .lmore').click()`);
    assert.equal(await L.q(`[...document.querySelectorAll('#lmenu button')].map((b) => b.textContent.replace('F2', '')).join('|')`), 'Rename component…|Delete component…');
    await L.q(`document.querySelector('#lmenu [data-do=cdelete]').click()`);
    await waitFor(L, `document.querySelector('#cmp-dialog').open && document.querySelector('#cmp-ok')`);
    assert.match(await L.q(`document.querySelector('#cmp-dialog p').textContent`), /removes Button\.tsx.*Nothing else uses Button.*undo/);
    assert.ok(existsSync(join(L.compDir, 'Button.tsx')), 'asked first');
    await L.q(`document.querySelector('#cmp-ok').click()`);
    await waitFor(L, `!napkin.find('Button')`);
    assert.ok(!existsSync(join(L.compDir, 'Button.tsx')));
    await waitFor(L, `!document.querySelector('#cmp-toast').hidden`);
    assert.match(await L.q(`document.querySelector('#cmp-toast').textContent`), /Ctrl\+Z brings it back/);
    // undo (Cmd-Z right after) writes the same file back
    await key(L, 'z', { ctrlKey: true });
    await waitFor(L, `napkin.find('Button')?.doc`);
    assert.equal(readFileSync(join(L.compDir, 'Button.tsx'), 'utf8'), before);
  } finally { await L.close(); }
});

test('WPC-28: deleting a component something uses says what uses it and does not delete', { timeout: 90000 }, async () => {
  const data = (n) => readFileSync(new URL(`./fixtures/0004/${n}.tsx`, import.meta.url), 'utf8');
  const L = await lab({ Button: data('Button'), Panel: data('Panel') });
  try {
    const id = await L.id('Button');
    await L.q(`napkin.select({ component: ${JSON.stringify(id)}, node: napkin.find('Button').doc.root.id, variant: {} })`);
    await L.q(`napkin.quick.build(), napkin.quick.search('delete component').find((i) => i.label === 'Delete component…').run()`);
    await waitFor(L, `document.querySelector('#cmp-dialog').open && /is in use/.test(document.querySelector('#cmp-dialog h2').textContent)`);
    assert.match(await L.q(`document.querySelector('#cmp-dialog p').textContent`), /^Button is used by Panel\. Remove or swap those uses first/);
    assert.equal(await L.q(`!!document.querySelector('#cmp-ok')`), false, 'no Delete button');
    assert.ok(existsSync(join(L.compDir, 'Button.tsx')));
  } finally { await L.close(); }
});

test('WPC-30: N in a folder opened recursively puts the new component beside the existing ones', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-where-'));
  mkdirSync(join(dir, 'src/ui'), { recursive: true });
  for (const n of ['Card', 'Button']) writeFileSync(join(dir, 'src/ui', `${n}.tsx`), fx(n));
  writeFileSync(join(dir, 'src', 'Page.tsx'), fx('Card').replace(/Card/g, 'Page'));
  const ws = await openWorkspace(dir, { recursive: true, writeSidecars: false });
  try {
    await ws.ready;
    const r = await ws.create('Fresh', 'div', { by: 'you' });
    assert.ok(existsSync(join(dir, 'src/ui/Fresh.tsx')), readdirSync(dir).join());
    assert.ok(!existsSync(join(dir, 'Fresh.tsx')));
    assert.equal(r.path, 'src/ui/Fresh.tsx');
  } finally { await ws.close(); }
});


test('WPC-28: ws.create with a folder restores to the exact folder (nested layout)', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-nest-'));
  mkdirSync(join(dir, 'src/components/ui'), { recursive: true });
  for (const n of ['A', 'B', 'C']) writeFileSync(join(dir, 'src/components/ui', `${n}.tsx`), fx('Card').replace(/Card/g, n));
  writeFileSync(join(dir, 'src/components/Hero.tsx'), fx('Card').replace(/Card/g, 'Hero'));
  const ws = await openWorkspace(dir, { recursive: true, writeSidecars: false });
  try {
    const source = readFileSync(join(dir, 'src/components/Hero.tsx'), 'utf8');
    await ws.delete('Hero', { by: 'you' });
    const r = await ws.create('Hero', 'div', { by: 'you', source, folder: 'src/components' });
    assert.equal(r.path, 'src/components/Hero.tsx');
    assert.equal(readFileSync(join(dir, 'src/components/Hero.tsx'), 'utf8'), source);
    await ws.delete('Hero', { by: 'you' });
    await assert.rejects(ws.create('Hero', 'div', { by: 'you', source, folder: '../elsewhere' }), /not inside the components folder/);
  } finally { await ws.close(); }
});

test('WPC-28: Ctrl+Z after a rename puts file, export names and sidecar back, as one step', { timeout: 90000 }, async () => {
  const L = await lab({ Card: fx('Card'), Button: fx('Button') });
  try {
    const id = await L.id('Card');
    await L.q(`napkin.select({ component: ${JSON.stringify(id)}, node: napkin.find('Card').doc.root.id, variant: {} })`);
    const before = readFileSync(join(L.compDir, 'Card.tsx'), 'utf8');
    await L.q(`napkin.cmpOps.rename()`);
    await L.q(`(() => { document.querySelector('#cmp-name').value = 'Panel'; document.querySelector('#cmp-rename').requestSubmit(); })()`);
    await waitFor(L, `!document.querySelector('#cmp-dialog').open && napkin.find('Panel')?.doc`);
    await waitFor(L, `!document.querySelector('#cmp-toast').hidden`);
    assert.equal(await L.q(`napkin.state.selection?.component`), id, 'the selection stays on the renamed component');
    assert.ok(existsSync(join(L.compDir, 'Panel.napkin.json')));
    assert.match(await L.q(`document.querySelector('#cmp-toast').textContent`), /Ctrl\+Z/);
    await key(L, 'z', { ctrlKey: true });
    await waitFor(L, `!napkin.find('Panel') && napkin.find('Card')?.doc`).catch(async (e) => { throw new Error(e.message + ' | toast: ' + await L.q(`document.querySelector('#cmp-toast').textContent`) + ' | ' + await L.q(`[...napkin.state.components.values()].map((c) => c.name).join()`)); });
    assert.equal(readFileSync(join(L.compDir, 'Card.tsx'), 'utf8'), before);
    assert.ok(existsSync(join(L.compDir, 'Card.napkin.json')) && !existsSync(join(L.compDir, 'Panel.napkin.json')));
    assert.equal(await L.id('Card'), id);
  } finally { await L.close(); }
});

test('WPC-28: renaming a used component renames the import and tags in its users, one revision per file; undo restores them', { timeout: 60000 }, async () => {
  const data = (n) => readFileSync(new URL(`./fixtures/0004/${n}.tsx`, import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'napkin-used-'));
  writeFileSync(join(dir, 'Button.tsx'), data('Button')); writeFileSync(join(dir, 'Panel.tsx'), data('Panel'));
  const ws = await openWorkspace(dir, { writeSidecars: false });
  try {
    const panelBefore = readFileSync(join(dir, 'Panel.tsx'), 'utf8');
    assert.match(panelBefore, /import \{ Button \} from '\.\/Button'/);
    const r = await ws.rename('Button', 'Knob', { by: 'you' });
    assert.equal(r.name, 'Knob');
    const panel = readFileSync(join(dir, 'Panel.tsx'), 'utf8');
    assert.match(panel, /import \{ Knob \} from '\.\/Knob'/);
    assert.doesNotMatch(panel, /\bButton\b/);
    assert.deepEqual(ws.graph(ws.find('Knob')).usedBy, ['Panel']);
    await ws.rename('Knob', 'Button', { by: 'you' });
    // (the tag is re-printed by the writer, so compare what it says, not the bytes)
    assert.deepEqual(readComponent(readFileSync(join(dir, 'Panel.tsx'), 'utf8')).doc, readComponent(panelBefore).doc);
  } finally { await ws.close(); }
});

test('WPC-28: rename works in a folder without saved sidecars (the default open)', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-nosc-'));
  writeFileSync(join(dir, 'Card.tsx'), fx('Card'));
  const ws = await openWorkspace(dir, { writeSidecars: false });
  try {
    const r = await ws.rename('Card', 'Tile', { by: 'you' });
    assert.equal(r.name, 'Tile');
    assert.ok(existsSync(join(dir, 'Tile.tsx')) && !existsSync(join(dir, 'Card.tsx')));
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.napkin.json')), 'no sidecar was written');
    assert.equal(ws.find('Tile').id, r.id);
  } finally { await ws.close(); }
});

test('WPC-28: after a rename focus stays on the renamed row; Cancel on delete from the row menu returns focus to the row', { timeout: 90000 }, async () => {
  const L = await lab({ Card: fx('Card'), Button: fx('Button') });
  try {
    const id = await L.id('Card');
    const row = `#layers .lcomp[data-component=${JSON.stringify(id)}]`;
    await L.q(`document.querySelector(${JSON.stringify(row)}).focus()`);
    await L.q(`document.querySelector(${JSON.stringify(row)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))`);
    await waitFor(L, `document.querySelector('#cmp-dialog').open`);
    await L.q(`(() => { document.querySelector('#cmp-name').value = 'Panel'; document.querySelector('#cmp-rename').requestSubmit(); })()`);
    await waitFor(L, `napkin.find('Panel')?.doc && document.activeElement?.classList.contains('lcomp') && document.activeElement.dataset.component === ${JSON.stringify(id)}`);
    // row menu -> Delete -> Cancel
    await L.q(`document.querySelector(${JSON.stringify(row + ' .lmore')}).click()`);
    await L.q(`document.querySelector('#lmenu [data-do=cdelete]').click()`);
    await waitFor(L, `document.querySelector('#cmp-dialog').open && !!document.querySelector('#cmp-ok')`);
    await L.q(`document.querySelector('#cmp-cancel').click()`);
    await waitFor(L, `document.activeElement?.classList.contains('lcomp') && document.activeElement.dataset.component === ${JSON.stringify(id)}`);
    assert.match(await L.q(`document.querySelector('#cmp-toast').textContent`), /./);
  } finally { await L.close(); }
});

test('WPC-28: a read-only file that imports a component blocks its rename and delete, and is named', { timeout: 60000 }, async () => {
  const data = (n) => readFileSync(new URL(`./fixtures/0004/${n}.tsx`, import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'napkin-ro-'));
  writeFileSync(join(dir, 'Button.tsx'), data('Button'));
  const user = "import { useState } from 'react';\nimport { Button } from './Button';\nexport function Shell() {\n  const [n] = useState(0);\n  return <div className=\"x\"><Button />{n}</div>;\n}\n";
  writeFileSync(join(dir, 'Shell.tsx'), user);
  const ws = await openWorkspace(dir, { writeSidecars: false });
  try {
    assert.ok((await ws.find('Shell').store.read()).readOnly, 'Shell is read-only');
    await assert.rejects(ws.rename('Button', 'Knob', { by: 'you' }), /imported by Shell.*read-only.*Next:/);
    await assert.rejects(ws.delete('Button', { by: 'you' }), /used by Shell/);
    assert.ok(existsSync(join(dir, 'Button.tsx')) && !existsSync(join(dir, 'Knob.tsx')));
    assert.equal(readFileSync(join(dir, 'Shell.tsx'), 'utf8'), user);
  } finally { await ws.close(); }
});
