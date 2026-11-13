// The "Column types" control: a table's column labels can be set from the panel's schema; the cells keep the file's text, the label changes
// alignment and the distribution, undo restores the recipe, and a bad entry is refused with a next step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../helpers/harness.js';

test('columnTypes has a panel control that changes the served column types, and undoes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-coltypes-'));
  writeFileSync(join(dir, 't.csv'), 'id,price\n001,1.5\n002,2.5\n003,3\n');
  const server = await startServer(dir, { env: { NAPKIN_STATE_DIR: join(dir, '.state') } });
  t.after(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const session = await (await fetch(server.url + 'api/session', { method: 'POST', body: JSON.stringify({ as: 'you' }) })).json();
  const j = async (p, body) => {
    const r = await fetch(server.url + p, body ? { method: 'POST', headers: { authorization: 'Bearer ' + session.token }, body: JSON.stringify(body) } : {});
    return [r.status, await r.json()];
  };
  const [, schema] = await j('api/controls/t.csv');
  const c = schema.sections.flatMap((s) => s.controls).find((x) => x.id === 'view:columnTypes');
  assert.ok(c, 'the schema lists a Column types control');
  const before = (await j('api/item-data/t.csv'))[1];
  assert.equal(before.columns[1].type, 'number');
  const [bad, err] = await j('api/control', { item: 't.csv', control: c.id, value: 'price=banana', baseRevision: schema.revision });
  assert.ok(bad >= 400 && /Next:/.test(err.error), 'a bad type is refused with a next step');
  const [ok, res] = await j('api/control', { item: 't.csv', control: c.id, value: 'price=string, 0=integer', baseRevision: schema.revision });
  assert.equal(ok, 200, JSON.stringify(res));
  const after = (await j('api/item-data/t.csv'))[1];
  assert.deepEqual(after.columns.map((x) => x.type), ['integer', 'string']);
  assert.deepEqual(after.rows[0], ['001', '1.5'], 'cells keep the file text');
  const [, now] = await j('api/controls/t.csv');
  assert.equal(now.sections.flatMap((s) => s.controls).find((x) => x.id === c.id).value, '0=integer, price=string');
  const [u] = await j('api/undo', { item: 't.csv' });
  assert.equal(u, 200);
  assert.equal((await j('api/item-data/t.csv'))[1].columns[1].type, 'number');
});
