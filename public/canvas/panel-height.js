// The right panel's height lever (docs/basics/standards.md section 7 rule 6c): a long list in a section (the values of a
// stylesheet, a rule list, the variables) shows six rows. Its bottom edge is a handle: drag it down for more rows (it snaps
// to whole rows), or focus it and use Up/Down (Page Down for six more, Home for six, End for all). "Show all" opens the
// whole list and "Show fewer" folds it back. How many rows a list shows is remembered per kind of file and list, in
// localStorage 'napkin.rows'. A row reached by the keyboard past the cap is shown for as long as it has the focus.
// Any panel can use it: the dials sections (surface-panel.js) and the element panel (doc-panel.js) do.
//
//   capList(list, { key, label, rows: () => [rows], cap = 6 })   (again on the same list just measures it again)

const STORE = 'napkin.rows', CAP = 6;
const read = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };
const save = (key, n) => { try { const all = read(); if (n === null) delete all[key]; else all[key] = n; localStorage.setItem(STORE, JSON.stringify(all)); } catch {} };
const states = new WeakMap();
let serial = 0;

export function capList(list, opts) {
  if (!list) return null;
  let st = states.get(list);
  const o = { cap: CAP, ...opts };
  if (!st) { st = make(list, o); states.set(list, st); }
  st.opts = o;
  st.apply();
  return st;
}

function make(list, opts) {
  const st = { list, n: null, peek: 0, opts, foot: null };
  const rows = () => st.opts.rows();
  const total = () => rows().length;
  const cap = () => st.opts.cap;
  const wanted = () => { const v = read()[st.opts.key]; return v === 'all' ? Infinity : Number(v) || cap(); };
  // the height that shows exactly the first n rows (the list's own top padding included)
  function heightFor(n) {
    const r = rows(); if (!r.length) return 0;
    const top = list.getBoundingClientRect().top, last = r[Math.min(n, r.length) - 1].getBoundingClientRect();
    return Math.ceil(last.bottom - top);
  }
  function foot() {
    if (st.foot?.isConnected) return st.foot;
    const id = `nk-cap-${++serial}`;
    const f = document.createElement('div');
    f.className = 'nk-cap';
    f.innerHTML = `<div class="nk-cap-grip" role="separator" aria-orientation="horizontal" tabindex="0" id="${id}"></div><button type="button" class="nk-cap-all"></button>`;
    list.after(f);
    const grip = f.firstElementChild, all = f.lastElementChild;
    grip.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const now = shown(), t = total();
      const to = { ArrowDown: now + 1, ArrowUp: now - 1, PageDown: now + cap(), PageUp: now - cap(), Home: cap(), End: t }[ev.key];
      if (to === undefined) return;
      ev.preventDefault(); ev.stopPropagation();
      set(to);
    });
    grip.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      try { grip.setPointerCapture(ev.pointerId); } catch {}
      grip.dataset.held = '';
      const id = ev.pointerId;
      const move = (e) => {
        if (e.pointerId !== id) return;
        // the row whose bottom edge is nearest the pointer: the list never stops half way through a row
        const r = rows(), y = e.clientY;
        let best = cap(), d = Infinity;
        r.forEach((row, i) => { if (i + 1 < cap()) return; const b = row.getBoundingClientRect().bottom, k = Math.abs(b - y); if (k < d) { d = k; best = i + 1; } });
        set(best, false);
      };
      // listened for on the window, like the panel's own edge: the drag goes on wherever the pointer wanders
      const up = (e) => { if (e.pointerId !== id) return; delete grip.dataset.held; removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); set(shown()); };
      addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    });
    all.addEventListener('click', () => set(shown() >= total() ? cap() : total()));
    st.foot = f;
    return f;
  }
  const shown = () => Math.max(cap(), Math.min(total(), st.n ?? wanted()));
  function set(n, keep = true) {
    const t = total();
    st.n = Math.max(cap(), Math.min(t, n));
    if (keep) save(st.opts.key, st.n >= t ? 'all' : st.n === cap() ? null : st.n);
    st.apply();
  }
  st.apply = () => {
    // a full editor around the list shows every row (its CSS lifts the cap): keep the last measure for when it closes
    if (list.style.maxHeight && getComputedStyle(list).maxHeight === 'none') return;
    const t = total();
    if (t <= cap()) { delete list.dataset.capped; list.style.maxHeight = ''; st.foot?.remove(); st.foot = null; return; }
    const n = Math.max(shown(), st.peek), f = foot(), grip = f.firstElementChild, all = f.lastElementChild;
    if (n >= t) { delete list.dataset.capped; list.style.maxHeight = ''; }
    else { list.dataset.capped = ''; list.style.maxHeight = ''; const h = heightFor(n); list.style.maxHeight = h > 0 ? `${h}px` : ''; }
    grip.setAttribute('aria-label', `Rows shown in ${st.opts.label}`);
    grip.setAttribute('aria-valuemin', String(cap()));
    grip.setAttribute('aria-valuemax', String(t));
    grip.setAttribute('aria-valuenow', String(Math.min(n, t)));
    grip.setAttribute('aria-valuetext', `${Math.min(n, t)} of ${t} rows`);
    grip.title = 'Drag for more rows (Up and Down on the keyboard)';
    all.textContent = n >= t ? 'Show fewer' : `Show all ${t}`;
    all.setAttribute('aria-expanded', String(n >= t));
    f.dataset.more = String(Math.max(0, t - n));
  };
  // a row reached by Tab or by a find past the cap is shown while it has the focus
  list.addEventListener('focusin', (ev) => {
    if (!list.hasAttribute('data-capped')) return;
    const i = rows().findIndex((r) => r.contains(ev.target));
    if (i + 1 > shown()) { st.peek = i + 1; st.apply(); }
  });
  list.addEventListener('focusout', (ev) => { if (st.peek && !list.contains(ev.relatedTarget)) { st.peek = 0; st.apply(); } });
  // rows change height (fonts, a wider panel, a long value wrapping): measure again
  if (typeof ResizeObserver === 'function') {
    let last = '';
    const ro = new ResizeObserver(() => { const sig = list.clientWidth + ':' + rows().map((r) => r.offsetHeight).join(','); if (sig !== last) { last = sig; st.apply(); } });
    ro.observe(list); for (const r of rows().slice(0, 1)) ro.observe(r);
  }
  return st;
}
