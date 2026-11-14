// One way every field of the right panel behaves (docs/basics/standards.md section 7 rules 9 and 10), whichever part of the panel drew
// it: an HTML element's values (doc-panel.js), a TSX component's (panel.js) or a file's instruments (surface-panel.js, the dials library).
// Each of those still writes its own edit; this module only gives them the same keys:
//   click             focuses the field and selects all of it
//   +8  -4  *2  /2    math on the value the field had when it was focused (held back from the field until it is committed)
//   Enter             commits; the focus stays in the field, all of it selected
//   Tab, Shift+Tab    commits and moves to the next (previous) field of the panel
//   Escape            puts the field back and hands the focus to the canvas (#stage); the selection stays
//   Up, Down          +1 / -1, Shift ×10, on a number that no part of the panel steps itself
// The listeners sit on #inspector: the capture one runs before the field's own, the bubble one after.

const FIELD = 'input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea';
export const isField = (t) => !!t?.matches?.(FIELD) && !t.readOnly && !t.disabled && !!t.closest('#inspector');
const REL = /^\s*([+\-*/])\s*(\d*\.?\d+)\s*$/;
const NUM = /^\s*(-?\d*\.?\d+)\s*([a-z%]*)\s*$/i;
const round = (n) => Math.round(n * 1e4) / 1e4;

// `+8` on `632px` is `640px`; null when the text is not math on a number.
export function relative(start, text) {
  const m = REL.exec(String(text ?? '')), s = NUM.exec(String(start ?? ''));
  if (!m || !s) return null;
  const a = Number(s[1]), b = Number(m[2]);
  const n = { '+': a + b, '-': a - b, '*': a * b, '/': b ? a / b : a }[m[1]];
  return Number.isFinite(n) ? `${round(n)}${s[2]}` : null;
}
// A number with its unit, stepped (Up/Down on a field nothing else steps); null when it is not one number.
export function stepped(text, delta) {
  const s = NUM.exec(String(text ?? ''));
  return s ? `${round(Number(s[1]) + delta)}${s[2]}` : null;
}

export function initFields(ctx, root = document.querySelector('#inspector')) {
  if (!root || root.dataset.fields) return;
  root.dataset.fields = '1';
  const start = new WeakMap(); // the value a field had when it was focused (math is relative to it, Escape goes back to it)
  let passing = false, pointer = null;
  const fields = () => [...root.querySelectorAll(FIELD)].filter((f) => isField(f) && f.getClientRects().length && !f.closest('[hidden], [inert]'));
  const remember = (t) => start.set(t, t.value !== '' ? t.value : t.placeholder);
  const fire = (t, type) => { passing = true; try { t.dispatchEvent(new Event(type, { bubbles: true })); } finally { passing = false; } };
  // Math waits for the commit: "+8" typed is not 8.
  const settle = (t) => {
    const r = relative(start.get(t), t.value);
    if (r !== null) { t.value = r; fire(t, 'input'); }
  };
  const toCanvas = () => document.querySelector('#stage')?.focus({ preventScroll: true });

  root.addEventListener('pointerdown', (ev) => { if (isField(ev.target) && document.activeElement !== ev.target) pointer = ev.target; }, true);
  root.addEventListener('mouseup', (ev) => { if (pointer && ev.target === pointer) ev.preventDefault(); pointer = null; }, true); // the click keeps the selection focus made
  root.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (!isField(t)) return;
    remember(t);
    if (t.localName === 'input') t.select();
  });
  // A commit (a field's change, a step that wrote) is the new value Escape goes back to.
  root.addEventListener('change', (ev) => { if (!passing && isField(ev.target)) remember(ev.target); });
  root.addEventListener('input', (ev) => {
    if (passing || !isField(ev.target)) return;
    if (relative(start.get(ev.target), ev.target.value) !== null) ev.stopPropagation();
  }, true);

  root.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (!isField(t) || ev.isComposing || ev.nkSynthetic) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'Enter' && !(t.localName === 'textarea' && ev.shiftKey)) {
      settle(t);
      // after the field's own handlers: keep the focus in the field (or in its redrawn copy) with all of it selected
      const key = t.dataset.key || t.id;
      setTimeout(() => {
        let f = t.isConnected ? t : (key && root.querySelector(`[data-key="${CSS.escape(key)}"], #${CSS.escape(key)}`));
        if (!f || !isField(f)) return;
        const a = document.activeElement;
        if (a !== f && a && a !== document.body && root.contains(a) && isField(a)) return; // the field moved the focus on to another field
        if (a !== f) f.focus({ preventScroll: true });
        delete f.dataset.dirty;
        remember(f);
        if (f.localName === 'input') f.select();
      }, 0);
      return;
    }
    if (ev.key === 'Tab') {
      settle(t);
      const list = fields(), i = list.indexOf(t), next = list[i + (ev.shiftKey ? -1 : 1)];
      // the field's own commit (Enter), then on
      const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      enter.nkSynthetic = true;
      if (t.localName !== 'textarea') t.dispatchEvent(enter);
      if (!next) return;
      ev.preventDefault();
      next.focus({ preventScroll: false });
      return;
    }
    if (ev.key === 'Escape') {
      const was = start.get(t), key = t.dataset.key || t.id;
      // back first, before any handler of the panel can blur the field (a blur commits what it holds)
      const back = (f) => { if (was !== undefined && f.value !== was && f.value !== '') { f.value = f.placeholder && was === f.placeholder ? '' : was; fire(f, 'input'); } };
      back(t);
      setTimeout(() => {
        // the field, or its copy when the panel redrew it on Escape
        const f = t.isConnected ? t : key ? root.querySelector(`[data-key="${CSS.escape(key)}"], #${CSS.escape(key)}`) : null;
        if (f && isField(f)) back(f);
        if (f) delete f.dataset.dirty;
        const a = document.activeElement;
        if (!a || a === document.body || a === t || a === f || !root.contains(a) || !isField(a)) toCanvas();
      }, 0);
      return;
    }
    if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && t.localName === 'input' && !t.closest('.dials') && !t.dataset.step) {
      const v = stepped(t.value !== '' ? t.value : t.placeholder, (ev.key === 'ArrowUp' ? 1 : -1) * (ev.shiftKey ? 10 : 1));
      if (v === null) return;
      ev.preventDefault();
      t.value = v; fire(t, 'input');
    }
  }, true);
  // After every handler of the panel: Escape in a field was the field's, not the canvas's (which would drop the selection).
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && isField(ev.target) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) ev.stopPropagation(); });
  return { relative, stepped };
}
