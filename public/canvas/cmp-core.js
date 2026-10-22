// Shared by the components lane's panel parts (props.js, variants.js): escaping, small icons, one place for
// errors, and `run`, which sends a batch through ctx.sendEdits (the one commit path) and redraws the panel.
// Nothing here writes a file.
import { stripNext } from './words.js';
import { renderPanel, forgetDraft } from './panel.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const svg = (d, w = 14) => `<svg viewBox="0 0 16 16" width="${w}" height="${w}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const ICON = {
  up: svg('M8 13V3M4 7l4-4 4 4'),
  down: svg('M8 3v10M4 9l4 4 4-4'),
  grip: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="4" r="1.1"/><circle cx="10" cy="4" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="6" cy="12" r="1.1"/><circle cx="10" cy="12" r="1.1"/></g></svg>',
  reset: svg('M3.5 7.5a4.5 4.5 0 1 1 1.3 3.2M3.5 3.5v4h4', 12),
  base: svg('M3 3h10M8 13V6M5 9l3-3 3 3', 12),
  string: '<span class="gt">Aa</span>',
  boolean: svg('M2.5 8a3 3 0 0 1 3-3h5a3 3 0 0 1 0 6h-5a3 3 0 0 1-3-3zM10.5 8h.01', 14),
  enum: svg('M3 5h10M3 8h10M3 11h6'),
  number: '<span class="gt">#</span>',
  node: svg('M2.5 4.5h11v7h-11zM5 8h6', 14),
};

// One set of messages for the whole panel part, keyed by where they belong. They clear on the next success.
export const errors = {};
export const drag = { active: null };

export function ctxDoc(ctx) {
  const s = ctx.state.selection;
  const comp = s && ctx.state.components.get(s.component);
  return { s, comp, doc: comp?.doc };
}

export async function run(ctx, key, edits, clear = []) {
  const { s } = ctxDoc(ctx);
  if (!s) return { ok: false, error: 'nothing selected' };
  let r;
  const was = ctx.state.components.get(s.component)?.revision;
  try { r = await ctx.sendEdits(s.component, edits); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  clear.forEach(forgetDraft);
  if (r.ok) delete errors[key]; else errors[key] = stripNext(r.error);
  // A batch that changed the file is followed by a render, which redraws the panel after the new pixels (PRF-02, as panel.js does).
  // A refusal or a batch that changed nothing (same revision) has no render coming: redraw now.
  if (!r.ok || r.revision === was) setTimeout(() => renderPanel(ctx), 0);
  return r;
}

// `other` is the panel's own error line for the same key (the remove buttons still run through panel.js)
export const errorLine = (key, other = () => '') => (errors[key] ? `<p class="field-error" id="err-${esc(key)}" role="alert">${esc(errors[key])}</p>` : other(key));

// Reordering by dragging a grip: the row under the pointer decides the new position. Returns a cleanup-free starter.
// onDrop(fromName, toIndex) is called once on release. Escape-free by design (a drag you do not want: drop it back where it was).
export function startDrag(ev, list, rowSel, nameOf, onDrop) {
  const rows = [...list.querySelectorAll(rowSel)];
  const from = rows.findIndex((r) => r.contains(ev.target));
  if (from < 0) return;
  ev.preventDefault();
  const line = document.createElement('div');
  line.className = 'drop-line';
  list.append(line);
  let to = from;
  rows[from].classList.add('dragging');
  document.body.dataset.cmpDrag = '1';
  const move = (e) => {
    const rects = rows.map((r) => r.getBoundingClientRect());
    to = rects.findIndex((r) => e.clientY < r.top + r.height / 2);
    if (to < 0) to = rows.length; // below the last row
    const y = to === rows.length ? rects.at(-1).bottom : rects[to].top;
    line.style.top = `${y - list.getBoundingClientRect().top + list.scrollTop - 1}px`;
    line.dataset.at = String(to);
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    line.remove(); rows[from].classList.remove('dragging'); delete document.body.dataset.cmpDrag;
    const at = to > from ? to - 1 : to;
    if (at !== from) onDrop(nameOf(rows[from]), at);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  move(ev);
}
