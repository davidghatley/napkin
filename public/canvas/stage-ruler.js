// M4, real responsiveness. A frame's width is its document's viewport, so dragging the grip reflows the file for real. This
// module reads the file's own width breakpoints from the frame's style sheets and draws them as ticks on a ruler under the
// frame; dragging snaps to them, clicking a tick jumps to it, and the caption says the width and which breakpoints apply.
//   breakpoints(doc) -> [{ px, rules, kinds: Set('min'|'max') }]            sorted by px
//   describe(bps, width) -> string                                           "624 px · 640 and under"
//   snap(bps, width, within) -> { px, snapped }
//   createRuler(frame) -> { el, update(), points(), snap(w, within), say(w) }
//   initWidths(ctx) -> ctx.widths = { step(dir), reset(), target() }       Cmd-K: next / previous breakpoint, back to 640 px
const LEN = /^(-?[\d.]+)(px|em|rem)$/;
const toPx = (n, unit) => Number(n) * (unit === 'px' ? 1 : 16);
// width conditions in a media query: (min-width: 640px), (max-width: 40em), (width >= 640px), (640px <= width), (width < 40rem)
const CONDS = [
  [/\(\s*(min|max)-width\s*:\s*(-?[\d.]+)(px|em|rem)\s*\)/gi, (m) => [m[1].toLowerCase(), toPx(m[2], m[3]), false]],
  [/\(\s*width\s*(>=|>|<=|<)\s*(-?[\d.]+)(px|em|rem)\s*\)/gi, (m) => [m[1][0] === '>' ? 'min' : 'max', toPx(m[2], m[3]), m[1].length === 1]],
  [/\(\s*(-?[\d.]+)(px|em|rem)\s*(<=|<|>=|>)\s*width\s*\)/gi, (m) => [m[3][0] === '<' ? 'min' : 'max', toPx(m[1], m[2]), m[3].length === 1]],
];
export function widthConditions(text) {
  const out = [];
  for (const [re, f] of CONDS) for (const m of String(text).matchAll(re)) { const [kind, px, strict] = f(m); if (Number.isFinite(px) && px > 0) out.push({ kind, px, strict }); }
  return out;
}
function* mediaRules(sheet, depth = 0) {
  let rules; try { rules = sheet.cssRules; } catch { return; }
  for (const r of rules) {
    if (r.type === 3 && r.styleSheet && depth < 4) yield* mediaRules(r.styleSheet, depth + 1);        // @import
    else if (r.type === 4) { yield r.media.mediaText; yield* nested(r, depth); }                       // @media
    else if (r.cssRules) yield* nested(r, depth);                                                      // @supports, @layer, nesting
  }
}
function* nested(rule, depth) {
  for (const r of rule.cssRules || []) {
    if (r.type === 4) { yield r.media.mediaText; yield* nested(r, depth); } else if (r.cssRules) yield* nested(r, depth);
  }
}
export function breakpoints(doc) {
  const by = new Map();
  if (!doc) return [];
  for (const sheet of doc.styleSheets) for (const text of mediaRules(sheet)) for (const { kind, px, strict } of widthConditions(text)) {
    const k = Math.round(px * 100) / 100;
    const b = by.get(k) || { px: k, rules: 0, kinds: new Set(), strict: new Set() };
    b.rules++; b.kinds.add(kind); if (strict) b.strict.add(kind); by.set(k, b);
  }
  return [...by.values()].sort((a, b) => a.px - b.px);
}
// Which breakpoints apply at this width: the nearest "and under" above it and the nearest "and up" below it.
export function applying(bps, width) {
  const max = bps.filter((b) => b.kinds.has('max') && (b.strict.has('max') ? width < b.px : width <= b.px)).sort((a, b) => a.px - b.px)[0];
  const min = bps.filter((b) => b.kinds.has('min') && (b.strict.has('min') ? width > b.px : width >= b.px)).sort((a, b) => b.px - a.px)[0];
  return { max, min };
}
export function describe(bps, width) {
  const { max, min } = applying(bps, width);
  const parts = [max && (max.strict.has('max') ? `under ${Math.round(max.px)}` : `${Math.round(max.px)} and under`), min && (min.strict.has('min') ? `over ${Math.round(min.px)}` : `${Math.round(min.px)} and up`)].filter(Boolean);
  return `${Math.round(width)} px${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}
export function snap(bps, width, within) {
  let best = null;
  for (const b of bps) { const d = Math.abs(b.px - width); if (d <= within && (!best || d < best.d)) best = { d, px: b.px }; }
  return best ? { px: Math.round(best.px), snapped: true } : { px: Math.round(width), snapped: false };
}

export function createRuler(frame) {
  const el = document.createElement('div');
  el.className = 'cell-ruler'; el.dataset.nodrag = '1'; el.hidden = true;
  let bps = [];
  const paint = () => {
    // true scale; only the ticks that fit inside the frame and the gap beside it are drawn (the rest are in the breakpoints panel and the widths strip)
    const w = frame.width, reach = w + 90, shown = bps, beyond = bps.filter((b) => b.px > reach);
    el.hidden = !bps.length;
    if (!bps.length) { el.replaceChildren(); return; }
    el.style.width = `${reach}px`;
    const ticks = shown.map((b) => {
      const kind = [...b.kinds].map((k) => (k === 'max' ? 'and under' : 'and up')).join(' · ');
      return `<button type="button" class="rt${b.px > reach ? ' far' : ''}" tabindex="-1"${b.px > reach ? ' hidden' : ''} data-px="${Math.round(b.px)}" style="left:${b.px}px" title="${Math.round(b.px)} px: ${b.rules} @media rule${b.rules === 1 ? '' : 's'} (${kind}). Click to jump here."><i></i><span>${Math.round(b.px)}</span></button>`;
    }).join('');
    const more = beyond.length ? `<button type="button" class="rt-more" tabindex="-1" data-px="${Math.round(beyond[0].px)}" style="left:${reach}px" title="${beyond.map((b) => Math.round(b.px)).join(', ')} px: wider than this frame. Click to jump to ${Math.round(beyond[0].px)}.">${Math.round(beyond[0].px)} →</button>` : '';
    el.innerHTML = `${ticks}${more}<b class="now" style="left:${w}px"></b>`;
    for (const t of el.querySelectorAll('.rt')) t.classList.toggle('on', Math.abs(Number(t.dataset.px) - w) < 0.5);
  };
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const t = ev.target.closest('.rt, .rt-more');
    if (t) frame.commitWidth(Number(t.dataset.px));
  });
  return {
    el,
    update() { bps = breakpoints(frame.doc()); paint(); },
    points: () => bps,
    snap: (w, within) => snap(bps, w, within),
    say: (w, snapped) => { const t = describe(bps, w); el.querySelector('.now')?.style.setProperty('left', `${w}px`); for (const x of el.querySelectorAll('.rt')) x.classList.toggle('on', Math.abs(Number(x.dataset.px) - w) < 0.5); return snapped ? `${t} · snapped` : t; },
    paint,
  };
}

export function initWidths(ctx) {
  const frameOf = () => {
    const id = ctx.state.selection?.component ?? ctx.nav?.focused?.();
    return id ? ctx.stage.sections.get(id)?.docFrame ?? null : null;
  };
  const api = {
    target: frameOf,
    step(dir) {
      const f = frameOf();
      if (!f) { ctx.hint('Select an HTML or JSX component first'); return false; }
      const pts = f.ruler.points().map((b) => b.px), w = f.width;
      const next = dir > 0 ? pts.find((p) => p > w + 0.5) : [...pts].reverse().find((p) => p < w - 0.5);
      if (next === undefined) { ctx.hint(pts.length ? `No ${dir > 0 ? 'wider' : 'narrower'} breakpoint than ${Math.round(w)} px` : 'This file has no width breakpoints'); return false; }
      f.commitWidth(next);
      ctx.hint(`${Math.round(next)} px`);
      return true;
    },
    reset() { const f = frameOf(); if (!f) { ctx.hint('Select an HTML or JSX component first'); return false; } f.commitWidth(640); return true; },
  };
  ctx.widths = api;
  return api;
}
