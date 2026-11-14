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
    el("h3", { text: title, title: note || undefined }),
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
    // A text field inside a surface keeps its own pointer (caret, selection).
    if (e.target !== node && e.target.closest?.("input, textarea")) return;
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
/**
 * A drawn replacement for the browser select. Few short options become a segmented control;
 * the rest become a button that opens a listbox. `node.value` reads and sets the choice.
 */
export function choiceBox(label, options, change, { none } = {}) {
  const list = options.map((o) =>
    typeof o === "object" ? o : { value: o, text: String(o) },
  );
  if (none !== undefined) list.unshift({ value: "", text: none });
  const root = el("div", { class: "d-choice", role: "group", "aria-label": label });
  let current = list[0]?.value ?? "";
  let mixed = false; // several items selected whose values differ: no choice is shown as made, and any choice sets them all
  const label_ = (v) => (mixed ? "Mixed" : list.find((o) => o.value === v)?.text ?? String(v));
  const segmented =
    list.length <= 4 && list.reduce((n, o) => n + o.text.length, 0) <= 26;
  const pick = (v, emit) => {
    if (v === current && emit && !mixed) return;
    if (emit) mixed = false;
    current = v;
    paint();
    if (emit) change(v);
  };
  let paint;
  if (segmented) {
    const buttons = list.map((o) =>
      el("button", {
        type: "button",
        text: o.text,
        "aria-pressed": "false",
        onclick: () => pick(o.value, true),
      }),
    );
    root.classList.add("d-choice-seg");
    root.append(...buttons);
    paint = () =>
      buttons.forEach((b, i) =>
        b.setAttribute("aria-pressed", String(!mixed && list[i].value === current)),
      );
    root.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const i = list.findIndex((o) => o.value === current),
        n = Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
      pick(list[n].value, true);
      buttons[n].focus();
    });
  } else {
    const trigger = el("button", {
        type: "button",
        class: "d-choice-trigger",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
      }),
      pop = el("div", { class: "d-choice-pop", role: "listbox", "aria-label": label, hidden: "" }),
      items = [];
    const build = () => {
      if (items.length) return;
      for (const o of list)
        items.push(
          el("div", {
            role: "option",
            tabindex: "-1",
            class: "d-choice-item",
            text: o.text,
            "data-value": o.value,
          }),
        );
      pop.append(...items);
    };
    root.append(trigger);
    const close = (focus) => {
      pop.hidden = true;
      pop.remove();
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      if (focus) trigger.focus();
    };
    const outside = (e) => {
      if (!root.contains(e.target) && !pop.contains(e.target)) close(false); // a click on an option is the list's own
    };
    const open = () => {
      build();
      paint();
      const r = trigger.getBoundingClientRect();
      (root.closest(".dials") || document.body).append(pop);
      pop.hidden = false;
      pop.style.minWidth = `${r.width}px`;
      const below = innerHeight - r.bottom > Math.min(220, pop.offsetHeight + 8);
      pop.style.left = `${r.left}px`;
      pop.style.top = below ? `${r.bottom + 2}px` : "";
      pop.style.bottom = below ? "" : `${innerHeight - r.top + 2}px`;
      trigger.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside, true);
      (items.find((i) => i.dataset.value === String(current)) || items[0])?.focus();
    };
    trigger.addEventListener("click", () => (pop.hidden ? open() : close(true)));
    trigger.addEventListener("keydown", (e) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key) && pop.hidden) {
        e.preventDefault();
        open();
      }
    });
    pop.addEventListener("click", (e) => {
      const item = e.target.closest("[role=option]");
      if (!item) return;
      pick(list.find((o) => String(o.value) === item.dataset.value).value, true);
      close(true);
    });
    pop.addEventListener("keydown", (e) => {
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") items[Math.min(items.length - 1, i + 1)].focus();
      else if (e.key === "ArrowUp") items[Math.max(0, i - 1)].focus();
      else if (e.key === "Home") items[0].focus();
      else if (e.key === "End") items.at(-1).focus();
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        document.activeElement.click();
        return;
      } else if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") e.stopPropagation();
        close(e.key === "Escape");
        return;
      } else return;
      e.preventDefault();
    });
    paint = () => {
      trigger.textContent = label_(current);
      trigger.title = `${label}: ${label_(current)}`;
      trigger.setAttribute("aria-label", `${label}: ${label_(current)}`);
      items.forEach((i) =>
        i.setAttribute("aria-selected", String(!mixed && i.dataset.value === String(current))),
      );
    };
  }
  Object.defineProperty(root, "mixed", {
    get: () => mixed,
    set: (m) => {
      if (mixed === !!m) return;
      mixed = !!m;
      root.toggleAttribute("data-mixed", mixed);
      paint();
    },
  });
  Object.defineProperty(root, "value", {
    get: () => current,
    set: (v) => {
      if (v !== current && list.some((o) => o.value === v)) pick(v, false);
    },
  });
  paint();
  return root;
}
/** A drawn file chooser that also takes a dropped file. */
export function filePick(label, accept, onFile, hint = "or drop one here", inputLabel = label) {
  const input = el("input", {
      type: "file",
      accept,
      tabindex: "-1",
      "aria-label": inputLabel,
      class: "d-sr",
    }),
    status = el("span", { class: "d-drop-hint", text: hint }),
    trigger = button(label, label, () => input.click(), "d-drop-button"),
    root = el("div", { class: "d-drop" }, trigger, status, input);
  const take = (file) => {
    if (!file) return;
    status.textContent = file.name;
    onFile(file);
  };
  input.addEventListener("change", () => take(input.files[0]));
  root.addEventListener("dragover", (e) => {
    e.preventDefault();
    root.classList.add("is-over");
  });
  root.addEventListener("dragleave", () => root.classList.remove("is-over"));
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    root.classList.remove("is-over");
    take(e.dataTransfer?.files?.[0]);
  });
  root.status = status;
  return root;
}
