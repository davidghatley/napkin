import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeAdoption } from '../../src/adopt.js';
import { classifySource, formatReport } from '../../src/scan.js';
import { createBundler } from '../../src/bundle.js';
import { createComponent } from '../../src/commit.js';

const card = `export function Card({ title = 'Hello' }: { title?: string }) {
  return (<div style={{ color: '#f00', padding: 8 }}>
    <h2>{title}</h2>
  </div>);
}`;
const expected = `import type { CSSProperties } from 'react';

export interface CardProps {
  title?: string;
}

const base: Record<string, CSSProperties> = {
  root: {
    color: '#f00',
    padding: 8,
  },
};

const variants: Record<
  string,
  Record<string, Record<string, CSSProperties>>
> = {};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Card({ title = 'Hello' }: CardProps) {
  const v = {};
  return (
    <div data-n="root" style={s('root', v)}>
      <h2 data-n="node1" style={s('node1', v)}>
        {title}
      </h2>
    </div>
  );
}
`;

test('adoption prints a complete file with two-space indentation and no empty styles', () => {
  assert.equal(proposeAdoption(card, 'Card.tsx').source, expected);
  assert.equal(proposeAdoption(card.replace('return (', 'return ').replace('</div>);', '</div>;'), 'Card.tsx').source, expected);
  const unstyled = proposeAdoption('export function Empty() { return <div><span /></div>; }', 'Empty.tsx');
  assert.match(unstyled.source, /const base: Record<string, CSSProperties> = \{\};/);
});

test('prettier with singleQuote leaves the converted file unchanged when installed', async t => {
  let prettier;
  try { prettier = await import('prettier'); }
  catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; t.skip('prettier is not installed'); return; }
  assert.equal(await prettier.format(proposeAdoption(card, 'Card.tsx').source, { parser: 'typescript', singleQuote: true }), expected);
});

test('adoption names a string constant and gives syntax errors their own next step', () => {
  assert.throws(() => proposeAdoption(`const RED = "#f00"; export function Red() { return <div style={{ color: RED }} />; }`, 'Red.tsx'), /RED is a string, not a style object; napkin can only adopt style objects such as \{ color: '#f00' \}/);
  assert.throws(() => proposeAdoption('export function Broken() {\n  return <div>;\n}', 'Broken.tsx'), e => {
    assert.match(e.message, /Broken.tsx: line 2:.*fix the syntax error at line 2 first/s);
    assert.doesNotMatch(e.message, /simplify that construct/);
    return true;
  });
});

test('scan explains where foreign styling starts and caps each construct independently', () => {
  for (const style of ['style={{ color: "red" }}', 'className={cn("red")}']) {
    const row = classifySource(`export function Styled() {\n  return (\n    <div ${style} />\n  );\n}`, 'Styled.tsx');
    assert.equal(row.line, 3);
    assert.match(row.reason, /line 3: styles are not in napkin's `const base` object \(this file styles with className\/cn\(\) or inline styles\); see docs\/dialect.md/);
    assert.doesNotMatch(row.reason, /missing const base/);
  }
  const row = classifySource(`export function Many() {\n${Array.from({ length: 8 }, (_, i) => `  const n${i} = useThing();`).join('\n')}\n  return <div>\n${Array.from({ length: 7 }, () => '    <b className="red" />').join('\n')}\n  </div>;\n}`, 'Many.tsx');
  assert.equal(row.constructs.filter(c => c.name === 'hooks').length, 8);
  assert.equal(row.constructs.filter(c => c.name === 'className or cn() styling').length, 7);
  const report = formatReport([row]);
  assert.match(report, /and 3 more hooks/);
  assert.match(report, /and 2 more className or cn\(\) styling/);
  assert.match(report, /line 6: hooks/);
  assert.doesNotMatch(report, /line 7: hooks|line 8: hooks|line 9: hooks/);
  assert.match(report, /hooks: 1 file\b/);
});

test('build failures preserve esbuild import names, dependency paths, source lines and all errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-polish-build-')), bundler = createBundler();
  mkdirSync(join(dir, 'ui'));
  createComponent(join(dir, 'ui/Imports.tsx'), `import { A } from './missing-one';\nimport { B } from './missing-two';\nexport function Imports() { return <div><A /><B /></div>; }`);
  createComponent(join(dir, 'ui/Syntax.tsx'), 'export function Syntax() {\n  return <div>;\n}');
  createComponent(join(dir, 'ui/Styles.tsx'), `import './theme.css';\nexport function Styles() { return <div />; }`);
  createComponent(join(dir, 'ui/theme.css'), `@import './missing-theme.css';`);
  createComponent(join(dir, 'ui/Named.tsx'), `import { absent } from './exports';\nexport function Named() { return <div>{absent}</div>; }`);
  createComponent(join(dir, 'ui/exports.ts'), 'export const present = 1;');
  try {
    const imports = await bundler.build(join(dir, 'ui/Imports.tsx'), 'Imports', 'ui/Imports.tsx');
    assert.equal(imports.ok, false);
    assert.match(imports.error, /Could not resolve "\.\/missing-one"/);
    assert.match(imports.error, /Could not resolve "\.\/missing-two"/);
    assert.match(imports.error, /Imports.tsx:1:.*import \{ A \}/s);
    assert.match(imports.error, /Imports.tsx:2:.*import \{ B \}/s);
    const syntax = await bundler.build(join(dir, 'ui/Syntax.tsx'), 'Syntax', 'ui/Syntax.tsx');
    assert.equal(syntax.ok, false);
    assert.match(syntax.error, /Syntax.tsx:2:\d+/);
    assert.match(syntax.error, /return <div>;/);
    const css = await bundler.build(join(dir, 'ui/Styles.tsx'), 'Styles', 'ui/Styles.tsx');
    assert.equal(css.ok, false);
    assert.match(css.error, /theme.css:1:\d+/);
    assert.match(css.error, /Could not resolve "\.\/missing-theme.css"/);
    const named = await bundler.build(join(dir, 'ui/Named.tsx'), 'Named', 'ui/Named.tsx');
    assert.equal(named.ok, false);
    assert.match(named.error, /No matching export in "exports.ts" for import "absent"/);
    assert.match(named.error, /Named.tsx:1:\d+/);
    for (const result of [imports, syntax, css, named]) assert.doesNotMatch(result.error, new RegExp(dir));
  } finally { await bundler.close(); rmSync(dir, { recursive: true, force: true }); }
});
