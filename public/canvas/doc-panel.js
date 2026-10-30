// The design panel for a document-engine component (decision 0014): the selected element of an HTML file, its text and
// classes, every value with where it comes from (inline, which rule and line, which variable and where that is defined),
// and the rules and variables behind them, each editable at its source.
//
// The cascade is worked out the way the browser does it (inspector-cascade.js, decision 0015): the same code the server
// uses for GET /api/component/<id>/rules?node=, here matching with the frame's own element.matches() and matchMedia().
// A typed value is staged first: one key picks its scope (E this element, C this class, V this variable), the one-line
// change is shown, and Apply writes it with one contract edit (POST /api/edit). The file is the source of truth; the
// frame and this panel redraw from it when the engine says it changed.
import { plain } from './words.js';
import { createCascade } from './inspector-cascade.js';
import { classify, offScale, bindExact, bindPieces, kindOfProp, parseColor, tokens, firstVar } from './inspector-model.js';
import { scopeOptions, defaultScope, normalizeTyped } from './inspector-scope.js';
import { stripsHtml, wireStrips, askProp } from './inspector-vars.js';
import { initMeasure } from './measure-overlay.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const normSel = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim();
const normMedia = (t) => String(t ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*:\s*/g, ': ').trim().toLowerCase();
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const rulesCache = new Map(); // component -> { stamp, data }
const usage = new Map();      // 'r:file:line' / 'v:--name' -> { count, where }; cleared when a file changes
let stamp = 0;
export const docsChanged = () => { stamp++; usage.clear(); };

let staged = null;   // the value being edited: { key, prop, text, typed, raw, scope }
let live = null;     // the panel as last drawn: { selKey, ready, stage, ... }
let lastProp = null; // the value field you were last in (a variable clicked in the strips goes there)
const previews = []; // rules changed for a preview: { rule, css } (cssText to put back)
let measure = null;
let currentCtx = null;

// ---------- the one keyboard listener of the panel (actions.js lists it) ----------
// Enter applies the staged value (Shift+Enter is a new line in the text), Escape puts it back and leaves the field.
// E, C and V choose the scope and B toggles using the variable that matches a typed value; while a text field has the
// cursor they need Alt (Option) so typing is never swallowed.
const wired = new WeakSet();
const isText = (t) => t && 'value' in t && !['button', 'checkbox', 'radio', 'submit'].includes(t.type) && t.localName !== 'button';
function wireKeys(el) {
  if (wired.has(el)) return; wired.add(el);
  el.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (!t.closest?.('#panel')) return;
    const key = ev.key.toLowerCase();
    if (staged && (ev.altKey ? ['KeyE', 'KeyC', 'KeyV', 'KeyB'].includes(ev.code) : !isText(t) && !ev.metaKey && !ev.ctrlKey && ['e', 'c', 'v', 'b'].includes(key))) {
      ev.preventDefault();
      const k = ev.altKey ? ev.code.slice(3).toLowerCase() : key;
      if (k === 'b') currentCtx?.inspector?.toggleBound(); else currentCtx?.inspector?.scope({ e: 'element', c: 'class', v: 'variable' }[k]);
      return;
    }
    // Tab from the value being edited goes straight to where it will be written, then Apply; Shift+Tab comes back
    if (staged && ev.key === 'Tab' && !ev.shiftKey && t.matches?.('.vrow input.val') && t.dataset.prop === staged.prop) { const to = t.closest('#panel').querySelector('#doc-staged .opt[tabindex="0"]'); if (to) { ev.preventDefault(); to.focus(); return; } }
    if (staged && ev.key === 'Tab' && ev.shiftKey && t.classList?.contains('opt')) { const back = t.closest('#panel').querySelector(`.vrow input.val[data-prop="${CSS.escape(staged.prop)}"]`); if (back) { ev.preventDefault(); back.focus(); return; } }
    if (staged && t.classList?.contains('opt') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); currentCtx?.inspector?.step(ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1); return; }
    if (ev.key === 'Escape' && staged) { ev.preventDefault(); ev.stopPropagation(); if (isText(t)) t.value = t.defaultValue; currentCtx?.inspector?.cancel(); return; }
    if (ev.key === 'Enter' && staged && !isText(t) && (t.localName !== 'button' || t.classList.contains('opt'))) { ev.preventDefault(); currentCtx?.inspector?.apply(); return; }
    if (!isText(t) || !t.closest('.doc-body')) return;
    if (ev.key === 'Escape') { t.value = t.defaultValue; t.blur(); return; }
    if (ev.key !== 'Enter' || (ev.shiftKey && t.id === 'doc-text')) return;
    ev.preventDefault();
    if (t.id === 'doc-class-add' || t.closest('.decl.add')) t.dispatchEvent(new CustomEvent('doc-commit', { bubbles: true }));
    else if (t.closest('.vrow') && staged) currentCtx?.inspector?.apply();
    else t.blur(); // its change event applies it
  });
}

async function rulesFor(id) {
  const c = rulesCache.get(id);
  if (c && c.stamp === stamp) return c.data;
  const data = await (await fetch(`/api/component/${encodeURIComponent(id)}/rules`)).json();
  rulesCache.set(id, { stamp, data });
  return data;
}
// A selector the element matches (pseudo-elements are matched by their element; an invalid selector matches nothing).
const PSEUDO_EL = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b(\([^)]*\))?/gi;
function matches(el, selector) {
  try { return el.matches(selector.replace(PSEUDO_EL, '').trim() || '*'); } catch { return false; }
}

// How many elements of the canvas a rule reaches, and how many places use a variable (across every HTML component).
async function measureUse(ctx, kind, subject) {
  const key = kind === 'rule' ? `r:${subject.file}:${subject.line}` : `v:${subject}`;
  if (usage.has(key)) return usage.get(key);
  const comps = [...ctx.state.components.values()].filter((c) => c.kind === 'html');
  let count = 0; const per = [], decls = new Set(); // for a variable: each declaration counts once, however many components share its stylesheet
  for (const c of comps) {
    let d; try { d = await rulesFor(c.component); } catch { continue; }
    if (kind === 'rule') {
      const r = d.rules.find((x) => x.file === subject.file && x.line === subject.line);
      const doc = ctx.stage.sections.get(c.component)?.docFrame?.doc();
      if (!r || !doc) continue;
      let n = 0; try { n = doc.querySelectorAll(r.selector.replace(PSEUDO_EL, '').trim() || '*').length; } catch { /* invalid */ }
      if (n) { count += n; per.push({ name: c.name, n }); }
    } else {
      let here = 0;
      for (const r of d.rules) for (const x of r.decls) if (x.uses.includes(subject)) { here++; decls.add(`${r.file}:${x.start}`); }
      if (here) per.push({ name: c.name, n: here });
    }
  }
  if (kind === 'var') count = decls.size;
  const where = kind === 'rule'
    ? (per.length === 1 ? (per[0].n > 1 ? `all ${WORDS[per[0].n] ?? per[0].n} in ${per[0].name}` : `in ${per[0].name}`) : per.length ? `${per.length} components` : '')
    : (count ? `${count} rule${count === 1 ? '' : 's'}, ${per.length} of ${comps.length} components` : '');
  const out = { count, where };
  usage.set(key, out);
  return out;
}

export function initInspector(ctx) {
  if (ctx.inspector) return ctx.inspector;
  currentCtx = ctx;
  measure = initMeasure(ctx);
  ctx.inspector = {
    scope: (id) => live?.setScope?.(id),            // 'element', 'class' or 'variable'
    toggleBound: () => live?.toggleBound?.(),
    apply: () => live?.apply?.(),
    cancel: () => live?.cancel?.(),
    step: (d) => live?.step?.(d),
    stageValue: (prop, text) => live?.stage?.(prop, text),
    bindVariable: (at, name, group, value, prop) => bindTo(ctx, at, name, group, value, prop),
    toggle: (name, on) => { const v = measure.toggle(name, on); live?.syncChecks?.(); return v; },
    read: () => ({ ...measure.read(), staged: staged && { prop: staged.prop, scope: staged.scope, text: staged.text } }),
    state: () => staged && { prop: staged.prop, scope: staged.scope, raw: staged.raw },
  };
  return ctx.inspector;
}
// Bind a variable on an element that may not be the selected one yet: select it, wait for its panel, then ask which property.
async function bindTo(ctx, at, name, group, value, prop = null) {
  const k = `${at.component}|${at.node}`;
  const sel = ctx.state.selection;
  if (!sel || sel.component !== at.component || sel.node !== at.node) ctx.select({ component: at.component, node: at.node, variant: {} });
  for (let i = 0; i < 100 && !(live?.selKey === k && live.stage); i++) await new Promise((r) => setTimeout(r, 30));
  return live?.selKey === k ? live.bindHere(name, group, value, prop) : false;
}

export async function renderDocPanel(ctx, el, sel, comp) {
  initInspector(ctx);
  const frame = ctx.stage.sections.get(comp.component)?.docFrame;
  const node = frame?.node(sel.node);
  const target = frame?.element(sel.node)?.el;
  const key = `${comp.component}|${sel.node}|${comp.revision}|${stamp}`;
  if (!node) { el.innerHTML = `<div class="selhead"><div class="crumb"><span class="chip" id="sel-component">${esc(comp.name)}</span></div><p class="hint">${esc(comp.path)} · loading…</p></div>`; return; }
  const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  if (el.dataset.full === key && focus) return; // a redraw would take the field from under the cursor
  el.dataset.full = key;
  const selKey = `${comp.component}|${sel.node}`;
  if (staged && staged.key !== selKey) { staged = null; clearPreview(ctx); lastProp = null; }
  const me = live = { selKey };
  me.ready = Promise.resolve();
  const data = await rulesFor(comp.component).catch(() => ({ rules: [], sheets: [] }));
  if (ctx.state.selection !== sel || live !== me) return; // the selection moved on while the rules loaded
  const win = target?.ownerDocument.defaultView;
  const ids = new WeakMap(); let nid = 0;
  // the element and its ancestors that have a node in the file are known by that node's id (the "inherited from" links)
  const chainIds = (function find(list, trail) { for (const n of list || []) { const t = [...trail, n.node]; if (n.node === sel.node) return t; const f = find(n.children, t); if (f) return f; } return null; })(frame.tree()?.tree, []) || [];
  for (const id of chainIds) { const e = frame.element(id)?.el; if (e) ids.set(e, id); }
  const cas = target ? createCascade(data.rules, {
    matches, parent: (e) => e.parentElement, inline: (e) => e.getAttribute('style') || '', id: (e) => ids.get(e) ?? (ids.set(e, ++nid), nid),
    media: (p) => { try { return win.matchMedia(p).matches; } catch { return false; } },
  }, { sheets: data.sheets }) : null;
  const explain = cas ? cas.explain(target) : { rules: [], inline: [], props: {}, vars: {}, inherited: [] };
  const classes = (node.attrs?.class || '').split(/\s+/).filter(Boolean);
  const textOnly = !node.children.length && node.text !== undefined;
  const label = `${node.tag}${node.attrs?.id ? '#' + node.attrs.id : ''}${classes.map((c) => '.' + c).join('')}`;
  const index = (r) => { // which of the same-selector rules in that file this is (contract ruling 7)
    const same = data.rules.filter((x) => x.file === r.file && x.kind === 'style' && normSel(x.selector) === normSel(r.selector) && normMedia(x.media.at(-1)) === normMedia(r.media.at(-1)));
    return same.indexOf(r);
  };
  const cs = target ? win.getComputedStyle(target) : null;
  // the folder's variables with their values here (the strips and the off-scale check read these)
  const rootCs = target ? win.getComputedStyle(target.ownerDocument.documentElement) : null;
  const folderVars = {};
  for (const [name, defs] of Object.entries(data.vars || {})) {
    const v = rootCs?.getPropertyValue(name).trim() || defs.find((d) => !d.inline && !/var\(/.test(d.value))?.value || '';
    if (v) folderVars[name] = v;
  }
  const groups = classify(folderVars);
  const inlineDecls = explain.inline;

  // the winning declaration of every property, grouped the way a designer reads them
  const ORDER = ['color', 'type', 'size', 'space', 'radius'];
  const rank = (p) => { const i = ORDER.indexOf(kindOfProp(p)); return i < 0 ? 9 : i; };
  const props = Object.entries(explain.props).filter(([p]) => !p.startsWith('--')).sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  const beats = new Map(); // "prop|winner" -> the declarations that winner overrides
  const srcKey = (s) => (s.kind === 'inline' ? 'inline' : `r${s.order}`);
  const lose = (d, from) => { const k = `${d.prop.toLowerCase()}|${srcKey(d.by)}`; if (!beats.has(k)) beats.set(k, []); beats.get(k).push({ value: d.value, ...from }); };
  for (const r of explain.rules) for (const d of r.decls) if (d.state === 'overridden') lose(d, { selector: r.selector, line: d.line ?? r.line, file: r.file });
  for (const d of explain.inline) if (d.state === 'overridden') lose(d, { selector: 'inline style', line: node.line, file: comp.path });
  const base = (f) => String(f).split('/').pop();
  const swatch = (v) => (parseColor(v) ? `<span class="sw" style="background:${esc(v)}"></span>` : '');

  // one line of provenance: it never wraps (the whole text is on hover)
  const line = (cls, ...parts) => { const html = parts.join(' '); const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'); return `<div class="pfrom ${cls}" title="${esc(text)}">${html}</div>`; };
  const k = (t) => `<span class="k">${esc(t)}</span>`;
  const where = (s2) => (s2.kind === 'inline' ? `<code>inline style</code> ${k(`${comp.path}:${node.line}`)}` : `<code>${esc(s2.selector)}</code> ${k(`${base(s2.file)}:${s2.declLine ?? s2.line}${s2.media?.length ? ` · @media ${s2.media.at(-1)}` : ''}`)}`);
  const sayBy = (b) => (b.kind === 'inline' ? 'the inline style' : `${b.selector} ${base(b.file)}:${b.declLine ?? b.line}`);

  function valueRow([prop, w]) {
    const s2 = w.source;
    const lost = (beats.get(`${prop.toLowerCase()}|${srcKey(s2)}`) || []).slice(0, 2).map((b) => line('', k('beats'), `<s>${esc(b.value)}</s>`, k(`from ${b.selector} :${b.line}`))).join('');
    const part = w.state === 'partial' ? (w.lost || []).map((l) => line('lost', `<code>${esc(l.props.join(', '))}</code>`, k(`from ${sayBy(l.by)}`))).join('') : '';
    const v = firstVar(w.value), info = v && explain.vars[v];
    const varLine = v ? line('', `<code>${esc(v)}</code>`, info?.source ? k('defined in') + ' ' + where(info.source) + (info.inherited ? ' ' + k('· inherited') : '') : k('is not defined')) : '';
    const off = offScale(prop, w.value, groups)[0];
    const flag = off ? `<div class="pflag"><span class="k">${off.exact ? 'is exactly' : 'close to'}</span><button type="button" class="pbind" data-prop="${esc(prop)}" data-token="${esc(off.token)}" data-var="${esc(off.name)}" title="Write var(${esc(off.name)}) in place of ${esc(off.token)}">${esc(off.name)} <span class="k">${esc(off.value)}</span></button></div>` : '';
    const shown = w.resolved ?? w.value;
    return `<div class="vrow${off ? ' off' : ''}${w.state === 'partial' ? ' partial' : ''}" data-prop="${esc(prop)}"><div class="phead"><label for="pv-${esc(prop)}">${esc(prop)}</label>${w.state === 'partial' ? '<span class="pstate">partly overridden</span>' : ''}${w.important ? '<span class="imp">!important</span>' : ''}${w.resolved && w.resolved !== w.value ? `<span class="res" title="${esc(w.resolved)}">${esc(w.resolved)}</span>` : ''}</div>
      <div class="pval">${swatch(shown)}<input class="val" id="pv-${esc(prop)}" data-key="pv-${esc(prop)}" data-prop="${esc(prop)}" value="${esc(w.value)}" aria-label="${esc(prop)}" spellcheck="false" title="${esc(w.value)}"></div>
      ${line('', where(s2))}${part}${lost}${varLine}${flag}</div>`;
  }
  // what this element takes from an ancestor because nothing sets it here, with a link that selects that ancestor
  function inheritedRow(e) {
    const link = typeof e.from === 'string' && frame.has(e.from) ? `<button type="button" class="plink" data-node="${esc(e.from)}" title="Select the element it comes from">${esc(e.source.kind === 'inline' ? 'inline style' : e.source.selector)} ${esc(e.source.kind === 'inline' ? '' : `${base(e.source.file)}:${e.source.declLine ?? e.source.line}`)}</button>` : `<code>${esc(e.source.kind === 'inline' ? 'inline style' : e.source.selector)}</code>`;
    const shown = e.resolved ?? e.value;
    return `<div class="vrow inh" data-inherited="${esc(e.prop)}"><div class="phead"><span class="lbl">${esc(e.sets.length > 1 && e.sets.length < 6 ? e.sets.join(', ') : e.prop)}</span></div>
      <div class="pval">${swatch(shown)}<span class="ro" title="${esc(shown)}">${esc(e.value)}</span></div>
      <div class="pfrom" title="inherited from ${esc(e.source.selector ?? 'inline style')}">${k('inherited from')} ${link}</div></div>`;
  }

  // the variables this element's values are made of, each at the definition that applies here
  const varNames = Object.keys(explain.vars);
  function varRow(name) {
    const v = explain.vars[name];
    if (!v) return `<div class="decl ro"><code class="prop">${esc(name)}</code><span class="val">${esc(cs?.getPropertyValue(name).trim() || 'not defined')}</span><span class="src">not defined</span></div>`;
    const s = v.source;
    if (s.kind !== 'rule') return `<div class="decl ro"><code class="prop">${esc(name)}</code><span class="val">${esc(v.value)}</span><span class="src">set inline</span></div>`;
    const defs = (data.vars?.[name] || []).filter((x) => !x.inline);
    const bucket = defs.filter((x) => x.file === s.file && normMedia(x.media.at(-1)) === normMedia(s.media.at(-1)));
    const k = Math.max(0, bucket.findIndex((x) => x.line === s.declLine && normSel(x.selector) === normSel(s.selector)));
    return `<div class="decl" data-kind="var" data-prop="${esc(name)}" data-file="${esc(s.file)}" data-index="${k}" data-media="${esc(s.media.at(-1) ?? '')}">
      <code class="prop">${esc(name)}</code><input class="val" data-key="v-${esc(name)}" value="${esc(v.raw)}" aria-label="${esc(name)}" spellcheck="false" title="now ${esc(v.value)}"><span class="src" title="${esc(s.file)}:${s.declLine} · ${esc(s.selector)}">${esc(base(s.file))}:${s.declLine}${v.inherited ? ' ↑' : ''}</span></div>`;
  }

  function declRow({ prop, value, important, kind, rule, idx, line, over, partial, by, resolved }) {
    const k = kind === 'rule' ? `r${rule}-${prop}` : `s-${prop}`;
    const src = kind === 'rule' ? `<span class="src">:${line}</span>` : '';
    const why = (over || partial) && by ? `${partial ? 'partly overridden by' : 'beaten by'} ${by.kind === 'inline' ? 'the inline style' : `${by.selector} (${base(by.file)}:${by.declLine ?? by.line})`}` : '';
    return `<div class="decl${over ? ' over' : ''}${partial ? ' partial' : ''}" data-kind="${kind}" data-prop="${esc(prop)}"${kind === 'rule' ? ` data-rule="${rule}" data-index="${idx}"` : ''}>
      <code class="prop"${why ? ` title="${esc(why)}"` : ''}>${esc(prop)}</code><input class="val" data-key="${esc(k)}" value="${esc(value)}" aria-label="${esc(prop)}" spellcheck="false"${resolved ? ` title="now ${esc(resolved)}"` : why ? ` title="${esc(why)}"` : ''}>${important ? '<span class="imp">!important</span>' : ''}<button type="button" class="decl-x" aria-label="Remove ${esc(prop)}">×</button>${src}</div>`;
  }
  const rulesStrong = [...explain.rules].reverse();

  el.innerHTML = `
    <div class="selhead doc-head" data-node="${esc(sel.node)}">
      <div class="crumb"><span class="chip" id="sel-component">${esc(comp.name)}</span><span class="mono" id="sel-node" title="${esc(label)}">${esc(label)}</span></div>
      <p class="hint mono" id="doc-source">${esc(comp.path)}:${node.line}</p>
    </div>
    <div class="doc-body">
      ${textOnly ? `<section class="dsec"><h3>Text</h3><textarea id="doc-text" data-key="text" rows="${Math.min(6, Math.max(1, Math.ceil(node.text.length / 34)))}" aria-label="Text">${esc(node.text)}</textarea></section>` : ''}
      ${node.runs?.length ? `<section class="dsec"><h3>Text <span class="where">${node.runs.length} run${node.runs.length === 1 ? '' : 's'} between its elements</span></h3>${node.runs.map((r) => `<textarea class="doc-run" data-run="${r.index}" data-key="run-${r.index}" rows="${Math.min(4, Math.max(1, Math.ceil(r.text.length / 34)))}" aria-label="Text run ${r.index + 1}"${r.editable ? '' : ' disabled title="Computed in code"'}>${esc(r.text)}</textarea>`).join('')}</section>` : ''}
      <section class="dsec"><h3>Classes</h3>
        <div class="doc-classes" id="doc-classes">${classes.map((c) => `<span class="cls"><code>.${esc(c)}</code><button type="button" class="cls-x" data-remove="${esc(c)}" aria-label="Remove class ${esc(c)}">×</button></span>`).join('')}
          <input id="doc-class-add" data-key="class-add" placeholder="add class" aria-label="Add a class" spellcheck="false"></div>
      </section>
      <section class="dsec" id="doc-values"><h3>Where each value comes from <span class="where">type to change one, then choose where it goes</span></h3>
        ${props.length ? props.map(valueRow).join('') : explain.inherited.length ? '<p class="hint">Nothing sets a value on this element itself.</p>' : '<p class="hint">Nothing styles this element yet.</p>'}
      </section>
      ${explain.inherited.length ? `<section class="dsec" id="doc-inherited"><h3>Inherited <span class="where">from the elements around it</span></h3>${explain.inherited.map(inheritedRow).join('')}</section>` : ''}
      <section class="dsec"><h3>Inline style <span class="where">style="…"</span></h3>
        <div class="decls" id="doc-inline">${inlineDecls.map((d) => declRow({ prop: d.prop, value: d.value, important: d.important, kind: 'style', over: d.state === 'overridden', partial: d.state === 'partial', by: d.by, resolved: d.resolved })).join('')}
          <div class="decl add"><input class="prop" data-key="inline-new-prop" placeholder="property" aria-label="New inline property" spellcheck="false"><input class="val" data-key="inline-new-val" placeholder="value" aria-label="New inline value" spellcheck="false"></div></div>
      </section>
      <section class="dsec"><h3>Rules <span class="where">${rulesStrong.length} matching, strongest first</span></h3>
        ${rulesStrong.length ? rulesStrong.map((r) => `<div class="rule" data-rule="${r.order}" data-selector="${esc(r.selector)}" data-file="${esc(r.file)}">
          <div class="rhead"><code class="sel">${esc(r.selector)}</code>${r.media.length ? `<span class="media">@media ${esc(r.media.join(' and '))}</span>` : ''}<span class="src" title="${esc(r.file)}:${r.line} · specificity ${r.specificity.join(',')}">${esc(base(r.file))}:${r.line}</span></div>
          <div class="decls">${r.decls.map((d) => declRow({ prop: d.prop, value: d.value, important: d.important, kind: 'rule', rule: r.order, idx: index(data.rules[r.order]), line: d.line, over: d.state === 'overridden', partial: d.state === 'partial', by: d.by, resolved: d.resolved })).join('')}
            <div class="decl add"><input class="prop" data-key="r${r.order}-new-prop" data-rule="${r.order}" placeholder="property" aria-label="New property in ${esc(r.selector)}" spellcheck="false"><input class="val" data-key="r${r.order}-new-val" data-rule="${r.order}" placeholder="value" aria-label="New value in ${esc(r.selector)}" spellcheck="false"></div></div>
        </div>`).join('') : '<p class="hint">No rule of this file’s stylesheets matches this element.</p>'}
      </section>
      ${varNames.length ? `<section class="dsec"><h3>Variables <span class="where">the definition that applies here</span></h3><div class="decls">${varNames.map(varRow).join('')}</div></section>` : ''}
      <section class="dsec" id="doc-vars"><h3>Your variables <span class="where">${Object.keys(folderVars).length} in this folder</span></h3>
        <input id="doc-vars-filter" data-key="vars-filter" class="vfilter" type="search" placeholder="find a variable" aria-label="Find a variable" spellcheck="false">
        <div id="doc-vars-body">${stripsHtml(groups, new Set(varNames))}</div>
        <p class="hint">Click one to use it on the value you are in, or drag it onto an element.</p>
      </section>
      <section class="dsec" id="doc-checks"><h3>Check <span class="where">hold Alt over an element to measure it</span></h3>
        <div class="mrow"><button type="button" class="mchip" id="chk-contrast" aria-pressed="false">Contrast</button><button type="button" class="mchip" id="chk-order" aria-pressed="false">Focus order</button><span class="hint" id="chk-sum"></span></div>
      </section>
      <p class="field-error" id="doc-error" hidden></p>
    </div>
    <div id="doc-dock" hidden>
      <div id="doc-staged" aria-live="polite"></div>
      <div class="doc-foot" id="doc-foot"><button type="button" class="primary" id="doc-apply">Apply <kbd>↵</kbd></button><button type="button" id="doc-cancel">Cancel <kbd>Esc</kbd></button>
        <span class="legend"><kbd>E</kbd>this element <kbd>C</kbd>this class <kbd>V</kbd>this variable</span></div>
    </div>`;
  if (focus) el.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.focus();
  wireKeys(el);

  // ---------- edits ----------
  const showError = (msg) => { const e = el.querySelector('#doc-error'); if (!e) return; e.hidden = !msg; e.textContent = msg || ''; };
  async function send(edits) {
    showError('');
    const r = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: comp.component, baseRevision: comp.revision, edits }) });
    const j = await r.json().catch(() => ({ ok: false, error: `the edit failed (${r.status})` }));
    if (!j.ok) showError(plain(j.error)); else { stamp++; usage.clear(); if (j.revision) comp.revision = j.revision; }
    return j;
  }
  const ruleEdit = (r, prop, value) => { const rr = data.rules[r]; return { op: 'rule', file: rr.file, selector: rr.selector, media: rr.media.at(-1) ?? '', index: index(rr), prop, value }; }; // media '' means the rule outside any @media, so the index counts the same rules as index()
  el.querySelector('#doc-text')?.addEventListener('change', (ev) => { if (ev.target.value !== node.text) send([{ op: 'text', node: sel.node, value: ev.target.value }]); });
  el.querySelectorAll('.doc-run').forEach((t) => t.addEventListener('change', () => { if (t.value !== t.defaultValue) send([{ op: 'text', node: sel.node, run: Number(t.dataset.run), value: t.value }]); }));
  el.querySelectorAll('.cls-x').forEach((b) => b.addEventListener('click', () => send([{ op: 'class', node: sel.node, remove: [b.dataset.remove] }])));
  el.querySelector('#doc-class-add')?.addEventListener('doc-commit', (ev) => {
    const add = ev.target.value.trim().replace(/^\./, '').split(/\s+/).filter(Boolean);
    if (add.length) send([{ op: 'class', node: sel.node, add }]).then((j) => { if (j.ok) ev.target.value = ''; });
  });
  for (const row of el.querySelectorAll('.decl[data-kind]')) {
    const input = row.querySelector('input.val'), prop = row.dataset.prop, kind = row.dataset.kind;
    const commit = (value) => {
      if (kind === 'style') return send([{ op: 'style', node: sel.node, prop, value }]);
      if (kind === 'rule') return send([ruleEdit(Number(row.dataset.rule), prop, value)]);
      return send([{ op: 'var', file: row.dataset.file, name: prop, value, media: row.dataset.media, index: Number(row.dataset.index) }]);
    };
    input?.addEventListener('change', () => { if (input.value.trim() && input.value !== input.defaultValue) commit(input.value.trim()); });
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
    v.addEventListener('doc-commit', go);
    p.addEventListener('doc-commit', () => v.focus());
  }
  // one rule lights up everywhere: hovering a rule or a variable asks the stage to show where it applies (when it can)
  const light = (arg) => { try { arg ? ctx.stage?.highlight?.(arg) : ctx.stage?.clearHighlight?.(); } catch { /* the stage may not know */ } };
  for (const r of el.querySelectorAll('.rule')) {
    r.addEventListener('pointerenter', () => { if (!staged) light({ selector: r.dataset.selector, file: r.dataset.file }); });
    r.addEventListener('pointerleave', () => { if (!staged) light(null); });
  }

  // ---------- the staged value: scope, the change, Apply ----------
  const winners = explain.props;
  const uses = {
    rule: (r) => usage.get(`r:${r.file}:${r.line}`) ?? null,
    variable: (n) => usage.get(`v:${n}`) ?? null,
  };
  const optionsFor = () => scopeOptions({
    prop: staged.prop, typed: staged.typed, bound: staged.raw ? null : bindExact(staged.prop, staged.typed, groups), comp, node: { ...node, node: sel.node }, classes,
    matched: cas ? cas.matched(target) : [], winner: winners[staged.prop], vars: explain.vars, data, uses,
    wouldLose: (m, prop, imp) => cas.wouldLose(target, m, prop, imp),
  });
  const chosenOf = (opts) => opts.find((o) => o.id === staged.scope && !o.disabled) || opts.find((o) => !o.disabled);
  // The staged change shows on the canvas before it is written, by changing the rule itself in every frame that has it
  // (the CSS object model), so it sits at the rule's real place in the cascade: what the preview shows is what the file
  // will make, longhands that still win included. A change at this element is an inline style.
  function preview(opt) {
    clearPreview(ctx);
    if (!opt || !target) return;
    const e = opt.edit;
    if (opt.id === 'element') { target.setAttribute('data-napkin-prev', target.getAttribute('style') ?? ''); target.style.setProperty(e.prop, e.value); return; }
    if (!opt.preview?.selector) return;
    for (const [id, sec] of ctx.stage.sections) {
      const d = sec.docFrame?.doc(); if (!d) continue;
      for (const r of findRules(d, ctx.state.components.get(id)?.path, e.file, e.op === 'var' ? null : opt.preview.selector, e.media, e.index, e.op === 'var' ? e.name : null)) {
        previews.push({ rule: r, css: r.style.cssText });
        r.style.setProperty(e.prop ?? e.name, e.value, r.style.getPropertyPriority(e.prop ?? e.name));
      }
    }
  }
  // a long declaration keeps its changed end: the shared start becomes "…" (the whole line is on hover)
  const diffText = (l, lines) => {
    const other = lines.find((x) => x !== l); if (!other || l.text.length < 34) return l.text;
    let i = 0; while (i < l.text.length && l.text[i] === other.text[i]) i++;
    i = l.text.lastIndexOf(' ', i);
    return i > 10 ? `${l.text.slice(0, l.text.indexOf(':') + 1)} …${l.text.slice(i)}` : l.text;
  };
  function renderStaged() {
    const host = el.querySelector('#doc-staged'), dock = el.querySelector('#doc-dock');
    if (!host) return;
    el.querySelectorAll('.vrow').forEach((r) => r.classList.toggle('editing', !!staged && r.dataset.prop === staged.prop));
    if (!staged) { host.innerHTML = ''; dock.hidden = true; preview(null); light(null); return; }
    const had = host.contains(document.activeElement) ? (document.activeElement.dataset.scope || document.activeElement.id) : null; // a redraw keeps the focus where it was
    const opts = optionsFor(), chosen = chosenOf(opts);
    if (chosen) staged.scope = chosen.id;
    const exact = bindExact(staged.prop, staged.typed, groups), pieces = bindPieces(staged.prop, staged.typed, groups);
    const rawList = pieces.map((p) => p.raw).join(', '), varList = pieces.map((p) => `var(${p.name})`).join(', ');
    for (const o of opts.filter((x) => !x.disabled && x.id !== 'element')) { // counts arrive a moment later; the options redraw when they do
      const subject = o.id === 'class' ? { file: o.edit.file, line: Number(/:(\d+)/.exec(o.sub)?.[1]) } : o.edit.name;
      const k = o.id === 'class' ? `r:${subject.file}:${subject.line}` : `v:${subject}`;
      if (!usage.has(k)) measureUse(ctx, o.id === 'class' ? 'rule' : 'var', subject).then(() => { if (staged && live === me) renderStaged(); });
    }
    const one = (o) => `<button type="button" role="radio" class="opt${o.id === staged.scope ? ' on' : ''}" aria-checked="${o.id === staged.scope}" tabindex="${o.id === staged.scope ? 0 : -1}" data-scope="${o.id}"${o.disabled ? ' aria-disabled="true"' : ''} title="${esc(o.disabled ? o.why : o.sub)}${o.warn ? ` · ${esc(o.warn)}` : ''}">
      <kbd>${o.key}</kbd><b>${o.title}${o.code ? ` <code>${esc(o.code)}</code>` : ''}</b><span class="count">${esc(o.disabled ? 'not here' : o.countText ?? '')}</span></button>`;
    const n = chosen?.diff.lines.some((l) => l.kind === 'del') ? 1 : chosen?.diff.lines.length ?? 0;
    const note = chosen ? (chosen.warn ? `<em>${esc(chosen.warn)}</em> · ${esc(chosen.sub)}` : esc(chosen.sub)) : esc(opts.find((o) => o.id === staged.scope)?.why ?? '');
    host.innerHTML = `<section class="dsec staged">
      <h3><code>${esc(staged.prop)}</code> <span class="where">${chosen && chosen.id !== 'element' ? 'previewing on the canvas' : 'this element only'}</span></h3>
      ${exact && !staged.raw && chosen?.id !== 'variable' ? `<p class="pnote"><code>${esc(rawList)}</code> is on your scale: writing <code>${esc(varList)}</code>. <button type="button" class="linkish" id="doc-raw">Keep ${esc(rawList)} <kbd>B</kbd></button></p>` : ''}
      ${exact && staged.raw ? `<p class="pnote">Writing the plain value. <button type="button" class="linkish" id="doc-raw">Use <code>${esc(varList)}</code> <kbd>B</kbd></button></p>` : ''}
      <div class="scope" role="radiogroup" aria-label="Where this change goes">${opts.map(one).join('')}</div>
      <p class="scopenote" title="${esc(chosen?.sub ?? '')}">${note}</p>
      <div class="diff" id="doc-diff" aria-label="The change, ${n} line"><div class="h" title="${esc(chosen?.diff.head ?? '')}">${esc(chosen?.diff.head ?? '')}</div>${(chosen?.diff.lines ?? []).map((l) => `<div class="${l.kind === 'del' ? 'd' : 'a'}" title="${esc(l.text)}"><i>${l.line}</i><u>${l.kind === 'del' ? '−' : '+'}</u><span>${esc(diffText(l, chosen.diff.lines))}</span></div>`).join('')}</div>
    </section>`;
    const first = dock.hidden;
    dock.hidden = false;
    // the dock covers the bottom of the panel instead of pushing the values down; the value being edited is kept above it
    if (first) { el.style.setProperty('--dock', `${dock.offsetHeight + 8}px`); el.querySelector('.vrow.editing')?.scrollIntoView({ block: 'nearest' }); }
    host.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => setScope(b.dataset.scope)));
    host.querySelector('#doc-raw')?.addEventListener('click', toggleBound);
    if (had) (host.querySelector(`[data-scope="${had}"]`) || host.querySelector(`#${had}`))?.focus({ preventScroll: true });
    preview(chosen);
    if (chosen?.id === 'class') light({ selector: chosen.edit.selector, file: chosen.edit.file }); else if (chosen?.id === 'variable') light({ variable: chosen.edit.name }); else light(null);
  }
  function stage(prop, text) {
    const w = winners[prop];
    if (!w) return false;
    if (!text.trim() || text.trim() === w.value) { staged = null; renderStaged(); return false; }
    const prev = staged?.prop === prop ? staged : null;
    const field = el.querySelector(`.vrow input[data-prop="${CSS.escape(prop)}"]`); // a variable bound from the strips shows in the field
    if (field && field.value !== text) field.value = text;
    staged = { key: selKey, prop, text, typed: normalizeTyped(prop, text.trim()), raw: prev?.raw ?? false, scope: prev?.scope ?? null };
    const opts = optionsFor();
    if (!staged.scope || !opts.find((o) => o.id === staged.scope && !o.disabled)) staged.scope = defaultScope(opts, w);
    renderStaged();
    return true;
  }
  function setScope(id) {
    if (!staged) return false;
    const o = optionsFor().find((x) => x.id === id);
    if (!o || o.disabled) { showError(o ? o.why : ''); return false; }
    showError(''); staged.scope = id; renderStaged();
    el.querySelector(`[data-scope="${id}"]`)?.focus({ preventScroll: true });
    return true;
  }
  function step(d) { // arrow keys on the scope options: the next one that can be used
    if (!staged) return false;
    const order = ['element', 'class', 'variable'], opts = optionsFor();
    for (let i = order.indexOf(staged.scope) + d; i >= 0 && i < 3; i += d) if (!opts.find((o) => o.id === order[i])?.disabled) return setScope(order[i]);
    return false;
  }
  function toggleBound() { if (staged) { staged.raw = !staged.raw; renderStaged(); } }
  function cancel() {
    if (!staged) return;
    const input = el.querySelector(`.vrow input[data-prop="${CSS.escape(staged.prop)}"]`); if (input) input.value = input.defaultValue;
    staged = null; renderStaged(); showError('');
  }
  async function apply() {
    if (!staged) return null;
    const chosen = chosenOf(optionsFor());
    if (!chosen) return null;
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
    preview(null);
    const j = await send([chosen.edit]);
    if (j.ok) { staged = null; renderStaged(); light(null); } else renderStaged();
    return j;
  }
  el.querySelectorAll('.vrow input.val').forEach((inp) => {
    inp.addEventListener('input', () => stage(inp.dataset.prop, inp.value));
    inp.addEventListener('focus', () => { lastProp = inp.dataset.prop; });
  });
  el.addEventListener('pointerdown', () => { const a = document.activeElement; if (a?.matches?.('.vrow input.val') && el.contains(a)) lastProp = a.dataset.prop; }, true); // before the click moves the focus
  el.querySelectorAll('.plink').forEach((b) => b.addEventListener('click', () => ctx.select({ component: comp.component, node: b.dataset.node, variant: {} })));
  el.querySelectorAll('.pbind').forEach((b) => b.addEventListener('click', () => {
    const w = winners[b.dataset.prop]; if (!w) return;
    stage(b.dataset.prop, tokens(w.value).map((t) => (t === b.dataset.token ? `var(${b.dataset.var})` : t)).join(' '));
    el.querySelector('#doc-staged .opt.on')?.focus({ preventScroll: true }); // E, C, V and Enter work from here
  }));
  el.querySelector('#doc-apply')?.addEventListener('click', apply);
  el.querySelector('#doc-cancel')?.addEventListener('click', cancel);

  // ---------- variables as instruments ----------
  const setHere = (group) => props.map(([p]) => p).filter((p) => kindOfProp(p) === group);
  async function bindHere(name, group, value, prop = null) { // a variable onto this element: the value you are on, else ask which
    if (!prop) prop = lastProp && kindOfProp(lastProp) === group && winners[lastProp] ? lastProp : await askProp({ name, group, value, setHere: setHere(group), target: label });
    if (!prop) return false;
    if (!winners[prop]) winners[prop] = { value: '', source: { kind: 'none' }, important: false }; // nothing sets it yet: it can still be staged
    const w = winners[prop], parts = tokens(w.value);
    // a shorthand of several pieces (padding: a b): the variable replaces the last piece, the others stay
    const ok = stage(prop, group === 'space' && parts.length > 1 ? [...parts.slice(0, -1), `var(${name})`].join(' ') : `var(${name})`);
    el.querySelector('#doc-staged .opt.on')?.focus({ preventScroll: true }); // E, C, V and Enter work from here
    return ok;
  }
  wireStrips({ ctx, panel: el, bind: (name, group, value) => bindHere(name, group, value), bindTo: (at, name, group, value) => bindTo(ctx, at, name, group, value), render: (f) => stripsHtml(groups, new Set(varNames), f) });

  // ---------- checks ----------
  const syncChecks = () => {
    const m = measure.state, s = measure.read();
    el.querySelector('#chk-contrast')?.setAttribute('aria-pressed', String(m.contrast));
    el.querySelector('#chk-order')?.setAttribute('aria-pressed', String(m.order));
    const sum = el.querySelector('#chk-sum');
    if (sum) sum.textContent = [m.contrast && s.contrast ? `${s.contrast.total} text elements, ${s.contrast.fail} below AA` : '', m.order && s.order ? `${s.order.total} tab stops` : ''].filter(Boolean).join(' · ');
  };
  el.querySelector('#chk-contrast')?.addEventListener('click', () => { measure.toggle('contrast'); syncChecks(); });
  el.querySelector('#chk-order')?.addEventListener('click', () => { measure.toggle('order'); syncChecks(); });
  syncChecks();

  Object.assign(me, { stage, step, setScope, toggleBound, apply, cancel, syncChecks, bindHere, explain });
  if (staged && staged.key === selKey && winners[staged.prop]) { // a redraw while a value was being edited: put it back
    const input = el.querySelector(`.vrow input[data-prop="${CSS.escape(staged.prop)}"]`);
    if (input) input.value = staged.text;
    renderStaged();
  } else if (staged) { staged = null; clearPreview(ctx); }
}

// The rules of a frame's document that are the Nth one (in file order) with this selector and @media in that file. A
// stylesheet the page loads twice (applied by napkin and linked by the file) is two copies; each is returned.
function findRules(doc, ownPath, file, selector, media, index, declares) { // a variable is found by the rules that define it (the var op counts those), a value by its selector
  const sel = selector && normSel(selector), med = normMedia(media || '');
  const groups = new Map(); // where the rules came from -> the matching ones, in order
  const fileOf = (sheet) => { if (sheet.href) { try { const u = new URL(sheet.href); return u.pathname.startsWith('/raw/') ? decodeURIComponent(u.pathname.slice(5)) : null; } catch { return null; } } return ownPath; };
  const walk = (rules, f, chain, gk) => {
    for (const r of rules) {
      if (r.type === 1) { if (f === file && (!sel || normSel(r.selectorText) === sel) && (chain.at(-1) ?? '') === med && (!declares || r.style.getPropertyValue(declares) !== '')) { if (!groups.has(gk)) groups.set(gk, []); groups.get(gk).push(r); } }
      else if (r.type === 3 && r.styleSheet) { let list; try { list = r.styleSheet.cssRules; } catch { continue; } walk(list, fileOf(r.styleSheet), chain, r.styleSheet.href ? r.styleSheet : gk); }
      else if (r.type === 4) walk(r.cssRules, f, [...chain, normMedia(r.conditionText || r.media?.mediaText || '')], gk);
      else if (r.cssRules && r.type !== 5) walk(r.cssRules, f, chain, gk);
    }
  };
  for (const sheet of doc.styleSheets) { let list; try { list = sheet.cssRules; } catch { continue; } walk(list, fileOf(sheet), [], sheet.href ? sheet : 'inline'); }
  return [...groups.values()].map((g) => g[index]).filter(Boolean);
}
// The staged change shows on the canvas before it is written; this takes it away again.
function clearPreview(ctx) {
  for (const { rule, css } of previews.splice(0)) { try { rule.style.cssText = css; } catch { /* the frame was replaced */ } }
  try {
    for (const sec of ctx.stage.sections.values()) {
      const d = sec.docFrame?.doc(); if (!d) continue;
      d.querySelectorAll('[data-napkin-prev]').forEach((e) => { const was = e.getAttribute('data-napkin-prev'); e.removeAttribute('data-napkin-prev'); if (was) e.setAttribute('style', was); else e.removeAttribute('style'); });
    }
  } catch { /* a frame is being replaced */ }
}
