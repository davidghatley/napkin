// INV-04: a 50-file out-of-dialect corpus (hooks, maps, ternaries, spreads, class components, syntax errors, ...).
// Each file opens read-only with a reason that names a line, and every way to write is refused: store.apply, the HTTP
// edits endpoint, and the MCP apply_edits / add_variant tools. The .tsx bytes (sha256) must not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { openStore } from '../../src/store.js';
import { makeOutOfDialect, OUT_OF_DIALECT } from '../helpers/corpus.js';
import { ROOT, startServer, startMcp } from '../helpers/harness.js';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const EDIT = [{ op: 'set', path: 'root.gap', value: 3 }];

test('INV-04: 50 out-of-dialect files: read-only with a line number, every write path refuses, bytes unchanged', async (t) => {
  assert.equal(OUT_OF_DIALECT.length, 50);
  const dir = mkdtempSync(join(tmpdir(), 'napkin-ood-'));
  const cases = makeOutOfDialect(dir, ROOT);
  const before = new Map(cases.map((c) => [c.file, sha(c.file)]));
  assert.equal(new Set(before.values()).size, 50, 'fifty different files');

  await t.test('store: readOnly names a line that holds the offending code; apply refuses', async () => {
    let n = 0;
    for (const c of cases) {
      const store = await openStore(c.file);
      try {
        const r = await store.read();
        assert.match(r.readOnly || '', /^line \d+: /, `${c.name}: reason with a line`);
        const line = Number(r.readOnly.match(/^line (\d+)/)[1]);
        const lines = c.text.split('\n');
        if (c.token) assert.ok(lines[line - 1]?.includes(c.token), `${c.name}: line ${line} should contain ${JSON.stringify(c.token)} but is ${JSON.stringify(lines[line - 1])}`);
        else assert.ok(line >= 1 && line <= lines.length + 1, `${c.name}: line ${line} is inside the file`);
        for (const dryRun of [false, true]) {
          const w = await store.apply({ baseRevision: r.revision, edits: EDIT, by: 'test', dryRun });
          assert.equal(w.ok, false, c.name);
          assert.match(w.error, /^read-only: line \d+: /, c.name);
        }
        n++;
      } finally { await store.close(); }
    }
    assert.equal(n, 50);
  });

  await t.test('server: HTTP edits, MCP apply_edits and add_variant, and create_component over an existing name all refuse', async () => {
    const server = await startServer(dir);
    const mcp = await startMcp(server.url);
    try {
      const list = await (await fetch(new URL('api/components', server.url))).json();
      assert.equal(list.length, 50);
      assert.ok(list.every((x) => /^line \d+: /.test(x.readOnly || '')), 'every component is listed as read-only with a line');
      let http = 0, viaMcp = 0, variant = 0, create = 0;
      for (const c of cases) {
        const stem = basename(c.file, '.tsx');
        const r = await fetch(new URL(`api/components/${stem}/edits`, server.url), { method: 'POST', body: JSON.stringify({ baseRevision: 'x', edits: EDIT, by: 'test' }) });
        const body = await r.json();
        assert.equal(r.status, 409, c.name);
        assert.match(body.error, /^read-only: line \d+: /, c.name); http++;
        const m = await mcp.call('apply_edits', { component: stem, baseRevision: 'x', edits: EDIT });
        assert.equal(m.isError, true, c.name);
        assert.match(m.text, /^read-only: line \d+: /, c.name); viaMcp++;
        const v = await mcp.call('add_variant', { component: stem, baseRevision: 'x', axis: 'size', value: 'xl' });
        assert.equal(v.isError, true, c.name);
        assert.match(v.text, /^read-only: line \d+: /, c.name); variant++;
        const cr = await fetch(new URL('api/components', server.url), { method: 'POST', body: JSON.stringify({ name: stem }) });
        assert.equal(cr.status, 409, `${c.name}: create over an existing file`); create++;
      }
      console.log(`INV-04: refused ${http} HTTP edits, ${viaMcp} MCP apply_edits, ${variant} MCP add_variant, ${create} create_component over an existing name`);
    } finally { mcp.stop(); await server.stop(); }
  });

  await t.test('sha256 of all 50 files is unchanged', () => {
    let same = 0;
    for (const [f, h] of before) { assert.equal(sha(f), h, basename(f)); same++; }
    console.log(`INV-04: sha256 unchanged ${same}/50`);
    assert.equal(same, 50);
  });
});
