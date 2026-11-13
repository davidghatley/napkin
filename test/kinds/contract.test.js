import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  cpSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  existsSync,
  openSync,
  ftruncateSync,
  closeSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../helpers/harness.js';
import { openItems } from '../../src/kinds/items.js';
import { parquetBytes } from './samples/generate.js';
const samples = resolve('test/kinds/samples');
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-')),
    files = join(dir, 'files');
  cpSync(samples, files, { recursive: true });
  const server = await startServer(files, { env: { NAPKIN_STATE_DIR: join(dir, 'state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (path) => {
    const r = await fetch(server.url + path);
    return [r.status, await r.json()];
  };
  const [, session] = await (async () => {
    const r = await fetch(server.url + 'api/session', {
      method: 'POST',
      body: JSON.stringify({ as: 'you' }),
    });
    return [r.status, await r.json()];
  })();
  const post = async (path, body, token = session.token) => {
    const r = await fetch(server.url + path, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    return [r.status, await r.json()];
  };
  return { dir, files, server, get, post };
}
test('all generated samples are items, have correct kinds, standalone roots, instruments and exact undo', async (t) => {
  const { files, server, get, post } = await setup(t);
  const [, listing] = await get('api/items'),
    manifest = JSON.parse(readFileSync(join(files, 'manifest.json')));
  assert.ok(new Set(listing.items.map((x) => x.kind)).size >= 40);
  for (const [path, kind] of Object.entries(manifest)) {
    const item = listing.items.find((x) => x.path === path);
    assert.ok(item, path);
    assert.equal(item.kind, kind, path);
    assert.ok(item.mime);
    assert.equal(item.bytes, readFileSync(join(files, path)).length);
    const response = await fetch(server.url + 'view/' + encodeURIComponent(item.id));
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), new RegExp(`data-napkin-kind="${kind}"`), path);
    const [status, schema] = await get('api/controls/' + encodeURIComponent(item.id));
    assert.equal(status, 200, path);
    assert.ok(schema.sections.length, path);
    const c = schema.sections.at(-1).controls[0];
    assert.ok(c.id && c.type && c.depth);
    const value =
      typeof c.value === 'boolean'
        ? !c.value
        : typeof c.value === 'number'
          ? c.value + (c.max !== undefined && c.value >= c.max ? -(c.step || 1) : c.step || 1)
          : c.options
            ? c.options.find((x) => x !== c.value)
            : c.value + ' · edited';
    const before = readFileSync(join(files, path)),
      recipe = join(files, path + '.napkin-recipe.json');
    const [written, result] = await post('api/control', {
      item: item.id,
      control: c.id,
      value,
      baseRevision: schema.revision,
    });
    assert.equal(written, 200, path + JSON.stringify(result));
    assert.notEqual(result.revision, schema.revision);
    assert.ok(existsSync(recipe), path);
    const [undone, undo] = await post('api/undo', { item: item.id });
    assert.equal(undone, 200, JSON.stringify(undo));
    assert.deepEqual(readFileSync(join(files, path)), before, path);
    assert.equal(existsSync(recipe), false, path);
  }
});
test('native edits preserve surrounding bytes, conflicts preserve external edits, and recipes do not appear on reads', async (t) => {
  const { files, get, post } = await setup(t);
  const before = readdirSync(files);
  await get('api/items');
  for (const path of ['settings.json', 'tokens.css', 'leaf.svg', 'observations.csv', 'readme.md']) {
    const original = readFileSync(join(files, path));
    const [, schema] = await get('api/controls/' + encodeURIComponent(path));
    const c = schema.sections.find((s) => s.id === 'source').controls[0];
    const value =
      typeof c.value === 'number'
        ? c.value + 1
        : typeof c.value === 'boolean'
          ? !c.value
          : 'Changed';
    const [status, result] = await post('api/control', {
      item: path,
      control: c.id,
      value,
      baseRevision: schema.revision,
    });
    assert.equal(status, 200, JSON.stringify(result));
    assert.notDeepEqual(readFileSync(join(files, path)), original);
    assert.equal(
      (
        await post('api/control', {
          item: path,
          control: c.id,
          value,
          baseRevision: schema.revision,
        })
      )[0],
      409,
    );
    assert.equal((await post('api/undo', { item: path }))[0], 200);
    assert.deepEqual(readFileSync(join(files, path)), original);
  }
  assert.deepEqual(readdirSync(files), before);
  const [, schema] = await get('api/controls/settings.json'),
    c = schema.sections[0].controls[0];
  assert.equal(
    (
      await post(
        'api/control',
        { item: 'settings.json', control: c.id, value: 'Updated', baseRevision: schema.revision },
        'invalid',
      )
    )[0],
    401,
  );
  await post('api/control', {
    item: 'settings.json',
    control: c.id,
    value: 'Updated',
    baseRevision: schema.revision,
  });
  writeFileSync(join(files, 'settings.json'), 'external save\n');
  assert.equal((await post('api/undo', { item: 'settings.json' }))[0], 409);
  assert.equal(readFileSync(join(files, 'settings.json'), 'utf8'), 'external save\n');
});
test('data readers produce typed rows, real distributions, meshes, zip contents and audio peaks', async (t) => {
  const { get } = await setup(t);
  for (const name of [
    'observations.csv',
    'observations.tsv',
    'observations.jsonl',
    'garden.sqlite',
    'sample.parquet',
    'powers.arrow',
  ]) {
    const [status, d] = await get('api/item-data/' + name);
    assert.equal(status, 200, name);
    assert.ok(d.rows.length > 0, name);
    assert.ok(
      d.columns.some((c) => /int|num|float/i.test(c.type)),
      name,
    );
    assert.ok(
      d.columns.some((c) => c.bins.some((n) => n > 0)),
      name,
    );
  }
  const [, zip] = await get('api/item-data/garden.zip');
  assert.ok(zip.entries.some((e) => e.name === 'data/counts.csv'));
  const [, entry] = await get(
    'api/item-data/garden.zip?entry=' + encodeURIComponent('data/counts.csv'),
  );
  assert.match(entry.text, /fern,12/);
  for (const name of ['pyramid.obj', 'triangle.gltf', 'triangle.glb']) {
    const [, model] = await get('api/item-data/' + name);
    const prims = model.meshes.flatMap((m) => m.prims);
    assert.ok(prims.length >= 1 && prims[0].pos.length >= 9, name);
    assert.ok(prims[0].idx.length >= 3 && model.roots.length >= 1, name);
  }
  for (const name of ['tone.wav', 'tone.mp3', 'tone.flac', 'tone.ogg', 'tone.m4a']) {
    const [status, wave] = await get('api/item-data/' + name);
    assert.equal(status, 200, name);
    assert.equal(wave.peaks.length, 240, name);
    assert.ok(Math.max(...wave.peaks) > 0.01, name);
  }
});
test('2 GiB media range requests and a real 5 M row Parquet stay bounded', async (t) => {
  const { files, server, get } = await setup(t);
  const file = join(files, 'large.mp4'),
    video = readFileSync(join(files, 'turn.mp4'));
  const free = Buffer.alloc(8);
  free.writeUInt32BE(2 * 1024 ** 3 - video.length);
  free.write('free', 4);
  writeFileSync(file, Buffer.concat([video, free]));
  const fd = openSync(file, 'r+');
  ftruncateSync(fd, 2 * 1024 ** 3);
  closeSync(fd);
  writeFileSync(join(files, 'large.parquet'), parquetBytes(5_000_000));
  const started = performance.now();
  const [, listing] = await get('api/items');
  assert.ok(performance.now() - started < 2000);
  assert.equal(listing.items.find((x) => x.path === 'large.mp4').bytes, 2 * 1024 ** 3);
  const res = await fetch(server.url + 'file/large.mp4', { headers: { range: 'bytes=1024-2047' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 1024);
  assert.equal(res.headers.get('content-range'), `bytes 1024-2047/${2 * 1024 ** 3}`);
  const bad = await fetch(server.url + 'file/large.mp4', {
    headers: { range: 'bytes=9999999999-' },
  });
  assert.equal(bad.status, 416);
  const [status, d] = await get('api/item-data/large.parquet?group=49');
  assert.equal(status, 200);
  assert.equal(d.total, 5_000_000);
  assert.equal(d.groups, 50);
  assert.equal(d.rows[0][0], String(4_900_000));
  assert.ok(d.rows.length <= 120);
  const rss =
    Number(readFileSync(`/proc/${server.proc.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) *
    1024;
  assert.ok(rss < 200 * 1024 ** 2, `server RSS ${rss}`);
});
test('1,000 mixed file index and magic detection, with no symlink escape', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-kinds-index-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const names = [
    'settings.json',
    'color.png',
    'tone.wav',
    'observations.csv',
    'pyramid.obj',
    'bytes.bin',
    'readme.md',
    'sample.parquet',
    'garden.zip',
    'turn.mp4',
  ];
  for (let i = 0; i < 1000; i++) {
    const name = names[i % names.length];
    cpSync(join(samples, name), join(dir, `${i}-${name}`));
  }
  cpSync(join(samples, 'color.png'), join(dir, 'misnamed.txt'));
  symlinkSync('/etc/passwd', join(dir, 'outside.txt'));
  const index = openItems(dir, { stateDir: join(dir, 'state') });
  const start = performance.now(),
    items = index.items();
  assert.ok(performance.now() - start < 2000);
  assert.equal(items.length, 1001);
  assert.equal(items.find((x) => x.path === 'misnamed.txt').kind, 'png');
  assert.throws(() => index.context('outside.txt'), /outside/);
  assert.throws(() => index.context('../outside.txt'));
});
