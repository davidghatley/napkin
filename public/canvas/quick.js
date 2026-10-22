// Quick open (CAN-03): Cmd/Ctrl+K opens a palette that fuzzy-searches components, nodes and actions.
// Enter flies there (about 280 ms; none with prefers-reduced-motion) and selects it.
import { actionsFor } from './actions.js';
import { search } from './fuzzy.js';
import { variantGrid } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KIND = { component: 'Component', node: 'Layer', action: 'Action', property: 'Property' };
const MAX = 10; // the list never scrolls

export function initQuick(ctx) {
  const root = document.createElement('div');
  root.id = 'quick'; root.hidden = true; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Quick open');
  root.innerHTML = `<div class="q-scrim" data-close></div>
    <div class="q-panel" role="dialog" aria-modal="true" aria-label="Quick open">
      <div class="q-field"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input id="q-input" role="combobox" aria-expanded="true" aria-controls="q-list" aria-autocomplete="list" aria-label="Jump to a component, layer or action" placeholder="Jump to a component, a layer or an action" autocomplete="off" spellcheck="false"></div>
      <ul id="q-list" role="listbox" aria-label="Results"></ul>
      <div class="q-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> go</span><span><kbd>Esc</kbd> close</span></div>
    </div>`;
  document.body.append(root);
  const input = root.querySelector('#q-input'), list = root.querySelector('#q-list');
  let items = [], results = [], active = 0, returnTo = null;


  // Every control of the inspector, named by its section and label ("Fill colour", "Stroke colour", "Shadow", "Layout align top left",
  // "Settings label"), so Cmd-K reaches any property, not just the labelled number fields.
  const ALIAS = { Stroke: 'Border', Appearance: 'Corner opacity', Layout: 'Auto layout flex grid' };
  const SKIP = /^(pick-|nativepick|token-|off-token-|eye-|remove-|grip-|value-(up|down|name)|axis-(up|down|name)|make-base|add-(style|prop|value|axis)|swatch-|scope-info|insert-|pad-sides|rad-sides|edit-settings)/;
  function panelControls() {
    const out = [], seen = new Set(), panel = document.querySelector('#panel');
    if (!panel) return out;
    const seenIn = new Map();
    for (const el of panel.querySelectorAll('input, select, textarea, button[id]')) {
      const id = el.id;
      if (!id || seen.has(id) || el.disabled || el.type === 'color' || SKIP.test(id) || (/^propdef-/.test(id) && el.tagName !== 'INPUT')) continue;
      const lab = panel.querySelector(`label[for="${CSS.escape(id)}"]`);
      let name = (lab?.querySelector('.lt') || lab)?.textContent.trim() || el.getAttribute('aria-label') || (el.tagName === 'BUTTON' ? el.textContent.trim() : '') || '';
      const section = el.closest('details')?.querySelector('summary')?.firstChild?.textContent.trim() || '';
      if (el.id === 'add-effects') { name = 'Shadow'; }
      else if (/^Add /.test(name)) name = name.replace(/^Add /, '');
      if (!name) continue;
      seen.add(id);
      const generic = /^propdef-/.test(id) || /^(Colour|Opacity|Width|Height|Style|Size|Hug|Fill|Fixed|Block|Flex|Grid|Row|Column|Wrap|Left|Right|Top|Bottom|Center|All sides|Min \/ Max|Space between)$/.test(name) || /^Align /.test(name);
      const full = el.id === 'add-effects' || !section || !generic || section === name ? name : `${section.replace(/^Advanced.*/, 'Advanced')} ${name}`;
      out.push({ id, order: (seenIn.set(el.closest('details'), (seenIn.get(el.closest('details')) ?? -1) + 1), seenIn.get(el.closest('details'))), button: el.tagName === 'BUTTON', label: full, alias: ALIAS[section] && section !== 'Layout' ? ALIAS[section] : '' });
    }
    return out;
  }
  function build() {
    items = actionsFor(ctx);
    for (const c of ctx.state.components.values()) {
      items.push({ kind: 'component', label: c.name, hint: c.readOnly ? 'read-only component' : 'component', component: c.component, boost: 4 });
      if (!c.doc) continue;
      (function walk(n) {
        items.push({ kind: 'node', label: `${c.name} › ${n.id}`, hint: n.tag, component: c.component, node: n.id });
        n.children.forEach(walk);
      })(c.doc.root);
    }
    // WPC-07: the inspector's fields of the current selection, so Cmd-K + "rad" + Enter lands in Radius
    const sel = ctx.state.selection;
    if (sel) {
      const where = `${ctx.state.components.get(sel.component)?.name ?? ''} › ${sel.node}`;
      for (const p of panelControls()) items.push({ kind: 'property', label: p.label, hint: `${p.alias ? p.alias + ' · ' : ''}${where}`, field: p.id, boost: (p.button ? 3 : 6) - Math.min(p.order, 8) * 0.35 });
    }
    return items;
  }
  // Focus an inspector control (opening its section if folded). Used by property results and Alt+I.
  function focusField(el) {
    if (!el) return false;
    const id = el.id, sc = document.getElementById('scope'), sel = ctx.state.selection;
    if (id && id !== 'scope' && sc && sc.value !== 'variant' && sc.options[1] && !sc.options[1].disabled && sel) { // a variant cell is selected: land in that variant's scope
      sc.value = 'variant'; sc.dispatchEvent(new Event('change', { bubbles: true }));
      el = document.getElementById(id) || el;
    }
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    el.focus({ preventScroll: false }); el.select?.();
    return document.activeElement === el;
  }
  function focusInspector() {
    if (!ctx.state.selection) { ctx.hint('Select something first, then Alt+I jumps to its properties'); return false; }
    const first = document.querySelector('#panel label[for]'), el = first && document.getElementById(first.htmlFor);
    return focusField(el && !el.disabled ? el : document.querySelector('#panel input:not([disabled]), #panel button:not([disabled])'));
  }
  function query(q) {
    const t0 = performance.now();
    results = q.trim()
      ? search(items, q, MAX)
      : [...items.filter((i) => i.kind === 'action').slice(0, 5), ...items.filter((i) => i.kind === 'component')].slice(0, MAX).map((item) => ({ item, at: [] }));
    api.lastMs = performance.now() - t0;
    return results;
  }
  function mark(label, at) {
    if (!at.length) return esc(label);
    const set = new Set(at);
    let out = '', open = false;
    for (let i = 0; i < label.length; i++) {
      const on = set.has(i);
      if (on && !open) out += '<mark>'; if (!on && open) out += '</mark>';
      open = on; out += esc(label[i]);
    }
    return out + (open ? '</mark>' : '');
  }
  function paint() {
    list.innerHTML = results.map(({ item, at }, i) => `<li role="option" id="q-${i}" aria-selected="${i === active}" data-i="${i}"><span class="qk qk-${item.kind}">${KIND[item.kind]}</span><span class="ql">${mark(item.label, at)}</span>${item.hint && item.kind === 'node' ? `<span class="qh">${esc(item.hint)}</span>` : ''}${item.key ? `<kbd>${esc(item.key)}</kbd>` : ''}</li>`).join('') || '<li class="q-none" role="option" aria-disabled="true" aria-selected="false">Nothing matches</li>';
    input.setAttribute('aria-activedescendant', results.length ? `q-${active}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (!root.hidden) { input.focus(); input.select(); return; }
    returnTo = document.activeElement;
    build(); query(''); active = 0; paint();
    root.hidden = false; document.body.dataset.modal = 'quick';
    input.value = ''; input.focus();
  }
  function close() {
    if (root.hidden) return;
    root.hidden = true; delete document.body.dataset.modal;
    if (returnTo?.isConnected && returnTo !== document.body) returnTo.focus?.({ preventScroll: true });
    returnTo = null;
  }
  function go(r) {
    const item = r?.item;
    if (!item) return;
    close();
    if (item.kind === 'action') { item.run(); return; }
    if (item.kind === 'property') { focusField(document.getElementById(item.field)); return; }
    const c = ctx.state.components.get(item.component);
    if (!c) return;
    ctx.stage.live(c.component);
    if (!c.doc) {
      ctx.hint(`${c.name} is read-only${c.readOnly ? ` (${String(c.readOnly).replace(/\.$/, '')})` : ''}, so there is nothing to select. Open it in your editor to change it.`);
      const rect = ctx.stage.componentRect(c.component); if (rect) ctx.view.flyTo(rect, { pad: 96, max: 1.5 }); return; }
    const variant = variantGrid(c.doc)[0];
    if (item.kind === 'component') {
      ctx.select({ component: c.component, node: c.doc.root.id, variant });
      const rect = ctx.stage.componentRect(c.component);
      if (rect) ctx.view.flyTo(rect, { pad: 96, max: 1.5 });
    } else {
      ctx.stage.live(c.component);
      ctx.select({ component: c.component, node: item.node, variant });
      const rect = ctx.stage.nodeRect({ component: c.component, node: item.node, variant });
      if (rect) ctx.view.flyTo(rect, { pad: 160, max: 3 });
    }
  }

  input.addEventListener('input', () => { query(input.value); active = 0; paint(); });
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(active + 1, results.length - 1); paint(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); go(results[active]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    else if (ev.key === 'Tab') ev.preventDefault();
    else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); close(); }
  });
  list.addEventListener('click', (ev) => { const li = ev.target.closest('[data-i]'); if (li) go(results[Number(li.dataset.i)]); });
  list.addEventListener('mousemove', (ev) => { const li = ev.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== active) { active = Number(li.dataset.i); paint(); } });
  root.querySelector('[data-close]').addEventListener('click', close);
  addEventListener('keydown', (ev) => {
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.code === 'KeyI' && !ev.isComposing && root.hidden && !document.body.dataset.modal) { ev.preventDefault(); ev.stopPropagation(); focusInspector(); return; }
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ev.stopPropagation(); root.hidden ? open() : close(); }
  }, true);
  document.querySelector('#quick-open').addEventListener('click', open);

  const api = { open, close, focusInspector, search: (q) => query(q).map((r) => r.item), build, lastMs: 0, isOpen: () => !root.hidden }; // build() first, then search(): the index is rebuilt on open
  ctx.quick = api;
  return api;
}
