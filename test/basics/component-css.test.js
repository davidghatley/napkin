// Create component from a selection, without a browser: what the made component's CSS says (standards section 9, rule 5).
// The frames are test/fixtures/component/*.html, two pages an audit wrote to be hard: a state named on an ancestor outside
// the selection, a positional rule, a CSS-kept white space block, a card that a grid gave its width.
// What the browser draws from these files is checked in component-fidelity.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openFolder } from '../../src/doc/folder.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'component');
function engine() {
  const d = mkdtempSync(join(tmpdir(), 'napkin-cmpcss-'));
  cpSync(FIX, d, { recursive: true });
  mkdirSync(join(d, 'assets'), { recursive: true });
  writeFileSync(join(d, 'assets', 'landscape.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'));
  return { d, eng: openFolder(d, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-cmpcss-state-')) }) };
}
const find = (eng, file, pred) => { const walk = (ns) => { for (const n of ns) { if (pred(n)) return n; const f = walk(n.children); if (f) return f; } return null; }; return walk(eng.tree(file).tree); };
const cls = (c) => (n) => String(n.attrs?.class || '').split(/\s+/).includes(c);
const cssOf = (src) => /const css = `\n([\s\S]*?)\n`;/.exec(src)?.[1] || '';
// every selector of every rule (inside @media too), keyframe steps left out
const selectors = (css) => [...css.matchAll(/(^|\n)\s*([^@{}\n][^{}\n]*?)\s*\{/g)].map((m) => m[2]).filter((s) => !/^(from|to|\d+%)/.test(s));

test('a state named on an ancestor outside stays a state, on the wrapper; it never becomes unconditional', () => {
  const { d, eng } = engine();
  const node = find(eng, 'journey.html', (n) => n.attrs?.id === 'forecast');
  const made = eng.componentFrom({ from: 'journey.html', node: node.node });
  const css = cssOf(readFileSync(join(d, made.path), 'utf8'));
  assert.doesNotMatch(css, /:where\(\.weather\) \{background:#ffe2a0;\}/, 'not the resting look');
  assert.match(css, /:where\(\.weather-context:hover \.weather\) \{background:#ffe2a0;\}/);
});

test('a positional rule keeps the look it gave: the element is reached by its place in the component instead', () => {
  const { d, eng } = engine();
  const forecast = find(eng, 'journey.html', (n) => n.attrs?.id === 'forecast');
  const span = forecast.children.find((n) => n.tag === 'span'); // the first span: :nth-child(2) of the section
  const made = eng.componentFrom({ from: 'journey.html', node: span.node });
  const css = cssOf(readFileSync(join(d, made.path), 'utf8'));
  assert.match(css, /:where\(\.span-context > \*\) \{color:#c21d56;font-weight:bold;\}/, 'red and bold, on the root');
  assert.doesNotMatch(css, /nth-child\(2\)/);
});

test('every rule the component carries is scoped to it, so nothing reaches a page that uses it', () => {
  const { d, eng } = engine();
  for (const [file, pick] of [['journey.html', (n) => n.attrs?.id === 'forecast'], ['journey.html', (n) => n.tag === 'span'], ['journey.html', cls('trip')], ['journey.html', cls('teaser')], ['booking.html', cls('booking')], ['booking.html', cls('inline-note')]]) {
    const node = find(eng, file, pick);
    const made = eng.componentFrom({ from: file, node: node.node });
    const src = readFileSync(join(d, made.path), 'utf8');
    const ctx = /className="([\w-]+-context)"/.exec(src)?.[1];
    assert.ok(ctx, `${made.name} has its wrapper`);
    for (const sel of selectors(cssOf(src))) {
      for (const one of sel.split(/,\s*(?![^(]*\))/)) assert.ok(one.startsWith(`.${ctx}`) || one.startsWith(`:where(.${ctx}`), `${made.name}: "${one}" is scoped to .${ctx}`);
    }
  }
});

test('a positional rule that does reach inside the component keeps its readable form', () => {
  const { d, eng } = engine();
  const node = find(eng, 'journey.html', (n) => n.attrs?.id === 'forecast');
  const css = cssOf(readFileSync(join(d, eng.componentFrom({ from: 'journey.html', node: node.node }).path), 'utf8'));
  assert.match(css, /:where\(\.weather-context \.weather span:nth-child\(2\)\) \{color:#c21d56;font-weight:bold;\}/);
  assert.match(css, /:where\(\.weather-context > \.weather\) \{border:1px solid/);
});

test('white space a rule keeps (white-space: pre-wrap) is written exactly, and so is white space an ancestor keeps', async () => {
  const { d, eng } = engine();
  const node = find(eng, 'journey.html', cls('scrollcopy'));
  const src = readFileSync(join(d, eng.componentFrom({ from: 'journey.html', node: node.node }).path), 'utf8');
  assert.match(src, /\{"First line\\n    Keep four spaces and this new line\. A long piece of copy carries enough words to wrap across the card and expose whether the generated source preserves deliberate line breaks\.\\nFinal line\."\}/);
  const { toComponent } = await import('../../src/doc/to-component.js');
  const out = toComponent({ name: 'Poem', html: '<div class="poem"><p>one\n  two</p>\n<p>three   four</p></div>', keep: ['', '0', '1'] }).source;
  assert.match(out, /\{"one\\n  two"\}/);
  assert.match(out, /\{"three   four"\}/);
  assert.match(out, /\{"\\n"\}/, 'the line break between the paragraphs is text the browser keeps');
});

test('a root that a grid or flex parent sized gets the width it had, first, so its own width rules still win', () => {
  const { d, eng } = engine();
  const node = find(eng, 'journey.html', cls('teaser'));
  const css = cssOf(readFileSync(join(d, eng.componentFrom({ from: 'journey.html', node: node.node, width: 396.5 }).path), 'utf8'));
  assert.match(css, /^\.teaser-context \{[\s\S]*?\}\n\n(@media[\s\S]*?\}\n\}\n\n)?:where\(\.teaser-context > \*\) \{ width: 396\.5px; \}\n\n:where\(\.teaser-context \.teaser\)/);
  const plain = cssOf(readFileSync(join(d, eng.componentFrom({ from: 'journey.html', node: node.node }).path), 'utf8'));
  assert.doesNotMatch(plain, /width: \d/, 'no width when the frame sent none');
});

test('naming afterwards: the file and its export take the new name, and one undo still takes the component away', () => {
  const { d, eng } = engine();
  const node = find(eng, 'journey.html', cls('trip'));
  const made = eng.componentFrom({ from: 'journey.html', node: node.node, by: 'me' });
  assert.equal(made.path, 'Trip.tsx');
  const r = eng.renameMade({ path: 'Trip.tsx', to: 'CoastCard', by: 'me' });
  assert.equal(r.path, 'CoastCard.tsx');
  assert.equal(existsSync(join(d, 'Trip.tsx')), false);
  const src = readFileSync(join(d, 'CoastCard.tsx'), 'utf8');
  assert.match(src, /export default function CoastCard\(\) \{/);
  assert.match(src, /className="coast-card-context"/);
  assert.match(src, /:where\(\.coast-card-context \.trip\)/);
  assert.doesNotMatch(src, /trip-context|function Trip\(/);
  assert.throws(() => eng.renameMade({ path: 'CoastCard.tsx', to: 'lower', by: 'me' }), /cannot be a component name/);
  assert.throws(() => eng.renameMade({ path: 'CoastCard.tsx', to: 'Other', by: 'someone else' }), /not just made by napkin/);
  const latest = eng.latest('undo', 'me');
  assert.equal(latest.component, 'CoastCard.tsx');
  eng.undo('CoastCard.tsx', 'me');
  assert.equal(existsSync(join(d, 'CoastCard.tsx')), false, 'one undo: the component is gone');
  assert.equal(existsSync(join(d, 'Trip.tsx')), false);
});
