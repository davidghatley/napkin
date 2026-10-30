// The cascade at one element (decision 0015), without a browser: GET /api/component/<id>/rules?node= answers from the
// parsed file. Also the dead-writer sweep and the dotfile refusal of /raw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openFolder } from '../../src/doc/folder.js';
import { cli } from '../helpers/open.js';

const FILES = {
  'tokens.css': ':root { --space-1: 4px; --space-3: 12px; --ink: #111; --gap: var(--space-3); }\n@media (prefers-color-scheme: dark) { :root { --ink: #eee; } }\n.theme-x { --space-3: 99px; }\n',
  'a.html': `<!doctype html><link rel="stylesheet" href="tokens.css"><style>
.card { padding: var(--space-3); color: var(--ink); }
.card .tag { padding: var(--space-1); }
div .tag { padding: 1px; }
.tag { padding: 2px !important; margin: var(--gap) var(--missing, 7px); }
@media (max-width: 500px) { .card { padding: var(--space-1); } }
li:nth-child(2) { color: red; }
</style>
<div class="card" id="c"><span class="tag" style="padding: 5px">Hi</span></div>
<div class="card theme-x"><span class="tag">Yo</span></div>
<ul><li>a</li><li>b</li></ul>`,
};
const mk = () => { const d = mkdtempSync(join(tmpdir(), 'napkin-casc-')); for (const [p, t] of Object.entries(FILES)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), t); } return d; };
const engine = () => openFolder(mk(), { stateDir: mkdtempSync(join(tmpdir(), 'napkin-casc-state-')) });
const find = (eng, pred) => { const walk = (ns) => { for (const n of ns) { if (pred(n)) return n; const f = walk(n.children); if (f) return f; } return null; }; return walk(eng.tree('a.html').tree); };

test('cascade: winner by importance, specificity, order; inline; var() resolved to the definition that applies', () => {
  const eng = engine(); eng.setStyles(['tokens.css']);
  const tag = find(eng, (n) => n.attrs.style === 'padding: 5px');
  const at = eng.rulesAt('a.html', tag.node, { width: 1280, theme: 'light' }).node;
  assert.equal(at.props.padding.value, '2px', '!important rule beats inline and higher specificity');
  assert.equal(at.props.padding.source.selector, '.tag');
  const pads = at.rules.flatMap((r) => r.decls.filter((d) => d.prop === 'padding').map((d) => [r.selector, d.state]));
  assert.deepEqual(pads, [['.tag', 'applied'], ['div .tag', 'overridden'], ['.card .tag', 'overridden']], 'listed weakest first (specificity, then order)');
  assert.equal(pads.filter(([, s]) => s === 'applied').length, 1);
  assert.equal(at.inline[0].state, 'overridden');
  assert.equal(at.inline[0].by.selector, '.tag');
  assert.equal(at.props.margin.resolved, '12px 7px', 'var(--gap) resolves through --space-3; the fallback is used for --missing');
  assert.equal(at.vars['--space-3'].value, '12px');
  assert.equal(at.vars['--space-3'].source.file, 'tokens.css');
  assert.equal(at.vars['--space-3'].source.line, 1);
  assert.equal(at.vars['--missing'], null);
});

test('cascade: a variable is inherited from the nearest element that sets it; @media and theme are honoured', () => {
  const eng = engine(); eng.setStyles(['tokens.css']);
  const second = find(eng, (n) => n.tag === 'span' && n.attrs.class === 'tag' && !n.attrs.style);
  const at = eng.rulesAt('a.html', second.node, { width: 1280, theme: 'light' }).node;
  assert.equal(at.vars['--space-3'].value, '99px', '.theme-x on the parent redefines it');
  assert.equal(at.vars['--space-3'].source.selector, '.theme-x');
  assert.equal(at.vars['--space-3'].inherited, true);
  const card = find(eng, (n) => n.attrs.id === 'c');
  const light = eng.rulesAt('a.html', card.node, { width: 1280, theme: 'light' }).node;
  assert.equal(light.props.padding.resolved, '12px'); assert.equal(light.vars['--ink'].value, '#111');
  const small = eng.rulesAt('a.html', card.node, { width: 400, theme: 'dark' }).node;
  assert.equal(small.props.padding.resolved, '4px', '@media (max-width: 500px) applies at 400');
  assert.equal(small.vars['--ink'].value, '#eee'); assert.deepEqual(small.vars['--ink'].source.media, ['(prefers-color-scheme: dark)']);
});

test('cascade: structural selectors match like the browser; an unknown node is refused', () => {
  const eng = engine();
  const lis = []; const walk = (ns) => ns.forEach((n) => { if (n.tag === 'li') lis.push(n); walk(n.children); }); walk(eng.tree('a.html').tree);
  assert.equal(eng.rulesAt('a.html', lis[0].node).node.props.color, undefined);
  assert.equal(eng.rulesAt('a.html', lis[1].node).node.props.color.value, 'red');
  assert.throws(() => eng.rulesAt('a.html', 'nope'), /no element/);
});

test('sweep: a dead writer’s temp and guard files go on open and before a write; a live one’s and anything else stay', () => {
  const dir = mk();
  const dead = 2 ** 22 + 11; // beyond pid_max on this machine: no such process
  const mine = [`.a.html.tmp-${dead}-0`, `.a.html.guard-${dead}-3`, `.tokens.css.tmp-${dead}-1`];
  const keep = [`.a.html.tmp-${process.pid}-9`, '.a.html.tmp-abc-1', '.other.html.tmp-' + dead + '-0', '.env', 'notes.tmp-1-1'];
  for (const f of [...mine, ...keep]) writeFileSync(join(dir, f), 'x');
  const eng = openFolder(dir, { stateDir: mkdtempSync(join(tmpdir(), 'napkin-casc-state-')) });
  eng.files();
  const left = readdirSync(dir);
  for (const f of mine) assert.ok(!left.includes(f), `${f} swept`);
  for (const f of keep) assert.ok(left.includes(f), `${f} kept`);
  writeFileSync(join(dir, `.a.html.tmp-${dead}-5`), 'x');
  const tag = find(eng, (n) => n.attrs.class === 'card');
  eng.edit('a.html', { baseRevision: eng.tree('a.html').revision, edits: [{ op: 'style', node: tag.node, prop: 'color', value: 'red' }], by: 't' });
  assert.ok(!readdirSync(dir).includes(`.a.html.tmp-${dead}-5`), 'swept before the write');
});

test('http: ?node= over the wire, and /raw refuses dot-segments', async () => {
  const dir = mk(); writeFileSync(join(dir, '.secret'), 'nope'); mkdirSync(join(dir, '.git')); writeFileSync(join(dir, '.git', 'config'), 'nope');
  const app = await cli(dir);
  try {
    const get = (p) => fetch(app.url + p.replace(/^\//, ''));
    const t = await (await get('api/component/a.html')).json();
    const id = (function f(ns) { for (const n of ns) { if (n.attrs.id === 'c') return n.node; const r = f(n.children); if (r) return r; } })(t.tree);
    const r = await (await get(`api/component/a.html/rules?node=${id}&width=400&theme=dark`)).json();
    assert.equal(r.node.width, 400); assert.equal(r.node.theme, 'dark');
    assert.equal((await get('api/component/a.html/rules?node=zzz')).status, 404);
    assert.equal((await get('raw/tokens.css')).status, 200);
    for (const p of ['raw/.secret', 'raw/.git/config', 'raw/%2e%2e/x', 'raw/.git%2fconfig']) assert.equal((await get(p)).status, 404, p);
  } finally { await app.stop(); }
});
