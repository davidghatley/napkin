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
const KEYS = { Stroke: ['border'], Fill: ['background'], Appearance: ['corner'], Text: ['font', 'type'], Layout: ['auto layout', 'flex'] }; // other words that find a section's controls
  const GENERIC = /^(Colour|Opacity|Width|Style|Size|Hug|Fill|Fixed|Block|Flex|Grid|Row|Column|Wrap|Left|Right|Top|Bottom|Center|All sides|Min \/ Max|Space between|Hide|Remove|Show)$/;
  // Names for the controls whose own label says little ("md", "×", "+ value"): built from the control's id.
  const BY_ID = [
    [/^propdef-([^-]+)-(.+)$/, (m) => `Default ${m[1]} ${m[2]}`],
    [/^axis-name-(.+)$/, (m) => `Name of ${m[1]} axis`], [/^axis-(up|down)-(.+)$/, (m) => `Move ${m[2]} axis ${m[1]}`], [/^remove-axis-(.+)$/, (m) => `Remove ${m[1]} axis`],
    [/^value-name-([^-]+)-(.+)$/, (m) => `Name of value ${m[2]}`], [/^value-(up|down)-([^-]+)-(.+)$/, (m) => `Move ${m[3]} ${m[1]}`],
    [/^grip-value-([^-]+)-(.+)$/, (m) => `Drag ${m[2]} to reorder`], [/^remove-value-([^-]+)-(.+)$/, (m) => `Remove value ${m[2]}`], [/^make-base-([^-]+)-(.+)$/, (m) => `Make ${m[2]} the base`],
[/^seg-textAlign-(.+)$/, (m) => `Text align ${m[1]}`], [/^side-(.+)$/, (m) => m[1] === 'all' ? 'Stroke all sides' : `Stroke ${m[1].toLowerCase()} side`], [/^size-(width|height)-(hug|fill|fixed)$/, (m) => `${m[2][0].toUpperCase()}${m[2].slice(1)} ${m[1]}`], [/^token-(.+)$/, (m, p) => `Bind ${fieldName(p, m[1])} to token`], [/^off-token-(.+)$/, (m, p) => `Snap ${fieldName(p, m[1])} to token`], [/^add-value-(.+)$/, (m) => `Add ${m[1]} value`], [/^add-axis$/, () => 'Add variant'], [/^add-prop$/, () => 'Add setting'],
  ];
  const fieldName = (panel, id) => { const l = panel.querySelector(`label[for="${CSS.escape(id)}"]`); return ((l?.querySelector('.lt') || l)?.textContent.trim() || humanId(id)).toLowerCase(); };
  const humanId = (id) => id.replace(/[-_]+/g, ' ');
  const symbolic = (t) => !/[A-Za-z0-9]{2,}/.test(t);
  function nameOf(el, panel) {
    const id = el.id;
    for (const [re, f] of BY_ID) { const m = re.exec(id); if (m) return f(m, panel); }
    if (el.tagName === 'SUMMARY') return (el.firstChild?.textContent.trim() || el.textContent.trim()).replace(/^Advanced.*/, 'Advanced');
    if (id === 'add-effects') return 'Shadow';
    const lab = id && panel.querySelector(`label[for="${CSS.escape(id)}"]`);
    const own = el.tagName === 'BUTTON' ? el.textContent.trim() : '';
    let name = (lab?.querySelector('.lt') || lab)?.textContent.trim() || el.getAttribute('aria-label') || (symbolic(own) ? '' : own) || el.title || humanId(id);
    if (/^\+/.test(own)) name = `Add ${own.replace(/^\W+/, '')}`;
    if (/^insert-/.test(id)) name = (el.title || name).replace(/ into .*$/, '');
    return name.replace(/^Add (?=\w)/, (m) => (/^add-(fill|stroke|effects)$/.test(id) ? '' : m)).replace(/^([a-z])/, (c) => c.toUpperCase());
  }
  // Every focusable control of the inspector gets a name, so Cmd-K reaches all of them (WPC-07). A bare name that two controls share
  // ("Colour", "Width", "Hug") is prefixed with its section; if that is still shared, with its id.
  // display:none anywhere between the control and the panel means nobody can focus it (a closed <details> does not count: it opens).
  const notRendered = (el, panel) => { for (let e = el; e && e !== panel; e = e.parentElement) if (getComputedStyle(e).display === 'none') return true; return false; };
  function panelControls() {
    const panel = document.querySelector('#panel'), list = [];
    if (!panel) return list;
    const seenIn = new Map();
    for (const el of panel.querySelectorAll('input, select, textarea, button, summary')) {
      if (el.disabled || el.type === 'color' || el.tabIndex < 0 || el.closest('[hidden]') || notRendered(el, panel)) continue;
      const det = el.closest('details'), section = det?.querySelector('summary')?.firstChild?.textContent.trim() || '';
      if (!el.id) el.id = el.tagName === 'SUMMARY' ? `sum-${(det?.dataset.sec || section).toLowerCase().replace(/\W+/g, '-')}` : `ctl-${(el.textContent.trim() || el.type || el.tagName).toLowerCase().replace(/\W+/g, '-')}-${list.length}`; // controls with no id of their own get one, so they can be focused by id
      const name = nameOf(el, panel);
      if (!name) continue;
      const order = (seenIn.set(det, (seenIn.get(det) ?? -1) + 1), seenIn.get(det));
      list.push({ id: el.id, order, section, name, force: /^propdef-/.test(el.id) && el.tagName === 'INPUT', button: el.tagName === 'BUTTON' || el.tagName === 'SUMMARY', add: /^(add-prop|add-axis|add-value-[^-]+)$/.test(el.id) });
    }
    const count = (f) => { const c = new Map(); for (const p of list) c.set(f(p).toLowerCase(), (c.get(f(p).toLowerCase()) || 0) + 1); return c; };
    const bare = count((p) => p.name);
    for (const p of list) p.label = /^Align /.test(p.name) || (p.section === 'Size' && /^(Width|Height)$/.test(p.name)) ? p.name : p.force || bare.get(p.name.toLowerCase()) > 1 || GENERIC.test(p.name) ? (p.section && !p.name.toLowerCase().startsWith(p.section.toLowerCase()) ? `${p.section.replace(/^Advanced.*/, 'Advanced')} ${p.name}` : p.name) : p.name;
    const full = count((p) => p.label);
    for (const p of list) { if (full.get(p.label.toLowerCase()) > 1) p.label = `${p.label} (${humanId(p.id)})`; p.alias = ALIAS[p.section] && p.section !== 'Layout' ? ALIAS[p.section] : ''; }
    return list;
  }
  // The inspector's fields of the current selection, so Cmd-K + "rad" + Enter lands in Radius. Rebuilt on every query: the panel may have
  // been redrawn since the palette opened.
  function propertyItems() {
    const sel = ctx.state.selection, out = [];
    if (!sel) return out;
    const where = `${ctx.state.components.get(sel.component)?.name ?? ''} › ${sel.node}`;
    const panel = document.querySelector('#panel');
    for (const [btn, form] of [['add-prop', 'new-prop-name'], ['add-axis', 'new-axis-name']]) { // the form is open, so its button is gone: the action still lands in the form
      if (panel?.querySelector('#' + form) && !panel.querySelector('#' + btn)) out.push({ kind: 'property', label: btn === 'add-prop' ? 'Add setting' : 'Add variant', hint: where, field: btn, add: true, boost: 16 });
    }
    const controls = panelControls();
    if (panel?.querySelector('#add-axis, [id^="add-value-"], [id^="axis-name-"]') && !controls.some((p) => /^make-base-/.test(p.id))) // none can be used: say so instead of matching nothing
      out.push({ kind: 'property', label: 'Make base (not possible here)', hint: where, note: 'Make base needs a variant value that is not the base yet. There is none here.', boost: 5 });
    for (const p of controls) out.push({ kind: 'property', keys: [...(KEYS[p.section] ?? []), ...(/^(remove|eye)-(fill|stroke)$/.test(p.id) ? ['clear'] : [])], label: p.label, hint: `${p.alias ? p.alias + ' · ' : ''}${where}`, field: p.id, add: p.add, boost: 14 - p.label.length * 0.25 - (/^(value-(up|down|name)|grip-value|remove-value|make-base|axis-(up|down|name)|remove-axis)-/.test(p.id) ? 4 : 0) + (/^size-height-/.test(p.id) ? 0.6 : 0) + (p.add ? 3 : p.button ? 0 : 0.5) - Math.min(p.order, 8) * 0.02 });
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
    items.push(...propertyItems());
    return items;
  }
  // Focus an inspector control (opening its section if folded). Used by property results and Alt+I.
  function focusField(el) {
    if (!el) return false;
    const id = el.id, sc = document.getElementById('scope'), sel = ctx.state.selection;
    if (id && !/^(propdef|add-|axis-|value-|remove-|grip-|make-|insert-|edit-|scope|sum-|new-)/.test(id) && el.tagName !== 'SUMMARY' && sc && sc.value !== 'variant' && sc.options[1] && !sc.options[1].disabled && sel) { // a variant cell is selected: land in that variant's scope
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
    if (item.kind === 'property' && item.note) { ctx.hint(item.note); return; }
    if (item.kind === 'property') {
      const el = document.getElementById(item.field);
      if (item.add) { // "Add setting", "Add variant", "Add variant value": open the form and land in its name field
        for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
        const want0 = item.field === 'add-prop' ? 'new-prop-name' : item.field === 'add-axis' ? 'new-axis-name' : `new-value-${item.field.replace(/^add-value-/, '')}`;
        if (!document.getElementById(want0)) el?.click(); // the form may already be open: then just land in it
        const want = item.field === 'add-prop' ? 'new-prop-name' : item.field === 'add-axis' ? 'new-axis-name' : `new-value-${item.field.replace(/^add-value-/, '')}`;
        let tries = 0; const land = () => { const f = document.getElementById(want); if (f) { const open = (x) => { for (let d = x.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; x.focus(); }; open(f); setTimeout(() => { if (document.activeElement.id !== want) { const g = document.getElementById(want); if (g) open(g); } }, 150); return; } if (++tries < 20) requestAnimationFrame(land); }; land();
        return;
      }
      if (el?.tagName === 'SUMMARY') { // Enter on a section moves into its first field
        for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
        const fields = [...(el.closest('details')?.querySelectorAll('input, select, textarea, button') ?? [])].filter((x) => !x.disabled && x.tabIndex >= 0 && x.type !== 'color' && getComputedStyle(x).display !== 'none' && !x.closest('[hidden]'));
        focusField(fields.find((x) => x.tagName !== 'BUTTON') || fields[0] || el); return; // a text field before any button
      }
      focusField(el); return;
    }
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

  input.addEventListener('input', () => { if (input.value.trim()) items = [...items.filter((i) => i.kind !== 'property'), ...propertyItems()]; query(input.value); active = 0; paint(); });
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
