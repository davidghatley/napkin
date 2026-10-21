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
const toValue = (raw) => { const t = raw.trim(); return t === '' ? null : NUMBER.test(t) ? Number(t) : t; };
const UNITLESS = new Set(['opacity', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'zIndex', 'order']);
const css = (prop, v) => (typeof v === 'number' && !UNITLESS.has(prop) ? `${v}px` : String(v));

// What each design control edits. `scrub`: drag the label to change the number.
const F = {
  gap: { label: 'Gap', unit: 'px', scrub: { step: 1, min: 0 } },
  padding: { label: 'Padding', unit: 'px', scrub: { step: 1, min: 0 } },
  width: { label: 'Width', unit: 'px', scrub: { step: 1, min: 0 } },
  height: { label: 'Height', unit: 'px', scrub: { step: 1, min: 0 } },
  opacity: { label: 'Opacity', scrub: { step: 0.01, min: 0, max: 1, digits: 2 } },
  borderRadius: { label: 'Corner radius', unit: 'px', scrub: { step: 1, min: 0 } },
  border: { label: 'Border' },
  boxShadow: { label: 'Shadow' },
  background: { label: 'Fill', color: true },
  color: { label: 'Text color', color: true },
  fontFamily: { label: 'Font' },
  fontSize: { label: 'Size', unit: 'px', scrub: { step: 1, min: 1 } },
  lineHeight: { label: 'Line height', scrub: { step: 1, min: 0 }, auto: true },
  letterSpacing: { label: 'Letter spacing', unit: 'px', scrub: { step: 0.1, min: -20, digits: 1 } },
};
const WEIGHTS = [300, 400, 500, 600, 700, 800];
const DESIGN = new Set([...Object.keys(F), 'display', 'flexDirection', 'justifyContent', 'alignItems', 'fontWeight', 'textAlign']);
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
  closed: new Set(), // collapsed sections
  advanced: false,
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
  reset: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 7.5a4.5 4.5 0 1 1 1.3 3.2M3.5 3.5v4h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

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
  const field = (prop, o = {}) => {
    const f = { ...F[prop], ...o }, { value, mixed } = val(prop);
    const shown = value === undefined ? '' : String(value);
    const unit = f.unit && (shown === '' || NUMBER.test(shown)) && !mixed ? `<span class="unit" aria-hidden="true">${f.unit}</span>` : '';
    const labelAttrs = f.scrub ? `class="flabel scrub" data-scrub="${prop}" title="Drag to change"` : 'class="flabel"';
    const sw = f.color ? `<label class="swatch"><input type="color" id="pick-${prop}" data-pick="${prop}" aria-label="Pick ${esc(f.label.toLowerCase())}"${dis}><span class="chipcolor" data-color="${esc(shown)}"></span></label>` : '';
    return `<div class="f${isOver(prop) ? ' overridden' : ''}"><label ${labelAttrs} for="${prop}">${esc(f.label)}</label>
      <div class="fbox${f.color ? ' hascolor' : ''}">${sw}<input id="${prop}" data-field="style" data-prop="${prop}" data-step="${f.scrub?.step ?? ''}"${f.scrub ? '' : ' data-text="1"'} autocomplete="off" spellcheck="false" value="${esc(shown)}" placeholder="${mixed ? 'Mixed' : f.placeholder ?? ''}"${mixed ? ' data-mixed="1"' : ''}${dis}>${unit}</div>
      <div class="ftags">${tags(prop, f.label)}</div>${err('style-' + prop)}${err('reset-' + prop)}</div>`;
  };
  // A segmented control: one CSS property, a few values.
  const seg = (prop, label, opts, { aria } = {}) => {
    const { value, mixed } = val(prop);
    return `<div class="f${isOver(prop) ? ' overridden' : ''}"><span class="flabel" id="lbl-${prop}">${esc(label)}</span>
      <div class="seg" role="radiogroup" aria-labelledby="lbl-${prop}">${opts.map(([v, text, icon, match]) => `<button type="button" role="radio" id="seg-${prop}-${v}" aria-checked="${!mixed && (match ? match.test(String(value)) : value === v)}" data-seg="${prop}" data-val="${v}" title="${esc(aria?.[v] ?? text)}"${dis}>${icon || ''}<span>${esc(text)}</span></button>`).join('')}</div>
      <div class="ftags">${tags(prop, label)}</div>${err('style-' + prop)}${err('reset-' + prop)}</div>`;
  };
  // Hug / Fill / Fixed for width or height.
  const sizeMode = (v) => (v === undefined || v === 'auto' || v === 'fit-content' || v === 'max-content' ? 'hug' : v === '100%' ? 'fill' : typeof v === 'number' || /^-?\d+(\.\d+)?px$/.test(String(v)) ? 'fixed' : 'custom');
  const size = (prop) => {
    const { value, mixed } = val(prop), mode = mixed ? '' : sizeMode(value);
    const opts = [['hug', 'Hug'], ['fill', 'Fill'], ['fixed', 'Fixed']];
    return field(prop, { placeholder: 'Auto' }).replace('<div class="ftags">', `<div class="seg sizeseg" role="radiogroup" aria-label="${prop} sizing">${opts.map(([m, text]) => `<button type="button" role="radio" id="size-${prop}-${m}" aria-checked="${mode === m}" data-size="${prop}" data-mode="${m}" title="${m === 'hug' ? 'Hug contents (auto)' : m === 'fill' ? 'Fill the parent (100%)' : 'Fixed size in px'}"${dis}><span>${text}</span></button>`).join('')}</div><div class="ftags">`);
  };
  const section = (id, title, body, { open = true } = {}) => `<details class="sec" data-sec="${id}"${open && !ui.closed.has(id) ? ' open' : ''}><summary>${title}</summary><div class="sbody">${body}</div></details>`;

  // ---- Layout ----
  const disp = val('display').value;
  const isFlex = /flex/.test(String(disp)), isGrid = disp === 'grid';
  const dir = val('flexDirection').value === 'column' ? 'column' : 'row';
  const justify = val('justifyContent'), alignI = val('alignItems');
  const matrix = isFlex ? `<div class="f"><span class="flabel" id="lbl-align">Alignment</span><div class="amatrix" role="group" aria-labelledby="lbl-align">${[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => {
    const [mainI, crossI] = dir === 'row' ? [c, r] : [r, c];
    const on = !justify.mixed && !alignI.mixed && (justify.value ?? 'flex-start') === ALIGN[mainI] && alignI.value === ALIGN[crossI];
    return `<button type="button" id="align-${r}${c}" data-align="${mainI},${crossI}" aria-pressed="${on}" aria-label="Align ${AL_NAME[r][c]}" title="Align ${AL_NAME[r][c]}"${dis}><i></i></button>`;
  })).join('')}</div><div class="ftags">${tags('justifyContent', 'Alignment') || tags('alignItems', 'Alignment')}</div>${err('align')}</div>` : '';
  const layout = section('layout', 'Layout',
    seg('display', 'Layout', [['block', 'Block'], ['flex', 'Flex', '', /flex/], ['grid', 'Grid']])
    + (isFlex ? seg('flexDirection', 'Direction', [['row', 'Row', I.row, /^(row|undefined)$/], ['column', 'Column', I.column]]) + matrix : '')
    + (isFlex || isGrid ? field('gap') : '') + field('padding'));
  const sizeSec = section('size', 'Size', size('width') + size('height'));
  const look = section('appearance', 'Appearance', field('borderRadius') + field('opacity', { placeholder: '1' }) + field('border') + field('boxShadow'));
  const fill = section('fill', 'Fill', field('background', { placeholder: 'none' }));
  const wt = val('fontWeight');
  const typeSec = section('type', 'Text',
    field('fontFamily') + `<div class="pair">${field('fontSize')}${(() => `<div class="f"><label class="flabel" for="fontWeight">Weight</label><div class="fbox"><select id="fontWeight" data-field="weight"${dis}>${wt.mixed ? '<option value="" selected>Mixed</option>' : ''}${wt.value === undefined ? '<option value="" selected>Inherit</option>' : ''}${[...new Set([...(wt.value !== undefined && !WEIGHTS.includes(Number(wt.value)) ? [wt.value] : []), ...WEIGHTS])].map((w) => `<option value="${w}"${!wt.mixed && String(wt.value) === String(w) ? ' selected' : ''}>${w}</option>`).join('')}</select></div><div class="ftags">${tags('fontWeight', 'Weight')}</div>${err('style-fontWeight')}</div>`)()}</div>`
    + `<div class="pair">${field('lineHeight')}${field('letterSpacing')}</div>`
    + seg('textAlign', 'Align', [['left', 'Left', I.left], ['center', 'Center', I.center], ['right', 'Right', I.right]]) + field('color', { placeholder: 'inherit' }));

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

  // ---- Where do edits go? ----
  const scope = `<fieldset class="scope"><legend class="sr">Edit where</legend>
      <div class="seg wide">
        <label class="segopt"><input type="radio" name="target" id="target-base" value="base"${t.overriding ? '' : ' checked'}${dis}><span>Base</span></label>
        <label class="segopt"><input type="radio" name="target" id="target-variant" value="variant"${t.overriding ? ' checked' : ''}${t.available ? '' : ' disabled'}${dis}><span>This variant</span></label>
      </div>
      ${t.available ? '' : `<p class="hint" id="target-note">${Object.keys(sel.variant || {}).length ? 'This cell is all base values, so there is no override to make. Edits go to the base.' : 'This component has no variants yet. Edits go to the base.'}</p>`}
      ${t.overriding && t.nonBase.length > 1 ? `<label class="flabel" for="override-axis">Override belongs to</label><select id="override-axis">${t.nonBase.map(([a, v]) => `<option value="${esc(a)}"${t.chosen[0] === a ? ' selected' : ''}>${esc(a)}=${esc(v)}</option>`).join('')}</select>` : ''}
      ${t.overriding && t.nonBase.length === 1 ? `<p class="hint" id="override-note">Overrides ${esc(t.chosen[0])}=${esc(t.chosen[1])}.</p>` : ''}
    </fieldset>`;

  // ---- Settings (props) and Variants: the component, not the node ----
  const propRows = doc.props.map((p) => {
    const def = p.type === 'boolean'
      ? `<input type="checkbox" id="propdef-${p.name}" data-field="propdef" data-prop="${p.name}"${p.default ? ' checked' : ''}${dis} aria-label="default of ${esc(p.name)}">`
      : p.type === 'string'
        ? `<input id="propdef-${p.name}" data-field="propdef" data-prop="${p.name}" autocomplete="off" value="${esc(p.default ?? '')}"${dis} aria-label="default of ${esc(p.name)}">`
        : `<span id="propdef-${p.name}" class="mono">${esc(p.default)} (base)</span>`;
    return `<li><div class="prop"><strong>${esc(p.name)}</strong><span class="mono">${p.type}${p.options ? ': ' + esc(p.options.join(' | ')) : ''}</span>
      <button type="button" class="btn small" id="remove-prop-${p.name}" data-action="remove-prop" data-prop="${p.name}"${dis}>Remove</button></div>
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
    <dl class="selmeta"><dt>Variant</dt><dd id="sel-variant">${esc(variantLabel(sel.variant))}</dd><dt>Editing</dt><dd id="sel-target">${t.overriding ? `override ${esc(t.chosen[0])}=${esc(t.chosen[1])}` : 'Base'}</dd></dl>
    ${multi ? `<p class="hint multi" id="sel-multi">${nodes.length} layers selected. Fields show Mixed where they differ; a change applies to all of them in one edit.</p>` : ''}
    ${comp.readOnly ? `<p class="hint" id="sel-readonly">read-only: ${esc(comp.readOnly)}</p>` : ''}
    ${scope}</div>
    ${layout}${sizeSec}${look}${fill}${typeSec}${content}${advanced}
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
  async function commit(prop, raw, id) {
    const s = ctx.state.selection;
    if (!s) return;
    const edits = styleEdits([[prop, typeof raw === 'string' ? toValue(raw) : raw]]);
    if (!edits.length) { delete ui.draft[id ?? prop]; rerender(); return; }
    await run('style-' + prop, s.component, edits, { clear: [id ?? prop] });
  }

  el.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.pick) { preview(t.dataset.pick, t.value); const txt = el.querySelector('#' + CSS.escape(t.dataset.pick)); if (txt) txt.value = t.value; return; }
    if (t.id && t.type !== 'checkbox' && t.type !== 'radio' && t.type !== 'color') ui.draft[t.id] = t.value;
  });
  el.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d.matches?.('details.sec')) return;
    const id = d.dataset.sec;
    if (id === 'advanced') ui.advanced = d.open; else if (d.open) ui.closed.delete(id); else ui.closed.add(id);
  }, true);

  el.addEventListener('change', async (ev) => {
    const t = ev.target, s = ctx.state.selection, doc = curDoc();
    if (!s || !doc) return;
    if (t.name === 'target') { ui.mode = t.value; rerender(); return; }
    if (t.id === 'override-axis') { ui.axis = t.value; rerender(); return; }
    if (t.dataset.pick) { await commit(t.dataset.pick, t.value, t.dataset.pick); return; }
    const field = t.dataset.field;
    if (field === 'style') await commit(t.dataset.prop, t.value, t.id);
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
    for (const p of previewed) p.n.style[prop] = css(prop, toValue(String(value)) ?? '');
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
    preview(scrub.prop, next);
  });
  const endScrub = async (ev) => {
    if (!scrub) return;
    const sc = scrub; scrub = null;
    delete document.body.dataset.scrub;
    if (!sc.moved) return;
    ui.scrubbing = false;
    if (ev.type === 'pointercancel' || sc.value === undefined || sc.value === sc.start) { restore(); sc.input.value = sc.start; rerender(); return; }
    previewed = []; // the committed render replaces the DOM
    await commit(sc.prop, sc.value, sc.input.id);
  };
  el.addEventListener('pointerup', endScrub);
  el.addEventListener('pointercancel', endScrub);
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && scrub?.moved) { restore(); scrub.input.value = scrub.start; scrub = null; ui.scrubbing = false; delete document.body.dataset.scrub; rerender(); } }, true);
}

// How a field scrubs. A unitless line height (1.5) moves in 0.05s, a pixel one in 1s.
function scrubOf(prop, text) {
  const o = { ...(F[prop]?.scrub || { step: 1 }) };
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
