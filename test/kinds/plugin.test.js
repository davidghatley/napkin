import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/harness.js';
test('an explicitly installed kind owns detection, metadata, viewer, controls and exact undo without core changes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kind-plugin-')),
    plugin = join(dir, 'plugin.mjs');
  writeFileSync(join(dir, 'note.nkx'), 'First note\n');
  writeFileSync(
    plugin,
    `export default ({registerKind})=>registerKind({
  id:'note-test',family:'note',mime:'text/plain',extensions:['.nkx'],
  detect:c=>c.ext==='.nkx', metadata:c=>({words:c.text.trim().split(/\\s+/).length}),
  viewer:c=>'<html data-napkin-kind="note-test"><body><article>'+c.text.replaceAll('<','&lt;')+'</article></body></html>',
  controls:c=>[{id:'text',label:'Note',controls:[{id:'note',label:'Text',type:'text',value:c.text,depth:1}]}],
  apply:(c,control,value)=>({source:value})
});`,
  );
  const server = await startServer(dir, {
    env: { NAPKIN_STATE_DIR: join(dir, '.state'), NAPKIN_KIND_PLUGINS: plugin },
  });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (path) => (await fetch(server.url + path)).json();
  const listing = await get('api/items'),
    item = listing.items.find((i) => i.path === 'note.nkx');
  assert.equal(item.kind, 'note-test');
  assert.equal(item.meta.words, 2);
  assert.match(
    await (await fetch(server.url + 'view/note.nkx')).text(),
    /data-napkin-kind="note-test"/,
  );
  const { token } = await (
    await fetch(server.url + 'api/session', { method: 'POST', body: JSON.stringify({ as: 'you' }) })
  ).json();
  const post = async (path, body) =>
    (
      await fetch(server.url + path, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      })
    ).json();
  const { revision } = await get('api/controls/note.nkx');
  assert.equal(
    (
      await post('api/control', {
        item: 'note.nkx',
        control: 'note',
        value: 'A real edit\n',
        baseRevision: revision,
      })
    ).ok,
    true,
  );
  assert.equal(readFileSync(join(dir, 'note.nkx'), 'utf8'), 'A real edit\n');
  assert.equal((await post('api/undo', { item: 'note.nkx' })).ok, true);
  assert.equal(readFileSync(join(dir, 'note.nkx'), 'utf8'), 'First note\n');
});
