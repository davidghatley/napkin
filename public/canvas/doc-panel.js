// The design panel for a document-engine component (decision 0014): the selected element of an HTML file, its text and
// classes, every value with where it comes from (inline, which rule and line, which variable and where that is defined),
// and the rules and variables behind them, each editable at its source.
//
// The cascade is worked out the way the browser does it (inspector-cascade.js, decision 0015): the same code the server
// uses for GET /api/component/<id>/rules?node=, here matching with the frame's own element.matches() and matchMedia().
// A typed value shows on the canvas as it is typed and is written to this element when it is committed (Enter, Tab, or leaving the
// field: the panel's one field contract, fields.js), one contract edit (POST /api/edit) and one undo step. Where else it could go
// (this class, this variable) is a choice made on purpose: Alt+C / Alt+V while typing, or binding a variable, opens the scope chooser
// with Apply. The file is the source of truth; the frame and this panel redraw from it when the engine says it changed.
import { plain } from './words.js';
import { createCascade, longhandsOf } from './inspector-cascade.js';
import { createPreview } from './inspector-preview.js';
import { classify, offScale, bindExact, bindPieces, kindOfProp, parseColor, tokens, firstVar } from './inspector-model.js';
import { scopeOptions, defaultScope, normalizeTyped } from './inspector-scope.js';
import { stripsHtml, wireStrips, askProp } from './inspector-vars.js';
import { initMeasure } from './measure-overlay.js';
import { usersOfVariable } from './stage-highlight.js';
import { capList } from './panel-height.js';
import { sectionHtml, wireSections, openAround } from './sections.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const normSel = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim();
const normMedia = (t) => String(t ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*:\s*/g, ': ').trim().toLowerCase();
// a value the browser would not take is not written (var() values are checked where they resolve)
const validValue = (prop, value) => { if (prop.startsWith('--') || /var\(/.test(value)) return true; try { return CSS.supports(prop, value); } catch { return true; } };
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const rulesCache = new Map(); // component -> { stamp, data }
const usage = new Map();      // 'r:file:line' / 'v:--name' -> { count, where }; cleared when a file changes
let stamp = 0;
export const docsChanged = () => { stamp++; usage.clear(); };

let backTo = null;   // after Apply the keyboard stays on the value: { key, prop }, used by the redraw the edit causes
let staged = null;   // the value being edited: { key, prop, text, typed, raw, scope }
let live = null;     // the panel as last drawn: { selKey, ready, stage, ... }
let lastProp = null; // the value field you were last in (a variable clicked in the strips goes there)
let pv = null;       // the preview: the planned edit swapped into every frame (inspector-preview.js)
const openFolds = new Map(); // which collapsible sections the person opened or closed
let measure = null;
let currentCtx = null;

// ---------- the one keyboard listener of the panel (actions.js lists it) ----------
// Enter applies the staged value (Shift+Enter is a new line in the text), Escape puts it back and leaves the field.
// E, C and V choose the scope and B toggles using the variable that matches a typed value; while a text field has the
// cursor they need Alt (Option) so typing is never swallowed.
const wired = new WeakSet();
const isText = (t) => t && 'value' in t && !['button', 'checkbox', 'radio', 'submit'].includes(t.type) && t.localName !== 'button';
export function wireKeys(el) {
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
    // (Tab in the field is the field contract's: it commits and moves to the next field, fields.js. The scope chooser never takes it.)
    // Shift+Tab from the chooser comes back to the value it is choosing for
    if (staged && ev.key === 'Tab' && ev.shiftKey && t.classList?.contains('opt')) { const back = t.closest('#panel').querySelector(`.vrow input.val[data-prop="${CSS.escape(staged.prop)}"]`); if (back) { ev.preventDefault(); back.focus(); return; } }
    if (staged && t.classList?.contains('opt') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); currentCtx?.inspector?.step(ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1); return; }
    if (ev.key === 'Escape' && staged) { ev.preventDefault(); ev.stopPropagation(); if (isText(t)) t.value = t.defaultValue; currentCtx?.inspector?.cancel(); return; }
    if (ev.key === 'Enter' && staged && !isText(t) && (t.localName !== 'button' || t.classList.contains('opt'))) { ev.preventDefault(); currentCtx?.inspector?.apply(); return; }
    if (!isText(t) || !t.closest('.doc-body')) return;
    if (ev.key === 'Escape') { t.value = t.defaultValue; t.blur(); return; }
    if (ev.key !== 'Enter' || (ev.shiftKey && t.id === 'doc-text')) return;
    ev.preventDefault();
    if (t.id === 'doc-class-add' || t.closest('.decl.add')) t.dispatchEvent(new CustomEvent('doc-commit', { bubbles: true }));
    else if (t.closest('.vrow') && !t.closest('.doc-multi')) { if (staged) currentCtx?.inspector?.apply(); } // nothing typed: the focus stays
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
  let count = 0; const per = [];
  for (const c of comps) {
    let d; try { d = await rulesFor(c.component); } catch { continue; }
    if (kind === 'rule') {
      const r = d.rules.find((x) => x.file === subject.file && x.line === subject.line);
      const doc = ctx.stage.sections.get(c.component)?.docFrame?.doc();
      if (!r || !doc) continue;
      let n = 0; try { n = doc.querySelectorAll(r.selector.replace(PSEUDO_EL, '').trim() || '*').length; } catch { /* invalid */ }
      if (n) { count += n; per.push({ name: c.name, n }); }
    } else {
      // the same count the highlight gives: the places on the canvas that use it, not the rules that mention it
      const doc = ctx.stage.sections.get(c.component)?.docFrame?.doc();
      if (!doc) continue;
      const u = usersOfVariable(doc, subject), here = u.direct.size + u.indirect.size;
      if (here) { per.push({ name: c.name, n: here }); count += here; }
    }
  }
  const where = kind === 'rule'
    ? (per.length === 1 ? (per[0].n > 1 ? `all ${WORDS[per[0].n] ?? per[0].n} in ${per[0].name}` : `in ${per[0].name}`) : per.length ? `${per.length} components` : '')
    : (count ? `${count} place${count === 1 ? '' : 's'} in ${per.length} component${per.length === 1 ? '' : 's'}` : '');
  const out = { count, where };
  usage.set(key, out);
  return out;
}

export function initInspector(ctx) {
  if (ctx.inspector) return ctx.inspector;
  currentCtx = ctx;
  measure = initMeasure(ctx);
  pv = createPreview(ctx);
  // Staging ends whenever the selection leaves the element: nothing stays drawn, and it is said (nothing was written).
  ctx.on('select', (sel) => { if (!staged) return; const k = sel ? `${sel.component}|${sel.node}` : null; if (k !== staged.key) { const was = staged; dropStaged(ctx); ctx.hint(`Cancelled ${was.prop}: ${was.text}. Nothing was written.`); } });
  ctx.inspector = {
    scope: (id) => live?.setScope?.(id),            // 'element', 'class' or 'variable'
    choose: () => live?.choose?.(),                 // open the scope chooser on the value being typed (its suggested scope)
    toggleBound: () => live?.toggleBound?.(),
    apply: () => live?.apply?.(),
    cancel: () => { if (live?.cancel && staged?.key === live.selKey) live.cancel(); else dropStaged(ctx); },
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
async function bindTo(ctx, at, name, group, value, prop = null, drop = false) {
  const k = `${at.component}|${at.node}`;
  const sel = ctx.state.selection;
  if (!sel || sel.component !== at.component || sel.node !== at.node) ctx.select({ component: at.component, node: at.node, variant: {} });
  for (let i = 0; i < 100 && !(live?.selKey === k && live.stage); i++) await new Promise((r) => setTimeout(r, 30));
  return live?.selKey === k ? live.bindHere(name, group, value, prop, drop) : false;
}

export async function renderDocPanel(ctx, el, sel, comp) {
  initInspector(ctx);
  const frame = ctx.stage.sections.get(comp.component)?.docFrame;
  const node = frame?.node(sel.node);
  const target = frame?.element(sel.node)?.el;
  const key = `${comp.component}|${sel.node}|${comp.revision}|${stamp}`;
  if (!node) { el.innerHTML = `<p class="hint pp-note">${esc(comp.path)} · loading…</p>`; return; }
  const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  if (el.dataset.full === key && focus) return; // a redraw would take the field from under the cursor
  el.dataset.full = key;
  const selKey = `${comp.component}|${sel.node}`;
  if (staged && staged.key !== selKey) { const was = staged; dropStaged(ctx); ctx.hint(`Cancelled ${was.prop}: ${was.text}. Nothing was written.`); }
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
  const computed = /^\{/.test(node.attrs?.className ?? '') ? String(node.attrs.className).replace(/^\{|\}$/g, '').replace(/\s+/g, ' ').slice(0, 70) : null; // classes a React file works out in code
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
  // the file most values come from is said once, in the section's head; the rows say the line
  const fileCount = new Map(); for (const [, w] of Object.entries(explain.props)) if (w.source?.kind === 'rule') { const f = String(w.source.file).split('/').pop(); fileCount.set(f, (fileCount.get(f) ?? 0) + 1); }
  const mainFile = [...fileCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  // the selector gives way to an ellipsis, the file and line never do
  const loc = (t) => `<span class="k loc">${esc(t).replace(/^(.*)(:\d+)/, (m, a, b) => (a === mainFile ? `<span class="same-file">${a}</span>${b}` : m))}</span>`;
  const where = (s2) => (s2.kind === 'inline' ? `<code class="selp">inline style</code> ${loc(`${comp.path}:${node.line}`)}` : `<button type="button" class="selp lit" data-lit-sel="${esc(s2.selector)}" data-lit-file="${esc(s2.file)}" title="Light up every place this rule applies"><code>${esc(s2.selector)}</code></button> ${loc(`${base(s2.file)}:${s2.declLine ?? s2.line}${s2.media?.length ? ` · @media ${s2.media.at(-1)}` : ''}`)}`);
  const sayBy = (b) => (b.kind === 'inline' ? 'the inline style' : `${b.selector} ${base(b.file)}:${b.declLine ?? b.line}`);

  function valueRow([prop, w], name = prop) {
    const s2 = w.source;
    if (!s2 || s2.kind === 'none') return ghostRow(prop, w, name);
    const lost = (beats.get(`${prop.toLowerCase()}|${srcKey(s2)}`) || []).slice(0, 2).map((b) => line('', k('beats'), `<s>${esc(b.value)}</s>`, k(`from ${b.selector} :${b.line}`))).join('');
    const part = w.state === 'partial' ? (w.lost || []).map((l) => line('lost', `<code>${esc(l.props.join(', '))}</code>`, k(`from ${sayBy(l.by)}`))).join('') : '';
    const v = firstVar(w.value), info = v && explain.vars[v];
    const varLine = v ? line('pvar', `<button type="button" class="lit" data-lit-var="${esc(v)}" title="Light up every place this variable is used"><code>${esc(v)}</code></button>`, info?.source ? k('defined in') + ' ' + where(info.source) + (info.inherited ? ' ' + k('· inherited') : '') : k('is not defined')) : '';
    const offs = offScale(prop, w.value, groups).slice(0, 3);
    const flag = offs.map((off) => `<div class="pflag"><span class="k">${esc(off.token)} ${off.exact ? 'is exactly' : 'is close to'}</span><button type="button" class="pbind" data-prop="${esc(prop)}" data-token="${esc(off.token)}" data-var="${esc(off.name)}" title="Write var(${esc(off.name)}) in place of ${esc(off.token)}">${esc(off.name)} <span class="k">${esc(off.value)}</span></button></div>`).join('');
    const shown = w.resolved ?? w.value;
    return `<div class="vrow${lenCls(w.value)}${offs.length ? ' off' : ''}${w.state === 'partial' ? ' partial' : ''}" data-prop="${esc(prop)}"><div class="phead"><label for="pv-${esc(prop)}"${name !== prop ? ` title="${esc(prop)}"` : ''}>${esc(name)}</label>${w.state === 'partial' ? '<span class="pstate">partly overridden</span>' : ''}${w.important ? '<span class="imp">!important</span>' : ''}${w.resolved && w.resolved !== w.value ? `<span class="res${String(w.value).length >= 15 || parseColor(shown) ? ' longv' : ''}" title="${esc(w.resolved)}">${esc(w.resolved)}</span>` : ''}</div>
      <div class="pval">${swatch(shown)}<input class="val" id="pv-${esc(prop)}" data-key="pv-${esc(prop)}" data-prop="${esc(prop)}" value="${esc(w.value)}" aria-label="${esc(prop)}" spellcheck="false" autocomplete="off" title="${esc(w.value)}">${advToggle(prop)}</div>
      <div class="pmore">${line('', where(s2))}${part}${lost}${varLine}${flag}</div></div>`;
  }
  // A value nothing sets on this element: its field holds what the browser works out, dimmed, and typing in it stages a new
  // declaration like any other (the scope picker says where it goes).
  function ghostRow(prop, w, name = prop) {
    return `<div class="vrow ghost" data-prop="${esc(prop)}"><div class="phead"><label for="pv-${esc(prop)}"${name !== prop ? ` title="${esc(prop)}"` : ''}>${esc(name)}</label></div>
      <div class="pval"><input class="val" id="pv-${esc(prop)}" data-key="pv-${esc(prop)}" data-prop="${esc(prop)}" value="" placeholder="${esc(w.shown ?? w.value)}" aria-label="${esc(prop)} (not set here, now ${esc(w.shown ?? w.value)})" spellcheck="false" autocomplete="off">${advToggle(prop)}</div></div>`;
  }

  // ---------- the panel's width and height levers (standards section 7 rules 6 and 7) ----------
  // The values sit in Figma's order, each group a small heading. At the default width every row is a label and a field;
  // from 360 px related fields pair up (X beside Y, W beside H, the sides of a padding or the corners of a radius) and
  // from 480 px the spacing gets its live box figure. Narrower than 360, a padding's sides and a radius's corners wait
  // behind a small toggle at the right of the row, inline, unless they differ (then they show). (inspector-doc.css)
  const GROUPS = [
    ['layout', 'Layout', /^(display|position|inset|top|right|bottom|left|z-index|float|clear|box-sizing|(min-|max-)?(width|height)|aspect-ratio|flex(-.*)?|order|align-.*|justify-.*|place-.*|grid(-.*)?|gap|row-gap|column-gap|vertical-align|object-.*)$/],
    ['spacing', 'Spacing', /^(padding|margin)(-.*)?$/],
    ['appearance', 'Appearance', /^(opacity|border(-(top|bottom)-(left|right))?-radius|overflow(-.*)?|visibility|mix-blend-mode|cursor|isolation)$/],
    ['type', 'Typography', /^(font(-.*)?|line-height|letter-spacing|word-spacing|text-(?!shadow).*|white-space|color|hyphens|tab-size|direction)$/],
    ['fill', 'Fill', /^background(-.*)?$/],
    ['stroke', 'Stroke', /^(border(?!.*radius)(-.*)?|outline(-.*)?)$/],
    ['effects', 'Effects', /^(box-shadow|text-shadow|filter|backdrop-filter|transform.*|translate|rotate|scale|transition(-.*)?|animation(-.*)?)$/],
  ];
  const groupOf = (p) => (GROUPS.find(([, , re]) => re.test(p)) || ['other'])[0];
  const SIDES = { padding: [['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']], margin: [['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']], 'border-radius': [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left']] };
  const partProp = (prop, side) => (prop === 'border-radius' ? `border-${side}-radius` : `${prop}-${side}`);
  const ghosts = new Map(); // values nothing sets here that the panel still offers (W, H, the sides): staged like any other
  const ghost = (prop) => { const v = cs?.getPropertyValue(prop).trim() || ''; const w = { value: v, shown: v.replace(/^(-?[\d.]+)px$/, '$1'), source: { kind: 'none' }, important: false, state: 'computed' }; ghosts.set(prop, w); return w; };
  const winOf = (prop) => explain.props[prop] ?? ghost(prop);
  const advOpen = (prop) => (openFolds.has('adv:' + prop) ? openFolds.get('adv:' + prop) : null);
  function advToggle(prop) {
    if (!SIDES[prop]) return '';
    return `<button type="button" class="pl-adv" data-adv="${esc(prop)}" aria-controls="pl-sides-${esc(prop)}" aria-expanded="false" aria-label="${esc(prop)}: each ${prop === 'border-radius' ? 'corner' : 'side'}" title="Each ${prop === 'border-radius' ? 'corner' : 'side'}"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="${prop === 'border-radius' ? 'M1.5 5V3a1.5 1.5 0 011.5-1.5h2M7 1.5h2A1.5 1.5 0 0110.5 3v2M10.5 7v2A1.5 1.5 0 019 10.5H7M5 10.5H3A1.5 1.5 0 011.5 9V7' : 'M1.5 1.5h9v9h-9zM4 4h4v4H4z'}" fill="none" stroke="currentColor" stroke-width="1.1"/></svg></button>`;
  }
  // a padding, margin or radius with its four parts under it (each its own field, staged on its own longhand)
  function sidesBlock(prop) {
    const w = winOf(prop), parts = SIDES[prop].map(([side, name]) => [partProp(prop, side), name, winOf(partProp(prop, side))]);
    const uneven = new Set(parts.map(([, , x]) => x.value)).size > 1;
    const open = advOpen(prop) ?? uneven;
    return `<div class="pl-adv-host${open ? ' open' : ''}${uneven ? ' uneven' : ''}" data-adv-host="${esc(prop)}">${valueRow([prop, w])}
      <div class="pl-pair pl-sides" id="pl-sides-${esc(prop)}" role="group" aria-label="${esc(prop)}: each ${prop === 'border-radius' ? 'corner' : 'side'}">${parts.map(([p, name, x]) => valueRow([p, x], name)).join('')}</div></div>`;
  }
  // X and Y (where the box is in its positioned parent, measured) beside W and H (staged as width and height)
  function geometry() {
    if (!target) return '';
    const n = (v) => String(Math.round(v * 10) / 10);
    const ro = (key, name, v, what) => `<div class="vrow ro" data-geo="${key}"><div class="phead"><label for="pg-${key}">${name}</label></div><div class="pval"><input class="ro" id="pg-${key}" value="${n(v)}" readonly aria-label="${what}" title="${what}; it follows from the layout"></div></div>`;
    const size = (prop, name) => valueRow([prop, winOf(prop)], name);
    return `<div class="pl-pair pl-geo" data-pair="xy">${ro('x', 'X', target.offsetLeft, 'X, measured from its positioned parent')}${ro('y', 'Y', target.offsetTop, 'Y, measured from its positioned parent')}</div>
      <div class="pl-pair pl-geo" data-pair="wh">${size('width', 'W')}${size('height', 'H')}</div>`;
  }
  // the box this element is: margin, border, padding and content, each with its numbers (from 480 px)
  function boxFigure() {
    if (!cs || !target) return '';
    const px = (p) => Math.round(parseFloat(cs.getPropertyValue(p)) || 0);
    const side = (p) => ['top', 'right', 'bottom', 'left'].map((s) => px(p === 'border' ? `border-${s}-width` : `${p}-${s}`));
    const m = side('margin'), b = side('border'), pd = side('padding');
    const cw = Math.round(target.clientWidth - pd[1] - pd[3]), ch = Math.round(target.clientHeight - pd[0] - pd[2]);
    const t = (x, y, v, cls = '') => `<text x="${x}" y="${y}" class="${cls}">${v}</text>`;
    const label = `Box: margin ${m.join(' ')}, border ${b.join(' ')}, padding ${pd.join(' ')}, content ${cw} by ${ch}`;
    return `<figure class="pl-box" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 320 144" aria-hidden="true">
      <rect x="1" y="1" width="318" height="142" rx="4" class="bm-m"/><rect x="40" y="24" width="240" height="96" rx="2" class="bm-b"/><rect x="56" y="40" width="208" height="64" class="bm-p"/><rect x="104" y="58" width="112" height="28" class="bm-c"/>
      ${t(8, 14, 'margin', 'cap')}${t(160, 16, m[0])}${t(160, 136, m[2])}${t(20, 76, m[3])}${t(300, 76, m[1])}
      ${t(46, 36, 'border', 'cap')}${t(160, 35, b[0])}${t(160, 117, b[2])}
      ${t(62, 52, 'padding', 'cap')}${t(160, 54, pd[0])}${t(160, 100, pd[2])}${t(80, 76, pd[3])}${t(240, 76, pd[1])}
      ${t(160, 76, `${cw} × ${ch}`, 'cnt')}</svg></figure>`;
  }
  // The values, one section per group in the panel's order (Layout, Spacing, Appearance, Typography, Fill, Stroke, Effects). A text
  // element always has its Typography: what is set here, what it inherits (with where from), and the rest as the browser works it out,
  // each typed over like any value. What fits no group is "Other CSS", after the content sections.
  const kindKey = /\.(tsx|jsx)$/i.test(comp.path || '') ? 'tsx' : 'html';
  const sec = (id, title, body, o = {}) => (body ? sectionHtml({ kind: kindKey, id, title, body, ...o }) : '');
  const texty = textOnly || !!node.runs?.length;
  const TYPE_GROUP = GROUPS.find(([id]) => id === 'type')[2];
  const typeInherited = new Set(); // inherited rows Typography shows (the Inherited section then leaves them out)
  function valuesHtml() {
    const by = new Map(GROUPS.map(([id]) => [id, []]).concat([['other', []]]));
    const taken = new Set(['width', 'height']);
    for (const prop of Object.keys(SIDES)) if (explain.props[prop] || SIDES[prop].some(([sd]) => explain.props[partProp(prop, sd)])) { taken.add(prop); for (const [sd] of SIDES[prop]) taken.add(partProp(prop, sd)); }
    for (const pw of props) if (!taken.has(pw[0])) by.get(groupOf(pw[0])).push(valueRow(pw));
    if (texty) {
      const covered = new Set(props.map(([p]) => p));
      // (an inherited shorthand such as `font: 24px sans-serif` is not shown: it is not what this element draws. The parts are, each its own field.)
      for (const e of explain.inherited) if (TYPE_GROUP.test(e.prop)) { typeInherited.add(e); if (e.prop === 'font') continue; by.get('type').push(inheritedRow(e)); covered.add(e.prop); for (const x of e.sets || []) covered.add(x); }
      for (const p of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align']) if (!covered.has(p)) by.get('type').push(valueRow([p, winOf(p)]));
    }
    const sideList = (names) => names.filter((p) => taken.has(p)).map(sidesBlock).join('');
    return {
      main: [
        sec('layout', 'Layout', geometry() + by.get('layout').join('')),
        // padding is offered on every element (Figma shows it on every frame); margin and a radius once something sets them
        sec('spacing', 'Spacing', (taken.has('padding') ? '' : sidesBlock('padding')) + sideList(['padding', 'margin']) + by.get('spacing').join('') + boxFigure()),
        sec('appearance', 'Appearance', sideList(['border-radius']) + by.get('appearance').join('')),
        ...GROUPS.slice(3).map(([id, name]) => sec(id, name, by.get(id).join(''))),
      ].join(''),
      other: sec('other', 'Other CSS', by.get('other').join(''), { open: false }),
    };
  }
  // what this element takes from an ancestor because nothing sets it here, with a link that selects that ancestor
  // How long a value reads: a long one takes its own line under its name when the panel is too narrow for both (inspector-doc.css).
  const lenCls = (v) => { const n = String(v ?? '').length; return n > 30 ? ' long xlong' : n > 12 ? ' long' : ''; };
  function inheritedRow(e) {
    const link = typeof e.from === 'string' && frame.has(e.from) ? `<button type="button" class="plink" data-node="${esc(e.from)}" title="Select the element it comes from"><span class="selp">${esc(e.source.kind === 'inline' ? 'inline style' : e.source.selector)}</span> ${e.source.kind === 'inline' ? '' : loc(`${base(e.source.file)}:${e.source.declLine ?? e.source.line}`)}</button>` : `<code class="selp">${esc(e.source.kind === 'inline' ? 'inline style' : e.source.selector)}</code>`;
    const shown = e.resolved ?? e.value, name = e.sets.length > 1 && e.sets.length < 6 ? e.sets.join(', ') : e.prop;
    return `<div class="vrow inh${lenCls(e.value)}" data-prop="${esc(e.prop)}"><div class="phead"><label for="pv-${esc(e.prop)}">${esc(name)}</label><span class="pstate">inherited</span>${e.resolved && e.resolved !== e.value ? `<span class="res${String(e.value).length >= 15 || parseColor(shown) ? ' longv' : ''}" title="${esc(e.resolved)}">${esc(e.resolved)}</span>` : ''}</div>
      <div class="pval">${swatch(shown)}<input class="val" id="pv-${esc(e.prop)}" data-key="pv-${esc(e.prop)}" data-prop="${esc(e.prop)}" value="${esc(e.value)}" aria-label="${esc(e.prop)} (inherited)" spellcheck="false" autocomplete="off" title="${esc(e.value)}"></div>
      <div class="pmore"><div class="pfrom"><span class="k">inherited from</span> ${link}</div></div></div>`;
  }

  // the variables this element's values are made of, each at the definition that applies here
  const varNames = Object.keys(explain.vars);
  function varRow(name) {
    const v = explain.vars[name];
    if (!v) return `<div class="decl ro"><code class="prop">${esc(name)}</code><span class="val">${esc(cs?.getPropertyValue(name).trim() || 'not defined')}</span><span class="src">not defined</span></div>`;
    const s = v.source;
    if (s.kind !== 'rule') return `<div class="decl ro${lenCls(v.value)}" data-ro="${esc(name)}"><code class="prop">${esc(name)}</code><span class="val">${esc(v.value)}</span><span class="src">set inline on ${v.inherited ? 'an ancestor' : 'this element'}</span></div>`;
    const defs = (data.vars?.[name] || []).filter((x) => !x.inline);
    const bucket = defs.filter((x) => x.file === s.file && normMedia(x.media.at(-1)) === normMedia(s.media.at(-1)));
    const k = Math.max(0, bucket.findIndex((x) => x.line === s.declLine && normSel(x.selector) === normSel(s.selector)));
    return `<div class="decl${lenCls(v.raw)}" data-kind="var" data-prop="${esc(name)}" data-file="${esc(s.file)}" data-index="${k}" data-media="${esc(s.media.at(-1) ?? '')}">
      <button type="button" class="lit prop" data-lit-var="${esc(name)}" title="Light up every place this variable is used"><code>${esc(name)}</code></button><input class="val" data-key="v-${esc(name)}" value="${esc(v.raw)}" aria-label="${esc(name)}" spellcheck="false" autocomplete="off" title="now ${esc(v.value)}"><span class="src" title="${esc(s.file)}:${s.declLine} · ${esc(s.selector)}">${esc(base(s.file))}:${s.declLine}${v.inherited ? ' ↑' : ''}</span></div>`;
  }

  function declRow({ prop, value, important, kind, rule, idx, line, over, partial, by, resolved }) {
    const k = kind === 'rule' ? `r${rule}-${prop}` : `s-${prop}`;
    const src = kind === 'rule' ? `<span class="src">:${line}</span>` : '';
    const why = (over || partial) && by ? `${partial ? 'partly overridden by' : 'beaten by'} ${by.kind === 'inline' ? 'the inline style' : `${by.selector} (${base(by.file)}:${by.declLine ?? by.line})`}` : '';
    return `<div class="decl${lenCls(value)}${over ? ' over' : ''}${partial ? ' partial' : ''}" data-kind="${kind}" data-prop="${esc(prop)}"${kind === 'rule' ? ` data-rule="${rule}" data-index="${idx}"` : ''}>
      <code class="prop"${why ? ` title="${esc(why)}"` : ''}>${esc(prop)}</code><input class="val" data-key="${esc(k)}" value="${esc(value)}" aria-label="${esc(prop)}" spellcheck="false" autocomplete="off"${resolved ? ` title="now ${esc(resolved)}"` : why ? ` title="${esc(why)}"` : ''}>${important ? '<span class="imp">!important</span>' : ''}<button type="button" class="decl-x" aria-label="Remove ${esc(prop)}">×</button>${src}</div>`;
  }
  const rulesStrong = [...explain.rules].reverse();

  const values = props.length || target ? valuesHtml() : { main: '', other: '' };
  const inheritedRest = explain.inherited.filter((e) => !typeInherited.has(e));
  const codeNote = !props.length && computed ? `<p class="hint">Its classes are worked out in code: <code>${esc(computed)}</code> at line ${node.line} of ${esc(base(comp.path))}. No stylesheet rule of this folder matches it here. Change them in that file.</p>` : '';
  // One list, in the panel's order (standards section 7 rule 4): the design sections, then this element's content and where its
  // values come from (Text, Classes, Other CSS, Inherited, Inline style, Rules, Variables), then the checks. The header is
  // panel-head.js's; the file's own sections (Source, Viewer) follow from the instruments.
  el.innerHTML = `
    <button type="button" class="doc-skip" id="doc-skip">Skip to your variables</button>
    <div class="doc-body" data-node="${esc(sel.node)}">
      ${values.main}
      ${textOnly ? sec('text', 'Text', `<textarea id="doc-text" data-key="text" rows="${Math.min(4, Math.max(1, Math.ceil(node.text.length / 38)))}" aria-label="Text">${esc(node.text)}</textarea>`) : ''}
      ${node.runs?.length ? sec('runs', 'Text', node.runs.map((r) => `<textarea class="doc-run" data-run="${r.index}" data-key="run-${r.index}" rows="${Math.min(4, Math.max(1, Math.ceil(r.text.length / 34)))}" aria-label="Text run ${r.index + 1}"${r.editable ? '' : ' disabled title="Computed in code"'}>${esc(r.text)}</textarea>`).join(''), { note: `${node.runs.length} run${node.runs.length === 1 ? '' : 's'}` }) : ''}
      ${sec('classes', 'Classes', `<div class="doc-classes" id="doc-classes">${classes.length > 12 ? `<span class="hint" title="${esc(classes.join(' '))}">first 12 of ${classes.length}</span>` : ''}${classes.slice(0, 12).map((c) => `<span class="cls"><code>.${esc(c)}</code><button type="button" class="cls-x" data-remove="${esc(c)}" aria-label="Remove class ${esc(c)}">×</button></span>`).join('')}
          <input id="doc-class-add" data-key="class-add" placeholder="add class" aria-label="Add a class" spellcheck="false" autocomplete="off"></div>${codeNote}`)}
      ${values.other}
      ${inheritedRest.length ? sec('inherited', 'Inherited', `<div id="doc-inherited">${inheritedRest.map(inheritedRow).join('')}</div>`, { open: false, note: `${inheritedRest.length} from around it` }) : ''}
      ${sec('inline', 'Inline style', `<div class="decls" id="doc-inline">${inlineDecls.map((d) => declRow({ prop: d.prop, value: d.value, important: d.important, kind: 'style', over: d.state === 'overridden', partial: d.state === 'partial', by: d.by, resolved: d.resolved })).join('')}
          <div class="decl add"><input class="prop" data-key="inline-new-prop" placeholder="property" aria-label="New inline property" spellcheck="false" autocomplete="off"><input class="val" data-key="inline-new-val" placeholder="value" aria-label="New inline value" spellcheck="false" autocomplete="off"></div></div>`, { open: false, note: inlineDecls.length ? `${inlineDecls.length} set` : 'none yet' })}
      ${sec('rules', 'Rules', rulesStrong.length ? '<div class="rules-list">' + rulesStrong.map((r) => `<div class="rule" data-rule="${r.order}" data-selector="${esc(r.selector)}" data-file="${esc(r.file)}">
          <div class="rhead"><button type="button" class="lit" data-lit-sel="${esc(r.selector)}" data-lit-file="${esc(r.file)}" title="Light up every place this rule applies"><code class="sel">${esc(r.selector)}</code></button>${r.media.length ? `<span class="media">@media ${esc(r.media.join(' and '))}</span>` : ''}<span class="src" title="${esc(r.file)}:${r.line} · specificity ${r.specificity.join(',')}">${esc(base(r.file))}:${r.line}</span></div>
          <div class="decls">${r.decls.map((d) => declRow({ prop: d.prop, value: d.value, important: d.important, kind: 'rule', rule: r.order, idx: index(data.rules[r.order]), line: d.line, over: d.state === 'overridden', partial: d.state === 'partial', by: d.by, resolved: d.resolved })).join('')}
            <div class="decl add"><input class="prop" data-key="r${r.order}-new-prop" data-rule="${r.order}" placeholder="property" aria-label="New property in ${esc(r.selector)}" spellcheck="false" autocomplete="off"><input class="val" data-key="r${r.order}-new-val" data-rule="${r.order}" placeholder="value" aria-label="New value in ${esc(r.selector)}" spellcheck="false" autocomplete="off"></div></div>
        </div>`).join('') + '</div>' : '<p class="hint">No rule of this file’s stylesheets matches this element.</p>', { open: false, note: `${rulesStrong.length} matching${mainFile ? ' · ' + esc(mainFile) : ''}` })}
      ${varNames.length ? sec('vars-here', 'Variables here', `<div class="decls">${varNames.map(varRow).join('')}</div>`, { open: false, note: String(varNames.length) }) : ''}
      ${sec('vars', 'Your variables', `<div id="doc-vars"><input id="doc-vars-filter" data-key="vars-filter" class="vfilter" type="search" placeholder="find a variable" aria-label="Find a variable" spellcheck="false" autocomplete="off">
        <div id="doc-vars-body">${stripsHtml(groups, new Set(varNames))}</div>
        <p class="hint">Click one to use it on the value you are in, or drag it onto an element.</p></div>`, { open: false, note: `${Object.keys(folderVars).length} in this folder` })}
      ${sec('checks', 'Check', `<div id="doc-checks"><div class="mrow"><button type="button" class="mchip" id="chk-contrast" aria-pressed="false">Contrast</button><button type="button" class="mchip" id="chk-order" aria-pressed="false">Focus order</button><span class="hint" id="chk-sum"></span></div><p class="hint">Hold Alt over an element to measure it.</p></div>`, { open: false })}
      <p class="field-error" id="doc-error" hidden></p>
    </div>
    <div id="doc-dock" hidden>
      <div id="doc-staged" aria-live="polite"></div>
      <div class="doc-foot" id="doc-foot"><button type="button" class="primary" id="doc-apply">Apply <kbd>↵</kbd></button><button type="button" id="doc-cancel">Cancel <kbd>Esc</kbd></button></div>
    </div>`;
  wireSections(el);
  el.querySelectorAll('.pl-adv').forEach((b) => {
    const hostEl = b.closest('.pl-adv-host'), prop = b.dataset.adv;
    if (!hostEl) { b.remove(); return; }
    b.setAttribute('aria-expanded', String(hostEl.classList.contains('open')));
    b.addEventListener('click', () => { const on = !hostEl.classList.contains('open'); hostEl.classList.toggle('open', on); b.setAttribute('aria-expanded', String(on)); openFolds.set('adv:' + prop, on); });
  });
  // the height lever: a long list shows six rows, its bottom edge drags for more (panel-height.js)
  const rl = el.querySelector('[data-sec="rules"] .rules-list'); if (rl) capList(rl, { key: `${kindKey}.rules`, label: 'Rules', rows: () => [...rl.children] });
  for (const [sel2, key2, name2] of [['#doc-inline', 'inline', 'Inline style'], ['[data-sec="vars-here"] .decls', 'vars-here', 'Variables here']]) { const l = el.querySelector(sel2); if (l) capList(l, { key: `${kindKey}.${key2}`, label: name2, rows: () => [...l.children].filter((r) => !r.classList.contains('add')) }); }
  if (focus) el.querySelector(`[data-key="${CSS.escape(focus)}"]`)?.focus();
  else if (backTo?.key === selKey) { el.querySelector(`.vrow input[data-prop="${CSS.escape(backTo.prop)}"]`)?.focus({ preventScroll: true }); backTo = null; }
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
  const light = (arg) => { try { ctx.stage?.lightQuiet?.(arg); } catch { /* the stage may not know */ } };
  for (const r of el.querySelectorAll('.rule')) {
    r.addEventListener('pointerenter', () => { if (!staged) light({ selector: r.dataset.selector, file: r.dataset.file }); });
    r.addEventListener('pointerleave', () => { if (!staged) light(null); });
  }

  el.querySelectorAll('[data-lit-sel], [data-lit-var]').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); ctx.stage?.highlight?.(b.dataset.litVar ? { variable: b.dataset.litVar } : { selector: b.dataset.litSel, file: b.dataset.litFile }); }));
  el.querySelectorAll('[data-lit-sel], [data-lit-var]').forEach((b) => {
    const spec = () => (b.dataset.litVar ? { variable: b.dataset.litVar } : { selector: b.dataset.litSel, file: b.dataset.litFile });
    b.addEventListener('pointerenter', () => { if (!staged) light(spec()); }); b.addEventListener('pointerleave', () => { if (!staged) light(null); });
    b.addEventListener('focus', () => { if (!staged) light(spec()); }); b.addEventListener('blur', () => { if (!staged) light(null); });
  });
  el.querySelector('#doc-skip')?.addEventListener('click', () => { openAround(el.querySelector('#doc-vars')); const c = el.querySelector('#doc-vars .ivchip'); c?.scrollIntoView({ block: 'center' }); c?.focus({ preventScroll: true }); });

  // ---------- the staged value: scope, the change, Apply ----------
  const winners = explain.props;
  for (const [p, w] of ghosts) winners[p] ??= w; // W, H and the sides offered though nothing sets them
  for (const e of explain.inherited) winners[e.prop.toLowerCase()] ??= { value: e.value, ...(e.resolved !== undefined && { resolved: e.resolved }), important: false, source: e.source, state: 'inherited', from: e.from }; // an inherited value stages like any other
  const uses = {
    rule: (r) => usage.get(`r:${r.file}:${r.line}`) ?? null,
    variable: (n) => usage.get(`v:${n}`) ?? null,
  };
  const optionsFor = () => scopeOptions({
    prop: staged.prop, typed: staged.typed, bound: staged.raw ? null : bindExact(staged.prop, staged.typed, groups), comp, node: { ...node, node: sel.node }, classes,
    matched: cas ? cas.matched(target) : [], winner: winners[staged.prop], vars: explain.vars, data, uses, important: !!staged.important,
    wouldLose: (m, prop, imp) => cas.wouldLose(target, m, prop, imp), forceRule: staged.forceRule ?? null,
  });
  const chosenOf = (opts) => opts.find((o) => o.id === staged.scope && !o.disabled) || opts.find((o) => !o.disabled);
  // The staged change shows on the canvas before it is written, and it is the change itself: the engine plans the edit
  // without writing it (dryRun) and those exact bytes replace the file in every frame (inspector-preview.js). Then the
  // value is read back from the frame: if it did not take, the person is told why and what would work.
  let pvTok = 0, pvKey = null, animName = null;
  // a running animation that sets this property wins over every rule, so a value typed here will not show
  function animatedBy(prop) {
    if (!prop || !target?.getAnimations) return null;
    try {
      const camel = (p) => p.replace(/-([a-z])/g, (m, c) => c.toUpperCase()), keys = new Set(longhandsOf(prop).map(camel));
      for (const an of target.getAnimations()) { if (!an.animationName) continue; for (const kf of an.effect.getKeyframes()) for (const k of Object.keys(kf)) if (keys.has(k)) return an.animationName; }
    } catch { /* no animations to read */ }
    return null;
  }
  // A variable with a definition per theme: the designer picks which definitions the value goes to; the one in force here by default.
  const themeDefs = (opt) => { if (opt?.id !== 'variable') return []; const defs = (data.vars?.[opt.edit.name] || []).filter((x) => !x.inline); return defs.length > 1 ? defs : []; };
  const defEdit = (opt, d) => { const bucket = (data.vars[opt.edit.name] || []).filter((x) => !x.inline && x.file === d.file && normMedia(x.media.at(-1)) === normMedia(d.media.at(-1))); return { op: 'var', file: d.file, name: opt.edit.name, value: opt.edit.value, media: d.media.at(-1) ?? '', index: Math.max(0, bucket.indexOf(d)) }; };
  const editsOf = (opt) => { const defs = themeDefs(opt); if (!defs.length || !staged?.defs) return [opt.edit]; const chosen = defs.filter((d, i) => staged.defs.has(i)); return chosen.length ? chosen.map((d) => defEdit(opt, d)) : [opt.edit]; };
  const defLabel = (d) => (d.media?.length ? `@media ${d.media.at(-1)}` : d.selector && !/^:root$/.test(d.selector.trim()) ? d.selector : 'default');
  async function preview(opt) {
    const tok = ++pvTok;
    if (!opt || !target || staged?.invalid) { pvKey = null; pv.clear(); return; }
    const key = JSON.stringify(editsOf(opt));
    if (key === pvKey) return;
    const r = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: comp.component, baseRevision: comp.revision, edits: editsOf(opt), dryRun: true }) });
    const j = await r.json().catch(() => ({ ok: false, error: `the preview failed (${r.status})` }));
    if (tok !== pvTok || !staged) return;
    if (!j.ok) { pvKey = null; pv.clear(); showError(plain(j.error)); return; }
    showError(''); pvKey = key;
    pv.clear(); animName = animatedBy(opt.edit.prop); // read with the page as it runs, before the preview holds animations still
    const shown = await pv.apply(j.files || []);
    await new Promise((res) => requestAnimationFrame(res));
    if (tok !== pvTok || !staged) return;
    // a change the frames cannot show is said so; it is never reported as a rule that loses
    const unseen = (j.files || []).find((f) => !shown.has(f.path));
    const fx = animName ? { animation: animName } : unseen ? { unseen: unseen.path } : effectOf(opt);
    if (JSON.stringify(fx) !== JSON.stringify(staged.fx?.[key])) { staged.fx = { [key]: fx }; renderStaged(); }
  }
  // The computed longhands of `prop: value` on a bare copy of this element (null when the browser would not take it).
  function computedOf(prop, value) {
    if (!target?.isConnected || prop.startsWith('--') || !validValue(prop, value)) return null;
    const tcs = win.getComputedStyle(target), probe = target.cloneNode(false);
    for (const a of ['id', 'class', 'style', 'data-napkin-prev']) probe.removeAttribute(a);
    const keep = Object.keys(explain.vars).map((n) => `${n}:${tcs.getPropertyValue(n)}`).join(';');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;font-size:${tcs.fontSize};color:${tcs.color};${keep};${prop}:${value}`;
    if (probe.style.getPropertyValue(prop) === '') return null;
    target.after(probe);
    const pcs = win.getComputedStyle(probe), out = longhandsOf(prop).map((l) => pcs.getPropertyValue(l)).join('|');
    probe.remove();
    return out;
  }
  // `#f00` over `red`, `0px` over `0`: the same value said differently is no change (a variable binding is a change)
  function sameMeaning(prop, typed, current) {
    if (/var\(/.test(typed) || /var\(/.test(current)) return false;
    const a = computedOf(prop, typed), b = computedOf(prop, current);
    return a !== null && a === b;
  }
  // Does the typed value show on this element now? The same value on a bare copy of it (nothing else styling it) is what
  // the browser would paint with no competition; any longhand that differs lost to something else.
  function effectOf(opt) {
    const e = opt.edit, prop = e.prop;
    if (!prop || e.op === 'var' || prop.startsWith('--') || !target?.isConnected) return null;
    const doc = target.ownerDocument, tcs = win.getComputedStyle(target), probe = target.cloneNode(false);
    for (const a of ['id', 'class', 'style', 'data-napkin-prev']) probe.removeAttribute(a);
    const keep = Object.keys(explain.vars).map((n) => `${n}:${tcs.getPropertyValue(n)}`).join(';'); // the variables this element sees
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;font-size:${tcs.fontSize};color:${tcs.color};${keep};${prop}:${e.value}`;
    if (probe.style.getPropertyValue(prop) === '') return { invalid: true };
    target.after(probe);
    const pcs = win.getComputedStyle(probe), bad = longhandsOf(prop).filter((l) => pcs.getPropertyValue(l) !== tcs.getPropertyValue(l));
    probe.remove(); void doc;
    return bad.length ? { bad } : null;
  }
  // a long declaration keeps its changed end: the shared start becomes "…" (the whole line is on hover)
  const diffText = (l, lines) => {
    const other = lines.find((x) => x !== l); if (!other || l.text.length < 34) return l.text;
    let i = 0; while (i < l.text.length && l.text[i] === other.text[i]) i++;
    i = l.text.lastIndexOf(' ', i);
    return i > 10 ? `${l.text.slice(0, l.text.indexOf(':') + 1)} …${l.text.slice(i)}` : l.text;
  };
  // "won't show: .imp components.css:9 wins (!important)" and the scope that would work
  function whyNot(opt, fx) {
    if (!fx) return null;
    if (fx.invalid) return { text: `not a value ${staged.prop} accepts` };
    if (fx.animation) return { text: `won’t show: animation ${fx.animation} controls ${staged.prop}` };
    if (fx.unseen) return { text: /\.css$/i.test(fx.unseen) ? `this rule is in an @imported sheet (${base(fx.unseen)}); the preview can’t show it` : `this change is in ${base(fx.unseen)}; the preview can’t show it` };
    const l = opt.losers?.[0];
    if (!l) return { text: `won’t show: something else on the page wins ${fx.bad.slice(0, 2).join(', ')}` };
    const same = l.by.kind === 'rule' && opt.id === 'class' && l.by.order === data.rules.findIndex((r) => r.file === opt.edit.file && r.selector === opt.edit.selector && normMedia(r.media.at(-1)) === normMedia(opt.edit.media));
    const who = l.by.kind === 'inline' ? 'the inline style' : `${l.by.selector} ${base(l.by.file)}:${l.by.declLine ?? l.by.line}`;
    const part = fx.bad.length < longhandsOf(staged.prop).length ? `${fx.bad.join(', ')} ` : ''; // only some of what the value sets loses
    const text = same ? `${part || `${staged.prop} `}is set again later in this rule, which wins` : `${part}won’t show: ${who} wins (${l.why})`;
    const fix = l.by.kind === 'inline' ? { label: 'Use this element', scope: 'element' } : !same ? { label: `Change ${l.by.selector} instead`, scope: 'class', rule: l.by.order } : null;
    return { text, fix };
  }
  function renderStaged() {
    const host = el.querySelector('#doc-staged'), dock = el.querySelector('#doc-dock');
    if (!host) return;
    el.querySelectorAll('.vrow').forEach((r) => r.classList.toggle('editing', !!staged && r.dataset.prop === staged.prop));
    if (!staged) { host.innerHTML = ''; dock.hidden = true; preview(null); light(null); ctx.stage?.setEditNote?.(null); ctx.legend?.pop('staged'); return; }
    if (!staged.explicit) { // an ordinary edit: shown on the canvas, no dock; Enter, Tab or leaving the field writes it to this element
      host.innerHTML = ''; dock.hidden = true; ctx.legend?.pop('staged');
      preview(staged.invalid ? null : chosenOf(optionsFor())); light(null);
      return;
    }
    ctx.legend?.push('staged', [['E', 'this element'], ['C', 'this class'], ['V', 'this variable'], ['↵', 'apply'], ['Esc', 'cancel']]);
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
      <kbd>${o.key}</kbd><span class="otxt"><b>${o.title}${o.code && !o.disabled ? ` <code>${esc(o.code)}</code>` : ''}</b><span class="osub">${o.id === 'element' ? `inline style · ${esc(base(comp.path))}:${node.line}` : o.disabled ? 'not here' : esc(o.sub || '')}</span></span><span class="ocount">${o.countText ? esc(o.countText) : ''}</span></button>`;
    const fx = staged.invalid ? { invalid: true } : chosen ? staged.fx?.[JSON.stringify(editsOf(chosen))] : null, not = whyNot(chosen, fx);
    const applyBtn = el.querySelector('#doc-apply'); if (applyBtn) { applyBtn.disabled = !!staged.invalid; applyBtn.title = staged.invalid ? `Not a value ${staged.prop} accepts` : ''; }
    const n = chosen?.diff.lines.some((l) => l.kind === 'del') ? 1 : chosen?.diff.lines.length ?? 0;
    const where = chosen ? chosen.sub : (opts.find((o) => o.id === staged.scope)?.why ?? '');
    host.innerHTML = `<section class="dsec staged">
      <h3><code>${esc(staged.prop)}</code> <span class="where">${exact && !staged.raw && chosen?.id !== 'variable' ? `on your scale: <code>${esc(rawList)}</code> → <code>${esc(varList)}</code> <button type="button" class="linkish" id="doc-raw">keep <kbd>B</kbd></button>` : exact && staged.raw ? `plain value <button type="button" class="linkish" id="doc-raw">use <code>${esc(varList)}</code> <kbd>B</kbd></button>` : chosen && chosen.id !== 'element' ? 'previewing on the canvas' : 'this element only'}</span></h3>
      <div class="scope" role="radiogroup" aria-label="Where this change goes">${opts.map(one).join('')}</div>
      <p class="scopenote${not ? ' bad' : ''}" title="${esc(not ? not.text : where)}">${not ? `<em>${esc(not.text)}</em>${not.fix ? ` <button type="button" class="linkish" id="doc-fix">${esc(not.fix.label)}</button>` : ''}` : esc(where)}</p>
      ${(() => { const defs = themeDefs(chosen); if (!defs.length) return ''; if (!staged.defs) { const here = defs.findIndex((d) => JSON.stringify(defEdit(chosen, d)) === JSON.stringify(chosen.edit)); staged.defs = new Set([Math.max(0, here)]); } return `<fieldset class="var-themes" id="var-themes"><legend>Write to</legend>${defs.map((d, i) => `<label><input type="checkbox" data-def="${i}"${staged.defs.has(i) ? ' checked' : ''}><span class="vt-where" title="${esc(d.file)}:${d.line}">${esc(defLabel(d))}</span><code title="now ${esc(d.value)}">${esc(d.value)}</code></label>`).join('')}</fieldset>`; })()}
      <div class="diff" id="doc-diff" aria-label="The change, ${n} line">${(chosen?.diff.lines ?? []).map((l) => `<div class="${l.kind === 'del' ? 'd' : 'a'}" title="${esc(l.text)}"><i>${l.line}</i><u>${l.kind === 'del' ? '−' : '+'}</u><span>${esc(diffText(l, chosen.diff.lines))}</span></div>`).join('')}</div>
    </section>`;
    const first = dock.hidden;
    dock.hidden = false;
    // the dock covers the bottom of the panel instead of pushing the values down; the value being edited is kept above it
    if (first) { el.style.setProperty('--dock', `${dock.offsetHeight + 8}px`); el.querySelector('.vrow.editing')?.scrollIntoView({ block: 'nearest' }); }
    host.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => setScope(b.dataset.scope)));
    host.querySelectorAll('#var-themes input').forEach((c) => c.addEventListener('change', () => { const i = Number(c.dataset.def); if (c.checked) staged.defs.add(i); else if (staged.defs.size > 1) staged.defs.delete(i); else c.checked = true; renderStaged(); }));
    host.querySelector('#doc-raw')?.addEventListener('click', toggleBound);
    host.querySelector('#doc-fix')?.addEventListener('click', () => { staged.forceRule = not.fix.rule ?? null; setScope(not.fix.scope); });
    if (had) (host.querySelector(`[data-scope="${had}"]`) || host.querySelector(`#${had}`))?.focus({ preventScroll: true });
    preview(chosen);
    if (chosen?.id === 'class') light({ selector: chosen.edit.selector, file: chosen.edit.file }); else if (chosen?.id === 'variable') light({ variable: chosen.edit.name }); else light(null);
    // the scope, said on the canvas where the eye is
    const reach = chosen?.id === 'element' ? 0 : ctx.highlight?.places?.() ?? 0, at = target && ctx.highlight?.placeOf?.(target);
    const kind = chosen?.id === 'class' ? 'class' : chosen?.id === 'variable' ? 'variable' : 'element';
    ctx.stage?.setEditNote?.({ component: comp.component, chip: kind === 'element' ? 'this element' : `${kind} scope${reach ? ` · ${at ? `${at} of ` : ''}${reach}` : ''}`, title: kind === 'element' ? 'editing · this element only' : `editing · ${reach} place${reach === 1 ? '' : 's'} preview the change` });
  }
  // the first keystroke brings what is being edited up to a size you can see it change at
  function legible() {
    const r = frame?.cell.getBoundingClientRect(), box = ctx.view.stageBox(), v = ctx.view.get();
    if (!r || !target?.isConnected) return;
    const inView = r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
    if (v.z >= 0.6 && inView) return;
    ctx.view.flyTo(ctx.view.rectToWorld(r), { pad: 72, max: 1 });
  }
  function stage(prop, text, { typed = false } = {}) {
    const w = winners[prop];
    if (!w) return false;
    const raw = text.trim();
    if (!raw) { staged = null; renderStaged(); return false; }
    const important = /\s*!\s*important\s*$/i.test(raw), t = raw.replace(/\s*!\s*important\s*$/i, '').trim(); // !important is written as the flag it is
    if (!important && (t === w.value || normalizeTyped(prop, t) === w.value || sameMeaning(prop, normalizeTyped(prop, t), w.value))) { staged = null; renderStaged(); ctx.hint(`No change: ${prop} is already ${w.value}`); return false; }
    const prev = staged?.prop === prop ? staged : null;
    if (!staged) legible();
    const field = el.querySelector(`.vrow input[data-prop="${CSS.escape(prop)}"]`); // a variable bound from the strips shows in the field
    if (field && field.value !== text) field.value = text;
    let typed0 = normalizeTyped(prop, t);
    if (/^-?\d*\.?\d+$/.test(typed0) && !validValue(prop, typed0) && validValue(prop, typed0 + 'px')) typed0 += 'px'; // W 632 is 632px, as the field shows it
    // typed into the field: an ordinary edit, written to this element, with no chooser (unless one was asked for while typing)
    const explicit = prev?.explicit ?? !typed;
    staged = { key: selKey, prop, text, typed: typed0, important, invalid: !validValue(prop, typed0), raw: prev?.raw ?? false, scope: prev?.scope ?? null, forceRule: prev?.forceRule ?? null, explicit };
    const opts = optionsFor();
    if (!explicit && !staged.scope && opts.find((o) => o.id === 'element' && !o.disabled)) staged.scope = 'element';
    if (!staged.scope || !opts.find((o) => o.id === staged.scope && !o.disabled)) staged.scope = defaultScope(opts, w);
    renderStaged();
    return true;
  }
  // Open the scope chooser on the value being typed, at the scope napkin would suggest (the class when it is the element's own).
  function choose() {
    if (!staged) return false;
    if (!staged.explicit) { staged.explicit = true; staged.scope = defaultScope(optionsFor(), winners[staged.prop]); }
    renderStaged();
    return true;
  }
  function setScope(id) {
    if (!staged) return false;
    const o = optionsFor().find((x) => x.id === id);
    if (!o || o.disabled) { showError(o ? o.why : ''); return false; }
    showError(''); staged.scope = id; staged.explicit = true; if (id !== 'class') staged.forceRule = null; renderStaged();
    el.querySelector(`[data-scope="${id}"]`)?.focus({ preventScroll: true });
    return true;
  }
  function step(d) { // arrow keys on the scope options: the next one that can be used
    if (!staged) return false;
    const order = ['element', 'class', 'variable'], opts = optionsFor();
    for (let i = order.indexOf(staged.scope) + d; i >= 0 && i < 3; i += d) if (!opts.find((o) => o.id === order[i])?.disabled) return setScope(order[i]);
    return false;
  }
  function toggleBound() { if (staged) { staged.raw = !staged.raw; staged.explicit = true; renderStaged(); } }
  function cancel() {
    if (!staged) return;
    const input = el.querySelector(`.vrow input[data-prop="${CSS.escape(staged.prop)}"]`); if (input) input.value = input.defaultValue;
    staged = null; renderStaged(); showError('');
  }
  async function apply() {
    if (!staged || staged.invalid) { if (staged?.invalid) showError(`Not a value ${staged.prop} accepts`); return null; }
    const chosen = chosenOf(optionsFor());
    if (!chosen) return null;
    if (staged.applying) return null;
    staged.applying = true;
    const refocus = staged.prop, field = el.querySelector(`.vrow input[data-prop="${CSS.escape(refocus)}"]`);
    // the focus comes back to the value unless the person has moved on (Tab to the next field, a click elsewhere in the panel)
    const stay = () => { const a = document.activeElement; return !a || a === document.body || a === field || !!a.closest?.('#doc-dock') || (!el.contains(a) && !a.closest?.('#inspector')); };
    const j = await send(editsOf(chosen));
    preview(null);
    if (j.ok) {
      staged = null; renderStaged(); light(null);
      if (stay()) { backTo = { key: selKey, prop: refocus }; const f = el.querySelector(`.vrow input[data-prop="${CSS.escape(refocus)}"]`); f?.focus({ preventScroll: true }); f?.select?.(); }
    } else { if (staged) staged.applying = false; renderStaged(); }
    return j;
  }
  el.querySelectorAll('.vrow input.val').forEach((inp) => {
    inp.addEventListener('input', () => stage(inp.dataset.prop, inp.value, { typed: true }));
    inp.addEventListener('focus', () => { lastProp = inp.dataset.prop; });
    // leaving the field commits what was typed into it (an edit with its scope chooser open waits for Apply)
    inp.addEventListener('blur', () => { if (staged && staged.prop === inp.dataset.prop && !staged.explicit && !staged.applying && !staged.invalid && live === me) apply(); });
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

  // how widely this element's classes are used on the canvas, so a drop can choose its scope knowingly
  const classHint = () => {
    const out = [];
    for (const c of classes.slice(0, 2)) { let n = 0; for (const sec of ctx.stage.sections.values()) { try { n += sec.docFrame?.doc()?.querySelectorAll(`.${CSS.escape(c)}`).length ?? 0; } catch { /* no document yet */ } } out.push(`.${c} is on ${n} element${n === 1 ? '' : 's'} on the canvas`); }
    return out.length ? `${out.join(' · ')}. It goes on this element unless you choose the class (C).` : 'It goes on this element.';
  };
  // ---------- variables as instruments ----------
  const setHere = (group) => props.map(([p]) => p).filter((p) => kindOfProp(p) === group);
  async function bindHere(name, group, value, prop = null, drop = false) { // a variable onto this element: the value you are on, else ask which
    if (!prop) prop = lastProp && kindOfProp(lastProp) === group && winners[lastProp] ? lastProp : await askProp({ ctx, name, group, value, setHere: setHere(group), target: label, hint: classHint(),
      show: async (p) => { if (!p) { pv.clear(); return; } const j = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: comp.component, baseRevision: comp.revision, edits: [{ op: 'style', node: sel.node, prop: p, value: `var(${name})` }], dryRun: true }) }).then((r) => r.json()).catch(() => null); if (j?.ok) await pv.apply(j.files || []); } });
    if (!prop) return false;
    if (!winners[prop]) winners[prop] = { value: '', source: { kind: 'none' }, important: false }; // nothing sets it yet: it can still be staged
    const w = winners[prop], parts = tokens(w.value);
    // a shorthand of several pieces (padding: a b): the variable replaces the last piece, the others stay
    const ok = stage(prop, group === 'space' && parts.length > 1 ? [...parts.slice(0, -1), `var(${name})`].join(' ') : `var(${name})`);
    if (drop && ok) setScope('element'); // a drop onto one element is that element
    el.querySelector('#doc-staged .opt.on')?.focus({ preventScroll: true }); // E, C, V and Enter work from here
    return ok;
  }
  wireStrips({ ctx, panel: el, bind: (name, group, value) => bindHere(name, group, value), bindTo: (at, name, group, value) => bindTo(ctx, at, name, group, value, null, true), render: (f) => stripsHtml(groups, new Set(varNames), f) });

  // ---------- checks ----------
  const syncChecks = () => {
    const m = measure.state, s = measure.read();
    el.querySelector('#chk-contrast')?.setAttribute('aria-pressed', String(m.contrast));
    el.querySelector('#chk-order')?.setAttribute('aria-pressed', String(m.order));
    const sum = el.querySelector('#chk-sum');
    if (sum) sum.textContent = [m.contrast && s.contrast ? `${s.contrast.total} text elements, ${s.contrast.fail} below AA, in the frames in view` : '', m.order && s.order ? `${s.order.total} tab stops` : '', (m.contrast || m.order) && (ctx.view?.get().z ?? 1) < 0.45 ? 'zoom in to read each one' : ''].filter(Boolean).join(' · ');
  };
  el.querySelector('#chk-contrast')?.addEventListener('click', () => { measure.toggle('contrast'); syncChecks(); });
  el.querySelector('#chk-order')?.addEventListener('click', () => { measure.toggle('order'); syncChecks(); });
  syncChecks();

  Object.assign(me, { stage, step, choose, setScope, toggleBound, apply, cancel, syncChecks, bindHere, explain });
  if (staged && staged.key === selKey && winners[staged.prop]) { // a redraw while a value was being edited: put it back
    const input = el.querySelector(`.vrow input[data-prop="${CSS.escape(staged.prop)}"]`);
    if (input) input.value = staged.text;
    renderStaged();
  } else if (staged) { staged = null; clearPreview(); }
}

// However staging ends: no preview, no outlines, no chip, no legend, no dock, and the field says what the file says.
function dropStaged(ctx) {
  staged = null; lastProp = null; clearPreview();
  ctx.stage?.lightQuiet?.(null); ctx.stage?.setEditNote?.(null); ctx.legend?.pop('staged');
  const panel = document.querySelector('#panel');
  panel?.querySelectorAll('.vrow.editing').forEach((r) => { r.classList.remove('editing'); const i = r.querySelector('input.val'); if (i) i.value = i.defaultValue; });
  const dock = panel?.querySelector('#doc-dock'); if (dock) dock.hidden = true;
  const host = panel?.querySelector('#doc-staged'); if (host) host.innerHTML = '';
}
// The staged change shows on the canvas before it is written; this takes it away again.
function clearPreview() { pv?.clear(); }
