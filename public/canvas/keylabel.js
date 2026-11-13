// Key labels follow the platform: one helper for every key the shell shows (top bar, tooltips, layers menu, right-panel hints,
// status bar). A key is written once as a spec, "Mod+K", "Shift+1", "Ctrl+\", "Backspace"; Mod is Command on a Mac and Ctrl
// elsewhere. On a Mac the label is the symbols (⌘K, ⇧1, ⌃\, ⌫); elsewhere the words (Ctrl K, Shift 1, Ctrl \, Backspace).
//   keyLabel(spec) -> string; relabel(root) fills [data-keys] (text) and [data-title-keys] (the {k} in title) under root
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SYM = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Backspace: '⌫' };
const WORD = { Mod: 'Ctrl' };
export function keyLabel(spec, mac = MAC) {
  const parts = String(spec).split(/\+(?!$)/); // "Ctrl++" keeps its plus
  return mac ? parts.map((p) => SYM[p] ?? p).join('') : parts.map((p) => WORD[p] ?? p).join(' ');
}
export function relabel(root = document) {
  for (const el of root.querySelectorAll('[data-keys]')) el.textContent = keyLabel(el.dataset.keys);
  for (const el of root.querySelectorAll('[data-title-keys]')) {
    el.dataset.titleTpl ??= el.getAttribute('title') || '';
    el.title = el.dataset.titleTpl.replace('{k}', keyLabel(el.dataset.titleKeys));
  }
}
