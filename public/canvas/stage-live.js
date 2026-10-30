// M1, it's alive. Every HTML or JSX component is the real file running in its frame: animation, hover, focus and scroll work
// in place. Play mode lets the pointer and the keyboard in (editing chrome fades). Space then P plays it for as long as you
// hold both: let go and you are back to editing, with the same selection. P alone still toggles play mode (play.js).
//   initLive(ctx) -> ctx.live = { held(), frames() }
const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

export function initLive(ctx) {
  let held = null; // { wasOn, targets }
  const frameWindows = () => [...ctx.stage.sections.values()].map((s) => s.docFrame?.iframe()?.contentWindow).filter(Boolean);

  function end() {
    if (!held) return;
    const h = held; held = null;
    for (const t of h.targets) t.removeEventListener('keyup', up, true);
    delete document.body.dataset.playHold;
    if (!h.wasOn) ctx.play.set(false);
    document.querySelector('#stage').focus({ preventScroll: true }); // the keyboard comes back to the canvas
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true })); // the pan key the frame swallowed
  }
  function up(ev) {
    if (!held || (ev.code !== 'KeyP' && ev.code !== 'Space')) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); // (a Space released over a focused button must not press it)
    end();
  }
  function begin() {
    if (held) return;
    held = { wasOn: ctx.play.active(), targets: [window, ...frameWindows()] };
    document.body.dataset.playHold = '1';
    ctx.play.set(true);
    for (const t of held.targets) t.addEventListener('keyup', up, true);
    // the keyboard goes into the selected component's frame
    const id = ctx.state.selection?.component;
    ctx.stage.sections.get(id)?.docFrame?.iframe()?.contentWindow?.focus();
  }
  addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyP' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || typing(ev.target) || document.body.dataset.modal) return;
    if (!ctx.view.isPanning()) return; // Space is down: this is the hold, not a plain P
    ev.preventDefault(); ev.stopImmediatePropagation();
    begin();
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(); });
  // a Play control in the toolbar, as in the mockups: it toggles play mode (P), and shows the hold chord
  const mountButton = () => {
  const bar = document.querySelector('#toolbar');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'tool-play'; btn.setAttribute('aria-pressed', 'false'); btn.title = 'Play: the components run (P toggles; hold Space then P to play while held)';
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg><span>Play</span><kbd>Space P</kbd>';
  bar?.append(btn);
  btn.addEventListener('click', () => ctx.play.toggle());
  ctx.on('play', ({ on }) => btn.setAttribute('aria-pressed', String(on)));
  };
  ctx.live = { mountButton, held: () => !!held, frames: frameWindows };
  return ctx.live;
}
