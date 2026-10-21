// The side panel (stub for M3). M2: the selected component, node and variant, the node's base
// styles read-only, and ONE editable base property (padding) that sends a `set` edit, so the
// proving demo can run. M3 replaces this with the real property panel.
import { index } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const variantLabel = (v) => Object.entries(v || {}).map(([k, x]) => `${k}=${x}`).join(' · ') || 'default';
const EDITABLE = 'padding';

export function renderPanel(ctx) {
  const el = document.querySelector('#panel');
  const sel = ctx.state.selection;
  const comp = sel && ctx.state.components.get(sel.component);
  const node = comp?.doc && index(comp.doc).byId.get(sel.node);
  if (!node && comp?.readOnly) { // no model to show: say why, and offer no edits
    el.dataset.key = '';
    el.innerHTML = `<h2>Selection</h2><dl><dt>component</dt><dd id="sel-component">${esc(comp.name)}</dd><dt>node</dt><dd id="sel-node">${esc(sel.node)}</dd></dl><p class="hint" id="sel-readonly">read-only: ${esc(comp.readOnly)}</p>`;
    return;
  }
  if (!node) {
    el.dataset.key = '';
    el.innerHTML = '<h2>Selection</h2><p class="hint">Click an element on the canvas to select it.</p>';
    return;
  }
  const key = `${sel.component}|${sel.node}|${JSON.stringify(sel.variant)}`;
  const rows = Object.entries(node.style || {}).map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join('') || '<li><span>no base styles</span></li>';
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = `<h2>Selection</h2>
      <dl><dt>component</dt><dd id="sel-component">${esc(comp.name)}</dd><dt>node</dt><dd id="sel-node">${esc(node.id)} &lt;${esc(node.tag)}&gt;</dd><dt>variant</dt><dd id="sel-variant">${esc(variantLabel(sel.variant))}</dd></dl>
      <h2>Base styles</h2><ul id="base-styles">${rows}</ul>
      <h2>Edit</h2><label>Padding <input id="padding" autocomplete="off"${comp.readOnly ? ' disabled' : ''}></label>`;
  } else {
    el.querySelector('#base-styles').innerHTML = rows;
  }
  const input = el.querySelector('#padding');
  if (!input.dataset.dirty) input.value = node.style?.[EDITABLE] ?? '';
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    // Only an input with unsaved typing is protected from incoming changes.
    el.addEventListener('input', (ev) => { if (ev.target.id === 'padding') ev.target.dataset.dirty = '1'; });
    el.addEventListener('change', async (ev) => {
      if (ev.target.id !== 'padding') return;
      delete ev.target.dataset.dirty;
      const s = ctx.state.selection; if (!s) return;
      const raw = ev.target.value.trim();
      const value = raw === '' ? null : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      const r = await ctx.sendEdits(s.component, [{ op: 'set', path: `${s.node}.${EDITABLE}`, value }]);
      if (!r.ok) renderPanel(ctx);
    });
  }
}
