// Moments 9 and 10, server side: the film strip's memory (napkin's edits kept outside the folder, git read-only), restore as
// one undo step through the engine, a version drawn by /view, and the copy payload (exact bytes, exact rule text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openFolder } from '../../src/doc/folder.js';
import { createDocRoutes } from '../../src/doc/routes.js';

const PAGE = (title, color) => `<!doctype html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="card.css"></head>\n<body>\n<div class="card" id="c">\n  <h2>${title}</h2>\n  <p class="note" style="color:${color}">Café notes</p>\n</div>\n</body></html>\n`;
const CSS = `/* card styles */\n.card {\n  padding:   24px;\n  border: 1px solid #ccc;\n}\n@media (max-width: 600px) {\n  .card { padding: 8px }\n}\n.other { color: red }\n`;
const tree = (d, base = d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(join(d, e.name), base) : [join(d, e.name).slice(base.length) + ' ' + createHash('sha1').update(readFileSync(join(d, e.name))).digest('hex')])).sort();

async function boot({ git = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-time-'));
  writeFileSync(join(dir, 'card.html'), PAGE('One', 'navy'));
  writeFileSync(join(dir, 'card.css'), CSS);
  const sh = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', ...a], { stdio: 'ignore' });
  if (git) {
    sh('init', '-q'); sh('add', 'card.html', 'card.css'); sh('commit', '-q', '-m', 'first card');
    writeFileSync(join(dir, 'card.html'), PAGE('Two', 'navy')); sh('commit', '-q', '-am', 'second title');
  }
  const stateDir = mkdtempSync(join(tmpdir(), 'napkin-time-state-'));
  const eng = openFolder(dir, { stateDir });
  const handle = createDocRoutes(eng, { identify: (t) => (t === 'tok' ? 'you' : null) });
  const srv = createServer(async (req, res) => { if (!(await handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end('{}'); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = async (p) => (await fetch(base + p)).json();
  const text = async (p) => (await fetch(base + p)).text();
  const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
  const stop = () => { eng.close(); srv.close(); };
  return { dir, eng, stateDir, get, text, post, stop, sh };
}
const find = (list, tag) => { for (const n of list) { if (n.tag === tag) return n; const f = find(n.children, tag); if (f) return f; } return null; };

test('film: napkin keeps its edits outside the folder, lists them, previews and restores one as a single undo step', async () => {
  const t = await boot();
  try {
    const before = tree(t.dir);
    const first = readFileSync(join(t.dir, 'card.html'));
    const tr = await t.get('/api/component/card.html');
    const h2 = find(tr.tree, 'h2');
    let r = await t.post('/api/edit', { component: 'card.html', baseRevision: tr.revision, edits: [{ op: 'text', node: h2.node, value: 'Two' }] });
    assert.equal(r.ok, true);
    const tr2 = await t.get('/api/component/card.html');
    r = await t.post('/api/edit', { component: 'card.html', baseRevision: tr2.revision, edits: [{ op: 'text', node: find(tr2.tree, 'h2').node, value: 'Three' }] });
    assert.equal(r.ok, true);

    const film = await t.get('/api/component/card.html/film');
    assert.equal(film.git, false);
    assert.equal(film.frames.length, 3, 'as first seen, then two edits');
    assert.deepEqual(film.frames.map((f) => f.by), ['you', 'you', 'file']);
    assert.equal(film.frames[0].same, true, 'the newest frame is the file now');
    const old = film.frames[2];
    assert.match(old.summary, /first saw/);

    // a version is drawn by /view as that version of the file (the applied stylesheets and <base> are the only additions)
    const v = await t.text(`/view/card.html?version=${old.id}`);
    assert.match(v, /<h2>One<\/h2>/); assert.doesNotMatch(v, /Three/);
    assert.match((await t.text('/view/card.html')), /<h2>Three<\/h2>/, 'the live view is untouched');
    const d = await t.get(`/api/component/card.html/film/${old.id}/diff`);
    assert.deepEqual([d.removed, d.added], [1, 1]);

    // restore = one new edit: the file's bytes equal that version, one undo gives back the newest text exactly
    const res = await t.post('/api/component/card.html/film/restore', { frame: old.id });
    assert.equal(res.ok, true);
    assert.deepEqual(readFileSync(join(t.dir, 'card.html')), first, 'byte for byte the first version');
    const after = await t.get('/api/component/card.html/film');
    assert.equal(after.frames.length, 4); assert.match(after.frames[0].summary, /^Restored the version from/);
    assert.equal((await t.get('/api/component/card.html/history')).history[0].summary.startsWith('Restored'), true);
    const u = await t.post('/api/undo', { component: 'card.html' });
    assert.equal(u.ok, true);
    assert.match(readFileSync(join(t.dir, 'card.html'), 'utf8'), /<h2>Three<\/h2>/, 'one undo undoes the whole restore');
    assert.deepEqual(tree(t.dir).filter((x) => !x.startsWith('/card.html')), before.filter((x) => !x.startsWith('/card.html')), 'nothing else in the folder changed');
    assert.equal(tree(t.dir).length, before.length, 'no file was added to the folder');
    // the history survives a restart: a new engine on the same state dir lists the same frames
    t.eng.close();
    const eng2 = openFolder(t.dir, { stateDir: t.stateDir });
    const h = createDocRoutes(eng2, { identify: () => 'you' });
    const out = await new Promise((resolve) => { const chunks = []; const res2 = { writeHead() {}, end: (b) => resolve(JSON.parse(b)) }; h({ method: 'GET', headers: {} }, res2, new URL('http://x/api/component/card.html/film')); void chunks; });
    assert.ok(out.frames.length >= 5, `kept across a restart (${out.frames.length})`);
    eng2.close();
  } finally { t.stop(); }
});

test('film: the git history of the file joins the strip, read-only; restoring a commit is one edit', async () => {
  const t = await boot({ git: true });
  try {
    const before = tree(t.dir);
    const film = await t.get('/api/component/card.html/film');
    assert.equal(film.git, true);
    const g = film.frames.filter((f) => f.source === 'git');
    assert.deepEqual(g.map((f) => f.summary), ['second title', 'first card']);
    assert.equal(g[0].by, 'Ada'); assert.equal(g[0].same, true, 'HEAD equals the file');
    assert.match(await t.text(`/view/card.html?version=${g[1].id}`), /<h2>One<\/h2>/);
    const r = await t.post('/api/component/card.html/film/restore', { frame: g[1].id });
    assert.equal(r.ok, true);
    assert.match(readFileSync(join(t.dir, 'card.html'), 'utf8'), /<h2>One<\/h2>/);
    assert.equal(execFileSync('git', ['-C', t.dir, 'log', '--oneline']).toString().trim().split('\n').length, 2, 'no commit was made');
    assert.match(execFileSync('git', ['-C', t.dir, 'status', '--porcelain']).toString(), /M card\.html/);
    assert.deepEqual(tree(t.dir).filter((x) => !x.includes('.git/') && !x.startsWith('/card.html')), before.filter((x) => !x.includes('.git/') && !x.startsWith('/card.html')));
    const bad = await t.get('/view/card.html?version=g0000000000000000000000000000000000000000');
    assert.equal(bad.ok, false);
  } finally { t.stop(); }
});

test('copy: the element is its exact bytes, each rule its exact text with file:line', async () => {
  const t = await boot();
  try {
    const tr = await t.get('/api/component/card.html');
    const card = find(tr.tree, 'div'), p = find(tr.tree, 'p');
    const rules = (await t.get('/api/component/card.html/rules')).rules.filter((r) => r.kind === 'style' && /\.card/.test(r.selector));
    assert.equal(rules.length, 2);
    const q = rules.map((r) => `rule=${encodeURIComponent(`${r.file}:${r.start}-${r.end}`)}`).join('&');
    const c = await t.get(`/api/component/card.html/copy?node=${p.node}&${q}`);
    assert.equal(c.source, '<p class="note" style="color:navy">Café notes</p>');
    assert.equal(c.css.length, 2);
    assert.equal(c.css[0].text, '.card {\n  padding:   24px;\n  border: 1px solid #ccc;\n}', 'spacing kept as the file has it');
    assert.equal(c.css[0].file, 'card.css'); assert.equal(c.css[0].line, 2);
    assert.equal(c.css[1].text, '.card { padding: 8px }'); assert.equal(c.css[1].line, 7); assert.deepEqual(c.css[1].context, ['@media (max-width: 600px)']);
    assert.match(c.text, /^<p class="note"[^\n]*<\/p>\n\n\/\* napkin: the CSS that applies \*\/\n\/\* card\.css:2 \*\/\n\.card \{\n  padding:   24px;/);
    const whole = await t.get(`/api/component/card.html/copy?node=${card.node}`);
    assert.equal(whole.source, `<div class="card" id="c">\n  <h2>One</h2>\n  <p class="note" style="color:navy">Café notes</p>\n</div>`);
    assert.equal(whole.text, whole.source, 'no rules: just the source');
    const none = await t.get('/api/component/card.html/copy?node=9.9.9');
    assert.equal(none.ok, false);
    const evil = await t.get(`/api/component/card.html/copy?node=${p.node}&rule=${encodeURIComponent('../../etc/passwd:0-10')}`);
    assert.equal(evil.css.length, 0, 'only the folder\'s stylesheets can be sliced');
  } finally { t.stop(); }
});

test('film: a React component keeps versions too, and a version is bundled from its own bytes', async () => {
  const t = await boot();
  try {
    writeFileSync(join(t.dir, 'Badge.tsx'), "export function Badge() {\n  return <span className=\"badge\">Hello</span>;\n}\n");
    t.eng.rescan();
    const id = 'Badge.tsx#Badge';
    const tr = await t.get(`/api/component/${encodeURIComponent(id)}`);
    const span = tr.tree[0];
    const r = await t.post('/api/edit', { component: id, baseRevision: tr.revision, edits: [{ op: 'text', node: span.node, value: 'Goodbye' }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const cp = await t.get(`/api/component/${encodeURIComponent(id)}/copy?node=${span.node}`);
    assert.equal(cp.source, '<span className="badge">Goodbye</span>', 'the JSX slice, exact bytes');
    assert.equal(cp.kind, 'tsx');
    const film = await t.get(`/api/component/${encodeURIComponent(id)}/film`);
    assert.equal(film.frames.length, 2);
    const old = film.frames[1];
    const v = await t.text(`/view/${encodeURIComponent(id)}?version=${old.id}`);
    assert.match(v, /Hello/); assert.doesNotMatch(v, /Goodbye/);
    assert.match(await t.text(`/view/${encodeURIComponent(id)}`), /Goodbye/, 'the live view still builds the file as it is');
    const back = await t.post(`/api/component/${encodeURIComponent(id)}/film/restore`, { frame: old.id });
    assert.equal(back.ok, true);
    assert.match(readFileSync(join(t.dir, 'Badge.tsx'), 'utf8'), />Hello</);
  } finally { t.stop(); }
});
