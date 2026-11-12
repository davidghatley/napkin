import {
  clone,
  same,
  clamp,
  expression,
  format,
  parse,
  numeric,
  scrubLimits,
  quantize,
  validateSchema,
  validateValue,
} from "./values.js";
import { parseColor, cssLch } from "./color.js";
import { drawFigure } from "./figures.js";
import { el, button, pointerSurface } from "./dom.js";
import { createStudio } from "./studios.js";
const controls = new Map(),
  figures = new Map();
let serial = 0;
export function registerControl(type, plugin) {
  if (!type || typeof plugin?.mount !== "function")
    throw new Error("A control plugin needs mount(context)");
  controls.set(type, plugin);
  return () => controls.delete(type);
}
export function registerFigure(type, draw) {
  if (typeof draw !== "function")
    throw new Error("A figure plugin needs a drawing function");
  figures.set(type, draw);
  return () => figures.delete(type);
}
export const defaultKeys = {
  increase: ["ArrowRight", "ArrowUp", "l", "k"],
  decrease: ["ArrowLeft", "ArrowDown", "h", "j"],
  reset: ["r", "R"],
  studio: ["s"],
  help: ["?"],
};
const keyBindings = (keys) => [
  ["Tab / Shift Tab", "Move between instruments"],
  ["Enter", "Edit a value / open a section"],
  [
    [...keys.increase, ...keys.decrease].join(" / "),
    "Change a focused label or figure",
  ],
  ["3 then l", "Change by a count (on a label)"],
  ["Shift / Alt", "Fine / coarse adjustment"],
  ["Home / End", "Minimum / maximum"],
  ["Arrows on Size", "Resize the studio pane; Shift for larger steps"],
  [
    keys.reset.join(" / ") + " / double-click label",
    "Reset to the declared default",
  ],
  [
    keys.studio.join(" / ") + " / Enter on figure",
    "Open this control in the studio",
  ],
  ["Ctrl C / Ctrl V", "Copy / paste a value (on a label)"],
  ["Ctrl K", "Find any control, or change a section's depth"],
  ["Ctrl Z / Ctrl Shift Z", "Undo / redo"],
  ["1 / 2 / 3", "Dial / bench / studio (on section depth buttons)"],
  ["Escape", "Cancel edit / leave studio"],
  [keys.help.join(" / "), "Show this key map"],
];
export const bindings = keyBindings(defaultKeys);
export function render(schema, container, options = {}) {
  return new Dials(container, options).render(schema);
}
export class Dials extends EventTarget {
  constructor(container, options = {}) {
    super();
    if (!(container instanceof Element))
      throw new Error("Dials needs a container element");
    this.container = container;
    this.options = options;
    this.keys = { ...defaultKeys, ...options.keys };
    this.gestures = [];
    this.rows = new Map();
    this.sections = new Map();
    this.active = new Map();
    this.history = [];
    this.future = [];
    this.pending = new Map();
    this.disposed = false;
    this.root = el("div", {
      class: "dials",
      "data-studio-mode": options.studio === "viewport" ? "viewport" : "inline",
      "aria-label": options.label || "Instruments",
    });
    if (options.theme) this.root.dataset.theme = options.theme;
    this.status = el("div", {
      class: "d-sr",
      "aria-live": "polite",
      role: "status",
    });
    this.root.append(this.status);
    container.append(this.root);
    this.root.addEventListener("keydown", (e) => this.keydown(e));
    this.root.addEventListener("copy", (e) => {
      const row = this.rowAt(e.target);
      if (row && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        e.clipboardData.setData("text/plain", format(row.c.value, row.c));
      }
    });
    this.root.addEventListener("paste", (e) => {
      const row = this.rowAt(e.target);
      if (row && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        this.fromText(row.c.id, e.clipboardData.getData("text/plain"));
      }
    });
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    if (type === "value") this.options.onChange?.(detail);
  }
  rowAt(target) {
    return this.rows.get(target.closest("[data-control]")?.dataset.control);
  }
  announce(message) {
    this.status.textContent = message;
  }
  render(schema) {
    validateSchema(schema);
    const next = clone(schema);
    for (const s of next.sections)
      for (const c of s.controls)
        if (c.type === "color") {
          parseColor(c.value, this.root);
          if (c.default !== undefined) parseColor(c.default, this.root);
        }
    this.gestures.forEach((dispose) => dispose());
    this.gestures = [];
    for (const id of [...this.active.keys()]) this.cancel(id);
    this.sections.forEach((s) => {
      cancelAnimationFrame(s.depthFrame);
      s.animation?.cancel();
      s.lab?.destroy?.();
    });
    this.rows.forEach((r) => r.plugin?.destroy?.());
    this.rows.clear();
    this.sections.clear();
    this.history = [];
    this.future = [];
    this.schema = next;
    this.revision = next.revision;
    this.root.replaceChildren(this.status);
    const fragment = document.createDocumentFragment();
    for (const section of next.sections) {
      const node = el("section", {
        class: "d-section",
        "data-section": section.id,
        "aria-label": section.label || section.id,
      });
      const first = section.controls[0],
        fig = el("span", { class: "d-figure d-summary-figure" }),
        summary = el("span", { class: "d-summary" });
      const toggle = button(
        section.label || section.id,
        `Open ${section.label || section.id}`,
        () => this.setDepth(section.id, s.depth === 1 ? 2 : 1),
        "d-section-name",
      );
      const depth = el("div", {
        class: "d-depth",
        role: "group",
        "aria-label": `${section.label} depth`,
      });
      const buttons = ["Dial", "Bench", "Studio"].map((name, i) =>
        button(name, `${section.label}: ${name}`, () =>
          this.setDepth(section.id, i + 1),
        ),
      );
      depth.append(...buttons);
      const resize = button(
        "Size",
        "Resize studio pane with arrow keys; click for compact size",
        () =>
          this.resizeStudio(
            section.id,
            Math.min(800, s.node.parentElement.clientWidth),
            640,
          ),
        "d-pane-size d-studio-only",
      );
      const head = el(
        "header",
        { class: "d-section-head" },
        toggle,
        fig,
        summary,
        resize,
        depth,
      );
      const body = el("div", { class: "d-section-inner" }),
        content = el("div", { class: "d-section-content" }),
        rowlist = el("div", { class: "d-rows" }),
        labHost = el("div", { class: "d-lab" });
      const tabs = el("div", {
        class: "d-studio-tabs d-studio-only",
        role: "group",
        "aria-label": section.label + " studio instrument",
      });
      tabs.append(
        ...section.controls.map((c) =>
          button(c.label || c.id, "Open " + (c.label || c.id) + " studio", () =>
            this.open(c.id),
          ),
        ),
      );
      body.append(content);
      content.append(rowlist, labHost);
      node.append(head, tabs, body);
      const s = {
        schema: section,
        node,
        head,
        toggle,
        fig,
        summary,
        buttons,
        resize,
        body,
        content,
        rowlist,
        labHost,
        tabs,
        studioControl: first?.id,
        depth: 0,
      };
      this.sections.set(section.id, s);
      if (first) {
        this.scrub(toggle, first.id);
        toggle.addEventListener("dblclick", () => this.reset(first.id));
      }
      for (const c of section.controls) {
        c.default = clone(c.default ?? c.value);
        const row = this.makeRow(c, s);
        rowlist.append(row.node);
      }
      this.buildStudio(
        s,
        section.controls.find((c) => c.type === section.studio)?.id ||
          first?.id,
        false,
      );
      fragment.append(node);
      this.setDepth(section.id, section.depth || 2, false);
    }
    this.root.append(fragment);
    // Finish row mutations before studios read computed styles and draw their previews.
    for (const row of this.rows.values()) this.paint(row.c.id, false);
    for (const s of this.sections.values()) s.lab?.update?.();
    this.emit("render", { revision: this.revision });
    return this;
  }
  makeRow(c, section) {
    const uid = `d-${++serial}`;
    const reset = button(
      "",
      "Reset " + c.label,
      () => this.reset(c.id),
      "d-reset",
    );
    const label = button(
      c.label || c.id,
      `${c.label || c.id}: adjust with arrows; Enter to type`,
      () =>
        (
          input?.querySelector?.('[role="radio"][tabindex="0"]') || input
        )?.focus(),
      "d-label",
    );
    label.id = uid;
    const fig = el("span", {
      class: "d-figure",
      tabindex: 0,
      role: "button",
      "aria-label": `${c.label || c.id} live figure; arrows adjust, Enter opens studio`,
    });
    const node = el("div", {
      class: "d-row",
      "data-control": c.id,
      "data-min-depth": c.depth || 1,
      title: c.description || "",
    });
    const wrap = el("div", { class: "d-value" });
    let input, plugin;
    const context = this.context(c.id, c);
    if (controls.has(c.type)) {
      plugin = controls.get(c.type).mount(context);
      wrap.append(plugin.element);
    } else if (c.type === "boolean") {
      input = button(
        c.value ? "On" : "Off",
        c.label,
        () => this.transact(c.id, !c.value),
        "d-toggle",
      );
      input.setAttribute("role", "switch");
    } else if (c.type === "segmented") {
      input = el("div", {
        class: "d-segmented",
        role: "radiogroup",
        "aria-labelledby": uid,
      });
      for (const option of c.options || []) {
        const value = typeof option === "object" ? option.value : option;
        const b = button(
          typeof option === "object" ? option.label : String(option),
          `${c.label}: ${typeof option === "object" ? option.label : option}`,
          () => this.transact(c.id, value),
        );
        b.setAttribute("role", "radio");
        input.append(b);
      }
    } else if (c.type === "select") {
      input = el("select", { "aria-labelledby": uid });
      (c.options || []).forEach((o, i) =>
        input.append(
          el("option", { value: i, text: typeof o === "object" ? o.label : o }),
        ),
      );
      input.addEventListener("change", () => {
        const o = c.options[Number(input.value)];
        this.transact(c.id, typeof o === "object" ? o.value : o);
      });
    } else {
      input = el("input", {
        type: "text",
        "aria-labelledby": uid,
        spellcheck: false,
        autocomplete: "off",
        value: format(c.value, c),
      });
      input.addEventListener("focus", () => {
        input.value = format(c.value, c);
        this.begin(c.id, "entry");
      });
      input.addEventListener("input", () => {
        try {
          const v = this.parse(input.value, c);
          this.change(c.id, v);
          input.removeAttribute("aria-invalid");
          input.setCustomValidity("");
        } catch (error) {
          input.setAttribute("aria-invalid", "true");
          input.setCustomValidity(error.message);
          this.announce(error.message);
        }
      });
      input.addEventListener("blur", () => {
        if (input.getAttribute("aria-invalid")) {
          this.cancel(c.id);
          input.value = format(c.value, c);
          input.removeAttribute("aria-invalid");
          input.setCustomValidity("");
        } else this.commit(c.id);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          try {
            this.change(c.id, this.parse(input.value, c));
            this.commit(c.id);
            input.value = format(c.value, c);
            input.removeAttribute("aria-invalid");
            input.setCustomValidity("");
            this.announce(`${c.label}: ${input.value}`);
          } catch (err) {
            this.announce(err.message);
            input.setAttribute("aria-invalid", "true");
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.cancel(c.id);
          input.value = format(c.value, c);
          input.removeAttribute("aria-invalid");
          input.setCustomValidity("");
          label.focus();
        }
        if (numeric(c) && ["ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          this.adjust(c.id, e.key === "ArrowUp" ? 1 : -1, e);
        }
      });
    }
    if (input) wrap.append(input);
    node.append(reset, label, fig, wrap);
    const row = { c, section, node, label, fig, input, plugin, context };
    this.rows.set(c.id, row);
    this.scrub(label, c.id);
    this.scrub(fig, c.id);
    label.addEventListener("dblclick", () => this.reset(c.id));
    if (c.disabled) {
      node.inert = true;
      node.setAttribute("aria-disabled", "true");
    }
    return row;
  }
  parse(text, c) {
    const v = parse(text, c);
    if (c.type === "color") parseColor(v, this.root);
    return v;
  }
  context(id, c = this.rows.get(id)?.c) {
    return {
      control: c,
      host: this.root,
      get: () => clone(this.rows.get(id)?.c.value ?? c.value),
      begin: (source = "plugin") => this.begin(id, source),
      change: (v) => this.change(id, v),
      commit: () => this.commit(id),
      cancel: () => this.cancel(id),
      isEditing: () => this.active.has(id),
      set: (v) => this.transact(id, v),
      subscribe: (fn) => {
        const cb = (e) => {
          if (e.detail.control === id) fn(this.get(id));
        };
        this.addEventListener("paint", cb);
        return () => this.removeEventListener("paint", cb);
      },
    };
  }
  get(id) {
    return clone(this.rows.get(id)?.c.value);
  }
  values() {
    return Object.fromEntries(
      [...this.rows].map(([id, r]) => [id, clone(r.c.value)]),
    );
  }
  begin(id, source = "pointer") {
    const r = this.rows.get(id);
    if (!r || r.c.disabled || this.active.has(id)) return;
    const edit = {
      before: clone(r.c.value),
      source,
      revision: this.revision,
      transaction: `dials-${++serial}`,
    };
    this.active.set(id, edit);
    this.event(id, "begin", edit);
  }
  change(id, value) {
    const r = this.rows.get(id);
    if (!r || r.c.disabled) return;
    validateValue(value, r.c);
    if (r.c.type === "color") parseColor(value, this.root);
    if (!this.active.has(id)) this.begin(id);
    r.c.value = clone(value);
    this.paint(id);
    this.event(id, "change", this.active.get(id));
  }
  commit(id) {
    const edit = this.active.get(id);
    if (!edit) return;
    const after = this.get(id);
    this.active.delete(id);
    if (!same(edit.before, after) && this.options.history !== false) {
      this.history.push({ id, before: edit.before, after });
      if (this.history.length > 200) this.history.shift();
      this.future = [];
    }
    this.event(id, "commit", edit);
    this.reconcile(id, edit, after);
    this.paint(id);
  }
  cancel(id) {
    const edit = this.active.get(id);
    if (!edit) return;
    this.rows.get(id).c.value = clone(edit.before);
    this.active.delete(id);
    this.paint(id);
    this.event(id, "cancel", edit);
    this.reconcile(id, edit, this.get(id));
  }
  event(id, phase, edit) {
    if (!edit) return;
    this.emit("value", {
      control: id,
      value: this.get(id),
      previous: clone(edit.before),
      phase,
      source: edit.source,
      transaction: edit.transaction,
      baseRevision: edit.revision,
    });
  }
  reconcile(id, edit, local) {
    if (!this.pending.has(id)) return;
    const remote = this.pending.get(id);
    this.pending.delete(id);
    if (!same(local, remote.value))
      this.emit("conflict", {
        control: id,
        local,
        remote: clone(remote.value),
        baseRevision: edit.revision,
        revision: remote.revision,
      });
    this.rows.get(id).c.value = clone(remote.value);
    // A local undo must never resurrect a value over a newer external writer.
    this.history = this.history.filter((entry) => entry.id !== id);
    this.future = this.future.filter((entry) => entry.id !== id);
    this.paint(id);
  }
  transact(id, value, source = "keyboard") {
    this.begin(id, source);
    try {
      this.change(id, value);
      this.commit(id);
    } catch (e) {
      this.cancel(id);
      throw e;
    }
  }
  update(values, { revision = this.revision } = {}) {
    for (const [id, v] of Object.entries(values)) {
      const r = this.rows.get(id);
      if (!r) throw new Error(`Unknown control ${id}`);
      validateValue(v, r.c);
      if (r.c.type === "color") parseColor(v, this.root);
    }
    this.revision = revision;
    this.schema.revision = revision;
    const labs = new Set();
    for (const [id, value] of Object.entries(values)) {
      if (this.active.has(id))
        this.pending.set(id, { value: clone(value), revision });
      else {
        this.rows.get(id).c.value = clone(value);
        this.paint(id, false);
        const s = this.rows.get(id).section;
        if (s.studioControl === id) labs.add(s);
      }
    }
    labs.forEach((s) => s.lab?.update?.());
    return this;
  }
  paint(id, updateStudio = true) {
    const r = this.rows.get(id);
    if (!r) return;
    const { c, input } = r;
    r.node.classList.toggle("is-modified", !same(c.value, c.default));
    r.node.classList.toggle("is-editing", this.active.has(id));
    r.label.setAttribute(
      "aria-description",
      `${format(c.value, c)}. ${c.description || "Drag to adjust. Shift fine; Alt coarse."}`,
    );
    r.label.setAttribute("aria-disabled", String(!!c.disabled));
    r.node.querySelector(".d-reset").title =
      `Reset ${c.label} to ${format(c.default, c)}`;
    if (input && (input !== document.activeElement || !this.active.has(id))) {
      if (input.tagName === "INPUT")
        input.value =
          input !== document.activeElement &&
          typeof c.value === "string" &&
          ["gradient", "asset", "file"].includes(c.type)
            ? this.summary(c)
            : input !== document.activeElement &&
                c.value &&
          typeof c.value === "object" &&
          !Array.isArray(c.value)
            ? this.summary(c)
            : format(c.value, c);
      else if (input.tagName === "SELECT")
        input.value = (c.options || []).findIndex((o) =>
          same(typeof o === "object" ? o.value : o, c.value),
        );
    }
    if (input?.getAttribute("role") === "switch") {
      input.textContent = c.value ? "On" : "Off";
      input.setAttribute("aria-checked", String(c.value));
    }
    if (input?.getAttribute("role") === "radiogroup") {
      [...input.children].forEach((b, i) => {
        const option = c.options[i],
          selected = same(
            typeof option === "object" ? option.value : option,
            c.value,
          );
        b.setAttribute("aria-checked", String(selected));
        b.tabIndex = selected ? 0 : -1;
      });
    }
    r.plugin?.update?.(clone(c.value));
    const key = typeof c.figure === "string" ? c.figure : c.figure?.type,
      draw = figures.get(key);
    if (draw) draw(r.fig, c, clone(c.value));
    else drawFigure(r.fig, c, c.value);
    const s = r.section;
    if (s.schema.controls[0] === c) {
      drawFigure(s.fig, c, c.value);
      s.summary.textContent = this.summary(c);
    }
    if (updateStudio && s.studioControl === id) s.lab?.update?.();
    this.emit("paint", { control: id, value: clone(c.value) });
  }
  summary(c) {
    const v = c.value;
    if (typeof v === "object") {
      if (["motion", "bezier", "spring"].includes(c.type))
        return `${v.mode === "spring" ? "Spring" : "Bezier"} · ${v.duration || 1000}ms`;
      if (c.type === "typography") return `${v.size}px / ${v.weight}`;
      if (c.type === "shadow") return `${v.x} / ${v.y} / ${v.blur}px`;
      if (c.type === "sampler") return `${v.steps} steps · ${v.scheduler}`;
      if (c.type === "image") return `γ ${v.gamma || 1}`;
      if (c.type === "encoding") return `${v.x || "—"} × ${v.y || "—"}`;
    }
    if (typeof v === "string" && c.type === "gradient") {
      const parts = [];
      let depth = 0,
        cur = "";
      for (const ch of v.slice(v.indexOf("(") + 1, v.lastIndexOf(")"))) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && !depth) {
          parts.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      parts.push(cur.trim());
      const first = parts[0] || "",
        direction = /^(-?[\d.]+(?:deg|turn|rad)|to [a-z ]+|circle|ellipse)/.test(first);
      return `${/^([a-z-]+)-gradient/.exec(v)?.[1] || "gradient"} ${direction ? first.split(" ")[0] + " " : ""}· ${parts.length - (direction ? 1 : 0)} stops`;
    }
    if (typeof v === "string" && ["asset", "file"].includes(c.type))
      return v.split(/[\\/]/).pop() || v;
    return format(v, c).slice(0, 38);
  }
  buildStudio(s, id, update = true) {
    s.lab?.destroy?.();
    s.labHost.replaceChildren();
    s.studioControl = id;
    const c = s.schema.controls.find((c) => c.id === id),
      plugin = c && controls.get(c.type);
    s.lab = plugin?.studio
      ? plugin.studio({ ...this.context(id), panel: this }, s.labHost)
      : createStudio(this, { ...s.schema, studioControl: id }, s.labHost);
    [...s.tabs.children].forEach((b, i) =>
      b.setAttribute("aria-pressed", String(s.schema.controls[i].id === id)),
    );
    s.labHost.inert = !!c?.disabled;
    if (update) s.lab?.update?.();
  }
  open(id, depth = 3) {
    const r = this.rows.get(id);
    if (!r) throw new Error("Unknown control " + id);
    const s = r.section;
    if (s.studioControl !== id) this.buildStudio(s, id);
    this.setDepth(s.schema.id, depth);
    return this;
  }
  reset(id) {
    const r = this.rows.get(id);
    this.transact(id, clone(r.c.default), "reset");
    this.announce(`${r.c.label} reset`);
  }
  fromText(id, text) {
    try {
      this.transact(id, this.parse(text, this.rows.get(id).c), "paste");
      this.announce("Value pasted");
    } catch (e) {
      this.announce(e.message);
    }
  }
  adjust(id, dir, event = {}, count = 1, base) {
    const r = this.rows.get(id),
      c = r.c,
      v = clone(base ?? c.value),
      factor = (event.shiftKey ? 0.1 : 1) * (event.altKey ? 10 : 1) * count;
    let result = v;
    if (numeric(c) || typeof v === "number")
      result = quantize(v + dir * (c.step || 1) * factor, {
        ...c,
        step: event.shiftKey ? (c.step || 1) / 10 : c.step,
      });
    else if (c.type === "boolean") result = !v;
    else if (["select", "segmented"].includes(c.type)) {
      const opts = c.options.map((o) => (typeof o === "object" ? o.value : o)),
        i = opts.findIndex((o) => same(o, v));
      result = opts[clamp(i + dir * count, 0, opts.length - 1)];
    } else if (c.type === "color") {
      const lch = parseColor(v, this.root);
      lch[0] = clamp(lch[0] + dir * 0.01 * factor, 0, 1);
      result = cssLch(lch);
    } else if (Array.isArray(v))
      result = v.map((n, i) =>
        i === 0
          ? Number(
              clamp(
                n + dir * (c.step || 1) * factor,
                c.min ?? (c.type === "spacing" ? 0 : -Infinity),
                c.max,
              ).toFixed(5),
            )
          : n,
      );
    else if (v && typeof v === "object") {
      const key =
        c.scrub || Object.keys(v).find((k) => typeof v[k] === "number");
      if (key) {
        const [min, max] = scrubLimits[c.type]?.[key] ||
          (["spring", "bezier"].includes(c.type)
            ? scrubLimits.motion[key]
            : undefined) || [-Infinity, Infinity];
        result = {
          ...v,
          [key]: Number(
            clamp(
              v[key] + dir * (c.step || 1) * factor,
              c.min ?? min,
              c.max ?? max,
            ).toFixed(5),
          ),
        };
      } else return;
    } else return;
    if (event.type === "pointermove" || event.type === "pointerdown")
      this.change(id, result);
    else this.transact(id, result);
  }
  scrub(target, id) {
    let startX,
      base,
      moved = false;
    this.gestures.push(
      pointerSurface(target, {
        start: (e) => {
          startX = e.clientX;
          base = this.get(id);
          moved = false;
          this.begin(id, "scrub");
        },
        move: (e) => {
          const dx = e.clientX - startX;
          if (Math.abs(dx) > 2) moved = true;
          if (moved) this.adjust(id, Math.round(dx / 2), e, 1, base);
        },
        end: () => {
          this.commit(id);
          if (moved) {
            const swallow = (e) => {
              e.preventDefault();
              e.stopImmediatePropagation();
            };
            target.addEventListener("click", swallow, {
              once: true,
              capture: true,
            });
          }
        },
        cancel: () => this.cancel(id),
      }),
    );
  }
  setDepth(id, depth, animate = true) {
    const s = this.sections.get(id);
    if (!s) return;
    const before = s.node.getBoundingClientRect();
    const prior = s.depth;
    s.animation?.cancel();
    cancelAnimationFrame(s.depthFrame);
    s.depth = clamp(depth, 1, 3);
    s.node.dataset.depth = s.depth;
    if (s.depth !== 3) {
      s.node.style.width = "";
      s.node.style.height = "";
    }
    s.body.inert = s.depth === 1;
    s.toggle.setAttribute("aria-expanded", String(s.depth > 1));
    s.buttons.forEach((b, i) =>
      b.setAttribute("aria-pressed", String(i + 1 === s.depth)),
    );
    s.lab?.depth?.(s.depth);
    for (const c of s.schema.controls) {
      const row = this.rows.get(c.id);
      if (row) row.node.hidden = (c.depth || 1) > Math.max(2, s.depth);
    }
    this.options.onDepth?.(id, s.depth);
    this.emit("depth", { section: id, depth: s.depth });
    if (
      animate &&
      prior &&
      s.node.isConnected &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      s.animation?.cancel();
      s.depthFrame = requestAnimationFrame(() => {
        const after = s.node.getBoundingClientRect();
        if (before.width && after.width)
          s.animation = s.node.animate(
            [
              {
                transformOrigin: "top left",
                transform: `translate(${before.x - after.x}px,${before.y - after.y}px) scale(${before.width / after.width},${before.height / Math.max(1, after.height)})`,
              },
              { transformOrigin: "top left", transform: "none" },
            ],
            { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
          );
      });
    }
    if (s.depth === 1 && s.body.contains(document.activeElement))
      s.toggle.focus();
    if (
      s.depth < 3 &&
      (s.tabs.contains(document.activeElement) ||
        s.resize === document.activeElement)
    )
      s.buttons[s.depth - 1].focus();
  }
  resizeStudio(id, width, height) {
    const s = this.sections.get(id);
    if (!s || s.depth !== 3) return;
    const viewport = this.root.dataset.studioMode === "viewport",
      maxWidth = viewport
        ? document.documentElement.clientWidth
        : s.node.parentElement.clientWidth,
      maxHeight = viewport ? innerHeight : innerHeight * 0.9;
    s.node.style.width = `${clamp(width, Math.min(360, maxWidth), maxWidth)}px`;
    s.node.style.height = `${clamp(height, Math.min(520, maxHeight), maxHeight)}px`;
    this.announce(
      `Studio ${s.node.offsetWidth} by ${s.node.offsetHeight} pixels`,
    );
  }
  keydown(e) {
    if (e.defaultPrevented) return;
    const editing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
        e.target.isContentEditable,
      s = [...this.sections.values()].find((s) => s.node.contains(e.target));
    const row =
      this.rowAt(e.target) ||
      (s && e.target === s.toggle
        ? this.rows.get(s.schema.controls[0]?.id)
        : undefined);
    if (
      s &&
      e.target === s.resize &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      const step = e.shiftKey ? 64 : 16;
      this.resizeStudio(
        s.schema.id,
        s.node.offsetWidth +
          (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0),
        s.node.offsetHeight +
          (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0),
      );
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this.palette();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !editing) {
      e.preventDefault();
      this.undo(e.shiftKey);
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (this.keys.help.includes(e.key) && !editing) {
      e.preventDefault();
      this.help();
      return;
    }
    if (e.key === "Escape" && !editing && s?.depth === 3) {
      e.preventDefault();
      this.setDepth(s.schema.id, 2);
      s.buttons[1].focus();
      return;
    }
    if (e.target.closest(".d-depth") && /^[123]$/.test(e.key)) {
      e.preventDefault();
      this.setDepth(s.schema.id, Number(e.key));
      s.buttons[Number(e.key) - 1].focus();
      return;
    }
    if (!row || editing) return;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      row.count = ((row.count || "") + e.key).slice(-4);
      this.announce(`Count ${row.count}`);
      return;
    }
    const direction = this.keys.increase.includes(e.key)
      ? 1
      : this.keys.decrease.includes(e.key)
        ? -1
        : 0;
    if (direction) {
      e.preventDefault();
      try {
        this.adjust(
          row.c.id,
          direction,
          e,
          Math.max(1, Number(row.count || 1)),
        );
        if (e.target.getAttribute("role") === "radio")
          row.input.querySelector('[tabindex="0"]')?.focus();
      } catch (err) {
        this.announce(err.message);
      }
      row.count = "";
      return;
    }
    if (this.keys.reset.includes(e.key)) {
      e.preventDefault();
      this.reset(row.c.id);
      return;
    }
    if (["Home", "End"].includes(e.key) && numeric(row.c)) {
      e.preventDefault();
      const n = e.key === "Home" ? row.c.min : row.c.max;
      if (n !== undefined) this.transact(row.c.id, n);
      return;
    }
    if (
      this.keys.studio.includes(e.key) ||
      (["Enter", " "].includes(e.key) && e.target === row.fig)
    ) {
      e.preventDefault();
      this.open(row.c.id);
    }
  }
  undo(redo = false) {
    if (this.options.history === false) {
      this.emit("command", { command: redo ? "redo" : "undo" });
      return;
    }
    const from = redo ? this.future : this.history,
      to = redo ? this.history : this.future,
      entry = from.pop();
    if (!entry) return;
    const id = entry.id,
      value = redo ? entry.after : entry.before;
    this.begin(id, redo ? "redo" : "undo");
    this.rows.get(id).c.value = clone(value);
    this.paint(id);
    this.event(id, "change", this.active.get(id));
    this.event(id, "commit", this.active.get(id));
    this.active.delete(id);
    to.push(entry);
    this.paint(id);
  }
  /** Command palette: type to find a control or a depth command; Enter runs, Shift+Enter opens the studio. */
  palette() {
    if (this.dialog?.open) return;
    const items = [];
    for (const s of this.sections.values()) {
      const name = s.schema.label || s.schema.id;
      for (const c of s.schema.controls)
        items.push({
          text: `${name} / ${c.label || c.id}`,
          hint: format(c.value ?? c.default, c).slice(0, 24),
          run: (studio) => {
            if (studio) return this.open(c.id);
            if (s.depth === 1) this.setDepth(s.schema.id, 2, false);
            this.rows.get(c.id)?.label.focus();
          },
        });
      ["Dial", "Bench", "Studio"].forEach((depthName, i) =>
        items.push({
          text: `${name}: show as ${depthName.toLowerCase()}`,
          hint: String(i + 1),
          run: () => {
            this.setDepth(s.schema.id, i + 1);
            s.buttons[i].focus();
          },
        }),
      );
    }
    const input = el("input", {
        type: "text",
        role: "combobox",
        "aria-expanded": "true",
        "aria-autocomplete": "list",
        "aria-label": "Find a control or command",
        placeholder: "Find a control or command",
        spellcheck: false,
        autocomplete: "off",
      }),
      list = el("div", { role: "listbox", class: "d-palette-list", "aria-label": "Results" });
    const listId = `d-pal-${++serial}`;
    list.id = listId;
    input.setAttribute("aria-controls", listId);
    let shown = [],
      at = 0;
    const score = (text, q) => {
      if (!q) return 1;
      const t = text.toLowerCase();
      let i = 0,
        gaps = 0,
        last = -1;
      for (const ch of q.toLowerCase().replace(/\s+/g, "")) {
        const j = t.indexOf(ch, i);
        if (j < 0) return 0;
        gaps += last >= 0 ? j - last - 1 : j;
        last = j;
        i = j + 1;
      }
      return 1 / (1 + gaps);
    };
    const paint = () => {
      shown = items
        .map((it) => [score(it.text, input.value), it])
        .filter(([n]) => n > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 12)
        .map(([, it]) => it);
      at = Math.min(at, Math.max(0, shown.length - 1));
      list.replaceChildren(
        ...shown.map((it, i) => {
          const o = el(
            "div",
            {
              role: "option",
              id: `${listId}-${i}`,
              class: "d-palette-item",
              "aria-selected": String(i === at),
            },
            el("span", { text: it.text }),
            el("kbd", { text: it.hint }),
          );
          o.addEventListener("click", () => run(it, false));
          return o;
        }),
      );
      input.setAttribute("aria-activedescendant", shown.length ? `${listId}-${at}` : "");
      if (!shown.length) list.append(el("div", { class: "d-palette-empty", text: "Nothing matches" }));
    };
    const run = (it, studio) => {
      this.dialog.close();
      // The dialog hands focus back to its opener on close; move focus after that.
      setTimeout(() => it.run(studio), 0);
    };
    input.addEventListener("input", () => {
      at = 0;
      paint();
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        at = clamp(at + (e.key === "ArrowDown" ? 1 : -1), 0, Math.max(0, shown.length - 1));
        paint();
      } else if (e.key === "Enter" && shown[at]) {
        e.preventDefault();
        run(shown[at], e.shiftKey);
      }
    });
    this.dialog = el(
      "dialog",
      { class: "dials d-help d-palette", "aria-label": "Command palette" },
      input,
      list,
      el("p", { class: "d-palette-note", text: "Enter goes to the control. Shift Enter opens its studio. Escape closes." }),
    );
    this.root.append(this.dialog);
    this.dialog.addEventListener("close", () => this.dialog.remove(), { once: true });
    paint();
    this.dialog.showModal();
    input.focus();
  }
  help() {
    if (this.dialog?.open) return;
    const editor = el("div", { class: "d-keymap" });
    for (const action of ["increase", "decrease", "reset", "studio", "help"]) {
      const field = el("input", {
        type: "text",
        "aria-label": `Keys for ${action}`,
        value: this.keys[action].join(" "),
        spellcheck: false,
      });
      field.addEventListener("change", () => {
        const list = field.value.split(/\s+/).filter(Boolean);
        if (!list.length) {
          field.value = this.keys[action].join(" ");
          return;
        }
        this.keys[action] = list;
        this.options.onKeys?.({ ...this.keys });
        this.announce(`${action} is now ${list.join(", ")}`);
      });
      editor.append(el("label", {}, el("span", { text: action }), field));
    }
    this.dialog = el(
      "dialog",
      { class: "dials d-help", "aria-label": "Instrument keyboard map" },
      el("h2", { text: "Instrument keys" }),
      ...keyBindings(this.keys).map(([key, text]) =>
        el("p", {}, el("kbd", { text: key }), el("span", { text })),
      ),
      el("h2", { text: "Change keys" }),
      el("p", { class: "d-note", text: "Separate several keys with a space, for example: ArrowRight l" }),
      editor,
      button("Close", "Close keyboard map", () => this.dialog.close()),
    );
    this.root.append(this.dialog);
    this.dialog.addEventListener("close", () => this.dialog.remove(), {
      once: true,
    });
    this.dialog.showModal();
  }
  destroy() {
    if (this.disposed) return;
    this.gestures.forEach((dispose) => dispose());
    this.gestures = [];
    for (const id of [...this.active.keys()]) this.cancel(id);
    this.sections.forEach((s) => {
      cancelAnimationFrame(s.depthFrame);
      s.animation?.cancel();
      s.lab?.destroy?.();
    });
    this.rows.forEach((r) => r.plugin?.destroy?.());
    this.root.remove();
    this.rows.clear();
    this.sections.clear();
    this.disposed = true;
  }
}
export { expression } from "./values.js";
