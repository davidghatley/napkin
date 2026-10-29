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
  // An acronym: every query letter starts a word of the text, in order ("sl" -> "Stroke Left", "ras" -> "Remove axis state").
  if (lq.length >= 2 && !/\s/.test(lq)) {
    const starts = []; for (let i = 0; i < t.length; i++) if (/[a-z0-9]/i.test(t[i]) && (i === 0 || SEP.test(t[i - 1]) || (t[i - 1] === t[i - 1].toLowerCase() && t[i] !== t[i].toLowerCase()))) starts.push(i);
    const hit = []; let from = 0;
    for (const ch of lq) { const k = starts.findIndex((s, n) => n >= from && lt[s] === ch); if (k < 0) { hit.length = 0; break; } hit.push(starts[k]); from = k + 1; }
    if (hit.length === lq.length) { const skipped = starts.indexOf(hit.at(-1)) + 1 - hit.length; return { score: 85 - skipped * 6 - lt.length * 0.05, at: hit }; }
  }
  // Chunks: the query is cut into pieces of 1-3 letters, each the start of a later word ("rst" -> "Remove state axis": r|st).
  if (lq.length >= 3 && !/\s/.test(lq)) {
    const words = []; for (let i = 0; i < t.length; i++) if (/[a-z0-9]/i.test(t[i]) && (i === 0 || SEP.test(t[i - 1]) || (t[i - 1] === t[i - 1].toLowerCase() && t[i] !== t[i].toLowerCase()))) words.push(i);
    let best = null;
    const go = (qi, wi, hit, skipped) => {
      if (qi === lq.length) { if (!best || skipped < best.skipped) best = { hit: hit.slice(), skipped }; return; }
      for (let w = wi; w < words.length; w++) for (let n = 1; n <= 3 && qi + n <= lq.length; n++) {
        if (lt.slice(words[w], words[w] + n) !== lq.slice(qi, qi + n)) continue;
        go(qi + n, w + 1, [...hit, ...Array.from({ length: n }, (_, k) => words[w] + k)], skipped + (w - wi));
      }
    };
    go(0, 0, [], 0);
    if (best && best.hit.length === lq.length) return { score: 88 - best.skipped * 3 - lt.length * 0.05, at: best.hit };
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
    else if (item.hint && q) { const h = match(q, `${item.label} ${item.hint}`); if (h) out.push({ item, score: h.score - 12 + (item.boost || 0), at: [] }); }
  }
  out.sort((a, b) => b.score - a.score || KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] || a.item.label.localeCompare(b.item.label));
  return out.slice(0, limit);
}
