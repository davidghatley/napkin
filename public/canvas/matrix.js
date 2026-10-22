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
  function apply(id) {
    const sec = section(id), c = ctx.state.components.get(id);
    if (!sec || !c?.doc) return;
    const ax = axes(c.doc), s = stateOf(id);
    const hidden = (a, v) => !!s.hide[a]?.has(v);
    const total = ax.reduce((n, a) => n * a.options.length, 1);
    const [across, down] = ax;
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
      if (ctl.dataset.html !== html) { ctl.innerHTML = html; ctl.dataset.html = html; }
    }
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
    ctx.stage?.measureAll(id);
    ctx.stage?.refreshOverlays();
  }

  function changed(id) { save(id); apply(id); ctx.emit('matrix', { component: id }); }
  const api = {
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
}
