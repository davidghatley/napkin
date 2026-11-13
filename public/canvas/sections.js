// The right panel's section chrome (docs/basics/standards.md section 7 rules 4 and 5): one look for every section of every
// selection, whoever draws it (panel.js for a TSX layer, doc-panel.js for an HTML element, the instruments for a whole file).
// A section is a heading with one button: the label and a chevron. Click or Enter/Space toggles it; aria-expanded says which.
// Whether it is open is remembered per kind of selection and section (localStorage 'napkin.sections', "png.viewer": false),
// so closing Viewer on one PNG keeps it closed on the next PNG.
//
//   sectionHtml({ kind, id, title, body, open, action, cls })  the markup of one section ('open' is the default before a choice)
//   wireSections(root)              the toggles under root (delegated once per root); each section also gets an `open` property
//   isOpen(kind, id, dflt) / remember(kind, id, open)          the remembered state
//   openAround(el)                  open every closed section (or <details>) around el, so it can take focus
const KEY = 'napkin.sections';
let memo = null;
const load = () => { if (memo) return memo; try { memo = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { memo = {}; } return memo; };
export function isOpen(kind, id, dflt = true) { const m = load(), k = `${kind}.${id}`; return k in m ? !!m[k] : dflt; }
export function remember(kind, id, open) { const m = load(); m[`${kind}.${id}`] = !!open; try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {} }

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let serial = 0;
export function sectionHtml({ kind, id, title, body, open = true, action = '', cls = '', note = '' }) {
  const on = isOpen(kind, id, open), bid = `pps-${id}-${++serial}`;
  return `<section class="pp-sec sec${cls ? ' ' + cls : ''}" data-sec="${esc(id)}" data-kind="${esc(kind)}"${on ? ' data-open="1"' : ''}><h3 class="pp-sec-t"><button type="button" class="pp-sec-h" aria-expanded="${on}" aria-controls="${bid}"><span class="pp-chev" aria-hidden="true"></span><span class="pp-sec-l">${title}</span>${note ? `<span class="pp-sec-n">${note}</span>` : ''}</button>${action}</h3><div class="pp-sec-b sbody" id="${bid}"${on ? '' : ' hidden'}>${body}</div></section>`;
}

function set(sec, on, save = true) {
  sec.toggleAttribute('data-open', on);
  sec.querySelector(':scope > .pp-sec-t > .pp-sec-h')?.setAttribute('aria-expanded', String(on));
  const b = sec.querySelector(':scope > .pp-sec-b'); if (b) b.hidden = !on;
  if (save) remember(sec.dataset.kind, sec.dataset.sec, on);
  sec.dispatchEvent(new CustomEvent('section-toggle', { bubbles: true, detail: { id: sec.dataset.sec, open: on } }));
}
// `open` reads and sets a section like a <details>: what the older panel code and tests expect of a section.
const OPEN = { configurable: true, get() { return this.hasAttribute('data-open'); }, set(v) { set(this, !!v); } };
const wired = new WeakSet();
export function wireSections(root) {
  for (const s of root.querySelectorAll('.pp-sec')) if (!Object.hasOwn(s, 'open')) Object.defineProperty(s, 'open', OPEN);
  if (wired.has(root)) return;
  wired.add(root);
  root.addEventListener('click', (ev) => {
    const h = ev.target.closest?.('.pp-sec-h');
    if (!h || !root.contains(h)) return;
    const sec = h.closest('.pp-sec');
    set(sec, !sec.hasAttribute('data-open'));
  });
}
export function openAround(el) {
  for (let s = el?.closest?.('.pp-sec:not([data-open]), details:not([open])'); s; s = s.parentElement?.closest('.pp-sec:not([data-open]), details:not([open])')) {
    if (s.tagName === 'DETAILS') s.open = true; else set(s, true);
  }
}
