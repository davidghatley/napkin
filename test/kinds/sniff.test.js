import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openItems } from '../../src/kinds/items.js';
test('content decides the kind when the name does not, and a recipe can override it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-sniff-'));
  try {
    writeFileSync(join(dir, 'page.bin'), '<!doctype html><html><body><h1>x</h1></body></html>');
    writeFileSync(join(dir, 'table.dat'), 'a,b,c\n1,2,3\n4,5,6\n7,8,9\n');
    writeFileSync(join(dir, 'events.txt'), '{"a":1}\n{"a":2}\n');
    writeFileSync(join(dir, 'config.dat'), '{"x":[1,2]}');
    writeFileSync(join(dir, 'plain.txt'), 'just some words\nand more\n');
    writeFileSync(join(dir, 'odd.bin'), Buffer.from([0, 1, 2, 3, 250, 251]));
    const items = openItems(dir, { stateDir: join(dir, '.state') });
    const kind = (id) => items.get(id).kind;
    assert.equal(kind('page.bin'), 'html');
    assert.equal(kind('table.dat'), 'csv');
    assert.equal(kind('events.txt'), 'jsonl');
    assert.equal(kind('config.dat'), 'json');
    assert.equal(kind('plain.txt'), 'txt');
    assert.equal(kind('odd.bin'), 'binary');
    // Explicit override through the control and recipe.
    const c = items.controls('odd.bin'),
      open = c.sections.flatMap((s) => s.controls).find((x) => x.id === 'view:kind');
    assert.ok(open && open.options.includes('csv'));
    items.control('odd.bin', 'view:kind', 'txt', c.revision, 'test');
    assert.equal(kind('odd.bin'), 'txt');
    items.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('item undo history survives a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-undo-'));
  try {
    writeFileSync(join(dir, 'c.json'), '{"a": 1}');
    const state = join(dir, '.state');
    let items = openItems(dir, { stateDir: state });
    const c = items.controls('c.json'),
      ctl = c.sections.flatMap((s) => s.controls).find((x) => x.label === 'a');
    items.control('c.json', ctl.id, 7, c.revision, 'me');
    items.close();
    items = openItems(dir, { stateDir: state });
    items.undo('c.json', 'me');
    assert.equal(JSON.parse((await import('node:fs')).readFileSync(join(dir, 'c.json'), 'utf8')).a, 1);
    items.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('the PDF zoom control changes what is drawn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-pdf-'));
  try {
    (await import('node:fs')).copyFileSync('test/kinds/samples/guide.pdf', join(dir, 'guide.pdf'));
    const items = openItems(dir, { stateDir: join(dir, '.state') });
    const size = async () => {
      const ctx = items.context('guide.pdf');
      const d = await ctx.definition.preview(ctx, new URLSearchParams());
      return { zoom: d.zoom, bytes: d.image.length };
    };
    const before = await size(),
      c = items.controls('guide.pdf');
    items.control('guide.pdf', 'view:zoom', 200, c.revision, 'me');
    const after = await size();
    assert.equal(after.zoom, 200);
    assert.ok(after.bytes > before.bytes * 1.5, JSON.stringify({ before, after }));
    items.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
