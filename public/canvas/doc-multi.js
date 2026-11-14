// The panel for several HTML elements selected together (standards section 7 rule 2): the controls they have in common, each showing
// the value they share or "Mixed" where they differ. A typed value is set on every selected element in one contract edit
// (POST /api/edit with one style edit per element), so it is one undo step. The values are the browser's own (computed), as in a
// single element's panel, so what the panel says is what the canvas draws.
import { plain } from './words.js';
import { sectionHtml, wireSections } from './sections.js';
import { TYPE_FIELDS, effective } from './doc-effective.js';
import { wireKeys } from './doc-panel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LENGTHY = /^(width|height|padding|margin|font-size|line-height|border-radius|letter-spacing)$/;

const SECTIONS = [
  ['layout', 'Layout', [['width', 'W'], ['height', 'H']]],
  ['spacing', 'Spacing', [['padding', 'Padding'], ['margin', 'Margin']]],
  ['appearance', 'Appearance', [['border-radius', 'Radius'], ['opacity', 'Opacity']]],
  ['type', 'Typography', TYPE_FIELDS],
  ['fill', 'Fill', [['background-color', 'Background']]],
];

export function renderDocMulti(ctx, el, sels, comp) {
  const frame = ctx.stage.sections.get(comp.component)?.docFrame;
  const els = sels.map((s) => frame?.element(s.node)?.el).filter((e) => e?.isConnected);
  if (!frame || !els.length) { el.innerHTML = `<p class="hint pp-note">${esc(comp.path)} · loading…</p>`; return; }
  const key = `multi|${comp.component}|${sels.map((s) => s.node).join(',')}|${comp.revision}`;
  const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  if (el.dataset.full === key && focus) return;
  el.dataset.full = key;
  const row = (prop, name) => {
    const v = effective(els, prop);
    return `<div class="vrow${v.mixed ? ' mixed' : ''}" data-prop="${esc(prop)}"${v.mixed ? ' data-mixed' : ''}><div class="phead"><label for="pv-${esc(prop)}">${esc(name)}</label></div>
      <div class="pval"><input class="val" id="pv-${esc(prop)}" data-key="pv-${esc(prop)}" data-prop="${esc(prop)}" value="${esc(v.mixed ? '' : v.value)}" placeholder="${v.mixed ? 'Mixed' : ''}" aria-label="${esc(name)}${v.mixed ? ' (Mixed)' : ''}" spellcheck="false" autocomplete="off"></div></div>`;
  };
  el.innerHTML = `<div class="doc-body doc-multi">${SECTIONS.map(([id, title, fields]) => sectionHtml({ kind: 'html', id, title, body: fields.map(([p, n]) => row(p, n)).join('') })).join('')}
    <p class="field-error" id="doc-error" hidden></p></div>`;
  wireSections(el); wireKeys(el);
  const error = (msg) => { const e = el.querySelector('#doc-error'); if (e) { e.hidden = !msg; e.textContent = msg || ''; } };
  if (focus) { const f = el.querySelector(`[data-key="${CSS.escape(focus)}"]`); f?.focus({ preventScroll: true }); f?.select?.(); }
  el.querySelectorAll('.vrow input.val').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const prop = inp.dataset.prop; let value = inp.value.trim();
      if (!value) { inp.value = inp.defaultValue; return; }
      if (LENGTHY.test(prop) && /^-?\d*\.?\d+$/.test(value) && value !== '0') value += 'px';
      let ok = true; try { ok = CSS.supports(prop, value); } catch { /* the browser decides at the write */ }
      if (!ok) { error(`Not a value ${prop} accepts`); return; }
      error('');
      const r = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: comp.component, baseRevision: comp.revision, edits: sels.map((s) => ({ op: 'style', node: s.node, prop, value })) }) });
      const j = await r.json().catch(() => ({ ok: false, error: `the edit failed (${r.status})` }));
      if (!j.ok) error(plain(j.error)); else if (j.revision) comp.revision = j.revision;
    });
  });
}
