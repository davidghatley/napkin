// Create component from a selection (standards section 9, decision 0023). Select an element in an HTML frame, run the
// command, and that element becomes a component of its own: a .tsx file beside the frame, on the canvas to its right.
// No name is asked first: the name comes from what was selected (its class, id or tag) and can be changed afterwards.
// The server does the work (POST /api/frames/component, src/doc/to-component.js); this file decides when the command
// applies, says so plainly when it does not, and shows the result.
//   initMakeComponent(ctx) -> ctx.makeComponent = { can() -> { ok, why }, run() -> Promise<{ path, name } | null> }
import { plain } from './words.js';

export function initMakeComponent(ctx) {
  const until = (f, ms = 4000) => new Promise((res) => { const t0 = performance.now(); (function poll() { const v = f(); if (v || performance.now() - t0 > ms) res(v || null); else requestAnimationFrame(poll); })(); });
  let busy = false;

  // What the command would act on, or why it cannot: one sentence a person can act on.
  function can() {
    const sel = ctx.state.selection, c = sel && ctx.state.components.get(sel.component);
    if (!sel || !c) return { ok: false, why: 'Select an element in a frame first.' };
    if ((ctx.state.selections?.length || 1) > 1) return { ok: false, why: 'Select one element; a component is made from one element and what is inside it.' };
    if ((c.fileKind || c.kind) !== 'html') return { ok: false, why: `${c.name} is already a component.` };
    const sec = ctx.stage.sections.get(sel.component), tree = sec?.docFrame?.tree?.();
    const node = (function find(l) { for (const n of l || []) { if (String(n.node) === String(sel.node)) return n; const f = find(n.children); if (f) return f; } return null; })(tree?.tree);
    if (!node) return { ok: false, why: 'Select an element in a frame first.' };
    if (['html', 'head', 'body'].includes(String(node.tag).toLowerCase())) return { ok: false, why: 'Double-click into the frame and select the part you want; the whole frame cannot be a component.' };
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

  async function run() {
    if (busy) return null;
    const t = can();
    if (!t.ok) { ctx.hint(t.why); return null; }
    busy = true;
    try {
      const res = await ctx.fetch('/api/frames/component', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: t.from, node: t.node }) });
      const r = await res.json().catch(() => ({ ok: false, error: `napkin answered ${res.status}` }));
      if (!r.ok) { ctx.hint(`Could not make the component: ${plain(r.error)}`); return null; }
      // the new file joins the canvas on the folder's next scan; wait for its card, then show it
      // (a .tsx file's card is named for the file and its export: "Card.tsx#Card")
      const made = await until(() => { for (const [id, c] of ctx.state.components) if (c.path === r.path) { const s = ctx.stage.sections.get(id); if (s?.el?.isConnected) return { id, c }; } return null; });
      if (made) { ctx.stage.reveal?.(made.id); selectWhenDrawn(r.path); }
      const left = r.dropped?.length ? ` Left behind: ${r.dropped.join('; ')}.` : '';
      ctx.hint(`${r.name} made from ${r.from}. It is ${r.path}; the frame is unchanged.${left}`);
      ctx.emit?.('component-made', { path: r.path, name: r.name, from: r.from });
      return { path: r.path, name: r.name, component: made?.id ?? null };
    } finally { busy = false; }
  }

  const api = { can, run };
  ctx.makeComponent = api;
  return api;
}
