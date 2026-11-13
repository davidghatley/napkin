// Runs, steps, artifacts, proposals, questions, checkpoints, presence and the event log (DREAM 3, D5).
// One store per opened folder. Everything an agent does through HTTP or MCP lands here, is written to the state
// directory (never the opened folder, except artifacts, which are real files in it) and is announced once on the event
// stream and once in the durable event log, which is also the audit trail.
//
//   const runs = createRuns({ root, stateDir, items, broadcast, colorOf })
//   runs.startRun(by, { name, plan }) / runs.step(by, id, { id, label, status }) / runs.artifact(by, id, {...})
//   runs.propose(by, id, {...}) / runs.resolve(by, proposalId, { outcome, comment })
//   runs.ask(by, {...}) / runs.answer(by, questionId, { answer })
//   runs.checkpoint(by, id, label) / runs.resume(by, id)
//   runs.events(by, { since, wait, run, types, limit, peek })        the durable log, one cursor per caller name
//
// Every method throws RunError(message, status). Messages end in "Next: ..." so an agent can act on them.
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, appendFileSync,
  statSync, renameSync, rmSync, unlinkSync,
} from 'node:fs';
import { dirname, join, resolve, sep, posix } from 'node:path';
import { writeAtomic } from '../atomic.js';
import { stateRoot } from '../doc/folder.js';
import { explainError } from '../errors.js';

export class RunError extends Error {
  constructor(message, status = 400, extra) { super(explainError(message)); this.status = status; this.extra = extra; }
}
const refuse = (message, status, extra) => { throw new RunError(message, status, extra); };

export const STEP_STATUS = ['pending', 'running', 'complete', 'failed', 'skipped', 'blocked'];
export const RUN_STATUS = ['running', 'paused', 'complete', 'failed', 'cancelled'];
const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'bower_components', 'vendor', 'target']);
const MAX_ARTIFACT = 40 * 1024 * 1024;
const RING = 2000;           // events kept in memory
const LOG_KEEP = 20000;      // events kept on disk
const sha = (b) => createHash('sha256').update(b).digest('hex');
const uid = (p) => `${p}_${randomBytes(5).toString('hex')}`;
const text = (v, max, what) => {
  if (typeof v !== 'string' || !v.trim()) refuse(`${what} must be a non-empty string. Next: send ${what}.`);
  return v.trim().slice(0, max);
};

const OUTCOMES = {
  accepted: 'accepted', accept: 'accepted', approve: 'accepted', approved: 'accepted',
  rejected: 'rejected', reject: 'rejected', deny: 'rejected', denied: 'rejected',
  'sent-back': 'sent-back', 'send-back': 'sent-back', sendback: 'sent-back', 'changes-requested': 'sent-back', 'request-changes': 'sent-back', revise: 'sent-back',
  comment: 'comment', commented: 'comment',
};

export function createRuns({ root, stateDir = stateRoot(), items, broadcast = () => {}, colorOf = () => ({}) }) {
  root = realpathSync(root);
  const dir = join(stateDir, createHash('sha256').update(Buffer.from(root)).digest('hex').slice(0, 20), 'agents');
  // The state folder is made on the first write: merely opening a folder leaves no trace in the state directory.
  const ensure = () => { mkdirSync(join(dir, 'runs'), { recursive: true }); mkdirSync(join(dir, 'content'), { recursive: true }); };

  const runs = new Map();            // id -> run
  const questions = new Map();       // id -> question (global: a question may belong to no run)
  const proposals = new Map();       // id -> proposal (global index; the record lives in run.proposals or loose)
  const looseProposals = [];         // proposals of no run
  const looseQuestions = [];

  // ------------------------------------------------------------------------------------------------ persistence
  const writeJson = (file, value) => {
    ensure();
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, file);
  };
  const saveRun = (run) => { run.updatedAt = Date.now(); writeJson(join(dir, 'runs', `${run.id}.json`), run); };
  const saveLoose = () => writeJson(join(dir, 'loose.json'), { questions: looseQuestions, proposals: looseProposals });
  const index = (run) => {
    runs.set(run.id, run);
    for (const q of run.questions) questions.set(q.id, q);
    for (const p of run.proposals) proposals.set(p.id, p);
  };
  let saved = []; try { saved = readdirSync(join(dir, 'runs')); } catch { /* nothing saved yet */ }
  for (const f of saved) {
    if (!f.endsWith('.json')) continue;
    try { index(JSON.parse(readFileSync(join(dir, 'runs', f), 'utf8'))); } catch { /* a half-written file is skipped; the rename above is atomic */ }
  }
  try {
    const loose = JSON.parse(readFileSync(join(dir, 'loose.json'), 'utf8'));
    for (const q of loose.questions) { looseQuestions.push(q); questions.set(q.id, q); }
    for (const p of loose.proposals) { looseProposals.push(p); proposals.set(p.id, p); }
  } catch { /* none yet */ }

  // ------------------------------------------------------------------------------------------------ event log
  const logFile = join(dir, 'events.jsonl'), cursorFile = join(dir, 'cursors.json');
  let ring = [], seq = 0;
  try {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const keep = lines.length > LOG_KEEP ? lines.slice(-Math.floor(LOG_KEEP / 2)) : lines;
    if (keep !== lines) writeFileSync(logFile, keep.join('\n') + '\n');
    for (const l of keep) { try { ring.push(JSON.parse(l)); } catch { /* torn last line */ } }
    ring = ring.slice(-RING);
    seq = ring.at(-1)?.seq ?? 0;
  } catch { /* first start */ }
  let cursors = {};
  try { cursors = JSON.parse(readFileSync(cursorFile, 'utf8')); } catch { /* none */ }
  const waiters = new Set();
  const wake = () => { for (const w of [...waiters]) w(); };

  function emit(type, data = {}, { persist = true } = {}) {
    const ev = { type, seq: ++seq, at: Date.now(), ...data };
    if (persist) {
      ring.push(ev); if (ring.length > RING * 1.5) ring = ring.slice(-RING);
      try { ensure(); appendFileSync(logFile, JSON.stringify(ev) + '\n'); } catch { /* the log is best effort; the run files are the record */ }
    }
    broadcast({ ...ev, ...(ev.by ? colorOf(ev.by) : {}) });
    wake();
    return ev;
  }

  // Presence for runs: who is here, what they are doing, for how long.
  const agents = new Map(); // name -> { name, run, label, step, at, since }
  function touch(by, run, label, step) {
    if (!by || by === 'you') return; // the person is not an agent: no presence chip for them
    const prev = agents.get(by);
    const a = { name: by, run: run?.id ?? prev?.run ?? null, runName: run?.name ?? prev?.runName ?? null, label: label || prev?.label || 'working', step: step ?? null, at: Date.now(), since: prev?.since ?? Date.now() };
    agents.set(by, a);
    broadcast({ type: 'run-activity', agent: by, ...colorOf(by), run: a.run, runName: a.runName, label: a.label, step: a.step, at: a.at });
  }

  // ------------------------------------------------------------------------------------------------ files
  function folderPath(path) {
    if (typeof path !== 'string' || !path || path.length > 300 || path.includes('\0'))
      refuse('path must be a relative file path inside the opened folder. Next: send e.g. "reports/summary.md".');
    const norm = posix.normalize(path.replaceAll('\\', '/'));
    const parts = norm.split('/');
    const odd = parts.find((x) => x === '..' || x === '' || x.startsWith('.') || SKIP.has(x));
    if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || odd !== undefined)
      refuse(`path ${JSON.stringify(path)} is outside what napkin lists${odd ? ` (${JSON.stringify(odd)} is hidden or skipped; so are ${[...SKIP].join(', ')})` : ' (absolute paths are not allowed)'}. Next: use a plain relative path such as "renders/a.svg".`);
    const abs = resolve(root, norm);
    if (!abs.startsWith(root + sep)) refuse('path escapes the opened folder. Next: use a relative path inside it.');
    return { rel: parts.join('/'), abs };
  }
  function ensureInside(abs) {
    mkdirSync(dirname(abs), { recursive: true });
    const real = realpathSync(dirname(abs));
    if (real !== root && !real.startsWith(root + sep)) refuse('path escapes the opened folder through a link. Next: use a plain relative path.');
  }
  const decode = (content, encoding = 'utf8') => {
    if (typeof content !== 'string') refuse('content must be a string (utf8 text or base64). Next: send content with encoding "utf8" or "base64".');
    if (encoding !== 'utf8' && encoding !== 'base64') refuse('encoding must be "utf8" or "base64". Next: send encoding "utf8" or "base64".');
    if (content.length > MAX_ARTIFACT * 1.4) refuse('content is over 40 MiB. Next: write large files directly in the folder and mention them in a step.', 413);
    const buf = Buffer.from(content, encoding);
    if (encoding === 'base64' && content.length && !buf.length) refuse('content is not valid base64. Next: send base64 text.');
    if (buf.length > MAX_ARTIFACT) refuse('content is over 40 MiB. Next: write large files directly in the folder and mention them in a step.', 413);
    return buf;
  };
  const currentSha = (abs) => { try { return sha(readFileSync(abs)); } catch { return null; } };
  function detectKind(rel) { try { return items.get(rel).kind; } catch { return null; } }

  // ------------------------------------------------------------------------------------------------ runs
  const getRun = (id) => runs.get(id) ?? refuse(`no run ${JSON.stringify(id)}. Next: list_runs, or start_run.`, 404);
  const summary = (r) => ({
    id: r.id, name: r.name, by: r.by, status: r.status, goal: r.goal, createdAt: r.createdAt, updatedAt: r.updatedAt,
    steps: { total: r.steps.length, complete: r.steps.filter((s) => s.status === 'complete').length, failed: r.steps.filter((s) => s.status === 'failed').length, running: r.steps.filter((s) => s.status === 'running').map((s) => s.id) },
    artifacts: r.artifacts.length,
    pending: { proposals: r.proposals.filter((p) => p.status === 'pending').length, questions: r.questions.filter((q) => q.status === 'open').length },
    agents: [...new Set([r.by, ...r.artifacts.map((a) => a.by), ...r.steps.map((s) => s.by).filter(Boolean)])],
    lastCheckpoint: r.checkpoints.at(-1) ?? null,
  });
  const normStep = (s, i) => {
    const o = typeof s === 'string' ? { label: s } : s;
    if (!o || typeof o !== 'object') refuse('each plan step is a label or { id, label, status }. Next: fix the plan.');
    const id = o.id === undefined ? `s${i + 1}` : text(String(o.id), 80, 'step id');
    const status = o.status ?? 'pending';
    if (!STEP_STATUS.includes(status)) refuse(`step status must be one of ${STEP_STATUS.join(', ')}. Next: use one of them.`);
    return { id, label: text(o.label ?? id, 300, 'step label'), status };
  };

  function startRun(by, { name, plan = [], goal } = {}) {
    name = text(name, 120, 'name');
    if (!Array.isArray(plan) || plan.length > 500) refuse('plan must be an array of up to 500 steps. Next: send plan: [{ id, label }].');
    const planned = plan.map(normStep);
    if (new Set(planned.map((s) => s.id)).size !== planned.length) refuse('plan step ids must be unique. Next: give each step its own id.');
    const now = Date.now();
    const run = {
      id: uid('run'), name, by, goal: typeof goal === 'string' ? goal.slice(0, 600) : undefined, status: 'running', createdAt: now, updatedAt: now,
      plan: planned.map(({ id, label }) => ({ id, label })),
      steps: planned.map((s) => ({ ...s, ...(s.status === 'running' ? { startedAt: now } : {}), ...(s.status === 'complete' ? { completedAt: now } : {}) })),
      artifacts: [], questions: [], proposals: [], checkpoints: [],
    };
    runs.set(run.id, run);
    saveRun(run);
    touch(by, run, `started ${name}`);
    emit('run-started', { run: run.id, name, by, steps: run.steps.length, summary: summary(run) });
    return { id: run.id, run: view(run) };
  }
  const view = (r) => ({ ...r, summary: summary(r) });

  function step(by, id, { id: stepId, label, status, note, detail } = {}) {
    const run = getRun(id);
    stepId = text(String(stepId ?? ''), 80, 'step id');
    if (status !== undefined && !STEP_STATUS.includes(status)) refuse(`step status must be one of ${STEP_STATUS.join(', ')}. Next: use one of them.`);
    let s = run.steps.find((x) => x.id === stepId);
    const now = Date.now();
    if (!s) {
      s = { id: stepId, label: text(label ?? stepId, 300, 'step label'), status: status ?? 'pending' };
      run.steps.push(s);
    } else if (label !== undefined) s.label = text(label, 300, 'step label');
    if (status !== undefined) {
      s.status = status;
      if (status === 'running') s.startedAt ??= now;
      if (status === 'complete' || status === 'failed' || status === 'skipped') s.completedAt = now;
      if (status === 'pending') delete s.completedAt;
    }
    if (typeof note === 'string' || typeof detail === 'string') s.note = String(note ?? detail).slice(0, 600);
    s.by = by;
    if (run.status === 'running' && run.steps.length && run.steps.every((x) => x.status === 'complete' || x.status === 'skipped')) run.status = 'complete';
    else if (run.status === 'complete' && run.steps.some((x) => x.status !== 'complete' && x.status !== 'skipped')) run.status = 'running';
    saveRun(run);
    touch(by, run, `${s.status}: ${s.label}`, s.id);
    emit('run-step', { run: run.id, by, step: { ...s }, status: run.status });
    return { ok: true, step: s, status: run.status, next: nextStep(run) };
  }
  const nextStep = (run) => run.steps.find((x) => x.status !== 'complete' && x.status !== 'skipped') ?? null;

  function setStatus(by, id, status, note) {
    const run = getRun(id);
    if (!RUN_STATUS.includes(status)) refuse(`run status must be one of ${RUN_STATUS.join(', ')}. Next: use one of them.`);
    run.status = status;
    if (note) run.note = String(note).slice(0, 600);
    saveRun(run);
    touch(by, run, `run ${status}`);
    emit('run-status', { run: run.id, by, status, note: run.note });
    return { ok: true, status };
  }

  // ------------------------------------------------------------------------------------------------ artifacts
  function artifact(by, id, { path, content, encoding = 'utf8', kind, step: stepId, overwrite = false, note, propose = false, mode = 'write' } = {}) {
    const run = getRun(id);
    if (stepId !== undefined && !run.steps.some((x) => x.id === stepId))
      refuse(`run ${run.id} has no step ${JSON.stringify(stepId)}. Next: add_run_step first, or use one of ${run.steps.slice(0, 8).map((x) => x.id).join(', ')}.`);
    const { rel, abs } = folderPath(path);
    const buf = decode(content, encoding);
    if (propose || mode === 'propose') return propose_({ by, run, rel, abs, buf, note: note ?? 'new file', kind, step: stepId });
    ensureInside(abs);
    const before = existsSync(abs) ? sha(readFileSync(abs)) : null;
    const digest = sha(buf);
    if (before === digest) { /* the same bytes are already there: attach, do not rewrite */ }
    else if (before && !overwrite) refuse(`${rel} already exists with different content. Next: choose another path, or send overwrite: true to replace it (the previous version is not kept).`, 409);
    else writeAtomic(abs, buf, before ? {} : { exclusive: true });
    return attach({ by, run, rel, buf, digest, kind, stepId, note, previous: before && before !== digest ? before : null });
  }
  function attach({ by, run, rel, buf, digest, kind, stepId, note, previous, proposal }) {
    items.invalidate();
    let found = null; try { found = items.get(rel); } catch { /* not listed (hidden by the skip list) */ }
    const art = {
      id: uid('art'), path: rel, kind: found?.kind ?? kind ?? 'file', ...(kind && found && kind !== found.kind ? { declaredKind: kind } : {}),
      bytes: buf.length, sha: digest.slice(0, 20), step: stepId ?? null, by, at: Date.now(), ...(note ? { note: String(note).slice(0, 300) } : {}),
      ...(previous ? { replaced: previous.slice(0, 20) } : {}), ...(proposal ? { proposal } : {}),
    };
    run.artifacts.push(art);
    saveRun(run);
    touch(by, run, `placed ${rel}`, stepId);
    broadcast({ type: 'items-changed', paths: [rel] });
    emit('run-artifact', { run: run.id, by, path: rel, artifact: art, item: found ? { id: found.id, kind: found.kind, mime: found.mime, bytes: found.bytes } : null });
    return { ok: true, id: art.id, artifact: art, item: found ? { id: found.id, kind: found.kind } : null };
  }

  // ------------------------------------------------------------------------------------------------ proposals
  const contentFile = (id) => join(dir, 'content', id);
  function publicProposal(p) {
    const { value: _v, ...rest } = p;
    return { ...rest, ...(p.kind === 'control' ? { value: p.value } : {}), ...colorOf(p.by) };
  }
  function previewOf(buf, rel) {
    const k = detectKind(rel);
    const texty = !buf.subarray(0, 4096).includes(0);
    return { texty, preview: texty ? buf.subarray(0, 1600).toString('utf8') : null, image: /^image\//.test(guessMime(rel)) };
  }
  const guessMime = (rel) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' })[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

  function propose_({ by, run, rel, abs, buf, note, kind, step: stepId, replaces }) {
    ensureInside(abs);
    const id = uid('prop');
    const p = {
      id, run: run?.id ?? null, by, kind: 'file', path: rel, bytes: buf.length, sha: sha(buf).slice(0, 20), declaredKind: kind ?? null, step: stepId ?? null,
      baseSha: existsSync(abs) ? sha(readFileSync(abs)) : null, note: note ? String(note).slice(0, 600) : '', status: 'pending', comments: [], at: Date.now(),
      ...previewOf(buf, rel), mime: guessMime(rel),
      ...(replaces ? { replaces } : {}),
    };
    ensure(); writeFileSync(contentFile(id), buf);
    return register(p, run, by);
  }
  function register(p, run, by) {
    proposals.set(p.id, p);
    if (run) { run.proposals.push(p); saveRun(run); } else { looseProposals.push(p); saveLoose(); }
    touch(by, run, `proposed ${p.path ?? p.control}`, p.step);
    emit('run-proposal', { run: run?.id ?? null, by, id: p.id, proposal: publicProposal(p) });
    return { ok: true, id: p.id, proposal: p.id, status: 'pending', proposed: true };
  }
  function propose(by, runId, body = {}) {
    const run = runId ? getRun(runId) : null;
    if (body.replaces) {
      const old = proposals.get(body.replaces);
      if (!old || old.by !== by) refuse(`replaces: no proposal ${JSON.stringify(body.replaces)} of yours. Next: read_events for the sent-back proposal id.`, 404);
    }
    if (body.step !== undefined && run && !run.steps.some((x) => x.id === body.step)) refuse(`run ${run.id} has no step ${JSON.stringify(body.step)}. Next: add_run_step first.`);
    if (body.item !== undefined) { // a proposed instrument change
      let c;
      try { c = items.controls(String(body.item)); } catch (e) { refuse(`${e.message}`, e.status ?? 404); }
      const control = c.sections.flatMap((s) => s.controls).find((x) => x.id === body.control);
      if (!control) refuse(`item ${body.item} has no control ${JSON.stringify(body.control)}. Next: get_controls and use a listed id.`, 404);
      const p = {
        id: uid('prop'), run: run?.id ?? null, by, kind: 'control', item: String(body.item), control: body.control, label: control.label ?? control.id, value: body.value,
        before: control.value, baseRevision: body.baseRevision ?? c.revision, note: body.note ? String(body.note).slice(0, 600) : '', status: 'pending', comments: [], at: Date.now(),
        path: String(body.item), ...(body.replaces ? { replaces: body.replaces } : {}),
      };
      const r = register(p, run, by);
      if (body.replaces) supersede(body.replaces, p.id);
      return r;
    }
    const { rel, abs } = folderPath(body.path);
    const r = propose_({ by, run, rel, abs, buf: decode(body.content, body.encoding), note: body.note, kind: body.kind, step: body.step, replaces: body.replaces });
    if (body.replaces) supersede(body.replaces, r.id);
    return r;
  }
  function supersede(oldId, newId) {
    const old = proposals.get(oldId);
    if (old && old.status === 'sent-back') { old.status = 'superseded'; old.supersededBy = newId; persistProposal(old); }
  }
  const persistProposal = (p) => { const run = p.run && runs.get(p.run); if (run) saveRun(run); else saveLoose(); };

  function resolve_(by, id, { outcome, comment } = {}) {
    const p = proposals.get(id) ?? refuse(`no proposal ${JSON.stringify(id)}. Next: GET /api/review lists what is waiting.`, 404);
    const kind = OUTCOMES[String(outcome ?? '').toLowerCase()] ?? refuse(`outcome must be accepted, rejected, sent-back or comment. Next: use one of them.`);
    if (p.by === by) refuse('You cannot review your own proposal. Next: leave it for the person (or another agent) to answer.', 403);
    const note = typeof comment === 'string' ? comment.trim().slice(0, 1200) : '';
    if (p.status !== 'pending' && !(kind === 'comment' && p.status === 'sent-back')) refuse(`proposal ${id} is already ${p.status}. Next: read it with get_run.`, 409);
    const run = p.run ? runs.get(p.run) : null;
    if (kind === 'comment') {
      if (!note) refuse('a comment needs text. Next: send comment.');
      p.comments.push({ by, text: note, at: Date.now() });
      persistProposal(p);
      touch(by, run, `commented on ${p.path}`);
      emit('run-proposal-comment', { run: p.run, by, id: p.id, proposal: p.id, outcome: 'comment', comment: note, path: p.path, proposedBy: p.by });
      return { ok: true, status: p.status, outcome: 'comment' };
    }
    let result = {};
    if (kind === 'accepted') result = land(p, by);
    if (note) p.comments.push({ by, text: note, at: Date.now() });
    p.status = kind; p.resolvedBy = by; p.resolvedAt = Date.now();
    if (note) p.resolution = note;
    if (kind !== 'accepted' || p.kind === 'control') { /* nothing on disk to attach */ }
    persistProposal(p);
    touch(by, run, `${kind} ${p.path}`);
    const ev = emit('run-proposal-resolved', { run: p.run, by, id: p.id, proposal: p.id, outcome: kind, comment: note, path: p.path, proposedBy: p.by, kind: p.kind, ...result });
    if (kind !== 'accepted') { try { unlinkSync(contentFile(p.id)); } catch { /* none */ } }
    return { ok: true, status: kind, outcome: kind, seq: ev.seq, ...result };
  }
  // Writing an accepted proposal. Throws (leaving it pending) when the file changed since it was proposed.
  function land(p, by) {
    const run = p.run ? runs.get(p.run) : null;
    if (p.kind === 'control') {
      try { const r = items.control(p.item, p.control, p.value, p.baseRevision, p.by); return { revision: r.revision, applied: true }; }
      catch (e) { refuse(`${e.message} The proposal stays open. Next: ask the agent to propose again on the new revision, or reject it.`, e.status === 409 ? 409 : (e.status ?? 400)); }
    }
    const { abs } = folderPath(p.path);
    ensureInside(abs);
    const buf = readFileSync(contentFile(p.id));
    const now = existsSync(abs) ? sha(readFileSync(abs)) : null;
    if (now !== p.baseSha) refuse(`${p.path} changed on disk after it was proposed. The proposal stays open. Next: reject it, or send it back so the agent proposes again.`, 409);
    try {
      writeAtomic(abs, buf, { ...(p.baseSha ? { check: () => { if (currentSha(abs) !== p.baseSha) throw new RunError('the file changed while saving', 409); } } : { exclusive: true }) });
    } catch (e) {
      if (e instanceof RunError) throw e;
      if (e.code === 'EEXIST') refuse(`${p.path} appeared after it was proposed. The proposal stays open. Next: reject it or send it back.`, 409);
      throw e;
    }
    if (run) {
      const placed = attach({ by: p.by, run, rel: p.path, buf, digest: sha(buf), kind: p.declaredKind ?? undefined, stepId: p.step, note: p.note, previous: p.baseSha, proposal: p.id });
      return { artifact: placed.artifact.id };
    }
    items.invalidate(); broadcast({ type: 'items-changed', paths: [p.path] });
    return {};
  }
  function content(id) {
    const p = proposals.get(id) ?? refuse(`no proposal ${JSON.stringify(id)}.`, 404);
    if (p.kind !== 'file') refuse('only file proposals have content.', 404);
    try { return { bytes: readFileSync(contentFile(id)), mime: p.mime, path: p.path }; } catch { refuse('the proposal content is gone (it was resolved).', 404); }
  }

  // ------------------------------------------------------------------------------------------------ questions
  function ask(by, { run: runId, text: t, options, multiple, default: def, step: stepId } = {}) {
    const run = runId ? getRun(runId) : null;
    if (options !== undefined && (!Array.isArray(options) || options.length > 40 || options.some((o) => typeof o !== 'string' || !o.trim())))
      refuse('options must be up to 40 non-empty strings. Next: send options: ["yes","no"].');
    const q = {
      id: uid('q'), run: run?.id ?? null, by, text: text(t, 1200, 'text'), options: options?.map((o) => o.trim().slice(0, 200)) ?? [],
      ...(multiple ? { multiple: true } : {}), ...(def !== undefined ? { default: String(def).slice(0, 200) } : {}), step: stepId ?? null, status: 'open', at: Date.now(),
    };
    questions.set(q.id, q);
    if (run) { run.questions.push(q); saveRun(run); } else { looseQuestions.push(q); saveLoose(); }
    touch(by, run, 'asked a question', stepId);
    emit('run-question', { run: run?.id ?? null, by, id: q.id, question: q.id, text: q.text, options: q.options, ...(q.multiple ? { multiple: true } : {}) });
    return { ok: true, id: q.id, question: q.id, status: 'open' };
  }
  function answer(by, id, { answer: a } = {}) {
    const q = questions.get(id) ?? refuse(`no question ${JSON.stringify(id)}. Next: GET /api/review lists what is waiting.`, 404);
    if (q.by === by) refuse('You cannot answer your own question. Next: wait for the person to answer.', 403);
    if (q.status !== 'open') refuse(`question ${id} is already ${q.status}. Next: read the answer with get_run.`, 409);
    if (typeof a !== 'string' && !Array.isArray(a)) refuse('answer must be text (or a list of options). Next: send answer.');
    const value = Array.isArray(a) ? a.map(String) : a.slice(0, 4000);
    if (typeof value === 'string' && !value.trim()) refuse('answer is empty. Next: send some text.');
    q.status = 'answered'; q.answer = value; q.answeredBy = by; q.answeredAt = Date.now();
    persistQuestion(q);
    touch(by, q.run && runs.get(q.run), 'answered a question');
    const ev = emit('run-question-answered', { run: q.run, by, id: q.id, question: q.id, answer: value, askedBy: q.by, text: q.text });
    return { ok: true, id: q.id, answer: value, seq: ev.seq };
  }
  const persistQuestion = (q) => { const run = q.run && runs.get(q.run); if (run) saveRun(run); else saveLoose(); };
  async function waitAnswer(id, ms = 0) {
    const q = questions.get(id) ?? refuse(`no question ${JSON.stringify(id)}.`, 404);
    const until = Date.now() + Math.min(Math.max(Number(ms) || 0, 0), 30000);
    while (q.status === 'open' && Date.now() < until) await new Promise((res) => { const t = setTimeout(done, until - Date.now()); function done() { clearTimeout(t); waiters.delete(done); res(); } waiters.add(done); });
    return { ok: true, id: q.id, status: q.status, ...(q.status === 'answered' ? { answer: q.answer, answeredBy: q.answeredBy } : {}) };
  }

  // ------------------------------------------------------------------------------------------------ checkpoints and resume
  function checkpoint(by, id, label) {
    const run = getRun(id);
    const cp = {
      id: uid('cp'), label: String(label ?? `Checkpoint ${run.checkpoints.length + 1}`).slice(0, 120), by, at: Date.now(),
      stepsComplete: run.steps.filter((s) => s.status === 'complete').length, stepsTotal: run.steps.length, next: nextStep(run)?.id ?? null,
      artifacts: run.artifacts.length, openQuestions: run.questions.filter((q) => q.status === 'open').map((q) => q.id), pendingProposals: run.proposals.filter((p) => p.status === 'pending').map((p) => p.id),
      stepStates: Object.fromEntries(run.steps.map((s) => [s.id, s.status])),
    };
    run.checkpoints.push(cp);
    saveRun(run);
    touch(by, run, `checkpoint ${cp.label}`);
    emit('run-checkpoint', { run: run.id, by, checkpoint: cp });
    return { ok: true, id: cp.id, checkpoint: cp };
  }
  // Everything an agent needs to carry on: what is next, what is still open, what the person answered since the checkpoint.
  function resume(by, id) {
    const run = getRun(id);
    const cp = run.checkpoints.at(-1) ?? null;
    const since = cp?.at ?? 0;
    const next = nextStep(run);
    if (run.status === 'paused' || run.status === 'failed') { run.status = 'running'; saveRun(run); }
    touch(by, run, 'resumed');
    emit('run-resumed', { run: run.id, by, next: next?.id ?? null });
    return {
      ok: true, run: run.id, name: run.name, status: run.status, next,
      pending: run.steps.filter((s) => s.status !== 'complete' && s.status !== 'skipped'),
      done: run.steps.filter((s) => s.status === 'complete').length, total: run.steps.length,
      checkpoint: cp,
      openQuestions: run.questions.filter((q) => q.status === 'open'),
      pendingProposals: run.proposals.filter((p) => p.status === 'pending').map(publicProposal),
      answeredSinceCheckpoint: run.questions.filter((q) => q.status === 'answered' && q.answeredAt > since).map(({ id: i, text: t, answer: a, answeredBy }) => ({ id: i, text: t, answer: a, answeredBy })),
      resolvedSinceCheckpoint: run.proposals.filter((p) => p.resolvedAt > since).map(({ id: i, path, status, resolution, resolvedBy }) => ({ id: i, path, status, comment: resolution ?? '', resolvedBy })),
      artifacts: run.artifacts.map((a) => a.path),
      hint: next ? `Continue with step ${next.id} (${next.label}). Mark it running with add_run_step before you start.` : 'Every step is complete. Set the run status to complete, or add steps.',
    };
  }

  // ------------------------------------------------------------------------------------------------ events
  async function events(by, { since, wait = 0, run, types, limit = 500, peek = false } = {}) {
    limit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
    const wanted = types ? new Set(String(types).split(',').filter(Boolean)) : null;
    const from = since === 'now' ? seq : since === undefined || since === '' ? (cursors[by] ?? 0) : Number(since);
    if (!Number.isFinite(from) || from < 0) refuse('since must be a number from an earlier read, or "now". Next: omit it to read what is new for you.');
    const pick = () => ring.filter((e) => e.seq > from && (!run || e.run === run) && (!wanted || wanted.has(e.type))).slice(0, limit);
    let out = pick();
    const until = Date.now() + Math.min(Math.max(Number(wait) || 0, 0), 30000);
    while (!out.length && Date.now() < until) {
      await new Promise((res) => { const t = setTimeout(done, until - Date.now()); function done() { clearTimeout(t); waiters.delete(done); res(); } waiters.add(done); });
      out = pick();
    }
    const cursor = out.length ? out.at(-1).seq : since === 'now' ? seq : Math.max(from, 0);
    if (!peek && by && since === undefined && out.length) { cursors[by] = cursor; try { writeJson(cursorFile, cursors); } catch { /* a missed cursor only repeats events */ } }
    const oldest = ring[0]?.seq ?? 0;
    return { events: out, cursor, latest: seq, ...(from + 1 < oldest ? { truncated: true, oldest } : {}) };
  }
  const replay = (since) => ring.filter((e) => e.seq > Number(since));

  // ------------------------------------------------------------------------------------------------ review queue
  function review() {
    const pending = [], open = [];
    for (const p of proposals.values()) if (p.status === 'pending') pending.push(publicProposal(p));
    for (const q of questions.values()) if (q.status === 'open') open.push({ ...q, ...colorOf(q.by) });
    pending.sort((a, b) => a.at - b.at); open.sort((a, b) => a.at - b.at);
    return { proposals: pending, questions: open, count: pending.length + open.length };
  }
  const agentList = () => [...agents.values()].map((a) => ({ ...a, ...colorOf(a.name) })).sort((a, b) => b.at - a.at);
  const all = () => [...runs.values()].sort((a, b) => b.createdAt - a.createdAt);

  return {
    dir, emit, touch, runs: all, summary, get: (id) => view(getRun(id)), startRun, step, setStatus, artifact, propose, resolve: resolve_, content, ask, answer, waitAnswer,
    checkpoint, resume, events, replay, review, agents: agentList, seq: () => seq, proposal: (id) => proposals.get(id), question: (id) => questions.get(id),
    artifactsOf: () => all().flatMap((r) => r.artifacts.map((a) => ({ run: r.id, runName: r.name, ...a }))),
    audit: ({ run, limit = 200 } = {}) => ring.filter((e) => !run || e.run === run).slice(-Math.min(limit, 2000)),
    dispose() { waiters.clear(); },
  };
}
