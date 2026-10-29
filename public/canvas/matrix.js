// CMP-10: big variant matrices (4 x 4 x 4 = 64 cells) that stay usable. Two controls, both view-only (nothing is written
// to a file; the choice is remembered for this browser tab):
//   - Filter chips in the frame title, one row per axis: click a value to show only it (click again to show all),
//     Shift-click to add or remove a value. A hidden value hides its column, row or group.
//   - Groups (the axes after the second) collapse and expand by clicking their title; "Collapse all / Expand all" in the title.
// Any cell is therefore at most two actions away: one chip (or one group title), then the cell is on screen to click.
// `ctx.matrix` = { state(component), filter(component, axis, value, { add }), showAll(component), collapse(component, groupKey | null), expandAll(component), collapseAll(component) }.
import { axes } from '/src/model.js';

const MANY = 16; // cells before the chips show up on their own
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initMatrix(ctx) {
  const states = new Map(); // component id -> { hide: { axis: Set(values) }, collapsed: Set(groupKey) }
  const key = (id) => `napkin.matrix.${ctx.state.components.get(id)?.name ?? id}`;
  function stateOf(id) {
    let s = states.get(id);
    if (s) return s;
    s = { hide: {}, collapsed: new Set() };
    try {
      const saved = JSON.parse(sessionStorage.getItem(key(id)) || 'null');
      if (saved) { for (const [a, v] of Object.entries(saved.hide || {})) s.hide[a] = new Set(v); s.collapsed = new Set(saved.collapsed || []); }
    } catch {}
    states.set(id, s);
    return s;
  }
  function save(id) {
    const s = stateOf(id);
    try { sessionStorage.setItem(key(id), JSON.stringify({ hide: Object.fromEntries(Object.entries(s.hide).map(([a, v]) => [a, [...v]])), collapsed: [...s.collapsed] })); } catch {}
  }
  const section = (id) => document.querySelector(`section.cmp[data-component="${CSS.escape(id)}"]`);

  // Make the DOM match the state: cells, headers, groups, grid columns. Cheap: only class and style writes.
  // The filter bar alone. The stage calls it before it places a new frame, so the title row's height (bar included) is known then.
  function bar(id) {
    const sec = section(id), c = ctx.state.components.get(id);
    if (!sec || !c?.doc) return null;
    const ax = axes(c.doc), s = stateOf(id);
    const total = ax.reduce((n, a) => n * a.options.length, 1);
    const hidden = (a, v) => !!s.hide[a]?.has(v);
    // controls in the title
    let ctl = sec.querySelector('.mctl');
    const filtering = Object.values(s.hide).some((v) => v.size);
    const show = ax.length > 0 && (total >= MANY || filtering);
    if (!show) ctl?.remove();
    else {
      if (!ctl) { ctl = document.createElement('div'); ctl.className = 'mctl'; ctl.dataset.nodrag = '1'; sec.querySelector('.cmp-head').append(ctl); }
      const groups = ax.length > 2;
      const html = ax.map((a) => `<div class="mrow" data-axis="${esc(a.name)}"><span class="mname">${esc(a.name)}</span><button type="button" class="mchip mall" data-axis="${esc(a.name)}" data-value="" aria-pressed="${!s.hide[a.name]?.size}" title="Show every ${esc(a.name)}">All</button>${a.options.map((o) => `<button type="button" class="mchip" data-axis="${esc(a.name)}" data-value="${esc(o)}" aria-pressed="${!!s.hide[a.name]?.size && !hidden(a.name, o)}" title="Show only ${esc(o)}. Shift-click adds or removes it.">${esc(o)}</button>`).join('')}</div>`).join('')
        + `<div class="mrow mtools">${filtering ? '<button type="button" class="mtool" data-act="show-all">Show all values</button>' : ''}${groups ? '<button type="button" class="mtool" data-act="collapse-all">Collapse groups</button><button type="button" class="mtool" data-act="expand-all">Expand groups</button>' : ''}<span class="mcount" id="mcount-${esc(id)}"></span></div>`;
      if (ctl.dataset.html !== html) {
        const had = ctl.contains(document.activeElement) ? document.activeElement : null, at = had && { axis: had.dataset.axis, value: had.dataset.value, act: had.dataset.act };
        ctl.innerHTML = html; ctl.dataset.html = html; delete ctl.dataset.nw; // (its natural size is measured again)
        if (at) ctl.querySelector(at.act ? `[data-act="${at.act}"]` : `.mchip[data-axis="${CSS.escape(at.axis)}"][data-value="${CSS.escape(at.value)}"]`)?.focus({ preventScroll: true }); // a keyboard press keeps its place
      }
    }
    return { sec, c, ax, s, total, hidden };
  }
  // WPC-32: the bar is drawn at a constant size on screen, so at low zoom it grows (in canvas units) past the frame it belongs to and
  // pushes the rows of frames below it apart. It is shown only while it fits inside its frame; a frame too small for it hides it
  // (zoom in to filter). At 100% and above it wraps inside the frame instead. `natural` measures its size once per content.
  function natural(sec) {
    const ctl = sec.querySelector('.mctl');
    if (!ctl) return null;
    if (!ctl.dataset.nw) {
      const off = sec.hasAttribute('data-mctl-off'); sec.removeAttribute('data-mctl-off'); ctl.style.maxWidth = '';
      ctl.dataset.nw = String(ctl.offsetWidth); ctl.dataset.nh = String(ctl.offsetHeight);
      if (off) sec.setAttribute('data-mctl-off', '');
    }
    return { ctl, w: Number(ctl.dataset.nw), h: Number(ctl.dataset.nh) };
  }
  const labelScale = () => ctx.view?.settledLabelScale?.() ?? 1;
  const fits = (sec, lf = labelScale()) => { const n = natural(sec), f = sec.querySelector('.frame'); return !n || !f || lf <= 1 || n.w * lf <= f.offsetWidth + 1; };
  function fit(sec) {
    const n = natural(sec);
    if (!n) { sec.removeAttribute('data-mctl-off'); return; }
    const lf = labelScale(), ok = fits(sec, lf), w = sec.querySelector('.frame')?.offsetWidth || 0;
    if (ok === sec.hasAttribute('data-mctl-off')) ok ? sec.removeAttribute('data-mctl-off') : sec.setAttribute('data-mctl-off', '');
    n.ctl.style.maxWidth = lf <= 1 && w && n.w > w ? `${w}px` : '';
  }
  function apply(id) {
    const made = bar(id);
    if (!made) return;
    const { sec, ax, s, total, hidden } = made;
    const [across, down] = ax;
    let shown = 0;
    for (const cell of sec.querySelectorAll('.cell')) {
      const v = JSON.parse(cell.dataset.variant);
      const off = ax.some((a) => hidden(a.name, v[a.name]));
      cell.classList.toggle('mhide', off);
      if (!off) shown++;
    }
    let groupsShown = 0;
    const groupEls = [...sec.querySelectorAll('.group')];
    for (const g of groupEls) {
      const gv = JSON.parse(g.dataset.group), gk = g.dataset.group;
      const off = Object.entries(gv).some(([a, v]) => hidden(a, v));
      g.classList.toggle('mhide', off);
      if (!off) groupsShown++;
      const collapsed = s.collapsed.has(gk) && Object.keys(gv).length > 0;
      g.dataset.collapsed = collapsed ? '1' : '0';
      const title = g.querySelector('.group-title');
      if (title && Object.keys(gv).length) {
        title.dataset.nodrag = '1';
        let btn = title.querySelector('.gtoggle');
        if (!btn) { btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gtoggle'; title.querySelector('.gchips')?.prepend(btn); }
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} group ${Object.entries(gv).map(([a, v]) => `${a} ${v}`).join(', ')}`);
        btn.textContent = collapsed ? '▸' : '▾';
        const n = [...g.querySelectorAll('.cell:not(.mhide)')].length;
        let cnt = title.querySelector('.gcount');
        if (!cnt) { cnt = document.createElement('span'); cnt.className = 'gcount'; title.querySelector('.gchips')?.append(cnt); }
        cnt.textContent = collapsed ? `${n} cells` : '';
      }
      // headers and columns inside the group
      const grid = g.querySelector('.mgrid');
      if (grid && across) {
        const cols = across.options.filter((o) => !hidden(across.name, o));
        for (const h of grid.querySelectorAll('.colhead')) h.classList.toggle('mhide', hidden(across.name, h.textContent));
        if (down) for (const h of grid.querySelectorAll('.rowhead')) h.classList.toggle('mhide', hidden(down.name, h.textContent));
        grid.style.setProperty('--nk-cols', String(Math.max(1, cols.length)));
      }
    }
    sec.querySelector('.matrix')?.style.setProperty('--nk-gcols', String(Math.max(1, Math.min(groupsShown || 1, Math.ceil(Math.sqrt(groupsShown || 1))))));
    const count = sec.querySelector('.mcount');
    if (count) count.textContent = `${shown} of ${total} shown`;
    sec.dataset.shown = String(shown);
    rove(sec);
    fit(sec);
    ctx.stage?.measureAll(id);
    ctx.stage?.refreshOverlays();
  }

  // WPC-07: tab order. Each row of filter chips is one Tab stop and all the group bars of a component are one Tab stop;
  // arrow keys move inside the set (roving tabindex), so 30 "Collapse group" buttons no longer flood the tab order.
  const setOf = (el) => (el.matches('.gtoggle') ? [...el.closest('section.cmp').querySelectorAll('.gtoggle')] : [...el.closest('.mrow').querySelectorAll('button')]);
  function rove(sec) {
    const sets = [[...sec.querySelectorAll('.gtoggle')], ...[...sec.querySelectorAll('.mctl .mrow')].map((r) => [...r.querySelectorAll('button')])];
    // only the selected component's bars are Tab stops (Cmd-K or a click selects one); the rest stay clickable but out of the way
    const mine = sec.dataset.component === ctx.state.selection?.component || sec.contains(document.activeElement);
    for (const set of sets) {
      if (!set.length) continue;
      if (!mine) { for (const b of set) b.tabIndex = -1; continue; }
      const cur = set.find((b) => b.dataset.rove === '1' && b.isConnected && !b.closest('.mhide')) ?? set.find((b) => !b.closest('.mhide')) ?? set[0];
      for (const b of set) { b.tabIndex = b === cur ? 0 : -1; if (b === cur) b.dataset.rove = '1'; else delete b.dataset.rove; }
    }
  }
  function changed(id) { save(id); apply(id); ctx.emit('matrix', { component: id }); }
  const api = {
    bar, natural, fits,
    state: (id) => { const s = stateOf(id); return { hide: Object.fromEntries(Object.entries(s.hide).map(([a, v]) => [a, [...v]])), collapsed: [...s.collapsed] }; },
    // click: show only `value` (again: show all of that axis); add: toggle it in or out of the shown set
    filter(id, axis, value, { add = false } = {}) {
      const c = ctx.state.components.get(id), a = c && axes(c.doc).find((x) => x.name === axis);
      if (!a) return;
      const s = stateOf(id), cur = s.hide[axis] ?? new Set(), shown = a.options.filter((o) => !cur.has(o));
      let next;
      if (add) next = shown.includes(value) ? shown.filter((o) => o !== value) : [...shown, value];
      else next = shown.length === 1 && shown[0] === value ? a.options : [value];
      if (!next.length) next = a.options;
      s.hide[axis] = new Set(a.options.filter((o) => !next.includes(o)));
      if (!s.hide[axis].size) delete s.hide[axis];
      changed(id);
    },
    clearAxis(id, axis) { delete stateOf(id).hide[axis]; changed(id); },
    showAll(id) { stateOf(id).hide = {}; changed(id); },
    collapse(id, groupKey) { const s = stateOf(id); s.collapsed.has(groupKey) ? s.collapsed.delete(groupKey) : s.collapsed.add(groupKey); changed(id); },
    collapseAll(id) { const s = stateOf(id); for (const g of section(id)?.querySelectorAll('.group') || []) if (g.dataset.group !== '{}') s.collapsed.add(g.dataset.group); changed(id); },
    expandAll(id) { stateOf(id).collapsed.clear(); changed(id); },
  };
  ctx.matrix = api;
  ctx.on('render', ({ component }) => apply(component));
  ctx.on('viewsettle', () => { for (const sec of document.querySelectorAll('section.cmp')) if (sec.querySelector('.mctl')) fit(sec); });
  ctx.on('select', () => { for (const sec of document.querySelectorAll('section.cmp')) rove(sec); });

  document.querySelector('#world').addEventListener('click', (ev) => {
    const t = ev.target;
    const id = t.closest?.('section.cmp')?.dataset.component;
    if (!id) return;
    const chip = t.closest('.mchip'), tool = t.closest('.mtool'), title = t.closest('.group-title');
    if (chip && chip.dataset.value === '') api.clearAxis(id, chip.dataset.axis);
    else if (chip) api.filter(id, chip.dataset.axis, chip.dataset.value, { add: ev.shiftKey || ev.metaKey || ev.ctrlKey });
    else if (tool) { const a = tool.dataset.act; if (a === 'show-all') api.showAll(id); else if (a === 'collapse-all') api.collapseAll(id); else api.expandAll(id); }
    else if (title && title.closest('.group').dataset.group !== '{}') api.collapse(id, title.closest('.group').dataset.group);
  });

  const world = document.querySelector('#world');
  world.addEventListener('focusin', (ev) => {
    const b = ev.target.closest?.('.gtoggle, .mctl button');
    if (!b || b.tabIndex === 0) return;
    for (const x of setOf(b)) { x.tabIndex = x === b ? 0 : -1; if (x === b) x.dataset.rove = '1'; else delete x.dataset.rove; }
  });
  world.addEventListener('keydown', (ev) => {
    const b = ev.target.closest?.('.gtoggle, .mctl button');
    if (!b || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    const set = setOf(b).filter((x) => !x.closest('.mhide') && x.offsetParent !== null), i = set.indexOf(b);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: set.length - 1 }[ev.key];
    if (to === undefined || i < 0) return;
    ev.preventDefault(); ev.stopPropagation();
    set[Math.max(0, Math.min(set.length - 1, to))].focus();
  });
}
