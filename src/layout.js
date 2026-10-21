// Layout rules shared by the design panel, the canvas gestures and the tests (LAY-02, LAY-03, LAY-04, LAY-06). Pure: no DOM, no Node.
// Every function returns a style patch { cssProp: value | null } (null removes the line) that the caller turns into `set` edits.

const str = (v) => (v === undefined || v === null ? '' : String(v));
export const isFlex = (s) => /flex/.test(str(s?.display));
export const isGrid = (s) => /grid/.test(str(s?.display));
export const isColumn = (s) => /^column/.test(str(s?.flexDirection));
// The size property that runs along a flex parent's main axis.
export const mainProp = (parent) => (isColumn(parent) ? 'height' : 'width');
const num = (v) => { const m = /^(-?\d*\.?\d+)(px)?$/.exec(str(v).trim()); return m ? Number(m[1]) : null; };
const growing = (s) => Number(s?.flexGrow) >= 1 || /^1(\s+1)?(\s+0(px|%)?)?$/.test(str(s?.flex).trim());

// ---- LAY-02: Hug / Fill / Fixed ------------------------------------------------------------------------------
// Hug  -> width: auto.
// Fill -> flex: 1 along a flex parent's main axis, alignSelf: stretch across it, 100% anywhere else (and for a root).
// Fixed-> a number of px.
export function sizeMode(style = {}, parent, prop) {
  const v = style[prop];
  if (parent && isFlex(parent)) {
    if (prop === mainProp(parent) ? growing(style) : style.alignSelf === 'stretch' && (v === undefined || v === 'auto')) return 'fill';
  }
  if (v === '100%') return 'fill';
  if (v === undefined || v === 'auto' || v === 'fit-content' || v === 'max-content') return 'hug';
  return num(v) !== null ? 'fixed' : 'custom';
}
export function sizePatch(style = {}, parent, prop, mode, px = 100) {
  const patch = {};
  const flexParent = !!parent && isFlex(parent);
  const main = flexParent && prop === mainProp(parent);
  // leave a Fill that is spelt another way
  if (main && style.flex !== undefined) patch.flex = null;
  if (main && style.flexGrow !== undefined) patch.flexGrow = null;
  if (flexParent && !main && style.alignSelf === 'stretch') patch.alignSelf = null;
  if (mode === 'hug') patch[prop] = 'auto';
  else if (mode === 'fixed') patch[prop] = Math.round(px);
  else if (mode === 'fill') {
    const drop = style[prop] === undefined ? {} : { [prop]: null };
    if (main) Object.assign(patch, { flex: 1 }, drop, style.flexGrow !== undefined ? { flexGrow: null } : {});
    else if (flexParent) Object.assign(patch, { alignSelf: 'stretch' }, drop);
    else patch[prop] = '100%';
  }
  return patch;
}

// ---- LAY-04: pins for absolute children ---------------------------------------------------------------------
// Per axis: 'min' (left/top), 'max' (right/bottom), 'both' (stretch), 'center'.
// A rect is { x, y, w, h } of the child inside the parent's padding box; parent is { w, h }.
export const PIN_H = ['min', 'max', 'both', 'center'];
export function pinPatch(pins, rect, parent, style = {}) {
  const { h = 'min', v = 'min' } = pins;
  const patch = { position: 'absolute' };
  const r = Math.round;
  const axis = (mode, a, size, p, lo, hi, dim) => {
    if (mode === 'min') { patch[lo] = r(a); patch[hi] = null; patch[dim] = r(size); }
    else if (mode === 'max') { patch[hi] = r(p - a - size); patch[lo] = null; patch[dim] = r(size); }
    else if (mode === 'both') { patch[lo] = r(a); patch[hi] = r(p - a - size); patch[dim] = null; }
    else { const off = r(a + size / 2 - p / 2); patch[lo] = off ? `calc(50% + ${off}px)` : '50%'; patch[hi] = null; patch[dim] = r(size); }
  };
  axis(h, rect.x, rect.w, parent.w, 'left', 'right', 'width');
  axis(v, rect.y, rect.h, parent.h, 'top', 'bottom', 'height');
  patch.transform = h === 'center' && v === 'center' ? 'translate(-50%, -50%)' : h === 'center' ? 'translateX(-50%)' : v === 'center' ? 'translateY(-50%)' : null;
  if (patch.transform === null && style.transform === undefined) delete patch.transform;
  for (const k of Object.keys(patch)) if (patch[k] === null && style[k] === undefined) delete patch[k];
  return patch;
}
// Which pins a style has (for the panel).
export function pinsOf(style = {}) {
  const set = (k) => style[k] !== undefined && style[k] !== 'auto';
  const centre = (k) => /^(50%|calc\(50%)/.test(str(style[k]));
  const axis = (lo, hi) => (centre(lo) ? 'center' : set(lo) && set(hi) ? 'both' : set(hi) ? 'max' : 'min');
  return { h: axis('left', 'right'), v: axis('top', 'bottom') };
}

// ---- LAY-03: grid ---------------------------------------------------------------------------------------------
export const tracks = (v) => { const out = []; let d = 0, cur = ''; for (const ch of str(v)) { if (ch === '(') d++; if (ch === ')') d--; if (d === 0 && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
export const trackText = (list) => list.join(' ');
// Which 1-based cell (col, row) a point falls in, from the resolved track sizes in px (computed style) and the gap.
export function cellAt(cols, rows, gapX, gapY, x, y) {
  const find = (sizes, gap, p) => { let at = 0; for (let i = 0; i < sizes.length; i++) { const end = at + sizes[i]; if (p < end + gap / 2 || i === sizes.length - 1) return i + 1; at = end + gap; } return 1; };
  return { col: find(cols, gapX, x), row: find(rows, gapY, y) };
}
// A placement is ONE line: gridArea "row / col" (row start / column start). A hand-written gridColumn / gridRow is edited in place instead.
export function placePatch(style = {}, col, row) {
  if (style.gridColumn !== undefined || style.gridRow !== undefined) return { gridColumn: String(col), gridRow: String(row) };
  return { gridArea: `${row} / ${col}` };
}
export function placementOf(style = {}) {
  const n = (v) => { const m = /^\s*(\d+)/.exec(str(v)); return m ? Number(m[1]) : null; };
  if (style.gridArea !== undefined) { const [r, c] = str(style.gridArea).split('/'); return { col: n(c), row: n(r) }; }
  return { col: n(style.gridColumn), row: n(style.gridRow) };
}

// ---- LAY-06: snapping -----------------------------------------------------------------------------------------
// moving: { x, y, w, h } in canvas px. targets: [{ x, y, w, h, kind: 'sibling'|'parent' }]. threshold: canvas px (4 screen px / zoom).
// grid: 4 or 8 (or 0 = off). Returns { dx, dy, guides: [{ axis: 'x'|'y', at, from, to, kind }] } : add dx, dy to the moving rect.
export function snap(moving, targets, { threshold = 4, grid = 0, edges = ['l', 'c', 'r', 't', 'm', 'b'] } = {}) {
  const lines = (r) => ({ x: [r.x, r.x + r.w / 2, r.x + r.w], y: [r.y, r.y + r.h / 2, r.y + r.h] });
  const mine = lines(moving), res = { dx: 0, dy: 0, guides: [] };
  const best = { x: null, y: null };
  for (const axis of ['x', 'y']) {
    const use = axis === 'x' ? edges.filter((e) => 'lcr'.includes(e)) : edges.filter((e) => 'tmb'.includes(e));
    mine[axis].forEach((m, i) => {
      if (!use.includes((axis === 'x' ? 'lcr' : 'tmb')[i])) return;
      for (const t of targets) {
        const tl = lines(t)[axis];
        tl.forEach((v) => {
          const d = v - m;
          if (Math.abs(d) <= threshold && (best[axis] === null || Math.abs(d) < Math.abs(best[axis].d) - 1e-9)) best[axis] = { d, v, t, kind: t.kind };
        });
      }
    });
    if (best[axis] === null && grid) {
      const m = mine[axis][0], g = Math.round(m / grid) * grid, d = g - m;
      if (Math.abs(d) <= threshold) best[axis] = { d, v: g, t: null, kind: 'grid' };
    }
  }
  if (best.x) res.dx = best.x.d;
  if (best.y) res.dy = best.y.d;
  const after = { x: moving.x + res.dx, y: moving.y + res.dy, w: moving.w, h: moving.h };
  for (const axis of ['x', 'y']) {
    const b = best[axis];
    if (!b) continue;
    const spans = [after, ...(b.t ? targets.filter((t) => lines(t)[axis].some((v) => Math.abs(v - b.v) < 0.5)) : [])];
    const o = axis === 'x' ? 'y' : 'x', od = axis === 'x' ? 'h' : 'w';
    res.guides.push({ axis, at: b.v, from: Math.min(...spans.map((r) => r[o])), to: Math.max(...spans.map((r) => r[o] + r[od])), kind: b.kind });
  }
  return res;
}
// Shift constrains a drag to the dominant axis.
export const constrain = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy]);
