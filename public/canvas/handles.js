// Direct manipulation on the canvas (LAY-05, LAY-06, LAY-03, LAY-11). Everything here is a gesture: while the pointer is down only the DOM
// (and these overlays) change, and on release ONE ctx.sendEdits batch is sent: one revision per gesture.
//   - resize handles on the selection (Shift keeps the proportions), snapping to sibling and parent edges
//   - padding handles inside a container and gap handles between its children
//   - dragging a layer: reorder in a flex or block parent with an insertion line (and move into another frame), place into a grid cell,
//     or move an absolute layer with smart guides (4 screen px snap, 4 / 8 px grid, Shift locks the axis)
//   - dragging the right edge of a variant cell to preview other widths (kept in the sidecar, never in the .tsx)
// Gesture state is exposed as document.body.dataset.gesture = resize | padding | gap | move | cell while it lasts (the tests read it).
import { index, VOID } from '/src/model.js';
import { isFlex, isGrid, isColumn, sizePatch, pinPatch, pinsOf, snap, constrain, cellAt, placePatch, placementOf } from '/src/layout.js';
import { cssSize, relRect, paddingOf } from './geom.js';

const THRESH = 4;      // screen px: snaps and the start of a drag
const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const holds = (n) => n.text === undefined && !n.textProp && !VOID.has(n.tag);
const num = (v) => parseFloat(v) || 0;

export function initHandles(ctx) {
  const stageEl = document.querySelector('#stage'), overlays = document.querySelector('#overlays');
  const layer = document.createElement('div');
  layer.id = 'handles'; overlays.append(layer);
  const zoom = () => ctx.state.zoom || 1;
  let g = null;             // the active gesture
  let queued = false, dirty = false;

  // ------------------------------------------------------------------------------------------ what is selected
  function current() {
    const s = ctx.state.selection;
    if (!s || ctx.state.selections.length !== 1 || ctx.state.tool !== 'select') return null;
    const c = ctx.state.components.get(s.component);
    if (!c?.doc || c.readOnly) return null;
    const el = ctx.stage.selectedElement(s);
    if (!el?.isConnected || el.closest('[data-cull]')) return null;
    const { byId, parentOf } = index(c.doc), node = byId.get(s.node);
    if (!node) return null;
    const parent = parentOf.get(node.id) ?? null;
    return { s, c, doc: c.doc, el, node, parent, parentEl: parent ? ctx.stage.cellElement(s.component, parent.id, s.variant) : null, byId, parentOf };
  }
  const styleOf = (info, n) => resolved(info, n);
  function resolved(info, n) {
    const out = { ...(n.style || {}) };
    for (const a of info.doc.props.filter((p) => p.type === 'enum')) Object.assign(out, info.doc.variants?.[a.name]?.[info.s.variant?.[a.name] ?? a.default]?.[n.id]);
    return out;
  }

  // ------------------------------------------------------------------------------------------ drawing the handles
  const mkdiv = (cls, attrs = {}) => { const d = document.createElement('div'); d.className = cls; for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v); return d; };
  const place = (d, x, y, w, h) => { d.style.transform = `translate(${x}px, ${y}px)`; if (w !== undefined) { d.style.width = `${w}px`; d.style.height = `${h}px`; } };
  // During a wheel or drag gesture the handles are not rebuilt: a pan moves the layer by the same offset, a zoom hides it until the view settles.
  let drawnAt = null, gesturing = false;
  function draw() {
    queued = false; dirty = false;
    if (g || gesturing) return;
    layer.style.transform = ''; layer.style.visibility = ''; drawnAt = ctx.view?.get() ?? null;
    layer.replaceChildren();
    const info = current();
    if (!info) return;
    const base = overlays.getBoundingClientRect(), r = info.el.getBoundingClientRect(), z = zoom();
    const x = r.left - base.left, y = r.top - base.top;
    for (const [h, [fx, fy]] of Object.entries(HANDLES)) {
      const d = mkdiv('hdl hdl-resize', { 'data-h': h, 'aria-hidden': 'true' });
      place(d, x + fx * r.width, y + fy * r.height);
      layer.append(d);
    }
    const style = resolved(info, info.node);
    const kids = [...info.el.children].filter((k) => k.dataset?.n);
    const cs = getComputedStyle(info.el);
    if (holds(info.node) && info.node.tag !== 'img') {
      const [pt, pr, pb, pl] = paddingOf(info.el).map((v) => v * z);
      const sides = { top: [x + r.width / 2, y + pt / 2, 'h'], bottom: [x + r.width / 2, y + r.height - pb / 2, 'h'], left: [x + pl / 2, y + r.height / 2, 'v'], right: [x + r.width - pr / 2, y + r.height / 2, 'v'] };
      const band = { top: [x, y, r.width, pt], bottom: [x, y + r.height - pb, r.width, pb], left: [x, y, pl, r.height], right: [x + r.width - pr, y, pr, r.height] };
      if (r.width > 60 && r.height > 40) for (const [side, [cx, cy, o]] of Object.entries(sides)) {
        const b = mkdiv('hdl-band', { 'data-side': side }); place(b, ...band[side]); layer.append(b);
        const d = mkdiv(`hdl hdl-pad ${o}`, { 'data-side': side, 'aria-hidden': 'true', title: `Padding ${side}` });
        place(d, cx, cy); layer.append(d);
      }
      if (isFlex(style) && kids.length > 1 && !/space-/.test(String(style.justifyContent))) {
        const col = isColumn(style);
        const gapPx = Math.max(num(cs.rowGap) , num(cs.columnGap)) * z;
        kids.slice(0, -1).forEach((k, i) => {
          const a = k.getBoundingClientRect(), b = kids[i + 1].getBoundingClientRect();
          if (col ? b.top < a.bottom - 1 : b.left < a.right - 1) return; // wrapped onto a new line: not a gap on this axis
          const band2 = mkdiv('hdl-gapband', {}), d = mkdiv(`hdl hdl-gap ${col ? 'h' : 'v'}`, { 'data-i': String(i + 1), 'aria-hidden': 'true', title: 'Gap' });
          if (col) { place(band2, a.left - base.left, a.bottom - base.top, a.width, Math.max(gapPx, 2)); place(d, a.left - base.left + a.width / 2, a.bottom - base.top + Math.max(gapPx, 2) / 2); }
          else { place(band2, a.right - base.left, a.top - base.top, Math.max(gapPx, 2), a.height); place(d, a.right - base.left + Math.max(gapPx, 2) / 2, a.top - base.top + a.height / 2); }
          layer.append(band2, d);
        });
      }
      if (isGrid(style)) drawTracks(info, cs, base);
    }
  }
  function drawTracks(info, cs, base) {
    const z = zoom(), r = info.el.getBoundingClientRect();
    const cols = cs.gridTemplateColumns.split(' ').map(num), rows = cs.gridTemplateRows.split(' ').map(num);
    const gx = num(cs.columnGap), gy = num(cs.rowGap), ox = r.left + (num(cs.borderLeftWidth) + num(cs.paddingLeft)) * z, oy = r.top + (num(cs.borderTopWidth) + num(cs.paddingTop)) * z;
    let at = 0;
    cols.forEach((w) => { const d = mkdiv('hdl-track v'); place(d, ox + at * z - base.left, r.top - base.top, w * z, r.height); layer.append(d); at += w + gx; });
    at = 0;
    rows.forEach((h) => { const d = mkdiv('hdl-track h'); place(d, r.left - base.left, oy + at * z - base.top, r.width, h * z); layer.append(d); at += h + gy; });
  }
  const schedule = () => { dirty = true; if (!queued) { queued = true; requestAnimationFrame(draw); } };
  for (const e of ['overlays', 'select', 'render', 'tool']) ctx.on(e, schedule);
  ctx.on('view', (v) => {
    if (!v.gesture || !drawnAt) { gesturing = false; schedule(); return; }
    if (v.z === drawnAt.z) { gesturing = true; layer.style.transform = `translate(${v.x - drawnAt.x}px, ${v.y - drawnAt.y}px)`; } // a pan: the handles move with the world
    else { gesturing = false; schedule(); } // a zoom: they are drawn again at the new size, in the next frame (the geometry is read from a world that has not changed layout)
  });
  ctx.on('viewsettle', () => { if (gesturing) { gesturing = false; schedule(); } });

  // ------------------------------------------------------------------------------------------ gesture plumbing
  let frame = 0, pending = null, lastEv = null;
  const stats = []; // the main-thread cost of each gesture frame (ms), kept for the performance check (LAY-05)
  function begin(kind, ev, extra) {
    g = { kind, x0: ev.clientX, y0: ev.clientY, moved: false, info: current(), ...extra };
    if (!g.info) { g = null; return false; }
    document.body.dataset.gesture = kind; layer.classList.add('busy');
    addEventListener('pointermove', onMove, true); addEventListener('pointerup', onUp, true); addEventListener('pointercancel', onCancel, true); addEventListener('keydown', onKey, true);
    return true;
  }
  function onMove(ev) {
    if (!g) return;
    lastEv = ev;
    if (!g.moved && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < THRESH) return;
    if (!g.moved) { g.moved = true; g.start?.(); }
    ev.preventDefault();
    pending = ev;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (g && pending) { const t0 = performance.now(); g.move(pending); stats.push(performance.now() - t0); if (stats.length > 4000) stats.shift(); } });
  }
  async function onUp(ev) {
    if (!g) return;
    cancelAnimationFrame(frame); frame = 0;
    const cur = g; 
    if (cur.moved) { cur.move(ev); }
    cleanup();
    if (cur.moved) { swallowClick = Date.now(); try { await cur.end?.(ev); } finally { g = null; } } else g = null;
    schedule();
  }
  function onCancel() { if (!g) return; const cur = g; cleanup(); cur.undo?.(); g = null; schedule(); }
  function onKey(ev) { if (ev.key === 'Escape' && g) { ev.preventDefault(); ev.stopPropagation(); onCancel(); } }
  function cleanup() {
    removeEventListener('pointermove', onMove, true); removeEventListener('pointerup', onUp, true); removeEventListener('pointercancel', onCancel, true); removeEventListener('keydown', onKey, true);
    layer.classList.remove('busy'); delete document.body.dataset.gesture;
    layer.querySelectorAll('.hdl-guide, .hdl-line, .hdl-cellhl, .hdl-chip, .hdl-ghost').forEach((n) => n.remove());
    pending = null;
  }
  let swallowClick = 0;
  document.addEventListener('click', (ev) => { if (swallowClick && Date.now() - swallowClick < 400) { swallowClick = 0; ev.stopPropagation(); ev.preventDefault(); } }, true);

  const send = (info, edits) => (edits.length ? ctx.sendEdits(info.s.component, edits) : Promise.resolve({ ok: true }));
  // edits for a style patch on a node (base, or the selected variant is never used here: gestures write the base)
  const patchEdits = (id, patch, was) => Object.entries(patch).filter(([k, v]) => (v === null ? was[k] !== undefined : was[k] !== v)).map(([k, v]) => ({ op: 'set', path: `${id}.${k}`, value: v }));
  function chip(text, x, y) {
    let c = layer.querySelector('.hdl-chip');
    if (!c) { c = mkdiv('hdl-chip'); layer.append(c); }
    c.textContent = text; c.style.transform = `translate(${x}px, ${y}px)`;
  }
  const baseBox = () => overlays.getBoundingClientRect();
  const guides = (list) => {
    layer.querySelectorAll('.hdl-guide').forEach((n) => n.remove());
    const base = baseBox(), z = zoom();
    for (const gd of list) {
      const d = mkdiv(`hdl-guide ${gd.axis}`);
      const o = g.origin; // canvas coords -> screen: screen = canvas * z + origin
      if (gd.axis === 'x') place(d, gd.at * z + o.x - base.left, gd.from * z + o.y - base.top, 1, (gd.to - gd.from) * z);
      else place(d, gd.from * z + o.x - base.left, gd.at * z + o.y - base.top, (gd.to - gd.from) * z, 1);
      layer.append(d);
    }
  };
  // siblings and the parent as snap targets, in "canvas px relative to a fixed origin" (screen rect / zoom)
  function targetsFor(info) {
    const z = zoom(), out = [];
    const toRect = (r, kind) => ({ x: r.left / z, y: r.top / z, w: r.width / z, h: r.height / z, kind });
    if (info.parentEl) {
      const pr = info.parentEl.getBoundingClientRect();
      const inner = { left: pr.left + info.parentEl.clientLeft * z, top: pr.top + info.parentEl.clientTop * z, width: info.parentEl.clientWidth * z, height: info.parentEl.clientHeight * z };
      out.push(toRect(inner, 'parent'));
      for (const k of info.parentEl.children) if (k !== info.el && k.dataset?.n) out.push(toRect(k.getBoundingClientRect(), 'sibling'));
    }
    return out;
  }
  const gridStep = () => (zoom() >= 2 ? 4 : 8);
  // where the parent's inner box starts, in the same units as targetsFor (screen px / zoom): the 8 px grid is measured from here
  const gridOrigin = (info) => { const z = zoom(), pe = info.parentEl; if (!pe) return { x: 0, y: 0 }; const r = pe.getBoundingClientRect(); return { x: (r.left + pe.clientLeft * z) / z, y: (r.top + pe.clientTop * z) / z }; };

  // ------------------------------------------------------------------------------------------ resize
  layer.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const h = ev.target.closest('.hdl-resize'), pad = ev.target.closest('.hdl-pad'), gap = ev.target.closest('.hdl-gap');
    if (!h && !pad && !gap) return;
    ev.preventDefault(); ev.stopPropagation();
    if (h) startResize(ev, h.dataset.h); else if (pad) startPadding(ev, pad.dataset.side); else startGap(ev, Number(gap.dataset.i));
  });
  function startResize(ev, hd) {
    const z = zoom();
    const ok = begin('resize', ev, {});
    if (!ok) return;
    const { info } = g, r0 = info.el.getBoundingClientRect(), style = resolved(info, info.node);
    const abs = style.position === 'absolute', targets = targetsFor(info);
    g.origin = { x: 0, y: 0 };
    const w0 = r0.width / z, h0 = r0.height / z, was = { width: info.el.style.width, height: info.el.style.height, left: info.el.style.left, top: info.el.style.top, flex: info.el.style.flex, alignSelf: info.el.style.alignSelf };
    g.result = null;
    g.move = (ev2) => {
      let dx = (ev2.clientX - g.x0) / z, dy = (ev2.clientY - g.y0) / z;
      const west = hd.includes('w'), east = hd.includes('e'), north = hd.includes('n'), south = hd.includes('s');
      // snap the edge that moves
      const res = snap({ x: r0.left / z + (east ? w0 + dx : west ? dx : 0), y: r0.top / z + (south ? h0 + dy : north ? dy : 0), w: 0, h: 0 }, targets, { threshold: THRESH / z, grid: ev2.altKey ? 0 : gridStep(), origin: gridOrigin(info), edges: [...(east || west ? ['l'] : []), ...(north || south ? ['t'] : [])] });
      if (east || west) dx += res.dx; if (north || south) dy += res.dy;
      let w = Math.max(1, w0 + (east ? dx : west ? -dx : 0)), h = Math.max(1, h0 + (south ? dy : north ? -dy : 0));
      if (ev2.shiftKey && (east || west) && (north || south)) { const k = Math.max(w / w0, h / h0); w = w0 * k; h = h0 * k; }
      w = Math.round(w); h = Math.round(h);
      const box = cssSize(info.el, w, h);
      if (east || west) { info.el.style.flex = 'none'; info.el.style.width = `${box.w}px`; }
      if (north || south) { info.el.style.alignSelf = 'auto'; info.el.style.height = `${box.h}px`; }
      g.result = { w, h, dx, dy, west, north, box };
      const moved = { x: r0.left / z + (west ? w0 - w : 0), y: r0.top / z + (north ? h0 - h : 0), w, h };
      guides(snap(moved, targets, { threshold: 0.6, edges: [...(east || west ? ['l', 'r'] : []), ...(north || south ? ['t', 'b'] : [])] }).guides);
      ctx.stage.refreshOverlays();
    };
    g.end = async () => {
      const res = g.result; if (!res) return;
      const edits = [];
      const parentStyle = info.parent ? resolved(info, info.parent) : undefined;
      const sx = res.w !== Math.round(w0) && (hd.includes('e') || hd.includes('w')), sy = res.h !== Math.round(h0) && (hd.includes('n') || hd.includes('s'));
      if (abs && info.parentEl) {
        const { rect, parent } = relRect(info.el, info.parentEl, z);
        const patch = pinPatch(pinsOf(style), { x: rect.x, y: rect.y, w: res.w, h: res.h }, parent, style);
        edits.push(...patchEdits(info.node.id, patch, style));
      } else {
        if (sx) edits.push(...patchEdits(info.node.id, sizePatch(style, parentStyle, 'width', 'fixed', res.box.w), style));
        if (sy) edits.push(...patchEdits(info.node.id, sizePatch(style, parentStyle, 'height', 'fixed', res.box.h), style));
      }
      const r = await send(info, edits);
      if (!edits.length || !r.ok) Object.assign(info.el.style, was); // a landed edit is redrawn by the render; otherwise put the old size back
    };
    g.undo = () => { Object.assign(info.el.style, was); ctx.stage.refreshOverlays(); };
  }

  // ------------------------------------------------------------------------------------------ padding and gap
  function startPadding(ev, side) {
    const z = zoom();
    if (!begin('padding', ev, {})) return;
    const { info } = g, el = info.el, b0 = paddingOf(el), was = el.style.padding, idx = { top: 0, right: 1, bottom: 2, left: 3 }[side];
    const sign = side === 'top' || side === 'left' ? 1 : -1, horiz = side === 'left' || side === 'right';
    g.move = (ev2) => {
      const d = ((horiz ? ev2.clientX - g.x0 : ev2.clientY - g.y0) / z) * sign;
      const b = [...b0];
      const v = Math.max(0, Math.round(b0[idx] + d));
      if (ev2.shiftKey) b.fill(v); else if (ev2.altKey) { b[idx] = v; b[(idx + 2) % 4] = v; } else b[idx] = v;
      el.style.padding = b.map((x) => `${x}px`).join(' ');
      g.result = b;
      const r = el.getBoundingClientRect(), base = baseBox();
      chip(`${b[idx]}`, r.left - base.left + r.width / 2, r.top - base.top - 22);
      ctx.stage.refreshOverlays();
    };
    g.end = async () => {
      const b = g.result; if (!b) { el.style.padding = was; return; }
      const same = b.every((x) => x === b[0]);
      if (b.every((x, i) => Math.round(x) === Math.round(b0[i]))) { el.style.padding = was; return; }
      const r = await send(info, [{ op: 'set', path: `${info.node.id}.padding`, value: same ? b[0] : b.map((x) => `${x}px`).join(' ') }]);
      if (!r.ok) el.style.padding = was;
    };
    g.undo = () => { el.style.padding = was; ctx.stage.refreshOverlays(); };
  }
  function startGap(ev, i) {
    const z = zoom();
    if (!begin('gap', ev, {})) return;
    const { info } = g, el = info.el, style = resolved(info, info.node), col = isColumn(style), cs = getComputedStyle(el);
    const g0 = Math.round(num(col ? cs.rowGap : cs.columnGap)), was = el.style.gap;
    g.move = (ev2) => {
      const d = ((col ? ev2.clientY - g.y0 : ev2.clientX - g.x0) / z) / i;
      const v = Math.max(0, Math.round(g0 + d));
      el.style.gap = `${v}px`; g.result = v;
      const r = el.getBoundingClientRect(), base = baseBox();
      chip(`${v}`, r.left - base.left + r.width / 2, r.top - base.top - 22);
      ctx.stage.refreshOverlays();
    };
    g.end = async () => { const v = g.result; if (v === undefined || v === g0) { el.style.gap = was; return; } const r = await send(info, [{ op: 'set', path: `${info.node.id}.gap`, value: v }]); if (!r.ok) el.style.gap = was; };
    g.undo = () => { el.style.gap = was; ctx.stage.refreshOverlays(); };
  }

  // ------------------------------------------------------------------------------------------ dragging a layer
  stageEl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch' || ctx.state.tool !== 'select' || g) return;
    if (ev.target.closest('.hdl, .cell-grip')) return;
    const el = ev.target.closest?.('.mount [data-n]');
    if (!el || ev.shiftKey || ev.metaKey || ev.ctrlKey) return;
    const cell = el.closest('.cell'), sec = el.closest('.cmp');
    const sel = { component: sec.dataset.component, node: el.dataset.n, variant: JSON.parse(cell.dataset.variant) };
    const c = ctx.state.components.get(sel.component);
    if (!c?.doc || c.readOnly || c.doc.root.id === sel.node) return;
    startMove(ev, sel, el);
  });
  function startMove(ev, sel, el) {
    // select on the first move (a plain click still selects through the stage's click handler)
    const z = zoom();
    const already = ctx.state.selections.length === 1 && ctx.state.selection.component === sel.component && ctx.state.selection.node === sel.node;
    const ok = (() => {
      g = { kind: 'move', x0: ev.clientX, y0: ev.clientY, moved: false, info: null };
      document.body.dataset.gesture = 'move';
      addEventListener('pointermove', onMove, true); addEventListener('pointerup', onUp, true); addEventListener('pointercancel', onCancel, true); addEventListener('keydown', onKey, true);
      layer.classList.add('busy');
      return true;
    })();
    if (!ok) return;
    g.start = () => {
      if (!already) ctx.select(sel);
      g.info = current();
      if (!g.info) { onCancel(); return; }
      const info = g.info, style = resolved(info, info.node);
      const base = baseBox();
      g.origin = { x: 0, y: 0 };
      const r0 = info.el.getBoundingClientRect();
      const parentStyle = info.parent ? resolved(info, info.parent) : null;
      g.mode = style.position === 'absolute' && info.parentEl ? 'abs' : parentStyle && isGrid(parentStyle) ? 'grid' : 'flow';
      if (g.mode === 'abs') g.rel0 = relRect(info.el, info.parentEl, z);
      const ccs = getComputedStyle(info.el); g.baseLeft = num(ccs.left); g.baseTop = num(ccs.top);
      g.r0 = r0; g.style = style; g.parentStyle = parentStyle; g.targets = targetsFor(info);
      g.wasOp = info.el.style.opacity; g.wasPE = info.el.style.pointerEvents; g.wasLeft = info.el.style.left; g.wasTop = info.el.style.top;
      info.el.style.pointerEvents = 'none';
      if (g.mode !== 'abs') info.el.style.opacity = '.45';
      const ghost = mkdiv('hdl-ghost'); place(ghost, r0.left - base.left, r0.top - base.top, r0.width, r0.height); layer.append(ghost); g.ghost = ghost;
      document.body.dataset.gesture = g.mode === 'abs' ? 'move' : 'reorder';
      void z;
    };
    g.move = (ev2) => {
      const info = g.info; if (!info) return;
      const z2 = zoom(), base = baseBox();
      let dx = ev2.clientX - g.x0, dy = ev2.clientY - g.y0;
      if (ev2.shiftKey) [dx, dy] = constrain(dx, dy);
      g.ghost.style.transform = `translate(${g.r0.left - base.left + dx}px, ${g.r0.top - base.top + dy}px)`;
      if (g.mode === 'abs') {
        const res = snap({ x: (g.r0.left + dx) / z2, y: (g.r0.top + dy) / z2, w: g.r0.width / z2, h: g.r0.height / z2 }, g.targets, { threshold: THRESH / z2, grid: ev2.altKey ? 0 : gridStep(), origin: gridOrigin(info) });
        const ax = dx + res.dx * z2, ay = dy + res.dy * z2;
        g.result = { dx: ax / z2, dy: ay / z2 };
        info.el.style.left = `${Math.round(g.baseLeft + ax / z2)}px`;
        info.el.style.top = `${Math.round(g.baseTop + ay / z2)}px`;
        guides(snap({ x: (g.r0.left + ax) / z2, y: (g.r0.top + ay) / z2, w: g.r0.width / z2, h: g.r0.height / z2 }, g.targets, { threshold: 0.6 }).guides);
        ctx.stage.refreshOverlays();
      } else if (g.mode === 'grid') {
        const hit = gridCellAt(info, ev2.clientX, ev2.clientY);
        g.result = hit; showCell(hit);
      } else {
        const drop = dropAt(info, ev2.clientX, ev2.clientY);
        g.result = drop; showLine(drop);
      }
    };
    g.end = async () => {
      const info = g.info; if (!info) return;
      const res = g.result;
      if (!res || res.noop || (g.mode === 'flow' && !res.parent) || (g.mode === 'grid' && !res.col)) { restoreMove(); return; }
      if (g.mode === 'abs') {
        const { rect, parent } = g.rel0; // where it was before the preview moved it
        const patch = pinPatch(pinsOf(g.style), { x: rect.x + res.dx, y: rect.y + res.dy, w: rect.w, h: rect.h }, parent, g.style);
        for (const k of ['width', 'height']) if (g.style[k] === undefined) delete patch[k]; // a drag only moves
        const edits = patchEdits(info.node.id, patch, g.style);
        const r = await send(info, edits); if (!edits.length || !r.ok) restoreMove();
      } else if (g.mode === 'grid') {
        const cur = placementOf(g.style);
        if (cur.col === res.col && cur.row === res.row) { restoreMove(); return; }
        const r = await send(info, patchEdits(info.node.id, placePatch(g.style, res.col, res.row), g.style)); if (!r.ok) restoreMove();
      } else {
        const r = await send(info, [{ op: 'move', id: info.node.id, parent: res.parent, index: res.index }]); if (!r.ok) restoreMove();
      }
    };
    g.undo = () => { restoreMove(); ctx.stage.refreshOverlays(); };
  }
  function restoreMove() {
    const info = g?.info; if (!info?.el) return;
    info.el.style.opacity = g.wasOp ?? ''; info.el.style.pointerEvents = g.wasPE ?? '';
    if (g.mode === 'abs') { info.el.style.left = g.wasLeft ?? ''; info.el.style.top = g.wasTop ?? ''; }
  }

  // Where would the dragged layer land? The deepest frame under the pointer (in the same variant cell) is the new parent; the index comes
  // from the siblings' positions along the parent's direction. The index is counted without the dragged layer (what `move` expects).
  function dropAt(info, x, y) {
    const cell = info.el.closest('.cell');
    const under = document.elementFromPoint(x, y)?.closest?.('.mount [data-n]');
    let tEl = under && cell.contains(under) ? under : info.parentEl;
    let tNode = info.byId.get(tEl.dataset.n);
    if (!tNode) return null;
    // an element with nothing in it is a box to sit beside, unless the pointer is in its middle; text and images are never containers
    const mid = (e) => { const r = e.getBoundingClientRect(); return Math.abs(x - (r.left + r.width / 2)) < r.width * 0.18 && Math.abs(y - (r.top + r.height / 2)) < r.height * 0.18; };
    if (!holds(tNode) || (!tNode.children.length && tEl !== info.parentEl && !mid(tEl))) { tEl = tEl.parentElement.closest('[data-n]'); tNode = tEl && info.byId.get(tEl.dataset.n); if (!tNode) return null; }
    for (let p = tNode; p; p = info.parentOf.get(p.id)) if (p.id === info.node.id) return null; // not into itself
    const style = resolved(info, tNode), col = !isFlex(style) || isColumn(style);
    const kids = [...tEl.children].filter((k) => k.dataset?.n && k !== info.el);
    let at = kids.length, line = null;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      const before = col ? y < r.top + r.height / 2 : (y < r.top || (y <= r.bottom && x < r.left + r.width / 2));
      if (before) { at = i; break; }
    }
    // the line sits on the near edge of the sibling it goes before, or past the far edge of the last one
    const tr = tEl.getBoundingClientRect();
    if (kids.length) {
      const k = kids[Math.min(at, kids.length - 1)].getBoundingClientRect(), after = at >= kids.length;
      line = col ? { x: k.left, y: after ? k.bottom : k.top, w: k.width, h: 0 } : { x: after ? k.right : k.left, y: k.top, w: 0, h: k.height };
    } else line = col ? { x: tr.left + 8, y: tr.top + 8, w: Math.max(0, tr.width - 16), h: 0 } : { x: tr.left + 8, y: tr.top + 8, w: 0, h: Math.max(0, tr.height - 16) };
    const sameParent = info.parent && tNode.id === info.parent.id;
    const order = info.parent ? info.parent.children.filter((c) => c.id !== info.node.id) : [];
    const noop = sameParent && order.map((c) => c.id).slice(0, at).length === at && info.parent.children.indexOf(info.node) === at;
    return { parent: tNode.id, index: at, line, noop };
  }
  function showLine(drop) {
    layer.querySelectorAll('.hdl-line').forEach((n) => n.remove());
    if (!drop?.line) return;
    const base = baseBox(), l = drop.line, d = mkdiv('hdl-line' + (drop.noop ? ' noop' : ''));
    place(d, l.x - base.left - (l.w === 0 ? 1 : 0), l.y - base.top - (l.h === 0 ? 1 : 0), Math.max(l.w, 2), Math.max(l.h, 2));
    layer.append(d);
  }
  function gridCellAt(info, x, y) {
    const pe = info.parentEl, cs = getComputedStyle(pe), z = zoom(), r = pe.getBoundingClientRect();
    const cols = cs.gridTemplateColumns.split(' ').map(num), rows = cs.gridTemplateRows.split(' ').map(num);
    const ox = r.left + (num(cs.borderLeftWidth) + num(cs.paddingLeft)) * z, oy = r.top + (num(cs.borderTopWidth) + num(cs.paddingTop)) * z;
    if (!cols.length || !rows.length) return null;
    const cell = cellAt(cols, rows, num(cs.columnGap), num(cs.rowGap), (x - ox) / z, (y - oy) / z);
    let cx = 0, cy = 0;
    for (let i = 0; i < cell.col - 1; i++) cx += cols[i] + num(cs.columnGap);
    for (let i = 0; i < cell.row - 1; i++) cy += rows[i] + num(cs.rowGap);
    return { ...cell, rect: { x: ox + cx * z, y: oy + cy * z, w: cols[cell.col - 1] * z, h: rows[cell.row - 1] * z } };
  }
  function showCell(hit) {
    layer.querySelectorAll('.hdl-cellhl').forEach((n) => n.remove());
    if (!hit) return;
    const base = baseBox(), d = mkdiv('hdl-cellhl'); place(d, hit.rect.x - base.left, hit.rect.y - base.top, hit.rect.w, hit.rect.h);
    d.dataset.col = hit.col; d.dataset.row = hit.row; layer.append(d);
  }

  // ------------------------------------------------------------------------------------------ preview widths (LAY-11)
  stageEl.addEventListener('pointerdown', (ev) => {
    const grip = ev.target.closest?.('.cell-grip');
    if (!grip || ev.button !== 0 || grip.closest('.doc-cell')) return; // an HTML or JSX frame sizes itself (doc-frames.js)
    ev.preventDefault(); ev.stopPropagation();
    const cell = grip.closest('.cell'), mount = cell.querySelector('.mount'), id = cell.closest('.cmp').dataset.component, z = zoom();
    const w0 = mount.getBoundingClientRect().width / z, was = mount.style.width;
    g = { kind: 'cell', x0: ev.clientX, y0: ev.clientY, moved: false, info: {} };
    document.body.dataset.gesture = 'cell';
    addEventListener('pointermove', onMove, true); addEventListener('pointerup', onUp, true); addEventListener('pointercancel', onCancel, true); addEventListener('keydown', onKey, true);
    g.move = (ev2) => {
      const w = Math.max(24, Math.round(w0 + (ev2.clientX - g.x0) / z));
      mount.style.width = `${w}px`; cell.dataset.pw = String(w); g.result = w;
      ctx.stage.measureAll?.(id); ctx.stage.refreshOverlays();
    };
    g.end = async () => {
      const w = g.result; if (w === undefined) return;
      await ctx.fetch(`/api/components/${encodeURIComponent(id)}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variant: JSON.parse(cell.dataset.variant), width: w }) });
    };
    g.undo = () => { mount.style.width = was; if (!was) delete cell.dataset.pw; ctx.stage.refreshOverlays(); };
  }, true);
  stageEl.addEventListener('dblclick', async (ev) => {
    const grip = ev.target.closest?.('.cell-grip');
    if (!grip) return;
    ev.stopPropagation();
    const cell = grip.closest('.cell'), id = cell.closest('.cmp').dataset.component;
    cell.querySelector('.mount').style.width = ''; delete cell.dataset.pw;
    await ctx.fetch(`/api/components/${encodeURIComponent(id)}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ variant: JSON.parse(cell.dataset.variant), width: null }) });
  }, true);

  const api = { draw, busy: () => !!g, gesture: () => g?.kind ?? null, stats };
  ctx.handles = api;
  return api;
}
