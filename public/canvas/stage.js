// The stage: every component with its full variant grid, rendered by the component's own bundle
// (real React, F04), plus selection and hover overlays. Plain DOM; React is only inside the cells.
import { variantGrid, index } from '/src/model.js';
import { variantLabel } from './panel.js';

export function createStage(ctx, root) {
  const sections = new Map(); // component id -> { el, grid, unmounts, token }
  const overlay = (id) => { const o = document.createElement('div'); o.id = id; root.append(o); return o; };
  const selectBox = overlay('overlay-select'), hoverBox = overlay('overlay-hover');

  function place(box, target, label) {
    if (!target?.isConnected) { box.style.display = 'none'; return; }
    const r = target.getBoundingClientRect(), s = root.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left - s.left + root.scrollLeft}px`, top: `${r.top - s.top + root.scrollTop}px`, width: `${r.width}px`, height: `${r.height}px` });
    if (label) box.dataset.label = label;
  }

  // The element for a selection: the clicked variant's cell if it still exists, else the first cell with the node.
  function selectedElement() {
    const sel = ctx.state.selection;
    const sec = sel && sections.get(sel.component);
    if (!sec) return null;
    const css = `[data-n="${CSS.escape(sel.node)}"]`;
    const key = JSON.stringify(sel.variant);
    const cell = [...sec.grid.children].find((c) => c.dataset.variant === key);
    return cell?.querySelector(css) || sec.grid.querySelector(css);
  }

  function refreshOverlays() {
    const el = selectedElement();
    const sel = ctx.state.selection;
    place(selectBox, el, sel && `${ctx.state.components.get(sel.component)?.name} · ${sel.node}`);
  }

  function section(id) {
    let sec = sections.get(id);
    if (sec) return sec;
    const el = document.createElement('section');
    el.className = 'cmp'; el.dataset.component = id;
    el.innerHTML = '<header><h3></h3><span class="badge" hidden></span><span class="rev"></span><p class="problem" role="status"></p><p class="build-error" role="alert"></p></header><div class="grid"></div>';
    sec = { el, grid: el.querySelector('.grid'), unmounts: [], token: 0 };
    sections.set(id, sec);
    root.insertBefore(el, selectBox);
    return sec;
  }

  function header(id) {
    const c = ctx.state.components.get(id), sec = section(id);
    sec.el.querySelector('h3').textContent = c.name;
    sec.el.dataset.name = c.name;
    const badge = sec.el.querySelector('.badge');
    badge.hidden = !c.readOnly; badge.textContent = c.readOnly ? `read-only: ${c.readOnly}` : '';
    sec.el.querySelector('.problem').textContent = c.problem ? `file has an error, showing the last good version: ${c.problem}` : '';
  }

  async function render(id) {
    const c = ctx.state.components.get(id);
    if (!c) return;
    const sec = section(id);
    const token = ++sec.token;
    header(id);
    const res = await fetch(`/bundle/${encodeURIComponent(id)}.js?rev=${c.revision}`);
    if (token !== sec.token) return; // a newer revision is already on its way
    const err = sec.el.querySelector('.build-error');
    if (!res.ok) {
      err.textContent = `build failed: ${(await res.json().catch(() => ({}))).error || res.status}`;
      sec.el.dataset.ready = '1';
      return;
    }
    err.textContent = '';
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    let mod; try { mod = await import(url); } finally { URL.revokeObjectURL(url); }
    if (token !== sec.token) return;
    const variants = c.doc ? variantGrid(c.doc) : [{}];
    const unmounts = [];
    const cells = variants.map((variant) => {
      const fig = document.createElement('figure');
      fig.className = 'cell'; fig.dataset.variant = JSON.stringify(variant);
      const mount = document.createElement('div'); mount.className = 'mount';
      const cap = document.createElement('figcaption'); cap.textContent = variantLabel(variant);
      fig.append(mount, cap);
      try { unmounts.push(mod.mount(mount, variant)); }
      catch (e) { mount.innerHTML = '<div class="error"></div>'; mount.firstChild.textContent = `render failed: ${e.message}`; }
      return fig;
    });
    const old = sec.unmounts;
    sec.grid.replaceChildren(...cells);
    sec.unmounts = unmounts;
    queueMicrotask(() => old.forEach((u) => u()));
    sec.el.dataset.revision = c.revision; sec.el.dataset.ready = '1';
    sec.el.querySelector('.rev').textContent = `r${String(c.revision).slice(0, 7)}`; // revisions are content hashes; show them short
    // Keep the selection while its node still exists; drop it when the node is gone.
    const sel = ctx.state.selection;
    if (sel?.component === id && !(c.doc && index(c.doc).byId.has(sel.node))) ctx.select(null);
    refreshOverlays();
    ctx.emit('render', { component: id, revision: c.revision });
  }

  function remove(id) {
    const sec = sections.get(id);
    if (!sec) return;
    sec.token++; sec.unmounts.forEach((u) => u()); sec.el.remove(); sections.delete(id);
    if (ctx.state.selection?.component === id) ctx.select(null);
  }

  const hit = (ev) => {
    const el = ev.target.closest?.('.mount [data-n]');
    const cell = el?.closest('.cell');
    return el && cell && { el, id: cell.closest('.cmp').dataset.component, variant: JSON.parse(cell.dataset.variant) };
  };
  root.addEventListener('mouseover', (ev) => { const h = hit(ev); place(hoverBox, h?.el); });
  root.addEventListener('mouseleave', () => place(hoverBox, null));
  root.addEventListener('click', (ev) => {
    const h = hit(ev);
    if (h) ev.preventDefault();
    ctx.select(h ? { component: h.id, node: h.el.dataset.n, variant: h.variant } : null);
  }, true);
  window.addEventListener('resize', refreshOverlays);
  ctx.on('select', refreshOverlays);

  return { render, remove, header, refreshOverlays };
}
