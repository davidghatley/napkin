// A frame is its file (docs/basics/standards.md section 3): an HTML file drawn as a frame is duplicated beside itself (Ctrl+D, the
// menu's Duplicate), deleted (Delete, the menu's Delete file) and renamed in place on its label (F2, the menu's Rename, a
// double-click on the label: all create.js startRename, the one rename field). Each goes through the server's frame routes
// (POST /api/frames/duplicate, DELETE /api/frames/<path>, POST /api/frames/rename): one step on your undo stack, so Ctrl+Z or the
// toast's Undo takes it back (history.js). The frame keeps its place on the canvas through a rename, a delete and its undo; a
// duplicate goes in the first free place to the right on the same row, and nothing else moves or zooms.
//   initFileOps(ctx) -> ctx.fileOps = { rename(id), duplicate(id), remove(id) }
import { plain } from './words.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 48;   // between a frame and its copy
const TITLE = 40; // the label strip above a frame, kept clear too

export function initFileOps(ctx) {
  const post = async (path, body, method = 'POST') => {
    const r = await ctx.fetch(path, { method, headers: { 'content-type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
    return r.json().catch(() => ({ ok: false, error: `server answered ${r.status}` }));
  };
  const comp = (id) => ctx.state.components.get(id);
  const sec = (id) => ctx.stage.sections.get(id);
  const fileName = (path) => String(path).split('/').pop();
  const cardOf = (id) => ({ component: id, node: comp(id)?.doc?.root.id ?? ctx.stage.rootNode?.(id) ?? '', variant: {}, card: true });
  // the file is on the canvas, drawn: then it can be selected
  async function arrived(id, ms = 10000) {
    for (let t = 0; t < ms; t += 40) { const s = sec(id); if (comp(id) && s?.pos && s.el?.dataset.ready === '1' && s.docFrame?.tree()) return true; await sleep(40); }
    return false;
  }
  async function gone(id, ms = 6000) { for (let t = 0; t < ms && comp(id); t += 40) await sleep(40); }
  // A frame the stage placed itself has no saved place; it gets one before its file changes name or goes, so it comes back there.
  async function pin(id) {
    const c = comp(id), s = sec(id);
    if (!c || !s?.pos || (c.canvas && (c.canvas.x || c.canvas.y))) return;
    await post('/api/layout', { component: id, x: s.pos.x, y: s.pos.y });
    c.canvas = { x: s.pos.x, y: s.pos.y };
  }
  // Ctrl+Z (or the toast's Undo) undoes the step on the server (history.js), then `after` puts the selection back.
  const toast = (msg, after) => {
    const undo = async () => { const j = await ctx.undo(); if (!j?.ok) return false; await after?.(j); return true; };
    ctx.cmpOps?.remember({ undo }); ctx.cmpOps?.toast(msg, true);
  };
  const selectFile = async (id) => { if (await arrived(id)) ctx.select(cardOf(id)); };

  // ---------------------------------------------------------------------------------------------------- duplicate
  // The copy goes to the right of the frame, on its row, in the first gap wide enough (the view does not move or zoom).
  function besideOf(id) {
    const s = sec(id), w = s.size.w, h = s.size.h, y = s.pos.y;
    const others = ctx.stage.sections.all().filter(([k, x]) => k !== id && x.pos).map(([, x]) => ({ x: x.pos.x, y: x.pos.y - TITLE, w: x.size.w, h: x.size.h + TITLE }));
    let x = s.pos.x + w + GAP;
    for (let i = 0; i < 400; i++) {
      const hit = others.find((o) => x < o.x + o.w + GAP && x + w + GAP > o.x && y - TITLE < o.y + o.h && y + h > o.y);
      if (!hit) break;
      x = hit.x + hit.w + GAP;
    }
    return { x, y };
  }
  async function duplicate(id) {
    const c = comp(id);
    if (!c || !sec(id)?.pos) return null;
    await pin(id);
    const r = await post('/api/frames/duplicate', { from: id, ...besideOf(id) });
    if (!r.ok) { ctx.hint(`Not duplicated: ${plain(r.error)}`); return r; }
    await selectFile(r.component);
    toast(`Duplicated ${fileName(c.path)} as ${fileName(r.component)}. Ctrl+Z removes the copy.`, async () => {
      await gone(r.component);
      if (comp(id)) ctx.select(cardOf(id));
    });
    return r;
  }

  // ---------------------------------------------------------------------------------------------------- delete
  async function remove(id) {
    const c = comp(id);
    if (!c) return null;
    await pin(id);
    const r = await post(`/api/frames/${encodeURIComponent(id)}`, null, 'DELETE');
    if (!r.ok) { ctx.hint(`Not deleted: ${plain(r.error)}`); return r; }
    if (ctx.state.selections.some((s) => s.component === id)) ctx.select(null);
    toast(`Deleted ${fileName(c.path)}. Ctrl+Z brings it back.`, () => selectFile(id));
    return r;
  }

  // ---------------------------------------------------------------------------------------------------- rename
  // One rename field for a frame file, whichever way it is asked for (create.js): Ctrl+Z after it undoes it on the server.
  async function rename(id) {
    if (!comp(id)) return false;
    await pin(id);
    ctx.cmpOps?.remember(null);
    return !!ctx.create.startRename(id);
  }

  const api = { rename, duplicate, remove };
  ctx.fileOps = api;
  return api;
}
