// Structured stale errors (AGT-06, AGT-10): which keys changed under you, what they hold now,
// what you tried to write, and who changed them.
import { getValue, index, propOf, touched, conflicts } from './model.js';

const clean = (v) => (v === undefined ? null : v);

// The current value behind a touched key (see touched() in model.js for the key forms).
export function currentValue(doc, key) {
  if (!doc) return null;
  if (key.startsWith('children:')) return clean(index(doc).byId.get(key.slice(9))?.children.map((c) => c.id));
  if (key.startsWith('node:')) return index(doc).byId.has(key.slice(5)) ? 'present' : 'absent';
  if (key.startsWith('prop:')) return clean(propOf(doc, key.slice(5)));
  if (key === 'meta.name') return doc.name;
  const at = key.indexOf('@');
  if (at > 0 && !key.slice(at).startsWith('@src') && !key.slice(at).startsWith('@alt')) {
    const path = key.slice(0, at);
    const variant = Object.fromEntries(key.slice(at + 1).split(',').map((p) => p.split('=')));
    return clean(getValue(doc, path, variant));
  }
  try { return clean(getValue(doc, key)); } catch { return null; }
}

// Entries for every key of `edits` that a later revision changed: [{ key, value (theirs, now), yours, revision, by }].
export function staleEntries({ doc, edits, keys, history, baseRevision }) {
  const yours = new Map();
  for (const e of edits) for (const k of touched([e])) if (!yours.has(k)) yours.set(k, e?.op === 'set' ? clean(e.value) : e);
  const out = new Map();
  for (const h of history) {
    if (h.revision <= baseRevision) continue;
    for (const k of keys) {
      if (conflicts(new Set([k]), h.keys)) out.set(k, { key: k, value: currentValue(doc, k), yours: clean(yours.get(k)), revision: h.revision, by: h.by });
    }
  }
  return [...out.values()];
}
