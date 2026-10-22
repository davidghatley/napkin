// AST-01..03 on the page. Drop an image file on a node (or drag one from the Assets tab): an <img> takes it as its src, any other
// node gets a new <img> inside it. The server copies the bytes to assets/<sha8>.<ext> next to the components (the same bytes are
// stored once) and makes ONE edit. The Assets tab lists every image and SVG in the repo. A src that does not load shows a badge
// with its path on the cell; nothing else breaks.
import { plain } from './words.js';
import { h } from './drawer.js';
import { index } from '/src/model.js';

const MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const MIME_KEY = 'application/x-napkin-asset';

export function initAssets(ctx, drawer) {
  const stage = document.querySelector('#stage');
  let pane, grid, filter, count, assets = [];

  // ------------------------------------------------------------------------------------------- the tab
  async function load() {
    const r = await fetch('/api/assets').then((x) => x.json()).catch(() => null);
    assets = r?.ok ? r.assets : [];
    draw();
  }
  function draw() {
    if (!grid) return;
    const q = filter.value.trim().toLowerCase();
    const shown = assets.filter((a) => !q || a.path.toLowerCase().includes(q));
    count.textContent = `${shown.length} of ${assets.length} image${assets.length === 1 ? '' : 's'}`;
    grid.replaceChildren(...shown.map((a) => {
      const img = h('img', { src: `/api/assets/file?path=${encodeURIComponent(a.path)}`, alt: '', loading: 'lazy', draggable: 'false' });
      const li = h('li', { class: 'asset', draggable: 'true', tabindex: '0', 'data-path': a.path, title: `${a.path} (${kb(a.bytes)}). Drag onto the canvas.` },
        h('span', { class: 'a-thumb' }, img), h('span', { class: 'a-name', text: a.name }), h('span', { class: 'a-meta', text: `${a.ext} · ${kb(a.bytes)}` }), h('span', { class: 'a-dir', text: a.path.slice(0, -a.name.length).replace(/\/$/, '') || '.' }));
      li.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData(MIME_KEY, a.path); ev.dataTransfer.setData('text/plain', a.path); ev.dataTransfer.effectAllowed = 'copy'; document.body.dataset.dragging = 'asset'; });
      li.addEventListener('dragend', () => { delete document.body.dataset.dragging; });
      return li;
    }));
  }
  function build(p) {
    pane = p; pane.classList.add('assets');
    filter = h('input', { type: 'search', id: 'a-filter', placeholder: 'Filter images', 'aria-label': 'Filter images', oninput: draw });
    count = h('span', { class: 'a-count', id: 'a-count', role: 'status' });
    grid = h('ul', { id: 'a-grid', class: 'a-grid', 'aria-label': 'Images and SVGs in this repo' });
    pane.append(h('div', { class: 'a-bar' }, filter, count, h('button', { type: 'button', id: 'a-refresh', text: 'Refresh', onclick: load })), grid);
  }
  drawer.add('assets', 'Assets', { build, onOpen: load });

  // ------------------------------------------------------------------------------------------- dropping
  let target = null;
  const mark = (el) => { if (target === el) return; target?.classList.remove('drop-target'); target = el; target?.classList.add('drop-target'); };
  const nodeUnder = (ev) => ev.target.closest?.('.cell .mount [data-n]');
  const hasImage = (dt) => dt && ([...dt.types].includes(MIME_KEY) || [...(dt.items || [])].some((i) => i.kind === 'file' && (i.type === '' || MIME[i.type])));
  stage.addEventListener('dragover', (ev) => { if (!hasImage(ev.dataTransfer)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; mark(nodeUnder(ev) ?? null); });
  stage.addEventListener('dragleave', (ev) => { if (!stage.contains(ev.relatedTarget)) mark(null); });
  stage.addEventListener('drop', async (ev) => {
    if (!hasImage(ev.dataTransfer)) return;
    ev.preventDefault(); mark(null); delete document.body.dataset.dragging;
    const el = nodeUnder(ev), sec = el?.closest('section.cmp');
    if (!el || !sec) { ctx.hint('Drop the image on a node of a component'); return; }
    const component = sec.dataset.component, node = el.dataset.n, c = ctx.state.components.get(component);
    const path = ev.dataTransfer.getData(MIME_KEY);
    const file = [...ev.dataTransfer.files].find((f) => MIME[f.type] || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f.name));
    const body = {};
    if (path) body.from = path;
    else if (file) { body.data = b64(await file.arrayBuffer()); body.ext = MIME[file.type] || file.name.split('.').pop(); }
    else { ctx.hint('That is not an image napkin can store'); return; }
    // an img takes the image as its src; a node that holds text (or is another void tag) cannot hold an img, so its parent does
    const doc = c?.doc, n = doc && index(doc).byId.get(node);
    if (n?.tag === 'img') body.node = node;
    else if (n && (n.text !== undefined || n.textProp)) body.into = index(doc).parentOf.get(node)?.id ?? doc.root.id;
    else body.into = node;
    await place(component, body);
  });
  async function place(component, body) {
    const r = await ctx.fetch(`/api/components/${encodeURIComponent(component)}/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, error: `image failed (${r.status})` }));
    ctx.hint(j.ok ? `${j.created ? 'Added' : 'Already stored:'} ${j.path}` : `Can't place the image: ${plain(j.error)}`);
    if (j.ok && drawer.active === 'assets') load();
    return j;
  }

  // ------------------------------------------------------------------------------------------- missing assets
  function scan(root = document) {
    for (const cell of (root.matches?.('.cell') ? [root] : root.querySelectorAll('.cell'))) {
      cell.querySelectorAll(':scope > .asset-badge').forEach((b) => b.remove());
      const seen = new Set();
      for (const img of cell.querySelectorAll('.mount img[src]')) {
        const src = img.getAttribute('src');
        if (!src || !img.complete || img.naturalWidth > 0) continue;
        if (seen.has(src)) continue; seen.add(src);
        const r = img.getBoundingClientRect(), cr = cell.getBoundingClientRect(), z = ctx.state.zoom || 1;
        const badge = h('span', { class: 'asset-badge', role: 'status', 'data-path': src, title: `This image is missing: ${src}`, text: `missing: ${src}` });
        badge.style.top = `${(r.top - cr.top) / z + 4}px`; badge.style.left = `${Math.max(0, (r.left - cr.left) / z) + 4}px`;
        cell.append(badge);
        img.dataset.missing = '1';
      }
    }
  }
  const rescan = (ev) => { if (ev.target.tagName === 'IMG') scan(ev.target.closest('.cell') ?? document); };
  document.querySelector('#world').addEventListener('error', rescan, true);
  document.querySelector('#world').addEventListener('load', (ev) => { if (ev.target.tagName === 'IMG') { delete ev.target.dataset.missing; scan(ev.target.closest('.cell') ?? document); } }, true);
  ctx.on('render', () => setTimeout(() => scan(), 0));
  ctx.assets = { scan, place, load };
}
