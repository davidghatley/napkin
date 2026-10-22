// The stage: every component is a frame on an infinite canvas, drawn by the component's own bundle (real
// React, F04). Variants sit in a matrix (first axis across, second down, the rest as labelled groups).
// Plain DOM; React is only inside the cells.
//
//   #world (one CSS transform, see view.js)
//     section.cmp[data-component][data-name][data-revision][data-ready]   absolutely placed at its canvas x/y
//       .cmp-head      title, badge, revision, problem, build-error (counter-scaled so it stays legible)
//       .frame > .matrix > .group > .mgrid > (.corner|.colhead|.rowhead|figure.cell[data-variant] > .mount, figcaption)
//   #overlays (screen space, outside the world): #overlay-select, #overlay-hover, .overlay-extra, #overlay-measure
//
// Interactions here: click / shift-click / marquee selection (ctx.state.selections), dragging a frame by its
// title (position saved in the sidecar only), Alt to measure, hover. Components are laid out once and never
// re-packed, so an edit in one frame can never move another (FEEL-04).
import { variantGrid, axes, index } from '/src/model.js';
import { variantLabel } from './panel.js';

let SHELF_W = 2400; const GAP_X = 120, GAP_Y = 170, CULL_AFTER = 40; // up to 40 components all draw and all follow the files (PRF-01, REL-05); beyond that, frames far off screen wait until they are revealed
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createStage(ctx, root, world, view) {
  const sections = new Map(); // component id -> { el, frame, unmounts, token, pos, size, culled }
  const auto = new Map();     // component id -> { x, y } chosen by the stage for components that have no saved position
  const overlays = root.querySelector('#overlays');
  const mk = (id) => { const o = document.createElement('div'); o.id = id; overlays.append(o); return o; };
  const selectBox = mk('overlay-select'), hoverBox = mk('overlay-hover'), measureBox = mk('overlay-measure');
  const sizeChip = document.createElement('span'); sizeChip.className = 'osize'; selectBox.append(sizeChip); // "128 × 36", in canvas pixels
  const extras = [];
  let shelf = { x: 0, y: 0, h: 0 };
  let laidOut = false, hoverEl = null, measuring = false;
  const byName = (a, b) => (ctx.state.components.get(a)?.name ?? a).localeCompare(ctx.state.components.get(b)?.name ?? b);

  // ---------------------------------------------------------------------------------------------- lookup
  const cellOf = (sec, variant) => { const key = JSON.stringify(variant || {}); return [...sec.el.querySelectorAll('.cell')].find((c) => c.dataset.variant === key); };
  function cellElement(id, node, variant) {
    const sec = sections.get(id);
    if (!sec) return null;
    const css = `.mount [data-n="${CSS.escape(node)}"]`;
    return cellOf(sec, variant)?.querySelector(css) || sec.el.querySelector(css);
  }
  const selectedElement = (sel) => (sel ? cellElement(sel.component, sel.node, sel.variant) : null);
  const live = (id) => { const sec = sections.get(id); if (sec?.culled) { sec.culled = false; delete sec.el.dataset.cull; } if (sec?.pending) { sec.follow = true; render(id, true).catch(console.error); } return sec; };

  // ---------------------------------------------------------------------------------------------- sections
  function section(id) {
    let sec = sections.get(id);
    if (sec) return sec;
    const el = document.createElement('section');
    el.className = 'cmp'; el.dataset.component = id;
    el.innerHTML = '<div class="cmp-head"><span class="cmp-title"><h3></h3><span class="badge" hidden></span><span class="rev"></span></span><span class="axes-strip"></span><p class="problem" role="status"></p></div><div class="frame"></div>';
    sec = { el, frame: el.querySelector('.frame'), unmounts: [], token: 0, pos: null, size: { w: 0, h: 0 }, culled: false };
    sections.set(id, sec);
    world.append(el);
    const saved = ctx.state.components.get(id)?.canvas;
    if (saved && (saved.x || saved.y)) moveTo(id, saved.x, saved.y);
    return sec;
  }

  function header(id) {
    const c = ctx.state.components.get(id), sec = section(id);
    sec.el.querySelector('h3').textContent = ctx.title(c);
    sec.el.dataset.name = c.name;
    const ax = c.doc ? axes(c.doc) : [];
    sec.el.querySelector('.axes-strip').textContent = ax.map((a, i) => `${a.name} ×${a.options.length}${i === 0 ? ' →' : i === 1 ? ' ↓' : ''}`).join('  ');
    const badge = sec.el.querySelector('.badge');
    badge.hidden = !c.readOnly; badge.textContent = c.readOnly ? `read-only: ${c.readOnly}` : ''; badge.title = badge.textContent;
    sec.el.querySelector('.problem').textContent = c.problem ? `file has an error, showing the last good version: ${c.problem}` : '';
  }

  // The matrix: first axis across, second down, the rest as labelled groups.
  function buildMatrix(doc, cellFor) {
    const ax = doc ? axes(doc) : [];
    const matrix = document.createElement('div');
    matrix.className = 'matrix'; matrix.dataset.axes = String(ax.length);
    if (!ax.length) { matrix.append(cellFor({})); return matrix; }
    const [across, down, ...rest] = ax;
    let groups = [{}];
    for (const a of rest) groups = groups.flatMap((g) => a.options.map((o) => ({ ...g, [a.name]: o })));
    matrix.style.setProperty('--nk-gcols', String(Math.max(1, Math.min(groups.length, Math.ceil(Math.sqrt(groups.length))))));
    for (const g of groups) {
      const group = document.createElement('div');
      group.className = 'group'; group.dataset.group = JSON.stringify(g);
      const t = document.createElement('div');
      t.className = 'group-title';
      const chips = Object.entries(g).map(([k, v]) => `<span class="gchip"><i>${esc(k)}</i> ${esc(v)}</span>`).join('');
      t.innerHTML = `<span class="gchips">${chips}</span><span class="ghint"><i>${esc(across.name)}</i> →${down ? ` <i>${esc(down.name)}</i> ↓` : ''}</span>`;
      group.append(t);
      const grid = document.createElement('div');
      grid.className = 'mgrid'; grid.style.setProperty('--nk-cols', across.options.length);
      grid.dataset.rows = down ? '1' : '0';
      const head = (cls, text, base) => { const d = document.createElement('div'); d.className = cls + (base ? ' is-base' : ''); d.innerHTML = `<span>${esc(text)}</span>`; return d; };
      if (down) { const corner = document.createElement('div'); corner.className = 'corner'; grid.append(corner); }
      for (const o of across.options) grid.append(head('colhead', o, o === across.default));
      for (const r of down ? down.options : [null]) {
        if (down) grid.append(head('rowhead', r, r === down.default));
        // keys in axis order, like variantGrid(): data-variant is compared as a string
        for (const o of across.options) { const m = { ...g, [across.name]: o, ...(down ? { [down.name]: r } : {}) }; grid.append(cellFor(Object.fromEntries(ax.map((a) => [a.name, m[a.name]])))); }
      }
      group.append(grid);
      matrix.append(group);
    }
    return matrix;
  }

  const visible = sec => {
    const { x, y, z } = view.get(), b = view.stageBox(), p = sec.pos;
    return !p || (p.x * z + x < b.width + 200 && (p.x + sec.size.w) * z + x > -200 && p.y * z + y < b.height + 200 && (p.y + sec.size.h) * z + y > -200);
  };
  function errorCard(message) {
    const card = document.createElement('details'); card.className = 'build-error';
    const summary = document.createElement('summary'); summary.textContent = message.split('. Next:')[0].slice(0, 180) + ' · Click for details';
    const detail = document.createElement('pre'); detail.textContent = message;
    card.append(summary, detail); return card;
  }
  function finish(sec, id, revision) {
    const previous = { ...sec.size }; measure(sec);
    sec.el.dataset.ready = '1'; sec.el.dataset.revision = revision;
    const resized = previous.w !== sec.size.w || previous.h !== sec.size.h;
    const overlaps = sec.pos && [...sections.entries()].some(([otherId, other]) => otherId !== id && other.pos && sec.pos.x < other.pos.x + other.size.w + GAP_X && sec.pos.x + sec.size.w + GAP_X > other.pos.x && sec.pos.y < other.pos.y + other.size.h + GAP_Y * 0.6 && sec.pos.y + sec.size.h + GAP_Y * 0.6 > other.pos.y);
    if (laidOut && (!sec.pos || auto.has(id) && resized && overlaps)) placeNew(id);
    if (sec.follow) { sec.follow = false; view.flyTo(componentRect(id), { pad: 96, max: Math.max(1, view.get().z) }); }
    refreshOverlays(); ctx.emit('render', { component: id, revision }); queueCull();
  }
  async function render(id, force = false) {
    const c = ctx.state.components.get(id);
    if (!c) return;
    const sec = section(id);
    const token = ++sec.token;
    header(id);
    if (!force && ctx.state.components.size > CULL_AFTER) {
      if (!sec.pos) {
        sec.frame.innerHTML = '<div class="bundle-pending">Preview loads when in view</div>';
        measure(sec); placeNew(id);
      }
      if (!visible(sec)) { sec.pending = true; sec.el.dataset.ready = '1'; return; }
    }
    sec.pending = false;
    const res = await fetch(`/bundle/${encodeURIComponent(id)}.js?rev=${c.revision}`);
    if (token !== sec.token) return; // a newer revision is already on its way
    if (!res.ok) {
      sec.unmounts.forEach(u => u()); sec.unmounts = [];
      sec.frame.replaceChildren(errorCard(`build failed: ${(await res.json().catch(() => ({}))).error || res.status}`));
      finish(sec, id, c.revision);
      return;
    }
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    let mod; try { mod = await import(url); } finally { URL.revokeObjectURL(url); }
    if (token !== sec.token) return;
    const unmounts = [];
    const cellFor = (variant) => {
      const fig = document.createElement('figure');
      fig.className = 'cell'; fig.dataset.variant = JSON.stringify(variant);
      const mount = document.createElement('div'); mount.className = 'mount';
      const cap = document.createElement('figcaption'); cap.textContent = variantLabel(variant);
      const grip = document.createElement('div'); grip.className = 'cell-grip'; grip.title = 'Drag to preview another width. Double-click to reset.';
      const pw = c.preview?.[JSON.stringify(variant)];
      if (pw) { mount.style.width = `${pw}px`; fig.dataset.pw = String(pw); }
      fig.append(mount, cap, grip);
      try { unmounts.push(mod.mount(mount, { ...variant, ...(c.slots || {}), ...(ctx.play?.props(id) ?? {}) })); }
      catch (e) { mount.replaceChildren(errorCard(`${c.path || c.name + '.tsx'}: render failed: ${e.message}`)); }
      return fig;
    };
    const matrix = buildMatrix(c.doc, cellFor);
    const old = sec.unmounts;
    sec.frame.replaceChildren(matrix);
    sec.unmounts = unmounts;
    queueMicrotask(() => old.forEach((u) => u()));
    sec.el.dataset.revision = c.revision; sec.el.dataset.ready = '1';
    sec.el.querySelector('.rev').textContent = `r${String(c.revision).slice(0, 7)}`; // revisions are content hashes; show them short
    finish(sec, id, c.revision);
    // Keep the selection while its nodes still exist; drop the ones that are gone.
    const sels = ctx.state.selections.filter((s) => !(s.component === id && !(c.doc && index(c.doc).byId.has(s.node))));
    if (sels.length !== ctx.state.selections.length) ctx.selectMany(sels);
    refreshOverlays();
  }

  function remove(id) {
    const sec = sections.get(id);
    if (!sec) return;
    sec.token++; sec.unmounts.forEach((u) => u()); sec.el.remove(); sections.delete(id); auto.delete(id);
    if (ctx.state.selections.some((s) => s.component === id)) ctx.selectMany(ctx.state.selections.filter((s) => s.component !== id));
  }

  // ---------------------------------------------------------------------------------------------- placement
  function measure(sec) {
    if (sec.culled) return;
    sec.size = { w: sec.frame.offsetWidth, h: sec.frame.offsetHeight };
    sec.el.style.setProperty('--nk-w', `${sec.size.w}px`); sec.el.style.setProperty('--nk-h', `${sec.size.h}px`);
  }
  // preview widths (LAY-11) came in from the sidecar: put them on the cells
  function applyPreview(id) {
    const sec = sections.get(id), pv = ctx.state.components.get(id)?.preview || {};
    if (!sec) return;
    for (const cell of sec.el.querySelectorAll('.cell')) {
      const w = pv[cell.dataset.variant], mount = cell.querySelector('.mount');
      if (w) { mount.style.width = `${w}px`; cell.dataset.pw = String(w); } else { mount.style.width = ''; delete cell.dataset.pw; }
    }
    measure(sec); refreshOverlays();
  }
  ctx.on('preview', (f) => applyPreview(f.component));
  function moveTo(id, x, y) {
    const sec = sections.get(id);
    if (!sec) return;
    sec.pos = { x, y };
    // left/top, not a transform: 200 frames with a transform each are 200 paint-property nodes and make every frame's layerize pass slow (PRF-02)
    sec.el.style.left = `${x}px`; sec.el.style.top = `${y}px`;
    sec.el.dataset.pos = '1';
  }
  const placed = (id) => { const s = ctx.state.components.get(id)?.canvas; return !!s && (s.x !== 0 || s.y !== 0); };
  // What a frame takes on the canvas besides its body: the title row and filter bar above it (drawn at a size that stays readable,
  // so in canvas units they grow as the view zooms out) and a gap of at least CLEAR px. Packing reserves it, so frames never overlap.
  const CLEAR = 24;
  const headBox = (sec, z) => {
    const head = sec.el.querySelector('.cmp-head'), lf = Math.min(16, Math.max(1, 1 / z));
    const nat = head ? { w: head.offsetWidth, h: head.offsetHeight } : { w: 0, h: 28 };
    if (head && z < 0.33) { // far out the axis strip shows under the title (hidden now, so measured by its text)
      const strip = head.querySelector('.axes-strip')?.textContent || '';
      if (strip) { nat.h += 20; nat.w = Math.max(nat.w, Math.ceil(strip.length * 6.8)); }
    }
    return { w: Math.max(sec.size.w, Math.ceil(nat.w * lf)), top: Math.ceil((nat.h + 8) * lf) + CLEAR };
  };
  // Components with no saved position are packed once (alphabetically, in rows). Nothing is ever re-packed.
  function pack(ids, taken, z) {
    let y = taken.length ? Math.max(...taken.map((id) => sections.get(id).pos.y + sections.get(id).size.h)) + CLEAR : 0;
    const boxes = new Map(ids.map((id) => [id, headBox(sections.get(id), z)]));
    const area = ids.reduce((a, id) => a + (boxes.get(id).w + GAP_X) * (sections.get(id).size.h + boxes.get(id).top), 0);
    const width = Math.max(1400, ...ids.map((id) => boxes.get(id).w), Math.round(Math.sqrt(area * 1.7)));
    const out = new Map();
    const rows = [[]];
    for (const id of ids) {
      const { w } = boxes.get(id);
      const cur = rows.at(-1);
      const used = cur.reduce((a, i) => a + boxes.get(i).w + GAP_X, 0);
      if (cur.length && used + w > width) rows.push([id]); else cur.push(id);
    }
    for (const row of rows) {
      if (!row.length) continue;
      const top = Math.max(...row.map((id) => boxes.get(id).top));
      y += top;
      let cx = 0;
      for (const id of row) { out.set(id, { x: cx, y }); cx += boxes.get(id).w + GAP_X; }
      y += Math.max(...row.map((id) => sections.get(id).size.h));
    }
    return { out, width, bottom: y };
  }
  function layoutAll() {
    const ids = [...sections.keys()];
    for (const id of ids) if (placed(id)) { const s = ctx.state.components.get(id).canvas; moveTo(id, s.x, s.y); }
    const todo = ids.filter((id) => !placed(id) && !auto.has(id)).sort(byName);
    const taken = ids.filter(placed);
    // the reserve depends on the zoom the whole layout will be viewed at, which depends on the reserve: settle it in a few steps
    const box = view.stageBox();
    const fitZoom = (res) => { // what Shift+1 will show: the frames and their 36 px title strip, 72 px padding, at most 100%
      const rects = [...taken.map((id) => ({ x: sections.get(id).pos.x, y: sections.get(id).pos.y, w: sections.get(id).size.w, h: sections.get(id).size.h })), ...todo.map((id) => ({ ...res.out.get(id), w: sections.get(id).size.w, h: sections.get(id).size.h }))];
      const x0 = Math.min(...rects.map((r) => r.x)), x1 = Math.max(...rects.map((r) => r.x + r.w)), y0 = Math.min(...rects.map((r) => r.y)) - 36, y1 = Math.max(...rects.map((r) => r.y + r.h));
      return Math.max(1 / 16, Math.min(1, (box.width - 144) / Math.max(1, x1 - x0), (box.height - 144) / Math.max(1, y1 - y0)));
    };
    let z = 1, res = pack(todo, taken, z);
    for (let i = 0; i < 8 && todo.length; i++) {
      const next = fitZoom(res);
      if (Math.abs(Math.round(Math.min(16, 1 / next) * 20) - Math.round(Math.min(16, 1 / z) * 20)) <= 1) break;
      z = next; res = pack(todo, taken, z);
    }
    for (const id of todo) { const p = res.out.get(id); auto.set(id, { x: p.x, y: p.y }); moveTo(id, p.x, p.y); }
    SHELF_W = res.width;
    const last = todo.at(-1);
    shelf = last ? { x: res.out.get(last).x + headBox(sections.get(last), z).w + GAP_X, y: res.out.get(last).y, h: sections.get(last).size.h } : { x: 0, y: 0, h: 0 };
    laidOut = true;
    ctx.emit('layout', {});
  }
  // A component that appears later goes into the first free slot, so nothing else moves.
  function placeNew(id) {
    if (placed(id)) { const s = ctx.state.components.get(id).canvas; moveTo(id, s.x, s.y); return; }
    const me = sections.get(id), z = Math.min(1, view.get().z);
    const others = [...sections.entries()].filter(([k, s]) => k !== id && s.pos).map(([k, s]) => { const b = headBox(s, z); return { x: s.pos.x, y: s.pos.y - b.top, w: b.w, h: s.size.h + b.top }; });
    const mine = headBox(me, z), { h } = me.size, w = mine.w;
    SHELF_W = Math.max(SHELF_W, w);
    let x = shelf.x, y = shelf.y;
    if (x && x + w > SHELF_W) { x = 0; y = y + shelf.h + CLEAR; }
    const hit = (px, py) => others.some((o) => px < o.x + o.w + GAP_X && px + w + GAP_X > o.x && py - mine.top < o.y + o.h + CLEAR && py + h + CLEAR > o.y);
    if (hit(x, y)) { x = 0; y = Math.max(0, ...others.map((o) => o.y + o.h)) + CLEAR + mine.top; }
    shelf = { x: x + w + GAP_X, y, h: Math.max(h, x ? shelf.h : 0) };
    auto.set(id, { x, y }); moveTo(id, x, y);
  }

  // ---------------------------------------------------------------------------------------------- ghost frames (WPC-22)
  // A component that does not exist yet (an agent's create proposal) is drawn as a dashed frame with its real rendered cells, in the slot a
  // new component would take (the same search as placeNew, but nothing advances: if it is accepted the real frame lands in this same slot).
  // Ghost frames are not components: no section, no selection, no pointer events. key is the proposal id.
  const ghosts = new Map(); // key -> { el, frame, unmounts, pos, size }
  function ghostSlot(key, size) {
    const z = Math.min(1, view.get().z), lf = Math.min(16, Math.max(1, 1 / z));
    const top = Math.ceil(52 * lf) + CLEAR, w = size.w, h = size.h;
    const others = [...sections.values()].filter((s) => s.pos).map((s) => { const b = headBox(s, z); return { x: s.pos.x, y: s.pos.y - b.top, w: b.w, h: s.size.h + b.top }; });
    for (const [k, g] of ghosts) if (k !== key && g.pos) others.push({ x: g.pos.x, y: g.pos.y - top, w: g.size.w, h: g.size.h + top });
    const sw = Math.max(SHELF_W, w);
    let x = shelf.x, y = shelf.y;
    if (x && x + w > sw) { x = 0; y = y + shelf.h + CLEAR; }
    const hit = (px, py) => others.some((o) => px < o.x + o.w + GAP_X && px + w + GAP_X > o.x && py - top < o.y + o.h + CLEAR && py + h + CLEAR > o.y);
    if (hit(x, y)) { x = 0; y = Math.max(0, ...others.map((o) => o.y + o.h)) + CLEAR + top; }
    return { x, y };
  }
  function removeGhost(key) {
    const g = ghosts.get(key);
    if (!g) return;
    for (const u of g.unmounts) try { u(); } catch { /* already gone */ }
    g.el.remove(); ghosts.delete(key);
  }
  function ghostFrame(key, { flag, color, ink, doc, mod }) {
    removeGhost(key);
    const el = document.createElement('section');
    el.className = 'ghost-new'; el.dataset.proposal = key; el.setAttribute('role', 'status');
    el.style.setProperty('--nk-c', color || 'var(--nk-accent)'); el.style.setProperty('--nk-ink', ink || 'var(--nk-on-accent)');
    const head = document.createElement('div'); head.className = 'gn-head';
    const f = document.createElement('span'); f.className = 'gn-flag'; f.textContent = flag; f.title = flag; head.append(f);
    const frame = document.createElement('div'); frame.className = 'frame gn-frame';
    el.append(head, frame);
    const unmounts = [];
    const cellFor = (variant) => {
      const fig = document.createElement('figure'); fig.className = 'cell'; fig.dataset.variant = JSON.stringify(variant);
      const mount = document.createElement('div'); mount.className = 'mount';
      const cap = document.createElement('figcaption'); cap.textContent = variantLabel(variant);
      fig.append(mount, cap);
      try { unmounts.push(mod.mount(mount, { ...variant })); } catch (e) { mount.textContent = `could not draw: ${e.message}`; }
      return fig;
    };
    frame.append(buildMatrix(doc, cellFor));
    const g = { el, frame, unmounts, pos: null, size: { w: 0, h: 0 } };
    ghosts.set(key, g);
    el.style.visibility = 'hidden'; world.append(el);
    g.size = { w: frame.offsetWidth, h: frame.offsetHeight };
    g.pos = ghostSlot(key, g.size);
    el.style.left = `${g.pos.x}px`; el.style.top = `${g.pos.y}px`; el.style.visibility = '';
    el.style.setProperty('--nk-w', `${g.size.w}px`);
    return el;
  }
  // The layout moved on (first pack, a new component): ghosts take the first free slot again.
  function reslotGhosts() {
    for (const [key, g] of ghosts) { g.pos = ghostSlot(key, g.size); g.el.style.left = `${g.pos.x}px`; g.el.style.top = `${g.pos.y}px`; }
  }
  const ghostRect = (key) => { const g = ghosts.get(key); return g?.pos ? { x: g.pos.x, y: g.pos.y - 36, w: g.size.w, h: g.size.h + 36 } : null; };
  const ghostKeys = () => [...ghosts.keys()];

  // ---------------------------------------------------------------------------------------------- rectangles (canvas units)
  function componentRect(id) {
    const sec = sections.get(id);
    if (!sec?.pos) return null;
    measure(sec);
    return { x: sec.pos.x, y: sec.pos.y - 36, w: sec.size.w, h: sec.size.h + 36 };
  }
  const elementRect = (el) => view.rectToWorld(el.getBoundingClientRect());
  const union = (rs) => {
    rs = rs.filter(Boolean);
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
  };
  const allRect = () => union([...sections.keys()].map(componentRect));
  function nodeRect(sel) { live(sel.component); const el = selectedElement(sel); return el ? elementRect(el) : null; }
  const selectionRect = () => (ctx.state.selections.length ? union(ctx.state.selections.map(nodeRect)) : null);
  view.setFitters({ all: allRect, selection: selectionRect });

  // ---------------------------------------------------------------------------------------------- overlays
  function place(box, target, label, base) {
    if (!target?.isConnected || target.closest('[data-cull]')) { box.style.display = 'none'; return; }
    const r = target.getBoundingClientRect();
    box.style.setProperty('--nk-w', `${r.width}px`); box.style.setProperty('--nk-h', `${r.height}px`); // children are placed with transforms from these, so a new size never shifts layout
    Object.assign(box.style, { display: 'block', transform: `translate(${r.left - base.left}px, ${r.top - base.top}px)`, width: `${r.width}px`, height: `${r.height}px` });
    if (label !== undefined) box.dataset.label = label;
  }
  function refreshOverlays() {
    const sels = ctx.state.selections, sel = ctx.state.selection;
    if (!sels.length && !hoverEl && !measuring && !selectBox.style.display.includes('block') && !hoverBox.style.display.includes('block')) return; // nothing is shown, so there is nothing to place (and no layout to force)
    const base = overlays.getBoundingClientRect();
    const selEl = selectedElement(sel);
    place(selectBox, selEl, sel && `${ctx.state.components.get(sel.component)?.name} · ${sel.node}`, base);
    if (selEl?.isConnected && selectBox.style.display === 'block') { const r = selEl.getBoundingClientRect(), z = view.get().z; sizeChip.textContent = `${Math.round(r.width / z)} × ${Math.round(r.height / z)}`; }
    const others = sels.filter((s) => s !== sel);
    while (extras.length < others.length) { const d = document.createElement('div'); d.className = 'overlay-extra'; overlays.append(d); extras.push(d); }
    extras.forEach((d, i) => (others[i] ? place(d, selectedElement(others[i]), undefined, base) : (d.style.display = 'none')));
    place(hoverBox, hoverEl && !sels.some((s) => selectedElement(s) === hoverEl) ? hoverEl : null, undefined, base);
    drawMeasure(base);
    selectBox.dataset.count = String(sels.length);
    ctx.emit('overlays', {});
  }

  // Alt: distance between the selection and the hovered node, in canvas pixels (what the component's CSS sees).
  function drawMeasure(base) {
    const a = measuring && selectedElement(ctx.state.selection), b = measuring && hoverEl;
    measureBox.replaceChildren();
    if (!a || !b || a === b || !a.isConnected || !b.isConnected || a.closest('[data-cull]') || b.closest('[data-cull]')) { measureBox.dataset.active = ''; return; }
    measureBox.dataset.active = '1';
    const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(), z = view.get().z;
    const put = (axis, from, to, cross, value) => {
      if (value < 0.01) return;
      const line = document.createElement('div');
      line.className = `m-line m-${axis}`;
      const [x, y] = axis === 'x' ? [from - base.left, cross - base.top] : [cross - base.left, from - base.top];
      Object.assign(line.style, { transform: `translate(${x}px, ${y}px)`, width: `${axis === 'x' ? to - from : 0}px`, height: `${axis === 'y' ? to - from : 0}px` });
      const label = document.createElement('span');
      label.className = 'm-label'; label.dataset.axis = axis; label.dataset.value = value.toFixed(2);
      label.textContent = String(Math.round(value * 10) / 10);
      line.append(label);
      measureBox.append(line);
    };
    const mid = (lo1, hi1, lo2, hi2) => { const lo = Math.max(lo1, lo2), hi = Math.min(hi1, hi2); return hi > lo ? (lo + hi) / 2 : (lo1 + hi1 + lo2 + hi2) / 4; };
    const cy = mid(A.top, A.bottom, B.top, B.bottom), cx = mid(A.left, A.right, B.left, B.right);
    if (A.right <= B.left) put('x', A.right, B.left, cy, (B.left - A.right) / z);
    else if (B.right <= A.left) put('x', B.right, A.left, cy, (A.left - B.right) / z);
    else {
      put('x', Math.min(A.left, B.left), Math.max(A.left, B.left), cy, Math.abs(A.left - B.left) / z);
      put('x', Math.min(A.right, B.right), Math.max(A.right, B.right), cy, Math.abs(A.right - B.right) / z);
    }
    if (A.bottom <= B.top) put('y', A.bottom, B.top, cx, (B.top - A.bottom) / z);
    else if (B.bottom <= A.top) put('y', B.bottom, A.top, cx, (A.top - B.bottom) / z);
    else {
      put('y', Math.min(A.top, B.top), Math.max(A.top, B.top), cx, Math.abs(A.top - B.top) / z);
      put('y', Math.min(A.bottom, B.bottom), Math.max(A.bottom, B.bottom), cx, Math.abs(A.bottom - B.bottom) / z);
    }
    const mark = document.createElement('div'); mark.className = 'm-target';
    Object.assign(mark.style, { transform: `translate(${B.left - base.left}px, ${B.top - base.top}px)`, width: `${B.width}px`, height: `${B.height}px` });
    measureBox.append(mark);
  }
  addEventListener('keydown', (ev) => { if (ev.key === 'Alt' && !measuring) { measuring = true; ev.preventDefault(); refreshOverlays(); } });
  addEventListener('keyup', (ev) => { if (ev.key === 'Alt') { measuring = false; refreshOverlays(); } });
  addEventListener('blur', () => { if (measuring) { measuring = false; refreshOverlays(); } });

  // ---------------------------------------------------------------------------------------------- culling
  // Far off-screen frames stop being painted (content-visibility), keeping their size. Cheap until a repo is big.
  let cullQueued = false;
  function cull() {
    cullQueued = false;
    if (sections.size <= CULL_AFTER) { for (const sec of sections.values()) if (sec.culled) { sec.culled = false; delete sec.el.dataset.cull; } return; }
    const { x, y, z } = view.get(), b = view.stageBox();
    const m = 0.6; // margin as a share of the viewport
    const x0 = (-x - b.width * m) / z, x1 = (b.width * (1 + m) - x) / z, y0 = (-y - b.height * m) / z, y1 = (b.height * (1 + m) - y) / z;
    const keep = new Set(ctx.state.selections.map((s) => s.component));
    for (const [id, sec] of sections) {
      if (sec.pending && visible(sec)) render(id, true).catch(console.error);
      if (!sec.pos || !sec.size.w) continue;
      const off = !keep.has(id) && (sec.pos.x > x1 || sec.pos.x + sec.size.w < x0 || sec.pos.y - 40 > y1 || sec.pos.y + sec.size.h < y0);
      if (off !== sec.culled) { sec.culled = off; if (off) sec.el.dataset.cull = '1'; else delete sec.el.dataset.cull; }
    }
  }
  const queueCull = () => { if (!cullQueued) { cullQueued = true; requestAnimationFrame(cull); } };
  ctx.on('view', () => { refreshOverlays(); queueCull(); });
  ctx.on('select', () => {
    for (const s of ctx.state.selections) live(s.component);
    const on = new Set(ctx.state.selections.map((s) => s.component));
    for (const [id, sec] of sections) { if (on.has(id)) sec.el.dataset.sel = '1'; else delete sec.el.dataset.sel; }
    const n = ctx.state.selections.length;
    selectBox.dataset.more = String(n - 1);
    refreshOverlays();
  });
  ctx.on('layout', queueCull);

  // ---------------------------------------------------------------------------------------------- pointer: hover, click, marquee, frame drag
  const hit = (target) => {
    const el = target.closest?.('.mount [data-n]');
    const cell = el?.closest('.cell');
    return el && cell && { el, id: cell.closest('.cmp').dataset.component, variant: JSON.parse(cell.dataset.variant) };
  };
  // Clicking a component's own button must select it, not focus it (Enter and Space would then press it).
  root.addEventListener('mousedown', (ev) => { if (!document.body.dataset.play && ev.target.closest('.mount')) { ev.preventDefault(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } });
  const setHoverEl = (el, h) => { hoverEl = el; ctx.emit('hover', h ? { component: h.id, node: h.el.dataset.n } : null); refreshOverlays(); };
  root.addEventListener('mouseover', (ev) => { if (document.body.dataset.play) return; const h = hit(ev.target); setHoverEl(h?.el ?? null, h); });
  root.addEventListener('mouseleave', () => setHoverEl(null, null));
  // the layers tree hovers a node on the canvas
  function hoverNode(sel) {
    hoverEl = sel ? cellElement(sel.component, sel.node, ctx.state.selection?.component === sel.component ? ctx.state.selection.variant : undefined) : null;
    refreshOverlays();
  }
  let suppressClick = 0;
  root.addEventListener('click', (ev) => {
    if (document.body.dataset.play) return; // play mode: the click belongs to the component
    if (suppressClick && Date.now() - suppressClick < 300) { suppressClick = 0; return; }
    const h = hit(ev.target);
    if (h) ev.preventDefault();
    if (ev.target.closest?.('.cmp-head, .build-error, [data-nodrag]')) return; // handled by the frame drag (a click on a title selects the component's root)
    if (!h) { if (!ev.target.closest?.('#error')) ctx.select(null); return; }
    const sel = { component: h.id, node: h.el.dataset.n, variant: h.variant };
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) ctx.toggle(sel); else ctx.select(sel);
  }, true);
  window.addEventListener('resize', refreshOverlays);

  // Marquee on empty canvas (select tool).
  const marquee = document.querySelector('#marquee');
  let mq = null;
  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch' || ctx.state.tool !== 'select' || view.isPanning()) return;
    if (ev.target.closest('.mount [data-n], .cmp-head, .frame, #error')) return; // inside a frame, a drag moves the frame
    mq = { x: ev.clientX, y: ev.clientY, moved: false, additive: ev.shiftKey };
  });
  addEventListener('pointermove', (ev) => {
    if (!mq) return;
    if (!mq.moved && Math.hypot(ev.clientX - mq.x, ev.clientY - mq.y) < 4) return;
    mq.moved = true;
    const b = root.getBoundingClientRect();
    Object.assign(marquee.style, { left: `${Math.min(mq.x, ev.clientX) - b.left}px`, top: `${Math.min(mq.y, ev.clientY) - b.top}px`, width: `${Math.abs(ev.clientX - mq.x)}px`, height: `${Math.abs(ev.clientY - mq.y)}px` });
    marquee.hidden = false;
  });
  addEventListener('pointerup', (ev) => {
    if (!mq) return;
    const m = mq; mq = null; marquee.hidden = true;
    if (!m.moved) return;
    suppressClick = Date.now();
    const x0 = Math.min(m.x, ev.clientX), x1 = Math.max(m.x, ev.clientX), y0 = Math.min(m.y, ev.clientY), y1 = Math.max(m.y, ev.clientY);
    let best = [];
    for (const [id, sec] of sections) {
      if (sec.culled || !sec.pos) continue;
      const f = sec.frame.getBoundingClientRect();
      if (f.right < x0 || f.left > x1 || f.bottom < y0 || f.top > y1) continue;
      const seen = new Set(), found = [];
      for (const el of sec.el.querySelectorAll('.mount [data-n]')) {
        const r = el.getBoundingClientRect();
        if (r.right < x0 || r.left > x1 || r.bottom < y0 || r.top > y1 || seen.has(el.dataset.n)) continue;
        seen.add(el.dataset.n);
        found.push({ component: id, node: el.dataset.n, variant: JSON.parse(el.closest('.cell').dataset.variant) });
      }
      if (found.length > best.length) best = found;
    }
    if (m.additive && best.length) {
      const keep = ctx.state.selections.filter((s) => s.component === best[0].component && !best.some((b) => b.node === s.node));
      best = [...keep, ...best];
    }
    ctx.selectMany(best);
  }, true);

  // Drag a frame by its title; a plain click on the title selects the component's root.
  let drag = null;
  root.addEventListener('pointerdown', (ev) => {
    // by the title, or by any empty part of the frame (never by a component's own elements)
    const head = ev.target.closest?.('.cmp-head');
    const body = !head && ctx.state.tool === 'select' && ev.pointerType !== 'touch' && !ev.target.closest('.mount [data-n]') ? ev.target.closest?.('.frame') : null;
    if (ev.target.closest('details, summary, pre, [data-nodrag]')) return;
    if (!(head || body) || ev.button !== 0 || view.isPanning()) return;
    const id = (head || body).closest('.cmp').dataset.component, sec = sections.get(id);
    if (!sec?.pos) return;
    ev.preventDefault();
    drag = { id, x: ev.clientX, y: ev.clientY, from: { ...sec.pos }, moved: false, title: !!head };
    document.body.dataset.dragging = 'frame';
  });
  addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 3) return;
    drag.moved = true;
    const z = view.get().z;
    moveTo(drag.id, Math.round(drag.from.x + (ev.clientX - drag.x) / z), Math.round(drag.from.y + (ev.clientY - drag.y) / z));
    refreshOverlays();
    ctx.emit('framedrag', { id: drag.id, x: ev.clientX, y: ev.clientY });
  });
  addEventListener('pointerup', async (ev) => {
    if (!drag) return;
    const d = drag; drag = null; delete document.body.dataset.dragging;
    ctx.emit('framedragend', {});
    if (d.moved && d.title && ctx.frameDrop?.(d.id, ev.clientX, ev.clientY)) { moveTo(d.id, d.from.x, d.from.y); suppressClick = Date.now(); refreshOverlays(); return; } // dropped onto another component: it became an instance there, and the frame stays where it was
    if (!d.moved) {
      const c = ctx.state.components.get(d.id);
      if (d.title && c?.doc) ctx.select({ component: d.id, node: c.doc.root.id, variant: variantGrid(c.doc)[0] });
      else if (d.title && c?.readOnly) ctx.select({ component: d.id, node: '', variant: {} }); // nothing to edit: the panel says why
      return;
    }
    suppressClick = Date.now();
    const pos = sections.get(d.id)?.pos;
    if (!pos) return;
    const c = ctx.state.components.get(d.id);
    if (c) c.canvas = { ...pos };
    auto.delete(d.id);
    try {
      const r = await ctx.fetch(`/api/components/${encodeURIComponent(d.id)}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pos) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    } catch (e) { document.querySelector('#error').textContent = `could not save the position: ${e.message}`; }
    ctx.emit('moved', { component: d.id, ...pos });
  });

  // Bring a component into view if it is not (a new one, or a quick-open target); never moves a view that already shows it.
  function reveal(id) {
    live(id);
    const r = componentRect(id), v = view.get(), b = view.stageBox();
    if (!r) return;
    const x0 = r.x * v.z + v.x, y0 = r.y * v.z + v.y, x1 = (r.x + r.w) * v.z + v.x, y1 = (r.y + r.h) * v.z + v.y;
    if (x0 >= 0 && y0 >= 0 && x1 <= b.width && y1 <= b.height) return;
    view.flyTo(r, { pad: 96, max: Math.max(1, v.z) });
  }

  return {
    reveal, applyPreview, measureAll: (id) => { const sec = sections.get(id); if (sec) measure(sec); }, hoverNode, render, remove, header, refreshOverlays, layoutAll, placeNew, moveTo, ghostFrame, removeGhost, ghostRect, ghostKeys, reslotGhosts, cull: queueCull,
    componentRect, allRect, selectionRect, nodeRect, cellElement, selectedElement, live,
    sections, position: (id) => sections.get(id)?.pos ?? null,
  };
}
