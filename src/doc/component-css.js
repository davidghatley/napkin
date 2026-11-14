// Create component from a selection: the CSS that makes the component look the same on its own (standards section 9,
// rule 5). The selection leaves its frame, so whatever reached it from outside has to be written into the component:
//   - rules whose selector names ancestors the component will not have (.shell > .offer, .shell .offer h2) are rewritten
//     against the component itself; the cascade is kept by writing every rule as :where(...) in its original cascade order
//     (specificity, then order), so the rewritten selectors cannot change which declaration wins
//   - type and colour it inherits from the elements around it, and the custom properties it reads (followed through
//     --brand: var(--blue) to --blue), media queries included, go on a wrapper with display: contents. That wrapper stands
//     where the frame's parent stood: inheritance and em units work as before, and the root keeps its own native defaults
//     (a <button>'s font, a <pre>'s monospace)
//   - :hover and :focus rules come along, though nothing hovers a file at rest
//   - url(...) in a rule from a stylesheet in another folder is rebased to the component's file
// Pure: rules come from rulesOf() (src/doc/folder.js); elements from buildDom() (src/doc/select.js).
//   componentCss({ el, html, rules, textOf, dir, scope }) -> { css: [{ text, context }], scope: className | null, keep: [path] }
//     el      the selected element (its subtree is the component); html its source (for the var()s its inline styles read)
//     rules   every rule of the frame's cascade, in order
//     textOf  rule -> its text as written ("sel { ... }")
//     dir     the folder the component is written to (posix, relative to the napkin folder)
//     scope   the wrapper's class name to use when one is needed
//     width   the root's width in the frame, sent when a grid or flex parent gave it (CSS px, in its own box-sizing)
import { posix } from 'node:path';
import { matches as selMatches } from './select.js';

const INHERITED = /^(color|font|font-(family|size|weight|style|stretch|variant|variant-[\w-]+|feature-settings|kerning|optical-sizing|synthesis)|line-height|letter-spacing|word-spacing|text-align|text-align-last|text-transform|text-indent|text-shadow|text-rendering|white-space|word-break|overflow-wrap|hyphens|tab-size|direction|writing-mode|visibility|cursor|quotes|list-style|list-style-(type|position|image)|caret-color|accent-color|color-scheme|-webkit-font-smoothing|-moz-osx-font-smoothing|-webkit-text-size-adjust)$/i;
// states a file at rest is never in; for deciding whether a rule reaches the selection they count as met
const DYNAMIC = /:(hover|focus-visible|focus-within|focus|active|visited|target)(?![\w(-])/gi;
const PSEUDO_ELEMENT = /(::?(before|after|first-line|first-letter)|::[\w-]+(\([^)]*\))?)$/i;

const test = (e, sel) => { try { return selMatches(e, sel); } catch { return false; } };
const reaches = (e, sel) => test(e, sel.replace(DYNAMIC, '') || '*');
const states = (t) => (String(t).match(DYNAMIC) || []).join('');
const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

// '.a > .b c' -> [{ comb: null, text: '.a' }, { comb: '>', text: '.b' }, { comb: ' ', text: 'c' }]
export function compounds(sel) {
  const out = []; let cur = '', depth = 0, q = null, comb = null, gap = false;
  const push = () => { if (cur) { out.push({ comb: out.length ? comb || ' ' : null, text: cur }); cur = ''; comb = null; } };
  for (const ch of sel.trim()) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (depth === 0 && (/\s/.test(ch) || '>+~'.includes(ch))) { if (cur) push(); if (ch !== ' ' && !/\s/.test(ch)) comb = ch; gap = true; continue; }
    if (gap && !cur && comb === null && out.length) comb = ' ';
    gap = false;
    if (ch === '"' || ch === "'") q = ch;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    cur += ch;
  }
  push();
  return out;
}
const join = (cs) => cs.map((c, i) => (i === 0 ? c.text : c.comb === ' ' ? ` ${c.text}` : ` ${c.comb} ${c.text}`)).join('');

// url(...) in CSS from `fromFile` written into a file in `toDir`: relative URLs point at the same file again
export function rebase(css, fromFile, toDir) {
  const from = posix.dirname(fromFile);
  if (from === toDir) return css;
  return css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (all, quote, u) => {
    if (!u || /^([a-z][\w+.-]*:|\/|#)/i.test(u)) return all;
    const to = posix.relative(toDir === '.' ? '' : toDir, posix.normalize(posix.join(from, u))) || '.';
    return `url(${quote}${to}${quote})`;
  });
}

// (4) the elements whose white space the browser keeps (a <pre>, or white-space: pre-wrap from any rule, inline style or
// ancestor), as paths of child indexes from the root ('' is the root, '1.0' its second child's first child). Their text
// is written exactly as it is. Erring towards keeping is safe: where white space does fold, the browser folds it anyway.
const KEEPS = (prop, value) => (/^white-space$/i.test(prop) && /pre|break-spaces/i.test(value)) || (/^white-space-collapse$/i.test(prop) && /preserve|break-spaces/i.test(value));
function keepSpace(el, ancestors, rules) {
  const own = (e) => ['pre', 'textarea', 'listing', 'xmp', 'plaintext'].includes(e.tag)
    || [...String(e.attrs.style || '').matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].some((m) => KEEPS(m[1], m[2]))
    || rules.some((r) => r.kind === 'style' && r.decls.some((d) => KEEPS(d.prop, d.value)) && r.parts.some((p) => test(e, p.selector)));
  const out = [];
  (function walk(e, path, inherited) { const k = inherited || own(e); if (k) out.push(path); e.children.forEach((c, i) => walk(c, path === '' ? String(i) : `${path}.${i}`, k)); })(el, '', ancestors.some(own));
  return out;
}

const varUses = (t) => [...String(t).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

export function componentCss({ el, html = '', rules, textOf, dir = '.', scope = 'component-context', width = null }) {
  const subtree = []; (function walk(e) { subtree.push(e); e.children.forEach(walk); })(el);
  const ancestors = []; for (let a = el.parent; a; a = a.parent) ancestors.unshift(a);
  const before = el.parent ? el.parent.children.slice(0, el.parent.children.indexOf(el)) : [];
  const body = (r) => { const t = textOf(r); return rebase(t.slice(t.indexOf('{')), r.file, dir); };

  // (1) the rules that reach the selection. Every selector is written inside the wrapper (.scope ...), so nothing leaks
  // into a page that uses the component, and each form is checked against the component as it will stand (its root the
  // wrapper's only child): a form is kept only if it reaches no element the original did not. What no form reaches (a
  // position the component cannot reproduce: :nth-child(2) of a frame, a sibling before it) is frozen onto the element by
  // its place inside the component. A state named on an element outside (.shell:hover .weather) goes on the wrapper,
  // which is hovered when the component is; a state on a sibling outside cannot be met, so that form is dropped.
  const twin = new Map(), model = [];
  const wrapper = { id: '#scope', tag: 'div', attrs: { class: scope }, parent: null, index: 0, children: [], hasText: false };
  wrapper.children = [(function copy(e, parent, index) {
    const c = { ...e, parent, index, children: [] }; twin.set(c, e); model.push(c);
    c.children = e.children.filter((k) => k.tag !== 'script' && k.tag !== 'style').map((k, i) => copy(k, c, i));
    return c;
  })(el, wrapper, 0)];
  const pathOf = new Map(); // frame element -> ' > :nth-child(i)' steps from the root
  for (const c of model) { const steps = []; for (let x = c; x.parent && x.parent !== wrapper; x = x.parent) steps.unshift(` > :nth-child(${x.index + 1})`); pathOf.set(twin.get(c), steps.join('')); }
  const W = `.${scope}`;
  const parts = [];
  for (const r of rules) {
    if (r.kind !== 'style') continue;
    for (const p of r.parts) {
      const S = new Set(subtree.filter((e) => reaches(e, p.selector)));
      if (!S.size) continue;
      const cs = compounds(p.selector), last = cs.at(-1).text, pe = PSEUDO_ELEMENT.exec(last)?.[0] || '';
      const cands = [`${W} ${p.selector}`];
      for (let k = 1; k < cs.length; k++) {
        const prefix = join(cs.slice(0, k)), rest = cs.slice(k), head = rest[0];
        const st = states(prefix), viaSibling = cs.slice(1, k + 1).some((c) => c.comb === '+' || c.comb === '~');
        if (st && viaSibling) continue; // a state of a sibling outside: never met in the component
        const tail = join([{ ...head, comb: null }, ...rest.slice(1)]);
        const atRoot = reaches(el, head.text.replace(PSEUDO_ELEMENT, '') || '*');
        if (head.comb === ' ' && ancestors.some((a) => reaches(a, prefix))) cands.push(`${W}${st} ${tail}`);
        else if (head.comb === '>' && atRoot && el.parent && reaches(el.parent, prefix)) cands.push(`${W}${st} > ${tail}`);
        else if (head.comb === '+' && atRoot && before.length && reaches(before.at(-1), prefix)) cands.push(`${W} > ${tail}`);
        else if (head.comb === '~' && atRoot && before.some((s) => reaches(s, prefix))) cands.push(`${W} > ${tail}`);
      }
      const forms = [], got = new Set();
      for (const f of new Set(cands)) {
        const hit = model.filter((c) => reaches(c, f)).map((c) => twin.get(c));
        if (!hit.length || hit.some((e) => !S.has(e))) continue;
        forms.push(f); hit.forEach((e) => got.add(e));
      }
      // freeze what no form reaches, unless the rule waits on a state of something other than the element itself
      const inner = states(cs.slice(0, -1).map((c) => c.text).join(' '));
      if (!inner) for (const e of S) if (!got.has(e)) forms.push(`${W} > *${pathOf.get(e)}${states(last.replace(PSEUDO_ELEMENT, ''))}${pe}`);
      if (forms.length) parts.push({ r, spec: p.specificity, forms });
    }
  }
  // :where() counts nothing, so which declaration wins is decided by order alone: the rules go in the order the cascade
  // ranked them (specificity, then order). A pseudo-element cannot sit inside :where(), so it follows it.
  const css = [];
  // the width a grid or flex parent gave the root, which the component will not have: written first, so a width of the
  // root's own rules still wins (the frame measured it in the root's own box-sizing)
  const w = Number(width);
  if (Number.isFinite(w) && w > 0) css.push({ text: `:where(${W} > *) { width: ${Math.round(w * 100) / 100}px; }`, context: [] });
  const sorted = parts.map((x, i) => ({ ...x, i })).sort((a, b) => cmp(a.spec, b.spec) || a.r.order - b.r.order || a.i - b.i);
  for (const x of sorted) {
    const sel = x.forms.map((f) => { const pe = PSEUDO_ELEMENT.exec(f)?.[0] || ''; return `:where(${f.slice(0, f.length - pe.length)})${pe}`; }).join(', ');
    css.push({ text: `${sel} ${body(x.r)}`, context: x.r.context });
  }

  // (2) animations its rules name
  const all = () => css.map((c) => c.text).join('\n');
  const frames = new Map();
  for (const r of rules) {
    const at = r.kind === 'keyframe' && r.context.find((c) => /^@(-\w+-)?keyframes\s/.test(c));
    if (at) (frames.get(at) || frames.set(at, []).get(at)).push(rebase(textOf(r), r.file, dir));
  }
  for (const [at, steps] of frames) {
    const nm = at.replace(/^@(-\w+-)?keyframes\s+/, '').trim();
    if (new RegExp(`(^|[\\s,:])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s,;])`).test(all())) css.push({ text: `${at} {\n${steps.map((x) => '  ' + x).join('\n')}\n}`, context: [] });
  }

  // (3) what the elements around it gave it: inherited type and colour, and custom properties, in the order the cascade
  // applied them (outermost ancestor first; in each, weakest rule first, inline style after rules, !important last).
  const given = [];
  for (const a of ancestors) {
    const mine = [];
    for (const r of rules) {
      if (r.kind !== 'style') continue;
      const hit = r.parts.filter((p) => test(a, p.selector));
      if (!hit.length) continue;
      const spec = hit.map((p) => p.specificity).reduce((m, s) => (cmp(s, m) > 0 ? s : m));
      for (const d of r.decls) mine.push({ prop: d.prop, value: rebase(d.value, r.file, dir), important: !!d.important, context: r.context, spec, order: r.order, inline: false });
    }
    for (const m of String(a.attrs.style || '').matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
      const v = m[2].trim(), imp = /!\s*important$/i.test(v);
      mine.push({ prop: m[1], value: v.replace(/\s*!\s*important$/i, ''), important: imp, context: [], spec: [9, 9, 9], order: Infinity, inline: true });
    }
    mine.sort((x, y) => (x.important - y.important) || (x.inline - y.inline) || cmp(x.spec, y.spec) || x.order - y.order);
    given.push(...mine);
  }
  const need = new Set([...varUses(all()), ...varUses(html), ...given.filter((d) => !d.prop.startsWith('--') && INHERITED.test(d.prop)).flatMap((d) => varUses(d.value))]);
  for (let grew = true; grew;) { grew = false; for (const d of given) if (d.prop.startsWith('--') && need.has(d.prop)) for (const u of varUses(d.value)) if (!need.has(u)) { need.add(u); grew = true; } }
  const kept = given.filter((d) => (d.prop.startsWith('--') ? need.has(d.prop) : INHERITED.test(d.prop)));
  if (!kept.length && !css.length) return { css, scope: null, keep: keepSpace(el, ancestors, rules) };
  const blocks = [{ context: [], decls: ['display: contents'] }];
  for (const d of kept) {
    const key = JSON.stringify(d.context), last = blocks.at(-1);
    if (JSON.stringify(last.context) === key) last.decls.push(`${d.prop}: ${d.value}`);
    else blocks.push({ context: d.context, decls: [`${d.prop}: ${d.value}`] });
  }
  css.unshift(...blocks.map((bk) => ({ text: `.${scope} {\n${bk.decls.map((x) => `  ${x};`).join('\n')}\n}`, context: bk.context })));
  return { css, scope, keep: keepSpace(el, ancestors, rules) };
}
