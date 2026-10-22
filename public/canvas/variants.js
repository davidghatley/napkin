// CMP-02 and CMP-03, the panel's variant parts.
//  - variantsBody(): the axes. Add an axis, add / rename / reorder / remove values, make a value the base.
//    A rename is one `renameVariant` or `renameProp` edit, so the file changes only on the lines that name it.
//  - sourcesBody(): for the selected element in the selected cell, where each property's value comes from:
//    base, or an axis=value override (accent dot), with Reset and "Move to base" on the row, and a note of the
//    other cells that override it. Nothing here writes a file; every action is one batch through ctx.sendEdits.
import { index, axes, resolveStyle } from '/src/model.js';
import { esc, ICON, errorLine, errors, run, ctxDoc, startDrag } from './cmp-core.js';
import { renderPanel } from './panel.js';

const forms = {};

const overrideCount = (doc, axis, value) => Object.values(doc.variants?.[axis]?.[value] || {}).reduce((n, st) => n + Object.keys(st).length, 0);

export function variantsBody(doc, dis, other) {
  const ax = axes(doc);
  const names = ax.map((a) => a.name);
  const axisUi = ax.map((a, ai) => {
    const an = esc(a.name);
    const rows = a.options.map((o, i) => {
      const isBase = o === a.default, on = overrideCount(doc, a.name, o), oe = esc(o);
      return `<li class="vrow" data-axis="${an}" data-value="${oe}">
        <button type="button" class="grip" id="grip-value-${an}-${oe}" data-grip="value" aria-label="Drag to reorder ${oe}" title="Drag to reorder"${dis}>${ICON.grip}</button>
        <div class="fbox txt vname"><input id="value-name-${an}-${oe}" data-cmp="rename-value" data-axis="${an}" data-value="${oe}" value="${oe}" autocomplete="off" spellcheck="false" aria-label="Name of ${an} value ${oe}"${dis}></div>
        ${isBase ? '<span class="badge" title="The base value: the component without an override">base</span>'
          : `<button type="button" class="minibtn" id="make-base-${an}-${oe}" data-cmp="make-base" data-axis="${an}" data-value="${oe}" title="${on ? `${oe} has ${on} override${on === 1 ? '' : 's'}; reset them first to make it the base` : `Make ${oe} the base value`}"${dis}${on ? ' disabled' : ''}>Make base</button>`}
        ${on ? `<span class="ocount" title="${on} overridden propert${on === 1 ? 'y' : 'ies'}">${on}</span>` : ''}
        <button type="button" class="rowbtn" id="value-up-${an}-${oe}" data-cmp="move-value" data-dir="-1" data-axis="${an}" data-value="${oe}" aria-label="Move ${oe} up" title="Move up"${dis}${i === 0 ? ' disabled' : ''}>${ICON.up}</button>
        <button type="button" class="rowbtn" id="value-down-${an}-${oe}" data-cmp="move-value" data-dir="1" data-axis="${an}" data-value="${oe}" aria-label="Move ${oe} down" title="Move down"${dis}${i === a.options.length - 1 ? ' disabled' : ''}>${ICON.down}</button>
        <button type="button" class="x" id="remove-value-${an}-${oe}" data-action="remove-value" data-axis="${an}" data-value="${oe}" aria-label="Remove ${oe}"${isBase ? ` disabled title="${oe} is the base of ${an}, so it can't be removed"` : ' title="Remove"'}${dis}>×</button>
      </li>`;
    }).join('');
    return `<div class="axis acard" data-axis="${an}" id="axis-${an}">
      <div class="phead"><span class="ptype" aria-hidden="true">${ICON.enum}</span>
        <div class="fbox txt pname"><input id="axis-name-${an}" data-cmp="rename-axis" data-axis="${an}" value="${an}" autocomplete="off" spellcheck="false" aria-label="Name of axis ${an}"${dis}></div>
        <button type="button" class="rowbtn" id="axis-up-${an}" data-cmp="move-axis" data-dir="-1" data-axis="${an}" aria-label="Move axis ${an} up" title="Move axis up"${dis}${ai === 0 ? ' disabled' : ''}>${ICON.up}</button>
        <button type="button" class="rowbtn" id="axis-down-${an}" data-cmp="move-axis" data-dir="1" data-axis="${an}" aria-label="Move axis ${an} down" title="Move axis down"${dis}${ai === ax.length - 1 ? ' disabled' : ''}>${ICON.down}</button>
        <button type="button" class="x" id="remove-axis-${an}" data-cmp="remove-axis" data-axis="${an}" aria-label="Remove axis ${an}" title="Remove axis and its overrides"${dis}>×</button></div>
      <ul class="plain vlist" data-axis="${an}">${rows}</ul>
      ${forms['value:' + a.name]
        ? `<form data-cmp-submit="add-value" data-axis="${an}" class="inline addform"><label for="new-value-${an}">New ${an} value</label><input id="new-value-${an}" autocomplete="off"${dis}><div class="row2"><button type="submit" class="btn primary" id="add-value-submit-${an}"${dis}>Add</button><button type="button" class="btn" data-cmp="close" data-form="value:${an}">Cancel</button></div></form>`
        : `<button type="button" class="btn small" id="add-value-${an}" data-cmp="open" data-form="value:${an}"${dis}>+ value</button>`}
      ${errorLine('axis-' + a.name, other)}</div>`;
  }).join('');
  const size = ax.reduce((n, a) => n * a.options.length, 1);
  return `${axisUi || '<p class="hint">No variant axes yet.</p>'}
    ${ax.length ? `<p class="pmeta" id="grid-size">${names.join(' × ')} = ${size} variant${size === 1 ? '' : 's'}</p>` : ''}
    ${forms.axis
      ? `<form data-cmp-submit="add-axis" class="inline addform"><label for="new-axis-name">Axis name</label><input id="new-axis-name" placeholder="size" autocomplete="off"${dis}>
          <label for="new-axis-value">First value</label><input id="new-axis-value" placeholder="sm" autocomplete="off"${dis}>
          <label for="new-axis-base">Base value</label><input id="new-axis-base" placeholder="default" autocomplete="off"${dis}>
          <div class="row2"><button type="submit" class="btn primary" id="add-axis-submit"${dis}>Add</button><button type="button" class="btn" data-cmp="close" data-form="axis">Cancel</button></div></form>`
      : `<button type="button" class="btn" id="add-axis" data-cmp="open" data-form="axis"${dis}>+ axis</button>`}${errorLine('add-axis')}`;
}

// ---- CMP-03: sources ----
const human = (prop) => { const t = prop.replace(/([A-Z])/g, ' $1').toLowerCase(); return t[0].toUpperCase() + t.slice(1); };
const fmt = (v) => (typeof v === 'number' ? String(v) : String(v));

// The rows for one element in one cell: [{ prop, value, from: null | [axis, value], also: [[axis, value]] }]
export function sourceRows(doc, nodeId, cell) {
  const node = index(doc).byId.get(nodeId);
  if (!node) return [];
  const ax = axes(doc);
  const inCell = ax.map((a) => [a.name, cell?.[a.name] ?? a.default]).filter(([n, v]) => v !== ax.find((a) => a.name === n).default);
  const resolved = resolveStyle(doc, nodeId, cell || {});
  const everywhere = []; // every axis=value that overrides this node
  for (const [axis, vals] of Object.entries(doc.variants || {})) for (const [value, nodes] of Object.entries(vals)) if (nodes[nodeId]) everywhere.push([axis, value, nodes[nodeId]]);
  const props = [...new Set([...Object.keys(node.style || {}), ...everywhere.flatMap(([, , st]) => Object.keys(st))])];
  return props.filter((p) => resolved[p] !== undefined).map((prop) => {
    let from = null;
    for (const [a, v] of inCell) if (doc.variants?.[a]?.[v]?.[nodeId]?.[prop] !== undefined) from = [a, v]; // the last axis wins, as in resolveStyle
    const also = everywhere.filter(([a, v, st]) => st[prop] !== undefined && !(from && from[0] === a && from[1] === v) && !inCell.some(([ia, iv]) => ia === a && iv === v)).map(([a, v]) => [a, v]);
    return { prop, value: resolved[prop], from, also };
  });
}

export function sourcesBody(doc, sel, dis) {
  const rows = sourceRows(doc, sel.node, sel.variant);
  if (!rows.length) return '<p class="hint" id="sources-empty">This element has no styles yet.</p>';
  const li = rows.map((r) => {
    const p = esc(r.prop), from = r.from ? `${r.from[0]}=${r.from[1]}` : 'base';
    return `<li class="srow${r.from ? ' over' : ''}" data-prop="${p}" id="src-${p}" data-source="${esc(from)}">
      <div class="sline"><span class="${r.from ? 'dot' : 'dot off'}" id="src-dot-${p}" role="img" aria-label="${r.from ? `${esc(human(r.prop))} is overridden by ${esc(from)}` : `${esc(human(r.prop))} comes from the base`}"></span><span class="sname">${esc(human(r.prop))}</span><code class="sval">${esc(fmt(r.value))}</code></div>
      <div class="sline sub"><span class="srcchip${r.from ? ' over' : ''}" id="src-chip-${p}">${esc(from)}</span>
        ${r.from ? `<button type="button" class="minibtn" id="src-reset-${p}" data-cmp="src-reset" data-prop="${p}" data-axis="${esc(r.from[0])}" data-value="${esc(r.from[1])}" title="Remove the ${esc(from)} override; the base value shows again"${dis}>${ICON.reset} Reset</button>
        <button type="button" class="minibtn" id="src-base-${p}" data-cmp="src-base" data-prop="${p}" data-axis="${esc(r.from[0])}" data-value="${esc(r.from[1])}" title="Make this value the base for every variant, and drop the ${esc(from)} override"${dis}>${ICON.base} Move to base</button>` : ''}
        ${r.also.length ? `<span class="also" id="src-also-${p}">also in ${esc(r.also.map(([a, v]) => `${a}=${v}`).join(', '))}</span>` : ''}</div>
      ${errorLine('src-' + r.prop)}</li>`;
  }).join('');
  return `<ul class="plain srcs" id="sources">${li}</ul>`;
}
export const overriddenCount = (doc, sel) => sourceRows(doc, sel.node, sel.variant).filter((r) => r.from).length;

export function wireVariants(ctx, el) {
  if (el.dataset.variantsWired) return;
  el.dataset.variantsWired = '1';
  const rerender = () => renderPanel(ctx);

  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-cmp]');
    if (!b) return;
    const { s, doc } = ctxDoc(ctx);
    const c = b.dataset.cmp, d = b.dataset;
    if (!doc) return;
    if (c === 'open' && (d.form === 'axis' || d.form?.startsWith('value:'))) { forms[d.form] = true; rerender(); setTimeout(() => el.querySelector('form.addform input')?.focus(), 0); }
    else if (c === 'close' && (d.form === 'axis' || d.form?.startsWith('value:'))) { delete forms[d.form]; rerender(); }
    else if (c === 'move-value') {
      const a = doc.props.find((p) => p.name === d.axis);
      await run(ctx, 'axis-' + d.axis, [{ op: 'reorderVariant', axis: d.axis, value: d.value, to: a.options.indexOf(d.value) + Number(d.dir) }]);
    } else if (c === 'move-axis') {
      const order = axes(doc).map((a) => a.name), at = order.indexOf(d.axis) + Number(d.dir);
      if (at < 0 || at >= order.length) return;
      await run(ctx, 'axis-' + d.axis, [{ op: 'reorderProp', name: d.axis, to: doc.props.findIndex((p) => p.name === order[at]) }]);
    } else if (c === 'remove-axis') await run(ctx, 'axis-' + d.axis, [{ op: 'removeProp', name: d.axis }]);
    else if (c === 'make-base') await run(ctx, 'axis-' + d.axis, [{ op: 'setDefault', name: d.axis, value: d.value }]);
    else if (c === 'src-reset') await run(ctx, 'src-' + d.prop, [{ op: 'set', path: `${s.node}.${d.prop}`, value: null, variant: { [d.axis]: d.value } }]);
    else if (c === 'src-base') {
      const value = doc.variants?.[d.axis]?.[d.value]?.[s.node]?.[d.prop];
      if (value === undefined) return;
      await run(ctx, 'src-' + d.prop, [{ op: 'set', path: `${s.node}.${d.prop}`, value }, { op: 'set', path: `${s.node}.${d.prop}`, value: null, variant: { [d.axis]: d.value } }]);
    }
  });

  el.addEventListener('change', async (ev) => {
    const t = ev.target, c = t.dataset?.cmp;
    if (c !== 'rename-axis' && c !== 'rename-value') return;
    const to = t.value.trim();
    if (c === 'rename-axis') { if (to !== t.dataset.axis) await run(ctx, 'axis-' + t.dataset.axis, [{ op: 'renameProp', name: t.dataset.axis, to }], [t.id]); }
    else if (to !== t.dataset.value) await run(ctx, 'axis-' + t.dataset.axis, [{ op: 'renameVariant', axis: t.dataset.axis, value: t.dataset.value, to }], [t.id]);
  });

  el.addEventListener('submit', async (ev) => {
    const form = ev.target, kind = form.dataset.cmpSubmit;
    if (kind !== 'add-value' && kind !== 'add-axis') return;
    ev.preventDefault();
    const v = (id) => form.querySelector('#' + id)?.value.trim() ?? '';
    const ids = [...form.querySelectorAll('[id]')].map((x) => x.id);
    let r;
    if (kind === 'add-value') { const axis = form.dataset.axis; r = await run(ctx, 'axis-' + axis, [{ op: 'addVariant', axis, value: v('new-value-' + axis) }], ids); if (r.ok) delete forms['value:' + axis]; }
    else {
      const edit = { op: 'addVariant', axis: v('new-axis-name'), value: v('new-axis-value') };
      if (v('new-axis-base')) edit.base = v('new-axis-base');
      r = await run(ctx, 'add-axis', [edit], ids);
      if (r.ok) delete forms.axis;
    }
    if (r.ok) rerender();
  });

  el.addEventListener('pointerdown', (ev) => {
    const g = ev.target.closest('.grip[data-grip=value]');
    if (!g || ev.button !== 0) return;
    const list = g.closest('.vlist'), axis = list.dataset.axis;
    startDrag(ev, list, '.vrow', (r) => r.dataset.value, (value, to) => run(ctx, 'axis-' + axis, [{ op: 'reorderVariant', axis, value, to }]));
  });
}
