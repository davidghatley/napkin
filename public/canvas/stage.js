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
import { plain, problemBanner } from './words.js';
import { variantGrid, axes, index } from '/src/model.js';
import { variantLabel } from './panel.js';
import { createDocFrame } from './doc-frames.js';
import { createItemFrame, compactItem, glanceCard, cardSize } from './kinds.js';
import { cardLabel } from './card-label.js';
import { tidyLayout, GUTTER } from './tidy.js';

let SHELF_W = 2400; const MASONRY_GAP = 72, GAP_X = 120, GAP_Y = 170, CULL_AFTER = 40, DOC_BUDGET = 40, DOC_BATCH = 6; // up to 40 components all draw and all follow the files (PRF-01, REL-05); beyond that, frames far off screen wait until they are revealed
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createStage(ctx, root, world, view) {
  world.style.visibility = 'hidden'; // until the first layout: frames are packed together once they are all measured, and nobody sees them move there
  // Components' sections. File items (kinds) are in the same map for get/set/has/delete, but iteration sees components only, so
  // the inspector, theme, styles and every other loop over the stage's document frames never meets an item card. all() is both.
  class SectionMap extends Map {
    items = new Map();
    set(k, v) { if (v?.item) this.items.set(k, v); else super.set(k, v); return this; }
    get(k) { return super.get(k) ?? this.items.get(k); }
    has(k) { return super.has(k) || this.items.has(k); }
    delete(k) { return this.items.delete(k) || super.delete(k); }
    all() { return [...super.entries(), ...this.items]; }
  }
  const sections = new SectionMap(); // component id -> { el, frame, unmounts, token, pos, size, culled }
  const auto = new Map();     // component id -> { x, y } chosen by the stage for components that have no saved position
  const overlays = root.querySelector('#overlays');
  const mk = (id) => { const o = document.createElement('div'); o.id = id; overlays.append(o); return o; };
  const selectBox = mk('overlay-select'), hoverBox = mk('overlay-hover'), measureBox = mk('overlay-measure');
  const sizeChip = document.createElement('span'); sizeChip.className = 'osize'; selectBox.append(sizeChip); // "128 × 36", in canvas pixels
  const extras = [];
  let shelf = { x: 0, y: 0, h: 0 };
  let laidOut = false, hoverEl = null, measuring = false, tidy = false;
  const byName = (a, b) => (ctx.state.components.get(a)?.name ?? a).localeCompare(ctx.state.components.get(b)?.name ?? b);

  // ---------------------------------------------------------------------------------------------- lookup
  const cellOf = (sec, variant) => { const key = JSON.stringify(variant || {}); return [...sec.el.querySelectorAll('.cell')].find((c) => c.dataset.variant === key); };
  function cellElement(id, node, variant) {
    const sec = sections.get(id);
    if (!sec) return null;
    if (sec.docFrame) return sec.docFrame.element(node); // an HTML component: the element inside its frame (doc-frames.js)
    const css = `.mount [data-n="${CSS.escape(node)}"]`;
    return cellOf(sec, variant)?.querySelector(css) || sec.el.querySelector(css);
  }
  const selectedElement = (sel) => (sel ? cellElement(sel.component, sel.node, sel.variant) : null);
  const live = (id) => { const sec = sections.get(id); if (sec?.culled) { sec.culled = false; delete sec.el.dataset.cull; delete sec.el.dataset.far; queueMicrotask(() => regrown([sec])); } if (sec?.pending) { sec.follow = true; render(id, true).catch(console.error); } return sec; };

  // ---------------------------------------------------------------------------------------------- sections
  function section(id) {
    let sec = sections.get(id);
    if (sec) return sec;
    const el = document.createElement('section');
    el.className = ctx.state.components.get(id)?.item ? 'item-card' : 'cmp'; el.dataset.component = id; el.dataset.itemId = ctx.itemOf?.(id) ?? id;
    el.innerHTML = '<div class="cmp-head"><span class="cmp-title"><h3></h3><span class="cmp-path" hidden></span><span class="badge" hidden></span><span class="rev"></span><span class="cmp-note" hidden></span></span><span class="axes-strip"></span><p class="problem" role="status"></p></div><div class="frame"></div>';
    if (ctx.state.components.get(id)?.item) el.dataset.awaiting = '1';
    sec = { el, frame: el.querySelector('.frame'), unmounts: [], token: 0, pos: null, size: { w: 0, h: 0 }, culled: false, item: !!ctx.state.components.get(id)?.item };
    sections.set(id, sec);
    world.append(el);
    const saved = ctx.state.components.get(id)?.canvas;
    if (saved && (saved.x || saved.y)) moveTo(id, saved.x, saved.y);
    return sec;
  }

  // A file card stays out of the picture until it is placed and its picture, poster or type has arrived: it never shows as an empty box.
  // A file card's size comes from what it shows (kinds.js cardSize), never from a layout read.
  function sizeCard(sec, c) {
    const { w, h } = cardSize(c, sec.natural);
    if (sec.size.w === w && sec.size.h === h) return;
    sec.size = { w, h }; sec.el.style.setProperty('--nk-w', `${w}px`); sec.el.style.setProperty('--nk-h', `${h}px`);
  }
  const revealCard = (sec) => { if (sec.item && sec.pos && sec.media !== false) delete sec.el.dataset.awaiting; };
  function awaitMedia(sec) {
    sec.media = false;
    if (sec.culled) { sec.media = true; return; }
    const done = () => {
      if (sec.media !== false) return;
      sec.media = true;
      // a picture's card takes the picture's proportions (kinds.js cardSize): known once it has decoded
      const img = sec.frame.querySelector('.kind-compact > img:not(.kind-poster)');
      if (img && !sec.natural && (img.naturalWidth || img.complete)) { // (a picture that failed to decode is complete with no width: card-state.js draws its error card)
        sec.natural = img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : { broken: true };
        const id = sec.el.dataset.component, was = { ...sec.size };
        measure(sec);
        if (laidOut && (was.w !== sec.size.w || was.h !== sec.size.h)) { if (auto.has(id) && overlapsOthers(id, sec)) reseat(id); refreshOverlays(); ctx.emit('layout', {}); }
      }
      revealCard(sec);
    };
    const wait = [];
    for (const m of sec.frame.querySelectorAll('img')) if (!m.complete) wait.push(new Promise((r) => { m.addEventListener('load', r, { once: true }); m.addEventListener('error', r, { once: true }); }));
    for (const v of sec.frame.querySelectorAll('video[poster]')) wait.push(new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = v.poster; }));
    if (!wait.length) return done();
    Promise.all(wait).then(done); setTimeout(done, 3000);
  }
  function header(id) {
    const c = ctx.state.components.get(id), sec = section(id);
    const label = cardLabel(c, ctx.title(c)), path = sec.el.querySelector('.cmp-path'); // one label for every kind: name, then the extension, quieter
    sec.el.querySelector('h3').textContent = label.name;
    path.textContent = label.ext; path.hidden = !label.ext; sec.el.querySelector('.cmp-title').title = label.path;
    sec.el.dataset.name = c.name;
    const ax = c.doc ? axes(c.doc) : [];
    sec.el.querySelector('.axes-strip').textContent = ax.map((a, i) => `${a.name} ×${a.options.length}${i === 0 ? ' →' : i === 1 ? ' ↓' : ''}`).join('  ');
    const badge = sec.el.querySelector('.badge');
    badge.hidden = !c.readOnly; badge.textContent = c.readOnly ? `read-only: ${c.readOnly}` : ''; badge.title = badge.textContent;
    sec.el.querySelector('.problem').textContent = c.problem ? problemBanner(c.path || `${c.name}.tsx`, c.problem) : '';
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
  const overlapsOthers = (id, sec) => { const gx = tidy ? GUTTER / 2 : GAP_X, gy = tidy ? GUTTER / 2 : GAP_Y * 0.6; return sec.pos && sections.all().some(([otherId, other]) => otherId !== id && other.pos && sec.pos.x < other.pos.x + other.size.w + gx && sec.pos.x + sec.size.w + gx > other.pos.x && sec.pos.y < other.pos.y + other.size.h + gy && sec.pos.y + sec.size.h + gy > other.pos.y); };
  // WPC-23: a frame far off screen is kept at the size it had (or a placeholder's) while it is culled; when it is drawn again it can be bigger
  // than the room it was given. The ones the stage placed itself move aside to free space; nothing else moves.
  function regrown(secs) {
    let changed = false;
    for (const sec of secs) {
      const id = sections.all().find(([, x]) => x === sec)?.[0];
      if (!id || sec.culled) continue;
      const was = { ...sec.size }; measure(sec);
      if (was.w === sec.size.w && was.h === sec.size.h) continue;
      changed = true;
      if (laidOut && auto.has(id) && overlapsOthers(id, sec)) reseat(id);
    }
    if (changed) { refreshOverlays(); ctx.emit('layout', {}); }
  }
  function finish(sec, id, revision) {
    ctx.matrix?.bar(id); // WPC-15: the filter bar exists before the frame is placed, so its height is counted
    const previous = { ...sec.size }; measure(sec);
    sec.el.dataset.ready = '1'; sec.el.dataset.revision = revision;
    if (sec.item) { if (sec.media === undefined) awaitMedia(sec); revealCard(sec); }
    const resized = previous.w !== sec.size.w || previous.h !== sec.size.h;
    const overlaps = overlapsOthers(id, sec);
    if (laidOut && (!sec.pos || auto.has(id) && resized && overlaps)) reseat(id);
    if (sec.follow) { sec.follow = false; view.flyTo(componentRect(id), { pad: 96, max: Math.max(1, view.get().z) }); }
    refreshOverlays(); ctx.emit('render', { component: id, revision }); queueCull();
  }
  async function render(id, force = false) {
    const c = ctx.state.components.get(id);
    if (!c) return;
    const sec = section(id);
    const token = ++sec.token;
    header(id);
    // Mixed-file cards have a fixed viewport. Build them in one pass, then pack once;
    // no per-card layout reads or free-slot searches during a large folder's first draw.
    if (c.item && !laidOut && !force) {
      sec.frame.innerHTML = `<figure class="cell doc-cell kind-cell" data-n="item">${compactItem(c)}</figure>`;
      awaitMedia(sec);
      sec.pending = true; sizeCard(sec, c);
      sec.el.dataset.kind = c.kind; sec.el.dataset.ready = '1';
      return;
    }
    if (!force && (c.item ? ctx.state.components.total : ctx.state.components.size) > CULL_AFTER) {
      if (!sec.pos) {
        sec.frame.innerHTML = c.item ? `<figure class="cell doc-cell kind-cell" data-n="item">${compactItem(c)}</figure>` : c.kind === 'html' ? glanceCard(ctx, c) : '<div class="bundle-pending">Preview loads when in view</div>';
        measure(sec); placeNew(id);
      }
      if (!visible(sec)) { sec.pending = true; sec.el.dataset.ready = '1'; return; }
    }
    // the budget holds on every road in (first draw, a styles answer, an edit): frames beyond DOC_BUDGET wait, named, until there is room
    if ((c.kind === 'html' || c.item) && !sec.docFrame && (c.item ? ctx.state.components.total : ctx.state.components.size) > CULL_AFTER && sections.all().filter(([, x]) => x.docFrame).length >= DOC_BUDGET && !(!c.item && evictItem())) { // (components and file items share the budget, components first: a file card gives its frame up for a component)
      sec.pending = true; sec.el.dataset.ready = '1';
      if (!c.item && !sec.frame.querySelector('.bundle-pending')) sec.frame.innerHTML = glanceCard(ctx, c);
      return;
    }
    sec.pending = false;
    if (c.kind === 'html' || c.item) return renderDoc(id, c, sec, token); // (an HTML or JSX frame waits to be revealed the same way: no iframe loads for a frame far off screen)
    const res = await fetch(`/bundle/${encodeURIComponent(id)}.js?rev=${c.revision}`);
    if (token !== sec.token) return; // a newer revision is already on its way
    if (!res.ok) {
      if (ctx.docs?.takeOver(id)) return; // the dialect could not build it: the engine draws the file as /view (which says why)
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

  // A frame taken out of memory: its iframe goes, its place and size stay, and it says what it is until it is in view again.
  function unloadDoc(id, sec) {
    const c = ctx.state.components.get(id);
    const w = sec.frame.offsetWidth, h = sec.frame.offsetHeight;
    sec.docFrame?.destroy(); sec.docFrame = null; sec.pending = true;
    sec.frame.style.minWidth = `${w}px`; sec.frame.style.minHeight = `${h}px`;
    sec.frame.innerHTML = c?.item ? `<figure class="cell doc-cell kind-cell" data-n="item">${compactItem(c)}</figure>` : `<div class="bundle-pending">${esc(c?.name ?? id)} · ${esc(c?.path ?? '')}<br>loads when you scroll to it</div>`;
  }

  // The loaded file card farthest from the view gives its live frame back to the budget. False when none is loaded.
  function evictItem(keep = new Set(ctx.state.selections.map((s) => s.component))) {
    const b = view.get(), cx = (-b.x + view.stageBox().width / 2) / b.z, cy = (-b.y + view.stageBox().height / 2) / b.z;
    const loaded = [...sections.items].filter(([id, x]) => x.docFrame && x.pos && !keep.has(id)).sort((p, q) => Math.hypot(q[1].pos.x - cx, q[1].pos.y - cy) - Math.hypot(p[1].pos.x - cx, p[1].pos.y - cy));
    if (!loaded.length) return false;
    unloadDoc(loaded[0][0], loaded[0][1]);
    return true;
  }

  // A component of the document engine (decision 0014): the file itself, in an iframe of /view (doc-frames.js).
  async function renderDoc(id, c, sec, token) {
    if (!sec.docFrame) {
      sec.docFrame = c.item ? createItemFrame(ctx, id) : createDocFrame(ctx, id, { onResize: (byWidth) => { if (!sections.has(id)) return; measure(sec); if (byWidth) rearrangeSoon(id); if (!byWidth && laidOut && auto.has(id) && overlapsOthers(id, sec)) reseat(id); /* (a frame never moves because you changed its width: it may cover its neighbour while you look) */ refreshOverlays(); ctx.emit('layout', {}); } });
      sec.frame.replaceChildren(sec.docFrame.cell); sec.frame.style.minWidth = sec.frame.style.minHeight = '';
      sec.el.dataset.kind = c.item ? c.kind : 'html';
    }
    let ok = false;
    try { ok = await sec.docFrame.load(c.revision); }
    catch (e) { if (token === sec.token) { sec.docFrame.cell.querySelector('.build-error')?.remove(); sec.docFrame.cell.append(errorCard(`could not load ${c.path}: ${e.message}`)); } }
    if (token !== sec.token) return;
    sec.el.dataset.revision = c.revision; sec.el.dataset.ready = '1';
    sec.el.querySelector('.rev').textContent = `r${String(c.revision).slice(0, 7)}`;
    finish(sec, id, c.revision);
    if (ok) {
      const sels = ctx.state.selections.filter((s) => !(s.component === id && !sec.docFrame.has(s.node)));
      if (sels.length !== ctx.state.selections.length) ctx.selectMany(sels);
      else if (ctx.state.selection?.component === id) ctx.emit('select', ctx.state.selection); // the panel reads the new values
    }
    refreshOverlays();
  }

  function remove(id) {
    const sec = sections.get(id);
    if (!sec) return;
    sec.docFrame?.destroy();
    sec.token++; sec.unmounts.forEach((u) => u()); sec.el.remove(); sections.delete(id); auto.delete(id);
    if (ctx.state.selections.some((s) => s.component === id)) ctx.selectMany(ctx.state.selections.filter((s) => s.component !== id));
  }

  // ---------------------------------------------------------------------------------------------- placement
  function measure(sec) {
    if (sec.culled) return;
    if (ctx.state.components.get(sec.el.dataset.component)?.item) { // fixed viewport; no layout reads, including newly arrived files
      sizeCard(sec, ctx.state.components.get(sec.el.dataset.component));
      return;
    }
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
  // A person put the frame here (a drag, a nudge, an undo): it stays here, whatever the packing of the others does.
  function putAt(id, x, y) {
    const c = ctx.state.components.get(id);
    moveTo(id, x, y);
    if (c) c.canvas = { x, y };
    auto.delete(id);
    refreshOverlays();
  }
  const placed = (id) => { const s = ctx.state.components.get(id)?.canvas; return !!s && (s.x !== 0 || s.y !== 0); };
  // What a frame takes on the canvas besides its body: the title row and filter bar above it (drawn at a size that stays readable,
  // so in canvas units they grow as the view zooms out) and a gap of at least CLEAR px. Packing reserves it, so frames never overlap.
  const CLEAR = 24, RESERVE_Z = 0.25;
  const headBox = (sec, z) => {
    if (ctx.state.components.get(sec.el.dataset.component)?.item) {
      const lf = Math.min(4, Math.max(1, 1 / z));
      return { w: Math.max(sec.size.w, Math.ceil((sec.el.dataset.name.length * 7 + 20) * lf)), top: Math.ceil(36 * lf) + CLEAR };
    }
    const head = sec.el.querySelector('.cmp-head'), lf = Math.min(16, Math.max(1, 1 / z));
    const nat = head ? { w: head.offsetWidth, h: head.offsetHeight } : { w: 0, h: 28 };
    const bar = head && ctx.matrix?.natural(sec.el); // WPC-32: a filter bar too big for its frame is hidden, so it takes no room above it
    if (bar) {
      const shown = bar.ctl.offsetParent !== null, fits = ctx.matrix.fits(sec.el, lf);
      nat.h += (fits ? bar.h + 4 : 0) - (shown ? bar.ctl.offsetHeight + 4 : 0);
      if (shown && !fits) nat.w = head.querySelector('.cmp-title')?.offsetWidth || nat.w;
    }
    if (head && z < 0.4) { // far out the axis strip shows under the title (hidden now, so measured by its text)
      const strip = head.querySelector('.axes-strip')?.textContent || '';
      if (strip) { nat.h += 20; nat.w = Math.max(nat.w, Math.ceil(strip.length * 6.8)); }
    }
    return { w: Math.max(sec.size.w, Math.ceil(nat.w * lf)), top: Math.ceil((nat.h + 8) * lf) + CLEAR };
  };
  // The room a card's label takes at zoom z, in canvas units: above the card (top: the label and its 4 px gap) and across (w: a short card's
  // label may be wider than the card). Labels are a fixed size on screen (view.labelScale), so the room grows as the zoom falls.
  let ch10 = 0;
  function labelRoom(sec, z) {
    const head = sec.el.querySelector('.cmp-head'), t = head?.querySelector('.cmp-title');
    if (!t || (!sec.item && (ctx.matrix?.natural(sec.el) || head.querySelector('.axes-strip')?.textContent || head.querySelector('.problem')?.textContent))) { const b = headBox(sec, z); return { top: b.top - CLEAR, w: b.w }; }
    const lf = sec.item ? Math.min(4, view.labelScale(z)) : view.labelScale(z);
    if (!ch10) { const p = document.createElement('span'); p.style.cssText = 'position:absolute;visibility:hidden;width:10ch'; head.append(p); ch10 = p.offsetWidth || 66; p.remove(); }
    const path = t.querySelector('.cmp-path'), nat = (t.querySelector('h3')?.scrollWidth || 0) + (path && !path.hidden ? path.scrollWidth - 4 : 0);
    return { top: ((t.offsetHeight || 16) + 4) * lf, w: sec.item ? sec.size.w : Math.max(sec.size.w, Math.min(nat * lf, ch10 * lf, sec.size.w + 24)) }; // (cards.css: a label runs at most 24 units past its card)
  }
  // A folder of up to CULL_AFTER cards opens on a tidy layout (tidy.js): grouped by what they are, rows with aligned tops, one gutter, sized so the
  // first view shows them all at the largest zoom the canvas between the panels allows. Cards with a saved position stay; the rest go below them.
  const GROUP = { css: 2, image: 3, markdown: 4, text: 4 }; // pages, components, stylesheets, pictures, then text
  const groupOf = (id) => { const c = ctx.state.components.get(id); return c?.item ? GROUP[c.meta?.family] ?? 5 : /\.html?$/i.test(c?.path || '') ? 0 : 1; };
  function layoutTidy(ids) {
    const todo = ids.filter((id) => !placed(id)).sort((a, b) => groupOf(a) - groupOf(b) || byName(a, b));
    const seated = ids.filter((id) => placed(id) && sections.get(id).pos);
    const origin = seated.length ? { x: Math.min(...seated.map((id) => sections.get(id).pos.x)), y: Math.max(...seated.map((id) => sections.get(id).pos.y + sections.get(id).size.h)) + GUTTER } : { x: 0, y: 0 };
    const res = tidyLayout(todo.map((id) => { const sec = sections.get(id); return { id, group: groupOf(id), w: sec.size.w, h: sec.size.h, reserve: (z) => labelRoom(sec, z) }; }), { box: view.stageBox(), origin });
    for (const id of todo) { const p = res.at.get(id); auto.set(id, { x: p.x, y: p.y }); moveTo(id, p.x, p.y); }
    SHELF_W = Math.max(SHELF_W, res.width);
    const last = todo.at(-1);
    shelf = last ? { x: res.at.get(last).x + sections.get(last).size.w + GUTTER, y: res.at.get(last).y, h: sections.get(last).size.h } : { x: 0, y: 0, h: 0 };
  }
  // Components with no saved position are packed once (alphabetically, in rows). Nothing is ever re-packed.
  function pack(ids, taken, z) {
    let y = taken.length ? Math.max(...taken.map((id) => sections.get(id).pos.y + sections.get(id).size.h)) + CLEAR : 0;
    const boxes = new Map(ids.map((id) => [id, headBox(sections.get(id), z)]));
    const area = ids.reduce((a, id) => a + (boxes.get(id).w + GAP_X) * (sections.get(id).size.h + boxes.get(id).top), 0);
    const width = Math.max(ids.every((id) => sections.get(id).el.dataset.kind === 'html') ? 1300 : 1400, ...ids.map((id) => boxes.get(id).w), Math.round(Math.sqrt(area * 1.7)));
    const out = new Map();
    // Frames of files only: they vary in height, so they stack in columns (shortest first) as wide as the canvas shows, and read at a larger zoom
    if (!taken.length && ids.length > 2 && ids.every((id) => sections.get(id).el.dataset.kind === 'html')) {
      const sb = view.stageBox(), colW = Math.max(...ids.map((id) => sections.get(id).size.w)) + MASONRY_GAP; // (far out a title drops its path, so it fits its column)
      const stack = (n) => { const heights = Array(n).fill(0), at = new Map(); for (const id of ids) { const c = heights.indexOf(Math.min(...heights)), top = boxes.get(id).top; at.set(id, { x: c * colW, y: heights[c] + top }); heights[c] += top + sections.get(id).size.h; } return { heights, at }; };
      // as many columns as read largest on the canvas you have
      const zoomOf = (n, heights) => Math.min((sb.width - 144) / (n * colW), (sb.height - 144) / Math.max(1, Math.max(...heights)));
      let n = 1, best = stack(1);
      for (let k = 2; k <= Math.min(8, ids.length); k++) { const t = stack(k); if (zoomOf(k, t.heights) > zoomOf(n, best.heights)) { n = k; best = t; } }
      const heights = best.heights;
      for (const [id, p] of best.at) out.set(id, p);
      return { out, width: n * colW, bottom: Math.max(...heights) };
    }
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
  // A frame that changes width keeps its place; the frames nobody placed make way, right for a neighbouring column and down for
  // the one below, and go back as it shrinks. Worked out from where each was packed, so the canvas never drifts. Saved positions stay.
  const home = new Map();
  let rearrangeQueued = 0;
  const rearrangeSoon = (id) => { if (!rearrangeQueued) rearrangeQueued = requestAnimationFrame(() => { rearrangeQueued = 0; rearrange(id); }); };
  function rearrange(changed) {
    if (!laidOut) return;
    const z = view.get().z, gapX = MASONRY_GAP;
    const list = sections.all().filter(([, s]) => s.pos).map(([id, s]) => { if (!home.has(id)) home.set(id, { ...s.pos }); return { id, s, h: home.get(id) }; }).sort((a, b) => a.h.x - b.h.x || a.h.y - b.h.y);
    const done = []; let moved = false;
    for (const { id, s, h } of list) {
      let x = id === changed || !auto.has(id) ? s.pos.x : h.x, y = id === changed || !auto.has(id) ? s.pos.y : h.y;
      const w = s.size.w, ht = s.size.h, top = headBox(s, z).top;
      if (id !== changed && auto.has(id)) for (let tries = 0; tries < 40; tries++) {
        const a = done.find((o) => x < o.x + o.w + 24 && x + w + 24 > o.x && y - 30 < o.y + o.h + o.pad && y + ht > o.y - 30); // (the title above; below the frame in hand, its caption too)
        if (!a) break;
        if (a.hx < h.x - 1) x = a.x + a.w + gapX; else y = a.y + a.h + a.pad + Math.min(top, 60);
      }
      if (x !== s.pos.x || y !== s.pos.y) { moveTo(id, x, y); moved = true; }
      done.push({ x, y, w, h: ht, hx: h.x, pad: id === changed ? 26 : 0 });
    }
    if (moved) { refreshOverlays(); ctx.emit('layout', {}); }
  }
  function layoutAll() {
    home.clear();
    const ids = sections.all().map(([k]) => k);
    // Frames placed one by one while the first renders were still on their way were placed by a placeholder size; now that
    // the sizes are known, the ones without a saved position are packed once, together (WPC-23: no overlaps after a reload).
    for (const id of ids) if (!placed(id)) auto.delete(id);
    // Frames not drawn yet (far off screen on a big canvas) have no size of their own: each is given room for a large one of the sizes
    // measured so far (the 90th percentile), so drawing it later rarely needs more room than it was given and nothing has to move.
    const real = ids.filter((id) => { const x = sections.get(id); return !x.pending && x.size.w > 0 && !x.frame.querySelector('.bundle-pending'); });
    const pend = ids.filter((id) => !ctx.state.components.get(id)?.item && !placed(id) && sections.get(id).pending);
    if (pend.length && real.length >= 3) {
      const p90 = (vals) => vals.sort((a, b) => a - b)[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
      const est = { w: p90(real.map((id) => sections.get(id).size.w)), h: p90(real.map((id) => sections.get(id).size.h)) };
      for (const id of pend) { const x = sections.get(id); x.size = { ...est }; x.el.style.setProperty('--nk-w', `${est.w}px`); x.el.style.setProperty('--nk-h', `${est.h}px`); }
    }
    for (const id of ids) if (placed(id)) { const s = ctx.state.components.get(id).canvas; moveTo(id, s.x, s.y); }
    tidy = ids.length <= CULL_AFTER && !pend.length;
    if (tidy) {
      layoutTidy(ids);
      laidOut = true;
      for (const [, x] of sections.all()) revealCard(x);
      world.style.visibility = '';
      ctx.emit('layout', {});
      return;
    }
    const isItem = (id) => !!ctx.state.components.get(id)?.item;
    // Files that are not components are packed after them, so a component never lands somewhere different because other files exist.
    const todo = ids.filter((id) => !placed(id) && !auto.has(id) && !isItem(id)).sort(byName);
    // A folder of hundreds of files opens on its files: they are packed first, grouped by what they are, and the components go after them.
    const bigFolder = ids.length > 150 && ids.filter(isItem).length > ids.length / 2;
    const byKind = (a, b) => (ctx.state.components.get(a)?.kind ?? '').localeCompare(ctx.state.components.get(b)?.kind ?? '') || byName(a, b);
    const todoItems = ids.filter((id) => !placed(id) && !auto.has(id) && isItem(id)).sort(bigFolder ? byKind : byName);
    const taken = ids.filter((id) => placed(id) && !isItem(id));
    if (bigFolder && todoItems.length) {
      const seatedFirst = ids.filter((id) => sections.get(id).pos && !todoItems.includes(id)), first = pack(todoItems, seatedFirst, 0.3); // (room for the titles as they are drawn at the opening zoom)
      for (const id of todoItems) { const p = first.out.get(id); auto.set(id, { x: p.x, y: p.y }); moveTo(id, p.x, p.y); }
      SHELF_W = Math.max(SHELF_W, first.width);
      taken.push(...todoItems);
    }
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
    if (todoItems.length && !bigFolder) {
      const seated = ids.filter((id) => sections.get(id).pos && !todoItems.includes(id)), ir = pack(todoItems, seated, 1);
      for (const id of todoItems) { const p = ir.out.get(id); auto.set(id, { x: p.x, y: p.y }); moveTo(id, p.x, p.y); }
      SHELF_W = Math.max(SHELF_W, ir.width);
    }
    const last = todo.at(-1);
    shelf = last ? { x: res.out.get(last).x + headBox(sections.get(last), z).w + GAP_X, y: res.out.get(last).y, h: sections.get(last).size.h } : { x: 0, y: 0, h: 0 };
    laidOut = true;
    for (const [, x] of sections.all()) revealCard(x);
    world.style.visibility = '';
    ctx.emit('layout', {});
  }
  // The first free slot for a frame of w x h with `top` px of title above it, among `others` (their rectangles, title strips included): the
  // earliest row, then the leftmost place in it, no wider than the shelf. Holes are filled, so a burst of new frames (a branch switch) stays
  // compact and a frame is never put "below everything" (WPC-23: that stacked 40 new files into one tall column that Shift+1 could not fit).
  function freeSlot(w, h, top, others) {
    const hit = (rx, ry) => others.some((o) => rx < o.x + o.w + GAP_X && rx + w + GAP_X > o.x && ry < o.y + o.h + CLEAR && ry + top + h + CLEAR > o.y);
    const xs = [...new Set([0, ...others.map((o) => o.x + o.w + GAP_X)])].sort((p, q) => p - q);
    const ys = [...new Set([0, ...others.map((o) => o.y + o.h + CLEAR)])].filter((v) => v >= 0).sort((p, q) => p - q);
    for (const ry of ys) for (const rx of xs) if ((rx === 0 || rx + w <= SHELF_W) && !hit(rx, ry)) return { x: rx, y: ry + top };
    return { x: 0, y: Math.max(0, ...others.map((o) => o.y + o.h)) + CLEAR + top };
  }
  // A card the stage placed has grown into a neighbour. While the folder is still opening (nothing pressed, clicked or scrolled yet) the
  // tidy layout is worked out again for the real sizes; after that it goes into the first free slot, so nothing else moves.
  let opening = true, retidy = 0;
  for (const e of ['pointerdown', 'keydown', 'wheel']) addEventListener(e, () => { opening = false; }, { capture: true, once: true });
  function reseat(id) {
    if (!(tidy && opening && sections.has(id))) return placeNew(id);
    if (!sections.get(id).pos) placeNew(id); // (somewhere at once; the tidy layout follows)
    clearTimeout(retidy);
    retidy = setTimeout(() => { if (tidy && opening) { layoutTidy(sections.all().map(([k]) => k)); refreshOverlays(); ctx.emit('layout', {}); } }, 60);
  }
  // A component that appears later goes into the first free slot, so nothing else moves.
  function placeNew(id) {
    if (placed(id)) { const s = ctx.state.components.get(id).canvas; moveTo(id, s.x, s.y); return; }
    const me = sections.get(id), z = Math.max(RESERVE_Z, Math.min(1, view.get().z)); // (the room for a title is bounded: a zoomed-out view must not make every new frame's slot huge)
    const others = sections.all().filter(([k, s]) => k !== id && s.pos).map(([k, s]) => { const b = headBox(s, z); return { x: s.pos.x, y: s.pos.y - b.top, w: b.w, h: s.size.h + b.top }; });
    const mine = headBox(me, z), { h } = me.size, w = mine.w;
    SHELF_W = Math.max(SHELF_W, w);
    const { x, y } = freeSlot(w, h, mine.top, others);
    shelf = { x: x + w + GAP_X, y, h };
    auto.set(id, { x, y }); moveTo(id, x, y);
  }

  // ---------------------------------------------------------------------------------------------- ghost frames (WPC-22)
  // A component that does not exist yet (an agent's create proposal) is drawn as a dashed frame with its real rendered cells, in the slot a
  // new component would take (the same search as placeNew, but nothing advances: if it is accepted the real frame lands in this same slot).
  // Ghost frames are not components: no section, no selection, no pointer events. key is the proposal id.
  const ghosts = new Map(); // key -> { el, frame, unmounts, pos, size }
  function ghostSlot(key, size) {
    const z = Math.max(RESERVE_Z, Math.min(1, view.get().z)), lf = Math.min(16, Math.max(1, 1 / z));
    const top = Math.ceil(52 * lf) + CLEAR, w = size.w, h = size.h;
    const others = sections.all().map(([, s]) => s).filter((s) => s.pos).map((s) => { const b = headBox(s, z); return { x: s.pos.x, y: s.pos.y - b.top, w: b.w, h: s.size.h + b.top }; });
    for (const [k, g] of ghosts) if (k !== key && g.pos) others.push({ x: g.pos.x, y: g.pos.y - top, w: g.size.w, h: g.size.h + top });
    SHELF_W = Math.max(SHELF_W, w);
    return freeSlot(w, h, top, others);
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
  // Everything, at zoom z with each label at its size on screen (view.js fitAll); without z, with a 36 unit title strip
  const allRect = (z) => z ? union(sections.all().map(([, sec]) => { if (!sec.pos) return null; const r = labelRoom(sec, z); return { x: sec.pos.x, y: sec.pos.y - r.top, w: Math.max(sec.size.w, r.w), h: sec.size.h + r.top }; })) : union(sections.all().map(([k]) => k).map(componentRect));
  function nodeRect(sel) { live(sel.component); const el = selectedElement(sel); return el ? elementRect(el) : null; }
  const selectionRect = () => (ctx.state.selections.length ? union(ctx.state.selections.map(nodeRect)) : null);
  // The components alone (the work the folder was opened for): fitAll({ work: true }). The first view and Shift+1 show everything.
  const workRect = () => { const own = [...sections.keys()]; return own.length ? union(own.map(componentRect)) : allRect(); };
  view.setFitters({ all: allRect, selection: selectionRect, work: workRect });

  // ---------------------------------------------------------------------------------------------- overlays
  function place(box, target, label, base) {
    if (!target?.isConnected || target.closest('[data-cull]')) { box.style.display = 'none'; return; }
    const r = target.getBoundingClientRect();
    const v = view.get(), sb = view.stageBox();
    cached.set(box, { x: (r.left - sb.left - v.x) / v.z, y: (r.top - sb.top - v.y) / v.z, w: r.width / v.z, h: r.height / v.z, dx: sb.left - base.left, dy: sb.top - base.top, bw: r.width, bh: r.height }); // canvas units, for gestures
    box.style.setProperty('--nk-w', `${r.width}px`); box.style.setProperty('--nk-h', `${r.height}px`); // children are placed with transforms from these, so a new size never shifts layout
    Object.assign(box.style, { display: 'block', transform: `translate(${r.left - base.left}px, ${r.top - base.top}px)`, width: `${r.width}px`, height: `${r.height}px` });
    if (label !== undefined) box.dataset.label = label;
  }
  // While the view is in a wheel or drag gesture the boxes are moved from the geometry measured at the last full refresh (in canvas units):
  // arithmetic and style writes only, no layout read. The full refresh runs again when the gesture settles.
  const cached = new WeakMap();
  let gesturing = false, lastZ = view.get().z;
  function moveOverlays(v) {
    for (const box of [selectBox, hoverBox, ...extras]) {
      const c = box.style.display === 'block' && cached.get(box);
      if (!c) continue;
      // Positioned and sized from the geometry cached in canvas units, at 1x: the outline and the pills are not stretched. (The boxes are layers of their own,
      // so resizing one repaints only itself.)
      const w = c.w * v.z, h = c.h * v.z;
      box.style.transform = `translate(${c.x * v.z + v.x + c.dx}px, ${c.y * v.z + v.y + c.dy}px)`;
      if (w !== c.bw || h !== c.bh) { c.bw = w; c.bh = h; box.style.setProperty('--nk-w', `${w}px`); box.style.setProperty('--nk-h', `${h}px`); box.style.width = `${w}px`; box.style.height = `${h}px`; }
    }
  }
  // WPC-33: the name and size tags sit below the selection box; when that would cover a cell caption (the selected box is at the foot of
  // its cell, so its caption is right below) they sit above it, or (a caption there too) inside its corners. The tags' sizes are estimated from their text (they are pseudo-elements).
  const captionRects = (sec) => {
    const out = [];
    for (const cap of sec ? sec.querySelectorAll('.cell:not(.mhide) figcaption') : []) {
      if (!cap.firstChild) continue;
      const rg = document.createRange(); rg.selectNodeContents(cap);
      const r = rg.getBoundingClientRect();
      if (r.width) out.push(r);
    }
    return out;
  };
  // On a frame of the engine the name and size sit above the box, or below it when that lands on fewer lines of text.
  function docTagSide(selEl) {
    const r = selEl.getBoundingClientRect(), H = 22, lw = Math.min(360, (selectBox.dataset.label || '').length * 6.8 + 18), doc = selEl.el.ownerDocument;
    const frame = selEl.closest('.doc-cell'), fr = frame?.querySelector('iframe.doc-frame')?.getBoundingClientRect(), z = view.get().z;
    if (!fr) return 'above';
    if (z < 0.45) { for (const other of world.querySelectorAll('.cmp[data-chip-top]')) other.removeAttribute('data-chip-top'); return 'none'; } // an overview: the name is in the layers, the frame's title stays readable
    const sec = selEl.closest('section.cmp'), tight = r.top - fr.top < H + 9;
    for (const other of world.querySelectorAll('.cmp[data-chip-top]')) if (other !== sec || !tight) other.removeAttribute('data-chip-top');
    if (tight) sec.setAttribute('data-chip-top', '');
    const lines = [];
    try { const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), rg = doc.createRange(); for (let n = walker.nextNode(), i = 0; n && i < 600; n = walker.nextNode(), i++) { if (!/\S/.test(n.nodeValue)) continue; rg.selectNodeContents(n); for (const c of rg.getClientRects()) lines.push({ l: fr.left + c.left * z, r: fr.left + c.right * z, t: fr.top + c.top * z, b: fr.top + c.bottom * z }); } } catch { return 'above'; }
    const onText = (top) => lines.filter((c) => c.l < r.left + lw && c.r > r.left && c.t < top + H && c.b > top).length;
    selectBox.style.setProperty('--nk-tagw', `${lw + 4 + sizeChip.textContent.length * 6.4 + 14}px`); // a small box: the size goes beside the name, never over the title
    return onText(r.top - 7 - H) <= onText(r.bottom + 7) ? 'above' : 'below';
  }
  function tagSide(selEl) {
    let side = 'below';
    selectBox.toggleAttribute('data-doc', !!selEl?.docFrame);
    if (!selEl?.docFrame) for (const other of world.querySelectorAll('.cmp[data-chip-top]')) other.removeAttribute('data-chip-top');
    if (selectBox.style.display === 'block' && selEl?.docFrame) side = docTagSide(selEl);
    else if (selectBox.style.display === 'block' && selEl?.isConnected && root.dataset.zoomBand === 'near') {
      const caps = captionRects(selEl.closest('section.cmp'));
      if (caps.length) {
        const r = selEl.getBoundingClientRect(), narrow = r.width < 190, lw = Math.min(360, (selectBox.dataset.label || '').length * 6.8 + 18), cw = sizeChip.textContent.length * 6.4 + 14, H = 20, pad = 3;
        const hits = (ys) => { // ys: [label top, chip top]
          const boxes = [{ x: r.left - 1, w: lw, y: ys[0] }, { x: r.right - cw, w: cw, y: ys[1] }];
          return caps.some((c) => boxes.some((b) => c.left < b.x + b.w + pad && c.right > b.x - pad && c.top < b.y + H + pad && c.bottom > b.y - pad));
        };
        const below = [r.bottom + 7, r.bottom + 8 + (narrow ? 24 : 0)], above = [r.top - 7 - H, r.top - 7 - H - (narrow ? 24 : 0)];
        side = !hits(below) ? 'below' : !hits(above) ? 'above' : 'inside'; // (inside the box never meets a caption: they sit outside the cells)
      }
    }
    if (selectBox.dataset.tags !== side) selectBox.dataset.tags = side;
  }
  // How a designer names an element of a file: its tag and first class ("span.ss-note__tag"), never a path through the tree.
  const elementName = (el) => (el ? `${el.localName}${el.id ? `#${el.id}` : ''}${el.classList?.length ? `.${el.classList[0]}` : ''}` : '');
  // The edit being staged, said on the canvas: on the selection's chip ("class scope · 1 of 3") and in the frame's title row.
  let editNote = null;
  function setEditNote(note) { // { component, chip, title } or null
    if (editNote?.component && editNote.component !== note?.component) { const n = sections.get(editNote.component)?.el.querySelector('.cmp-note'); if (n) { n.hidden = true; n.textContent = ''; } }
    editNote = note;
    if (note) { const n = sections.get(note.component)?.el.querySelector('.cmp-note'); if (n) { n.textContent = note.title || ''; n.hidden = !note.title; } }
    refreshOverlays();
  }
  function refreshOverlays() {
    const sels = ctx.state.selections, sel = ctx.state.selection;
    if (!sels.length && !hoverEl && !measuring && !selectBox.style.display.includes('block') && !hoverBox.style.display.includes('block')) return; // nothing is shown, so there is nothing to place (and no layout to force)
    const base = overlays.getBoundingClientRect();
    const selEl = selectedElement(sel);
    place(selectBox, selEl, sel && (selEl?.docFrame ? elementName(selEl.el) + (editNote?.chip ? ` ${editNote.chip}` : '') : `${ctx.state.components.get(sel.component)?.name} · ${sel.node}`), base);
    if (selEl?.isConnected && selectBox.style.display === 'block') { const r = selEl.getBoundingClientRect(), z = view.get().z; sizeChip.textContent = `${Math.round(r.width / z)} × ${Math.round(r.height / z)}`; }
    tagSide(selEl);
    const others = sels.filter((s) => s !== sel);
    while (extras.length < others.length) { const d = document.createElement('div'); d.className = 'overlay-extra'; overlays.append(d); extras.push(d); }
    extras.forEach((d, i) => (others[i] ? place(d, selectedElement(others[i]), undefined, base) : (d.style.display = 'none')));
    const cardSelected = hoverEl?.classList?.contains('frame') && hoverEl.parentElement?.dataset.sel; // a card hovered by its label is not outlined twice once selected
    place(hoverBox, hoverEl && !cardSelected && !sels.some((s) => selectedElement(s) === hoverEl) ? hoverEl : null, undefined, base);
    drawMeasure(base);
    selectBox.dataset.count = String(sels.length);
    ctx.emit('overlays', {});
  }

  // Alt: distance between the selection and the hovered node, in canvas pixels (what the component's CSS sees).
  function drawMeasure(base) {
    const a = measuring && selectedElement(ctx.state.selection), b = measuring && hoverEl;
    measureBox.replaceChildren();
    const nested = a?.docFrame && b?.docFrame && a.el?.ownerDocument === b.el?.ownerDocument && (a.el.contains(b.el) || b.el.contains(a.el)); // inside its own selection the box model says it all
    if (!a || !b || a === b || nested || !a.isConnected || !b.isConnected || a.closest('[data-cull]') || b.closest('[data-cull]')) { measureBox.dataset.active = ''; return; }
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
  const NEAR = 0.05; // viewports of margin: frames inside are drawn, frames outside are not. Every frame drawn costs paint work in every frame that moves the view, so a gesture draws only what comes within this margin (no read-ahead: 4 frames brought in per event made a 1,000-file pan drop frames at 1920x1080) and nothing is taken out until it settles
  let cullQueued = false, cullMode = 'exact'; // 'exact' (settled, or a programmatic move), 'pan' (a wheel or drag pan) or 'zoom' (a wheel or pinch zoom)
  function cull() {
    cullQueued = false;
    const mode = cullMode; cullMode = 'exact';
    const drawn = []; // frames un-culled in this pass
    if (sections.size + sections.items.size <= CULL_AFTER) { for (const [, sec] of sections.all()) if (sec.culled) { sec.culled = false; delete sec.el.dataset.cull; delete sec.el.dataset.far; drawn.push(sec); } if (drawn.length) regrown(drawn); return; }
    const { x, y, z } = view.get(), b = view.stageBox();
    const box = (m) => ({ x0: (-x - b.width * m) / z, x1: (b.width * (1 + m) - x) / z, y0: (-y - b.height * m) / z, y1: (b.height * (1 + m) - y) / z });
    const out = (r, sec) => sec.pos.x > r.x1 || sec.pos.x + sec.size.w < r.x0 || sec.pos.y - 40 > r.y1 || sec.pos.y + sec.size.h < r.y0;
    const near = box(NEAR), far = box(1); // a change of culling costs a layout and a repaint: while panning, what comes within the margin is un-culled at once, and nothing is taken out
    const keep = new Set(ctx.state.selections.map((s) => s.component));
    // A frame of the document engine is a whole page, so they load progressively and under a budget: a few per pass for the frames in view (at fit-all too), never more than
    // DOC_BUDGET at once. When the frames in view want more than the budget, the loaded ones farthest from the view are unloaded (they keep their size and their name).
    const isDocSec = (id) => ctx.state.components.get(id)?.kind === 'html' || ctx.state.components.get(id)?.item;
    let loaded = sections.all().filter(([, x]) => x.docFrame).length, started = 0, wanting = false;
    for (const [id, sec] of sections.all()) {
      if (ctx.state.components.get(id)?.item && z < 0.35 && !keep.has(id)) continue;
      if (z * sec.size.w < 20 && !keep.has(id)) continue; // a frame under 20 screen pixels wide cannot be read: it stays the card of its file's first lines
      if (mode !== 'exact') { /* a gesture (wheel, drag, pinch) is compositor work only: no frame is loaded or unloaded until the view settles */ }
      else if (sec.pending && visible(sec) && isDocSec(id)) {
        const isItem = !!ctx.state.components.get(id)?.item;
        if (!isItem && loaded >= DOC_BUDGET && evictItem(keep)) loaded--;
        if (loaded < DOC_BUDGET && started < DOC_BATCH) { loaded++; started++; render(id, true).catch(console.error); } else wanting = true;
      } else if (sec.pending && visible(sec)) render(id, true).catch(console.error);
    }
    if (wanting) { // unload the farthest loaded frames to make room, then come back for the rest
      const cy = (-y + b.height / 2) / z, cx = (-x + b.width / 2) / z;
      const away = sections.all().filter(([id, sec]) => sec.docFrame && sec.pos && !keep.has(id) && !visible(sec)).sort((p, q) => Math.hypot(q[1].pos.x - cx, q[1].pos.y - cy) - Math.hypot(p[1].pos.x - cx, p[1].pos.y - cy));
      for (const [id, sec] of away.slice(0, DOC_BATCH)) unloadDoc(id, sec);
      setTimeout(() => queueCull(), 120);
    }
    for (const [id, sec] of sections.all()) {
      if (!sec.pos || !sec.size.w) continue;
      let off;
      if (mode !== 'exact') { // a gesture (pan or zoom): nothing is taken out, what comes into view is drawn within a frame
        off = sec.culled;
        if (sec.culled && !out(near, sec)) off = false;
      } else off = !keep.has(id) && out(near, sec);
      if (off !== sec.culled) { sec.culled = off; if (off) sec.el.dataset.cull = '1'; else { delete sec.el.dataset.cull; delete sec.el.dataset.far; drawn.push(sec); } }
      if (mode === 'exact' && sec.culled) { if (out(far, sec)) sec.el.dataset.far = '1'; else delete sec.el.dataset.far; }
    }
    if (mode !== 'exact') titlesNow(view.get()); // frames just drawn get their label scales now
    if (drawn.length) regrown(drawn);
  }
  // The first screenful of a big folder: where Shift+1 would show a map too small to read, a person starts on the first files at a size they can read.
  function openingRect(zoom = 0.3) {
    const cards = sections.all().filter(([, x]) => x.item && x.pos).sort((p, q) => p[1].pos.y - q[1].pos.y || p[1].pos.x - q[1].pos.x);
    if (!cards.length) return null;
    const box = view.stageBox(), { x, y } = cards[0][1].pos;
    return { x, y: y - 36, w: box.width / zoom, h: box.height / zoom };
  }
  const RANK = { zoom: 0, pan: 1, exact: 2 };
  const queueCull = (mode = 'exact') => { if (!cullQueued) cullMode = mode; else if (RANK[mode] > RANK[cullMode]) cullMode = mode; if (!cullQueued) { cullQueued = true; requestAnimationFrame(cull); } };
  ctx.on('view', (v) => {
    if (v.gesture && gesturing) moveOverlays(v); else refreshOverlays();
    const was = lastZ; lastZ = v.z; gesturing = !!v.gesture;
    if (world.dataset.far !== (v.z < 0.1 ? '1' : '')) { if (v.z < 0.1) world.dataset.far = '1'; else delete world.dataset.far; } // far out, a title is under 3 px tall: it is not drawn
    if (v.gesture) titlesNow(v);
    queueCull(v.gesture ? (v.z !== was ? 'zoom' : 'pan') : 'exact');
  });
  // Titles keep a readable size during a gesture: the world's title scale waits for the view to settle, so the titles on screen (a handful) get theirs now, on the element.
  // Labels keep a bounded size during a gesture: the world's title and label scales wait for the view to settle, so the frames on screen (a handful) get theirs on
  // the element as soon as a scale is more than LABEL_STEP off, and give it back on settle. (A transform, not layout: nothing shifts.)
  const LABEL_STEP = 1.4, titled = new Set();
  function titlesNow(v) {
    const lf = view.labelScale(v.z), ls = view.labelScaleLs(v.z), slf = view.settledLabelScale(), sls = view.settledLabelScaleLs();
    if (lf === slf && ls === sls && !titled.size) return;
    const b = view.stageBox(), m = 0; // (only the titles on screen: each one restyled is paint work in this frame; one that comes into view gets its scale on the next event)
    const x0 = (-v.x - b.width * m) / v.z, x1 = (b.width * (1 + m) - v.x) / v.z, y0 = (-v.y - b.height * m) / v.z, y1 = (b.height * (1 + m) - v.y) / v.z;
    const off = (a, h) => Math.max(a / h, h / a) >= LABEL_STEP;
    for (const [, sec] of sections.all()) {
      if (sec.culled || !sec.pos || !sec.size.w) continue;
      if (sec.pos.x > x1 || sec.pos.x + sec.size.w < x0 || sec.pos.y - 40 * lf > y1 || sec.pos.y + sec.size.h < y0) continue;
      if (off(lf, sec.headLf ?? slf)) { const head = sec.el.querySelector('.cmp-head'); if (head) { head.style.setProperty('--nk-lf', String(lf)); sec.headLf = lf; titled.add(sec); } }
      if (off(ls, sec.chipLs ?? sls)) { sec.el.style.setProperty('--nk-ls', String(ls)); sec.chipLs = ls; titled.add(sec); }
    }
  }
  ctx.on('viewsettle', () => { for (const sec of titled) { sec.el.querySelector('.cmp-head')?.style.removeProperty('--nk-lf'); sec.el.style.removeProperty('--nk-ls'); sec.headLf = undefined; sec.chipLs = undefined; } titled.clear(); if (gesturing) { gesturing = false; refreshOverlays(); } queueCull('exact'); });
  ctx.on('select', () => {
    for (const [gid, gsec] of sections) if (gsec.docFrame) gsec.docFrame.grip.tabIndex = ctx.state.selections.some((q) => q.component === gid) ? 0 : -1; // only the selected frame's grip is a Tab stop
    for (const s of ctx.state.selections) live(s.component);
    const on = new Set(ctx.state.selections.map((s) => s.component));
    for (const [id, sec] of sections.all()) { if (on.has(id)) sec.el.dataset.sel = '1'; else delete sec.el.dataset.sel; }
    const n = ctx.state.selections.length;
    selectBox.dataset.more = String(n - 1);
    refreshOverlays();
  });
  ctx.on('layout', () => queueCull());

  // ---------------------------------------------------------------------------------------------- pointer: hover, click, marquee, frame drag
  // Figma's selection model in a document frame (standards section 5). The card is <body> (or <html>); its direct children are
  // the top level. A click picks the element under the pointer at the level of the selection (the children of the selected
  // element's parent, when that parent is inside the card), else at the top level; Ctrl/Cmd picks the deepest one.
  const CARD = new Set(['html', 'head', 'body']);
  function pathTo(id, node) { // the tree nodes from the root down to node, or null
    const t = sections.get(id)?.docFrame?.tree()?.tree;
    const walk = (list, up) => { for (const n of list || []) { const p = [...up, n]; if (n.node === node) return p; const r = walk(n.children, p); if (r) return r; } return null; };
    return t ? walk(t, []) : null;
  }
  function pickNode(id, node, { deep = false } = {}) {
    const path = !deep && pathTo(id, node);
    if (!path) return node;
    let card = -1; path.forEach((n, i) => { if (CARD.has(n.tag)) card = i; });
    if (card === path.length - 1) return node; // the card itself (its empty part)
    const s = ctx.state.selections.find((x) => x.component === id), sp = s && pathTo(id, s.node), parent = sp && sp.length > 1 ? sp[sp.length - 2] : null;
    if (parent && !CARD.has(parent.tag)) { const i = path.indexOf(path.find((n) => n.node === parent.node)); if (i >= 0 && path[i + 1]) return path[i + 1].node; }
    return path[card + 1].node;
  }
  // Double-click: one level in from the selection toward node (null when the selection is the deepest there, or not on its way)
  function deeper(id, node) {
    const s = ctx.state.selections.length === 1 && ctx.state.selection, path = s?.component === id && pathTo(id, node);
    if (!path) return null;
    const i = path.findIndex((n) => n.node === s.node);
    return i >= 0 && path[i + 1] ? path[i + 1].node : null;
  }
  // Escape: the selection's parent, the card from the top level, null from the card (or outside a document frame)
  function upOf(sel) {
    const path = sel && sections.get(sel.component)?.docFrame && pathTo(sel.component, sel.node);
    if (!path || path.length < 2 || CARD.has(path.at(-1).tag)) return null;
    return path.at(-2).node;
  }
  const hit = (target, ev) => {
    const el = target.closest?.('.mount [data-n]');
    const cell = el?.closest('.cell');
    if (!el && ev && !document.body.dataset.play) { // an HTML component's frame: hit-test the document inside it
      const dc = target.closest?.('.doc-cell');
      const id = dc?.closest('.cmp, .item-card')?.dataset.component;
      const f = id && sections.get(id)?.docFrame;
      let p = f?.pick(ev.clientX, ev.clientY);
      if (p) { const n = pickNode(id, p.dataset.n, { deep: ev.ctrlKey || ev.metaKey }); if (n !== p.dataset.n) p = f.element(n) || p; }
      p = p || (id && ctx.state.components.get(id)?.item ? dc : null);
      return p ? { el: p, id, variant: {}, doc: !!f } : null;
    }
    return el && cell && { el, id: cell.closest('.cmp, .item-card').dataset.component, variant: JSON.parse(cell.dataset.variant) };
  };
  // Clicking a component's own button must select it, not focus it (Enter and Space would then press it).
  root.addEventListener('mousedown', (ev) => { if (!document.body.dataset.play && ev.target.closest('.mount')) { ev.preventDefault(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } });
  const setHoverEl = (el, h) => { hoverEl = el; ctx.emit('hover', h ? { component: h.id, node: h.el.dataset.n } : null); refreshOverlays(); };
  root.addEventListener('mouseover', (ev) => {
    if (document.body.dataset.play) return;
    // over a card's label: the whole card is outlined, as when the pointer is on it (standards 3, States); not when it is selected already
    const head = ev.target.closest?.('.cmp-head');
    if (head) { const card = head.parentElement; setHoverEl(card.dataset.sel ? null : card.querySelector(':scope > .frame'), null); return; }
    const h = hit(ev.target, ev); setHoverEl(h?.el ?? null, h);
  });
  root.addEventListener('mousemove', (ev) => { if (document.body.dataset.play || !ev.target.closest?.('.doc-cell')) return; const h = hit(ev.target, ev); if ((h?.el ?? null) !== hoverEl) setHoverEl(h?.el ?? null, h); });
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
    const h = hit(ev.target, ev);
    if (h) ev.preventDefault();
    if (ev.target.closest?.('.cmp-head, .build-error, [data-nodrag]')) return; // handled by the frame drag (a click on a title selects the component's root)
    if (!h) { if (!ev.target.closest?.('#error')) ctx.select(null); return; }
    const sel = { component: h.id, node: h.el.dataset.n, variant: h.variant };
    if (ev.shiftKey || (!h.doc && (ev.metaKey || ev.ctrlKey))) ctx.toggle(sel); else ctx.select(sel); // in a document frame Ctrl/Cmd picks the deepest (hit), Shift adds
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
    const id = (head || body).closest('.cmp, .item-card').dataset.component, sec = sections.get(id);
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
      else if (d.title && c?.item) ctx.select({ component: d.id, node: 'item', variant: {} });
      else if (d.title && c?.kind === 'html') { const t = sections.get(d.id)?.docFrame?.tree(); const body = (function find(l) { for (const n of l || []) { if (n.tag === 'body') return n; const f = find(n.children); if (f) return f; } return null; })(t?.tree); const first = body?.children[0] || body || t?.tree?.[0]; if (first) ctx.select({ component: d.id, node: first.node, variant: {} }); }
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
      const r = c?.item
        ? await ctx.fetch('/api/item-layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: d.id, x: pos.x, y: pos.y }) })
        : c?.kind === 'html' // the document engine keeps the layout outside the folder (decision 0013); a move is one undo step (standards 3.8)
        ? await ctx.fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: d.id, x: pos.x, y: pos.y, undo: true }) })
        : await ctx.fetch(`/api/components/${encodeURIComponent(d.id)}/canvas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pos) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    } catch (e) { document.querySelector('#error').textContent = `Could not save the position: ${plain(e.message)}`; }
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
    pickNode, deeper, upOf, pathTo, rootNode: (id) => { const f = sections.get(id)?.docFrame, t = f?.tree()?.tree; if (!t) return null; const body = (function find(l) { for (const n of l) { if (n.tag === 'body') return n; const r = find(n.children); if (r) return r; } return null; })(t); const list = body ? body.children : t; const n = list.find((x) => !['script', 'style', 'template', 'link', 'meta'].includes(x.tag) && f.has(x.node)); return n?.node ?? null; }, rearrange, setEditNote, reveal, applyPreview, measureAll: (id) => { const sec = sections.get(id); if (sec) measure(sec); }, hoverNode, render, remove, header, refreshOverlays, layoutAll, placeNew, moveTo, putAt, ghostFrame, removeGhost, ghostRect, ghostKeys, reslotGhosts, cull: () => queueCull(),
    openingRect, componentRect, allRect, selectionRect, nodeRect, cellElement, selectedElement, live,
    sections, position: (id) => sections.get(id)?.pos ?? null,
  };
}
