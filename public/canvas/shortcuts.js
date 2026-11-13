// The key map (?): generated from the bindings in force (GET /api/keys: the registry in actions.js plus any rebinding),
// then every other key of the canvas from the same registry. A command can be rebound here (Rebind, then press the keys)
// or from the palette ("Rebind <command> to <keys>").
import { ACTIONS } from './actions.js';
import { eventChord } from './keynames.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function initShortcuts(ctx) {
  const dialog = document.createElement('dialog'); dialog.id = 'shortcuts';
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-labelledby', 'shortcuts-title'); dialog.setAttribute('data-keymap', '');
  dialog.innerHTML = `<div class="km-head"><h2 id="shortcuts-title">Keys</h2><button type="button" class="km-close">Close</button></div>
    <p class="km-note">Ctrl on Windows and Linux, Cmd on Mac. A sequence is pressed one key after the other (A K: A, then K). A number first repeats a move (3, then ArrowRight). Every command is also in the palette (Ctrl K).</p>
    <section aria-labelledby="km-commands"><h3 id="km-commands">Commands</h3><ul class="km-list"></ul></section>
    <section aria-labelledby="km-more"><h3 id="km-more">Everywhere else</h3><dl class="km-more"></dl></section>
    <p class="km-status" role="status" aria-live="polite"></p>`;
  // First in the page, so it is the dialog a person (or a test) finds while it is open.
  document.body.prepend(dialog);
  const list = dialog.querySelector('.km-list'), more = dialog.querySelector('.km-more'), status = dialog.querySelector('.km-status');
  const byId = new Map(ACTIONS.map((a) => [a.id, a]));
  const name = (id) => byId.get(id)?.label ?? id;
  function paint() {
    const bindings = ctx.surface?.bindings() ?? [];
    list.innerHTML = bindings.map((b) => `<li class="shortcut" data-command="${esc(b.command)}"><span class="km-label">${esc(name(b.command))}</span><kbd class="km-keys">${esc(b.keys)}</kbd><button type="button" class="km-rebind" data-rebind="${esc(b.command)}" aria-label="Rebind ${esc(name(b.command))}">Rebind</button></li>`).join('');
    const bound = new Set(bindings.map((b) => b.command));
    more.innerHTML = ACTIONS.filter((a) => !bound.has(a.id) && !a.command && a.sheet !== false).map((a) => `<div class="shortcut"><dt>${esc(a.label)}</dt><dd>${esc(a.key)}</dd></div>`).join('');
  }
  let previous, recording = null;
  const close = () => dialog.close();
  function open() { if (dialog.open) return; ctx.quick?.close(); previous = document.activeElement; paint(); status.textContent = ''; document.body.dataset.modal = 'shortcuts'; dialog.showModal(); dialog.querySelector('.km-close').focus({ focusVisible: true }); }
  dialog.querySelector('.km-close').addEventListener('click', close);
  dialog.addEventListener('click', (e) => {
    const r = e.target.closest?.('[data-rebind]');
    if (r) { recording = r.dataset.rebind; r.textContent = 'Press keys'; status.textContent = `Press the new keys for ${name(recording)}. Escape keeps the old ones.`; return; }
    if (e.target === dialog) { const b = dialog.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) close(); }
  });
  dialog.addEventListener('close', () => { recording = null; delete document.body.dataset.modal; previous?.focus?.({ preventScroll: true }); });
  ctx.on('keys', () => { if (dialog.open) paint(); });
  addEventListener('keydown', (ev) => {
    if (recording && dialog.open) {
      const chord = eventChord(ev);
      if (!chord) return; // a modifier on its own: wait for the key
      ev.preventDefault(); ev.stopImmediatePropagation();
      const command = recording; recording = null;
      if (ev.key === 'Escape') { paint(); status.textContent = 'Kept the old keys.'; return; }
      ctx.surface.rebind(`${command} to ${chord}`).then(() => { paint(); status.textContent = `${name(command)}: ${chord}`; list.querySelector(`[data-rebind="${CSS.escape(command)}"]`)?.focus({ focusVisible: true }); });
      return;
    }
    if (ev.key === 'Escape' && dialog.open) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); return; }
    if (ev.key !== '?' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); dialog.open ? close() : open();
  }, true);
  ctx.shortcuts = { open, close };
}
