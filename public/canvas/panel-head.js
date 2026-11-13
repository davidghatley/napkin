// The right panel's one header and its empty state (docs/basics/standards.md section 7 rules 2, 3, 8 and 13).
// Header: the selection's type glyph (the layers panel's icons), its name, and for an element its tag. The name is typed over
// in place, with the layers panel's own rename (ctx.layers.rename with { at }): F2 or a click on the name. At its right: the
// frame width of an HTML file (breakpoints, B), "Open alone" for a file, and the button that hides the panel (Ctrl+Shift+\).
// Under the name, one quiet line says where the selection lives (file and line, kind and size).
// Nothing selected: one line, "Select something to edit it.", and the canvas settings the product has (zoom, background,
// tokens), in one section.
//   initPanelHead(ctx) -> ctx.panelHead = { render(), empty(el) }
import { ICON, iconFor, htmlIcon, fileIcon, htmlName } from './layers.js';
import { index } from '/src/model.js';
import { keyLabel } from './keylabel.js';
import { sectionHtml, wireSections } from './sections.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const enc = encodeURIComponent;
const OPEN_ICON = '<svg class="ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5M11.25 9.5v3.75H2.75V4.75H6.5"/></svg>';
const HIDE_ICON = '<svg class="ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.5"/><path d="M9.75 2.75v10.5"/></svg>';

// What the selection is, for the header: { kind, icon, name, tag, where, renamable, item, frame }
export function describe(ctx) {
  const sels = ctx.state.selections, sel = ctx.state.selection;
  const c = sel && ctx.state.components.get(sel.component);
  if (!c) return null;
  const comps = new Set(sels.map((s) => s.component));
  if (comps.size > 1) return { kind: 'many', icon: ICON.frame, name: `${comps.size} selected`, where: 'Shared values: a change goes to each of them' };
  const item = ctx.itemOf?.(sel.component);
  const more = sels.length > 1 ? ` +${sels.length - 1}` : '';
  if (c.item) {
    const kind = c.fileKind || c.kind || 'file';
    return { kind, icon: fileIcon(c), name: ctx.title(c), where: `${kind}${c.bytes !== undefined ? ' · ' + Number(c.bytes).toLocaleString() + ' bytes' : ''}`, item, renamable: false };
  }
  if (c.kind === 'html') {
    const frameFile = !!ctx.create?.isFrameFile(c);
    const frame = ctx.stage?.sections.get(c.component)?.docFrame;
    if (sel.card) return { kind: /\.(tsx|jsx)$/i.test(c.path || '') ? 'tsx-file' : 'html-file', icon: fileIcon(c), name: ctx.title(c), where: c.path, item, renamable: frameFile && !c.readOnly };
    const n = frame?.node(sel.node);
    const kids = n ? n.children.filter((x) => !['script', 'style', 'template', 'link', 'meta'].includes(x.tag)).length : 0;
    return { kind: /\.(tsx|jsx)$/i.test(c.path || '') ? 'tsx' : 'html', icon: n ? htmlIcon(n, kids) : ICON.frame, name: n ? htmlName(n) + more : sel.node, tag: n?.tag, where: `${c.path}${n?.line ? ':' + n.line : ''}`, source: true, item, frame, renamable: false };
  }
  if (c.doc) {
    const n = index(c.doc).byId.get(sel.node);
    if (sel.card || !n) return { kind: 'component', icon: ICON.component, name: c.name, where: c.path || 'component', item, renamable: !c.readOnly };
    return { kind: 'tsx', icon: iconFor(n), name: n.id + more, tag: n.tag, where: c.name, item, renamable: !c.readOnly && sels.length === 1 };
  }
  return { kind: 'file', icon: ICON.doc, name: ctx.title(c), where: c.path || '', item, renamable: false };
}

export function initPanelHead(ctx) {
  const insp = document.querySelector('#inspector');
  const head = document.createElement('header');
  head.id = 'pp-head'; head.className = 'pp-head'; head.hidden = true;
  insp.prepend(head);
  let last = '', renaming = false;

  function render() {
    if (renaming) return;
    const d = describe(ctx);
    if (!d) { if (!head.hidden) { head.hidden = true; head.replaceChildren(); last = ''; } return; }
    const sel = ctx.state.selection, c = ctx.state.components.get(sel.component);
    const nameHtml = d.renamable
      ? `<button type="button" class="pp-name" id="sel-node" aria-keyshortcuts="F2" title="Rename (F2)" data-tip="Rename" data-key="F2">${esc(d.name)}</button>`
      : `<span class="pp-name" id="sel-node" title="${esc(d.name)}">${esc(d.name)}</span>`;
    const width = d.frame && !sel.card ? `<button type="button" class="pp-tool pp-width" id="doc-frame-width" title="Frame width and breakpoints (B)" aria-keyshortcuts="B">${d.frame.width} px</button>` : '';
    const open = d.item && d.kind !== 'many' ? `<a class="icon-btn pp-tool" id="pp-open" href="/view/${enc(d.item)}" target="_blank" rel="noopener" aria-label="Open this file alone" data-tip="Open this file alone">${OPEN_ICON}</a>` : '';
    const hide = `<button type="button" class="icon-btn pp-tool" id="pp-collapse" aria-controls="inspector" aria-label="Hide the design panel" aria-keyshortcuts="Control+Shift+Backslash" data-tip="Hide panel" data-key="Ctrl+Shift+\\">${HIDE_ICON}</button>`;
    const where = d.source ? `<span id="sel-component">${esc(c.name)}</span> · <span id="doc-source" title="${esc(d.where)}">${esc(d.where.split('/').pop())}</span>` : `<span id="sel-component">${esc(d.where)}</span>`;
    const html = `<div class="pp-row"><span class="pp-glyph" aria-hidden="true">${d.icon}</span>${nameHtml}${d.tag ? `<span class="pp-tag" title="The element’s tag">&lt;${esc(d.tag)}&gt;</span>` : ''}<span class="pp-tools">${width}${open}${hide}</span></div><p class="pp-where">${where}</p>`;
    head.hidden = false;
    head.dataset.kind = d.kind;
    if (html === last) return;
    const had = head.contains(document.activeElement) ? document.activeElement.id : null;
    last = html; head.innerHTML = html;
    if (had) head.querySelector('#' + CSS.escape(had))?.focus({ preventScroll: true });
  }
  function rename() {
    const at = head.querySelector('button.pp-name');
    if (!at) return false;
    renaming = true;
    const ok = ctx.layers?.rename(ctx.state.selection, { at, done: () => { renaming = false; last = ''; render(); head.querySelector('.pp-name')?.focus({ preventScroll: true }); } });
    if (!ok || !head.querySelector('input')) { renaming = false; last = ''; render(); } // a dialog (a component's rename) or nothing: the header stays as it was
    return ok;
  }
  head.addEventListener('click', (ev) => {
    const t = ev.target.closest?.('button, a');
    if (!t) return;
    if (t.matches('.pp-name')) rename();
    else if (t.id === 'doc-frame-width') ctx.breakpoints?.open?.();
    else if (t.id === 'pp-collapse') ctx.rightPanel?.toggle(false);
  });
  head.addEventListener('keydown', (ev) => { if (ev.key === 'F2' && ev.target.matches?.('.pp-name')) { ev.preventDefault(); ev.stopPropagation(); rename(); } });

  // ---- nothing selected ----
  function empty(el) {
    const z = Math.round((ctx.view?.get().z ?? 1) * 100);
    const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    const body = `<div class="pp-field"><span class="pp-label" id="pp-zoom-l">Zoom</span><div class="pp-ctl pp-zoom" role="group" aria-labelledby="pp-zoom-l">
        <button type="button" class="pp-btn" data-pp="zoom-out" aria-label="Zoom out">−</button><button type="button" class="pp-btn pp-zl" data-pp="zoom-100" id="pp-zoom" aria-label="Zoom ${z}%, set to 100%" title="Zoom to 100% (${esc(keyLabel('Shift+0'))})">${z}%</button><button type="button" class="pp-btn" data-pp="zoom-in" aria-label="Zoom in">+</button><button type="button" class="pp-btn" data-pp="fit" title="Fit all (${esc(keyLabel('Shift+1'))})">Fit</button></div></div>
      <div class="pp-field"><span class="pp-label" id="pp-bg-l">Background</span><div class="pp-ctl pp-seg" role="radiogroup" aria-labelledby="pp-bg-l"><button type="button" role="radio" class="pp-btn" data-pp="bg-light" aria-checked="${!dark}">Light</button><button type="button" role="radio" class="pp-btn" data-pp="bg-dark" aria-checked="${dark}">Dark</button></div></div>
      <div class="pp-field"><span class="pp-label">Tokens</span><div class="pp-ctl"><button type="button" class="pp-btn pp-link" data-pp="tokens">Open tokens</button></div></div>`;
    el.innerHTML = `<p class="pp-empty" id="pp-empty">Select something to edit it.</p>${sectionHtml({ kind: 'canvas', id: 'canvas', title: 'Canvas', body })}`;
    wireSections(el);
  }
  document.querySelector('#panel').addEventListener('click', (ev) => {
    const b = ev.target.closest?.('[data-pp]');
    if (!b) return;
    const v = ctx.view, a = b.dataset.pp;
    if (a === 'zoom-in') v.zoomBy(1.25); else if (a === 'zoom-out') v.zoomBy(0.8);
    else if (a === 'zoom-100') v.zoomBy(1 / v.get().z, undefined, undefined, { animate: true });
    else if (a === 'fit') v.fitAll({ animate: true });
    else if (a === 'tokens') ctx.drawer?.open('tokens');
    else if (a === 'bg-light' || a === 'bg-dark') {
      const want = a.slice(3), cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      if (cur !== want) document.querySelector('#theme-toggle')?.click();
      for (const r of b.parentElement.children) r.setAttribute('aria-checked', String(r === b));
    }
  });
  ctx.on('view', ({ z }) => { const e = document.querySelector('#pp-zoom'); if (e) { const t = `${Math.round(z * 100)}%`; if (e.textContent !== t) { e.textContent = t; e.setAttribute('aria-label', `Zoom ${t}, set to 100%`); } } });

  ctx.panelHead = { render, empty, rename, el: head };
  return ctx.panelHead;
}
