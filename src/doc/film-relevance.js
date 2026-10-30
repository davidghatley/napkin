// Does a change to a shared stylesheet matter to one component? (The film strip leaves out the frames that do not.)
//   relevanceOf(engine, comp) -> { related({ sel, prop }) }
// A rule matters when some element of the component matches the last compound of one of its selectors (tag, #id, .class);
// a custom property matters when the component uses it, directly (var() in its markup or in a rule that matches it) or
// through another property's value. Anything this cannot tell is taken as mattering: the strip never hides a change it
// is unsure about.
const varsIn = (text) => [...String(text).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

// "a .b > c.d:hover::before" -> "c.d" (the last compound, without states, pseudo-elements and attribute tests)
function lastCompound(part) {
  let depth = 0, cut = 0;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    else if (!depth && /[\s>+~]/.test(ch)) cut = i + 1;
  }
  return part.slice(cut).replace(/:{1,2}[\w-]+(\([^)]*\))?/g, '').replace(/\[[^\]]*\]/g, '').trim();
}
const splitTop = (sel) => { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };

export function relevanceOf(engine, comp) {
  const all = () => ({ related: () => true });
  let tree, rules;
  try { tree = engine.tree(comp.id); rules = engine.rulesOf(comp.id).rules; } catch { return all(); }
  if (tree.error) return all();
  const els = [];
  (function walk(list) { for (const n of list) { els.push({ tag: String(n.tag).toLowerCase(), id: n.attrs?.id ?? '', classes: new Set(String(n.attrs?.class ?? n.attrs?.className ?? '').split(/\s+/).filter(Boolean)) }); walk(n.children); } })(tree.tree || []);
  const matchesAny = (sel) => splitTop(sel).some((part) => {
    const c = lastCompound(part);
    if (!c || c === '*' || /^(html|body|:root)$/i.test(c)) return true;
    const m = /^([A-Za-z][\w-]*|\*)?((?:[.#][\w-]+)*)$/.exec(c);
    if (!m) return true;                                              // something this does not read: assume it matters
    const tag = m[1] && m[1] !== '*' ? m[1].toLowerCase() : null, tests = [...(m[2] || '').matchAll(/([.#])([\w-]+)/g)];
    return els.some((e) => (!tag || e.tag === tag) && tests.every(([, k, v]) => (k === '.' ? e.classes.has(v) : e.id === v)));
  });
  // custom properties the component uses, with the ones their values use in turn
  const used = new Set();
  let own = ''; try { own = engine.read(comp.path).s; } catch { /* gone */ }
  varsIn(own).forEach((v) => used.add(v));
  for (const r of rules) if (r.kind === 'style' && matchesAny(r.selector)) for (const d of r.decls) varsIn(d.value).forEach((v) => used.add(v));
  for (let grew = true; grew;) { grew = false; for (const r of rules) for (const d of r.decls) if (used.has(d.prop)) for (const v of varsIn(d.value)) if (!used.has(v)) { used.add(v); grew = true; } }
  // names of animations and font families the component's own text and the rules that match it mention
  let animText = own, fontText = own.toLowerCase();
  for (const r of rules) if (r.kind === 'style' && matchesAny(r.selector)) for (const d of r.decls) { if (/^animation/.test(d.prop)) animText += ' ' + d.value; if (/^font/.test(d.prop)) fontText += ' ' + d.value.toLowerCase(); }
  const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    related: (t) => {
      if (t.at === 'keyframes') return new RegExp(`(^|[^\\w-])${esc(t.name)}($|[^\\w-])`).test(animText);
      if (t.at === 'font-face') return fontText.includes(String(t.name).toLowerCase());
      return t.prop && t.prop.startsWith('--') ? used.has(t.prop) : matchesAny(t.sel);
    },
  };
}
