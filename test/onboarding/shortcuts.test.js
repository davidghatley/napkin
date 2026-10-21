// Audit every keyboard listener, not a hand-picked list of global shortcuts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import { ACTIONS, KEYBOARD_HANDLERS } from '../../public/canvas/actions.js';
import { evidence } from '../helpers/agents.js';
import { ROOT } from '../helpers/harness.js';

function walk(n, fn) { if (!n || typeof n !== 'object') return; if (n.type) fn(n); for (const [k, v] of Object.entries(n)) { if (['loc', 'start', 'end'].includes(k)) continue; if (Array.isArray(v)) v.forEach((c) => walk(c, fn)); else if (v && typeof v === 'object') walk(v, fn); } }
test('ONB-03: 100% of keyboard handlers and every compared key/code have registry entries', (t) => {
  let total = 0;
  const counts = {};
  for (const file of readdirSync(join(ROOT, 'public/canvas')).filter((f) => f.endsWith('.js'))) {
    const ast = parse(readFileSync(join(ROOT, 'public/canvas', file), 'utf8'), { sourceType: 'module' });
    walk(ast, (n) => {
      if (n.type !== 'CallExpression' || (n.callee.property?.name || n.callee.name) !== 'addEventListener' || !['keydown', 'keyup'].includes(n.arguments[0]?.value)) return;
      const event = n.arguments[0].value, ref = `${file}:${event}`;
      counts[ref] = (counts[ref] || 0) + 1; total++;
      const entries = ACTIONS.filter((a) => a.handlers?.includes(ref));
      assert.ok(entries.length, `${ref}:${n.loc.start.line} is missing from the sheet`);
      const documented = new Set(entries.flatMap((a) => a.codes || []));
      walk(n.arguments[1], (x) => {
        if (x.type !== 'BinaryExpression' || !['===', '!=='].includes(x.operator)) return;
        for (const [value, other] of [[x.left, x.right], [x.right, x.left]]) {
          const prop = other.type === 'MemberExpression' && other.property?.name;
          const variable = other.type === 'Identifier' && other.name;
          if (value.type === 'StringLiteral' && (['key', 'code'].includes(prop) || variable === 'key')) assert.ok(documented.has(value.value), `${ref}:${x.loc.start.line}: ${value.value} has no documented action`);
        }
      });
    });
    // The tool listener obtains V/F/T/I from this table instead of comparing ev.key.
    if (file === 'tools.js') walk(ast, (n) => { if (n.type === 'ObjectProperty' && n.key.name === 'key' && n.value.type === 'StringLiteral') assert.ok(ACTIONS.some((a) => a.codes?.includes(n.value.value)), `tool ${n.value.value} missing`); });
  }
  assert.deepEqual(counts, KEYBOARD_HANDLERS, 'a new keyboard handler needs an action and an audit count');
  t.diagnostic(`${total}/${total} keyboard handlers documented; every key/code comparison covered`);
  evidence('ONB-03', `Re-run: EVIDENCE=1 node --test test/onboarding/shortcuts.test.js\n${total}/${total} keyboard listeners documented. All key/code comparisons and delegated tool keys covered.\n` + ACTIONS.map((a) => `${a.label}: ${a.key}`).join('\n'));
});
