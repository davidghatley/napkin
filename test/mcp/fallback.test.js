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

test('propose is refused in fallback mode: with no canvas there is nobody to review it', async () => {
  const { compDir, fileOf } = tempRepo();
  const mcp = await startMcp(DEAD, { NAPKIN_DIR: compDir, NAPKIN_AGENT: 'solo' });
  try {
    const before = readFileSync(fileOf('Card'), 'utf8');
    const rev = (await mcp.call('read_component', { component: 'Card' })).data.revision;
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 900 }], propose: true });
    assert.equal(r.isError, true); assert.match(r.text, /needs a running napkin canvas/);
    assert.equal(readFileSync(fileOf('Card'), 'utf8'), before);
    const v = await mcp.call('add_variant', { component: 'Button', baseRevision: 1, axis: 'size', value: 'xl', propose: true });
    assert.equal(v.isError, true);
    // a direct apply still works, and dryRun is unaffected
    assert.equal((await mcp.call('apply_edits', { component: 'Card', baseRevision: rev, edits: [{ op: 'set', path: 'title.fontWeight', value: 900 }], dryRun: true })).isError, false);
  } finally { mcp.stop(); }
});

test('the canvas server takes the same lock: it refuses to start while a fallback MCP holds the folder, naming the PID', async () => {
  const { compDir } = tempRepo();
  const mcp = await startMcp(DEAD, { NAPKIN_DIR: compDir });
  try {
    assert.equal((await mcp.call('list_components')).isError, false);
    await assert.rejects(startServer(compDir), (e) => { assert.match(e.message, new RegExp(`pid ${mcp.proc.pid}`)); assert.match(e.message, /exited 1/); return true; });
    mcp.stop();
    await waitFor(() => !existsSync(join(compDir, '.napkin', 'lock')), 3000);
    const server = await startServer(compDir); // released: now it starts
    try {
      assert.equal(parseInt(readFileSync(join(compDir, '.napkin', 'lock'), 'utf8'), 10), server.proc.pid);
      const second = startServer(compDir); // and a second server is refused in turn
      await assert.rejects(second, /exited 1/);
    } finally { await server.stop(); }
    assert.ok(!existsSync(join(compDir, '.napkin', 'lock')), 'a stopped server releases the lock');
  } finally { mcp.stop(); }
});

test('stale-lock takeover is race-free: 8 processes find a dead holder at once and exactly one wins', async () => {
  const { compDir } = tempRepo();
  mkdirSync(join(compDir, '.napkin'));
  const dead = spawn(process.execPath, ['-e', '0']); await new Promise((r) => dead.once('exit', r));
  const lockUrl = new URL('../../src/lock.js', import.meta.url).href;
  const script = `import(${JSON.stringify(lockUrl)}).then(({acquireLock})=>{ const go=Number(process.argv[2]); while(Date.now()<go); try{acquireLock(${JSON.stringify(compDir)});console.log('WON '+process.pid);setTimeout(()=>process.exit(0),700)}catch(e){console.log('LOST')}})`;
  for (let round = 0; round < 3; round++) {
    writeFileSync(join(compDir, '.napkin', 'lock'), `${dead.pid}\n`);
    const go = Date.now() + 1200; // all start from the same instant
    const procs = Array.from({ length: 8 }, () => spawn(process.execPath, ['-e', script, String(go)], { stdio: ['ignore', 'pipe', 'inherit'] }));
    const outs = await Promise.all(procs.map((p) => new Promise((r) => { let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('exit', () => r(o.trim())); })));
    const winners = outs.filter((o) => o.startsWith('WON'));
    assert.equal(winners.length, 1, `round ${round}: ${JSON.stringify(outs)}`);
    await waitFor(() => !existsSync(join(compDir, '.napkin', 'lock')), 3000);
  }
});
