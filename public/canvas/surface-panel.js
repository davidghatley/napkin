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
import { Dials, registerFigure } from '/dials/dials.js';
import { colorObjects } from '/dials/studios.js';
import { plain } from './words.js';

const enc = encodeURIComponent;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const norm = (s) => String(s ?? '').trim().toLowerCase();

// A number with no range of its own, or a very wide one (a poster time up to a day, a cell worth 664 675): the figure is a ruler
// that slides under a fixed pointer, one tick per step, so one step is always a visible move.
registerFigure('window', (host, c, v) => {
  const unit = Number(c.step) > 0 ? Number(c.step) : 1, at = (Number(v) || 0) / unit, gap = 6.4, shift = (at - Math.floor(at)) * gap;
  let ticks = '';
  for (let i = -1; i <= 12; i++) {
    const n = Math.floor(at) + i - 5, x = 6 + i * gap - shift;
    if (x < 3 || x > 73) continue;
    ticks += `<path d="M${x.toFixed(1)} ${n % 5 === 0 ? 1.5 : 4}V8" stroke="var(--d-rule)"/>`;
  }
  host.innerHTML = `<svg viewBox="0 0 76 24" width="76" height="24" aria-hidden="true">${ticks}<rect x="6" y="13" width="64" height="4" rx="2" fill="var(--d-rule)" opacity=".6"/><rect x="6" y="13" width="32" height="4" rx="2" fill="var(--d-accent)"/><circle cx="38" cy="15" r="5" fill="var(--d-surface)" stroke="var(--d-text)" stroke-width="1.5"/></svg>`;
});

// A text figure shows the text itself, as far as it fits: two lines of its first characters. Changing one character changes the figure.
registerFigure('specimen', (host, c, v) => {
  const text = String(v ?? '').replace(/\s+/g, ' ').trim(), esc1 = (t) => t.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
  const a = text.slice(0, 13), b = text.slice(13, 26);
  host.innerHTML = `<svg viewBox="0 0 76 24" width="76" height="24" aria-hidden="true">${text ? `<text x="2" y="10" font-size="9" font-family="ui-monospace, monospace" fill="var(--d-text)" textLength="${Math.min(72, a.length * 5.6)}" lengthAdjust="spacingAndGlyphs">${esc1(a)}</text>${b ? `<text x="2" y="21" font-size="9" font-family="ui-monospace, monospace" fill="var(--d-faint)" textLength="${Math.min(72, b.length * 5.6)}" lengthAdjust="spacingAndGlyphs">${esc1(b)}</text>` : ''}` : '<path d="M3 6v12" stroke="var(--d-accent)" stroke-width="1.5"/><path d="M7 18.5H73" stroke="var(--d-rule)"/>'}</svg>`;
});

export function initInstruments(ctx) {
  const host = document.createElement('div');
  host.id = 'instruments';
  document.querySelector('#panel').after(host); // below the element panel, so drawing it never moves what is above

  const schemas = new Map(); // item id -> { revision, sections } as last read
  const originals = new Map(); // "item|control" -> the value first seen this session: what Reset goes back to
  let panel = null, shown = null, token = 0;
  let previewing = 0; // until when a panel drawn ahead of its selection may stand without one

  // The selection as files (item ids); cardOf maps a file back to the canvas card that draws it.
  const cardOf = new Map();
  const ids = () => { const out = []; for (const s of ctx.state.selections) { if (!ctx.state.components.get(s.component)) continue; const id = ctx.itemOf(s.component); cardOf.set(id, s.component); if (!out.includes(id)) out.push(id); } return out; };
  const redraw = (id) => ctx.stage.render(cardOf.get(id) ?? id, true).catch(() => {});
  // One read of an item's controls at a time (a phrase being typed asks for the same item at every key). A write made while a
  // read was out makes that read stale, so its revision is not kept.
  const flight = new Map(), gen = new Map();
  function read(id, priority = 'high') { // a read a person waits for goes first in the browser's queue; the warm-up ones go last
    if (flight.has(id)) return flight.get(id);
    const p = readNow(id, priority).finally(() => flight.delete(id));
    flight.set(id, p);
    return p;
  }
  async function readNow(id, priority) {
    const g = gen.get(id) || 0;
    const r = await fetch('/api/controls/' + enc(id), { priority });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'no instruments');
    // A section the person opened at a depth carries it; its controls keep the depth they were declared with.
    for (const s of j.sections || []) for (const c of s.controls) if (c.nativeDepth !== undefined) { c.depth = c.nativeDepth; delete c.nativeDepth; }
    if ((gen.get(id) || 0) !== g && schemas.has(id)) return schemas.get(id);
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
        // The item schema names figures the dials library does not draw ("value", "meter"): dials then picks one by control type.
        const f = typeof c.figure === 'string' ? c.figure : c.figure?.type;
        if (f === 'value' || f === 'meter') delete c.figure;
        if (!c.figure && (c.type === 'text' || c.type === 'textarea') && !(c.options?.length)) c.figure = { type: 'specimen' };
        if (c.type === 'number' && !c.figure && (!Number.isFinite(c.min) || !Number.isFinite(c.max) || (c.max - c.min) / (Number(c.step) > 0 ? c.step : 1) > 100)) c.figure = { type: 'window' };
      }
    }
    return copy;
  }
  function header(list, many) {
    const c = ctx.state.components.get(cardOf.get(list[0]) ?? list[0]) || { name: list[0] };
    const withElement = !many && !document.querySelector('#panel').hidden && document.querySelector('#panel').childElementCount > 0; // the element panel is above: this one is the whole file's
    const name = many ? `${list.length} selected` : withElement ? 'Whole file' : c.name;
    const what = many ? 'Shared instruments: a change goes to each of them' : `${withElement ? c.name + ' · ' : ''}${c.fileKind || c.kind || 'file'}${c.bytes !== undefined ? ' · ' + Number(c.bytes).toLocaleString() + ' bytes' : ''}`;
    return `<header class="inst-head"><div><h2>${esc(name)}</h2><p>${esc(what)}</p></div><div class="inst-tools"><button type="button" data-inst-undo title="Undo the last instrument change (G U)">Undo</button>${many ? '' : `<a href="/view/${enc(list[0])}" target="_blank" rel="noopener" title="Open this file alone">Open</a>`}</div></header><p class="inst-status" role="status" aria-live="polite"></p>`;
  }

  // The selection changes, so the element panel above may appear, vanish or change height and this panel's top edge moves with it. For two
  // frames it is out of sight, so the move is never a layout shift. (A panel the person is working in keeps its place.)
  let quietTimer = 0;
  function quiet() {
    if (host.contains(document.activeElement)) return;
    host.style.visibility = 'hidden';
    cancelAnimationFrame(quietTimer);
    quietTimer = requestAnimationFrame(() => { quietTimer = requestAnimationFrame(() => { host.style.visibility = ''; }); });
  }
  async function show() {
    const list = ids(), mine = ++token;
    const key = list.join('\n');
    if (!list.length) { if (previewing > performance.now() && panel) return; quiet(); clear(); return; } // a file being selected (its frame still loading) keeps its panel
    previewing = 0;
    // The same selection: keep the panel (and its focus, gesture and depths), refresh its values.
    if (key === shown && panel) { refresh(); return; }
    quiet();
    const cached = list.map((id) => schemas.get(id));
    if (cached.every(Boolean)) draw(list, cached, mine); // drawn at once from what was read before, then brought up to date
    let fresh;
    try { fresh = await Promise.all(list.map((id) => read(id))); } catch (e) { if (mine === token) { clear(); host.innerHTML = `<p class="inst-empty" role="alert">${esc(plain(e.message))}</p>`; } return; }
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
    // Pictures come from the file's own bytes (/raw/<id>); a control that is not a picture says so instead of drawing one.
    panel = new Dials(host.querySelector('.inst-mount'), { studio: 'viewport', history: false, pagePalette: false, label: 'Instruments', source: (c) => (['image', 'asset', 'file'].includes(c.type) ? '/raw/' + enc(list[0]) : null) });
    panel.items = list;
    const t0 = performance.now();
    panel.render(schema);
    api.lastDrawMs = performance.now() - t0;
    performance.mark('inst-drawn');
    for (const sec of schema.sections) for (const c of sec.controls) if (Array.isArray(c.palette) && c.palette.length) colorObjects(panel, c.id).palette.splice(0, Infinity, ...c.palette); // the colours kept before
    for (const f of host.querySelectorAll('.d-figure')) f.setAttribute('data-figure', ''); // every figure is findable as one, whatever it draws it with
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
    try { const fresh = await Promise.all(list.map((id) => read(id))); if (mine === token && panel?.items === list) values(fresh); } catch {}
  }
  const status = (text) => { const s = host.querySelector('.inst-status'); if (s) s.textContent = plain(text); };

  // How many instrument changes of each item are still standing, and when the newest was made: Ctrl+Z undoes them in order with other edits.
  const wrote = new Map();
  const canUndo = (id) => { const w = wrote.get(id); return !!w && w.n > 0 && w.at > (ctx.lastEditAt || 0); };
  async function undoItem(id) {
    const r = await ctx.fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) { status(j.error || 'Nothing to undo.'); return false; }
    const w = wrote.get(id); if (w) w.n = Math.max(0, w.n - 1);
    gen.set(id, (gen.get(id) || 0) + 1);
    redraw(id); await refresh();
    return true;
  }

  // One write at a time per item, each on the revision the last one returned.
  const queue = new Map();
  function write(id, control, value) {
    const run = async () => {
      const schema = schemas.get(id) || await read(id);
      const r = await ctx.fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: id, control, value, baseRevision: schema.revision }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) { status(j.error || 'That change was not written.'); await read(id).catch(() => {}); refresh(); return false; }
      schema.revision = j.revision;
      gen.set(id, (gen.get(id) || 0) + 1);
      const w = wrote.get(id) ?? { n: 0, at: 0 }; wrote.set(id, { n: w.n + 1, at: performance.now() });
      const s = schema.sections.flatMap((x) => x.controls).find((c) => c.id === control); if (s) s.value = value;
      redraw(id);
      return true;
    };
    const p = (queue.get(id) || Promise.resolve()).then(run, run);
    queue.set(id, p.catch(() => {}));
    return p;
  }
  async function writeToken(name, value) {
    try {
      const data = await (await fetch('/api/tokens')).json();
      const bare = String(name).replace(/^--/, ''), t = (data.tokens || []).find((x) => x.name === bare || x.name === '--' + bare);
      if (!t) { status(`There is no token called ${name} in this folder, so only the colour in the file changed.`); return; }
      const mode = (data.modes || [])[0] || 'light';
      const r = await ctx.fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: t.name, mode, value: String(value), baseRevision: data.revision }) });
      const j = await r.json().catch(() => ({}));
      status(r.ok && j.ok !== false ? `Token ${name} is now ${value}.` : (j.error || 'The token was not written.'));
    } catch (e) { status(e.message); }
  }
  async function undo() {
    const list = panel?.items || ids();
    for (const id of list) await undoItem(id);
  }
  function wire(p) {
    p.addEventListener('value', ({ detail: e }) => {
      if (e.phase !== 'commit' || same(e.previous, e.value)) return;
      for (const id of p.items) write(id, e.control, e.value);
    });
    p.addEventListener('command', ({ detail }) => { if (detail.command === 'undo') undo(); });
    // A colour bound to a token edits the token: the token source is written, and the control keeps var(--name).
    p.addEventListener('token', ({ detail: e }) => { if (e.phase === 'commit') writeToken(e.name, e.value); });
    // The colours kept in a colour studio are the board's, so they come back with the file.
    p.addEventListener('palette', ({ detail: e }) => { for (const id of p.items) ctx.fetch('/api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ palette: { item: id, control: e.control, palette: e.palette } }) }).catch(() => {}); });
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
    if (d === 3) panel.open(row.c.id, 3); else panel.setDepth(row.section.schema.id, d, false); // a command settles at once: its result is measured and read, not watched
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
    const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
    const cards = [...document.querySelectorAll('#world [data-item-id]')]; // the cards on screen first, then the rest, at most 120
    const ids = [...new Set([...cards.filter(onScreen), ...cards].map((e) => e.dataset.itemId))].filter((id) => !schemas.has(id)).slice(0, 120);
    for (let i = 0; i < ids.length; i += 2) { await Promise.all(ids.slice(i, i + 2).map((id) => read(id, 'low').catch(() => {}))); await new Promise((r) => (window.requestIdleCallback || setTimeout)(r)); } // two at a time: the browser has six connections and a person's own read needs one
  };
  let warmed = 0;
  const warmSoon = () => { clearTimeout(warmed); warmed = setTimeout(() => (window.requestIdleCallback || setTimeout)(warm), 250); };
  ctx.on('items-changed', warmSoon);
  warmSoon(); setTimeout(warmSoon, 1500);
  // Draw the panel for a file before the canvas has finished selecting it (a frame still loading). The selection that follows keeps it.
  async function preview(id, component) {
    performance.mark('inst-preview');
    if (!id || shown === id) return;
    if (component) cardOf.set(id, component);
    previewing = performance.now() + 4000;
    const mine = ++token;
    try { const j = schemas.get(id) ?? await read(id); if (mine === token && shown !== id) draw([id], [j], mine); } catch {}
  }
  const api = { show, preview, canUndo, undoItem, controls, focusControl, depth, reset, undo, focusFirst, prefetch: (id) => { if (!schemas.has(id)) read(id).catch(() => {}); }, panel: () => panel, host };
  ctx.instruments = api;
  return api;
}
