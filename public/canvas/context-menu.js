// Right-click menus (docs/basics/standards.md section 8): one menu, filled only from the command registry (actions.js), for
// what is under the pointer: the empty canvas, a frame (a file's card), an element inside a frame, several selected things, or
// a row of the layers panel. Groups come in one order everywhere (edit, arrange, create, view, delete) with a 1 px rule between
// them; each item shows the command's key at the right through keylabel.js; an item that does not apply now stays, dimmed, and
// says why. Order is the one submenu.
//   Open: right-click; Shift+F10 or the Menu key while the canvas or the layers panel has the keyboard (at the selection, or the
//   middle of the canvas). Keys: Down / Up (wrap), Home / End, a letter jumps, Right or Enter opens the submenu, Left closes it,
//   Enter or Space runs, Escape closes one level and puts the focus back where it was. Closes on a press outside, the wheel, a
//   scroll, a zoom or pan, a tool change, the window losing focus or changing size.
//   Text fields keep the browser's own menu; so does a component in play mode (it is live, the menu is its own).
//   initContextMenu(ctx) -> ctx.menu = { open(kind, at, opts), openRow(row, at, opts), openAtSelection(), close(), isOpen(), target() }
import { ACTIONS } from './actions.js';
import { keyLabel, MAC } from './keylabel.js';

const byId = new Map(ACTIONS.map((a) => [a.id, a]));
const ORDER = { sub: 'Order', items: ['bring-forward', 'send-backward', 'bring-to-front', 'send-to-back'] };
// The item sets, as action ids in five groups: edit, arrange, create, view, delete.
export const MENUS = {
  canvas: [['paste'], [], ['frame', 'text', 'image'], ['select-all', 'fit', 'actual', 'toggle-left'], []],
  frame: [['paste', 'component-rename'], [], ['frame', 'text', 'image'], ['fit-selection', 'open-code'], ['component-delete']],
  element: [['cut', 'copy', 'paste', 'duplicate', 'rename'], ['select-parent', 'select-children', ORDER, 'wrap'], ['create-component'], ['fit-selection', 'open-code'], ['delete']],
  several: [['cut', 'copy', 'duplicate'], ['select-parent', 'wrap'], ['create-component'], ['fit-selection'], ['delete']],
  file: [[], [], [], ['fit-selection'], []], // a picture, a stylesheet, a text file: napkin shows it, it does not edit it here; or several cards
};
const ROW = ['layer-toggle']; // a layer row adds these to its item's view group
const GAP = 2;                // the menu opens this far from the pointer, so the pointer is never on an item
const EDGE = 8;               // and keeps this far inside the window
const HOVER_MS = 150;         // a submenu opens after this long on its item

const editable = (t) => !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') || !!t?.isContentEditable;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CHEVRON = '<svg class="ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m6.5 4.5 3.5 3.5-3.5 3.5"/></svg>';

export function initContextMenu(ctx) {
  const make = (id) => { const m = document.createElement('div'); m.id = id; m.className = 'nk-menu'; m.setAttribute('role', 'menu'); m.tabIndex = -1; m.hidden = true; document.body.append(m); return m; };
  const menu = make('ctxmenu'), sub = make('ctxmenu-sub');
  sub.setAttribute('aria-label', 'Order');
  let state = null;     // { kind, target, back: element focus returns to, backKey: a layer row's key, at }
  let subTimer = 0, kbdAt = 0;

  // ---------------------------------------------------------------------------------------------------- what an item shows
  const label = (a) => (typeof a.short === 'function' ? a.short(ctx) : a.short ?? a.label);
  const enabled = (a) => { try { return a.enabled ? a.enabled(ctx) : true; } catch { return 'Not available'; } };
  // The key shown: the binding in force for a command (the key map's own), else the action's spec; one helper spells it.
  function keysOf(a) {
    if (a.command) { const b = ctx.surface?.bindings().find((x) => x.command === a.id); return b?.keys || ''; }
    return a.spec || '';
  }
  function itemHtml(a, i) {
    const on = enabled(a), keys = keysOf(a), text = keys ? keyLabel(keys) : '';
    return `<div role="menuitem" class="nk-mi" tabindex="-1" data-action="${esc(a.id)}" data-i="${i}"${on === true ? '' : ` aria-disabled="true" title="${esc(on)}"`}${keys && !keys.includes(' ') ? ` aria-keyshortcuts="${esc(keys.replace(/\bMod\b/, MAC ? 'Meta' : 'Control').replace(/\bCtrl\b/, 'Control'))}"` : ''}><span class="nk-ml">${esc(label(a))}</span>${text ? `<kbd class="nk-mk">${esc(text)}</kbd>` : ''}</div>`;
  }
  // Groups -> rows: items that never apply are left out; empty groups go; one rule between groups.
  function rows(groups) {
    const out = [];
    for (const g of groups) {
      const list = [];
      for (const x of g) {
        if (typeof x === 'object') { const kids = x.items.map((id) => byId.get(id)).filter((a) => a && enabled(a) !== null); if (kids.length) list.push({ sub: x.sub, kids }); continue; }
        const a = byId.get(x);
        if (a && enabled(a) !== null) list.push({ a });
      }
      if (list.length) { if (out.length) out.push({ sep: true }); out.push(...list); }
    }
    return out;
  }
  function paint(el, list) {
    el.innerHTML = list.map((r, i) => (r.sep ? '<div role="separator" class="nk-msep"></div>'
      : r.sub ? `<div role="menuitem" class="nk-mi" tabindex="-1" aria-haspopup="menu" aria-expanded="false" aria-controls="ctxmenu-sub" data-sub="${i}"${r.kids.every((a) => enabled(a) !== true) ? ' aria-disabled="true" title="Nothing to reorder here"' : ''}><span class="nk-ml">${esc(r.sub)}</span>${CHEVRON}</div>`
      : itemHtml(r.a, i))).join('');
  }
  const items = (el) => [...el.querySelectorAll('[role=menuitem]')];

  // ---------------------------------------------------------------------------------------------------- where it opens
  // At the pointer, flipped at the right and bottom edges so it stays in the window, never under the pointer; clamped when
  // neither side has room.
  function place(el, x, y, avoid) {
    el.style.left = '0px'; el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight, W = innerWidth, H = innerHeight;
    let left = x + GAP, top = y + GAP, fx = false, fy = false;
    if (left + w > W - EDGE) { left = (avoid ? avoid.left : x) - GAP - w; fx = true; }
    if (left < EDGE) left = Math.max(EDGE, Math.min(W - EDGE - w, x + GAP));
    if (top + h > H - EDGE) { top = y - GAP - h; fy = true; }
    if (top < EDGE) top = Math.max(EDGE, H - EDGE - h);
    el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
    el.dataset.flip = `${fx ? 'x' : ''}${fy ? 'y' : ''}`;
  }

  // ---------------------------------------------------------------------------------------------------- open, close
  // kind: one of MENUS; at: { x, y } in page pixels; opts: { keyboard, row, title }
  function open(kind, at, opts = {}) {
    close({ restore: false });
    const back = document.activeElement;
    state = { kind, target: { kind, row: opts.row ?? null }, back: back && back !== document.body ? back : null, backKey: opts.row && back?.closest?.('#layers .lrow') ? ctx.layers?.key(opts.row) : null, at, t: performance.now() };
    const groups = MENUS[kind].map((g) => [...g]);
    if (opts.row) groups[3].push(...ROW);
    const list = rows(groups);
    state.list = list;
    paint(menu, list);
    menu.setAttribute('aria-label', opts.title || 'Canvas');
    menu.hidden = false;
    menu.classList.remove('nk-in'); void menu.offsetWidth; menu.classList.add('nk-in');
    place(menu, at.x, at.y);
    document.body.dataset.menu = kind;
    if (opts.keyboard) focusItem(menu, firstOn(menu)); else menu.focus({ preventScroll: true });
    ctx.emit('menu', { open: true, kind });
  }
  function close({ restore = true } = {}) {
    if (!state) return;
    const s = state; state = null;
    closeSub(false);
    menu.hidden = true; menu.innerHTML = '';
    delete document.body.dataset.menu;
    if (restore) {
      let to = s.back;
      if (s.backKey && !to?.isConnected) to = ctx.layers?.find(s.backKey); // the layers redraw their rows: the same row, by its key
      if (to?.isConnected) { if (to.matches('#layers .lrow')) to.tabIndex = 0; to.focus({ preventScroll: true }); }
      else if (menu.contains(document.activeElement) || document.activeElement === menu) document.activeElement.blur();
    }
    ctx.emit('menu', { open: false });
  }
  const isOpen = () => !!state;

  // ---------------------------------------------------------------------------------------------------- the submenu
  function openSub(parent, { focus = false } = {}) {
    clearTimeout(subTimer);
    if (parent.getAttribute('aria-disabled') === 'true') return;
    const r = state.list[Number(parent.dataset.sub)];
    if (!sub.hidden && sub.dataset.of === parent.dataset.sub) { if (focus) focusItem(sub, firstOn(sub)); return; }
    paint(sub, r.kids.map((a) => ({ a })));
    sub.dataset.of = parent.dataset.sub;
    sub.hidden = false;
    sub.classList.remove('nk-in'); void sub.offsetWidth; sub.classList.add('nk-in');
    const b = parent.getBoundingClientRect(), m = menu.getBoundingClientRect();
    place(sub, m.right - GAP - 4, b.top - 4 - GAP, m); // beside the menu, its first item level with the parent; to the left when the right is short
    parent.setAttribute('aria-expanded', 'true');
    if (focus) focusItem(sub, firstOn(sub));
  }
  function closeSub(refocus) {
    clearTimeout(subTimer);
    if (sub.hidden) return;
    const p = menu.querySelector('[aria-expanded="true"]');
    sub.hidden = true; sub.innerHTML = ''; delete sub.dataset.of;
    p?.setAttribute('aria-expanded', 'false');
    if (refocus && p) focusItem(menu, p);
  }

  // ---------------------------------------------------------------------------------------------------- moving and running
  const firstOn = (el) => items(el).find((x) => x.getAttribute('aria-disabled') !== 'true') || items(el)[0];
  function focusItem(el, item) { if (!item) return; for (const x of items(el)) x.tabIndex = -1; item.tabIndex = 0; item.focus({ preventScroll: true }); }
  const current = () => (sub.contains(document.activeElement) ? sub : menu);
  async function run(item) {
    if (!item || item.getAttribute('aria-disabled') === 'true') return;
    if (item.dataset.sub) { openSub(item, { focus: true }); return; }
    const a = byId.get(item.dataset.action);
    const target = state?.target;
    close({ restore: true });
    if (!a?.run) return;
    try { pending = target; await a.run(ctx); } catch (e) { ctx.hint(`Could not ${label(a).toLowerCase()}: ${e.message || e}`); } finally { pending = null; }
  }
  let pending = null; // the target of the item being run (a layer row's Expand reads it after the menu is gone)

  function onKey(ev) {
    if (!state) return false;
    const el = current(), list = items(el), i = list.indexOf(document.activeElement);
    const go = (j) => focusItem(el, list[(j + list.length) % list.length]);
    const k = ev.key;
    if (k === 'ArrowDown') go(i < 0 ? 0 : i + 1);
    else if (k === 'ArrowUp') go(i < 0 ? list.length - 1 : i - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(list.length - 1);
    else if (k === 'ArrowRight') { if (el === menu && list[i]?.dataset.sub) openSub(list[i], { focus: true }); }
    else if (k === 'ArrowLeft') { if (el === sub) closeSub(true); }
    else if (k === 'Enter' || k === ' ') run(list[i]);
    else if (k === 'Escape') { if (el === sub) closeSub(true); else close({ restore: true }); }
    else if (k === 'Tab') close({ restore: true });
    else if (k.length === 1 && /\S/.test(k) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      // a letter jumps to the next item whose name starts with it
      const ch = k.toLowerCase(), n = list.length;
      for (let s = 1; s <= n; s++) { const x = list[(i + s + n) % n]; if (x.querySelector('.nk-ml').textContent.trim().toLowerCase().startsWith(ch)) { focusItem(el, x); break; } }
    } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return true; // any other key: the menu keeps the keyboard and lets it go
    return true;
  }

  // ---------------------------------------------------------------------------------------------------- targets
  const comp = (id) => ctx.state.components.get(id);
  const keyOf = (s) => `${s.component}|${s.node}`;
  const has = (sel) => ctx.state.selections.some((s) => keyOf(s) === keyOf(sel));
  function cardSel(id) {
    const c = comp(id);
    if (!c) return null;
    if (c.item) return { component: id, node: 'item', variant: {}, card: true };
    if (c.doc) return { component: id, node: c.doc.root.id, variant: Object.fromEntries((c.doc.props || []).filter((p) => p.type === 'enum').map((p) => [p.name, p.default])), card: true };
    return { component: id, node: ctx.stage.rootNode?.(id) ?? '', variant: {}, card: true };
  }
  // the menu that fits the selection as it is now
  function kindNow() {
    const sels = ctx.state.selections;
    if (!sels.length) return 'canvas';
    if (sels.length > 1) return sels.every((s) => s.card || s.node === 'item') ? 'file' : 'several';
    const s = sels[0], c = comp(s.component);
    if (!c || c.item || (c.readOnly && !c.doc)) return 'file';
    return s.card ? 'frame' : 'element';
  }
  const titleOf = (kind) => {
    const s = ctx.state.selection, c = s && comp(s.component), name = c ? ctx.title(c) : '';
    return kind === 'canvas' ? 'Canvas' : kind === 'several' || (kind === 'file' && ctx.state.selections.length > 1) ? `${ctx.state.selections.length} selected` : kind === 'element' ? `${s.node} in ${name}` : name;
  };
  // What is under a point of the canvas: an element of a frame, a frame (its title or its empty part), or the canvas.
  function hitCanvas(t, x, y) {
    const el = t.closest?.('.mount [data-n]'), cell = el?.closest('.cell');
    if (el && cell) return { component: cell.closest('.cmp, .item-card').dataset.component, node: el.dataset.n, variant: JSON.parse(cell.dataset.variant || '{}') };
    const card = t.closest?.('.cmp, .item-card');
    if (!card) return null;
    const id = card.dataset.component, f = ctx.stage.sections.get(id)?.docFrame;
    if (f && t.closest('.doc-cell')) {
      const p = f.pick(x, y), node = p?.dataset.n, tag = node && f.node(node)?.tag;
      if (node && !['html', 'body', 'head'].includes(tag)) return { component: id, node, variant: {} };
    }
    return cardSel(id);
  }
  function openCanvas(t, x, y) {
    const sel = hitCanvas(t, x, y);
    if (!sel) { if (ctx.state.selections.length) ctx.select(null); } // the empty canvas: like a click there, the selection clears
    else if (!has(sel)) ctx.select(sel); // an unselected thing is selected first; a selected one keeps the whole selection
    const kind = kindNow();
    open(kind, { x, y }, { title: titleOf(kind) });
  }
  function openRow(row, at, opts = {}) {
    if (!row?.dataset.component) return;
    const id = row.dataset.component, c = comp(id);
    const sel = row.dataset.kind === 'component' ? cardSel(id) : null;
    if (sel) { if (!has(sel)) ctx.select(sel); }
    else { const k = `${id}|${row.dataset.node}`; if (!ctx.state.selections.some((s) => keyOf(s) === k)) ctx.layers?.pick(row); }
    const live = ctx.layers?.find(ctx.layers.key(row)) || row; // (the pick may have redrawn the rows)
    const kind = !c || c.item ? 'file' : kindNow();
    if (!at) { const r = live.getBoundingClientRect(); at = { x: r.left + 24, y: r.bottom - GAP }; }
    open(kind, at, { ...opts, row: live, title: titleOf(kind) });
  }
  // From the keyboard: at the selection's top-left, or the middle of the canvas.
  function openAtSelection() {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    let at = { x: stage.left + stage.width / 2, y: stage.top + stage.height / 2 };
    const boxes = ctx.state.selections.map((s) => (s.card || s.node === 'item' ? ctx.stage.sections.get(s.component)?.el : ctx.stage.cellElement(s.component, s.node, s.variant))).filter(Boolean).map((e) => e.getBoundingClientRect());
    if (boxes.length) at = { x: Math.min(...boxes.map((b) => b.left)), y: Math.min(...boxes.map((b) => b.top)) };
    at = { x: Math.max(stage.left, Math.min(stage.right - 1, at.x)), y: Math.max(stage.top, Math.min(stage.bottom - 1, at.y)) };
    const kind = kindNow();
    open(kind, at, { keyboard: true, title: titleOf(kind) });
  }

  // ---------------------------------------------------------------------------------------------------- events
  document.addEventListener('contextmenu', (ev) => {
    const t = ev.target;
    if (performance.now() - kbdAt < 600) { ev.preventDefault(); return; } // the menu the key just opened (Shift+F10 and the Menu key also send this)
    if (menu.contains(t) || sub.contains(t)) { ev.preventDefault(); return; }
    if (editable(t)) return; // fields keep the browser's menu: spelling, paste, select all
    const row = t.closest?.('#layers .lrow[data-component]');
    if (row) { ev.preventDefault(); openRow(row, { x: ev.clientX, y: ev.clientY }); return; }
    if (!t.closest?.('#stage') || document.body.dataset.play || t.closest('#doc-dock, #time, .proposal, details, pre')) return; // in play the component is live and the menu is its own
    ev.preventDefault();
    openCanvas(t, ev.clientX, ev.clientY);
  }, true);
  // The menu keeps the keyboard while it is open (registered before the other canvas keys, on the window, so it hears them first).
  addEventListener('keydown', (ev) => {
    if (state) { if (onKey(ev)) { ev.preventDefault(); ev.stopImmediatePropagation(); } return; }
    if (!((ev.key === 'F10' && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) || ev.key === 'ContextMenu') || ev.isComposing) return;
    const t = ev.target;
    if (editable(t) || document.body.dataset.modal) return;
    const row = t.closest?.('#layers .lrow[data-component]');
    const canvas = !t || t === document.body || t === document.documentElement || !!t.closest?.('#stage');
    if (!row && !canvas) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    kbdAt = performance.now();
    if (row) openRow(row, null, { keyboard: true }); else openAtSelection();
  }, true);
  for (const el of [menu, sub]) {
    el.addEventListener('click', (ev) => { const it = ev.target.closest('[role=menuitem]'); if (it) run(it); });
    el.addEventListener('pointermove', (ev) => {
      const it = ev.target.closest('[role=menuitem]');
      if (!it || it === document.activeElement) return;
      focusItem(el, it);
      if (el === menu) {
        clearTimeout(subTimer);
        if (it.dataset.sub) subTimer = setTimeout(() => openSub(it), HOVER_MS);
        else if (!sub.hidden) subTimer = setTimeout(() => closeSub(false), HOVER_MS);
      }
    });
    el.addEventListener('pointerleave', (ev) => { if (!sub.contains(ev.relatedTarget) && !menu.contains(ev.relatedTarget) && state) { const f = document.activeElement; if (el.contains(f) && !f.dataset.sub) el.focus({ preventScroll: true }); } });
    el.addEventListener('pointerenter', () => { if (el === sub) clearTimeout(subTimer); });
  }
  document.addEventListener('pointerdown', (ev) => { if (state && !menu.contains(ev.target) && !sub.contains(ev.target)) close({ restore: false }); }, true);
  addEventListener('wheel', (ev) => { if (state && !menu.contains(ev.target) && !sub.contains(ev.target)) close({ restore: false }); }, { capture: true, passive: true });
  // a scroll or a view change the opening itself set off (the layers reveal the row just selected) does not count
  const settled = () => state && performance.now() - state.t > 300;
  addEventListener('scroll', (ev) => { if (settled() && !menu.contains(ev.target) && !sub.contains(ev.target)) close({ restore: false }); }, true);
  addEventListener('blur', () => close({ restore: false }));
  addEventListener('resize', () => close({ restore: false }));
  ctx.on('view', () => { if (settled()) close({ restore: false }); });
  ctx.on('tool', () => close({ restore: false }));

  const api = { open, openRow, openAtSelection, close, isOpen, target: () => state?.target ?? pending, kind: () => state?.kind ?? null, menus: MENUS };
  ctx.menu = api;
  return api;
}
