// Real input events over CDP for the canvas tests: keys with modifiers, wheel, mouse buttons, touch.
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const mods = (o = {}) => (o.alt ? 1 : 0) | (o.ctrl ? 2 : 0) | (o.meta ? 4 : 0) | (o.shift ? 8 : 0);
const CODEOF = (key) => (key === ' ' ? 'Space' : key.length === 1 && /[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : key);
const CODES = { Enter: 13, Escape: 27, Delete: 46, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ' ': 32, Alt: 18, Shift: 16, F2: 113, Tab: 9 };

export function input(browser) {
  const send = browser.send;
  const api = {
    async key(key, o = {}) {
      const code = o.code ?? CODEOF(key);
      const vk = CODES[key] ?? key.toUpperCase().charCodeAt(0);
      const base = { key, code, windowsVirtualKeyCode: vk, modifiers: mods(o) };
      const text = key.length === 1 && !o.ctrl && !o.meta ? key : key === 'Enter' ? '\r' : undefined;
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text && { text }) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async down(key, o = {}) { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: o.code ?? CODEOF(key), windowsVirtualKeyCode: CODES[key] ?? key.toUpperCase().charCodeAt(0), modifiers: mods(o) }); },
    async up(key, o = {}) { await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: o.code ?? CODEOF(key), windowsVirtualKeyCode: CODES[key] ?? key.toUpperCase().charCodeAt(0), modifiers: mods(o) }); },
    async wheel(x, y, dx, dy, o = {}) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers: mods(o) }); },
    async move(x, y, o = {}) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: mods(o), buttons: o.buttons ?? 0 }); },
    async press(x, y, o = {}) { const button = o.button ?? 'left'; await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : button === 'middle' ? 4 : 2, clickCount: 1, modifiers: mods(o) }); },
    async release(x, y, o = {}) { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: o.button ?? 'left', buttons: 0, clickCount: 1, modifiers: mods(o) }); },
    async click(x, y, o = {}) { await api.move(x, y, o); await api.press(x, y, o); await api.release(x, y, o); },
    // a real double-click: two presses at one point, the second with clickCount 2 (what makes the browser fire dblclick)
    async dblclick(x, y, o = {}) {
      await api.move(x, y, o);
      for (const clickCount of [1, 2]) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount, modifiers: mods(o) });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount, modifiers: mods(o) });
      }
    },
    async type(text) { for (const ch of text) await api.key(ch); },
    async drag(x0, y0, x1, y1, o = {}) {
      const button = o.button ?? 'left', held = button === 'left' ? 1 : button === 'middle' ? 4 : 2;
      await api.move(x0, y0, o); await api.press(x0, y0, o);
      for (const f of [0.25, 0.5, 0.75, 1]) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, buttons: held, button, modifiers: mods(o) });
      await api.release(x1, y1, o);
    },
    async touch(type, points) { await send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i })) }); },
  };
  return api;
}

// The centre of an element's box, in page pixels.
export const centerOf = async (browser, sel) => JSON.parse(await browser.eval(`JSON.stringify((() => { const r = (${sel}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height }; })())`));
