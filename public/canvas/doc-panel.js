// The design panel for a document-engine component (decision 0014): the selected element of an HTML file, its text,
// classes and inline style, and every CSS rule of its cascade that matches it, each value editable at its source with
// the file and line it lives on. Matching is the browser's own: element.matches() and matchMedia() inside the frame.
// Every change is one contract edit (POST /api/edit): text, class, style, rule or var. The file is the source of truth;
// the frame and this panel redraw from it when the engine says it changed.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const normSel = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim();
const normMedia = (t) => String(t ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*:\s*/g, ': ').trim().toLowerCase();
const rulesCache = new Map(); // component -> { stamp, data }
let stamp = 0;
export const docsChanged = () => { stamp++; };

async function rulesFor(id) {
  const c = rulesCache.get(id);
  if (c && c.stamp === stamp) return c.data;
  const data = await (await fetch(`/api/component/${encodeURIComponent(id)}/rules`)).json();
  rulesCache.set(id, { stamp, data });
  return data;
}
// A selector the element matches (pseudo-elements are matched by their element; an invalid selector matches nothing).
function matches(el, selector) {
  const sel = selector.replace(/::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b(\([^)]*\))?/gi, '');
  try { return el.matches(sel.trim() || '*'); } catch { return false; }
}
// Each selector of a list on its own, so a rule "a, .b" shows which part matched.
const parts = (selector) => { const out = []; let depth = 0, cur = ''; for (const ch of selector) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };

export async function renderDocPanel(ctx, el, sel, comp) {
  const frame = ctx.stage.sections.get(comp.component)?.docFrame;
  const node = frame?.node(sel.node);
  const target = frame?.element(sel.node)?.el;
  const key = `${comp.component}|${sel.node}|${comp.revision}|${stamp}`;
  if (!node) { el.innerHTML = `<div class="selhead"><div class="crumb"><span class="chip" id="sel-component">${esc(comp.name)}</span></div><p class="hint">${esc(comp.path)} · loading…</p></div>`; return; }
  const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  if (el.dataset.full === key && focus) return; // a redraw would take the field from under the cursor
  el.dataset.full = key;
  const data = await rulesFor(comp.component).catch(() => ({ rules: [] }));
  if (ctx.state.selection !== sel) return; // the selection moved on while the rules loaded
  const win = target?.ownerDocument.defaultView;
  const media = (r) => !r.media.length || r.media.every((m) => { try { return win?.matchMedia(m).matches; } catch { return false; } });
  const hits = target ? data.rules.filter((r) => r.kind === 'style' && parts(r.selector).some((p) => matches(target, p)) && media(r)) : [];
  // The rule nearest the element wins a property it shares with an earlier one (same importance); earlier ones show struck.
  const won = new Map();
  for (const r of [...hits].reverse()) for (const d of [...r.decls].reverse()) { const k = d.prop.toLowerCase(); if (!won.has(k) || (d.important && !won.get(k).important)) won.set(k, d); }
  const inline = Object.entries(node.attrs || {}).find(([k]) => k === 'style')?.[1] ?? '';
  const inlineDecls = inline.split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(':'); return i < 0 ? null : { prop: x.slice(0, i).trim(), value: x.slice(i + 1).trim() }; }).filter(Boolean);
  const classes = (node.attrs?.class || '').split(/\s+/).filter(Boolean);
  const textOnly = !node.children.length && node.text !== undefined;
  const label = `${node.tag}${node.attrs?.id ? '#' + node.attrs.id : ''}${classes.map((c) => '.' + c).join('')}`;
  const index = (r) => { // which of the same-selector rules in that file this is (contract ruling 7)
    const same = data.rules.filter((x) => x.file === r.file && x.kind === 'style' && normSel(x.selector) === normSel(r.selector) && normMedia(x.media.at(-1)) === normMedia(r.media.at(-1)));
    return same.indexOf(r);
  };
  const vars = new Map(); // custom properties this element's values use -> their definitions in the cascade
  for (const r of data.rules) for (const d of r.decls) if (d.prop.startsWith('--')) { if (!vars.has(d.prop)) vars.set(d.prop, []); vars.get(d.prop).push({ r, d }); }
  const used = new Set(); for (const d of [...inlineDecls, ...hits.flatMap((r) => r.decls)]) for (const m of String(d.value).matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]);
  const cs = target ? getComputedStyle(target) : null;

  el.innerHTML = `
    <div class="selhead doc-head">
      <div class="crumb"><span class="chip" id="sel-component">${esc(comp.name)}</span><span class="mono" id="sel-node" title="${esc(label)}">${esc(label)}</span></div>
      <p class="hint mono" id="doc-source">${esc(comp.path)}:${node.line}</p>
    </div>
    <div class="doc-body">
      ${textOnly ? `<section class="dsec"><h3>Text</h3><textarea id="doc-text" data-key="text" rows="${Math.min(6, Math.max(1, Math.ceil(node.text.length / 34)))}" aria-label="Text">${esc(node.text)}</textarea></section>` : ''}
      <section class="dsec"><h3>Classes</h3>
        <div class="doc-classes" id="doc-classes">${classes.map((c) => `<span class="cls"><code>.${esc(c)}</code><button type="button" class="cls-x" data-remove="${esc(c)}" aria-label="Remove class ${esc(c)}">×</button></span>`).join('')}
          <input id="doc-class-add" data-key="class-add" placeholder="add class" aria-label="Add a class" spellcheck="false"></div>
      </section>
      <section class="dsec"><h3>Inline style <span class="where">style="…"</span></h3>
        <div class="decls" id="doc-inline">${inlineDecls.map((d) => declRow({ prop: d.prop, value: d.value, kind: 'style' })).join('')}
          <div class="decl add"><input class="prop" data-key="inline-new-prop" placeholder="property" aria-label="New inline property" spellcheck="false"><input class="val" data-key="inline-new-val" placeholder="value" aria-label="New inline value" spellcheck="false"></div></div>
      </section>
      <section class="dsec"><h3>Rules <span class="where">${hits.length} matching</span></h3>
        ${hits.length ? [...hits].reverse().map((r) => `<div class="rule" data-rule="${data.rules.indexOf(r)}">
          <div class="rhead"><code class="sel">${esc(r.selector)}</code>${r.media.length ? `<span class="media">@media ${esc(r.media.join(' and '))}</span>` : ''}<span class="src" title="${esc(r.file)}:${r.line}">${esc(r.file.split('/').pop())}:${r.line}</span></div>
          <div class="decls">${r.decls.map((d) => declRow({ prop: d.prop, value: d.value, important: d.important, kind: 'rule', rule: data.rules.indexOf(r), idx: index(r), line: d.line, over: won.get(d.prop.toLowerCase()) !== d })).join('')}
            <div class="decl add"><input class="prop" data-key="r${data.rules.indexOf(r)}-new-prop" data-rule="${data.rules.indexOf(r)}" placeholder="property" aria-label="New property in ${esc(r.selector)}" spellcheck="false"><input class="val" data-key="r${data.rules.indexOf(r)}-new-val" data-rule="${data.rules.indexOf(r)}" placeholder="value" aria-label="New value in ${esc(r.selector)}" spellcheck="false"></div></div>
        </div>`).join('') : '<p class="hint">No rule of this file’s stylesheets matches this element.</p>'}
      </section>
      ${used.size ? `<section class="dsec"><h3>Variables</h3><div class="decls">${[...used].map((v) => { const defs = vars.get(v) || []; const def = defs.filter(({ r }) => !r.media.length || media(r)).at(-1) || defs.at(-1); const now = cs?.getPropertyValue(v).trim();
        return def ? declRow({ prop: v, value: def.d.value, kind: 'var', file: def.r.file, line: def.d.line, varIndex: defs.filter((x) => x.r.file === def.r.file && normMedia(x.r.media.at(-1)) === normMedia(def.r.media.at(-1))).indexOf(def), media: def.r.media.at(-1) ?? null, computed: now })
          : `<div class="decl ro"><code class="prop">${esc(v)}</code><span class="val">${esc(now || 'not defined')}</span><span class="src">not defined</span></div>`; }).join('')}</div></section>` : ''}
      <p class="field-error" id="doc-error" hidden></p>
    </div>`;
  function declRow({ prop, value, important, kind, rule, idx, line, over, file, varIndex, media: m, computed }) {
    const k = kind === 'rule' ? `r${rule}-${prop}` : kind === 'var' ? `v-${prop}` : `s-${prop}`;
    const src = kind === 'var' ? `<span class="src" title="${esc(file)}:${line}">${esc(file.split('/').pop())}:${line}</span>` : kind === 'rule' ? `<span class="src">:${line}</span>` : '';
    return `<div class="decl${over ? ' over' : ''}" data-kind="${kind}" data-prop="${esc(prop)}"${kind === 'rule' ? ` data-rule="${rule}" data-index="${idx}"` : ''}${kind === 'var' ? ` data-file="${esc(file)}" data-index="${varIndex}" data-media="${esc(m ?? '')}"` : ''}>
      <code class="prop">${esc(prop)}</code><input class="val" data-key="${esc(k)}" value="${esc(value)}" aria-label="${esc(prop)}" spellcheck="false"${computed ? ` title="now ${esc(computed)}"` : ''}>${important ? '<span class="imp">!important</span>' : ''}${kind !== 'var' ? `<button type="button" class="decl-x" aria-label="Remove ${esc(prop)}">×</button>` : ''}${src}</div>`;
  }
  if (focus) el.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.focus();

  // ---------- edits ----------
  const showError = (msg) => { const e = el.querySelector('#doc-error'); if (!e) return; e.hidden = !msg; e.textContent = msg || ''; };
  async function send(edits) {
    showError('');
    const r = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: comp.component, baseRevision: comp.revision, edits }) });
    const j = await r.json().catch(() => ({ ok: false, error: `the edit failed (${r.status})` }));
    if (!j.ok) showError(j.error); else { stamp++; if (j.revision) comp.revision = j.revision; }
    return j;
  }
  const ruleEdit = (r, prop, value) => { const rr = data.rules[r]; return { op: 'rule', file: rr.file, selector: rr.selector, ...(rr.media.length ? { media: rr.media.at(-1) } : {}), index: index(rr), prop, value }; };
  el.querySelector('#doc-text')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.target.blur(); } if (ev.key === 'Escape') { ev.target.value = node.text; ev.target.blur(); } });
  el.querySelector('#doc-text')?.addEventListener('change', (ev) => { if (ev.target.value !== node.text) send([{ op: 'text', node: sel.node, value: ev.target.value }]); });
  el.querySelectorAll('.cls-x').forEach((b) => b.addEventListener('click', () => send([{ op: 'class', node: sel.node, remove: [b.dataset.remove] }])));
  el.querySelector('#doc-class-add')?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return; ev.preventDefault();
    const add = ev.target.value.trim().replace(/^\./, '').split(/\s+/).filter(Boolean);
    if (add.length) send([{ op: 'class', node: sel.node, add }]).then((j) => { if (j.ok) ev.target.value = ''; });
  });
  for (const row of el.querySelectorAll('.decl[data-kind]')) {
    const input = row.querySelector('input.val'), prop = row.dataset.prop, kind = row.dataset.kind;
    const commit = (value) => {
      if (kind === 'style') return send([{ op: 'style', node: sel.node, prop, value }]);
      if (kind === 'rule') return send([ruleEdit(Number(row.dataset.rule), prop, value)]);
      return send([{ op: 'var', file: row.dataset.file, name: prop, value, ...(row.dataset.media ? { media: row.dataset.media } : {}), index: Number(row.dataset.index) }]);
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); } if (ev.key === 'Escape') { input.value = input.defaultValue; input.blur(); } });
    input.addEventListener('change', () => { if (input.value.trim() && input.value !== input.defaultValue) commit(input.value.trim()); });
    row.querySelector('.decl-x')?.addEventListener('click', () => commit(null));
  }
  for (const add of el.querySelectorAll('.decl.add')) {
    const [p, v] = add.querySelectorAll('input');
    const go = () => {
      if (!p.value.trim() || !v.value.trim()) return;
      const prop = p.value.trim(), value = v.value.trim();
      const edit = p.dataset.rule !== undefined ? ruleEdit(Number(p.dataset.rule), prop, value) : { op: 'style', node: sel.node, prop, value };
      send([edit]);
    };
    v.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
    p.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); v.focus(); } });
  }
}
