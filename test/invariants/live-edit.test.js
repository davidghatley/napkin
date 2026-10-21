// FMT-07: a hand edit in an editor while the server is open becomes a revision within 1 s, and no canvas edit is lost.
// A real server runs on a temp folder. The test plays the editor (writes the file directly, or the way vim does:
// write a new file and rename it over) and, without waiting, plays the canvas (HTTP edits against the revision it
// last saw). Every round touches different properties, so every change from both sides must be in the file at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, startServer, sleep } from '../helpers/harness.js';
import { session } from '../helpers/agents.js';
import { connectCanvas } from '../../src/canvas-client.js';
import { readComponent } from '../../src/tsx/read.js';

test('FMT-07: hand edits show up as revisions within 1 s while canvas edits keep landing (interleaved, 0 lost)', async () => {
  const { compDir, fileOf } = tempRepo(['Button']);
  const file = fileOf('Button');
  const server = await startServer(compDir);
  const canvas = await connectCanvas(server.url, { by: 'canvas' });
  const token = await session(server.url, 'david');
  const api = (path, init = {}) => fetch(new URL(path, server.url), { ...init, headers: { ...(init.body && { 'content-type': 'application/json' }), authorization: `Bearer ${token}` } }).then((r) => r.json());
  const ROUNDS = 12;
  const PROPS = ['margin', 'padding', 'color', 'gap', 'width', 'height', 'top', 'left', 'right', 'bottom', 'opacity', 'zIndex']; // one property per round: no round edits a key an earlier round's canvas edit still has in flight
  const latencies = [];
  let retried = 0;
  try {
    for (let i = 0; i < ROUNDS; i++) {
      const rev0 = canvas.state('Button').revision;
      // the editor: change the fontSize of the root (a base property)
      const hand = readFileSync(file, 'utf8').replace(/^(\s+fontSize: )\d+,$/m, `$1${20 + i},`);
      assert.notEqual(hand, readFileSync(file, 'utf8'));
      const seen = new Promise((resolve) => {
        const t0 = performance.now();
        const off = canvas.onChange((c) => { if (c.type === 'change' && c.by === 'file' && c.doc.root.style.fontSize === 20 + i) { off?.(); resolve(performance.now() - t0); } });
      });
      if (i % 2) { const tmp = join(compDir, '.Button.tsx.vim'); writeFileSync(tmp, hand); renameSync(tmp, file); } // atomic, like many editors
      else writeFileSync(file, hand); // in place
      // the canvas, at once and still holding the revision from before the hand edit: a different property
      let r = await api('api/components/Button/edits', { method: 'POST', body: JSON.stringify({ baseRevision: rev0, edits: [{ op: 'set', path: `label.${PROPS[i]}`, value: `${300 + i}px` }], by: 'canvas' }) });
      for (let k = 0; !r.ok && /read-only: the file on disk is not valid/.test(r.error) && k < 5; k++) { retried++; await sleep(30); r = await api('api/components/Button/edits', { method: 'POST', body: JSON.stringify({ baseRevision: rev0, edits: [{ op: 'set', path: `label.${PROPS[i]}`, value: `${300 + i}px` }], by: 'canvas' }) }); }
      assert.equal(r.ok, true, `round ${i}: canvas edit refused: ${r.error}`);
      latencies.push(await Promise.race([seen, sleep(3000).then(() => Infinity)]));
      // both changes are in the file now
      const doc = readComponent(readFileSync(file, 'utf8')).doc;
      assert.equal(doc.root.style.fontSize, 20 + i, `round ${i}: the hand edit survived the canvas edit`);
      assert.equal(doc.root.children[0].style[PROPS[i]], `${300 + i}px`, `round ${i}: the canvas edit landed`);
    }
    // and the server's idea of the document is the file
    const served = await api('api/components/Button');
    assert.equal(served.source, readFileSync(file, 'utf8'));
    const max = Math.max(...latencies);
    console.log(`FMT-07: ${ROUNDS} rounds, 0 lost edits; hand edit -> revision seen after ${latencies.map((x) => x.toFixed(0)).join(', ')} ms (max ${max.toFixed(0)} ms; ${retried} canvas retries while a half-written file was on disk)`);
    assert.ok(max <= 1000, `a hand edit took ${max} ms to show`);
  } finally { canvas.close(); await server.stop(); }
});

// The narrow race: a hand edit lands after the store re-read the file but before its rename. The test plays the editor from
// inside the first fsync of the temp file (which happens in exactly that window).
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { openStore } from '../../src/store.js';

async function withEditorInTheWindow(file, handEdit, run) {
  const realFsync = fs.fsyncSync, realWrite = fs.writeFileSync;
  let fired = 0;
  fs.fsyncSync = function (...a) { if (!fired++) realWrite(file, handEdit); return realFsync.apply(this, a); };
  syncBuiltinESMExports();
  try { return await run(); } finally { fs.fsyncSync = realFsync; syncBuiltinESMExports(); }
}

test('FMT-07: a hand edit that lands between our last look and the rename is not overwritten', async () => {
  const { file } = tempRepo(['Button']);
  const store = await openStore(file);
  try {
    const { revision } = await store.read();
    const base = readFileSync(file, 'utf8');
    const hand = base.replace(/^(\s+fontSize: )\d+,$/m, '$199,');
    const r = await withEditorInTheWindow(file, hand, () => store.apply({ baseRevision: revision, edits: [{ op: 'set', path: 'label.fontWeight', value: 800 }], by: 'canvas' }));
    assert.equal(r.ok, true, r.error);
    const doc = readComponent(readFileSync(file, 'utf8')).doc;
    assert.equal(doc.root.style.fontSize, 99, 'the hand edit survived');
    assert.equal(doc.root.children[0].style.fontWeight, 800, 'the canvas edit landed on top of it');
  } finally { await store.close(); }
});

test('FMT-07: the same race on the same property: the canvas edit is refused as stale and the hand edit stays', async () => {
  const { file } = tempRepo(['Button']);
  const store = await openStore(file);
  try {
    const { revision } = await store.read();
    const hand = readFileSync(file, 'utf8').replace(/^(\s+fontSize: )\d+,$/m, '$199,');
    const r = await withEditorInTheWindow(file, hand, () => store.apply({ baseRevision: revision, edits: [{ op: 'set', path: 'root.fontSize', value: 33 }], by: 'canvas' }));
    assert.equal(r.ok, false);
    assert.match(r.error, /^stale revision/);
    assert.equal(readComponent(readFileSync(file, 'utf8')).doc.root.style.fontSize, 99);
  } finally { await store.close(); }
});

// The last window: after the hard link guard is taken and just before the rename. An in-place hand save shows through the shared
// inode (the user's text is renamed back); an editor's atomic save replaces the inode (nothing of ours is renamed over it).
async function withEditorBeforeRename(file, how, handEdit, run) {
  const realRename = fs.renameSync, realWrite = fs.writeFileSync, realLink = fs.linkSync;
  let fired = 0;
  if (how === 'inplace') { // a plain write to the file, just before our rename
    fs.renameSync = function (from, to, ...rest) { if (to === file && !fired++) realWrite(file, handEdit); return realRename.call(this, from, to, ...rest); };
  } else { // an editor's save (new file renamed over the target) right after the guard link was taken
    fs.linkSync = function (from, to, ...rest) { const r = realLink.call(this, from, to, ...rest); if (from === file && !fired++) { realWrite(`${file}.vim`, handEdit); realRename(`${file}.vim`, file); } return r; };
  }
  syncBuiltinESMExports();
  try { return await run(); } finally { fs.renameSync = realRename; fs.linkSync = realLink; syncBuiltinESMExports(); }
}
for (const how of ['inplace', 'atomic']) {
  test(`FMT-07: a hand save (${how}) between the guard link and the rename wins: stale reply, the user's text stays`, async () => {
    const { file } = tempRepo(['Button']);
    const store = await openStore(file);
    try {
      const { revision } = await store.read();
      const hand = readFileSync(file, 'utf8').replace(/^(\s+fontSize: )\d+,$/m, '$177,');
      const r = await withEditorBeforeRename(file, how, hand, () => store.apply({ baseRevision: revision, edits: [{ op: 'set', path: 'label.fontWeight', value: 800 }], by: 'canvas' }));
      assert.equal(r.ok, false);
      assert.match(r.error, /^stale revision: Button\.tsx changed on disk while saving; reread and retry$/);
      assert.equal(readFileSync(file, 'utf8'), hand, 'the hand-written text is what is on disk');
      assert.equal((await store.read()).doc.root.style.fontSize, 77, 'and the store took it in');
      const again = await store.apply({ baseRevision: (await store.read()).revision, edits: [{ op: 'set', path: 'label.fontWeight', value: 800 }], by: 'canvas' });
      assert.equal(again.ok, true, again.error);
      assert.equal(readComponent(readFileSync(file, 'utf8')).doc.root.style.fontSize, 77);
    } finally { await store.close(); }
  });
}
