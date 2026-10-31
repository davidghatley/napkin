// The sidebar's second tab: the folder's rules and variables, grouped by file, each with how many places on the canvas it
// reaches. A click lights it up (stage-highlight.js), which turns the inspector to it. Counts are read from the frames in
// idle moments, a few rules at a time, and only while the tab is open.
//   initStylesTab(ctx) -> ctx.stylesTab = { show(name), refresh() }
import { matchAll } from './stage-highlight.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const enc = encodeURIComponent;
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 30));

export function initStylesTab(ctx) {
  const side = document.querySelector('#sidebar'), layers = document.querySelector('#layers'), title = side.querySelector('.pane-title');
  const tabs = document.createElement('div');
  tabs.className = 'side-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Sidebar');
  tabs.innerHTML = '<button type="button" role="tab" id="tab-layers" aria-selected="true" aria-controls="layers">Layers</button><button type="button" role="tab" id="tab-styles" aria-selected="false" aria-controls="styles" tabindex="-1">Styles</button>';
  title.after(tabs); title.classList.add('sr-only');
  const pane = document.createElement('div');
  pane.id = 'styles'; pane.hidden = true; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', 'tab-styles');
  pane.innerHTML = '<div class="st-top"><input id="styles-filter" type="search" placeholder="find a rule or variable" aria-label="Find a rule or variable" spellcheck="false"></div><div id="styles-list"></div>';
  layers.after(pane);
  const list = pane.querySelector('#styles-list'), filter = pane.querySelector('#styles-filter');
  let entries = [], current = null, gen = 0, stale = true;

  async function collect() {
    const ids = [...ctx.state.components.values()].filter((c) => c.kind === 'html').map((c) => c.component);
    const all = await Promise.all(ids.map((id) => fetch(`/api/component/${enc(id)}/rules`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    const rules = new Map(), vars = new Map();
    for (const d of all) {
      if (!d) continue;
      for (const r of d.rules || []) if (r.kind === 'style') { const k = `${r.file}|${r.selector}`; if (!rules.has(k)) rules.set(k, { kind: 'rule', selector: r.selector.replace(/\s+/g, ' ').trim(), raw: r.selector, file: r.file, line: r.line, n: null }); }
      for (const [name, defs] of Object.entries(d.vars || {})) if (!vars.has(name) && defs.some((x) => !x.inline)) vars.set(name, { kind: 'variable', selector: name, raw: name, file: defs[0]?.file, line: defs[0]?.line, n: null });
    }
    entries = [...[...rules.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line), ...vars.values()];
    stale = false;
  }
  function paint() {
    const q = filter.value.trim().toLowerCase();
    const shown = entries.filter((e) => !q || e.selector.toLowerCase().includes(q));
    const byFile = new Map();
    for (const e of shown) { const k = e.kind === 'variable' ? 'Variables' : e.file; if (!byFile.has(k)) byFile.set(k, []); byFile.get(k).push(e); }
    const had = document.activeElement?.dataset?.raw;
    list.innerHTML = [...byFile].map(([file, rows]) => `<h3>${esc(file.split('/').pop())} <span>${rows.length}</span></h3><ul>${rows.map((e) => `<li><button type="button" class="st-row${current === e.raw ? ' on' : ''}" data-raw="${esc(e.raw)}" data-file="${esc(e.file ?? '')}" data-kind="${e.kind}" title="${esc(e.selector)} · ${esc(e.file ?? '')}:${e.line ?? ''}"><i aria-hidden="true">${e.kind === 'variable' ? '--' : '{ }'}</i><code>${esc(e.kind === 'variable' ? e.selector.replace(/^--/, '') : e.selector)}</code><span class="st-n">${e.n ?? ''}</span></button></li>`).join('')}</ul>`).join('') || '<p class="st-none">No rules or variables match.</p>';
    if (had) list.querySelector(`.st-row[data-raw="${CSS.escape(had)}"]`)?.focus({ preventScroll: true });
    count();
  }
  // a few at a time, when nothing else wants the frame
  function count() {
    const my = ++gen, todo = entries.filter((e) => e.kind === 'rule' && e.n === null);
    const docs = () => [...ctx.stage.sections.values()].map((s) => s.docFrame?.doc()).filter(Boolean);
    const step = () => {
      if (my !== gen || pane.hidden) return;
      for (const e of todo.splice(0, 8)) { let n = 0; for (const d of docs()) n += matchAll(d, e.selector).size; e.n = n; const b = list.querySelector(`.st-row[data-raw="${CSS.escape(e.raw)}"] .st-n`); if (b) b.textContent = String(n); b?.closest('.st-row').classList.toggle('none', !n); }
      if (todo.length) idle(step);
    };
    idle(step);
  }
  async function show(name) {
    const styles = name === 'styles';
    tabs.querySelector('#tab-layers').setAttribute('aria-selected', String(!styles)); tabs.querySelector('#tab-styles').setAttribute('aria-selected', String(styles));
    tabs.querySelector('#tab-layers').tabIndex = styles ? -1 : 0; tabs.querySelector('#tab-styles').tabIndex = styles ? 0 : -1;
    layers.hidden = styles; pane.hidden = !styles; side.classList.toggle('on-styles', styles);
    if (styles) { if (stale) await collect(); paint(); }
  }
  tabs.addEventListener('click', (ev) => { const t = ev.target.closest('[role=tab]'); if (t) show(t.id === 'tab-styles' ? 'styles' : 'layers'); });
  tabs.addEventListener('keydown', (ev) => { if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return; ev.preventDefault(); const to = pane.hidden ? 'styles' : 'layers'; show(to); tabs.querySelector(`#tab-${to}`).focus(); });
  list.addEventListener('click', (ev) => {
    const b = ev.target.closest('.st-row'); if (!b) return;
    ctx.stage.highlight(b.dataset.kind === 'variable' ? { variable: b.dataset.raw } : { selector: b.dataset.raw, file: b.dataset.file });
  });
  list.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const rows = [...list.querySelectorAll('.st-row')], i = rows.indexOf(document.activeElement); if (i < 0) return;
    ev.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  filter.addEventListener('input', paint);
  ctx.on('highlight', (h) => { current = h && !h.quiet ? (h.variable ?? h.selector) : null; for (const b of list.querySelectorAll('.st-row')) b.classList.toggle('on', b.dataset.raw === current); });
  const dirty = () => { stale = true; for (const e of entries) e.n = null; if (!pane.hidden) collect().then(paint); };
  ctx.on('doc-change', dirty); ctx.on('doc-styles', dirty); ctx.on('added', dirty); ctx.on('removed', dirty);
  ctx.stylesTab = { show, refresh: dirty };
  return ctx.stylesTab;
}
