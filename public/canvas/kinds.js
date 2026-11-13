import { plain } from './words.js';
// Folder items join the existing stage. Document components keep their original frames and editing paths.
const enc = encodeURIComponent,
  esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
export function initKinds(ctx) {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/canvas/kind-canvas.css';
  document.head.append(style);
  let scrubQueued = false,
    scrubVideo = null,
    scrubAt = 0;
  document.querySelector('#world').addEventListener('pointermove', (e) => {
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
      for (const item of items) {
        // A file the dialect or the document engine already draws is not drawn twice. Dialect paths are relative
        // to the folder it opened (often components/), so a suffix match counts.
        if (paths.has(item.path) || ((item.kind === 'tsx' || item.kind === 'jsx') && owned.some((p) => item.path.endsWith('/' + p)))) continue;
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
export function compactItem(c) {
  const family = c.meta.family,
    raw = '/file/' + enc(c.id),
    text = c.meta.preview || '';
  let content = '';
  if (family === 'image')
    content = `<img loading="lazy" decoding="async" alt="${esc(c.name)}" src="${raw}">`;
  else if (family === 'video')
    content = `<video preload="metadata" muted playsinline src="${raw}#t=0.1"></video><span class="kind-stamp">Move across to scrub</span>`;
  else if (family === 'font')
    content = `<style>@font-face{font-family:'k${enc(c.id).replaceAll('%', '')}';src:url('${raw}')}</style><div class="kind-type" style="font-family:'k${enc(c.id).replaceAll('%', '')}'">Aa Bb<br>012345</div>`;
  else if (c.meta.table)
    content = `<div class="kind-mini-table"><div>${c.meta.table.columns
      .slice(0, 5)
      .map(
        (col) =>
          `<span><b>${esc(col.name)}</b><small>${esc(col.type)}</small>${miniHist(col.bins || [])}</span>`,
      )
      .join('')}</div>${c.meta.table.rows
      .slice(0, 6)
      .map(
        (row) =>
          `<div>${row
            .slice(0, 5)
            .map((v) => `<span>${esc(String(v ?? '∅').slice(0, 35))}</span>`)
            .join('')}</div>`,
      )
      .join('')}</div><p class="kind-caption">${esc(c.meta.summary || 'Sampled values')}</p>`;
  else if (family === 'binary')
    content = `<pre class="kind-code">${esc(text.match(/.{1,32}/g)?.join('\n'))}</pre><p class="kind-caption">${esc(c.meta.strings?.join(' · ') || 'No printable strings in this window')}</p>`;
  else if (family === 'audio')
    content = `<div class="kind-audio"><svg viewBox="0 0 400 180" role="img" aria-label="Audio waveform"><line x1="0" x2="400" y1="90" y2="90" stroke="currentColor"/>${(c.meta.peaks || []).map((v, i) => `<rect x="${i * 4}" y="${90 - v * 500}" width="3" height="${Math.max(1, v * 1000)}" fill="currentColor"/>`).join('')}</svg><audio preload="none" src="${raw}" controls></audio><p class="kind-caption">${c.meta.duration ? c.meta.duration.toFixed(2) + ' s · ' : ''}${c.meta.sampleRate ? c.meta.sampleRate + ' Hz' : 'Audio track'}</p></div>`;
  else if (c.meta.graph) content = miniGraph(c.meta.graph);
  else if (c.meta.archive)
    content = `<div class="kind-archive"><h3>${c.meta.archive.length} archive entries</h3>${c.meta.archive.map((e) => `<p style="padding-left:${Math.min(6, e.name.split('/').length) * 12}px"><b>${esc(e.name)}</b><small>${e.bytes.toLocaleString()} bytes</small></p>`).join('')}</div>`;
  else if (c.meta.cells)
    content = `<div class="kind-notebook">${c.meta.cells.map((cell) => `<div><small>${cell.type === 'code' ? 'In [' + (cell.count ?? ' ') + ']' : 'Markdown'}</small><pre>${esc(cell.text)}</pre></div>`).join('')}</div>`;
  else if (c.meta.events)
    content = `<div class="kind-timeline">${c.meta.events.map((e) => `<div><b>${esc(e.type)}</b><small>${esc(e.time)}</small><p>${esc(e.text)}</p></div>`).join('')}</div>`;
  else if (c.meta.chart) content = miniChart(c.meta.chart);
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
    content = `<div class="kind-paper"><small>PDF document</small>${(c.meta.documentText || []).map((s) => `<h2>${esc(s)}</h2>`).join('') || `<h2>${esc(c.name)}</h2>`}<div class="kind-paper-lines"></div></div>`;
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
  if (!['image', 'video', 'font', 'audio'].includes(family)) content = cachedSurface(content);
  else if (family === 'audio')
    content = content.replace(/<svg[\s\S]*?<\/svg>/, (svg) => cachedSurface(svg));
  return `<div class="kind-compact" data-napkin-kind="${esc(c.kind)}">${content}<span class="kind-stamp">${esc(c.kind)} · ${c.bytes.toLocaleString()} bytes</span></div>`;
}
function cachedSurface(content) {
  const style = `*{box-sizing:border-box}body,div{color:#263e33}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 monospace;padding:18px;margin:0}small{font:10px monospace;color:#74957f}p{font:12px/1.5 system-ui;margin:8px 0}h3{font:600 24px system-ui}svg{width:100%;height:300px;display:block}.kind-mini-table{font:12px/1.6 monospace;padding:12px}.kind-mini-table>div{display:flex;border-bottom:1px solid #d8e1d6}.kind-mini-table span{flex:1;padding:8px;overflow:hidden}.kind-mini-table small{display:block}.kind-mini-table svg{height:25px;width:70px}.kind-mini-table>div:first-child{background:#e1eadd}.kind-caption{font:11px monospace;padding:6px 18px}.kind-archive,.kind-prose,.kind-timeline{padding:16px 22px}.kind-archive p{padding:7px;border-bottom:1px solid #d6e0d4}.kind-archive small,.kind-timeline small{float:right}.kind-notebook{padding:12px}.kind-notebook>div{border:1px solid #d2e0d1;border-radius:4px;margin-bottom:10px}.kind-notebook small{display:block;background:#e2ebdd;padding:5px 8px}.kind-notebook pre{padding:10px}.kind-timeline>div{border-left:2px solid #9bbaa4;padding:0 0 14px 18px}.kind-motion{background:#e0e9d9;min-height:340px;display:grid;place-content:center}.kind-motion>div{background:#35836a;color:white;border-radius:16px;padding:25px;font:30px system-ui}.kind-paper{margin:18px 70px;padding:30px;background:white;min-height:290px}.kind-paper h2{font:26px Georgia;color:#2c7155}.kind-paper-lines{height:80px;background:repeating-linear-gradient(transparent,transparent 15px,#d5dfd2 15px,#d5dfd2 16px)}`;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="340"><foreignObject width="480" height="340"><div xmlns="http://www.w3.org/1999/xhtml" style="width:480px;height:340px;overflow:hidden;background:#f5f5ee"><style>${style}</style>${content.replaceAll('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')}</div></foreignObject></svg>`;
  return `<img class="kind-surface" alt="File preview" decoding="async" src="data:image/svg+xml,${enc(xml)}">`;
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
function miniChart(c) {
  const ps = c.points,
    max = Math.max(1, ...ps.map((p) => p.y)),
    px = (i) => 30 + (i * 420) / Math.max(1, ps.length - 1),
    py = (v) => 275 - (v / max) * 220;
  return `<div class="kind-caption">${esc(c.title || '')}</div><svg class="kind-chart" viewBox="0 0 480 300"><path d="M25 25V275H460" fill="none" stroke="#bdcdbd"/>${c.mark === 'line' ? `<path d="${ps.map((p, i) => `${i ? 'L' : 'M'}${px(i)},${py(p.y)}`).join(' ')}" stroke="#35836a" stroke-width="4" fill="none"/>` : ps.map((p, i) => `<rect x="${30 + (i * 420) / ps.length}" y="${py(p.y)}" width="${Math.max(1, 420 / ps.length - 9)}" height="${Math.max(0, 275 - py(p.y))}" rx="3" fill="#35836a"/>`).join('')}</svg>`;
}
function miniMesh(mesh) {
  const vs = mesh.vertices;
  if (!vs.length) return '';
  const lo = [0, 1, 2].map((i) => Math.min(...vs.map((v) => v[i]))),
    hi = [0, 1, 2].map((i) => Math.max(...vs.map((v) => v[i]))),
    scale = 190 / Math.max(0.001, ...hi.map((n, i) => n - lo[i])),
    points = vs.map((v) => {
      const x = (v[0] - (lo[0] + hi[0]) / 2) * scale,
        y = (v[1] - (lo[1] + hi[1]) / 2) * scale,
        z = (v[2] - (lo[2] + hi[2]) / 2) * scale;
      return [240 + x * 0.86 + z * 0.5, 180 - y + z * 0.2];
    });
  return `<svg class="kind-mesh" viewBox="0 0 480 340">${mesh.faces
    .filter((f) => f.every((i) => points[i]))
    .slice(0, 500)
    .map(
      (f, i) =>
        `<polygon points="${f.map((i) => points[i].join(',')).join(' ')}" fill="hsl(152 24% ${35 + (i % 7) * 4}%)" stroke="#80a78d" stroke-width="1"/>`,
    )
    .join('')}</svg>`;
}
export function createItemFrame(ctx, id) {
  const c = ctx.state.components.get(id),
    cell = document.createElement('figure');
  cell.className = 'cell doc-cell kind-cell';
  cell.dataset.variant = '{}';
  cell.dataset.n = 'item';
  cell.innerHTML = compactItem(c);
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
      const mine = ++generation;
      rev = revision;
      const next = document.createElement('iframe');
      next.className = 'doc-frame kind-frame doc-next';
      next.title = c.name + ' (live)';
      next.tabIndex = -1;
      next.style.width = width + 'px';
      next.style.height = '340px';
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
