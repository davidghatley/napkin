// AGT-08: with no canvas server, MCP runs its own store on NAPKIN_DIR under a single-writer lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { connectCanvas } from '../../src/canvas-client.js';
import { acquireLock, LockError } from '../../src/lock.js';
import { tempRepo, startServer, startMcp, waitFor } from '../helpers/harness.js';

const DEAD = 'http://127.0.0.1:1/'; // nothing listens here

test('with no server, edits land through the in-process store; a canvas started later shows them', async () => {
  const { compDir } = tempRepo();
  const mcp = await startMcp(DEAD, { NAPKIN_DIR: compDir, NAPKIN_AGENT: 'solo' });
  try {
    const list = await mcp.call('list_components');
    assert.equal(list.isError, false, list.text);
    assert.deepEqual(list.data.map((c) => c.name).sort(), ['Button', 'Card']);
    const lock = join(compDir, '.napkin', 'lock');
    assert.ok(existsSync(lock), 'lock file exists');
    assert.equal(parseInt(readFileSync(lock, 'utf8'), 10), mcp.proc.pid, 'lock holds the holder PID');
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 900 }] });
    assert.equal(r.isError, false, r.text);
    assert.match(readFileSync(join(compDir, 'Card.tsx'), 'utf8'), /fontWeight: 900/);
    const stale = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 100 }] });
    assert.equal(stale.isError, true); assert.equal(stale.data.stale[0].by, 'solo');
    const made = await mcp.call('create_component', { name: 'Tag' });
    assert.equal(made.isError, false, made.text);
    const img = await mcp.request('tools/call', { name: 'render_component', arguments: { component: 'Card' } });
    assert.ok(img.result.content.some((c) => c.type === 'image'), 'render works with no server too');
    mcp.stop();
    await waitFor(() => !existsSync(lock), 3000);
    // now a canvas server starts on the same folder and shows the edit
    const server = await startServer(compDir);
    try {
      const c = await connectCanvas(server.url, { by: 'david' });
      assert.equal(c.state('Card').doc.root.children.find((n) => n.id === 'title').style.fontWeight, 900);
      assert.ok(c.state('Tag'));
      c.close();
    } finally { await server.stop(); }
  } finally { mcp.stop(); }
});

test('the lock admits one live holder; a stale lock from a dead process is taken over', async () => {
  const { compDir } = tempRepo();
  const holder = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  try {
    mkdirSync(join(compDir, '.napkin'));
    writeFileSync(join(compDir, '.napkin', 'lock'), `${holder.pid}\n`);
    assert.throws(() => acquireLock(compDir), LockError);
    const mcp = await startMcp(DEAD, { NAPKIN_DIR: compDir });
    try {
      const r = await mcp.call('list_components');
      assert.equal(r.isError, true); assert.match(r.text, new RegExp(`pid ${holder.pid}`));
    } finally { mcp.stop(); }
    holder.kill('SIGKILL'); await new Promise((r) => holder.once('exit', r));
    const lock = acquireLock(compDir); // the holder is dead: take over
    assert.equal(parseInt(readFileSync(lock.file, 'utf8'), 10), process.pid);
    lock.release();
    assert.ok(!existsSync(lock.file));
  } finally { holder.kill('SIGKILL'); }
});
