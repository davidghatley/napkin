import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/harness.js';
import { decodeText } from '../../src/kinds/registry.js';

test('decodeText reads UTF-8, both UTF-16 forms with and without a byte order mark, and Windows-1252', () => {
  assert.equal(decodeText(Buffer.from('café', 'utf8')), 'café');
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo', 'utf16le')])), 'héllo');
  assert.equal(decodeText(Buffer.from('héllo wörld', 'utf16le')), 'héllo wörld');
  assert.equal(decodeText(Buffer.from('héllo wörld', 'utf16le').swap16()), 'héllo wörld');
  assert.equal(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94])), 'café “q”');
});

test('items carry decoded previews for older encodings and unreadable images say so', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-enc-')),
    files = join(dir, 'files');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(files);
  writeFileSync(join(files, 'latin1.txt'), Buffer.from('caf\xe9 \xfcber na\xefve\n', 'latin1'));
  writeFileSync(join(files, 'utf16.txt'), Buffer.from('héllo wörld\n', 'utf16le'));
  writeFileSync(join(files, 'broken.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]));
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const { items } = await (await fetch(server.url + 'api/items')).json();
  const by = Object.fromEntries(items.map((i) => [i.path, i]));
  assert.match(by['latin1.txt'].meta.preview, /café über naïve/);
  assert.match(by['utf16.txt'].meta.preview, /héllo wörld/);
  assert.equal(by['broken.png'].kind, 'png');
  assert.equal(by['broken.png'].meta.width, undefined);
  const page = await (await fetch(server.url + 'view/broken.png')).text();
  assert.match(page, /data-napkin-kind="png"/);
});
