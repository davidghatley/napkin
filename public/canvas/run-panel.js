// Runs and the review queue on the canvas (D5). One panel, bottom-left of the canvas:
//   - agents that are here and what each is doing now,
//   - "Waiting for you": proposals to approve, reject, comment on or send back; questions to answer,
//   - runs: plan with live step status, and the files each run has made (click one to select its card).
// Data: GET /api/runs, /api/review, /api/agents, then the run-* frames of /api/events (main.js hands them over as 'run-frame').
// Keys: Alt+R opens the panel and focuses the first waiting card; in the queue ArrowDown/ArrowUp or j/k move, a approves,
// x rejects, s sends back, c comments (types into the card's note field; Enter posts it), 1 to 9 pick a question's option,
// Enter in the answer field answers, Escape returns to the canvas. The note field's text goes with a, x or s.
// Also reports the person's selection and viewport to POST /api/board so agents can read what they see.
import { h } from './drawer.js';
import { plain } from './words.js';
import { initRunGroups } from './run-groups.js';
import { diffLines, hunks, changeCount, openDiff } from './run-diff.js';

const JSON_POST = { method: 'POST', headers: { 'content-type': 'application/json' } };
const ago = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 5 ? 'now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const MARK = { pending: '', running: '●', complete: '✓', failed: '✕', skipped: '–', blocked: '!' };
const LABEL = { pending: 'pending', running: 'running', complete: 'done', failed: 'failed', skipped: 'skipped', blocked: 'blocked' };

export function initRuns(ctx) {
  const link = h('link', { rel: 'stylesheet', href: '/canvas/run-panel.css' });
  document.head.append(link);
  const S = { runs: new Map(), review: { proposals: [], questions: [] }, agents: new Map(), open: true, userFolded: false, errors: new Map(), busy: new Set(), runToggle: new Map(), focus: null, announce: '', diffs: new Map() };
  try { S.userFolded = localStorage.getItem('napkin.runs.folded') === '1'; } catch { /* storage may be blocked */ }

  const root = h('section', { id: 'runs-panel', role: 'region', 'aria-label': 'Runs and review', hidden: true, 'data-open': '1' });
  const head = h('div', { class: 'rp-head' });
  const body = h('div', { class: 'rp-body' });
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  root.append(head, body, live);
  document.body.append(root);

  // ------------------------------------------------------------------------------------------------ data
  const get = (path) => fetch(path).then((r) => r.json()).catch(() => null);
  async function loadRun(id) {
    const r = await get(`/api/runs/${encodeURIComponent(id)}`);
    if (r && r.id) { S.runs.set(id, r); schedule(); }
  }
  async function loadAll() {
    const [runs, review, agents] = await Promise.all([get('/api/runs'), get('/api/review'), get('/api/agents')]);
    if (runs?.runs) await Promise.all(runs.runs.slice(0, 12).map((r) => loadRun(r.id)));
    if (review?.proposals) S.review = review;
    for (const a of agents?.agents ?? []) S.agents.set(a.name, a);
    schedule();
  }
  async function loadReview() {
    const r = await get('/api/review');
    if (!r?.proposals) return;
    // draw the cards together with the runs they belong to, so a question never shows without its run
    const missing = [...new Set([...r.proposals, ...r.questions].map((x) => x.run).filter((id) => id && !S.runs.has(id)))];
    await Promise.all(missing.map(loadRun));
    S.review = r; schedule();
    for (const p of r.proposals) if (p.texty && p.kind !== 'control' && !S.diffs.has(p.id) && (p.bytes ?? 0) <= 2_000_000) prefetchDiff(p);
  }
  // The whole proposed text and the file it would replace, so the card shows what changed and D opens everything.
  async function prefetchDiff(p) {
    S.diffs.set(p.id, 'loading');
    try {
      const next = await fetch(`/api/review/${encodeURIComponent(p.id)}/content`).then((x) => x.text());
      let old = '';
      if (p.baseSha) { const r = await get(`/api/read?item=${encodeURIComponent(p.path)}&length=4194304`); old = r?.encoding === 'utf8' ? r.content : null; }
      S.diffs.set(p.id, { old, next, lines: old == null ? null : diffLines(old, next) });
    } catch { S.diffs.set(p.id, null); }
    schedule(true);
  }
  const pending = new Map();
  const later = (key, fn, ms = 60) => { clearTimeout(pending.get(key)); pending.set(key, setTimeout(fn, ms)); };

  ctx.on('run-frame', (f) => {
    if (f.type === 'run-activity') { S.agents.set(f.agent, { name: f.agent, color: f.color, ink: f.ink, run: f.run, label: f.label, at: f.at }); schedule(); return; }
    if (f.type === 'run-heartbeat' || f.type === 'board') return;
    if (f.run) later(`run:${f.run}`, () => loadRun(f.run));
    if (/^run-(proposal|question)/.test(f.type)) later('review', loadReview, 30);
    if (f.type === 'run-proposal' || f.type === 'run-question') {
      S.announce = f.type === 'run-question' ? `${f.by} asked you a question` : `${f.by} proposed a change`;
      S.userFolded = false; // something new needs you: show the panel
    }
  });
  ctx.on('connection', (f) => { if (f.connected) loadAll(); });
  ctx.on('agents', () => schedule());
  ctx.on('items-changed', () => later('tag', tagCards, 200));

  // ------------------------------------------------------------------------------------------------ the person's side
  async function post(path, body) {
    const r = await ctx.fetch(path, { ...JSON_POST, body: JSON.stringify(body) });
    return r.json().catch(() => ({ ok: false, error: `The server answered ${r.status}` }));
  }
  async function resolve(p, outcome) {
    if (S.busy.has(p.id)) return;
    const note = cardNote(p.id);
    if (outcome === 'comment' && !note) { focusNote(p.id); return; }
    S.busy.add(p.id); S.errors.delete(p.id);
    const r = await post(`/api/review/${encodeURIComponent(p.id)}`, { outcome, comment: note || undefined });
    S.busy.delete(p.id);
    if (!r.ok) S.errors.set(p.id, plain(r.error));
    else { S.announce = `${outcome === 'accepted' ? 'Approved' : outcome === 'rejected' ? 'Rejected' : outcome === 'sent-back' ? 'Sent back' : 'Commented on'} ${p.path ?? p.label}`; if (outcome === 'comment') drafts.delete(p.id); else drafts.delete(p.id); }
    const at = cards().findIndex((c) => c.dataset.proposalId === p.id);
    await loadReview(); if (p.run) await loadRun(p.run);
    schedule(true);
    if (r.ok) afterDecision(at);
  }
  // A decision (also one made inside the full diff) lands the person on the next waiting card; with none left, back on the canvas.
  function afterDecision(at) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && a !== document.body && root.contains(a) && a.closest?.('.rp-card')) return; // still on a card
      const list = cards(), next = list[Math.min(Math.max(at, 0), list.length - 1)];
      if (next) next.focus({ preventScroll: true }); else document.querySelector('#stage')?.focus();
    }));
  }
  async function answer(q, value) {
    if (S.busy.has(q.id)) return;
    value = String(value ?? '').trim();
    if (!value) return;
    S.busy.add(q.id); S.errors.delete(q.id);
    const r = await post(`/api/questions/${encodeURIComponent(q.id)}/answer`, { answer: value });
    S.busy.delete(q.id);
    if (!r.ok) S.errors.set(q.id, plain(r.error)); else { S.announce = 'Answered'; drafts.delete(q.id); }
    const at = cards().findIndex((c) => c.dataset.questionId === q.id);
    await loadReview(); if (q.run) await loadRun(q.run);
    schedule(true);
    if (r.ok) afterDecision(at);
  }

  // ------------------------------------------------------------------------------------------------ drawing
  const drafts = new Map(); // text typed into a card's note field survives a redraw
  const cardNote = (id) => (root.querySelector(`[data-note-for="${CSS.escape(id)}"]`)?.value ?? drafts.get(id) ?? '').trim();
  const focusNote = (id) => root.querySelector(`[data-note-for="${CSS.escape(id)}"]`)?.focus();
  const tint = (el, who) => { if (who?.color) { el.style.setProperty('--rp-c', who.color); el.style.setProperty('--rp-ink', who.ink || '#fff'); } return el; };
  const chip = (name, extra = '') => tint(h('span', { class: 'rp-who' }, h('i'), name, extra && h('small', { text: extra })), S.agents.get(name));

  function proposalCard(p) {
    const media = p.kind === 'control'
      ? h('p', { class: 'rp-change' }, h('b', { text: p.label ?? p.control }), ' ', h('span', { class: 'rp-from', text: show(p.before) }), ' → ', h('span', { class: 'rp-to', text: show(p.value) }))
      : p.image ? h('img', { class: 'rp-img', src: `/api/review/${encodeURIComponent(p.id)}/content`, alt: `Proposed ${p.path}`, loading: 'lazy' })
      : p.texty && p.preview != null ? textMedia(p)
      : h('p', { class: 'rp-meta', text: `${p.bytes} bytes` });
    const card = h('li', { class: 'rp-card', 'data-proposal-id': p.id, 'data-kind': p.kind, tabindex: '0', 'aria-label': `Proposal: ${p.path}, from ${p.by}` },
      h('div', { class: 'rp-line' }, chip(p.by), h('span', { class: 'rp-when', text: [S.runs.get(p.run)?.name, ago(p.at)].filter(Boolean).join(' · ') })),
      h('p', { class: 'rp-path' }, h('span', { class: 'rp-verb', text: p.kind === 'control' ? 'change' : p.baseSha ? 'replace' : 'add' }), ' ', h('code', { text: p.path })),
      p.note && h('p', { class: 'rp-note', text: p.note }),
      media,
      ...(p.comments ?? []).map((c) => h('p', { class: 'rp-said' }, h('b', { text: c.by }), ' ', c.text)),
      noteField(p.id),
      h('div', { class: 'rp-actions', role: 'group', 'aria-label': 'Review' },
        btn('Approve', 'A', () => resolve(p, 'accepted'), 'primary'), btn('Reject', 'X', () => resolve(p, 'rejected')),
        btn('Send back', 'S', () => resolve(p, 'sent-back')), btn('Comment', 'C', () => resolve(p, 'comment')), p.kind !== 'control' && btn('Full diff', 'D', () => showDiff(p))),
      S.errors.has(p.id) && h('p', { class: 'rp-err', role: 'alert', text: S.errors.get(p.id) }));
    return tint(card, S.agents.get(p.by) ?? p);
  }
  // A text proposal shows what changes (changed lines with a little context) once the whole text is here, never just the opening lines.
  function textMedia(p) {
    const d = S.diffs.get(p.id);
    if (!d || d === 'loading' || !d.lines) return h('pre', { class: 'rp-pre', text: p.preview.split('\n').slice(0, 7).join('\n') + (p.bytes > 1600 ? '\n…' : '') });
    const n = changeCount(d.lines);
    if (!p.baseSha) return h('div', {}, h('pre', { class: 'rp-pre', text: d.next.split('\n').slice(0, 7).join('\n') }), diffBar(p, `New file, ${d.lines.length} lines`));
    if (!n) return diffBar(p, 'No text changes');
    const rows = []; let prev = -1;
    for (const r of hunks(d.lines, 1)) {
      if (r.from - prev > 1) rows.push(h('span', { text: `… ${r.from - prev - 1} unchanged lines` }));
      for (let i = r.from; i <= r.to; i++) { const l = d.lines[i]; rows.push(h('span', { class: l.t === '+' ? 'add' : l.t === '-' ? 'del' : '', text: `${l.t === ' ' ? ' ' : l.t} ${l.text}` })); }
      prev = r.to;
    }
    const pre = h('pre', { class: 'rp-pre', 'data-diff': '1', tabindex: '-1' }); pre.append(...rows);
    return h('div', {}, pre, diffBar(p, `${d.lines.filter((l) => l.t === '+').length} added, ${d.lines.filter((l) => l.t === '-').length} removed`));
  }
  const diffBar = (p, text) => h('p', { class: 'rp-diffbar' }, h('span', { text }), btn('Full diff', 'D', () => showDiff(p)));
  let closeDiff = null;
  function showDiff(p) {
    const d = S.diffs.get(p.id);
    if (p.kind !== 'control' && !p.image && !(d && d !== 'loading')) { prefetchDiff(p).then(() => showDiff(p)); return; }
    closeDiff?.();
    closeDiff = openDiff({ proposal: p, old: p.baseSha ? d?.old : null, next: d?.next, image: p.image ? `/api/review/${encodeURIComponent(p.id)}/content` : null,
      actions: [{ text: 'Approve', key: 'A', kind: 'primary', run: () => resolve(p, 'accepted') }, { text: 'Reject', key: 'X', run: () => resolve(p, 'rejected') }, { text: 'Send back', key: 'S', run: () => resolve(p, 'sent-back') }],
      onClose: () => { closeDiff = null; } });
  }
  const show = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
  function noteField(id) {
    return h('input', { type: 'text', class: 'rp-input', 'data-note-for': id, 'aria-label': 'Note for the agent', placeholder: 'Note for the agent (C)', value: drafts.get(id) ?? '', maxlength: '1200', oninput: (e) => drafts.set(id, e.target.value) });
  }
  const btn = (text, key, fn, kind) => h('button', { type: 'button', class: `rp-btn${kind ? ' ' + kind : ''}`, onclick: (e) => { e.stopPropagation(); fn(); }, 'aria-keyshortcuts': key }, text, h('kbd', { text: key }));
  function questionCard(q) {
    const field = h('input', { type: 'text', class: 'rp-input', 'data-note-for': q.id, 'aria-label': 'Your answer', placeholder: q.options?.length ? 'Or type an answer (C)' : 'Type an answer (C)', value: drafts.get(q.id) ?? '', maxlength: '4000',
      oninput: (e) => drafts.set(q.id, e.target.value), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(q, e.target.value); } else if (e.key === 'Escape') { e.stopPropagation(); e.target.closest('.rp-card').focus(); } } });
    const card = h('li', { class: 'rp-card', 'data-question-id': q.id, tabindex: '0', 'aria-label': `Question from ${q.by}: ${q.text}` },
      h('div', { class: 'rp-line' }, chip(q.by), h('span', { class: 'rp-when', text: [S.runs.get(q.run)?.name, ago(q.at)].filter(Boolean).join(' · ') })),
      h('p', { class: 'rp-q', text: q.text }),
      q.options?.length ? h('div', { class: 'rp-opts', role: 'group', 'aria-label': 'Options' }, q.options.slice(0, 9).map((o, i) => btn(o, String(i + 1), () => answer(q, o), i === 0 ? 'primary' : ''))) : null,
      field,
      h('div', { class: 'rp-actions' }, btn('Answer', 'Enter', () => answer(q, field.value))),
      S.errors.has(q.id) && h('p', { class: 'rp-err', role: 'alert', text: S.errors.get(q.id) }));
    return tint(card, S.agents.get(q.by) ?? q);
  }

  function runBlock(r) {
    const total = r.steps.length, done = r.steps.filter((s) => s.status === 'complete').length;
    const cur = r.steps.find((s) => s.status === 'running') ?? r.steps.find((s) => s.status !== 'complete' && s.status !== 'skipped');
    const newest = [...S.runs.values()].sort((a, b) => b.createdAt - a.createdAt)[0]?.id;
    const open = S.runToggle.get(r.id) ?? r.id === newest;
    const el = h('article', { class: 'rp-run', 'data-run-id': r.id, 'data-status': r.status });
    const toggle = h('button', { type: 'button', class: 'rp-run-head', 'aria-expanded': String(open), onclick: () => { S.runToggle.set(r.id, !open); schedule(); } },
      h('span', { class: 'rp-run-name', text: r.name }), h('span', { class: 'rp-run-status', text: r.status === 'running' ? (cur ? cur.label : 'running') : r.status }),
      total ? h('span', { class: 'rp-count', text: `${done} / ${total}` }) : null);
    const bar = total ? h('div', { class: 'rp-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done), 'aria-label': `${r.name}: ${done} of ${total} steps` }, h('i', { style: `width:${(done / total) * 100}%` })) : null;
    el.append(h('div', { class: 'rp-run-top' }, toggle, h('span', { class: 'rp-by' }, chip(r.by))));
    if (bar) el.append(bar);
    if (open) {
      if (total) el.append(h('ol', { class: 'rp-steps' }, r.steps.map((s) => h('li', { 'data-status': s.status, 'data-step-id': s.id }, h('span', { class: 'rp-mark', 'aria-hidden': 'true', text: MARK[s.status] }), h('span', { class: 'rp-step-label', text: s.label }), h('span', { class: 'rp-sr', text: ` ${LABEL[s.status]}` }), s.note && h('small', { text: s.note })))));
      if (r.artifacts.length) el.append(h('p', { class: 'rp-meta', text: `${new Set(r.artifacts.map((a) => a.path)).size} files` }), h('ul', { class: 'rp-arts', 'aria-label': `Files from ${r.name}` }, [...new Map(r.artifacts.map((a) => [a.path, a])).values()].map((a) => h('li', {}, h('button', { type: 'button', class: 'rp-art', 'data-path': a.path, title: `${a.path}\n${a.kind}, ${a.bytes} bytes`, onclick: () => pick(a.path) }, h('span', { class: 'rp-kind', text: a.kind }), a.path.includes('/') && h('small', { text: a.path.slice(0, a.path.lastIndexOf('/') + 1) }), a.path.split('/').pop())))));
      const answered = r.questions.filter((q) => q.status === 'answered').slice(-3), resolved = r.proposals.filter((p) => p.status !== 'pending').slice(-3);
      if (answered.length || resolved.length) el.append(h('ul', { class: 'rp-log', 'aria-label': 'Answers' }, [...resolved.map((p) => h('li', {}, h('b', { text: p.status }), ` ${p.path}`, p.resolution && h('i', { text: ` “${p.resolution}”` }))), ...answered.map((q) => h('li', {}, h('b', { text: 'answered' }), ' ', h('i', { text: `“${Array.isArray(q.answer) ? q.answer.join(', ') : q.answer}”` })))]));
    }
    return el;
  }
  // One line that says where the newest unfinished run is, so the drawer can stay folded and the person still knows.
  function summaryOf(runs) {
    const r = runs.find((x) => x.status === 'running') ?? runs[0];
    if (!r) return null;
    const total = r.steps.length, done = r.steps.filter((s) => s.status === 'complete').length;
    const cur = r.steps.find((s) => s.status === 'running') ?? r.steps.find((s) => s.status === 'pending');
    return h('span', { class: 'rp-sum', 'data-run-id': r.id }, h('b', { text: r.name }), total ? ` ${done} / ${total}` : '', r.status !== 'running' ? ` · ${r.status}` : cur ? ` · ${cur.label}` : '');
  }
  function pick(path) {
    if (!ctx.state.components.get(path)) { ctx.hint?.(`${path} is not on the canvas yet`); return; }
    ctx.select({ component: path, node: 'item', variant: {} });
    ctx.nav?.focus?.(path);
  }

  let raf = 0, keepFocus = false, clearLive = 0;
  function schedule(restoreFocus) { if (restoreFocus) keepFocus = true; if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function draw() {
    const runs = [...S.runs.values()].sort((a, b) => b.createdAt - a.createdAt);
    const props = S.review.proposals, qs = S.review.questions;
    const waiting = props.length + qs.length;
    const here = [...S.agents.values()].filter((a) => Date.now() - a.at < 90000).sort((a, b) => b.at - a.at);
    const anything = runs.length || waiting || here.length;
    root.hidden = !anything; if (!anything) sizeDock();
    if (!anything) return;
    const open = !S.userFolded;
    root.dataset.open = open ? '1' : '0';
    root.dataset.waiting = waiting ? '1' : '0';
    root.dataset.dock = runs.length || waiting ? '1' : '0';
    const active = document.activeElement, cardOf = active && root.contains(active) ? active.closest('[data-proposal-id],[data-question-id]') : null, focusedId = cardOf ? (cardOf.dataset.proposalId ?? cardOf.dataset.questionId) : null;
    const typing = active?.matches?.('input') && root.contains(active) ? { id: active.dataset.noteFor, at: active.selectionStart } : null;
    head.replaceChildren(
      h('button', { type: 'button', class: 'rp-toggle', 'aria-expanded': String(open), 'aria-controls': 'rp-body', title: 'Runs and review (Alt+R)', 'aria-keyshortcuts': 'Alt+R', onclick: () => fold() },
        h('span', { class: 'rp-title', text: 'Runs' }),
        waiting ? h('span', { class: 'rp-badge', text: `${waiting} waiting for you` }) : h('span', { class: 'rp-quiet', text: runs.length ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : 'agents here' })),
      summaryOf(runs),
      h('span', { class: 'rp-agents', 'aria-label': 'Agents here' }, here.slice(0, 5).map((a) => tint(h('span', { class: 'rp-who live', title: `${a.name}: ${a.label ?? ''}` }, h('i'), a.name, a.label && h('small', { text: a.label })), a))));
    body.id = 'rp-body'; body.hidden = !open;
    const nodes = [];
    if (waiting) nodes.push(h('section', { class: 'rp-queue', 'aria-label': 'Waiting for you' }, h('h3', { text: 'Waiting for you' }), h('ul', { class: 'rp-cards' }, [...qs.map(questionCard), ...props.map(proposalCard)])));
    if (runs.length) nodes.push(h('section', { class: 'rp-runs', 'aria-label': 'Runs' }, runs.slice(0, 8).map(runBlock)));
    else if (!waiting) nodes.push(h('p', { class: 'rp-empty', text: 'Agents are connected. Runs they start show up here.' }));
    body.replaceChildren(...nodes);
    sizeDock();
    if (S.announce) { live.textContent = S.announce; S.announce = ''; clearTimeout(clearLive); clearLive = setTimeout(() => { live.textContent = ''; }, 3000); }
    if (keepFocus || typing || focusedId) {
      keepFocus = false;
      const sel = typing ? `[data-note-for="${CSS.escape(typing.id)}"]` : focusedId ? `[data-proposal-id="${CSS.escape(focusedId)}"],[data-question-id="${CSS.escape(focusedId)}"]` : null;
      const el = (sel && root.querySelector(sel)) ?? (focusedId ? root.querySelector('.rp-card') : null);
      el?.focus({ preventScroll: true }); if (typing && el?.setSelectionRange) try { el.setSelectionRange(typing.at, typing.at); } catch { /* not a text field */ }
    }
    tagCards();
    for (const ol of root.querySelectorAll('.rp-steps')) { const cur = ol.querySelector('[data-status="running"]') ?? ol.querySelector('li:not([data-status="complete"])'); if (cur) ol.scrollTop = Math.max(0, cur.offsetTop - ol.offsetTop - ol.clientHeight / 2); }
  }
  // The stage gives the drawer its room (CSS: margin-bottom: var(--nk-rp-h)).
  const sizeDock = () => requestAnimationFrame(() => { const st = document.querySelector('#stage'); if (st) st.style.marginBottom = !root.hidden && root.dataset.dock === '1' ? `${root.offsetHeight}px` : ''; });
  const fold = () => { S.userFolded = !S.userFolded; try { localStorage.setItem('napkin.runs.folded', S.userFolded ? '1' : '0'); } catch { /* blocked */ } schedule(); };

  // Cards made by a run say so: data-run and the agent's colour (the canvas draws the accent from these).
  function tagCards() {
    const mine = new Map();
    for (const r of S.runs.values()) for (const a of r.artifacts) mine.set(a.path, { r, a });
    for (const el of document.querySelectorAll('[data-item-id][data-run]')) if (!mine.has(el.dataset.itemId)) { delete el.dataset.run; el.style.removeProperty('--nk-run-c'); }
    for (const [path, { r, a }] of mine) {
      const el = document.querySelector(`[data-item-id="${CSS.escape(path)}"]`);
      if (!el || el.dataset.run === r.id) continue;
      el.dataset.run = r.id; el.dataset.runName = r.name;
      const who = S.agents.get(a.by); if (who?.color) el.style.setProperty('--nk-run-c', who.color);
    }
  }

  // ------------------------------------------------------------------------------------------------ keys
  const typingIn = (t) => t?.matches?.('input,textarea,select,[contenteditable="true"]');
  const cards = () => [...root.querySelectorAll('.rp-card')];
  function openAndFocus() {
    S.userFolded = false; try { localStorage.setItem('napkin.runs.folded', '0'); } catch { /* blocked */ }
    root.hidden = false; draw();
    (cards()[0] ?? head.querySelector('button'))?.focus();
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === 'KeyR') { ev.preventDefault(); openAndFocus(); return; }
    if (!root.contains(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    const card = ev.target.closest?.('.rp-card');
    if (ev.key === 'Escape') { ev.preventDefault(); if (typingIn(ev.target) && card) { card.focus(); return; } document.querySelector('#stage')?.focus(); return; }
    if (typingIn(ev.target)) return;
    const list = cards(), i = list.indexOf(card);
    if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); (list[i + 1] ?? list[0])?.focus(); return; }
    if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); (list[i - 1] ?? list.at(-1))?.focus(); return; }
    if (!card || ev.target !== card) return;
    const id = card.dataset.proposalId, qid = card.dataset.questionId;
    const key = ev.key.toLowerCase();
    if (id) {
      const p = S.review.proposals.find((x) => x.id === id); if (!p) return;
      if (key === 'a') { ev.preventDefault(); resolve(p, 'accepted'); } else if (key === 'x' || key === 'r') { ev.preventDefault(); resolve(p, 'rejected'); }
      else if (key === 'd' || ev.key === 'Enter') { ev.preventDefault(); showDiff(p); }
      else if (key === 's') { ev.preventDefault(); resolve(p, 'sent-back'); } else if (key === 'c') { ev.preventDefault(); focusNote(id); }
    } else if (qid) {
      const q = S.review.questions.find((x) => x.id === qid); if (!q) return;
      if (/^[1-9]$/.test(ev.key) && q.options?.[Number(ev.key) - 1] !== undefined) { ev.preventDefault(); answer(q, q.options[Number(ev.key) - 1]); }
      else if (key === 'c' || ev.key === 'Enter') { ev.preventDefault(); focusNote(qid); }
    }
  });
  // In a proposal's note field, Enter posts the note as a comment.
  root.addEventListener('keydown', (ev) => {
    const f = ev.target.closest?.('input[data-note-for]'); const card = ev.target.closest?.('[data-proposal-id]');
    if (!f || !card || ev.key !== 'Enter') return;
    ev.preventDefault(); const p = S.review.proposals.find((x) => x.id === card.dataset.proposalId); if (p) resolve(p, 'comment');
  });

  // Commands for the palette and the key map (the surface registry, when it exists; otherwise queued for it to pick up).
  const cmd = (id, title, keys, run) => ({ id, title, keys, group: 'Agents', run });
  const first = (kind) => (kind === 'p' ? S.review.proposals[0] : S.review.questions[0]);
  const current = () => { const c = document.activeElement?.closest?.('.rp-card'); return c?.dataset.proposalId ? S.review.proposals.find((x) => x.id === c.dataset.proposalId) : first('p'); };
  const commands = [
    cmd('runs.open', 'Open runs', 'Alt+R', openAndFocus),
    cmd('review.approve', 'Approve', 'A (in the review queue)', () => { const p = current(); if (p) resolve(p, 'accepted'); }),
    cmd('review.reject', 'Reject', 'X (in the review queue)', () => { const p = current(); if (p) resolve(p, 'rejected'); }),
    cmd('review.sendback', 'Send back', 'S (in the review queue)', () => { const p = current(); if (p) resolve(p, 'sent-back'); }),
    cmd('review.comment', 'Comment', 'C (in the review queue)', () => { openAndFocus(); const p = current(); if (p) focusNote(p.id); }),
    cmd('review.next', 'Next review', 'J (in the review queue)', () => { openAndFocus(); }),
  ];
  const register = () => { if (typeof ctx.registerCommands === 'function') ctx.registerCommands(commands); else (window.napkinCommandQueue ||= []).push(...commands); };
  register();
  ctx.runs = { open: openAndFocus, state: S, commands };

  // ------------------------------------------------------------------------------------------------ what the person sees
  let sel = 0, vw = 0;
  ctx.on('select', () => { clearTimeout(sel); sel = setTimeout(() => post('/api/board', { selection: ctx.state.selections.map((s) => s.component) }).catch(() => {}), 120); });
  ctx.on('view', (v) => { clearTimeout(vw); vw = setTimeout(() => { if (v && [v.x, v.y, v.z].every(Number.isFinite)) post('/api/board', { view: { x: v.x, y: v.y, z: v.z } }).catch(() => {}); }, 400); });
  // Ages in the cards tick quietly.
  setInterval(() => { if (!root.hidden && !root.contains(document.activeElement)) schedule(); }, 15000);
  loadAll();
  initRunGroups(ctx);
}
