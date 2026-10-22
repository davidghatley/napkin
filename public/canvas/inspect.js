// INS-02 Inspect and INS-03 Copy usage.
// Inspect: for the selected node, in ANY variant cell (a picker, starting at the cell you clicked), the computed CSS read from the
// browser (getComputedStyle on the rendered element), and where each value comes from:
//   base            declared in the node's base style
//   <axis>=<value>  declared by that variant's override (the last axis that sets it wins, as in the file)
//   inherited       not declared here; the browser passes it down (names the ancestor that declares it)
//   browser default nothing declares it
// Copy usage: the JSX line that draws this cell in an app: <Button size="sm" label="Button" />.
import { h } from './drawer.js';
import { axes, index, variantGrid } from '/src/model.js';
import { usageFor } from '/src/usage.js';

const kebab = (p) => p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
// Properties a browser passes from parent to child.
const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'cursor', 'visibility'];
const label = (v) => (Object.keys(v).length ? Object.entries(v).map(([k, x]) => `${k}=${x}`).join(' · ') : 'default');

// Where a declared property comes from for one cell: 'base' | 'axis=value'. Pure; exported for the tests.
export function declaredFrom(doc, nodeId, variant, prop) {
  let from = null;
  const node = index(doc).byId.get(nodeId);
  if (node && prop in (node.style || {})) from = 'base';
  for (const a of axes(doc)) {
    const value = variant[a.name] ?? a.default;
    if (doc.variants?.[a.name]?.[value]?.[nodeId] && prop in doc.variants[a.name][value][nodeId]) from = `${a.name}=${value}`;
  }
  return from;
}

// The value the file declares for a property in one cell (the winning override, else the base).
function declaredValue(doc, nodeId, variant, prop) {
  let v = index(doc).byId.get(nodeId)?.style?.[prop];
  for (const a of axes(doc)) { const o = doc.variants?.[a.name]?.[variant[a.name] ?? a.default]?.[nodeId]; if (o && prop in o) v = o[prop]; }
  return v;
}

export function initInspect(ctx, drawer) {
  let pane, table, picker, usage, status, copyBtn;
  const S = { cell: null };

  const sel = () => ctx.state.selection;
  const cellEl = (id, variant) => [...document.querySelectorAll(`section.cmp[data-component="${CSS.escape(id)}"] figure.cell`)].find((c) => c.dataset.variant === JSON.stringify(variant));
  const elOf = (id, node, variant) => cellEl(id, variant)?.querySelector(`.mount [data-n="${CSS.escape(node)}"]`);

  // Rows for one node in one cell: [{ prop, declared?, computed, from }], read from the real element.
  function rowsFor(doc, node, variant, el) {
    const cs = getComputedStyle(el);
    const byId = index(doc);
    const declared = [];
    const names = new Set(Object.keys(byId.byId.get(node)?.style || {}));
    for (const a of axes(doc)) { const v = variant[a.name] ?? a.default; for (const p of Object.keys(doc.variants?.[a.name]?.[v]?.[node] || {})) names.add(p); }
    for (const p of names) {
      const from = declaredFrom(doc, node, variant, p);
      // `background: #2236b0` is just a colour: show background-color, not the browser's long shorthand with its default image, repeat and box
      const cssName = p === 'background' && declaredValue(doc, node, variant, p) && !/url\(|gradient|\s/.test(String(declaredValue(doc, node, variant, p)).trim()) ? 'background-color' : kebab(p);
      declared.push({ prop: cssName, computed: cs.getPropertyValue(cssName), from });
    }
    const rest = [];
    const own = new Set(declared.map((r) => r.prop));
    for (const prop of INHERITED) {
      if (own.has(prop)) continue;
      let from = 'browser default', cur = byId.parentOf.get(node);
      for (; cur; cur = byId.parentOf.get(cur.id)) {
        const f = declaredFrom(doc, cur.id, variant, prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
        if (f) { from = `inherited from ${cur.id} (${f})`; break; }
      }
      // cells are isolated from the editor's CSS (decision 0012): an undeclared inherited value is the browser's own default, as on a blank page
      rest.push({ prop, computed: cs.getPropertyValue(prop), from });
    }
    const box = ['width', 'height', 'display'].filter((p) => !own.has(p)).map((prop) => ({ prop, computed: cs.getPropertyValue(prop), from: 'computed by the browser' }));
    return { declared, rest, box };
  }

  function render() {
    if (!pane || drawer.active !== 'inspect') return;
    const s = sel(), c = s && ctx.state.components.get(s.component);
    table.replaceChildren(); usage.textContent = ''; picker.replaceChildren(); copyBtn.disabled = true;
    if (!s || !c?.doc) { status.textContent = 'Select a node on the canvas to inspect it.'; return; }
    const grid = variantGrid(c.doc);
    const want = JSON.stringify(S.cell && S.component === s.component ? S.cell : s.variant);
    S.component = s.component;
    for (const v of grid) picker.append(h('option', { value: JSON.stringify(v), text: label(v) }));
    picker.value = grid.some((v) => JSON.stringify(v) === want) ? want : JSON.stringify(grid[0] ?? {});
    const variant = JSON.parse(picker.value || '{}');
    S.cell = variant;
    const el = elOf(s.component, s.node, variant);
    usage.textContent = usageFor(c.doc, variant); copyBtn.disabled = false;
    if (!el) { status.textContent = `${c.name} · ${s.node} is not drawn in that cell yet.`; return; }
    status.textContent = `${c.name} · ${s.node} · ${label(variant)}`;
    const { declared, rest, box } = rowsFor(c.doc, s.node, variant, el);
    const group = (title, rows) => {
      if (!rows.length) return;
      table.append(h('tr', { class: 'i-group' }, h('th', { colspan: '3', scope: 'colgroup', text: title })));
      for (const r of rows) table.append(h('tr', { 'data-prop': r.prop, 'data-from': r.from }, h('td', { class: 'i-prop' }, h('code', { text: r.prop })), h('td', { class: 'i-val' }, h('code', { text: r.computed })), h('td', { class: 'i-from', text: r.from })));
    };
    group('Declared in the file', declared); group('Inherited text settings', rest); group('Size, as drawn', box);
  }

  async function copy() {
    const text = usage.textContent;
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = 'Copied'; }
    catch { copyBtn.textContent = 'Select and copy'; const r = document.createRange(); r.selectNodeContents(usage); getSelection().removeAllRanges(); getSelection().addRange(r); }
    ctx.copied = text;
    setTimeout(() => { copyBtn.textContent = 'Copy usage'; }, 1400);
  }

  function build(p) {
    pane = p; pane.classList.add('inspect');
    status = h('span', { class: 'i-status', id: 'i-status', role: 'status' });
    picker = h('select', { id: 'i-cell', 'aria-label': 'Variant cell', onchange: () => { S.cell = JSON.parse(picker.value); render(); } });
    usage = h('code', { id: 'i-usage', class: 'i-usage', 'aria-label': 'Usage' });
    copyBtn = h('button', { type: 'button', id: 'i-copy', class: 'primary', text: 'Copy usage', onclick: copy });
    table = h('table', { id: 'i-table', class: 'i-table' });
    pane.append(h('div', { class: 'i-bar' }, status, picker), h('div', { class: 'i-use' }, usage, copyBtn), h('div', { class: 'i-scroll' }, table));
  }
  drawer.add('inspect', 'Inspect', { build, onOpen: render });
  ctx.on('select', (s) => { if (s) S.cell = null; render(); });
  ctx.on('render', () => { if (drawer.active === 'inspect') render(); });
  ctx.inspect = { render, rowsFor, declaredFrom };
}
