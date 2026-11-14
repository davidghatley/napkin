// Structure edits from the keyboard and the clipboard (LAY-09, LAY-10). Everything goes through ctx.sendEdits: one batch, one revision.
//   Ctrl/Cmd+D duplicate · Ctrl/Cmd+Alt+G wrap in frame · Ctrl/Cmd+Shift+G unwrap · copy / cut / paste events
//   Paste: nodes copied from napkin (any component, fresh ids), an image file or SVG (stored in assets/ by content hash), an HTML snippet
//   (dialect nodes if it fits exactly, else refused with the reason), or a line of text.
//   ctx.ops = { duplicate, wrap, unwrap, copy(event?), paste(clipboardData), hide, last }  (`last` is the result of the latest paste, for tests)
// The same verbs for the menus and the palette (context-menu.js, actions.js), on both engines: the TSX dialect (ctx.sendEdits) and the
// document engine's HTML and React files (POST /api/edit, one batch, one undo step):
//   ctx.ops.can(verb) -> true | the reason it is off now | null (it can never apply to this selection)
//   ctx.ops.{ remove, order(forward|backward|front|back), selectParent, selectChildren, selectAll, copyNow, cutNow, pasteNow, isFrame }
// A frame (a file's card, or its root: the dialect's root layer, an HTML file's <html> or <body>) is the file as a whole: Copy
// takes what it holds, Duplicate, Rename and Delete act on the file (file-ops.js; a TSX component's own dialogs, component-ops.js).
// Every Delete, Cut and Duplicate is one history step that knows the selection before it and after it: Undo puts back the one
// before, Redo the one after (by identity at that revision, so a positional id that now names another element is never picked).
import { plain, SANS } from './words.js';
import { index, VOID } from '/src/model.js';
import { pasteHtml } from './html-paste.js';
import { isFlex } from '/src/layout.js';

const MIME = 'application/x-napkin+json';
const PREFIX = 'napkin/1 ';
const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };

export function initEditOps(ctx) {
  const ops = { last: null };
  const say = (t) => ctx.hint(t);
  const cur = () => { const s = ctx.state.selection, c = s && ctx.state.components.get(s.component); return c?.doc && !c.readOnly ? { s, c, doc: c.doc, ...index(c.doc) } : null; };
  // the selected nodes, minus the root and any node whose ancestor is selected too
  function picked({ root = false } = {}) {
    const k = cur();
    if (!k) return null;
    const all = new Set(ctx.state.selections.filter((x) => x.component === k.s.component && (root || x.node !== k.doc.root.id)).map((x) => x.node));
    const under = (id) => { for (let p = k.parentOf.get(id); p; p = k.parentOf.get(p.id)) if (all.has(p.id)) return true; return false; };
    const ids = [...all].filter((id) => !under(id));
    return { ...k, ids };
  }
  const select = (component, ids, variant) => ctx.selectMany(ids.map((node) => ({ component, node, variant: variant ?? ctx.state.selection?.variant ?? {} })));
  const newIds = (before, after) => { const a = new Set([...index(before).byId.keys()]); return [...index(after).byId.keys()].filter((id) => !a.has(id)); };

  async function duplicate() {
    const k = picked();
    if (!k?.ids.length) return say('Select something to duplicate (the root can’t be duplicated)');
    const sels = [...ctx.state.selections], before = k.c.revision;
    const r = await ctx.sendEdits(k.s.component, k.ids.map((id) => ({ op: 'duplicate', id })));
    if (r.ok) { const added = newIds(k.doc, r.doc), after = index(r.doc); select(k.s.component, added.filter((id) => !added.includes(after.parentOf.get(id)?.id))); remember(k.s.component, before, r, sels, [...ctx.state.selections]); }
    return r;
  }
  async function wrap() {
    const k = picked();
    if (!k?.ids.length) return say('Select what to wrap in a frame');
    const parents = new Set(k.ids.map((id) => k.parentOf.get(id)?.id));
    if (parents.size !== 1) return say('Wrap needs layers that share one parent');
    const parent = k.parentOf.get(k.ids[0]);
    let n = 1; while (k.byId.has(`frame${n}`)) n++;
    const id = `frame${n}`;
    const style = isFlex(parent.style) ? { display: 'flex', ...(parent.style.flexDirection && { flexDirection: parent.style.flexDirection }), ...(parent.style.gap !== undefined && { gap: parent.style.gap }), ...(parent.style.alignItems && { alignItems: parent.style.alignItems }) } : {};
    const r = await ctx.sendEdits(k.s.component, [{ op: 'wrap', ids: k.ids, id, style }]);
    if (r.ok) select(k.s.component, [id]);
    return r;
  }
  async function unwrap() {
    const k = picked();
    if (!k || k.ids.length !== 1) return say('Select one frame to unwrap');
    const n = k.byId.get(k.ids[0]);
    if (!n.children.length) return say('Only a frame with layers inside can be unwrapped');
    const r = await ctx.sendEdits(k.s.component, [{ op: 'unwrap', id: n.id }]);
    if (r.ok) select(k.s.component, n.children.map((c) => c.id));
    return r;
  }
  async function hide() {
    const k = picked();
    if (!k?.ids.length) return;
    const all = k.ids.every((id) => k.byId.get(id).style?.visibility === 'hidden');
    return ctx.sendEdits(k.s.component, k.ids.map((id) => ({ op: 'set', path: `${id}.visibility`, value: all ? null : 'hidden' })));
  }

  // ---- copy: the selected subtrees, with the variant overrides they carry ----
  function payload() {
    const k = picked({ root: true });
    if (!k?.ids.length) return null;
    const doc = k.doc;
    const bake = (n) => ({ id: n.id, tag: n.tag, style: { ...n.style }, ...(n.text !== undefined ? { text: n.text } : {}), ...(n.textProp ? { text: doc.props.find((p) => p.name === n.textProp)?.default ?? '', textProp: n.textProp } : {}), ...(n.attrs ? { attrs: { ...n.attrs } } : {}), children: n.children.map(bake) });
    const trees = k.ids.map((id) => bake(k.byId.get(id)));
    const ids = new Set(trees.flatMap(function flat(t) { return [t.id, ...t.children.flatMap(flat)]; }));
    const variants = {};
    for (const [axis, vals] of Object.entries(doc.variants)) for (const [val, nodes] of Object.entries(vals)) for (const [id, st] of Object.entries(nodes)) if (ids.has(id)) ((variants[axis] ??= {})[val] ??= {})[id] = { ...st };
    return { napkin: 1, from: doc.name, trees, variants, axes: doc.props.filter((p) => p.type === 'enum').map((p) => ({ name: p.name, options: p.options })) };
  }
  function copy(ev) {
    const p = payload();
    if (!p) return false;
    const text = JSON.stringify(p);
    if (ev?.clipboardData) { ev.clipboardData.setData(MIME, text); ev.clipboardData.setData('text/plain', PREFIX + text); ev.preventDefault(); }
    ops.clip = p;
    return true;
  }

  // ---- paste ----
  function target() {
    const k = cur() ?? (() => { const all = [...ctx.state.components.values()].filter((c) => c.doc && !c.readOnly); if (all.length !== 1) return null; const c = all[0]; return { s: { component: c.component, node: c.doc.root.id, variant: {} }, c, doc: c.doc, ...index(c.doc) }; })();
    if (!k) return null;
    const n = k.byId.get(k.s.node);
    const holds = (x) => x.text === undefined && !x.textProp && !VOID.has(x.tag);
    if (holds(n)) return { ...k, parent: n.id, index: undefined };
    const par = k.parentOf.get(n.id);
    return { ...k, parent: par.id, index: par.children.indexOf(n) + 1 };
  }
  async function insert(t, trees, variants, kind) {
    const edits = trees.map((tree, i) => ({ op: 'paste', parent: t.parent, ...(t.index !== undefined && { index: t.index + i }), tree, ...(variants && { variants }) }));
    const r = await ctx.sendEdits(t.s.component, edits);
    ops.last = { ok: r.ok, kind, ...(r.ok ? {} : { reason: r.error }) };
    if (r.ok) { const added = newIds(t.doc, r.doc); const tops = added.filter((id) => !added.includes(index(r.doc).parentOf.get(id)?.id)); select(t.s.component, tops, t.s.variant); }
    return r;
  }
  async function pasteImage(t, type, bytes) {
    const res = await ctx.fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ext: type === 'image/svg+xml' ? 'svg' : 'png', data: b64(bytes) }) });
    const a = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
    if (!res.ok || !a.ok) { ops.last = { ok: false, kind: 'image', reason: a.error }; say(`Not pasted: ${plain(a.error)}`); return a; }
    const [w, h] = await natural(type, bytes, a.path);
    return insert(t, [{ id: 'image', tag: 'img', attrs: { src: a.path, alt: '' }, style: { display: 'block', width: w, height: h }, children: [] }], null, 'image');
  }
  function natural(type, bytes, src) {
    const fit = (w, h) => { const k = Math.min(1, 320 / Math.max(w, h, 1)); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; };
    if (type === 'image/svg+xml') {
      const t = new TextDecoder().decode(bytes);
      const w = /<svg[^>]*\swidth="([\d.]+)/.exec(t)?.[1], h = /<svg[^>]*\sheight="([\d.]+)/.exec(t)?.[1], vb = /viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(t);
      return Promise.resolve(fit(Number(w ?? vb?.[1] ?? 120), Number(h ?? vb?.[2] ?? 120)));
    }
    return new Promise((res) => { const i = new Image(); i.onload = () => res(fit(i.naturalWidth, i.naturalHeight)); i.onerror = () => res([120, 120]); i.src = '/' + src; });
  }
  async function paste(data, dest) {
    const t = dest ?? target();
    if (!t) { say('Select a layer to paste into'); return null; }
    const mine = data.getData?.(MIME) || (data.getData?.('text/plain') || '').startsWith(PREFIX) && data.getData('text/plain').slice(PREFIX.length);
    if (mine) {
      let p; try { p = JSON.parse(mine); } catch { p = null; }
      if (p?.napkin === 1) return insert(t, p.trees, p.variants, 'nodes');
    }
    for (const f of [...(data.files ?? [])]) {
      if (f.type === 'image/png' || f.type === 'image/svg+xml') return pasteImage(t, f.type, await f.arrayBuffer());
      if (/^image\//.test(f.type)) { ops.last = { ok: false, kind: 'image', reason: `${f.type} is not supported; paste a PNG or an SVG` }; say(`Not pasted: ${ops.last.reason}`); return null; }
    }
    const plain = data.getData?.('text/plain') ?? '';
    if (/^\s*<svg[\s>]/i.test(plain)) return pasteImage(t, 'image/svg+xml', new TextEncoder().encode(plain));
    const html = data.getData?.('text/html');
    if (html) {
      const comp = ctx.state.components.get(t.s.component), at = t.index ?? t.byId.get(t.parent).children.length;
      // the check runs against the real target (its inherited style, display and width) and against the file text the store would write
      const r = await pasteHtml(html, {
        context: ctx.stage.cellElement(t.s.component, t.parent, t.s.variant),
        checking: () => say('Checking paste…'),
        written: async (trees) => {
          const res = await ctx.fetch(`/api/components/${encodeURIComponent(t.s.component)}/edits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: comp.revision, dryRun: true, edits: trees.map((tree, i) => ({ op: 'paste', parent: t.parent, index: at + i, tree })) }) });
          const j = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
          if (!j.ok) return { ok: false, reason: j.error };
          const parent = index(j.written).byId.get(t.parent);
          return { ok: true, trees: parent.children.slice(at, at + trees.length) };
        },
      });
      if (!r.ok) { ops.last = { ok: false, kind: 'html', reason: r.reason }; say(`Not pasted: ${r.reason}`); return null; }
      return insert(t, r.trees, null, 'html');
    }
    if (plain.trim() && !/\n/.test(plain.trim()) && plain.length <= 500) return insert(t, [{ id: 'text', tag: 'span', text: plain.trim(), style: { fontFamily: SANS }, children: [] }], null, 'text');
    return null;
  }

  document.addEventListener('copy', (ev) => { if (!typing(ev.target)) copy(ev); });
  document.addEventListener('cut', async (ev) => {
    if (typing(ev.target) || !copy(ev)) return;
    const k = picked();
    if (k?.ids.length) { const sels = [...ctx.state.selections], before = k.c.revision, r = await ctx.sendEdits(k.s.component, k.ids.map((id) => ({ op: 'delete', id }))); remember(k.s.component, before, r, sels); if (r.ok) clearIf(sels); }
  });
  document.addEventListener('paste', (ev) => { if (typing(ev.target) || !ev.clipboardData) return; ev.preventDefault(); paste(ev.clipboardData).catch((e) => say(plain(e.message || e))); });
  document.addEventListener('keydown', (ev) => {
    if (typing(ev.target) || ev.defaultPrevented || ev.isComposing) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const key = ev.key.toLowerCase();
    if (key === 'd' && !ev.altKey && !ev.shiftKey) { ev.preventDefault(); ops.duplicate(); }
    else if (key === 'g' && ev.altKey && !ev.shiftKey) { ev.preventDefault(); wrap(); }
    else if (key === 'g' && ev.shiftKey && !ev.altKey) { ev.preventDefault(); unwrap(); }
  });
  // ---- the document engine (HTML, and React files the engine draws): its tree comes from the frame (doc-frames.js) ----
  const SKIP = new Set(['script', 'style', 'template', 'link', 'meta', 'title', 'head', 'base', 'noscript']);
  const TOP = new Set(['html', 'body', 'head']);
  const isReact = (c) => c.fileKind === 'tsx' || c.fileKind === 'jsx';
  function eng() {
    const s = ctx.state.selection, c = s && ctx.state.components.get(s.component);
    if (!c || c.item || c.doc || c.kind !== 'html') return null;
    const f = ctx.stage?.sections.get(s.component)?.docFrame, tree = f?.tree()?.tree;
    if (!tree) return null;
    const find = (id) => { const walk = (list, up) => { for (const n of list) { if (n.node === id) return { n, parent: up }; const r = walk(n.children, n); if (r) return r; } return null; }; return walk(tree, null); };
    const sels = ctx.state.selections.filter((x) => x.component === s.component);
    // the selected elements, minus any whose ancestor is selected too (it goes with it)
    const all = new Set(sels.map((x) => x.node));
    const ids = [...all].filter((id) => { for (let p = find(id)?.parent; p; p = find(p.node)?.parent) if (all.has(p.node)) return false; return true; });
    return { s, c, f, tree, find, ids, at: find(s.node), base: c.revision };
  }
  const visible = (list) => list.filter((n) => !SKIP.has(n.tag));
  async function engEdit(c, edits, summary, base = c.revision) {
    const r = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: c.component, baseRevision: base, edits, summary }) });
    const j = await r.json().catch(() => ({ ok: false, error: `server answered ${r.status}` }));
    if (!j.ok) say(`Not done: ${plain(j.error)}`);
    return j;
  }
  // after an engine edit, the frame draws the new revision; a selection made before that would point at the old tree
  async function drawn(e, revision, nodes) {
    for (let i = 0; i < 160; i++) { const t = e.f.tree(); if ((!revision || t?.revision === revision) && nodes.every((n) => e.f.has(n))) return true; await new Promise((r) => setTimeout(r, 25)); }
    return false;
  }
  const kind = () => { const s = ctx.state.selection, c = s && ctx.state.components.get(s.component); return !c ? null : c.item ? 'item' : c.doc ? 'dialect' : c.kind === 'html' ? 'engine' : null; };

  // A frame: the file as a whole (its card, or its root).
  function isFrame(s = ctx.state.selection) {
    const c = s && ctx.state.components.get(s.component);
    if (!c || c.item) return false;
    if (s.card) return true;
    if (c.doc) return s.node === c.doc.root.id;
    return TOP.has(ctx.stage?.sections.get(s.component)?.docFrame?.node?.(s.node)?.tag);
  }
  const oneFrame = () => ctx.state.selections.length === 1 && isFrame();
  const htmlFile = (c) => c?.kind === 'html' && !c.doc && c.fileKind === 'html';

  // What each verb can do with the selection now. A reason is shown on the disabled menu item.
  function can(verb) {
    const k = kind(), c = k && ctx.state.components.get(ctx.state.selection.component);
    if (!k) return verb === 'paste' ? 'Select a frame or an element to paste into' : 'Select something first';
    if (k === 'item') return null;
    if (c.readOnly) return `${c.name} is read-only`;
    const many = ctx.state.selections.length > 1;
    if (oneFrame()) {
      const react = k === 'engine' && !htmlFile(c);
      switch (verb) {
        case 'copy': return k === 'dialect' || ctx.copyCode?.picks().length ? true : 'Nothing in this frame to copy yet';
        case 'paste': return k === 'dialect' ? (target() ? true : 'Select a layer to paste into') : true;
        case 'duplicate': return react ? 'Duplicate a React file in your editor for now' : k === 'dialect' ? 'Duplicating a TSX component comes in the next pass: copy its file in your editor' : true;
        case 'delete': case 'rename-file': return react ? `${verb === 'delete' ? 'Delete' : 'Rename'} a React file in your editor for now` : true;
        case 'cut': return null; // a frame is its file: Copy, then Delete
      }
    }
    if (k === 'dialect') {
      const p = picked(), n = p && p.byId.get(p.s.node), par = n && p.parentOf.get(n.id);
      switch (verb) {
        case 'copy': return picked({ root: true })?.ids.length ? true : 'Select a layer first';
        case 'cut': case 'delete': case 'duplicate': return p?.ids.length ? true : 'The root of a component stays';
        case 'paste': return target() ? true : 'Select a layer to paste into';
        case 'wrap': return !p?.ids.length ? 'The root of a component stays' : new Set(p.ids.map((id) => p.parentOf.get(id)?.id)).size === 1 ? true : 'Wrap needs layers that share one parent';
        case 'rename': return many ? 'Select one layer to rename' : true;
        case 'parent': return par ? true : 'This is the top of the component';
        case 'children': return n?.children.length ? true : 'Nothing inside this layer';
        case 'forward': case 'front': return many ? 'Select one layer to reorder' : !par ? 'The root has no siblings' : par.children.at(-1) === n ? 'Already in front of its siblings' : true;
        case 'backward': case 'back': return many ? 'Select one layer to reorder' : !par ? 'The root has no siblings' : par.children[0] === n ? 'Already behind its siblings' : true;
      }
      return null;
    }
    const e = eng();
    if (!e?.at) return 'The frame is still loading';
    const n = e.at.n, top = TOP.has(n.tag) || !e.at.parent, card = !!e.s.card, par = e.at.parent && !TOP.has(e.at.parent.tag) ? e.at.parent : null;
    const sibs = e.at.parent ? visible(e.at.parent.children) : visible(e.tree);
    switch (verb) {
      case 'copy': case 'cut': case 'delete': case 'duplicate': return card ? 'A frame is its file: select an element inside it' : top ? 'Select an element inside the frame' : true;
      case 'paste': return true;
      case 'wrap': return 'Not yet for HTML elements: coming in the next pass';
      case 'rename': return null; // an HTML element is named by its id and class (the panel edits those)
      case 'parent': return par ? true : 'This element is at the top of the file';
      case 'children': return visible(n.children).length ? true : 'Nothing inside this element';
      case 'forward': case 'front': return card ? null : many ? 'Select one element to reorder' : top ? 'The top element has no siblings' : sibs.at(-1) === n ? 'Already in front of its siblings' : true;
      case 'backward': case 'back': return card ? null : many ? 'Select one element to reorder' : top ? 'The top element has no siblings' : sibs[0] === n ? 'Already behind its siblings' : true;
    }
    return null;
  }
  const refuse = (verb) => { const r = can(verb); if (r === true) return false; say(r || 'Not for this selection'); return true; };

  // The selection each step of ours had before and after it, oldest first; `undone` marks the steps Redo can bring back.
  const steps = []; // { component, before, after, selsBefore, selsAfter, undone }
  const copySels = (list) => list.map((x) => ({ ...x }));
  function remember(component, before, r, selsBefore, selsAfter = []) {
    if (!r?.ok) return;
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].component === component && steps[i].undone) steps.splice(i, 1); // a new step ends that redo line
    steps.push({ component, before, after: r.revision, selsBefore: copySels(selsBefore), selsAfter: copySels(selsAfter), undone: false });
    if (steps.length > 200) steps.shift();
  }
  // after the step: the selection clears only when it is still what the step acted on (a later click picked something else: it stays)
  const sameSels = (a, b) => a.length === b.length && a.every((x) => b.some((y) => y.component === x.component && y.node === x.node));
  function clearIf(sels) { if (sameSels(ctx.state.selections, sels)) ctx.select(null); }
  // select `sels` once the frame (or the dialect doc) shows `revision` and holds them
  async function putBack(component, revision, sels) {
    const f = ctx.stage?.sections.get(component)?.docFrame;
    for (let i = 0; i < 160; i++) {
      const c = ctx.state.components.get(component);
      const there = f ? f.tree()?.revision === revision && sels.every((x) => f.has(x.node)) : !sels.length || (c?.doc && sels.every((x) => index(c.doc).byId.has(x.node)));
      if (there) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    if (sels.length) ctx.selectMany(sels); else ctx.select(null);
  }
  ctx.on('undone', (u) => {
    const i = steps.findLastIndex((x) => x.component === u.component && !x.undone), st = steps[i];
    if (!st || (u.revision !== st.before && u.undone?.revision !== st.after)) return; // the step undone is not one of ours
    st.undone = true;
    putBack(st.component, u.revision, st.selsBefore);
  });
  ctx.on('redone', (u) => {
    const i = steps.findIndex((x) => x.component === u.component && x.undone), st = steps[i];
    if (!st || (u.revision !== st.after && u.redone?.revision !== st.after)) return;
    st.undone = false;
    putBack(st.component, u.revision, st.selsAfter);
  });
  async function remove() {
    if (oneFrame()) {
      if (refuse('delete')) return null;
      const id = ctx.state.selection.component;
      return kind() === 'dialect' ? ctx.cmpOps?.remove(id) : ctx.fileOps?.remove(id);
    }
    const sels = [...ctx.state.selections];
    if (kind() === 'dialect') {
      const k = picked();
      if (!k?.ids.length) return say('Select something to delete (the root of a component stays)');
      const before = k.c.revision, r = await ctx.sendEdits(k.s.component, k.ids.map((id) => ({ op: 'delete', id })));
      remember(k.s.component, before, r, sels);
      if (r.ok) clearIf(sels);
      return r;
    }
    if (refuse('delete')) return null;
    return engRemove(eng(), sels);
  }
  // the elements of `e` (taken when the command started) and its revision then: exactly those go, whatever is selected by now
  async function engRemove(e, sels) {
    const j = await engEdit(e.c, e.ids.map((node) => ({ op: 'delete', node })), e.ids.length > 1 ? `Deleted ${e.ids.length} elements` : `Deleted <${e.at.n.tag}>`, e.base);
    remember(e.c.component, e.base, j, sels);
    if (j.ok) clearIf(sels);
    return j;
  }
  async function frameDuplicate() {
    if (refuse('duplicate')) return null;
    return ctx.fileOps?.duplicate(ctx.state.selection.component);
  }
  async function engDuplicate() {
    if (refuse('duplicate')) return null;
    const e = eng(), sels = [...ctx.state.selections];
    const src = await Promise.all(e.ids.map((node) => fetch(`/api/component/${encodeURIComponent(e.c.component)}/copy?node=${encodeURIComponent(node)}`).then((r) => r.json())));
    if (src.some((p) => !p.ok)) { say('Could not read the element to duplicate'); return null; }
    // each copy goes right after its original; the last in the file first, so the earlier places do not move
    const jobs = e.ids.map((node, i) => { const at = e.find(node); const list = at.parent ? at.parent.children : e.tree; return { parent: at.parent?.node, index: list.indexOf(at.n) + 1, code: src[i].source, path: (at.parent ? at.parent.node + '.' : '') }; })
      .sort((a, b) => (a.parent === b.parent ? b.index - a.index : 0));
    if (jobs.some((x) => x.parent === undefined)) { say('Select an element inside the frame'); return null; }
    const j = await engEdit(e.c, jobs.map((x) => ({ op: 'insert', parent: x.parent, index: x.index, [isReact(e.c) ? 'jsx' : 'html']: x.code })), jobs.length > 1 ? `Duplicated ${jobs.length} elements` : `Duplicated <${e.at.n.tag}>`, e.base);
    if (j.ok) {
      // the copies' places, counted after every insert of the batch
      const added = jobs.map((x) => x.path + (x.index + jobs.filter((y) => y.parent === x.parent && y.index < x.index).length));
      const copies = added.map((node) => ({ component: e.c.component, node, variant: {} }));
      remember(e.c.component, e.base, j, sels, copies);
      if (await drawn(e, j.revision, added)) ctx.selectMany(copies);
    }
    return j;
  }
  async function order(how) {
    if (refuse(how)) return null;
    if (kind() === 'dialect') {
      const k = picked({ root: true }), n = k.byId.get(k.s.node), par = k.parentOf.get(n.id), i = par.children.indexOf(n);
      const index = how === 'forward' ? i + 1 : how === 'backward' ? i - 1 : how === 'front' ? par.children.length - 1 : 0;
      return ctx.sendEdits(k.s.component, [{ op: 'move', id: n.id, parent: par.id, index }]);
    }
    const e = eng(), n = e.at.n, list = e.at.parent ? e.at.parent.children : e.tree, sibs = visible(list), i = sibs.indexOf(n);
    // the place among the visible siblings, turned into the file's index (a <style> or <script> between them stays where it is)
    const to = how === 'forward' ? sibs[i + 1] : how === 'backward' ? sibs[i - 1] : how === 'front' ? sibs.at(-1) : sibs[0];
    const rest = list.filter((x) => x !== n), index = rest.indexOf(to) + (how === 'forward' || how === 'front' ? 1 : 0);
    const j = await engEdit(e.c, [{ op: 'move', node: n.node, parent: e.at.parent.node, index }], `Moved <${n.tag}> ${how === 'front' ? 'to the front' : how === 'back' ? 'to the back' : how}`);
    if (j.ok) { const node = (e.at.parent ? e.at.parent.node + '.' : '') + index; if (await drawn(e, j.revision, [node])) ctx.select({ component: e.c.component, node, variant: {} }); }
    return j;
  }
  function selectParent() {
    if (refuse('parent')) return;
    if (kind() === 'dialect') { const k = picked({ root: true }); ctx.select({ ...k.s, node: k.parentOf.get(k.s.node).id }); return; }
    const e = eng(); ctx.select({ component: e.c.component, node: e.at.parent.node, variant: {} });
  }
  // Ctrl+A: every element beside the selected one (its scope); with a frame or nothing selected, every card.
  function selectAll() {
    const s = ctx.state.selection;
    if (!s || isFrame(s) || ctx.state.components.get(s.component)?.item) return ctx.surface?.selectAll();
    if (kind() === 'dialect') { const k = picked({ root: true }), par = k && k.parentOf.get(s.node); if (par) ctx.selectMany(par.children.map((x) => ({ ...s, node: x.id }))); return; }
    const e = eng(); if (!e?.at) return;
    const list = e.at.parent ? visible(e.at.parent.children) : visible(e.tree).filter((n) => !TOP.has(n.tag));
    ctx.selectMany(list.map((x) => ({ component: e.c.component, node: x.node, variant: {} })));
    ctx.hint(`${list.length} selected`);
  }
  function selectChildren() {
    if (refuse('children')) return;
    if (kind() === 'dialect') { const k = picked({ root: true }); ctx.selectMany(k.byId.get(k.s.node).children.map((x) => ({ ...k.s, node: x.id }))); return; }
    const e = eng(); ctx.selectMany(visible(e.at.n.children).map((x) => ({ component: e.c.component, node: x.node, variant: {} })));
  }

  // ---- the clipboard from a menu or the palette: the same copy and cut events the keys make, and a paste read from the clipboard ----
  function copyNow() {
    if (refuse('copy')) return false;
    let done = false; try { done = document.execCommand('copy'); } catch {}
    if (!done) { if (kind() === 'engine') ctx.copyCode?.copy(); else copy(); }
    return true;
  }
  // Cut: everything selected goes to the clipboard first (the copy event fills it from the whole selection), then exactly those go.
  async function cutNow() {
    if (refuse('cut')) return null;
    // the target and its revision are taken now, before the copy is awaited: a right-click meanwhile does not change what goes
    const sels = [...ctx.state.selections];
    if (kind() === 'engine') { const e = eng(); if (!(await ctx.copyCode?.copy())) return null; return engRemove(e, sels); } // (nothing goes unless the copy holds it)
    copyNow();
    const k = picked();
    if (!k?.ids.length) return null;
    const before = k.c.revision, r = await ctx.sendEdits(k.s.component, k.ids.map((id) => ({ op: 'delete', id })));
    remember(k.s.component, before, r, sels);
    if (r.ok) clearIf(sels);
    return r;
  }
  // The clipboard as a paste event would give it; napkin's own last copy when the page may not read the clipboard.
  async function readClipboard(engine = kind() === 'engine') {
    try {
      const items = await Promise.race([navigator.clipboard.read(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 10000))]);
      const text = {}, files = [];
      for (const it of items) for (const t of it.types) { const b = await it.getType(t); if (t.startsWith('text/')) text[t] = await b.text(); else if (/^image\//.test(t)) files.push(new File([b], 'pasted', { type: t })); }
      if (Object.keys(text).length || files.length) return { getData: (t) => text[t] ?? '', files };
    } catch {}
    if (engine && ctx.clip) return { getData: (t) => (t === 'text/plain' ? ctx.clip.text : t === 'text/html' ? ctx.clip.html : ''), files: [] };
    if (ops.clip) { const text = JSON.stringify(ops.clip); return { getData: (t) => (t === MIME ? text : t === 'text/plain' ? PREFIX + text : ''), files: [] }; }
    if (ctx.clip) return { getData: (t) => (t === 'text/plain' ? ctx.clip.text : t === 'text/html' ? ctx.clip.html : ''), files: [] };
    return null;
  }
  async function pasteNow() {
    if (refuse('paste')) return null;
    // the destination (component, node, tree and revision) is taken now, before the clipboard is read: a right-click meanwhile does not redirect the write
    const engine = kind() === 'engine', e = engine ? eng() : null, t = engine ? null : target();
    const cap = e && { s: { ...e.s }, c: e.c, tree: e.tree, base: e.base };
    const data = await readClipboard(engine);
    if (!data) { say(`Nothing to paste yet. Copy something first, or use ${'Ctrl/Cmd+V'}`); return null; }
    if (engine) {
      // onto a frame (its card): into the body; onto an element: into it, as the keys do
      const top = (function find(l) { for (const n of l) { if (n.tag === 'body') return n; const r = find(n.children); if (r) return r; } return null; })(e.tree) ?? e.tree.find((n) => n.tag === 'html');
      const into = isFrame(cap.s) ? (top?.node ?? e.at.parent?.node ?? null) : null;
      return ctx.copyCode?.paste(data.getData('text/plain'), data.getData('text/html'), into, cap);
    }
    return paste(data, t);
  }

  Object.assign(ops, { duplicate: async () => (oneFrame() ? frameDuplicate() : kind() === 'engine' ? engDuplicate() : duplicate()), wrap, unwrap, hide, copy, paste, payload, can, kind, remove, order, selectParent, selectChildren, selectAll, copyNow, cutNow, pasteNow, isFrame });
  ctx.ops = ops;
  return ops;
}
