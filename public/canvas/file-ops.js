// A frame is its file (docs/basics/standards.md section 3): an HTML file drawn as a frame is renamed in place on its label (F2,
// the menu's Rename, a double-click on the label), duplicated beside itself (Ctrl+D, the menu's Duplicate) and deleted into
// napkin's trash outside the folder (Delete, the menu's Delete file). Each is undone straight after with Ctrl+Z or the toast's
// Undo (component-ops.js keeps that one "last thing"). The frame keeps its place on the canvas through a rename, a delete and
// its undo; a duplicate goes in the first free place to the right on the same row, and nothing else moves or zooms.
//   initFileOps(ctx) -> ctx.fileOps = { rename(id), duplicate(id), remove(id), editing() }
import { plain } from './words.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 48;   // between a frame and its copy
const TITLE = 40; // the label strip above a frame, kept clear too

export function initFileOps(ctx) {
  const post = async (path, body) => {
    const r = await ctx.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.json().catch(() => ({ ok: false, error: `server answered ${r.status}` }));
  };
  const comp = (id) => ctx.state.components.get(id);
  const sec = (id) => ctx.stage.sections.get(id);
  const fileName = (path) => String(path).split('/').pop();
  const stem = (path) => fileName(path).replace(/\.html?$/i, '');
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
  const toast = (msg, undo) => { ctx.cmpOps?.remember(undo ? { undo } : null); ctx.cmpOps?.toast(msg, !!undo); };
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
    const r = await post('/api/files/duplicate', { component: id, ...besideOf(id) });
    if (!r.ok) { ctx.hint(`Not duplicated: ${plain(r.error)}`); return r; }
    await selectFile(r.component);
    toast(`Duplicated ${fileName(c.path)} as ${fileName(r.file)}. Ctrl+Z removes the copy.`, async () => {
      const t = await post('/api/files/trash', { component: r.component });
      if (!t.ok) { ctx.cmpOps?.toast(`Can't remove the copy: ${plain(t.error)}`, false); return false; }
      await gone(r.component);
      if (comp(id)) ctx.select(cardOf(id));
      ctx.cmpOps?.toast(`Removed ${fileName(r.file)}.`, false);
      return true;
    });
    return r;
  }

  // ---------------------------------------------------------------------------------------------------- delete
  async function remove(id) {
    const c = comp(id);
    if (!c) return null;
    await pin(id);
    const r = await post('/api/files/trash', { component: id });
    if (!r.ok) { ctx.hint(`Not deleted: ${plain(r.error)}`); return r; }
    if (ctx.state.selections.some((s) => s.component === id)) ctx.select(null);
    toast(`Deleted ${fileName(c.path)}. Ctrl+Z brings it back.`, async () => {
      const b = await post('/api/files/restore', { trash: r.trash });
      if (!b.ok) { ctx.cmpOps?.toast(`Can't bring ${fileName(c.path)} back: ${plain(b.error)}`, false); return false; }
      await selectFile(b.component);
      ctx.cmpOps?.toast(`Brought ${fileName(c.path)} back.`, false);
      return true;
    });
    return r;
  }

  // ---------------------------------------------------------------------------------------------------- rename in place
  // The label becomes a field with the name selected. Enter or a click elsewhere renames the file; Escape keeps the name. An empty
  // name, one the folder already has, or one a file cannot have is refused under the field, which stays open.
  let editor = null;
  function rename(id) {
    const c = comp(id), s = sec(id), label = s?.el?.querySelector('.cmp-head h3');
    if (!c || !label) return false;
    editor?.cancel();
    const back = document.activeElement;
    const input = document.createElement('input'), msg = document.createElement('p');
    input.className = 'nk-rename'; input.value = stem(c.path); input.spellcheck = false; input.autocomplete = 'off';
    input.setAttribute('aria-label', `Rename ${fileName(c.path)}`); input.dataset.nodrag = '1';
    msg.className = 'nk-rename-msg'; msg.setAttribute('role', 'alert'); msg.hidden = true; msg.id = 'nk-rename-msg';
    input.setAttribute('aria-describedby', msg.id);
    document.body.append(input, msg);
    const place = () => {
      const r = label.getBoundingClientRect();
      input.style.left = `${Math.round(r.left - 5)}px`; input.style.top = `${Math.round(r.top + r.height / 2 - 12)}px`;
      input.style.width = `${Math.round(Math.max(160, Math.min(360, r.width + 48)))}px`;
      msg.style.left = input.style.left; msg.style.top = `${Math.round(r.top + r.height / 2 + 16)}px`;
    };
    place();
    const offView = ctx.on('view', place), offLayout = ctx.on('layout', place);
    input.focus(); input.select();
    let busy = false, done = false;
    const finish = (refocus = true) => {
      if (done) return; done = true; editor = null;
      offView(); offLayout(); input.remove(); msg.remove();
      if (refocus && back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    };
    const refuse = (text) => { msg.textContent = text; msg.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); input.select(); };
    async function commit() {
      if (busy || done) return;
      const to = input.value.trim().replace(/\.html?$/i, '');
      if (to === stem(c.path)) return finish();
      if (!to) return refuse('A file needs a name.');
      const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/') + 1) : '';
      const ext = c.path.slice(c.path.lastIndexOf('.'));
      if ([...ctx.state.components.values()].some((x) => x !== c && x.path?.toLowerCase() === (dir + to + ext).toLowerCase())) return refuse(`${to}${ext} already exists in this folder. Type another name.`);
      busy = true;
      await pin(id);
      const r = await post('/api/files/rename', { component: id, name: to });
      busy = false;
      if (!r.ok) return refuse(plain(r.error));
      finish(false);
      if (r.same) return;
      const from = c.path;
      await selectFile(r.component);
      if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
      toast(`Renamed ${fileName(from)} to ${fileName(r.file)}. Ctrl+Z puts the old name back.`, async () => {
        const u = await post('/api/files/rename', { component: r.component, name: stem(from) });
        if (!u.ok) { ctx.cmpOps?.toast(`Can't put the old name back: ${plain(u.error)}`, false); return false; }
        await selectFile(u.component);
        ctx.cmpOps?.toast(`${fileName(r.file)} is ${fileName(from)} again.`, false);
        return true;
      });
    }
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation(); // the canvas keys (Delete, Escape, letters) stay out of the field
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(); }
    });
    input.addEventListener('input', () => { msg.hidden = true; input.removeAttribute('aria-invalid'); });
    input.addEventListener('blur', () => { setTimeout(() => { if (!done && document.activeElement !== input) commit(); }, 0); });
    editor = { cancel: () => finish(false), input };
    return true;
  }

  // A double-click on the label of an HTML file's frame renames it (a TSX component's label opens its rename dialog).
  document.addEventListener('dblclick', (ev) => {
    const label = ev.target.closest?.('#stage .cmp-head h3');
    const id = label?.closest('.cmp')?.dataset.component, c = id && comp(id);
    if (!c || c.item || c.readOnly || ctx.state.tool !== 'select') return;
    if (c.kind === 'html' && c.fileKind !== 'html') return;
    ev.preventDefault(); ev.stopPropagation();
    ctx.select(cardOf(id));
    ctx.cmpOps.rename(id);
  }, true);

  const api = { rename, duplicate, remove, editing: () => !!editor };
  ctx.fileOps = api;
  return api;
}
