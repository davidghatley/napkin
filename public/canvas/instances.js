// Composition on the canvas (CMP-04, CMP-06, CMP-07, CMP-08), against the 0004 ops:
//   - "Show when" (a boolean setting shows or hides the node: `set node.@when`),
//   - insert another component as an instance (a picker in the panel, or drag a frame's title onto a frame: `insertInstance`),
//   - an instance's props as attributes (`set node.prop:<name>`, a text / number / true-false / a setting passed through),
//   - swap an instance for another component, keeping the props both have (`swapInstance`),
//   - "Make component" for any subtree (POST /api/components/:id/extract: a new file, an instance in its place).
// The page never writes files: each of these is one ctx.sendEdits batch (or the server's extract route).
// Also here: the canvas labels. A nested component draws its own elements (their data-n are the inner file's); after each
// render the instance's root takes the instance's id as data-n and the inner elements stay unlabelled, so a click on a
// nested Button selects the instance in the host, not an element of Button.
import { plain, stripNext } from './words.js';
import { index, propOf, axes, instancePropFits } from '/src/model.js';
import { esc, errorLine, errors, run, ctxDoc } from './cmp-core.js';
import { renderPanel } from './panel.js';

const dirOf = (c) => String(c.path || '').split('/').slice(0, -1).join('/');
const usesNames = (doc) => (doc ? [...new Set([...index(doc).byId.values()].filter((n) => n.instance).map((n) => n.instance.component))] : []);
const holds = (n) => n.tag !== 'img' && !n.instance && n.text === undefined && !n.textProp && !n.slot;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Components of the same folder this one may use: editable, not itself, and not already using it (no cycle).
export function siblingsOf(ctx, comp) {
  const all = [...ctx.state.components.values()].filter((c) => dirOf(c) === dirOf(comp));
  const byName = new Map(all.map((c) => [c.name, c]));
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return usesNames(byName.get(from)?.doc).some((n) => reaches(n, target, seen));
  };
  return all.filter((c) => c.component !== comp.component && c.doc && !c.readOnly && !reaches(c.name, comp.name)).sort((a, b) => a.name.localeCompare(b.name));
}

const freeId = (doc, stem) => {
  const taken = new Set(index(doc).byId.keys());
  const base = stem.charAt(0).toLowerCase() + stem.slice(1);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(base + n)) return base + n;
};

// ---------------------------------------------------------------- the panel section
const kindOf = (p) => (p.type === 'enum' ? 'string' : p.type);

function instanceRows(ctx, doc, node, comp, dis) {
  const target = siblingsOf(ctx, comp).find((c) => c.name === node.instance.component) || ctx.named(node.instance.component).find((c) => dirOf(c) === dirOf(comp));
  if (!target?.doc) return `<p class="hint" id="inst-missing">${esc(node.instance.component)} has no file next to this one.</p>`;
  const given = node.instance.props;
  const rows = target.doc.props.filter((p) => p.type !== 'node').map((p) => {
    const v = given[p.name], linked = v && typeof v === 'object' ? v.prop : null;
    const mine = doc.props.filter((q) => q.type !== 'node' && kindOf(q) === kindOf(p) && (p.type !== 'enum' || (q.type === 'enum' && q.options.join() === p.options.join())));
    const id = `inst-${esc(p.name)}`;
    let ctl;
    if (linked) ctl = `<div class="fbox txt"><label class="flabel pfx"><span class="lt">${esc(p.name)}</span></label><span class="linked" id="${id}">from <code>${esc(linked)}</code></span></div>`;
    else if (p.type === 'boolean') ctl = `<div class="fbox txt"><label class="flabel pfx" id="${id}-label"><span class="lt">${esc(p.name)}</span></label><div class="seg" role="radiogroup" aria-labelledby="${id}-label" id="${id}">${[['', 'Default'], ['false', 'False'], ['true', 'True']].map(([val, t]) => `<button type="button" role="radio" id="${id}-${val || 'default'}" aria-checked="${String(v ?? '') === val}" data-inst="bool" data-prop="${esc(p.name)}" data-value="${val}"${dis}>${t}</button>`).join('')}</div></div>`;
    else if (p.type === 'enum') ctl = `<div class="fbox sel"><label class="flabel pfx" for="${id}"><span class="lt">${esc(p.name)}</span></label><select id="${id}" data-inst="value" data-prop="${esc(p.name)}" data-kind="string"${dis}><option value="">Default (${esc(p.default)})</option>${p.options.map((o) => `<option value="${esc(o)}"${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    else ctl = `<div class="fbox ${p.type === 'number' ? 'num' : 'txt'}"><label class="flabel pfx" for="${id}"><span class="lt">${esc(p.name)}</span></label><input id="${id}" data-inst="value" data-prop="${esc(p.name)}" data-kind="${p.type}" value="${esc(v ?? '')}" placeholder="${esc(p.default ?? '')}" autocomplete="off"${dis}></div>`;
    const link = mine.length ? `<div class="fbox sel plink"><label class="flabel pfx" for="${id}-link"><span class="lt">Setting</span></label><select id="${id}-link" data-inst="link" data-prop="${esc(p.name)}"${dis}><option value="">A value</option>${mine.map((q) => `<option value="${esc(q.name)}"${linked === q.name ? ' selected' : ''}>${esc(q.name)}</option>`).join('')}</select></div>` : '';
    return `<div class="fld full">${ctl}</div>${link ? `<div class="fld full plinkrow">${link}</div>` : ''}`;
  }).join('');
  const others = siblingsOf(ctx, comp).filter((c) => c.name !== node.instance.component);
  const keep = (c) => { const kept = Object.entries(given).filter(([k, v]) => { const tp = propOf(c.doc, k); return tp && instancePropFits(doc, v, tp); }).map(([k]) => k); return { kept, dropped: Object.keys(given).filter((k) => !kept.includes(k)) }; };
  const swap = others.length ? `<div class="fld full"><div class="fbox sel"><label class="flabel pfx" for="swap-select"><span class="lt">Swap for</span></label><select id="swap-select" data-inst="swap"${dis}><option value="">Choose…</option>${others.map((c) => { const { kept, dropped } = keep(c); return `<option value="${esc(c.name)}" title="keeps ${esc(kept.join(', ') || 'nothing')}${dropped.length ? `; drops ${esc(dropped.join(', '))}` : ''}">${esc(c.name)}${dropped.length ? ` (drops ${dropped.length})` : ''}</option>`; }).join('')}</select></div></div>` : '';
  return `<div class="instrows">${rows || '<p class="hint">This component has no settings to pass.</p>'}</div>${swap}
    <div class="row2"><button type="button" class="btn small" id="open-instance" data-inst="open" data-name="${esc(node.instance.component)}">Open ${esc(node.instance.component)}</button></div>`;
}

export function composeBody(ctx, doc, node, comp, dis) {
  const { byId, parentOf } = index(doc);
  const isRoot = !parentOf.get(node.id);
  const parts = [];
  // CMP-04: show when
  if (!isRoot) {
    const bools = doc.props.filter((p) => p.type === 'boolean');
    parts.push(`<div class="fld full" id="when-row"><div class="fbox sel"><label class="flabel pfx" for="when-select"><span class="lt">Show when</span></label>
      <select id="when-select" data-inst="when"${dis}><option value="">Always</option>${bools.map((p) => `<option value="${esc(p.name)}"${node.when === p.name ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="+new">New setting…</option></select></div>
      ${node.when ? `<p class="pmeta" id="when-note">Shown while <code>${esc(node.when)}</code> is on; hidden when it is off. Try it in play mode.</p>` : ''}</div>`);
  }
  // CMP-05: slot
  if (node.slot) {
    const text = ctx.find(comp.component)?.slots?.[node.slot] ?? '';
    parts.push(`<div class="fld full" id="slot-row"><p class="pmeta">This element shows what the caller puts in <code>${esc(node.slot)}</code>.</p>
      <div class="fbox txt"><label class="flabel pfx" for="slot-preview"><span class="lt">Preview</span></label><input id="slot-preview" data-inst="slot-preview" data-slot="${esc(node.slot)}" value="${esc(text)}" placeholder="Words shown here on the canvas" autocomplete="off"${dis}></div>
      <p class="pmeta">The preview is kept beside the file, never in it.</p>
      <div class="row2"><button type="button" class="btn small" id="slot-remove" data-inst="slot-remove"${dis}>Remove slot</button></div></div>`);
  } else if (holds(node) && !node.children.length) {
    const slots = doc.props.filter((p) => p.type === 'node');
    parts.push(`<div class="fld full" id="slot-row"><div class="fbox sel"><label class="flabel pfx" for="slot-select"><span class="lt">Content slot</span></label><select id="slot-select" data-inst="slot"${dis}><option value="">None</option>${slots.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}${slots.some((p) => p.name === 'children') ? '' : '<option value="+children">New “children” slot</option>'}</select></div></div>`);
  }
  // CMP-06 / 07: an instance
  if (node.instance) parts.push(`<div class="instbox" id="instance-box"><p class="pmeta">Instance of <strong>${esc(node.instance.component)}</strong>. Its settings are written as attributes in this file.</p>${instanceRows(ctx, doc, node, comp, dis)}</div>`);
  // insert another component
  const sibs = siblingsOf(ctx, comp);
  if (holds(node)) {
    parts.push(`<div class="fld full" id="insert-row"><span class="metacap">Insert a component into ${esc(node.id)}</span>
      ${sibs.length ? `<div class="picker" role="list">${sibs.map((c) => `<button type="button" class="btn small" role="listitem" id="insert-${esc(c.name)}" data-inst="insert" data-name="${esc(c.name)}" title="Insert ${esc(c.name)} into ${esc(node.id)}"${dis}>＋ ${esc(c.name)}</button>`).join('')}</div>` : '<p class="hint">No other component to insert. Drag another frame’s title onto this frame, or make a component from a selection.</p>'}</div>`);
  }
  // CMP-08: extract
  if (!isRoot && !node.instance) {
    parts.push(`<div class="fld full" id="extract-row">${errors.extractOpen === node.id
      ? `<form data-cmp-submit="extract" class="inline addform"><label for="extract-name">New component name</label><input id="extract-name" value="${esc(cap(node.id))}" autocomplete="off"${dis}><div class="row2"><button type="submit" class="btn primary" id="extract-submit"${dis}>Make component</button><button type="button" class="btn" data-inst="extract-cancel">Cancel</button></div></form>`
      : `<button type="button" class="btn" id="make-component" data-inst="extract-open"${dis}>Make component…</button>`}${errorLine('extract')}</div>`);
  }
  return `${parts.join('')}${errorLine('compose')}`;
}

// ---------------------------------------------------------------- wiring
export function initInstances(ctx) {
  const panel = document.querySelector('#panel');
  const rerender = () => renderPanel(ctx);

  const insert = async (componentId, hostId, parentNode, name) => {
    const host = ctx.state.components.get(componentId);
    if (!host?.doc) return { ok: false, error: 'component is not loaded' };
    const id = freeId(host.doc, name);
    const r = await ctx.sendEdits(componentId, [{ op: 'insertInstance', parent: parentNode, id, component: name }]);
    if (r.ok) { ctx.hint(`${name} added to ${host.name} as ${id}`); ctx.select({ component: componentId, node: id, variant: ctx.state.selection?.variant ?? {} }); }
    else ctx.hint(plain(r.error));
    return r;
  };

  async function extract() {
    const { s, comp, doc } = ctxDoc(ctx);
    const name = panel.querySelector('#extract-name')?.value.trim();
    if (!s || !doc) return;
    const r = await (await ctx.fetch(`/api/components/${encodeURIComponent(s.component)}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: s.node, name }) })).json();
    if (!r.ok) { errors.extract = stripNext(r.error); rerender(); return; }
    delete errors.extract; delete errors.extractOpen;
    ctx.hint(`${name} made from ${s.node}. It is a new file next to ${comp.name}.`);
    setTimeout(rerender, 0);
  }

  panel.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-inst]');
    if (!b) return;
    const { s, comp, doc } = ctxDoc(ctx);
    if (!s || !doc) return;
    const a = b.dataset.inst;
    if (a === 'insert') await insert(s.component, s.node, s.node, b.dataset.name);
    else if (a === 'extract-open') { errors.extractOpen = s.node; rerender(); setTimeout(() => panel.querySelector('#extract-name')?.select(), 0); }
    else if (a === 'extract-cancel') { delete errors.extractOpen; delete errors.extract; rerender(); }
    else if (a === 'open') ctx.nav.focus(ctx.named(b.dataset.name).find((c) => dirOf(c) === dirOf(comp))?.component ?? b.dataset.name);
    else if (a === 'bool') await run(ctx, 'compose', [{ op: 'set', path: `${s.node}.prop:${b.dataset.prop}`, value: b.dataset.value === '' ? null : b.dataset.value === 'true' }]);
    else if (a === 'slot-remove') await run(ctx, 'compose', [{ op: 'set', path: `${s.node}.@slot`, value: null }]);
  });

  panel.addEventListener('change', async (ev) => {
    const t = ev.target, a = t.dataset?.inst;
    if (!a) return;
    const { s, comp, doc } = ctxDoc(ctx);
    if (!s || !doc) return;
    const node = index(doc).byId.get(s.node);
    if (a === 'when') {
      if (t.value === '+new') {
        const stem = /^[a-z][a-zA-Z0-9]*$/.test(node.id) && !propOf(doc, node.id) && !['children', 'default'].includes(node.id) ? node.id : `show${cap(node.id.replace(/[^a-zA-Z0-9]/g, ''))}`;
        await run(ctx, 'compose', [{ op: 'addProp', name: stem, type: 'boolean', default: true }, { op: 'set', path: `${s.node}.@when`, value: stem }]);
      } else await run(ctx, 'compose', [{ op: 'set', path: `${s.node}.@when`, value: t.value || null }]);
    } else if (a === 'slot') {
      if (t.value === '+children') await run(ctx, 'compose', [{ op: 'addProp', name: 'children', type: 'node' }, { op: 'set', path: `${s.node}.@slot`, value: 'children' }]);
      else if (t.value) await run(ctx, 'compose', [{ op: 'set', path: `${s.node}.@slot`, value: t.value }]);
    } else if (a === 'slot-preview') {
      const r = await (await ctx.fetch(`/api/components/${encodeURIComponent(s.component)}/slot-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prop: t.dataset.slot, text: t.value === '' ? null : t.value }) })).json();
      if (!r.ok) { errors.compose = stripNext(r.error); rerender(); } else delete errors.compose;
    } else if (a === 'value') {
      const raw = t.value.trim();
      const value = raw === '' ? null : t.dataset.kind === 'number' ? Number(raw) : raw;
      await run(ctx, 'compose', [{ op: 'set', path: `${s.node}.prop:${t.dataset.prop}`, value }], [t.id]);
    } else if (a === 'link') {
      const name = t.dataset.prop;
      await run(ctx, 'compose', [{ op: 'set', path: `${s.node}.prop:${name}`, value: t.value ? { prop: t.value } : null }]);
    } else if (a === 'swap' && t.value) {
      const before = node.instance.props;
      const r = await run(ctx, 'compose', [{ op: 'swapInstance', id: s.node, component: t.value }]);
      if (r.ok) {
        const after = index(r.doc).byId.get(s.node)?.instance?.props ?? {};
        const dropped = Object.keys(before).filter((k) => !(k in after));
        ctx.hint(`${node.instance.component} swapped for ${t.value}. Kept ${Object.keys(after).join(', ') || 'no props'}${dropped.length ? `; dropped ${dropped.join(', ')}` : ''}.`);
      }
    }
  });

  panel.addEventListener('submit', (ev) => { if (ev.target.dataset.cmpSubmit === 'extract') { ev.preventDefault(); extract(); } });

  // Drag a frame's title onto another frame: the dragged component becomes an instance inside the element under the pointer.
  ctx.frameDrop = (id, x, y) => {
    const host = [...document.elementsFromPoint(x, y)].map((e) => e.closest('.mount [data-n]')).find((e) => e && e.closest('section.cmp')?.dataset.component !== id);
    if (!host) return false;
    const hostId = host.closest('section.cmp').dataset.component, hc = ctx.state.components.get(hostId), dragged = ctx.state.components.get(id);
    if (!hc?.doc || !dragged || hc.readOnly) return false;
    let n = index(hc.doc).byId.get(host.dataset.n);
    const { parentOf } = index(hc.doc);
    while (n && !holds(n)) n = parentOf.get(n.id);
    if (!n) return false;
    if (!siblingsOf(ctx, hc).some((c) => c.component === id)) { ctx.hint(`${dragged.name} cannot go inside ${hc.name}: ${dirOf(dragged) === dirOf(hc) ? 'it would make a cycle or is not editable' : 'they are in different folders'}`); return false; }
    insert(hostId, hostId, n.id, dragged.name);
    return true;
  };
  ctx.on('framedrag', ({ x, y, id }) => {
    document.querySelectorAll('.drop-target').forEach((e) => e.classList.remove('drop-target'));
    const host = [...document.elementsFromPoint(x, y)].map((e) => e.closest('.mount [data-n]')).find((e) => e && e.closest('section.cmp')?.dataset.component !== id);
    host?.classList.add('drop-target');
  });
  ctx.on('framedragend', () => document.querySelectorAll('.drop-target').forEach((e) => e.classList.remove('drop-target')));

  // Canvas labels for nested components, after every render.
  ctx.on('render', ({ component }) => label(component));
  function label(id) {
    const c = ctx.state.components.get(id), sec = document.querySelector(`section.cmp[data-component="${CSS.escape(id)}"]`);
    if (!c?.doc || !sec || !usesNames(c.doc).length) return;
    for (const mount of sec.querySelectorAll('.cell .mount')) {
      const rootEl = mount.firstElementChild;
      if (rootEl) walk(c.doc.root, rootEl);
    }
  }
  // Match the host's nodes to the DOM, child by child. Conditions can hide nodes, so the next DOM child is matched against the
  // remaining nodes in order: a plain node by its data-n, an instance when nothing plain comes first (its own root has the inner id).
  function walk(node, el) {
    if (node.slot || node.text !== undefined || node.textProp) return;
    const kids = node.children;
    let j = 0;
    for (const d of el.children) {
      const dn = d.getAttribute('data-n');
      for (let k = j; k < kids.length; k++) {
        const c = kids[k];
        if (!c.instance && c.id === dn) { j = k + 1; walk(c, d); break; }
        if (c.instance) {
          if (c.when && kids.slice(k + 1).some((x) => !x.instance && x.id === dn)) continue; // hidden by its condition
          d.setAttribute('data-n', c.id); d.setAttribute('data-instance', c.instance.component);
          for (const inner of d.querySelectorAll('[data-n]')) { inner.setAttribute('data-inner', inner.getAttribute('data-n')); inner.removeAttribute('data-n'); }
          j = k + 1; break;
        }
      }
    }
  }
  ctx.instances = { siblingsOf: (c) => siblingsOf(ctx, c), insert, label };
}
