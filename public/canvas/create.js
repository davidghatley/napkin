// Create on the canvas (basics pass 2; docs/basics/standards.md sections 2, 3 and 4). Pick a tool, draw, the thing is there.
//   Frame on empty canvas: a new HTML file (frame-N.html, src/doc/folder.js frameTemplate) whose card sits where it was drawn.
//   Text on empty canvas: the same, hugging the text, with the caret in it; text left empty leaves nothing behind.
//   Image on empty canvas: a slot, the native picker, then a frame holding the picture (Cancel leaves nothing).
//   Inside an HTML frame each tool inserts an element there instead (one /api/edit insert).
// The card is drawn at once (a pending card in the world), the file follows; the pending card goes when the real one is drawn.
// tools.js owns the gesture (outline and size readout); this module turns a finished gesture into files and edits.
//   initCreate(ctx) -> ctx.create = { targetAt(ev), make({ tool, target, box, point }), atCentre(tool), rename(id, to), startRename(id),
//                                      adopt(response of POST /api/frames*): the new card, drawn; bodyOf(tree) }
import { plain } from './words.js';
import { VOID } from '/src/model.js';
import { richText, serialize } from './rich-text.js';

export const DEFAULT = { frame: [320, 180], image: [160, 120], nested: [100, 100] };
const MIN = { w: 48, h: 32 };
const TEXT_FONT = 'font: 16px/1.4 system-ui, sans-serif';
const FILL = '#f4f4f5'; // a frame inside a frame: a light fill so the box can be seen at all
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(16); } return null; }
const CONTAINERS = new Set(['html', 'body', 'div', 'section', 'main', 'article', 'aside', 'header', 'footer', 'nav', 'form', 'figure', 'ul', 'ol', 'li', 'td', 'th', 'fieldset', 'details', 'dialog']);
const frameFile = (c) => c && !c.item && c.kind === 'html' && (c.fileKind ?? 'html') === 'html' && /\.html?$/i.test(c.path || '');
const nameOf = (path) => String(path).split('/').pop().replace(/\.html?$/i, '');

export function initCreate(ctx) {
  const world = document.querySelector('#world');
  const post = async (path, body, method = 'POST') => {
    const res = await ctx.fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
  };
  const zoom = () => ctx.view.get().z || 1;

  // ---- names: what the next frame file will be called (the server decides; this is only the label shown at once)
  const paths = () => new Set([...(ctx.docs?.files || []).map((f) => f.path.toLowerCase()), ...[...ctx.state.components.all()].map((c) => String(c.path || '').replace(/#.*$/, '').toLowerCase())]);
  function nextName() { const taken = paths(); let n = 1; while (taken.has(`frame-${n}.html`)) n++; return `frame-${n}`; }

  // ---- the pending card: looks like a frame card (label above, white body), in canvas coordinates, until the real one is drawn
  function pending({ x, y, w, h, name }) {
    const el = document.createElement('section');
    el.className = 'cmp-pending'; el.dataset.nodrag = '1';
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.innerHTML = '<div class="cmp-head"><span class="cmp-title"><h3></h3></span></div><div class="frame"></div>';
    const frame = el.querySelector('.frame'), h3 = el.querySelector('h3');
    h3.textContent = name;
    if (w) { frame.style.width = `${w}px`; el.style.setProperty('--nk-w', `${w}px`); }
    if (h) frame.style.height = `${h}px`;
    world.append(el);
    return { el, frame, name: (n) => { h3.textContent = n; }, remove: () => el.remove() };
  }

  // The new file joins the canvas at once (docs.js would find it on the next folder scan; this does not wait for that).
  async function adopt(r) {
    const id = r.component;
    if (!ctx.state.components.has(id)) {
      ctx.state.components.set(id, { component: id, name: r.name ?? nameOf(id), path: r.path ?? id, kind: 'html', fileKind: 'html', revision: r.revision, doc: null, canvas: { x: r.canvas.x, y: r.canvas.y }, width: r.canvas.width });
      ctx.emit('added', { component: id });
    }
    ctx.stage.render(id).catch(console.error);
    ctx.stage.moveTo(id, r.canvas.x, r.canvas.y); // exactly where it was drawn (0, 0 included)
    return until(() => { const s = ctx.stage.sections.get(id); return s?.el.dataset.ready === '1' && s.docFrame?.tree() ? s : null; });
  }
  const bodyOf = (tree) => (function find(l) { for (const n of l || []) { if (n.tag === 'body') return n; const f = find(n.children); if (f) return f; } return null; })(tree?.tree);

  // ---- Frame on empty canvas -------------------------------------------------------------------------------------------
  async function newFrame({ x, y, w, h }) {
    const p = pending({ x, y, w, h, name: nextName() });
    const r = await post('/api/frames', { x, y, width: w, height: h });
    if (!r.ok) { p.remove(); ctx.hint(`Could not make the frame: ${plain(r.error)}`); return null; }
    p.name(r.name);
    const sec = await adopt(r);
    p.remove();
    const body = sec && bodyOf(sec.docFrame.tree());
    if (body) ctx.select({ component: r.component, node: body.node, variant: {} });
    return r;
  }

  // ---- Text: an editor in the canvas, at the pointer, that the file catches up with -------------------------------------
  let editing = null;
  function textEditor({ x, y, width, host }) {
    const ed = document.createElement('div');
    ed.className = 'nk-new-text'; ed.contentEditable = 'true'; ed.spellcheck = false;
    ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true'); ed.setAttribute('aria-label', 'New text');
    if (width) { ed.style.width = `${width}px`; ed.dataset.fixed = '1'; }
    if (host) host.append(ed);
    else { ed.classList.add('nk-in-frame'); ed.dataset.nodrag = '1'; ed.style.left = `${x}px`; ed.style.top = `${y}px`; world.append(ed); }
    return ed;
  }
  // Escape, Ctrl/Cmd+Enter or a click elsewhere commit; Enter is a new line; Ctrl/Cmd+B, I, U format (rich-text.js, the same keys
  // as text edited again). Resolves to { text, html }: the plain text (empty means nothing was typed) and the markup to write.
  function editUntilDone(ed) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; const html = serialize(ed); detach(); ed.contentEditable = 'false'; ed.blur(); editing = null; resolve({ text: ed.textContent, html }); };
      const detach = richText(ed, { onCommit: finish });
      ed.addEventListener('blur', () => setTimeout(finish, 0));
      editing = { finish };
      ed.focus();
    });
  }
  async function canvasText({ x, y, width }) {
    const p = pending({ x, y, w: width, h: 0, name: nextName() });
    p.frame.style.height = ''; p.el.dataset.text = '1';
    const ed = textEditor({ width, host: p.frame });
    const { text, html } = await editUntilDone(ed);
    if (!text.trim()) { p.remove(); return null; } // nothing typed: no frame, no file, no undo step
    const w = width ?? Math.max(MIN.w, Math.ceil(ed.getBoundingClientRect().width / zoom()) + 1);
    const r = await post('/api/frames', { x, y, width: w, body: `<p style="margin: 0; ${TEXT_FONT}">${html}</p>` });
    if (!r.ok) { p.remove(); ctx.hint(`Could not make the text: ${plain(r.error)}`); return null; }
    p.name(r.name);
    const sec = await adopt(r);
    p.remove();
    const body = sec && bodyOf(sec.docFrame.tree());
    if (body) ctx.select({ component: r.component, node: body.children[0]?.node ?? body.node, variant: {} });
    return r;
  }

  // ---- Image: a slot at once, the picker, then the picture (Cancel takes the slot away) -------------------------------------
  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
      let settled = false; const settle = (f) => { if (!settled) { settled = true; input.remove(); resolve(f); } };
      input.addEventListener('change', () => settle(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => settle(null));
      document.body.append(input);
      input.click();
    });
  }
  async function upload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    return post('/api/assets', { ext, data: btoa(bin) });
  }
  async function canvasImage({ x, y, w, h }) {
    const p = pending({ x, y, w, h, name: nextName() });
    p.frame.classList.add('nk-slot');
    const file = await pickFile();
    if (!file) { p.remove(); return null; }
    const a = await upload(file);
    if (!a.ok) { p.remove(); ctx.hint(`Could not add the picture: ${plain(a.error)}`); return null; }
    const r = await post('/api/frames', { x, y, width: w, height: h, body: `<img src="${esc(a.path)}" alt="" style="display: block; width: 100%; height: 100%; object-fit: cover">` });
    if (!r.ok) { p.remove(); ctx.hint(`Could not make the frame: ${plain(r.error)}`); return null; }
    p.name(r.name);
    const sec = await adopt(r);
    p.remove();
    const body = sec && bodyOf(sec.docFrame.tree());
    if (body) ctx.select({ component: r.component, node: body.children[0]?.node ?? body.node, variant: {} });
    return r;
  }

  // ---- Inside an HTML frame: one insert into the element under the press -----------------------------------------------------
  // Into the body (or any positioned element) the new element is placed where it was drawn (position: absolute), as a frame in
  // Figma places its children; into any other container it joins the flow at the end. On text or an image it goes beside it.
  function spot(t, sx, sy) {
    const df = t.df, f = df.iframe(), doc = df.doc();
    if (!f || !doc) return null;
    const fr = f.getBoundingClientRect(), z = f.offsetWidth ? fr.width / f.offsetWidth : 1;
    const ix = (sx - fr.left) / z - f.clientLeft, iy = (sy - fr.top) / z - f.clientTop;
    let p = df.pick(sx, sy);
    let node = p && df.node(p.dataset.n);
    if (!node) { const root = df.tree()?.tree?.[0]; if (!root) return null; node = df.node(root.node); p = df.element(root.node); }
    let parentId = node.node, index = node.children.length, el = p?.el;
    const holds = (n) => n.children.length > 0 || (n.text === undefined && CONTAINERS.has(String(n.tag).toLowerCase()) && !VOID.has(n.tag));
    if (!holds(node)) {
      const up = node.node.includes('.') ? node.node.slice(0, node.node.lastIndexOf('.')) : null;
      const parent = up && df.node(up);
      if (!parent) return null;
      parentId = parent.node; index = parent.children.findIndex((x) => x.node === node.node) + 1; el = df.element(parent.node)?.el;
    }
    const tag = String(df.node(parentId)?.tag || '').toLowerCase();
    const win = doc.defaultView, cs = el && win.getComputedStyle(el);
    let at = null;
    if (cs && cs.position !== 'static') { const r = el.getBoundingClientRect(); at = { x: ix - r.left - el.clientLeft + el.scrollLeft, y: iy - r.top - el.clientTop + el.scrollTop }; }
    else if (tag === 'html' || tag === 'body') at = { x: ix + win.scrollX, y: iy + win.scrollY };
    return { parent: parentId, index, at: at && { x: Math.round(at.x), y: Math.round(at.y) }, id: `${parentId}.${index}` };
  }
  const placeCss = (s, w, h) => (s.at ? `position: absolute; left: ${s.at.x}px; top: ${s.at.y}px; ` : '') + (w ? `width: ${w}px; ` : '') + (h ? `height: ${h}px; ` : '');
  async function insert(t, s, html, summary, hold) {
    const c = ctx.state.components.get(t.id);
    const r = await post('/api/edit', { component: t.id, baseRevision: c?.revision, edits: [{ op: 'insert', parent: s.parent, index: s.index, html }], summary });
    if (!r.ok) { hold?.remove(); ctx.hint(`Could not add it: ${plain(r.error)}`); return null; }
    // the frame redraws on the change; the new element is selected as soon as it is there
    const sec = await until(() => { const x = ctx.stage.sections.get(t.id); return x?.el.dataset.revision === String(r.revision) && x.docFrame?.has(s.id) ? x : null; });
    hold?.remove();
    if (sec) ctx.select({ component: t.id, node: s.id, variant: {} });
    return r;
  }
  function holdBox(box) { // the drawn outline stays on the canvas until the element is drawn in its place
    const a = ctx.view.toWorld(box.left, box.top), z = zoom();
    const el = document.createElement('div'); el.className = 'nk-hold';
    Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${box.w / z}px`, height: `${box.h / z}px` });
    world.append(el); return el;
  }
  async function inFrame(tool, t, box, point) {
    const z = zoom();
    const s = spot(t, box ? box.left : point.x, box ? box.top : point.y);
    if (!s) { ctx.hint('Nothing here can hold a new element.'); return null; }
    if (tool === 'frame') {
      const [w, h] = box ? [Math.max(8, Math.round(box.w / z)), Math.max(8, Math.round(box.h / z))] : DEFAULT.nested;
      return insert(t, s, `<div style="${placeCss(s, w, h)}background: ${FILL}"></div>`, 'Added a frame', box && holdBox(box));
    }
    if (tool === 'text') {
      const w = box ? Math.max(MIN.w, Math.round(box.w / z)) : null;
      const a = ctx.view.toWorld(box ? box.left : point.x, box ? box.top : point.y);
      const ed = textEditor({ x: a.x, y: a.y, width: w });
      const { text, html } = await editUntilDone(ed);
      if (!text.trim()) { ed.remove(); return null; }
      // a click gives text that grows with what is typed (it never wraps against the frame's edge); a drag gives a fixed width
      return insert(t, s, `<p style="${placeCss(s, w, 0)}margin: 0; ${TEXT_FONT}${w ? '' : '; white-space: pre'}">${html}</p>`, 'Added text', ed);
    }
    const [w, h] = box ? [Math.max(8, Math.round(box.w / z)), Math.max(8, Math.round(box.h / z))] : DEFAULT.image;
    const hold = holdBox(box || { left: point.x, top: point.y, w: w * z, h: h * z }); hold.classList.add('nk-slot');
    const file = await pickFile();
    if (!file) { hold.remove(); return null; }
    const a = await upload(file);
    if (!a.ok) { hold.remove(); ctx.hint(`Could not add the picture: ${plain(a.error)}`); return null; }
    const depth = (t.id.match(/\//g) || []).length;
    return insert(t, s, `<img src="${esc('../'.repeat(depth) + a.path)}" alt="" style="${placeCss(s, w, h)}display: block; object-fit: cover">`, 'Added an image', hold);
  }

  // ---- what a press lands on --------------------------------------------------------------------------------------------
  function targetAt(ev) {
    const t = ev.target;
    if (t.closest?.('.cmp-head, [data-nodrag], button, input, textarea, select, a, summary, details, .cell-grip, .build-error, #hint, #error, .nk-new-text')) return null;
    const sec = t.closest?.('section.cmp');
    const id = sec?.dataset.component, c = id && ctx.state.components.get(id);
    if (!sec || !c) return { kind: 'canvas' };
    if (!frameFile(c)) return { kind: 'canvas' }; // a card napkin cannot insert into (a picture, a TSX file drawn as it is): a new frame goes on top
    if (c.readOnly) { ctx.hint(`${c.name} is read-only, so nothing can be added to it here.`); return null; }
    const df = ctx.stage.sections.get(id)?.docFrame;
    return df?.iframe() ? { kind: 'doc', id, df } : null;
  }

  // ---- a finished gesture: box (screen px, from tools.js) or a click point ------------------------------------------------
  function make({ tool, target, box, point, centred = false }) {
    ctx.view.hold?.(); // the view stays put: the new card is where it was drawn, on screen
    if (target.kind === 'doc') return inFrame(tool, target, box, point);
    const z = zoom();
    const at = box ? ctx.view.toWorld(box.left, box.top) : ctx.view.toWorld(point.x, point.y);
    if (tool === 'text') {
      const width = box ? Math.max(MIN.w, Math.round(box.w / z)) : null;
      return canvasText({ x: Math.round(at.x - (centred ? 40 : 0)), y: Math.round(at.y - (centred ? 12 : 0)), width });
    }
    let [w, h] = box ? [Math.round(box.w / z), Math.round(box.h / z)] : tool === 'image' ? DEFAULT.image : DEFAULT.frame;
    w = Math.max(MIN.w, w); h = Math.max(MIN.h, h);
    const x = Math.round(at.x - (centred ? w / 2 : 0)), y = Math.round(at.y - (centred ? h / 2 : 0));
    return tool === 'image' ? canvasImage({ x, y, w, h }) : newFrame({ x, y, w, h });
  }
  // The keyboard path: F (or T, I) then Enter makes the default one in the middle of the view.
  function atCentre(tool) {
    const b = ctx.view.stageBox();
    return make({ tool, target: { kind: 'canvas' }, point: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, centred: true });
  }

  // ---- rename: the label is the file name; double-click it (or the layers row) to rename the file --------------------------
  function check(id, to) {
    const name = String(to ?? '').trim().replace(/\.html?$/i, '');
    if (!name) return { error: 'Type a name.' };
    if (!/^[A-Za-z0-9_][A-Za-z0-9 ._-]{0,99}$/.test(name)) return { error: 'Use letters, digits, spaces, dots, dashes or underscores.' };
    const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/') + 1) : '';
    const path = `${dir}${name}.html`;
    if (path.toLowerCase() === id.toLowerCase()) return { same: true, name };
    if (paths().has(path.toLowerCase())) return { error: `${name}.html is already in this folder.` };
    return { name };
  }
  async function rename(id, to) {
    const k = check(id, to);
    if (k.error) return { ok: false, error: plain(k.error) };
    if (k.same) return { ok: true, noop: true, component: id };
    const r = await post('/api/frames/rename', { from: id, to: k.name });
    if (!r.ok) return { ok: false, error: plain(r.error) };
    await swap(id, r.component);
    return r;
  }
  // A renamed file keeps its card where it is: the old card stays on screen until the new one is drawn, then goes.
  const swapping = new Set();
  async function swap(from, to) {
    const c = ctx.state.components.get(from);
    if (!c || ctx.state.components.has(to) || swapping.has(from)) return;
    swapping.add(from);
    const old = ctx.stage.sections.get(from), pos = old?.pos ?? c.canvas;
    const sels = ctx.state.selections.map((s) => (s.component === from ? { ...s, component: to } : s));
    // the old card's element is kept out of the stage's hands until the new card covers it
    let keep = null;
    if (old) { keep = old.el; keep.removeAttribute('data-component'); keep.dataset.leaving = '1'; const h3 = keep.querySelector('h3'); if (h3) h3.textContent = nameOf(to); old.el = document.createElement('section'); old.docFrame = null; }
    ctx.state.components.delete(from);
    ctx.state.components.set(to, { ...c, component: to, path: to, name: nameOf(to), canvas: pos ? { x: pos.x, y: pos.y } : c.canvas });
    ctx.stage.remove(from);
    ctx.emit('removed', { component: from });
    ctx.emit('added', { component: to });
    ctx.stage.render(to).catch(console.error);
    if (pos) ctx.stage.moveTo(to, pos.x, pos.y);
    if (sels.some((s) => s.component === to)) ctx.selectMany(sels);
    await until(() => ctx.stage.sections.get(to)?.el.dataset.ready === '1');
    keep?.remove();
    swapping.delete(from);
    if (sels.some((s) => s.component === to)) ctx.selectMany(sels);
  }
  ctx.on('doc-renamed', (f) => { if (f.from && f.to) swap(f.from, f.to); }); // an undo, a redo, another window, an agent

  // In place on the canvas: the label becomes a field with the name selected. Enter commits, Escape cancels, a click away commits.
  // Any other card (a TSX component) renames through the same field: opts { name, check(to), rename(to) } say how.
  function startRename(id, opts = null) {
    const c = ctx.state.components.get(id);
    const sec = ctx.stage.sections.get(id);
    if (!(opts || frameFile(c)) || !sec || c.readOnly) return false;
    const h3 = sec.el.querySelector('.cmp-title h3');
    if (!h3 || sec.el.querySelector('.nk-rename')) return false;
    const was = opts?.name ?? nameOf(id), checkTo = opts?.check ?? ((to) => check(id, to)), renameTo = opts?.rename ?? ((to) => rename(id, to));
    const input = document.createElement('input');
    input.className = 'nk-rename'; input.value = was; input.spellcheck = false; input.dataset.nodrag = '1';
    input.setAttribute('aria-label', `Rename ${was}`);
    const msg = document.createElement('span'); msg.className = 'nk-rename-msg'; msg.setAttribute('role', 'alert'); msg.hidden = true;
    const fit = () => { input.style.width = `${Math.max(4, input.value.length + 2)}ch`; };
    fit(); h3.hidden = true; h3.after(input, msg);
    input.focus(); input.select();
    let done = false;
    const close = () => { done = true; input.remove(); msg.remove(); h3.hidden = false; };
    const commit = async (fromBlur) => {
      if (done) return;
      const k = checkTo(input.value);
      if (k.same) { close(); return; }
      if (k.error) { if (fromBlur) { close(); ctx.hint(plain(k.error)); return; } msg.textContent = k.error; msg.hidden = false; input.focus(); return; }
      done = true; h3.textContent = k.name; input.disabled = true;
      const r = await renameTo(k.name);
      input.remove(); msg.remove(); h3.hidden = false;
      if (!r.ok) { h3.textContent = was; if (!fromBlur) startRename(id, opts)?.error?.(r.error); else ctx.hint(plain(r.error)); }
    };
    input.addEventListener('input', () => { fit(); msg.hidden = true; });
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(false); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    });
    input.addEventListener('blur', () => { if (!done) commit(true); });
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    return { input, error: (text) => { msg.textContent = text; msg.hidden = false; } };
  }
  document.querySelector('#stage').addEventListener('dblclick', (ev) => {
    const head = ev.target.closest?.('section.cmp .cmp-head');
    if (!head || ev.target.closest('input')) return;
    const id = head.closest('section.cmp').dataset.component;
    if (!frameFile(ctx.state.components.get(id))) return;
    ev.preventDefault(); ev.stopPropagation();
    startRename(id);
  }, true);

  const api = { targetAt, make, atCentre, rename, startRename, check, isFrameFile: frameFile, adopt, bodyOf, editing: () => !!editing, finish: () => editing?.finish() };
  ctx.create = api;
  return api;
}
