// A film strip of time (DREAM moment 9). H opens it under the canvas for the selected HTML or React component: its versions
// as thumbnails, oldest on the left, "Now" on the right. A version is the component's WHOLE write set (its file and every
// stylesheet it uses), so a rule or variable edit is a frame too. Napkin's own edits (kept outside the folder, so they
// survive a restart) and the files' git history sit side by side. Scrub with the pointer or the arrow keys: the component's
// frame on the canvas shows that version, drawn by the browser from that version's bytes. B flips a frame between before and
// after its change. Restore puts every file of the version back as ONE new edit through the engine's write path, so one undo
// gives the newest text back; it refuses with a reason when a shared stylesheet changed since in a way that would undo other work.
//   initTimeStrip(ctx) -> ctx.time = { open(), close(), toggle(), restore(), pick(index|'now'), flip(), fit(), state() }
import { plain } from './words.js';
import { thumbs } from './time-thumbs.js';

const enc = encodeURIComponent;
const ENGINE = new Set(['html', 'tsx', 'jsx']);
const pad = (n) => String(n).padStart(2, '0');
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const clock = (at) => { const d = new Date(at), t = `${pad(d.getHours())}:${pad(d.getMinutes())}`; return sameDay(d, new Date()) ? t : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${t}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// What a tile says it is: what changed (from the diff), else the engine's own words.
export function wording(f) {
  if (f.what) return f.what;
  if (f.now) return 'The files as they are';
  const s = String(f.summary || '');
  return s || 'An earlier version';
}
const who = (f) => (f.source === 'git' ? f.by : f.by === 'you' ? 'You' : f.by === 'file' ? '' : f.by);

export function initTimeStrip(ctx) {
  const stage = document.querySelector('#stage');
  const S = { open: false, id: null, film: null, tiles: [], at: -1, gen: 0, preview: null, side: 'after', revealed: false, crop: null, kind: null };
  const el = document.createElement('section');
  el.id = 'time'; el.hidden = true; el.dataset.nodrag = '1'; el.setAttribute('aria-label', 'Versions of the selected component');
  // DOM order is Tab order: the track first, then Before, Fit, Restore, Close (CSS puts the buttons back in the header row)
  el.innerHTML = `<header class="tm-head"><h2 class="tm-title">Versions <span class="tm-file" id="time-file"></span></h2>
    <span class="tm-cue" id="time-cue-chip" hidden>Earlier version</span><span class="tm-info" id="time-info" role="status" aria-live="polite"></span>
    <span class="tm-keys">← → scrub · B before / after · Enter restore · Esc close</span></header>
    <div class="tm-track" id="time-track" role="listbox" tabindex="0" aria-label="Versions, oldest first. Left and right move, Enter restores"></div>
    <div class="tm-acts"><button type="button" id="time-flip" class="tm-btn" aria-pressed="false" title="Flip between the version before this change and after it (B)" disabled>Before</button>
    <button type="button" id="time-fit" class="tm-btn" title="Bring the component into view above the strip">Fit</button>
    <button type="button" id="time-restore" class="tm-restore" disabled aria-label="Restore this version">Restore</button><button type="button" id="time-close" class="tm-close" aria-label="Close versions">×</button></div>`;
  stage.append(el);
  const cue = document.createElement('div');
  cue.id = 'time-cue'; cue.hidden = true; cue.setAttribute('aria-hidden', 'true'); cue.innerHTML = '<span class="tc-pill"></span>';
  stage.append(cue);
  const track = el.querySelector('#time-track'), info = el.querySelector('#time-info'), restoreBtn = el.querySelector('#time-restore'), flipBtn = el.querySelector('#time-flip'), chip = el.querySelector('#time-cue-chip');
  const thumbsOf = thumbs(track, (tile) => ({ id: S.id, version: tile.dataset.version || null, kind: S.kind, crop: S.crop }));

  const compOf = (id) => ctx.state.components.get(id);
  const targetId = () => { const s = ctx.state.selection; const c = s && compOf(s.component); return c && ENGINE.has(c.kind) ? c.component : null; };
  const frameOf = (id) => ctx.stage.sections.get(id)?.docFrame ?? null;

  // ---------- the cue, in screen pixels: it reads the same at any zoom ----------
  function placeCue() {
    const fr = S.open && S.preview ? frameOf(S.id) : null;
    if (!fr) { cue.hidden = true; return; }
    const r = fr.cell.getBoundingClientRect(), st = stage.getBoundingClientRect();
    cue.hidden = false;
    Object.assign(cue.style, { left: `${r.left - st.left - 3}px`, top: `${r.top - st.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    const t = S.tiles[S.at];
    const text = S.side === 'before' ? 'Before this change · not saved' : `Earlier version${t && !t.now ? ' · ' + clock(t.at) : ''} · not saved`;
    cue.querySelector('.tc-pill').textContent = text; chip.textContent = S.side === 'before' ? 'Before this change' : 'Earlier version';
    cue.classList.toggle('above', r.top - st.top < 30);
    cue.classList.toggle('narrow', r.width < 300); // a small frame: the label hangs from its left edge so it stays on the canvas
  }
  ctx.on('view', () => { if (S.preview) placeCue(); });
  ctx.on('layout', () => { if (S.preview) placeCue(); });
  addEventListener('resize', () => { if (S.preview) placeCue(); });

  // ---------- keep the component in view above the strip ----------
  function reveal(force = false) {
    const fr = frameOf(S.id); if (!fr) return;
    const r = fr.cell.getBoundingClientRect(), st = stage.getBoundingClientRect(), stripTop = el.getBoundingClientRect().top;
    const m = 14, top = st.top + m + 24, bottom = stripTop - m - 8, left = st.left + m, right = st.right - m;
    const v = ctx.view.get();
    const inside = r.top >= top - 24 && r.bottom <= bottom && r.left >= left && r.right <= right;
    if (inside && v.z >= 0.5 && !force) return;
    const availW = right - left, availH = bottom - top, ww = r.width / v.z, wh = r.height / v.z;
    // legible: a frame seen small is brought up to 100% when it fits (never below what fits), a frame already big enough only moves
    const fit = Math.min(availW / ww, availH / wh);
    const z = Math.max(0.05, v.z < 0.5 ? Math.min(fit, 1) : Math.min(v.z, fit));
    const wx = (r.left - st.left - v.x) / v.z, wy = (r.top - st.top - v.y) / v.z;
    const cx = (left + right) / 2 - st.left, cy = (top + bottom) / 2 - st.top;
    ctx.view.set({ x: cx - (wx + ww / 2) * z, y: cy - (wy + wh / 2) * z, z }, { animate: true });
  }

  // ---------- the preview on the canvas ----------
  function clearPreview() {
    S.gen++; clearTimeout(pick.t);          // a version still loading is dropped, not shown late
    S.preview?.remove(); S.preview = null; cue.hidden = true; chip.hidden = true;
    document.querySelectorAll('[data-time-previewing]').forEach((c) => { delete c.dataset.timePreviewing; });
  }
  function showPreview(version) {
    const fr = frameOf(S.id);
    const live = fr?.iframe();
    if (!fr || !live) return;
    if (!version) { clearPreview(); return; }
    const w = fr.width, next = document.createElement('iframe');
    next.className = 'time-preview'; next.title = 'Earlier version (preview)'; next.tabIndex = -1; next.setAttribute('aria-hidden', 'true');
    next.style.width = `${w}px`; next.style.height = live.style.height || '120px';
    const my = ++S.gen;
    next.addEventListener('load', () => {
      if (my !== S.gen || !next.isConnected) return;
      try { const h = Math.ceil(next.contentDocument.documentElement.getBoundingClientRect().height); if (h) next.style.height = `${Math.max(24, Math.min(4000, h))}px`; } catch { /* not ours */ }
      next.dataset.ready = '1';
      S.preview?.remove(); S.preview = next; // the old one goes when the new one is drawn: scrubbing does not flash
      fr.cell.dataset.timePreviewing = '1'; // the live frame hides only now, so there is never a blank frame between
      chip.hidden = false; placeCue();
    }, { once: true });
    next.src = `/view/${enc(S.id)}?version=${enc(version)}&width=${w}`;
    fr.cell.append(next);
    setTimeout(() => { if (my === S.gen && S.preview !== next) next.remove(); }, 8000);
  }

  // ---------- the strip ----------
  const tileHtml = (t, i) => {
    if (t.boundary) return `<div class="tm-boundary" id="tm-${i}" data-i="${i}" role="presentation" aria-hidden="true" title="${esc(t.what)}"><span>${esc(t.what)}</span></div>`;
    const label = t.now ? 'Now' : clock(t.at), what = wording(t), by = t.now ? '' : who(t);
    const tag = t.source === 'git' ? `<span class="tm-git" title="Commit ${esc(t.short)}: ${esc(t.summary)}">git ${esc(t.short)}</span>` : t.git ? `<span class="tm-git" title="Also commit ${esc(t.git.short)}: ${esc(t.git.subject)}">git ${esc(t.git.short)}</span>` : '';
    const n = (t.count > 1 ? `<span class="tm-count">${t.count} edits</span>` : '') + (t.more > 0 ? `<span class="tm-count">+${t.more} more</span>` : '');
    const tip = [what, t.where, t.source === 'git' ? `${t.by}: ${t.summary}` : by ? `${by}${t.summary ? ': ' + t.summary : ''}` : t.summary].filter(Boolean).join('\n');
    return `<div class="tm-tile" id="tm-${i}" role="option" aria-selected="false" aria-label="${esc(`${label}. ${what}${t.count > 1 ? `. ${t.count} edits` : ''}${t.more > 0 ? `. and ${t.more} more` : ''}${t.same && !t.now ? '. Same as now' : ''}`)}" data-i="${i}" data-source="${t.now ? 'now' : t.source}"${t.version ? ` data-version="${esc(t.version)}"` : ''} title="${esc(tip)}">
      <div class="tm-thumb" aria-hidden="true"></div><div class="tm-meta"><span class="tm-time">${esc(label)}</span>${tag}${n}</div><div class="tm-what">${esc(what)}</div></div>`;
  };

  // The crop every thumbnail shows: the selected element if there is one, else the component's content, so tiles differ where the versions do.
  function cropOf() {
    const fr = frameOf(S.id), doc = fr?.doc(); if (!doc?.body) return null;
    const sel = ctx.state.selection, node = sel && sel.component === S.id ? fr.element(sel.node)?.el : null;
    let r = null;
    if (node?.getBoundingClientRect) { const b = node.getBoundingClientRect(); if (b.width > 2 && b.height > 2) r = { x: b.left, y: b.top, w: b.width, h: b.height }; }
    if (!r) {
      let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
      for (const c of doc.body.children) { if (/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(c.tagName) || c.hasAttribute('data-napkin')) continue; const b = c.getBoundingClientRect(); if (!b.width && !b.height) continue; x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom); }
      r = x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: fr.width, h: 200 };
    }
    const p = 10, x = Math.max(0, r.x - p), y = Math.max(0, r.y - p);
    return { x, y, w: Math.max(40, Math.min(fr.width - x, r.w + 2 * p)), h: Math.max(30, r.h + 2 * p), frameWidth: fr.width };
  }

  async function load({ keep = false } = {}) {
    const id = S.id; if (!id) return;
    const r = await fetch(`/api/component/${enc(id)}/film`).then((x) => x.json()).catch(() => null);
    if (!r?.ok || id !== S.id) { info.textContent = r ? plain(r.error) : 'Could not read the versions'; return; }
    S.film = r; S.kind = compOf(id)?.kind;
    el.querySelector('#time-file').textContent = r.file;
    // the newest frame is what the files are now: it is the "Now" tile, not a second copy of it (and says what the last change was)
    const newest = r.frames[0]?.same ? r.frames[0] : null;
    const frames = newest ? r.frames.slice(1) : r.frames;
    S.tiles = [...frames.reverse().map((f) => ({ ...f, version: f.id })), { now: true, same: true, what: newest?.what ?? '', where: newest?.where ?? '', count: newest?.count ?? 1, more: newest?.more ?? 0, beforeId: newest?.beforeId ?? null, summary: newest?.summary ?? '', source: newest?.source ?? 'napkin', by: newest?.by }];
    const prev = keep && S.at >= 0 ? S.tiles[S.at]?.id : null;
    thumbsOf.reset();
    S.crop = cropOf();
    track.innerHTML = S.tiles.map(tileHtml).join('');
    thumbsOf.watch(S.crop);
    const at = prev ? S.tiles.findIndex((t) => t.id === prev) : -1;
    S.at = -1; pick(at >= 0 ? at : S.tiles.length - 1, { scroll: true, quiet: true });
    if (S.tiles.length === 1) info.textContent = 'No earlier versions yet. Edit something and each change shows up here.';
  }

  // a boundary (stylesheets applied or removed) is a mark between versions, never a stop
  const stepFrom = (i, d) => { let j = i + d; while (S.tiles[j]?.boundary) j += d; return S.tiles[j] ? j : i; };
  const firstStop = () => S.tiles.findIndex((t) => !t.boundary);
  const versionOf = (t) => (S.side === 'before' ? t.beforeId : t.version);
  function pick(i, { scroll = true, quiet = false } = {}) {
    i = Math.max(0, Math.min(S.tiles.length - 1, i));
    if (i === S.at) return;
    S.at = i; S.side = 'after'; flipBtn.setAttribute('aria-pressed', 'false'); flipBtn.textContent = 'Before';
    const t = S.tiles[i];
    track.querySelectorAll('.tm-tile').forEach((n) => n.setAttribute('aria-selected', String(Number(n.dataset.i) === i)));
    track.setAttribute('aria-activedescendant', `tm-${i}`);
    const node = track.querySelector(`#tm-${i}`);
    if (scroll && node) node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    restoreBtn.disabled = !!t.now || !!t.same;
    restoreBtn.title = t.now ? 'This is the files as they are' : t.same ? 'The files already equal this version' : '';
    flipBtn.disabled = !t.beforeId;
    if (t.now) { showPreview(null); info.textContent = quiet ? '' : 'The files as they are now'; return; }
    show(t, quiet);
  }
  function show(t, quiet = false) {
    clearTimeout(pick.t);
    const v = versionOf(t);
    if (!v) { showPreview(null); return; }
    if (!S.revealed && !t.now) { S.revealed = true; reveal(); }
    pick.t = setTimeout(() => showPreview(v), quiet ? 0 : 50); // a drag across many tiles draws only where it rests
    info.textContent = S.side === 'before' ? 'Before this change' : t.same ? 'Same as now' : '';
    restoreBtn.title = t.otherFiles ? `Puts back this version's own files (${t.otherFiles.join(', ')}). The stylesheets applied now stay as they are.` : restoreBtn.title;
    if (S.side === 'after' && t.otherFiles) info.textContent = `Made of other files than now (${t.otherFiles.length}): restoring puts back only these; applied stylesheets stay`;
    else if (S.side === 'after' && !t.same) {
      const my = S.at, id = S.id;
      fetch(`/api/component/${enc(id)}/film/${enc(t.version)}/diff`).then((x) => x.json()).then((d) => {
        if (my !== S.at || id !== S.id || !d.ok || S.side !== 'after') return;
        const n = d.added + d.removed;
        info.textContent = n === 0 ? 'Same as now' : `Now differs: ${d.removed} removed, ${d.added} added`;
      }).catch(() => {});
    }
  }
  function flip() {
    const t = S.tiles[S.at]; if (!t?.beforeId) return;
    S.side = S.side === 'before' ? 'after' : 'before';
    flipBtn.setAttribute('aria-pressed', String(S.side === 'before')); flipBtn.textContent = S.side === 'before' ? 'After' : 'Before';
    restoreBtn.disabled = S.side === 'before' || !!t.now || !!t.same;
    if (S.side === 'after' && t.now) { showPreview(null); info.textContent = 'The files as they are now'; return; }
    show(t);
  }

  async function restore() {
    const t = S.tiles[S.at];
    if (!t || t.now || t.same || S.side === 'before') return null;
    const r = await ctx.fetch(`/api/component/${enc(S.id)}/film/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frame: t.version }) });
    const j = await r.json().catch(() => ({ ok: false, error: `Restore failed (${r.status})` }));
    if (!j.ok) { ctx.hint(`Could not restore: ${plain(j.error)}`); info.textContent = plain(j.error); return j; }
    clearPreview();
    ctx.hint(`Restored the version from ${clock(t.at)}${j.changed?.length > 1 ? ` (${j.changed.length} files)` : ''}. Cmd-Z puts the newer text back.`);
    S.at = -1; await load();
    return j;
  }

  function open() {
    const id = targetId();
    if (!id) { ctx.hint('Select an HTML or React component first, then open its versions'); return false; }
    S.id = id; S.open = true; S.revealed = false; S.side = 'after'; el.hidden = false; document.body.dataset.timeOpen = '1';
    track.focus({ preventScroll: true });
    S.tiles = []; S.at = -1; track.replaceChildren(); thumbsOf.reset(); // nothing of the last time it was open
    load();
    return true;
  }
  // Closing leaves the selection and the view alone.
  function close() {
    if (!S.open) return;
    S.open = false; el.hidden = true; delete document.body.dataset.timeOpen; S.gen++;
    clearPreview(); thumbsOf.reset();
  }
  const toggle = () => (S.open ? close() : open());

  // ---------- input ----------
  const typing = (t) => !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  document.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() !== 'h' || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey || ev.defaultPrevented || ev.isComposing) return;
    if (typing(ev.target) || document.body.dataset.play) return;
    ev.preventDefault(); toggle();
  });
  track.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    if (k === 'ArrowLeft' || k === 'ArrowUp') pick(stepFrom(S.at, -1));
    else if (k === 'ArrowRight' || k === 'ArrowDown') pick(stepFrom(S.at, 1));
    else if (k === 'Home') pick(firstStop());
    else if (k === 'End') pick(S.tiles.length - 1);
    else if (k === 'Enter') restore();
    else if (k === 'b' || k === 'B') flip();
    else if (k === 'Escape') { close(); stage.focus({ preventScroll: true }); }
    else return;
    ev.preventDefault(); ev.stopPropagation();
  });
  // Pointer: press and drag across the tiles to scrub; a click picks one.
  let down = false;
  const under = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.tm-tile');
  track.addEventListener('pointerdown', (ev) => { if (ev.button !== 0) return; const t = under(ev); if (!t) return; down = true; track.setPointerCapture?.(ev.pointerId); pick(Number(t.dataset.i), { scroll: false }); track.focus({ preventScroll: true }); });
  track.addEventListener('pointermove', (ev) => { if (!down) return; const t = under(ev); if (t) pick(Number(t.dataset.i), { scroll: false }); });
  const up = () => { down = false; };
  track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  track.addEventListener('dblclick', () => restore());
  restoreBtn.addEventListener('click', () => restore());
  flipBtn.addEventListener('click', () => { flip(); track.focus({ preventScroll: true }); });
  el.querySelector('#time-fit').addEventListener('click', () => { reveal(true); track.focus({ preventScroll: true }); });
  el.querySelector('#time-close').addEventListener('click', close);

  // ---------- following the canvas ----------
  ctx.on('select', () => {
    if (!S.open) return;
    const id = targetId();
    if (id && id !== S.id) { clearPreview(); S.id = id; S.at = -1; S.revealed = false; load(); return; }
    if (id) { const c = cropOf(); if (c && JSON.stringify(c) !== JSON.stringify(S.crop)) { S.crop = c; thumbsOf.reset(); thumbsOf.watch(c); } } // a new element: the thumbnails show it
  });
  let reload = 0;
  ctx.on('doc-change', (f) => {
    if (!S.open) return;
    const c = compOf(S.id);
    if (!c) return;
    if (!(f.path === c.path || (f.affects || []).includes(S.id))) return;
    clearTimeout(reload);
    // a new edit lands: the strip grows a frame and the canvas shows Now. A change napkin already has a frame for (the
    // events of an edit arrive more than once) leaves the strip, and the scrub in progress, alone.
    reload = setTimeout(async () => {
      const id = S.id, r = await fetch(`/api/component/${enc(id)}/film`).then((x) => x.json()).catch(() => null);
      if (!S.open || id !== S.id || !r?.ok) return;
      const sig = (film) => film.frames.map((x) => x.id).join() + film.now.sig;
      if (S.film && sig(r) === sig(S.film)) return;
      clearPreview(); load({ keep: false });
    }, 150);
  });
  // the frame drew again (an edit, a reload): the element is where it is now, so the thumbnails are cropped to it
  ctx.on('render', ({ component }) => { if (S.open && component === S.id && S.tiles.length) { const c = cropOf(); if (c && JSON.stringify(c) !== JSON.stringify(S.crop)) { S.crop = c; thumbsOf.reset(); thumbsOf.watch(c); } } });
  ctx.on('removed', ({ component }) => { if (component === S.id) close(); });

  const api = { open, close, toggle, restore, flip, fit: () => reveal(true), pick: (i) => pick(i === 'now' ? S.tiles.length - 1 : i), state: () => ({ open: S.open, id: S.id, at: S.at, side: S.side, tiles: S.tiles.map((t) => ({ id: t.id ?? 'now', source: t.source ?? 'now', same: !!t.same, what: t.what, count: t.count })) }) };
  ctx.time = api;
  return api;
}
