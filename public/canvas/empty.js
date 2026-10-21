// Only empty-canvas teaching. Lives in screen space, so zooming does not shrink the instructions.
export function initEmpty(ctx, stage) {
  const style = document.createElement('style');
  style.textContent = `#empty-state { position:absolute; left:50%; top:44%; transform:translate(-50%,-50%); width:330px; padding:24px; color:var(--text); background:var(--chrome); border:1px solid var(--line); border-radius:12px; box-shadow:var(--frame-shadow); font:12px/1.6 var(--sans); z-index:1 } #empty-state h2 { font-size:17px; margin:0 0 6px; font-weight:600 } #empty-state p { color:var(--text-2); margin:0 0 18px } #empty-state button { width:100%; display:flex; align-items:center; justify-content:space-between; border:1px solid var(--line); border-radius:7px; padding:9px 12px; color:var(--text); background:var(--chrome-2); margin-bottom:16px } #empty-state dl { display:grid; grid-template-columns:1fr auto; gap:8px 12px; margin:0; color:var(--text-2) } #empty-state dd { margin:0; text-align:right } #empty-state small { display:block; margin-top:18px; color:var(--text-3) }`;
  document.head.append(style);
  const panel = document.createElement('section'); panel.id = 'empty-state'; panel.setAttribute('aria-labelledby', 'empty-title');
  panel.innerHTML = `<h2 id="empty-title">Room for your first component</h2><p>Start a component, then draw inside it.</p><button type="button"><span>New component</span><kbd>N</kbd></button><dl><dt>Draw a frame</dt><dd><kbd>F</kbd></dd><dt>Add text</dt><dd><kbd>T</kbd></dd><dt>Add an image slot</dt><dd><kbd>I</kbd></dd><dt>Find a component or action</dt><dd><kbd>Ctrl/Cmd+K</kbd></dd></dl><small>Press <kbd>?</kbd> for every shortcut.</small>`;
  stage.append(panel);
  panel.querySelector('button').addEventListener('click', () => document.querySelector('#tool-new').click());
  const update = () => { panel.hidden = ctx.state.components.size > 0; };
  ctx.on('added', update); ctx.on('removed', update); ctx.on('render', update);
  update(); return panel;
}
