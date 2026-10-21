// Quick open (CAN-03): Cmd/Ctrl+K opens a palette that fuzzy-searches components, nodes and actions.
// Enter flies there (about 280 ms; none with prefers-reduced-motion) and selects it.
import { search } from './fuzzy.js';
import { variantGrid } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KIND = { component: 'Component', node: 'Layer', action: 'Action' };
const MAX = 14;

export function initQuick(ctx) {
  const root = document.createElement('div');
  root.id = 'quick'; root.hidden = true;
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

  const actions = () => [
    { kind: 'action', label: 'Fit all', hint: 'view', key: '⇧1', run: () => ctx.view.fitAll({ animate: true }) },
    { kind: 'action', label: 'Fit selection', hint: 'view', key: '⇧2', run: () => ctx.view.fitSelection({ animate: true }) },
    { kind: 'action', label: 'Zoom to 100%', hint: 'view', key: '⇧0', run: () => { const b = ctx.view.stageBox(); ctx.view.zoomBy(1 / ctx.view.get().z, b.left + b.width / 2, b.top + b.height / 2, { animate: true }); } },
    { kind: 'action', label: 'Focus selected component', hint: 'view', key: 'Enter', run: () => { const s = ctx.state.selection; if (s) ctx.nav.focus(s.component, s.node); } },
    { kind: 'action', label: 'Leave focus', hint: 'view', key: 'Esc', run: () => ctx.nav.unfocus() },
    { kind: 'action', label: 'New component', hint: 'create', key: 'N', run: () => key('n') },
    { kind: 'action', label: 'Frame tool', hint: 'draw', key: 'F', run: () => ctx.tools?.use('frame') },
    { kind: 'action', label: 'Text tool', hint: 'draw', key: 'T', run: () => ctx.tools?.use('text') },
    { kind: 'action', label: 'Image slot tool', hint: 'draw', key: 'I', run: () => ctx.tools?.use('image') },
    { kind: 'action', label: 'Select tool', hint: 'draw', key: 'V', run: () => ctx.tools?.use('select') },
    { kind: 'action', label: 'Switch light or dark chrome', hint: 'theme', run: () => document.querySelector('#theme-toggle').click() },
  ];
  const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  function build() {
    items = actions();
    for (const c of ctx.state.components.values()) {
      items.push({ kind: 'component', label: c.name, hint: c.readOnly ? 'read-only component' : 'component', component: c.component, boost: 4 });
      if (!c.doc) continue;
      (function walk(n) {
        items.push({ kind: 'node', label: `${c.name} › ${n.id}`, hint: n.tag, component: c.component, node: n.id });
        n.children.forEach(walk);
      })(c.doc.root);
    }
    return items;
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
    const c = ctx.state.components.get(item.component);
    if (!c?.doc) return;
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
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ev.stopPropagation(); root.hidden ? open() : close(); }
  }, true);
  document.querySelector('#quick-open').addEventListener('click', open);

  const api = { open, close, search: (q) => { if (!items.length) build(); return query(q).map((r) => r.item); }, build, lastMs: 0, isOpen: () => !root.hidden };
  ctx.quick = api;
  return api;
}
