// AST-01 drop an image on a slot, AST-02 the asset browser's list, AST-03 a missing asset, AST-04 the same image twice is one file.
// Server side; the page's drop and badge are tested in test/history/ui.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rig } from './helpers.js';
import { saveAsset, AssetError } from '../../src/assets.js';
import { png, SVG } from './png.js';

const b64 = (b) => b.toString('base64');

test('AST-01/04: a dropped image is copied to assets/<sha8>.<ext>, src is one changed line, and twice is one file', async () => {
  const r = await rig(['Card']);
  try {
    // a card with an image slot, committed so the diff below shows only the drop
    const ins = await r.edit('you', 'Card', [{ op: 'insert', parent: 'card', index: 0, node: { id: 'photo', tag: 'img', attrs: { src: '', alt: 'photo' }, style: { width: '100%' } } }]);
    assert.equal(ins.ok, true, JSON.stringify(ins));
    r.git('add', 'components/Card.tsx'); r.git('-c', 'user.name=t', '-c', 'user.email=t@e.invalid', 'commit', '-qm', 'slot');

    const bytes = png([200, 40, 40]);
    const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const a = await r.call('you', 'POST', '/api/components/Card/image', { node: 'photo', ext: 'png', data: b64(bytes) });
    assert.equal(a.status, 200, JSON.stringify(a));
    assert.equal(a.path, `assets/${sha8}.png`); assert.equal(a.created, true);
    assert.deepEqual(readFileSync(join(r.compDir, 'assets', `${sha8}.png`)), bytes, 'the file is the dropped bytes');
    assert.match(r.git('diff', '--numstat', '--', 'components/Card.tsx'), /^1\t1\t/, 'one changed line');
    assert.match(r.read('Card'), new RegExp(`src="assets/${sha8}\\.png"`));
    assert.deepEqual(r.git('status', '--porcelain', '-uall').split('\n').filter(Boolean).map((l) => l.slice(3)).filter((p) => !p.endsWith('.napkin.json')).sort(), ['components/Card.tsx', `components/assets/${sha8}.png`], '1 changed file + 1 new file');
    const hist = (await r.history('Card'))[0];
    assert.equal(hist.by, 'you'); assert.match(hist.summary, /photo\.@src/);

    // AST-04: the same bytes again, from another route and another name: stored once
    const b = await r.call('you', 'POST', '/api/assets', { ext: 'png', data: b64(bytes) });
    assert.equal(b.status, 200); assert.equal(b.created, false); assert.equal(b.path, a.path);
    await r.call('you', 'POST', '/api/components/Card/image', { into: 'card', ext: 'png', data: b64(bytes) });
    assert.deepEqual(readdirSync(join(r.compDir, 'assets')).filter((n) => !n.startsWith('.')), [`${sha8}.png`], 'one file');
    // and an undo of the drop is an ordinary undo
    assert.equal((await r.call('you', 'POST', '/api/undo', {})).status, 200);
  } finally { await r.close(); }
});

test('AST-01: the exported helper, its limits, and the identity rules', async () => {
  const r = await rig(['Card']);
  try {
    const one = saveAsset(r.compDir, png([1, 2, 3]), 'PNG');
    assert.match(one.path, /^assets\/[0-9a-f]{8}\.png$/); assert.equal(one.created, true);
    assert.equal(saveAsset(r.compDir, png([1, 2, 3]), '.png').created, false);
    const svg = saveAsset(r.compDir, SVG(), 'svg'); assert.match(svg.path, /\.svg$/);
    assert.throws(() => saveAsset(r.compDir, Buffer.from('hello'), 'png'), AssetError, 'text is not a png');
    assert.throws(() => saveAsset(r.compDir, png([1, 2, 3]), 'exe'), /not an image type/);
    assert.throws(() => saveAsset(r.compDir, Buffer.alloc(0), 'png'), /empty/);
    assert.equal((await r.call(null, 'POST', '/api/assets', { ext: 'png', data: b64(png([9, 9, 9])) })).status, 401, 'identity required');
    assert.equal((await r.call('you', 'POST', '/api/assets', { ext: 'png', data: b64(Buffer.from('nope')) })).status, 400);
    assert.deepEqual(readdirSync(join(r.compDir, 'assets')).filter((n) => n.startsWith('.')), [], 'no temp files left');
  } finally { await r.close(); }
});

test('AST-02: the asset list holds every image and SVG in the repo, and serves them', async () => {
  const r = await rig(['Card']);
  try {
    mkdirSync(join(r.dir, 'public', 'icons'), { recursive: true }); mkdirSync(join(r.compDir, 'assets'), { recursive: true }); mkdirSync(join(r.dir, 'node_modules', 'x'), { recursive: true });
    const files = { 'public/logo.png': png([10, 20, 30]), 'public/icons/star.svg': SVG(), 'components/assets/photo.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'hero.webp': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'notes.txt': Buffer.from('not an image'), 'node_modules/x/skip.png': png([0, 0, 0]) };
    for (const [p, b] of Object.entries(files)) writeFileSync(join(r.dir, p), b);
    const list = (await r.call(null, 'GET', '/api/assets')).assets;
    assert.deepEqual(list.map((a) => a.path), ['components/assets/photo.jpg', 'hero.webp', 'public/icons/star.svg', 'public/logo.png'], 'every image, none of the rest');
    assert.ok(list.every((a) => a.bytes > 0 && a.name && a.ext));
    const got = await r.api.handle({ method: 'GET', path: '/api/assets/file', query: new URLSearchParams({ path: 'public/logo.png' }) });
    assert.equal(got.status, 200); assert.equal(got.type, 'image/png'); assert.deepEqual(got.bytes, files['public/logo.png']);
    // a path that leaves the repo, a non-image and a missing file are all 404
    for (const bad of ['../../etc/passwd.png', '/etc/hostname', 'notes.txt', 'nope.png', 'node_modules/x/skip.png']) {
      assert.equal((await r.api.handle({ method: 'GET', path: '/api/assets/file', query: new URLSearchParams({ path: bad }) })).status, 404, bad);
    }
    // dragging an asset from elsewhere in the repo copies it into assets/ under its hash
    const d = await r.call('you', 'POST', '/api/components/Card/image', { into: 'card', from: 'public/logo.png' });
    assert.equal(d.status, 200, JSON.stringify(d)); assert.match(d.path, /^assets\/[0-9a-f]{8}\.png$/);
    const e = await r.call('you', 'POST', '/api/components/Card/image', { into: 'card', from: 'public/icons/star.svg' });
    assert.match(e.path, /\.svg$/);
    assert.equal((await r.call('you', 'POST', '/api/components/Card/image', { into: 'card', from: '../../etc/hostname' })).status, 404);
  } finally { await r.close(); }
});
