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
  repairSchema,
  convert,
} from "./values.js";
import { parseColor, cssLch } from "./color.js";
import { motionCode, readMotionCode } from "./motion.js";
import { drawFigure, translateOf } from "./figures.js";
/** Replace (or add) translateX in a CSS transform list. */
export const withTranslate = (transform = "", x) => {
  const n = `translateX(${Number(Number(x).toFixed(2))}px)`;
  return /translateX\([^)]*\)/.test(transform)
    ? transform.replace(/translateX\([^)]*\)/, n)
    : `${n} ${transform}`.trim();
};
import { el, button, pointerSurface, choiceBox } from "./dom.js";
import { createStudio } from "./studios.js";
import { builtinTypes, shapeOf, shapeSummary } from "./shapes.js";
const controls = new Map(),
  figures = new Map();
let serial = 0;
// Rows whose figures draw during render(); later rows draw theirs as they come near or when idle.
const EAGER_FIGURES = 32;
const DIALS_MIME = "application/x-dials+json";
// Every live panel, so the palette can reach controls in all of them; one document listener per page.
const livePanels = new Set(),
  pageKeys = new WeakSet();
/** Ctrl K (Cmd K) anywhere on the page opens the palette of the panel used last, listing every panel. */
function listenOnPage(doc) {
  if (pageKeys.has(doc)) return;
  pageKeys.add(doc);
  doc.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey) return;
    const panels = [...livePanels].filter((p) => p.root.isConnected && p.root.ownerDocument === doc && p.options.pagePalette !== false);
    if (!panels.length) return;
    e.preventDefault();
    panels.sort((a, b) => (b._usedAt || 0) - (a._usedAt || 0))[0].palette();
  });
}
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
  ["g then h j k l / arrows", "Move focus to the nearest instrument that way"],
  ["g g / g e", "First / last row of the section"],
  ["g s / g r / g u", "Studio / reset / undo"],
  ["g 1 / g 2 / g 3", "Dial / bench / studio for this section"],
  ["Digits while dragging", "Type a number; Enter applies it (rows and studio handles)"],
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
// Depth glyphs: one line, the lines opened, the pane.
// Depth pictograms drawn at their relative sizes: one row, the opened rows, the whole pane.
const depthGlyphs = [
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="3" rx=".5" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3.5" width="10" height="9" rx="1" fill="none" stroke="currentColor"/><rect x="3" y="3.5" width="10" height="2.5" fill="currentColor"/><path d="M5 8.5H11M5 10.5H11" stroke="currentColor"/></svg>',
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="none" stroke="currentColor"/><rect x="1.5" y="2.5" width="13" height="2.5" fill="currentColor"/><rect x="2.5" y="6" width="3" height="6.5" fill="currentColor" opacity=".45"/><path d="M7 11.5L9 8.5L10.5 10L13 7" fill="none" stroke="currentColor"/></svg>',
];
const depthNames = [
  ["Dial", "one row"],
  ["Bench", "every control"],
  ["Studio", "the full pane"],
];
const sizeGlyph =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M13 7V13H7M13 13L8.5 8.5M3 9V3H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
    livePanels.add(this);
    listenOnPage(container.ownerDocument);
    // The panel used last answers a page-wide Ctrl K.
    const used = () => (this._usedAt = performance.now());
    this.root.addEventListener("pointerdown", used, true);
    this.root.addEventListener("focusin", used);
    this.status = el("div", {
      class: "d-sr",
      "aria-live": "polite",
      role: "status",
    });
    this.root.append(this.status);
    container.append(this.root);
    this.root.addEventListener("keydown", (e) => this.keydown(e));
    // Copy a value from a row or a studio; paste it on any other control, of any type that can hold it.
    // The clipboard carries the words and, for other panels, the typed value.
    this.root.addEventListener("copy", (e) => {
      const row = this.controlAt(e.target);
      if (row && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        e.clipboardData.setData("text/plain", format(row.c.value, row.c));
        e.clipboardData.setData(DIALS_MIME, JSON.stringify({ type: row.c.type, unit: row.c.unit, min: row.c.min, max: row.c.max, label: row.c.label, value: row.c.value }));
        this.announce(`Copied ${row.c.label}`);
      }
    });
    this.root.addEventListener("paste", (e) => {
      const row = this.controlAt(e.target);
      if (row && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        const typed = e.clipboardData.getData(DIALS_MIME);
        if (typed) this.fromValue(row.c.id, JSON.parse(typed));
        else this.fromText(row.c.id, e.clipboardData.getData("text/plain"));
      }
    });
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    if (type === "value") this.options.onChange?.(detail);
  }
  /** The control a node belongs to: its row, or the control whose studio holds it. */
  controlAt(target) {
    const row = this.rowAt(target);
    if (row) return row;
    const lab = target.closest?.(".d-lab"),
      s = lab && [...this.sections.values()].find((x) => x.labHost === lab);
    return s?.studioControl ? this.rows.get(s.studioControl) : undefined;
  }
  /** Paste a value copied from another control, converted to this one's type. */
  fromValue(id, from) {
    const c = this.rows.get(id).c;
    try {
      this.transact(id, convert(from.value, from, c), "paste");
      this.announce(from.type === c.type ? "Value pasted" : `Pasted ${from.label || from.type} as ${c.type}`);
    } catch (e) {
      this.announce(`Cannot paste ${from.label || from.type} here: ${e.message}`);
    }
  }
  rowAt(target) {
    return this.rows.get(target.closest("[data-control]")?.dataset.control);
  }
  announce(message) {
    this.status.textContent = message;
  }
  render(schema) {
    // Read tolerantly: a value or field that does not fit is repaired and its row says so.
    const { schema: next, problems } = repairSchema(schema);
    for (const s of next.sections)
      for (const c of s.controls)
        if (c.type === "color")
          for (const key of ["value", "default"]) {
            if (c[key] === undefined) continue;
            try {
              parseColor(c[key], this.root);
            } catch {
              c.invalid = `${c.invalid ? c.invalid + "; " : ""}its ${key} (${String(c[key]).slice(0, 40)}) is not a colour this browser reads; showing grey`;
              c[key] = "#808080";
            }
          }
    this.problems = problems;
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
      const buttons = depthNames.map(([name, what], i) => {
        const b = button("", `${section.label}: ${name}`, () =>
          this.setDepth(section.id, i + 1),
        );
        b.title = `${name}: ${what} (${i + 1})`;
        b.innerHTML = depthGlyphs[i];
        return b;
      });
      depth.append(...buttons);
      const resize = button(
        "",
        "Resize studio pane with arrow keys; click for compact size",
        () =>
          this.resizeStudio(
            section.id,
            Math.min(800, s.node.parentElement.clientWidth),
            640,
          ),
        "d-pane-size d-studio-only",
      );
      resize.innerHTML = sizeGlyph;
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
        ...section.controls.map((c) => {
          const b = button(c.label || c.id, "Open " + (c.label || c.id) + " studio", () => this.open(c.id));
          if ((c.label || c.id).length > 18) b.title = c.label || c.id;
          return b;
        }),
      );
      body.append(content);
      const railHost = el("div", { class: "d-rail" });
      content.append(rowlist, railHost, labHost);
      head.insertBefore(tabs, resize);
      node.append(head, body);
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
        railHost,
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
        // Past the first screens, a row's figure is drawn when it scrolls near or when the page is idle.
        if (this.rows.size > EAGER_FIGURES) row.lazyFig = true;
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
    this.wakeFigures();
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
      "data-control-id": c.id,
      "data-type": c.type,
      "data-kind": controls.has(c.type)
        ? "plugin"
        : numeric(c) && c.type !== "seed"
          ? "meter"
          : ["segmented", "select"].includes(c.type)
            ? "choice"
            : c.type === "boolean"
              ? "switch"
              : "wide",
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
      input = choiceBox(
        c.label,
        (c.options || []).map((o, i) => ({
          value: String(i),
          text: typeof o === "object" ? o.label : String(o),
        })),
        (i) => {
          const o = c.options[Number(i)];
          this.transact(c.id, typeof o === "object" ? o.value : o);
        },
      );
      input.setAttribute("aria-labelledby", uid);
    } else {
      // Numbers sit on one line; anything that can run long (text, colours, JSON) wraps and
      // grows the row instead of being cut off.
      const wide = !numeric(c);
      input = el(wide ? "textarea" : "input", {
        type: wide ? undefined : "text",
        rows: wide ? 1 : undefined,
        "aria-labelledby": uid,
        spellcheck: false,
        autocomplete: "off",
      });
      input.value = format(c.value, c);
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
    this.scrub(fig, c.id, true);
    label.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.reset(c.id);
    });
    // Double click anywhere else on the row opens its studio.
    node.addEventListener("dblclick", (e) => {
      if (e.target.closest("input, textarea, .d-label, .d-reset")) return;
      this.open(c.id);
    });
    if (c.type === "boolean")
      fig.addEventListener("click", () => this.transact(c.id, !c.value));
    // A value the schema got wrong was repaired; the row says what happened, in words.
    if (c.invalid) {
      node.dataset.invalid = "";
      label.title = `${c.label || c.id}: ${c.invalid}`;
    } else if ((c.label || "").length > 24) label.title = c.label;
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
    const detail = {
      control: id,
      value: this.get(id),
      previous: clone(edit.before),
      phase,
      source: edit.source,
      transaction: edit.transaction,
      baseRevision: edit.revision,
    };
    // A finished motion edit carries the code it writes, so a host can save the file.
    const r = this.rows.get(id);
    if (phase === "commit" && r && ["motion", "bezier", "spring", "keyframes"].includes(r.c.type))
      detail.code = this.motionCode(r.section.schema.id);
    this.emit("value", detail);
  }
  /** The CSS transition, CSS @keyframes animation and WAAPI call a motion section writes. */
  motionCode(sectionId) {
    const s = this.sections.get(sectionId);
    if (!s) throw new Error("Unknown section " + sectionId);
    const of = (...types) => s.schema.controls.find((c) => types.includes(c.type));
    const m = of("motion", "bezier", "spring"),
      k = of("keyframes"),
      loop = s.schema.controls.find((c) => c.type === "boolean" && /loop|repeat/i.test(c.id + c.label)),
      rot = s.schema.controls.find((c) => c.type === "angle");
    const mv = m ? this.get(m.id) : {};
    return motionCode({
      motion: Array.isArray(mv) ? { mode: "bezier", bezier: mv, duration: 1000 } : mv,
      frames: k ? this.get(k.id) : undefined,
      loop: loop ? !!this.get(loop.id) : false,
      rotate: rot ? this.get(rot.id) : undefined,
      name: s.schema.id,
    });
  }
  /**
   * Read motion code back into a section: a transition rule, an @keyframes animation or a
   * WAAPI animate() call. Each changed control is one undoable edit. Returns what was read.
   */
  applyMotionCode(sectionId, text) {
    const s = this.sections.get(sectionId);
    if (!s) throw new Error("Unknown section " + sectionId);
    const read = readMotionCode(text),
      ids = s.schema.controls;
    const m = ids.find((c) => c.type === "motion"),
      k = ids.find((c) => c.type === "keyframes"),
      loop = ids.find((c) => c.type === "boolean" && /loop|repeat/i.test(c.id + c.label)),
      rot = ids.find((c) => c.type === "angle");
    const put = (c, v) => {
      if (c && !same(this.get(c.id), v)) this.transact(c.id, v, "code");
    };
    if (read.motion && m) put(m, { ...this.get(m.id), ...read.motion });
    if (read.frames && k) put(k, read.frames);
    if (read.iterations !== undefined && loop) put(loop, read.iterations === Infinity);
    if (read.rotate !== undefined && rot) put(rot, read.rotate);
    return read;
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
    const modified = !same(c.value, c.default);
    r.node.classList.toggle("is-modified", modified);
    r.node.toggleAttribute("data-modified", modified);
    r.node.classList.toggle("is-editing", this.active.has(id));
    r.label.setAttribute(
      "aria-description",
      `${format(c.value, c)}. ${c.invalid ? `Repaired: ${c.invalid}. ` : ""}${c.description || "Drag to adjust. Shift fine; Alt coarse."}`,
    );
    r.label.setAttribute("aria-disabled", String(!!c.disabled));
    r.node.querySelector(".d-reset").title =
      `Reset ${c.label} to ${format(c.default, c)}`;
    if (input && (input !== document.activeElement || !this.active.has(id))) {
      if (input.tagName === "INPUT" || input.tagName === "TEXTAREA")
        input.value =
          input !== document.activeElement &&
          typeof c.value === "string" &&
          ["gradient", "asset", "file"].includes(c.type)
            ? this.summary(c)
            : input !== document.activeElement &&
                c.value &&
          typeof c.value === "object" &&
          (!Array.isArray(c.value) || c.type === "keyframes" || !builtinTypes.has(c.type))
            ? this.summary(c)
            : format(c.value, c);
      else if (input.classList.contains("d-choice"))
        input.value = String(
          (c.options || []).findIndex((o) =>
            same(typeof o === "object" ? o.value : o, c.value),
          ),
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
      // With a drawn figure only the chosen word shows; keep focus on what is visible.
      if (input.contains(document.activeElement) && document.activeElement.getAttribute("aria-checked") !== "true")
        input.querySelector("[aria-checked=\"true\"]")?.focus();
    }
    r.plugin?.update?.(clone(c.value));
    if (r.lazyFig) r.figStale = true;
    else this.drawRowFigure(r);
    const s = r.section;
    if (s.schema.controls[0] === c) {
      drawFigure(s.fig, c, c.value);
      s.summary.textContent = this.summary(c);
    }
    if (updateStudio && s.studioControl === id) s.lab?.update?.();
    this.emit("paint", { control: id, value: clone(c.value) });
  }
  drawRowFigure(r) {
    const { c } = r,
      key = typeof c.figure === "string" ? c.figure : c.figure?.type,
      draw = figures.get(key);
    if (draw) draw(r.fig, c, clone(c.value));
    else drawFigure(r.fig, c, c.value);
  }
  /** Draw deferred row figures: each as its row comes near the viewport, the rest in idle slices. */
  wakeFigures() {
    const lazy = [...this.rows.values()].filter((r) => r.lazyFig);
    if (!lazy.length) return;
    const token = (this._figToken = {}),
      wake = (r) => {
        if (!r.lazyFig || this._figToken !== token) return;
        r.lazyFig = false;
        if (r.figStale) this.drawRowFigure(r);
        r.figStale = false;
      };
    for (const r of lazy) r.node.addEventListener("contentvisibilityautostatechange", (e) => !e.skipped && wake(r), { once: true });
    let i = 0;
    const slice = () => {
      if (this._figToken !== token || this.disposed) return;
      const end = performance.now() + 6;
      while (i < lazy.length && performance.now() < end) wake(lazy[i++]);
      if (i < lazy.length) setTimeout(slice, 16);
    };
    requestAnimationFrame(() => setTimeout(slice, 32));
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
      if (c.type === "keyframes" && Array.isArray(v))
        return `${v.length} keys · ${v.map((f) => translateOf(f)).join(" → ")}${c.unit || "px"}`;
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
    if (!builtinTypes.has(c.type)) {
      const words = shapeSummary(shapeOf(c, v), c, v);
      if (words) return words;
    }
    return format(v, c).slice(0, 38);
  }
  buildStudio(s, id, update = true) {
    s.lab?.destroy?.();
    s.labHost.replaceChildren();
    s.labHost.className = "d-lab";
    delete s.labHost.dataset.layout;
    s.railHost.replaceChildren();
    s.studioControl = id;
    if (s.depth === 3) s.node.dataset.studioFor = id;
    const c = s.schema.controls.find((c) => c.id === id),
      plugin = c && controls.get(c.type);
    [...s.tabs.children].forEach((b, i) =>
      b.setAttribute("aria-pressed", String(s.schema.controls[i].id === id)),
    );
    // Keep the current tab in view when the tabs scroll (narrow studios), without moving the page.
    const tab = s.tabs.querySelector('[aria-pressed="true"]');
    if (tab && s.tabs.scrollWidth > s.tabs.clientWidth) {
      const l = tab.offsetLeft - s.tabs.offsetLeft;
      if (l < s.tabs.scrollLeft || l + tab.offsetWidth > s.tabs.scrollLeft + s.tabs.clientWidth) s.tabs.scrollLeft = l - 24;
    }
    // A studio is drawn when it is opened, so swapping a whole panel stays cheap.
    s.lab = null;
    s.labStale = s.depth !== 3;
    if (s.labStale) return;
    s.lab = plugin?.studio
      ? plugin.studio({ ...this.context(id), panel: this, rail: s.railHost }, s.labHost)
      : createStudio(this, { ...s.schema, studioControl: id }, s.labHost, s.railHost);
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
    } else if (Array.isArray(v) && c.type !== "keyframes")
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
    else if (c.type === "keyframes" && Array.isArray(v)) {
      // Arrows move the frame that travels furthest; the others keep their place.
      const xs = v.map(translateOf),
        at = xs.reduce((best, x, i) => (Math.abs(x) > Math.abs(xs[best]) ? i : best), 0),
        next = clamp(xs[at] + dir * (c.step || 1) * factor, c.min ?? -Infinity, c.max ?? Infinity);
      result = v.map((f, i) =>
        i === at ? { ...f, transform: withTranslate(f.transform, next) } : f,
      );
    } else if (c.type === "gradient" && typeof v === "string") {
      // Arrows turn the gradient's angle; the stops stay where the typed value put them.
      const angle = /(-?\d+(?:\.\d+)?)deg/.exec(v);
      if (!angle) return;
      const turned = (((Number(angle[1]) + dir * 5 * factor) % 360) + 360) % 360;
      result = v.replace(angle[0], `${Number(turned.toFixed(2))}deg`);
    } else if (c.type === "encoding" && v && typeof v === "object") {
      // Arrows walk the channel's field through the declared fields; the first press from "none" picks the first.
      const names = (c.fields || []).map((f) => (typeof f === "object" ? f.name : f)),
        key = c.scrub || "x",
        at = names.indexOf(v[key]);
      if (!names.length) return;
      const next = clamp(at + dir * count, -1, names.length - 1);
      result = { ...v, [key]: next < 0 ? "" : names[next] };
    } else if (v && typeof v === "object") {
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
  /**
   * Drag to change a value. On a label the drag is relative (Shift fine, Alt coarse). On a figure
   * the drawing is the control: a ranged number goes where the pointer is on its track, a vector
   * follows the pointer in two dimensions, a choice picks the option drawn under the pointer.
   * While the button is held, typed digits replace the value: Enter (or release) applies them.
   */
  scrub(target, id, track = false) {
    let startX,
      base,
      direct,
      typed = "",
      locked = false,
      moved = false;
    const onKey = (e) => {
      const row = this.rows.get(id);
      if (!row || !numeric(row.c)) return;
      if (/^[0-9.]$/.test(e.key) || (e.key === "-" && !typed)) typed += e.key;
      else if (e.key === "Backspace") typed = typed.slice(0, -1);
      else if (e.key === "Enter" && typed) applyTyped();
      else return;
      e.preventDefault();
      e.stopPropagation();
      row.node.classList.toggle("is-typing", !!typed && !locked);
      if (row.input && !locked) row.input.value = typed || format(row.c.value, row.c);
      if (typed) this.announce(`Typed ${typed}`);
    };
    const applyTyped = () => {
      const row = this.rows.get(id);
      if (!typed || locked || !row) return;
      locked = true;
      row.node.classList.remove("is-typing");
      try {
        this.change(id, this.parse(typed, row.c));
      } catch (err) {
        this.announce(err.message);
      }
    };
    const stopKeys = () =>
      target.ownerDocument.removeEventListener("keydown", onKey, true);
    this.gestures.push(
      pointerSurface(target, {
        start: (e) => {
          startX = e.clientX;
          base = this.get(id);
          moved = false;
          typed = "";
          locked = false;
          target.ownerDocument.addEventListener("keydown", onKey, true);
          const c = this.rows.get(id)?.c;
          // On a figure the pointer sets the value where it points; Shift keeps the fine relative drag.
          direct = null;
          if (track && !e.shiftKey && c) {
            const svg = target.querySelector("svg");
            if (
              numeric(c) &&
              c.type !== "seed" &&
              Number.isFinite(c.min) &&
              Number.isFinite(c.max)
            )
              direct = {
                mode: "range",
                node: target.querySelector(".d-track") || svg || target,
              };
            else if (c.type === "vector") direct = { mode: "vector", node: svg || target };
            else if (["select", "segmented"].includes(c.type) && c.options?.length)
              direct = { mode: "choice", node: svg || target };
          }
          this.begin(id, "scrub");
        },
        move: (e) => {
          if (locked || typed) return;
          const dx = e.clientX - startX;
          if (Math.abs(dx) > 2) moved = true;
          if (direct) {
            const c = this.rows.get(id).c,
              r = direct.node.getBoundingClientRect(),
              t = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
            moved = moved || e.type === "pointermove";
            if (direct.mode === "range")
              this.change(id, quantize(c.min + t * (c.max - c.min), c));
            else if (direct.mode === "vector") {
              const lo = c.min ?? -1,
                hi = c.max ?? 1,
                u = clamp(1 - (e.clientY - r.top) / (r.height || 1), 0, 1),
                q = (k) => quantize(lo + k * (hi - lo), { ...c, min: lo, max: hi });
              this.change(id, [q(t), q(u)]);
            } else {
              const opts = c.options.map((o) => (typeof o === "object" ? o.value : o));
              this.change(id, opts[Math.min(opts.length - 1, Math.floor(t * opts.length))]);
            }
          } else if (moved) this.adjust(id, Math.round(dx / 2), e, 1, base);
        },
        end: () => {
          stopKeys();
          applyTyped();
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
        cancel: () => {
          stopKeys();
          this.rows.get(id)?.node.classList.remove("is-typing");
          this.cancel(id);
        },
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
    if (s.depth === 3 && s.labStale) this.buildStudio(s, s.studioControl);
    // Contract hook: the open studio names the control it is for.
    if (s.depth === 3) s.node.dataset.studioFor = s.studioControl || s.schema.controls[0]?.id || "";
    else delete s.node.dataset.studioFor;
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
    if (!editing && this.leaderKey(e, s, row)) return;
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
  /**
   * The leader: press g, then a key. g h/j/k/l (or arrows) moves focus to the nearest
   * instrument in that direction (labels, figures, values, studio handles alike); g g and
   * g e go to the first and last row; g s opens the studio, g 1/2/3 sets the section's
   * depth, g r resets the focused control, g u undoes, g / finds anything.
   */
  leaderKey(e, s, row) {
    const now = performance.now();
    if (!this.leader || now - this.leader > 1500) {
      this.leader = 0;
      // A key rebound to another action wins over the leader.
      if (e.key !== "g" || e.altKey || Object.values(this.keys).some((list) => list.includes("g"))) return false;
      e.preventDefault();
      this.leader = now;
      this.announce("g … h j k l move · g e first or last · s studio · 1 2 3 depth · r reset · u undo · / find");
      return true;
    }
    this.leader = 0;
    e.preventDefault();
    const dir = { h: [-1, 0], ArrowLeft: [-1, 0], l: [1, 0], ArrowRight: [1, 0], k: [0, -1], ArrowUp: [0, -1], j: [0, 1], ArrowDown: [0, 1] }[e.key];
    const rowsHere = [...this.rows.values()].filter((r) => !s || r.section === s);
    if (dir) this.spatialFocus(e.target, dir);
    else if (e.key === "g") rowsHere[0]?.label.focus();
    else if (e.key === "e") rowsHere.at(-1)?.label.focus();
    else if (e.key === "s" && row) this.open(row.c.id);
    else if (/^[123]$/.test(e.key) && s) this.setDepth(s.schema.id, Number(e.key));
    else if (e.key === "r" && row) this.reset(row.c.id);
    else if (e.key === "u") this.undo(false);
    else if (e.key === "/") this.palette();
    else if (e.key !== "Escape") {
      this.announce(`g ${e.key} does nothing; press ? for the key map`);
      return true;
    }
    this.announce("");
    return true;
  }
  /** Move focus to the nearest focusable thing in a direction, by on-screen position. */
  spatialFocus(from, [dx, dy]) {
    const a = from.getBoundingClientRect(),
      ax = a.left + a.width / 2,
      ay = a.top + a.height / 2;
    let best = null,
      score = Infinity;
    for (const node of this.root.querySelectorAll('[tabindex="0"], button:not([disabled]), input:not([type=hidden]), textarea, select, a[href]')) {
      if (node === from || node.closest("[hidden], dialog:not([open])")) continue;
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const ox = r.left + r.width / 2 - ax,
        oy = r.top + r.height / 2 - ay,
        along = ox * dx + oy * dy,
        across = Math.abs(ox * dy - oy * dx);
      // In the direction, within a 60-degree-ish cone; nearer and straighter wins.
      if (along <= 4 || across > along * 1.8) continue;
      const d = along + across * 2.5;
      if (d < score) (score = d), (best = node);
    }
    if (best) {
      best.focus();
      best.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else this.announce("Nothing further that way");
    return best;
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
  /** This panel's palette commands; the palette lists every panel's on the page. */
  paletteItems() {
    // Commands are exact phrases (`Control Opacity`, `Studio Accent`, `Bench Pigment`, `Reset Wash`),
    // so a person or an agent can type one whole and press Enter.
    const items = [];
    for (const s of this.sections.values()) {
      const name = s.schema.label || s.schema.id;
      for (const c of s.schema.controls) {
        const label = c.label || c.id;
        items.push(
          {
            text: `Control ${label}`,
            hint: name,
            control: c,
            run: (studio) => {
              if (studio) return this.open(c.id);
              if (s.depth === 1) this.setDepth(s.schema.id, 2, false);
              this.rows.get(c.id)?.label.focus();
            },
          },
          {
            text: `Studio ${label}`,
            hint: name,
            control: c,
            what: "Opens the full pane for this control.",
            run: () => {
              this.open(c.id);
              s.buttons[2].focus();
            },
          },
          {
            text: `Reset ${label}`,
            hint: "R",
            control: c,
            what: "Back to the declared default.",
            reset: true,
            run: () => {
              this.reset(c.id);
              if (s.depth === 1) this.setDepth(s.schema.id, 2, false);
              this.rows.get(c.id)?.label.focus();
            },
          },
        );
      }
      ["Dial", "Bench", "Studio"].forEach((depthName, i) =>
        items.push({
          text: `${depthName} ${name}`,
          hint: String(i + 1),
          section: s,
          depthIndex: i,
          run: () => {
            this.setDepth(s.schema.id, i + 1);
            s.buttons[i].focus();
          },
        }),
      );
    }
    for (const it of items) it.panel = this;
    return items;
  }
  palette() {
    if (this.dialog?.open || [...livePanels].some((p) => p.dialog?.open)) return;
    // Every panel on the page, this one first: Ctrl K finds any control from anywhere.
    const others = [...livePanels].filter((p) => p !== this && p.root.isConnected && p.root.ownerDocument === this.root.ownerDocument);
    const items = [this, ...others].flatMap((p) => p.paletteItems());
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
      const t = text.toLowerCase(),
        k = q.trim().toLowerCase();
      // Exact phrases first, then prefixes, then words that start the same, then fuzzy letters.
      if (t === k) return 4;
      if (t.startsWith(k)) return 3 + k.length / (t.length * 10);
      if (t.split(/\s+/).some((w) => w.startsWith(k))) return 2;
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
            el("span", { class: "d-palette-fig", "aria-hidden": "true" }),
            el("span", { class: "d-palette-text", text: it.text }),
            el("kbd", { text: it.hint }),
          );
          if (it.control) drawFigure(o.firstChild, it.control, it.panel.get(it.control.id));
          else if (it.section) o.firstChild.innerHTML = depthGlyphs[it.depthIndex];
          o.addEventListener("click", () => run(it, false));
          return o;
        }),
      );
      input.setAttribute("aria-activedescendant", shown.length ? `${listId}-${at}` : "");
      showPreview(shown[at]);
      if (!shown.length) list.append(el("div", { class: "d-palette-empty", text: "Nothing matches" }));
    };
    // The preview: what the highlighted command acts on, drawn, with its whole value.
    const preview = el("aside", { class: "d-palette-preview", "aria-live": "polite" });
    const showPreview = (it) => {
      preview.replaceChildren();
      if (!it) return;
      const c = it.control;
      if (c) {
        const now = it.panel.get(c.id),
          shownValue = it.reset ? c.default : now,
          fig = el("span", { class: "d-palette-big" });
        drawFigure(fig, c, shownValue);
        preview.append(
          el("p", { class: "d-palette-kicker", text: `${it.panel.rows.get(c.id)?.section.schema.label || ""} · ${c.type}` }),
          el("h3", { text: c.label || c.id }),
          fig,
          el("p", { class: "d-palette-value", text: format(shownValue, c) }),
          el("p", { class: "d-palette-what", text: it.reset ? (same(now, c.default) ? "Already at its default." : `Now ${format(now, c)}; this puts back the default shown above.`) : it.what || "Focus its row: arrows, typing or a drag change it." }),
        );
      } else if (it.section) {
        const g = el("span", { class: "d-palette-big d-palette-depth" });
        g.innerHTML = depthGlyphs[it.depthIndex];
        preview.append(
          el("h3", { text: it.section.schema.label || it.section.schema.id }),
          g,
          el("p", { class: "d-palette-what", text: `${depthNames[it.depthIndex][0]}: ${depthNames[it.depthIndex][1]}. ${it.section.schema.controls.length} controls.` }),
        );
      }
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
      { class: "d-help d-palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" },
      input,
      el("div", { class: "d-palette-body" }, list, preview),
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
      { class: "d-help", role: "dialog", "aria-modal": "true", "aria-label": "Instrument keyboard map" },
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
    livePanels.delete(this);
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
export { registerInstrument } from "./instruments.js";
export { looseJson } from "./values.js";
