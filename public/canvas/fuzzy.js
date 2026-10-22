// Fuzzy matching for quick open (CAN-03). Pure, so Node can time it on 200 components.
//   match(query, text) -> null | { score, at: [index...] }     (case-insensitive subsequence match)
//   search(items, query, limit) -> [{ item, score, at }]        items: { label, hint?, kind, ... }
const SEP = /[\s›>\-_./:]/;

export function match(q, t) {
  if (!q) return { score: 0, at: [] };
  const lq = q.toLowerCase(), lt = t.toLowerCase();
  const sub = lt.indexOf(lq);
  if (sub >= 0) { // a straight substring beats any scattered match
    const at = Array.from({ length: lq.length }, (_, i) => sub + i);
    const wordStart = sub === 0 || SEP.test(t[sub - 1]) || (t[sub - 1] === t[sub - 1].toLowerCase() && t[sub] !== t[sub].toLowerCase());
    return { score: 60 + (sub === 0 ? 30 : 0) + (wordStart ? 15 : 0) + (lq.length === lt.length ? 40 : 0) - sub * 0.5 - lt.length * 0.05, at };
  }
  const at = [];
  let ti = 0, score = 0, prev = -2;
  for (let qi = 0; qi < lq.length; qi++) {
    // prefer a word start over the first hit when one is close
    let idx = lt.indexOf(lq[qi], ti);
    if (idx < 0) return null;
    if (idx !== prev + 1) {
      for (let j = idx; j < Math.min(lt.length, idx + 12); j++) if (lt[j] === lq[qi] && (j === 0 || SEP.test(t[j - 1]) || (t[j - 1] === t[j - 1].toLowerCase() && t[j] !== t[j].toLowerCase()))) { idx = j; break; }
    }
    score += 2;
    if (idx === prev + 1) score += 8;
    if (idx === 0 || SEP.test(t[idx - 1])) score += 6;
    else if (t[idx - 1] === t[idx - 1].toLowerCase() && t[idx] !== t[idx].toLowerCase()) score += 5;
    at.push(idx); prev = idx; ti = idx + 1;
  }
  return { score: score - at[0] * 0.3 - lt.length * 0.05, at };
}

const KIND_RANK = { action: 0, property: 0.5, component: 1, node: 2 };
export function search(items, query, limit = 30) {
  const out = [];
  const q = query.trim();
  for (const item of items) {
    const m = match(q, item.label);
    if (m) out.push({ item, score: m.score + (item.boost || 0), at: m.at });
    else if (item.hint && q) { const h = match(q, `${item.label} ${item.hint}`); if (h) out.push({ item, score: h.score - 12, at: [] }); }
  }
  out.sort((a, b) => b.score - a.score || KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] || a.item.label.localeCompare(b.item.label));
  return out.slice(0, limit);
}
