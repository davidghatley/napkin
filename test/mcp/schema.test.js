// AGT-01: `edits` items have a real oneOf schema, one per op; every op in the guide validates and typos do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A small JSON Schema checker: type (and type arrays), const, enum, required, properties, additionalProperties, items, oneOf.
function valid(schema, v) {
  if (schema.oneOf) return schema.oneOf.filter((s) => valid(s, v)).length === 1;
  if ('const' in schema && v !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(v)) return false;
  const types = schema.type && [].concat(schema.type);
  const of = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x);
  if (types && !types.some((t) => t === of(v) || (t === 'number' && typeof v === 'number') || (t === 'object' && of(v) === 'object'))) return false;
  if (schema.type === 'object' || schema.properties) {
    if (of(v) !== 'object') return false;
    for (const r of schema.required || []) if (!(r in v)) return false;
    for (const [k, x] of Object.entries(v)) {
      if (schema.properties?.[k]) { if (!valid(schema.properties[k], x)) return false; }
      else if (schema.additionalProperties === false) return false;
    }
  }
  if (schema.items && Array.isArray(v) && !v.every((x) => valid(schema.items, x))) return false;
  return true;
}

import { editItemSchema } from '../../src/mcp-schema.js';
import { applyEdits } from '../../src/model.js';
import { readComponent } from '../../src/tsx/read.js';
import { readFileSync } from 'node:fs';
import { fixture } from '../helpers/harness.js';
import { GUIDE } from '../../src/guide.js';
import { tempRepo, startServer, startMcp } from '../helpers/harness.js';

const GOOD = [
  { op: 'set', path: 'title.fontWeight', value: 600 }, { op: 'set', path: 'title.color', value: null },
  { op: 'set', path: 'root.padding', value: '4px', variant: { size: 'sm' } },
  { op: 'insert', parent: 'root', index: 1, node: { id: 'badge', tag: 'span', style: { color: 'red' }, text: 'New' } },
  { op: 'delete', id: 'badge' }, { op: 'move', id: 'badge', parent: 'root', index: 0 },
  { op: 'addProp', name: 'tone', type: 'enum', options: ['plain', 'loud'], default: 'plain' }, { op: 'removeProp', name: 'tone' },
  { op: 'setDefault', name: 'label', value: 'Go' }, { op: 'bindText', id: 'label', prop: 'label' }, { op: 'bindText', id: 'label', prop: null },
  { op: 'addVariant', axis: 'size', value: 'xl' }, { op: 'addVariant', axis: 'size', value: 'xl', base: 'md' }, { op: 'removeVariant', axis: 'size', value: 'xl' },
];
const BAD = [
  { op: 'sett', path: 'a.b', value: 1 }, { op: 'set', path: 'a.b' }, { op: 'set', value: 1 }, { op: 'delete' }, { op: 'delete', id: 5 },
  { op: 'insert', parent: 'root' }, { op: 'move', id: 'a' }, { op: 'addProp', name: 'x', type: 'banana' }, { op: 'addVariant', axis: 'size' },
  { op: 'set', path: 'a.b', value: 1, extra: true }, 'set title', {}, { op: 'removeVariant', value: 'xl' },
];

test('the edit item schema is a oneOf with one entry per op; good edits validate, typos and missing fields do not', () => {
  const schema = editItemSchema();
  assert.equal(schema.oneOf.length, 13);
  assert.deepEqual(schema.oneOf.map((s) => s.properties.op.const).sort(), ['addProp', 'addVariant', 'bindText', 'delete', 'extractComponent', 'insert', 'insertInstance', 'move', 'removeProp', 'removeVariant', 'set', 'setDefault', 'swapInstance']);
  for (const e of GOOD) assert.ok(valid(schema, e), `should validate: ${JSON.stringify(e)}`);
  for (const e of BAD) assert.ok(!valid(schema, e), `should not validate: ${JSON.stringify(e)}`);
  assert.deepEqual(editItemSchema(true), { type: 'object' }, 'the control arm gets a bare object');
});

test('every op example in the guide parses as JSON and validates; the schema agrees with the model (the ops it accepts are the ops applyEdits knows)', () => {
  const schema = editItemSchema();
  const examples = GUIDE.split('\n').filter((l) => l.includes('{ "op"')).flatMap((l) => l.slice(l.indexOf('{ "op"')).split(/\s+\|\s+/)).filter((x) => x.startsWith('{ "op"')).map((x) => x.slice(0, x.lastIndexOf('}') + 1));
  assert.ok(examples.length >= 10, `found ${examples.length} guide examples`);
  for (const ex of examples) { let e; try { e = JSON.parse(ex); } catch { assert.fail(`guide example is not JSON: ${ex}`); } assert.ok(valid(schema, e), `guide example fails its schema: ${ex}`); }
  const { doc } = readComponent(readFileSync(fixture('Button'), 'utf8'));
  for (const e of [{ ...GOOD[0], path: 'label.fontWeight' }, GOOD[2], GOOD[3], GOOD[6], GOOD[8], GOOD[11]]) assert.doesNotThrow(() => applyEdits(doc, [e]), JSON.stringify(e));
});

test('tools/list exposes the oneOf schema on apply_edits.edits items', async () => {
  const { compDir } = tempRepo();
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url);
  try {
    const tools = (await mcp.request('tools/list', {})).result.tools;
    assert.equal(tools.find((t) => t.name === 'apply_edits').inputSchema.properties.edits.items.oneOf.length, 13);
  } finally { mcp.stop(); await server.stop(); }
});
