// The layers tree (CAN-04): every component, and under it the JSX tree of its nodes, as the file has it.
// Selection syncs both ways. Rename (F2 / double-click) is one `rename` edit; dragging a row is one `move`.
import { index, VOID } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ICON = {
  frame: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  text: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M2.5 3.5v-1h9v1M7 2.5v9M5.2 11.5h3.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><rect x="1.8" y="2.3" width="10.4" height="9.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="m2.5 10 3-3.2 2.2 2.2 1.4-1.4 2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
  button: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><rect x="1.5" y="4" width="11" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  eye: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M1.2 7s2-3.800 5.800-3.800S12.800 7 12.800 7 10.800 10.800 7 10.800 1.200 7 1.200 7z" fill="none" stroke="currentColor" stroke-width="1.200"/><circle cx="7" cy="7" r="1.500" fill="none" stroke="currentColor" stroke-width="1.200"/></svg>',
  eyeoff: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M1.200 7s2-3.800 5.800-3.800S12.800 7 12.800 7 10.800 10.800 7 10.800 1.200 7 1.200 7zM2.500 12l9-10" fill="none" stroke="currentColor" stroke-width="1.200" stroke-linecap="round"/></svg>',
  component: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M7 1.8 12.2 7 7 12.2 1.8 7z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
};
const iconFor = (n) => (n.tag === 'img' ? ICON.image : n.tag === 'button' ? ICON.button : n.children.length || !(n.text !== undefined || n.textProp) ? ICON.frame : ICON.text);
const holdsText = (n) => n.text !== undefined || !!n.textProp;
const canHold = (n) => !holdsText(n) && !VOID.has(n.tag);

export function initLayers(ctx, el) {
  const expanded = new Set();          // component ids showing their nodes
  const folded = new Set();            // "component|node" rows whose children are hidden
  let queued = false, renaming = null, dragging = null, reveal = false, focusKey = null; // focusKey: the row that keeps keyboard focus across a rebuild
  const rowKey = (r) => `${r.dataset.component}|${r.dataset.node ?? ''}`;

  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
  const selKey = (s) => `${s.component}|${s.node}`;
  const selected = () => new Set(ctx.state.selections.map(selKey));
  const baseVariant = (c) => Object.fromEntries((c.doc?.props || []).filter((p) => p.type === 'enum').map((a) => [a.name, a.default]));

  function draw() {
    if (renaming || dragging) return;
    const sel = selected(), prim = ctx.state.selection;
    const comps = [...ctx.state.components.values()].sort((a, b) => a.name.localeCompare(b.name));
    const rows = [];
    const anc = new Set(); // ancestors of every selected node: a quiet trail down to the selection
    for (const sl of ctx.state.selections) { const c0 = ctx.state.components.get(sl.component); if (!c0?.doc) continue; const { parentOf } = index(c0.doc); for (let q = parentOf.get(sl.node); q; q = parentOf.get(q.id)) anc.add(`${sl.component}|${q.id}`); }
    for (const c of comps) {
      const open = expanded.has(c.component);
      const has = ctx.state.selections.some((s) => s.component === c.component);
      rows.push(`<div class="lrow lcomp${has ? ' has-sel' : ''}" role="treeitem" aria-level="1" aria-expanded="${open}" aria-selected="${has && sel.has(`${c.component}|${c.doc?.root.id}`)}" data-component="${esc(c.component)}" data-kind="component" tabindex="-1" style="--d:0"><span class="twirl" aria-hidden="true">${open ? '▾' : '▸'}</span><span class="licon">${ICON.component}</span><span class="lname">${esc(c.name)}</span>${c.readOnly ? '<span class="ltag">read-only</span>' : ''}</div>`);
      if (!open || !c.doc) continue;
      (function walk(n, depth) {
        const k = `${c.component}|${n.id}`, kids = n.children.length, isFolded = folded.has(k);
        rows.push(`<div class="lrow lnode${n.style?.visibility === 'hidden' ? ' hidden-node' : ''}${sel.has(k) ? ' selected' : ''}${prim && selKey(prim) === k ? ' primary' : ''}${anc.has(k) ? ' anc' : ''}" title="${esc(n.id)} · ${esc(n.tag)}${n.textProp ? ' · shows ' + esc(n.textProp) : ''}" role="treeitem" aria-level="${depth + 1}"${kids ? ` aria-expanded="${!isFolded}"` : ''} aria-selected="${sel.has(k)}" data-component="${esc(c.component)}" data-node="${esc(n.id)}" data-kind="node" tabindex="-1" style="--d:${depth}"><span class="lgrip" aria-hidden="true">⠿</span><span class="twirl" aria-hidden="true">${kids ? (isFolded ? '▸' : '▾') : ''}</span><span class="licon">${iconFor(n)}</span><span class="lname">${esc(n.id)}</span><span class="ltag">${esc(n.tag)}${n.textProp ? ` · ${esc(n.textProp)}` : ''}</span><button type="button" class="leye" tabindex="-1" data-action="eye" aria-pressed="${n.style?.visibility === 'hidden'}" aria-label="${n.style?.visibility === 'hidden' ? 'Show' : 'Hide'} ${esc(n.id)}" title="${n.style?.visibility === 'hidden' ? 'Show' : 'Hide'}">${n.style?.visibility === 'hidden' ? ICON.eyeoff : ICON.eye}</button><button type="button" class="lmore" tabindex="-1" data-action="more" aria-label="More actions for ${esc(n.id)}" title="More">⋯</button></div>`);
        if (!isFolded) n.children.forEach((x) => walk(x, depth + 1));
      })(c.doc.root, 1);
    }
    el.innerHTML = rows.join('') || '<p class="empty">No components yet. Press N to draw one.</p>';
    if (rows.length) el.setAttribute('role', 'tree'); else el.removeAttribute('role'); // an empty tree is not a tree
    const tab = el.querySelector('.primary') || el.querySelector('.has-sel') || el.querySelector('.lrow');
    if (tab) tab.tabIndex = 0;
    if (focusKey) {
      const f = [...el.querySelectorAll('.lrow')].find((r) => rowKey(r) === focusKey);
      if (f) { f.tabIndex = 0; f.focus({ preventScroll: true }); }
      focusKey = null;
    }
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
  el.addEventListener('click', async (ev) => {
    if (suppress) { suppress = false; return; }
    const row = ev.target.closest('.lrow');
    if (!row || ev.target.closest('input')) return;
    if (ev.target.closest('.leye')) {
      ev.stopPropagation();
      const c = ctx.state.components.get(row.dataset.component), n = c?.doc && index(c.doc).byId.get(row.dataset.node);
      if (n && !c.readOnly) await ctx.sendEdits(c.component, [{ op: 'set', path: `${n.id}.visibility`, value: n.style?.visibility === 'hidden' ? null : 'hidden' }]);
      return;
    }
    if (ev.target.closest('.lmore')) { ev.stopPropagation(); pick(row); openMenu(ev.target.closest('.lmore')); return; }
    if (ev.target.closest('.twirl')) {
      if (row.dataset.kind === 'component') { const id = row.dataset.component; expanded.has(id) ? expanded.delete(id) : expanded.add(id); }
      else { const k = `${row.dataset.component}|${row.dataset.node}`; folded.has(k) ? folded.delete(k) : folded.add(k); }
      draw(); return;
    }
    if (row.dataset.kind === 'component') expanded.add(row.dataset.component);
    focusKey = rowKey(row);
    pick(row, ev);
    row.focus({ preventScroll: true });
  });
  el.addEventListener('dblclick', (ev) => {
    const row = ev.target.closest('.lrow');
    if (!row) return;
    if (row.dataset.kind === 'component') { const r = ctx.stage.componentRect(row.dataset.component); if (r) ctx.view.flyTo(r, { pad: 88, max: 2 }); }
    else startRename(row);
  });

  // ---- row actions: rename, duplicate, delete ----
  const menu = document.createElement('div');
  menu.id = 'lmenu'; menu.setAttribute('role', 'menu'); menu.hidden = true; document.body.append(menu);
  const closeMenu = () => { menu.hidden = true; };
  function openMenu(btn) {
    const row = btn.closest('.lrow'), c = ctx.state.components.get(row.dataset.component);
    const isRoot = c?.doc?.root.id === row.dataset.node, ro = !!c?.readOnly;
    menu.innerHTML = `<button type="button" role="menuitem" data-do="rename"${ro ? ' disabled title="This file is read-only"' : ''}>Rename<kbd>F2</kbd></button><button type="button" role="menuitem" data-do="duplicate"${ro || isRoot ? ` disabled title="${isRoot ? "The root can't be duplicated" : 'This file is read-only'}"` : ''}>Duplicate${isRoot ? '<small>The root can’t be duplicated</small>' : ''}</button><button type="button" role="menuitem" data-do="delete"${ro || isRoot ? ` disabled title="${isRoot ? "The root can't be deleted" : 'This file is read-only'}"` : ''}>Delete${isRoot ? '<small>The root can’t be deleted</small>' : '<kbd>⌫</kbd>'}</button>`;
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, { left: `${r.right - 150}px`, top: `${r.bottom + 4}px` });
    menu.dataset.component = row.dataset.component; menu.dataset.node = row.dataset.node;
    menu.hidden = false; menu.querySelector('button:not(:disabled)')?.focus();
  }
  async function duplicate(component, id) {
    const c = ctx.state.components.get(component), { byId, parentOf } = index(c.doc), n = byId.get(id), parent = parentOf.get(id);
    if (!parent) return;
    const used = new Set(byId.keys()), ops = [];
    const fresh = (b) => { let i = 2; while (used.has(`${b}${i}`)) i++; used.add(`${b}${i}`); return `${b}${i}`; };
    const clone = (x, pid, at) => {
      const nid = fresh(x.id.replace(/\d+$/, '') || x.id);
      ops.push({ op: 'insert', parent: pid, index: at, node: { id: nid, tag: x.tag, style: { ...x.style }, ...(x.text !== undefined ? { text: x.text } : {}), ...(x.attrs ? { attrs: { ...x.attrs } } : {}) } });
      if (x.textProp) ops.push({ op: 'bindText', id: nid, prop: x.textProp });
      x.children.forEach((ch, i) => clone(ch, nid, i));
      return nid;
    };
    const top = clone(n, parent.id, parent.children.findIndex((q) => q.id === id) + 1);
    const r = await ctx.sendEdits(component, ops);
    if (r.ok) ctx.select({ component, node: top, variant: ctx.state.selection?.variant ?? {} });
  }
  menu.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-do]');
    if (!b) return;
    const { component, node } = menu.dataset; closeMenu();
    if (b.dataset.do === 'rename') { const r = el.querySelector(`.lrow[data-component="${CSS.escape(component)}"][data-node="${CSS.escape(node)}"]`); if (r) startRename(r); }
    else if (b.dataset.do === 'duplicate') await duplicate(component, node);
    else if (b.dataset.do === 'delete') await ctx.sendEdits(component, [{ op: 'delete', id: node }]);
  });
  menu.addEventListener('keydown', (ev) => {
    const items = [...menu.querySelectorAll('button:not(:disabled)')], i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeMenu(); }
  });
  document.addEventListener('pointerdown', (ev) => { if (!menu.hidden && !ev.target.closest('#lmenu, .lmore')) closeMenu(); }, true);

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
      focusKey = `${c.component}|${ctx.state.selection?.node ?? old}`;
      draw();
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
    const go = (r) => { if (r) { ev.preventDefault(); focusKey = rowKey(r); pick(r); } };
    if (ev.key === 'ArrowDown') go(rows[i + 1]);
    else if (ev.key === 'ArrowUp') go(rows[i - 1]);
    else if (ev.key === 'ArrowRight' && row.getAttribute('aria-expanded') === 'false') { ev.preventDefault(); row.querySelector('.twirl').click(); }
    else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      if (row.getAttribute('aria-expanded') === 'true') row.querySelector('.twirl').click();
      else { const lvl = Number(row.getAttribute('aria-level')); go(rows.slice(0, i).reverse().find((r) => Number(r.getAttribute('aria-level')) < lvl)); }
    } else if (ev.key === 'F2') { ev.preventDefault(); startRename(row); }
    else if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) { ev.preventDefault(); const b = row.querySelector('.lmore'); if (b) openMenu(b); }
    else if (ev.key === 'Enter') { ev.preventDefault(); focusKey = rowKey(row); pick(row); ctx.nav?.focus(row.dataset.component, row.dataset.node); }
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
