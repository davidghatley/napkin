// The document engine (decision 0014), without a browser: source maps, the one edit path, undo, stale edits, the
// "ask once" state and the promise that nothing is written into the folder except edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHtml } from '../../src/doc/html.js';
import { parseCss } from '../../src/doc/css.js';
import { parseJsx, componentTree } from '../../src/doc/jsx.js';
import { openFolder } from '../../src/doc/folder.js';

const L = (t) => Buffer.from(t, 'utf8').toString('latin1');
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-doc-'));
  for (const [p, t] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), t); }
  return dir;
}
const listAll = (d, base = d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listAll(join(d, e.name), base) : [join(d, e.name).slice(base.length + 1)])).sort();

test('html: implied end tags, raw text, void and foreign self-closing elements, byte offsets', () => {
  const s = L('<!-- c --><!doctype html><p>One<p>Two <b>é</b><ul><li>a<li>b</ul><table><tr><td>x<td>y</table><svg><rect/><g><circle/></g></svg><script>if (a<b) "</div>"</script><br/><img src=x>');
  const d = parseHtml(s);
  const tags = d.nodes.map((n) => n.tag);
  assert.deepEqual(tags, ['p', 'p', 'b', 'ul', 'li', 'li', 'table', 'tr', 'td', 'td', 'svg', 'rect', 'g', 'circle', 'script', 'br', 'img']);
  const [p1, p2] = d.nodes;
  assert.equal(s.slice(p1.start, p1.end), '<p>One', 'a <p> ends where the next <p> starts');
  assert.ok(p1.implicitEnd);
  assert.equal(d.nodes.find((n) => n.tag === 'ul').parent, p2.parent, '<ul> closes the open <p>');
  assert.equal(d.nodes.find((n) => n.tag === 'b').start, s.indexOf('<b>'), 'offsets are bytes (é is 2)');
  assert.equal(d.nodes.find((n) => n.tag === 'g').children[0].tag, 'circle', 'SVG />');
  assert.equal(d.nodes.filter((n) => n.parent?.tag === 'script').length, 0, 'script content is text');
  assert.equal(d.nodes.find((n) => n.tag === 'img').attrs[0].value, 'x');
});

test('css: values without spaces, comments or !important; contexts; imports', () => {
  const s = '@import url("a.css") screen;\n.a   {  padding : 24px ;color:red /* c */ ;  margin: 0 !important }\n@media (max-width: 600px) { .a { padding: 2px } }';
  const { rules, imports } = parseCss(s);
  assert.equal(imports[0].url, 'a.css'); assert.equal(imports[0].media, 'screen');
  const [a, b] = rules;
  assert.deepEqual(a.decls.map((d) => [d.prop, d.value, d.important]), [['padding', '24px', false], ['color', 'red', false], ['margin', '0', true]]);
  assert.equal(b.context[0].prelude, '(max-width: 600px)');
});

test('jsx: exported components by shape, elements with byte ranges, prop-elements kept apart', () => {
  const s = L(`import x from 'y';\nexport const SIZES = [1];\nconst Inner = () => <i/>;\nfunction Card({ a }) { return <div className={cn(a)} icon={<Icon/>}><span>é</span>{a && <b/>}</div>; }\nexport { Card, Inner as Other };\nexport default function App() { return <Card/>; }\n`);
  const p = parseJsx(s, '.tsx');
  assert.deepEqual(p.components.map((c) => c.name), ['Card', 'Other', 'App']);
  const t = componentTree(p, p.components[0]);
  assert.deepEqual(t.flat.map((n) => n.tag), ['div', 'span', 'b']);
  assert.equal(s.slice(t.flat[1].start, t.flat[1].end), L('<span>é</span>'));
  assert.equal(t.roots[0].propElements.length, 1);
});

test('edits mirror the file: quotes, compact styles, one declaration per line, CRLF', () => {
  const dir = folder({
    'a.html': '<!doctype html>\r\n<style>\r\n.x {\r\n  color: red;\r\n}\r\n.y{margin:0;padding:0}\r\n</style>\r\n<p class=one title=\'q\' style="a:b;c:d">Hi</p>\r\n',
  });
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-doc-state-')) });
  try {
    const t = eng.tree('a.html');
    const p = (function find(l) { for (const n of l) { if (n.tag === 'p') return n; const f = find(n.children); if (f) return f; } })(t.tree);
    eng.edit('a.html', { baseRevision: t.revision, by: 't', edits: [
      { op: 'class', node: p.node, add: ['two'] }, { op: 'attr', node: p.node, name: 'title', value: "it's" },
      { op: 'style', node: p.node, prop: 'e', value: 'f' }, { op: 'rule', file: 'a.html', selector: '.x', prop: 'margin', value: '4px' },
      { op: 'rule', file: 'a.html', selector: '.y', prop: 'border', value: '0' }, { op: 'text', node: p.node, value: 'A & <B>' },
    ] });
    assert.equal(readFileSync(join(dir, 'a.html'), 'utf8'), '<!doctype html>\r\n<style>\r\n.x {\r\n  color: red;\r\n  margin: 4px;\r\n}\r\n.y{margin:0;padding:0;border:0}\r\n</style>\r\n<p class="one two" title=\'it&#39;s\' style="a:b;c:d;e:f">A & &lt;B></p>\r\n');
    for (let k = 0; k < 1; k++) eng.undo('a.html', 't');
    assert.equal(readFileSync(join(dir, 'a.html'), 'utf8').includes('<p class=one title=\'q\' style="a:b;c:d">Hi</p>'), true, 'one batch is one undo step');
  } finally { eng.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a stale edit is re-based onto the current text; undo of a changed file keeps the other change', () => {
  const dir = folder({ 'c.css': '.a { color: red; }\n.b { color: blue; }\n', 'x.html': '<link rel="stylesheet" href="c.css"><div class="a">A</div><div class="b">B</div>' });
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-doc-state-')) });
  try {
    const t0 = eng.tree('x.html');
    const divB = t0.tree.find((n) => n.tag === 'div' && n.attrs.class === 'b') || t0.tree.flatMap((n) => n.children).find((n) => n.attrs?.class === 'b');
    eng.edit('x.html', { baseRevision: t0.revision, by: 'a', edits: [{ op: 'text', node: t0.tree.find((n) => n.attrs?.class === 'a')?.node ?? '1', value: 'AA' }] });
    // b edits against the old revision: its node still starts with the same tag, once
    const r = eng.edit('x.html', { baseRevision: t0.revision, by: 'b', edits: [{ op: 'text', node: divB.node, value: 'BB' }] });
    assert.equal(r.ok, true);
    assert.match(readFileSync(join(dir, 'x.html'), 'utf8'), /AA.*BB/);
    eng.edit('x.html', { by: 'a', edits: [{ op: 'rule', file: 'c.css', selector: '.a', prop: 'color', value: 'green' }] });
    writeFileSync(join(dir, 'c.css'), readFileSync(join(dir, 'c.css'), 'utf8').replace('blue', 'navy')); // someone else
    eng.undo('x.html', 'a');
    assert.equal(readFileSync(join(dir, 'c.css'), 'utf8'), '.a { color: red; }\n.b { color: navy; }\n');
    assert.throws(() => eng.edit('x.html', { baseRevision: 'nope', by: 'a', edits: [{ op: 'delete', node: '1' }] }), /stale revision/);
  } finally { eng.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('refusals are one spot at a time; ambiguous rules list their matches; nothing else is written', () => {
  const dir = folder({ 's.css': '.a { color: red }\n@media (min-width: 9px) { .a { color: blue } }\n', 'p.html': '<p class="a">x</p>', 'C.tsx': 'export function C() { return <div className={cn("x")}>hi</div>; }\n' });
  const stateDir = mkdtempSync(join(tmpdir(), 'napkin-doc-state-'));
  const before = listAll(dir);
  const eng = openFolder(dir, { stateDir });
  try {
    assert.throws(() => eng.edit('p.html', { by: 't', edits: [{ op: 'rule', file: 's.css', selector: '.a', prop: 'margin', value: '0' }] }), (e) => e.status === 409 && e.matches.length === 2);
    eng.edit('p.html', { by: 't', edits: [{ op: 'rule', file: 's.css', selector: '.a', media: '(min-width: 9px)', prop: 'color', value: 'teal' }] });
    assert.match(readFileSync(join(dir, 's.css'), 'utf8'), /\{ \.a \{ color: teal \} \}/);
    const t = eng.tree('C.tsx#C');
    assert.throws(() => eng.edit('C.tsx#C', { by: 't', edits: [{ op: 'class', node: t.tree[0].node, add: ['y'] }] }), /computed in code/);
    eng.edit('C.tsx#C', { by: 't', edits: [{ op: 'text', node: t.tree[0].node, value: 'a {b}' }] });
    assert.match(readFileSync(join(dir, 'C.tsx'), 'utf8'), /\{"a \{b\}"\}/);
    eng.setStyles(['s.css']);
    assert.deepEqual(listAll(dir), before, 'answers and layout live in the state dir');
    assert.deepEqual(JSON.parse(readFileSync(join(eng.state, 'styles.json'), 'utf8')).applied, ['s.css']);
  } finally { eng.close(); rmSync(dir, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true }); }
});

const firstTag = (list, tag) => { for (const n of list) { if (n.tag === tag) return n; const f = firstTag(n.children, tag); if (f) return f; } return null; };

test('text runs: mixed content is editable run by run; computed JSX text is refused alone', () => {
  const dir = folder({
    'm.html': '<p>two &amp; <b>bold</b></p>\n<p>one <i>x</i> two <!-- c --> three</p>\n',
    'P.tsx': "export function P({ n }) { return <div><p>{\"x\"}</p><p>{'y'} and {n}</p></div>; }\n",
  });
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-doc-state-')) });
  try {
    const t = eng.tree('m.html');
    const [p1, p2] = t.tree.filter((n) => n.tag === 'p');
    assert.deepEqual(p1.runs.map((r) => r.text), ['two &']);
    assert.deepEqual(p2.runs.map((r) => r.text), ['one', 'two', 'three']);
    eng.edit('m.html', { by: 't', edits: [{ op: 'text', node: p1.node, value: 'three &' }] }); // the one run, no index needed
    assert.throws(() => eng.edit('m.html', { by: 't', edits: [{ op: 'text', node: p2.node, value: 'z' }] }), (e) => e.status === 409 && /send run/.test(e.message));
    eng.edit('m.html', { by: 't', edits: [{ op: 'text', node: p2.node, run: 2, value: '3' }] });
    assert.equal(readFileSync(join(dir, 'm.html'), 'utf8'), '<p>three & <b>bold</b></p>\n<p>one <i>x</i> two <!-- c --> 3</p>\n');
    const j = eng.tree('P.tsx#P');
    const [q1, q2] = j.tree[0].children;
    assert.deepEqual(q2.runs.map((r) => [r.text, r.editable]), [['y', true], ['and', true], ['{n}', false]]);
    eng.edit('P.tsx#P', { by: 't', edits: [{ op: 'text', node: q1.node, value: 'say "hi"' }] });
    eng.edit('P.tsx#P', { by: 't', edits: [{ op: 'text', node: q2.node, run: 0, value: "it's" }] });
    assert.throws(() => eng.edit('P.tsx#P', { by: 't', edits: [{ op: 'text', node: q2.node, run: 2, value: 'z' }] }), /computed in code/);
    assert.equal(readFileSync(join(dir, 'P.tsx'), 'utf8'), "export function P({ n }) { return <div><p>{\"say \\\"hi\\\"\"}</p><p>{'it\\'s'} and {n}</p></div>; }\n");
  } finally { eng.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a TSX file that does not parse keeps a component whose frame says why (file and line)', async () => {
  const dir = folder({ 'ui/game-view.tsx': 'export function GameView() {\n  return <div>\n}\n' });
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-doc-state-')) });
  try {
    const f = eng.files().find((x) => x.path === 'ui/game-view.tsx');
    assert.deepEqual(f.components.map((c) => c.id), ['ui/game-view.tsx#GameView']);
    const t = eng.tree('ui/game-view.tsx#GameView');
    assert.deepEqual(t.tree, []); assert.match(t.error, /game-view\.tsx: line \d+/);
    const { createTsxViews } = await import('../../src/doc/view.js');
    const v = await createTsxViews(eng).view(eng.component('ui/game-view.tsx#GameView'));
    assert.equal(v.status, 200); assert.match(v.body.toString(), /could not build ui\/game-view\.tsx#GameView: line \d+/);
    assert.throws(() => eng.edit('ui/game-view.tsx#GameView', { by: 't', edits: [{ op: 'delete', node: '0' }] }), (e) => e.status === 422);
  } finally { eng.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('TSX style edits keep the file\'s quote style', () => {
  const dir = folder({ 'S.tsx': "export const S = () => <div style={{ color: 'red', margin: 4 }}><span style={{}}>a</span></div>;\n" });
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-doc-state-')) });
  try {
    const t = eng.tree('S.tsx#S');
    eng.edit('S.tsx#S', { by: 't', edits: [{ op: 'style', node: t.tree[0].node, prop: 'color', value: 'blue' }, { op: 'style', node: t.tree[0].node, prop: 'padding', value: '2px 4px' }, { op: 'style', node: t.tree[0].node, prop: 'margin', value: '8px' }] });
    eng.edit('S.tsx#S', { by: 't', edits: [{ op: 'style', node: t.tree[0].children[0].node, prop: 'font-weight', value: 'bold' }] });
    assert.equal(readFileSync(join(dir, 'S.tsx'), 'utf8'), "export const S = () => <div style={{ color: 'blue', margin: 8, padding: '2px 4px' }}><span style={{ fontWeight: 'bold' }}>a</span></div>;\n");
  } finally { eng.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('rules: specificity per selector part, cascade order, and where every variable is defined', () => {
  const dir = folder({
    't.css': ':root { --ink: #111; }\n@media (prefers-color-scheme: dark) { :root { --ink: #eee; } }\n',
    'p.html': '<link rel="stylesheet" href="t.css"><style>#a .x, p { color: var(--ink); } .x:hover > b { color: var(--ink, red); }</style><p id="a" style="--pad: 4px; padding: var(--pad)">x</p>',
  });
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-doc-state-')) });
  try {
    const r = eng.rulesOf('p.html');
    const style = r.rules.filter((x) => x.kind === 'style');
    assert.deepEqual(style.map((x) => x.order), [...style.map((x) => x.order)].sort((a, b) => a - b));
    const list = style.find((x) => x.selector.startsWith('#a'));
    assert.deepEqual(list.parts.map((p) => [p.selector, p.specificity]), [['#a .x', [1, 1, 0]], ['p', [0, 0, 1]]]);
    assert.deepEqual(style.find((x) => x.selector.startsWith('.x:hover')).parts[0].specificity, [0, 2, 1]);
    assert.deepEqual(list.decls[0].uses, ['--ink']);
    assert.deepEqual(r.vars['--ink'].map((d) => [d.file, d.line, d.value, d.selector, d.media]), [['t.css', 1, '#111', ':root', []], ['t.css', 2, '#eee', ':root', ['(prefers-color-scheme: dark)']]]);
    const ink = r.vars['--ink'][0];
    assert.equal(readFileSync(join(dir, 't.css'), 'latin1').slice(ink.valStart, ink.valEnd), '#111');
    assert.deepEqual(r.vars['--pad'].map((d) => [d.inline, d.value]), [[true, '4px']]);
    assert.deepEqual(r.undefinedVars, []);
  } finally { eng.close(); rmSync(dir, { recursive: true, force: true }); }
});
