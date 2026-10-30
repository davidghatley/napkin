// Words for what changed between two versions of a component's files (the film strip's labels), from the actual diff.
//   describe([{ path, a, b }], { related }) -> { what, more, where, key, hidden? }   a / b: the file's text before and after (null when absent)
// CSS: declarations compared by rule and property ("padding 12px -> 16px"). HTML/JSX: the changed lines are cut into tags and
// text and compared piece by piece, so a whole element added reads "Added <span class="ss-pill">QA done</span>", a text change
// "Shipped -> Shipped today", an attribute "class a -> b", an inline style the declaration.
// `key` names the thing that changed, so consecutive edits of one thing can be one run. `related(touch)` says whether a changed
// stylesheet rule or variable ({ sel, prop }) matters to the component; the ones that do not are left out, and a change made of
// nothing else is `hidden`.
import { parseCss } from './css.js';
import { fromL } from './source.js';

const ARROW = ' → ';
const DOT = ' · ';
const clip = (t, n = 26) => { t = String(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
// The words that changed between two texts: the common start and end are cut, and one neighbouring word stays for context
// when one side would be empty ("Shipped" -> "Shipped today" reads better than "" -> "today").
function wordDiff(a, b) {
  const x = a.split(' ').filter(Boolean), y = b.split(' ').filter(Boolean);
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  let xm = x.slice(i, x.length - j), ym = y.slice(i, y.length - j);
  if (!xm.length || !ym.length) { const w = i > 0 ? x[i - 1] : j > 0 ? x[x.length - j] : null; if (w) { if (i > 0) { xm = [w, ...xm]; ym = [w, ...ym]; } else { xm = [...xm, w]; ym = [...ym, w]; } } }
  return [xm.join(' '), ym.join(' ')];
}

const unq = (v) => String(v).trim().replace(/^["']|["']$/g, '');
function cssMap(s) {
  const m = new Map(), seen = new Map();
  for (const r of s == null ? [] : parseCss(s).rules) {
    const decls = new Map(); for (const d of r.decls) decls.set(d.prop, fromL(d.value) + (d.important ? ' !important' : ''));
    let rk, entry;
    if (r.kind === 'style') {
      const sel = fromL(r.selector).replace(/\s+/g, ' ').trim(), ctx = r.context.map((c) => `@${c.name} ${fromL(c.prelude)}`).join(' ');
      rk = `${ctx}|${sel}`; entry = { sel, decls };
    } else if (r.kind === 'keyframe') {
      const name = fromL(r.context.find((c) => /keyframes$/.test(c.name))?.prelude ?? '').trim(), sel = fromL(r.selector).trim();
      rk = `@keyframes ${name}|${sel}`; entry = { sel, decls, at: 'keyframes', name };
    } else if (r.kind === 'font-face') {
      const name = unq(decls.get('font-family') ?? '');
      rk = `@font-face|${name}`; entry = { sel: '@font-face', decls, at: 'font-face', name };
    } else if (r.kind === 'property') {
      const name = fromL(r.selector).replace(/^@property\s*/, '').trim();
      rk = `@property|${name}`; entry = { sel: ':root', decls, at: 'property', name };
    } else continue;
    const n = (seen.set(rk, (seen.get(rk) ?? -1) + 1), seen.get(rk));
    m.set(`${rk}#${n}`, entry);
  }
  return m;
}
// One item per thing that changed. A keyframes block, a font face or an @property is one thing, however many lines of it moved.
function cssItems(pathName, a, b) {
  const A = cssMap(a), B = cssMap(b), out = [], atSeen = new Set();
  const at = (e, verb) => {
    const k = `${e.at}:${e.name}`; if (atSeen.has(k)) return; atSeen.add(k);
    if (e.at === 'property') out.push({ text: `${verb} @property ${e.name}`, where: pathName, key: `prop:${e.name}`, touch: { sel: ':root', prop: e.name } });
    else out.push({ text: e.at === 'keyframes' ? `${verb} animation ${e.name}` : `${verb} font ${e.name}`, where: pathName, key: `${e.at}:${e.name}`, touch: { at: e.at, name: e.name } });
  };
  for (const [k, rb] of B) {
    const ra = A.get(k);
    if (rb.at) { if (!ra) at(rb, 'Added'); else if ([...rb.decls].some(([p, v]) => ra.decls.get(p) !== v) || [...ra.decls.keys()].some((p) => !rb.decls.has(p))) at(rb, 'Changed'); continue; }
    if (!ra) { out.push({ text: `Added ${clip(rb.sel, 30)}`, where: pathName, key: `css+${rb.sel}`, touch: { sel: rb.sel, prop: null } }); continue; }
    for (const [prop, v] of rb.decls) {
      const where = `${rb.sel}${DOT}${pathName}`, touch = { sel: rb.sel, prop, to: v };
      if (!ra.decls.has(prop)) out.push({ text: `${prop} ${clip(v)}`, where, key: `css:${rb.sel}|${prop}`, touch });
      else if (ra.decls.get(prop) !== v) out.push({ text: `${prop} ${clip(ra.decls.get(prop))}${ARROW}${clip(v)}`, where, key: `css:${rb.sel}|${prop}`, touch });
    }
    for (const prop of ra.decls.keys()) if (!rb.decls.has(prop)) out.push({ text: `Removed ${prop}`, where: `${rb.sel}${DOT}${pathName}`, key: `css:${rb.sel}|${prop}`, touch: { sel: rb.sel, prop, to: null } });
  }
  for (const [k, ra] of A) if (!B.has(k)) { if (ra.at) at(ra, 'Removed'); else out.push({ text: `Removed ${clip(ra.sel, 30)}`, where: pathName, key: `css-${ra.sel}`, touch: { sel: ra.sel, prop: null } }); }
  return out;
}
// The rules and variables a stylesheet edit touched: [{ sel, prop } | { at, name }] (what the film strip asks `related` about).
// Empty when the two sheets parse to the same rules (a comment, white space, the order of nothing that matters).
export const cssTouched = (a, b) => cssItems('', a, b).map((i) => i.touch);
export const touchKey = (t) => (t.at ? `@${t.at}:${t.name}` : `${t.sel}|${t.prop ?? ''}`);
export const touchWords = (t) => (t.at ? `${t.at === 'keyframes' ? 'animation' : 'font'} ${t.name}` : t.prop ? `${t.sel} ${t.prop}` : t.sel);

// ---------- markup ----------
const tokens = (line) => line.match(/<[^>]*>|[^<]+/g)?.map((t) => (t.startsWith('<') ? t : t.replace(/\s+/g, ' '))).filter((t) => t.trim()) ?? [];
const isTag = (t) => t.startsWith('<');
const nameOf = (t) => /^<\s*\/?\s*([A-Za-z][\w:-]*)/.exec(t ?? '')?.[1]?.toLowerCase() ?? null;
const isClose = (t) => /^<\s*\//.test(t);
const isVoidish = (t) => /\/>$/.test(t) || /^<\s*(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)\b/i.test(t) || /^<!/.test(t);
const attrsOf = (tag) => { const out = new Map(); for (const x of tag.replace(/^<\s*[\w:-]+/, '').matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out.set(x[1], x[2] ?? x[3] ?? x[4] ?? ''); return out; };
const styleOf = (v) => new Map(String(v).split(';').map((x) => { const i = x.indexOf(':'); return i < 0 ? null : [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }).filter(Boolean));
// True when the tokens are whole elements (every open tag closed inside them).
function balanced(ts) {
  const stack = [];
  for (const t of ts) { if (!isTag(t) || isVoidish(t)) continue; if (isClose(t)) { if (stack.pop() !== nameOf(t)) return false; } else stack.push(nameOf(t)); }
  return !stack.length && ts.some(isTag);
}
// Edit script between two token lists: [{ x: removed[], y: added[] }] hunks.
function hunks(a, b) {
  if (a.length * b.length > 250000) return [{ x: a, y: b }];
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    cur ||= { x: [], y: [] };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) cur.y.push(b[j++]); else cur.x.push(a[i++]);
  }
  flush();
  return out;
}
// An inserted or removed run can start anywhere among identical neighbours ("QA done</span><span>" for "<span>QA done</span>"):
// the rotation that is whole elements is the one a person added.
const wholeElements = (ts) => { for (let k = 0; k < ts.length; k++) { const r = [...ts.slice(k), ...ts.slice(0, k)]; if (isTag(r[0]) && balanced(r)) return r; } return null; };
function pairItems(r, d, pathName) {
  const items = [];
  for (const h of hunks(tokens(r), tokens(d))) {
    const xs = h.x, ys = h.y, tagX = xs.some(isTag), tagY = ys.some(isTag);
    if (!tagX && !tagY) {
      const [wa, wb] = wordDiff(xs.join(' ').trim(), ys.join(' ').trim());
      items.push({ text: `${clip(wa || '(empty)')}${ARROW}${clip(wb || '(empty)')}`, where: pathName, key: `text:${nameOf(tokens(d).find(isTag)) ?? 'text'}` });
    } else if (!xs.length && wholeElements(ys)) { const w = wholeElements(ys); items.push({ text: `Added ${clip(w.join(''), 64)}`, where: pathName, key: `add:${nameOf(w[0])}` }); }
    else if (!ys.length && wholeElements(xs)) { const w = wholeElements(xs); items.push({ text: `Removed ${clip(w.join(''), 64)}`, where: pathName, key: `del:${nameOf(w[0])}` }); }
    else if (xs.length === 1 && ys.length === 1 && isTag(xs[0]) && isTag(ys[0]) && nameOf(xs[0]) === nameOf(ys[0])) {
      const tag = nameOf(xs[0]), aa = attrsOf(xs[0]), ab = attrsOf(ys[0]), where = `<${tag}>${DOT}${pathName}`;
      for (const [k, v] of ab) {
        if (aa.get(k) === v) continue;
        if (k === 'style') {
          const sa = styleOf(aa.get('style') ?? ''), sb = styleOf(v);
          for (const [p, x] of sb) if (sa.get(p) !== x) items.push({ text: sa.has(p) ? `${p} ${clip(sa.get(p))}${ARROW}${clip(x)}` : `${p} ${clip(x)}`, where, key: `style:${tag}|${p}` });
          for (const p of sa.keys()) if (!sb.has(p)) items.push({ text: `Removed ${p}`, where, key: `style:${tag}|${p}` });
        } else items.push({ text: aa.has(k) ? `${k} ${clip(aa.get(k))}${ARROW}${clip(v)}` : `Added ${k} ${clip(v)}`, where, key: `attr:${tag}|${k}` });
      }
      for (const k of aa.keys()) if (!ab.has(k)) items.push({ text: `Removed ${k}`, where, key: `attr:${tag}|${k}` });
    } else if (!ys.length && xs.length) items.push({ text: `Removed ${clip(xs.join(''), 64)}`, where: pathName, key: `del:${nameOf(xs.find(isTag)) ?? 'text'}` });
    else if (!xs.length && ys.length) items.push({ text: `Added ${clip(ys.join(''), 64)}`, where: pathName, key: `add:${nameOf(ys.find(isTag)) ?? 'text'}` });
    else items.push({ text: `Changed ${clip(ys.join(''), 56)}`, where: pathName, key: `edit:${nameOf(ys.find(isTag)) ?? 'text'}` });
  }
  return items;
}
function htmlItems(pathName, a, b) {
  const la = (a ?? '').split('\n').map((l) => l.trimEnd()), lb = (b ?? '').split('\n').map((l) => l.trimEnd());
  const count = (ls) => { const m = new Map(); for (const l of ls) if (l.trim()) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  const ca = count(la), cb = count(lb);
  // lines that are in only one side, in file order (a line present twice and now once leaves one)
  const only = (ls, other) => { const used = new Map(), out = []; for (const l of ls) { if (!l.trim()) continue; const seen = (used.set(l, (used.get(l) ?? 0) + 1), used.get(l)); if (seen > (other.get(l) ?? 0)) out.push(l); } return out; };
  const rem = only(la, cb), add = only(lb, ca), items = [];
  const n = Math.min(rem.length, add.length);
  for (let i = 0; i < n; i++) items.push(...pairItems(rem[i], add[i], pathName));
  for (const d of add.slice(n)) items.push(...pairItems('', d, pathName));
  for (const r of rem.slice(n)) items.push(...pairItems(r, '', pathName));
  if (!items.length && a !== b) items.push({ text: 'Moved things around', where: pathName, key: null });
  return items;
}

export function describe(changes, { related = () => true } = {}) {
  let items = [];
  for (const c of changes) {
    if (c.a == null && c.b != null) { items.push({ text: `Added ${c.path}`, where: c.path, key: null }); continue; }
    if (c.b == null) { items.push({ text: `Removed ${c.path}`, where: c.path, key: null }); continue; }
    items.push(...(/\.css$/i.test(c.path) ? cssItems(c.path, c.a, c.b) : htmlItems(c.path, c.a, c.b)));
  }
  if (!items.length) return changes.every((c) => /\.css$/i.test(c.path)) ? { what: 'Shared styles changed', more: 0, where: '', key: null, hidden: true } : { what: 'No visible change', more: 0, where: '', key: null }; // the same rules in a sheet: a comment, white space
  const kept = items.filter((i) => !i.touch || related(i.touch));
  if (!kept.length) return { what: 'Shared styles changed', more: 0, where: '', key: null, hidden: true };
  items = kept;
  const keys = [...new Set(items.map((i) => i.key))];
  return { what: items[0].text, more: items.length - 1, where: [...new Set(items.slice(0, 2).map((i) => i.where))].join(DOT), key: keys.every(Boolean) ? keys.sort().join('+') : null };
}
