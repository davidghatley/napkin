// Small DOM geometry helpers shared by the panel and the canvas gestures. All sizes are in the component's own px (screen / zoom).
const px = (v) => parseFloat(v) || 0;
// The CSS `width` / `height` that gives an element this border-box size (a content-box element has padding and border on top).
export function cssSize(el, w, h) {
  const cs = getComputedStyle(el);
  if (cs.boxSizing === 'border-box') return { w, h };
  return { w: w - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth), h: h - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth) };
}
// An element's rectangle inside its parent's padding box, and the parent's padding-box size.
export function relRect(el, parentEl, z = 1) {
  const r = el.getBoundingClientRect(), p = parentEl.getBoundingClientRect();
  return { rect: { x: (r.left - p.left) / z - parentEl.clientLeft, y: (r.top - p.top) / z - parentEl.clientTop, w: r.width / z, h: r.height / z }, parent: { w: parentEl.clientWidth, h: parentEl.clientHeight } };
}
export const paddingOf = (el) => { const cs = getComputedStyle(el); return [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)]; };
