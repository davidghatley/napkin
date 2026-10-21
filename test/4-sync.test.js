// Build-first #4 (F07): changes flow both ways live, in under 1 second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getValue } from '../src/model.js';
import { tempRepo, startServer, startMcp, waitFor } from './helpers/harness.js';
import { connectCanvas } from '../src/canvas-client.js';

test('live sync between canvas socket, MCP agent and the file', async (t) => {
  const { compDir, git } = tempRepo();
  const file = `${compDir}/Card.tsx`;
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  const canvas = await connectCanvas(server.url);
  const seen = []; canvas.onChange((c) => seen.push({ ...c, at: performance.now() }));
  try {
    await t.test('agent edit reaches the canvas socket in under 1 s', async () => {
      const read = await mcp.call('read_component', { component: 'Card' });
      const t0 = performance.now();
      const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: read.data.revision, edits: [{ op: 'set', path: 'title.fontWeight', value: 600 }] });
      assert.equal(r.isError, false, r.text);
      const { value } = await waitFor(() => seen.find((c) => c.revision === r.data.revision), 1000);
      t.diagnostic(`agent -> canvas: ${(value.at - t0).toFixed(1)} ms`);
      assert.ok(value.at - t0 < 1000);
      assert.equal(value.by, 'agent');
      assert.equal(getValue(value.doc, 'title.fontWeight'), 600);
    });
    await t.test('canvas edit reaches the agent as a change notice with the new revision in under 1 s', async () => {
      const t0 = performance.now();
      const r = await canvas.sendEdits('Card', canvas.state('Card').revision, [{ op: 'set', path: 'card.padding', value: '24px' }]);
      assert.equal(r.ok, true, r.error);
      const { value } = await waitFor(() => mcp.notifications.find((n) => n.method === 'notifications/napkin/change' && n.params.revision === r.revision), 1000);
      t.diagnostic(`canvas -> agent: ${(value.at - t0).toFixed(1)} ms`);
      assert.ok(value.at - t0 < 1000);
      assert.equal(value.params.by, 'you');
      assert.equal(value.params.component, canvas.state('Card').component);
      assert.match(readFileSync(file, 'utf8'), /padding: '24px'/);
    });
    await t.test('git restore shows on the canvas socket within 1 s', async () => {
      const t0 = performance.now();
      git('restore', 'components/Card.tsx');
      const { value } = await waitFor(() => { const s = canvas.state('Card'); return getValue(s.doc, 'card.padding') === '16px' && getValue(s.doc, 'title.fontWeight') === 400 && s; }, 1000);
      t.diagnostic(`git restore -> canvas: ${(performance.now() - t0).toFixed(1)} ms`);
      assert.ok(seen.some((c) => c.by === 'file'));
      assert.ok(value);
    });
  } finally { canvas.close(); mcp.stop(); await server.stop(); }
});
