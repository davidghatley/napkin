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
//   componentCss({ el, html, rules, textOf, dir, scope }) -> { css: [{ text, context }], scope: className | null }
//     el      the selected element (its subtree is the component); html its source (for the var()s its inline styles read)
//     rules   every rule of the frame's cascade, in order
//     textOf  rule -> its text as written ("sel { ... }")
//     dir     the folder the component is written to (posix, relative to the napkin folder)
//     scope   the wrapper's class name to use when one is needed
import { posix } from 'node:path';
import { matches as selMatches } from './select.js';

const INHERITED = /^(color|font|font-(family|size|weight|style|stretch|variant|variant-[\w-]+|feature-settings|kerning|optical-sizing|synthesis)|line-height|letter-spacing|word-spacing|text-align|text-align-last|text-transform|text-indent|text-shadow|text-rendering|white-space|word-break|overflow-wrap|hyphens|tab-size|direction|writing-mode|visibility|cursor|quotes|list-style|list-style-(type|position|image)|caret-color|accent-color|color-scheme|-webkit-font-smoothing|-moz-osx-font-smoothing|-webkit-text-size-adjust)$/i;
// states a file at rest is never in; for deciding whether a rule reaches the selection they count as met
const DYNAMIC = /:(hover|focus-visible|focus-within|focus|active|visited|target)(?![\w(-])/gi;
const PSEUDO_ELEMENT = /(::?(before|after|first-line|first-letter)|::[\w-]+(\([^)]*\))?)$/i;

const test = (e, sel) => { try { return selMatches(e, sel); } catch { return false; } };
const reaches = (e, sel) => test(e, sel.replace(DYNAMIC, '') || '*');
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

const varUses = (t) => [...String(t).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

export function componentCss({ el, html = '', rules, textOf, dir = '.', scope = 'component-context' }) {
  const subtree = []; (function walk(e) { subtree.push(e); e.children.forEach(walk); })(el);
  const ancestors = []; for (let a = el.parent; a; a = a.parent) ancestors.unshift(a);
  const before = el.parent ? el.parent.children.slice(0, el.parent.children.indexOf(el)) : [];
  // the selection on its own: a copy whose root has no parent, to ask what a selector reaches inside it alone
  const alone = []; (function copy(e, parent) { const c = { ...e, parent, children: [] }; alone.push(c); c.children = e.children.map((k, i) => ({ ...copy(k, c), index: i })); return c; })(el, null);
  const pin = (text) => `.${scope} > ${text}`; // the component's root: the only element whose parent is the wrapper
  const body = (r) => { const t = textOf(r); return rebase(t.slice(t.indexOf('{')), r.file, dir); };

  // (1) the rules that reach the selection, each selector rewritten so it still does without the frame around it
  const parts = []; let rewritten = false;
  for (const r of rules) {
    if (r.kind !== 'style') continue;
    for (const p of r.parts) {
      if (!subtree.some((e) => reaches(e, p.selector))) continue;
      const cs = compounds(p.selector), forms = [];
      if (alone.some((e) => reaches(e, p.selector))) forms.push(p.selector);
      for (let k = 1; k < cs.length; k++) {
        const prefix = join(cs.slice(0, k)), rest = cs.slice(k), head = rest[0];
        const atRoot = reaches(el, head.text.replace(PSEUDO_ELEMENT, '') || '*');
        if (head.comb === ' ' && ancestors.some((a) => reaches(a, prefix))) forms.push(join([{ ...head, comb: null }, ...rest.slice(1)]));
        else if (head.comb === '>' && atRoot && el.parent && reaches(el.parent, prefix)) forms.push(pin(join([{ ...head, comb: null }, ...rest.slice(1)])));
        else if (head.comb === '+' && atRoot && before.length && reaches(before.at(-1), prefix)) forms.push(pin(join([{ ...head, comb: null }, ...rest.slice(1)])));
        else if (head.comb === '~' && atRoot && before.some((s) => reaches(s, prefix))) forms.push(pin(join([{ ...head, comb: null }, ...rest.slice(1)])));
      }
      if (!forms.length) forms.push(p.selector);
      const uniq = [...new Set(forms)];
      if (uniq.length !== 1 || uniq[0] !== p.selector) rewritten = true;
      parts.push({ r, spec: p.specificity, forms: uniq });
    }
  }
  const css = [];
  if (!rewritten) { // every selector still reaches what it did: the rules as written, in their order
    for (const r of rules) if (parts.some((x) => x.r === r)) css.push({ text: rebase(textOf(r), r.file, dir), context: r.context });
  } else {
    // :where() counts nothing, so which declaration wins is decided by order alone: put the rules in the order the cascade
    // ranked them (specificity, then order). A pseudo-element cannot sit inside :where(), so it follows it.
    const sorted = parts.map((x, i) => ({ ...x, i })).sort((a, b) => cmp(a.spec, b.spec) || a.r.order - b.r.order || a.i - b.i);
    for (const x of sorted) {
      const sel = x.forms.map((f) => { const pe = PSEUDO_ELEMENT.exec(f)?.[0] || ''; return `:where(${f.slice(0, f.length - pe.length) || '*'})${pe}`; }).join(', ');
      css.push({ text: `${sel} ${body(x.r)}`, context: x.r.context });
    }
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
  if (!kept.length && !rewritten) return { css, scope: null };
  const blocks = [{ context: [], decls: ['display: contents'] }];
  for (const d of kept) {
    const key = JSON.stringify(d.context), last = blocks.at(-1);
    if (JSON.stringify(last.context) === key) last.decls.push(`${d.prop}: ${d.value}`);
    else blocks.push({ context: d.context, decls: [`${d.prop}: ${d.value}`] });
  }
  css.unshift(...blocks.map((bk) => ({ text: `.${scope} {\n${bk.decls.map((x) => `  ${x};`).join('\n')}\n}`, context: bk.context })));
  return { css, scope };
}
