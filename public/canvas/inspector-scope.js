// Edit at the right scope (dream moment 2): one typed value, three places it can be written, and the one-line change
// each would make. Pure (no DOM): the panel hands in what it knows and gets back the options, each with its edit
// (a contract op for POST /api/edit) and the diff it will show before anything is written.
import { parseInline } from './inspector-cascade.js';
import { kindOfProp, tokens, firstVar, classTarget, declLine, bindExact, parseLength } from './inspector-model.js';

const normSel = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim();
const normMedia = (t) => String(t ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*:\s*/g, ': ').trim().toLowerCase();

// A bare number in a space, radius or size property is pixels (a designer types 16, not 16px).
export function normalizeTyped(prop, text) {
  const kind = kindOfProp(prop);
  if (!['space', 'radius', 'size'].includes(kind) || /^line-height$/i.test(prop)) return String(text).trim();
  return tokens(String(text).trim()).map((t) => (/^-?[\d.]+$/.test(t) && parseFloat(t) !== 0 ? `${t}px` : t)).join(' ');
}
// Which variable of the old value does the typed value replace? { name, value } when exactly one var() piece became a
// raw piece (and nothing else changed shape), or when the old value was one var() and the typed one is one raw piece.
export function varChange(oldValue, typed) {
  const a = tokens(oldValue), b = tokens(typed);
  if (a.length === b.length) {
    const hits = a.map((t, i) => (t !== b[i] && /^var\(/.test(t) && !/var\(/.test(b[i]) ? { name: firstVar(t), value: b[i] } : null)).filter(Boolean);
    if (hits.length === 1 && a.every((t, i) => t === b[i] || /^var\(/.test(t))) return hits[0];
  }
  const v = firstVar(oldValue);
  return a.length === 1 && v && b.length === 1 && !/var\(/.test(typed) ? { name: v, value: typed.trim() } : null;
}

// "padding-left still wins from .card.big" (and why), the first thing that would keep a new value from showing
const loseText = (lost) => (lost.length ? `${lost[0].props.join(', ')} still ${lost[0].by.kind === 'inline' ? 'comes from the inline style' : `wins from ${lost[0].by.selector}`} (${lost[0].why})` : null);
const cmp3 = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
const styleAfter = (before, prop, value) => {
  const list = parseInline(before || '');
  const i = list.findIndex((d) => d.prop.toLowerCase() === prop.toLowerCase());
  const next = { prop, value, important: false };
  if (i >= 0) list[i] = { ...list[i], value }; else list.push(next);
  return list.map((d) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''}`).join('; ');
};

// in: { prop, typed, comp: { path }, node: { node, line, attrs }, classes, matched, winner, vars, data, uses }
//   typed:   what the person typed (already normalised); bound: the same with exact scale values as var()
export function scopeOptions({ prop, typed, bound, comp, node, classes, matched, winner: w0, vars, data, uses = {}, wouldLose = () => [], forceRule = null }) {
  const winner = w0?.source?.kind === 'none' ? null : w0; // a property nothing sets yet has no winner
  const value = bound ?? typed;
  const out = [];
  const index = (r) => data.rules.filter((x) => x.file === r.file && x.kind === 'style' && normSel(x.selector) === normSel(r.selector) && normMedia(x.media.at(-1)) === normMedia(r.media.at(-1))).indexOf(r);

  // E: this element (an inline style)
  const before = node.attrs?.style;
  const had = parseInline(before || '').find((d) => d.prop.toLowerCase() === prop.toLowerCase());
  const elLost = wouldLose(null, prop, false);
  out.push({
    id: 'element', key: 'E', title: 'Element', code: null, count: 1, countText: '1',
    sub: `inline style · ${comp.path}:${node.line}`,
    edit: { op: 'style', node: node.node, prop, value },
    preview: { selector: null, media: null },
    warn: loseText(elLost), losers: elLost,
    diff: { head: `${comp.path} · this element`, lines: [...(before !== undefined && had ? [{ kind: 'del', line: node.line, text: `style="${before}"` }] : []), { kind: 'add', line: node.line, text: `style="${styleAfter(before, prop, value)}"` }] },
  });

  // C: this class (or the rule the value lives in)
  const hit = classTarget(matched, prop, classes);
  const wRule = winner?.source?.kind === 'rule' ? data.rules[winner.source.order] : null;
  // a value the element inherits is edited in the rule of the ancestor it comes from; a rule can also be named (to fix a value that does not show)
  const rule = (forceRule !== null && data.rules[forceRule]) || (winner?.state === 'inherited' ? wRule : hit?.rule ?? wRule);
  if (rule) {
    const single = /^\.[\w-]+$/.test(rule === hit?.rule ? hit.part : rule.selector.trim());
    const d = rule.decls.find((x) => x.prop.toLowerCase() === prop.toLowerCase());
    const u = uses.rule?.(rule) ?? null;
    const m = matched.find((x) => x.rule === rule);
    const lost = m ? wouldLose(m, prop, !!d?.important) : []; // what would still beat the new value, so the preview and the file agree
    out.push({
      id: 'class', key: 'C', title: single ? 'Class' : 'Rule', code: single ? rule.selector.trim() : rule.selector, count: u?.count ?? null, countText: u ? `${u.count} use${u.count === 1 ? '' : 's'}` : '',
      sub: `${rule.file.split('/').pop()}:${rule.line}${rule.media.length ? ` · in @media ${rule.media.at(-1)}` : ''}${u?.where ? ` · ${u.where}` : ''}`,
      warn: loseText(lost), losers: lost,
      preview: { selector: rule.selector, media: rule.media.at(-1) ?? null },
      edit: { op: 'rule', file: rule.file, selector: rule.selector, media: rule.media.at(-1) ?? '', index: index(rule), prop, value },
      diff: { head: `${rule.file} · ${rule.selector}${rule.media.length ? ` @media ${rule.media.at(-1)}` : ''}`, lines: [...(d ? [{ kind: 'del', line: d.line, text: declLine(prop, d.value, d.important) }] : []), { kind: 'add', line: d ? d.line : (rule.decls.at(-1)?.line ?? rule.line) + 1, text: declLine(prop, value, d?.important) }] },
    });
  } else out.push({ id: 'class', key: 'C', title: 'Class', code: null, disabled: true, why: classes.length ? 'No rule for this class yet in the folder’s stylesheets' : 'This element has no class', sub: classes.length ? 'add the property in a class by hand first' : 'add a class above to use this scope' });

  // V: this variable (what the value is made of)
  const change = varChange(winner?.value ?? '', typed);
  const info = change && vars[change.name];
  const src = info?.source;
  if (change && src?.kind === 'rule') {
    const defs = (data.vars?.[change.name] || []).filter((x) => !x.inline);
    const bucket = defs.filter((x) => x.file === src.file && normMedia(x.media.at(-1)) === normMedia(src.media.at(-1)));
    const k = Math.max(0, bucket.findIndex((x) => x.line === src.declLine && normSel(x.selector) === normSel(src.selector)));
    const u = uses.variable?.(change.name) ?? null;
    const old = defs.find((x) => x.file === src.file && x.line === src.declLine)?.value ?? info.raw;
    out.push({
      id: 'variable', key: 'V', title: 'Variable', code: change.name, count: u?.count ?? null, countText: u ? `${u.count} use${u.count === 1 ? '' : 's'}` : '',
      sub: `${src.file.split('/').pop()}:${src.declLine}${src.media.length ? ` · in @media ${src.media.at(-1)}` : ''}${src.selector && !/^:root$/.test(src.selector.trim()) ? ` · ${src.selector}` : ''}${u?.where ? ` · ${u.where}` : ''}`,
      preview: { selector: src.selector, media: src.media.at(-1) ?? null },
      edit: { op: 'var', file: src.file, name: change.name, value: change.value, media: src.media.at(-1) ?? '', index: k },
      diff: { head: `${src.file} · ${src.selector}${src.media.length ? ` @media ${src.media.at(-1)}` : ''}`, lines: [{ kind: 'del', line: src.declLine, text: declLine(change.name, old) }, { kind: 'add', line: src.declLine, text: declLine(change.name, change.value) }] },
    });
  } else out.push({
    id: 'variable', key: 'V', title: 'Variable', code: null, disabled: true,
    why: !/var\(/.test(winner?.value ?? '') ? 'This value is not a variable yet' : /var\(/.test(typed) && !tokens(winner?.value ?? '').some((t) => /^var\(/.test(t) && !tokens(typed).includes(t)) ? 'Nothing here replaces a variable with a plain value' : info && src?.kind === 'inline' ? 'The variable is set inline on an ancestor' : 'Change one variable’s part of the value to a plain value to edit it',
    sub: !/var\(/.test(winner?.value ?? '') ? 'bind one from the strips below, or type var(--name)' : 'edit one part of the value',
  });
  return out;
}

// The scope to start on: where the value lives now (an inline value stays inline; a rule value goes to its class or rule).
export function defaultScope(options, winner) {
  if (winner?.source?.kind === 'inline') return 'element';
  return options.find((o) => o.id === 'class' && !o.disabled) ? 'class' : 'element';
}
export { bindExact, parseLength };
