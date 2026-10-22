import { ACTIONS } from './actions.js';

export function initShortcuts(ctx) {
  const style = document.createElement('style');
  style.textContent = `#shortcuts { color:var(--nk-text); background:var(--nk-chrome); border:1px solid var(--nk-line); border-radius:12px; padding:24px; width:min(760px,90vw); max-height:85vh; box-shadow:var(--nk-shadow-pop); font:12px/1.5 var(--nk-sans) } #shortcuts::backdrop { background:#0005 } #shortcuts header { display:flex; justify-content:space-between; align-items:center } #shortcuts h2 { font-size:17px; margin:0 } #shortcuts p { color:var(--nk-text-2) } #shortcuts dl { display:grid; grid-template-columns:1fr 1fr; gap:0 24px } #shortcuts .shortcut { display:flex; justify-content:space-between; align-items:center; gap:12px; border-top:1px solid var(--nk-line); padding:9px 0; break-inside:avoid } #shortcuts dt { max-width:55% } #shortcuts dd { margin:0; text-align:right; font:10px var(--nk-mono); color:var(--nk-text-2) } #shortcuts button { border:1px solid var(--nk-line); background:var(--nk-chrome-2); border-radius:6px; padding:5px 10px } @media(max-width:650px) { #shortcuts dl { grid-template-columns:1fr } }`;
  document.head.append(style);
  const dialog = document.createElement('dialog'); dialog.id = 'shortcuts'; dialog.setAttribute('aria-labelledby', 'shortcuts-title');
  dialog.innerHTML = '<header><h2 id="shortcuts-title">Keyboard shortcuts</h2><button type="button" autofocus>Close</button></header><p>Ctrl on Windows and Linux · Cmd on Mac. Tool keys pause while you type.</p>';
  const dl = document.createElement('dl');
  for (const a of ACTIONS) { const row = document.createElement('div'); row.className = 'shortcut'; const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = a.label; dd.textContent = a.key; row.append(dt, dd); dl.append(row); }
  dialog.append(dl); document.body.append(dialog);
  let previous;
  const close = () => dialog.close();
  function open() { if (dialog.open) return; ctx.quick?.close(); previous = document.activeElement; document.body.dataset.modal = 'shortcuts'; dialog.showModal(); }
  dialog.querySelector('button').addEventListener('click', close);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  dialog.addEventListener('close', () => { delete document.body.dataset.modal; previous?.focus?.({ preventScroll: true }); });
  addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && dialog.open) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); return; }
    if (ev.key !== '?' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); dialog.open ? close() : open();
  }, true);
  ctx.shortcuts = { open, close };
}
