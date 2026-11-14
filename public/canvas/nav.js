// Focus a component (Enter) and come back (Esc) (CAN-08). The address bar carries the view: #Button focuses
// Button, #Button/label also selects its node. A reload restores a free view from sessionStorage.
const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || !!el.closest?.('#doc-dock')); // the inspector's staged edit keeps Escape for itself
const KEY = 'napkin.view';

export function initNav(ctx) {
  const { view, stage } = ctx;
  let focused = null;   // component id
  let before = null;    // the view to return to on Esc

  const store = (v) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const setHash = (h) => { const url = location.pathname + location.search + h; if (location.hash !== h) history.replaceState(null, '', url); };

  const byIdHas = (c, n) => { const walk = (x) => x.id === n || x.children.some(walk); return walk(c.doc.root); };
  function focus(id, node, { animate = true } = {}) {
    const c = ctx.find(id);
    if (!c) return false;
    if (!focused) before = view.get();
    focused = c.component;
    document.body.dataset.focus = c.name;
    for (const [sid, sec] of stage.sections.all()) { if (sid === focused) sec.el.dataset.focused = '1'; else delete sec.el.dataset.focused; }
    stage.live(focused);
    const r = stage.componentRect(focused);
    if (r) view.fitRect(r, { pad: 88, max: 2, animate });
    if (node && c.doc && !byIdHas(c, node)) node = null; // a link to a node that is not there focuses the component only
    if (c.item) ctx.select({ component: focused, node: 'item', variant: {} });
    if (node && c.doc) {
      ctx.select({ component: focused, node, variant: firstVariant(c) });
    } else if (c.doc && !ctx.state.selections.some((s) => s.component === focused)) {
      ctx.select({ component: focused, node: c.doc.root.id, variant: firstVariant(c) });
    }
    setHash('#' + encodeURIComponent(c.name) + (ctx.state.selection?.component === focused ? '/' + encodeURIComponent(ctx.state.selection.node) : ''));
    persist();
    ctx.emit('focus', { component: focused });
    return true;
  }
  function unfocus({ animate = true } = {}) {
    if (!focused) return false;
    focused = null;
    delete document.body.dataset.focus;
    for (const [, sec] of stage.sections.all()) delete sec.el.dataset.focused;
    setHash('');
    history.replaceState(null, '', location.pathname + location.search);
    if (before) view.set(before, { animate }); else view.fitAll({ animate });
    before = null;
    persist();
    ctx.emit('focus', { component: null });
    return true;
  }
  const firstVariant = (c) => { const ax = (c.doc?.props || []).filter((p) => p.type === 'enum'); return Object.fromEntries(ax.map((a) => [a.name, a.default])); };

  let timer = 0, restored = false;
  // (nothing is saved until restore() has run: the page's first layout moves the view to its default before the saved or fitted view is chosen)
  const persist = () => { if (!restored) return; clearTimeout(timer); timer = setTimeout(() => store({ view: view.get(), before, focus: focused }), 120); };
  ctx.on('view', persist);

  function fromHash() {
    const m = decodeURIComponent(location.hash.slice(1)).split('/');
    return m[0] ? { name: m[0], node: m[1] } : null;
  }
  function restore() {
    restored = true;
    const h = fromHash(), saved = load();
    if (h && ctx.find(h.name)) {
      before = saved?.before ?? null;
      if (!before) { view.fitAll({ animate: false }); before = view.get(); }
      focus(h.name, h.node, { animate: false });
      return;
    }
    if (saved?.view && !saved.focus) view.set(saved.view);
    else if (ctx.state.components.total > 150 && stage.openingRect?.()) view.fitRect(stage.openingRect(), { pad: 0, max: 1, animate: false });
    else view.fitAll({ animate: false }); // the first view shows every card (lane b-polish)
  }
  addEventListener('hashchange', () => {
    const h = fromHash();
    if (!h) unfocus(); else if (ctx.find(h.name) && ctx.find(h.name).component !== focused) focus(h.name, h.node);
  });

  // The first element inside a selected element of an HTML frame (what Enter selects), or null
  const SKIP = new Set(['script', 'style', 'template', 'link', 'meta', 'title', 'head', 'base', 'noscript']);
  function firstChild(sel) {
    const c = ctx.state.components.get(sel.component), f = !c?.doc && !c?.item && stage.sections.get(sel.component)?.docFrame;
    const path = f && stage.pathTo?.(sel.component, sel.node);
    const n = path?.at(-1)?.children.find((x) => !SKIP.has(x.tag) && f.has(x.node));
    return n?.node ?? null;
  }
  // Registered first (capture on window), so Escape sees the tool before tools.js changes it.
  addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.isComposing || typing(ev.target) || ev.target.closest?.('#time')) return; // the film strip keeps its own Escape and Enter (time-strip.js)
    if (document.body.dataset.modal || document.body.dataset.scrub || document.body.dataset.dragging) return;
    if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ((ev.target.closest?.('#stage') && !ev.target.closest?.('[data-nodrag]')) || !ev.target.closest?.('button, a, summary, [role=treeitem], [role=option], [role=tab]'))) {
      const sel = ctx.state.selection;
      const child = sel && ctx.state.tool === 'select' && firstChild(sel);
      if (child) { ev.preventDefault(); ctx.select({ component: sel.component, node: child, variant: {} }); } // in an HTML frame Enter goes one level in (standards 3.12, 5.2)
      else if (sel && ctx.state.tool === 'select' && sel.component !== focused) { ev.preventDefault(); focus(sel.component, sel.node); }
      else if (sel && focused) ev.preventDefault();
    } else if (ev.key === 'Escape' && ctx.state.tool === 'select') {
      if (focused) { ev.preventDefault(); unfocus(); }
      else if (ctx.state.selections.length) { // up one level in an HTML frame (to its card from the top level), then clear
        ev.preventDefault();
        const s = ctx.state.selection, up = ctx.state.selections.length === 1 && stage.upOf?.(s);
        ctx.select(up ? { component: s.component, node: up, variant: {} } : null);
      }
    }
  }, true);
  ctx.on('select', () => {
    if (!focused) return;
    const s = ctx.state.selection;
    if (s && s.component !== focused) { focus(s.component, s.node); return; }
    const c = ctx.state.components.get(focused);
    if (c) setHash('#' + encodeURIComponent(c.name) + (s ? '/' + encodeURIComponent(s.node) : ''));
  });

  const api = { focus, unfocus, restore, focused: () => focused };
  ctx.nav = api;
  return api;
}
