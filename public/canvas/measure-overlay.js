// Honest measurement (dream moment 8), drawn over the canvas from the frames' own computed styles:
//   Hold Alt over an element: its box model (margin, border, padding, content) and the gaps between its children, in
//     the component's own pixels. The distance lines between the selection and the hovered element are the stage's.
//   Contrast: the WCAG ratio of every text element of the frames in view (below AA is marked).
//   Focus order: the tab order of every frame in view, numbered and joined.
// Nothing here runs unless Alt is down or an overlay is switched on; the frames are read, never changed.
import { parseColor, contrast, hex } from './inspector-model.js';

const NS = 'http://www.w3.org/2000/svg';
const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';
const px = (v) => parseFloat(v) || 0;
const r1 = (n) => Math.round(n * 10) / 10;

export function initMeasure(ctx) {
  const stage = document.querySelector('#stage');
  const layer = document.createElement('div');
  layer.id = 'inspect-overlay'; layer.setAttribute('aria-hidden', 'true');
  stage.append(layer);
  const state = { alt: false, contrast: false, order: false, hover: null, summary: { contrast: null, order: null } };
  let queued = false;

  const frames = () => [...(ctx.stage?.sections?.values?.() ?? [])].filter((s) => s.docFrame?.iframe()?.isConnected && !s.el?.dataset.cull).map((s) => ({ id: s.id ?? s.el?.dataset.id, name: s.el?.dataset.name, f: s.docFrame }));
  const sectionsById = () => ctx.stage?.sections;
  const scaleOf = (iframe) => (iframe.offsetWidth ? iframe.getBoundingClientRect().width / iframe.offsetWidth : 1);
  // A rect inside a frame, in stage pixels.
  const rectIn = (iframe, el, base) => {
    const fr = iframe.getBoundingClientRect(), z = scaleOf(iframe), r = el.getBoundingClientRect();
    return { x: fr.left + (iframe.clientLeft + r.left) * z - base.left, y: fr.top + (iframe.clientTop + r.top) * z - base.top, w: r.width * z, h: r.height * z, z };
  };
  const inView = (iframe, base) => { const r = iframe.getBoundingClientRect(); return r.right > base.left && r.left < base.right && r.bottom > base.top && r.top < base.bottom; };
  const div = (cls, style, text) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, style); if (text !== undefined) d.textContent = text; return d; };
  const box = (x, y, w, h) => ({ left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });

  // ---------- the box model of one element ----------
  function boxModel(iframe, el, base) {
    const win = iframe.contentWindow, cs = win.getComputedStyle(el), R = rectIn(iframe, el, base), z = R.z;
    const m = ['top', 'right', 'bottom', 'left'].map((s) => px(cs[`margin-${s}`]));
    const b = ['top', 'right', 'bottom', 'left'].map((s) => px(cs[`border-${s}-width`]));
    const p = ['top', 'right', 'bottom', 'left'].map((s) => px(cs[`padding-${s}`]));
    const g = document.createDocumentFragment();
    const ring = (outer, widths, cls) => { // a band of `widths` (top,right,bottom,left; component px) inside the outer rect
      const d = div(`im-ring ${cls}`, { ...box(outer.x, outer.y, outer.w, outer.h), borderWidth: widths.map((v) => `${v * z}px`).join(' ') }); g.append(d); return d;
    };
    const mo = { x: R.x - m[3] * z, y: R.y - m[0] * z, w: R.w + (m[1] + m[3]) * z, h: R.h + (m[0] + m[2]) * z };
    ring(mo, m, 'im-margin');
    ring(R, b, 'im-border');
    const pb = { x: R.x + b[3] * z, y: R.y + b[0] * z, w: R.w - (b[1] + b[3]) * z, h: R.h - (b[0] + b[2]) * z };
    ring(pb, p, 'im-padding');
    const ct = { x: pb.x + p[3] * z, y: pb.y + p[0] * z, w: pb.w - (p[1] + p[3]) * z, h: pb.h - (p[0] + p[2]) * z };
    g.append(div('im-content', box(ct.x, ct.y, ct.w, ct.h)));
    const label = (x, y, v, cls) => { if (v > 0) g.append(div(`im-num ${cls}`, { left: `${x}px`, top: `${y}px` }, String(r1(v)))); };
    label(mo.x + mo.w / 2, mo.y + (m[0] * z) / 2, m[0], 'im-m'); label(mo.x + mo.w - (m[1] * z) / 2, mo.y + mo.h / 2, m[1], 'im-m');
    label(mo.x + mo.w / 2, mo.y + mo.h - (m[2] * z) / 2, m[2], 'im-m'); label(mo.x + (m[3] * z) / 2, mo.y + mo.h / 2, m[3], 'im-m');
    label(pb.x + pb.w / 2, pb.y + (p[0] * z) / 2, p[0], 'im-p'); label(pb.x + pb.w - (p[1] * z) / 2, pb.y + pb.h / 2, p[1], 'im-p');
    label(pb.x + pb.w / 2, pb.y + pb.h - (p[2] * z) / 2, p[2], 'im-p'); label(pb.x + (p[3] * z) / 2, pb.y + pb.h / 2, p[3], 'im-p');
    // gaps: the real space between consecutive children of a flex or grid container
    const gaps = [];
    if (/flex|grid/.test(cs.display)) {
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
    const seen = new Set();
    for (const gp of gaps) { const k = `${Math.round(gp.x)}|${Math.round(gp.y)}|${Math.round(gp.w)}|${Math.round(gp.h)}`; if (seen.has(k)) continue; seen.add(k); g.append(div('im-gap', box(gp.x, gp.y, gp.w, gp.h))); g.append(div('im-num im-g', { left: `${gp.x + gp.w / 2}px`, top: `${gp.y + gp.h / 2}px` }, String(r1(gp.v)))); }
    const name = `${el.localName}${el.id ? '#' + el.id : ''}${[...el.classList].map((c) => '.' + c).join('')}`;
    const fmt = (a) => (a.every((v) => v === a[0]) ? String(r1(a[0])) : a[0] === a[2] && a[1] === a[3] ? `${r1(a[0])} ${r1(a[1])}` : a.map(r1).join(' ')); // as CSS shorthand
    const read = div('im-read', { left: `${R.x}px`, top: `${Math.max(2, R.y - 26)}px` });
    read.innerHTML = '';
    const nm = document.createElement('b'); nm.textContent = name; read.append(nm);
    read.append(document.createTextNode(` ${r1(R.w / z)} × ${r1(R.h / z)}  margin ${fmt(m)}  padding ${fmt(p)}${gaps.length ? `  gap ${r1(gaps[0].v)}` : ''}`));
    g.append(read);
    return { node: g, margin: m, padding: p, border: b, size: [R.w / z, R.h / z], gap: gaps[0]?.v ?? 0, name };
  }

  // ---------- contrast ----------
  function backdrop(win, el) { // the colour behind an element's text: composite background colours up the tree
    let layers = [], unknown = false;
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
  function drawContrast(into, base) {
    const out = []; let total = 0, fail = 0;
    for (const { f } of frames()) {
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
        const r = rectIn(iframe, el, base);
        if (r.w < 2 || r.h < 2) continue;
        const chip = div(`im-badge ${ok ? 'ok' : 'bad'}${unknown ? ' unsure' : ''}`, { left: `${r.x}px`, top: `${r.y}px` }, `${unknown ? '~' : ''}${ratio >= 21 ? '21' : r1(ratio)}`);
        chip.title = `${unknown ? 'a background image or gradient is behind it, so this is an estimate. ' : ''}${hex(fg)} on ${hex(bg)}: ${r1(ratio)}:1, needs ${need}:1${large ? ' (large text)' : ''}`;
        into.append(chip);
        out.push({ el: el.localName, ratio: r1(ratio), need, ok });
      }
    }
    return { total, fail, items: out };
  }

  // ---------- focus order ----------
  function drawOrder(into, base) {
    let total = 0;
    for (const { f } of frames()) {
      const iframe = f.iframe(), doc = f.doc(), win = iframe.contentWindow;
      if (!doc?.body || !inView(iframe, base)) continue;
      const els = [...doc.querySelectorAll(FOCUSABLE)].filter((e) => {
        if (e.disabled || e.closest('[inert]') || e.closest('[data-napkin]')) return false;
        const t = e.getAttribute('tabindex'); if (t !== null && Number(t) < 0) return false;
        const cs = win.getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      const tab = (e) => { const t = Number(e.getAttribute('tabindex')); return Number.isInteger(t) && t > 0 ? t : Infinity; };
      const order = els.map((e, i) => [e, i]).sort((a, b) => tab(a[0]) - tab(b[0]) || a[1] - b[1]).map((x) => x[0]);
      const pts = order.map((e) => { const r = rectIn(iframe, e, base); return { x: r.x + Math.min(10, r.w / 2), y: r.y + Math.min(10, r.h / 2), r }; });
      if (pts.length > 1) {
        const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'im-orderline');
        const path = document.createElementNS(NS, 'polyline'); path.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' ')); svg.append(path); into.append(svg);
      }
      pts.forEach((p, i) => { into.append(div('im-order', { left: `${p.x}px`, top: `${p.y}px` }, String(i + 1))); total++; });
    }
    return { total };
  }

  // ---------- drawing ----------
  function draw() {
    queued = false;
    layer.replaceChildren();
    const active = state.alt || state.contrast || state.order;
    layer.dataset.active = active ? '1' : '';
    state.summary = { contrast: null, order: null };
    if (!active) return;
    const base = stage.getBoundingClientRect();
    if (state.contrast) state.summary.contrast = drawContrast(layer, base);
    if (state.order) state.summary.order = drawOrder(layer, base);
    if (state.alt) {
      const targets = [state.hover, ...(ctx.state.selection ? [ctx.state.selection] : [])].filter(Boolean);
      const seen = new Set();
      for (const t of targets) {
        const key = `${t.component}|${t.node}`; if (seen.has(key)) continue; seen.add(key);
        const f = sectionsById()?.get(t.component)?.docFrame, el = f?.element(t.node)?.el, iframe = f?.iframe();
        if (!el?.isConnected || !iframe || !inView(iframe, base)) continue;
        const m = boxModel(iframe, el, base);
        if (t === state.hover) { layer.append(m.node); state.summary.box = { name: m.name, margin: m.margin, padding: m.padding, border: m.border, size: m.size, gap: m.gap }; }
        else { const wrap = div('im-sel'); wrap.append(m.node); layer.append(wrap); }
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

  const api = {
    state,
    toggle(name, on) {
      if (!['contrast', 'order'].includes(name)) return state[name];
      state[name] = on === undefined ? !state[name] : !!on;
      redraw(); draw(); // draw now, so the caller can read the summary
      return state[name];
    },
    // the numbers behind what is drawn (also what a test reads)
    read: () => state.summary,
    draw,
  };
  return api;
}
