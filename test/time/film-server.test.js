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
    assert.equal(refused.ok, false); assert.match(refused.error, /card\.css is shared: \.card border changed after this version while you worked on card, and card draws it\. Restoring would undo that\. Next:/);
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
    void h; // no request at all: opening the folder is what cleans
    assert.ok(readdirSync(join(eng2.state, 'film', 'blobs')).length <= 6, 'the removed file\'s blobs went with it, on open');
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

test('film: restoring a git version keeps every commit in its place; the restore and the undo are entries of their own', async () => {
  const t = await boot({ git: true });
  try {
    const labels = (f) => f.frames.filter((x) => x.source === 'git').map((x) => [x.id, x.what, x.summary]);
    const f0 = await t.get('/api/component/card.html/film');
    const commits0 = labels(f0);
    assert.equal(commits0.length, 2);
    const first = f0.frames.at(-1);                               // the oldest commit
    const r = await t.post('/api/component/card.html/film/restore', { frame: first.id });
    assert.equal(r.ok, true);
    const f1 = await t.get('/api/component/card.html/film');
    assert.deepEqual(labels(f1), commits0, 'both commits are still there once, in order, with the same words');
    assert.equal(f1.frames[0].source, 'napkin'); assert.match(f1.frames[0].what, /^Restored commit [0-9a-f]{7}$/);
    assert.equal(f1.frames[0].same, true);
    assert.equal(f1.frames.filter((x) => x.same).length, 2, 'the restore is Now; the commit it restored is marked the same as now, not absorbed');
    assert.equal((await t.post('/api/undo', { component: 'card.html' })).ok, true);
    const f2 = await t.get('/api/component/card.html/film');
    assert.deepEqual(labels(f2), commits0);
    assert.equal(f2.frames[0].what, 'Undid the restore');
    assert.equal(new Set(f2.frames.map((x) => x.id)).size, f2.frames.length);
    for (const x of f2.frames) assert.ok(x.what && !/undefined|\[object/.test(x.what), `a real label: ${x.what}`);
  } finally { t.stop(); }
});

test('film: a shared stylesheet edited while napkin was stopped is not clobbered by a restore either', async () => {
  const t = await boot();
  try {
    writeFileSync(join(t.dir, 'pill.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="card.css"></head><body><span class="card">Pill</span></body></html>\n');
    t.eng.rescan();
    await t.get('/api/component/pill.html/film');
    const r = await t.post('/api/edit', { component: 'pill.html', edits: [{ op: 'rule', file: 'card.css', selector: '.card', index: 0, prop: 'padding', value: '40px' }] });
    assert.equal(r.ok, true);
    const old = (await t.get('/api/component/pill.html/film')).frames.at(-1);
    t.stop();
    // napkin is not running: the stylesheet is edited by hand
    writeFileSync(join(t.dir, 'card.css'), readFileSync(join(t.dir, 'card.css'), 'utf8').replace(/padding:\s*40px/, 'padding: 99px') + '.mine { color: teal }\n');
    const eng2 = openFolder(t.dir, { stateDir: t.stateDir });
    const h = createDocRoutes(eng2, { identify: (tok) => (tok === 'tok' ? 'you' : null) });
    const srv = createServer(async (req, res) => { if (!(await h(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end('{}'); } });
    await new Promise((r2) => srv.listen(0, '127.0.0.1', r2));
    try {
      const res = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/component/pill.html/film/restore`, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ frame: old.id }) })).json();
      assert.equal(res.ok, false); assert.match(res.error, /card\.css is shared: \.card padding changed after this version outside napkin or in git, and card draws it\. Restoring would undo that\. Next:/);
      assert.match(readFileSync(join(t.dir, 'card.css'), 'utf8'), /\.mine/, 'nothing was written');
      // a change nothing else draws (a rule no other component has an element for) is not in the way
      writeFileSync(join(t.dir, 'card.css'), readFileSync(join(t.dir, 'card.css'), 'utf8').replace('padding: 99px', 'padding: 40px'));
      await new Promise((r2) => setTimeout(r2, 150));
      const ok = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/component/pill.html/film/restore`, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ frame: old.id }) })).json();
      assert.equal(ok.ok, true, JSON.stringify(ok));
    } finally { eng2.close(); srv.close(); }
  } finally { try { t.stop(); } catch { /* already */ } }
});

test('film: labels say the truth: a whole element added, restores and undos in words, no hidden count', async () => {
  const t = await boot();
  try {
    writeFileSync(join(t.dir, 'pills.html'), '<!doctype html><html><body><p><span class="ss-pill">Shipped</span> <span class="ss-pill">Blocked</span></p></body></html>\n');
    t.eng.rescan();
    const id = 'pills.html';
    await t.get(`/api/component/${id}/film`);
    const tr = await t.get(`/api/component/${id}`);
    const p = find(tr.tree, 'p');
    const r = await t.post('/api/edit', { component: id, baseRevision: tr.revision, edits: [{ op: 'insert', parent: p.node, index: 1, html: '<span class="ss-pill">QA done</span>' }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    let f = await t.get(`/api/component/${id}/film`);
    assert.equal(f.frames[0].what, 'Added <span class="ss-pill">QA done</span>');
    assert.equal((await t.post('/api/undo', { component: id })).ok, true);
    f = await t.get(`/api/component/${id}/film`);
    assert.equal(f.frames[0].what, 'Undid Added <span class="ss-pill">QA done</span>');
    // several things in one write: the first is said, the rest are a count of their own
    const tr2 = await t.get(`/api/component/${id}`);
    await t.post('/api/edit', { component: id, baseRevision: tr2.revision, edits: [{ op: 'attr', node: find(tr2.tree, 'p').node, name: 'class', value: 'row' }, { op: 'attr', node: find(tr2.tree, 'p').node, name: 'title', value: 'x' }] });
    f = await t.get(`/api/component/${id}/film`);
    assert.ok(f.frames[0].more >= 1, JSON.stringify(f.frames[0]));
    assert.ok(!/and \d+ more/.test(f.frames[0].what), 'the count is not inside the words');
  } finally { t.stop(); }
});

test('film: a shared stylesheet edit nothing of this component uses is no frame of it, and writes nothing for it', async () => {
  const t = await boot();
  try {
    writeFileSync(join(t.dir, 'other.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="card.css"></head><body><b class="elsewhere">x</b></body></html>\n');
    t.eng.rescan();
    await t.get('/api/component/other.html/film'); await t.get('/api/component/card.html/film');
    const slotOf = (id) => readdirSync(join(t.eng.state, 'film')).filter((n) => n !== 'blobs' && n !== 'ledger.json').map((n) => join(t.eng.state, 'film', n, 'frames.json')).find((p) => JSON.parse(readFileSync(p, 'utf8')).comp === id);
    const before = readFileSync(slotOf('other.html'), 'utf8');
    // .card is used by card.html only
    const r = await t.post('/api/edit', { component: 'card.html', edits: [{ op: 'rule', file: 'card.css', selector: '.card', index: 0, prop: 'padding', value: '40px' }] });
    assert.equal(r.ok, true);
    assert.equal(readFileSync(slotOf('other.html'), 'utf8'), before, 'other.html\'s frames were not rewritten');
    const fo = await t.get('/api/component/other.html/film');
    assert.equal(fo.frames.length, 1, 'no frame for a change it never draws');
    const fc = await t.get('/api/component/card.html/film');
    assert.match(fc.frames[0].what, /padding/);
    // and a variable the component does not use, or uses only through another
    writeFileSync(join(t.dir, 'card.css'), readFileSync(join(t.dir, 'card.css'), 'utf8') + ':root { --ink: #111; --sheet: var(--ink); --unused: 1px; }\n.elsewhere { color: var(--sheet); }\n');
    await new Promise((r2) => setTimeout(r2, 200));
    const r2 = await t.post('/api/edit', { component: 'card.html', edits: [{ op: 'var', file: 'card.css', name: '--unused', value: '2px' }] });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    const r3 = await t.post('/api/edit', { component: 'card.html', edits: [{ op: 'var', file: 'card.css', name: '--ink', value: '#222' }] });
    assert.equal(r3.ok, true, JSON.stringify(r3));
    const fo2 = await t.get('/api/component/other.html/film');
    assert.match(fo2.frames[0].what, /--ink/, 'a variable it uses through another property is a frame of it');
    assert.ok(!fo2.frames.some((f) => /--unused/.test(f.what)), 'one it does not use is not');
  } finally { t.stop(); }
});

// ---- round 4: restores that must not silently undo anyone else's work, and frames that must be true ----
async function folderOf(files, { git = false, commits = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-time4-'));
  for (const [p, c] of Object.entries(files)) writeFileSync(join(dir, p), c);
  const sh = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', ...a], { stdio: 'ignore' });
  if (git) { sh('init', '-q'); sh('add', '.'); sh('commit', '-q', '-m', 'start'); for (const [msg, edit] of commits) { edit(dir); sh('commit', '-q', '-am', msg); } }
  const stateDir = mkdtempSync(join(tmpdir(), 'napkin-time4-state-'));
  const eng = openFolder(dir, { stateDir });
  const handle = createDocRoutes(eng, { identify: (t) => (t === 'tok' ? 'you' : null) });
  const srv = createServer(async (req, res) => { if (!(await handle(req, res, new URL(req.url, 'http://x')))) { res.writeHead(404); res.end('{}'); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = async (p) => (await fetch(base + p)).json();
  const text = async (p) => (await fetch(base + p)).text();
  const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return { dir, eng, get, text, post, wait, film: (id) => get(`/api/component/${encodeURIComponent(id)}/film`), stop: () => { eng.close(); srv.close(); } };
}
const page = (cls, body = 'x') => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shared.css"></head><body><p class="${cls}">${body}</p></body></html>\n`;
const SHARED = '.pill { padding: 1px 7px; }\n.note { padding: 4px; }\n';
const rule = (sel, prop, value) => ({ op: 'rule', file: 'shared.css', selector: sel, index: 0, prop, value });

test('restore: commits that came before napkin and changed rules other components draw are not silently undone', async () => {
  const t = await folderOf({ 'pill.html': page('pill'), 'note.html': page('note'), 'shared.css': SHARED }, { git: true, commits: [
    ['note body padding', (d) => writeFileSync(join(d, 'shared.css'), '.pill { padding: 1px 7px; }\n.note { padding: 12px; }\n')],
    ['pill label', (d) => writeFileSync(join(d, 'pill.html'), page('pill', 'Shipped'))],
  ] });
  try {
    const f = await t.film('pill.html');
    const start = f.frames.at(-1);
    assert.equal(start.summary, 'start');
    const cssNow = readFileSync(join(t.dir, 'shared.css'), 'utf8');
    const r = await t.post('/api/component/pill.html/film/restore', { frame: start.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /shared\.css is shared: \.note padding changed after this version outside napkin or in git, and note draws it\. Restoring would undo that\. Next:/);
    assert.equal(readFileSync(join(t.dir, 'shared.css'), 'utf8'), cssNow, 'nothing was written');
    assert.match(readFileSync(join(t.dir, 'pill.html'), 'utf8'), /Shipped/);
    assert.ok(!f.frames.some((x) => x.summary === 'note body padding'), 'the commit that only changed a rule Pill never draws is no frame of Pill');
    assert.equal(f.frames.length, 2);
  } finally { t.stop(); }
});

test('restore: another component\'s edit that was undone is not in the way', async () => {
  const t = await folderOf({ 'pill.html': page('pill'), 'note.html': page('note'), 'shared.css': SHARED });
  try {
    await t.film('pill.html'); await t.film('note.html');
    const a = (await t.film('pill.html')).frames[0];                       // Pill's frame A: the files as first seen
    assert.equal((await t.post('/api/edit', { component: 'note.html', edits: [rule('.note', 'padding', '30px')] })).ok, true);
    assert.equal((await t.post('/api/undo', { component: 'note.html' })).ok, true);          // the bytes are A's again
    assert.equal((await t.post('/api/edit', { component: 'pill.html', edits: [rule('.pill', 'padding', '1px 14px')] })).ok, true);   // Pill's own rule
    const fa = (await t.film('pill.html')).frames.at(-1);
    const r = await t.post('/api/component/pill.html/film/restore', { frame: fa.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(join(t.dir, 'shared.css'), 'utf8'), SHARED);
    void a;
    // but while the other component's change is still there, it is refused
    assert.equal((await t.post('/api/edit', { component: 'note.html', edits: [rule('.note', 'padding', '31px')] })).ok, true);
    assert.equal((await t.post('/api/edit', { component: 'pill.html', edits: [rule('.pill', 'padding', '1px 15px')] })).ok, true);
    const r2 = await t.post('/api/component/pill.html/film/restore', { frame: fa.id });
    assert.equal(r2.ok, false); assert.match(r2.error, /\.note padding changed after this version while you worked on note, and note draws it/);
  } finally { t.stop(); }
});

test('film: applying stylesheets leaves the earlier versions behind a boundary; each scrubs with its own files; restore keeps the applied setting', async () => {
  const t = await folderOf({ 'pill.html': '<!doctype html><html><head><meta charset="utf-8"></head><body><p class="pill">Hi</p></body></html>\n', 'tokens.css': ':root { --ink: #111; }\n', 'shared.css': '.pill { color: var(--ink); }\n' });
  try {
    const textNode = async () => (await t.get('/api/component/pill.html')).tree[0].children[1].children[0].node;
    assert.equal((await t.post('/api/edit', { component: 'pill.html', edits: [{ op: 'text', node: await textNode(), value: 'Hello' }] })).ok, true);   // before answering the ask-once dialog
    const before = await t.film('pill.html');
    assert.equal(before.frames.length, 2);
    assert.equal((await t.post('/api/styles', { applied: ['tokens.css', 'shared.css'] })).ok, true);
    const after = await t.film('pill.html');
    assert.deepEqual(after.frames.map((x) => (x.boundary ? 'boundary' : x.what)), ['boundary', 'Hi → Hello', 'The file as napkin first saw it'], 'the earlier versions are all still there, behind a boundary; a frame with nothing new beside it is not a row of its own');
    assert.equal(after.frames[0].what, 'Stylesheets applied: tokens.css, shared.css');
    const old = after.frames[2];                                   // the file as first seen
    assert.deepEqual(old.otherFiles, ['pill.html'], 'it says it is made of other files than the ones used now');
    const v = await t.text(`/view/pill.html?version=${old.id}`);
    assert.doesNotMatch(v, /tokens\.css/, 'a version before the boundary draws with its own files only');
    // restoring it puts its own file back and leaves the applied stylesheets as they are
    const r = await t.post('/api/component/pill.html/film/restore', { frame: old.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(readFileSync(join(t.dir, 'pill.html'), 'utf8'), />Hi</);
    assert.deepEqual((await t.get('/api/styles')).applied, ['tokens.css', 'shared.css']);
    // after the boundary, labels work against the version before them
    const f = await t.film('pill.html');
    assert.equal(f.frames[0].what, 'Restored the version from ' + f.frames[0].what.replace('Restored the version from ', ''));
    assert.equal(await t.text(`/vraw/pill.html/${f.frames[0].id}/tokens.css`), ':root { --ink: #111; }\n');
    assert.match(await t.text(`/vraw/pill.html/${old.id}/tokens.css`), /not part of this version/, 'a stylesheet the version does not have is never the live one');
  } finally { t.stop(); }
});

test('film: a commit from before a stylesheet existed is a version, and each label is against the true previous one', async () => {
  const t = await folderOf({ 'pill.html': '<!doctype html><html><head><meta charset="utf-8"></head><body><p>Shipped</p></body></html>\n' }, { git: true, commits: [
    ['add the sheet', (d) => { writeFileSync(join(d, 'shared.css'), '.pill { color: red; }\n'); writeFileSync(join(d, 'pill.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shared.css"></head><body><p>Shipped</p></body></html>\n'); execFileSync('git', ['-C', d, 'add', 'shared.css'], { stdio: 'ignore' }); }],
    ['v2', (d) => writeFileSync(join(d, 'pill.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shared.css"></head><body><p>Shipped v2</p></body></html>\n')],
  ] });
  try {
    const f = await t.film('pill.html');
    const rows = f.frames.map((x) => (x.boundary ? `| ${x.what}` : `${x.summary}: ${x.what}`));
    assert.equal(f.frames.filter((x) => !x.boundary).length, 3, 'all three commits are versions of the HTML: ' + rows.join(' / '));
    const v2 = f.frames.find((x) => x.summary === 'v2');
    assert.equal(v2.what, 'Shipped → Shipped v2', 'against the commit before it, which has the same files');
    assert.ok(f.frames.some((x) => x.boundary && /Stylesheets applied: shared\.css/.test(x.what)));
    const start = f.frames.find((x) => x.summary === 'start');
    assert.equal(start.what, 'start');
    assert.deepEqual(start.otherFiles, ['pill.html']);
  } finally { t.stop(); }
});

test('film: undo and redo are worded from what was reversed, not from the row before', async () => {
  const t = await folderOf({ 'pill.html': page('pill'), 'shared.css': SHARED });
  try {
    await t.film('pill.html');
    const set = async (v) => assert.equal((await t.post('/api/edit', { component: 'pill.html', edits: [rule('.pill', 'padding', v)] })).ok, true);
    await set('2px 7px'); await set('3px 7px');
    const ops = async (verb) => assert.equal((await t.post(`/api/${verb}`, { component: 'pill.html' })).ok, true);
    await ops('undo'); await ops('undo'); await ops('redo'); await ops('redo');
    const f = await t.film('pill.html');
    const words = f.frames.map((x) => x.what);
    assert.deepEqual(words.slice(0, 4), ['Redid padding 2px 7px → 3px 7px', 'Redid padding 1px 7px → 2px 7px', 'Undid padding 1px 7px → 2px 7px', 'Undid padding 2px 7px → 3px 7px'], JSON.stringify(words));
    for (const w of words) assert.ok(!/(Undid|Redid) (Undid|Redid)/.test(w), w);
    // a restore, then undo, redo, undo, undo
    const first = f.frames.at(-1);
    assert.equal((await t.post('/api/component/pill.html/film/restore', { frame: first.id })).ok, true);
    await ops('undo'); await ops('redo'); await ops('undo'); await ops('undo');
    const g = (await t.film('pill.html')).frames.map((x) => x.what);
    for (const w of g.slice(0, 5)) assert.ok(!/(Undid|Redid) (Undid|Redid)/.test(w) && w, w);
    assert.ok(/^Restored /.test(g.find((w) => /^Restored/.test(w)) ?? ''));
    assert.ok(g.includes('Undid the restore') && g.includes('Redid the restore'), JSON.stringify(g));
  } finally { t.stop(); }
});

test('film: a font change is a change for the component that uses it through a variable; a new commit shows at once', async () => {
  const t = await folderOf({ 'pt.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shared.css"></head><body><p class="px">Stem</p></body></html>\n', 'other.html': page('nothing'), 'shared.css': ':root { --font-pixel: "Stem 7", monospace; }\n.px { font-family: var(--font-pixel); }\n@font-face { font-family: "Stem 7"; src: url(a.woff2); }\n@font-face { font-family: "Never"; src: url(n.woff2); }\n' }, { git: true });
  try {
    await t.film('pt.html'); await t.film('other.html');
    const css = readFileSync(join(t.dir, 'shared.css'), 'utf8');
    writeFileSync(join(t.dir, 'shared.css'), css.replace('url(a.woff2)', 'url(b.woff2)')); await t.wait(400);
    const f = await t.film('pt.html');
    assert.equal(f.frames[0].what, 'Changed font Stem 7', JSON.stringify(f.frames.map((x) => x.what)));
    writeFileSync(join(t.dir, 'shared.css'), readFileSync(join(t.dir, 'shared.css'), 'utf8').replace('url(n.woff2)', 'url(m.woff2)')); await t.wait(400);
    assert.equal((await t.film('pt.html')).frames[0].what, 'Changed font Stem 7', 'a face nobody uses is no frame');
    assert.ok(!(await t.film('other.html')).frames.some((x) => /font/.test(x.what)));
    // a commit made just now is in the list at once
    writeFileSync(join(t.dir, 'pt.html'), readFileSync(join(t.dir, 'pt.html'), 'utf8').replace('>Stem<', '>Stem 7<')); await t.wait(300);
    execFileSync('git', ['-C', t.dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', 'commit', '-q', '-am', 'fresh'], { stdio: 'ignore' });
    assert.ok((await t.film('pt.html')).frames.some((x) => x.summary === 'fresh'));
  } finally { t.stop(); }
});
test('film: a change to a shared sheet that changes nothing visible, or nothing this component draws, is no frame', async () => {
  const css = '.a { color: red; }\n.b { color: blue; }\n@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n@keyframes wobble { from { opacity: 0; } to { opacity: 1; } }\n.a { animation: spin 1s; }\n';
  const t = await folderOf({ 'a.html': page('a'), 'b.html': page('b'), 'shared.css': css });
  const save = (s) => writeFileSync(join(t.dir, 'shared.css'), s);
  try {
    await t.film('a.html'); await t.film('b.html');
    const n0 = (await t.film('a.html')).frames.length;
    save(css + '/* a note to self */\n'); await t.wait(300);                                // a comment
    save(css.replace('.a { color: red; }', '.a  {\n  color: red;\n}')); await t.wait(300);   // white space
    save(css.replace('@keyframes wobble { from { opacity: 0; } to { opacity: 1; } }', '@keyframes wobble { from { opacity: 0; } to { opacity: .5; } }')); await t.wait(300); // an animation a does not use
    save(css.replace('.b { color: blue; }', '.b { color: teal; }')); await t.wait(300);       // a rule a does not draw
    assert.equal((await t.film('a.html')).frames.length, n0, 'none of those is a moment of a.html');
    const fa = await t.film('a.html');
    assert.equal(fa.frames[0].same, true, 'and what it has is still Now');
    save(css.replace('@keyframes spin { from { opacity: 0; } to { opacity: 1; } }', '@keyframes spin { from { opacity: 0; } to { opacity: .2; } }')); await t.wait(400);
    const f2 = await t.film('a.html');
    assert.equal(f2.frames.length, n0 + 1, 'an animation it uses is a real change');
    assert.equal(f2.frames[0].what, 'Changed animation spin');
    assert.ok(!(await t.film('b.html')).frames.some((x) => /animation/.test(x.what)), 'and not one of b.html\'s');
  } finally { t.stop(); }
});

test('film: a run that ends where it began says so, and Now stays marked when only unrelated sheets changed', async () => {
  const t = await folderOf({ 'a.html': '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shared.css"></head><body><h1>Done</h1></body></html>\n', 'b.html': page('b'), 'shared.css': '.b { padding: 1px; }\n' });
  try {
    await t.film('a.html');
    for (const v of ['Done?', 'Done']) {
      const tr = await t.get('/api/component/a.html');
      assert.equal((await t.post('/api/edit', { component: 'a.html', baseRevision: tr.revision, edits: [{ op: 'text', node: tr.tree[0].children[1].children[0].node, value: v }] })).ok, true);
    }
    const f = await t.film('a.html');
    assert.equal(f.frames[0].count, 2); assert.equal(f.frames[0].what, 'No net change');
    assert.equal((await t.post('/api/edit', { component: 'b.html', edits: [rule('.b', 'padding', '9px')] })).ok, true);
    const g = await t.film('a.html');
    assert.equal(g.frames[0].same, true, 'the newest frame is still Now');
    assert.equal(g.frames.filter((x) => x.same).length >= 1, true);
  } finally { t.stop(); }
});

// ---- round 6 ----
const bare = (cls, body) => `<!doctype html><html><head><meta charset="utf-8"></head><body><p class="${cls}">${body}</p></body></html>\n`;
const textEdit = async (t, id, value) => { const tr = await t.get(`/api/component/${encodeURIComponent(id)}`); return t.post('/api/edit', { component: id, baseRevision: tr.revision, edits: [{ op: 'text', node: tr.tree[0].children[1].children[0].node, value }] }); };

test('restore across a boundary is refused when it would undo another component\'s work, even with the sheets un-applied', async () => {
  const t = await folderOf({ 'pixel.html': bare('px', 'Hi'), 'pill.html': bare('ss-pill', 'Pill'), 'tokens.css': ':root { --ink: #111; }\n', 'components.css': '.ss-pill { padding: 1px 7px; }\n.px { color: var(--ink); }\n' });
  try {
    assert.equal((await t.post('/api/styles', { applied: ['tokens.css', 'components.css'] })).ok, true);
    await t.film('pixel.html'); await t.film('pill.html');
    assert.equal((await textEdit(t, 'pixel.html', 'Hi 1')).ok, true);
    const v = (await t.film('pixel.html')).frames[0];                                  // V holds both sheets
    assert.equal((await t.post('/api/edit', { component: 'pill.html', edits: [{ op: 'rule', file: 'components.css', selector: '.ss-pill', index: 0, prop: 'padding', value: '1px 14px' }] })).ok, true);
    assert.equal((await textEdit(t, 'pixel.html', 'Hi 2')).ok, true);
    assert.equal((await t.post('/api/styles', { applied: [] })).ok, true);
    const css = readFileSync(join(t.dir, 'components.css'), 'utf8'), html = readFileSync(join(t.dir, 'pixel.html'), 'utf8');
    const r = await t.post('/api/component/pixel.html/film/restore', { frame: v.id });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.error, /components\.css is shared: \.ss-pill padding changed after this version while you worked on pill, and pill draws it\./);
    assert.equal(readFileSync(join(t.dir, 'components.css'), 'utf8'), css); assert.equal(readFileSync(join(t.dir, 'pixel.html'), 'utf8'), html, 'nothing was written');
    // the version still previews with the sheets it holds, in their recorded order, though none is applied now
    const view = await t.text(`/view/pixel.html?version=${v.id}`);
    const links = [...view.matchAll(/href="\/vraw\/pixel\.html\/[^/]+\/([^"]+\.css)"/g)].map((m) => m[1]);
    assert.deepEqual(links, ['tokens.css', 'components.css']);
    assert.equal(await t.text(`/vraw/pixel.html/${v.id}/components.css`), '.ss-pill { padding: 1px 7px; }\n.px { color: var(--ink); }\n');
  } finally { t.stop(); }
});

test('film: a commit made in the same second as the edit it contains comes after it, and the undo is worded from the right frames', async () => {
  const t = await folderOf({ 'pills.html': '<!doctype html><html><body><p><span class="ss-pill">Shipped</span> <span class="ss-pill">Blocked</span></p></body></html>\n' }, { git: true });
  try {
    await t.film('pills.html');
    const tr = await t.get('/api/component/pills.html');
    const before = Date.now();
    assert.equal((await t.post('/api/edit', { component: 'pills.html', baseRevision: tr.revision, edits: [{ op: 'insert', parent: tr.tree[0].children[0].children[0].node, index: 1, html: '<span class="ss-pill">c5</span>' }] })).ok, true);
    const at = Math.floor(Date.now() / 1000);
    execFileSync('git', ['-C', t.dir, '-c', 'user.email=a@b.c', '-c', 'user.name=Ada', 'commit', '-q', '-am', 'c5'], { stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: `${at} +0000`, GIT_AUTHOR_DATE: `${at} +0000` } });
    void before;
    assert.equal((await t.post('/api/undo', { component: 'pills.html' })).ok, true);
    const f = await t.film('pills.html');
    const rows = f.frames.map((x) => `${x.source}:${x.summary}`);
    const iEdit = f.frames.findIndex((x) => x.source === 'napkin' && /^insert/.test(x.summary)), iCommit = f.frames.findIndex((x) => x.summary === 'c5');
    assert.ok(iCommit >= 0 && iEdit >= 0, rows.join(' / '));
    assert.ok(iCommit < iEdit, `newest first: the commit (${iCommit}) is above the edit it contains (${iEdit})`);
    assert.match(f.frames[0].what, /^Undid Added <span class="ss-pill">c5<\/span>$/, JSON.stringify(f.frames.map((x) => x.what)));
  } finally { t.stop(); }
});

test('restore: a rule no component draws, committed in a shared sheet, is never dropped silently', async () => {
  const t = await folderOf({ 'pill.html': page('pill'), 'note.html': page('note'), 'shared.css': SHARED }, { git: true, commits: [
    ['a rule for later', (d) => writeFileSync(join(d, 'shared.css'), `${SHARED}.hand { color: red }\n`)],
    ['pill label', (d) => writeFileSync(join(d, 'pill.html'), page('pill', 'Shipped'))],
    ['a colour for later', (d) => writeFileSync(join(d, 'shared.css'), `${SHARED}.hand { color: blue }\n`)],
  ] });
  try {
    const f = await t.film('pill.html');
    // the oldest version has no .hand: restoring it keeps the whole rule, after what it puts back
    const r = await t.post('/api/component/pill.html/film/restore', { frame: f.frames.at(-1).id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.kept, ['.hand']);
    assert.equal(readFileSync(join(t.dir, 'shared.css'), 'utf8'), `${SHARED}.hand { color: blue }\n`, 'the rule is still there, with its own bytes');
    assert.doesNotMatch(readFileSync(join(t.dir, 'pill.html'), 'utf8'), /Shipped/);
  } finally { t.stop(); }
});

test('restore: a value changed in a rule no component draws is refused by name, and nothing is written', async () => {
  const t = await folderOf({ 'pill.html': page('pill'), 'note.html': page('note'), 'shared.css': `${SHARED}.hand { color: red }\n` }, { git: true, commits: [
    ['pill label', (d) => writeFileSync(join(d, 'pill.html'), page('pill', 'Shipped'))],
    ['a new colour', (d) => writeFileSync(join(d, 'shared.css'), `${SHARED}.hand { color: blue }\n`)],
  ] });
  try {
    const f = await t.film('pill.html');
    const cssNow = readFileSync(join(t.dir, 'shared.css'), 'utf8');
    const r = await t.post('/api/component/pill.html/film/restore', { frame: f.frames.at(-1).id });
    assert.equal(r.ok, false);
    assert.match(r.error, /shared\.css: \.hand color changed after this version outside napkin or in git\. No component draws it, so you would not see it go\. Next:/);
    assert.equal(readFileSync(join(t.dir, 'shared.css'), 'utf8'), cssNow);
    assert.match(readFileSync(join(t.dir, 'pill.html'), 'utf8'), /Shipped/);
  } finally { t.stop(); }
});

test('restore: a hand comment and the place of a kept rule survive; only the differing rule goes back', async () => {
  const start = `.pill { padding: 1px; }\n.note { padding: 2px; }\n`;
  const t = await folderOf({ 'pill.html': page('pill'), 'note.html': page('note'), 'shared.css': start }, { git: true, commits: [
    ['hand work', (d) => writeFileSync(join(d, 'shared.css'), `/* hand comment */\n.hand { color: red }\n.pill { padding: 9px; }\n.note { padding: 2px; }\n`)],
  ] });
  try {
    const f = await t.film('pill.html');
    const r = await t.post('/api/component/pill.html/film/restore', { frame: f.frames.at(-1).id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.kept, ['.hand']);
    assert.equal(readFileSync(join(t.dir, 'shared.css'), 'utf8'), `/* hand comment */\n.hand { color: red }\n.pill { padding: 1px; }\n.note { padding: 2px; }\n`, 'comment and order as they were, one value back');
  } finally { t.stop(); }
});

test('restore: refused for a shared rule, the way forward is one file; the sheet stays', async () => {
  const t = await folderOf({ 'pill.html': page('pill'), 'note.html': page('note'), 'shared.css': SHARED }, { git: true, commits: [
    ['note', (d) => writeFileSync(join(d, 'shared.css'), '.pill { padding: 1px 7px; }\n.note { padding: 12px; }\n')],
    ['pill label', (d) => writeFileSync(join(d, 'pill.html'), page('pill', 'Shipped'))],
  ] });
  try {
    const f = await t.film('pill.html'), frame = f.frames.at(-1).id, css = readFileSync(join(t.dir, 'shared.css'), 'utf8');
    const no = await t.post('/api/component/pill.html/film/restore', { frame });
    assert.equal(no.ok, false); assert.match(no.error, /Next: .*restore only this component's file/);
    const yes = await t.post('/api/component/pill.html/film/restore', { frame, only: 'own' });
    assert.equal(yes.ok, true, JSON.stringify(yes));
    assert.doesNotMatch(readFileSync(join(t.dir, 'pill.html'), 'utf8'), /Shipped/);
    assert.equal(readFileSync(join(t.dir, 'shared.css'), 'utf8'), css, 'the shared rule is protected');
  } finally { t.stop(); }
});
