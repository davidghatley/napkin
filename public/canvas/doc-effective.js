// What an element really has, as the browser works it out (computed style), for the panel's fields: one value per property, the
// way a designer reads it (a padding of four equal sides is one value), and for several elements the shared value or Mixed.
const SIDES = { padding: ['top', 'right', 'bottom', 'left'].map((s) => `padding-${s}`), margin: ['top', 'right', 'bottom', 'left'].map((s) => `margin-${s}`),
  'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((s) => `border-${s}-radius`) };
// 1 to 4 values, the shortest that says the same thing (CSS order: top right bottom left)
function collapse(v) {
  const [t, r, b, l] = v;
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return v.join(' ');
}
export const TYPE_FIELDS = [['font-family', 'Font'], ['font-size', 'Size'], ['font-weight', 'Weight'], ['line-height', 'Line height'], ['text-align', 'Align'], ['color', 'Colour']];
export function valueOf(el, prop) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  if (SIDES[prop]) return collapse(SIDES[prop].map((p) => cs.getPropertyValue(p).trim()));
  return cs.getPropertyValue(prop).trim();
}
export function effective(els, prop) {
  const vals = els.map((e) => valueOf(e, prop));
  const mixed = new Set(vals).size > 1;
  return { mixed, value: mixed ? '' : vals[0] ?? '' };
}
