// A film strip of time (DREAM moment 9). H opens it under the canvas for the selected HTML or React component: its versions
// as thumbnails, oldest on the left, "Now" on the right. Napkin's own edits (kept outside the folder, so they survive a
// restart) and the file's git history, side by side. Scrub with the pointer or the arrow keys: the component's frame on the
// canvas shows that version, drawn by the browser from that version's bytes. Restore makes the file that version as ONE new
// edit through the engine's write path, so one undo gives the newest text back and the diff is the difference to that version.
//   initTimeStrip(ctx) -> ctx.time = { open(), close(), toggle(), restore(), pick(index|'now'), state() }
import { plain } from './words.js';
import { thumbs } from './time-thumbs.js';

const enc = encodeURIComponent;
const ENGINE = new Set(['html', 'tsx', 'jsx']);
const pad = (n) => String(n).padStart(2, '0');
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const clock = (at) => { const d = new Date(at), t = `${pad(d.getHours())}:${pad(d.getMinutes())}`; return sameDay(d, new Date()) ? t : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${t}`; };

// The engine's one-line summaries ("text", "attr class", "rule .card padding") in words a designer would use.
export function describe(frame) {
  const s = String(frame.summary || '');
  if (frame.source === 'git') return s;
  const verbs = { text: 'Edited text', attr: 'Changed', prop: 'Changed', style: 'Changed', insert: 'Added an element', delete: 'Removed an element', move: 'Moved an element', rule: 'Changed', var: 'Changed' };
  const parts = s.split(', ').map((p) => { const [op, ...rest] = p.split(' '); return verbs[op] && /^(text|attr|prop|style|insert|delete|move|rule|var)$/.test(op) ? `${verbs[op]}${op === 'text' || op === 'insert' || op === 'delete' || op === 'move' ? '' : ' ' + rest.join(' ')}`.trim() : p; });
  return parts.length > 2 ? `${parts[0]} and ${parts.length - 1} more` : parts.join(', ');
}
const who = (f) => (f.source === 'git' ? f.by : f.by === 'you' ? 'You' : f.by === 'file' ? '' : f.by);

export function initTimeStrip(ctx) {
  const stage = document.querySelector('#stage');
  const S = { open: false, id: null, film: null, tiles: [], at: -1, gen: 0, preview: null, diff: null };
  const el = document.createElement('section');
  el.id = 'time'; el.hidden = true; el.dataset.nodrag = '1'; el.setAttribute('aria-label', 'Versions of the selected component');
  el.innerHTML = `<header class="tm-head"><h2 class="tm-title">Versions <span class="tm-file" id="time-file"></span></h2><span class="tm-info" id="time-info" role="status" aria-live="polite"></span>
    <span class="tm-keys">← → scrub · Enter restore · Esc close</span>
    <button type="button" id="time-restore" class="tm-restore" disabled>Restore this version</button><button type="button" id="time-close" class="tm-close" aria-label="Close versions">×</button></header>
    <div class="tm-track" id="time-track" role="listbox" tabindex="0" aria-label="Versions, oldest first. Left and right move, Enter restores"></div>`;
  stage.append(el);
  const track = el.querySelector('#time-track'), info = el.querySelector('#time-info'), restoreBtn = el.querySelector('#time-restore');
  const thumbsOf = thumbs(track, (tile, size) => ({ id: S.id, version: tile.dataset.version || null, kind: S.kind, width: size }));

  const compOf = (id) => ctx.state.components.get(id);
  const targetId = () => {
    const s = ctx.state.selection; const c = s && compOf(s.component);
    return c && ENGINE.has(c.kind) ? c.component : null;
  };
  const frameOf = (id) => ctx.stage.sections.get(id)?.docFrame ?? null;

  // ---------- the preview on the canvas ----------
  function clearPreview() {
    S.gen++; clearTimeout(pick.t);          // a version still loading is dropped, not shown late
    S.preview?.remove(); S.preview = null;
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
    }, { once: true });
    next.src = `/view/${enc(S.id)}?version=${enc(version)}&width=${w}`;
    fr.cell.append(next);
    setTimeout(() => { if (my === S.gen && S.preview !== next) next.remove(); }, 8000);
  }

  // ---------- the strip ----------
  const tileHtml = (t, i) => {
    const label = t.now ? 'Now' : clock(t.at), name = t.now ? 'The file as it is' : [who(t), describe(t)].filter(Boolean).join(' · ');
    const tag = t.source === 'git' ? `<span class="tm-git" title="A git commit">git ${t.short}</span>` : '';
    return `<div class="tm-tile" id="tm-${i}" role="option" aria-selected="false" aria-label="${esc(`${label}. ${name}${t.same && !t.now ? '. Same as now' : ''}`)}" data-i="${i}" data-source="${t.now ? 'now' : t.source}"${t.version ? ` data-version="${esc(t.version)}"` : ''}>
      <div class="tm-thumb" aria-hidden="true"></div><div class="tm-meta"><span class="tm-time">${esc(label)}</span>${tag}</div><div class="tm-what" title="${esc(name)}">${esc(name)}</div></div>`;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  async function load({ keep = false } = {}) {
    const id = S.id; if (!id) return;
    const r = await fetch(`/api/component/${enc(id)}/film`).then((x) => x.json()).catch(() => null);
    if (!r?.ok || id !== S.id) { info.textContent = r ? plain(r.error) : 'Could not read the versions'; return; }
    S.film = r; S.kind = compOf(id)?.kind;
    el.querySelector('#time-file').textContent = r.file;
    // the newest napkin frame is what the file is now: it is the "Now" tile, not a second copy of it
    const newest = r.frames.findIndex((x) => x.source === 'napkin');
    const frames = r.frames.filter((f, k) => !(k === newest && f.same));
    S.tiles = [...frames.reverse().map((f) => ({ ...f, version: f.id })), { now: true, same: true }];
    const prev = keep && S.at >= 0 ? S.tiles[S.at]?.id : null;
    thumbsOf.reset();
    track.innerHTML = S.tiles.map(tileHtml).join('');
    thumbsOf.watch(frameWidth());
    const at = prev ? S.tiles.findIndex((t) => t.id === prev) : -1;
    S.at = -1; pick(at >= 0 ? at : S.tiles.length - 1, { scroll: true, quiet: true });
    if (S.tiles.length === 1) info.textContent = 'No earlier versions yet. Edit something and each change shows up here.';
  }
  const frameWidth = () => frameOf(S.id)?.width || 640;

  async function pick(i, { scroll = true, quiet = false } = {}) {
    i = Math.max(0, Math.min(S.tiles.length - 1, i));
    if (i === S.at) return;
    S.at = i;
    const t = S.tiles[i];
    track.querySelectorAll('.tm-tile').forEach((n) => n.setAttribute('aria-selected', String(Number(n.dataset.i) === i)));
    track.setAttribute('aria-activedescendant', `tm-${i}`);
    const node = track.querySelector(`#tm-${i}`);
    if (scroll && node) node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    restoreBtn.disabled = !!t.now || !!t.same;
    restoreBtn.title = t.now ? 'This is the file as it is' : t.same ? 'The file already equals this version' : '';
    S.diff = null;
    if (t.now) { showPreview(null); info.textContent = quiet ? '' : 'The file as it is now'; return; }
    clearTimeout(pick.t);
    pick.t = setTimeout(() => showPreview(t.version), quiet ? 0 : 50); // a drag across many tiles draws only where it rests
    info.textContent = t.same ? 'Same as now' : '';
    if (!t.same) {
      const my = S.at, id = S.id;
      fetch(`/api/component/${enc(id)}/film/${enc(t.version)}/diff`).then((x) => x.json()).then((d) => {
        if (my !== S.at || id !== S.id || !d.ok) return;
        S.diff = d;
        const n = d.added + d.removed;
        info.textContent = n === 0 ? 'Same as now' : `Against now: ${d.removed} line${d.removed === 1 ? '' : 's'} removed, ${d.added} added`;
      }).catch(() => {});
    }
  }

  async function restore() {
    const t = S.tiles[S.at];
    if (!t || t.now || t.same) return null;
    const r = await ctx.fetch(`/api/component/${enc(S.id)}/film/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frame: t.version }) });
    const j = await r.json().catch(() => ({ ok: false, error: `Restore failed (${r.status})` }));
    if (!j.ok) { ctx.hint(`Could not restore: ${plain(j.error)}`); return j; }
    clearPreview();
    ctx.hint(`Restored the version from ${clock(t.at)}. Cmd-Z puts the newer text back.`);
    S.at = -1; await load();
    return j;
  }

  function open() {
    const id = targetId();
    if (!id) { ctx.hint('Select an HTML or React component first, then open its versions'); return false; }
    S.id = id; S.open = true; el.hidden = false; document.body.dataset.timeOpen = '1';
    document.querySelector('#time-open')?.setAttribute('aria-pressed', 'true');
    track.focus({ preventScroll: true });
    S.tiles = []; S.at = -1; track.replaceChildren(); thumbsOf.reset(); // nothing of the last time it was open
    load();
    return true;
  }
  function close() {
    if (!S.open) return;
    S.open = false; el.hidden = true; delete document.body.dataset.timeOpen; S.gen++;
    clearPreview(); thumbsOf.reset();
    document.querySelector('#time-open')?.setAttribute('aria-pressed', 'false');
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
    if (k === 'ArrowLeft' || k === 'ArrowUp') pick(S.at - 1);
    else if (k === 'ArrowRight' || k === 'ArrowDown') pick(S.at + 1);
    else if (k === 'Home') pick(0);
    else if (k === 'End') pick(S.tiles.length - 1);
    else if (k === 'Enter') restore();
    else if (k === 'Escape') { if (S.at < S.tiles.length - 1) pick(S.tiles.length - 1); else { close(); stage.focus({ preventScroll: true }); } }
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
  el.querySelector('#time-close').addEventListener('click', close);
  document.querySelector('#time-open')?.addEventListener('click', toggle);

  // ---------- following the canvas ----------
  ctx.on('select', () => { if (!S.open) return; const id = targetId(); if (id && id !== S.id) { clearPreview(); S.id = id; S.at = -1; load(); } });
  let reload = 0;
  ctx.on('doc-change', (f) => {
    if (!S.open) return;
    const c = compOf(S.id);
    if (!c || (f.path !== c.path && !(f.affects || []).includes(S.id))) return;
    if (f.path !== c.path) return;
    clearTimeout(reload);
    // a new edit lands: the strip grows a frame and the canvas shows Now. A change napkin already has a frame for (the
    // events of an edit arrive more than once) leaves the strip, and the scrub in progress, alone.
    reload = setTimeout(async () => {
      const id = S.id, r = await fetch(`/api/component/${enc(id)}/film`).then((x) => x.json()).catch(() => null);
      if (!S.open || id !== S.id || !r?.ok) return;
      const sig = (film) => film.frames.map((x) => x.id).join() + film.now.hash;
      if (S.film && sig(r) === sig(S.film)) return;
      clearPreview(); load({ keep: false });
    }, 150);
  });
  ctx.on('removed', ({ component }) => { if (component === S.id) close(); });

  const api = { open, close, toggle, restore, pick: (i) => pick(i === 'now' ? S.tiles.length - 1 : i), state: () => ({ open: S.open, id: S.id, at: S.at, tiles: S.tiles.map((t) => ({ id: t.id ?? 'now', source: t.source ?? 'now', same: !!t.same })) }) };
  ctx.time = api;
  return api;
}
