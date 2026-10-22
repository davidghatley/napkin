// Tools (M4, F11 canvas side + F12): select (V), frame (F), text (T), image slot (I), new component (N).
// Plain DOM. A toolbar in #toolbar, keyboard shortcuts that never fire while typing in an input, and the
// drawing itself: with a tool active, a click (or press-drag-release) inside a rendered component inserts a
// node into the element under the pointer, through ctx.sendEdits (one `insert` op, into the base).
// Select-tool niceties live here too: Delete removes the selected node, Alt+Up/Down moves it among its siblings,
// double-click edits a text node in place.
//   initTools(ctx) -> { tools, use(id), editText(selection), createComponent(name) }; also set as ctx.tools.
import { index, variantGrid, VOID } from '/src/model.js';

const svg = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: svg('M3.5 2.5 12 6.4l-4.2 1.4-1.4 4.2z') },
  { id: 'frame', label: 'Frame', key: 'F', icon: svg('M5 1.8v12.4M11 1.8v12.4M1.8 5h12.4M1.8 11h12.4') },
  { id: 'text', label: 'Text', key: 'T', icon: svg('M3 3.5V2.5h10v1M8 2.5v11M6 13.5h4') },
  { id: 'image', label: 'Image slot', key: 'I', icon: svg('M2.5 3h11v10h-11zM2.5 11l3.3-3.4 2.4 2.4 1.6-1.6 3.7 3.6') },
];
const MIN = { frame: [48, 32], image: [8, 8] };
const DRAG = 4; // px of pointer travel before a press counts as a drag

const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Defaults for each tool's new node. `size` ([w, h] in component px) comes from a drag, if any.
function newNode(tool, id, size) {
  if (tool === 'frame') {
    const [w, h] = size || [];
    return { id, tag: 'div', style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 8, boxSizing: 'border-box', border: '1px dashed #9a927f', minWidth: MIN.frame[0], minHeight: MIN.frame[1], ...(size && { width: Math.max(w, MIN.frame[0]), height: Math.max(h, MIN.frame[1]) }) } };
  }
  if (tool === 'text') return { id, tag: 'span', text: 'Text' };
  const [w, h] = size || [64, 64];
  return { id, tag: 'img', attrs: { src: '', alt: '' }, style: { display: 'block', width: Math.max(w, MIN.image[0]), height: Math.max(h, MIN.image[1]), backgroundColor: '#e4dccb' } };
}

// A readable id that is free in the component: frame1, frame2, text1, image1 ...
function freshId(doc, stem) {
  const { byId } = index(doc);
  let n = 1;
  while (byId.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}
const STEM = { frame: 'frame', text: 'text', image: 'image' };

export function initTools(ctx) {
  const $ = (s) => document.querySelector(s);
  const bar = $('#toolbar');
  const say = (msg) => { const e = $('#error'); if (e) e.textContent = msg || ''; };
  const zoom = () => ctx.state.zoom || 1;
  const stageEl = $('#stage');

  // --- toolbar -------------------------------------------------------------------------------------------
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Tools');
  bar.innerHTML = TOOLS.map((t) => `<button type="button" data-tool="${t.id}" aria-pressed="false" aria-keyshortcuts="${t.key}" title="${t.label} (${t.key})">${t.icon}${t.label} <kbd>${t.key}</kbd></button>`).join('')
    + `<button type="button" id="tool-new" aria-keyshortcuts="N" aria-expanded="false" aria-controls="new-component" title="New component (N)">${svg('M8 3v10M3 8h10')}New component <kbd>N</kbd></button>`
    + '<form id="new-component" hidden autocomplete="off"><label>Name <input id="new-name" aria-label="Component name" placeholder="Card" spellcheck="false"></label><button type="submit">Create</button><span id="new-error" role="alert"></span></form>';
  const buttons = new Map([...bar.querySelectorAll('[data-tool]')].map((b) => [b.dataset.tool, b]));
  const form = bar.querySelector('#new-component'), nameInput = bar.querySelector('#new-name'), newErr = bar.querySelector('#new-error'), newBtn = bar.querySelector('#tool-new');

  const tools = new Map(TOOLS.map((t) => [t.id, { id: t.id, activate() {}, deactivate() {} }]));
  function use(id) {
    if (!tools.has(id) || id === ctx.state.tool) return;
    tools.get(ctx.state.tool)?.deactivate(ctx);
    ctx.state.tool = id;
    tools.get(id).activate(ctx);
    sync();
    ctx.emit('tool', { tool: id });
  }
  function sync() {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === ctx.state.tool));
    document.body.dataset.tool = ctx.state.tool;
  }
  bar.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tool]');
    if (b) use(b.dataset.tool);
  });
  newBtn.addEventListener('click', () => (form.hidden ? openNew() : closeNew()));
  sync();

  // --- new component (N) ---------------------------------------------------------------------------------
  function openNew() { cancelDraw(); form.hidden = false; newBtn.setAttribute('aria-expanded', 'true'); newErr.textContent = ''; nameInput.value = ''; nameInput.focus(); }
  function closeNew() { nameInput.blur(); form.hidden = true; newBtn.setAttribute('aria-expanded', 'false'); newErr.textContent = ''; }
  nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeNew(); newBtn.focus(); } });

  // Waits until a component's section has drawn the revision (and the node, if given).
  async function rendered(component, revision, node, variant) {
    for (let i = 0; i < 200; i++) {
      const sec = document.querySelector(`section.cmp[data-component="${CSS.escape(component)}"]`);
      if (sec && sec.dataset.ready === '1' && (revision === undefined || sec.dataset.revision === String(revision)) && (!node || cellElement(sec, node, variant))) return sec;
      await sleep(25);
    }
    return null;
  }
  function cellElement(sec, node, variant) {
    const css = `.mount [data-n="${CSS.escape(node)}"]`;
    const key = JSON.stringify(variant || {});
    const cell = [...sec.querySelectorAll('.cell')].find((c) => c.dataset.variant === key);
    return cell?.querySelector(css) || sec.querySelector(css);
  }

  async function createComponent(name) {
    name = String(name).trim();
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return { ok: false, error: `"${name}" is not a component name: use PascalCase, like Card` };
    const res = await ctx.fetch('/api/components', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
    if (!res.ok || !r.ok) return { ok: false, error: r.error || `server answered ${res.status}` };
    for (let i = 0; i < 200 && !ctx.state.components.get(r.id)?.doc; i++) await sleep(25);
    const c = ctx.state.components.get(r.id);
    const sec = c && await rendered(r.id, c.revision);
    if (sec) { ctx.stage?.reveal(r.id); ctx.select({ component: r.id, node: c.doc.root.id, variant: variantGrid(c.doc)[0] }); }
    return { ok: true, id: r.id, name: r.name };
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    newErr.textContent = '';
    const r = await createComponent(nameInput.value);
    if (!r.ok) { newErr.textContent = r.error; nameInput.focus(); return; }
    closeNew(); say('');
  });

  // --- inline text editing -------------------------------------------------------------------------------
  let editor = null;
  function editText(sel) {
    const c = sel && ctx.state.components.get(sel.component);
    const node = c?.doc && index(c.doc).byId.get(sel.node);
    if (!node || c.readOnly || node.textProp || node.children.length || VOID.has(node.tag)) return false;
    const sec = document.querySelector(`section.cmp[data-component="${CSS.escape(sel.component)}"]`);
    const el = sec && cellElement(sec, sel.node, sel.variant);
    if (!el) return false;
    editor?.cancel();
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), z = zoom();
    const input = document.createElement('input');
    input.className = 'text-edit'; input.setAttribute('aria-label', `Text of ${sel.node}`); input.value = node.text ?? '';
    // the editor looks like the text it replaces, at the canvas's zoom: same face, size, spacing, alignment and colour
    Object.assign(input.style, { left: `${r.left}px`, top: `${r.top}px`, minWidth: `${Math.max(r.width + 16, 80)}px`, height: `${Math.max(r.height + 4, 24)}px`, fontFamily: cs.fontFamily, fontSize: `${parseFloat(cs.fontSize) * z}px`, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing === 'normal' ? 'normal' : `${parseFloat(cs.letterSpacing) * z}px`, textAlign: cs.textAlign === 'start' ? 'left' : cs.textAlign, color: cs.color });
    document.body.append(input);
    input.focus(); input.select();
    let done = false, composing = false;
    // An IME (Japanese, Chinese, Korean, dead keys) builds a word in steps: Enter and blur while a composition is open belong to the IME, not to us.
    input.addEventListener('compositionstart', () => { composing = true; input.dataset.composing = '1'; });
    input.addEventListener('compositionend', () => { composing = false; delete input.dataset.composing; });
    const finish = async (commit) => {
      if (done) return; done = true;
      input.remove(); editor = null;
      const value = input.value;
      if (commit && value !== '' && value !== node.text) await ctx.sendEdits(sel.component, [{ op: 'set', path: `${sel.node}.text`, value }]);
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.isComposing || composing || ev.keyCode === 229) return; // the IME is using this key
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => { if (!composing) finish(true); else input.addEventListener('compositionend', () => finish(true), { once: true }); });
    editor = { cancel: () => finish(false) };
    return true;
  }
  stageEl.addEventListener('dblclick', (ev) => {
    if (ctx.state.tool !== 'select') return;
    const h = hit(ev.target);
    if (h) { ctx.select({ component: h.component, node: h.node, variant: h.variant }); editText({ component: h.component, node: h.node, variant: h.variant }); }
  });

  // --- drawing -------------------------------------------------------------------------------------------
  const rect = document.createElement('div');
  rect.id = 'draw-rect'; rect.hidden = true; document.body.append(rect);
  let drag = null;       // { h, x, y, moved }
  let swallowClick = 0;  // a drawing gesture ends in a click that must not also select

  function hit(target) {
    const el = target?.closest?.('.mount [data-n]');
    const cell = el?.closest('.cell');
    return el && cell && { el, component: cell.closest('.cmp').dataset.component, node: el.dataset.n, variant: JSON.parse(cell.dataset.variant) };
  }
  function cancelDraw() { drag = null; rect.hidden = true; }

  const drawing = () => ctx.state.tool === 'frame' || ctx.state.tool === 'text' || ctx.state.tool === 'image';
  document.addEventListener('pointerdown', (ev) => {
    if (!drawing() || ev.button !== 0 || !stageEl.contains(ev.target)) return;
    const h = hit(ev.target);
    if (!h) return;
    ev.preventDefault();
    drag = { h, x: ev.clientX, y: ev.clientY, moved: false };
    swallowClick = Date.now();
  }, true);
  document.addEventListener('pointermove', (ev) => {
    if (!drag || ctx.state.tool === 'text') return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG) return;
    drag.moved = true;
    Object.assign(rect.style, { left: `${Math.min(drag.x, ev.clientX)}px`, top: `${Math.min(drag.y, ev.clientY)}px`, width: `${Math.abs(ev.clientX - drag.x)}px`, height: `${Math.abs(ev.clientY - drag.y)}px` });
    rect.hidden = false;
  }, true);
  document.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const d = drag; cancelDraw();
    const size = d.moved && ctx.state.tool !== 'text' ? [Math.round(Math.abs(ev.clientX - d.x) / zoom()), Math.round(Math.abs(ev.clientY - d.y) / zoom())] : null;
    draw(d.h, ctx.state.tool, size, ev.shiftKey);
  }, true);
  // The click that follows a drawing gesture belongs to the tool, not to the select tool.
  document.addEventListener('click', (ev) => {
    if (swallowClick && Date.now() - swallowClick < 1000) { swallowClick = 0; ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  document.addEventListener('pointercancel', cancelDraw, true);

  async function draw(h, tool, size, keep) {
    const c = ctx.state.components.get(h.component);
    if (!c?.doc || c.readOnly) { say(`${c?.name ?? 'component'} is read-only: ${c?.readOnly ?? 'not loaded'}`); return; }
    const { byId, parentOf } = index(c.doc);
    const target = byId.get(h.node);
    if (!target) return;
    // Elements go inside an element that can hold them; beside (after) one that holds text or is an image.
    let parent = target, at;
    if (target.text !== undefined || target.textProp || VOID.has(target.tag)) {
      parent = parentOf.get(target.id);
      if (!parent) { say(`${target.id} holds text and has no parent to draw into`); return; }
      at = parent.children.findIndex((x) => x.id === target.id) + 1;
    }
    const id = freshId(c.doc, STEM[tool]);
    const r = await ctx.sendEdits(h.component, [{ op: 'insert', parent: parent.id, ...(at !== undefined && { index: at }), node: newNode(tool, id, size) }]);
    if (!r.ok) return;
    await rendered(h.component, r.revision, id, h.variant);
    const sel = { component: h.component, node: id, variant: h.variant };
    ctx.select(sel);
    if (!keep) use('select');
    if (tool === 'text') editText(sel);
  }

  // --- select-tool niceties ------------------------------------------------------------------------------
  async function deleteSelected() {
    const sel = ctx.state.selection, c = sel && ctx.state.components.get(sel.component);
    if (!c?.doc || c.readOnly) return;
    // every selected node except the root, in one batch (one revision)
    const { parentOf } = index(c.doc);
    const all = new Set(ctx.state.selections.filter((s) => s.component === sel.component && s.node !== c.doc.root.id).map((s) => s.node));
    const under = (id) => { for (let p = parentOf.get(id); p; p = parentOf.get(p.id)) if (all.has(p.id)) return true; return false; };
    const ids = [...all].filter((id) => !under(id)); // a selected child goes with its selected parent
    if (ids.length) await ctx.sendEdits(sel.component, ids.map((id) => ({ op: 'delete', id })));
  }
  async function moveSelected(step) {
    const sel = ctx.state.selection, c = sel && ctx.state.components.get(sel.component);
    if (!c?.doc || c.readOnly) return;
    const parent = index(c.doc).parentOf.get(sel.node);
    if (!parent) return;
    const from = parent.children.findIndex((x) => x.id === sel.node), to = from + step;
    if (to < 0 || to >= parent.children.length) return;
    await ctx.sendEdits(sel.component, [{ op: 'move', id: sel.node, parent: parent.id, index: to }]);
  }

  // --- keyboard ------------------------------------------------------------------------------------------
  document.addEventListener('keydown', (ev) => {
    if (typing(ev.target) || ev.defaultPrevented || ev.isComposing) return;
    if (ev.key === 'Escape') {
      if (drag) cancelDraw();
      else if (!form.hidden) closeNew();
      else if (ctx.state.tool !== 'select') use('select');
      return;
    }
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault(); moveSelected(ev.key === 'ArrowUp' ? -1 : 1); return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelected(); return; }
    const key = ev.key.length === 1 ? ev.key.toUpperCase() : '';
    if (key === 'N') { ev.preventDefault(); openNew(); return; }
    const t = TOOLS.find((x) => x.key === key);
    if (t) { ev.preventDefault(); use(t.id); }
  });

  const api = { tools, use, editText, createComponent };
  ctx.tools = api;
  return api;
}
