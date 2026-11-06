// CMP-09: play mode. P turns every cell from a drawing into the live React component: pointer and keyboard events reach it
// (buttons press, take focus and show :active), and the selection overlays and handles step aside. A small bar on the stage
// lets you type into the component's settings (text, on / off, number) and every cell re-renders with those values, like a
// Storybook control. Nothing here is written to a file: the values live in this tab until you leave play mode or reload.
// `ctx.play` = { active(), set(on), toggle(), props(component), setProp(component, name, value), reset(component) }.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initPlay(ctx) {
  const live = new Map(); // component id -> { prop: value }
  let on = false;
  const bar = document.createElement('div');
  bar.id = 'play-bar'; bar.hidden = true; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Play mode');
  document.querySelector('#stage').append(bar);

  const target = () => { const id = ctx.state.selection?.component ?? [...ctx.state.components.keys()][0]; return id && ctx.state.components.get(id) ? id : null; };

  function paint() {
    const id = target(), c = id && ctx.state.components.get(id);
    const focus = document.activeElement?.closest?.('#play-bar') ? { id: document.activeElement.id, s: document.activeElement.selectionStart, e: document.activeElement.selectionEnd } : null;
    const vals = live.get(id) || {};
    const fields = (c?.doc?.props || []).filter((p) => p.type !== 'enum').map((p) => {
      const v = vals[p.name] ?? p.default;
      const label = `<label for="play-prop-${esc(p.name)}">${esc(p.name)}</label>`;
      if (p.type === 'boolean') return `<span class="pfield">${label}<input type="checkbox" id="play-prop-${esc(p.name)}" data-play-prop="${esc(p.name)}" data-kind="boolean"${v ? ' checked' : ''}></span>`;
      return `<span class="pfield">${label}<input id="play-prop-${esc(p.name)}" data-play-prop="${esc(p.name)}" data-kind="${p.type}" autocomplete="off" value="${esc(v ?? '')}"></span>`;
    }).join('');
    bar.innerHTML = `<strong id="play-title">Play</strong><span class="pname">${esc(c?.name ?? '')}</span>${fields || '<span class="phint">No settings to try.</span>'}<button type="button" id="play-replay" title="Start the animations over">Replay</button><button type="button" id="play-reset"${live.get(id) ? '' : ' disabled'}>Reset</button><button type="button" id="play-exit" aria-label="Leave play mode">Done <kbd>P</kbd></button>`;
    if (focus?.id) { const f = bar.querySelector('#' + CSS.escape(focus.id)); if (f) { f.focus({ preventScroll: true }); try { f.setSelectionRange(focus.s, focus.e); } catch {} } }
  }

  // A one-shot animation has finished long before you press P: entering play starts them over, and Replay does so at any time.
  function restartAnimations() {
    for (const s of ctx.stage.sections.values()) {
      const d = s.docFrame?.doc(); if (!d?.head) continue;
      const st = d.createElement('style'); st.setAttribute('data-napkin', ''); st.textContent = '*,*::before,*::after{animation:none!important}';
      d.head.append(st); void d.documentElement.offsetWidth; st.remove();
    }
  }
  const rerender = (id) => ctx.stage.render(id, true).catch(console.error);
  function set(next) {
    if (next === on) return;
    on = next;
    if (on) { document.body.dataset.play = '1'; bar.hidden = false; paint(); restartAnimations(); }
    else {
      delete document.body.dataset.play; bar.hidden = true;
      const ids = [...live.keys()]; live.clear();
      for (const id of ids) rerender(id); // back to the drawing, with the file's own defaults
    }
    ctx.emit('play', { on });
    ctx.stage.refreshOverlays();
  }
  const api = {
    active: () => on, replay: restartAnimations,
    set, toggle: () => set(!on),
    props: (id) => (on ? live.get(id) || {} : {}),
    setProp(id, name, value) { const v = live.get(id) || {}; v[name] = value; live.set(id, v); if (bar.contains(document.activeElement)) { /* keep typing */ } rerender(id); paint(); },
    reset(id) { live.delete(id); rerender(id); paint(); },
  };
  ctx.play = api;

  bar.addEventListener('input', (ev) => {
    const t = ev.target, name = t.dataset.playProp, id = target();
    if (!name || !id) return;
    const p = ctx.state.components.get(id)?.doc.props.find((x) => x.name === name);
    api.setProp(id, name, t.dataset.kind === 'boolean' ? t.checked : t.dataset.kind === 'number' ? (t.value.trim() === '' ? undefined : Number(t.value)) : t.value);
  });
  bar.addEventListener('click', (ev) => {
    if (ev.target.closest('#play-replay')) restartAnimations();
    else if (ev.target.closest('#play-exit')) set(false);
    else if (ev.target.closest('#play-reset')) { const id = target(); if (id) api.reset(id); }
  });
  ctx.on('select', () => { if (on) paint(); });
  ctx.on('render', () => { if (on && !bar.contains(document.activeElement)) paint(); });

  addEventListener('keydown', (ev) => {
    if (ev.code === 'Escape' || ev.key === 'Escape') { if (on) { ev.preventDefault(); ev.stopImmediatePropagation(); set(false); } return; }
    if (ev.code !== 'KeyP' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable || document.body.dataset.modal) return;
    ev.preventDefault(); set(!on);
  }, true);
}
