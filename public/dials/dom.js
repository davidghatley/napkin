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
export function canvas(label, width = 420, height = 230) {
  return el("canvas", {
    width,
    height,
    tabindex: 0,
    "aria-label": label,
    role: "img",
    class: "d-plot",
  });
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
