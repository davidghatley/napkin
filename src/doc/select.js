// A CSS selector matcher over the parsed file (decision 0015): which elements of an HTML component a selector reaches,
// with no browser. It is what lets GET /api/component/<id>/rules?node= answer over plain HTTP; the canvas uses the
// browser's own element.matches() with the same cascade code, and a test holds the two to the same answers.
//   buildDom(tree) -> { root, byId, el(id) }       from the `tree` of GET /api/component/<id>
//   matches(el, selector) -> bool                  one selector (no comma list); a pseudo-element is matched by its element
// Not matched, on purpose: dynamic states (:hover, :focus, :active, :visited, :target ...): the file at rest.

export function buildDom(tree) {
  const byId = new Map();
  const make = (n, parent, index) => {
    const attrs = {}; for (const [k, v] of Object.entries(n.attrs || {})) attrs[k.toLowerCase()] = v;
    const el = { id: String(n.node), tag: String(n.tag).toLowerCase(), attrs, parent, index, children: [], hasText: !!(n.text || n.runs?.length), src: n };
    byId.set(el.id, el);
    el.children = (n.children || []).map((c, i) => make(c, el, i));
    return el;
  };
  let roots = tree.map((n, i) => make(n, null, i));
  let root = roots.find((r) => r.tag === 'html');
  if (!root) { // a fragment: the browser still has <html><body> around it
    root = { id: 'html', tag: 'html', attrs: {}, parent: null, index: 0, children: [], hasText: false, synthetic: true };
    const body = { id: 'body', tag: 'body', attrs: {}, parent: root, index: 0, children: roots, hasText: false, synthetic: true };
    root.children = [body]; for (const r of roots) r.parent = body; roots.forEach((r, i) => { r.index = i; });
    byId.set('html', root); byId.set('body', body);
  }
  return { root, byId, el: (id) => byId.get(String(id)) || null };
}

// ---------- parsing ----------
const IDENT = /^(?:[\w -￿-]|\\[\s\S])+/;
const unescapeIdent = (s) => s.replace(/\\([0-9a-f]{1,6})\s?|\\([\s\S])/gi, (_, h, c) => (h ? String.fromCodePoint(parseInt(h, 16)) : c));
const PSEUDO_ELEMENT = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b(\([^)]*\))?/gi;
const cache = new Map();

function parseList(text) { // 'a, b > c' -> [complex]
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of text) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean).map(parseComplex);
}
function parseComplex(text) {
  const parts = []; let i = 0, comb = null, cur = null;
  const s = text.trim();
  const push = () => { if (cur?.length) parts.push({ comb, simples: cur }); cur = null; };
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') {
      let j = i, c = null; while (j < s.length && (/\s/.test(s[j]) || '>+~'.includes(s[j]))) { if ('>+~'.includes(s[j])) c = s[j]; j++; }
      push(); comb = c || ' '; i = j; continue;
    }
    cur ||= [];
    let m;
    if (ch === '*') { cur.push({ t: 'univ' }); i++; }
    else if (ch === '&') { cur.push({ t: 'univ' }); i++; }
    else if (ch === '#') { m = IDENT.exec(s.slice(i + 1)); cur.push({ t: 'id', v: unescapeIdent(m?.[0] ?? '') }); i += 1 + (m?.[0].length ?? 0); }
    else if (ch === '.') { m = IDENT.exec(s.slice(i + 1)); cur.push({ t: 'class', v: unescapeIdent(m?.[0] ?? '') }); i += 1 + (m?.[0].length ?? 0); }
    else if (ch === '[') {
      const end = closing(s, i, '[', ']'); const body = s.slice(i + 1, end);
      const a = /^\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*("([^"]*)"|'([^']*)'|[^\s\]]+)\s*([is])?)?\s*$/i.exec(body);
      cur.push(a ? { t: 'attr', name: a[1].replace(/^\*?\|/, '').toLowerCase(), op: a[2] || null, v: a[4] ?? a[5] ?? a[3] ?? '', ci: /i/i.test(a[6] || '') } : { t: 'never' });
      i = end + 1;
    } else if (ch === ':') {
      const dbl = s[i + 1] === ':'; const from = i + (dbl ? 2 : 1);
      m = IDENT.exec(s.slice(from)); const name = (m?.[0] ?? '').toLowerCase(); let arg = null; i = from + (m?.[0].length ?? 0);
      if (s[i] === '(') { const end = closing(s, i, '(', ')'); arg = s.slice(i + 1, end); i = end + 1; }
      cur.push(pseudo(name, arg));
    } else { m = IDENT.exec(s.slice(i)); if (!m) { cur.push({ t: 'never' }); i++; } else { cur.push({ t: 'type', name: unescapeIdent(m[0]).toLowerCase() }); i += m[0].length; } }
  }
  push();
  return parts;
}
function closing(s, at, open, close) {
  let depth = 0, q = null;
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c; else if (c === open) depth++; else if (c === close && --depth === 0) return i;
  }
  return s.length;
}
const DYNAMIC = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'target', 'target-within', 'current', 'past', 'future', 'playing', 'paused', 'fullscreen', 'modal', 'popover-open', 'user-invalid', 'user-valid', 'in-range', 'out-of-range', 'indeterminate', 'placeholder-shown', 'autofill', 'read-write', 'default', 'valid', 'invalid']);
function pseudo(name, arg) {
  if (name === 'not' || name === 'is' || name === 'where' || name === 'matches' || name === '-webkit-any' || name === '-moz-any') return { t: 'logic', name: name.replace(/^-\w+-/, '') === 'any' ? 'is' : name, list: parseList(arg ?? '') };
  if (name === 'has') return { t: 'has', list: topComma(arg ?? '').map((x) => x.trim()).filter(Boolean).map((x) => { const lead = /^[>+~]/.test(x) ? x[0] : ' '; return { lead, parts: parseComplex(x.replace(/^[>+~]\s*/, '')) }; }) };
  if (/^nth-(last-)?(child|of-type)$/.test(name)) {
    const of = /^(.*?)\s+of\s+(.*)$/i.exec(arg ?? ''); const ab = nth(of ? of[1] : arg ?? '');
    return { t: 'nth', last: name.includes('last'), type: name.endsWith('of-type'), ab, of: of ? parseList(of[2]) : null };
  }
  if (DYNAMIC.has(name)) return { t: 'never' };
  return { t: 'pseudo', name };
}
const topComma = (t) => { const out = []; let d = 0, cur = ''; for (const c of t) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
function nth(t) {
  const x = t.trim().toLowerCase().replace(/\s+/g, '');
  if (x === 'odd') return [2, 1]; if (x === 'even') return [2, 0];
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(x);
  if (m) return [m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0];
  return /^[+-]?\d+$/.test(x) ? [0, parseInt(x, 10)] : [0, NaN];
}

// ---------- matching ----------
const siblings = (el) => (el.parent ? el.parent.children : [el]);
const attr = (el, name) => (name in el.attrs ? el.attrs[name] : undefined);
function simple(el, s, scope) {
  switch (s.t) {
    case 'univ': return true;
    case 'never': return false;
    case 'type': return el.tag === s.name;
    case 'id': return attr(el, 'id') === s.v;
    case 'class': return (attr(el, 'class') || '').split(/\s+/).includes(s.v);
    case 'attr': {
      const v = attr(el, s.name); if (v === undefined) return false;
      if (!s.op) return true;
      const a = s.ci ? v.toLowerCase() : v, b = s.ci ? s.v.toLowerCase() : s.v;
      switch (s.op) {
        case '=': return a === b; case '~=': return b !== '' && a.split(/\s+/).includes(b); case '|=': return a === b || a.startsWith(b + '-');
        case '^=': return b !== '' && a.startsWith(b); case '$=': return b !== '' && a.endsWith(b); case '*=': return b !== '' && a.includes(b);
        default: return false;
      }
    }
    case 'logic': { const hit = s.list.some((c) => complex(el, c, scope)); return s.name === 'not' ? !hit : hit; }
    case 'has': return s.list.some((r) => hasRel(el, r));
    case 'nth': {
      let sib = siblings(el); if (s.type) sib = sib.filter((x) => x.tag === el.tag); if (s.of) { if (!s.of.some((c) => complex(el, c, scope))) return false; sib = sib.filter((x) => s.of.some((c) => complex(x, c, scope))); }
      const pos = (s.last ? sib.length - sib.indexOf(el) : sib.indexOf(el) + 1); const [a, b] = s.ab;
      if (Number.isNaN(b)) return false;
      return a === 0 ? pos === b : (pos - b) / a >= 0 && Number.isInteger((pos - b) / a);
    }
    case 'pseudo': return pseudoClass(el, s.name, scope);
    default: return false;
  }
}
function pseudoClass(el, name, scope) {
  const tags = (...t) => t.includes(el.tag);
  switch (name) {
    case 'root': return !el.parent;
    case 'scope': return scope ? el === scope : !el.parent;
    case 'empty': return !el.children.length && !el.hasText;
    case 'first-child': return siblings(el)[0] === el;
    case 'last-child': return siblings(el).at(-1) === el;
    case 'only-child': return siblings(el).length === 1;
    case 'first-of-type': return siblings(el).find((x) => x.tag === el.tag) === el;
    case 'last-of-type': return siblings(el).findLast((x) => x.tag === el.tag) === el;
    case 'only-of-type': return siblings(el).filter((x) => x.tag === el.tag).length === 1;
    case 'link': case 'any-link': return tags('a', 'area') && attr(el, 'href') !== undefined;
    case 'checked': return (tags('input') && attr(el, 'checked') !== undefined) || (tags('option') && attr(el, 'selected') !== undefined);
    case 'disabled': return tags('button', 'input', 'select', 'textarea', 'fieldset', 'optgroup', 'option') && attr(el, 'disabled') !== undefined;
    case 'enabled': return tags('button', 'input', 'select', 'textarea', 'fieldset', 'optgroup', 'option') && attr(el, 'disabled') === undefined;
    case 'required': return tags('input', 'select', 'textarea') && attr(el, 'required') !== undefined;
    case 'optional': return tags('input', 'select', 'textarea') && attr(el, 'required') === undefined;
    case 'defined': return true;
    default: return false;
  }
}
const compound = (el, simples, scope) => simples.every((s) => simple(el, s, scope));
function chain(el, parts, i, scope) {
  if (!compound(el, parts[i].simples, scope)) return false;
  if (i === 0) return true;
  switch (parts[i].comb) {
    case '>': return !!el.parent && chain(el.parent, parts, i - 1, scope);
    case '+': { const k = siblings(el).indexOf(el); return k > 0 && chain(siblings(el)[k - 1], parts, i - 1, scope); }
    case '~': { const sib = siblings(el); for (let k = sib.indexOf(el) - 1; k >= 0; k--) if (chain(sib[k], parts, i - 1, scope)) return true; return false; }
    default: for (let a = el.parent; a; a = a.parent) if (chain(a, parts, i - 1, scope)) return true; return false;
  }
}
const complex = (el, parts, scope) => !!parts.length && chain(el, parts, parts.length - 1, scope);
function hasRel(el, rel) {
  const parts = [{ comb: null, simples: [{ t: 'pseudo', name: 'scope' }] }, { comb: rel.lead, simples: rel.parts[0]?.simples || [] }, ...rel.parts.slice(1)];
  const walk = (e, f) => { for (const c of e.children) { if (f(c)) return true; if (walk(c, f)) return true; } return false; };
  const test = (c) => chain(c, parts, parts.length - 1, el);
  if (rel.lead === '>' || rel.lead === ' ') return walk(el, test);
  const sib = siblings(el), k = sib.indexOf(el);
  return sib.slice(k + 1).some((c) => test(c) || walk(c, test));
}

export function matches(el, selector) {
  let list = cache.get(selector);
  if (!list) { list = parseList(String(selector).replace(PSEUDO_ELEMENT, '').trim() || '*'); cache.set(selector, list); }
  return list.some((c) => complex(el, c, null));
}
