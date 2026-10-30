// M5, theme wipe (decision 0016). A slider and a vertical line wipe one theme into another across the whole canvas: the
// themes the files define (prefers-color-scheme, [data-theme="x"], .dark / .light classes), not a filter.
//
// How a frame is shown in a theme the system is not in: the frame's own document is changed in memory, never the file.
//   1. @media (prefers-color-scheme: ...) conditions in its style sheets are rewritten in the CSSOM (true or false for the theme);
//   2. the attribute or class the files use ([data-theme], .dark) is set on <html> and <body>;
//   3. `color-scheme` is set on :root, so light-dark(), form controls and the canvas background follow.
// The wipe renders each frame twice (the second copy is the same /view page in the other theme), clipped at the line.
// Closing puts the frames back by loading them again.
//   initTheme(ctx) -> ctx.theme = { open(), close(), toggle(), set({ left, right, at }), state(), themes() }
const enc = encodeURIComponent;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ATTR = /\[\s*(data-[\w-]*(?:theme|mode|scheme)[\w-]*|theme|color-scheme)\s*(?:[~|^$*]?=\s*["']?([\w-]+)["']?\s*)?\]/gi;
const CLASS = /\.(dark|light|dark-mode|light-mode|dark-theme|light-theme|theme-[\w-]+|[\w-]+-theme)(?![\w-])/gi;
const SCHEME = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;
const HAS_SCHEME = /prefers-color-scheme/i;
export const TOKEN = (name) => name.toLowerCase().replace(/^(theme-)|(-theme|-mode)$/g, '');

// ---- reading what a document defines ----
function* rulesOf(sheet, depth = 0) {
  let rules; try { rules = sheet.cssRules; } catch { return; }
  for (const r of rules) {
    yield r;
    if (r.type === 3 && r.styleSheet && depth < 4) yield* rulesOf(r.styleSheet, depth + 1);
    else if (r.cssRules) yield* inner(r);
  }
}
function* inner(rule) { for (const r of rule.cssRules || []) { yield r; if (r.cssRules) yield* inner(r); } }
export function discover(doc) {
  const out = { scheme: false, attrs: new Map(), classes: new Set() };
  if (!doc) return out;
  for (const sheet of doc.styleSheets) for (const r of rulesOf(sheet)) {
    if (r.type === 4 || r.type === 3) { if (HAS_SCHEME.test(r.media?.mediaText || '')) out.scheme = true; }
    if (r.type !== 1) continue;
    const sel = r.selectorText || '';
    for (const m of sel.matchAll(ATTR)) if (m[2]) { if (!out.attrs.has(m[1])) out.attrs.set(m[1], new Set()); out.attrs.get(m[1]).add(m[2].toLowerCase()); }
    for (const m of sel.matchAll(CLASS)) out.classes.add(m[1].toLowerCase());
  }
  return out;
}

// ---- putting a document in a theme ----
const originals = new WeakMap(); // doc -> Map(rule or element -> its first media text)
export function applyTheme(doc, theme) {
  if (!doc?.documentElement) return;
  const found = discover(doc);
  const orig = originals.get(doc) || originals.set(doc, new Map()).get(doc);
  if (theme.scheme) {
    const fix = (t) => t.replace(SCHEME, (m, v) => (v.toLowerCase() === theme.scheme ? '(min-width: 0px)' : '(min-width: 1000000px)'));
    const touch = (node, mediaOf, set) => {
      const base = orig.has(node) ? orig.get(node) : mediaOf();
      if (!/prefers-color-scheme/i.test(base)) return;
      orig.set(node, base);
      const next = fix(base);
      if (mediaOf() !== next) set(next);
    };
    for (const sheet of doc.styleSheets) {
      for (const r of rulesOf(sheet)) if ((r.type === 4 || r.type === 3) && r.media) touch(r, () => r.media.mediaText, (t) => { r.media.mediaText = t; });
    }
    for (const el of doc.querySelectorAll('link[media], style[media]')) touch(el, () => el.getAttribute('media') || '', (t) => el.setAttribute('media', t));
  }
  // the attribute or class the files use: set the theme's own value when the files define it, otherwise take the others off
  for (const el of [doc.documentElement, doc.body].filter(Boolean)) {
    for (const [name, values] of found.attrs) {
      if (values.has(theme.name)) el.setAttribute(name, theme.name); else if (theme.scheme || values.size) el.removeAttribute(name);
    }
    const family = [...found.classes];
    for (const c of family) el.classList.remove(c);
    const mine = family.find((c) => TOKEN(c) === theme.name);
    if (mine) el.classList.add(mine);
  }
  let st = doc.head?.querySelector('style[data-napkin-theme]');
  if (theme.scheme) {
    if (!st) { st = doc.createElement('style'); st.setAttribute('data-napkin', ''); st.setAttribute('data-napkin-theme', ''); doc.head?.append(st); }
    st.textContent = `:root { color-scheme: ${theme.scheme} !important; }`;
  } else st?.remove();
}

// The themes a set of documents define: light and dark always, then every other name the files use.
export function themesOf(docs) {
  const list = [{ id: 'light', name: 'light', label: 'Light', scheme: 'light' }, { id: 'dark', name: 'dark', label: 'Dark', scheme: 'dark' }];
  const seen = new Set(['light', 'dark']);
  for (const d of docs) {
    const f = discover(d);
    const names = [...f.attrs.values()].flatMap((v) => [...v]).concat([...f.classes].map(TOKEN));
    for (const n of names) if (n && !seen.has(n) && !/^(auto|system|default)$/.test(n)) { seen.add(n); list.push({ id: n, name: n, label: n[0].toUpperCase() + n.slice(1), scheme: null }); }
  }
  return list;
}

// What the canvas and a frame's card look like in a theme: the card is the frame's own background (white by day, the dark chrome by night), the stage is the canvas.
const CANVAS = { light: { stage: '#e8eaee', card: '#ffffff' }, dark: { stage: '#14161b', card: '#1b1d23' } };

export function initTheme(ctx) {
  const stageEl = document.querySelector('#stage');
  const bar = document.createElement('div');
  bar.id = 'theme-wipe'; bar.hidden = true; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Theme wipe'); bar.dataset.nodrag = '1';
  bar.innerHTML = `<label class="tw-side">Left of the line <select id="tw-left" aria-label="Theme left of the line"></select></label>
    <input id="tw-range" type="range" min="0" max="100" step="1" value="50" aria-label="Wipe position: how much of the canvas shows the left theme">
    <label class="tw-side">Right <select id="tw-right" aria-label="Theme right of the line"></select></label>
    <button type="button" id="tw-close" aria-label="Close the theme wipe (Escape)">Done <kbd>Esc</kbd></button>`;
  const line = document.createElement('div');
  line.id = 'wipe-line'; line.hidden = true; line.dataset.nodrag = '1';
  line.innerHTML = '<span class="wl-grab" aria-hidden="true"></span>';
  stageEl.append(line, bar);
  const left = bar.querySelector('#tw-left'), right = bar.querySelector('#tw-right'), range = bar.querySelector('#tw-range');
  const S = { on: false, left: 'light', right: 'dark', at: 50, themes: [] };
  const clones = new Map(); // component id -> the second iframe
  const cards = new Map();  // component id -> the card layer under the frame (the left theme's card colour), clipped like the copy
  const stageBg = document.createElement('div'); stageBg.id = 'wipe-stage'; stageBg.hidden = true; stageBg.setAttribute('aria-hidden', 'true');
  stageEl.prepend(stageBg);
  const ownStage = stageEl.style.backgroundColor;
  // a theme with no scheme of its own (sepia) takes the colour its pages paint on <body>
  const paintOf = (t, which) => {
    if (t.scheme) return CANVAS[t.scheme][which];
    for (const [, f] of frames()) { const d = clones.get(f.cell?.closest?.('.cmp')?.dataset.component)?.contentDocument || f.doc(); const c = d?.body && getComputedStyle(d.body).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; }
    return CANVAS.light[which];
  };
  const frames = () => [...ctx.stage.sections].filter(([, sec]) => sec.docFrame).map(([id, sec]) => [id, sec.docFrame]);
  const themeById = (id) => S.themes.find((t) => t.id === id) || S.themes[0];

  function fillSelects() {
    S.themes = themesOf(frames().map(([, f]) => f.doc()));
    for (const [sel, cur] of [[left, S.left], [right, S.right]]) {
      sel.innerHTML = S.themes.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
      sel.value = S.themes.some((t) => t.id === cur) ? cur : S.themes[0].id;
    }
  }
  // Where the line cuts each frame, in the frame's own pixels.
  function clip() {
    if (!S.on) return;
    const box = stageEl.getBoundingClientRect(), lineX = box.left + (S.at / 100) * box.width;
    line.style.left = `${(S.at / 100) * box.width}px`; stageBg.style.width = `${(S.at / 100) * box.width}px`;
    for (const [id, c] of cards) { const fr = ctx.stage.sections.get(id)?.frame; if (!fr) continue; const r = fr.getBoundingClientRect(), z = fr.offsetWidth ? r.width / fr.offsetWidth : 1, w = fr.offsetWidth, x = Math.max(0, Math.min(w, (lineX - r.left) / z)); c.style.clipPath = `inset(0 ${w - x}px 0 0)`; }
    for (const [id, f] of frames()) {
      const b = clones.get(id), a = f.iframe();
      if (!b || !a) continue;
      const r = a.getBoundingClientRect(), z = a.offsetWidth ? r.width / a.offsetWidth : 1;
      const w = a.offsetWidth, x = Math.max(0, Math.min(w, (lineX - r.left) / z));
      b.style.clipPath = `inset(0 ${w - x}px 0 0)`;
    }
  }
  let queued = 0;
  const queueClip = () => { if (S.on && !queued) queued = requestAnimationFrame(() => { queued = 0; clip(); }); };

  async function second(id, f) {
    clones.get(id)?.remove(); clones.delete(id);
    const a = f.iframe();
    if (!a) return;
    const b = document.createElement('iframe');
    b.className = 'doc-frame doc-wipe'; b.title = `${id} (${themeById(S.left).label})`; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true');
    b.style.width = a.style.width; b.style.height = a.style.height;
    f.cell.append(b);
    clones.set(id, b);
    await new Promise((res) => { b.addEventListener('load', res, { once: true }); b.src = `/view/${enc(id)}?width=${f.width}&rev=${enc(ctx.state.components.get(id)?.revision ?? '')}&wipe=1`; });
    if (clones.get(id) !== b) return;
    applyTheme(b.contentDocument, themeById(S.left));
    queueClip();
  }
  function colours() {
    const L = themeById(S.left), R = themeById(S.right);
    stageBg.style.background = paintOf(L, 'stage'); stageEl.style.backgroundColor = paintOf(R, 'stage');
    for (const [id, sec] of ctx.stage.sections) {
      if (!sec.docFrame) continue;
      sec.frame.style.background = paintOf(R, 'card');
      let c = cards.get(id);
      if (!c) { c = document.createElement('div'); c.className = 'wipe-card'; c.setAttribute('aria-hidden', 'true'); sec.frame.prepend(c); cards.set(id, c); }
      c.style.background = paintOf(L, 'card');
    }
  }
  function paintFrame(id, f) {
    if (!S.on || !f.iframe()) return;
    applyTheme(f.doc(), themeById(S.right));
    return second(id, f);
  }
  async function paintAll() { fillSelects(); await Promise.all(frames().map(([id, f]) => paintFrame(id, f))); colours(); queueClip(); }

  function open() {
    if (S.on) { range.focus(); return; }
    S.on = true; document.body.dataset.wipe = '1'; bar.hidden = false; line.hidden = false; stageBg.hidden = false;
    fillSelects(); range.value = String(S.at);
    paintAll().then(() => ctx.emit('wipe', { on: true }));
    range.focus({ preventScroll: true });
  }
  function close() {
    if (!S.on) return;
    S.on = false; delete document.body.dataset.wipe; bar.hidden = true; line.hidden = true;
    for (const b of clones.values()) b.remove(); clones.clear();
    for (const c of cards.values()) c.remove(); cards.clear();
    for (const sec of ctx.stage.sections.values()) { sec.frame.style.background = ''; }
    stageBg.hidden = true; stageEl.style.backgroundColor = ownStage;
    for (const [id] of frames()) ctx.stage.render(id).catch(console.error); // load them again: the frames leave in their own theme
    ctx.emit('wipe', { on: false });
    stageEl.focus({ preventScroll: true });
  }
  const set = ({ left: l, right: r, at } = {}) => {
    if (l) S.left = l; if (r) S.right = r; if (at !== undefined) { S.at = Math.max(0, Math.min(100, Number(at))); range.value = String(S.at); }
    if (S.on) { left.value = S.left; right.value = S.right; if (l || r) paintAll(); else queueClip(); }
  };

  range.addEventListener('input', () => { S.at = Number(range.value); clip(); });
  left.addEventListener('change', () => set({ left: left.value }));
  right.addEventListener('change', () => set({ right: right.value }));
  bar.querySelector('#tw-close').addEventListener('click', close);
  // the line itself can be dragged
  line.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation(); line.setPointerCapture(ev.pointerId);
    const move = (e) => { const b = stageEl.getBoundingClientRect(); S.at = Math.max(0, Math.min(100, ((e.clientX - b.left) / b.width) * 100)); range.value = String(Math.round(S.at)); clip(); };
    line.addEventListener('pointermove', move);
    line.addEventListener('pointerup', () => line.removeEventListener('pointermove', move), { once: true });
  });
  ctx.on('view', queueClip); ctx.on('layout', queueClip); ctx.on('framewidth', ({ component, width }) => {
    const b = clones.get(component), a = ctx.stage.sections.get(component)?.docFrame?.iframe();
    if (b && a) { b.style.width = `${width}px`; b.style.height = a.style.height; }
    queueClip();
  });
  ctx.on('render', ({ component }) => { const f = ctx.stage.sections.get(component)?.docFrame; if (S.on && f) { fillSelects(); paintFrame(component, f); } });
  addEventListener('resize', queueClip);
  addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    if (ev.code === 'Escape' && S.on && ev.target.closest?.('#theme-wipe')) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); return; }
    if (ev.code !== 'KeyW' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable || document.body.dataset.modal) return;
    ev.preventDefault(); S.on ? close() : open();
  }, true);

  const api = { open, close, toggle: () => (S.on ? close() : open()), set, state: () => ({ ...S, themes: S.themes.map((t) => t.id) }), themes: () => S.themes.map((t) => ({ ...t })), clones: () => clones };
  ctx.theme = api;
  return api;
}
