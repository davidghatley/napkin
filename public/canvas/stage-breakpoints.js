// M4, the rest of the bar: a breakpoints panel for the selected frame (the file's own @media conditions, which apply at this width, which rules switch on or
// off), and the same frame at other widths (one small live frame per breakpoint, loaded only while the panel is open).
//   initBreakpoints(ctx) -> ctx.breakpoints = { open(), close(), toggle(), widths() }     B or Cmd-K "Breakpoints of this frame"
import { widthConditions } from './stage-ruler.js';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const enc = encodeURIComponent;

export function initBreakpoints(ctx) {
  const stageEl = document.querySelector('#stage');
  const panel = document.createElement('aside');
  panel.id = 'bp-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Breakpoints of the selected frame'); panel.dataset.nodrag = '1';
  const strip = document.createElement('div');
  strip.id = 'bp-strip'; strip.hidden = true; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'The same frame at other widths'); strip.dataset.nodrag = '1';
  stageEl.append(panel, strip);
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

  async function paint() {
    const t = target();
    if (!on) return;
    panel.hidden = !t;
    if (!t) { strip.hidden = true; return; }
    const { id, f } = t, w = f.width, win = f.iframe()?.contentWindow;
    const rules = await rulesFor(id);
    if (target()?.id !== id) return;
    const conds = new Map(); // media text -> { cond, rules }
    for (const r of rules) for (const m of r.media || []) { if (!widthConditions(m).length) continue; if (!conds.has(m)) conds.set(m, { m, list: [] }); conds.get(m).list.push(r); }
    const rows = [...conds.values()].map(({ m, list }) => {
      const wc = widthConditions(m), px = wc[0].px;
      let match = false; try { match = !!win?.matchMedia(m).matches; } catch { /* a query the browser does not take */ }
      return { m, px, kind: wc[0].kind, match, list };
    }).sort((a, b) => a.px - b.px);
    const file = [...new Set(rules.filter((r) => (r.media || []).length).map((r) => r.file))][0];
    const sel = (r) => String(r.selector).replace(/\s+/g, ' ');
    const on_ = rows.filter((r) => r.match).flatMap((r) => r.list.map((x) => ({ x, r }))), off_ = rows.filter((r) => !r.match).flatMap((r) => r.list.map((x) => ({ x, r })));
    panel.innerHTML = `<header><h3>Breakpoints in this folder</h3><span>${esc((file || '').split('/').pop())}</span></header>
      <p class="bp-now">${esc(ctx.state.components.get(id)?.name ?? id)} is <b>${w} px</b> wide: ${on_.length} of ${on_.length + off_.length} media rules apply.</p>
      <ul class="bp-rows">${rows.map((r) => `<li class="${r.match ? 'on' : ''}"><button type="button" data-px="${Math.round(r.px)}" title="Jump the frame to ${Math.round(r.px)} px"><span class="bp-px">${Math.round(r.px)}</span><span class="bp-kind">${r.kind === 'max' ? 'and under' : 'and up'}</span><span class="bp-state">${r.match ? 'applies now' : 'not in frame'}</span><span class="bp-rules">${r.list.slice(0, 2).map((x) => `<code>${esc(sel(x))}</code> <i>:${x.line}</i>`).join(', ')}${r.list.length > 2 ? ` +${r.list.length - 2}` : ''}</span></button></li>`).join('') || '<li class="none">This file has no width breakpoints.</li>'}</ul>
      ${rows.length ? `<h4>What ${w} px switches</h4>
      <div class="bp-diff">${on_.slice(0, 5).map(({ x, r }) => `<div class="on"><b>on</b> <code>${esc(sel(x))}</code> <span>${esc(r.m.replace(/[()]/g, ''))}</span></div>`).join('')}${off_.slice(0, 4).map(({ x, r }) => `<div class="off"><b>off</b> <code>${esc(sel(x))}</code> <span>${esc(r.m.replace(/[()]/g, ''))}</span></div>`).join('')}</div>` : ''}
      <p class="bp-note">Nothing is written to the file: the width is a way of looking, the rules are the file's own.</p>`;
    panel.querySelectorAll('button[data-px]').forEach((b) => b.addEventListener('click', () => f.commitWidth(Number(b.dataset.px))));
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
    strip.innerHTML = `<span class="bp-cap">Same frame at other widths <i>click to jump</i></span>${ws.map((w) => `<button type="button" data-px="${w}" class="${Math.abs(w - f.width) < 1 ? 'cur' : ''}" aria-label="Show the frame at ${w} px"><span class="bp-thumb" style="--w:${w}"><iframe tabindex="-1" aria-hidden="true" title="${w} px" loading="lazy" data-src="/view/${enc(id)}?width=${w}&strip=1" style="width:${w}px"></iframe></span><span class="bp-lbl">${w}${w <= 480 ? ' · phone' : ''}</span></button>`).join('')}`;
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const fr = e.target.querySelector('iframe'); if (fr && !fr.src) fr.src = fr.dataset.src; io.unobserve(e.target); } });
    strip.querySelectorAll('.bp-thumb').forEach((t) => io.observe(t));
    strip.querySelectorAll('button[data-px]').forEach((b) => b.addEventListener('click', () => f.commitWidth(Number(b.dataset.px))));
  }

  const open = () => { on = true; document.body.dataset.bp = '1'; paint(); };
  const close = () => { on = false; delete document.body.dataset.bp; panel.hidden = true; strip.hidden = true; strip.replaceChildren(); stripFor = ''; };
  ctx.on('select', () => on && paint());
  ctx.on('framewidth', () => on && paint());
  ctx.on('render', () => { if (on) { cache = { key: '', rules: [] }; stripFor = ''; paint(); } });
  addEventListener('keydown', (ev) => {
    if (ev.code !== 'KeyB' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.isComposing) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable || document.body.dataset.modal) return;
    ev.preventDefault(); on ? close() : open();
  }, true);
  ctx.breakpoints = { open, close, toggle: () => (on ? close() : open()), widths: () => { const t = target(); return t ? widthsFor(t.f) : []; }, active: () => on };
  return ctx.breakpoints;
}
