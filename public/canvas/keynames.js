// Key names for bindings, shared by the server (/api/keys) and the canvas (commands.js, the key map).
// A binding is one chord ("Alt+Y", "Shift+ArrowRight", "F5") or a sequence of chords separated by spaces ("A K": A, then K).
// Modifiers are always written in the order Ctrl, Alt, Shift, Meta; a single letter is written upper case.
const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const ALIAS = { control: 'Ctrl', ctrl: 'Ctrl', cmd: 'Meta', command: 'Meta', meta: 'Meta', super: 'Meta', option: 'Alt', opt: 'Alt', alt: 'Alt', shift: 'Shift' };
const NAMED = { esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', space: 'Space', tab: 'Tab', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', del: 'Delete', delete: 'Delete', backspace: 'Backspace', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };

export function chord(text) {
  const parts = String(text).trim().split(/\+(?!$)/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const mods = new Set();
  let key = null;
  for (const p of parts) {
    const m = ALIAS[p.toLowerCase()];
    if (m && (parts.length > 1 || p.length > 1) && p !== parts.at(-1)) { mods.add(m); continue; }
    if (key !== null) return null;
    const named = NAMED[p.toLowerCase()];
    key = named || (/^f([1-9]|1[0-2])$/i.test(p) ? p.toUpperCase() : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1));
  }
  if (!key) return null;
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}
/** "alt+y" -> "Alt+Y"; "a k" -> "A K"; null when it cannot be read. */
export function normalizeKeys(text) {
  const chords = String(text ?? '').trim().split(/\s+/).filter(Boolean).map(chord);
  return chords.length && chords.every(Boolean) ? chords.join(' ') : null;
}
/** The chord a keyboard event makes, in the same spelling. */
export function eventChord(ev) {
  let key = ev.key;
  if (key === ' ') key = 'Space';
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  // With Alt or Ctrl held, some layouts send a symbol; the physical letter is in `code`.
  if ((ev.altKey || ev.ctrlKey || ev.metaKey) && /^Key[A-Z]$/.test(ev.code || '')) key = ev.code.slice(3);
  // Ctrl+Shift+\ (the design panel) is the backslash key with Shift, whatever symbol the layout puts on it.
  const slash = (ev.ctrlKey || ev.metaKey) && ev.code === 'Backslash';
  if (slash) key = '\\';
  const shifted = !slash && key.length === 1 && !/[a-z0-9]/i.test(key); // "?" already carries its Shift
  const mods = [ev.ctrlKey && 'Ctrl', ev.altKey && 'Alt', ev.shiftKey && !shifted && 'Shift', ev.metaKey && 'Meta'].filter(Boolean);
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}
