import { plain } from './words.js';
// Folder items join the existing stage. Document components keep their original frames and editing paths.
const enc = encodeURIComponent,
  esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
// A component card that is not drawn live yet: its name and the start of its file, so it is never an empty box.
export function glanceCard(ctx, c) {
  const text = ctx.glances?.get(c.path)?.text || '';
  return `<div class="bundle-pending"><b>${esc(c.name)}</b> · ${esc(c.path)}<br><small>loads when you scroll to it</small><pre class="doc-glance">${esc(text.slice(0, 700))}</pre></div>`;
}
export function initKinds(ctx) {
  ctx.glances = new Map();
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/canvas/kind-canvas.css';
  document.head.append(style);
  let scrubQueued = false,
    scrubVideo = null,
    scrubAt = 0;
  document.querySelector('#world').addEventListener('pointermove', (e) => {
    const poster = e.target.closest('.kind-compact img.kind-poster');
    if (poster) { // the poster is shown until you reach for the clip
      const v = document.createElement('video');
      Object.assign(v, { muted: true, playsInline: true, preload: 'metadata', poster: poster.src, src: poster.dataset.clip + '#t=0.1' });
      v.setAttribute('aria-label', poster.alt);
      poster.replaceWith(v);
      return;
    }
    const video = e.target.closest('.kind-compact video');
    if (!video || !video.paused || !Number.isFinite(video.duration)) return;
    const b = video.getBoundingClientRect();
    scrubVideo = video;
    scrubAt = Math.max(
      0,
      Math.min(video.duration - 0.01, ((e.clientX - b.left) / b.width) * video.duration),
    );
    if (!scrubQueued) {
      scrubQueued = true;
      requestAnimationFrame(() => {
        scrubQueued = false;
        if (scrubVideo?.isConnected) scrubVideo.currentTime = scrubAt;
      });
    }
  });
  let loading = null;
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const [r, l] = await Promise.all([fetch('/api/items'), fetch('/api/item-layout')]);
      if (!r.ok) return;
      const { items } = await r.json(),
        layout = await l.json(),
        seen = new Set(),
        owned = [...ctx.state.components.values()].filter((c) => c.path).map((c) => c.path),
        paths = new Set(owned);
      // A TSX or JSX module that exports no component (a config, a hook, constants) has no component frame: it gets its own card
      // with its source, like any other file. Every other HTML, TSX and JSX file is drawn once, as a component.
      const noComponent = new Set((ctx.docs?.files || []).filter((f) => f.noComponent).map((f) => f.path));
      for (const item of items) {
        if (item.meta?.family === 'component') ctx.glances.set(item.path, { kind: item.kind, text: item.meta.preview || '' });
        const componentFile = item.meta?.family === 'component' && /\.(html?|tsx|jsx)$/i.test(item.path) && !noComponent.has(item.path);
        if (componentFile || paths.has(item.path) || item.path.endsWith('.napkin.json')) continue; // (a component's own sidecar is part of that component)
        seen.add(item.id);
        const old = ctx.state.components.get(item.id);
        const revision = String(item.meta.modifiedAt) + ':' + item.bytes;
        ctx.state.components.set(item.id, {
          ...old,
          ...item,
          item: true,
          component: item.id,
          name: item.path.split('/').at(-1),
          fileKind: item.kind,
          doc: null,
          revision,
          canvas: old?.canvas || layout.frames?.[item.id] || { x: 0, y: 0 },
        });
        if (ctx.kindsLoaded && (!old || old.revision !== revision)) {
          ctx.stage.render(item.id).catch(console.error);
          ctx.emit('added', { component: item.id });
        }
      }
      for (const [id, c] of [...ctx.state.components.items])
        if (!seen.has(id)) {
          ctx.stage.remove(id);
          ctx.state.components.delete(id);
          ctx.emit('removed', { component: id });
        }
      ctx.kindsLoaded = true;
      ctx.emit('glances', {});
      // A module with no component export has its own card: its Layers row is that card's row, and it keeps the reason.
      for (const s of ctx.docs.skipped) { const it = ctx.state.components.items.get(s.path); if (it) it.noComponent = s.note; }
      ctx.docs.skipped = ctx.docs.skipped.filter((k) => !seen.has(k.path));
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
  }
  ctx.on('item-change', async (f) => {
    await load();
    const c = ctx.state.components.get(f.item);
    if (c) {
      c.revision = f.revision;
      await ctx.stage.render(c.component, true);
      ctx.emit('select', ctx.state.selection);
    }
  });
  ctx.on('doc-files', () => load().catch(console.error));
  ctx.on('items-changed', async (f) => {
    await load();
    for (const path of f.paths || [])
      if (path.endsWith('.napkin-recipe.json')) {
        const id = path.slice(0, -'.napkin-recipe.json'.length);
        if (ctx.state.components.get(id)?.item) ctx.stage.render(id, true).catch(console.error);
      }
  });
  ctx.kinds = { load };
  return ctx.kinds;
}
// The line that stays readable when the board is zoomed out: the kind and the one fact about the file that matters most.
function headline(c) {
  const m = c.meta || {},
    bits = [];
  if (m.summary) bits.push(m.summary);
  else if (m.table?.rows?.length) bits.push(m.table.columns.length + ' columns');
  if (m.duration) bits.push(m.duration.toFixed(1) + ' s');
  if (m.width && m.height) bits.push(m.width + ' × ' + m.height);
  if (m.archive) bits.push(m.archive.length + ' entries');
  if (m.cells) bits.push(m.cells.length + ' cells');
  if (m.events) bits.push(m.events.length + ' events');
  if (m.graph?.nodes) bits.push(m.graph.nodes.length + ' nodes');
  if (!bits.length) bits.push(c.bytes.toLocaleString() + ' bytes');
  return `<span class="kind-headline"><b>${esc(c.kind.toUpperCase())}</b><i>${esc(bits.slice(0, 2).join(' · '))}</i></span>`;
}
// The design-core file kinds (decision 0023) show their content as a clean card: no kind strip or byte stamp (the label and the Layers glyph say the kind).
const CORE = new Set(['text', 'markdown', 'css', 'image']);
const isCore = (c) => CORE.has(c?.meta?.family) && !c.meta.table && !c.meta.animation;
// A page of text: 16 px above and below, 20 px at the sides, 20 px lines (13 px type), at most 480 x 340. Estimated from the text, so no layout read.
const PAGE = { padX: 20, padY: 16, line: 20, minW: 240, maxW: 480, minH: 72, maxH: 340 };
function pageSize(text, charW, headings = false) {
  const lines = String(text).replace(/\n+$/, '').split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const w = Math.max(PAGE.minW, Math.min(PAGE.maxW, Math.ceil(longest * charW + 2 * PAGE.padX)));
  const per = Math.max(1, Math.floor((w - 2 * PAGE.padX) / charW));
  let h = 2 * PAGE.padY;
  for (const l of lines) {
    if (headings && !l.trim()) continue; // markdown: blank lines are paragraph breaks, given as margins below
    const big = headings && /^#\s/.test(l);
    h += Math.max(1, Math.ceil(l.length / per)) * (big ? 24 : PAGE.line) + (headings ? 8 : 0);
  }
  return { w, h: Math.max(PAGE.minH, Math.min(PAGE.maxH, Math.round(h))) };
}
// What a file card measures on the canvas, by kind. `natural` is a picture's decoded size, when it is known.
export function cardSize(c, natural) {
  if (!isCore(c)) return { w: 480, h: 340 };
  const m = c.meta, family = m.family;
  if (family === 'image') {
    const w = natural?.w || m.width, h = natural?.h || m.height;
    if (!w || !h) return { w: 320, h: 240 };
    // the picture's proportions; a small one is drawn larger, up to 240 px on its long side, a large one fits 480 x 340
    const s = Math.min(480 / w, 340 / h, Math.max(1, 240 / Math.max(w, h)));
    return { w: Math.max(48, Math.round(w * s)), h: Math.max(32, Math.round(h * s)) };
  }
  const text = m.preview || '';
  if (family === 'markdown') return pageSize(text, 6.4, true);
  return pageSize(text, family === 'css' ? 7.3 : 6.4);
}
// **strong**, *em*, `code` in a markdown line (escaped first: nothing in the file becomes markup but these)
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
function corePage(c) {
  const text = c.meta.preview || '', family = c.meta.family, clip = cardSize(c).h >= PAGE.maxH ? ' kind-clip' : '';
  if (family === 'markdown') {
    const blocks = text.split('\n').filter((l) => l.trim()).slice(0, 24).map((l) => {
      const h = l.match(/^(#{1,6})\s+(.*)/);
      if (h) return `<h${Math.min(3, h[1].length)}>${inline(h[2])}</h${Math.min(3, h[1].length)}>`;
      const li = l.match(/^\s*[-*+]\s+(.*)/);
      return li ? `<p class="li">${inline(li[1])}</p>` : `<p>${inline(l)}</p>`;
    });
    return `<article class="kind-page kind-prose${clip}">${blocks.join('')}</article>`;
  }
  if (family === 'css') return `<pre class="kind-page kind-code${clip}">${esc(text.slice(0, 2000))}</pre>`;
  return `<div class="kind-page kind-text${clip}">${esc(text.slice(0, 2000))}</div>`;
}
export function compactItem(c) {
  if (isCore(c) && c.meta.family !== 'image') return `<div class="kind-compact" data-napkin-kind="${esc(c.kind)}">${corePage(c)}</div>`;
  if (isCore(c)) return `<div class="kind-compact" data-napkin-kind="${esc(c.kind)}"><img decoding="async" alt="${esc(c.name)}" src="/file/${enc(c.id)}"></div>`;
  const family = c.meta.family,
    raw = '/file/' + enc(c.id),
    text = c.meta.preview || '';
  let content = '';
  if (family === 'image')
    content = `<img decoding="async" alt="${esc(c.name)}" src="${raw}">`;
  else if (family === 'video')
    // (a picture until a pointer reaches it: every <video> is a compositor layer of its own and forces layers on what is drawn over it, so a canvas of
    // hundreds of clips made every pan frame layerize hundreds of layers; the clip element is put in on the first pointer move, for scrubbing)
    content = `<img class="kind-poster" decoding="async" alt="${esc(c.name)}" src="/api/poster/${enc(c.id)}" data-clip="${raw}"><span class="kind-stamp">Move across to scrub</span>`;
  else if (family === 'font')
    content = `<style>@font-face{font-family:'k${enc(c.id).replaceAll('%', '')}';src:url('${raw}')}</style><pre class="kind-type" style="font-family:'k${enc(c.id).replaceAll('%', '')}'">Aa Bb
012345</pre>`;
  else if (c.meta.table) content = miniTable(c.meta.table, c.meta.summary);
  else if (family === 'binary')
    content = `<pre class="kind-code">${esc(text.match(/.{1,32}/g)?.join('\n'))}</pre><p class="kind-caption">${esc(c.meta.strings?.join(' · ') || 'No printable strings in this window')}</p>`;
  else if (family === 'audio')
    content = `<div class="kind-audio"><svg class="kind-wave" viewBox="0 0 400 180" role="img" aria-label="Audio waveform"><line x1="0" x2="400" y1="90" y2="90" stroke="currentColor"/>${(c.meta.peaks || []).map((v, i) => `<rect x="${i * 4}" y="${90 - v * 500}" width="3" height="${Math.max(1, v * 1000)}" fill="currentColor"/>`).join('')}</svg><audio preload="none" src="${raw}" controls></audio><p class="kind-caption">${c.meta.duration ? c.meta.duration.toFixed(2) + ' s · ' : ''}${c.meta.sampleRate ? c.meta.sampleRate + ' Hz' : 'Audio track'}</p></div>`;
  else if (c.meta.graph) content = miniGraph(c.meta.graph);
  else if (c.meta.archive)
    content = `<div class="kind-archive"><h3>${c.meta.archive.length} archive entries</h3>${c.meta.archive.map((e) => `<p style="padding-left:${Math.min(6, e.name.split('/').length) * 12}px"><b>${esc(e.name)}</b><small>${e.bytes.toLocaleString()} bytes</small></p>`).join('')}</div>`;
  else if (c.meta.cells)
    content = `<div class="kind-notebook">${c.meta.cells.map((cell) => `<div><small>${cell.type === 'code' ? 'In [' + (cell.count ?? ' ') + ']' : 'Markdown'}</small><pre>${esc(cell.text)}</pre></div>`).join('')}</div>`;
  else if (c.meta.events)
    content = `<div class="kind-timeline">${c.meta.events.map((e) => `<div><b>${esc(e.type)}</b><small>${esc(e.time)}</small><p>${esc(e.text)}</p></div>`).join('')}</div>`;
  else if (c.meta.spec) content = '<div class="kind-chart-host"><p class="kind-caption">Drawing the chart</p></div>';
  else if (c.meta.mesh) content = miniMesh(c.meta.mesh);
  else if (c.meta.animation) {
    const a = c.meta.animation,
      color = a.fill
        ? 'rgb(' +
          a.fill
            .slice(0, 3)
            .map((v) => Math.round(v * 255))
            .join(',') +
          ')'
        : '#35836a';
    content = `<div class="kind-motion">${a.kind === 'waapi' ? `<div>${esc(a.text || 'Motion')}</div>` : `<svg viewBox="0 0 ${Number(a.width) || 320} ${Number(a.height) || 240}">${(a.shapes || []).map((s) => (s.type === 'el' ? `<ellipse cx="${(a.width || 320) / 2}" cy="${(a.height || 240) / 2}" rx="${Number(s.size?.[0] || 80) / 2}" ry="${Number(s.size?.[1] || 80) / 2}" fill="${color}"/>` : `<rect x="80" y="60" width="${Number(s.size?.[0] || 80)}" height="${Number(s.size?.[1] || 80)}" rx="12" fill="${color}"/>`)).join('')}</svg>`}</div>`;
  } else if (family === 'pdf')
    content = `<div class="kind-paper kind-pdf-host"><small>PDF document</small>${(c.meta.documentText || []).map((s) => `<h2>${esc(s)}</h2>`).join('') || `<h2>${esc(c.name)}</h2>`}<div class="kind-paper-lines"></div></div>`;
  else if (family === 'markdown')
    content = `<article class="kind-prose">${text
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 9)
      .map((l) =>
        /^#/.test(l)
          ? `<h3>${esc(l.replace(/^#+\s*/, ''))}</h3>`
          : `<p>${esc(l.slice(0, 100))}</p>`,
      )
      .join('')}</article>`;
  else
    content = `<pre class="kind-code">${esc(text.slice(0, 1000) || `${c.kind.toUpperCase()}\n${c.bytes.toLocaleString()} bytes\nOpen the live viewer`)}</pre>`;
  // Source-derived overview surfaces are cached SVG images. Thousands of table cells and graph
  // paths need not enter the canvas DOM; focusing still opens the fully interactive viewer.
  // Text-like files keep real text in the card (it is what you read, search and select); heavier surfaces are cached images.
  const plain = ['md', 'txt', 'csv', 'tsv', 'json', 'jsonl', 'code', 'tsx', 'jsx', 'diff', 'patch', 'css', 'css-keyframes', 'yaml', 'toml', 'xml', 'shader'].includes(c.kind);
  if (!plain && !c.meta.spec && family !== 'pdf' && !['image', 'video', 'font', 'audio'].includes(family)) content = cachedSurface(content);
  return `<div class="kind-compact" data-napkin-kind="${esc(c.kind)}">${content}${headline(c)}<span class="kind-stamp">${esc(c.kind)} · ${c.bytes.toLocaleString()} bytes</span></div>`;
}
// The first rows of a table as the file holds them, with each column's type and distribution.
function miniTable(t, summary) {
  return `<div class="kind-mini-table"><div>${t.columns
      .slice(0, 5)
      .map(
        (col) =>
          `<span><b>${esc(col.name)}</b><small>${esc(col.type)}</small>${miniHist(col.bins || [])}</span>`,
      )
      .join('')}</div>${t.rows
      .slice(0, 6)
      .map(
        (row) =>
          `<div>${row
            .slice(0, 5)
            .map((v) => `<span>${esc(String(v ?? '∅').slice(0, 35))}</span>`)
            .join('')}</div>`,
      )
      .join('')}</div><p class="kind-caption">${esc(summary || 'Sampled values')}</p>`;
}
function cachedSurface(content) {
  const style = `*{box-sizing:border-box}body,div{color:#263e33}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 monospace;padding:18px;margin:0}small{font:10px monospace;color:#74957f}p{font:12px/1.5 system-ui;margin:8px 0}h3{font:600 24px system-ui}svg{width:100%;height:300px;display:block}.kind-mini-table{font:12px/1.6 monospace;padding:12px}.kind-mini-table>div{display:flex;border-bottom:1px solid #d8e1d6}.kind-mini-table span{flex:1;padding:8px;overflow:hidden}.kind-mini-table small{display:block}.kind-mini-table svg{height:25px;width:70px}.kind-mini-table>div:first-child{background:#e1eadd}.kind-caption{font:11px monospace;padding:6px 18px}.kind-archive,.kind-prose,.kind-timeline{padding:16px 22px}.kind-archive p{padding:7px;border-bottom:1px solid #d6e0d4}.kind-archive small,.kind-timeline small{float:right}.kind-notebook{padding:12px}.kind-notebook>div{border:1px solid #d2e0d1;border-radius:4px;margin-bottom:10px}.kind-notebook small{display:block;background:#e2ebdd;padding:5px 8px}.kind-notebook pre{padding:10px}.kind-timeline>div{border-left:2px solid #9bbaa4;padding:0 0 14px 18px}.kind-motion{background:#e0e9d9;min-height:340px;display:grid;place-content:center}.kind-motion>div{background:#35836a;color:white;border-radius:16px;padding:25px;font:30px system-ui}.kind-paper{margin:18px 70px;padding:30px;background:white;min-height:290px}.kind-paper h2{font:26px Georgia;color:#2c7155}.kind-paper-lines{height:80px;background:repeating-linear-gradient(transparent,transparent 15px,#d5dfd2 15px,#d5dfd2 16px)}`;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="340"><foreignObject width="480" height="340"><div xmlns="http://www.w3.org/1999/xhtml" style="width:480px;height:340px;overflow:hidden;background:#f5f5ee"><style>${style}</style>${content.replaceAll('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')}</div></foreignObject></svg>`;
  return `<img class="kind-surface" alt="File preview" decoding="async" src="data:image/svg+xml,${enc(xml)}">`;
}
const seen = new WeakSet(),
  lookup = new Map();
const getData = (id, q = '') => {
  const k = id + q;
  if (!lookup.has(k)) {
    lookup.set(k, fetch('/api/item-data/' + enc(id) + q).then((r) => (r.ok ? r.json() : Promise.reject(new Error('no data')))));
    if (lookup.size > 400) lookup.delete(lookup.keys().next().value);
  }
  return lookup.get(k);
};
// A card shows the item's own content. Cheap kinds draw from metadata; audio, PDF and chart cards fetch or
// compute theirs when they first come near the screen, so a thousand cards never start a thousand decodes.
function enhance(cell, c) {
  const host = cell.querySelector('.kind-compact');
  if (!host) return;
  const family = c.meta.family;
  if (family === 'audio')
    getData(c.id).then((d) => {
      const svg = host.querySelector('.kind-wave');
      if (!svg || !d.peaks?.length) return;
      const w = 400 / d.peaks.length;
      svg.innerHTML = '<line x1="0" x2="400" y1="90" y2="90" stroke="currentColor" opacity=".4"/>' + d.peaks.map((v, i) => `<rect x="${(i * w).toFixed(2)}" y="${(90 - Math.max(1, Math.min(1, v) * 85)).toFixed(1)}" width="${Math.max(1, w - 0.8).toFixed(2)}" height="${Math.max(2, Math.min(1, v) * 170).toFixed(1)}" fill="currentColor"/>`).join('');
    }).catch(() => {});
  else if (family === 'pdf')
    getData(c.id, '?page=1&dpi=60').then((d) => {
      const el = host.querySelector('.kind-pdf-host');
      if (el && d.image) el.outerHTML = `<img class="kind-pdf-page" alt="First page of ${esc(c.name)}" src="${d.image}">`;
    }).catch(() => {});
  else if (c.meta.table && !c.meta.table.rows?.length)
    // A large Parquet or Arrow file has no rows in its metadata: the card reads its first window when it comes near the screen.
    getData(c.id).then((d) => {
      const el = host.querySelector('.kind-surface');
      if (el && d.rows?.length) el.outerHTML = cachedSurface(miniTable({ columns: d.columns.slice(0, 8), rows: d.rows.slice(0, 6) }, c.meta.summary));
    }).catch(() => {});
  else if (c.meta.spec)
    Promise.all([import('./vega-lite.js'), import('./chart-spec.js')]).then(async ([vl, cs]) => {
      const dir = c.path.split('/').slice(0, -1),
        load = async (u) => {
          if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u)) throw new Error('only files in this folder can be read');
          const r = await fetch('/raw/' + [...dir, ...u.split('/')].map(enc).join('/'));
          if (!r.ok) throw new Error('not found');
          return r.text();
        };
      const { svg } = await vl.renderVegaLite(cs.chartSpec(c.meta.spec), { load });
      const el = host.querySelector('.kind-chart-host');
      if (el) el.innerHTML = svg;
    }).catch(() => {});
}
function whenNear(cell, fn) {
  if (typeof IntersectionObserver === 'undefined') return fn();
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: '300px' });
  io.observe(cell);
}
function miniHist(bins) {
  const max = Math.max(1, ...bins);
  return `<svg viewBox="0 0 100 24">${bins.map((v, i) => `<rect x="${(i * 100) / bins.length}" y="${24 - (v / max) * 22}" width="${Math.max(1, 100 / bins.length - 1)}" height="${(v / max) * 22}" fill="#35836a"/>`).join('')}</svg>`;
}
function miniGraph(g) {
  const ns = g.nodes.map((n, i) => ({
      ...n,
      x: Number(n.pos?.[0] || (i % 3) * 220),
      y: Number(n.pos?.[1] || Math.floor(i / 3) * 140),
    })),
    map = new Map(ns.map((n) => [String(n.id), n]));
  if (!ns.length) return '';
  const x = Math.min(...ns.map((n) => n.x)) - 20,
    y = Math.min(...ns.map((n) => n.y)) - 20,
    w = Math.max(...ns.map((n) => n.x + 190)) - x + 20,
    h = Math.max(...ns.map((n) => n.y + 80)) - y + 20;
  return `<svg class="kind-graph" viewBox="${x} ${y} ${w} ${h}">${g.links
    .map((l) => {
      const a = map.get(String(l[1])),
        b = map.get(String(l[3]));
      return a && b
        ? `<path d="M${a.x + 190} ${a.y + 40} C${a.x + 230} ${a.y + 40} ${b.x - 40} ${b.y + 40} ${b.x} ${b.y + 40}" fill="none" stroke="#71a28b" stroke-width="3"/>`
        : '';
    })
    .join(
      '',
    )}${ns.map((n) => `<g transform="translate(${n.x} ${n.y})"><rect width="190" height="80" rx="8" fill="#e0e9dc" stroke="#a5bdac"/><text x="12" y="28" font-size="14" fill="#245d45">${esc(String(n.title).slice(0, 22))}</text><text x="12" y="59" font-size="12" fill="#6b8f78">#${esc(n.id)}</text></g>`).join('')}</svg>`;
}
// The scene as it is posed in the file: world-space triangles with their own material colors.
function miniMesh(mesh) {
  const t = mesh.tris;
  if (!t?.length) return '';
  const n = t.length / 9,
    lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], t[i + k]); hi[k] = Math.max(hi[k], t[i + k]); }
  const c = lo.map((v, i) => (v + hi[i]) / 2),
    scale = 200 / Math.max(0.001, ...hi.map((v, i) => v - lo[i])),
    yaw = 0.6,
    pitch = 0.45,
    cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const proj = (i) => {
    const x = (t[i] - c[0]) * scale, y = (t[i + 1] - c[1]) * scale, z = (t[i + 2] - c[2]) * scale;
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    return [240 + x1, 175 - y2, z2];
  };
  const faces = [];
  for (let k = 0; k < n; k++) {
    const p = [proj(k * 9), proj(k * 9 + 3), proj(k * 9 + 6)],
      ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1],
      shade = 0.62 + 0.38 * Math.abs(Math.sin(k * 1.7 + (ux * vy - uy * vx > 0 ? 1 : 0)));
    faces.push({ z: (p[0][2] + p[1][2] + p[2][2]) / 3, p, rgb: mesh.colors[k].map((v) => Math.round(v * shade)) });
  }
  faces.sort((a, b) => a.z - b.z);
  return `<svg class="kind-mesh" viewBox="0 0 480 340">${faces.map((f) => `<polygon points="${f.p.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" fill="rgb(${f.rgb})" stroke="rgb(${f.rgb})" stroke-width=".6"/>`).join('')}</svg>`;
}
export function createItemFrame(ctx, id) {
  const c = ctx.state.components.get(id),
    cell = document.createElement('figure');
  cell.className = 'cell doc-cell kind-cell';
  cell.dataset.variant = '{}';
  cell.dataset.n = 'item';
  cell.innerHTML = compactItem(c);
  whenNear(cell, () => enhance(cell, c));
  const grip = document.createElement('span');
  grip.hidden = true;
  cell.append(grip);
  let frame = null,
    rev = null,
    generation = 0;
  const waits = new Set();
  const tree = () => ({ tree: [{ node: 'item', tag: 'article', attrs: {}, children: [] }] }),
    width = 480;
  const api = {
    cell,
    grip,
    width,
    setWidth() {},
    tree,
    node: () => tree().tree[0],
    has: (n) => n === 'item',
    iframe: () => frame,
    doc: () => frame?.contentDocument,
    element: (n) => (n === 'item' ? cell : null),
    pick: () => cell,
    async load(revision) {
      if (rev === revision && frame) return true;
      const now = ctx.state.components.get(id) || c;
      if (isCore(now)) { // a design-core card is its content (text, a picture): no viewer page is loaded over it; an edit redraws it
        if (rev !== null && rev !== revision) { cell.querySelector('.kind-compact')?.remove(); cell.insertAdjacentHTML('afterbegin', compactItem(now)); }
        rev = revision;
        return true;
      }
      const mine = ++generation;
      rev = revision;
      const next = document.createElement('iframe');
      next.className = 'doc-frame kind-frame doc-next';
      next.title = c.name + ' (live)';
      next.tabIndex = -1;
      next.style.width = '100%'; // the card's size (cardSize), set on the section
      next.style.height = '100%';
      next.src = '/view/' + enc(id) + '?rev=' + enc(revision || '');
      let done;
      const loaded = new Promise((resolve) => {
        done = resolve;
        waits.add(resolve);
        next.onload = () => resolve(true);
        next.onerror = () => resolve(false);
      });
      cell.append(next);
      await loaded;
      waits.delete(done);
      if (mine !== generation || !cell.isConnected) {
        next.remove();
        return false;
      }
      frame?.remove();
      frame = next;
      next.classList.remove('doc-next');
      cell.querySelector('.kind-compact')?.remove();
      return true;
    },
    destroy() {
      generation++;
      for (const done of waits) done(false);
      waits.clear();
      frame?.remove();
      frame = null;
      cell.remove();
    },
  };
  cell.addEventListener('pointermove', (e) => {
    if (c.meta.family !== 'video') return;
    const b = cell.getBoundingClientRect(),
      fraction = (e.clientX - b.left) / b.width;
    frame?.contentWindow?.postMessage({ type: 'kind-scrub', fraction }, location.origin);
  });
  return api;
}
let panelToken = 0;
export async function renderKindPanel(ctx, el, c) {
  const token = ++panelToken;
  el.innerHTML = `<div class="kind-panel"><h2>${esc(c.name)}</h2><p class="storage">${esc(c.kind)} · ${c.bytes.toLocaleString()} bytes</p></div>`;
  const res = await fetch('/api/controls/' + enc(c.id));
  if (token !== panelToken || ctx.state.selection?.component !== c.id) return;
  const schema = await res.json();
  if (!res.ok) {
    el.insertAdjacentHTML('beforeend', `<p role="alert">${esc(plain(schema.error))}</p>`);
    return;
  }
  const panel = el.firstElementChild;
  panel.insertAdjacentHTML(
    'beforeend',
    schema.sections
      .map(
        (s) =>
          `<section><h3>${esc(s.label)}</h3>${s.controls.map((v, i) => `<label class="kind-control"><span>${esc(v.label)}</span>${v.type === 'boolean' ? `<input type="checkbox" data-control="${esc(v.id)}"${v.value ? ' checked' : ''}>` : v.type === 'textarea' ? `<textarea data-control="${esc(v.id)}">${esc(v.value)}</textarea>` : v.options ? `<select data-control="${esc(v.id)}">${v.options.map((o) => `<option${o === v.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input type="${v.type === 'number' ? 'number' : v.type === 'color' && /^#[0-9a-f]{6}$/i.test(v.value) ? 'color' : 'text'}" data-control="${esc(v.id)}" value="${esc(v.value)}"${v.min !== undefined ? ` min="${v.min}"` : ''}${v.max !== undefined ? ` max="${v.max}"` : ''} step="${v.step || 'any'}">`}</label>`).join('')}</section>`,
      )
      .join('') +
      `<p class="storage">File values write to the source. Viewer settings create a recipe beside the file.</p><footer><button type="button" data-kind-undo>Undo item edit</button><a href="/view/${enc(c.id)}" target="_blank">Open viewer ↗</a></footer><p role="status" data-kind-status></p>`,
  );
  panel.onchange = async (e) => {
    const input = e.target.closest('[data-control]');
    if (!input) return;
    const control = schema.sections
      .flatMap((s) => s.controls)
      .find((v) => v.id === input.dataset.control);
    const value =
      control.type === 'number'
        ? Number(input.value)
        : control.type === 'boolean'
          ? input.checked
          : input.value;
    const result = await ctx.fetch('/api/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item: c.id,
        control: control.id,
        value,
        baseRevision: schema.revision,
      }),
    });
    const j = await result.json();
    if (!result.ok) panel.querySelector('[data-kind-status]').textContent = plain(j.error);
    else {
      schema.revision = j.revision;
      ctx.stage.render(c.id, true).catch(console.error);
    }
  };
  panel.querySelector('[data-kind-undo]').onclick = async () => {
    const response = await ctx.fetch('/api/undo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: c.id }),
    });
    const j = await response.json();
    if (!response.ok) panel.querySelector('[data-kind-status]').textContent = plain(j.error);
    else {
      await ctx.kinds.load();
      ctx.stage.render(c.id, true);
      renderKindPanel(ctx, el, c);
    }
  };
}
