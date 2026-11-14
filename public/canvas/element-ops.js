// The elements inside an HTML frame (text, an image, a frame inside the frame) handled as objects on the canvas, the way Figma treats
// a layer inside a frame (standards 3.5, 3.6, 3.8, 3.9, 4.9). Each verb writes the element's inline style in the file, one /api/edit,
// so it is one step on the undo stack:
//   move(sel, dx, dy)      a drag of the element (grab), or the arrows (nudge): left and top. An element in the flow is moved with
//                          position: relative, so the elements around it keep their places.
//   resize(sel, box)       the eight handles (handles.js draws them): width and height, and left and top when the element is placed
// A press on an element of a frame that would be selected by a click (the selection itself, or what a click picks at its level) starts
// a drag of that element; a press on the frame itself (its card) drags the frame (stage.js).
//   initElementOps(ctx) -> ctx.elements = { selected(), grab(ev), nudge(dx, dy), move, resize, place(el) }
import { plain } from './words.js';

const CARD = new Set(['html', 'head', 'body']);
const THRESH = 4; // screen px before a press becomes a drag (standards 3.5)

export function initElementOps(ctx) {
  let chain = Promise.resolve();
  const queue = (fn) => (chain = chain.then(fn).catch((e) => { ctx.hint(plain(e?.message || String(e))); return null; }));

  // what the one selection is, when it is an element inside an editable HTML frame (not the frame's own card)
  function info(s) {
    if (!s || s.card) return null;
    const c = ctx.state.components.get(s.component);
    if (!c || c.readOnly || !ctx.create?.isFrameFile(c)) return null;
    const sec = ctx.stage.sections.get(s.component), f = sec?.docFrame, n = f?.node(s.node);
    if (!n || CARD.has(String(n.tag).toLowerCase())) return null;
    const el = f.element(s.node);
    if (!el?.isConnected) return null;
    return { s, c, id: s.component, sec, f, el, node: s.node };
  }
  function selected() {
    if (ctx.state.selections.length !== 1 || ctx.state.tool !== 'select' || document.body.dataset.textEdit || ctx.textEdit?.editing()) return null;
    return info(ctx.state.selection);
  }

  // where an element is placed, from its computed style: { mode: absolute | relative | static, left, top, w, h } in its page's px
  function place(el) {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    const mode = cs.position === 'absolute' || cs.position === 'fixed' ? 'absolute' : cs.position === 'relative' ? 'relative' : 'static';
    const n = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
    return { mode, left: n(cs.left), top: n(cs.top), w: n(cs.width), h: n(cs.height) };
  }
  // the inline style that puts an element dx, dy from where p (place) says it is
  const moved = (p, dx, dy) => ({ ...(p.mode === 'static' && { position: 'relative' }), left: `${Math.round(p.left + dx)}px`, top: `${Math.round(p.top + dy)}px` });
  const show = (el, style) => { for (const [k, v] of Object.entries(style)) el.style.setProperty(k, v); };
  function write(es, style, summary) {
    const c = es.c;
    const edits = Object.entries(style).map(([prop, value]) => ({ op: 'style', node: es.node, prop, value }));
    return queue(async () => {
      const res = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: es.id, baseRevision: c.revision, edits, summary }) });
      const j = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
      if (!j.ok) { ctx.hint(`Could not change ${es.el.el.localName}: ${plain(j.error)}`); ctx.stage.render(es.id).catch(() => {}); }
      return j;
    });
  }
  function move(es, dx, dy) {
    const p = place(es.el.el), style = moved(p, dx, dy);
    show(es.el.el, style); ctx.stage.refreshOverlays();
    return write(es, style, `Moved ${es.el.el.localName}`);
  }
  function resize(es, { w, h, dx = 0, dy = 0 }, p = place(es.el.el)) {
    const style = { width: `${Math.max(1, Math.round(w))}px`, height: `${Math.max(1, Math.round(h))}px`, ...((dx || dy) && moved(p, dx, dy)) };
    show(es.el.el, style); ctx.stage.refreshOverlays();
    return write(es, style, `Resized ${es.el.el.localName}`);
  }
  function nudge(dx, dy) {
    const es = selected();
    if (!es) return false;
    move(es, dx, dy);
    return true;
  }

  // ---- a drag of an element: it is selected as the drag starts, follows the pointer, and is written once on release
  let swallow = 0;
  document.addEventListener('click', (ev) => { if (swallow && Date.now() - swallow < 400) { swallow = 0; ev.stopPropagation(); ev.preventDefault(); } }, true);
  function grab(ev) {
    if (ev.button !== 0 || ev.shiftKey || ctx.state.tool !== 'select' || document.body.dataset.play || document.body.dataset.textEdit) return false;
    const id = ev.target.closest?.('.doc-cell')?.closest('section.cmp')?.dataset.component;
    const sec = id && ctx.stage.sections.get(id), f = sec?.docFrame, c = id && ctx.state.components.get(id);
    if (!f || !c || c.readOnly || !ctx.create?.isFrameFile(c)) return false;
    const p = f.pick(ev.clientX, ev.clientY);
    if (!p) return false;
    // the selection itself when the press is on it (or inside it), else what a click here would pick
    const cur = ctx.state.selections.length === 1 && ctx.state.selection?.component === id ? info(ctx.state.selection) : null;
    const node = cur && cur.el.el.contains(p.el) ? cur.node : ctx.stage.pickNode(id, p.dataset.n, { deep: ev.ctrlKey || ev.metaKey });
    const es = info({ component: id, node, variant: {} });
    if (!es) return false;
    ev.preventDefault();
    const el = es.el.el, z = () => { const fr = f.iframe().getBoundingClientRect(); return f.iframe().offsetWidth ? fr.width / f.iframe().offsetWidth : 1; };
    const p0 = place(el), was = { position: el.style.position, left: el.style.left, top: el.style.top };
    const x0 = ev.clientX, y0 = ev.clientY, k = z();
    let on = false, last = null;
    const mv = (e) => {
      if (!on && Math.hypot(e.clientX - x0, e.clientY - y0) < THRESH) return;
      if (!on) {
        on = true; document.body.dataset.gesture = 'move';
        const s = ctx.state.selection;
        if (!(ctx.state.selections.length === 1 && s?.component === id && s.node === node)) ctx.select({ component: id, node, variant: {} });
      }
      e.preventDefault();
      last = { dx: (e.clientX - x0) / k, dy: (e.clientY - y0) / k };
      show(el, moved(p0, last.dx, last.dy)); ctx.stage.refreshOverlays();
    };
    const end = (e, cancel) => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', cn, true); removeEventListener('keydown', key, true);
      delete document.body.dataset.gesture;
      if (!on) return;
      swallow = Date.now();
      const back = () => { el.style.position = was.position; el.style.left = was.left; el.style.top = was.top; ctx.stage.refreshOverlays(); };
      if (cancel || !last || (Math.round(last.dx) === 0 && Math.round(last.dy) === 0)) { back(); return; }
      const style = moved(p0, last.dx, last.dy);
      write(es, style, `Moved ${el.localName}`);
    };
    const up = (e) => { if (on) mv(e); end(e, false); };
    const cn = (e) => end(e, true);
    const key = (e) => { if (e.key === 'Escape' && on) { e.preventDefault(); e.stopPropagation(); end(e, true); } };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', cn, true); addEventListener('keydown', key, true);
    return true;
  }

  const api = { selected, info, grab, nudge, move, resize, place };
  ctx.elements = api;
  return api;
}
