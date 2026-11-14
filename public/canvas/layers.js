// The layers tree (CAN-04): every component, and under it the JSX tree of its nodes, as the file has it.
// Selection syncs both ways. Rename (F2 / double-click) is one `rename` edit; dragging a row is one `move`.
import { plain } from './words.js';
import { index, VOID } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Row glyphs: 16 px grid, 1.5 px stroke, round caps and joins, as every chrome icon (canvas.css). Stroke and fill come from the row's CSS.
const g = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${d}</svg>`;
const ICON = {
  frame: g('<path d="M5.25 2.25v11.5M10.75 2.25v11.5M2.25 5.25h11.5M2.25 10.75h11.5"/>'),
  text: g('<path d="M3.25 4.75v-2h9.5v2M8 2.75v10.5M6 13.25h4"/>'),
  image: g('<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5"/><path d="m2.25 11 3.25-3.25 2.75 2.75 1.75-1.75 3.75 3.75"/><circle cx="10.5" cy="5.75" r=".75"/>'),
  button: g('<rect x="1.75" y="4.75" width="12.5" height="6.5" rx="3.25"/>'),
  component: g('<path d="M8 1.75 14.25 8 8 14.25 1.75 8z"/>'),
  css: g('<path d="M6 2.75c-1.25 0-2 .5-2 1.75v1.75C4 7.25 3.5 8 2.5 8c1 0 1.5.75 1.5 1.75v1.75c0 1.25.75 1.75 2 1.75M10 2.75c1.25 0 2 .5 2 1.75v1.75c0 1 .5 1.75 1.5 1.75-1 0-1.5.75-1.5 1.75v1.75c0 1.25-.75 1.75-2 1.75"/>'),
  vector: g('<path d="M3.5 12.5C3.5 7 7 3.5 12.5 3.5"/><rect x="2" y="11" width="3" height="3" rx=".5"/><rect x="11" y="2" width="3" height="3" rx=".5"/>'),
  doc: g('<path d="M4.25 1.75h4.75l2.75 2.75v9.75h-7.5z"/><path d="M6.25 7.25h3.5M6.25 10h3.5"/>'),
  eye: g('<path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z"/><circle cx="8" cy="8" r="1.75"/>'),
  eyeoff: g('<path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z"/><path d="M2.75 13.25 13.25 2.75"/>'),
  more: g('<circle cx="4" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12" cy="8" r="1"/>'),
  chevron: g('<path d="M5 6.5 8 9.5l3-3"/>'),
};
const iconFor = (n) => (n.tag === 'img' ? ICON.image : n.tag === 'button' ? ICON.button : n.children.length || !(n.text !== undefined || n.textProp) ? ICON.frame : ICON.text);
// An element of an HTML file: a picture, a vector, text, a button, or a box (a frame, as Figma calls a container).
const htmlIcon = (n, kids) => (/^(img|picture|video|canvas)$/.test(n.tag) ? ICON.image : n.tag === 'svg' ? ICON.vector : n.tag === 'button' ? ICON.button : !kids && n.text?.trim() ? ICON.text : ICON.frame);
// A file row says what the file is: an HTML file is a frame, a TSX or JSX file a component, then CSS, SVG, pictures and text.
const fileIcon = (c) => {
  if (!c.item) return c.kind === 'html' && !/\.(tsx|jsx)$/i.test(c.path || '') ? ICON.frame : ICON.component;
  const fam = c.meta?.family, path = c.path || c.name || '';
  return /\.svg$/i.test(path) ? ICON.vector : fam === 'image' ? ICON.image : fam === 'css' ? ICON.css : ICON.doc;
};
const twirl = (on) => `<span class="twirl" aria-hidden="true">${on ? ICON.chevron : ''}</span>`;
const holdsText = (n) => n.text !== undefined || !!n.textProp;
const canHold = (n) => !holdsText(n) && !VOID.has(n.tag);

export function initLayers(ctx, el) {
  const expanded = new Set();          // component ids showing their nodes
  const folded = new Set();            // "component|node" rows whose children are hidden
  const opened = new Set();            // rows of a file's tree opened by hand (the rest open only on the path to the selection)
  const keptOpen = new Set();          // files opened by hand: they stay open when the selection moves on
  let lastHtml = '', queued = false, renaming = null, dragging = null, reveal = false, focusKey = null; // focusKey: the row that keeps keyboard focus across a rebuild
  const rowKey = (r) => `${r.dataset.component}|${r.dataset.node ?? ''}`;

  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
  const selKey = (s) => `${s.component}|${s.node}`;
  const selected = () => new Set(ctx.state.selections.map(selKey));
  const baseVariant = (c) => Object.fromEntries((c.doc?.props || []).filter((p) => p.type === 'enum').map((a) => [a.name, a.default]));

  function draw() {
    if (renaming || dragging) { lastHtml = ''; return; } // (the rename box and the drag marks are not in lastHtml)
    const sel = selected(), prim = ctx.state.selection;
    const comps = ctx.state.components.all().sort((a, b) => a.name.localeCompare(b.name));
    const rows = [];
    const anc = new Set(); // ancestors of every selected node: a quiet trail down to the selection
    for (const sl of ctx.state.selections) { const c0 = ctx.state.components.get(sl.component); if (!c0?.doc) continue; const { parentOf } = index(c0.doc); for (let q = parentOf.get(sl.node); q; q = parentOf.get(q.id)) anc.add(`${sl.component}|${q.id}`); }
    for (const c of comps) {
      const open = expanded.has(c.component), canOpen = !c.item && (!!c.doc || c.kind === 'html');
      const has = ctx.state.selections.some((s) => s.component === c.component);
      rows.push(`<div class="lrow lcomp${has ? ' has-sel' : ''}" role="treeitem" aria-level="1"${canOpen ? ` aria-expanded="${open}"` : ''} aria-selected="${has && [c.doc?.root.id, 'item', ''].some((n) => n != null && sel.has(`${c.component}|${n}`))}" data-component="${esc(c.component)}" data-kind="component" tabindex="-1" style="--nk-d:0">${twirl(canOpen)}<span class="licon">${fileIcon(c)}</span><span class="lname">${esc(ctx.title(c))}</span>${c.readOnly ? '<span class="ltag">read-only</span>' : ''}${c.noComponent ? `<span class="lnote" title="${esc(c.noComponent)}">no component exported</span>` : ''}<button type="button" class="lmore" tabindex="-1" data-action="more" aria-label="More actions for ${esc(ctx.title(c))}" title="More">${ICON.more}</button></div>`);
      if (open && c.kind === 'html') { htmlRows(c, rows, sel, prim); continue; }
      if (!open || !c.doc) continue;
      (function walk(n, depth) {
        const k = `${c.component}|${n.id}`, kids = n.children.length, isFolded = folded.has(k);
        rows.push(`<div class="lrow lnode${n.style?.visibility === 'hidden' ? ' hidden-node' : ''}${sel.has(k) ? ' selected' : ''}${prim && selKey(prim) === k ? ' primary' : ''}${anc.has(k) ? ' anc' : ''}" title="${esc(n.tag)}${n.textProp ? ' · shows ' + esc(n.textProp) : ''}" role="treeitem" aria-level="${depth + 1}"${kids ? ` aria-expanded="${!isFolded}"` : ''} aria-selected="${sel.has(k)}" data-component="${esc(c.component)}" data-node="${esc(n.id)}" data-kind="node" tabindex="-1" style="--nk-d:${depth}">${twirl(kids)}<span class="licon">${iconFor(n)}</span><span class="lname">${esc(n.id)}</span><span class="ltag">${esc(n.tag)}${n.textProp && n.textProp !== n.id ? ` · ${esc(n.textProp)}` : ''}</span><button type="button" class="leye" tabindex="-1" data-action="eye" aria-pressed="${n.style?.visibility === 'hidden'}" aria-label="${n.style?.visibility === 'hidden' ? 'Show' : 'Hide'} ${esc(n.id)}" title="${n.style?.visibility === 'hidden' ? 'Show' : 'Hide'}">${n.style?.visibility === 'hidden' ? ICON.eyeoff : ICON.eye}</button><button type="button" class="lmore" tabindex="-1" data-action="more" aria-label="More actions for ${esc(n.id)}" title="More">${ICON.more}</button></div>`);
        if (!isFolded) n.children.forEach((x) => walk(x, depth + 1));
      })(c.doc.root, 1);
    }
    for (const k of ctx.docs?.skipped ?? []) rows.push(`<div class="lrow lskip" role="treeitem" aria-level="1" aria-disabled="true" title="${esc(k.note)}" style="--nk-d:0"><span class="lname">${esc(k.path)}</span><span class="lnote">no component exported</span></div>`); // (a file that exports no component has no frame)
    const html = rows.join('') || '<p class="empty">No layers yet. Files you add to the folder show here.</p>';
    if (html === lastHtml && !focusKey) { if (reveal) { reveal = false; el.querySelector('.primary')?.scrollIntoView({ block: 'nearest' }); } return; } // an edit that moved no row leaves the tree alone (~200 rows at 200 components)
    lastHtml = html;
    el.innerHTML = html;
    if (rows.length) el.setAttribute('role', 'tree'); else el.removeAttribute('role'); // an empty tree is not a tree
    const tab = el.querySelector('.primary') || el.querySelector('.has-sel') || el.querySelector('.lrow');
    if (tab) { tab.tabIndex = 0; tab.querySelectorAll('.leye, .lmore').forEach((b) => { b.tabIndex = 0; }); } // reachable by Tab from the row; shown while the row has focus
    if (focusKey) {
      const f = [...el.querySelectorAll('.lrow')].find((r) => rowKey(r) === focusKey);
      if (f) { f.tabIndex = 0; f.focus({ preventScroll: true }); }
      focusKey = null;
    }
    if (reveal) { reveal = false; el.querySelector('.primary')?.scrollIntoView({ block: 'nearest' }); } // only when the selection changed, never on an edit
  }

  // An HTML component's elements (document engine): the <body> subtree of its file, labelled tag#id.class.
  function htmlRows(c, rows, sel, prim) {
    const t = ctx.stage?.sections.get(c.component)?.docFrame?.tree();
    const body = (function find(l) { for (const n of l || []) { if (n.tag === 'body') return n; const f = find(n.children); if (f) return f; } return null; })(t?.tree);
    // the rows on the way to the selection are open; everything else starts closed. An svg's shapes are one row until asked for.
    const onPath = new Set();
    const mark = (list) => { let hit = false; for (const n of list || []) { const self = sel.has(`${c.component}|${n.node}`), under = mark(n.children); if (under) onPath.add(n.node); hit ||= self || under; } return hit; };
    mark(t?.tree);
    const SKIP = ['script', 'style', 'template', 'link', 'meta'];
    const nameOf = (n) => { const id = n.attrs?.id ? `#${n.attrs.id}` : '', cl = (n.attrs?.class || '').split(/\s+/).filter(Boolean); return `${id}${cl.slice(0, 2).map((x) => '.' + x).join('')}${cl.length > 2 ? ` +${cl.length - 2}` : ''}` || n.text?.trim().slice(0, 40) || (n.attrs?.['aria-label'] ? `${n.tag} “${n.attrs['aria-label']}”` : n.tag); };
    const bare = (n) => !n.children.length && !n.attrs?.id && !n.attrs?.class && !n.text?.trim();
    const walkList = (list, depth) => {
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (SKIP.includes(n.tag)) continue;
        // a run of the same empty, unnamed element (the cells of a pixel grid, the paths of an icon) is one row, unless the selection is in it
        let run = 1; if (bare(n)) while (list[i + run]?.tag === n.tag && bare(list[i + run])) run++;
        if (run <= 3 || list.slice(i, i + run).some((x) => sel.has(`${c.component}|${x.node}`))) run = 1;
        const k = `${c.component}|${n.node}`, kids = n.children.filter((x) => !SKIP.includes(x.tag)).length;
        const isFolded = kids > 0 && ((!onPath.has(n.node) && !opened.has(k)) || folded.has(k));
        const label = `${nameOf(n)}${run > 1 ? ` ×${run}` : ''}${n.tag === 'svg' && kids ? ` · ${kids} shape${kids === 1 ? '' : 's'}` : ''}`;
        rows.push(`<div class="lrow lnode${sel.has(k) ? ' selected' : ''}${prim && selKey(prim) === k ? ' primary' : ''}${onPath.has(n.node) ? ' anc' : ''}" title="${esc(n.tag)} · line ${n.line}" role="treeitem" aria-level="${depth + 1}"${kids ? ` aria-expanded="${!isFolded}"` : ''} aria-selected="${sel.has(k)}" data-component="${esc(c.component)}" data-node="${esc(n.node)}" data-kind="node" tabindex="-1" style="--nk-d:${depth}">${twirl(kids)}<span class="licon">${htmlIcon(n, kids)}</span><span class="lname">${esc(label)}</span></div>`);
        if (!isFolded) walkList(n.children, depth + 1);
        i += run - 1;
      }
    };
    walkList(body ? body.children : t?.tree || [], 1);
  }
  ctx.on('render', ({ component }) => { if (ctx.state.components.get(component)?.kind === 'html' && expanded.has(component)) schedule(); });

  // ---- selection from the tree ----
  function pick(row, ev) {
    const c = ctx.state.components.get(row.dataset.component);
    if (c?.item) { ctx.select({ component: c.component, node: 'item', variant: {} }); return; }
    if (c?.kind === 'html') { // the document engine: a node of the file, or its first element for the component row
      const node = row.dataset.node || ctx.stage?.mainNode?.(c.component);
      ctx.select({ component: c.component, node: node ?? '', variant: {} }); // (nothing drawn: an empty or failed render is selected as its card)
      return;
    }
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
    if (ev.target.closest('.lmore')) { ev.stopPropagation(); openMenu(ev.target.closest('.lmore')); return; }
    if (ev.target.closest('.twirl')) {
      if (row.dataset.kind === 'component') { const id = row.dataset.component; if (expanded.has(id)) { expanded.delete(id); keptOpen.delete(id); } else { expanded.add(id); keptOpen.add(id); } }
      else { const k = `${row.dataset.component}|${row.dataset.node}`; if (row.getAttribute('aria-expanded') === 'true') { folded.add(k); opened.delete(k); } else { folded.delete(k); opened.add(k); } }
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
    if (row.dataset.kind === 'component' && frameRow(row)) fileRename(row); // an HTML frame: its row name is its file name
    else if (row.dataset.kind === 'component') { const r = ctx.stage.componentRect(row.dataset.component); if (r) ctx.view.flyTo(r, { pad: 88, max: 2 }); }
    else startRename(row);
  });

  // ---- row actions: the row's "More" button opens the context menu of its item (context-menu.js), as a right-click does ----
  function openMenu(btn) { const row = btn.closest('.lrow'), r = btn.getBoundingClientRect(); ctx.menu?.openRow(row, { x: r.left, y: r.bottom + 4 }, { anchor: btn }); }

  // ---- hover: the row and the element light each other up ----
  el.addEventListener('mouseover', (ev) => {
    const row = ev.target.closest('.lrow[data-component]'); // a file row outlines its card, an element row its element
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

  // An HTML frame file is renamed in its row, the same way as on the canvas (ctx.create.rename: the file moves on disk).
  const frameRow = (row) => !!ctx.create?.isFrameFile(ctx.state.components.get(row.dataset.component));
  function fileRename(row) {
    const id = row.dataset.component, c = ctx.state.components.get(id);
    if (!c || c.readOnly) return;
    const name = row.querySelector('.lname'), old = String(c.path || id).split('/').pop().replace(/\.html?$/i, '');
    const input = document.createElement('input');
    input.className = 'lrename'; input.value = old; input.setAttribute('aria-label', `Rename ${old}`); input.spellcheck = false;
    const msg = document.createElement('span'); msg.className = 'nk-rename-msg'; msg.setAttribute('role', 'alert'); msg.hidden = true;
    name.replaceWith(input); input.after(msg);
    renaming = { row, old };
    input.focus(); input.select();
    let done = false;
    const close = () => { done = true; renaming = null; focusKey = `${ctx.state.selection?.component ?? id}|${ctx.state.selection?.node ?? ''}`; draw(); };
    const finish = async (commit, fromBlur) => {
      if (done) return;
      if (!commit) { close(); return; }
      const k = ctx.create.check(id, input.value);
      if (k.same) { close(); return; }
      if (k.error) { if (fromBlur) { ctx.hint(plain(k.error)); close(); } else { msg.textContent = k.error; msg.hidden = false; } return; }
      done = true; input.disabled = true;
      const r = await ctx.create.rename(id, k.name);
      if (!r.ok) ctx.hint(plain(r.error));
      renaming = null; draw();
    };
    input.addEventListener('input', () => { msg.hidden = true; });
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true, false); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true, true));
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
    } else if (ev.key === 'F2') { ev.preventDefault(); if (row.dataset.kind === 'component' && frameRow(row)) fileRename(row); else if (row.dataset.kind === 'component') ctx.cmpOps.rename(row.dataset.component); else startRename(row); }
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
    line.style.left = `${Number(d.row.style.getPropertyValue('--nk-d')) * 12 + 28}px`;
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
  // the tree follows the selection: its component opens, the other files' trees close, unless you opened them by hand
  ctx.on('select', () => { const sels = ctx.state.selections; if (sels.length && sels.every((x) => ctx.state.components.get(x.component)?.kind === 'html')) for (const id of [...expanded]) if (ctx.state.components.get(id)?.kind === 'html' && !sels.some((x) => x.component === id) && !keptOpen.has(id)) expanded.delete(id); for (const x of sels) expanded.add(x.component); reveal = true; schedule(); });
  for (const e of ['render', 'removed', 'added', 'layout']) ctx.on(e, schedule); // ('layout': a folder of files only has no component render to draw the first rows)
  let seeded = false; // a small repo opens fully expanded, once
  ctx.on('render', () => { if (!seeded && ctx.state.components.size <= 8) { seeded = true; for (const id of ctx.state.components.keys()) expanded.add(id); } });
  draw();
  // For the context menu and the palette: the row of a selection, select it as a click does, rename it, open or close it.
  const rowOf = (sel) => sel && [...el.querySelectorAll('.lrow')].find((r) => r.dataset.component === sel.component && (sel.card ? r.dataset.kind === 'component' : r.dataset.node === sel.node));
  function rename(sel = ctx.state.selection) {
    if (!sel) return false;
    if (sel.card) { ctx.cmpOps.rename(sel.component, { fromRow: true }); return true; }
    let row = rowOf(sel);
    if (!row) { expanded.add(sel.component); lastHtml = ''; draw(); row = rowOf(sel); } // a row inside a closed file opens first
    if (!row) return false;
    row.scrollIntoView({ block: 'nearest' });
    startRename(row);
    return true;
  }
  function toggle(row = document.activeElement?.closest?.('#layers .lrow') || rowOf(ctx.state.selection)) {
    const t = row?.querySelector('.twirl');
    if (!t || !row.hasAttribute('aria-expanded')) return false;
    focusKey = rowKey(row);
    t.click();
    return true;
  }
  const api = { redraw: draw, expand: (id) => expanded.add(id), pick, rename, toggle, rowOf, key: rowKey, find: (key) => [...el.querySelectorAll('.lrow')].find((r) => rowKey(r) === key) };
  ctx.layers = api;
  return api;
}
