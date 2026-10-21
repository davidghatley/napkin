// Collect all explicit error-producing expressions in src/, including template strings.
// Typed constructors and forwarding boundaries have one tested formatter; naked error
// strings must themselves contain a next step. Adding a new sink fails closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from '@babel/parser';
import { explainError } from '../../src/errors.js';
import { EditError } from '../../src/model.js';
import { DialectError } from '../../src/tsx/read.js';
import { CreateError } from '../../src/workspace.js';
import { RenderError } from '../../src/render-png.js';
import { LockError } from '../../src/lock.js';
import { openStore } from '../../src/store.js';
import { evidence } from '../helpers/agents.js';
import { ROOT, fixture } from '../helpers/harness.js';

const walk = (n, cb, parents = []) => { if (!n || typeof n !== 'object') return; if (n.type) cb(n, parents); for (const [k, v] of Object.entries(n)) { if (['loc', 'start', 'end', 'comments', 'tokens'].includes(k)) continue; if (Array.isArray(v)) v.forEach((c) => walk(c, cb, [...parents, n])); else if (v && typeof v === 'object') walk(v, cb, [...parents, n]); } };
const nextStep = /Next:|\b(?:send|set|start|stop|retry|choose|use|fix|run|export|provide|keep|check)\b/i;
test('ONB-04: every explicit thrown/returned error in src has an actionable rule', (t) => {
  const inventory = [], failures = [];
  // These constructors format at construction; API fail(), store.apply(), and server
  // json() format at the return boundary. Each boundary is asserted below.
  const typed = new Set(['EditError', 'DialectError', 'CreateError', 'RenderError', 'LockError', 'ToolError', 'Unreachable']);
  function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []); }
  for (const file of files(join(ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8'), ast = parse(source, { sourceType: 'module' }), name = file.slice(join(ROOT, 'src').length + 1);
    walk(ast, (n, parents) => {
      let expr, rule;
      if (n.type === 'NewExpression' && /Error$|^Unreachable$/.test(n.callee.name)) { expr = n.arguments[n.callee.name === 'EditError' || n.callee.name === 'DialectError' ? 1 : 0]; rule = typed.has(n.callee.name) ? 'typed' : null; }
      else if (n.type === 'CallExpression' && n.callee.name === 'fail') { expr = n.arguments[1]; rule = 'api'; }
      else if (n.type === 'ObjectProperty' && ['error', 'message'].includes(n.key.name) && !parents.some((p) => p.type === 'NewExpression')) {
        // error:null clears an error; protocol errors use message, component failures use error.
        if (n.value.type === 'NullLiteral' || n.value.type === 'ObjectExpression') return;
        if (n.key.name === 'message' && !parents.some((p) => p.type === 'ObjectProperty' && p.key.name === 'error')) return;
        expr = n.value;
        if (name === 'store.js' && parents.some((p) => p.type === 'FunctionDeclaration' && p.id?.name === 'applyNow')) rule = 'store.apply';
        if (name === 'server.js' && parents.some((p) => p.type === 'CallExpression' && p.callee.name === 'json')) rule = 'http-json';
        if (name === 'mcp.js' && parents.some((p) => p.type === 'CallExpression' && p.callee.name === 'send') && parents.some((p) => p.type === 'ObjectProperty' && p.key.name === 'error')) rule = 'json-rpc';
        // Workspace build event is a verbatim forwarding of the bundler's formatted error.
        if (name === 'workspace.js' && source.slice(expr.start, expr.end) === 'r.error') rule = 'bundler-forward';
      }
      if (!expr) return;
      const text = source.slice(expr.start, expr.end);
      inventory.push(`${name}:${n.loc.start.line} [${rule || 'inline'}] ${text}`);
      if (!rule && !text.includes('explainError(') && !nextStep.test(text)) failures.push(inventory.at(-1));
    });
    // Audited boundaries must keep formatting even if their callers change.
    const required = {
      'api.js': /const fail[\s\S]*?error: explainError\(error/,
      'store.js': /apply\(req(, meta = \{\})?\)[\s\S]*?explainError\(r.error, \{ file/,
      'server.js': /const json[\s\S]*?explainError\(body.error/,
      'mcp.js': /const send[\s\S]*?explainError\(/,
    }[name];
    if (required) assert.match(source, required, `${name} lost its error boundary`);
    walk(ast, (n) => {
      if (n.type === 'ClassDeclaration' && typed.has(n.id?.name)) assert.match(source.slice(n.start, n.end), /super\(explainError\(/, `${n.id.name} must format at construction`);
      if (n.type === 'VariableDeclarator' && n.id.name === 'fail') assert.match(source.slice(n.start, n.end), /error: explainError\(error/, 'every fail() helper must format errors');
    });
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(inventory.length > 100, `collected ${inventory.length} errors`);
  for (const ErrorClass of [CreateError, RenderError, LockError]) assert.match(new ErrorClass('problem').message, nextStep);
  assert.match(new EditError(3, 'problem').message, /^invalid edit #3:.*Next:/);
  assert.match(new DialectError({ loc: { start: { line: 7 } } }, 'problem').message, /line 7:.*Next:/);
  for (const prefix of ['stale revision:', 'invalid edit #0:', 'read-only:']) assert.ok(explainError(prefix + ' problem', { file: 'Button.tsx' }).startsWith(prefix));
  t.diagnostic(`${inventory.length} explicit error expressions audited; typed constructors and return boundaries checked`);
  evidence('ONB-04', `Re-run: EVIDENCE=1 node --test test/onboarding/errors.test.js\n${inventory.length}/${inventory.length} error expressions have a next-step rule. File context and stale/invalid/read-only prefixes tested at runtime.\n\n` + inventory.join('\n'));
});
test('ONB-04: real parse, read-only and stale failures name the file and preserve prefixes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-errors-')), file = join(dir, 'Button.tsx');
  writeFileSync(file, readFileSync(fixture('Button')));
  const store = await openStore(file);
  try {
    const r = await store.apply({ baseRevision: -1, by: 'test', edits: [{ op: 'set', path: 'root.color', value: 'red' }] });
    assert.match(r.error, /^stale revision:.*Button.tsx.*Next:/);
    const invalid = await store.apply({ baseRevision: 1, by: 'test', edits: [{ op: 'set', path: 'missing.color', value: 'red' }] });
    assert.match(invalid.error, /^invalid edit #0:.*Button.tsx.*Next:/);
    const unknown = await store.apply({ baseRevision: 1, by: 'test', edits: [{ op: 'madeUp' }] });
    assert.match(unknown.error, /unknown op.*valid ops: set, insert, delete, move, addProp, removeProp, setDefault, bindText, addVariant, removeVariant, rename/);
  } finally { await store.close(); }
  writeFileSync(file, 'export function Button( { broken');
  const broken = await openStore(file);
  try { const r = (await broken.read()).readOnly; assert.match(r, /line 1:.*Button.tsx.*Next:/); assert.match(r, /fix the syntax error at line 1, then save; napkin reloads it/); }
  finally { await broken.close(); rmSync(dir, { recursive: true, force: true }); }
});
