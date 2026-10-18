// Build-first #3 (F06): an agent can read and edit through MCP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/format.js';
import { getValue } from '../src/edits.js';
import { tempRepo, startServer, startMcp } from './helpers/harness.js';

test('scripted MCP client: list, read, apply_edits changes the file', async () => {
  const { file } = tempRepo();
  const server = await startServer(file);
  const mcp = await startMcp(file, server.url);
  try {
    assert.ok(mcp.init.result?.capabilities?.tools, 'initialize advertises tools');
    const tools = (await mcp.request('tools/list', {})).result.tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ['apply_edits', 'list_components', 'read_component']);
    const list = await mcp.call('list_components');
    assert.deepEqual(list.data, [{ id: 'cmp_card_01', name: 'Card' }]);
    const read = await mcp.call('read_component', { component: 'Card' });
    assert.equal(getValue(read.data.doc, 'title.fontWeight'), 400);
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: read.data.revision, edits: [{ op: 'set', path: 'title.fontWeight', value: 600 }] });
    assert.equal(r.isError, false, r.text);
    assert.equal(getValue(parse(readFileSync(file, 'utf8')), 'title.fontWeight'), 600);
    const stale = await mcp.call('apply_edits', { component: 'Card', baseRevision: read.data.revision, edits: [{ op: 'set', path: 'title.fontWeight', value: 700 }] });
    assert.equal(stale.isError, true);
    assert.match(stale.text, /stale revision/);
  } finally { mcp.stop(); await server.stop(); }
});
