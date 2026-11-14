// The viewport (CAN-01). One transform on one layer (#world): translate(x, y) scale(z), z from 5% to 800%.
// Everything else (component frames, matrices) lives inside #world in canvas units, so panning and zooming
// never lay anything out again. Selection overlays live outside it in screen pixels and are refreshed in
// the same call that moves the world (listeners of 'view'), so they are never a frame behind.
//
//   view.get() -> { x, y, z }         view.set({ x, y, z }, { animate })     view.zoomAt(sx, sy, z)
//   view.panBy(dx, dy)                view.fitRect(worldRect, { pad, max })   view.flyTo(worldRect, opts)
//   view.toWorld(sx, sy)              view.rectToWorld(domRect)               view.stageBox()
// Bindings: wheel/trackpad pans; Ctrl/Cmd-wheel and pinch zoom to the cursor; Space-drag, middle-drag and
// one-finger touch drag pan; + / - zoom; Shift+1 fit all, Shift+2 fit selection, Shift+0 is 100%.
export const MIN_Z = 0.05, MAX_Z = 8;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
// The labels' scale (--nk-lf) at a zoom: 1 / zoom, so a card's label is 11 px with a 4 px gap on screen at every zoom (docs/basics/standards.md 3.2):
// counter-scaled up when zoomed out (to 16x, the 200-component fit) and down when zoomed in. Quantised so it changes rarely: in 1/20 steps of
// 1 / zoom below 100%, of the zoom above it (within 1% of exact either way).
export const labelScale = (z) => z <= 1 ? Math.round(clamp(1 / z, 1, 16) * 20) / 20 : 1 / (Math.round(clamp(z, 1, MAX_Z) * 20) / 20);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createView(ctx, stageEl, worldEl) {
  let v = { x: 80, y: 120, z: 1 };
  let anim = null, target = null; // target: where a running animation ends
  let box = stageEl.getBoundingClientRect();
  let lastPointer = null;       // last pointer position over the stage, for keyboard zoom
  let movingTimer = 0;
  let fitters = { all: () => null, selection: () => null }; // set by the stage
  const view = {};

  const stageBox = () => box;
  new ResizeObserver(() => { box = stageEl.getBoundingClientRect(); apply(); }).observe(stageEl);

  // A gesture (wheel, drag, pinch) moves the world by compositor transform only: nothing that needs a layout or a re-raster of the frames
  // runs per event. The label counter-scale, the zoom band and the overlays are brought exact in settle(), 160 ms after the last event.
  let zoomedSinceRaster = false, rasterZ = v.z;
  let labelZ = v.z, labelsStale = false, dotZ = 0;
  // The dot grid is the world's floor, in world units (a 24-unit pitch), first under every frame. It moves and scales with the world, so a gesture changes
  // nothing but the world's transform; its dots are redrawn at 1 screen pixel when the view settles. Being one painted area under all the frames, it also
  // lets Chromium paint every frame into the world's one layer: on a bare (sparse) world each frame was a layer of its own (839 at 2560x1440 with 1,000
  // files), and every frame of a pan or zoom re-layerized them all. (Not a layer itself: no will-change, or the frames over it would be layers again.)
  const FLOOR = 24 * 41667; // about a million units each way from the origin, on the pitch so a dot sits on (0, 0)
  const grid = document.createElement('div'); grid.id = 'grid'; grid.setAttribute('aria-hidden', 'true'); worldEl.prepend(grid);
  Object.assign(grid.style, { left: `${-FLOOR}px`, top: `${-FLOOR}px`, width: `${2 * FLOOR}px`, height: `${2 * FLOOR}px` });
  function labels() {
    const { z } = v; labelsStale = false; labelZ = z;
    const ls = Math.round(clamp(1 / z, 1, 3.2) * 20) / 20; // label scale, quantised so it changes rarely
    if (worldEl.dataset.ls !== String(ls)) { worldEl.dataset.ls = String(ls); worldEl.style.setProperty('--nk-ls', ls); }
    const lf = labelScale(z); // titles and the axis strip stay readable down to the 200-component fit, and stay chrome-sized above 100%
    if (worldEl.dataset.lf !== String(lf)) { worldEl.dataset.lf = String(lf); worldEl.style.setProperty('--nk-lf', lf); }
    // (an attribute written with the value it already has still repaints the page: only write on a change)
    const hdr = z < 0.4 ? 'strip' : '', band = z < 0.25 ? 'far' : z < 0.6 ? 'mid' : 'near';
    if (stageEl.dataset.hdr !== hdr) stageEl.dataset.hdr = hdr;
    if (stageEl.dataset.zoomBand !== band) stageEl.dataset.zoomBand = band;
  }
  function placeGrid() {
    const r = 1 / v.z;
    if (r === dotZ) return; dotZ = r;
    grid.style.backgroundImage = `radial-gradient(circle at ${r}px ${r}px, var(--nk-dot) ${r}px, transparent ${1.4 * r}px)`;
  }
  function apply(gesture = false) {
    const { x, y, z } = v;
    worldEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${z})`;
    if (gesture && z !== labelZ) labelsStale = true; else labels();
    // (not custom properties: a custom property set on #stage is inherited by every element under it, and each pan event would restyle them all)
    // (kept for readers of the stage style; the dots are drawn by #grid). Not during a gesture: any paint change re-layerizes every drawn frame, so a gesture changes only transforms.
    if (!gesture) stageEl.style.backgroundPosition = `${x}px ${y}px`;
    if (!gesture) placeGrid(); // (in a gesture the dots scale with the world, and are redrawn at their size on settle)
    ctx.state.zoom = z; if (z !== rasterZ) { rasterZ = z; zoomedSinceRaster = true; }
    if (!document.body.classList.contains('moving')) document.body.classList.add('moving'); clearTimeout(movingTimer); movingTimer = setTimeout(settle, 160);
    ctx.emit('view', gesture ? { ...v, gesture: true } : { ...v });
  }
  function settle() {
    document.body.classList.remove('moving');
    stageEl.style.backgroundPosition = `${v.x}px ${v.y}px`;
    if (labelsStale) labels();
    placeGrid();
    if (zoomedSinceRaster) { zoomedSinceRaster = false; worldEl.style.willChange = 'auto'; requestAnimationFrame(() => requestAnimationFrame(() => { worldEl.style.willChange = ''; })); }
    ctx.emit('viewsettle', { ...v });
  }
  view.labelScale = labelScale; // the title scale for a zoom, as labels() quantises it
  view.settledLabelScale = () => Number(worldEl.dataset.lf || 1);
  view.labelScaleLs = (z) => Math.round(clamp(1 / z, 1, 3.2) * 20) / 20;
  view.settledLabelScaleLs = () => Number(worldEl.dataset.ls || 1);
  view.get = () => ({ ...v });
  view.target = () => ({ ...(target ?? v) }); // where the view is going (or is)
  function set(next, { animate = false, duration = 220, anchor = null, gesture = false } = {}) {
    next = { x: next.x, y: next.y, z: clamp(next.z, MIN_Z, MAX_Z) };
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
    target = null;
    if (!animate || reducedMotion()) { v = next; apply(gesture); return Promise.resolve(); }
    const from = { ...v }, t0 = performance.now();
    target = next;
    return new Promise((done) => {
      const step = (now) => {
        const t = clamp((now - t0) / duration, 0, 1), e = 1 - Math.pow(1 - t, 3);
        // zoom in log space so the motion feels even; the point at the centre of the screen follows a straight line
        const z = Math.exp(Math.log(from.z) + (Math.log(next.z) - Math.log(from.z)) * e);
        v = anchor ? { x: anchor.cx - anchor.wx * z, y: anchor.cy - anchor.wy * z, z } : { x: from.x + (next.x - from.x) * e, y: from.y + (next.y - from.y) * e, z };
        if (t >= 1) v = next;
        apply();
        if (t < 1) anim.raf = requestAnimationFrame(step); else { anim = null; target = null; done(); }
      };
      anim = { raf: requestAnimationFrame(step) };
    });
  }
  view.set = set;
  view.stageBox = stageBox;
  view.toWorld = (sx, sy) => ({ x: (sx - box.left - v.x) / v.z, y: (sy - box.top - v.y) / v.z });
  view.rectToWorld = (r) => ({ x: (r.left - box.left - v.x) / v.z, y: (r.top - box.top - v.y) / v.z, w: r.width / v.z, h: r.height / v.z });

  // Zoom to `z`, keeping the world point under screen point (sx, sy) where it is.
  view.zoomAt = (sx, sy, z, opts) => {
    z = clamp(z, MIN_Z, MAX_Z);
    const cx = sx - box.left, cy = sy - box.top;
    const wx = (cx - v.x) / v.z, wy = (cy - v.y) / v.z;
    return set({ x: cx - wx * z, y: cy - wy * z, z }, { ...opts, anchor: { cx, cy, wx, wy } }); // the point under the cursor stays put on every frame
  };
  view.zoomBy = (factor, sx, sy, opts) => {
    if (sx === undefined) { const p = lastPointer && inside(lastPointer) ? lastPointer : { x: box.left + box.width / 2, y: box.top + box.height / 2 }; sx = p.x; sy = p.y; }
    return view.zoomAt(sx, sy, v.z * factor, opts);
  };
  view.panBy = (dx, dy, opts) => set({ x: v.x + dx, y: v.y + dy, z: v.z }, opts);

  // The view that shows a world rect { x, y, w, h } with `pad` screen pixels around it.
  view.fitView = (r, { pad = 64, max = 1 } = {}) => {
    const z = clamp(Math.min((box.width - pad * 2) / Math.max(r.w, 1), (box.height - pad * 2) / Math.max(r.h, 1)), MIN_Z, Math.min(max, MAX_Z));
    return { z, x: box.width / 2 - (r.x + r.w / 2) * z, y: box.height / 2 - (r.y + r.h / 2) * z };
  };
  view.fitRect = (r, opts = {}) => set(view.fitView(r, opts), { animate: opts.animate });
  view.flyTo = (r, opts = {}) => set(view.fitView(r, opts), { animate: true });
  view.stop = () => { if (anim) { cancelAnimationFrame(anim.raf); anim = null; } target = null; };
  view.setFitters = (f) => { fitters = f; };
  // Shift+1 must show every frame. Frames far off screen draw late and then grow, and a frame may be moved aside when it does: while the
  // view is still exactly the fit the stage keeps it a fit (WPC-23). Any pan or zoom of the person's own ends this.
  let lastFit = null, refitTimer = 0;
  const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.z - b.z) < 1e-6;
  const refit = () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      if (!lastFit || anim || !near(v, lastFit)) return;
      const t = fitAllView(lastWork); if (!t) return;
      if (!near(t, lastFit)) { lastFit = t; set(t); }
    }, 120);
  };
  ctx.on('render', refit); ctx.on('layout', refit);
  view.hold = () => { lastFit = null; }; // something placed by hand (a frame drawn on the canvas) ends the fit too: it must stay where it was drawn
  let lastWork = false;
  // Everything with its labels: a label is a fixed size on screen, so the room it takes in canvas units depends on the zoom of the fit.
  // fitters.all(z) is the rectangle at zoom z; a few steps settle it. Centred, so the margins are even on both sides.
  const fitAllView = (work) => {
    let r = (work && fitters.work?.()) || fitters.all();
    if (!r) return null;
    let t = view.fitView(r, { pad: 72, max: 1 });
    for (let i = 0; i < 4 && !work; i++) {
      r = fitters.all(t.z) || r;
      const n = view.fitView(r, { pad: 72, max: 1 });
      if (near(n, t)) break;
      t = n;
    }
    return t;
  };
  view.fitAll = (opts = {}) => {
    lastWork = !!opts.work;
    const t = fitAllView(lastWork);
    if (!t) { lastFit = null; return set({ x: 80, y: 120, z: 1 }, opts); }
    lastFit = t;
    return set(t, { animate: opts.animate });
  };
  view.fitSelection = (opts = {}) => { const r = fitters.selection(); return r ? view.fitRect(r, { pad: 96, max: 4, ...opts }) : undefined; };

  const inside = (p) => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;

  // --- wheel: pan, or zoom with Ctrl/Cmd (a trackpad pinch arrives as Ctrl+wheel) ---
  stageEl.addEventListener('wheel', (ev) => {
    if (ev.target.closest?.('#error')) return;
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? box.height : 1;
    const dx = ev.deltaX * unit, dy = ev.deltaY * unit;
    if (ev.ctrlKey || ev.metaKey) {
      view.zoomAt(ev.clientX, ev.clientY, v.z * Math.exp(-clamp(dy, -48, 48) * 0.005), { gesture: true });
    } else if (ev.shiftKey && !dx) {
      view.panBy(-dy, 0, { gesture: true });
    } else view.panBy(-dx, -dy, { gesture: true });
  }, { passive: false });
  addEventListener('pointermove', (ev) => { lastPointer = { x: ev.clientX, y: ev.clientY }; }, true);

  // --- drag to pan: Space + drag, middle button, or a finger on empty canvas; two fingers pinch ---
  let space = false, pan = null;
  const touches = new Map();
  const grabbing = (on) => { document.body.dataset.pan = on ? 'drag' : space ? 'ready' : ''; };
  view.isPanning = () => !!pan || space;
  stageEl.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch') {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) { const [a, b] = [...touches.values()]; pan = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; ev.preventDefault(); }
      else if (!ev.target.closest('.mount [data-n], .cmp-head') && !pan) pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      return;
    }
    if (!(ev.button === 1 || (ev.button === 0 && space))) return;
    ev.preventDefault(); ev.stopPropagation();
    pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    try { stageEl.setPointerCapture(ev.pointerId); } catch {}
    grabbing(true);
  }, true);
  addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch' && touches.has(ev.pointerId)) {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pan?.pinch && touches.size === 2) {
        const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        view.panBy(cx - pan.cx, cy - pan.cy, { gesture: true });
        view.zoomAt(cx, cy, v.z * (d / pan.d), { gesture: true });
        pan.d = d; pan.cx = cx; pan.cy = cy;
        return;
      }
    }
    if (!pan || pan.pinch || ev.pointerId !== pan.id) return;
    view.panBy(ev.clientX - pan.x, ev.clientY - pan.y, { gesture: true });
    pan.x = ev.clientX; pan.y = ev.clientY;
  }, true);
  const end = (ev) => {
    touches.delete(ev.pointerId);
    if (pan && (pan.pinch ? touches.size < 2 : ev.pointerId === pan.id)) { pan = null; grabbing(false); }
  };
  addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);
  // the click that ends a pan must not select
  stageEl.addEventListener('click', (ev) => { if (space || pan) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);

  // --- keys ---
  addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    const ctl = ev.ctrlKey || ev.metaKey;
    if (ev.code === 'Space' && !ctl && !ev.altKey && !typing(ev.target) && ((ev.target.closest?.('#stage') && !ev.target.closest?.('[data-nodrag]')) || !ev.target.closest?.('button, a, [role=option], summary'))) {
      ev.preventDefault();
      if (!space) { space = true; grabbing(!!pan); }
      return;
    }
    if (typing(ev.target) || ev.altKey) return;
    const key = ev.key;
    if (ev.shiftKey && !ctl && (ev.code === 'Digit1' || key === '!' || key === '1')) { ev.preventDefault(); view.fitAll({ animate: true }); return; }
    if (ev.shiftKey && !ctl && (ev.code === 'Digit2' || key === '@' || key === '2')) { ev.preventDefault(); view.fitSelection({ animate: true }); return; }
    if (ev.shiftKey && !ctl && (ev.code === 'Digit0' || key === ')' || key === '0')) { ev.preventDefault(); view.zoomBy(1 / v.z, undefined, undefined, { animate: true }); return; }
    if (key === '+' || key === '=' || ev.code === 'NumpadAdd') { ev.preventDefault(); view.zoomBy(1.25); return; }
    if (key === '-' || key === '_' || ev.code === 'NumpadSubtract') { ev.preventDefault(); view.zoomBy(0.8); return; }
  });
  addEventListener('keyup', (ev) => { if (ev.code === 'Space') { space = false; grabbing(!!pan); } });
  addEventListener('blur', () => { space = false; pan = null; grabbing(false); });

  // (the status bar's zoom control is statusbar.js: it runs the zoom actions and follows the view)

  apply();
  return view;
}
