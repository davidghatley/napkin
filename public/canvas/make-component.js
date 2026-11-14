// Create component from a selection (standards section 9, decision 0023). Select an element in an HTML frame, run the
// command, and that element becomes a component of its own: a .tsx file beside the frame, on the canvas to its right.
// No name is asked first: the name comes from what was selected (its class, id or tag); the card's label is then a field
// with that name selected, to change it in place (Enter) or keep it (Escape).
// The server does the work (POST /api/frames/component, src/doc/to-component.js); this file decides when the command
// applies, says so plainly when it does not, and shows the result: revealed, readable and clear of the message.
//   initMakeComponent(ctx) -> ctx.makeComponent = { can() -> { ok, why }, run() -> Promise<{ path, name } | null>, rename(id) -> bool }
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
  // something else, or clears the selection once it was there. Focus is not moved.
  async function selectWhenDrawn(path, renamed = false) {
    const key = (x) => (x ? `${x.component}\n${x.node}` : ''), t0 = performance.now(); let held = 0, asked = false;
    const was = key(ctx.state.selection);
    while (performance.now() - t0 < 8000 && held < 4) {
      let id = null; for (const [k, c] of ctx.state.components) if (c.path === path) id = k; // a new card's id settles after its first read, so follow the file
      if (id == null || ctx.stage.sections.get(id)?.el?.dataset.ready !== '1') { await new Promise((r) => setTimeout(r, 80)); continue; }
      const now = ctx.state.selection;
      if (now?.component === id) held++;
      else if (!now && (held || (!asked && !renamed))) return; // the person cleared it (a card drops only a selection it cannot find yet, before it holds; a rename drops the old card's)
      else if (now && key(now) !== was && !(renamed && !ctx.state.components.has(now.component))) return; // the person moved on
      else { held = 0; const root = ctx.stage.mainNode?.(id) ?? ctx.state.components.get(id)?.doc?.root?.id; if (root != null) { asked = true; ctx.select({ component: id, node: root, variant: {}, card: true }); if (ctx.state.selection?.component === id) held = 1; } } // taken at once: a clear after this is the person's, not the card dropping it
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

  // Naming afterwards (standards section 9, rule 4): the new card's label is a field with the automatic name selected.
  // Enter names it (the file and its export, POST /api/frames/component/rename), Escape or a click away keeps the
  // automatic name. A .tsx card's id settles after its first read ("Trip.tsx#Trip"), so this follows the file, and waits
  // for the settled card so the field is not drawn into a card that is about to be replaced.
  const base = (p) => String(p || '').split('/').pop().replace(/\.(tsx|jsx)$/i, '');
  const dirOf = (p) => (String(p).includes('/') ? String(p).slice(0, String(p).lastIndexOf('/') + 1) : '');
  async function nameWhenDrawn(path) {
    const sel = ctx.state.selection;
    const got = await until(() => { for (const [id, c] of ctx.state.components) if (c.path === path && String(id).includes('#')) { const s = ctx.stage.sections.get(id); if (s?.el?.dataset.ready === '1' && s.el.querySelector('.cmp-title h3')) return id; } return null; }, 8000);
    if (got == null) return null;
    const now = ctx.state.selection;
    if (now && now.component !== got && sel && (now.component !== sel.component || now.node !== sel.node)) return null; // the person moved on
    return rename(got);
  }
  function rename(id) {
    const c = ctx.state.components.get(id);
    if (!c?.path) return false;
    const was = base(c.path), dir = dirOf(c.path);
    const taken = new Set([...ctx.state.components.values()].filter((x) => x.path && x.path !== c.path && /\.(tsx|jsx)$/i.test(x.path) && dirOf(x.path) === dir).map((x) => base(x.path).toLowerCase()));
    const ed = ctx.create?.startRename(id, {
      name: was,
      check: (v) => {
        const to = String(v ?? '').trim().replace(/\.(tsx|jsx)$/i, '');
        if (to === was) return { same: true };
        if (!/^[A-Z][A-Za-z0-9]*$/.test(to)) return { error: 'A component name is letters and digits, starting with a capital: Card, PriceTag.' };
        if (taken.has(to.toLowerCase())) return { error: `${to} is already a component in this folder.` };
        return { name: to };
      },
      rename: async (to) => {
        const res = await ctx.fetch('/api/frames/component/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: c.path, to }) });
        const j = await res.json().catch(() => ({ ok: false, error: `napkin answered ${res.status}` }));
        if (!j.ok) return { ok: false, error: plain(j.error) };
        ctx.hint(`Named ${j.name}: ${j.path}.`);
        selectWhenDrawn(j.path, true);
        return j;
      },
    });
    return !!ed;
  }

  // The box the element has in its frame: its width, and its height when a grid or flex parent sized it (a row stretched it),
  // each in the element's own box-sizing (what `width:` means for it). The component has no such parent, so it is given the
  // size it had (and may shrink to fit); null where a size does not apply (an inline box, a table part, display: contents).
  const REPLACED = /^(img|svg|video|canvas|iframe|input|button|select|textarea|object|embed|meter|progress)$/i;
  function frameSize(id, node) {
    try {
      const real = ctx.stage.sections.get(id)?.docFrame?.element(node)?.el, win = real?.ownerDocument?.defaultView;
      if (!real || !win) return {};
      const s = win.getComputedStyle(real);
      if (/^(contents|none|table-.*)$/.test(s.display) || (s.display === 'inline' && !REPLACED.test(real.tagName))) return {};
      const r = real.getBoundingClientRect(), edge = (...k) => k.reduce((n, x) => n + (parseFloat(s[x]) || 0), 0);
      const inBox = (v, ...k) => (s.boxSizing === 'border-box' ? v : v - edge(...k));
      const round = (v) => (v > 0 ? Math.round(v * 100) / 100 : null);
      const parent = real.parentElement && win.getComputedStyle(real.parentElement);
      return {
        width: round(inBox(r.width, 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth')),
        height: parent && /^(inline-)?(grid|flex)$/.test(parent.display) && !/^(inline-)?table$/.test(s.display) ? // a table's height leaves out its caption
           round(inBox(r.height, 'paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth')) : null,
      };
    } catch { return {}; }
  }

  async function run() {
    if (busy) return null;
    const t = can();
    if (!t.ok) { ctx.hint(t.why); return null; }
    busy = true;
    try {
      const res = await ctx.fetch('/api/frames/component', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: t.from, node: t.node, ...frameSize(t.from, t.node) }) });
      const r = await res.json().catch(() => ({ ok: false, error: `napkin answered ${res.status}` }));
      if (!r.ok) { ctx.hint(`Could not make the component: ${plain(r.error)}`); return null; }
      // the new file joins the canvas on the folder's next scan; wait for its card, then show it
      // (a .tsx file's card is named for the file and its export: "Card.tsx#Card")
      const made = await until(() => { for (const [id, c] of ctx.state.components) if (c.path === r.path) { const s = ctx.stage.sections.get(id); if (s?.el?.isConnected) return { id, c }; } return null; });
      const left = r.dropped?.length ? ` Left behind: ${r.dropped.join('; ')}.` : '';
      ctx.hint(`${r.name} made from ${r.from}. It is ${r.path}; the frame is unchanged.${left}`);
      if (made) { revealWhenSettled(r.path); selectWhenDrawn(r.path); nameWhenDrawn(r.path); }
      for (let i = steps.length - 1; i >= 0; i--) if (steps[i].undone) steps.splice(i, 1); // a new step ends the redo line
      steps.push({ path: r.path, from: t.from, node: t.node, undone: false });
      ctx.emit?.('component-made', { path: r.path, name: r.name, from: r.from });
      return { path: r.path, name: r.name, component: made?.id ?? null };
    } finally { busy = false; }
  }

  // Undo and Redo of a made component (history.js emits 'undone' / 'redone' for the file): undo selects the element it was
  // made from again (waiting for the frame to hold it), redo selects the new card once it is drawn. The same two events
  // edit-ops.js uses for its own steps; a step that is not ours is left alone.
  const steps = []; // { path, from, node, undone }
  const fileOf = (u) => String(u.component ?? '').split('#')[0];
  ctx.on?.('undone', (u) => {
    const m = steps.findLast((x) => fileOf(u) === x.path && !x.undone); if (!m) return;
    m.undone = true;
    (async () => {
      const f = () => ctx.stage.sections.get(m.from)?.docFrame;
      for (let i = 0; i < 160 && !(f()?.has?.(m.node)); i++) await new Promise((r) => setTimeout(r, 25));
      ctx.select({ component: m.from, node: m.node, variant: {} });
    })();
  });
  ctx.on?.('redone', (u) => {
    const m = steps.findLast((x) => fileOf(u) === x.path && x.undone); if (!m) return;
    m.undone = false;
    selectWhenDrawn(m.path);
  });

  const api = { can, run, rename };
  ctx.makeComponent = api;
  return api;
}
