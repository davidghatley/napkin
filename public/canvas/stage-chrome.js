// M11, zero chrome. Tab on the canvas hides every bit of chrome (top bar, layers, inspector, status bar, frame titles, rulers,
// selection outlines) so the canvas is the design; Tab again brings it back, focus where it was. The picture does not move:
// the view is shifted by the width of what left, so every frame stays under the same pixels.
//
// The ruling on Tab (WPC-07 keeps component content out of the Tab order, so Tab only ever walked the chrome):
//   - Tab pressed with focus on the canvas itself (the stage, not a control inside it) toggles zero chrome;
//   - while the chrome is hidden, Tab (anywhere but a text field) brings it back;
//   - in every other place (a button, a field, the layers tree, a dialog) Tab keeps its normal job: it moves focus.
//   A keyboard-only user who is not on the canvas gets the same through Cmd-K "Hide all chrome".
//   initChrome(ctx) -> ctx.chrome = { hide(), show(), toggle(), hidden() }
export function initChrome(ctx) {
  const stageEl = document.querySelector('#stage');
  let back = null; // what had focus when the chrome went away
  const hidden = () => document.body.dataset.chrome === 'hidden';
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role=dialog], [role=slider], #hl-bar, #theme-wipe, #play-bar, #ask-styles, #hl-pick, [data-nodrag]';

  function shiftView(before) {
    const after = stageEl.getBoundingClientRect(); // (reading it lays the page out with the new tracks)
    const v = ctx.view.get();
    ctx.view.set({ x: v.x + (before.left - after.left), y: v.y + (before.top - after.top), z: v.z });
  }
  function hide() {
    if (hidden()) return;
    const before = stageEl.getBoundingClientRect();
    back = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    document.body.dataset.chrome = 'hidden';
    if (!document.activeElement || document.activeElement === document.body || !document.activeElement.checkVisibility?.()) stageEl.focus({ preventScroll: true });
    shiftView(before);
    ctx.stage.refreshOverlays();
    ctx.emit('chrome', { hidden: true });
  }
  function show() {
    if (!hidden()) return;
    const before = stageEl.getBoundingClientRect();
    delete document.body.dataset.chrome;
    shiftView(before);
    const f = back && back.isConnected && back.checkVisibility?.() ? back : null;
    (f || stageEl).focus({ preventScroll: true });
    back = null;
    ctx.stage.refreshOverlays();
    ctx.emit('chrome', { hidden: false });
  }
  const toggle = () => (hidden() ? show() : hide());

  addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.isComposing) return;
    if (document.body.dataset.modal || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable) return;
    const onCanvas = ev.target === stageEl || (!!ev.target.closest?.('#stage') && !ev.target.closest(INTERACTIVE));
    if (!hidden() && (!onCanvas || ctx.highlight?.active())) return; // (while something is lit, Tab walks its places: stage-highlight.js)
    ev.preventDefault(); ev.stopImmediatePropagation();
    toggle();
  }, true);
  ctx.chrome = { hide, show, toggle, hidden };
  return ctx.chrome;
}
