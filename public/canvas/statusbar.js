// The status bar (docs/basics/standards.md sections 1 and 10): quiet counts at the left, the drawer toggles after them (drawer.js
// adds those), a legend slot that shows keys only while a mode has the keyboard (legend.js), and the zoom control at the right:
// minus, the percentage (it opens the presets), plus, Fit. Every command it runs is an action of actions.js; keys are spelled by
// keylabel.js. Minus is dimmed at the smallest zoom and plus at the largest; they keep the focus and do nothing there.
//   initStatusbar(ctx) -> { counts(), menu: { open({ keyboard }), close(), isOpen() } }
// The presets menu looks like the right-click menu (context-menu.css: .nk-menu, .nk-mi) and keeps its keys: Down / Up (wrap),
// Home / End, Enter or Space runs, Escape or Tab closes and puts the focus back on the percentage. It opens above the bar.
import { ACTIONS } from './actions.js';
import { keyLabel } from './keylabel.js';
import { MIN_Z, MAX_Z } from './view.js';

const byId = new Map(ACTIONS.map((a) => [a.id, a]));
const PRESETS = [['fit', 'fit-selection'], ['zoom-50', 'actual', 'zoom-200']];
const EDGE = 8; // the menu keeps this far inside the window
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initStatusbar(ctx) {
  const $ = (s) => document.querySelector(s);
  const countsEl = $('#counts'), out = $('#zoom-out'), lvl = $('#zoom-level'), inn = $('#zoom-in'), fit = $('#zoom-fit');
  const run = (id) => byId.get(id)?.run?.(ctx);

  // ---- counts: what is in the folder, and what is selected. From the documents, never the cards on screen, so zoom never changes it (WPC-35).
  const fmt = (n) => n.toLocaleString('en');
  function counts() {
    const n = ctx.state.components.total, sel = ctx.state.selections?.length || 0;
    const t = `${fmt(n)} file${n === 1 ? '' : 's'}${sel ? ` · ${fmt(sel)} selected` : ''}`;
    if (countsEl.textContent !== t) countsEl.textContent = t;
  }
  for (const e of ['added', 'removed', 'select', 'glances', 'render']) ctx.on(e, counts);

  // ---- zoom: the percentage, and the ends of the range
  let shown = '';
  const atMin = (z) => z <= MIN_Z * 1.0001, atMax = (z) => z >= MAX_Z * 0.9999;
  const off = (b, yes) => { if ((b.getAttribute('aria-disabled') === 'true') !== yes) b.setAttribute('aria-disabled', String(yes)); };
  function zoomShown({ z }) {
    const t = `${Math.round(z * 100)}%`;
    if (t !== shown) { shown = t; lvl.textContent = t; lvl.setAttribute('aria-label', `Zoom ${t}, presets`); }
    off(out, atMin(z)); off(inn, atMax(z));
  }
  ctx.on('view', zoomShown);
  zoomShown(ctx.view.get());
  out.addEventListener('click', () => { if (!atMin(ctx.view.get().z)) run('zoom-out'); });
  inn.addEventListener('click', () => { if (!atMax(ctx.view.get().z)) run('zoom-in'); });
  fit.addEventListener('click', () => run('fit'));

  // ---- the presets menu
  const menu = document.createElement('div');
  menu.id = 'zoom-menu'; menu.className = 'nk-menu'; menu.hidden = true; menu.tabIndex = -1;
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Zoom');
  document.body.append(menu);
  lvl.setAttribute('aria-haspopup', 'menu'); lvl.setAttribute('aria-expanded', 'false'); lvl.setAttribute('aria-controls', 'zoom-menu');

  const enabled = (a) => { try { return a.enabled ? a.enabled(ctx) : true; } catch { return 'Not available'; } };
  function paint() {
    menu.innerHTML = PRESETS.map((g) => g.map((id) => {
      const a = byId.get(id), on = enabled(a), keys = a.spec ? keyLabel(a.spec) : '';
      return `<div role="menuitem" class="nk-mi" tabindex="-1" data-action="${esc(id)}"${on === true ? '' : ` aria-disabled="true" title="${esc(on)}"`}><span class="nk-ml">${esc(a.short ?? a.label)}</span>${keys ? `<kbd class="nk-mk">${esc(keys)}</kbd>` : ''}</div>`;
    }).join('')).join('<div class="nk-msep" role="separator"></div>');
  }
  const items = () => [...menu.querySelectorAll('.nk-mi')];
  const live = () => items().filter((i) => i.getAttribute('aria-disabled') !== 'true');
  const focusItem = (i) => i?.focus({ preventScroll: true });
  const isOpen = () => !menu.hidden;
  function place() {
    const b = lvl.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    const above = lvl.closest('#statusbar').getBoundingClientRect().top - 4; // 4 px over the bar, its right edge on the percentage's
    const left = Math.max(EDGE, Math.min(innerWidth - EDGE - w, b.right - w)), top = Math.max(EDGE, above - h);
    menu.style.left = `${left}px`; menu.style.top = `${top}px`;
    menu.dataset.flip = 'xy'; // grows from its bottom right corner, the percentage's
  }
  function open({ keyboard = false } = {}) {
    ctx.menu?.close?.();
    paint(); menu.hidden = false; lvl.setAttribute('aria-expanded', 'true');
    menu.classList.remove('nk-in'); void menu.offsetWidth; menu.classList.add('nk-in');
    place();
    if (keyboard) focusItem(live()[0]); else menu.focus({ preventScroll: true });
  }
  function close({ restore = true } = {}) {
    if (!isOpen()) return;
    menu.hidden = true; lvl.setAttribute('aria-expanded', 'false');
    if (restore) lvl.focus({ preventScroll: true });
  }
  function choose(i) {
    if (!i || i.getAttribute('aria-disabled') === 'true') return;
    close(); run(i.dataset.action);
  }
  lvl.addEventListener('click', (ev) => { if (isOpen()) close(); else open({ keyboard: ev.detail === 0 }); }); // detail 0: Enter or Space on the button
  menu.addEventListener('pointermove', (ev) => { const i = ev.target.closest?.('.nk-mi'); if (i && document.activeElement !== i) focusItem(i); });
  menu.addEventListener('pointerleave', () => { if (menu.contains(document.activeElement)) menu.focus({ preventScroll: true }); });
  menu.addEventListener('click', (ev) => choose(ev.target.closest?.('.nk-mi')));
  addEventListener('pointerdown', (ev) => { if (isOpen() && !menu.contains(ev.target) && !lvl.contains(ev.target)) close({ restore: false }); }, true);
  addEventListener('resize', () => close({ restore: false }));
  ctx.on('menu', ({ open: o } = {}) => { if (o) close({ restore: false }); });
  ctx.on('view', () => close({ restore: false })); ctx.on('tool', () => close({ restore: false })); // the canvas moved or the tool changed: the presets no longer apply to what is shown

  document.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    const key = ev.key;
    if (ev.target === lvl && !isOpen() && (key === 'ArrowUp' || key === 'ArrowDown')) { ev.preventDefault(); ev.stopImmediatePropagation(); open({ keyboard: true }); return; }
    if (!isOpen() || !(menu.contains(ev.target) || ev.target === lvl)) return;
    const list = live(), at = list.indexOf(document.activeElement);
    const stop = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    if (key === 'Escape') { stop(); close(); }
    else if (key === 'Tab') { close({ restore: false }); }
    else if (key === 'ArrowDown') { stop(); focusItem(list[(at + 1) % list.length]); }
    else if (key === 'ArrowUp') { stop(); focusItem(list[(at - 1 + list.length) % list.length]); }
    else if (key === 'Home') { stop(); focusItem(list[0]); }
    else if (key === 'End') { stop(); focusItem(list.at(-1)); }
    else if ((key === 'Enter' || key === ' ') && menu.contains(ev.target)) { stop(); choose(document.activeElement); }
  }, true);

  counts();
  return { counts, menu: { open, close, isOpen } };
}
