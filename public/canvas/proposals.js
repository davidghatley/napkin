// AGT-04 on the page: the proposals tray (bottom-right of the canvas) and the ghost before/after cells.
// Agents in propose mode send edits that are held on the server, never written. The tray lists them per agent; picking one draws the
// proposed result over every cell of its component (a layer on top; the live cells and the file stay as they are) with a Before / Split / After switch.
// Accept goes through POST /api/proposals/:id/accept (store.apply, attributed to the agent, approved by you); Reject writes nothing.
// A stale accept shows why. Whole proposal or one edit; Accept all / Reject all. Keys (tray focused): ArrowUp/Down move, Enter shows the ghost,
// A accepts, R rejects, Escape folds the tray; Alt+P from anywhere opens it and focuses the first proposal.
import { h } from './drawer.js';

const ago = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 5 ? 'now' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
const fmt = (v) => (v === null || v === undefined ? 'removed' : typeof v === 'string' ? v : JSON.stringify(v));
const JSON_POST = { method: 'POST', headers: { 'content-type': 'application/json' } };

export function initProposals(ctx) {
  const S = { list: new Map(), picked: null, pickedEdit: null, open: false, userFolded: false, mode: 'after', errors: new Map(), busy: new Set(), mod: null, token: 0, unmounts: [] };
  const stageEl = document.querySelector('#stage');
  // The tray lives in the dock under the canvas (beside the drawer), so the canvas shrinks instead of being covered: cells under review stay fully visible.
  const dockEl = document.querySelector('#dock');
  dockEl.querySelector('#proposals-tray')?.remove(); // the reserved empty slot
  const tray = h('section', { id: 'proposals-tray', role: 'region', 'aria-label': 'Proposals from agents', hidden: true, 'data-open': '0' });
  dockEl.append(tray);
  const nameOf = (id) => ctx.state.components.get(id)?.name ?? id;
  const titleOf = (p) => (p.create ? p.name : nameOf(p.component));
  const sectionOf = (id) => document.querySelector(`section.cmp[data-component="${CSS.escape(id)}"]`);
  const sorted = () => [...S.list.values()].sort((a, b) => a.by.localeCompare(b.by) || a.at - b.at);

  // ---------------------------------------------------------------------------------------------- data
  async function load() {
    const r = await fetch('/api/proposals').then((x) => x.json()).catch(() => null);
    if (!Array.isArray(r)) return;
    S.list = new Map(r.map((p) => [p.id, p]));
    for (const p of r) ctx.presence?.remember?.(p.by, p.color, p.ink);
    afterChange(true);
  }
  function upsert(p) {
    const fresh = !S.list.has(p.id);
    S.list.set(p.id, p);
    ctx.presence?.remember?.(p.by, p.color, p.ink);
    S.errors.delete(p.id);
    if (S.picked === p.id) ghost(p);
    afterChange(fresh);
  }
  function drop(id) {
    S.list.delete(id); S.errors.delete(id);
    if (S.picked === id) { S.picked = null; S.pickedEdit = null; clearGhost(); }
    afterChange(false);
  }
  function afterChange(opened) {
    if (opened && S.list.size && !S.userFolded) S.open = true;
    if (!S.list.size) { S.open = false; S.userFolded = false; }
    draw();
  }

  // ---------------------------------------------------------------------------------------------- the tray
  const tint = (p) => `--c:${p.color || 'var(--text-3)'};--ink:${p.ink || 'var(--text)'}`;
  function editRows(p) {
    const lines = p.lines ?? p.edits.map((e) => e.op);
    const many = p.edits.length > 1 && !p.adoption;
    return h('ul', { class: 'pi-edits' }, lines.map((line, i) => h('li', { 'data-edit': String(i) },
      h('span', { text: line, title: line }),
      many ? h('button', { type: 'button', class: 'ed-show', 'aria-pressed': String(S.picked === p.id && S.pickedEdit === i), title: 'Show only this edit as a ghost', 'aria-label': `Show only edit ${i + 1} as a ghost: ${line}`, text: '◐', onclick: () => pick(S.picked === p.id && S.pickedEdit === i ? null : p.id, i) }) : null,
      many ? h('button', { type: 'button', class: 'ed-accept', title: `Accept only this edit`, 'aria-label': `Accept edit ${i + 1}: ${line}`, text: '✓', onclick: () => act(p, 'accept', [i]) }) : null,
      many ? h('button', { type: 'button', class: 'ed-reject', title: `Reject only this edit`, 'aria-label': `Reject edit ${i + 1}: ${line}`, text: '✕', onclick: () => act(p, 'reject', [i]) }) : null)));
  }
  function staleBox(p) {
    const e = S.errors.get(p.id);
    if (!e) return null;
    const rows = (e.stale ?? []).map((s) => h('li', {}, h('code', { text: s.key }), ` is now ${fmt(s.value)}`, s.by ? ` (${s.by}, r${s.revision})` : '', `; the proposal wanted ${fmt(s.yours)}.`));
    return h('div', { class: 'pi-stale', role: 'alert' }, h('div', { text: e.stale ? 'Can\'t accept: this changed after the agent looked.' : `Can't accept: ${String(e.error).replace(/^stale revision: /, '')}` }), rows.length ? h('ul', { style: 'margin:4px 0 0;padding-left:16px' }, rows) : null, h('div', { text: 'Reject it, or ask the agent to propose again on the new revision.' }));
  }
  function propRow(p) {
    const busy = S.busy.has(p.id);
    return h('li', { class: 'pitem', tabindex: '0', role: 'group', 'data-id': p.id, 'data-by': p.by, 'data-component': p.component, ...(p.create && { 'data-create': p.name }), 'aria-current': String(S.picked === p.id), 'aria-label': p.create ? `Proposal from ${p.by} to create the new component ${p.name}` : `Proposal from ${p.by} on ${nameOf(p.component)}: ${p.summary}`,
      onclick: (ev) => { if (!ev.target.closest('button')) pick(p.id); } },
      h('div', { class: 'pi-main' },
        h('div', { class: 'pi-top' }, h('span', { class: 'pi-comp', text: titleOf(p) }), p.adoption ? h('span', { class: 'pi-tag', text: 'adoption' }) : null, p.create ? h('span', { class: 'pi-tag', text: 'new component' }) : null, h('time', { class: 'pi-age', text: ago(p.at) })),
        editRows(p)),
      h('div', { class: 'pi-btns' },
        h('button', { type: 'button', class: 'pb go p-accept', disabled: busy, 'aria-label': `Accept ${p.edits.length > 1 ? 'all ' + p.edits.length + ' edits of ' : ''}the proposal on ${titleOf(p)}`, text: p.edits.length > 1 ? 'Accept' : 'Accept', onclick: () => act(p, 'accept') }),
        h('button', { type: 'button', class: 'pb no p-reject', disabled: busy, 'aria-label': `Reject the proposal on ${titleOf(p)}`, text: 'Reject', onclick: () => act(p, 'reject') }),
        h('button', { type: 'button', class: 'pb p-show', 'aria-pressed': String(S.picked === p.id), text: S.picked === p.id ? 'Hide ghost' : 'Show ghost', onclick: () => pick(S.picked === p.id && S.pickedEdit === null ? null : p.id) })),
      staleBox(p));
  }
  function draw() {
    const keep = document.activeElement?.closest?.('#proposals-tray') ? { id: document.activeElement.closest('.pitem')?.dataset.id, cls: [...document.activeElement.classList].find((c) => /^(p-|ed-|pt-)/.test(c)), edit: document.activeElement.closest('li[data-edit]')?.dataset.edit } : null;
    const all = sorted();
    tray.hidden = !all.length;
    dockEl.hidden = !all.length && !ctx.drawer?.active;
    if (all.length) dockEl.hidden = false;
    requestAnimationFrame(() => ctx.stage?.refreshOverlays?.());
    tray.dataset.open = S.open ? '1' : '0'; tray.dataset.count = String(all.length);
    if (!all.length) { tray.replaceChildren(); return; }
    const agents = [...new Set(all.map((p) => p.by))];
    const groups = agents.map((a) => {
      const mine = all.filter((p) => p.by === a);
      return [h('div', { class: 'pt-group', style: tint(mine[0]) }, h('i'), h('span', { text: `${a} · ${mine.length}` })), h('ol', { 'aria-label': `Proposals from ${a}` }, mine.map(propRow))];
    }).flat();
    const picked = S.picked && S.list.get(S.picked);
    tray.replaceChildren(...[
      h('div', { class: 'pt-head' },
        h('button', { type: 'button', class: 'pt-toggle', id: 'pt-toggle', 'aria-expanded': String(S.open), 'aria-controls': 'pt-body', title: 'Show or fold the proposals (Alt+P)', onclick: () => { S.open = !S.open; S.userFolded = !S.open; draw(); } },
          h('span', { class: 'pt-n', text: String(all.length) }), h('span', { class: 'pt-title', text: `${all.length === 1 ? 'proposal' : 'proposals'} · ${agents.join(', ')}` }), h('span', { class: 'pt-caret', 'aria-hidden': 'true', text: '▴' })),
        S.open ? h('button', { type: 'button', class: 'pb go', id: 'pt-accept-all', text: 'Accept all', onclick: () => all_('accept') }) : null,
        S.open ? h('button', { type: 'button', class: 'pb no', id: 'pt-reject-all', text: 'Reject all', onclick: () => all_('reject') }) : null),
      S.open && picked ? h('div', { class: 'pt-compare' }, h('span', { text: 'Ghost on canvas' }),
        h('span', { class: 'seg', role: 'group', 'aria-label': 'Compare' }, ['before', 'split', 'after'].map((m) => h('button', { type: 'button', id: `pt-mode-${m}`, 'aria-pressed': String(S.mode === m), text: m[0].toUpperCase() + m.slice(1), onclick: () => { S.mode = m; paintGhost(); draw(); } })))) : null,
      h('div', { class: 'pt-body', id: 'pt-body' }, ...groups)].filter(Boolean));
    if (keep?.id) {
      const row = tray.querySelector(`.pitem[data-id="${CSS.escape(keep.id)}"]`);
      const target = row && (keep.edit != null ? row.querySelector(`li[data-edit="${keep.edit}"] .${keep.cls}`) : keep.cls && row.querySelector('.' + keep.cls)) || row;
      (target || tray.querySelector('.pitem') || tray.querySelector('#pt-toggle'))?.focus({ preventScroll: true });
    } else if (keep) tray.querySelector('#pt-toggle')?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------------------------- accept and reject
  async function act(p, verb, only) {
    if (S.busy.has(p.id)) return null;
    S.busy.add(p.id);
    let j;
    try {
      const r = await ctx.fetch(`/api/proposals/${encodeURIComponent(p.id)}/${verb}`, { ...JSON_POST, body: JSON.stringify(only ? { only } : {}) });
      j = await r.json().catch(() => ({ ok: false, error: `${verb} failed (${r.status})` }));
    } catch (e) { j = { ok: false, error: String(e.message || e) }; }
    S.busy.delete(p.id);
    draw(); // the buttons were drawn disabled while the request was out
    if (j.ok) {
      S.errors.delete(p.id);
      if (j.remaining === undefined) drop(p.id); // the SSE frame says the same; this keeps the tray quick
      const part = only ? `edit ${only.map((i) => i + 1).join(', ')}` : 'proposal';
      ctx.hint(verb === 'accept' ? `Accepted ${part} from ${p.by}${j.revision ? ` as r${j.revision}` : ''}` : `Rejected ${part} from ${p.by}; nothing was written`);
    } else {
      S.errors.set(p.id, j); draw();
      if (!j.stale?.length) ctx.hint(`Can't ${verb}: ${String(j.error).replace(/^stale revision: /, 'stale: ')}`); // a stale reason is already in the tray
    }
    return j;
  }
  async function all_(verb) {
    const list = sorted(); let ok = 0, bad = 0;
    for (const p of list) { const j = await act(p, verb); if (j?.ok) ok++; else bad++; }
    ctx.hint(`${verb === 'accept' ? 'Accepted' : 'Rejected'} ${ok} of ${list.length}${bad ? `; ${bad} could not be ${verb === 'accept' ? 'accepted (stale)' : 'rejected'}` : ''}`);
  }

  // ---------------------------------------------------------------------------------------------- ghost cells
  function clearGhost() {
    S.token++;
    for (const u of S.unmounts) try { u(); } catch {}
    S.unmounts = []; S.mod = null;
    for (const e of document.querySelectorAll('.ghost-layer, .ghost-flag, .ghost-divider, .ghost-new')) e.remove();
    for (const e of document.querySelectorAll('.cell[data-ghost]')) { delete e.dataset.ghost; e.style.removeProperty('--c'); }
    for (const e of document.querySelectorAll('section.cmp[data-ghost]')) delete e.dataset.ghost;
    ctx.emit('ghost', { proposal: null });
  }
  function paintGhost() {
    const p = S.picked && S.list.get(S.picked);
    if (!p || !S.mod) return;
    for (const u of S.unmounts) try { u(); } catch {}
    S.unmounts = [];
    for (const e of document.querySelectorAll('.ghost-layer, .ghost-flag, .ghost-divider, .ghost-new')) e.remove();
    if (p.create) return paintNew(p);
    const sec = sectionOf(p.component);
    if (!sec) return;
    sec.dataset.ghost = p.id;
    const split = S.mode === 'split' ? '50%' : '0%';
    for (const cell of sec.querySelectorAll('.cell')) {
      cell.dataset.ghost = p.id; cell.style.setProperty('--c', p.color || 'var(--accent)');
      const inner = h('div', { class: 'preview-inner' });
      cell.append(h('div', { class: 'ghost-layer', 'data-mode': S.mode, 'aria-hidden': 'true', style: `--c:${p.color || 'var(--accent)'};--split:${split}` }, inner));
      if (S.mode === 'split') cell.append(h('div', { class: 'ghost-divider', style: `--c:${p.color || 'var(--accent)'};--split:${split}`, 'aria-hidden': 'true' }));
      let variant = {}; try { variant = JSON.parse(cell.dataset.variant); } catch {}
      try { S.unmounts.push(S.mod.mount(inner, variant)); } catch (e) { inner.textContent = `could not draw: ${e.message}`; }
    }
    sec.querySelector('.frame')?.append(h('div', { class: 'ghost-flag', role: 'status', style: `--c:${p.color || 'var(--accent)'};--ink:${p.ink || 'var(--on-accent)'}`, text: `${p.by}'s proposal${S.pickedEdit === null ? '' : ` · edit ${S.pickedEdit + 1} of ${p.edits.length}`} · ${S.mode === 'before' ? 'before (live)' : S.mode === 'split' ? 'before | after' : 'after'} · not written` }));
    ctx.emit('ghost', { proposal: p.id, component: p.component, mode: S.mode });
  }
  // A component that does not exist yet: a dashed ghost frame on the canvas (top-left of the stage), drawn from the would-be source. No file, no entry.
  function paintNew(p) {
    const inner = h('div', { class: 'preview-inner' });
    const c = p.color || 'var(--accent)';
    stageEl.append(h('div', { class: 'ghost-new', 'data-proposal': p.id, role: 'status', style: `--c:${c};--ink:${p.ink || 'var(--on-accent)'}` },
      h('div', { class: 'gn-flag', text: `${p.by}'s proposal · new component ${p.name} · not written` }), h('div', { class: 'gn-body' }, inner)));
    try { S.unmounts.push(S.mod.mount(inner, {})); } catch (e) { inner.textContent = `could not draw: ${e.message}`; }
    ctx.emit('ghost', { proposal: p.id, component: p.component, mode: S.mode, create: p.name });
  }
  async function ghost(p) {
    const token = ++S.token;
    const res = await fetch(`/bundle-proposal/${encodeURIComponent(p.id)}.js${S.pickedEdit === null ? '' : `?only=${S.pickedEdit}`}`);
    if (token !== S.token) return;
    if (!res.ok) { ctx.hint((await res.json().catch(() => ({}))).error || 'could not draw that proposal'); return; }
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    try { S.mod = await import(url); } finally { URL.revokeObjectURL(url); }
    if (token !== S.token || S.picked !== p.id) return;
    paintGhost();
  }
  // Show a proposal's result (or one edit of it) as a ghost, and bring its component fully into view in the space the tray left.
  function pick(id, edit = null) {
    clearGhost();
    S.picked = id; S.pickedEdit = id ? edit : null;
    draw();
    const p = id && S.list.get(id);
    if (p) { ghost(p); tray.querySelector(`.pitem[data-id="${CSS.escape(p.id)}"]`)?.scrollIntoView({ block: 'nearest' }); if (!p.create) requestAnimationFrame(() => requestAnimationFrame(() => frame(p))); }
  }
  function frame(p) {
    const r = ctx.stage.componentRect?.(p.component);
    if (r) ctx.view.flyTo(r, { pad: 70, max: Math.max(1, ctx.view.get().z) });
  }

  // ---------------------------------------------------------------------------------------------- keys
  tray.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (S.picked) pick(null); else { S.open = false; S.userFolded = true; draw(); } stageEl.focus({ preventScroll: true }); return; }
    const row = ev.target.closest?.('.pitem');
    if (!row || ev.target !== row) return; // letters only act from the row itself, never from a button inside it
    const p = S.list.get(row.dataset.id);
    const rows = [...tray.querySelectorAll('.pitem')], i = rows.indexOf(row);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); pick(S.picked === p.id ? null : p.id); }
    else if (ev.key === 'a' || ev.key === 'A') { ev.preventDefault(); const next = rows[i + 1] ?? rows[i - 1]; act(p, 'accept').then(() => (next?.isConnected ? next : tray.querySelector('.pitem') ?? stageEl).focus?.({ preventScroll: true })); }
    else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); const next = rows[i + 1] ?? rows[i - 1]; act(p, 'reject').then(() => (next?.isConnected ? next : tray.querySelector('.pitem') ?? stageEl).focus?.({ preventScroll: true })); }
  });
  // Keyboard focus (or any focus) inside a row scrolls that row into the tray's visible part, so Accept is never out of reach.
  tray.addEventListener('focusin', (ev) => ev.target.closest?.('.pitem')?.scrollIntoView({ block: 'nearest' }));
  function openTray() {
    if (!S.list.size) { ctx.hint('No proposals waiting'); return; }
    if (tray.contains(document.activeElement) && S.open) { S.open = false; S.userFolded = true; draw(); stageEl.focus({ preventScroll: true }); return; }
    S.open = true; S.userFolded = false; draw();
    (tray.querySelector('.pitem') ?? tray.querySelector('#pt-toggle'))?.focus();
  }
  addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyP' || !ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.isComposing) return;
    ev.preventDefault();
    openTray();
  });

  // ---------------------------------------------------------------------------------------------- events
  ctx.on('proposal', (f) => upsert(f.proposal));
  ctx.on('proposal-resolved', (f) => drop(f.id));
  ctx.on('render', ({ component }) => { const p = S.picked && S.list.get(S.picked); if (p && p.component === component && S.mod) paintGhost(); });
  ctx.on('removed', ({ component }) => { for (const p of [...S.list.values()]) if (p.component === component) drop(p.id); });
  setInterval(() => { for (const t of tray.querySelectorAll('time.pi-age')) { const p = S.list.get(t.closest('.pitem')?.dataset.id); if (p) t.textContent = ago(p.at); } }, 15000);
  ctx.proposals = { openTray, frame, list: () => sorted(), pick, accept: (id, only) => act(S.list.get(id), 'accept', only), reject: (id, only) => act(S.list.get(id), 'reject', only), state: S, reload: load };
  load();
}
