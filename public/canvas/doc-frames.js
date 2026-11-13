// A component of the document engine (decision 0014) on the canvas: one same-origin iframe of /view/<id>, the file as
// the browser draws it, so @media answers to the frame's width. While editing, the iframe takes no pointer events: the
// stage hit-tests it from outside (pick), so wheel, drag and click keep working over it. In play mode it is live.
// Elements in the iframe are mapped to the file's nodes by walking the DOM and the source tree together
// (GET /api/component/<id>); an element the browser made up (an implied <tbody>) passes its children through.
//   createDocFrame(ctx, id, { onResize }) -> { cell, load(revision), pick(clientX, clientY), element(node), has(node),
//                                              iframe(), doc(), tree(), node(id), width, setWidth(w) }
import { createRuler } from './stage-ruler.js';
const enc = encodeURIComponent;
export const DOC_WIDTH = 640;

// DOM elements <-> source nodes. Tags are compared case-insensitively; a DOM element with no source node (implied by
// the parser, or made by a script) is walked through with the same source list.
export function mapDom(document, roots, host = null) {
  const byNode = new Map(), byEl = new Map();
  const same = (el, n) => el.localName.toLowerCase() === String(n.tag).toLowerCase();
  const walk = (domKids, srcKids, i) => {
    for (const el of domKids) {
      if (el.hasAttribute('data-napkin')) continue; // the applied stylesheets and <base> /view adds
      let j = i; while (j < srcKids.length && !same(el, srcKids[j])) j++;
      if (j < srcKids.length) { const n = srcKids[j]; byNode.set(n.node, el); byEl.set(el, n.node); walk([...el.children], n.children, 0); i = j + 1; }
      else i = walk([...el.children], srcKids, i);
    }
    return i;
  };
  if (host) walk([...host.children], roots, 0); // a JSX component: its elements are inside the page's #root, which is not one of them
  else walk([document.documentElement], roots, 0);
  return { byNode, byEl };
}

export function createDocFrame(ctx, id, { onResize = () => {} } = {}) {
  const cell = document.createElement('figure');
  cell.className = 'cell doc-cell'; cell.dataset.variant = '{}';
  const cap = document.createElement('figcaption');
  // The frame's width is the document's viewport: drag the grip and the component reflows for real (its own @media).
  const grip = document.createElement('div'); grip.className = 'cell-grip'; grip.dataset.nodrag = '1'; grip.title = 'Drag to change the frame width. Double-click for 640 px. With the keyboard: arrows 1 px, Shift 10 px, Page Up and Page Down the next breakpoint.';
  grip.tabIndex = -1; grip.setAttribute('role', 'slider'); grip.setAttribute('aria-label', 'Frame width'); grip.setAttribute('aria-valuemin', '120'); grip.setAttribute('aria-valuemax', '2400');
  const ruler = createRuler({ doc: () => iframe?.contentDocument || null, commitWidth: (w) => { api.setWidth(w); saveWidth(); }, get width() { return width; } });
  cell.append(cap, ruler.el, grip);
  // Until the live page is drawn the card shows the start of the file's own text, so it is never an empty box.
  const glance = document.createElement('pre'); glance.className = 'doc-glance';
  const fillGlance = () => { const c = ctx.state.components.get(id); glance.textContent = (ctx.glances?.get(c?.path)?.text || (c ? `${c.name}\n${c.path}` : id)).slice(0, 700); };
  if (ctx.state.components.total > 150) { fillGlance(); cell.prepend(glance); } // (a big folder only: smaller canvases draw their frames at once)
  const offGlance = ctx.on?.('glances', fillGlance);
  let widthAt = 0, iframe = null, map = { byNode: new Map(), byEl: new Map() }, tree = null, nodes = new Map(), width = DOC_WIDTH, ro = null, gen = 0;
  const proxies = new WeakMap();
  const say = (w, snapped) => { cap.textContent = ruler.say(w, snapped); grip.setAttribute('aria-valuenow', String(w)); grip.setAttribute('aria-valuetext', `${w} px`); };
  say(width);
  const saveWidth = () => ctx.fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: id, width }) }).catch(() => {});
  grip.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation(); grip.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX, w0 = width, z = ctx.view?.get().z || 1;
    // the file's own breakpoints pull the width in (within 8 screen pixels); Alt drags freely
    // detents: a breakpoint holds the width while the pointer is within 12 screen px of it, takes it from 8 px away, and takes it when one step carries the pointer across it
    let stuck = null, prev = w0;
    const move = (e) => {
      const raw = w0 + (e.clientX - x0) / z;
      let px = raw, snapped = false;
      if (!e.altKey) {
        const pts = ruler.points().map((b) => Math.round(b.px));
        if (stuck !== null && Math.abs(raw - stuck) <= 12 / z) { px = stuck; snapped = true; }
        else {
          stuck = null;
          const crossed = pts.find((p) => (prev < p && raw >= p) || (prev > p && raw <= p));
          const s = crossed !== undefined ? { px: crossed, snapped: true } : ruler.snap(raw, 8 / z);
          if (s.snapped) { stuck = s.px; px = s.px; snapped = true; }
        }
      }
      prev = raw;
      api.setWidth(px, snapped);
    };
    const up = () => { grip.removeEventListener('pointermove', move); delete cell.dataset.resizing; say(width); saveWidth(); };
    cell.dataset.resizing = '1';
    const before = document.createElement('div'); before.className = 'cell-was'; before.style.width = `${w0}px`; before.style.height = `${cell.offsetHeight}px`; before.innerHTML = `<span>${w0} before the drag</span>`; cell.append(before);
    // the inspector shows the width and what it crosses while the edge is held; it goes back on release unless it was open already
    const auto = !ctx.breakpoints?.active?.(); if (auto) ctx.breakpoints?.open?.();
    grip.addEventListener('pointerup', () => { before.remove(); if (auto) ctx.breakpoints?.close?.(); }, { once: true });
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
  });
  // the grip of the selected frame can be reached by keyboard: arrows move 1 px (Shift 10), Page Up and Page Down jump to the next breakpoint
  grip.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const step = ev.shiftKey ? 10 : 1;
    let to = null;
    if (ev.code === 'ArrowRight' || ev.code === 'ArrowUp') to = width + step;
    else if (ev.code === 'ArrowLeft' || ev.code === 'ArrowDown') to = width - step;
    else if (ev.code === 'PageUp' || ev.code === 'PageDown') { const pts = ruler.points().map((b) => Math.round(b.px)); to = ev.code === 'PageUp' ? pts.find((p) => p > width) : [...pts].reverse().find((p) => p < width); if (to === undefined) { ctx.hint(`No ${ev.code === 'PageUp' ? 'wider' : 'narrower'} breakpoint`); to = null; } }
    else if (ev.code === 'Home') to = DOC_WIDTH;
    if (to === null) { if (['PageUp', 'PageDown'].includes(ev.code)) { ev.preventDefault(); ev.stopPropagation(); } return; }
    ev.preventDefault(); ev.stopPropagation();
    const s = ruler.snap(to, 0.5);
    api.setWidth(s.px, s.snapped);
    clearTimeout(grip._save); grip._save = setTimeout(saveWidth, 250);
  });
  grip.addEventListener('dblclick', (ev) => { ev.stopPropagation(); api.setWidth(DOC_WIDTH); saveWidth(); });

  // An element inside the frame, seen from the canvas page: rects in page pixels, closest() answered by the frame.
  const proxy = (el) => {
    if (!el) return null;
    let p = proxies.get(el);
    if (p) return p;
    const host = () => iframe;
    p = {
      el, dataset: { n: map.byEl.get(el) }, docFrame: true,
      get isConnected() { const f = host(); return !!f?.isConnected && el.isConnected && el.ownerDocument === f.contentDocument; },
      closest: (sel) => host()?.closest(sel) ?? null,
      getBoundingClientRect() {
        const f = host(); const fr = f.getBoundingClientRect(); const z = f.offsetWidth ? fr.width / f.offsetWidth : 1;
        const r = el.getBoundingClientRect();
        return new DOMRect(fr.left + (f.clientLeft + r.left) * z, fr.top + (f.clientTop + r.top) * z, r.width * z, r.height * z);
      },
    };
    proxies.set(el, p);
    return p;
  };
  const flatten = (list, out = new Map()) => { for (const n of list) { out.set(n.node, n); flatten(n.children, out); } return out; };

  function size() {
    const d = iframe?.contentDocument;
    if (!d?.documentElement) return;
    // the frame hugs its content (a body with a fixed viewport height or overflow never gets an inner scrollbar on the canvas)
    const h = Math.max(24, Math.min(4000, Math.ceil(Math.max(d.documentElement.getBoundingClientRect().height, d.documentElement.scrollHeight > iframe.clientHeight + 1 ? d.documentElement.scrollHeight : 0))));
    if (iframe.style.height !== `${h}px`) { iframe.style.height = `${h}px`; onResize(Date.now() - widthAt < 2000); }
  }
  const settle = (f) => new Promise((res) => {
    const done = () => res(); const t = setTimeout(done, 4000);
    const d = f.contentDocument;
    Promise.race([d.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(() => { clearTimeout(t); done(); }));
  });
  // (Re)load: the new document loads beside the old one and replaces it when it is drawn, so an edit never flashes.
  async function load(revision) {
    const my = ++gen;
    const t = await (await fetch(`/api/component/${enc(id)}`)).json();
    if (my !== gen) return false;
    const next = document.createElement('iframe');
    next.className = 'doc-frame'; next.title = `${id} (live)`; next.tabIndex = -1;
    next.setAttribute('loading', 'eager');
    next.style.width = `${width}px`; next.style.height = iframe?.style.height || '120px';
    if (iframe || glance.isConnected) { next.classList.add('doc-next'); cell.append(next); } else cell.prepend(next);
    await new Promise((res) => { next.addEventListener('load', res, { once: true }); next.src = `/view/${enc(id)}?width=${width}&rev=${enc(revision ?? t.revision ?? '')}`; });
    await settle(next);
    if (my !== gen || !next.isConnected) { next.remove(); return false; }
    const old = iframe;
    iframe = next; tree = t; nodes = flatten(t.tree || []);
    const fk = ctx.state.components.get(id)?.fileKind;
    map = mapDom(next.contentDocument, t.tree || [], fk === 'tsx' || fk === 'jsx' ? next.contentDocument.getElementById('root') : null);
    for (const [el, node] of map.byEl) { const p = proxies.get(el); if (p) p.dataset.n = node; }
    next.classList.remove('doc-next');
    glance.remove(); offGlance?.();
    if (old && old !== next) old.remove();
    ro?.disconnect();
    try { ro = new next.contentWindow.ResizeObserver(() => size()); ro.observe(next.contentDocument.documentElement); } catch { ro = null; }
    // keyboard focus never stays inside a frame while editing: the canvas's keys keep working
    next.contentWindow.addEventListener('focus', () => { if (!document.body.dataset.play) next.blur(); });
    // in play the keyboard is inside the frame: Escape, and P outside a text field, still leave play
    next.contentWindow.addEventListener('keydown', (ev) => {
      if (!document.body.dataset.play || document.body.dataset.playHold) return;
      const field = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;
      if (ev.key === 'Escape' || (ev.code === 'KeyP' && !field && !ev.ctrlKey && !ev.metaKey && !ev.altKey)) { ev.preventDefault(); ev.stopPropagation(); ctx.play.set(false); next.blur(); document.querySelector('#stage').focus({ preventScroll: true }); }
    }, true);
    // while editing a frame has no scrollbars of its own: the canvas is what scrolls. Play gives them back (the file's own)
    const noBars = next.contentDocument.createElement('style'); noBars.setAttribute('data-napkin', ''); noBars.setAttribute('data-napkin-chrome', ''); noBars.textContent = 'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}';
    if (!document.body.dataset.play) (next.contentDocument.head || next.contentDocument.documentElement).append(noBars);
    size();
    ruler.update(); say(width);
    return true;
  }
  // The element under a page point (nearest one with a source node), or null.
  function pick(clientX, clientY) {
    if (!iframe?.contentDocument) return null;
    const fr = iframe.getBoundingClientRect(), z = iframe.offsetWidth ? fr.width / iframe.offsetWidth : 1;
    const x = (clientX - fr.left) / z - iframe.clientLeft, y = (clientY - fr.top) / z - iframe.clientTop;
    if (x < 0 || y < 0 || x > iframe.clientWidth || y > iframe.clientHeight) return null;
    let el = iframe.contentDocument.elementFromPoint(x, y);
    while (el && !map.byEl.has(el)) el = el.parentElement || el.getRootNode?.().host || null;
    return el ? proxy(el) : null;
  }
  const api = {
    cell, load, pick,
    element: (node) => proxy(map.byNode.get(node)),
    nodeOf: (el) => map.byEl.get(el) ?? null,
    has: (node) => map.byNode.has(node) || nodes.has(node),
    node: (node) => nodes.get(node) || null,
    iframe: () => iframe, doc: () => iframe?.contentDocument || null, tree: () => tree,
    get width() { return width; },
    grip, ruler, commitWidth: (w) => { api.setWidth(w); saveWidth(); },
    setWidth(w, snapped = false) { widthAt = Date.now(); width = Math.max(120, Math.min(2400, Math.round(w))); say(width, snapped); ruler.paint(); if (iframe) { iframe.style.width = `${width}px`; size(); } onResize(true); grip.setAttribute('aria-valuenow', String(width)); grip.setAttribute('aria-valuetext', `${width} px`); ctx.emit('framewidth', { component: id, width }); },
    destroy() { gen++; ro?.disconnect(); iframe?.remove(); },
  };
  const w = ctx.state.components.get(id)?.width;
  if (w) api.setWidth(w);
  return api;
}
