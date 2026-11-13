// Groups and run sections drawn on the canvas (D5). Every group an agent sets on the board and every run's own section
// becomes a labelled region behind the cards it holds, and "Arrange by run" packs each section's cards together.
// Data: GET /api/board (groups, runs, arrange), refreshed on the board and run frames.
import { h } from './drawer.js';

const PAD = 28, GAP = 36, SECTION_GAP = 160, ROW_W = 2600;

export function initRunGroups(ctx) {
  const world = document.querySelector('#world');
  if (!world) return;
  // The layer exists only while there is a region to draw: a canvas with no runs or groups has nothing added to it.
  let layer = null;
  let board = { groups: [], runs: [], arrange: { by: 'kind' } }, raf = 0, timer = 0;

  const flat = (groups, out = []) => { for (const g of groups ?? []) { out.push(g); flat(g.groups, out); } return out; };
  const frameOf = (id) => { for (const el of world.querySelectorAll('[data-item-id]')) if (el.dataset.itemId === id) return el; return null; };
  const rectOf = (el) => ({ x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: el.offsetWidth, h: el.offsetHeight });
  const sections = () => [...(board.runs ?? []).map((r) => ({ ...r, kind: 'run' })), ...flat(board.groups).map((g) => ({ ...g, kind: 'group' }))];

  async function load() {
    try { board = await (await fetch('/api/board')).json(); } catch { return; }
    if (board.arrange?.by === 'run' && lastArranged !== board.revision) { lastArranged = board.revision; arrange(); }
    draw();
  }
  let lastArranged = null;
  const soon = (ms = 120) => { clearTimeout(timer); timer = setTimeout(load, ms); };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  function draw() {
    const boxes = [];
    for (const s of sections()) {
      const rects = s.items.map((id) => frameOf(id)).filter(Boolean).map(rectOf).filter((r) => r.w > 0);
      if (!rects.length) continue;
      const x0 = Math.min(...rects.map((r) => r.x)) - PAD, y0 = Math.min(...rects.map((r) => r.y)) - PAD - 34;
      const x1 = Math.max(...rects.map((r) => r.x + r.w)) + PAD, y1 = Math.max(...rects.map((r) => r.y + r.h)) + PAD;
      boxes.push(h('div', { class: 'rg-box', 'data-kind': s.kind, 'data-group': s.id, style: `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px` },
        h('span', { class: 'rg-label' }, h('b', { text: s.name }), h('small', { text: `${s.items.length} item${s.items.length === 1 ? '' : 's'}` }))));
    }
    if (!boxes.length) { layer?.remove(); layer = null; return; }
    if (!layer) { layer = h('div', { id: 'run-groups', 'aria-hidden': 'true' }); world.prepend(layer); }
    layer.replaceChildren(...boxes);
  }

  // Pack every section's cards into its own block, blocks stacked below everything that belongs to no section.
  async function arrange() {
    const secs = sections().filter((s) => s.items.some((id) => frameOf(id)));
    if (!secs.length) return;
    const owned = new Set(secs.flatMap((s) => s.items));
    const others = [...world.querySelectorAll('[data-item-id]')].filter((el) => !owned.has(el.dataset.itemId)).map(rectOf);
    let y = others.length ? Math.max(...others.map((r) => r.y + r.h)) + SECTION_GAP : 0;
    const x0 = others.length ? Math.min(...others.map((r) => r.x)) : 0, placed = new Set(), moves = [];
    for (const s of secs) {
      const els = s.items.filter((id) => !placed.has(id)).map(frameOf).filter(Boolean);
      if (!els.length) continue;
      let x = x0, rowH = 0, top = y + 40;
      for (const el of els) {
        const r = rectOf(el);
        if (x > x0 && x + r.w > x0 + ROW_W) { x = x0; top += rowH + GAP; rowH = 0; }
        ctx.stage.moveTo(el.dataset.itemId, Math.round(x), Math.round(top)); moves.push({ item: el.dataset.itemId, x: Math.round(x), y: Math.round(top) });
        placed.add(el.dataset.itemId); x += r.w + GAP; rowH = Math.max(rowH, r.h);
      }
      y = top + rowH + SECTION_GAP;
    }
    ctx.stage.refreshOverlays?.(); draw();
    for (const m of moves) ctx.fetch('/api/item-layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {});
    ctx.emit('layout', {});
  }

  ctx.on('run-frame', (f) => { if (f.type === 'board' ? f.fields?.some((k) => k === 'groups' || k === 'arrange') : /^run-(artifact|start|proposal)/.test(f.type)) soon(); });
  for (const e of ['layout', 'moved', 'items-changed', 'render', 'added', 'removed', 'view']) ctx.on(e, redraw);
  ctx.on('connection', (f) => { if (f.connected) soon(0); });
  const cmds = [{ id: 'board.arrange-run', title: 'Arrange by run', keys: '', group: 'Agents', run: () => load().then(arrange) }];
  if (typeof ctx.registerCommands === 'function') ctx.registerCommands(cmds); else (window.napkinCommandQueue ||= []).push(...cmds);
  ctx.runGroups = { arrange: () => load().then(arrange), redraw: load };
  load();
}
