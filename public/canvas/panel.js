// The design panel (FEEL-02), on the right. Plain DOM, rebuilt on every selection or render, with event
// delegation wired once. It reads like a design tool: sections with human labels, scrubbable number fields
// (drag a label), units, a 3x3 alignment matrix, Hug / Fill / Fixed, colour swatches, and override dots with Reset.
// Every control still writes CSS through ctx.sendEdits: one `set` per property, and one batch per change
// (several selected nodes = one revision). The panel never writes files. Text typed into a field survives a
// rebuild (ui.draft) until it is saved.
import { index, axes, resolveStyle, propOf } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const variantLabel = (v) => Object.entries(v || {}).map(([k, x]) => `${k}=${x}`).join(' · ') || 'default';

const NUMBER = /^-?\d+(\.\d+)?$/;
// One unit convention: a single px value shows as the number with a px suffix inside the field; the file keeps its own spelling (see commit).
const pxless = (v, unit) => (unit === 'px' && /^-?\d*\.?\d+px$/.test(String(v)) ? String(v).slice(0, -2) : String(v));
const toValue = (raw) => { const t = raw.trim(); return t === '' ? null : NUMBER.test(t) ? Number(t) : t; };
const UNITLESS = new Set(['opacity', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'zIndex', 'order']);
const css = (prop, v) => (typeof v === 'number' && !UNITLESS.has(prop) ? `${v}px` : String(v));

// What each design control edits. `scrub`: drag the label to change the number.
const F = {
  gap: { label: 'Gap', unit: 'px', scrub: { step: 1, min: 0 }, placeholder: '0' },
  padding: { label: 'Padding', unit: 'px', scrub: { step: 1, min: 0 }, placeholder: '0' },
  width: { label: 'Width', unit: 'px', scrub: { step: 1, min: 0 } },
  height: { label: 'Height', unit: 'px', scrub: { step: 1, min: 0 } },
  opacity: { label: 'Opacity', unit: '%', pct: true, scrub: { step: 1, min: 0, max: 100 }, placeholder: '100' },
  borderRadius: { label: 'Corner radius', unit: 'px', scrub: { step: 1, min: 0 }, placeholder: '0' },
  color: { label: 'Text color', color: true, placeholder: 'Inherit' },
  fontFamily: { label: 'Font', placeholder: 'Inherit' },
  fontSize: { label: 'Size', unit: 'px', scrub: { step: 1, min: 1 } },
  lineHeight: { label: 'Line height', scrub: { step: 1, min: 0 }, auto: true, placeholder: 'Auto' },
  letterSpacing: { label: 'Letter spacing', unit: 'px', scrub: { step: 0.1, min: -20, digits: 1 }, placeholder: '0' },
};
const WEIGHTS = [300, 400, 500, 600, 700, 800];
const ALLBORDERS = ['border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft'];
const DESIGN = new Set([...Object.keys(F), ...ALLBORDERS, 'boxShadow', 'background', 'display', 'flexDirection', 'justifyContent', 'alignItems', 'fontWeight', 'textAlign']);
const ALIGN = ['flex-start', 'center', 'flex-end'];
const AL_NAME = [['top left', 'top', 'top right'], ['left', 'center', 'right'], ['bottom left', 'bottom', 'bottom right']];

// Panel-only state (nothing here is document state).
const ui = {
  selKey: '',      // component|variant: the edit target resets to Base when it changes
  mode: 'base',    // 'base' | 'variant'
  axis: null,      // which axis an override is written to
  errors: {},      // key -> { text, retry?: { component, edits } }
  forms: {},       // key -> true while an inline form is open
  draft: {},       // input id -> unsaved text
  closed: new Set(), // sections the user collapsed
  opened: new Set(), // sections the user expanded (overrides a collapsed default)
  advanced: false,
  sides: { pad: false, rad: false }, // per-side padding and per-corner radius expanded
  side: '',        // which border side the Stroke controls edit ('' = all)
  info: false,     // the scope explanation
  lastFill: null,
  scrubbing: false,
};

function target(doc, sel) {
  const nonBase = axes(doc).filter((a) => (sel.variant?.[a.name] ?? a.default) !== a.default).map((a) => [a.name, sel.variant[a.name]]);
  const available = nonBase.length > 0;
  const overriding = available && ui.mode === 'variant';
  const chosen = nonBase.find(([a]) => a === ui.axis) || nonBase[0] || null;
  return { nonBase, available, overriding, chosen };
}
// Axis/value pairs of the selected cell that override `prop` on `node`.
const overridesOf = (doc, nonBase, nodeId, prop) => nonBase.filter(([a, v]) => doc.variants?.[a]?.[v]?.[nodeId]?.[prop] !== undefined);

const err = (key) => {
  const e = ui.errors[key];
  if (!e) return '';
  return `<p class="field-error" id="err-${esc(key)}" role="alert">${esc(e.text)}${e.retry ? ` <button type="button" data-action="retry" data-key="${esc(key)}">Reload and retry</button>` : ''}</p>`;
};

// ---- small icons for segmented controls ----
const I = {
  row: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 8h11M10 5l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  column: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v11M5 10l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M2 8h7M2 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  center: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M4.5 8h7M3 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  right: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M7 8h7M4 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.200 12.500 8 12.500 1.500 8 1.500 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>',
  eyeoff: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8 12.200 12.500 8 12.500 1.500 8 1.500 8zM2.500 13.500l11-11" fill="none" stroke="currentColor" stroke-width="1.300" stroke-linecap="round"/></svg>',
  sides: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.500 6V2.500H6M10 2.500h3.500V6M13.500 10v3.500H10M6 13.500H2.500V10" fill="none" stroke="currentColor" stroke-width="1.300" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  reset: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 7.5a4.5 4.5 0 1 1 1.3 3.2M3.5 3.5v4h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---- values that are several words in CSS but one idea in the panel ----
const parseHex = (v) => {
  const m = typeof v === 'string' && v.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return { rgb: '#' + h.slice(0, 6).toLowerCase(), a: h.length === 8 ? Math.round(parseInt(h.slice(6), 16) * 100 / 255) : 100 };
};
const withAlpha = (rgb, a) => (a >= 100 || !/^#[0-9a-f]{6}$/i.test(rgb) ? rgb : rgb + Math.round(Math.max(0, a) * 255 / 100).toString(16).padStart(2, '0'));
const topSplit = (s, sep) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (d === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch))) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
function parseBorder(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return { w: v, s: 'solid', c: '#000000' };
  const t = topSplit(String(v)), w = t.find((x) => /^[\d.]+(px)?$/.test(x)), st = t.find((x) => /^(none|solid|dashed|dotted|double)$/.test(x));
  const c = t.filter((x) => x !== w && x !== st).join(' ');
  return { w: w ? parseFloat(w) : 1, s: st || 'solid', c: c || '#000000' };
}
function parseShadow(v) {
  if (typeof v !== 'string' || /inset/.test(v) || topSplit(v, ',').length > 1) return null;
  const t = topSplit(v), nums = t.filter((x) => /^-?[\d.]+(px)?$/.test(x)).map(parseFloat);
  if (nums.length < 2 || nums.length > 4) return null;
  return { x: nums[0], y: nums[1], b: nums[2] ?? 0, s: nums[3] ?? 0, c: t.filter((x) => !/^-?[\d.]+(px)?$/.test(x)).join(' ') || '#000000' };
}
// "8px 16px" -> [8, 16, 8, 16] (top right bottom left), or null when it is not plain px
function parseBox(v) {
  if (typeof v === 'number') return [v, v, v, v];
  if (typeof v !== 'string') return [0, 0, 0, 0];
  const t = topSplit(v);
  if (!t.length || t.length > 4 || !t.every((x) => /^-?[\d.]+(px)?$/.test(x))) return null;
  const n = t.map(parseFloat);
  return [n[0], n[1] ?? n[0], n[2] ?? n[0], n[3] ?? n[1] ?? n[0]];
}
// Font stacks read as a name, not as code: "Georgia, serif" shows Georgia.
const famName = (v) => String(v ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');
const GENERIC = ['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive'];
const COMMON = ['Inter Var', 'JB Mono', 'Georgia', 'Helvetica', 'Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', ...GENERIC];
function fontNames(ctx) {
  const set = new Set(COMMON);
  try { document.fonts.forEach((f) => set.add(f.family.replace(/^["']|["']$/g, ''))); } catch {}
  const walk = (n) => { if (n.style?.fontFamily) set.add(famName(n.style.fontFamily)); n.children?.forEach(walk); };
  for (const c of ctx.state.components.values()) if (c.doc) walk(c.doc.root);
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}
function stackFor(name, current) {
  if (GENERIC.includes(name)) return name;
  const tail = String(current ?? '').split(',').slice(1).join(',').trim();
  const q = /\s/.test(name) ? '"' + name + '"' : name;
  return tail ? q + ', ' + tail : q + ', ' + (/mono|code|courier/i.test(name) ? 'monospace' : /times|georgia|serif/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif');
}

export function renderPanel(ctx) {
  const el = document.querySelector('#panel');
  wire(ctx, el);
  if (ui.scrubbing) return;
  const sel = ctx.state.selection;
  const comp = sel && ctx.state.components.get(sel.component);
  const doc = comp?.doc;
  const node = doc && index(doc).byId.get(sel.node);
  if (!node && comp?.readOnly) {
    el.innerHTML = `<div class="selhead"><div class="crumb"><span class="chip" id="sel-component">${esc(comp.name)}</span><span class="mono" id="sel-node">${esc(sel.node)}</span></div></div><p class="hint" id="sel-readonly">read-only: ${esc(comp.readOnly)}</p>`;
    return;
  }
  if (!node && !ctx.state.components.size) {
    el.innerHTML = '<div class="empty-panel"><h2>Design</h2><p class="hint">Your selection’s properties appear here.</p></div>'; return;
  }
  if (!node) {
    el.innerHTML = `<div class="empty-panel"><svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><rect x="7" y="9" width="34" height="30" rx="5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 4"/><path d="M19 20l11 5-5 2-2 5z" fill="currentColor"/></svg>
      <h2>Nothing selected</h2><p class="hint">Click a layer or an element on the canvas. Shift-click or drag a box to select several.</p>
      <dl class="keys"><dt><kbd>⌘K</kbd></dt><dd>Jump to anything</dd><dt><kbd>Enter</kbd></dt><dd>Focus a component</dd><dt><kbd>⇧1</kbd></dt><dd>Fit everything</dd><dt><kbd>N</kbd></dt><dd>New component</dd><dt><kbd>Alt</kbd></dt><dd>Measure to hovered</dd></dl></div>`;
    return;
  }
  const selKey = `${sel.component}|${JSON.stringify(sel.variant)}`;
  const full = `${selKey}|${sel.node}`;
  if (ui.selKey !== selKey) { ui.selKey = selKey; ui.mode = 'base'; ui.axis = null; }
  if (el.dataset.full !== full) { el.dataset.full = full; ui.errors = {}; ui.draft = {}; ui.forms = {}; }

  const focus = document.activeElement && el.contains(document.activeElement) ? { id: document.activeElement.id, s: document.activeElement.selectionStart, e: document.activeElement.selectionEnd } : null;
  const dis = comp.readOnly ? ' disabled' : '';
  const t = target(doc, sel);
  const { byId } = index(doc);
  const nodes = ctx.state.selections.filter((s) => s.component === sel.component).map((s) => byId.get(s.node)).filter(Boolean);
  const multi = nodes.length > 1;
  const isText = nodes.length === 1 && node.tag !== 'img' && !node.children.length && (node.text !== undefined || !!node.textProp); // a text node: Layout and Size start collapsed
  const resolvedOf = (n) => (t.overriding ? resolveStyle(doc, n.id, sel.variant) : n.style || {});
  // One value for the control, or "mixed" when the selected nodes disagree.
  const val = (prop) => {
    const vals = nodes.map((n) => resolvedOf(n)[prop]);
    const first = vals[0];
    return { value: first, mixed: vals.some((v) => v !== first) };
  };
  const overOf = (prop) => (t.overriding ? nodes.flatMap((n) => overridesOf(doc, t.nonBase, n.id, prop)) : []);
  const tags = (prop, label) => {
    const over = overOf(prop);
    if (!over.length) return '';
    const where = esc([...new Set(over.map(([a, v]) => `${a}=${v}`))].join(', '));
    return `<span class="dot" id="dot-${prop}" role="img" aria-label="${esc(label)} is overridden in ${where}" title="Overridden in ${where}"></span><button type="button" class="reset" id="reset-${prop}" data-action="reset" data-prop="${prop}" aria-label="Reset ${esc(label)} to base" title="Reset to base"${dis}>${I.reset}</button>`;
  };
  const isOver = (prop) => overOf(prop).length > 0;

  // A text/number field with a label (drag it to scrub), a unit and the override dot.
  // Numbers are filled wells you can scrub; text is an outlined box. Units show only when the value is a plain number.
  const field = (prop, o = {}) => {
    const f = { ...F[prop], ...o }, { value, mixed } = val(prop);
    const shown = value === undefined || mixed ? '' : f.pct ? String(Math.round(Number(value) * 100)) : pxless(value, f.unit);
    const unit = f.unit && shown !== '' && NUMBER.test(shown) && !mixed ? `<span class="unit" aria-hidden="true">${f.unit}</span>` : '';
    const labelAttrs = f.scrub ? `class="flabel scrub" data-scrub="${prop}" title="Drag to change"` : 'class="flabel"';
    const sw = f.color ? `<label class="swatch"><input type="color" id="pick-${prop}" data-pick="${prop}" aria-label="Pick ${esc(f.label.toLowerCase())}"${dis}><span class="chipcolor" data-color="${esc(shown)}"></span></label>` : '';
    const list = prop === 'fontFamily' ? ' aria-haspopup="listbox" data-picker="font"' : '';
    return `<div class="f${isOver(prop) ? ' overridden' : ''}"><label ${labelAttrs} for="${prop}">${esc(f.label)}</label>
      <div class="fbox ${f.scrub ? 'num' : 'txt'}${f.color ? ' hascolor' : ''}">${sw}<input id="${prop}" data-field="${prop === 'fontFamily' ? 'family' : 'style'}" data-prop="${prop}" data-step="${f.scrub?.step ?? ''}"${f.scrub ? '' : ' data-text="1"'}${f.pct ? ' data-pct="1"' : ''}${list} autocomplete="off" spellcheck="false" value="${esc(prop === 'fontFamily' ? famName(shown) : shown)}" placeholder="${mixed ? 'Mixed' : f.placeholder ?? ''}"${mixed ? ' data-mixed="1"' : ''}${dis}>${unit}</div>
      <div class="ftags">${o.extra || ''}${tags(prop, f.label)}</div>${err('style-' + prop)}${err('reset-' + prop)}</div>`;
  };
  // A segmented control: one CSS property, a few values.
  const seg = (prop, label, opts, { aria, iconOnly } = {}) => {
    const { value, mixed } = val(prop);
    return `<div class="f${isOver(prop) ? ' overridden' : ''}"><span class="flabel" id="lbl-${prop}">${esc(label)}</span>
      <div class="seg" role="radiogroup" aria-labelledby="lbl-${prop}">${opts.map(([v, text, icon, match]) => `<button type="button" role="radio" id="seg-${prop}-${v}" aria-checked="${!mixed && (match ? match.test(String(value)) : value === v)}" data-seg="${prop}" data-val="${v}" title="${esc(aria?.[v] ?? text)}"${dis}>${icon || ''}<span${iconOnly ? ' class="sr"' : ''}>${esc(text)}</span></button>`).join('')}</div>
      <div class="ftags">${tags(prop, label)}</div>${err('style-' + prop)}${err('reset-' + prop)}</div>`;
  };
  // Width or height on ONE row: the mode (Hug / Fill / Fixed) and the value. The unit only shows when the size is a number.
  const sizeMode = (v) => (v === undefined || v === 'auto' || v === 'fit-content' || v === 'max-content' ? 'hug' : v === '100%' ? 'fill' : typeof v === 'number' || /^-?\d+(\.\d+)?px$/.test(String(v)) ? 'fixed' : 'custom');
  const size = (prop) => {
    const { value, mixed } = val(prop), mode = mixed ? '' : sizeMode(value);
    const shown = value === undefined || mixed ? '' : pxless(value, 'px');
    const isNum = NUMBER.test(shown);
    const opts = [['hug', 'Hug'], ['fill', 'Fill'], ['fixed', 'Fixed']];
    const name = prop === 'width' ? 'Width' : 'Height';
    return `<div class="f sizerow${isOver(prop) ? ' overridden' : ''}"><label class="flabel scrub" data-scrub="${prop}" for="${prop}" title="Drag to change ${name.toLowerCase()}">${name[0]}<span class="sr">${name.slice(1)}</span></label>
      <div class="seg sizeseg" role="radiogroup" aria-label="${name} sizing">${opts.map(([m, text]) => `<button type="button" role="radio" id="size-${prop}-${m}" aria-checked="${mode === m}" data-size="${prop}" data-mode="${m}" title="${m === 'hug' ? 'Hug contents (auto)' : m === 'fill' ? 'Fill the parent (100%)' : 'Fixed size in px'}"${dis}><span>${text}</span></button>`).join('')}</div>
      <div class="fbox num"><input id="${prop}" data-field="style" data-prop="${prop}" data-step="1" autocomplete="off" spellcheck="false" value="${esc(shown)}" placeholder="${mixed ? 'Mixed' : mode === 'fill' ? '100%' : 'Auto'}" aria-label="${name}"${mixed ? ' data-mixed="1"' : ''}${dis}>${isNum && !mixed ? '<span class="unit" aria-hidden="true">px</span>' : ''}</div>
      <div class="ftags">${tags(prop, name)}</div>${err('style-' + prop)}${err('reset-' + prop)}</div>`;
  };
  const section = (id, title, body, { open = true } = {}) => `<details class="sec" data-sec="${id}"${(ui.closed.has(id) ? false : ui.opened.has(id) ? true : open) ? ' open' : ''}><summary>${title}</summary><div class="sbody">${body}</div></details>`;
  const has = (prop) => nodes.some((n) => resolvedOf(n)[prop] !== undefined);
  // An optional section (fill, stroke, shadow): present = its own section; absent = a chip in one "Add" row, so empty sections take no room.
  const addChips = [];
  const addBtn = (id, label, props, def) => `<button type="button" class="addchip" id="add-${id}" data-action="set-prop" data-props="${props.join(',')}" data-def="${esc(def)}" aria-label="Add ${label.toLowerCase()}" title="Add ${label.toLowerCase()}"${dis}>+ ${label}</button>`;
  const optSection = (id, title, props, present, body, def, { force = false, always = '' } = {}) => {
    if (!present && !force) { addChips.push(addBtn(id, title, props, def)); return ''; }
    return section(id, title, (present ? body : `<div class="none"><span class="hint">None on this side.</span>${addBtn(id, title, props, def)}</div>`) + always);
  };
  // swatch | hex | opacity % in ONE field, then the eye and a minus at the row's end (like Figma's fill row).
  const colorRow = (group, idBase, value, { eye, alphaId, remove } = {}) => {
    const px = parseHex(value);
    const hex = px ? px.rgb : value ?? '';
    return `<div class="crow"><div class="fbox txt hascolor colorbox"><label class="swatch"><input type="color" id="pick-${idBase}" data-pick="${idBase}" data-group="${group}" aria-label="Pick colour"${dis}><span class="chipcolor" data-color="${esc(hex)}"></span></label>
      <input id="${idBase}" data-field="part" data-group="${group}" data-part="c" data-text="1" autocomplete="off" spellcheck="false" value="${esc(hex)}" placeholder="None" aria-label="Colour"${dis}>
      <span class="vdiv" aria-hidden="true"></span><input class="alpha" id="${alphaId}" data-field="part" data-group="${group}" data-part="a" data-step="1" data-prop="${alphaId}" autocomplete="off" value="${px ? px.a : 100}" aria-label="Opacity"${px ? '' : ' disabled'}${dis}><span class="unit" aria-hidden="true">%</span></div>
      ${eye ? `<button type="button" class="rowbtn" id="eye-${group}" data-action="toggle-eye" data-group="${group}" aria-pressed="${!eye.off}" aria-label="${eye.off ? 'Show' : 'Hide'} ${group}" title="${eye.off ? 'Show' : 'Hide'}"${dis}>${eye.off ? I.eyeoff : I.eye}</button>` : '<span></span>'}
      ${remove ? `<button type="button" class="rowbtn" id="remove-${remove.id}" data-action="clear-prop" data-props="${remove.props.join(',')}" aria-label="Remove ${group}" title="Remove"${dis}>−</button>` : ''}</div>`;
  };
  const part = (group, id, label, value, o = {}) => `<div class="f"><label class="flabel scrub" data-scrub="${id}" title="Drag to change" for="${id}">${label}</label><div class="fbox num"><input id="${id}" data-field="part" data-group="${group}" data-part="${o.part ?? id}" data-prop="${id}" data-step="${o.step ?? 1}" autocomplete="off" spellcheck="false" value="${esc(value ?? '')}" placeholder="${o.ph ?? '0'}"${dis}>${value !== '' && value !== undefined ? '<span class="unit" aria-hidden="true">px</span>' : ''}</div></div>`;
  const linkBtn = (which, on, label) => `<button type="button" class="linkbtn" id="${which}-sides" data-action="toggle-sides" data-which="${which}" aria-pressed="${on}" aria-label="${label}" title="${label}"${dis}>${I.sides}</button>`;
  const boxOf = (prop) => { const { value, mixed } = val(prop); return mixed ? null : parseBox(value); };

  // ---- Layout ----
  const disp = val('display').value;
  const isFlex = /flex/.test(String(disp)), isGrid = disp === 'grid';
  const dir = val('flexDirection').value === 'column' ? 'column' : 'row';
  const justify = val('justifyContent'), alignI = val('alignItems');
  const matrix = isFlex ? `<div class="amatrix" role="group" aria-label="Alignment">${[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => {
    const [mainI, crossI] = dir === 'row' ? [c, r] : [r, c];
    const on = !justify.mixed && !alignI.mixed && (justify.value ?? 'flex-start') === ALIGN[mainI] && alignI.value === ALIGN[crossI];
    return `<button type="button" id="align-${r}${c}" data-align="${mainI},${crossI}" aria-pressed="${on}" aria-label="Align ${AL_NAME[r][c]}" title="Align ${AL_NAME[r][c]}"${dis}><i></i></button>`;
  })).join('')}</div>` : '';
  const padSides = ui.sides.pad, radSides = ui.sides.rad;
  const pb = padSides ? boxOf('padding') : null, rb = radSides ? boxOf('borderRadius') : null;
  const sidesFields = (group, b, labels, ids, unsupported) => (b
    ? `<div class="pair sides">${ids.map((id, i) => part(group, id, labels[i], String(b[i]), { part: String(i) })).join('')}</div>`
    : `<p class="hint">${unsupported}</p>`);
  const layout = section('layout', 'Layout',
    seg('display', 'Display', [['block', 'Block'], ['flex', 'Flex', '', /flex/], ['grid', 'Grid']])
    + (isFlex ? seg('flexDirection', 'Direction', [['row', 'Row', I.row, /^(row|undefined)$/], ['column', 'Column', I.column]]) : '')
    + (isFlex ? `<div class="alignrow"><div class="f stackf"><span class="flabel" id="lbl-align">Align</span>${matrix}</div><div class="stack">${field('gap')}${field('padding', { extra: linkBtn('pad', padSides, 'Padding per side') })}</div></div>${err('align')}`
      : (isGrid ? field('gap') : '') + field('padding', { extra: linkBtn('pad', padSides, 'Padding per side') }))
    + (padSides ? sidesFields('pad', pb, ['Top', 'Right', 'Bottom', 'Left'], ['pad-t', 'pad-r', 'pad-b', 'pad-l'], 'Per-side editing needs px values; use the Padding field.') : ''), { open: !isText });
  const sizeSec = section('size', 'Size', size('width') + size('height'), { open: !isText });
  const look = section('appearance', 'Appearance', field('opacity') + field('borderRadius', { extra: linkBtn('rad', radSides, 'Radius per corner') })
    + (radSides ? sidesFields('rad', rb, ['Top left', 'Top right', 'Bottom right', 'Bottom left'], ['rad-tl', 'rad-tr', 'rad-br', 'rad-bl'], 'Per-corner editing needs px values; use the Corner radius field.') : ''));
  // Fill
  const bgv = val('background');
  const fillOff = bgv.value === 'transparent';
  const fill = optSection('fill', 'Fill', ['background'], has('background'),
    `<div class="f colorf${isOver('background') ? ' overridden' : ''}">${colorRow('fill', 'background', bgv.mixed ? '' : String(fillOff ? ui.lastFill ?? '#d9d9d9' : bgv.value ?? ''), { eye: { off: fillOff }, alphaId: 'fill-a', remove: { id: 'fill', props: ['background'] } })}<div class="ftags">${tags('background', 'Fill')}</div>${err('style-background')}${err('reset-background')}</div>`, '#d9d9d9');
  // Stroke (border): colour, opacity, width and style compose ONE css line: border, or one side of it
  const sideProp = 'border' + ui.side;
  const bv = val(sideProp), bp = parseBorder(bv.value);
  const strokeOff = bp?.s === 'none';
  const strokeProps = ui.side ? [sideProp] : ALLBORDERS;
  const sideIcon = (v) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>${{ '': '<rect x="3" y="3" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>', Top: '<path d="M3 3h10" stroke="currentColor" stroke-width="2.2"/>', Right: '<path d="M13 3v10" stroke="currentColor" stroke-width="2.2"/>', Bottom: '<path d="M3 13h10" stroke="currentColor" stroke-width="2.2"/>', Left: '<path d="M3 3v10" stroke="currentColor" stroke-width="2.2"/>' }[v]}</svg>`;
  const strokeSides = `<div class="f"><span class="flabel" id="lbl-side">Sides</span><div class="seg small icons" role="radiogroup" aria-labelledby="lbl-side">${[['', 'All sides'], ['Top', 'Top'], ['Right', 'Right'], ['Bottom', 'Bottom'], ['Left', 'Left']].map(([v, name]) => `<button type="button" role="radio" title="${name}" aria-label="${name}" id="side-${v || 'all'}" aria-checked="${ui.side === v}" data-action="stroke-side" data-side="${v}">${sideIcon(v)}</button>`).join('')}</div></div>`;
  const stroke = optSection('stroke', 'Stroke', strokeProps, strokeProps.some(has),
    `<div class="f colorf${isOver(sideProp) ? ' overridden' : ''}">${colorRow('stroke', 'stroke-color', bp ? bp.c : '', { eye: { off: strokeOff }, alphaId: 'stroke-a', remove: { id: 'stroke', props: strokeProps } })}<div class="ftags">${tags(sideProp, 'Stroke')}</div>${err('style-' + sideProp)}${err('reset-' + sideProp)}</div>
     <div class="pair">${part('stroke', 'stroke-w', 'Width', bp ? String(bp.w) : '', { part: 'w', ph: '1' })}<div class="f"><label class="flabel" for="stroke-s">Style</label><div class="fbox sel"><select id="stroke-s" data-field="part" data-group="stroke" data-part="s"${dis}>${['solid', 'dashed', 'dotted', 'none'].map((s) => `<option${bp?.s === s ? ' selected' : ''}>${s}</option>`).join('')}</select></div></div></div>
`, '1px solid #1f2937', { force: !!ui.side, always: strokeSides });
  // Effects: one drop shadow = x y blur spread colour, ONE css line
  const sv = val('boxShadow'), sp = parseShadow(sv.value);
  const effects = optSection('effects', 'Shadow', ['boxShadow'], has('boxShadow'),
    sp || sv.value === undefined || sv.mixed ? `<div class="f colorf${isOver('boxShadow') ? ' overridden' : ''}">${colorRow('shadow', 'shadow-color', sp ? sp.c : '', { alphaId: 'shadow-a', remove: { id: 'effects', props: ['boxShadow'] } })}<div class="ftags">${tags('boxShadow', 'Shadow')}</div>${err('style-boxShadow')}${err('reset-boxShadow')}</div>
      <div class="pair">${part('shadow', 'shadow-x', 'X', sp ? String(sp.x) : '', { part: 'x' })}${part('shadow', 'shadow-y', 'Y', sp ? String(sp.y) : '', { part: 'y' })}</div>
      <div class="pair">${part('shadow', 'shadow-blur', 'Blur', sp ? String(sp.b) : '', { part: 'b' })}${part('shadow', 'shadow-spread', 'Spread', sp ? String(sp.s) : '', { part: 's' })}</div>`
      : `<p class="hint">This shadow has several layers or an inset; edit it as text.</p><div class="f"><label class="flabel" for="boxShadow">CSS</label><div class="fbox txt"><input id="boxShadow" data-field="style" data-prop="boxShadow" data-text="1" value="${esc(sv.value)}"${dis}></div>${err('style-boxShadow')}</div>`,
    '0px 2px 6px 0px #00000040');
  const wt = val('fontWeight');
  const typeSec = section('type', 'Text',
    field('fontFamily') + `<div class="pair">${field('fontSize')}${(() => `<div class="f"><label class="flabel" for="fontWeight">Weight</label><div class="fbox sel"><select id="fontWeight" data-field="weight"${dis}>${wt.mixed ? '<option value="" selected>Mixed</option>' : ''}${wt.value === undefined ? '<option value="" selected>Inherit</option>' : ''}${[...new Set([...(wt.value !== undefined && !WEIGHTS.includes(Number(wt.value)) ? [wt.value] : []), ...WEIGHTS])].map((w) => `<option value="${w}"${!wt.mixed && String(wt.value) === String(w) ? ' selected' : ''}>${w}</option>`).join('')}</select></div><div class="ftags">${tags('fontWeight', 'Weight')}</div>${err('style-fontWeight')}</div>`)()}</div>`
    + `<div class="pair">${field('lineHeight')}${field('letterSpacing')}</div>`
    + seg('textAlign', 'Align', [['left', 'Left', I.left], ['center', 'Center', I.center], ['right', 'Right', I.right]], { iconOnly: true }) + field('color'));

  const addRow = addChips.length ? `<div class="addrow"><span class="flabel">Add</span>${addChips.join('')}</div>` : '';

  // ---- Content: text, setting binding, image attributes ----
  let content = '';
  const single = nodes.length === 1;
  if (single && node.tag === 'img') {
    content = section('content', 'Image', `<div class="f"><label class="flabel" for="src">Source</label><div class="fbox"><input id="src" data-field="attr" data-attr="src" autocomplete="off" value="${esc(node.attrs?.src ?? '')}"${dis}></div>${err('attr-src')}</div>
      <div class="f"><label class="flabel" for="alt">Alt text</label><div class="fbox"><input id="alt" data-field="attr" data-attr="alt" autocomplete="off" value="${esc(node.attrs?.alt ?? '')}"${dis}></div>${err('attr-alt')}</div>`);
  } else if (single && !node.children.length) {
    const bound = node.textProp;
    content = section('content', 'Content', `${bound
      ? `<p class="shows" id="shows">shows <code>${esc(bound)}</code> <button type="button" class="btn" id="unbind" data-action="unbind"${dis}>Unbind</button></p>`
      : `<div class="f"><label class="flabel" for="text">Text</label><div class="fbox"><input id="text" data-field="text" autocomplete="off" value="${esc(node.text ?? '')}"${dis}></div></div>
         ${ui.forms.bind
           ? `<form data-submit="bind" class="inline"><label for="bind-prop">Setting name</label><input id="bind-prop" autocomplete="off" value="${esc(ui.draft['bind-prop'] ?? (/^[a-z][a-zA-Z0-9]*$/.test(node.id) ? node.id : 'text'))}"${dis}><div class="row2"><button type="submit" class="btn primary" id="bind-submit"${dis}>Bind</button><button type="button" class="btn" data-action="close" data-form="bind">Cancel</button></div></form>`
           : `<button type="button" class="btn" id="make-setting" data-action="open" data-form="bind"${dis}>Make setting</button>`}`}
      ${err('text')}${err('bind')}`);
  }

  // ---- Advanced: every CSS property the design controls don't cover ----
  const resolvedAll = nodes.length ? resolvedOf(nodes[0]) : {};
  const extra = [...new Set(nodes.flatMap((n) => Object.keys(resolvedOf(n))))].filter((p) => !DESIGN.has(p));
  const advRow = (prop) => {
    const { value, mixed } = val(prop), shown = value === undefined ? '' : String(value);
    return `<div class="f${isOver(prop) ? ' overridden' : ''}"><label class="flabel mono" for="${prop}">${esc(prop)}</label><div class="fbox"><input id="${prop}" data-field="style" data-prop="${prop}" data-text="1" autocomplete="off" spellcheck="false" value="${esc(shown)}" placeholder="${mixed ? 'Mixed' : ''}"${dis}></div><div class="ftags">${tags(prop, prop)}</div>${err('style-' + prop)}${err('reset-' + prop)}</div>`;
  };
  const advanced = `<details class="sec adv" data-sec="advanced"${ui.advanced ? ' open' : ''}><summary>Advanced: all CSS</summary><div class="sbody">${extra.map(advRow).join('')}
    ${ui.forms.style ? `<form data-submit="add-style" class="inline"><label for="new-style-name">Property</label><input id="new-style-name" placeholder="boxShadow" autocomplete="off"${dis}><label for="new-style-value">Value</label><input id="new-style-value" autocomplete="off"${dis}><div class="row2"><button type="submit" class="btn primary" id="add-style-submit"${dis}>Add</button><button type="button" class="btn" data-action="close" data-form="style">Cancel</button></div></form>`
    : `<button type="button" class="btn" id="add-style" data-action="open" data-form="style"${dis}>+ property</button>`}${err('add-style')}</div></details>`;
  void resolvedAll;

  // ---- Where do edits go? One compact row: "Editing  Base v", with the explanation behind an info button ----
  const explain = t.available ? (t.overriding ? `Edits go to ${esc(t.chosen[0])}=${esc(t.chosen[1])} only. Everything else keeps the base value.` : 'Edits go to the base and reach every variant that does not override them.')
    : (Object.keys(sel.variant || {}).length ? 'This cell is all base values, so there is no override to make. Edits go to the base.' : 'This component has no variants yet. Edits go to the base.');
  const scope = `<div class="scope"><div class="scoperow"><label class="flabel" for="scope">Editing</label>
      <div class="fbox sel"><select id="scope" name="target" title="${t.available ? esc('Base, or this variant: ' + t.nonBase.map(([a, v]) => a + '=' + v).join(', ')) : 'Base'}"${dis}><option value="base"${t.overriding ? '' : ' selected'}>Base</option><option value="variant"${t.overriding ? ' selected' : ''}${t.available ? '' : ' disabled'}>This variant${t.available ? ` · ${esc(t.nonBase.map(([a, v]) => a + '=' + v).join(', '))}` : ''}</option></select></div>
      <button type="button" class="infobtn" id="scope-info" data-action="info" aria-expanded="${ui.info}" aria-controls="target-note" aria-label="What does this mean?" title="What does this mean?">i</button></div>
      ${t.overriding && t.nonBase.length > 1 ? `<div class="scoperow"><label class="flabel" for="override-axis">Variant</label><div class="fbox sel"><select id="override-axis">${t.nonBase.map(([a, v]) => `<option value="${esc(a)}"${t.chosen[0] === a ? ' selected' : ''}>${esc(a)}=${esc(v)}</option>`).join('')}</select></div></div>` : ''}
      <p class="hint info" id="target-note"${ui.info ? '' : ' hidden'}>${explain}</p>
      ${t.overriding && t.nonBase.length === 1 ? `<span class="sr" id="override-note">Overrides ${esc(t.chosen[0])}=${esc(t.chosen[1])}.</span>` : ''}
    </div>`;

  // ---- Settings (props) and Variants: the component, not the node ----
  const propRows = doc.props.map((p) => {
    const def = p.type === 'boolean'
      ? `<input type="checkbox" id="propdef-${p.name}" data-field="propdef" data-prop="${p.name}"${p.default ? ' checked' : ''}${dis} aria-label="default of ${esc(p.name)}">`
      : p.type === 'string'
        ? `<input id="propdef-${p.name}" data-field="propdef" data-prop="${p.name}" autocomplete="off" value="${esc(p.default ?? '')}"${dis} aria-label="default of ${esc(p.name)}">`
        : `<span id="propdef-${p.name}" class="mono">${esc(p.default)} (base)</span>`;
    return `<li><div class="prop"><strong>${esc(p.name)}</strong><span class="mono">${p.type}${p.options ? ': ' + esc(p.options.join(' | ')) : ''}</span>
      <button type="button" class="x" id="remove-prop-${p.name}" data-action="remove-prop" data-prop="${p.name}" aria-label="Remove setting ${esc(p.name)}" title="Remove"${dis}>×</button></div>
      <div class="f"><span class="flabel">Default</span><div class="fbox">${def}</div></div>${err('prop-' + p.name)}${err('propdef-' + p.name)}</li>`;
  }).join('');
  const propsUi = section('props', 'Settings', `${propRows ? `<ul class="plain" id="props">${propRows}</ul>` : '<p class="hint">No settings yet.</p>'}
    ${ui.forms.prop
      ? `<form data-submit="add-prop" class="inline"><label for="new-prop-name">Name</label><input id="new-prop-name" autocomplete="off"${dis}>
          <label for="new-prop-type">Type</label><select id="new-prop-type"${dis}><option>string</option><option>boolean</option><option>enum</option></select>
          <label for="new-prop-options">Options (enum, comma separated)</label><input id="new-prop-options" autocomplete="off"${dis}>
          <div class="row2"><button type="submit" class="btn primary" id="add-prop-submit"${dis}>Add</button><button type="button" class="btn" data-action="close" data-form="prop">Cancel</button></div></form>`
      : `<button type="button" class="btn" id="add-prop" data-action="open" data-form="prop"${dis}>+ setting</button>`}${err('add-prop')}`);

  const axisUi = axes(doc).map((a) => `<div class="axis" data-axis="${esc(a.name)}"><h3>${esc(a.name)}</h3>
      <ul class="plain chips">${a.options.map((o) => {
        const isBase = o === a.default;
        return `<li><span>${esc(o)}</span>${isBase ? '<span class="badge">base</span>' : ''}<button type="button" class="x" id="remove-value-${a.name}-${o}" data-action="remove-value" data-axis="${esc(a.name)}" data-value="${esc(o)}"${isBase ? ` disabled title="${esc(o)} is the base of ${esc(a.name)}, so it can't be removed" aria-label="Remove ${esc(o)} (it is the base, so it can't be removed)"` : ` aria-label="Remove ${esc(o)}"`}${dis}>×</button></li>`;
      }).join('')}</ul>
      ${ui.forms['value:' + a.name]
        ? `<form data-submit="add-value" data-axis="${esc(a.name)}" class="inline"><label for="new-value-${a.name}">New ${esc(a.name)} value</label><input id="new-value-${a.name}" autocomplete="off"${dis}><div class="row2"><button type="submit" class="btn primary" id="add-value-submit-${a.name}"${dis}>Add</button><button type="button" class="btn" data-action="close" data-form="value:${esc(a.name)}">Cancel</button></div></form>`
        : `<button type="button" class="btn small" id="add-value-${a.name}" data-action="open" data-form="value:${esc(a.name)}"${dis}>+ value</button>`}
      ${err('axis-' + a.name)}</div>`).join('');
  const variantsUi = section('variants', 'Variants', `${axisUi || '<p class="hint">No variant axes yet.</p>'}
    ${ui.forms.axis
      ? `<form data-submit="add-axis" class="inline"><label for="new-axis-name">Axis name</label><input id="new-axis-name" placeholder="size" autocomplete="off"${dis}>
          <label for="new-axis-value">First value</label><input id="new-axis-value" placeholder="sm" autocomplete="off"${dis}>
          <label for="new-axis-base">Base value</label><input id="new-axis-base" placeholder="default" autocomplete="off"${dis}>
          <div class="row2"><button type="submit" class="btn primary" id="add-axis-submit"${dis}>Add</button><button type="button" class="btn" data-action="close" data-form="axis">Cancel</button></div></form>`
      : `<button type="button" class="btn" id="add-axis" data-action="open" data-form="axis"${dis}>+ axis</button>`}${err('add-axis')}`);

  el.innerHTML = `<div class="selhead"><div class="crumb"><span class="chip" id="sel-component">${esc(comp.name)}</span><span class="sep" aria-hidden="true">›</span><span class="mono" id="sel-node">${esc(node.id)} &lt;${esc(node.tag)}&gt;${multi ? ` <b class="more">+${nodes.length - 1}</b>` : ''}</span></div>
    <dl class="selmeta"><dt>Variant</dt><dd id="sel-variant">${esc(variantLabel(sel.variant))}</dd><dt class="sr">Editing</dt><dd class="sr" id="sel-target">${t.overriding ? `override ${esc(t.chosen[0])}=${esc(t.chosen[1])}` : 'Base'}</dd></dl>
    ${multi ? `<p class="hint multi" id="sel-multi">${nodes.length} layers selected. Fields show Mixed where they differ; a change applies to all of them in one edit.</p>` : ''}
    ${comp.readOnly ? `<p class="hint" id="sel-readonly">read-only: ${esc(comp.readOnly)}</p>` : ''}
    ${scope}</div>
    ${isText ? typeSec + look + fill + stroke + effects + addRow + layout + sizeSec : layout + sizeSec + look + fill + stroke + effects + addRow + typeSec}${content}${advanced}
    <div class="grouphead">Component</div>${propsUi}${variantsUi}`;

  // swatches show the colour the field holds
  for (const sw of el.querySelectorAll('.chipcolor')) {
    const v = sw.dataset.color;
    sw.style.background = v || 'transparent';
    const pick = sw.parentElement.querySelector('input');
    const probe = getComputedStyle(sw).backgroundColor;
    const m = probe.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3 && !/^rgba\(0, 0, 0, 0\)$/.test(probe)) pick.value = '#' + m.slice(0, 3).map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('');
    sw.parentElement.classList.toggle('empty', !v);
  }
  for (const [id, v] of Object.entries(ui.draft)) {
    const f = el.querySelector('#' + CSS.escape(id));
    if (f && 'value' in f && f.type !== 'checkbox') f.value = v;
  }
  if (focus?.id) {
    const f = el.querySelector('#' + CSS.escape(focus.id));
    if (f) { f.focus({ preventScroll: true }); try { f.setSelectionRange(focus.s, focus.e); } catch {} }
  }
}

function wire(ctx, el) {
  if (el.dataset.wired) return;
  el.dataset.wired = '1';
  const rerender = () => renderPanel(ctx);
  const curDoc = () => { const s = ctx.state.selection; return s && ctx.state.components.get(s.component)?.doc; };
  const selNodes = () => ctx.state.selections.filter((s) => s.component === ctx.state.selection?.component).map((s) => s.node);

  // Sends a batch; shows the store's error at `key`. A success clears the error and the listed drafts and
  // closes the listed forms (the canvas re-render that follows redraws the panel).
  async function run(key, component, edits, { clear = [], close = [] } = {}) {
    let r;
    try { r = await ctx.sendEdits(component, edits); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (r.ok) {
      delete ui.errors[key];
      clear.forEach((id) => delete ui.draft[id]);
      close.forEach((f) => delete ui.forms[f]);
      setTimeout(rerender, 0); // the SSE render redraws; redraw now too in case this batch changed no visible state
    } else {
      ui.errors[key] = { text: r.error, retry: /^stale revision/.test(r.error) ? { component, edits, opts: { clear, close } } : null };
      rerender();
    }
    return r;
  }

  // One property for every selected node, written to the base or to the chosen override: one batch.
  function styleEdits(props) {
    const s = ctx.state.selection, doc = curDoc(), tg = target(doc, s), edits = [];
    for (const [prop, value] of props) {
      for (const node of selNodes()) {
        const edit = { op: 'set', path: `${node}.${prop}`, value };
        if (tg.overriding) {
          if (value === null) {
            const over = overridesOf(doc, tg.nonBase, node, prop);
            const [axis, val] = over.find(([a]) => a === tg.chosen[0]) || over[0] || [];
            if (!axis) continue; // nothing to clear in this variant
            edit.variant = { [axis]: val };
          } else edit.variant = { [tg.chosen[0]]: tg.chosen[1] };
        }
        edits.push(edit);
      }
    }
    return edits;
  }
  // Compound controls (stroke, shadow, fill with alpha, per-side padding) are several inputs written as ONE css value.
  const qv = (id) => el.querySelector('#' + CSS.escape(id))?.value.trim() ?? '';
  const nv = (id, d = 0) => { const n = parseFloat(qv(id)); return Number.isFinite(n) ? n : d; };
  const colorOf = (colorId, alphaId) => {
    const c = qv(colorId), px = parseHex(c);
    if (!c) return '';
    return px && c.length === 9 ? c : withAlpha(px?.rgb ?? c, nv(alphaId, 100));
  };
  const box = (ids) => { const n = ids.map((i) => nv(i)); return n.every((x) => x === n[0]) ? n[0] : n.map((x) => `${x}px`).join(' '); };
  function readGroup(g) {
    if (g === 'fill') return { prop: 'background', value: colorOf('background', 'fill-a') || null };
    if (g === 'stroke') return { prop: 'border' + ui.side, value: `${nv('stroke-w', 1)}px ${qv('stroke-s') || 'solid'} ${colorOf('stroke-color', 'stroke-a') || '#000000'}` };
    if (g === 'shadow') return { prop: 'boxShadow', value: `${nv('shadow-x')}px ${nv('shadow-y')}px ${nv('shadow-blur')}px ${nv('shadow-spread')}px ${colorOf('shadow-color', 'shadow-a') || '#000000'}` };
    if (g === 'pad') return { prop: 'padding', value: box(['pad-t', 'pad-r', 'pad-b', 'pad-l']) };
    if (g === 'rad') return { prop: 'borderRadius', value: box(['rad-tl', 'rad-tr', 'rad-br', 'rad-bl']) };
    return null;
  }
  const commitGroup = (g, ids) => { const r = readGroup(g); return commit(r.prop, r.value, ids ?? r.prop); };
  const curVal = (prop) => { const s = ctx.state.selection, doc = curDoc(); if (!s || !doc) return undefined; const n = index(doc).byId.get(s.node); return (target(doc, s).overriding ? resolveStyle(doc, s.node, s.variant) : n?.style || {})[prop]; };
  async function commit(prop, raw, id) {
    const s = ctx.state.selection;
    if (!s) return;
    let v = typeof raw === 'string' ? toValue(raw) : raw;
    if (prop === 'opacity' && typeof v === 'number') v = Math.round(v) / 100; // the panel shows percent, the file holds 0..1
    else if (typeof v === 'number' && F[prop]?.unit === 'px' && /^-?\d*\.?\d+px$/.test(String(curVal(prop)))) v = `${v}px`; // keep '16px' a string, as the file had it
    const edits = styleEdits([[prop, v]]);
    if (!edits.length) { delete ui.draft[id ?? prop]; rerender(); return; }
    await run('style-' + prop, s.component, edits, { clear: [id ?? prop] });
  }

  el.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.pick) {
      const txt = el.querySelector('#' + CSS.escape(t.dataset.pick)); if (txt) txt.value = t.value;
      if (t.dataset.group) { const r = readGroup(t.dataset.group); preview(r.prop, r.value); } else preview(t.dataset.pick, t.value);
      return;
    }
    if (t.id && t.type !== 'checkbox' && t.type !== 'radio' && t.type !== 'color') ui.draft[t.id] = t.value;
  });
  // only a person's click or key on a summary counts as a choice; a redraw inserting <details> also fires toggle
  let userToggle = 0;
  el.addEventListener('pointerdown', (ev) => { if (ev.target.closest?.('summary')) userToggle = Date.now(); }, true);
  el.addEventListener('keydown', (ev) => { if (ev.target.matches?.('summary')) userToggle = Date.now(); }, true);
  el.addEventListener('click', (ev) => { if (ev.target.closest?.('summary')) userToggle = Date.now(); }, true);
  el.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d.matches?.('details.sec') || Date.now() - userToggle > 500) return;
    const id = d.dataset.sec;
    if (id === 'advanced') ui.advanced = d.open; else if (d.open) { ui.closed.delete(id); ui.opened.add(id); } else { ui.closed.add(id); ui.opened.delete(id); }
  }, true);

  el.addEventListener('change', async (ev) => {
    const t = ev.target, s = ctx.state.selection, doc = curDoc();
    if (!s || !doc) return;
    if (t.name === 'target') { ui.mode = t.value; rerender(); return; }
    if (t.id === 'override-axis') { ui.axis = t.value; rerender(); return; }
    if (t.dataset.pick) { if (t.dataset.group) { const txt = el.querySelector('#' + CSS.escape(t.dataset.pick)); if (txt) txt.value = t.value; await commitGroup(t.dataset.group, t.dataset.pick); } else await commit(t.dataset.pick, t.value, t.dataset.pick); return; }
    const field = t.dataset.field;
    if (field === 'part') await commitGroup(t.dataset.group, t.id);
    else if (field === 'family') {
      const name = t.value.trim(), cur = curVal('fontFamily');
      if (name === famName(cur)) { rerender(); return; }
      await commit('fontFamily', name ? stackFor(name, cur) : null, t.id);
    }
    else if (field === 'style') await commit(t.dataset.prop, t.value, t.id);
    else if (field === 'weight') { if (t.value) await commit('fontWeight', Number(t.value), t.id); }
    else if (field === 'text') await run('text', s.component, [{ op: 'set', path: `${s.node}.text`, value: t.value === '' ? null : t.value }], { clear: [t.id] });
    else if (field === 'attr') await run('attr-' + t.dataset.attr, s.component, [{ op: 'set', path: `${s.node}.@${t.dataset.attr}`, value: t.value === '' ? null : t.value }], { clear: [t.id] });
    else if (field === 'propdef') {
      const p = propOf(doc, t.dataset.prop);
      if (!p) return;
      const value = p.type === 'boolean' ? t.checked : t.value;
      await run('propdef-' + p.name, s.component, [{ op: 'setDefault', name: p.name, value: value === '' ? null : value }], { clear: [t.id] });
    }
  });

  // Arrow keys nudge a number field (Shift = x10, Alt = x0.1); a short pause commits one edit.
  let nudgeTimer = 0;
  el.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t.matches?.('input[data-step]') && t.dataset.step && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ev.ctrlKey && !ev.metaKey) {
      const o = scrubOf(t.dataset.prop, t.value);
      const step = o.step * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1) * (ev.key === 'ArrowUp' ? 1 : -1);
      const next = bump(t.value || '0', step, o);
      if (next === null) return;
      ev.preventDefault();
      t.value = next; ui.draft[t.id] = next;
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => t.dispatchEvent(new Event('change', { bubbles: true })), 350);
    } else if (ev.key === 'Escape' && t.matches?.('#panel input[data-field]')) { delete ui.draft[t.id]; rerender(); }
  });

  el.addEventListener('click', async (ev) => {
    const s = ctx.state.selection, doc = curDoc();
    if (!s || !doc) return;
    const seg = ev.target.closest('button[data-seg]');
    if (seg) { await commit(seg.dataset.seg, seg.dataset.val); return; }
    const sz = ev.target.closest('button[data-size]');
    if (sz) {
      const prop = sz.dataset.size, mode = sz.dataset.mode;
      let value = mode === 'hug' ? 'auto' : mode === 'fill' ? '100%' : null;
      if (mode === 'fixed') {
        const n = ctx.stage.selectedElement(s);
        const z = ctx.state.zoom || 1;
        const r = n?.getBoundingClientRect();
        value = r ? Math.round((prop === 'width' ? r.width : r.height) / z) : 100;
      }
      await commit(prop, value);
      return;
    }
    const act = ev.target.closest('button[data-action]');
    if (act && ['info', 'toggle-sides', 'stroke-side', 'toggle-eye', 'set-prop', 'clear-prop'].includes(act.dataset.action)) {
      const a = act.dataset.action;
      if (a === 'info') { ui.info = !ui.info; rerender(); }
      else if (a === 'toggle-sides') { ui.sides[act.dataset.which] = !ui.sides[act.dataset.which]; rerender(); }
      else if (a === 'stroke-side') { ui.side = act.dataset.side; rerender(); }
      else if (a === 'toggle-eye') {
        const g = act.dataset.group;
        if (g === 'fill') { const cur = curVal('background'); if (cur === 'transparent') await commit('background', ui.lastFill ?? '#d9d9d9'); else { ui.lastFill = cur; await commit('background', 'transparent'); } }
        else if (g === 'stroke') { const sel2 = el.querySelector('#stroke-s'); if (sel2.value === 'none') sel2.value = ui.lastStyle || 'solid'; else { ui.lastStyle = sel2.value; sel2.value = 'none'; } await commitGroup('stroke', 'stroke-s'); }
      } else {
        const props = act.dataset.props.split(',');
        const main = props[0] === 'border' ? 'border' + ui.side : props[0];
        if (a === 'set-prop') await commit(main, act.dataset.def, main);
        else { const edits = styleEdits(props.map((p) => [p, null])); if (edits.length) await run('style-' + props[0], s.component, edits, { clear: props }); }
      }
      return;
    }
    const al = ev.target.closest('button[data-align]');
    if (al) {
      const [mainI, crossI] = al.dataset.align.split(',').map(Number);
      const edits = styleEdits([['justifyContent', ALIGN[mainI]], ['alignItems', ALIGN[crossI]]]);
      await run('align', s.component, edits);
      return;
    }
    const b = ev.target.closest('button[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'open') { ui.forms[b.dataset.form] = true; if (b.dataset.form === 'style') ui.advanced = true; rerender(); setTimeout(() => el.querySelector(`form[data-submit] input`)?.focus(), 0); }
    else if (a === 'close') { delete ui.forms[b.dataset.form]; for (const id of Object.keys(ui.draft)) if (el.querySelector(`form [id="${CSS.escape(id)}"]`)) delete ui.draft[id]; rerender(); }
    else if (a === 'retry') { const e = ui.errors[b.dataset.key]; if (e?.retry) await run(b.dataset.key, e.retry.component, e.retry.edits, e.retry.opts); }
    else if (a === 'reset') {
      const prop = b.dataset.prop, tg = target(doc, s);
      const edits = [];
      for (const node of selNodes()) {
        const over = overridesOf(doc, tg.nonBase, node, prop);
        const [axis, val] = over.find(([x]) => x === tg.chosen?.[0]) || over[0] || [];
        if (axis) edits.push({ op: 'set', path: `${node}.${prop}`, value: null, variant: { [axis]: val } });
      }
      if (edits.length) await run('reset-' + prop, s.component, edits, { clear: [prop] });
    }
    else if (a === 'unbind') await run('bind', s.component, [{ op: 'bindText', id: s.node, prop: null }]);
    else if (a === 'remove-prop') await run('prop-' + b.dataset.prop, s.component, [{ op: 'removeProp', name: b.dataset.prop }]);
    else if (a === 'remove-value') await run('axis-' + b.dataset.axis, s.component, [{ op: 'removeVariant', axis: b.dataset.axis, value: b.dataset.value }]);
  });

  el.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target, kind = form.dataset.submit, s = ctx.state.selection;
    if (!s) return;
    const v = (id) => form.querySelector('#' + id)?.value.trim() ?? '';
    const ids = [...form.querySelectorAll('[id]')].map((x) => x.id);
    if (kind === 'add-style') {
      const edits = styleEdits([[v('new-style-name'), toValue(v('new-style-value'))]]);
      await run('add-style', s.component, edits, { clear: ids, close: ['style'] });
    } else if (kind === 'bind') {
      await run('bind', s.component, [{ op: 'bindText', id: s.node, prop: v('bind-prop') }], { clear: ids, close: ['bind'] });
    } else if (kind === 'add-prop') {
      const type = form.querySelector('#new-prop-type').value;
      const edit = { op: 'addProp', name: v('new-prop-name'), type };
      if (type === 'enum') edit.options = v('new-prop-options').split(',').map((x) => x.trim()).filter(Boolean);
      await run('add-prop', s.component, [edit], { clear: ids, close: ['prop'] });
    } else if (kind === 'add-value') {
      const axis = form.dataset.axis;
      await run('axis-' + axis, s.component, [{ op: 'addVariant', axis, value: v('new-value-' + axis) }], { clear: ids, close: ['value:' + axis] });
    } else if (kind === 'add-axis') {
      const edit = { op: 'addVariant', axis: v('new-axis-name'), value: v('new-axis-value') };
      if (v('new-axis-base')) edit.base = v('new-axis-base');
      await run('add-axis', s.component, [edit], { clear: ids, close: ['axis'] });
    }
  });

  // ---- font picker: a popover of family names, each drawn in its own face ----
  const pop = document.createElement('div');
  pop.id = 'fontpop'; pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', 'Fonts'); pop.hidden = true; document.body.append(pop);
  let popFor = null;
  const closeFonts = () => { pop.hidden = true; popFor = null; };
  function openFonts(input, filter = '') {
    popFor = input;
    const q = filter.trim().toLowerCase(), cur = famName(curVal('fontFamily'));
    const names = fontNames(ctx).filter((n) => !q || n.toLowerCase().includes(q));
    pop.innerHTML = names.length ? names.map((n) => `<button type="button" role="option" aria-selected="${n === cur}" data-font="${esc(n)}" style="font-family: ${/\s/.test(n) ? `'${esc(n)}'` : esc(n)}, system-ui">${esc(n)}${GENERIC.includes(n) ? '<small>generic</small>' : ''}</button>`).join('') : '<p class="hint">No match. Press Enter to use it as typed.</p>';
    const r = input.getBoundingClientRect();
    Object.assign(pop.style, { left: `${r.left}px`, top: `${r.bottom + 4}px`, width: `${Math.max(r.width, 200)}px` });
    pop.hidden = false;
  }
  el.addEventListener('focusin', (ev) => { if (ev.target.dataset?.picker === 'font') openFonts(ev.target); });
  el.addEventListener('input', (ev) => { if (ev.target.dataset?.picker === 'font') openFonts(ev.target, ev.target.value); });
  el.addEventListener('keydown', (ev) => {
    if (ev.target.dataset?.picker !== 'font') return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); pop.querySelector('button')?.focus(); }
    else if (ev.key === 'Escape') { closeFonts(); }
    else if (ev.key === 'Enter') closeFonts();
  });
  pop.addEventListener('keydown', (ev) => {
    const items = [...pop.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (i <= 0) popFor?.focus(); else items[i - 1].focus(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); const f = popFor; closeFonts(); f?.focus(); }
  });
  pop.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-font]');
    if (!b || !popFor) return;
    const inp = popFor; closeFonts();
    inp.value = b.dataset.font;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('pointerdown', (ev) => { if (!pop.hidden && !ev.target.closest('#fontpop') && ev.target.dataset?.picker !== 'font') closeFonts(); }, true);
  document.addEventListener('focusin', (ev) => { if (!pop.hidden && !ev.target.closest('#fontpop') && ev.target.dataset?.picker !== 'font') closeFonts(); });

  // ---- live preview while scrubbing or picking a colour: only the DOM moves; one edit is sent at the end ----
  let previewed = [];
  function cellsFor() {
    const s = ctx.state.selection, doc = curDoc(), tg = target(doc, s);
    const sec = document.querySelector(`section.cmp[data-component="${CSS.escape(s.component)}"]`);
    if (!sec) return [];
    const out = [];
    for (const cell of sec.querySelectorAll('.cell')) {
      if (tg.overriding) { const v = JSON.parse(cell.dataset.variant); if (v[tg.chosen[0]] !== tg.chosen[1]) continue; }
      for (const node of selNodes()) { const n = cell.querySelector(`.mount [data-n="${CSS.escape(node)}"]`); if (n) out.push(n); }
    }
    return out;
  }
  function preview(prop, value) {
    if (!ctx.state.selection) return;
    if (!previewed.length || previewed.prop !== prop) { restore(); previewed = cellsFor().map((n) => ({ n, was: n.style[prop] })); previewed.prop = prop; }
    for (const p of previewed) p.n.style[prop] = css(prop, prop === 'opacity' ? Number(value) / 100 : toValue(String(value)) ?? '');
    ctx.stage.refreshOverlays();
  }
  function restore() { for (const p of previewed) p.n.style[previewed.prop] = p.was; previewed = []; }

  // ---- scrubbing: drag a label ----
  let scrub = null;
  el.addEventListener('pointerdown', (ev) => {
    const lab = ev.target.closest?.('label.scrub');
    if (!lab || ev.button !== 0) return;
    const input = el.querySelector('#' + CSS.escape(lab.dataset.scrub));
    if (!input || input.disabled) return;
    scrub = { lab, input, x: ev.clientX, start: input.value, moved: false, prop: lab.dataset.scrub, ...scrubOf(lab.dataset.scrub, input.value) };
    try { lab.setPointerCapture(ev.pointerId); } catch {}
  });
  el.addEventListener('pointermove', (ev) => {
    if (!scrub) return;
    const dx = ev.clientX - scrub.x;
    if (!scrub.moved && Math.abs(dx) < 3) return;
    if (!scrub.moved) { scrub.moved = true; ui.scrubbing = true; document.body.dataset.scrub = '1'; }
    ev.preventDefault();
    const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
    const next = bump(scrub.start || '0', Math.round(dx / 2) * scrub.step * mult, scrub);
    if (next === null) return;
    scrub.input.value = next; scrub.value = next;
    if (scrub.input.dataset.group) { const r = readGroup(scrub.input.dataset.group); preview(r.prop, r.value); } else preview(scrub.prop, next);
  });
  const endScrub = async (ev) => {
    if (!scrub) return;
    const sc = scrub; scrub = null;
    delete document.body.dataset.scrub;
    if (!sc.moved) return;
    ui.scrubbing = false;
    if (ev.type === 'pointercancel' || sc.value === undefined || sc.value === sc.start) { restore(); sc.input.value = sc.start; rerender(); return; }
    previewed = []; // the committed render replaces the DOM
    if (sc.input.dataset.group) await commitGroup(sc.input.dataset.group, sc.input.id); else await commit(sc.prop, sc.value, sc.input.id);
  };
  el.addEventListener('pointerup', endScrub);
  el.addEventListener('pointercancel', endScrub);
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && scrub?.moved) { ev.preventDefault(); restore(); scrub.input.value = scrub.start; scrub = null; ui.scrubbing = false; delete document.body.dataset.scrub; rerender(); } }, true);
}

// How a field scrubs. A unitless line height (1.5) moves in 0.05s, a pixel one in 1s.
const PARTSCRUB = Object.fromEntries([
  ...['stroke-w', 'shadow-blur', 'pad-t', 'pad-r', 'pad-b', 'pad-l', 'rad-tl', 'rad-tr', 'rad-br', 'rad-bl'].map((k) => [k, { step: 1, min: 0 }]),
  ...['shadow-x', 'shadow-y', 'shadow-spread'].map((k) => [k, { step: 1 }]),
  ...['fill-a', 'stroke-a', 'shadow-a'].map((k) => [k, { step: 1, min: 0, max: 100 }]),
]);
function scrubOf(prop, text) {
  const o = { ...(F[prop]?.scrub || PARTSCRUB[prop] || { step: 1 }) };
  if (F[prop]?.auto && !/px/.test(text) && Math.abs(parseFloat(text)) < 4) { o.step = 0.05; o.digits = 2; }
  return o;
}
// Add `delta` to every number in a CSS value ("8px 16px" -> "9px 17px"); keeps units, clamps, rounds.
function bump(text, delta, o = {}) {
  const { min = -Infinity, max = Infinity, digits = 0 } = o;
  if (!/-?\d/.test(text)) return null;
  const round = (n) => { const k = 10 ** digits; return Math.round(Math.min(max, Math.max(min, n)) * k) / k; };
  return text.replace(/-?\d+(\.\d+)?/g, (m) => String(round(Number(m) + delta)));
}
