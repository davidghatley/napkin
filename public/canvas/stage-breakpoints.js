// M4, the rest of the bar: a breakpoints panel for the selected frame (the file's own @media conditions, which apply at this width, which rules switch on or
// off), and the same frame at other widths (one small live frame per breakpoint, loaded only while the panel is open).
//   initBreakpoints(ctx) -> ctx.breakpoints = { open(), close(), toggle(), widths() }     B or Cmd-K "Breakpoints of this frame"
import { widthConditions } from './stage-ruler.js';
import { matchAll } from './stage-highlight.js';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const enc = encodeURIComponent;

export function initBreakpoints(ctx) {
  const stageEl = document.querySelector('#stage');
  const panel = document.createElement('aside');
  panel.id = 'bp-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Breakpoints of the selected frame'); panel.dataset.nodrag = '1';
  const strip = document.createElement('div');
  strip.id = 'bp-strip'; strip.hidden = true; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'The same frame at other widths'); strip.dataset.nodrag = '1';
  document.querySelector('#inspector').prepend(panel); stageEl.append(strip); // the width, the rules and what changed live in the inspector; the frame at other widths in a band at the canvas's foot
  let on = false, cache = { key: '', rules: [] };

  const target = () => { const id = ctx.state.selection?.component ?? ctx.nav?.focused?.(); const f = id && ctx.stage.sections.get(id)?.docFrame; return f ? { id, f } : null; };
  async function rulesFor(id) {
    const rev = ctx.state.components.get(id)?.revision, key = `${id}|${rev}`;
    if (cache.key === key) return cache.rules;
    const r = await fetch(`/api/component/${enc(id)}/rules`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    cache = { key, rules: r?.rules ?? [] };
    return cache.rules;
  }
  // widths for the strip: the breakpoints, a phone width when the file has none that small, and the frame's own
  const widthsFor = (f) => {
    const bps = f.ruler.points().map((b) => Math.round(b.px)).filter((p) => p >= 200 && p <= 1600);
    const set = new Set(bps); if (![...set].some((p) => p <= 480)) set.add(375);
    return [...set].sort((a, b) => a - b).slice(0, 6);
  };

  // What a width changed in this frame: the same frame is read twice, at this width and just past the boundary of each rule that applies, and the declarations that differ are listed
  let probe = null;
  async function probeFor(id, f) {
    if (probe?.id === id && probe.rev === ctx.state.components.get(id)?.revision && probe.fr.isConnected) return probe.fr;
    probe?.fr.remove();
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
    fr.style.cssText = `position:fixed;left:-20000px;top:0;width:${f.width}px;height:900px;border:0;visibility:hidden;pointer-events:none`;
    document.body.append(fr);
    await new Promise((res) => { fr.addEventListener('load', res, { once: true }); fr.src = `/view/${enc(id)}?width=${f.width}&probe=1`; });
    probe = { id, fr, rev: ctx.state.components.get(id)?.revision };
    return fr;
  }
  async function fillChanges(id, f, applying) {
    const box = panel.querySelector('#bp-changes'); if (!box) return;
    let fr; try { fr = await probeFor(id, f); } catch { return; }
    const w = f.width, doc = fr.contentDocument, win = fr.contentWindow, lines = [];
    const read = (at, rule) => { fr.style.width = `${at}px`; void doc.documentElement.offsetWidth; const out = {}; const el = matchAll(doc, rule.selector).values().next().value; if (el) { const cs = win.getComputedStyle(el); for (const d of rule.decls) if (!d.prop.startsWith('--')) out[d.prop] = cs.getPropertyValue(d.prop); } return out; };
    for (const r of applying) {
      const other = r.kind === 'max' ? r.px + 1 : r.px - 1;
      for (const rule of r.mine.slice(0, 6)) {
        const now = read(w, rule), before = read(other, rule);
        for (const prop of Object.keys(now)) if (before[prop] !== undefined && before[prop] !== now[prop]) lines.push({ sel: sel(rule), prop, was: before[prop], now: now[prop], m: r.m });
      }
    }
    fr.style.width = `${w}px`;
    if (panel.querySelector('#bp-changes') !== box) return;
    box.innerHTML = lines.length ? lines.slice(0, 8).map((l) => `<div class="on" title="${esc(l.sel)} ${esc(l.prop)}: ${esc(l.was)} → ${esc(l.now)}"><span class="bp-where"><code>${esc(l.sel)}</code> <span class="bp-prop">${esc(l.prop)}</span></span> <span class="bp-chg">${esc(short(l.was))} → ${esc(short(l.now))}</span></div>`).join('') : '<div class="none">Nothing here looks different from just past the boundary.</div>';
  }
  const sel = (r) => String(r.selector).replace(/\s+/g, ' ');
  const short = (t) => { t = String(t); return t.length > 34 ? `${t.slice(0, 33)}…` : t; };

  async function paint() {
    const t = target();
    if (!on) return;
    panel.hidden = !t;
    if (!t) { strip.hidden = true; return; }
    const { id, f } = t, w = f.width, win = f.iframe()?.contentWindow;
    const rules = await rulesFor(id);
    if (target()?.id !== id) return;
    const doc = f.doc();
    const conds = new Map(); // media text -> { m, mine: rules with an element in this frame, other: rules with none }
    for (const r of rules) for (const m of r.media || []) {
      if (!widthConditions(m).length) continue;
      if (!conds.has(m)) conds.set(m, { m, mine: [], other: [] });
      const hit = r.kind === 'style' && doc && matchAll(doc, r.selector).size > 0;
      conds.get(m)[hit ? 'mine' : 'other'].push(r);
    }
    const rows = [...conds.values()].map(({ m, mine, other }) => {
      const wc = widthConditions(m), px = wc[0].px;
      let match = false; try { match = !!win?.matchMedia(m).matches; } catch { /* a query the browser does not take */ }
      return { m, px, kind: wc[0].kind, strict: !!wc[0].strict, match, mine, other };
    }).sort((a, b) => a.px - b.px);
    const here = rows.filter((r) => r.mine.length), elsewhere = rows.flatMap((r) => r.other.map((x) => ({ r, x })));
    const file = [...new Set(rules.filter((r) => (r.media || []).length).map((r) => r.file))][0];
    const sel = (r) => String(r.selector).replace(/\s+/g, ' ');
    const on_ = here.filter((r) => r.match).flatMap((r) => r.mine.map((x) => ({ x, r }))), off_ = here.filter((r) => !r.match).flatMap((r) => r.mine.map((x) => ({ x, r })));
    const kindText = (r) => (r.kind === 'max' ? (r.strict ? 'under' : 'and under') : (r.strict ? 'over' : 'and up'));
    const rowHtml = (r, dim) => `<li class="${r.match && !dim ? 'on' : ''}${dim ? ' dim' : ''}"><button type="button" data-px="${Math.round(r.px)}" title="Jump the frame to ${Math.round(r.px)} px"><span class="bp-px">${Math.round(r.px)}</span><span class="bp-kind">${kindText(r)}</span><span class="bp-state">${dim ? 'nothing here' : r.match ? 'applies now' : 'not at this width'}</span><span class="bp-rules">${(dim ? r.other : r.mine).slice(0, 2).map((x) => `<code>${esc(sel(x))}</code> <i>:${x.line}</i>`).join(', ')}${(dim ? r.other : r.mine).length > 2 ? ` +${(dim ? r.other : r.mine).length - 2}` : ''}</span></button></li>`;
    const had = panel.contains(document.activeElement) && document.activeElement.id === 'frame-width';
    if (had) { const i = panel.querySelector('#frame-width'); if (i && document.activeElement === i && i.dataset.typing) { paintStrip(id, f); return; } } // the field being typed in stays as it is
    const comp = ctx.state.components.get(id), h = Math.round(f.iframe()?.getBoundingClientRect().height / (ctx.view.get().z || 1)) || 0;
    const sheets = [...new Set(rules.map((r) => r.file).filter((x) => x && x !== comp?.path))].map((x) => x.split('/').pop());
    const stageW = Math.round(stageEl.clientWidth / Math.max(.25, ctx.view.get().z) - 48);
    panel.innerHTML = `<div class="bp-head"><div><b>${esc(comp?.name ?? id)}</b> frame <button type="button" id="bp-back" title="Back to the element (B or Escape)">Back <kbd>Esc</kbd></button></div><p>${esc(comp?.path ?? '')}${sheets.length ? ` · with ${esc(sheets.slice(0, 2).join(' + '))}` : ''}</p></div>
      <section class="bp-sec" id="bp-width"><h3>Frame width</h3>
        <label class="bp-field"><span>Width</span><span class="bp-in"><input id="frame-width" inputmode="numeric" value="${w}" aria-label="Frame width in pixels" spellcheck="false"><i>px</i></span></label>
        <div class="bp-field"><span>Height</span><span class="bp-in ro"><b>${h}</b><i>hugs content</i></span></div>
        <div class="bp-presets" role="group" aria-label="Widths">${[...new Set([375, ...rows.map((r) => Math.round(r.px)).filter((p) => p >= 200 && p <= 1600), 960])].sort((a, b) => a - b).slice(0, 5).map((p) => `<button type="button" data-px="${p}" class="${p === w ? 'cur' : ''}">${p}</button>`).join('')}<button type="button" data-px="${stageW}" id="bp-fill" title="As wide as the canvas shows at this zoom">Fill</button></div>
      </section>
      <header><h3>Breakpoints in this folder</h3><span>${esc((file || '').split('/').pop())}</span></header>
      <p class="bp-now">${esc(ctx.state.components.get(id)?.name ?? id)} is <b>${w} px</b> wide: ${on_.length} of ${on_.length + off_.length} media rules that reach this frame apply.</p>
      <ul class="bp-rows">${here.map((r) => rowHtml(r, false)).join('') || '<li class="none">No width breakpoint of this file reaches this frame.</li>'}</ul>
      ${here.some((r) => r.match) ? `<h4>What ${w} px changed here</h4><div class="bp-diff" id="bp-changes"><div class="none">Reading the frame…</div></div>` : ''}
      ${elsewhere.length ? `<h4 class="dim">Not in this frame · ${elsewhere.length} rule${elsewhere.length === 1 ? '' : 's'}</h4><ul class="bp-rows dim">${elsewhere.slice(0, 8).map(({ r, x }) => `<li class="dim"><button type="button" data-px="${Math.round(r.px)}"><span class="bp-px">${Math.round(r.px)}</span><span class="bp-kind">${kindText(r)}</span><span class="bp-state">nothing here</span><span class="bp-rules"><code>${esc(sel(x))}</code> <i>:${x.line}</i></span></button></li>`).join('')}${elsewhere.length > 8 ? `<li class="none">+${elsewhere.length - 8} more</li>` : ''}</ul>` : ''}
      <p class="bp-note">Nothing is written to the file: the width is a way of looking, the rules are the file's own.</p>`;
    fillChanges(id, f, here.filter((r) => r.match));
    panel.querySelectorAll('button[data-px]').forEach((b) => b.addEventListener('click', () => f.commitWidth(Number(b.dataset.px))));
    panel.querySelector('#bp-back').onclick = () => { close(); stageEl.focus({ preventScroll: true }); };
    const field = panel.querySelector('#frame-width');
    field.addEventListener('input', () => { field.dataset.typing = '1'; });
    field.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); const n = (Number(field.value) || w) + (ev.key === 'ArrowUp' ? 1 : -1) * (ev.shiftKey ? 10 : 1); field.value = String(n); f.setWidth(n); }
      else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); const n = Number(field.value); delete field.dataset.typing; if (n >= 120) f.commitWidth(n); else { field.value = String(f.width); ctx.hint('A frame is at least 120 px wide'); } }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); delete field.dataset.typing; field.value = String(f.width); field.blur(); stageEl.focus({ preventScroll: true }); }
    });
    if (had) { const i = panel.querySelector('#frame-width'); i.focus(); i.select(); }
    paintStrip(id, f);
  }

  // the same frame at other widths: a small live frame for each, created once per frame and loaded lazily (when scrolled into the strip)
  let stripFor = '';
  function paintStrip(id, f) {
    const ws = widthsFor(f);
    strip.hidden = !ws.length;
    const key = `${id}|${ws.join()}|${ctx.state.components.get(id)?.revision}`;
    if (stripFor === key) { for (const b of strip.querySelectorAll('button')) b.classList.toggle('cur', Math.abs(Number(b.dataset.px) - f.width) < 1); return; }
    stripFor = key;
    strip.innerHTML = `<span class="bp-cap"><b>Same frame at other widths</b> <i>click to jump</i></span>${ws.map((w) => `<button type="button" data-px="${w}" class="${Math.abs(w - f.width) < 1 ? 'cur' : ''}" aria-label="Show the frame at ${w} px"><span class="bp-thumb" style="--w:${w}"><iframe tabindex="-1" aria-hidden="true" title="${w} px" loading="lazy" data-src="/view/${enc(id)}?width=${w}&strip=1" style="width:${w}px"></iframe></span><span class="bp-lbl">${w}${w <= 480 ? ' · phone' : ''}</span></button>`).join('')}`;
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const fr = e.target.querySelector('iframe'); if (fr && !fr.src) fr.src = fr.dataset.src; io.unobserve(e.target); } });
    strip.querySelectorAll('.bp-thumb').forEach((t) => io.observe(t));
    strip.querySelectorAll('button[data-px]').forEach((b) => b.addEventListener('click', () => f.commitWidth(Number(b.dataset.px))));
  }

  // the frame comes up to a legible size, whole, above the band at the foot of the canvas
  function legible() {
    const t = target(); if (!t) return;
    requestAnimationFrame(() => {
      const c = t.f.cell.getBoundingClientRect(), st = stageEl.getBoundingClientRect(), foot = strip.hidden ? 0 : strip.offsetHeight, v = ctx.view.get();
      const top = st.top + 62, bottom = st.bottom - foot - 30, left = st.left + 20, right = st.right - 56;
      if (v.z >= 0.5 && c.left >= left && c.right <= right && c.top >= top && c.bottom <= bottom) return;
      const ww = c.width / v.z, wh = c.height / v.z, z = Math.max(0.1, Math.min(1, (right - left) / ww, (bottom - top) / wh));
      const wx = (c.left - st.left - v.x) / v.z, wy = (c.top - st.top - v.y) / v.z;
      ctx.view.set({ x: (left + right) / 2 - st.left - (wx + ww / 2) * z, y: (top + bottom) / 2 - st.top - (wy + wh / 2) * z, z }, { animate: true });
    });
  }
  const open = () => { ctx.time?.close(); on = true; document.body.dataset.bp = '1'; document.body.classList.add('insp-frame'); paint().then(legible); ctx.legend?.push('frame', [['Alt drag', 'free of breakpoints'], ['↑ ↓', 'width, in the field'], ['B', 'done'], ['Esc', 'back']]); };
  const close = () => { ctx.legend?.pop('frame'); probe?.fr.remove(); probe = null; on = false; delete document.body.dataset.bp; document.body.classList.remove('insp-frame'); panel.hidden = true; strip.hidden = true; strip.replaceChildren(); stripFor = ''; };
  ctx.on('select', () => on && paint());
  let fitT = 0;
  ctx.on('framewidth', ({ component }) => { if (!on) return; paint(); const c = ctx.stage.sections.get(component)?.docFrame?.cell; clearTimeout(fitT); if (!c?.dataset.resizing) fitT = setTimeout(legible, 60); });
  ctx.on('render', () => { if (on) { cache = { key: '', rules: [] }; stripFor = ''; paint(); } });
  addEventListener('keydown', (ev) => {
    if (ev.code === 'Escape' && on && !ctx.highlight?.active() && !document.body.dataset.modal && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && !ev.target.closest?.('#time, #ask-styles, dialog')) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); stageEl.focus({ preventScroll: true }); return; }
    if (ev.code !== 'KeyB' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.isComposing) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable || document.body.dataset.modal || ev.target.closest?.('#time') || ctx.inspector?.state?.()) return; // while a value is staged B is the inspector's; in the film strip, B is before/after
    ev.preventDefault(); on ? close() : open();
  }, true);
  ctx.breakpoints = { legible, open, close, toggle: () => (on ? close() : open()), widths: () => { const t = target(); return t ? widthsFor(t.f) : []; }, active: () => on };
  return ctx.breakpoints;
}
