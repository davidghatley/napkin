// The stage: every component is a frame on an infinite canvas, drawn by the component's own bundle (real
// React, F04). Variants sit in a matrix (first axis across, second down, the rest as labelled groups).
// Plain DOM; React is only inside the cells.
//
//   #world (one CSS transform, see view.js)
//     section.cmp[data-component][data-name][data-revision][data-ready]   absolutely placed at its canvas x/y
//       .cmp-head      title, badge, revision, problem, build-error (counter-scaled so it stays legible)
//       .frame > .matrix > .group > .mgrid > (.corner|.colhead|.rowhead|figure.cell[data-variant] > .mount, figcaption)
//   #overlays (screen space, outside the world): #overlay-select, #overlay-hover, .overlay-extra, #overlay-measure
//
// Interactions here: click / shift-click / marquee selection (ctx.state.selections), dragging a frame by its
// title (position saved in the sidecar only), Alt to measure, hover. Components are laid out once and never
// re-packed, so an edit in one frame can never move another (FEEL-04).
import { variantGrid, axes, index } from '/src/model.js';
import { variantLabel } from './panel.js';

let SHELF_W = 2400; const GAP_X = 120, GAP_Y = 170, CULL_AFTER = 30;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createStage(ctx, root, world, view) {
  const sections = new Map(); // component id -> { el, frame, unmounts, token, pos, size, culled }
  const auto = new Map();     // component id -> { x, y } chosen by the stage for components that have no saved position
  const overlays = root.querySelector('#overlays');
  const mk = (id) => { const o = document.createElement('div'); o.id = id; overlays.append(o); return o; };
  const selectBox = mk('overlay-select'), hoverBox = mk('overlay-hover'), measureBox = mk('overlay-measure');
  const extras = [];
  let laidOut = false, hoverEl = null, measuring = false;
  const byName = (a, b) => (ctx.state.components.get(a)?.name ?? a).localeCompare(ctx.state.components.get(b)?.name ?? b);

  // ---------------------------------------------------------------------------------------------- lookup
  const cellOf = (sec, variant) => { const key = JSON.stringify(variant || {}); return [...sec.el.querySelectorAll('.cell')].find((c) => c.dataset.variant === key); };
  function cellElement(id, node, variant) {
    const sec = sections.get(id);
    if (!sec) return null;
    const css = `.mount [data-n="${CSS.escape(node)}"]`;
    return cellOf(sec, variant)?.querySelector(css) || sec.el.querySelector(css);
  }
  const selectedElement = (sel) => (sel ? cellElement(sel.component, sel.node, sel.variant) : null);
  const live = (id) => { const sec = sections.get(id); if (sec?.culled) { sec.culled = false; delete sec.el.dataset.cull; } return sec; };

  // ---------------------------------------------------------------------------------------------- sections
  function section(id) {
    let sec = sections.get(id);
    if (sec) return sec;
    const el = document.createElement('section');
    el.className = 'cmp'; el.dataset.component = id;
    el.innerHTML = '<div class="cmp-head"><span class="cmp-title"><h3></h3><span class="badge" hidden></span><span class="rev"></span></span><p class="problem" role="status"></p><p class="build-error" role="alert"></p></div><div class="frame"></div>';
    sec = { el, frame: el.querySelector('.frame'), unmounts: [], token: 0, pos: null, size: { w: 0, h: 0 }, culled: false };
    sections.set(id, sec);
    world.append(el);
    const saved = ctx.state.components.get(id)?.canvas;
    if (saved && (saved.x || saved.y)) moveTo(id, saved.x, saved.y);
    return sec;
  }

  function header(id) {
    const c = ctx.state.components.get(id), sec = section(id);
    sec.el.querySelector('h3').textContent = c.name;
    sec.el.dataset.name = c.name;
    const badge = sec.el.querySelector('.badge');
    badge.hidden = !c.readOnly; badge.textContent = c.readOnly ? `read-only: ${c.readOnly}` : '';
    sec.el.querySelector('.problem').textContent = c.problem ? `file has an error, showing the last good version: ${c.problem}` : '';
  }

  // The matrix: first axis across, second down, the rest as labelled groups.
  function buildMatrix(doc, cellFor) {
    const ax = doc ? axes(doc) : [];
    const matrix = document.createElement('div');
    matrix.className = 'matrix'; matrix.dataset.axes = String(ax.length);
    if (!ax.length) { matrix.append(cellFor({})); return matrix; }
    const [across, down, ...rest] = ax;
    let groups = [{}];
    for (const a of rest) groups = groups.flatMap((g) => a.options.map((o) => ({ ...g, [a.name]: o })));
    matrix.style.setProperty('--gcols', String(Math.max(1, Math.min(groups.length, Math.ceil(Math.sqrt(groups.length))))));
    for (const g of groups) {
      const group = document.createElement('div');
      group.className = 'group'; group.dataset.group = JSON.stringify(g);
      const t = document.createElement('div');
      t.className = 'group-title';
      const chips = Object.entries(g).map(([k, v]) => `<span class="gchip"><i>${esc(k)}</i> ${esc(v)}</span>`).join('');
      t.innerHTML = `<span class="gchips">${chips}</span><span class="ghint"><i>${esc(across.name)}</i> →${down ? ` <i>${esc(down.name)}</i> ↓` : ''}</span>`;
      group.append(t);
      const grid = document.createElement('div');
      grid.className = 'mgrid'; grid.style.setProperty('--cols', across.options.length);
      grid.dataset.rows = down ? '1' : '0';
      const head = (cls, text, base) => { const d = document.createElement('div'); d.className = cls + (base ? ' is-base' : ''); d.innerHTML = `<span>${esc(text)}</span>`; return d; };
      if (down) { const corner = document.createElement('div'); corner.className = 'corner'; grid.append(corner); }
      for (const o of across.options) grid.append(head('colhead', o, o === across.default));
      for (const r of down ? down.options : [null]) {
        if (down) grid.append(head('rowhead', r, r === down.default));
        for (const o of across.options) grid.append(cellFor({ ...g, [across.name]: o, ...(down ? { [down.name]: r } : {}) }));
      }
      group.append(grid);
      matrix.append(group);
    }
    return matrix;
  }

  async function render(id) {
    const c = ctx.state.components.get(id);
    if (!c) return;
    const sec = section(id);
    const token = ++sec.token;
    header(id);
    const res = await fetch(`/bundle/${encodeURIComponent(id)}.js?rev=${c.revision}`);
    if (token !== sec.token) return; // a newer revision is already on its way
    const err = sec.el.querySelector('.build-error');
    if (!res.ok) {
      err.textContent = `build failed: ${(await res.json().catch(() => ({}))).error || res.status}`;
      sec.el.dataset.ready = '1';
      return;
    }
    err.textContent = '';
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    let mod; try { mod = await import(url); } finally { URL.revokeObjectURL(url); }
    if (token !== sec.token) return;
    const unmounts = [];
    const cellFor = (variant) => {
      const fig = document.createElement('figure');
      fig.className = 'cell'; fig.dataset.variant = JSON.stringify(variant);
      const mount = document.createElement('div'); mount.className = 'mount';
      const cap = document.createElement('figcaption'); cap.textContent = variantLabel(variant);
      fig.append(mount, cap);
      try { unmounts.push(mod.mount(mount, variant)); }
      catch (e) { mount.innerHTML = '<div class="error"></div>'; mount.firstChild.textContent = `render failed: ${e.message}`; }
      return fig;
    };
    const matrix = buildMatrix(c.doc, cellFor);
    const old = sec.unmounts;
    sec.frame.replaceChildren(matrix);
    sec.unmounts = unmounts;
    queueMicrotask(() => old.forEach((u) => u()));
    sec.el.dataset.revision = c.revision; sec.el.dataset.ready = '1';
    sec.el.querySelector('.rev').textContent = `r${c.revision}`;
    measure(sec);
    if (laidOut && !sec.pos) placeNew(id);
    // Keep the selection while its nodes still exist; drop the ones that are gone.
    const sels = ctx.state.selections.filter((s) => !(s.component === id && !(c.doc && index(c.doc).byId.has(s.node))));
    if (sels.length !== ctx.state.selections.length) ctx.selectMany(sels);
    refreshOverlays();
    ctx.emit('render', { component: id, revision: c.revision });
  }

  function remove(id) {
    const sec = sections.get(id);
    if (!sec) return;
    sec.token++; sec.unmounts.forEach((u) => u()); sec.el.remove(); sections.delete(id); auto.delete(id);
    if (ctx.state.selections.some((s) => s.component === id)) ctx.selectMany(ctx.state.selections.filter((s) => s.component !== id));
  }

  // ---------------------------------------------------------------------------------------------- placement
  function measure(sec) {
    if (sec.culled) return;
    sec.size = { w: sec.frame.offsetWidth, h: sec.frame.offsetHeight };
    sec.el.style.setProperty('--w', `${sec.size.w}px`); sec.el.style.setProperty('--h', `${sec.size.h}px`);
  }
  function moveTo(id, x, y) {
    const sec = sections.get(id);
    if (!sec) return;
    sec.pos = { x, y };
    sec.el.style.transform = `translate(${x}px, ${y}px)`;
    sec.el.dataset.pos = '1';
  }
  const placed = (id) => { const s = ctx.state.components.get(id)?.canvas; return !!s && (s.x !== 0 || s.y !== 0); };
  // Components with no saved position are packed once (alphabetically, in rows). Nothing is ever re-packed.
  function layoutAll() {
    const ids = [...sections.keys()];
    for (const id of ids) if (placed(id)) { const s = ctx.state.components.get(id).canvas; moveTo(id, s.x, s.y); }
    const todo = ids.filter((id) => !placed(id) && !auto.has(id)).sort(byName);
    const taken = ids.filter(placed);
    let y = taken.length ? Math.max(...taken.map((id) => sections.get(id).pos.y + sections.get(id).size.h)) + GAP_Y : 0;
    // rows about 1.7 times wider than tall, so a handful of components fits on screen as one block
    const area = todo.reduce((a, id) => a + (sections.get(id).size.w + GAP_X) * (sections.get(id).size.h + GAP_Y), 0);
    SHELF_W = Math.max(1400, ...todo.map((id) => sections.get(id).size.w), Math.round(Math.sqrt(area * 1.7)));
    let x = 0, rowH = 0;
    for (const id of todo) {
      const { w, h } = sections.get(id).size;
      if (x > 0 && x + w > SHELF_W) { x = 0; y += rowH + GAP_Y; rowH = 0; }
      auto.set(id, { x, y }); moveTo(id, x, y);
      x += w + GAP_X; rowH = Math.max(rowH, h);
    }
    laidOut = true;
    ctx.emit('layout', {});
  }
  // A component that appears later goes into the first free slot, so nothing else moves.
  function placeNew(id) {
    if (placed(id)) { const s = ctx.state.components.get(id).canvas; moveTo(id, s.x, s.y); return; }
    const me = sections.get(id), others = [...sections.entries()].filter(([k, s]) => k !== id && s.pos).map(([, s]) => ({ x: s.pos.x, y: s.pos.y, w: s.size.w, h: s.size.h }));
    const { w, h } = me.size, hit = (x, y) => others.some((o) => x < o.x + o.w + GAP_X && x + w + GAP_X > o.x && y < o.y + o.h + GAP_Y * 0.6 && y + h + GAP_Y * 0.6 > o.y);
    let pos = null;
    for (let y = 0; y < 40000 && !pos; y += 80) for (let x = 0; x + w <= SHELF_W && !pos; x += 80) if (!hit(x, y)) pos = { x, y };
    pos ||= { x: 0, y: 0 };
    auto.set(id, pos); moveTo(id, pos.x, pos.y);
  }

  // ---------------------------------------------------------------------------------------------- rectangles (canvas units)
  function componentRect(id) {
    const sec = sections.get(id);
    if (!sec?.pos) return null;
    measure(sec);
    return { x: sec.pos.x, y: sec.pos.y - 36, w: sec.size.w, h: sec.size.h + 36 };
  }
  const elementRect = (el) => view.rectToWorld(el.getBoundingClientRect());
  const union = (rs) => {
    rs = rs.filter(Boolean);
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
  };
  const allRect = () => union([...sections.keys()].map(componentRect));
  function nodeRect(sel) { live(sel.component); const el = selectedElement(sel); return el ? elementRect(el) : null; }
  const selectionRect = () => (ctx.state.selections.length ? union(ctx.state.selections.map(nodeRect)) : null);
  view.setFitters({ all: allRect, selection: selectionRect });

  // ---------------------------------------------------------------------------------------------- overlays
  function place(box, target, label, base) {
    if (!target?.isConnected || target.closest('[data-cull]')) { box.style.display = 'none'; return; }
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', transform: `translate(${r.left - base.left}px, ${r.top - base.top}px)`, width: `${r.width}px`, height: `${r.height}px` });
    if (label !== undefined) box.dataset.label = label;
  }
  function refreshOverlays() {
    const base = overlays.getBoundingClientRect();
    const sels = ctx.state.selections, sel = ctx.state.selection;
    place(selectBox, selectedElement(sel), sel && `${ctx.state.components.get(sel.component)?.name} · ${sel.node}`, base);
    const others = sels.filter((s) => s !== sel);
    while (extras.length < others.length) { const d = document.createElement('div'); d.className = 'overlay-extra'; overlays.append(d); extras.push(d); }
    extras.forEach((d, i) => (others[i] ? place(d, selectedElement(others[i]), undefined, base) : (d.style.display = 'none')));
    place(hoverBox, hoverEl && !sels.some((s) => selectedElement(s) === hoverEl) ? hoverEl : null, undefined, base);
    drawMeasure(base);
    selectBox.dataset.count = String(sels.length);
  }

  // Alt: distance between the selection and the hovered node, in canvas pixels (what the component's CSS sees).
  function drawMeasure(base) {
    const a = measuring && selectedElement(ctx.state.selection), b = measuring && hoverEl;
    measureBox.replaceChildren();
    if (!a || !b || a === b || !a.isConnected || !b.isConnected || a.closest('[data-cull]') || b.closest('[data-cull]')) { measureBox.dataset.active = ''; return; }
    measureBox.dataset.active = '1';
    const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(), z = view.get().z;
    const put = (axis, from, to, cross, value) => {
      if (value < 0.01) return;
      const line = document.createElement('div');
      line.className = `m-line m-${axis}`;
      const [x, y] = axis === 'x' ? [from - base.left, cross - base.top] : [cross - base.left, from - base.top];
      Object.assign(line.style, { transform: `translate(${x}px, ${y}px)`, width: `${axis === 'x' ? to - from : 0}px`, height: `${axis === 'y' ? to - from : 0}px` });
      const label = document.createElement('span');
      label.className = 'm-label'; label.dataset.axis = axis; label.dataset.value = value.toFixed(2);
      label.textContent = String(Math.round(value * 10) / 10);
      line.append(label);
      measureBox.append(line);
    };
    const mid = (lo1, hi1, lo2, hi2) => { const lo = Math.max(lo1, lo2), hi = Math.min(hi1, hi2); return hi > lo ? (lo + hi) / 2 : (lo1 + hi1 + lo2 + hi2) / 4; };
    const cy = mid(A.top, A.bottom, B.top, B.bottom), cx = mid(A.left, A.right, B.left, B.right);
    if (A.right <= B.left) put('x', A.right, B.left, cy, (B.left - A.right) / z);
    else if (B.right <= A.left) put('x', B.right, A.left, cy, (A.left - B.right) / z);
    else {
      put('x', Math.min(A.left, B.left), Math.max(A.left, B.left), cy, Math.abs(A.left - B.left) / z);
      put('x', Math.min(A.right, B.right), Math.max(A.right, B.right), cy, Math.abs(A.right - B.right) / z);
    }
    if (A.bottom <= B.top) put('y', A.bottom, B.top, cx, (B.top - A.bottom) / z);
    else if (B.bottom <= A.top) put('y', B.bottom, A.top, cx, (A.top - B.bottom) / z);
    else {
      put('y', Math.min(A.top, B.top), Math.max(A.top, B.top), cx, Math.abs(A.top - B.top) / z);
      put('y', Math.min(A.bottom, B.bottom), Math.max(A.bottom, B.bottom), cx, Math.abs(A.bottom - B.bottom) / z);
    }
    const mark = document.createElement('div'); mark.className = 'm-target';
    Object.assign(mark.style, { transform: `translate(${B.left - base.left}px, ${B.top - base.top}px)`, width: `${B.width}px`, height: `${B.height}px` });
    measureBox.append(mark);
  }
  addEventListener('keydown', (ev) => { if (ev.key === 'Alt' && !measuring) { measuring = true; ev.preventDefault(); refreshOverlays(); } });
  addEventListener('keyup', (ev) => { if (ev.key === 'Alt') { measuring = false; refreshOverlays(); } });
  addEventListener('blur', () => { if (measuring) { measuring = false; refreshOverlays(); } });

  // ---------------------------------------------------------------------------------------------- culling
  // Far off-screen frames stop being painted (content-visibility), keeping their size. Cheap until a repo is big.
  let cullQueued = false;
  function cull() {
    cullQueued = false;
    if (sections.size <= CULL_AFTER) { for (const sec of sections.values()) if (sec.culled) { sec.culled = false; delete sec.el.dataset.cull; } return; }
    const { x, y, z } = view.get(), b = view.stageBox();
    const m = 0.6; // margin as a share of the viewport
    const x0 = (-x - b.width * m) / z, x1 = (b.width * (1 + m) - x) / z, y0 = (-y - b.height * m) / z, y1 = (b.height * (1 + m) - y) / z;
    const keep = new Set(ctx.state.selections.map((s) => s.component));
    for (const [id, sec] of sections) {
      if (!sec.pos || !sec.size.w) continue;
      const off = !keep.has(id) && (sec.pos.x > x1 || sec.pos.x + sec.size.w < x0 || sec.pos.y - 40 > y1 || sec.pos.y + sec.size.h < y0);
      if (off !== sec.culled) { sec.culled = off; if (off) sec.el.dataset.cull = '1'; else delete sec.el.dataset.cull; }
    }
  }
  const queueCull = () => { if (!cullQueued) { cullQueued = true; requestAnimationFrame(cull); } };
  ctx.on('view', () => { refreshOverlays(); queueCull(); });
  ctx.on('select', () => {
    for (const s of ctx.state.selections) live(s.component);
    const on = new Set(ctx.state.selections.map((s) => s.component));
    for (const [id, sec] of sections) { if (on.has(id)) sec.el.dataset.sel = '1'; else delete sec.el.dataset.sel; }
    const n = ctx.state.selections.length;
    selectBox.dataset.more = String(n - 1);
    refreshOverlays();
  });
  ctx.on('layout', queueCull);

  // ---------------------------------------------------------------------------------------------- pointer: hover, click, marquee, frame drag
  const hit = (target) => {
    const el = target.closest?.('.mount [data-n]');
    const cell = el?.closest('.cell');
    return el && cell && { el, id: cell.closest('.cmp').dataset.component, variant: JSON.parse(cell.dataset.variant) };
  };
  root.addEventListener('mouseover', (ev) => { const h = hit(ev.target); hoverEl = h?.el ?? null; refreshOverlays(); });
  root.addEventListener('mouseleave', () => { hoverEl = null; refreshOverlays(); });
  let suppressClick = 0;
  root.addEventListener('click', (ev) => {
    if (suppressClick && Date.now() - suppressClick < 300) { suppressClick = 0; return; }
    const h = hit(ev.target);
    if (h) ev.preventDefault();
    if (ev.target.closest?.('.cmp-head')) return; // handled by the frame drag (a click on a title selects the component's root)
    if (!h) { if (!ev.target.closest?.('#error')) ctx.select(null); return; }
    const sel = { component: h.id, node: h.el.dataset.n, variant: h.variant };
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) ctx.toggle(sel); else ctx.select(sel);
  }, true);
  window.addEventListener('resize', refreshOverlays);

  // Marquee on empty canvas (select tool).
  const marquee = document.querySelector('#marquee');
  let mq = null;
  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch' || ctx.state.tool !== 'select' || view.isPanning()) return;
    if (ev.target.closest('.mount [data-n], .cmp-head, #error')) return;
    mq = { x: ev.clientX, y: ev.clientY, moved: false, additive: ev.shiftKey };
  });
  addEventListener('pointermove', (ev) => {
    if (!mq) return;
    if (!mq.moved && Math.hypot(ev.clientX - mq.x, ev.clientY - mq.y) < 4) return;
    mq.moved = true;
    const b = root.getBoundingClientRect();
    Object.assign(marquee.style, { left: `${Math.min(mq.x, ev.clientX) - b.left}px`, top: `${Math.min(mq.y, ev.clientY) - b.top}px`, width: `${Math.abs(ev.clientX - mq.x)}px`, height: `${Math.abs(ev.clientY - mq.y)}px` });
    marquee.hidden = false;
  });
  addEventListener('pointerup', (ev) => {
    if (!mq) return;
    const m = mq; mq = null; marquee.hidden = true;
    if (!m.moved) return;
    suppressClick = Date.now();
    const x0 = Math.min(m.x, ev.clientX), x1 = Math.max(m.x, ev.clientX), y0 = Math.min(m.y, ev.clientY), y1 = Math.max(m.y, ev.clientY);
    let best = [];
    for (const [id, sec] of sections) {
      if (sec.culled || !sec.pos) continue;
      const f = sec.frame.getBoundingClientRect();
      if (f.right < x0 || f.left > x1 || f.bottom < y0 || f.top > y1) continue;
      const seen = new Set(), found = [];
      for (const el of sec.el.querySelectorAll('.mount [data-n]')) {
        const r = el.getBoundingClientRect();
        if (r.right < x0 || r.left > x1 || r.bottom < y0 || r.top > y1 || seen.has(el.dataset.n)) continue;
        seen.add(el.dataset.n);
        found.push({ component: id, node: el.dataset.n, variant: JSON.parse(el.closest('.cell').dataset.variant) });
      }
      if (found.length > best.length) best = found;
    }
    if (m.additive && best.length) {
      const keep = ctx.state.selections.filter((s) => s.component === best[0].component && !best.some((b) => b.node === s.node));
      best = [...keep, ...best];
    }
    ctx.selectMany(best);
  }, true);

  // Drag a frame by its title; a plain click on the title selects the component's root.
  let drag = null;
  root.addEventListener('pointerdown', (ev) => {
    const head = ev.target.closest?.('.cmp-head');
    if (!head || ev.button !== 0 || view.isPanning()) return;
    const id = head.closest('.cmp').dataset.component, sec = sections.get(id);
    if (!sec?.pos) return;
    ev.preventDefault();
    drag = { id, x: ev.clientX, y: ev.clientY, from: { ...sec.pos }, moved: false };
    document.body.dataset.dragging = 'frame';
  });
  addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 3) return;
    drag.moved = true;
    const z = view.get().z;
    moveTo(drag.id, Math.round(drag.from.x + (ev.clientX - drag.x) / z), Math.round(drag.from.y + (ev.clientY - drag.y) / z));
    refreshOverlays();
  });
  addEventListener('pointerup', async () => {
    if (!drag) return;
    const d = drag; drag = null; delete document.body.dataset.dragging;
    if (!d.moved) {
      const c = ctx.state.components.get(d.id);
      if (c?.doc) ctx.select({ component: d.id, node: c.doc.root.id, variant: variantGrid(c.doc)[0] });
      return;
    }
    suppressClick = Date.now();
    const pos = sections.get(d.id)?.pos;
    if (!pos) return;
    const c = ctx.state.components.get(d.id);
    if (c) c.canvas = { ...pos };
    auto.delete(d.id);
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(d.id)}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pos) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    } catch (e) { document.querySelector('#error').textContent = `could not save the position: ${e.message}`; }
    ctx.emit('moved', { component: d.id, ...pos });
  });

  return {
    render, remove, header, refreshOverlays, layoutAll, placeNew, moveTo, cull: queueCull,
    componentRect, allRect, selectionRect, nodeRect, cellElement, selectedElement, live,
    sections, position: (id) => sections.get(id)?.pos ?? null,
  };
}
