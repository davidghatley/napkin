// The layers tree (CAN-04): every component, and under it the JSX tree of its nodes, as the file has it.
// Selection syncs both ways. Rename (F2 / double-click) is one `rename` edit; dragging a row is one `move`.
import { index, VOID } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ICON = {
  frame: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  text: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M2.5 3.5v-1h9v1M7 2.5v9M5.2 11.5h3.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><rect x="1.8" y="2.3" width="10.4" height="9.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="m2.5 10 3-3.2 2.2 2.2 1.4-1.4 2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
  button: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><rect x="1.5" y="4" width="11" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  component: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M7 1.6 12.4 7 7 12.4 1.6 7z" fill="currentColor" opacity=".9"/></svg>',
};
const iconFor = (n) => (n.tag === 'img' ? ICON.image : n.tag === 'button' ? ICON.button : n.children.length || !(n.text !== undefined || n.textProp) ? ICON.frame : ICON.text);
const holdsText = (n) => n.text !== undefined || !!n.textProp;
const canHold = (n) => !holdsText(n) && !VOID.has(n.tag);

export function initLayers(ctx, el) {
  const expanded = new Set();          // component ids showing their nodes
  const folded = new Set();            // "component|node" rows whose children are hidden
  let queued = false, renaming = null, dragging = null, reveal = false;

  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
  const selKey = (s) => `${s.component}|${s.node}`;
  const selected = () => new Set(ctx.state.selections.map(selKey));
  const baseVariant = (c) => Object.fromEntries((c.doc?.props || []).filter((p) => p.type === 'enum').map((a) => [a.name, a.default]));

  function draw() {
    if (renaming || dragging) return;
    const sel = selected(), prim = ctx.state.selection;
    const comps = [...ctx.state.components.values()].sort((a, b) => a.name.localeCompare(b.name));
    const rows = [];
    for (const c of comps) {
      const open = expanded.has(c.component);
      const has = ctx.state.selections.some((s) => s.component === c.component);
      rows.push(`<div class="lrow lcomp${has ? ' has-sel' : ''}" role="treeitem" aria-level="1" aria-expanded="${open}" aria-selected="${has && sel.has(`${c.component}|${c.doc?.root.id}`)}" data-component="${esc(c.component)}" data-kind="component" tabindex="-1" style="--d:0"><span class="twirl" aria-hidden="true">${open ? '▾' : '▸'}</span><span class="licon">${ICON.component}</span><span class="lname">${esc(c.name)}</span>${c.readOnly ? '<span class="ltag">read-only</span>' : ''}</div>`);
      if (!open || !c.doc) continue;
      (function walk(n, depth) {
        const k = `${c.component}|${n.id}`, kids = n.children.length, isFolded = folded.has(k);
        rows.push(`<div class="lrow lnode${sel.has(k) ? ' selected' : ''}${prim && selKey(prim) === k ? ' primary' : ''}" role="treeitem" aria-level="${depth + 1}"${kids ? ` aria-expanded="${!isFolded}"` : ''} aria-selected="${sel.has(k)}" data-component="${esc(c.component)}" data-node="${esc(n.id)}" data-kind="node" tabindex="-1" style="--d:${depth}"><span class="twirl" aria-hidden="true">${kids ? (isFolded ? '▸' : '▾') : ''}</span><span class="licon">${iconFor(n)}</span><span class="lname">${esc(n.id)}</span><span class="ltag">${esc(n.tag)}${n.textProp ? ` {${esc(n.textProp)}}` : ''}</span></div>`);
        if (!isFolded) n.children.forEach((x) => walk(x, depth + 1));
      })(c.doc.root, 1);
    }
    el.innerHTML = rows.join('') || '<p class="empty">No components yet. Press N to draw one.</p>';
    if (rows.length) el.setAttribute('role', 'tree'); else el.removeAttribute('role'); // an empty tree is not a tree
    const tab = el.querySelector('.primary') || el.querySelector('.has-sel') || el.querySelector('.lrow');
    if (tab) tab.tabIndex = 0;
    if (reveal) { reveal = false; el.querySelector('.primary')?.scrollIntoView({ block: 'nearest' }); } // only when the selection changed, never on an edit
  }

  // ---- selection from the tree ----
  function pick(row, ev) {
    const c = ctx.state.components.get(row.dataset.component);
    if (!c?.doc) return;
    const node = row.dataset.node || c.doc.root.id;
    const cur = ctx.state.selection;
    const sel = { component: c.component, node, variant: cur?.component === c.component ? cur.variant : baseVariant(c) };
    if (row.dataset.node && (ev?.shiftKey || ev?.metaKey || ev?.ctrlKey)) ctx.toggle(sel); else ctx.select(sel);
  }
  el.addEventListener('click', (ev) => {
    if (suppress) { suppress = false; return; }
    const row = ev.target.closest('.lrow');
    if (!row || ev.target.closest('input')) return;
    if (ev.target.closest('.twirl')) {
      if (row.dataset.kind === 'component') { const id = row.dataset.component; expanded.has(id) ? expanded.delete(id) : expanded.add(id); }
      else { const k = `${row.dataset.component}|${row.dataset.node}`; folded.has(k) ? folded.delete(k) : folded.add(k); }
      draw(); return;
    }
    if (row.dataset.kind === 'component') expanded.add(row.dataset.component);
    pick(row, ev);
    el.querySelector('.primary')?.focus({ preventScroll: true });
  });
  el.addEventListener('dblclick', (ev) => {
    const row = ev.target.closest('.lrow');
    if (!row) return;
    if (row.dataset.kind === 'component') { const r = ctx.stage.componentRect(row.dataset.component); if (r) ctx.view.flyTo(r, { pad: 88, max: 2 }); }
    else startRename(row);
  });

  // ---- hover: the row and the element light each other up ----
  el.addEventListener('mouseover', (ev) => {
    const row = ev.target.closest('.lrow[data-node]');
    ctx.stage?.hoverNode(row ? { component: row.dataset.component, node: row.dataset.node } : null);
  });
  el.addEventListener('mouseleave', () => ctx.stage?.hoverNode(null));
  ctx.on('hover', (h) => {
    el.querySelector('.hot')?.classList.remove('hot');
    if (h) el.querySelector(`.lrow[data-component="${CSS.escape(h.component)}"][data-node="${CSS.escape(h.node)}"]`)?.classList.add('hot');
  });

  // ---- rename ----
  function startRename(row) {
    const c = ctx.state.components.get(row.dataset.component);
    if (!c || c.readOnly || !row.dataset.node) return;
    const old = row.dataset.node;
    const name = row.querySelector('.lname');
    const input = document.createElement('input');
    input.className = 'lrename'; input.value = old; input.setAttribute('aria-label', `Rename ${old}`); input.spellcheck = false;
    name.replaceWith(input);
    renaming = { row, old };
    input.focus(); input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      const to = input.value.trim();
      renaming = null;
      if (commit && to && to !== old) {
        const r = await ctx.sendEdits(c.component, [{ op: 'rename', id: old, to }]);
        if (r.ok) {
          const cur = ctx.state.selections.map((s) => (s.component === c.component && s.node === old ? { ...s, node: to } : s));
          ctx.selectMany(cur);
        }
      }
      draw();
      el.querySelector('.primary')?.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---- keyboard ----
  el.addEventListener('keydown', (ev) => {
    const row = ev.target.closest?.('.lrow');
    if (!row || ev.target.matches('input')) return;
    const rows = [...el.querySelectorAll('.lrow')], i = rows.indexOf(row);
    const go = (r) => { if (r) { ev.preventDefault(); pick(r); requestAnimationFrame(() => el.querySelector('.primary, .lcomp.has-sel')?.focus({ preventScroll: false })); } };
    if (ev.key === 'ArrowDown') go(rows[i + 1]);
    else if (ev.key === 'ArrowUp') go(rows[i - 1]);
    else if (ev.key === 'ArrowRight' && row.getAttribute('aria-expanded') === 'false') { ev.preventDefault(); row.querySelector('.twirl').click(); }
    else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      if (row.getAttribute('aria-expanded') === 'true') row.querySelector('.twirl').click();
      else { const lvl = Number(row.getAttribute('aria-level')); go(rows.slice(0, i).reverse().find((r) => Number(r.getAttribute('aria-level')) < lvl)); }
    } else if (ev.key === 'F2') { ev.preventDefault(); startRename(row); }
    else if (ev.key === 'Enter') { ev.preventDefault(); pick(row); ctx.nav?.focus(row.dataset.component, row.dataset.node); }
  });

  // ---- drag to reorder ----
  let suppress = false;
  const line = document.createElement('div');
  line.className = 'ldrop'; line.hidden = true;
  el.addEventListener('pointerdown', (ev) => {
    const row = ev.target.closest('.lrow[data-kind="node"]');
    if (!row || ev.button !== 0 || ev.target.closest('input')) return;
    const c = ctx.state.components.get(row.dataset.component);
    if (!c?.doc || c.readOnly || row.dataset.node === c.doc.root.id) return;
    dragging = { row, x: ev.clientX, y: ev.clientY, active: false, drop: null, component: c.component, node: row.dataset.node };
  });
  addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    if (!dragging.active) {
      if (Math.hypot(ev.clientX - dragging.x, ev.clientY - dragging.y) < 5) return;
      dragging.active = true; document.body.dataset.dragging = 'layer';
      dragging.row.classList.add('dragging'); el.append(line);
    }
    dragging.drop = dropAt(ev.clientX, ev.clientY);
    showDrop(dragging.drop);
  });
  function dropAt(x, y) {
    const t = document.elementFromPoint(x, y)?.closest?.('.lrow[data-kind="node"]');
    const c = ctx.state.components.get(dragging.component);
    if (!t || !c?.doc || t.dataset.component !== dragging.component) return null;
    const { byId, parentOf } = index(c.doc);
    const node = byId.get(dragging.node), target = byId.get(t.dataset.node);
    for (let p = target; p; p = parentOf.get(p.id)) if (p === node) return null; // not into itself
    const r = t.getBoundingClientRect(), f = (y - r.top) / r.height;
    let mode = f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'inside';
    if (mode === 'inside' && !canHold(target)) mode = f < 0.5 ? 'before' : 'after';
    if (mode !== 'inside' && !parentOf.get(target.id)) { if (!canHold(target)) return null; mode = 'inside'; }
    let parent, at;
    if (mode === 'inside') { parent = target; at = target.children.length; }
    else { parent = parentOf.get(target.id); at = parent.children.findIndex((x) => x.id === target.id) + (mode === 'after' ? 1 : 0); }
    if (!canHold(parent)) return null;
    const from = parent.children.findIndex((x) => x.id === node.id);
    if (from >= 0 && from < at) at -= 1; // the dragged node leaves its old slot first
    const sameParent = parentOf.get(node.id) === parent;
    if (sameParent && from === at) return { row: t, mode, noop: true };
    return { row: t, mode, parent: parent.id, index: at };
  }
  function showDrop(d) {
    el.querySelectorAll('.drop-into').forEach((r) => r.classList.remove('drop-into'));
    line.hidden = true;
    if (!d || d.noop) return;
    if (d.mode === 'inside') { d.row.classList.add('drop-into'); return; }
    const b = el.getBoundingClientRect(), r = d.row.getBoundingClientRect();
    line.hidden = false;
    line.style.top = `${(d.mode === 'before' ? r.top : r.bottom) - b.top + el.scrollTop - 1}px`;
    line.style.left = `${Number(d.row.style.getPropertyValue('--d')) * 14 + 22}px`;
  }
  addEventListener('pointerup', async () => {
    if (!dragging) return;
    const d = dragging; dragging = null;
    delete document.body.dataset.dragging; d.row.classList.remove('dragging'); line.remove(); line.hidden = true;
    el.querySelectorAll('.drop-into').forEach((r) => r.classList.remove('drop-into'));
    if (!d.active) return;
    suppress = true; setTimeout(() => { suppress = false; }, 50);
    if (d.drop && !d.drop.noop) await ctx.sendEdits(d.component, [{ op: 'move', id: d.node, parent: d.drop.parent, index: d.drop.index }]);
    draw();
  });
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && dragging?.active) { dragging.row.classList.remove('dragging'); dragging = null; line.remove(); delete document.body.dataset.dragging; draw(); } }, true);

  // ---- keep in step ----
  ctx.on('select', () => { for (const s of ctx.state.selections) expanded.add(s.component); reveal = true; schedule(); });
  for (const e of ['render', 'removed', 'added']) ctx.on(e, schedule);
  let seeded = false; // a small repo opens fully expanded, once
  ctx.on('render', () => { if (!seeded && ctx.state.components.size <= 8) { seeded = true; for (const id of ctx.state.components.keys()) expanded.add(id); } });
  return { redraw: draw, expand: (id) => expanded.add(id) };
}
