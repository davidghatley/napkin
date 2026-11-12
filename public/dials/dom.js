export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined) e.setAttribute(k, String(v));
  }
  for (const c of children.flat())
    if (c !== undefined && c !== null)
      e.append(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}
export const button = (text, label, action, cls = "") =>
  el(
    "button",
    {
      type: "button",
      class: cls,
      "aria-label": label,
      title: label,
      onclick: action,
    },
    text,
  );
export const heading = (title, note) =>
  el(
    "div",
    { class: "d-lab-head" },
    el("h3", { text: title }),
    el("span", { text: note || "" }),
  );
export function pointerSurface(node, { start, move, end, cancel }) {
  let active = false,
    pointerId;
  const doc = node.ownerDocument;
  const detach = () => {
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUp, true);
    doc.removeEventListener("pointercancel", onCancel, true);
  };
  const onCancel = () => {
    if (!active) return;
    active = false;
    detach();
    cancel?.();
  };
  const onMove = (e) => {
    if (!active || e.pointerId !== pointerId) return;
    if (!node.isConnected) {
      onCancel();
      return;
    }
    move(e);
  };
  const onUp = (e) => {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    detach();
    end?.(e);
  };
  const onDown = (e) => {
    if (e.button !== 0 || active) return;
    e.preventDefault();
    node.focus({ preventScroll: true });
    active = true;
    pointerId = e.pointerId;
    node.setPointerCapture(pointerId);
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("pointerup", onUp, true);
    doc.addEventListener("pointercancel", onCancel, true);
    start?.(e);
    move(e);
  };
  // Capture can be revoked while the button is still held (including focus/scroll changes).
  // The document listeners keep that gesture alive until its actual up or cancel event.
  node.addEventListener("pointerdown", onDown);
  return () => {
    onCancel();
    node.removeEventListener("pointerdown", onDown);
  };
}
const widthSetter = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "width",
  )?.set,
  heightSetter = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "height",
  )?.set;
/**
 * A plot keeps a fixed logical coordinate space (width x height) for drawing code,
 * while its backing store follows the device pixel ratio and the size it is shown at.
 * Whenever the backing store changes the canvas fires "d-resize" so its owner can redraw.
 */
export function canvas(label, width = 420, height = 230, interactive = true) {
  const c = el("canvas", {
    tabindex: interactive ? 0 : undefined,
    "aria-label": label,
    role: "img",
    class: interactive ? "d-plot" : "d-plot d-plot-passive",
  });
  const native = c.getContext.bind(c);
  let scale = Math.max(1, globalThis.devicePixelRatio || 1);
  const apply = () => {
    widthSetter.call(c, Math.round(width * scale));
    heightSetter.call(c, Math.round(height * scale));
  };
  apply();
  Object.defineProperties(c, {
    width: { get: () => width, configurable: true },
    height: { get: () => height, configurable: true },
  });
  c.style.aspectRatio = `${width} / ${height}`;
  c.getContext = (type, options) => {
    const g = native(type, options);
    if (type === "2d" && g) g.setTransform(scale, 0, 0, scale, 0, 0);
    return g;
  };
  // Drawing is skipped while a plot cannot be seen (collapsed, scrolled away, hidden by
  // content-visibility); it is redrawn from the same event once the plot comes into view.
  c.skipped = false;
  if (typeof IntersectionObserver === "function")
    new IntersectionObserver((entries) => {
      if (c.skipped && entries.some((e) => e.isIntersecting)) {
        c.skipped = false;
        c.dispatchEvent(new Event("d-resize"));
      }
    }).observe(c);
  if (typeof ResizeObserver === "function")
    new ResizeObserver(() => {
      const shown = c.clientWidth;
      if (!shown) return;
      const next = Math.min(
        4,
        Math.max(1, globalThis.devicePixelRatio || 1) *
          Math.max(1, shown / width),
      );
      if (Math.abs(next - scale) / scale < 0.08) return;
      scale = next;
      apply();
      c.dispatchEvent(new Event("d-resize"));
    }).observe(c);
  return c;
}
/** True when drawing to this plot would be seen. A plot that is not seen is flagged for redraw. */
export function visible(c) {
  const seen =
    c.isConnected &&
    c.getClientRects().length > 0 &&
    c.checkVisibility?.({ contentVisibilityAuto: true, visibilityProperty: true }) !== false &&
    c.getBoundingClientRect().bottom > -200 &&
    c.getBoundingClientRect().top < innerHeight + 200;
  c.skipped = !seen;
  return seen;
}
export function grid(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle =
    getComputedStyle(ctx.canvas).getPropertyValue("--d-line").trim() ||
    "#ccd0da";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    ctx.moveTo((i * w) / 10, 0);
    ctx.lineTo((i * w) / 10, h);
    ctx.moveTo(0, (i * h) / 10);
    ctx.lineTo(w, (i * h) / 10);
  }
  ctx.stroke();
}
