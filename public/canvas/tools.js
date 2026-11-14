// Tools (M4, F11 canvas side + F12): select (V), frame (F), text (T), image slot (I).
// Plain DOM. A toolbar in #toolbar (icon buttons, one roving tab stop, arrows move between them; standards section 1), keyboard shortcuts that never fire while typing in an input, and the
// drawing itself: with a tool active, a click (or press-drag-release) inside a rendered component inserts a
// node into the element under the pointer, through ctx.sendEdits (one `insert` op, into the base).
// Select-tool niceties live here too: Delete removes the selected node, Alt+Up/Down moves it among its siblings,
// double-click edits a text node in place.
//   initTools(ctx) -> { tools, use(id), editText(selection), createComponent(name) }; also set as ctx.tools.
// A component is no longer named up front from the bar (decision 0023): createComponent stays for the palette ("New component <Name>")
// and for agents, until "Create component" from a selection replaces it.
import { SANS } from './words.js';
import { index, variantGrid, VOID } from '/src/model.js';

// One grid (16 px), one stroke (1.5 px), round caps and joins: the same drawing rules as every chrome icon (canvas.css .ico).
const svg = (d) => `<svg class="ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${d}</svg>`;
const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: svg('<path d="M3.75 2.75v9.5l2.6-2.45 1.75 3.95 1.9-.85-1.75-3.9h3.5z"/>') },
  { id: 'frame', label: 'Frame', key: 'F', icon: svg('<path d="M5.25 2.25v11.5M10.75 2.25v11.5M2.25 5.25h11.5M2.25 10.75h11.5"/>') },
  { id: 'text', label: 'Text', key: 'T', icon: svg('<path d="M3.25 4.75v-2h9.5v2M8 2.75v10.5M6 13.25h4"/>') },
  { id: 'image', label: 'Image', key: 'I', icon: svg('<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5"/><path d="m2.25 11 3.25-3.25 2.75 2.75 1.75-1.75 3.75 3.75"/><circle cx="10.5" cy="5.75" r=".75"/>') },
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
  if (tool === 'text') return { id, tag: 'span', text: 'Text', style: { boxSizing: 'border-box', fontFamily: SANS } };
  const [w, h] = size || [64, 64];
  return { id, tag: 'img', attrs: { src: '', alt: '' }, style: { boxSizing: 'border-box', display: 'block', width: Math.max(w, MIN.image[0]), height: Math.max(h, MIN.image[1]), backgroundColor: '#e4dccb' } };
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
  bar.innerHTML = TOOLS.map((t, i) => `<button type="button" data-tool="${t.id}" aria-pressed="false" aria-keyshortcuts="${t.key}" aria-label="${t.label}" data-tip="${t.label}" data-key="${t.key}" tabindex="${i ? -1 : 0}">${t.icon}</button>`).join('');
  const buttons = new Map([...bar.querySelectorAll('[data-tool]')].map((b) => [b.dataset.tool, b]));

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
    for (const [id, b] of buttons) { const on = id === ctx.state.tool; b.setAttribute('aria-pressed', String(on)); if (!bar.contains(document.activeElement)) b.tabIndex = on ? 0 : -1; }
    document.body.dataset.tool = ctx.state.tool;
  }
  bar.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tool]');
    if (b) use(b.dataset.tool);
  });
  // one Tab stop for the group; arrows, Home and End move between the tools (Enter or Space arms, as any button does)
  bar.addEventListener('keydown', (ev) => {
    const list = [...buttons.values()], i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const to = ev.key === 'ArrowRight' ? (i + 1) % list.length : ev.key === 'ArrowLeft' ? (i - 1 + list.length) % list.length : ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1 : -1;
    if (to < 0) return;
    ev.preventDefault(); ev.stopPropagation();
    for (const b of list) b.tabIndex = -1;
    list[to].tabIndex = 0; list[to].focus();
  });
  sync();

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
    // WPC-23: a component made here keeps the free spot the stage found for it, so a reload (or another tab) does not stack it at 0,0
    const at = sec && ctx.stage?.position(r.id);
    if (at && (at.x !== 0 || at.y !== 0)) await ctx.fetch(`/api/components/${encodeURIComponent(r.id)}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: at.x, y: at.y }) }).catch(() => {});
    if (sec) { ctx.stage?.reveal(r.id); ctx.select({ component: r.id, node: c.doc.root.id, variant: variantGrid(c.doc)[0] }); }
    return { ok: true, id: r.id, name: r.name };
  }

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
  // the size readout under the outline: canvas px, as Figma and tldraw show it while drawing
  const readout = document.createElement('div');
  readout.id = 'draw-size'; readout.hidden = true; document.body.append(readout);
  function cancelDraw() { drag = null; rect.hidden = true; readout.hidden = true; delete rect.dataset.on; }

  const drawing = () => ctx.state.tool === 'frame' || ctx.state.tool === 'text' || ctx.state.tool === 'image';
  // A press on a component the dialect draws inserts there (draw below); anywhere else ctx.create decides: an HTML frame
  // (insert into it) or the canvas (a new frame file).
  document.addEventListener('pointerdown', (ev) => {
    if (!drawing() || ev.button !== 0 || ev.pointerType === 'touch' || !stageEl.contains(ev.target) || ctx.view.isPanning()) return;
    const h = hit(ev.target);
    const target = h ? null : ctx.create?.targetAt(ev);
    if (!h && !target) return;
    ev.preventDefault();
    drag = { h, target, x: ev.clientX, y: ev.clientY, moved: false };
    swallowClick = Date.now();
  }, true);
  // The drawn box in screen px: Shift makes it square, Alt draws it from its centre (standards section 2).
  function boxOf(d, ev) {
    let dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (ev.shiftKey && !d.h) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s; }
    if (ev.altKey && !d.h) return { left: d.x - Math.abs(dx), top: d.y - Math.abs(dy), w: 2 * Math.abs(dx), h: 2 * Math.abs(dy) };
    return { left: Math.min(d.x, d.x + dx), top: Math.min(d.y, d.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
  }
  document.addEventListener('pointermove', (ev) => {
    if (!drag || (drag.h && ctx.state.tool === 'text')) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG) return;
    drag.moved = true;
    const b = boxOf(drag, ev);
    Object.assign(rect.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.w}px`, height: `${b.h}px` });
    if (drag.target?.kind === 'canvas' && ctx.state.tool !== 'text') rect.dataset.on = 'canvas'; else delete rect.dataset.on;
    rect.hidden = false;
    if (!drag.h) {
      const z = zoom();
      readout.textContent = ctx.state.tool === 'text' ? `${Math.round(b.w / z)}` : `${Math.round(b.w / z)} \u00d7 ${Math.round(b.h / z)}`;
      Object.assign(readout.style, { left: `${b.left + b.w / 2}px`, top: `${b.top + b.h + 8}px` });
      readout.hidden = false;
    }
  }, true);
  document.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const d = drag, box = d.moved ? boxOf(d, ev) : null; cancelDraw();
    const tool = ctx.state.tool;
    if (d.h) {
      const size = d.moved && tool !== 'text' ? [Math.round(Math.abs(ev.clientX - d.x) / zoom()), Math.round(Math.abs(ev.clientY - d.y) / zoom())] : null;
      draw(d.h, tool, size, ev.shiftKey);
      return;
    }
    use('select'); // one use, then back to Select (standards section 2, open item settled)
    const go = () => ctx.create.make({ tool, target: d.target, box, point: { x: d.x, y: d.y } })?.catch?.((e) => { console.error(e); say(String(e.message || e)); });
    // the image tool opens the file picker, which Chromium only opens from the click (not the pointerup) of a mouse gesture
    if (tool === 'image') { afterClick = go; setTimeout(() => { if (afterClick === go) { afterClick = null; go(); } }, 400); } else go();
  }, true);
  // The click that follows a drawing gesture belongs to the tool, not to the select tool.
  let afterClick = null;
  document.addEventListener('click', (ev) => {
    if (swallowClick && Date.now() - swallowClick < 1000) { swallowClick = 0; ev.stopPropagation(); ev.preventDefault(); }
    if (afterClick) { const f = afterClick; afterClick = null; f(); }
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
    if (c?.kind === 'html' && !c.doc) return ctx.ops?.remove(); // an element of an HTML or React file: the engine's delete (edit-ops.js)
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
      else if (ctx.state.tool !== 'select') use('select');
      return;
    }
    // the keyboard path: F (or T, I) then Enter makes the default one in the middle of the view
    if (ev.key === 'Enter' && drawing() && !drag && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ctx.create) {
      ev.preventDefault(); const tool = ctx.state.tool; use('select'); ctx.create.atCentre(tool)?.catch?.(console.error); return;
    }
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault(); moveSelected(ev.key === 'ArrowUp' ? -1 : 1); return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelected(); return; }
    const key = ev.key.length === 1 ? ev.key.toUpperCase() : '';
    const t = TOOLS.find((x) => x.key === key);
    if (t && (held || drag)) { ev.preventDefault(); return; } // a tool key waits for the pointer gesture to end (standards 2.10)
    if (t) { ev.preventDefault(); use(t.id); }
  });
  // a pointer button held anywhere: a drawing, a move, a marquee or a resize is in progress
  let held = false;
  document.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'touch') held = true; }, true);
  for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { held = false; }, true);
  addEventListener('blur', () => { held = false; });

  const api = { tools, use, editText, createComponent };
  ctx.tools = api;
  return api;
}
