// A frame (an HTML file's card) handled as an object on the canvas, the way Figma treats an artboard (standards 3.5, 3.6, 3.8, 3.11).
// Each verb is one step on the person's undo stack on the server, so Ctrl+Z puts back exactly what was there:
//   nudge(dx, dy)          the arrows (1 px, Shift 10 px): POST /api/layout { undo: true }
//   resize(id, box)        the eight handles (handles.js draws them): the body's width and height in the file and the frame's place,
//                          one POST /api/edit { canvas }
// Delete and duplicate of a whole frame (its file) live in file-ops.js, the one path for the keys, the menus and the palette.
// A frame counts as selected when the one selection is its card, its <html> or its <body> (what drawing a frame selects).
// The keys reach these through the registry (actions.js): the arrows are the spatial-focus commands, which nudge a selected frame.
//   initFrameOps(ctx) -> ctx.frames = { selected(), box(id), nudge, resize, MIN }
import { plain } from './words.js';
import { DOC_WIDTH } from './doc-frames.js';

export const MIN = { w: 48, h: 32 };   // standards 3.6 (the server keeps the same floor: src/doc/folder.js FRAME_MIN)

export function initFrameOps(ctx) {
  const call = async (path, method, body) => {
    const res = await ctx.fetch(path, { method, headers: { 'content-type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
    return res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
  };
  // writes go one after another: two quick nudges are two steps, in the order they were pressed
  let chain = Promise.resolve();
  const queue = (fn) => (chain = chain.then(fn).catch((e) => { ctx.hint(plain(e?.message || String(e))); return null; }));

  function selected() {
    if (ctx.state.selections.length !== 1 || ctx.state.tool !== 'select') return null;
    const s = ctx.state.selection, c = ctx.state.components.get(s?.component);
    if (!c || c.readOnly || !ctx.create?.isFrameFile(c)) return null;
    const sec = ctx.stage.sections.get(s.component), f = sec?.docFrame, t = f?.tree();
    if (!sec?.pos || !t || !f.iframe()) return null;
    const body = ctx.create.bodyOf(t), top = (t.tree || []).find((n) => n.tag === 'html');
    if (!s.card && s.node !== '' && s.node !== body?.node && s.node !== top?.node) return null;
    return { s, c, id: s.component, sec, f, body };
  }
  // the frame's box in canvas px: where it sits and how big its page is drawn
  function box(id) {
    const sec = ctx.stage.sections.get(id), f = sec?.docFrame;
    if (!sec?.pos || !f?.iframe()) return null;
    return { x: sec.pos.x, y: sec.pos.y, w: f.width, h: Math.round(f.iframe().offsetHeight) };
  }

  function nudge(dx, dy) {
    const fs = selected();
    if (!fs) return false;
    const x = fs.sec.pos.x + dx, y = fs.sec.pos.y + dy;
    ctx.stage.putAt(fs.id, x, y);
    queue(async () => { const j = await call('/api/layout', 'POST', { component: fs.id, x, y, undo: true }); if (!j.ok) ctx.hint(`Could not move the frame: ${plain(j.error)}`); return j; });
    return true;
  }

  async function resize(id, { x, y, w, h }) {
    const c = ctx.state.components.get(id), f = ctx.stage.sections.get(id)?.docFrame, body = f && ctx.create.bodyOf(f.tree());
    if (!c || !body) return null;
    w = Math.max(MIN.w, Math.round(w)); h = Math.max(MIN.h, Math.round(h));
    ctx.stage.putAt(id, x, y);
    const edits = [{ op: 'style', node: body.node, prop: 'width', value: `${w}px` }, { op: 'style', node: body.node, prop: 'height', value: `${h}px` }];
    return queue(async () => {
      const j = await call('/api/edit', 'POST', { component: id, baseRevision: c.revision, edits, summary: `Resized ${c.name} to ${w} × ${h}`, canvas: { x, y, width: w } });
      if (!j.ok) ctx.hint(`Could not resize the frame: ${plain(j.error)}`);
      else c.width = w;
      return j;
    });
  }

  // an undo or a redo put a frame's place back (src/doc/folder.js putPlace): the card follows
  ctx.on('doc-layout', ({ frame: component, canvas }) => {
    const c = ctx.state.components.get(component), sec = ctx.stage.sections.get(component);
    if (!c || !sec) return;
    if (canvas && Number.isFinite(canvas.x)) ctx.stage.putAt(component, canvas.x, canvas.y);
    const w = canvas?.width;
    if (w !== c.width) { c.width = w; sec.docFrame?.setWidth?.(w ?? DOC_WIDTH); }
    ctx.stage.refreshOverlays();
  });

  const api = { selected, box, nudge, resize, MIN };
  ctx.frames = api;
  return api;
}
