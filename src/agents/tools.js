// The MCP tools for the shared surface (DREAM 3 D5). src/mcp.js adds TOOLS to its own list and hands unknown tool names to
// runAgentTool(name, args, backend). Every tool is one HTTP route (src/agents/routes.js, src/kinds/routes.js); the
// arguments are the route's body, with `run`, `item`, `proposal` and `question` naming the path parameter.
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const str = (description) => ({ type: 'string', description });
const run = str('run id from start_run');
const encoding = { type: 'string', enum: ['utf8', 'base64'], description: 'utf8 for text, base64 for binary' };

export const TOOLS = [
  { name: 'list_items', description: 'Every file in the opened folder as an item: [{ id, path, kind, mime, bytes, meta }]. kind filters (e.g. "png", "csv", "md").', inputSchema: obj({ kind: str('only items of this kind') }) },
  { name: 'read_item', description: 'Read a file: text comes back as utf8, binary as base64. offset and length (default 256 KiB) window big files; done says whether you have it all.', inputSchema: obj({ item: str('item id (its path)'), offset: { type: 'number' }, length: { type: 'number' }, encoding }, ['item']) },
  { name: 'get_controls', description: 'Every control an item exposes, the same sections the person sees in the item panel: { revision, sections: [{ id, label, controls: [{ id, type, label, value, depth, min?, max?, step?, unit?, options? }] }] }.', inputSchema: obj({ item: str('item id') }, ['item']) },
  { name: 'set_control', description: 'Set one control through the same path the person uses (the file or its recipe changes on disk). baseRevision is the revision you read; if the item changed since, this fails with "stale revision" and currentRevision, and you read again and retry. Propose-mode agents: use propose with item and control instead.', inputSchema: obj({ item: str('item id'), control: str('control id'), value: {}, baseRevision: str('revision from get_controls') }, ['item', 'control', 'value', 'baseRevision']) },
  { name: 'undo', description: 'Undo the latest control change that you made on an item (exact bytes).', inputSchema: obj({ item: str('item id') }, ['item']) },
  { name: 'place_item', description: 'Move an item card on the canvas to x, y (canvas pixels).', inputSchema: obj({ item: str('item id'), x: { type: 'number' }, y: { type: 'number' } }, ['item', 'x', 'y']) },
  { name: 'get_board', description: 'What the person sees: { selection: [item ids], view, groups, arrange: { by }, views, compare, presentation, runs: derived section per run, revision }.', inputSchema: obj({}) },
  { name: 'set_board', description: 'Group and arrange work: any of groups [{ id, name, items, groups?, pinned? }], arrange { by: kind|folder|date|similarity|tag|status|run|meta.<column> }, views. baseRevision (optional) turns a concurrent edit into a "stale revision" error you can retry.', inputSchema: obj({ groups: { type: 'array' }, arrange: { type: 'object' }, views: { type: 'array' }, compare: { type: 'object' }, presentation: { type: 'boolean' }, baseRevision: { type: 'number' } }) },

  { name: 'start_run', description: 'Start a long piece of work as a run: a plan of steps the person watches. plan: [{ id, label, status? }]. Returns { id }. Artifacts, proposals and questions you attach to the run appear in its section on the canvas.', inputSchema: obj({ name: str('what this run does'), plan: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, status: { type: 'string' } } } }, goal: { type: 'string' } }, ['name']) },
  { name: 'list_runs', description: 'Every run with progress: [{ id, name, status, steps: { total, complete }, artifacts, pending }].', inputSchema: obj({}) },
  { name: 'get_run', description: 'One run in full: plan, steps (live status), artifacts, questions (with answers), proposals (with outcomes), checkpoints.', inputSchema: obj({ run }, ['run']) },
  { name: 'add_run_step', description: 'Set a step\'s status (pending, running, complete, failed, skipped, blocked) or add a new step. Same id updates; a new id appends. note is shown beside the step.', inputSchema: obj({ run, id: str('step id'), label: { type: 'string' }, status: { type: 'string', enum: ['pending', 'running', 'complete', 'failed', 'skipped', 'blocked'] }, note: { type: 'string' } }, ['run', 'id']) },
  { name: 'add_artifact', description: 'Write a real file into the folder as part of a run and show it in the run\'s section. path is relative to the folder; content is utf8 text or base64. Fails if the path holds different content unless overwrite is true. Propose-mode agents get a proposal back instead of a file.', inputSchema: obj({ run, path: str('relative path'), content: { type: 'string' }, encoding, kind: str('what you think it is, e.g. png'), step: str('step id this belongs to'), overwrite: { type: 'boolean' }, note: { type: 'string' } }, ['run', 'path', 'content']) },
  { name: 'set_run_status', description: 'Mark a run running, paused, complete, failed or cancelled.', inputSchema: obj({ run, status: { type: 'string', enum: ['running', 'paused', 'complete', 'failed', 'cancelled'] }, note: { type: 'string' } }, ['run', 'status']) },
  { name: 'checkpoint_run', description: 'Record a checkpoint (steps done, what is open) so work can resume after an interruption or a restart.', inputSchema: obj({ run, label: { type: 'string' } }, ['run']) },
  { name: 'resume_run', description: 'Pick a run up again after a restart: the next unfinished step, what is still open, and what the person answered since the last checkpoint.', inputSchema: obj({ run }, ['run']) },

  { name: 'propose', description: 'Propose instead of write: nothing touches the folder until the person approves. Either a file (path, content, encoding) or an instrument change (item, control, value, baseRevision). The person approves, rejects, comments or sends it back; read_events tells you which. After a send-back, propose again with replaces set to the old proposal id.', inputSchema: obj({ run: { type: 'string', description: 'run id (optional)' }, path: { type: 'string' }, content: { type: 'string' }, encoding, note: { type: 'string' }, step: { type: 'string' }, kind: { type: 'string' }, item: { type: 'string' }, control: { type: 'string' }, value: {}, baseRevision: { type: 'string' }, replaces: { type: 'string' } }) },
  { name: 'resolve_proposal', description: 'Answer a proposal (for a person\'s own tooling, or a reviewing agent; you cannot answer your own). outcome: accepted writes the file, rejected drops it, sent-back asks for changes, comment adds a note and leaves it open.', inputSchema: obj({ proposal: str('proposal id'), outcome: { type: 'string', enum: ['accepted', 'rejected', 'sent-back', 'comment'] }, comment: { type: 'string' } }, ['proposal', 'outcome']) },
  { name: 'ask_question', description: 'Ask the person a question; it appears on the canvas. options adds buttons (any text is still an answer). waitMs (up to 25000) waits for the answer before returning. Otherwise carry on and read the answer with read_events or wait_for_answer.', inputSchema: obj({ run: { type: 'string', description: 'run id (optional)' }, text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, multiple: { type: 'boolean' }, step: { type: 'string' }, waitMs: { type: 'number' } }, ['text']) },
  { name: 'wait_for_answer', description: 'Wait up to waitMs (max 25000) for the answer to a question you asked: { status: open|answered, answer? }.', inputSchema: obj({ question: str('question id'), waitMs: { type: 'number' } }, ['question']) },
  { name: 'answer_question', description: 'Answer a question (the person does this on the canvas; this is the same call). You cannot answer your own.', inputSchema: obj({ question: str('question id'), answer: { type: 'string' } }, ['question', 'answer']) },
  { name: 'list_review', description: 'What is waiting for the person right now: pending proposals and open questions.', inputSchema: obj({}) },
  { name: 'read_events', description: 'What happened since you last read: answers, approvals, rejections, send-backs, comments, new runs and artifacts, board changes. Reading advances your cursor; pass since to re-read, since: "now" to skip the backlog, waitMs (max 25000) to wait for the first new event, run or types to filter.', inputSchema: obj({ since: { type: ['number', 'string'] }, waitMs: { type: 'number' }, run: { type: 'string' }, types: { type: 'string', description: 'comma list, e.g. run-question-answered,run-proposal-resolved' }, limit: { type: 'number' } }) },
  { name: 'get_agents', description: 'Who is connected and what each is doing now: [{ name, run, label, step, at }].', inputSchema: obj({}) },
  { name: 'get_audit', description: 'The audit trail: every write made through runs, proposals, questions and the board, with who and when. Filter with run.', inputSchema: obj({ run: { type: 'string' }, limit: { type: 'number' } }) },
];

export const RUNS_GUIDE = `
## Runs, review and the shared surface

You can do long work as a run the person watches. Start one with start_run (a plan of steps), mark steps running or
complete with add_run_step, and put what you make into the folder with add_artifact: the file is real, and it appears in the
run's section on the canvas at once. Use propose when the person should approve a change first (a file, or a control value);
nothing is written until they answer. Use ask_question when you need a decision; it shows on the canvas. Read what they said
with read_events (answers, approvals, rejections, send-backs and comments arrive as events with the proposal or question id).
Read the person's selection with get_board, hold the same instruments they hold with get_controls and set_control, and group
work with set_board. checkpoint_run before anything long; after a restart, resume_run tells you the next unfinished step.
Errors end with "Next:" and say what to do. A "stale revision" error means someone changed the item: read it again and retry.
`;

const q = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) p.set(k, String(v)); return p; };
const enc = encodeURIComponent;
function fail(r, extra) {
  const e = new Error(r.json?.error ?? `HTTP ${r.status}`);
  const { ok: _ok, error: _error, ...rest } = r.json ?? {};
  e.data = { ok: false, ...rest, ...extra };
  throw e;
}
const good = (r) => (r.status >= 400 || r.json?.ok === false ? fail(r) : r.json);

export async function runAgentTool(name, a = {}, b) {
  const get = (path, query) => b.call({ method: 'GET', path, query: query && q(query) });
  const post = (path, body) => b.call({ method: 'POST', path, body });
  switch (name) {
    case 'list_items': { const j = good(await get('/api/items')); return { items: a.kind ? j.items.filter((x) => x.kind === a.kind) : j.items }; }
    case 'read_item': return good(await get('/api/read', { item: a.item, offset: a.offset, length: a.length, encoding: a.encoding }));
    case 'get_controls': return good(await get(`/api/controls/${enc(a.item)}`));
    case 'set_control': {
      const r = await post('/api/control', { item: a.item, control: a.control, value: a.value, baseRevision: a.baseRevision });
      if (r.status === 409 || /changed/.test(r.json?.error ?? '') && r.status >= 400) {
        const now = await get(`/api/controls/${enc(a.item)}`);
        const e = new Error(`stale revision: ${r.json?.error ?? 'the item changed'} Next: read get_controls again and retry with baseRevision ${now.json?.revision}.`);
        e.data = { ok: false, stale: true, currentRevision: now.json?.revision };
        throw e;
      }
      return good(r);
    }
    case 'undo': return good(await post('/api/undo', { item: a.item }));
    case 'place_item': return good(await post('/api/item-layout', { item: a.item, x: a.x, y: a.y }));
    case 'get_board': return good(await get('/api/board'));
    case 'set_board': return good(await post('/api/board', a));
    case 'start_run': return good(await post('/api/runs', a));
    case 'list_runs': return good(await get('/api/runs'));
    case 'get_run': return good(await get(`/api/runs/${enc(a.run)}`));
    case 'add_run_step': { const { run: r, ...body } = a; return good(await post(`/api/runs/${enc(r)}/steps`, body)); }
    case 'add_artifact': { const { run: r, ...body } = a; return good(await post(`/api/runs/${enc(r)}/artifacts`, body)); }
    case 'set_run_status': return good(await post(`/api/runs/${enc(a.run)}/status`, { status: a.status, note: a.note }));
    case 'checkpoint_run': return good(await post(`/api/runs/${enc(a.run)}/checkpoint`, { label: a.label }));
    case 'resume_run': return good(await post(`/api/runs/${enc(a.run)}/resume`, {}));
    case 'propose': { const { run: r, ...body } = a; return good(await post(r ? `/api/runs/${enc(r)}/proposals` : '/api/proposals/file', body)); }
    case 'resolve_proposal': return good(await post(`/api/review/${enc(a.proposal)}`, { outcome: a.outcome, comment: a.comment }));
    case 'ask_question': {
      const asked = good(await post('/api/questions', { run: a.run, text: a.text, options: a.options, multiple: a.multiple, step: a.step }));
      if (Number(a.waitMs) > 0) return { ...asked, ...good(await get(`/api/questions/${enc(asked.id)}`, { wait: Math.min(Number(a.waitMs), 25000) })) };
      return asked;
    }
    case 'wait_for_answer': return good(await get(`/api/questions/${enc(a.question)}`, { wait: Math.min(Number(a.waitMs) || 0, 25000) || undefined }));
    case 'answer_question': return good(await post(`/api/questions/${enc(a.question)}/answer`, { answer: a.answer }));
    case 'list_review': return good(await get('/api/review'));
    case 'read_events': return good(await get('/api/event-log', { since: a.since, wait: Math.min(Number(a.waitMs) || 0, 25000) || undefined, run: a.run, types: a.types, limit: a.limit }));
    case 'get_agents': return good(await get('/api/agents'));
    case 'get_audit': return good(await get('/api/audit', { run: a.run, limit: a.limit }));
    default: return undefined;
  }
}
export const isAgentTool = (name) => TOOLS.some((t) => t.name === name);
