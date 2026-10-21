// The colour picker (LAY-08): a popover with a saturation/brightness square, hue and opacity sliders, the value in
// Hex / RGB / HSL / OKLCH, an eyedropper where the browser has one, and the colours already used in this file.
// It never writes anything: it calls onPreview(text) while a drag is going on and onCommit(text) once per gesture,
// with the text spelt in the chosen format (the panel starts it in the format the file already uses).
import { parseColor, formatColor, toHsv, fromHsv, toOklch, fromOklch } from '/src/color.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SPACES = [['hex', 'Hex'], ['rgb', 'RGB'], ['hsl', 'HSL'], ['oklch', 'OKLCH']];
let pop = null;

export const hasEyeDropper = () => typeof globalThis.EyeDropper === 'function';

export function closeColorPicker() { if (pop) { pop.close(); } }

// opts: { anchor: element, value: css colour text | '', space: 'hex'|'rgb'|'hsl'|'oklch', swatches: [css], label, onPreview(text), onCommit(text), onClose() }
export function openColorPicker(opts) {
  closeColorPicker();
  const start = parseColor(opts.value) ?? { r: 217, g: 217, b: 217, a: 1, space: 'hex' };
  let space = opts.space || start.space || 'hex';
  let like = start;
  let c = { r: start.r, g: start.g, b: start.b, a: start.a ?? 1 };
  let hsv = toHsv(c);
  const el = document.createElement('div');
  el.id = 'cpop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', opts.label || 'Colour');
  el.innerHTML = `<div class="cp-sv" id="cp-sv" tabindex="0" aria-label="Saturation and brightness"><i class="cp-knob"></i></div>
    <div class="cp-row"><div class="cp-sliders"><div class="cp-hue" id="cp-hue" tabindex="0" aria-label="Hue"><i class="cp-knob"></i></div><div class="cp-alpha" id="cp-alpha" tabindex="0" aria-label="Opacity"><i class="cp-knob"></i></div></div>
      <button type="button" class="cp-eye" id="cp-eye" aria-label="Pick a colour from the screen" title="${hasEyeDropper() ? 'Pick a colour from the screen' : 'This browser has no eyedropper'}"${hasEyeDropper() ? '' : ' disabled'}><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M10.200 2.300l3.500 3.500-1.200 1.200-.8-.8L6.300 11.300 4.700 11.700 4.300 11.300l.4-1.600 5.200-5.200-.8-.8z M3.800 12.200 2.500 13.500" fill="none" stroke="currentColor" stroke-width="1.200" stroke-linejoin="round" stroke-linecap="round"/></svg></button></div>
    <div class="cp-tabs seg small" role="radiogroup" aria-label="Colour format">${SPACES.map(([k, t]) => `<button type="button" role="radio" data-space="${k}" aria-checked="${k === space}">${t}</button>`).join('')}</div>
    <div class="cp-fields" id="cp-fields"></div>
    ${opts.swatches?.length ? `<div class="cp-docs"><span class="cp-cap">In this file</span><div class="cp-sw">${opts.swatches.map((s) => `<button type="button" class="cp-s" data-c="${esc(s)}" title="${esc(s)}" aria-label="${esc(s)}"><i style="background:${esc(s)}"></i></button>`).join('')}</div></div>` : ''}`;
  document.body.append(el);
  const $ = (s) => el.querySelector(s);
  const r = opts.anchor.getBoundingClientRect(), W = 236;
  el.style.width = `${W}px`;
  const left = Math.max(8, Math.min(innerWidth - W - 8, r.left - W - 12)), top = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, r.top - 20));
  Object.assign(el.style, { left: `${left}px`, top: `${top}px` });

  const text = () => formatColor({ ...c, ...(space === 'oklch' && like.oklch ? { oklch: like.oklch } : {}) }, space, like);
  function paint() {
    const hue = `hsl(${hsv.h} 100% 50%)`;
    $('#cp-sv').style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})`;
    $('#cp-sv .cp-knob').style.cssText = `left:${hsv.s * 100}%;top:${(1 - hsv.v) * 100}%;background:${formatColor({ ...c, a: 1 }, 'hex')}`;
    $('#cp-hue .cp-knob').style.left = `${(hsv.h / 360) * 100}%`;
    const rgb = formatColor({ ...c, a: 1 }, 'hex');
    $('#cp-alpha').style.setProperty('--c', rgb);
    $('#cp-alpha .cp-knob').style.left = `${c.a * 100}%`;
    fields();
  }
  function fields() {
    const box = $('#cp-fields');
    if (box.contains(document.activeElement)) return; // never rebuild under a field being typed in
    const n = (id, label, v, extra = '') => `<label class="cp-f"><span>${label}</span><input id="${id}" value="${esc(v)}" ${extra} autocomplete="off" spellcheck="false"></label>`;
    const a = n('cp-a', 'A %', String(Math.round(c.a * 100)), 'inputmode="decimal"');
    if (space === 'hex') box.innerHTML = n('cp-hex', 'Hex', formatColor({ ...c, a: 1 }, 'hex', like)) + a;
    else if (space === 'rgb') box.innerHTML = n('cp-r', 'R', String(Math.round(c.r))) + n('cp-g', 'G', String(Math.round(c.g))) + n('cp-b', 'B', String(Math.round(c.b))) + a;
    else if (space === 'hsl') { const h = formatColor(c, 'hsl').match(/-?\d+(\.\d+)?/g); box.innerHTML = n('cp-h', 'H', h[0]) + n('cp-s', 'S %', h[1]) + n('cp-l', 'L %', h[2]) + a; }
    else { const o = toOklch(c); box.innerHTML = n('cp-ol', 'L', String(Math.round(o.l * 1000) / 1000)) + n('cp-oc', 'C', String(Math.round(o.c * 1000) / 1000)) + n('cp-oh', 'H', String(Math.round(o.h * 10) / 10)) + a; }
  }
  const preview = () => opts.onPreview?.(text());
  const commit = () => opts.onCommit?.(text());
  const setRgb = (rgb, keepHue) => { c = { ...c, r: rgb.r, g: rgb.g, b: rgb.b }; const h = hsv.h; hsv = toHsv(c); if (keepHue || hsv.s === 0) hsv.h = h; };
  const fromHsvState = () => { setRgb(fromHsv(hsv.h, hsv.s, hsv.v), true); like = { ...like, oklch: undefined }; };

  // drag helper: one gesture = previews while moving, one commit on release
  function drag(node, move) {
    node.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); node.setPointerCapture(ev.pointerId);
      const at = (e) => { const b = node.getBoundingClientRect(); move(Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))); paint(); preview(); };
      at(ev);
      const mv = (e) => at(e);
      const up = () => { node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); commit(); };
      node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
    });
    node.addEventListener('keydown', (ev) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      const step = ev.shiftKey ? 0.1 : 0.01;
      move(null, null, d[0] * step, d[1] * step); paint(); preview(); commit();
    });
  }
  drag($('#cp-sv'), (x, y, dx, dy) => { hsv.s = x === null ? Math.min(1, Math.max(0, hsv.s + dx)) : x; hsv.v = y === null ? Math.min(1, Math.max(0, hsv.v - dy)) : 1 - y; fromHsvState(); });
  drag($('#cp-hue'), (x, _y, dx) => { hsv.h = x === null ? (hsv.h + dx * 360 + 360) % 360 : x * 360; fromHsvState(); });
  drag($('#cp-alpha'), (x, _y, dx) => { c.a = Math.round((x === null ? Math.min(1, Math.max(0, c.a + dx)) : x) * 100) / 100; });

  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-space]');
    if (t) { space = t.dataset.space; el.querySelectorAll('[data-space]').forEach((b) => b.setAttribute('aria-checked', String(b === t))); paint(); preview(); commit(); return; }
    const s = ev.target.closest('.cp-s');
    if (s) { const p = parseColor(s.dataset.c); if (p) { c = { r: p.r, g: p.g, b: p.b, a: p.a }; hsv = toHsv(c); like = p; paint(); preview(); commit(); } return; }
    if (ev.target.closest('#cp-eye') && hasEyeDropper()) {
      new globalThis.EyeDropper().open().then((res) => { const p = parseColor(res.sRGBHex); if (p) { c = { r: p.r, g: p.g, b: p.b, a: c.a }; hsv = toHsv(c); like = { ...like, oklch: undefined }; paint(); preview(); commit(); } }).catch(() => {}); // cancelled: nothing changes
    }
  });
  el.addEventListener('change', (ev) => {
    const id = ev.target.id, v = ev.target.value.trim(), num = parseFloat(v);
    if (id === 'cp-hex') { const p = parseColor(v.startsWith('#') ? v : '#' + v); if (!p) { paint(); return; } c = { r: p.r, g: p.g, b: p.b, a: c.a }; hsv = toHsv(c); }
    else if (id === 'cp-a') { if (!Number.isFinite(num)) { paint(); return; } c.a = Math.min(100, Math.max(0, num)) / 100; }
    else if (['cp-r', 'cp-g', 'cp-b'].includes(id)) { if (!Number.isFinite(num)) { paint(); return; } c[id.slice(3)] = Math.min(255, Math.max(0, num)); hsv = toHsv(c); }
    else if (['cp-h', 'cp-s', 'cp-l'].includes(id)) {
      const get = (k) => parseFloat($('#cp-' + k).value);
      const p = parseColor(`hsl(${get('h')} ${get('s')}% ${get('l')}%)`); if (!p) { paint(); return; }
      c = { r: p.r, g: p.g, b: p.b, a: c.a }; hsv = toHsv(c);
    } else if (['cp-ol', 'cp-oc', 'cp-oh'].includes(id)) {
      const L = parseFloat($('#cp-ol').value), C = parseFloat($('#cp-oc').value), H = parseFloat($('#cp-oh').value);
      if (![L, C, H].every(Number.isFinite)) { paint(); return; }
      const rgb = fromOklch(L, C, H); c = { ...rgb, a: c.a }; hsv = toHsv(c); like = { ...like, oklch: { l: L, c: C, h: H } };
    } else return;
    ev.stopPropagation(); paint(); preview(); commit();
  });
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
  const away = (ev) => { if (!el.contains(ev.target) && !opts.anchor.contains(ev.target)) close(); };
  document.addEventListener('pointerdown', away, true);
  function close() { document.removeEventListener('pointerdown', away, true); el.remove(); if (pop?.el === el) pop = null; opts.onClose?.(); }
  pop = { el, close };
  paint();
  $('#cp-sv').focus({ preventScroll: true });
  return { close, el };
}
