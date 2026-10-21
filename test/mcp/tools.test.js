// AGT-01: every tool is listed by tools/list with an input schema; the guide is a resource and a prompt (AGT-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempRepo, startServer, startMcp } from '../helpers/harness.js';

const EXPECTED = ['add_variant', 'apply_edits', 'create_component', 'delete_component', 'list_components', 'propose_adoption', 'read_component', 'rename_component', 'render_component', 'search', 'subscribe'];

test('tools/list lists every tool with an object input schema and a description; apply_edits has dryRun and propose', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    const { tools } = (await mcp.request('tools/list', {})).result;
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED);
    for (const t of tools) {
      assert.equal(t.inputSchema?.type, 'object', `${t.name} schema`);
      assert.ok(t.description.length > 20, `${t.name} description`);
      for (const r of t.inputSchema.required || []) assert.ok(r in t.inputSchema.properties, `${t.name}: required "${r}" is declared`);
    }
    const apply = tools.find((t) => t.name === 'apply_edits').inputSchema.properties;
    assert.ok(apply.dryRun && apply.propose);
    assert.ok(mcp.init.result.instructions.includes('napkin://guide'));
  } finally { mcp.stop(); await server.stop(); }
});

test('the guide is served as a resource and as a prompt, and covers ops, propose mode and stale handling', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    assert.ok(mcp.init.result.capabilities.resources && mcp.init.result.capabilities.prompts);
    const list = (await mcp.request('resources/list', {})).result.resources;
    assert.deepEqual(list.map((r) => r.uri), ['napkin://guide']);
    const text = (await mcp.request('resources/read', { uri: 'napkin://guide' })).result.contents[0].text;
    for (const word of ['"op": "set"', 'insert', 'addVariant', 'propose', 'stale', 'currentRevision', 'baseRevision', 'dryRun']) assert.ok(text.includes(word), `guide mentions ${word}`);
    const prompts = (await mcp.request('prompts/list', {})).result.prompts;
    assert.equal(prompts[0].name, 'napkin_guide');
    const got = (await mcp.request('prompts/get', { name: 'napkin_guide' })).result;
    assert.equal(got.messages[0].content.text, text);
    assert.ok((await mcp.request('resources/read', { uri: 'napkin://nope' })).error);
  } finally { mcp.stop(); await server.stop(); }
});
