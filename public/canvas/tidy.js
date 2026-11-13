// The opening arrangement of a folder's cards (lane b-polish): a tidy packed layout from the cards' real sizes, so the first view shows
// every card at the largest zoom that fits the canvas between the panels. Cards are grouped by what they are (pages, components,
// stylesheets, pictures, text), in rows with aligned tops (the frame tops; each row leaves room for its tallest label) and one gutter
// between them, in canvas units on the 4 px scale. A group starts a new row unless the whole group fits in what is left of the current one.
// Pure arithmetic: no DOM. The stage measures, this places.
//
//   tidyLayout(cards, { box, pad, gutter, origin, maxZ }) -> { at: Map(id -> { x, y }), width, bottom, z }
//     cards: [{ id, group, w, h, reserve(z) -> { top, w } }]   in order; reserve: the room the label takes above (top) and across (w) at zoom z
//     box: { width, height } of the canvas on screen; pad: screen px kept clear around the fit; origin: where the first row starts (x, y of its label top)
export const GUTTER = 32;

function rows(cards, W, gutter) {
  const out = [];
  let row = null, used = 0;
  const groupWidth = (i) => { let s = 0, g = cards[i].group; for (let k = i; k < cards.length && cards[k].group === g; k++) s += cards[k].rw + gutter; return s - gutter; };
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], startsGroup = i === 0 || cards[i - 1].group !== c.group;
    const room = W - used - (row?.length ? gutter : 0);
    const fresh = !row || !row.length || (startsGroup ? groupWidth(i) > room && c.rw <= W : c.rw > room);
    if (fresh) { if (row?.length) out.push(row); row = [c]; used = c.rw; } else { row.push(c); used += gutter + c.rw; }
  }
  if (row?.length) out.push(row);
  return out;
}

function place(cards, W, { gutter, origin }) {
  const at = new Map();
  let y = origin.y, width = 0;
  for (const row of rows(cards, W, gutter)) {
    const top = Math.max(...row.map((c) => c.top)), h = Math.max(...row.map((c) => c.h));
    let x = origin.x;
    for (const c of row) { at.set(c.id, { x, y: y + top }); x += c.rw + gutter; }
    width = Math.max(width, x - gutter - origin.x);
    y += top + h + gutter;
  }
  return { at, width, bottom: y - gutter, height: y - gutter - origin.y };
}

export function tidyLayout(list, { box, pad = 72, gutter = GUTTER, origin = { x: 0, y: 0 }, maxZ = 1, minZ = 1 / 16 } = {}) {
  if (!list.length) return { at: new Map(), width: 0, bottom: origin.y, z: maxZ };
  const fitZ = (w, h) => Math.max(minZ, Math.min(maxZ, (box.width - 2 * pad) / Math.max(1, w), (box.height - 2 * pad) / Math.max(1, h)));
  let z = maxZ, best = null;
  // the label's room depends on the zoom the layout is seen at, which depends on the layout: settle it in a few steps
  for (let step = 0; step < 12; step++) {
    const cards = list.map((c) => { const r = c.reserve(z); return { ...c, top: r.top, rw: Math.max(c.w, r.w) }; });
    const widest = Math.max(...cards.map((c) => c.rw)), total = cards.reduce((a, c) => a + c.rw + gutter, -gutter);
    best = null;
    // every row width from one card to all of them in one row, in small steps: the one that reads largest wins (ties, as when everything
    // fits at 100%: the one shaped most like the canvas)
    const shape = (p) => Math.abs(Math.log((p.width / Math.max(1, p.height)) / (box.width / Math.max(1, box.height))));
    for (let k = 0; k <= 64; k++) {
      const W = widest + (total - widest) * (k / 64);
      const p = place(cards, W, { gutter, origin });
      const pz = fitZ(p.width, p.height);
      if (!best || pz > best.z + 1e-6 || (pz > best.z - 1e-6 && shape(p) < best.shape - 1e-6)) best = { ...p, z: pz, shape: shape(p) };
    }
    if (Math.abs(best.z - z) < z * 0.001) break; // (relative: at 9% a step of 0.005 is a 5% bigger label)
    z = best.z;
  }
  return best;
}
