// Build-first #3 (F06), on TSX and a folder: an agent can list, read and edit through MCP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getValue } from '../src/model.js';
import { readComponent } from '../src/tsx/read.js';
import { tempRepo, startServer, startMcp } from './helpers/harness.js';

test('scripted MCP client: list, read (with source), apply_edits changes the file', async () => {
  const { compDir, file } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    assert.ok(mcp.init.result?.capabilities?.tools, 'initialize advertises tools');
    const tools = (await mcp.request('tools/list', {})).result.tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ['apply_edits', 'list_components', 'read_component']);
    const list = await mcp.call('list_components');
    assert.deepEqual(list.data.map((c) => c.name).sort(), ['Button', 'Card']);
    assert.ok(list.data.every((c) => /^cmp_/.test(c.id) && !c.readOnly));
    const read = await mcp.call('read_component', { component: 'Card' });
    assert.equal(read.data.component, list.data.find((c) => c.name === 'Card').id);
    assert.equal(getValue(read.data.doc, 'title.fontWeight'), 400);
    assert.equal(read.data.source, readFileSync(file, 'utf8'), 'read_component returns the TSX text');
    const byId = await mcp.call('read_component', { component: read.data.component });
    assert.equal(byId.data.revision, read.data.revision, 'id and name both work');
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: read.data.revision, edits: [{ op: 'set', path: 'title.fontWeight', value: 600 }] });
    assert.equal(r.isError, false, r.text);
    assert.equal(getValue(readComponent(readFileSync(file, 'utf8')).doc, 'title.fontWeight'), 600);
    const stale = await mcp.call('apply_edits', { component: 'Card', baseRevision: read.data.revision, edits: [{ op: 'set', path: 'title.fontWeight', value: 700 }] });
    assert.equal(stale.isError, true);
    assert.match(stale.text, /stale revision/);
  } finally { mcp.stop(); await server.stop(); }
});
