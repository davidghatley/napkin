// A component of the document engine (decision 0014) on the canvas: one same-origin iframe of /view/<id>, the file as
// the browser draws it, so @media answers to the frame's width. While editing, the iframe takes no pointer events: the
// stage hit-tests it from outside (pick), so wheel, drag and click keep working over it. In play mode it is live.
// Elements in the iframe are mapped to the file's nodes by walking the DOM and the source tree together
// (GET /api/component/<id>); an element the browser made up (an implied <tbody>) passes its children through.
//   createDocFrame(ctx, id, { onResize }) -> { cell, load(revision), pick(clientX, clientY), element(node), has(node),
//                                              iframe(), doc(), tree(), node(id), width, setWidth(w) }
const enc = encodeURIComponent;
export const DOC_WIDTH = 640;

// DOM elements <-> source nodes. Tags are compared case-insensitively; a DOM element with no source node (implied by
// the parser, or made by a script) is walked through with the same source list.
export function mapDom(document, roots) {
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
  walk([document.documentElement], roots, 0);
  return { byNode, byEl };
}

export function createDocFrame(ctx, id, { onResize = () => {} } = {}) {
  const cell = document.createElement('figure');
  cell.className = 'cell doc-cell'; cell.dataset.variant = '{}';
  const cap = document.createElement('figcaption');
  cell.append(cap);
  let iframe = null, map = { byNode: new Map(), byEl: new Map() }, tree = null, nodes = new Map(), width = DOC_WIDTH, ro = null, gen = 0;
  const proxies = new WeakMap();
  cap.textContent = `${width} px`;

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
    const h = Math.max(24, Math.min(4000, Math.ceil(d.documentElement.getBoundingClientRect().height)));
    if (iframe.style.height !== `${h}px`) { iframe.style.height = `${h}px`; onResize(); }
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
    if (iframe) { next.classList.add('doc-next'); cell.append(next); } else cell.prepend(next);
    await new Promise((res) => { next.addEventListener('load', res, { once: true }); next.src = `/view/${enc(id)}?width=${width}&rev=${enc(revision ?? t.revision ?? '')}`; });
    await settle(next);
    if (my !== gen || !next.isConnected) { next.remove(); return false; }
    const old = iframe;
    iframe = next; tree = t; nodes = flatten(t.tree || []);
    map = mapDom(next.contentDocument, t.tree || []);
    for (const [el, node] of map.byEl) { const p = proxies.get(el); if (p) p.dataset.n = node; }
    next.classList.remove('doc-next');
    if (old && old !== next) old.remove();
    ro?.disconnect();
    try { ro = new next.contentWindow.ResizeObserver(() => size()); ro.observe(next.contentDocument.documentElement); } catch { ro = null; }
    // keyboard focus never stays inside a frame while editing: the canvas's keys keep working
    next.contentWindow.addEventListener('focus', () => { if (!document.body.dataset.play) next.blur(); });
    size();
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
  return {
    cell, load, pick,
    element: (node) => proxy(map.byNode.get(node)),
    has: (node) => map.byNode.has(node) || nodes.has(node),
    node: (node) => nodes.get(node) || null,
    iframe: () => iframe, doc: () => iframe?.contentDocument || null, tree: () => tree,
    get width() { return width; },
    setWidth(w) { width = Math.max(120, Math.min(2400, Math.round(w))); cap.textContent = `${width} px`; if (iframe) { iframe.style.width = `${width}px`; size(); } onResize(); },
    destroy() { gen++; ro?.disconnect(); iframe?.remove(); },
  };
}
