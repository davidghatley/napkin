// Honest measurement (dream moment 8), drawn over the canvas from the frames' own computed styles:
//   Hold Alt over an element: its box model (margin, border, padding, content) and the gaps between its children, in
//     the component's own pixels. The distance lines between the selection and the hovered element are the stage's.
//   Contrast: the WCAG ratio of every text element of the frames in view (below AA is marked).
//   Focus order: the tab order of every frame in view, numbered.
// Labels never sit on what they measure. Every label (a ratio, a number, a readout) is a box in a label layer: it is
// placed in free space, away from every line of text in the frames, from the stage's own selection labels and from
// the labels already placed, and a thin leader line joins it to its element when it had to move away. The outlines and
// bands are drawn on the elements; they carry no text.
// Nothing here runs unless Alt is down or an overlay is switched on; the frames are read, never changed.
import { parseColor, contrast, hex } from './inspector-model.js';

const NS = 'http://www.w3.org/2000/svg';
const LABEL_ZOOM = 0.45; // below this the canvas is an overview: contrast and order labels are kept to what fails and the selected frame
const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';
const px = (v) => parseFloat(v) || 0;
const r1 = (n) => Math.round(n * 10) / 10;
const hit = (a, b, pad = 1) => a.x < b.x + b.w + pad && a.x + a.w > b.x - pad && a.y < b.y + b.h + pad && a.y + a.h > b.y - pad;

export function initMeasure(ctx) {
  const stage = document.querySelector('#stage');
  const layer = document.createElement('div');
  layer.id = 'inspect-overlay'; layer.setAttribute('aria-hidden', 'true');
  stage.append(layer);
  const state = { alt: false, contrast: false, order: false, hover: null, summary: { contrast: null, order: null } };
  let queued = false;

  const frames = () => [...(ctx.stage?.sections?.values?.() ?? [])].filter((s) => s.docFrame?.iframe()?.isConnected && !s.el?.dataset.cull).map((s) => ({ f: s.docFrame }));
  const scaleOf = (iframe) => (iframe.offsetWidth ? iframe.getBoundingClientRect().width / iframe.offsetWidth : 1);
  // A rect inside a frame, in stage pixels.
  const rectIn = (iframe, el, base) => {
    const fr = iframe.getBoundingClientRect(), z = scaleOf(iframe), r = el.getBoundingClientRect();
    return { x: fr.left + (iframe.clientLeft + r.left) * z - base.left, y: fr.top + (iframe.clientTop + r.top) * z - base.top, w: r.width * z, h: r.height * z, z };
  };
  const inView = (iframe, base) => { const r = iframe.getBoundingClientRect(); return r.right > base.left && r.left < base.right && r.bottom > base.top && r.top < base.bottom; };
  const div = (cls, style, text) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, style); if (text !== undefined) d.textContent = text; return d; };
  const box = (x, y, w, h) => ({ left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });

  // Everything a label must stay off: every line of text in the frames in view, and the stage's own selection labels.
  function avoidList(base, list) {
    const out = [];
    for (const { f } of list) {
      const iframe = f.iframe(), doc = f.doc();
      if (!doc?.body || !inView(iframe, base)) continue;
      const fr = iframe.getBoundingClientRect(), z = scaleOf(iframe), range = doc.createRange();
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(), i = 0; n && i < 4000; n = walker.nextNode(), i++) {
        if (!/\S/.test(n.nodeValue) || /^(script|style|noscript)$/i.test(n.parentElement?.localName || '')) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) out.push({ x: fr.left + (iframe.clientLeft + r.left) * z - base.left, y: fr.top + (iframe.clientTop + r.top) * z - base.top, w: r.width * z, h: r.height * z });
      }
    }
    for (const e of document.querySelectorAll('#overlay-select *, #overlay-hover *, #overlay-measure .m-label, .overlay-extra *')) {
      if (!e.textContent.trim() || e.children.length > 1) continue;
      const r = e.getBoundingClientRect(); if (r.width > 1 && r.height > 1) out.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    }
    return out;
  }

  // ---------- label placement ----------
  function placer(base, avoid, frameRects) {
    const placed = []; const bounds = { x: 0, y: 0, w: base.width, h: base.height };
    const inside = (r) => r.x >= bounds.x && r.y >= bounds.y && r.x + r.w <= bounds.x + bounds.w && r.y + r.h <= bounds.y + bounds.h;
    const free = (r) => inside(r) && !avoid.some((a) => hit(r, a, 1.5)) && !placed.some((a) => hit(r, a, 2));
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'im-leaders'); layer.append(svg);
    const leader = (r, a) => {
      const cx = Math.min(Math.max(r.x + r.w / 2, a.x), a.x + a.w), cy = Math.min(Math.max(r.y + r.h / 2, a.y), a.y + a.h);
      const sx = Math.min(Math.max(cx, r.x), r.x + r.w), sy = Math.min(Math.max(cy, r.y), r.y + r.h);
      if (Math.hypot(sx - cx, sy - cy) < 3) return;
      const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', sx); l.setAttribute('y1', sy); l.setAttribute('x2', cx); l.setAttribute('y2', cy); svg.append(l);
    };
    // label: an element already in the layer; anchor: what it is about (stage rect); prefer: spots to try first
    return (el, anchor, prefer = []) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const tries = prefer.map(([x, y]) => ({ x, y, w, h }));
      const ax = anchor.x, ay = anchor.y, aw = anchor.w, ah = anchor.h, g = 3;
      tries.push({ x: ax, y: ay - h - g, w, h }, { x: ax + aw - w, y: ay - h - g, w, h }, { x: ax - w - g, y: ay, w, h }, { x: ax + aw + g, y: ay, w, h }, { x: ax, y: ay + ah + g, w, h }, { x: ax + aw - w, y: ay + ah + g, w, h });
      for (let rad = 14; rad <= 260; rad += 14) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; tries.push({ x: ax + aw / 2 + Math.cos(a) * (rad + aw / 2) - w / 2, y: ay + ah / 2 + Math.sin(a) * (rad + ah / 2) - h / 2, w, h }); }
      // last resort: the gutter beside the frame the element is in, as far down as it takes
      const fr = frameRects.find((f) => ax >= f.x - 1 && ax <= f.x + f.w + 1 && ay >= f.y - 1 && ay <= f.y + f.h + 1);
      if (fr) for (let y = ay - 40; y < ay + 400; y += h + 2) tries.push({ x: fr.x - w - 8, y, w, h }, { x: fr.x + fr.w + 8, y, w, h });
      const spot = tries.find(free);
      if (!spot) { el.remove(); return null; }
      el.style.left = `${spot.x}px`; el.style.top = `${spot.y}px`; el.style.visibility = '';
      placed.push(spot); leader(spot, anchor);
      return spot;
    };
  }
  const label = (cls, text, title) => { const d = div(`im-label ${cls}`, { left: '0px', top: '0px', visibility: 'hidden' }, text); if (title) d.title = title; layer.append(d); return d; };

  // ---------- the box model of one element ----------
  // Rings and bands are drawn at once; the numbers are returned to be placed as labels (none for a dimmed one).
  function boxModel(iframe, el, base, { dim = false } = {}) {
    const win = iframe.contentWindow, cs = win.getComputedStyle(el), R = rectIn(iframe, el, base), z = R.z;
    const m = ['top', 'right', 'bottom', 'left'].map((s) => px(cs[`margin-${s}`]));
    const b = ['top', 'right', 'bottom', 'left'].map((s) => px(cs[`border-${s}-width`]));
    const p = ['top', 'right', 'bottom', 'left'].map((s) => px(cs[`padding-${s}`]));
    const ring = (outer, widths, cls) => layer.append(div(`im-ring ${cls}${dim ? ' im-dim' : ''}`, { ...box(outer.x, outer.y, outer.w, outer.h), borderWidth: widths.map((v) => `${v * z}px`).join(' ') }));
    const mo = { x: R.x - m[3] * z, y: R.y - m[0] * z, w: R.w + (m[1] + m[3]) * z, h: R.h + (m[0] + m[2]) * z };
    ring(mo, m, 'im-margin'); ring(R, b, 'im-border');
    const pb = { x: R.x + b[3] * z, y: R.y + b[0] * z, w: R.w - (b[1] + b[3]) * z, h: R.h - (b[0] + b[2]) * z };
    ring(pb, p, 'im-padding');
    const ct = { x: pb.x + p[3] * z, y: pb.y + p[0] * z, w: pb.w - (p[1] + p[3]) * z, h: pb.h - (p[0] + p[2]) * z };
    if (!dim) layer.append(div('im-content', box(ct.x, ct.y, ct.w, ct.h)));
    const gaps = []; // the real space between consecutive children of a flex or grid container
    if (!dim && /flex|grid/.test(cs.display)) {
      const kids = [...el.children].filter((c) => { const s = win.getComputedStyle(c); return s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed'; }).map((c) => rectIn(iframe, c, base));
      const between = (band) => kids.some((k) => k.x < band.x + band.w - 0.5 && k.x + k.w > band.x + 0.5 && k.y < band.y + band.h - 0.5 && k.y + k.h > band.y + 0.5);
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i], c = kids[j], ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
        let band = null;
        if (oy > 1 && c.x - (a.x + a.w) > 0.5) band = { x: a.x + a.w, y: Math.max(a.y, c.y), w: c.x - (a.x + a.w), h: oy, v: (c.x - (a.x + a.w)) / z };
        else if (ox > 1 && c.y - (a.y + a.h) > 0.5) band = { x: Math.max(a.x, c.x), y: a.y + a.h, w: ox, h: c.y - (a.y + a.h), v: (c.y - (a.y + a.h)) / z };
        if (band && !between(band)) gaps.push(band); // only the space between neighbours: nothing sits in it
      }
    }
    const seen = new Set(), gapBands = [];
    for (const gp of gaps) { const k = `${Math.round(gp.x)}|${Math.round(gp.y)}|${Math.round(gp.w)}|${Math.round(gp.h)}`; if (seen.has(k)) continue; seen.add(k); gapBands.push(gp); layer.append(div('im-gap', box(gp.x, gp.y, gp.w, gp.h))); }
    const nums = [];
    const add = (v, band, cls) => { if (v > 0 && !dim) nums.push({ band, cls, text: String(r1(v)) }); };
    add(m[0], { x: mo.x, y: mo.y, w: mo.w, h: m[0] * z }, 'im-m'); add(m[1], { x: mo.x + mo.w - m[1] * z, y: mo.y, w: m[1] * z, h: mo.h }, 'im-m');
    add(m[2], { x: mo.x, y: mo.y + mo.h - m[2] * z, w: mo.w, h: m[2] * z }, 'im-m'); add(m[3], { x: mo.x, y: mo.y, w: m[3] * z, h: mo.h }, 'im-m');
    add(p[0], { x: pb.x, y: pb.y, w: pb.w, h: p[0] * z }, 'im-p'); add(p[1], { x: pb.x + pb.w - p[1] * z, y: pb.y, w: p[1] * z, h: pb.h }, 'im-p');
    add(p[2], { x: pb.x, y: pb.y + pb.h - p[2] * z, w: pb.w, h: p[2] * z }, 'im-p'); add(p[3], { x: pb.x, y: pb.y, w: p[3] * z, h: pb.h }, 'im-p');
    for (const gp of gapBands) add(gp.v, gp, 'im-g');
    const fmt = (a) => (a.every((v) => v === a[0]) ? String(r1(a[0])) : a[0] === a[2] && a[1] === a[3] ? `${r1(a[0])} ${r1(a[1])}` : a.map(r1).join(' ')); // as CSS shorthand
    const name = `${el.localName}${el.id ? '#' + el.id : ''}${[...el.classList].map((c) => '.' + c).join('')}`;
    return { numbers: nums, summary: { name, margin: m, padding: p, border: b, size: [R.w / z, R.h / z], gap: gaps[0]?.v ?? 0 }, readout: `${name}  ${r1(R.w / z)} × ${r1(R.h / z)}  margin ${fmt(m)}  padding ${fmt(p)}${gaps.length ? `  gap ${r1(gaps[0].v)}` : ''}` };
  }

  // ---------- contrast ----------
  function backdrop(win, el) { // the colour behind an element's text: composite background colours up the tree
    const layers = []; let unknown = false;
    for (let e = el; e; e = e.parentElement) {
      const cs = win.getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') unknown = true;
      const c = parseColor(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let base = [255, 255, 255, 1];
    for (const c of layers.reverse()) { const a = c[3]; base = [c[0] * a + base[0] * (1 - a), c[1] * a + base[1] * (1 - a), c[2] * a + base[2] * (1 - a), 1]; }
    return { color: base, unknown };
  }
  function collectContrast(base, list) {
    const items = []; let total = 0, fail = 0;
    for (const { f } of list) {
      const iframe = f.iframe(), doc = f.doc(), win = iframe.contentWindow;
      if (!doc?.body || !inView(iframe, base)) continue;
      const seen = new Set();
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n && total < 600; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || seen.has(el) || !/\S/.test(n.nodeValue) || /^(script|style|noscript)$/i.test(el.localName)) continue;
        const cs = win.getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || px(cs.opacity) === 0) continue;
        seen.add(el);
        const fg = parseColor(cs.color); if (!fg) continue;
        const { color: bg, unknown } = backdrop(win, el);
        const ratio = contrast(fg, bg, bg), size = px(cs.fontSize), large = size >= 24 || (size >= 18.66 && px(cs.fontWeight) >= 700);
        const need = large ? 3 : 4.5, ok = ratio >= need;
        total++; if (!ok) fail++;
        items.push({ frame: iframe, el: el.localName, ratio: r1(ratio), need, ok, unknown, fg: hex(fg), bg: hex(bg), large, r: rectIn(iframe, el, base) });
      }
    }
    return { total, fail, items };
  }

  // ---------- focus order ----------
  function collectOrder(base, list) {
    const groups = [];
    for (const { f } of list) {
      const iframe = f.iframe(), doc = f.doc(), win = iframe.contentWindow;
      if (!doc?.body || !inView(iframe, base)) continue;
      const els = [...doc.querySelectorAll(FOCUSABLE)].filter((e) => {
        if (e.disabled || e.closest('[inert]') || e.closest('[data-napkin]')) return false;
        const t = e.getAttribute('tabindex'); if (t !== null && Number(t) < 0) return false;
        const cs = win.getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      const tab = (e) => { const t = Number(e.getAttribute('tabindex')); return Number.isInteger(t) && t > 0 ? t : Infinity; };
      groups.push({ frame: iframe, list: els.map((e, i) => [e, i]).sort((a, b) => tab(a[0]) - tab(b[0]) || a[1] - b[1]).map((x) => rectIn(iframe, x[0], base)) });
    }
    return groups;
  }

  // ---------- drawing ----------
  function draw() {
    queued = false;
    layer.replaceChildren();
    const active = state.alt || state.contrast || state.order;
    layer.dataset.active = active ? '1' : '';
    state.summary = { contrast: null, order: null };
    if (!active) return;
    const base = stage.getBoundingClientRect(), list = frames();
    const avoid = avoidList(base, list);
    const frameRects = list.filter(({ f }) => inView(f.iframe(), base)).map(({ f }) => { const r = f.iframe().getBoundingClientRect(); return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }; });
    const place = placer(base, avoid, frameRects);
    const labels = [];
    if (state.contrast) {
      const c = collectContrast(base, list);
      state.summary.contrast = { total: c.total, fail: c.fail, items: c.items.map(({ r, frame, ...i }) => i) };
      // far out a label per line of text is noise: only what fails, and the selected frame, are marked. The count stays in the panel.
      const selFrame = ctx.state.selection && ctx.stage?.sections?.get(ctx.state.selection.component)?.docFrame?.iframe();
      const near = (ctx.view?.get().z ?? 1) >= LABEL_ZOOM;
      for (const i of c.items) {
        if (i.r.w < 2 || i.r.h < 2 || (!near && i.ok && i.frame !== selFrame)) continue;
        layer.append(div(`im-box ${i.ok ? 'ok' : 'bad'}`, box(i.r.x - 1, i.r.y - 1, i.r.w + 2, i.r.h + 2)));
        labels.push({ cls: `im-badge ${i.ok ? 'ok' : 'bad'}${i.unknown ? ' unsure' : ''}`, text: `${i.unknown ? '~' : ''}${i.ratio >= 21 ? '21' : i.ratio}`, title: `${i.unknown ? 'a background image or gradient is behind it, so this is an estimate. ' : ''}${i.fg} on ${i.bg}: ${i.ratio}:1, needs ${i.need}:1${i.large ? ' (large text)' : ''}`, anchor: i.r, bad: !i.ok });
      }
    }
    if (state.order) {
      let total = 0;
      const selFrame = ctx.state.selection && ctx.stage?.sections?.get(ctx.state.selection.component)?.docFrame?.iframe();
      const near = (ctx.view?.get().z ?? 1) >= LABEL_ZOOM;
      for (const g of collectOrder(base, list)) g.list.forEach((r, k) => { total++; if (near || g.frame === selFrame) labels.push({ cls: 'im-order', text: String(k + 1), anchor: r }); });
      state.summary.order = { total };
    }
    // the ones that must be seen (below AA) first, then top to bottom
    labels.sort((a, b) => (b.bad ? 1 : 0) - (a.bad ? 1 : 0) || a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
    for (const l of labels) place(label(l.cls, l.text, l.title), l.anchor);
    if (state.alt) {
      const t = state.hover, sel = ctx.state.selection;
      const draw1 = (at, opts) => { const f = ctx.stage?.sections?.get(at.component)?.docFrame, el = f?.element(at.node)?.el, iframe = f?.iframe(); return el?.isConnected && iframe && inView(iframe, base) ? boxModel(iframe, el, base, opts) : null; };
      if (sel && !(t && sel.component === t.component && sel.node === t.node)) draw1(sel, { dim: true });
      const bm = t ? draw1(t, {}) : null;
      if (bm) {
        state.summary.box = bm.summary;
        const hud = label('im-read', bm.readout), hw = hud.offsetWidth, hh = hud.offsetHeight;
        place(hud, { x: base.width / 2 - 10, y: 6, w: 20, h: 4 }, [[Math.max(6, base.width / 2 - hw / 2), 8], [Math.max(6, base.width / 2 - hw / 2), base.height - hh - 8], [8, 8], [base.width - hw - 8, 8]]);
        for (const n of bm.numbers) {
          const l = label(`im-num ${n.cls}`, n.text), w = l.offsetWidth, h = l.offsetHeight;
          place(l, n.band, [[n.band.x + n.band.w / 2 - w / 2, n.band.y + n.band.h / 2 - h / 2]]);
        }
      }
    }
    ctx.emit('inspect-overlay', state.summary);
  }
  const redraw = () => { if (!queued && (state.alt || state.contrast || state.order)) { queued = true; requestAnimationFrame(draw); } };

  addEventListener('keydown', (ev) => { if (ev.key === 'Alt' && !state.alt) { state.alt = true; redraw(); } });
  addEventListener('keyup', (ev) => { if (ev.key === 'Alt' && state.alt) { state.alt = false; redraw(); } });
  addEventListener('blur', () => { if (state.alt) { state.alt = false; redraw(); } });
  ctx.on('hover', (h) => { state.hover = h || null; redraw(); });
  for (const e of ['view', 'viewsettle', 'layout', 'render', 'overlays', 'select', 'doc-change']) ctx.on(e, redraw);

  return {
    state,
    toggle(name, on) {
      if (!['contrast', 'order'].includes(name)) return state[name];
      state[name] = on === undefined ? !state[name] : !!on;
      redraw(); draw(); // draw now, so the caller can read the summary
      if (state[name] && name === 'contrast' && (ctx.view?.get().z ?? 1) < LABEL_ZOOM && state.summary.contrast) ctx.hint?.(`${state.summary.contrast.total} text elements, ${state.summary.contrast.fail} below AA. Zoom in to read each one`);
      return state[name];
    },
    read: () => state.summary, // the numbers behind what is drawn (also what a test reads)
    draw,
  };
}
