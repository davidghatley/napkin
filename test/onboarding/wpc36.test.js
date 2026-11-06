// WPC-36: words that must match behaviour (read-only reason, open report, MCP error text, syntax error line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource, formatReport } from '../../src/scan.js';
import { tempRepo, startServer, startMcp } from '../helpers/harness.js';

test('WPC-36: a component with no styles is not told it "styles with className/cn() or inline styles"', () => {
  const row = classifySource('export function Bare() {\n  return <div>hi</div>;\n}\n', 'Bare.tsx');
  assert.equal(row.editable, false);
  assert.match(row.reason, /no styles napkin can edit/);
  assert.doesNotMatch(row.reason, /className\/cn\(\)/);
});

test('WPC-36: the open report says "1 file", and has no heading with nothing under it', () => {
  const hooks = classifySource('export function H() {\n  const x = useThing();\n  return <div className="a">{x}</div>;\n}\n', 'H.tsx');
  assert.match(formatReport([hooks]), /hooks: 1 file\n/);
  const none = formatReport([{ file: 'A.tsx', editable: true, name: 'A' }]);
  assert.doesNotMatch(none, /Top blocking constructs/);
});

test('WPC-36: a syntax error names the broken line, not the line where the parser gave up', () => {
  const src = 'export function A() {\n  return (\n    <div className="x"\n      <b>hi</b>\n    </div>\n  );\n}\n';
  const row = classifySource(src, 'A.tsx');
  assert.equal(row.line, 3);
  assert.match(row.reason, /^line 3: syntax error/);
  assert.match(row.reason, /the parser stopped at line 4/);
  assert.match(row.reason, /fix the syntax error at line 3/);
});

test('WPC-36: an MCP error points at the guide resource, not at an HTTP route', async () => {
  const { compDir } = tempRepo(['Card']);
  const server = await startServer(compDir);
  const mcp = await startMcp(server.url, { NAPKIN_AGENT: 'tester' });
  try {
    const { revision } = (await mcp.call('read_component', { component: 'Card' })).data;
    const r = await mcp.call('apply_edits', { component: 'Card', baseRevision: revision, edits: [{ op: 'nonsense' }] });
    assert.equal(r.isError, true);
    const text = r.text;
    assert.doesNotMatch(text, /\/api\/guide/, text);
    assert.match(text, /napkin:\/\/guide/, text);
  } finally { mcp.stop(); await server.stop(); }
});
