// The right panel's width (docs/basics/standards.md section 7 rule 8, decision 0023): one panel that stays in the sidebar and never covers
// the canvas. Its left edge is a separator: drag it (col-resize), double-click it to go back to 280 px, or focus it and use Left/Right
// (Shift for bigger steps) and Home/End. The width lives in one custom property, --nk-right-w, on the root element; the shell grid
// reads it, so the canvas column reflows and nothing overlaps it. The panel is an `inspector` size container, so its sections can
// show more as it gets wider. The width is remembered (localStorage 'napkin.right'; index.html restores it before the first paint)
// and clamped again when the window changes size.
// Ctrl+Shift+\ (or the header's button) hides the panel and the canvas takes the width; the same key, or selecting something on the
// canvas, brings it back. Hidden or not is remembered too ('napkin.right.open').
// A wider panel never hides what is selected: if the selection was wholly in view before the canvas gave up the width, the camera
// moves it back into view (by the width taken, or less), and only if it no longer fits is it fitted again (keep()).
//   initRightPanel(ctx) -> ctx.rightPanel = { width(), setWidth(px, { save }), reset(), bounds(), toggle(open?), isOpen() }

export const RIGHT_DEFAULT = 280, RIGHT_MIN = 240;
const KEY = 'napkin.right', STEP = 8, BIG = 64;
export const rightMax = () => Math.round(Math.max(480, innerWidth / 2));
export const clampRight = (w) => Math.round(Math.min(rightMax(), Math.max(RIGHT_MIN, Number(w) || RIGHT_DEFAULT)));

export function initRightPanel(ctx) {
  const root = document.documentElement, edge = document.querySelector('#right-edge');
  let wanted = RIGHT_DEFAULT;
  try { wanted = Number(localStorage.getItem(KEY)) || RIGHT_DEFAULT; } catch {}
  let shown = 0;

  // The selection on screen (with room for its handles), in page pixels; null when nothing is selected or it is not drawn.
  const HANDLE = 8;
  function selBox() {
    if (!ctx.state?.selections?.length || !ctx.view || !ctx.stage?.selectionRect) return null;
    let r = null; try { r = ctx.stage.selectionRect(); } catch { return null; }
    if (!r || !(r.w >= 0)) return null;
    const v = ctx.view.get(), st = document.querySelector('#stage').getBoundingClientRect();
    return { l: st.left + v.x + r.x * v.z - HANDLE, t: st.top + v.y + r.y * v.z - HANDLE, r: st.left + v.x + (r.x + r.w) * v.z + HANDLE, b: st.top + v.y + (r.y + r.h) * v.z + HANDLE, world: r };
  }
  const within = (s, b) => s.l >= b.left - 0.5 && s.r <= b.right + 0.5 && s.t >= b.top - 0.5 && s.b <= b.bottom + 0.5;
  // Run a change of the canvas's width and keep the selection in view through it.
  function keep(change) {
    const stage = document.querySelector('#stage'), s0 = selBox(), b0 = stage?.getBoundingClientRect();
    const out = change();
    if (!s0 || !b0 || !within(s0, b0)) return out; // it was not wholly in view: the person's view is left alone
    const b1 = stage.getBoundingClientRect(); // (a layout now: the grid has the new width)
    if (within(s0, b1)) return out;
    const room = b1.width - (s0.r - s0.l);
    if (room >= 0) { // it fits: slide it left by what is missing (never past the left edge)
      const dx = Math.max(b1.left - s0.l, b1.right - s0.r - Math.min(16, room / 2));
      ctx.view.stop?.(); ctx.view.panBy(dx, 0);
    } else { // it no longer fits at this zoom: fit it into the new width (never closer), its middle at the same height
      const r = s0.world, v = ctx.view.get(), z = Math.min(v.z, (b1.width - 2 * (HANDLE + 16)) / Math.max(r.w, 1)), cy = v.y + (r.y + r.h / 2) * v.z;
      ctx.view.stop?.(); ctx.view.set({ z, x: b1.width / 2 - (r.x + r.w / 2) * z, y: cy - (r.y + r.h / 2) * z });
    }
    return out;
  }

  function apply(w) {
    const next = clampRight(w);
    edge.setAttribute('aria-valuemin', String(RIGHT_MIN));
    edge.setAttribute('aria-valuemax', String(rightMax()));
    edge.setAttribute('aria-valuenow', String(next));
    edge.setAttribute('aria-valuetext', `${next} pixels`);
    if (next === shown) return next;
    shown = next;
    keep(() => root.style.setProperty('--nk-right-w', next + 'px'));
    ctx.stage?.refreshOverlays?.();
    ctx.emit?.('shell', { right: next });
    return next;
  }
  function setWidth(w, { save = true } = {}) {
    wanted = clampRight(w);
    if (save) { try { localStorage.setItem(KEY, String(wanted)); } catch {} }
    return apply(wanted);
  }
  const reset = () => setWidth(RIGHT_DEFAULT);

  // Drag: the edge follows the pointer; the pointer is captured so the canvas's frames never take the move.
  let drag = null;
  // The press is the edge's alone: the canvas's own gestures (marquee, pan) never start from it. Moves are read on the window in the
  // capture phase too, so the drag holds even where another layer takes the pointer.
  const move = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    setWidth(drag.w + (drag.x - ev.clientX), { save: false });
  };
  const end = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    drag = null;
    delete document.body.dataset.resizing;
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', end, true);
    removeEventListener('pointercancel', end, true);
    setWidth(shown);
  };
  edge.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    try { edge.setPointerCapture(ev.pointerId); } catch {}
    drag = { id: ev.pointerId, x: ev.clientX, w: shown };
    document.body.dataset.resizing = 'right';
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', end, true);
    addEventListener('pointercancel', end, true);
  });
  edge.addEventListener('dblclick', reset);

  // Keys: the edge moves the way the arrow points (Left widens the panel).
  edge.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const step = ev.shiftKey ? BIG : STEP;
    const to = { ArrowLeft: shown + step, ArrowRight: shown - step, Home: RIGHT_MIN, End: rightMax(), Enter: RIGHT_DEFAULT }[ev.key];
    if (to === undefined) return;
    ev.preventDefault(); ev.stopPropagation();
    setWidth(to);
  });

  addEventListener('resize', () => apply(wanted));
  apply(wanted);

  // Hide and show. The stage keeps its place on screen: the canvas grows to the right, nothing under the pointer moves.
  const insp = document.querySelector('#inspector'), body = document.body;
  let open = true;
  try { open = localStorage.getItem(KEY + '.open') !== 'closed'; } catch {}
  function show() {
    body.dataset.right = document.documentElement.dataset.right = open ? 'open' : 'closed';
    insp.inert = !open; edge.inert = !open;
  }
  function toggle(want) {
    const next = typeof want === 'boolean' ? want : !open;
    if (next === open) return open;
    if (!next && (insp.contains(document.activeElement) || edge === document.activeElement)) document.querySelector('#stage')?.focus({ preventScroll: true }); // focus never stays in a panel that is going away
    open = next;
    try { localStorage.setItem(KEY + '.open', open ? 'open' : 'closed'); } catch {}
    keep(show);
    ctx.stage?.refreshOverlays?.();
    ctx.emit?.('shell', { right: open ? shown : 0 });
    return open;
  }
  show();
  ctx.on?.('select', () => { if (!open && ctx.state.selection) toggle(true); });
  ctx.rightPanel = { width: () => shown, setWidth, reset, bounds: () => ({ min: RIGHT_MIN, max: rightMax(), default: RIGHT_DEFAULT }), toggle, isOpen: () => open };
  return ctx.rightPanel;
}
