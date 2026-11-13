import { plain } from './words.js';
import { renderVegaLite } from './vega-lite.js';
import { chartSpec } from './chart-spec.js';
import { modelView } from './model-view.js';
import { modelThree } from './model-three.js';
// The same live surface is used in /view and in canvas frames. No remote scripts or GPU renderer.
const item = JSON.parse(document.querySelector('#item').textContent),
  root = document.querySelector('#viewer'),
  r = item.recipe || {};
const enc = encodeURIComponent,
  raw = '/file/' + enc(item.id),
  esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
if (r.color) root.style.setProperty('--accent', r.color);
if (r.fontSize) root.style.setProperty('--font-size', Number(r.fontSize) + 'px');
if (r.wrap === false) root.classList.add('no-wrap');
const fmt = (n) => Number(n).toLocaleString(),
  label = item.path.split('/').at(-1),
  isReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bar = (name, info = '') =>
  `<div class="toolbar"><strong>${esc(name)}</strong><span class="meta">${esc(info)}</span></div>`;
const note = (t) => `<div class="note">${esc(t)}</div>`;
const error = (e) => {
  root.insertAdjacentHTML('beforeend', `<p class="error" role="alert">${esc(plain(e.message || e))}</p>`);
  root.querySelector('.loading')?.remove();
};
async function data(params = {}) {
  const p = new URLSearchParams(params),
    res = await fetch('/api/item-data/' + enc(item.id) + '?' + p);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error);
  return j;
}
function highlight(text) {
  const regex =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|#[^\n]*|\b(?:const|let|var|function|return|class|import|from|export|default|if|else|for|while|def|fn|pub|async|await|true|false|null|None|SELECT|FROM|WHERE)\b|\b\d+(?:\.\d+)?\b)/g;
  let html = '',
    at = 0;
  for (const m of text.matchAll(regex)) {
    html += esc(text.slice(at, m.index));
    const token = m[0],
      type = /^["'`]/.test(token)
        ? 'string'
        : /^(\/\/|#)/.test(token)
          ? 'comment'
          : /^\d/.test(token)
            ? 'number'
            : 'key';
    html += `<span class="tok-${type}">${esc(token)}</span>`;
    at = m.index + token.length;
  }
  return html + esc(text.slice(at));
}
function source(text, kind = 'code') {
  return `<pre class="source${r.wrap !== false ? ' wrap' : ''}" style="--font-size:${Number(r.fontSize) || 13}px">${text
    .split('\n')
    .map(
      (line, i) =>
        `<span class="code-line${kind === 'diff' ? (line.startsWith('+') ? ' diff-add' : line.startsWith('-') ? ' diff-del' : line.startsWith('@@') ? ' diff-hunk' : '') : ''}"><span class="line-no">${i + 1}</span>${kind === 'txt' || kind === 'diff' ? esc(line) : highlight(line)}</span>`,
    )
    .join('')}</pre>`;
}
function safeUrl(u, image = false) {
  if (/^https?:\/\//.test(u) || u.startsWith('#')) return u;
  if (/^[a-z]+:/i.test(u)) return '#';
  const parts = item.path.split('/');
  parts.pop();
  return '/raw/' + [...parts, ...u.split('/')].map(enc).join('/');
}
// Markdown is rendered by marked (public/canvas/markdown-runtime.js, MIT) with GitHub's dialect: tables, task lists,
// strikethrough, autolinks, nested lists, fenced code. Raw HTML inside the file is shown as text, never run, and links and images
// resolve inside the opened folder.
let md = null;
async function loadMarkdown() {
  if (md) return md;
  const { Marked } = await import('./markdown-runtime.js');
  md = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => esc(text),
      link({ href, title, tokens }) {
        return `<a href="${esc(safeUrl(href))}"${title ? ` title="${esc(title)}"` : ''} rel="noreferrer" target="_blank">${this.parser.parseInline(tokens)}</a>`;
      },
      image: ({ href, title, text }) => `<img alt="${esc(text)}" src="${esc(safeUrl(href, true))}"${title ? ` title="${esc(title)}"` : ''}>`,
      code: ({ text }) => `<pre><code>${highlight(text)}</code></pre>`,
    },
  });
  return md;
}
function markdown(t) {
  t = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  return `<article class="prose" style="--font-size:${Number(r.fontSize) || 15}px">${md.parse(t)}</article>`;
}
function hist(bins) {
  const max = Math.max(1, ...bins);
  return `<svg class="hist" data-distribution viewBox="0 0 100 27" aria-label="Column distribution">${bins.map((v, i) => `<rect x="${(i * 100) / bins.length}" y="${27 - (v / max) * 25}" width="${Math.max(1, 100 / bins.length - 1)}" height="${(v / max) * 25}"/>`).join('')}</svg>`;
}
// Cells arrive as the exact text of the file; the column type only decides alignment and the distribution.
function table(d, numbered = false) {
  const first = d.rowStart ?? d.offset ?? 0,
    numeric = (d.columns || []).map((c) => /int|num|float|double|decimal/i.test(c.type));
  return `<div class="table-scroll"><table><thead><tr>${numbered ? '<th scope="col" data-type="number" class="rownum">row<small>number</small></th>' : ''}${(d.columns || []).map((c) => `<th scope="col" data-type="${esc(c.type)}">${esc(c.name)}<small>${esc(c.type)}${c.distinct !== undefined ? ` · ${c.distinct} distinct` : ''}${c.missing ? ` · ${c.missing} missing` : ''}</small>${hist(c.bins || [])}${c.min !== null && c.min !== undefined ? `<small>${esc(c.min)} — ${esc(c.max)}</small>` : ''}</th>`).join('')}</tr></thead><tbody>${(d.rows || []).map((row, n) => `<tr>${numbered ? `<td class="num rownum">${fmt(first + n + 1)}</td>` : ''}${row.map((v, i) => `<td class="${v === null ? 'null' : numeric[i] ? 'num' : ''}">${v === null ? '∅' : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const ROW_H = 26, WINDOW_H = 380;
async function showTable(params = {}) {
  const d = await data(params);
  // A long table scrolls like a document: the scrollbar spans every row, and where it stops decides which rows are drawn.
  const long = d.total > 400 && (d.starts || d.tables || ['arrow', 'sqlite', 'csv', 'tsv', 'jsonl', 'parquet'].includes(item.kind));
  const numbered = d.rowStart !== undefined || (long && d.offset !== undefined);
  root.innerHTML =
    bar(
      label,
      `${d.total === null ? 'Window of' : fmt(d.total ?? d.rows?.length ?? 0)} rows · ${d.columns?.length || 0} columns`,
    ) +
    `<div class="toolbar">${long ? '' : `<button id="prev" aria-label="Previous rows">←</button>`}<span class="meta" id="range">${fmt(d.rowStart ?? d.offset ?? 0)}–${fmt((d.rowStart ?? d.offset ?? 0) + (d.rows?.length ?? 0))}</span>${long ? '' : `<button id="next" aria-label="Next rows">→</button>`}${d.tables ? `<select id="tables" aria-label="Table">${d.tables.map((t) => `<option${t === d.name ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}${!long && d.groups > 1 ? `<select id="groups" aria-label="Row group">${Array.from({ length: Math.min(1000, d.groups) }, (_, i) => `<option value="${i}"${i === d.group ? ' selected' : ''}>Group ${i + 1}</option>`).join('')}</select>` : ''}</div>` +
    (long
      ? `<div class="vscroll" id="vs" tabindex="0" aria-label="Rows of ${esc(label)}" style="height:${WINDOW_H}px"><div class="vspace" style="height:${Math.min(3e7, d.total * ROW_H)}px"><div class="vwin">${table(d, numbered)}</div></div></div>`
      : table(d, numbered)) +
    note(
      d.note ||
        `${d.rows?.length || 0} sampled rows. Distributions describe this window.${d.truncated ? ' Text scan stops at 8 MiB.' : ''}`,
    );
  const offset = Number(params.offset ?? r.rowOffset ?? 0),
    size = Number(r.pageSize) || 80;
  root.querySelector('#prev')?.addEventListener('click', () =>
    showTable({ ...params, offset: Math.max(0, offset - size) }).catch(error),
  );
  root.querySelector('#next')?.addEventListener('click', () =>
    showTable({ ...params, offset: offset + size }).catch(error),
  );
  root
    .querySelector('#tables')
    ?.addEventListener('change', (e) =>
      showTable({ table: e.target.value, offset: 0 }).catch(error),
    );
  root
    .querySelector('#groups')
    ?.addEventListener('change', (e) => showTable({ group: e.target.value }).catch(error));
  if (long) virtualRows(d, params);
}
function virtualRows(d, params) {
  const box = root.querySelector('#vs'),
    win = root.querySelector('.vwin'),
    range = root.querySelector('#range');
  let timer = 0,
    seq = 0,
    at = null;
  const rowAt = () => {
    const span = box.scrollHeight - box.clientHeight;
    return span > 0 ? Math.floor((box.scrollTop / span) * Math.max(0, d.total - 1)) : 0;
  };
  box.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const row = rowAt(),
        mine = ++seq;
      let q;
      if (d.starts) {
        let g = 0;
        for (let lo = 0, hi = d.starts.length - 1; lo <= hi; ) {
          const mid = (lo + hi) >> 1;
          if (d.starts[mid] <= row) (g = mid), (lo = mid + 1);
          else hi = mid - 1;
        }
        if (g === at) return;
        q = { ...params, group: g };
        at = g;
      } else q = { ...params, offset: Math.max(0, Math.min(d.total - Math.min(d.rows?.length || 80, d.total), row)) };
      try {
        const n = await data(q);
        if (mine !== seq) return;
        win.innerHTML = table(n, true);
        range.textContent = `${fmt(n.rowStart ?? n.offset ?? 0)}–${fmt((n.rowStart ?? n.offset ?? 0) + (n.rows?.length ?? 0))}`;
      } catch (e) {
        error(e);
      }
    }, 60);
  });
}
// JSON is parsed from the file's text with each number's own digits (a 19-digit id or 1.50 is shown as written).
class Exact {
  constructor(source) {
    this.source = source;
  }
}
const parseExact = (t) =>
  JSON.parse(t, (k, v, c) => (typeof v === 'number' && typeof c?.source === 'string' && String(v) !== c.source ? new Exact(c.source) : v));
// Every value of the file is reachable: a branch draws its children when it is opened, 200 at a time, with a button for the next
// 200, so a list of a million entries opens as fast as a list of ten and its last entry is still one click range away.
const PAGE = 200;
function jsonLeaf(v, key) {
  const text = v instanceof Exact ? v.source : JSON.stringify(v),
    type = typeof v === 'string' ? 'string' : 'number';
  return `<div class="json-leaf"><span class="json-key">${esc(key)}</span> <span class="tok-${type}">${esc(text)}</span></div>`;
}
function jsonNode(v, key, depth) {
  if (v === null || typeof v !== 'object' || v instanceof Exact) return jsonLeaf(v, key);
  const n = Array.isArray(v) ? v.length : Object.keys(v).length;
  return `<details data-depth="${depth}"${depth < 2 ? ' open' : ''}><summary><span class="json-key">${esc(key)}</span> <span class="meta">${Array.isArray(v) ? '[' : '{'} ${fmt(n)} ${Array.isArray(v) ? ']' : '}'}</span></summary></details>`;
}
function jsonTree(host, value) {
  const values = new WeakMap();
  const fill = (el, v, depth, from = 0) => {
    const entries = Array.isArray(v) ? v : Object.keys(v),
      n = entries.length,
      to = Math.min(n, from + PAGE);
    let html = '';
    for (let i = from; i < to; i++) {
      const k = Array.isArray(v) ? i : entries[i];
      html += jsonNode(v[k], String(k), depth + 1);
    }
    el.querySelector(':scope > .json-more')?.remove();
    const before = el.querySelectorAll(':scope > details').length;
    el.insertAdjacentHTML('beforeend', html + (to < n ? `<button type="button" class="json-more">Show entries ${fmt(to + 1)}–${fmt(Math.min(n, to + PAGE))} of ${fmt(n)}</button>` : ''));
    const kids = [...el.querySelectorAll(':scope > details')].slice(before);
    let j = 0;
    for (let i = from; i < to; i++) {
      const k = Array.isArray(v) ? i : entries[i],
        x = v[k];
      if (x !== null && typeof x === 'object' && !(x instanceof Exact)) {
        const d = kids[j++];
        values.set(d, { v: x, depth: depth + 1 });
        if (d.open) fill(d, x, depth + 1);
      }
    }
    el.dataset.filled = to;
  };
  host.innerHTML = jsonNode(value, 'root', 0);
  const top = host.querySelector('details');
  if (!top) return;
  values.set(top, { v: value, depth: 0 });
  fill(top, value, 0);
  host.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.tagName === 'DETAILS' && d.open && !d.dataset.filled && values.has(d)) fill(d, values.get(d).v, values.get(d).depth);
  }, true);
  host.addEventListener('click', (e) => {
    const more = e.target.closest('.json-more');
    if (!more) return;
    const d = more.parentElement,
      { v, depth } = values.get(d);
    fill(d, v, depth, Number(d.dataset.filled));
  });
}
async function chartView(j) {
  const rel = (u) => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u)) throw new Error('only files in this folder can be read');
    return safeUrl(u);
  };
  const load = async (u) => {
    const res = await fetch(rel(u));
    if (!res.ok) throw new Error('not found');
    return res.text();
  };
  const spec = chartSpec(j);
  const { svg, notes, empty } = await renderVegaLite(spec, { load });
  return (
    svg +
    (empty ? note('This chart has no rows to draw.') : '') +
    (notes.length ? note('Not drawn: ' + notes.join('. ') + '.') : '')
  );
}
function graph(j) {
  let nodes = Array.isArray(j.nodes)
    ? j.nodes
    : Object.entries(j)
        .filter(([, v]) => v?.class_type)
        .map(([id, v], i) => ({
          id,
          title: v.class_type,
          pos: [(i % 3) * 240, Math.floor(i / 3) * 180],
          widgets_values: Object.entries(v.inputs || {})
            .filter(([, v]) => !Array.isArray(v))
            .map(([k, v]) => `${k}: ${v}`),
          inputs: Object.entries(v.inputs || {})
            .filter(([, v]) => Array.isArray(v))
            .map(([name, v]) => ({ name, source: v[0] })),
        }));
  nodes = nodes.slice(0, 160);
  const map = new Map(
    nodes.map((n, i) => {
      const p = Array.isArray(n.pos)
        ? n.pos
        : [n.pos?.[0] || (i % 3) * 240, n.pos?.[1] || Math.floor(i / 3) * 180];
      return [
        String(n.id),
        {
          ...n,
          x: Number(p[0]) || 0,
          y: Number(p[1]) || 0,
          w: 200,
          h: 75 + Math.min(5, n.widgets_values?.length || 0) * 19,
        },
      ];
    }),
  );
  const values = [...map.values()];
  if (!values.length) return note('Workflow has no nodes');
  const minX = Math.min(...values.map((n) => n.x)) - 20,
    minY = Math.min(...values.map((n) => n.y)) - 20,
    maxX = Math.max(...values.map((n) => n.x + n.w)) + 20,
    maxY = Math.max(...values.map((n) => n.y + n.h)) + 20;
  let links = j.links || [];
  if (!Array.isArray(j.nodes))
    links = values.flatMap((n) => (n.inputs || []).map((v, i) => [0, v.source, 0, n.id, i]));
  const paths = links
    .map((l) => {
      const a = map.get(String(Array.isArray(l) ? l[1] : l.origin_id)),
        b = map.get(String(Array.isArray(l) ? l[3] : l.target_id));
      if (!a || !b) return '';
      return `<path class="edge" d="M${a.x + a.w},${a.y + 48} C${a.x + a.w + 65},${a.y + 48} ${b.x - 65},${b.y + 48} ${b.x},${b.y + 48}"/>`;
    })
    .join('');
  return `<div class="workflow"><svg width="${Math.max(600, (maxX - minX) * (r.scale || 1))}" height="${Math.max(300, (maxY - minY) * (r.scale || 1))}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="Workflow graph">${paths}${values
    .map(
      (n) =>
        `<g transform="translate(${n.x},${n.y})"><rect class="node" width="200" height="${n.h}" rx="7"/><rect class="node-head" width="200" height="31" rx="7"/><text x="12" y="21">${esc(String(n.title || n.type || n.class_type || n.id).slice(0, 28))}</text><circle class="port" cx="0" cy="48" r="4"/><circle class="port" cx="200" cy="48" r="4"/><text x="12" y="52" opacity=".5">#${esc(n.id)}</text>${(
          n.widgets_values || []
        )
          .slice(0, 5)
          .map(
            (v, i) =>
              `<text x="12" y="${75 + i * 19}">${esc(String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 28))}</text>`,
          )
          .join('')}</g>`,
    )
    .join('')}</svg></div>`;
}
async function archive() {
  const d = await data();
  root.innerHTML =
    bar(label, `${d.entries.length} entries`) +
    `<div class="archive"><nav aria-label="Archive contents"><input aria-label="Filter archive" placeholder="Filter paths" value="${esc(r.filter || '')}"><ul role="tree" aria-label="Archive entries"></ul></nav><section><p class="note">Choose a file to read it without extracting the archive.</p></section></div>`;
  const nav = root.querySelector('nav ul'),
    preview = root.querySelector('.archive section');
  function draw(filter) {
    nav.innerHTML = d.entries
      .filter((e) => e.name.includes(filter))
      .map(
        (e, i) =>
          `<li role="treeitem" class="entry"><button data-index="${d.entries.indexOf(e)}" style="padding-left:${8 + Math.min(8, e.name.split('/').length - 1) * 10}px"><span class="entry-name">${esc(e.name)}</span><br><span class="meta">${fmt(e.bytes)} bytes</span></button></li>`,
      )
      .join('');
  }
  draw(r.filter || '');
  root.querySelector('input').oninput = (e) => draw(e.target.value);
  nav.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    nav.querySelector('[aria-current]')?.removeAttribute('aria-current');
    b.setAttribute('aria-current', 'true');
    try {
      const entry = await data({ entry: d.entries[Number(b.dataset.index)].name });
      preview.innerHTML = entry.binary
        ? `<pre class="hex">${esc(entry.hex.match(/.{1,32}/g)?.join('\n'))}</pre>`
        : source(entry.text);
    } catch (e) {
      preview.innerHTML = note(e.message);
    }
  };
}
async function pdfViewer(page = Number(r.page) || 1) {
  const d = await data({ page });
  if (!d.image) {
    root.innerHTML = bar(label, 'PDF') + note(d.note || 'This PDF could not be drawn.') + `<iframe class="pdf" title="${esc(label)}" src="${raw}"></iframe>`;
    return;
  }
  root.innerHTML =
    bar(label, `Page ${d.page} of ${d.pages}`) +
    `<div class="toolbar"><button id="prev" aria-label="Previous page"${d.page <= 1 ? ' disabled' : ''}>←</button><span class="meta">${d.page} / ${d.pages}</span><button id="next" aria-label="Next page"${d.page >= d.pages ? ' disabled' : ''}>→</button></div><div class="pdf-page" tabindex="0" aria-label="Page ${d.page}. Page Up and Page Down change page, plus and minus zoom."><canvas style="width:${d.zoom}%" aria-label="PDF page ${d.page}"></canvas></div>`;
  const img = new Image();
  img.onload = () => {
    const c = root.querySelector('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
  };
  img.src = d.image;
  const pg = root.querySelector('.pdf-page');
  pg.onkeydown = (e) => {
    if (e.key === 'PageDown' && d.page < d.pages) { e.preventDefault(); pdfViewer(d.page + 1).catch(error); }
    else if (e.key === 'PageUp' && d.page > 1) { e.preventDefault(); pdfViewer(d.page - 1).catch(error); }
  };
  root.querySelector('#prev').onclick = () => pdfViewer(d.page - 1).catch(error);
  root.querySelector('#next').onclick = () => pdfViewer(d.page + 1).catch(error);
}
function notebook(j) {
  return `<div class="notebook">${(j.cells || [])
    .slice(0, 100)
    .map((c) =>
      c.cell_type === 'markdown'
        ? `<div class="nb-cell">${markdown(Array.isArray(c.source) ? c.source.join('') : c.source || '')}</div>`
        : `<div class="nb-cell"><header>In [${esc(c.execution_count ?? ' ')}] · ${esc(j.metadata?.kernelspec?.display_name || 'code')}</header>${source(Array.isArray(c.source) ? c.source.join('') : c.source || '')}${(
            c.outputs || []
          )
            .map((o) => {
              const d = o.data || {},
                text = o.text || d['text/plain'] || o.traceback || [];
              return `<div class="nb-output">${d['image/png'] ? `<img alt="Notebook output" src="data:image/png;base64,${esc(d['image/png'])}">` : d['text/html'] ? `<iframe sandbox srcdoc="${esc(Array.isArray(d['text/html']) ? d['text/html'].join('') : d['text/html'])}" title="Notebook output"></iframe>` : `<pre class="source">${esc(Array.isArray(text) ? text.join('') : text)}</pre>`}</div>`;
            })
            .join('')}</div>`,
    )
    .join('')}</div>`;
}
// Lottie runs on lottie-web (public/canvas/lottie-runtime.js, MIT): the format's own player, so precompositions, masks, mattes,
// gradients, trim paths, repeaters, text and expressions are drawn by the code that defines them.
let lottieLoad = null;
const loadLottie = () =>
  (lottieLoad ||= new Promise((ok, no) => {
    if (window.lottie) return ok(window.lottie);
    const s = document.createElement('script');
    s.src = '/canvas/lottie-runtime.js';
    s.onload = () => ok(window.lottie);
    s.onerror = () => no(new Error('The Lottie player could not be loaded. Reload the page to try again; the file is unchanged.'));
    document.head.append(s);
  }));
// Hand-written and generated files often list a shape and its fill straight on the layer. The player wants them in a group
// with a transform, so loose items are wrapped in one (the drawing is the same, nothing is added to the file on disk).
function groupLoose(layers) {
  for (const l of layers || []) {
    if (l.ty !== 4 || !Array.isArray(l.shapes) || l.shapes.every((x) => x.ty === 'gr' || x.ty === 'tr')) continue;
    const loose = l.shapes.filter((x) => x.ty !== 'gr'),
      at = l.shapes.findIndex((x) => x.ty !== 'gr'),
      rest = l.shapes.filter((x) => x.ty === 'gr');
    const group = { ty: 'gr', nm: 'Group', it: [...loose.filter((x) => x.ty !== 'tr'), loose.find((x) => x.ty === 'tr') || { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] };
    rest.splice(Math.min(at, rest.length), 0, group);
    l.shapes = rest;
  }
}
// Defaults the Lottie format allows a file to leave out but lottie-web reads without a fallback (a layer with no start time
// "st" draws nothing at all). Filling them changes nothing the file says; the file on disk is untouched.
function lottieDefaults(comp) {
  const prop = (p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return;
    if (p.a === undefined && 'k' in p) p.a = Array.isArray(p.k) && p.k.length && typeof p.k[0] === 'object' && p.k[0] !== null && 't' in p.k[0] ? 1 : 0;
  };
  const shapes = (list) => {
    for (const x of list || []) {
      for (const v of Object.values(x)) prop(v);
      if (x.ty === 'gr') shapes(x.it);
    }
  };
  const layers = (list, ip, op) =>
    (list || []).forEach((l, i) => {
      l.st ??= 0;
      l.sr ??= 1;
      l.ind ??= i + 1;
      l.ddd ??= 0;
      l.ip ??= ip;
      l.op ??= op;
      l.ks ??= {};
      for (const k of ['a', 'p', 's', 'r', 'o']) l.ks[k] ??= { a: 0, k: k === 's' ? [100, 100, 100] : k === 'o' ? 100 : k === 'r' ? 0 : [0, 0, 0] };
      for (const v of Object.values(l.ks)) prop(v);
      shapes(l.shapes);
    });
  layers(comp.layers, comp.ip, comp.op);
  for (const asset of comp.assets || []) if (asset.layers) layers(asset.layers, comp.ip, comp.op);
}
// Image assets name a folder (u) and a file (p) relative to the animation; they are read through the folder's own file route.
function lottieAssets(comp) {
  for (const asset of comp.assets || []) {
    if (asset.layers || !asset.p || asset.e === 1 || /^data:/.test(asset.p)) continue;
    const ref = (asset.u || '') + asset.p;
    asset.u = '';
    asset.p = /^(https?:)?\/\//i.test(ref) ? '#' : safeUrl(ref, true);
  }
}
async function lottie(j) {
  const lib = await loadLottie();
  j = JSON.parse(JSON.stringify(j));
  lottieDefaults(j);
  groupLoose(j.layers);
  for (const a of j.assets || []) groupLoose(a.layers);
  lottieAssets(j);
  root.innerHTML =
    bar(label, `${j.w} × ${j.h} · ${j.fr} fps`) +
    '<div class="motion-stage"><div class="lottie-host" tabindex="0" role="img" aria-label="Vector animation. Space plays or pauses, arrow keys step."></div></div>';
  const host = root.querySelector('.lottie-host'),
    notes = [];
  let anim;
  try {
    anim = lib.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: true,
      autoplay: !(isReduced || r.paused),
      animationData: j,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    });
  } catch (e) {
    return void root.insertAdjacentHTML('beforeend', note('This animation could not be played: ' + e.message + '. The file may not follow the Lottie format.'));
  }
  anim.setSpeed(Number(r.speed) || 1);
  if (isReduced || r.paused) anim.goToAndStop(Number(j.ip) || 0, true);
  anim.addEventListener('data_failed', () => root.insertAdjacentHTML('beforeend', note('Some of this animation could not be loaded.')));
  // A drawing with no visible geometry is reported, never left as a silent blank stage.
  anim.addEventListener('DOMLoaded', () => {
    const svg = host.querySelector('svg'),
      drawn = [...(svg?.querySelectorAll('path,image,text') || [])].some((el) => (el.tagName === 'path' ? (el.getAttribute('d') || '').replace(/[^0-9]/g, '').length > 0 : true));
    if (!drawn) root.insertAdjacentHTML('beforeend', note('The player drew nothing for this animation: its layers have no shapes, images or text it can show at this frame.'));
    const missing = [...(svg?.querySelectorAll('image') || [])].filter((im) => !im.getAttribute('href') && !im.getAttribute('xlink:href'));
    if (missing.length) root.insertAdjacentHTML('beforeend', note(missing.length + ' image layers have no picture.'));
  });
  for (const asset of j.assets || [])
    if (asset.p && !asset.layers && asset.p !== '#' && !/^data:/.test(asset.p)) {
      const probe = new Image();
      probe.onerror = () => root.insertAdjacentHTML('beforeend', note('Image ' + asset.id + ' (' + decodeURIComponent(asset.p.split('/').pop()) + ') could not be found next to the animation.'));
      probe.src = asset.p;
    }
  if ((j.layers || []).some((l) => l.ddd === 1 || l.ty === 13)) notes.push('3D layers and cameras are drawn flat');
  if (notes.length) root.insertAdjacentHTML('beforeend', note('Partly drawn: ' + notes.join('. ') + '.'));
  host.addEventListener('keydown', (e) => {
    if (e.key === ' ') anim.isPaused ? anim.play() : anim.pause();
    else if (e.key === 'ArrowRight') anim.goToAndStop(Math.min(anim.totalFrames, anim.currentFrame + 1), true);
    else if (e.key === 'ArrowLeft') anim.goToAndStop(Math.max(0, anim.currentFrame - 1), true);
    else if (e.key === 'Home') anim.goToAndStop(0, true);
    else return;
    e.preventDefault();
  });
}
async function run() {
  if (item.family === 'image') {
    root.innerHTML = `<div class="media"><img alt="${esc(label)}" src="${raw}" style="object-fit:${r.fit === 'cover' ? 'cover' : 'contain'};filter:brightness(${2 ** (Number(r.exposure) || 0)}) contrast(${Number(r.contrast ?? 1)})"><span class="stamp">${esc(item.kind.toUpperCase())}</span></div>`;
    const img = root.querySelector('img');
    img.onload = () => {
      root.querySelector('.stamp').textContent =
        `${item.kind.toUpperCase()} · ${img.naturalWidth} × ${img.naturalHeight}`;
    };
    img.onerror = async () => {
      let head = '';
      try {
        const b = new Uint8Array(await (await fetch(raw, { headers: { range: 'bytes=0-23' } })).arrayBuffer()).slice(0, 24);
        head = [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
      } catch {}
      root.innerHTML = bar(label, item.kind.toUpperCase()) +
        note('This file is named like a ' + item.kind.toUpperCase() + ' image but the browser cannot decode it. It may be cut short or damaged.') +
        (head ? '<p class="meta">' + esc(item.bytes + ' bytes. It starts with: ') + '<code>' + esc(head) + '</code></p>' : '');
    };
    return;
  }
  if (item.family === 'video') {
    root.innerHTML = `<div class="media video"><video controls playsinline preload="metadata" ${r.muted !== false ? 'muted' : ''} src="${raw}"></video><span class="stamp">Move across to scrub</span></div>`;
    const v = root.querySelector('video'),
      stamp = root.querySelector('.stamp');
    v.playbackRate = Number(r.playbackRate) || 1;
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(Number(r.posterTime) || 0, Math.max(0, v.duration - 0.01));
    };
    let queued = false,
      fraction = 0;
    function scrub(f) {
      fraction = f;
      if (queued || !Number.isFinite(v.duration)) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        v.currentTime = Math.max(0, Math.min(v.duration - 0.01, fraction * v.duration));
        stamp.textContent = `${v.currentTime.toFixed(1)} / ${v.duration.toFixed(1)} s`;
      });
    }
    v.onpointermove = (e) => {
      if (v.paused) {
        const b = v.getBoundingClientRect();
        scrub((e.clientX - b.left) / b.width);
      }
    };
    addEventListener('message', (e) => {
      if (e.source === parent && e.data?.type === 'kind-scrub') scrub(e.data.fraction);
    });
    return;
  }
  if (item.family === 'audio') {
    root.innerHTML =
      bar(label, 'Waveform') +
      `<div class="audio-wrap"><svg class="waveform" viewBox="0 0 720 180" role="img" aria-label="Audio waveform"><line class="axis" x1="0" x2="720" y1="90" y2="90"/></svg><audio controls preload="metadata" src="${raw}"></audio></div>`;
    const audio = root.querySelector('audio');
    audio.volume = Math.min(1, Number(r.gain ?? 1));
    audio.playbackRate = Number(r.playbackRate) || 1;
    const d = await data(),
      svg = root.querySelector('svg');
    svg.insertAdjacentHTML(
      'beforeend',
      d.peaks
        .map(
          (v, i) =>
            `<rect x="${i * 3}" y="${90 - Math.max(1, v * 80)}" width="2" height="${Math.max(2, v * 160)}" rx="1"/>`,
        )
        .join(''),
    );
    svg.tabIndex = 0;
    svg.setAttribute('role', 'slider');
    svg.setAttribute('aria-label', 'Audio waveform. Left and right arrows seek, Home and End jump.');
    svg.onkeydown = (e) => {
      const step = e.shiftKey ? 15 : 5;
      if (!Number.isFinite(audio.duration)) return;
      if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
      else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - step);
      else if (e.key === 'Home') audio.currentTime = 0;
      else if (e.key === 'End') audio.currentTime = audio.duration;
      else if (e.key === ' ') audio.paused ? audio.play() : audio.pause();
      else return;
      e.preventDefault();
    };
    svg.onclick = (e) => {
      if (Number.isFinite(audio.duration)) {
        const b = svg.getBoundingClientRect();
        audio.currentTime = ((e.clientX - b.left) / b.width) * (d.sampledSeconds || audio.duration);
      }
    };
    root.insertAdjacentHTML(
      'beforeend',
      note(
        d.note ||
          `${d.duration ? d.duration.toFixed(2) + ' seconds · ' : ''}${d.sampleRate ? fmt(d.sampleRate) + ' Hz · ' : ''}${d.channels ? d.channels + ' channels · ' : ''}waveform covers ${Number(d.sampledSeconds).toFixed(1)} seconds`,
      ),
    );
    return;
  }
  if (['table', 'parquet', 'sqlite', 'arrow'].includes(item.family)) return showTable();
  if (item.family === 'font') {
    const style = document.createElement('style');
    style.textContent = `@font-face{font-family:specimen;src:url(${JSON.stringify(raw)})}`;
    document.head.append(style);
    root.innerHTML =
      bar(label, `${item.kind.toUpperCase()}${item.meta?.glyphs ? ` · ${item.meta.glyphs} glyphs` : ''}`) +
      `<div class="font-specimen" aria-label="Type specimen" style="--specimen-size:${Number(r.size) || 56}px;--weight:${Number(r.weight) || 400}"><div class="hero" contenteditable="true" spellcheck="false" aria-label="Editable specimen text">${esc(r.specimen || 'Sphinx of black quartz, judge my vow.')}</div><div class="glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 &amp; @ ! ?</div>${[12, 18, 24].map((size) => `<div class="font-line" style="font-size:${size}px"><small>${size}</small>The quick brown fox jumps over the lazy dog.</div>`).join('')}</div>`;
    return;
  }
  if (item.family === 'pdf') return pdfViewer();
  if (item.family === 'zip') return archive();
  if (item.family === 'model') {
    const args = { root, recipe: r, label, bar, note, fmt, isReduced, esc };
    const soft = async () => modelView({ ...args, scene: await data() });
    const real = async () => {
      const buffer = await (await fetch(raw)).arrayBuffer();
      return modelThree({ ...args, buffer, kind: item.kind === 'obj' ? 'obj' : 'gltf', itemId: item.id, fallback: soft });
    };
    // On its own page the real 3D runtime (three.js) draws it. Inside a canvas card a thousand folders must stay cheap, so the
    // card starts on the light software drawing and upgrades to the real runtime when the card is pointed at, focused or entered.
    const card = window.parent !== window ? window.frameElement?.closest?.('.item-card') : null;
    if (!card) {
      try {
        return await real();
      } catch (e) {
        console.warn('3D runtime unavailable, using the software viewer:', e.message);
        return soft();
      }
    }
    await soft();
    let upgraded = false;
    const upgrade = async () => {
      if (upgraded) return;
      upgraded = true;
      try {
        await real();
      } catch (e) {
        console.warn('3D runtime unavailable, keeping the software viewer:', e.message);
        await soft();
      }
    };
    document.addEventListener('pointermove', upgrade, { once: true });
    document.addEventListener('pointerdown', upgrade, { once: true });
    document.addEventListener('focusin', upgrade, { once: true });
    if (card.dataset.focused) upgrade();
    new MutationObserver(() => card.dataset.focused && upgrade()).observe(card, { attributes: true, attributeFilter: ['data-focused'] });
    return;
  }
  const d = await data();
  if (item.family === 'binary') {
    const b = d.hex.match(/.{1,2}/g) || [],
      cols = Number(r.columns) || 16;
    root.innerHTML =
      bar(label, `${fmt(item.bytes)} bytes`) +
      `<div class="binary-grid"><pre class="hex">${Array.from(
        { length: Math.ceil(b.length / cols) },
        (_, i) => {
          const bytes = b.slice(i * cols, (i + 1) * cols),
            ascii = bytes
              .map((h) => {
                const c = parseInt(h, 16);
                return c >= 32 && c < 127 ? String.fromCharCode(c) : '·';
              })
              .join('');
          return `${(d.offset + i * cols).toString(16).padStart(8, '0')}  ${bytes.join(' ').padEnd(cols * 3)}  ${ascii}`;
        },
      )
        .map(esc)
        .join(
          '\n',
        )}</pre><div class="strings"><b>Strings</b>${d.strings.map((s) => `<div><small>${s.offset.toString(16)}</small>${esc(s.text)}</div>`).join('') || note('No printable strings in this window')}</div></div>`;
    return;
  }
  if (item.family === 'markdown') {
    await loadMarkdown();
    root.innerHTML = markdown(d.text) + (d.limited ? note('Showing the first 1 MiB') : '');
    return;
  }
  if (item.family === 'json') {
    root.innerHTML =
      (d.asTable ? bar(label, `${fmt(d.total)} records · ${d.columns.length} columns`) + table(d) : bar(label, 'Structured values') + '<div class="json-tree"></div>');
    if (!d.asTable) jsonTree(root.querySelector('.json-tree'), parseExact(d.text));
    return;
  }
  if (item.family === 'notebook') {
    await loadMarkdown();
    root.innerHTML = bar(label, `${d.data.cells?.length || 0} cells`) + notebook(d.data);
    return;
  }
  if (item.family === 'chart') {
    root.innerHTML = bar(typeof d.data.title === 'object' ? d.data.title?.text || label : d.data.title || label, item.kind) + (await chartView(d.data));
    return;
  }
  if (item.family === 'graph') {
    root.innerHTML = bar(label, 'Workflow') + graph(d.data);
    return;
  }
  if (item.family === 'timeline') {
    root.innerHTML =
      bar(label, `${d.events.length} events`) +
      `<ol class="timeline" role="log" aria-label="Run log">${d.events.map((e, i) => `<li class="event"><header><span>${String(i + 1).padStart(2, '0')} · ${esc(e.role || e.type || e.event || 'Step')}</span><time>${esc(e.timestamp || e.time || e.at || '')}</time></header><pre>${esc(typeof e.content === 'string' ? e.content : e.message || e.text || JSON.stringify(e.content ?? e, null, 2))}</pre></li>`).join('')}</ol>` +
      (d.limited ? note('Showing the source window') : '');
    return;
  }
  if (item.family === 'animation') {
    if (item.kind === 'lottie') return lottie(d.data);
    root.innerHTML =
      bar(label, 'Web animation') +
      `<div class="motion-stage"><div class="motion-chip">${esc(d.data.text || 'Motion')}</div></div>`;
    const a = root
      .querySelector('.motion-chip')
      .animate(d.data.keyframes, { ...(d.data.options || d.data.timing), iterations: Infinity });
    a.playbackRate = Number(r.speed) || 1;
    if (r.paused || isReduced) a.pause();
    return;
  }
  if (item.family === 'css') {
    const vars = [...d.text.matchAll(/(--[\w-]+)\s*:\s*([^;}\n]+)/g)];
    root.innerHTML =
      bar(label, item.kind === 'css-keyframes' ? 'Keyframes' : 'CSS variables') +
      `<div class="swatches">${vars
        .slice(0, 20)
        .map(
          (m) =>
            `<div class="swatch"><i style="background:${esc(m[2])}"></i><span>${esc(m[1])}<br>${esc(m[2])}</span></div>`,
        )
        .join('')}</div>`;
    const iframe = document.createElement('iframe');
    iframe.className = 'css-preview';
    iframe.sandbox = '';
    iframe.title = 'Stylesheet specimen';
    const animation = /@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(d.text)?.[1];
    iframe.srcdoc = `<style>body{margin:20px;font:16px system-ui;display:flex;gap:12px;align-items:center}button,.motion-chip{padding:16px 24px;border-radius:8px;border:1px solid #bbc8c0;background:#d8e8df;color:#183c2c}${d.text.replaceAll('</style', '<\\/style')}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style><div class="motion-chip" style="${animation ? `animation:${esc(animation)} 2s infinite` : ''}">Aa · 0123</div><button>Button</button><p>Type and color</p>`;
    root.append(iframe);
    root.insertAdjacentHTML('beforeend', source(d.text));
    return;
  }
  if (item.family === 'component' && item.kind === 'html') {
    // A page whose name does not say so (renamed.bin): the extension-based loader does not own it, so the item draws it itself, sandboxed.
    root.innerHTML = bar(label, 'HTML page');
    const f = document.createElement('iframe');
    f.className = 'css-preview';
    f.sandbox = 'allow-scripts';
    f.title = label;
    f.srcdoc = d.text;
    root.append(f);
    return;
  }
  root.innerHTML =
    bar(label, item.kind) +
    source(d.text, item.kind) +
    (d.limited ? note('Showing the first 1 MiB') : '');
}
run().catch(error);
