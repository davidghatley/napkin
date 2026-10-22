// The drawer: one panel under the canvas (inside the reserved #dock) with a tab per tool of the history lane:
// Code, History, Inspect, Assets, Changes. Each tool is its own module and registers a tab here.
//   const drawer = createDrawer(ctx)
//   drawer.add('code', 'Code', { build(pane) {...}, onOpen() {...} })     the pane is built the first time the tab opens
//   drawer.open('code') / drawer.close() / drawer.toggle('code') / drawer.active (id | null)
// The tabs are buttons in the status bar (#drawer-tabs > button[data-drawer]); the drawer itself is #drawer with a pane per tab.
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};

export function createDrawer(ctx) {
  const dock = document.querySelector('#dock');
  const el = h('div', { id: 'drawer', hidden: true, role: 'region', 'aria-label': 'Code, history, inspect, assets and changes' });
  const title = h('h2', { class: 'dr-title', id: 'dr-title' });
  const close = h('button', { type: 'button', class: 'dr-close', 'aria-label': 'Close the drawer', title: 'Close (Esc)', text: '×', onclick: () => api.close() });
  const body = h('div', { class: 'dr-body' });
  el.append(h('div', { class: 'dr-head' }, title, close), body);
  dock.prepend(el);
  const bar = document.querySelector('#drawer-tabs'); // in index.html, with a reserved width, so the buttons arriving moves nothing

  const tabs = new Map();
  const api = {
    active: null,
    add(id, label, { build, onOpen, key } = {}) {
      const pane = h('div', { class: 'dr-pane', id: `pane-${id}`, hidden: true });
      body.append(pane);
      const btn = h('button', { type: 'button', 'data-drawer': id, id: `open-${id}`, 'aria-pressed': 'false', 'aria-controls': 'drawer', title: key ? `${label} (${key})` : label, text: label, onclick: () => api.toggle(id) });
      bar.append(btn);
      tabs.set(id, { label, build, onOpen, pane, btn, built: false });
    },
    open(id) {
      const t = tabs.get(id);
      if (!t) return;
      for (const [k, x] of tabs) { x.pane.hidden = k !== id; x.btn.setAttribute('aria-pressed', String(k === id)); }
      if (!t.built) { t.built = true; t.build?.(t.pane); }
      api.active = id; title.textContent = t.label; el.hidden = false; dock.hidden = false; el.dataset.tab = id;
      t.onOpen?.(t.pane);
      document.body.dataset.drawer = id;
      requestAnimationFrame(() => ctx.stage?.refreshOverlays?.());
      ctx.emit('drawer', { open: id });
    },
    close() {
      if (!api.active) return;
      for (const x of tabs.values()) x.btn.setAttribute('aria-pressed', 'false');
      api.active = null; el.hidden = true; delete document.body.dataset.drawer;
      if (!document.querySelector('#dock #proposals-tray')?.childElementCount) dock.hidden = true; // another lane may still be showing the dock
      requestAnimationFrame(() => ctx.stage?.refreshOverlays?.());
      ctx.emit('drawer', { open: null });
    },
    toggle(id) { if (api.active === id) api.close(); else api.open(id); },
    pane: (id) => tabs.get(id)?.pane,
  };
  // Esc closes the drawer when focus is inside it
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !ev.defaultPrevented && !ev.target.matches?.('input, select, textarea')) { ev.stopPropagation(); api.close(); } });
  return api;
}
