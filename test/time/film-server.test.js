// Moments 9 and 10, server side: the film strip's memory (napkin's edits kept outside the folder, git read-only), restore as
// one undo step through the engine, a version drawn by /view, and the copy payload (exact bytes, exact rule text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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

test('film: napkin keeps its edits outside the folder, merges a run of one thing, previews and restores one as a single undo step', async () => {
  const t = await boot();
  try {
    const before = tree(t.dir);
    const first = readFileSync(join(t.dir, 'card.html'));
    for (const v of ['Two', 'Three']) {
      const tr = await t.get('/api/component/card.html');
      const r = await t.post('/api/edit', { component: 'card.html', baseRevision: tr.revision, edits: [{ op: 'text', node: find(tr.tree, 'h2').node, value: v }] });
      assert.equal(r.ok, true);
    }
    const film = await t.get('/api/component/card.html/film');
    assert.equal(film.git, false);
    assert.equal(film.frames.length, 2, 'the file as first seen, and one run of two text edits');
    assert.deepEqual(film.frames.map((f) => f.by), ['you', 'file']);
    assert.equal(film.frames[0].count, 2); assert.equal(film.frames[0].what, 'One \u2192 Three', 'the run says what changed over all of it');
    assert.equal(film.frames[0].same, true, 'the newest frame is the files now');
    const old = film.frames[1];
    assert.match(old.summary, /first saw/);
    assert.equal(film.frames[0].beforeId, old.id);

    const v = await t.text(`/view/card.html?version=${old.id}`);
    assert.match(v, /<h2>One<\/h2>/); assert.doesNotMatch(v, /Three/);
    assert.match(v, /<base href="\/vraw\/card\.html\/[^/]+\/"/, 'a version draws from its own stylesheets');
    assert.match((await t.text('/view/card.html')), /<h2>Three<\/h2>/, 'the live view is untouched');
    const d = await t.get(`/api/component/card.html/film/${old.id}/diff`);
    assert.deepEqual([d.removed, d.added], [1, 1]);

    const res = await t.post('/api/component/card.html/film/restore', { frame: old.id });
    assert.equal(res.ok, true);
    assert.deepEqual(readFileSync(join(t.dir, 'card.html')), first, 'byte for byte the first version');
    const after = await t.get('/api/component/card.html/film');
    assert.match(after.frames[0].summary, /^Restored the version from/);
    assert.equal((await t.get('/api/component/card.html/history')).history[0].summary.startsWith('Restored'), true);
    assert.equal((await t.post('/api/undo', { component: 'card.html' })).ok, true);
    assert.match(readFileSync(join(t.dir, 'card.html'), 'utf8'), /<h2>Three<\/h2>/, 'one undo undoes the whole restore');
    assert.equal(tree(t.dir).length, before.length, 'no file was added to the folder');
    // the history survives a restart
    t.eng.close();
    const eng2 = openFolder(t.dir, { stateDir: t.stateDir });
    const h = createDocRoutes(eng2, { identify: () => 'you' });
    const out = await new Promise((resolve) => { h({ method: 'GET', headers: {} }, { writeHead() {}, end: (b) => resolve(JSON.parse(b)) }, new URL('http://x/api/component/card.html/film')); });
    assert.ok(out.frames.length >= 2, `kept across a restart (${out.frames.length})`);
    eng2.close();
  } finally { t.stop(); }
});

test('film: a CSS edit is a frame of every component that uses the stylesheet; a version and a restore cover every file', async () => {
  const t = await boot();
  try {
    writeFileSync(join(t.dir, 'pill.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="card.css"></head><body><span class="card">Pill</span></body></html>\n');
    t.eng.rescan();
    const cssBefore = readFileSync(join(t.dir, 'card.css'), 'utf8');
    for (const id of ['card.html', 'pill.html']) await t.get(`/api/component/${id}/film`); // each is looked at once
    const rules = (await t.get('/api/component/card.html/rules')).rules.find((r) => r.kind === 'style' && r.selector === '.card');
    const r = await t.post('/api/edit', { component: 'pill.html', edits: [{ op: 'rule', file: 'card.css', selector: '.card', index: 0, prop: 'padding', value: '40px' }] });
    assert.equal(r.ok, true, JSON.stringify(r)); void rules;
    for (const id of ['card.html', 'pill.html']) {
      const f = await t.get(`/api/component/${id}/film`);
      assert.equal(f.frames.length, 2, `${id}: the stylesheet edit is a frame`);
      assert.match(f.frames[0].what, /^padding 24px \u2192 40px/); assert.match(f.frames[0].where, /\.card/);
    }
    const f = await t.get('/api/component/pill.html/film');
    const old = f.frames[1];
    const v = await t.text(`/vraw/pill.html/${old.id}/card.css`);
    assert.equal(v, cssBefore, 'the old stylesheet is served for the old version');
    // restoring Pill's old version puts the stylesheet back (nobody else changed it since)
    const res = await t.post('/api/component/pill.html/film/restore', { frame: old.id });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(readFileSync(join(t.dir, 'card.css'), 'utf8'), cssBefore);
    assert.deepEqual(res.changed, ['card.css'], 'one write, one step');
    assert.equal((await t.post('/api/undo', { component: 'pill.html' })).ok, true);
    assert.match(readFileSync(join(t.dir, 'card.css'), 'utf8'), /padding: 40px|padding:\s+40px/);
    // now somebody works on Card's stylesheet rule: restoring Pill's older version would undo that, so it is refused with the reason
    const f2 = await t.get('/api/component/pill.html/film');
    const oldest = f2.frames.at(-1);
    const r2 = await t.post('/api/edit', { component: 'card.html', edits: [{ op: 'rule', file: 'card.css', selector: '.card', index: 0, prop: 'border', value: '2px solid red' }] });
    assert.equal(r2.ok, true);
    const refused = await t.post('/api/component/pill.html/film/restore', { frame: oldest.id });
    assert.equal(refused.ok, false); assert.match(refused.error, /card\.css is shared, and it changed at \d\d:\d\d while you worked on card\.html after this version/);
    assert.match(readFileSync(join(t.dir, 'card.css'), 'utf8'), /2px solid red/, 'nothing was written');
  } finally { t.stop(); }
});

test('film: identical bytes are one frame whichever source has them', async () => {
  const t = await boot({ git: true });
  try {
    const f = await t.get('/api/component/card.html/film');
    // the file as napkin first saw it is HEAD: one frame, not two
    assert.equal(f.frames.filter((x) => x.same).length, 1);
    assert.equal(f.frames.length, 2, 'two commits; "first saw it" is the second commit');
    assert.deepEqual(f.frames.map((x) => x.source), ['git', 'git']);
  } finally { t.stop(); }
});

test('film: 230 edits leave 200 frames and as many blobs; frames of a removed component are cleaned', async () => {
  const t = await boot();
  try {
    writeFileSync(join(t.dir, 'solo.html'), '<!doctype html><html><body><h1>v0</h1></body></html>\n');
    t.eng.rescan();
    for (let i = 1; i <= 230; i++) {
      const tr = await t.get('/api/component/solo.html');
      const r = await t.post('/api/edit', { component: 'solo.html', baseRevision: tr.revision, edits: [{ op: 'text', node: find(tr.tree, 'h1').node, value: `v${i}` }] });
      assert.equal(r.ok, true);
    }
    const blobs = readdirSync(join(t.eng.state, 'film', 'blobs'));
    const slots = readdirSync(join(t.eng.state, 'film')).filter((n) => n !== 'blobs' && n !== 'ledger.json');
    const frames = slots.map((n) => JSON.parse(readFileSync(join(t.eng.state, 'film', n, 'frames.json'), 'utf8'))).find((j) => j.comp === 'solo.html').frames;
    assert.equal(frames.length, 200);
    const mine = new Set(frames.map((f) => f.files['solo.html']));
    assert.equal(mine.size, 200); assert.equal(blobs.filter((b) => mine.has(b)).length, 200);
    assert.ok(blobs.length <= 200 + 4, `no orphan blobs (${blobs.length} for 200 frames of solo.html plus the card's own few)`);
    // the file goes away: a new engine on the same state forgets its frames and blobs
    t.eng.close();
    rmSync(join(t.dir, 'solo.html'));
    const eng2 = openFolder(t.dir, { stateDir: t.stateDir });
    const h = createDocRoutes(eng2, { identify: () => 'you' });
    await new Promise((resolve) => { h({ method: 'GET', headers: {} }, { writeHead() {}, end: () => resolve() }, new URL('http://x/api/component/card.html/film')); });
    assert.ok(readdirSync(join(eng2.state, 'film', 'blobs')).length <= 6, 'the removed file\'s blobs went with it');
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
