// Structure edits from the keyboard and the clipboard (LAY-09, LAY-10). Everything goes through ctx.sendEdits: one batch, one revision.
//   Ctrl/Cmd+D duplicate · Ctrl/Cmd+Alt+G wrap in frame · Ctrl/Cmd+Shift+G unwrap · copy / cut / paste events
//   Paste: nodes copied from napkin (any component, fresh ids), an image file or SVG (stored in assets/ by content hash), an HTML snippet
//   (dialect nodes if it fits exactly, else refused with the reason), or a line of text.
//   ctx.ops = { duplicate, wrap, unwrap, copy(event?), paste(clipboardData), hide, last }  (`last` is the result of the latest paste, for tests)
import { index, VOID } from '/src/model.js';
import { htmlToNodes } from '/src/html-import.js';
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
    const r = await ctx.sendEdits(k.s.component, k.ids.map((id) => ({ op: 'duplicate', id })));
    if (r.ok) { const added = newIds(k.doc, r.doc), after = index(r.doc); select(k.s.component, added.filter((id) => !added.includes(after.parentOf.get(id)?.id))); }
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
    const res = await ctx.fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, data: b64(bytes) }) });
    const a = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
    if (!res.ok || !a.ok) { ops.last = { ok: false, kind: 'image', reason: a.error }; say(`Not pasted: ${a.error}`); return a; }
    const [w, h] = await natural(type, bytes, a.src);
    return insert(t, [{ id: 'image', tag: 'img', attrs: { src: a.src, alt: '' }, style: { display: 'block', width: w, height: h }, children: [] }], null, 'image');
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
  async function paste(data) {
    const t = target();
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
      const r = htmlToNodes(html);
      if (!r.ok) { ops.last = { ok: false, kind: 'html', reason: r.reason }; say(`Not pasted: ${r.reason}`); return null; }
      return insert(t, r.trees, null, 'html');
    }
    if (plain.trim() && !/\n/.test(plain.trim()) && plain.length <= 500) return insert(t, [{ id: 'text', tag: 'span', text: plain.trim(), style: {}, children: [] }], null, 'text');
    return null;
  }

  document.addEventListener('copy', (ev) => { if (!typing(ev.target)) copy(ev); });
  document.addEventListener('cut', async (ev) => {
    if (typing(ev.target) || !copy(ev)) return;
    const k = picked();
    if (k?.ids.length) await ctx.sendEdits(k.s.component, k.ids.map((id) => ({ op: 'delete', id })));
  });
  document.addEventListener('paste', (ev) => { if (typing(ev.target) || !ev.clipboardData) return; ev.preventDefault(); paste(ev.clipboardData).catch((e) => say(String(e.message || e))); });
  document.addEventListener('keydown', (ev) => {
    if (typing(ev.target) || ev.defaultPrevented || ev.isComposing) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const key = ev.key.toLowerCase();
    if (key === 'd' && !ev.altKey && !ev.shiftKey) { ev.preventDefault(); duplicate(); }
    else if (key === 'g' && ev.altKey && !ev.shiftKey) { ev.preventDefault(); wrap(); }
    else if (key === 'g' && ev.shiftKey && !ev.altKey) { ev.preventDefault(); unwrap(); }
  });
  Object.assign(ops, { duplicate, wrap, unwrap, hide, copy, paste, payload });
  ctx.ops = ops;
  return ops;
}
