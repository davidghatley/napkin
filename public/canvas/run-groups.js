// Runs and groups drawn on the canvas (D5). Each run is one region behind its cards, with a header that says how far along it is;
// every group an agent sets is a region inside the run that holds its files (or on its own), labelled so no two labels overprint.
// "Arrange by run" packs each run's cards together and keeps its groups as blocks inside the run.
// "Fit to run" (and, until the person moves the view themselves, every file that lands) frames the newest run.
// Data: GET /api/board (groups, runs with status and progress, arrange), refreshed on the board and run frames.
// Nothing is added to the page until there is a run or a group to draw.
import { h } from './drawer.js';

const PAD = 28, GAP = 36, BLOCK_GAP = 110, ROW_W = 2600, LABEL = 34, TITLE = 22;

export function initRunGroups(ctx) {
  const world = document.querySelector('#world');
  if (!world) return;
  let layer = null;
  let board = { groups: [], runs: [], arrange: { by: 'kind' } }, raf = 0, timer = 0, follow = true, lastArranged = null, boxes = new Map();

  const flat = (groups, out = []) => { for (const g of groups ?? []) { out.push(g); flat(g.groups, out); } return out; };
  const frameOf = (id) => { for (const el of world.querySelectorAll('[data-item-id]')) if (el.dataset.itemId === id) return el; return null; };
  const rectOf = (el) => ({ x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: el.offsetWidth, h: el.offsetHeight });
  const sections = () => [...(board.runs ?? []).map((r) => ({ ...r, kind: 'run' })), ...flat(board.groups).map((g) => ({ ...g, kind: 'group' }))];
  // Titles grow as the view zooms out so they stay readable; the room they need grows with them.
  const labelScale = () => Number(world.dataset.ls || 1);
  const union = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

  async function load() {
    try { board = await (await fetch('/api/board')).json(); } catch { return; }
    if (board.arrange?.by === 'run' && lastArranged !== board.revision) { lastArranged = board.revision; arrange(); }
    draw();
  }
  const soon = (ms = 120) => { clearTimeout(timer); timer = setTimeout(load, ms); };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  // The sections that sit inside another one: a group whose files all belong to a run (or to a bigger group) is drawn inside it.
  function containment(secs) {
    const sets = new Map(secs.map((s) => [s, new Set(s.items.filter((id) => frameOf(id)))]));
    const inside = (a, b) => { // is b drawn inside a?
      const A = sets.get(a), B = sets.get(b);
      if (a === b || !B.size || ![...B].every((id) => A.has(id))) return false;
      return B.size < A.size || (a.kind === 'run' && b.kind === 'group');
    };
    return { sets, kids: new Map(secs.map((a) => [a, secs.filter((b) => inside(a, b))])) };
  }

  function layout() {
    const secs = sections(), { sets, kids } = containment(secs), head = LABEL * labelScale(), out = new Map();
    const order = [...secs].sort((a, b) => sets.get(a).size - sets.get(b).size || (a.kind === 'run') - (b.kind === 'run'));
    for (const s of order) {
      const rects = [...sets.get(s)].map((id) => rectOf(frameOf(id))).filter((r) => r.w > 0);
      for (const k of kids.get(s)) if (out.has(k)) rects.push(out.get(k));
      if (!rects.length) continue;
      const u = union(rects);
      out.set(s, { x: u.x - PAD, y: u.y - PAD - head - TITLE, w: u.w + 2 * PAD, h: u.h + 2 * PAD + head + TITLE }); // (TITLE: the file name each card wears above it)
    }
    return out;
  }

  function draw() {
    const out = layout(), els = [];
    boxes = new Map();
    for (const [s, rect] of out) {
      boxes.set(s.id, rect);
      const label = [h('b', { text: s.name })];
      if (s.kind === 'run' && s.progress) label.push(h('small', { text: `${s.progress.done} / ${s.progress.total} steps${s.status && s.status !== 'running' ? ` · ${s.status}` : s.progress.current ? ` · ${s.progress.current}` : ''}` }));
      else label.push(h('small', { text: `${s.items.length} item${s.items.length === 1 ? '' : 's'}` }));
      const pct = s.progress?.total ? (s.progress.done / s.progress.total) * 100 : 0;
      els.push(h('div', { class: 'rg-box', 'data-kind': s.kind, 'data-group': s.id, 'data-status': s.status ?? '', style: `left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;--rg-ls:${labelScale()}` },
        h('span', { class: 'rg-label' }, ...label),
        s.kind === 'run' && s.progress?.total ? h('i', { class: 'rg-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${pct}%` })) : null));
    }
    // outer regions first, so an inner one is painted over it
    els.sort((a, b) => (a.dataset.kind === 'run' ? 0 : 1) - (b.dataset.kind === 'run' ? 0 : 1) || parseFloat(b.style.width) - parseFloat(a.style.width));
    if (!els.length) { layer?.remove(); layer = null; return; }
    if (!layer) { layer = h('div', { id: 'run-groups', 'aria-hidden': 'true' }); world.prepend(layer); }
    layer.replaceChildren(...els);
    apartLabels(els);
  }
  // Regions that overlap (groups an agent made from interleaved files) would print their titles on top of each other:
  // measure each title and move it down, inside its own region, until it clears the ones already placed.
  function apartLabels(els) {
    const placed = [];
    for (const box of els) {
      const lab = box.querySelector('.rg-label'); if (!lab) continue;
      const bx = parseFloat(box.style.left), by = parseFloat(box.style.top), w = lab.offsetWidth, hgt = lab.offsetHeight;
      let dy = 0;
      for (let tries = 0; tries < 12; tries++) {
        const r = { x: bx + lab.offsetLeft, y: by + lab.offsetTop + dy, w, h: hgt };
        const hit = placed.find((o) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
        if (!hit) { placed.push(r); break; }
        dy = hit.y + hit.h - (by + lab.offsetTop) + 4;
        if (dy > box.offsetHeight - hgt) { placed.push(r); break; }
      }
      if (dy) { lab.style.top = `calc(6px * var(--rg-ls, 1) + ${dy}px)`; }
    }
  }

  // Pack every run into its own block (its groups as blocks inside it), then loose groups; blocks stack below everything that belongs to no section.
  async function arrange() {
    const secs = sections().filter((s) => s.items.some((id) => frameOf(id)));
    if (!secs.length) return;
    const { sets, kids } = containment(secs);
    const roots = secs.filter((s) => !secs.some((a) => kids.get(a).includes(s)));
    const owned = new Set(secs.flatMap((s) => [...sets.get(s)]));
    const others = [...world.querySelectorAll('[data-item-id]')].filter((el) => !owned.has(el.dataset.itemId)).map(rectOf);
    const head = LABEL * Math.max(3, labelScale()) + PAD; // room for one label level, enough to read when the view is fitted
    const x0 = others.length ? Math.min(...others.map((r) => r.x)) : 0, placed = new Set(), moves = [];
    let y = others.length ? Math.max(...others.map((r) => r.y + r.h)) + BLOCK_GAP + head : 0;

    // a section's own files in rows from `top`; returns the bottom edge
    const rows = (ids, left, top) => {
      let x = left, rowH = 0, t = top;
      for (const id of ids) {
        const r = rectOf(frameOf(id));
        if (x > left && x + r.w > left + ROW_W) { x = left; t += rowH + GAP; rowH = 0; }
        ctx.stage.moveTo(id, Math.round(x), Math.round(t)); moves.push({ item: id, x: Math.round(x), y: Math.round(t) });
        placed.add(id); x += r.w + GAP; rowH = Math.max(rowH, r.h);
      }
      return t + rowH;
    };
    const block = (s, left, top) => { // groups inside it first, one block each, then its other files; returns the bottom edge
      let at = top;
      const direct = kids.get(s).filter((c) => !kids.get(s).some((o) => o !== c && kids.get(o).includes(c)));
      for (const k of direct) {
        if (![...sets.get(k)].some((id) => !placed.has(id))) continue;
        at = block(k, left, at + head) + BLOCK_GAP / 2;
      }
      const rest = [...sets.get(s)].filter((id) => !placed.has(id));
      return rest.length ? rows(rest, left, direct.length ? at + head / 2 : at) : at;
    };
    for (const s of roots) {
      if (![...sets.get(s)].some((id) => !placed.has(id))) continue;
      y = block(s, x0, y + head) + BLOCK_GAP + head;
    }
    ctx.stage.refreshOverlays?.(); draw();
    for (const m of moves) ctx.fetch('/api/item-layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {});
    ctx.emit('layout', {});
    if (follow) fitRun();
  }

  // Frame the newest run: its header and every card in it, at most 100%.
  function fitRun(id) {
    draw();
    const runs = board.runs ?? [];
    const run = id ? runs.find((r) => r.id === id || r.run === id) : [...runs].reverse().find((r) => boxes.has(r.id));
    const rect = run && boxes.get(run.id);
    if (!rect || !ctx.view?.fitRect) return false;
    ctx.view.fitRect(rect, { pad: 56, max: 1, animate: true });
    return true;
  }
  let fitTimer = 0;
  const followSoon = () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { if (follow) load().then(() => { fitRun(); setTimeout(() => { if (follow) fitRun(); }, 700); }); }, 350); }; // (again once the drawer has taken its room)

  ctx.on('run-frame', (f) => {
    if (f.type === 'run-started') follow = true;
    if (f.type === 'board' ? f.fields?.some((k) => k === 'groups' || k === 'arrange') : /^run-(artifact|started|step|status|proposal)/.test(f.type)) soon();
    if (f.type === 'run-artifact' && follow) followSoon();
  });
  // The person moving the view by hand ends following; a fit we asked for is not a gesture.
  ctx.on('view', (v) => { if (v?.gesture) follow = false; redraw(); });
  for (const e of ['layout', 'moved', 'items-changed', 'render', 'added', 'removed', 'viewsettle']) ctx.on(e, redraw);
  ctx.on('connection', (f) => { if (f.connected) soon(0); });
  const cmds = [
    { id: 'board.arrange-run', title: 'Arrange by run', keys: '', group: 'Agents', run: () => load().then(arrange) },
    { id: 'board.fit-run', title: 'Fit to run', keys: '', group: 'Agents', run: () => { follow = true; load().then(() => fitRun()); } },
  ];
  if (typeof ctx.registerCommands === 'function') ctx.registerCommands(cmds); else (window.napkinCommandQueue ||= []).push(...cmds);
  ctx.runGroups = { arrange: () => load().then(arrange), redraw: load, fitRun: (id) => load().then(() => fitRun(id)) };
  load();
}
