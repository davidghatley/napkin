import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setup, SVG } from './helpers.js';

const files = (dir) => Object.fromEntries(readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => [f, createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')]));

test('a run keeps its plan, step status and artifacts; artifacts are real files with detected kinds', async (t) => {
  const ctl = await setup(t);
  const a = await ctl.as('claude');
  const r = await a.post('/api/runs', { name: 'Orbit study', plan: [{ id: 'a', label: 'Sketch' }, { id: 'b', label: 'Render' }] });
  assert.equal(r.status, 200); const run = r.json.id;
  assert.match(run, /^run_/);
  let s = await a.post(`/api/runs/${run}/steps`, { id: 'a', status: 'running' });
  assert.equal(s.json.step.status, 'running'); assert.ok(s.json.step.startedAt);
  const art = await a.post(`/api/runs/${run}/artifacts`, { path: 'renders/sketch.svg', content: SVG(7), step: 'a', kind: 'svg' });
  assert.equal(art.status, 200, JSON.stringify(art.json));
  assert.equal(readFileSync(join(ctl.dir, 'renders/sketch.svg'), 'utf8'), SVG(7));
  assert.equal(art.json.item.kind, 'svg');
  s = await a.post(`/api/runs/${run}/steps`, { id: 'a', status: 'complete' });
  assert.equal(s.json.next.id, 'b');
  const items = (await a.get('/api/items')).json.items;
  assert.ok(items.some((i) => i.path === 'renders/sketch.svg' && i.kind === 'svg'));
  const got = (await a.get(`/api/runs/${run}`)).json;
  assert.deepEqual(got.plan, [{ id: 'a', label: 'Sketch' }, { id: 'b', label: 'Render' }]);
  assert.equal(got.steps.find((x) => x.id === 'a').status, 'complete');
  assert.equal(got.artifacts[0].step, 'a');
  assert.equal(got.summary.steps.complete, 1);
  // the same bytes again attach without rewriting; different bytes are refused, not replaced
  const again = await a.post(`/api/runs/${run}/artifacts`, { path: 'renders/sketch.svg', content: SVG(7) });
  assert.equal(again.status, 200);
  const clash = await a.post(`/api/runs/${run}/artifacts`, { path: 'renders/sketch.svg', content: SVG(9) });
  assert.equal(clash.status, 409); assert.match(clash.json.error, /Next:/);
  assert.equal(readFileSync(join(ctl.dir, 'renders/sketch.svg'), 'utf8'), SVG(7));
  const over = await a.post(`/api/runs/${run}/artifacts`, { path: 'renders/sketch.svg', content: SVG(9), overwrite: true });
  assert.equal(over.status, 200); assert.equal(readFileSync(join(ctl.dir, 'renders/sketch.svg'), 'utf8'), SVG(9));
  // a step id that does not exist is an error with a way forward
  const nostep = await a.post(`/api/runs/${run}/artifacts`, { path: 'x.txt', content: 'x', step: 'zzz' });
  assert.equal(nostep.status, 400); assert.match(nostep.json.error, /Next:/);
});

test('artifact paths cannot leave the folder or hide', async (t) => {
  const ctl = await setup(t);
  const a = await ctl.as('claude');
  const run = (await a.post('/api/runs', { name: 'paths' })).json.id;
  const before = files(ctl.dir);
  for (const path of ['../escape.txt', '/etc/passwd', 'a/../../x.txt', '.hidden.txt', 'dir/.git/config', 'node_modules/x.js', 'C:\\x.txt', '']) {
    const r = await a.post(`/api/runs/${run}/artifacts`, { path, content: 'x' });
    assert.equal(r.status, 400, path);
  }
  assert.deepEqual(files(ctl.dir), before);
  const bad = await a.post(`/api/runs/${run}/artifacts`, { path: 'b.png', content: '!!!', encoding: 'base64' });
  assert.equal(bad.status, 400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const ok = await a.post(`/api/runs/${run}/artifacts`, { path: 'dot.png', content: png.toString('base64'), encoding: 'base64', kind: 'jpg' });
  assert.equal(ok.status, 200); assert.equal(ok.json.artifact.kind, 'png'); assert.equal(ok.json.artifact.declaredKind, 'jpg');
  assert.ok(readFileSync(join(ctl.dir, 'dot.png')).equals(png));
});

test('a proposal changes nothing until the person answers; approve writes it, reject and send-back do not', async (t) => {
  const ctl = await setup(t);
  const agent = await ctl.as('claude'), you = await ctl.as('you');
  const run = (await agent.post('/api/runs', { name: 'review' })).json.id;
  const before = files(ctl.dir);
  const p1 = (await agent.post(`/api/runs/${run}/proposals`, { path: 'draft.md', content: '# draft\n', note: 'first pass' })).json;
  const p2 = (await agent.post(`/api/runs/${run}/proposals`, { path: 'nope.md', content: 'no' })).json;
  const p3 = (await agent.post(`/api/runs/${run}/proposals`, { path: 'again.md', content: 'v1' })).json;
  assert.deepEqual(files(ctl.dir), before, 'proposing wrote to the folder');
  const queue = (await you.get('/api/review')).json;
  assert.equal(queue.proposals.length, 3); assert.equal(queue.count, 3);
  assert.equal(queue.proposals[0].path, 'draft.md'); assert.equal(queue.proposals[0].preview, '# draft\n');
  // the agent cannot approve its own proposal
  const self = await agent.post(`/api/review/${p1.id}`, { outcome: 'accepted' });
  assert.equal(self.status, 403);
  assert.equal((await you.post(`/api/review/${p1.id}`, { outcome: 'comment' })).status, 400);
  assert.equal((await you.post(`/api/review/${p1.id}`, { outcome: 'comment', comment: 'looks good so far' })).json.status, 'pending');
  const ok = await you.post(`/api/review/${p1.id}`, { outcome: 'accepted', comment: 'ship it' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(readFileSync(join(ctl.dir, 'draft.md'), 'utf8'), '# draft\n');
  assert.equal((await you.post(`/api/review/${p2.id}`, { outcome: 'rejected', comment: 'no' })).json.status, 'rejected');
  assert.ok(!existsSync(join(ctl.dir, 'nope.md')));
  assert.equal((await you.post(`/api/review/${p3.id}`, { outcome: 'sent-back', comment: 'make it v2' })).json.status, 'sent-back');
  assert.ok(!existsSync(join(ctl.dir, 'again.md')));
  assert.equal((await you.post(`/api/review/${p1.id}`, { outcome: 'accepted' })).status, 409, 'resolved twice');
  // the agent reads exactly what the person said
  const ev = (await agent.get('/api/event-log?types=run-proposal-resolved,run-proposal-comment')).json.events;
  const byId = Object.fromEntries(ev.filter((e) => e.type === 'run-proposal-resolved').map((e) => [e.id, e]));
  assert.equal(byId[p1.id].outcome, 'accepted'); assert.equal(byId[p1.id].comment, 'ship it');
  assert.equal(byId[p3.id].outcome, 'sent-back'); assert.equal(byId[p3.id].comment, 'make it v2');
  assert.equal(ev.filter((e) => e.type === 'run-proposal-comment')[0].comment, 'looks good so far');
  // a second read has nothing new for this agent (the cursor moved), a re-read with since=0 has it all
  assert.equal((await agent.get('/api/event-log?types=run-proposal-resolved')).json.events.length, 0);
  assert.equal((await agent.get('/api/event-log?since=0&types=run-proposal-resolved')).json.events.length, 3);
  // revise after a send-back: the new proposal replaces the old one, which stops being open
  const p4 = (await agent.post(`/api/runs/${run}/proposals`, { path: 'again.md', content: 'v2', replaces: p3.id })).json;
  assert.equal((await you.get('/api/review')).json.proposals.map((p) => p.id).join(), p4.id);
  await you.post(`/api/review/${p4.id}`, { outcome: 'accepted' });
  assert.equal(readFileSync(join(ctl.dir, 'again.md'), 'utf8'), 'v2');
  const full = (await agent.get(`/api/runs/${run}`)).json;
  assert.deepEqual(full.proposals.map((p) => p.status), ['accepted', 'rejected', 'superseded', 'accepted']);
  assert.ok(full.artifacts.some((a) => a.path === 'draft.md' && a.proposal === p1.id), 'an approved proposal lands as an artifact of its run');
});

test('approving a proposal for a file that changed meanwhile is refused and nothing is overwritten', async (t) => {
  const ctl = await setup(t);
  const agent = await ctl.as('claude'), you = await ctl.as('you');
  const run = (await agent.post('/api/runs', { name: 'stale' })).json.id;
  const p = (await agent.post(`/api/runs/${run}/proposals`, { path: 'notes.md', content: '# replaced\n' })).json;
  writeFileSync(join(ctl.dir, 'notes.md'), '# the person typed this\n');
  const r = await you.post(`/api/review/${p.id}`, { outcome: 'accepted' });
  assert.equal(r.status, 409); assert.match(r.json.error, /changed on disk/);
  assert.equal(readFileSync(join(ctl.dir, 'notes.md'), 'utf8'), '# the person typed this\n');
  assert.equal((await you.get('/api/review')).json.proposals.length, 1, 'it stays open');
  // and a proposal for a path that appeared meanwhile cannot clobber it either
  const q = (await agent.post(`/api/runs/${run}/proposals`, { path: 'fresh.txt', content: 'agent' })).json;
  writeFileSync(join(ctl.dir, 'fresh.txt'), 'person');
  assert.equal((await you.post(`/api/review/${q.id}`, { outcome: 'accepted' })).status, 409);
  assert.equal(readFileSync(join(ctl.dir, 'fresh.txt'), 'utf8'), 'person');
});

test('a proposed control change lands through the same path as the person\'s, on its revision', async (t) => {
  const ctl = await setup(t);
  const agent = await ctl.as('claude'), you = await ctl.as('you');
  const controls = (await agent.get('/api/controls/seed.svg')).json;
  const c = controls.sections.flatMap((s) => s.controls).find((x) => x.id.startsWith('attr:') && x.type === 'text');
  const before = readFileSync(join(ctl.dir, 'seed.svg'), 'utf8');
  const p = (await agent.post('/api/proposals/file', { item: 'seed.svg', control: c.id, value: '999', baseRevision: controls.revision, note: 'wider' })).json;
  assert.equal(readFileSync(join(ctl.dir, 'seed.svg'), 'utf8'), before);
  const r = await you.post(`/api/review/${p.id}`, { outcome: 'accepted' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.notEqual(readFileSync(join(ctl.dir, 'seed.svg'), 'utf8'), before);
  const now = (await agent.get('/api/controls/seed.svg')).json.sections.flatMap((s) => s.controls).find((x) => x.id === c.id);
  assert.equal(now.value, '999');
  // stale: someone else changed the item first
  const q = (await agent.post('/api/proposals/file', { item: 'seed.svg', control: c.id, value: '555', baseRevision: controls.revision })).json;
  const stale = await you.post(`/api/review/${q.id}`, { outcome: 'accepted' });
  assert.equal(stale.status, 409); assert.match(stale.json.error, /Next:/);
});

test('questions appear in the queue, wait for the person, and the exact answer comes back as an event', async (t) => {
  const ctl = await setup(t);
  const agent = await ctl.as('claude'), you = await ctl.as('you');
  const run = (await agent.post('/api/runs', { name: 'ask' })).json.id;
  const q = (await agent.post('/api/questions', { run, text: 'Which orbit?', options: ['gold', 'blue'] })).json;
  assert.equal((await you.get('/api/review')).json.questions[0].text, 'Which orbit?');
  const waiting = agent.get(`/api/questions/${q.id}?wait=3000`);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal((await agent.post(`/api/questions/${q.id}/answer`, { answer: 'x' })).status, 403, 'not its own question');
  assert.equal((await you.post(`/api/questions/${q.id}/answer`, { answer: 'a third colour, teal' })).status, 200);
  const w = (await waiting).json;
  assert.equal(w.status, 'answered'); assert.equal(w.answer, 'a third colour, teal');
  assert.equal((await you.get('/api/review')).json.questions.length, 0);
  assert.equal((await you.post(`/api/questions/${q.id}/answer`, { answer: 'again' })).status, 409);
  const ev = (await agent.get('/api/event-log?types=run-question-answered')).json.events;
  assert.equal(ev.length, 1); assert.equal(ev[0].question, q.id); assert.equal(ev[0].answer, 'a third colour, teal');
  // long-poll on the event log wakes for a new event
  const t0 = performance.now();
  const next = agent.get('/api/event-log?wait=3000&types=run-step');
  await new Promise((r) => setTimeout(r, 100));
  await agent.post(`/api/runs/${run}/steps`, { id: 'late', label: 'Late' });
  const got = (await next).json;
  assert.equal(got.events[0].step.id, 'late'); assert.ok(performance.now() - t0 < 1500);
});

test('checkpoint and resume survive a server restart; events and cursors too', async (t) => {
  const ctl = await setup(t);
  let agent = await ctl.as('claude'), you = await ctl.as('you');
  const run = (await agent.post('/api/runs', { name: 'long', plan: [{ id: 's1', label: 'One' }, { id: 's2', label: 'Two' }, { id: 's3', label: 'Three' }] })).json.id;
  await agent.post(`/api/runs/${run}/steps`, { id: 's1', status: 'complete' });
  await agent.post(`/api/runs/${run}/artifacts`, { path: 'one.txt', content: '1', step: 's1' });
  const q = (await agent.post('/api/questions', { run, text: 'Keep going?' })).json;
  const p = (await agent.post(`/api/runs/${run}/proposals`, { path: 'two.txt', content: '2' })).json;
  await agent.post(`/api/runs/${run}/checkpoint`, { label: 'after one' });
  await agent.get('/api/event-log'); // moves claude's cursor
  const before = (await agent.get(`/api/runs/${run}`)).json;
  await ctl.restart();
  agent = await ctl.as('claude'); you = await ctl.as('you');
  const after = (await agent.get(`/api/runs/${run}`)).json;
  for (const k of ['plan', 'steps', 'artifacts', 'questions', 'proposals', 'checkpoints']) assert.deepEqual(after[k], before[k], k);
  // the person answers after the restart; the agent, a fresh process, still receives it exactly once
  await you.post(`/api/questions/${q.id}/answer`, { answer: 'yes' });
  await you.post(`/api/review/${p.id}`, { outcome: 'accepted', comment: 'fine' });
  assert.equal(readFileSync(join(ctl.dir, 'two.txt'), 'utf8'), '2', 'content kept outside the folder came back');
  const res = (await agent.post(`/api/runs/${run}/resume`)).json;
  assert.equal(res.next.id, 's2'); assert.deepEqual(res.pending.map((x) => x.id), ['s2', 's3']);
  assert.equal(res.answeredSinceCheckpoint[0].answer, 'yes');
  assert.equal(res.resolvedSinceCheckpoint[0].status, 'accepted'); assert.equal(res.resolvedSinceCheckpoint[0].comment, 'fine');
  assert.match(res.hint, /s2/);
  const ev = (await agent.get('/api/event-log')).json.events.map((e) => e.type);
  assert.ok(ev.includes('run-question-answered') && ev.includes('run-proposal-resolved'));
  assert.ok(!ev.includes('run-started'), 'events read before the restart are not delivered again');
  // the SSE stream replays what a reconnecting client missed
  const r = await fetch(ctl.url + 'api/events?since=0'); const reader = r.body.getReader(); let seen = ''; const dec = new TextDecoder();
  const t0 = Date.now(); while (Date.now() - t0 < 3000 && !seen.includes('"type":"ready"')) { const { value, done } = await reader.read(); if (done) break; seen += dec.decode(value); }
  await reader.cancel();
  assert.ok(seen.includes('run-artifact') && seen.indexOf('run-artifact') < seen.indexOf('"type":"ready"'));
});

test('permissions: read cannot write, propose gets proposals instead of files, nobody reviews their own work', async (t) => {
  const ctl = await setup(t, { config: { agents: { you: 'write', reader: 'read', careful: 'propose', claude: 'write', '*': 'read' } } });
  const reader = await ctl.as('reader'), careful = await ctl.as('careful'), claude = await ctl.as('claude'), you = await ctl.as('you');
  assert.equal((await reader.post('/api/runs', { name: 'x' })).status, 403);
  assert.equal((await reader.get('/api/runs')).status, 200);
  const run = (await claude.post('/api/runs', { name: 'shared' })).json.id;
  const before = files(ctl.dir);
  const r = await careful.post(`/api/runs/${run}/artifacts`, { path: 'careful.txt', content: 'hi' });
  assert.equal(r.status, 200); assert.equal(r.json.proposed, true);
  assert.deepEqual(files(ctl.dir), before);
  assert.equal((await careful.post('/api/board', { arrange: { by: 'kind' } })).status, 403);
  assert.equal((await careful.post(`/api/review/${r.json.id}`, { outcome: 'accepted' })).status, 403);
  assert.equal((await you.post(`/api/review/${r.json.id}`, { outcome: 'accepted' })).status, 200);
  assert.equal(readFileSync(join(ctl.dir, 'careful.txt'), 'utf8'), 'hi');
  assert.equal((await ctl.as('stranger').then((s) => s.post('/api/runs', { name: 'no' }))).status, 403);
  const anon = await fetch(ctl.url + 'api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(anon.status, 401);
});

test('the board stores groups and arrangement outside the folder, rejects bad shapes, and shows each run as a section', async (t) => {
  const ctl = await setup(t);
  const agent = await ctl.as('claude'), you = await ctl.as('you');
  const before = files(ctl.dir);
  assert.deepEqual((await agent.get('/api/board')).json.selection, []);
  assert.equal((await you.post('/api/board', { selection: ['seed.svg'], view: { x: 1, y: 2, z: 0.5 } })).status, 200);
  const b0 = (await agent.get('/api/board')).json;
  assert.deepEqual(b0.selection, ['seed.svg']); assert.deepEqual(b0.view, { x: 1, y: 2, z: 0.5 });
  const run = (await agent.post('/api/runs', { name: 'sec' })).json.id;
  await agent.post(`/api/runs/${run}/artifacts`, { path: 'a.txt', content: 'a' });
  const set = await agent.post('/api/board', { groups: [{ id: 'g1', name: 'Mine', items: ['a.txt', 'seed.svg', 'a.txt'], groups: [{ id: 'g2', name: 'Inner', items: [] }] }], arrange: { by: 'run' }, views: [{ id: 'v', name: 'View' }] });
  assert.equal(set.status, 200);
  const b = (await you.get('/api/board')).json;
  assert.deepEqual(b.groups[0].items, ['a.txt', 'seed.svg']); assert.equal(b.arrange.by, 'run');
  assert.deepEqual(b.runs.find((s) => s.run === run).items, ['a.txt']);
  for (const bad of [{ groups: 'x' }, { groups: [{ id: 'a', name: 'n', items: [1] }] }, { groups: [{ id: 'a', name: 'n', items: [] }, { id: 'a', name: 'm', items: [] }] }, { arrange: {} }, {}]) assert.equal((await agent.post('/api/board', bad)).status, 400, JSON.stringify(bad));
  assert.equal((await agent.post('/api/board', { arrange: { by: 'kind' }, baseRevision: 0 })).status, 409);
  assert.deepEqual(files(ctl.dir), { ...before, 'a.txt': files(ctl.dir)['a.txt'] });
  await ctl.restart();
  const kept = (await (await ctl.as('claude')).get('/api/board')).json;
  assert.equal(kept.groups[0].id, 'g1'); assert.deepEqual(kept.selection, [], 'what the person sees is not kept across a restart');
});

test('four writers: artifacts and independent controls of one item all land', async (t) => {
  const ctl = await setup(t);
  const run = (await (await ctl.as('claude')).post('/api/runs', { name: 'busy' })).json.id;
  const writers = await Promise.all([0, 1, 2, 3].map((n) => ctl.as('w' + n)));
  const sched = [];
  await Promise.all(writers.map(async (w, n) => {
    for (let i = 0; i < 12; i++) {
      const path = `w${n}/f${i}.txt`, text = `${n}:${i}`;
      const r = await w.post(`/api/runs/${run}/artifacts`, { path, content: text });
      assert.equal(r.status, 200); sched.push([path, text]);
    }
  }));
  for (const [p, text] of sched) assert.equal(readFileSync(join(ctl.dir, p), 'utf8'), text);
  assert.equal((await writers[0].get(`/api/runs/${run}`)).json.artifacts.length, 48);
  const first = (await writers[0].get('/api/controls/seed.svg')).json;
  const four = first.sections.flatMap((s) => s.controls).filter((c) => c.id.startsWith('attr:')).slice(0, 4);
  assert.equal(four.length, 4);
  await Promise.all(writers.map(async (w, n) => {
    for (let retry = 0; retry < 20; retry++) {
      const rev = (await w.get('/api/controls/seed.svg')).json.revision;
      const r = await w.post('/api/control', { item: 'seed.svg', control: four[n].id, value: 'w' + 'x'.repeat(Math.max(0, String(four[n].value).length - 1)), baseRevision: rev });
      if (r.status === 200) return;
      assert.equal(r.status, 409);
    }
    assert.fail('writer starved');
  }));
  const final = (await writers[0].get('/api/controls/seed.svg')).json.sections.flatMap((s) => s.controls);
  for (let n = 0; n < 4; n++) assert.equal(final.find((c) => c.id === four[n].id).value, 'w' + 'x'.repeat(Math.max(0, String(four[n].value).length - 1)));
});
