// Words for what changed between two versions of a component's files (the film strip's labels), from the actual diff.
//   describe([{ path, a, b }]) -> { what, where, key }       a / b: the file's text before and after (null when absent)
// CSS: declarations compared by rule and property ("padding 12px -> 16px"). HTML/JSX: the changed lines, paired in order:
// a text change reads "Shipped -> Shipped today", an attribute "class a -> b", an inline style the declaration.
// `key` names the thing that changed (rule + property, attribute, element), so consecutive edits of one thing can be one run.
import { parseCss } from './css.js';
import { fromL } from './source.js';

const ARROW = ' → ';
const clip = (t, n = 26) => { t = String(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
// The words that changed between two texts: the common start and end are cut, and one neighbouring word stays for context
// when one side would be empty ("Shipped" -> "Shipped today" reads better than "" -> "today").
function wordDiff(a, b) {
  const x = a.split(' ').filter(Boolean), y = b.split(' ').filter(Boolean);
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  let xm = x.slice(i, x.length - j), ym = y.slice(i, y.length - j);
  if (!xm.length || !ym.length) { const ctxWord = i > 0 ? x[i - 1] : j > 0 ? x[x.length - j] : null; if (ctxWord) { if (i > 0) { xm = [ctxWord, ...xm]; ym = [ctxWord, ...ym]; } else { xm = [...xm, ctxWord]; ym = [...ym, ctxWord]; } } }
  return [xm.join(' '), ym.join(' ')];
}
const textOf = (line) => line.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const tagOf = (line) => /^\s*<\s*([A-Za-z][\w:-]*)/.exec(line)?.[1]?.toLowerCase() ?? null;

function cssItems(pathName, a, b) {
  const mapOf = (s) => {
    const m = new Map(), seen = new Map();
    for (const r of s == null ? [] : parseCss(s).rules) {
      if (r.kind !== 'style') continue;
      const sel = fromL(r.selector).replace(/\s+/g, ' ').trim(), ctx = r.context.map((c) => `@${c.name} ${fromL(c.prelude)}`).join(' ');
      const rk = `${ctx}|${sel}`, n = (seen.set(rk, (seen.get(rk) ?? -1) + 1), seen.get(rk));
      const decls = new Map(); for (const d of r.decls) decls.set(d.prop, fromL(d.value) + (d.important ? ' !important' : ''));
      m.set(`${rk}#${n}`, { sel, decls });
    }
    return m;
  };
  const A = mapOf(a), B = mapOf(b), out = [];
  for (const [k, rb] of B) {
    const ra = A.get(k);
    if (!ra) { out.push({ text: `Added ${clip(rb.sel, 30)}`, where: pathName, key: `css+${rb.sel}` }); continue; }
    for (const [prop, v] of rb.decls) {
      if (!ra.decls.has(prop)) out.push({ text: `${prop} ${clip(v)}`, where: `${rb.sel} · ${pathName}`, key: `css:${rb.sel}|${prop}`, added: true });
      else if (ra.decls.get(prop) !== v) out.push({ text: `${prop} ${clip(ra.decls.get(prop))}${ARROW}${clip(v)}`, where: `${rb.sel} · ${pathName}`, key: `css:${rb.sel}|${prop}` });
    }
    for (const prop of ra.decls.keys()) if (!rb.decls.has(prop)) out.push({ text: `Removed ${prop}`, where: `${rb.sel} · ${pathName}`, key: `css:${rb.sel}|${prop}` });
  }
  for (const [k, ra] of A) if (!B.has(k)) out.push({ text: `Removed ${clip(ra.sel, 30)}`, where: pathName, key: `css-${ra.sel}` });
  return out;
}

const attrsOf = (line) => { const m = /^\s*<\s*[\w:-]+([^>]*)>?/.exec(line); const out = new Map(); if (m) for (const x of m[1].matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out.set(x[1], x[2] ?? x[3] ?? x[4] ?? ''); return out; };
const styleOf = (v) => new Map(String(v).split(';').map((x) => { const i = x.indexOf(':'); return i < 0 ? null : [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }).filter(Boolean));

function htmlItems(pathName, a, b) {
  const la = (a ?? '').split('\n').map((l) => l.trimEnd()), lb = (b ?? '').split('\n').map((l) => l.trimEnd());
  const count = (ls) => { const m = new Map(); for (const l of ls) if (l.trim()) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  const ca = count(la), cb = count(lb);
  // lines that are in only one side, in file order (a line present twice and now once leaves one)
  const only = (ls, mine, other) => { const used = new Map(), out = []; for (const l of ls) { if (!l.trim()) continue; const seen = (used.set(l, (used.get(l) ?? 0) + 1), used.get(l)); if (seen > (other.get(l) ?? 0)) out.push(l); } return out; };
  const rem = only(la, ca, cb), add = only(lb, cb, ca), items = [];
  const n = Math.min(rem.length, add.length);
  for (let i = 0; i < n; i++) {
    const r = rem[i], d = add[i], ta = textOf(r), tb = textOf(d), tag = tagOf(d) ?? tagOf(r) ?? 'text';
    if (ta !== tb && (ta || tb)) { const [wa, wb] = wordDiff(ta, tb); items.push({ text: `${clip(wa || '(empty)')}${ARROW}${clip(wb || '(empty)')}`, where: pathName, key: `text:${tag}` }); continue; }
    const aa = attrsOf(r), ab = attrsOf(d);
    let found = false;
    for (const [k, v] of ab) {
      if (aa.get(k) === v) continue;
      found = true;
      if (k === 'style') {
        const sa = styleOf(aa.get('style') ?? ''), sb = styleOf(v);
        for (const [p, x] of sb) if (sa.get(p) !== x) items.push({ text: sa.has(p) ? `${p} ${clip(sa.get(p))}${ARROW}${clip(x)}` : `${p} ${clip(x)}`, where: `<${tag}> · ${pathName}`, key: `style:${tag}|${p}` });
        for (const p of sa.keys()) if (!sb.has(p)) items.push({ text: `Removed ${p}`, where: `<${tag}> · ${pathName}`, key: `style:${tag}|${p}` });
      } else items.push({ text: aa.has(k) ? `${k} ${clip(aa.get(k))}${ARROW}${clip(v)}` : `Added ${k} ${clip(v)}`, where: `<${tag}> · ${pathName}`, key: `attr:${tag}|${k}` });
    }
    for (const k of aa.keys()) if (!ab.has(k)) { found = true; items.push({ text: `Removed ${k}`, where: `<${tag}> · ${pathName}`, key: `attr:${tag}|${k}` }); }
    if (!found) items.push({ text: `Edited <${tag}>`, where: pathName, key: `edit:${tag}` });
  }
  for (const d of add.slice(n)) { const t = tagOf(d); items.push({ text: t ? `Added <${t}>` : `Added "${clip(textOf(d))}"`, where: pathName, key: `add:${t ?? 'text'}` }); }
  for (const r of rem.slice(n)) { const t = tagOf(r); items.push({ text: t ? `Removed <${t}>` : `Removed "${clip(textOf(r))}"`, where: pathName, key: `del:${t ?? 'text'}` }); }
  if (!items.length && a !== b) items.push({ text: 'Moved things around', where: pathName, key: null });
  return items;
}

export function describe(changes) {
  const items = [];
  for (const c of changes) {
    if (c.a == null && c.b != null) { items.push({ text: `Added ${c.path}`, where: c.path, key: null }); continue; }
    if (c.b == null) { items.push({ text: `Removed ${c.path}`, where: c.path, key: null }); continue; }
    items.push(...(/\.css$/i.test(c.path) ? cssItems(c.path, c.a, c.b) : htmlItems(c.path, c.a, c.b)));
  }
  if (!items.length) return { what: 'No visible change', where: '', key: null };
  const shown = items.slice(0, 2).map((i) => i.text).join(', ') + (items.length > 2 ? ` and ${items.length - 2} more` : '');
  const keys = [...new Set(items.map((i) => i.key))];
  return { what: shown, where: [...new Set(items.slice(0, 2).map((i) => i.where))].join(' · '), key: keys.every(Boolean) ? keys.sort().join('+') : null };
}
