// Shorthands against longhands: the winner is chosen per longhand, in the canvas cascade and the server's, so a row for
// `border` says which of its parts a later `border-color` took. Three real cases from the secret-sauce design system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFolder } from '../../src/doc/folder.js';
import { createCascade } from '../../public/canvas/inspector-cascade.js';
import { assembleCorpus } from '../../bench/corpus.js';

let ss = null;
try { const c = assembleCorpus(); ss = join(c.dir, 'ss-ds'); } catch { /* no secret-sauce checkout here */ }
const eng = () => { const e = openFolder(ss, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-sh-state-')) }); e.setStyles(['tokens.css', 'components.css']); return e; };
const find = (e, id, pred) => { const walk = (ns) => { for (const n of ns) { if (pred(n)) return n; const f = walk(n.children); if (f) return f; } return null; }; return walk(e.tree(id).tree); };

test('shorthand: the primary button’s border keeps width and style, its colour is the cobalt border-color', { skip: !ss }, () => {
  const e = eng(), id = 'components/Controls/preview.html';
  const n = find(e, id, (x) => /\bss-button--primary\b/.test(x.attrs.class || ''));
  const at = e.rulesAt(id, n.node, { width: 800 }).node;
  assert.equal(at.props.border.state, 'partial');
  assert.deepEqual(at.props.border.lost[0].props, ['border-color']);
  assert.equal(at.props.border.lost[0].by.selector, '.ss-button--primary');
  assert.equal(at.props['border-color'].source.selector, '.ss-button--primary');
  assert.equal(at.props['border-color'].state, 'applied');
});

test('shorthand: the key list’s padding at a narrow width loses its left side to the media rule', { skip: !ss }, () => {
  const e = eng(), id = 'components/Plate/preview.html';
  const n = find(e, id, (x) => x.tag === 'ol' && /ss-key/.test(x.attrs.class));
  const wide = e.rulesAt(id, n.node, { width: 900 }).node, narrow = e.rulesAt(id, n.node, { width: 400 }).node;
  assert.equal(wide.props.padding.state, 'applied');
  assert.equal(narrow.props.padding.state, 'partial');
  assert.deepEqual(narrow.props.padding.lost[0].props, ['padding-top', 'padding-left'], 'the media rule sets the top and the left');
  assert.deepEqual(narrow.props.padding.lost[0].by.media, ['(max-width: 640px)']);
  assert.equal(narrow.props['padding-left'].value, '0');
});

test('shorthand: a tab’s border: 0 is partly overridden by the border-bottom of the same rule', { skip: !ss }, () => {
  const e = eng(), id = 'components/Tabs/preview.html';
  const n = find(e, id, (x) => x.attrs.role === 'tab');
  const at = e.rulesAt(id, n.node, { width: 800 }).node;
  assert.equal(at.props.border.state, 'partial');
  const lost = at.props.border.lost.flatMap((l) => l.props);
  assert.ok(lost.includes('border-bottom-width') && lost.includes('border-bottom-style'), `lost: ${lost}`);
  assert.match(at.props['border-bottom'].value, /var\(--line-heavy\) solid transparent/);
  assert.equal(at.props['border-bottom'].lost?.[0].props[0] ?? 'border-bottom-color', 'border-bottom-color', 'the selected tab’s own colour is the only part of border-bottom that loses');
});

test('shorthand: expansion basics on a small file', () => {
  const rules = [{ order: 0, kind: 'style', file: 'a.css', line: 1, selector: '.a', parts: [{ selector: '.a', specificity: [0, 1, 0] }], media: [], sheet: 0, decls: [{ prop: 'margin', value: '0', important: false, line: 1 }, { prop: 'margin-left', value: '5px', important: false, line: 1 }, { prop: 'font', value: '12px/1 x', important: false, line: 1 }, { prop: 'font-size', value: '20px', important: false, line: 1 }] }];
  const el = { id: 'x', parent: null };
  const c = createCascade(rules, { matches: () => true, parent: () => null, inline: () => '', id: (x) => x.id }).explain(el);
  assert.equal(c.props.margin.state, 'partial'); assert.deepEqual(c.props.margin.lost[0].props, ['margin-left']);
  assert.equal(c.props.font.state, 'partial'); assert.deepEqual(c.props.font.lost[0].props, ['font-size']);
  assert.equal(c.props['font-size'].value, '20px');
});
