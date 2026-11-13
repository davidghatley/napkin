import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, SVG } from './helpers.js';
import { startMcp } from '../helpers/harness.js';
import { TOOLS } from '../../src/agents/tools.js';

test('every tool in the contract is advertised with a schema, and runs over MCP end to end', async (t) => {
  const ctl = await setup(t);
  const agent = await startMcp(ctl.url, { NAPKIN_AGENT: 'codex' });
  const person = await startMcp(ctl.url, { NAPKIN_AGENT: 'you' });
  t.after(() => { agent.stop(); person.stop(); });
  const names = (await agent.request('tools/list', {})).result.tools.map((x) => x.name);
  for (const need of ['list_items', 'get_controls', 'set_control', 'get_board', 'set_board', 'start_run', 'add_run_step', 'add_artifact', 'get_run', 'checkpoint_run', 'resume_run', 'propose', 'resolve_proposal', 'ask_question', 'answer_question', 'read_events']) assert.ok(names.includes(need), need);
  assert.ok(names.includes('list_components') && names.includes('apply_edits'), 'the component tools are still there');
  for (const x of TOOLS) assert.ok(x.description.length > 30 && x.inputSchema.type === 'object', x.name);
  assert.match(agent.init.result.instructions, /start_run/, 'the connection text teaches runs');

  const { data: r } = await agent.call('start_run', { name: 'mcp run', plan: [{ id: 'a', label: 'A' }] });
  const added = (await agent.call('add_artifact', { run: r.id, path: 'made.svg', content: SVG(2), step: 'a' })).data;
  assert.equal(added.item.kind, 'svg'); assert.equal(readFileSync(join(ctl.dir, 'made.svg'), 'utf8'), SVG(2));
  const text = (await agent.call('read_item', { item: 'made.svg' })).data;
  assert.equal(text.encoding, 'utf8'); assert.equal(text.content, SVG(2)); assert.equal(text.done, true);
  const items = (await agent.call('list_items', { kind: 'svg' })).data.items;
  assert.ok(items.every((i) => i.kind === 'svg') && items.some((i) => i.path === 'made.svg'));

  // the same controls the person has; a stale write names the current revision and does not write
  const schema = (await agent.call('get_controls', { item: 'made.svg' })).data;
  const c = schema.sections.flatMap((s) => s.controls).find((x) => x.type === 'text');
  const ok = await agent.call('set_control', { item: 'made.svg', control: c.id, value: 'zz'.slice(0, String(c.value).length), baseRevision: schema.revision });
  assert.equal(ok.isError, false);
  const stale = await agent.call('set_control', { item: 'made.svg', control: c.id, value: 'q'.repeat(String(c.value).length), baseRevision: schema.revision });
  assert.equal(stale.isError, true); assert.match(stale.text, /stale revision/);
  assert.ok(JSON.parse(stale.text).currentRevision);

  // propose, answer, read: nothing is written until the answer comes
  const prop = (await agent.call('propose', { run: r.id, path: 'later.txt', content: 'maybe' })).data;
  assert.equal((await agent.call('list_review')).data.proposals.length, 1);
  assert.equal((await agent.call('resolve_proposal', { proposal: prop.id, outcome: 'accepted' })).isError, true, 'the author cannot approve');
  assert.equal((await person.call('resolve_proposal', { proposal: prop.id, outcome: 'sent-back', comment: 'not yet' })).isError, false);
  const q = (await agent.call('ask_question', { run: r.id, text: 'Pick', options: ['a', 'b'], waitMs: 1 })).data;
  assert.equal(q.status, 'open');
  setTimeout(() => person.call('answer_question', { question: q.id, answer: 'b' }), 150);
  const w = (await agent.call('wait_for_answer', { question: q.id, waitMs: 5000 })).data;
  assert.equal(w.answer, 'b');
  const ev = (await agent.call('read_events', {})).data.events;
  assert.ok(ev.some((e) => e.type === 'run-proposal-resolved' && e.id === prop.id && e.outcome === 'sent-back' && e.comment === 'not yet'));
  assert.ok(ev.some((e) => e.type === 'run-question-answered' && e.id === q.id && e.answer === 'b'));
  const agents = (await person.call('get_agents')).data.agents;
  assert.ok(agents.some((a) => a.name === 'codex'));
  assert.ok(!agents.some((a) => a.name === 'you'));
  const missing = await agent.call('get_run', { run: 'run_nope' });
  assert.equal(missing.isError, true); assert.match(missing.text, /Next:/);
});
