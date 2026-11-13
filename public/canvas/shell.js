// The shell around the canvas (basics pass 1, docs/basics/standards.md sections 1 and 6): the chrome tooltip and the left panel's
// collapse. A control with data-tip shows its name (and data-key, its key) after 500 ms of hover, or at once on keyboard focus;
// Escape hides it. The left panel collapses with the bar's panel button or Ctrl+\ (commands.js runs the binding); the canvas takes
// the width, the picture stays under the same pixels (no animated slide: a moving canvas is harder to follow than a still one),
// and the choice is remembered.
//   initShell(ctx) -> ctx.shell = { toggleLeft(open?), leftOpen() }
const HOVER_MS = 500;
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function initShell(ctx) {
  const body = document.body, toggle = document.querySelector('#panel-toggle'), side = document.querySelector('#sidebar');

  // ---- the tooltip ----
  const tip = document.createElement('div');
  tip.id = 'tip'; tip.hidden = true; tip.setAttribute('aria-hidden', 'true'); // the control's own name and aria-keyshortcuts carry this for a screen reader
  body.append(tip);
  let timer = 0, owner = null;
  const keyText = (k) => (mac ? k.replace(/^Ctrl K$/, '⌘K') : k);
  function show(el) {
    clearTimeout(timer);
    owner = el;
    const key = el.dataset.key;
    tip.replaceChildren(document.createTextNode(el.dataset.tip));
    if (key) { const k = document.createElement('kbd'); k.textContent = keyText(key); tip.append(k); }
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)))}px`;
    tip.style.top = `${Math.round(r.bottom + 6)}px`;
  }
  function hide() { clearTimeout(timer); owner = null; tip.hidden = true; }
  const tipped = (t) => t?.closest?.('[data-tip]');
  document.addEventListener('pointerover', (ev) => {
    const el = tipped(ev.target);
    if (el === owner) return;
    hide();
    if (el && !el.disabled) timer = setTimeout(() => show(el), HOVER_MS);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', (ev) => { const el = tipped(ev.target); if (el && el === ev.target && el.matches(':focus-visible')) show(el); else if (owner) hide(); });
  document.addEventListener('focusout', () => { if (owner && !owner.matches(':hover')) hide(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !tip.hidden) hide(); });
  const qk = document.querySelector('#quick-open kbd');
  if (qk && mac) qk.textContent = '⌘K';

  // ---- the left panel ----
  let open = true;
  try { open = localStorage.getItem('napkin.left') !== 'closed'; } catch {}
  function apply() {
    body.dataset.left = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.dataset.tip = open ? 'Hide layers' : 'Show layers';
    side.inert = !open;
    if (owner === toggle) show(toggle);
  }
  function toggleLeft(want) {
    const next = typeof want === 'boolean' ? want : !open;
    if (next === open) return;
    if (!next && side.contains(document.activeElement)) toggle.focus(); // focus never stays in a panel that is going away
    const stageEl = document.querySelector('#stage'), before = stageEl.getBoundingClientRect();
    open = next;
    try { localStorage.setItem('napkin.left', open ? 'open' : 'closed'); } catch {}
    apply();
    const after = stageEl.getBoundingClientRect(), v = ctx.view?.get();
    if (v) ctx.view.set({ x: v.x + (before.left - after.left), y: v.y, z: v.z });
    ctx.stage?.refreshOverlays();
    ctx.emit('shell', { left: open });
  }
  toggle.addEventListener('click', () => toggleLeft());
  apply();

  ctx.shell = { toggleLeft, leftOpen: () => open };
  return ctx.shell;
}
