// The instrument panel of the canvas: whatever is selected (a file of any kind, an HTML or TSX component, several cards)
// gets one panel drawn by the dials library (public/dials), from the server's schema (GET /api/controls/<id>).
// Every commit goes through the item edit path (POST /api/control with the revision it was made on; undo is POST /api/undo),
// so the file bytes are the truth and undo restores them exactly. Several cards selected: the controls they share
// (same id and type) are shown once and a change goes to each of them.
//
//   ctx.instruments.show()            draw the panel for ctx.state.selections (called on every selection change)
//   ctx.instruments.controls()        [{ id, label, type, value, section }] of the panel on screen
//   ctx.instruments.focusControl(l)   focus the value of the control labelled l (opens its section first)
//   ctx.instruments.depth(l, 1|2|3)   fold / open / open with the full editor, the section of the control labelled l (always inside the panel)
//                                     the panel's width also opens a colour section's editor (Dials reveal); a long list shows six rows (panel-height.js)
//   ctx.instruments.reset(l)          back to its default
//   ctx.instruments.undo()            undo the newest instrument change of the selection
//
// Keys inside the panel follow the dials library, with napkin's contract for modifiers: Shift+Arrow is coarse and
// Alt+Arrow is fine. A typed value follows the panel's one field contract (fields.js): Enter applies it and keeps the focus there.
import { Dials, registerFigure } from '/dials/dials.js';
import { colorObjects } from '/dials/studios.js';
import { plain } from './words.js';
import { openColorPicker } from './colorpop.js';
import { capList } from './panel-height.js';
import { isOpen, remember } from './sections.js';

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
  // The file's own sections (Source, Viewer, a picture's adjustments...) are the end of the panel's one list (#panel): after the
  // element's sections (#pp-element), under the one header (panel-head.js).
  const list = document.querySelector('#panel'); list.tabIndex = 0; list.setAttribute('role', 'region'); list.setAttribute('aria-label', 'Properties'); // a scrolling region can be reached by keys
  const el0 = document.querySelector('#pp-element');
  list.append(host);

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
  // The controls several items share (same id and type). Where their values differ the control is marked mixed: it shows "Mixed"
  // (dials), not the first item's value, and a value set on it goes to every item.
  function shared(list) {
    const [first, ...rest] = list;
    const twin = (o, c) => { for (const t of o.sections) { const d = t.controls.find((x) => x.id === c.id && x.type === c.type); if (d) return d; } return null; };
    const sections = first.sections.map((s) => ({ ...s, controls: s.controls.filter((c) => rest.every((o) => twin(o, c))).map((c) => (rest.some((o) => !same(twin(o, c).value, c.value)) ? { ...c, mixed: true } : c)) })).filter((s) => s.controls.length);
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
  // The selection changes, so the element panel above may appear, vanish or change height and this panel's top edge moves with it. For two
  // frames it is out of sight, so the move is never a layout shift. (A panel the person is working in keeps its place.)
  let quietTimer = 0;
  function quiet() {
    if (host.contains(document.activeElement)) return;
    host.style.visibility = 'hidden';
    cancelAnimationFrame(quietTimer);
    quietTimer = requestAnimationFrame(() => { quietTimer = requestAnimationFrame(() => { host.style.visibility = ''; for (const s of panel?.sections.values() ?? []) s.lab?.update?.(); }); }); // an editor drawn while out of sight draws now
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
    host.innerHTML = `<div class="instruments" data-controls-for="${esc(list[0])}"${many ? ` data-controls-many="${esc(list.join(' '))}"` : ''}><p class="inst-status" role="status" aria-live="polite"></p><div class="inst-mount"></div></div>`;
    if (!schema.sections.length) host.querySelector('.inst-mount').innerHTML = `<p class="inst-empty">${many ? 'These cards share no instruments. Select one to tune it.' : 'This file has no instruments.'}</p>`;
    // Pictures come from the file's own bytes (/raw/<id>); a control that is not a picture says so instead of drawing one.
    // reveal: the panel's width shows more of a colour's editor (standards section 7 rule 6b); a narrow panel's swatch opens the
    // anchored picker, which stays inside the panel (rule 11).
    panel = new Dials(host.querySelector('.inst-mount'), { history: false, pagePalette: false, label: 'Instruments', reveal: true, source: (c) => (['image', 'asset', 'file'].includes(c.type) ? '/raw/' + enc(list[0]) : null),
      pickColor: ({ anchor, value, label, onPreview, onCommit }) => openColorPicker({ anchor, value, label, space: /^#/.test(value) ? 'hex' : /^rgb/i.test(value) ? 'rgb' : /^hsl/i.test(value) ? 'hsl' : /^oklch/i.test(value) ? 'oklch' : 'hex', onPreview, onCommit }) });
    panel.items = list;
    const t0 = performance.now();
    panel.render(schema);
    api.lastDrawMs = performance.now() - t0;
    performance.mark('inst-drawn');
    for (const sec of schema.sections) for (const c of sec.controls) if (Array.isArray(c.palette) && c.palette.length) colorObjects(panel, c.id).palette.splice(0, Infinity, ...c.palette); // the colours kept before
    for (const f of host.querySelectorAll('.d-figure')) f.setAttribute('data-figure', ''); // every figure is findable as one, whatever it draws it with
    // The height lever (rule 6c): a section's long list shows six rows; its bottom edge drags down for more, or Show all.
    const comp0 = ctx.state.components.get(cardOf.get(list[0]) ?? list[0]), kind = comp0?.fileKind || comp0?.kind || 'file';
    for (const s of panel.sections.values()) capList(s.rowlist, { key: `${kind}.${s.schema.id}`, label: s.schema.label || s.schema.id, rows: () => [...s.rowlist.children].filter((r) => !r.hidden) });
    // Open or closed is remembered per kind and section (sections.js), the same as the element's sections: Viewer closed on one
    // PNG stays closed on the next. (Set before wire(), so putting it back is not taken for a new choice.)
    for (const s of panel.sections.values()) {
      const want = isOpen(kind, s.schema.id, undefined);
      if (want === false && s.depth > 1) panel.setDepth(s.schema.id, 1, false);
      else if (want === true && s.depth === 1) panel.setDepth(s.schema.id, 2, false);
    }
    panel.kind = kind;
    shown = list.join('\n');
    wire(panel);
  }
  function values(fresh) {
    if (!panel) return;
    const patch = {}, src = fresh.length > 1 ? shared(fresh) : fresh[0], mixed = [];
    for (const s of src.sections) for (const c of s.controls) {
      const row = panel.rows.get(c.id);
      if (!row) continue;
      if (!same(panel.get(c.id), c.value)) patch[c.id] = c.value;
      if (!!row.c.mixed !== !!c.mixed && !panel.active?.has(c.id)) { if (c.mixed) row.c.mixed = true; else delete row.c.mixed; mixed.push(c.id); }
    }
    try { panel.update(patch, { revision: fresh[0].revision }); for (const id of mixed) panel.paint(id); } catch { draw(panel.items, fresh, token); }
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
  // One commit on several items (a multi-selection) is one step: Ctrl+Z on any of them undoes it on all of them.
  const steps = []; // newest last: the items one commit wrote
  async function undoItem(id) {
    const at = steps.findLastIndex((g) => g.includes(id));
    if (at < 0 || steps[at].length < 2) { if (at >= 0) steps.splice(at, 1); return undoOne(id); }
    const [group] = steps.splice(at, 1);
    let ok = true;
    for (const one of group) ok = (await undoOne(one)) && ok;
    return ok;
  }
  async function undoOne(id) {
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
  function write(id, control, value, step = null) {
    const run = async () => {
      const schema = schemas.get(id) || await read(id);
      const r = await ctx.fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: id, control, value, baseRevision: schema.revision }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) { status(j.error || 'That change was not written.'); if (step) { const k = step.indexOf(id); if (k >= 0) step.splice(k, 1); } /* not written: not undone either */ await read(id).catch(() => {}); refresh(); return false; }
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
    if (list.length) await undoItem(list[0]);
  }
  // A held scrub shows on the canvas at once and is taken away when it ends (the commit is what is stored, and it redraws from the file).
  const PICTURE = ['view:exposure', 'view:contrast', 'view:fit'];
  const imgsOf = (id) => [...document.querySelectorAll(`#world [data-item-id="${CSS.escape(id)}"] img`)];
  function previewPicture(p, e) {
    if (!PICTURE.includes(e.control)) return;
    if (e.phase !== 'change') { for (const id of p.items) for (const img of imgsOf(id)) { img.style.removeProperty('filter'); img.style.removeProperty('object-fit'); } return; }
    const v = (c) => { if (c === e.control) return e.value; try { return p.get(c); } catch { return undefined; } };
    const filter = `brightness(${2 ** (Number(v('view:exposure')) || 0)}) contrast(${Number(v('view:contrast') ?? 1)})`;
    for (const id of p.items) for (const img of imgsOf(id)) { img.style.filter = filter; if (v('view:fit') === 'cover' || v('view:fit') === 'contain') img.style.objectFit = v('view:fit'); }
  }
  function wire(p) {
    p.addEventListener('value', ({ detail: e }) => { if (['change', 'commit', 'cancel'].includes(e.phase)) previewPicture(p, e); });
    p.addEventListener('value', ({ detail: e }) => {
      if (e.phase !== 'commit' || (same(e.previous, e.value) && !e.wasMixed)) return;
      const step = [...p.items]; steps.push(step); if (steps.length > 200) steps.shift();
      for (const id of p.items) write(id, e.control, e.value, step);
    });
    p.addEventListener('command', ({ detail }) => { if (detail.command === 'undo') undo(); });
    // A colour bound to a token edits the token: the token source is written, and the control keeps var(--name).
    p.addEventListener('token', ({ detail: e }) => { if (e.phase === 'commit') writeToken(e.name, e.value); });
    // The colours kept in a colour studio are the board's, so they come back with the file.
    p.addEventListener('palette', ({ detail: e }) => { for (const id of p.items) ctx.fetch('/api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ palette: { item: id, control: e.control, palette: e.palette } }) }).catch(() => {}); });
    p.addEventListener('depth', ({ detail }) => {
      if (detail.auto) return; // the panel's width chose it, not the person
      remember(p.kind, detail.section, detail.depth > 1);
      for (const id of p.items) ctx.fetch('/api/board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ depth: { item: id, section: detail.section, depth: detail.depth } }) }).catch(() => {});
    });
  }

  // napkin's modifier contract (Shift coarse, Alt fine) and type-ahead on choices.
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
      return; // the focus stays in the field (fields.js)
    }
    // Up and Down in a number being typed step it like everywhere in the panel: one step, Shift ten (fields.js), as one commit.
    if (editing && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && ev.target.tagName === 'INPUT' && typeof row.c.value === 'number' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault(); ev.stopPropagation();
      try { panel.cancel(row.c.id); panel.adjust(row.c.id, ev.key === 'ArrowUp' ? 1 : -1, { altKey: ev.shiftKey }); } catch (err) { status(err.message); }
      ev.target.value = panel.rows.get(row.c.id)?.input?.value ?? ev.target.value;
      ev.target.select();
      return;
    }
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
    if (d === 3) panel.open(row.c.id, 3); else { panel.setDepth(row.section.schema.id, d, false); panel.reveal(row.section.schema.id); } // a command settles at once: its result is measured and read, not watched
    if (d === 3) (row.section.node.querySelector('.d-lab [tabindex="0"], .d-lab button, .d-lab input') || row.section.node.querySelector('button'))?.focus({ focusVisible: true, preventScroll: true });
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
  // When the element panel's DOM changes (a staged edit, a note) this panel moves with it. The observer runs before the frame is laid out, so it is
  // out of sight in the frame that moves.
  new MutationObserver(() => { if (!host.hidden) quiet(); }).observe(el0, { childList: true, subtree: true });
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
