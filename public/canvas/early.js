// Keys pressed while the canvas is still starting are kept, then played back once the palette and the key handlers exist,
// so a Ctrl+K and the words typed after it are not lost to a page that has loaded but not yet woken.
(() => {
  const kept = [];
  let live = false;
  const hold = (e) => {
    if (live || !e.isTrusted || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    if (kept.length > 200) return;
    kept.push({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
    e.preventDefault(); e.stopImmediatePropagation();
  };
  addEventListener('keydown', hold, true);
  // Remote-control tools (CDP, VNC, xdotool) often send a typed ! " # $ % & ' ( - . with the virtual-key code of PageUp, PageDown,
  // End, Home, an arrow, Insert or Delete (33 to 40, 45, 46), so the field moves its caret or deletes a character before the
  // character arrives, and the character lands in the wrong place. A real keyboard never makes that pair (a printable key
  // with an editing key's code). In a field, the selection and text from before the key press are kept, and the character that
  // follows replaces that selection as written.
  let before = null;
  addEventListener('keydown', (e) => {
    const f = e.target;
    before = e.key.length === 1 && (e.keyCode >= 33 && e.keyCode <= 40 || e.keyCode === 45 || e.keyCode === 46) && /^(INPUT|TEXTAREA)$/.test(f?.tagName) && !e.ctrlKey && !e.metaKey && !e.altKey
      ? { f, key: e.key, value: f.value, start: f.selectionStart, end: f.selectionEnd, at: performance.now() } : null;
  }, true);
  addEventListener('beforeinput', (e) => {
    const b = before;
    before = null;
    if (!b || e.target !== b.f || e.inputType !== 'insertText' || e.data !== b.key || performance.now() - b.at > 500) return;
    e.preventDefault();
    b.f.value = b.value;
    b.f.setRangeText(b.key, b.start, b.end, 'end');
    b.f.dispatchEvent(new InputEvent('input', { bubbles: true, data: b.key, inputType: 'insertText' }));
  }, true);
  window.napkinEarly = {
    // Called by main.js when the handlers are in place. Text keys go into the field that has focus by then (the palette), as typing would have.
    replay() {
      live = true;
      removeEventListener('keydown', hold, true);
      for (const k of kept.splice(0)) {
        const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
        const ev = new KeyboardEvent('keydown', { ...k, bubbles: true, cancelable: true, composed: true });
        target.dispatchEvent(ev);
        const at = document.activeElement;
        if (ev.defaultPrevented || !at || !/^(INPUT|TEXTAREA)$/.test(at.tagName) || k.ctrlKey || k.metaKey || k.altKey) continue;
        if (k.key.length === 1) { at.setRangeText(k.key, at.selectionStart ?? at.value.length, at.selectionEnd ?? at.value.length, 'end'); at.dispatchEvent(new InputEvent('input', { bubbles: true, data: k.key, inputType: 'insertText' })); }
        else if (k.key === 'Backspace' && at.value) { const s = at.selectionStart ?? at.value.length, e = at.selectionEnd ?? s; at.setRangeText('', s === e ? Math.max(0, s - 1) : s, e, 'end'); at.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); }
      }
    },
  };
})();
