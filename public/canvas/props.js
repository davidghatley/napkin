// CMP-01: the props editor ("Settings" in the panel). Each setting is a card: grip, type, name, Up / Down, remove;
// its default (a control that fits the type), and a description that is written as a JSDoc comment above it in the file.
// Add, rename, retype-by-adding, reorder (drag the grip or use Up / Down) and remove all go through ctx.sendEdits.
// A rename is one `renameProp` edit: the file updates the interface, the parameter and every place that shows it.
import { checkName } from './words.js';
import { applyEdits } from '/src/model.js';
import { esc, ICON, errorLine, errors, run, refuse, ctxDoc, startDrag } from './cmp-core.js';
import { renderPanel } from './panel.js';

const forms = {}; // which "add" forms are open
const ui = { edit: false, notes: new Set() }; // the structure editor is open; settings whose note field was asked for
export const formOpen = (k) => !!forms[k];

// Types the model accepts today (a number prop arrives with the dialect widening: ask the model, so this follows it).
export function propTypes(doc) {
  const probe = (type) => { try { applyEdits(doc, [{ op: 'addProp', name: 'probeprop', type }]); return true; } catch { return false; } };
  return ['string', 'boolean', 'enum', ...(probe('number') ? ['number'] : [])];
}
const TYPE_LABEL = { string: 'Text', boolean: 'On / off', enum: 'Choice', number: 'Number', node: 'Content' };

// Where a setting is used, in plain words.
function uses(doc, name) {
  const out = [];
  (function walk(n) {
    if (n.textProp === name) out.push(`${n.id} text`);
    if (n.when === name) out.push(`show or hide ${n.id}`);
    if (n.slot === name) out.push(`${n.id} content`);
    for (const [k, v] of Object.entries(n.instance?.props || {})) if (v && typeof v === 'object' && v.prop === name) out.push(`${n.instance.component} ${k} in ${n.id}`);
    (n.children || []).forEach(walk);
  })(doc.root);
  return out;
}

function defaultControl(p, dis, label = true) {
  const id = `propdef-${p.name}`, nm = esc(p.name);
  if (p.type === 'boolean') {
    const on = p.default === true;
    return `<button type="button" role="switch" class="switch" id="${id}" aria-checked="${on}" aria-label="${nm}" data-cmp="bool-default" data-prop="${nm}" data-value="${!on}"${dis}><span class="knob"></span><span class="sw-text">${on ? 'On' : 'Off'}</span></button>`;
  }
  if (p.type === 'enum') {
    return `<div class="seg wrapseg" role="radiogroup" aria-label="${nm}" id="${id}">${p.options.map((o) => `<button type="button" role="radio" id="${id}-${esc(o)}" aria-checked="${o === p.default}" data-cmp="enum-default" data-prop="${nm}" data-value="${esc(o)}"${dis}>${esc(o)}</button>`).join('')}</div>`;
  }
  const num = p.type === 'number';
  return `<div class="fbox ${num ? 'num' : 'txt'}">${label ? `<label class="flabel pfx" for="${id}"><span class="lt">Default value</span></label>` : ''}<input id="${id}" data-cmp="default" data-prop="${nm}" data-kind="${p.type}" autocomplete="off" spellcheck="false" value="${esc(p.default ?? '')}" placeholder="${num ? '0' : 'Empty'}"${dis} aria-label="${nm}"></div>`;
}

// The everyday view, like Storybook's Controls: a name and a control that fits the type; the description is a quiet second line.
function row(doc, p, dis, other) {
  const nm = esc(p.name), u = uses(doc, p.name);
  return `<li class="prow" data-prop="${nm}" id="prop-${nm}">
    <div class="pcol-name"><span class="pn" id="prop-label-${nm}" data-cmp="name-dbl" title="Double-click to edit settings">${nm}</span>${p.description ? `<span class="pdesc" id="prop-note-${nm}">${esc(p.description)}</span>` : ''}</div>
    <div class="pcol-ctl">${defaultControl(p, dis, false)}</div>
    ${u.length ? `<p class="pmeta" id="uses-${nm}">Used by: ${esc(u.join(', '))}</p>` : ''}
    ${errorLine('prop-' + p.name, other)}${errorLine('propdef-' + p.name, other)}${errorLine('desc-' + p.name)}
  </li>`;
}

function card(doc, p, i, n, dis, other) {
  const u = uses(doc, p.name);
  const nm = esc(p.name);
  return `<li class="pcard" data-prop="${nm}" id="prop-${nm}">
    <div class="phead">
      <button type="button" class="grip" id="grip-prop-${nm}" data-grip="prop" aria-label="Drag to reorder ${nm}" title="Drag to reorder"${dis}>${ICON.grip}</button>
      <span class="ptype" title="${esc(TYPE_LABEL[p.type] || p.type)}" aria-label="${esc(TYPE_LABEL[p.type] || p.type)}">${ICON[p.type] || ICON.string}</span>
      <div class="fbox txt pname"><input id="prop-name-${nm}" data-cmp="rename" data-prop="${nm}" value="${nm}" autocomplete="off" spellcheck="false" aria-label="Name of setting ${nm}"${dis}></div>
      <button type="button" class="rowbtn" id="prop-up-${nm}" data-cmp="move" data-dir="-1" data-prop="${nm}" aria-label="Move ${nm} up" title="Move up"${dis}${i === 0 ? ' disabled' : ''}>${ICON.up}</button>
      <button type="button" class="rowbtn" id="prop-down-${nm}" data-cmp="move" data-dir="1" data-prop="${nm}" aria-label="Move ${nm} down" title="Move down"${dis}${i === n - 1 ? ' disabled' : ''}>${ICON.down}</button>
      <button type="button" class="x" id="remove-prop-${nm}" data-action="remove-prop" data-prop="${nm}" aria-label="Remove setting ${nm}" title="Remove"${dis}>×</button>
    </div>
    <div class="fld full">${p.type === 'enum' ? `<div class="enumrow"><span class="pfx flabel"><span class="lt">Default value</span></span>${defaultControl(p, dis)}</div>` : defaultControl(p, dis)}</div>
    ${p.description || ui.notes.has(p.name)
      ? `<div class="fld full"><div class="fbox txt"><label class="flabel pfx" for="prop-desc-${nm}"><span class="lt">Note</span></label><input id="prop-desc-${nm}" data-cmp="describe" data-prop="${nm}" value="${esc(p.description ?? '')}" placeholder="What it does (kept as a comment)" autocomplete="off"${dis} aria-label="Note for ${nm}"></div></div>`
      : `<button type="button" class="linkbtn" id="add-note-${nm}" data-cmp="add-note" data-prop="${nm}"${dis}>Add note</button>`}
    ${u.length ? `<p class="pmeta" id="uses-${nm}">Used by: ${esc(u.join(', '))}</p>` : ''}
    ${errorLine('prop-' + p.name, other)}${errorLine('propdef-' + p.name, other)}${errorLine('desc-' + p.name)}
  </li>`;
}

export function settingsBody(doc, dis, other) {
  const rows = ui.edit ? doc.props.map((p, i) => card(doc, p, i, doc.props.length, dis, other)).join('') : doc.props.map((p) => row(doc, p, dis, other)).join('');
  const types = propTypes(doc);
  return `${doc.props.length ? `<div class="phdr"><span class="pcols"><span>Name</span><span>Control</span></span><button type="button" class="minibtn" id="edit-settings" data-cmp="edit" aria-pressed="${ui.edit}"${dis}>${ui.edit ? 'Done' : 'Edit settings'}</button></div>` : ''}
    ${rows ? `<ul class="plain ${ui.edit ? 'pcards' : 'ptable'}" id="props">${rows}</ul>` : '<p class="hint">No settings yet.</p>'}
    ${forms.prop
      ? `<form data-cmp-submit="add-prop" class="inline addform"><label for="new-prop-name">Name</label><input id="new-prop-name" autocomplete="off" placeholder="label"${dis}>
          <label for="new-prop-type">Type</label><select id="new-prop-type" data-cmp="type"${dis}>${types.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
          <label for="new-prop-options" id="new-prop-options-label" hidden>Options (comma separated)</label><input id="new-prop-options" autocomplete="off" placeholder="sm, md, lg" hidden${dis}>
          <label for="new-prop-note">Note</label><input id="new-prop-note" autocomplete="off" placeholder="optional"${dis}>
          <div class="row2"><button type="submit" class="btn primary" id="add-prop-submit"${dis}>Add</button><button type="button" class="btn" data-cmp="close" data-form="prop">Cancel</button></div></form>`
      : `<button type="button" class="btn" id="add-prop" data-cmp="open" data-form="prop"${dis}>+ setting</button>`}${errorLine('add-prop')}`;
}

export function wireProps(ctx, el) {
  if (el.dataset.propsWired) return;
  el.dataset.propsWired = '1';
  const rerender = () => renderPanel(ctx);

  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-cmp]');
    if (!b) return;
    const { doc } = ctxDoc(ctx);
    const c = b.dataset.cmp, name = b.dataset.prop;
    if (c === 'open' && b.dataset.form === 'prop') { forms.prop = true; rerender(); setTimeout(() => el.querySelector('#new-prop-name')?.focus(), 0); }
    else if (c === 'edit') { ui.edit = !ui.edit; rerender(); }
    else if (c === 'add-note') { ui.notes.add(name); rerender(); setTimeout(() => el.querySelector(`#prop-desc-${CSS.escape(name)}`)?.focus(), 0); }
    else if (c === 'close' && b.dataset.form === 'prop') { delete forms.prop; delete errors['add-prop']; rerender(); }
    else if (c === 'move' && doc) {
      const at = doc.props.findIndex((p) => p.name === name) + Number(b.dataset.dir);
      await run(ctx, 'prop-' + name, [{ op: 'reorderProp', name, to: at }]);
    } else if (c === 'bool-default') await run(ctx, 'propdef-' + name, [{ op: 'setDefault', name, value: b.dataset.value === 'true' }]);
    else if (c === 'enum-default') await run(ctx, 'propdef-' + name, [{ op: 'setDefault', name, value: b.dataset.value }]);
  });

  el.addEventListener('dblclick', (ev) => { if (ev.target.closest('[data-cmp=name-dbl]') && !ui.edit) { ui.edit = true; rerender(); } });

  el.addEventListener('change', async (ev) => {
    const t = ev.target;
    const c = t.dataset?.cmp;
    if (!c) return;
    const { doc } = ctxDoc(ctx);
    if (!doc) return;
    const name = t.dataset.prop;
    if (c === 'type') {
      const enumUi = t.value === 'enum';
      el.querySelector('#new-prop-options').hidden = !enumUi;
      el.querySelector('#new-prop-options-label').hidden = !enumUi;
    } else if (c === 'rename') {
      const to = t.value.trim();
      if (to === name) return;
      const problem = checkName('setting', to, Object.fromEntries(doc.props.filter((x) => x.name !== name).map((x) => [x.name, x.type === 'enum' ? 'variant' : 'setting'])));
      if (problem) return refuse(ctx, 'prop-' + name, problem, t.id);
      await run(ctx, 'prop-' + name, [{ op: 'renameProp', name, to }], [t.id], { kind: 'setting', field: t.id, value: to });
    } else if (c === 'describe') {
      await run(ctx, 'desc-' + name, [{ op: 'describeProp', name, text: t.value.trim() }], [t.id]);
    } else if (c === 'default') {
      const raw = t.value.trim();
      const value = raw === '' ? null : t.dataset.kind === 'number' ? Number(raw) : raw;
      await run(ctx, 'propdef-' + name, [{ op: 'setDefault', name, value }], [t.id]);
    }
  });

  el.addEventListener('submit', async (ev) => {
    const form = ev.target;
    if (form.dataset.cmpSubmit !== 'add-prop') return;
    ev.preventDefault();
    const v = (id) => form.querySelector('#' + id)?.value.trim() ?? '';
    const type = v('new-prop-type');
    const edit = { op: 'addProp', name: v('new-prop-name'), type };
    if (type === 'enum') edit.options = v('new-prop-options').split(',').map((x) => x.trim()).filter(Boolean);
    if (v('new-prop-note')) edit.description = v('new-prop-note');
    const { doc } = ctxDoc(ctx);
    const problem = checkName('setting', edit.name, Object.fromEntries((doc?.props ?? []).map((x) => [x.name, x.type === 'enum' ? 'variant' : 'setting']))); // before anything is sent
    if (problem) return refuse(ctx, 'add-prop', problem, 'new-prop-name');
    delete errors['add-prop'];
    const r = await run(ctx, 'add-prop', [edit], [...form.querySelectorAll('[id]')].map((x) => x.id), { kind: 'setting', field: 'new-prop-name', value: edit.name });
    if (r.ok) { delete forms.prop; rerender(); }
  });

  el.addEventListener('pointerdown', (ev) => {
    const g = ev.target.closest('.grip[data-grip=prop]');
    if (!g || ev.button !== 0) return;
    const list = el.querySelector('#props');
    startDrag(ev, list, '.pcard', (r) => r.dataset.prop, (name, to) => run(ctx, 'prop-' + name, [{ op: 'reorderProp', name, to }]));
  });
}
