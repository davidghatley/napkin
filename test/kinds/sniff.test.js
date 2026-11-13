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
