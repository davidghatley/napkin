// The instrument panel of the canvas: whatever is selected (a file of any kind, an HTML or TSX component, several cards)
// gets one panel drawn by the dials library (public/dials), from the server's schema (GET /api/controls/<id>).
// Every commit goes through the item edit path (POST /api/control with the revision it was made on; undo is POST /api/undo),
// so the file bytes are the truth and undo restores them exactly. Several cards selected: the controls they share
// (same id and type) are shown once and a change goes to each of them.
//
//   ctx.instruments.show()            draw the panel for ctx.state.selections (called on every selection change)
//   ctx.instruments.controls()        [{ id, label, type, value, section }] of the panel on screen
//   ctx.instruments.focusControl(l)   focus the value of the control labelled l (opens its section first)
//   ctx.instruments.depth(l, 1|2|3)   dial / bench / studio for the control labelled l
//   ctx.instruments.reset(l)          back to its default
//   ctx.instruments.undo()            undo the newest instrument change of the selection
//
// Keys inside the panel follow the dials library, with napkin's contract for modifiers: Shift+Arrow is coarse and
// Alt+Arrow is fine. Enter on a typed value applies it and hands focus back to the control's label, where arrows step it.
import { Dials } from '/dials/dials.js';
import { plain } from './words.js';

const enc = encodeURIComponent;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const norm = (s) => String(s ?? '').trim().toLowerCase();

export function initInstruments(ctx) {
  const host = document.createElement('div');
  host.id = 'instruments';
  document.querySelector('#panel').before(host);

  const schemas = new Map(); // item id -> { revision, sections } as last read
  const originals = new Map(); // "item|control" -> the value first seen this session: what Reset goes back to
  let panel = null, shown = null, token = 0;

  // The selection as files (item ids); cardOf maps a file back to the canvas card that draws it.
  const cardOf = new Map();
  const ids = () => { const out = []; for (const s of ctx.state.selections) { if (!ctx.state.components.get(s.component)) continue; const id = ctx.itemOf(s.component); cardOf.set(id, s.component); if (!out.includes(id)) out.push(id); } return out; };
  const redraw = (id) => ctx.stage.render(cardOf.get(id) ?? id, true).catch(() => {});
  async function read(id) {
    const r = await fetch('/api/controls/' + enc(id));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'no instruments');
    // A section the person opened at a depth carries it; its controls keep the depth they were declared with.
    for (const s of j.sections || []) for (const c of s.controls) if (c.nativeDepth !== undefined) { c.depth = c.nativeDepth; delete c.nativeDepth; }
    schemas.set(id, j);
    return j;
  }
  // The controls several items share (same id and type), with the first item's value.
  function shared(list) {
    const [first, ...rest] = list;
    const sections = first.sections.map((s) => ({ ...s, controls: s.controls.filter((c) => rest.every((o) => o.sections.some((t) => t.controls.some((d) => d.id === c.id && d.type === c.type)))) })).filter((s) => s.controls.length);
    return { revision: first.revision, sections };
  }
  function prepare(id, schema) {
    const copy = structuredClone(schema);
    for (const s of copy.sections) {
      s.label ||= s.id;
      for (const c of s.controls) {
        const k = id + '|' + c.id;
        if (!originals.has(k)) originals.set(k, structuredClone(c.default ?? c.value));
        c.default = structuredClone(originals.get(k));
      }
    }
    return copy;
  }
  function header(list, many) {
    const c = ctx.state.components.get(cardOf.get(list[0]) ?? list[0]) || { name: list[0] };
    const name = many ? `${list.length} selected` : c.name;
    const what = many ? 'Shared instruments: a change goes to each of them' : `${c.fileKind || c.kind || 'file'}${c.bytes !== undefined ? ' · ' + Number(c.bytes).toLocaleString() + ' bytes' : ''}`;
    return `<header class="inst-head"><div><h2>${esc(name)}</h2><p>${esc(what)}</p></div><div class="inst-tools"><button type="button" data-inst-undo title="Undo the last instrument change (G U)">Undo</button>${many ? '' : `<a href="/view/${enc(list[0])}" target="_blank" rel="noopener" title="Open this file alone">Open</a>`}</div></header><p class="inst-status" role="status" aria-live="polite"></p>`;
  }

  async function show() {
    const list = ids(), mine = ++token;
    const key = list.join('\n');
    if (!list.length) { clear(); return; }
    // The same selection: keep the panel (and its focus, gesture and depths), refresh its values.
    if (key === shown && panel) { refresh(); return; }
    const cached = list.map((id) => schemas.get(id));
    if (cached.every(Boolean)) draw(list, cached, mine); // drawn at once from what was read before, then brought up to date
    let fresh;
    try { fresh = await Promise.all(list.map(read)); } catch (e) { if (mine === token) { clear(); host.innerHTML = `<p class="inst-empty" role="alert">${esc(plain(e.message))}</p>`; } return; }
    if (mine !== token) return;
    if (!cached.every(Boolean) || !same(cached.map((s) => structure(s)), fresh.map((s) => structure(s)))) draw(list, fresh, mine);
    else values(fresh);
  }
  const structure = (s) => s.sections.map((x) => [x.id, x.depth, x.controls.map((c) => [c.id, c.type, c.label])]);
  function clear() {
    panel?.destroy(); panel = null; shown = null;
    host.replaceChildren();
    host.hidden = true;
  }
  function draw(list, schemaList, mine) {
    if (mine !== token) return;
    const many = list.length > 1;
    const schema = prepare(list[0], many ? shared(schemaList) : schemaList[0]);
    panel?.destroy();
    host.hidden = false;
    host.innerHTML = `<div class="instruments" data-controls-for="${esc(list[0])}"${many ? ` data-controls-many="${esc(list.join(' '))}"` : ''} role="region" aria-label="Instruments of ${esc(many ? list.length + ' cards' : list[0])}">${header(list, many)}<div class="inst-mount"></div></div>`;
    if (!schema.sections.length) host.querySelector('.inst-mount').innerHTML = `<p class="inst-empty">${many ? 'These cards share no instruments. Select one to tune it.' : 'This file has no instruments.'}</p>`;
    panel = new Dials(host.querySelector('.inst-mount'), { studio: 'viewport', history: false, pagePalette: false, label: 'Instruments' });
    panel.items = list;
    panel.render(schema);
    shown = list.join('\n');
    wire(panel);
    host.querySelector('[data-inst-undo]').onclick = () => undo();
  }
  function values(fresh) {
    if (!panel) return;
    const patch = {};
    for (const s of fresh[0].sections) for (const c of s.controls) if (panel.rows.has(c.id) && !same(panel.get(c.id), c.value)) patch[c.id] = c.value;
    try { panel.update(patch, { revision: fresh[0].revision }); } catch { draw(panel.items, fresh, token); }
  }
  async function refresh() {
    if (!panel) return;
    const list = panel.items, mine = token;
    try { const fresh = await Promise.all(list.map(read)); if (mine === token && panel?.items === list) values(fresh); } catch {}
  }
  const status = (text) => { const s = host.querySelector('.inst-status'); if (s) s.textContent = plain(text); };

  // One write at a time per item, each on the revision the last one returned.
  const queue = new Map();
  function write(id, control, value) {
    const run = async () => {
      const schema = schemas.get(id) || await read(id);
      const r = await ctx.fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: id, control, value, baseRevision: schema.revision }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) { status(j.error || 'That change was not written.'); await read(id).catch(() => {}); refresh(); return false; }
      schema.revision = j.revision;
      const s = schema.sections.flatMap((x) => x.controls).find((c) => c.id === control); if (s) s.value = value;
      redraw(id);
      return true;
    };
    const p = (queue.get(id) || Promise.resolve()).then(run, run);
    queue.set(id, p.catch(() => {}));
    return p;
  }
  async function undo() {
    const list = panel?.items || ids();
    for (const id of list) {
      const r = await ctx.fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) status(j.error || 'Nothing to undo.');
      redraw(id);
    }
    await refresh();
  }
  function wire(p) {
    p.addEventListener('value', ({ detail: e }) => {
      if (e.phase !== 'commit' || same(e.previous, e.value)) return;
      for (const id of p.items) write(id, e.control, e.value);
    });
    p.addEventListener('command', ({ detail }) => { if (detail.command === 'undo') undo(); });
    p.addEventListener('depth', ({ detail }) => {
      for (const id of p.items) ctx.fetch('/api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ depth: { item: id, section: detail.section, depth: detail.depth } }) }).catch(() => {});
      document.body.toggleAttribute('data-studio-open', [...p.sections.values()].some((s) => s.depth === 3));
    });
  }

  // napkin's modifier contract (Shift coarse, Alt fine), type-ahead on choices, and Enter that hands focus back to the label.
  let typed = '', typedAt = 0;
  host.addEventListener('keydown', (ev) => {
    if (!panel) return;
    const rowEl = ev.target.closest?.('[data-control]'), row = rowEl && panel.rows.get(rowEl.dataset.control);
    if (!row) return;
    const editing = /^(INPUT|TEXTAREA)$/.test(ev.target.tagName);
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[ev.key];
    if (dir && !editing && (ev.shiftKey || ev.altKey) && !ev.ctrlKey && !ev.metaKey && ev.target.getAttribute('role') !== 'radio') {
      ev.preventDefault(); ev.stopPropagation();
      try { panel.adjust(row.c.id, dir, { shiftKey: ev.altKey, altKey: ev.shiftKey }); } catch (err) { status(err.message); }
      return;
    }
    // A long text or JSON field: Enter applies it (Shift+Enter starts a new line), like the one-line fields. A text control's
    // field takes its words as they are typed (no quotes needed), whatever type name the schema gives it.
    if (ev.key === 'Enter' && ev.target.tagName === 'TEXTAREA' && (/\bki-(editor|source)\b/.test(ev.target.className) || typeof row.c.value === 'string') && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault(); ev.stopPropagation();
      let v = ev.target.value;
      if (ev.target.classList.contains('ki-source')) { try { v = JSON.parse(v); } catch (err) { status('That is not valid JSON. Fix it, then press Enter again.'); return; } }
      try { panel.transact(row.c.id, v); } catch (err) { status(err.message); return; }
      row.label.focus({ focusVisible: true });
      return;
    }
    if (ev.key === 'Enter' && editing && !ev.shiftKey) { setTimeout(() => { if (document.activeElement === ev.target && !ev.target.getAttribute('aria-invalid')) row.label.focus({ focusVisible: true }); }, 0); return; }
    if (['select', 'segmented'].includes(row.c.type) && !editing) {
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key !== ' ') { if (performance.now() - typedAt > 1500) typed = ''; typed += ev.key.toLowerCase(); typedAt = performance.now(); ev.preventDefault(); ev.stopPropagation(); return; }
      if (ev.key === 'Enter' && typed) {
        const o = (row.c.options || []).map((x) => (typeof x === 'object' ? x : { label: String(x), value: x })).find((x) => norm(x.label).startsWith(typed) || norm(x.value).startsWith(typed));
        typed = '';
        if (o) { ev.preventDefault(); ev.stopPropagation(); panel.transact(row.c.id, o.value); }
      }
    }
  }, true);
  const rowsByLabel = (label) => {
    if (!panel) return [];
    const want = norm(label), all = [...panel.rows.values()];
    return all.filter((r) => norm(r.c.label) === want).concat(all.filter((r) => norm(r.c.id) === want));
  };
  function find(label) {
    const row = rowsByLabel(label)[0];
    if (!row) ctx.hint(panel ? `No control called “${label}” here` : 'Select something first');
    return row;
  }
  function focusControl(label) {
    const row = find(label);
    if (!row) return false;
    if (row.section.depth === 1) panel.setDepth(row.section.schema.id, 2, false);
    const target = row.node.querySelector('.d-value input, .d-value textarea, .d-value [role=switch], .d-value [role=radio][tabindex="0"], .d-value button, .d-value [tabindex="0"]') || row.label;
    row.node.scrollIntoView({ block: 'nearest' });
    target.focus({ focusVisible: true });
    target.select?.();
    return true;
  }
  function depth(label, d) {
    const row = find(label);
    if (!row) return false;
    if (d === 3) panel.open(row.c.id, 3); else panel.setDepth(row.section.schema.id, d);
    if (d === 3) (row.section.node.querySelector('.d-lab [tabindex="0"], .d-lab button, .d-lab input') || row.section.node.querySelector('button'))?.focus({ focusVisible: true });
    else (d === 1 ? row.section.toggle : row.label).focus({ focusVisible: true });
    return true;
  }
  function reset(label) {
    const row = find(label);
    if (!row) return false;
    panel.reset(row.c.id);
    row.label.focus({ focusVisible: true });
    return true;
  }
  const controls = () => (panel ? [...panel.rows.values()].map((r) => ({ id: r.c.id, label: r.c.label || r.c.id, type: r.c.type, value: r.c.value, section: r.section.schema.label })) : []);
  function focusFirst() { const row = panel && [...panel.rows.values()].find((r) => !r.node.hidden); if (row) row.label.focus({ focusVisible: true }); return !!row; }

  // A file changed on disk (an agent, another editor, undo): the panel follows.
  ctx.on('item-change', (f) => { if (panel?.items.includes(f.item)) refresh(); });
  ctx.on('change', (f) => { if (panel?.items.includes(ctx.itemOf(f.component))) refresh(); });
  ctx.on('items-changed', () => { if (panel) refresh(); });
  host.hidden = true;
  // The schemas of the cards on the canvas are read while the page is idle, so a selection draws its panel at once.
  const warm = async () => {
    const ids = [...new Set([...document.querySelectorAll('#world [data-item-id]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }).map((e) => e.dataset.itemId))].filter((id) => !schemas.has(id)).slice(0, 60); // the cards on screen, at most 60
    for (let i = 0; i < ids.length; i += 4) { await Promise.all(ids.slice(i, i + 4).map((id) => read(id).catch(() => {}))); await new Promise((r) => (window.requestIdleCallback || setTimeout)(r)); }
  };
  setTimeout(() => (window.requestIdleCallback || setTimeout)(warm), 1500);
  const api = { show, controls, focusControl, depth, reset, undo, focusFirst, prefetch: (id) => { if (!schemas.has(id)) read(id).catch(() => {}); }, panel: () => panel, host };
  ctx.instruments = api;
  return api;
}
