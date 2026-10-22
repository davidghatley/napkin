// CMP-01: the props editor ("Settings" in the panel). Each setting is a card: grip, type, name, Up / Down, remove;
// its default (a control that fits the type), and a description that is written as a JSDoc comment above it in the file.
// Add, rename, retype-by-adding, reorder (drag the grip or use Up / Down) and remove all go through ctx.sendEdits.
// A rename is one `renameProp` edit: the file updates the interface, the parameter and every place that shows it.
import { applyEdits } from '/src/model.js';
import { esc, ICON, errorLine, errors, run, ctxDoc, startDrag } from './cmp-core.js';
import { renderPanel } from './panel.js';

const forms = {}; // which "add" forms are open
export const formOpen = (k) => !!forms[k];

// Types the model accepts today (a number prop arrives with the dialect widening: ask the model, so this follows it).
export function propTypes(doc) {
  const probe = (type) => { try { applyEdits(doc, [{ op: 'addProp', name: 'probeprop', type }]); return true; } catch { return false; } };
  return ['string', 'boolean', 'enum', ...(probe('number') ? ['number'] : [])];
}
const TYPE_LABEL = { string: 'Text', boolean: 'On / off', enum: 'Choice', number: 'Number', node: 'Content' };

// What each setting does in the component: its text, a hidden element, a slot, an instance's attribute.
function uses(doc, name) {
  const out = [];
  (function walk(n) {
    if (n.textProp === name) out.push(['shows', n.id]);
    if (n.when === name) out.push(['shown when', n.id]);
    if (n.slot === name) out.push(['content of', n.id]);
    for (const [k, v] of Object.entries(n.instance?.props || {})) if (v && typeof v === 'object' && v.prop === name) out.push([`passed to ${n.instance.component}.${k} at`, n.id]);
    (n.children || []).forEach(walk);
  })(doc.root);
  return out;
}

function defaultControl(p, dis) {
  const id = `propdef-${p.name}`;
  if (p.type === 'boolean') {
    const on = p.default === true;
    return `<div class="seg" role="radiogroup" aria-label="Default of ${esc(p.name)}" id="${id}">
      <button type="button" role="radio" id="${id}-false" aria-checked="${!on}" data-cmp="bool-default" data-prop="${esc(p.name)}" data-value="false"${dis}>False</button>
      <button type="button" role="radio" id="${id}-true" aria-checked="${on}" data-cmp="bool-default" data-prop="${esc(p.name)}" data-value="true"${dis}>True</button></div>`;
  }
  if (p.type === 'enum') {
    return `<div class="seg wrapseg" role="radiogroup" aria-label="Default of ${esc(p.name)}" id="${id}">${p.options.map((o) => `<button type="button" role="radio" id="${id}-${esc(o)}" aria-checked="${o === p.default}" data-cmp="enum-default" data-prop="${esc(p.name)}" data-value="${esc(o)}"${dis}>${esc(o)}</button>`).join('')}</div>`;
  }
  const num = p.type === 'number';
  return `<div class="fbox ${num ? 'num' : 'txt'}"><label class="flabel pfx" for="${id}"><span class="lt">Default</span></label><input id="${id}" data-cmp="default" data-prop="${esc(p.name)}" data-kind="${p.type}" autocomplete="off" spellcheck="false" value="${esc(p.default ?? '')}" placeholder="${num ? '0' : 'None'}"${dis} aria-label="Default of ${esc(p.name)}"></div>`;
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
    <div class="fld full">${p.type === 'enum' ? `<div class="enumrow"><span class="pfx flabel"><span class="lt">Base</span></span>${defaultControl(p, dis)}</div>` : defaultControl(p, dis)}</div>
    <div class="fld full"><div class="fbox txt"><label class="flabel pfx" for="prop-desc-${nm}"><span class="lt">Note</span></label><input id="prop-desc-${nm}" data-cmp="describe" data-prop="${nm}" value="${esc(p.description ?? '')}" placeholder="What it does (kept as a comment)" autocomplete="off"${dis} aria-label="Description of ${nm}"></div></div>
    ${u.length ? `<p class="pmeta" id="uses-${nm}">${u.map(([how, id]) => `${esc(how)} <code>${esc(id)}</code>`).join(' · ')}</p>` : ''}
    ${errorLine('prop-' + p.name, other)}${errorLine('propdef-' + p.name, other)}${errorLine('desc-' + p.name)}
  </li>`;
}

export function settingsBody(doc, dis, other) {
  const cards = doc.props.map((p, i) => card(doc, p, i, doc.props.length, dis, other)).join('');
  const types = propTypes(doc);
  return `${cards ? `<ul class="plain pcards" id="props">${cards}</ul>` : '<p class="hint">No settings yet.</p>'}
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
    else if (c === 'close' && b.dataset.form === 'prop') { delete forms.prop; delete errors['add-prop']; rerender(); }
    else if (c === 'move' && doc) {
      const at = doc.props.findIndex((p) => p.name === name) + Number(b.dataset.dir);
      await run(ctx, 'prop-' + name, [{ op: 'reorderProp', name, to: at }]);
    } else if (c === 'bool-default') await run(ctx, 'propdef-' + name, [{ op: 'setDefault', name, value: b.dataset.value === 'true' }]);
    else if (c === 'enum-default') await run(ctx, 'propdef-' + name, [{ op: 'setDefault', name, value: b.dataset.value }]);
  });

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
      await run(ctx, 'prop-' + name, [{ op: 'renameProp', name, to }], [t.id]);
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
    const r = await run(ctx, 'add-prop', [edit], [...form.querySelectorAll('[id]')].map((x) => x.id));
    if (r.ok) { delete forms.prop; rerender(); }
  });

  el.addEventListener('pointerdown', (ev) => {
    const g = ev.target.closest('.grip[data-grip=prop]');
    if (!g || ev.button !== 0) return;
    const list = el.querySelector('#props');
    startDrag(ev, list, '.pcard', (r) => r.dataset.prop, (name, to) => run(ctx, 'prop-' + name, [{ op: 'reorderProp', name, to }]));
  });
}
