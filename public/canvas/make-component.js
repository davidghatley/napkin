// Create component from a selection (standards section 9, decision 0023). Select an element in an HTML frame, run the
// command, and that element becomes a component of its own: a .tsx file beside the frame, on the canvas to its right.
// No name is asked first: the name comes from what was selected (its class, id or tag) and can be changed afterwards.
// The server does the work (POST /api/frames/component, src/doc/to-component.js); this file decides when the command
// applies, says so plainly when it does not, and shows the result: revealed, readable and clear of the message.
//   initMakeComponent(ctx) -> ctx.makeComponent = { can() -> { ok, why }, run() -> Promise<{ path, name } | null> }
import { plain } from './words.js';

const WHOLE = 'Double-click into the frame and select the part you want; the whole frame cannot be a component.';

export function initMakeComponent(ctx) {
  const until = (f, ms = 4000) => new Promise((res) => { const t0 = performance.now(); (function poll() { const v = f(); if (v || performance.now() - t0 > ms) res(v || null); else requestAnimationFrame(poll); })(); });
  let busy = false;

  // What the command would act on, or why it cannot: one sentence a person can act on.
  function can() {
    const sel = ctx.state.selection, c = sel && ctx.state.components.get(sel.component);
    if (!sel || !c) return { ok: false, why: 'Select an element in a frame first.' };
    if ((ctx.state.selections?.length || 1) > 1) return { ok: false, why: 'Select one element; a component is made from one element and what is inside it.' };
    if ((c.fileKind || c.kind) !== 'html') return { ok: false, why: `${c.name} is already a component.` };
    if (sel.card) return { ok: false, why: WHOLE }; // the frame's card itself (its label, its file row): the whole frame
    const sec = ctx.stage.sections.get(sel.component), tree = sec?.docFrame?.tree?.();
    const node = (function find(l) { for (const n of l || []) { if (String(n.node) === String(sel.node)) return n; const f = find(n.children); if (f) return f; } return null; })(tree?.tree);
    if (!node) return { ok: false, why: 'Select an element in a frame first.' };
    if (['html', 'head', 'body'].includes(String(node.tag).toLowerCase())) return { ok: false, why: WHOLE };
    return { ok: true, from: sel.component, node: String(sel.node), tag: node.tag };
  }

  // Select the new card so the panel shows it. Its frame may still be drawing, and a card drops a selection it cannot
  // find yet, so this keeps trying for a few seconds in the background and gives up the moment the person selects
  // something else. Focus is not moved.
  async function selectWhenDrawn(path) {
    const key = (x) => (x ? `${x.component}\n${x.node}` : ''), was = key(ctx.state.selection), t0 = performance.now(); let held = 0;
    while (performance.now() - t0 < 8000 && held < 4) {
      let id = null; for (const [k, c] of ctx.state.components) if (c.path === path) id = k; // a new card's id settles after its first read, so follow the file
      if (id == null) { await new Promise((r) => setTimeout(r, 80)); continue; }
      const now = ctx.state.selection;
      if (now?.component === id) held++;
      else if (now && key(now) !== was) return; // the person moved on
      else { held = 0; const root = ctx.state.components.get(id)?.doc?.root?.id ?? ctx.stage.rootNode?.(id); if (root != null) ctx.select({ component: id, node: root, variant: {}, card: true }); }
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  // Show the new card where a person can read it: wholly inside the canvas (which Layers and the right panel do not
  // overlap), clear of the message at the bottom, at 100% or the largest zoom that fits it. Its frame draws, measures and
  // may be moved by the layout after it appears, so this waits for its place and size to hold still, shows it, and shows
  // it again if it moves within the next seconds, unless the person pans or zooms in the meantime.
  const place = (id) => { const r = ctx.stage.componentRect?.(id); return r && Number.isFinite(r.x) && r.w > 0 && r.h > 0 ? r : null; };
  function clearArea() {
    const b = ctx.view.stageBox(), pad = 32, area = { left: pad, top: pad, right: b.width - pad, bottom: b.height - pad };
    const h = document.getElementById('hint'), hr = h?.textContent && h.getClientRects().length ? h.getBoundingClientRect() : null;
    if (hr) area.bottom = Math.min(area.bottom, hr.top - b.top - 16);
    return area;
  }
  function revealView(r) {
    const a = clearArea(), w = a.right - a.left, h = a.bottom - a.top, v = ctx.view.get();
    const fitZ = Math.min(1, w / r.w, h / r.h);
    const x0 = r.x * v.z + v.x, y0 = r.y * v.z + v.y, x1 = (r.x + r.w) * v.z + v.x, y1 = (r.y + r.h) * v.z + v.y;
    if (x0 >= a.left && y0 >= a.top && x1 <= a.right && y1 <= a.bottom && v.z >= fitZ - 1e-6) return null; // already in view and readable
    const z = Math.max(0.05, fitZ);
    return { z, x: a.left + w / 2 - (r.x + r.w / 2) * z, y: a.top + h / 2 - (r.y + r.h / 2) * z };
  }
  async function revealWhenSettled(path) {
    const idOf = () => { for (const [k, c] of ctx.state.components) if (c.path === path) return k; return null; };
    const same = (a, b) => a && b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;
    const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.z - b.z) < 1e-4;
    const t0 = performance.now(); let last = null, still = 0, shown = null, aim = null;
    while (performance.now() - t0 < 8000) {
      await new Promise((res) => setTimeout(res, 100));
      const id = idOf(); if (id == null) continue;
      const sec = ctx.stage.sections.get(id), r = place(id);
      if (!r || sec?.el?.dataset.ready !== '1') { still = 0; last = r; continue; }
      if (aim && !near(ctx.view.target?.() ?? ctx.view.get(), aim)) return; // the person moved the view: theirs now
      still = same(r, last) ? still + 1 : 0; last = r;
      if (still < 3 || same(r, shown)) { if (shown && performance.now() - t0 > 6000) return; continue; }
      const next = revealView(r); shown = r;
      if (next) { aim = next; ctx.view.set(next, { animate: true }); } else aim = ctx.view.get();
    }
  }

  // The width a grid or flex parent gave the element in its frame, in the element's own box-sizing (what `width:` means
  // for it); null when its width is its own. The component has no such parent, so it is given this width instead.
  function gridWidth(id, node) {
    try {
      const real = ctx.stage.sections.get(id)?.docFrame?.element(node)?.el, win = real?.ownerDocument?.defaultView;
      if (!real?.parentElement || !win) return null;
      const s = win.getComputedStyle(real), ps = win.getComputedStyle(real.parentElement);
      if (!/^(inline-)?(grid|flex)$/.test(ps.display) || /^(inline|contents|none)$/.test(s.display)) return null;
      let w = real.getBoundingClientRect().width;
      if (s.boxSizing !== 'border-box') w -= ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((n, k) => n + (parseFloat(s[k]) || 0), 0);
      return w > 0 ? Math.round(w * 100) / 100 : null;
    } catch { return null; }
  }

  async function run() {
    if (busy) return null;
    const t = can();
    if (!t.ok) { ctx.hint(t.why); return null; }
    busy = true;
    try {
      const res = await ctx.fetch('/api/frames/component', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: t.from, node: t.node, width: gridWidth(t.from, t.node) }) });
      const r = await res.json().catch(() => ({ ok: false, error: `napkin answered ${res.status}` }));
      if (!r.ok) { ctx.hint(`Could not make the component: ${plain(r.error)}`); return null; }
      // the new file joins the canvas on the folder's next scan; wait for its card, then show it
      // (a .tsx file's card is named for the file and its export: "Card.tsx#Card")
      const made = await until(() => { for (const [id, c] of ctx.state.components) if (c.path === r.path) { const s = ctx.stage.sections.get(id); if (s?.el?.isConnected) return { id, c }; } return null; });
      const left = r.dropped?.length ? ` Left behind: ${r.dropped.join('; ')}.` : '';
      ctx.hint(`${r.name} made from ${r.from}. It is ${r.path}; the frame is unchanged.${left}`);
      if (made) { revealWhenSettled(r.path); selectWhenDrawn(r.path); }
      ctx.emit?.('component-made', { path: r.path, name: r.name, from: r.from });
      return { path: r.path, name: r.name, component: made?.id ?? null };
    } finally { busy = false; }
  }

  const api = { can, run };
  ctx.makeComponent = api;
  return api;
}
