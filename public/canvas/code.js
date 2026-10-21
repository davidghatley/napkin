// INS-01: the code strip. The component's TSX under the canvas, live: the selected node's lines are highlighted (its JSX element
// and its style entries), clicking a line selects the node it belongs to, and every edit updates the text from the change frame
// itself, without another request (target < 100 ms). Plain DOM, a small tokenizer for colour.
import { h } from './drawer.js';
import { variantGrid } from '/src/model.js';

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const KEYWORDS = new Set(['import', 'export', 'from', 'const', 'function', 'return', 'type', 'interface', 'for', 'in', 'as', 'default']);
// One line to coloured HTML: comments, strings, numbers, JSX tag names and keywords. Good enough to read; never to compile.
export function paint(line) {
  let out = '', i = 0;
  const re = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d[\d.]*\b)|(<\/?[A-Za-z][\w.]*)|(\b[A-Za-z_]\w*\b)/g;
  for (let m; (m = re.exec(line)); ) {
    out += esc(line.slice(i, m.index)); i = re.lastIndex;
    if (m[1]) out += `<i class="tc">${esc(m[1])}</i>`;
    else if (m[2]) out += `<i class="ts">${esc(m[2])}</i>`;
    else if (m[3]) out += `<i class="tn">${esc(m[3])}</i>`;
    else if (m[4]) out += `<i class="tt">${esc(m[4])}</i>`;
    else out += KEYWORDS.has(m[5]) ? `<i class="tk">${m[5]}</i>` : esc(m[5]);
  }
  return out + esc(line.slice(i));
}

// Where each node lives in the source: { id -> { jsx: [a, b], styles: [[a, b], ...] } } in 1-based lines.
export function mapNodes(source) {
  const lines = source.split('\n'), starts = [0];
  for (let i = 0; i < lines.length; i++) starts.push(starts[i] + lines[i].length + 1);
  const lineOf = (pos) => { let lo = 0, hi = lines.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const nodes = {};
  const entry = (id) => (nodes[id] ??= { jsx: null, styles: [] });

  // JSX: every `data-n="id"` sits inside an opening tag; walk from that tag's `<` to the end of its element.
  const endOf = (from) => {
    let i = from, depth = 0;
    while (i < source.length) {
      if (source[i] !== '<') { i++; continue; }
      if (source[i + 1] === '/') { depth--; i = source.indexOf('>', i) + 1; if (depth <= 0) return i; continue; }
      let j = i + 1, brace = 0, q = null, self = false;
      for (; j < source.length; j++) {
        const c = source[j];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; continue; }
        if (brace) { if (c === '{') brace++; else if (c === '}') brace--; continue; }
        if (c === '{') { brace = 1; continue; }
        if (c === '>') { self = source[j - 1] === '/'; break; }
      }
      i = j + 1;
      if (self) { if (depth === 0) return i; } else depth++;
    }
    return source.length;
  };
  for (const m of source.matchAll(/data-n="([a-z][A-Za-z0-9_]*)"/g)) {
    const open = source.lastIndexOf('<', m.index);
    if (open < 0) continue;
    const end = endOf(open);
    entry(m[1]).jsx = [lineOf(open), lineOf(Math.max(open, end - 1))];
  }

  // Style entries: `  node: {` ... `  },` in `const base`, and `      node: {` ... in `const variants` (axis > value > node).
  let region = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^const base\b/.test(l)) region = 'base'; else if (/^const variants\b/.test(l)) region = 'variants'; else if (/^(function|export)\b/.test(l)) region = null;
    const m = region === 'base' ? /^ {2}(\w+): \{/.exec(l) : region === 'variants' ? /^ {6}(\w+): \{/.exec(l) : null;
    if (!m) continue;
    const close = region === 'base' ? /^ {2}\},?$/ : /^ {6}\},?$/;
    let j = i; while (j < lines.length && !close.test(lines[j]) && !(j > i && /^ {0,5}\S/.test(lines[j]) && region === 'variants')) j++;
    if (/\},?\s*$/.test(l) && /\{.*\}/.test(l)) j = i; // `node: {},` on one line
    entry(m[1]).styles.push([i + 1, Math.min(j, lines.length - 1) + 1]);
  }
  return nodes;
}

// The innermost node owning a line: its JSX element first, then a style block.
export function nodeAt(nodes, line) {
  let best = null;
  for (const [id, n] of Object.entries(nodes)) if (n.jsx && n.jsx[0] <= line && line <= n.jsx[1] && (!best || n.jsx[1] - n.jsx[0] <= best.size)) best = { id, size: n.jsx[1] - n.jsx[0] };
  if (best) return best.id;
  for (const [id, n] of Object.entries(nodes)) if (n.styles.some(([a, b]) => a <= line && line <= b)) return id;
  return null;
}

export function initCode(ctx, drawer) {
  let pane, body, head, nodes = {}, lines = [], source = '', rows = [];
  const S = { component: null, revision: null, perf: { frame: 0, painted: 0, lines: 0 } };
  const sources = new Map(); // component -> latest text, kept from change frames so nothing is fetched after an edit

  const currentId = () => ctx.state.selection?.component ?? S.component ?? ctx.state.components.keys().next().value ?? null;

  function setSource(id, text, revision) {
    sources.set(id, text);
    if (id === S.component) paintAll(text, revision);
  }

  function paintAll(text, revision) {
    const t0 = performance.now();
    source = text; lines = text.replace(/\n$/, '').split('\n'); nodes = mapNodes(text);
    // rewrite only the lines that changed, so a one-line edit touches one row
    const frag = document.createDocumentFragment();
    while (rows.length > lines.length) rows.pop().el.remove();
    lines.forEach((l, i) => {
      let r = rows[i];
      if (!r) { const ln = h('span', { class: 'ln', text: String(i + 1), 'aria-hidden': 'true' }), ct = h('span', { class: 'ct' }); const el = h('div', { class: 'cl', 'data-line': String(i + 1), role: 'presentation' }, ln, ct); r = rows[i] = { el, ct, text: null }; frag.append(el); }
      if (r.text !== l) { r.ct.innerHTML = paint(l) || '&nbsp;'; r.text = l; }
    });
    body.append(frag);
    head.querySelector('.c-rev').textContent = revision === undefined ? '' : `r${revision}`;
    S.revision = revision;
    highlight(false);
    S.perf.painted = performance.now(); S.perf.lines = lines.length; S.perf.ms = performance.now() - t0;
    body.dataset.revision = String(revision ?? '');
  }

  function highlight(scroll = true) {
    const sel = ctx.state.selection;
    for (const r of rows) r.el.classList.remove('hl', 'hl-style');
    const n = sel && sel.component === S.component ? nodes[sel.node] : null;
    body.dataset.node = n ? sel.node : '';
    if (!n) return;
    if (n.jsx) for (let l = n.jsx[0]; l <= n.jsx[1]; l++) rows[l - 1]?.el.classList.add('hl');
    for (const [a, b] of n.styles) for (let l = a; l <= b; l++) rows[l - 1]?.el.classList.add('hl-style');
    const first = n.jsx?.[0] ?? n.styles[0]?.[0];
    if (scroll && first) { const el = rows[first - 1]?.el; if (el) { const top = el.offsetTop - body.offsetTop; if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - 40) body.scrollTop = Math.max(0, top - 24); } }
  }

  async function show(id) {
    if (!id) return;
    S.component = id;
    head.querySelector('.c-name').textContent = `${ctx.state.components.get(id)?.name ?? id}.tsx`;
    if (sources.has(id)) paintAll(sources.get(id), ctx.state.components.get(id)?.revision);
    else {
      const r = await fetch(`/api/components/${encodeURIComponent(id)}`).then((x) => x.json()).catch(() => null);
      if (r?.source !== undefined && S.component === id) { sources.set(id, r.source); paintAll(r.source, r.revision); }
    }
  }

  function build(p) {
    pane = p; pane.classList.add('code');
    head = h('div', { class: 'c-head' }, h('span', { class: 'c-name' }), h('span', { class: 'c-rev' }), h('span', { class: 'c-hint', text: 'Click a line to select its node.' }));
    body = h('div', { class: 'c-body', id: 'code-lines', role: 'region', tabindex: '0', 'aria-label': 'Component source' });
    body.addEventListener('click', (ev) => {
      const row = ev.target.closest('.cl'); if (!row || !S.component) return;
      const id = nodeAt(nodes, Number(row.dataset.line)); if (!id) return;
      const c = ctx.state.components.get(S.component);
      const cur = ctx.state.selection;
      const variant = cur && cur.component === S.component ? cur.variant : (c?.doc ? variantGrid(c.doc)[0] : {});
      ctx.select({ component: S.component, node: id, variant });
    });
    pane.append(head, body);
  }

  drawer.add('code', 'Code', { build, onOpen() { const id = currentId(); show(id); } });

  // Sources come straight from the change frames (the server adds `source`), so the strip never waits for a fetch.
  ctx.on('change', (f) => {
    if (typeof f.source !== 'string') return;
    S.perf.frame = performance.now();
    setSource(f.component, f.source, f.revision);
  });
  ctx.on('added', (f) => { if (typeof f.source === 'string') setSource(f.component, f.source, f.revision); });
  ctx.on('removed', ({ component }) => { sources.delete(component); if (S.component === component && drawer.active === 'code') show(currentId()); });
  ctx.on('select', (s) => {
    if (drawer.active !== 'code') return;
    if (s && s.component !== S.component) show(s.component).then(() => highlight(true)); else highlight(true);
  });
  ctx.code = { perf: S.perf, state: S, mapNodes, nodeAt };
}
