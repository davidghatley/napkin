// The side panel (M3: F05, F13, F14, F15). Plain DOM, rebuilt on every selection or render, with
// event delegation wired once. Every change is a batch of model ops through ctx.sendEdits; the panel
// never writes files. Text typed into a field survives a rebuild (ui.draft) until it is saved.
import { index, axes, resolveStyle, propOf } from '/src/model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const variantLabel = (v) => Object.entries(v || {}).map(([k, x]) => `${k}=${x}`).join(' · ') || 'default';

const SECTIONS = [
  ['Layout', ['display', 'flexDirection', 'gap', 'padding', 'alignItems', 'justifyContent']],
  ['Size', ['width', 'height']],
  ['Fill', ['background', 'color']],
  ['Border', ['border', 'borderRadius']],
  ['Type', ['fontSize', 'fontWeight', 'fontFamily', 'lineHeight']],
];
const KNOWN = new Set(SECTIONS.flatMap(([, ps]) => ps));
const NUMBER = /^-?\d+(\.\d+)?$/;
const toValue = (raw) => { const t = raw.trim(); return t === '' ? null : NUMBER.test(t) ? Number(t) : t; };

// Panel-only state (nothing here is document state).
const ui = {
  selKey: '',      // component|variant: the edit target resets to Base when it changes
  mode: 'base',    // 'base' | 'variant'
  axis: null,      // which axis an override is written to
  errors: {},      // key -> { text, retry?: { component, edits } }
  forms: {},       // key -> true while an inline form is open
  draft: {},       // input id -> unsaved text
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

export function renderPanel(ctx) {
  const el = document.querySelector('#panel');
  wire(ctx, el);
  const sel = ctx.state.selection;
  const comp = sel && ctx.state.components.get(sel.component);
  const doc = comp?.doc;
  const node = doc && index(doc).byId.get(sel.node);
  if (!node && comp?.readOnly) {
    el.innerHTML = `<h2>Selection</h2><dl><dt>component</dt><dd id="sel-component">${esc(comp.name)}</dd><dt>node</dt><dd id="sel-node">${esc(sel.node)}</dd></dl><p class="hint" id="sel-readonly">read-only: ${esc(comp.readOnly)}</p>`;
    return;
  }
  if (!node) {
    el.innerHTML = '<h2>Selection</h2><p class="hint">Click an element on the canvas to select it.</p>';
    return;
  }
  const selKey = `${sel.component}|${JSON.stringify(sel.variant)}`;
  const full = `${selKey}|${sel.node}`;
  if (ui.selKey !== selKey) { ui.selKey = selKey; ui.mode = 'base'; ui.axis = null; }
  if (el.dataset.full !== full) { el.dataset.full = full; ui.errors = {}; ui.draft = {}; ui.forms = {}; }

  const focus = document.activeElement && el.contains(document.activeElement) ? { id: document.activeElement.id, s: document.activeElement.selectionStart, e: document.activeElement.selectionEnd } : null;
  const dis = comp.readOnly ? ' disabled' : '';
  const t = target(doc, sel);
  const resolved = t.overriding ? resolveStyle(doc, node.id, sel.variant) : node.style || {};

  const row = (prop) => {
    const over = t.overriding ? overridesOf(doc, t.nonBase, node.id, prop) : [];
    const dot = over.length ? `<span class="dot" id="dot-${prop}" role="img" aria-label="overridden in ${esc(over.map(([a, v]) => `${a}=${v}`).join(', '))}" title="overridden in ${esc(over.map(([a, v]) => `${a}=${v}`).join(', '))}"></span>` : '';
    const reset = over.length ? `<button type="button" class="small" id="reset-${prop}" data-action="reset" data-prop="${prop}"${dis}>Reset to base</button>` : '';
    return `<div class="row${over.length ? ' overridden' : ''}"><label for="${prop}">${prop}</label>${dot}<input id="${prop}" data-field="style" data-prop="${prop}" autocomplete="off" value="${esc(resolved[prop] ?? '')}"${dis}>${reset}${err('style-' + prop)}${err('reset-' + prop)}</div>`;
  };

  const sections = SECTIONS.map(([title, props]) => `<section class="psec"><h2>${title}</h2>${props.map(row).join('')}</section>`).join('');
  const extra = Object.keys(resolved).filter((p) => !KNOWN.has(p));
  const other = `<section class="psec"><h2>Other</h2>${extra.map(row).join('')}
    ${ui.forms.style ? `<form data-submit="add-style" class="inline"><label for="new-style-name">Property</label><input id="new-style-name" placeholder="boxShadow" autocomplete="off"${dis}><label for="new-style-value">Value</label><input id="new-style-value" autocomplete="off"${dis}><button type="submit" id="add-style-submit"${dis}>Add</button><button type="button" data-action="close" data-form="style">Cancel</button></form>`
    : `<button type="button" id="add-style" data-action="open" data-form="style"${dis}>+ property</button>`}${err('add-style')}</section>`;

  // Where do edits go?
  const targetUi = `<fieldset class="target"><legend>Edit where</legend>
      <label class="radio"><input type="radio" name="target" id="target-base" value="base"${t.overriding ? '' : ' checked'}${dis}> Base</label>
      <label class="radio"><input type="radio" name="target" id="target-variant" value="variant"${t.overriding ? ' checked' : ''}${t.available ? '' : ' disabled'}${dis}> This variant</label>
      ${t.available ? '' : `<p class="hint" id="target-note">${Object.keys(sel.variant || {}).length ? 'This cell is all base values, so there is no override to make. Edits go to the base.' : 'This component has no variants yet. Edits go to the base.'}</p>`}
      ${t.overriding && t.nonBase.length > 1 ? `<label for="override-axis">Override belongs to</label><select id="override-axis">${t.nonBase.map(([a, v]) => `<option value="${esc(a)}"${t.chosen[0] === a ? ' selected' : ''}>${esc(a)}=${esc(v)}</option>`).join('')}</select>` : ''}
      ${t.overriding && t.nonBase.length === 1 ? `<p class="hint" id="override-note">Overrides ${esc(t.chosen[0])}=${esc(t.chosen[1])}.</p>` : ''}
    </fieldset>`;

  // Text, setting binding, image attributes.
  let text = '';
  const isImg = node.tag === 'img';
  if (isImg) {
    text = `<section class="psec"><h2>Image</h2>
      <div class="row"><label for="src">src</label><input id="src" data-field="attr" data-attr="src" autocomplete="off" value="${esc(node.attrs?.src ?? '')}"${dis}>${err('attr-src')}</div>
      <div class="row"><label for="alt">alt</label><input id="alt" data-field="attr" data-attr="alt" autocomplete="off" value="${esc(node.attrs?.alt ?? '')}"${dis}>${err('attr-alt')}</div></section>`;
  } else if (!node.children.length) {
    const bound = node.textProp;
    text = `<section class="psec"><h2>Text</h2>${bound
      ? `<p id="shows">shows <code>${esc(bound)}</code> <button type="button" id="unbind" data-action="unbind"${dis}>Unbind</button></p>`
      : `<div class="row"><label for="text">text</label><input id="text" data-field="text" autocomplete="off" value="${esc(node.text ?? '')}"${dis}></div>
         ${ui.forms.bind
           ? `<form data-submit="bind" class="inline"><label for="bind-prop">Setting name</label><input id="bind-prop" autocomplete="off" value="${esc(ui.draft['bind-prop'] ?? (/^[a-z][a-zA-Z0-9]*$/.test(node.id) ? node.id : 'text'))}"${dis}><button type="submit" id="bind-submit"${dis}>Bind</button><button type="button" data-action="close" data-form="bind">Cancel</button></form>`
           : `<button type="button" id="make-setting" data-action="open" data-form="bind"${dis}>Make setting</button>`}`}
      ${err('text')}${err('bind')}</section>`;
  }

  // Props (component level).
  const propRows = doc.props.map((p) => {
    const def = p.type === 'boolean'
      ? `<input type="checkbox" id="propdef-${p.name}" data-field="propdef" data-prop="${p.name}"${p.default ? ' checked' : ''}${dis} aria-label="default of ${esc(p.name)}">`
      : p.type === 'string'
        ? `<input id="propdef-${p.name}" data-field="propdef" data-prop="${p.name}" autocomplete="off" value="${esc(p.default ?? '')}"${dis} aria-label="default of ${esc(p.name)}">`
        : `<span id="propdef-${p.name}" class="mono">${esc(p.default)} (base)</span>`;
    return `<li><div class="prop"><strong>${esc(p.name)}</strong> <span class="mono">${p.type}${p.options ? ': ' + esc(p.options.join(' | ')) : ''}</span>
      <button type="button" class="small" id="remove-prop-${p.name}" data-action="remove-prop" data-prop="${p.name}"${dis}>Remove</button></div>
      <div class="row"><label for="propdef-${p.name}">default</label>${def}</div>${err('prop-' + p.name)}${err('propdef-' + p.name)}</li>`;
  }).join('');
  const propsUi = `<section class="psec"><h2>Props</h2>${propRows ? `<ul class="plain" id="props">${propRows}</ul>` : '<p class="hint">No props yet.</p>'}
    ${ui.forms.prop
      ? `<form data-submit="add-prop" class="inline"><label for="new-prop-name">Name</label><input id="new-prop-name" autocomplete="off"${dis}>
          <label for="new-prop-type">Type</label><select id="new-prop-type"${dis}><option>string</option><option>boolean</option><option>enum</option></select>
          <label for="new-prop-options">Options (enum, comma separated)</label><input id="new-prop-options" autocomplete="off"${dis}>
          <button type="submit" id="add-prop-submit"${dis}>Add</button><button type="button" data-action="close" data-form="prop">Cancel</button></form>`
      : `<button type="button" id="add-prop" data-action="open" data-form="prop"${dis}>+ prop</button>`}${err('add-prop')}</section>`;

  // Variants.
  const axisUi = axes(doc).map((a) => `<div class="axis" data-axis="${esc(a.name)}"><h3>${esc(a.name)}</h3>
      <ul class="plain chips">${a.options.map((o) => {
        const isBase = o === a.default;
        return `<li><span>${esc(o)}</span>${isBase ? ' <span class="badge">base</span>' : ''} <button type="button" class="small" id="remove-value-${a.name}-${o}" data-action="remove-value" data-axis="${esc(a.name)}" data-value="${esc(o)}"${isBase ? ` disabled title="${esc(o)} is the base of ${esc(a.name)}, so it can't be removed" aria-label="Remove ${esc(o)} (it is the base, so it can't be removed)"` : ` aria-label="Remove ${esc(o)}"`}${dis}>Remove</button></li>`;
      }).join('')}</ul>
      ${ui.forms['value:' + a.name]
        ? `<form data-submit="add-value" data-axis="${esc(a.name)}" class="inline"><label for="new-value-${a.name}">New ${esc(a.name)} value</label><input id="new-value-${a.name}" autocomplete="off"${dis}><button type="submit" id="add-value-submit-${a.name}"${dis}>Add</button><button type="button" data-action="close" data-form="value:${esc(a.name)}">Cancel</button></form>`
        : `<button type="button" id="add-value-${a.name}" data-action="open" data-form="value:${esc(a.name)}"${dis}>+ value</button>`}
      ${err('axis-' + a.name)}</div>`).join('');
  const variantsUi = `<section class="psec"><h2>Variants</h2>${axisUi || '<p class="hint">No variant axes yet.</p>'}
    ${ui.forms.axis
      ? `<form data-submit="add-axis" class="inline"><label for="new-axis-name">Axis name</label><input id="new-axis-name" placeholder="size" autocomplete="off"${dis}>
          <label for="new-axis-value">First value</label><input id="new-axis-value" placeholder="sm" autocomplete="off"${dis}>
          <label for="new-axis-base">Base value</label><input id="new-axis-base" placeholder="default" autocomplete="off"${dis}>
          <button type="submit" id="add-axis-submit"${dis}>Add</button><button type="button" data-action="close" data-form="axis">Cancel</button></form>`
      : `<button type="button" id="add-axis" data-action="open" data-form="axis"${dis}>+ axis</button>`}${err('add-axis')}</section>`;

  el.innerHTML = `<h2>Selection</h2>
    <dl><dt>component</dt><dd id="sel-component">${esc(comp.name)}</dd><dt>node</dt><dd id="sel-node">${esc(node.id)} &lt;${esc(node.tag)}&gt;</dd><dt>variant</dt><dd id="sel-variant">${esc(variantLabel(sel.variant))}</dd><dt>editing</dt><dd id="sel-target">${t.overriding ? `override ${esc(t.chosen[0])}=${esc(t.chosen[1])}` : 'Base'}</dd></dl>
    ${comp.readOnly ? `<p class="hint" id="sel-readonly">read-only: ${esc(comp.readOnly)}</p>` : ''}
    ${targetUi}${sections}${other}${text}${propsUi}${variantsUi}`;

  for (const [id, v] of Object.entries(ui.draft)) {
    const f = el.querySelector('#' + CSS.escape(id));
    if (f && 'value' in f && f.type !== 'checkbox') f.value = v;
  }
  if (focus?.id) {
    const f = el.querySelector('#' + CSS.escape(focus.id));
    if (f) { f.focus(); try { f.setSelectionRange(focus.s, focus.e); } catch {} }
  }
}

function wire(ctx, el) {
  if (el.dataset.wired) return;
  el.dataset.wired = '1';
  const rerender = () => renderPanel(ctx);
  const curDoc = () => { const s = ctx.state.selection; return s && ctx.state.components.get(s.component)?.doc; };

  // Sends a batch; shows the store's error at `key`. A success clears the error and the listed drafts and
  // closes the listed forms (the canvas re-render that follows redraws the panel).
  async function run(key, component, edits, { clear = [], close = [] } = {}) {
    let r;
    try { r = await ctx.sendEdits(component, edits); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (r.ok) {
      delete ui.errors[key];
      clear.forEach((id) => delete ui.draft[id]);
      close.forEach((f) => delete ui.forms[f]);
      // the SSE render redraws; redraw now too in case this batch changed no visible state
      setTimeout(rerender, 0);
    } else {
      ui.errors[key] = { text: r.error, retry: /^stale revision/.test(r.error) ? { component, edits, opts: { clear, close } } : null };
      rerender();
    }
    return r;
  }

  el.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id && t.type !== 'checkbox' && t.type !== 'radio') ui.draft[t.id] = t.value;
  });

  el.addEventListener('change', async (ev) => {
    const t = ev.target, s = ctx.state.selection, doc = curDoc();
    if (!s || !doc) return;
    if (t.name === 'target') { ui.mode = t.value; rerender(); return; }
    if (t.id === 'override-axis') { ui.axis = t.value; rerender(); return; }
    const field = t.dataset.field;
    if (field === 'style') {
      const prop = t.dataset.prop, value = toValue(t.value), tg = target(doc, s);
      const edit = { op: 'set', path: `${s.node}.${prop}`, value };
      if (tg.overriding) {
        const over = overridesOf(doc, tg.nonBase, s.node, prop);
        const [axis, val] = value === null ? over.find(([a]) => a === tg.chosen[0]) || over[0] || [] : tg.chosen;
        if (!axis) { delete ui.draft[t.id]; rerender(); return; } // nothing to clear in this variant
        edit.variant = { [axis]: val };
      }
      await run('style-' + prop, s.component, [edit], { clear: [t.id] });
    } else if (field === 'text') {
      await run('text', s.component, [{ op: 'set', path: `${s.node}.text`, value: t.value === '' ? null : t.value }], { clear: [t.id] });
    } else if (field === 'attr') {
      await run('attr-' + t.dataset.attr, s.component, [{ op: 'set', path: `${s.node}.@${t.dataset.attr}`, value: t.value === '' ? null : t.value }], { clear: [t.id] });
    } else if (field === 'propdef') {
      const p = propOf(doc, t.dataset.prop);
      if (!p) return;
      const value = p.type === 'boolean' ? t.checked : t.value;
      // There is no "set default" op: re-declare the prop, keeping bound text bound.
      const users = [...index(doc).byId.values()].filter((n) => n.textProp === p.name);
      const edits = [
        ...users.map((n) => ({ op: 'bindText', id: n.id, prop: null })),
        { op: 'removeProp', name: p.name },
        { op: 'addProp', name: p.name, type: p.type, ...(value === '' ? {} : { default: value }) },
        ...users.map((n) => ({ op: 'bindText', id: n.id, prop: p.name })),
      ];
      await run('propdef-' + p.name, s.component, edits, { clear: [t.id] });
    }
  });

  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-action]');
    if (!b) return;
    const s = ctx.state.selection, doc = curDoc();
    if (!s || !doc) return;
    const a = b.dataset.action;
    if (a === 'open') { ui.forms[b.dataset.form] = true; rerender(); setTimeout(() => el.querySelector(`form[data-submit] input`)?.focus(), 0); }
    else if (a === 'close') { delete ui.forms[b.dataset.form]; for (const id of Object.keys(ui.draft)) if (el.querySelector(`form [id="${CSS.escape(id)}"]`)) delete ui.draft[id]; rerender(); }
    else if (a === 'retry') { const e = ui.errors[b.dataset.key]; if (e?.retry) await run(b.dataset.key, e.retry.component, e.retry.edits, e.retry.opts); }
    else if (a === 'reset') {
      const prop = b.dataset.prop, tg = target(doc, s);
      const over = overridesOf(doc, tg.nonBase, s.node, prop);
      const [axis, val] = over.find(([x]) => x === tg.chosen?.[0]) || over[0] || [];
      if (axis) await run('reset-' + prop, s.component, [{ op: 'set', path: `${s.node}.${prop}`, value: null, variant: { [axis]: val } }], { clear: [prop] });
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
      const tg = target(curDoc(), s), edit = { op: 'set', path: `${s.node}.${v('new-style-name')}`, value: toValue(v('new-style-value')) };
      if (tg.overriding) edit.variant = { [tg.chosen[0]]: tg.chosen[1] };
      await run('add-style', s.component, [edit], { clear: ids, close: ['style'] });
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
}
