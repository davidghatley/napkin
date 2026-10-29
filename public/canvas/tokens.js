// Tokens decorate the existing wells; the panel's own commit callback keeps scope and batching.
import { plain } from './words.js';
import { familyTokens, tokenColor, tokenName, tokenValue, offToken, snapValue, nearestTokens, MAX_COLOR_SNAP_DISTANCE } from '/src/token-math.js';
import { h } from './drawer.js';
const cssValue = v => String(v).replace(/\{([\w-]+)\}/g, 'var(--$1)');
export async function initTokens(ctx) {
  let data = { tokens: [], modes: [] }, mode = 'light', drawerPane, table, notice, drawerSearch, drawerCount;
  const style = h('style', { id: 'token-stage-vars' }); style.textContent = '#world .mount, #world .preview-inner, #stage .ghost-new .preview-inner {}'; document.head.append(style);
  const declarations = style.sheet.cssRules[0].style;
  style.sheet.insertRule('#world .frame {}', 1); // WPC-11: the frame (every cell's background) follows the theme's surface
  const frameDecl = style.sheet.cssRules[1].style;
  const theme = h('select', { id: 'token-theme', 'aria-label': 'Component theme', title: 'Preview token mode in every cell', onchange: () => api.setMode(theme.value) });
  const themeLabel = h('label', { id: 'token-theme-label', hidden: true }, h('span', { text: 'Component theme' }), theme);
  document.querySelector('.top-right').prepend(themeLabel);
  let picker;
  function apply() {
    const names = new Set(data.tokens.map(t => '--' + t.name));
    for (const name of Array.from(declarations)) if (!names.has(name)) declarations.removeProperty(name);
    for (const t of data.tokens) { const name = '--' + t.name, value = cssValue(t.values[mode]); if (declarations.getPropertyValue(name).trim() !== value) declarations.setProperty(name, value); }
    document.querySelector('#world').dataset.tokenTheme = mode;
    // Cells sit on the theme's own surface and ink, so a light accent button with a near-white label is not drawn on white.
    const resolve = (name) => { let v = data.tokens.find(t => t.name === name)?.values[mode]; for (let i = 0; i < 4 && /^\{[\w-]+\}$|^var\(--[\w-]+\)$/.test(String(v ?? '').trim()); i++) v = data.tokens.find(t => t.name === String(v).replace(/[{}]|var\(--|\)/g, ''))?.values[mode]; return v; };
    const named = (list) => list.find(n => data.tokens.some(t => t.name === n && t.type === 'color' && resolve(n)));
    const surface = named(['surface', 'background', 'bg', 'canvas', 'page', 'base']), ink = named(['ink', 'text', 'foreground', 'fg', 'on-surface']);
    surface ? frameDecl.setProperty('--nk-frame', resolve(surface)) : frameDecl.removeProperty('--nk-frame');
    document.querySelector('#world').dataset.frameTheme = surface && ink ? '1' : '';
    surface && ink ? frameDecl.setProperty('--nk-frame-ink', resolve(ink)) : frameDecl.removeProperty('--nk-frame-ink');
  }
  function update(next) {
    if (next.revision === data.revision && next.error === data.error) return false;
    data = next;
    if (!data.modes.includes(mode)) mode = data.modes[0] || 'light';
    theme.replaceChildren(...data.modes.map(m => h('option', { value: m, text: m })));
    theme.value = mode; themeLabel.hidden = !data.tokens.length;
    apply(); draw(); return true;
  }
  function closePicker() { if (!picker) return; const anchor = picker.anchor; picker.dispose?.(); picker.remove(); picker = null; anchor?.focus({ preventScroll: true }); }
  function openPicker(anchor, prop, bind, choices) {
    closePicker();
    const result = h('div', { id: 'token-results', role: 'group', 'aria-label': 'Matching tokens' });
    const search = h('input', { id: 'token-search', type: 'search', placeholder: 'Search tokens…', 'aria-label': 'Search tokens', autocomplete: 'off', oninput: () => list() });
    picker = h('div', { id: 'token-picker', role: 'dialog', 'aria-label': `Bind ${prop} to a token` },
      ...(choices ? [h('p', { class: 'token-choice-hint', text: 'Colour is distant. Choose one of the 3 nearest tokens.' })] : []),
      h('div', { class: 'token-picker-head' }, search, h('button', { id: 'token-picker-close', type: 'button', text: '×', 'aria-label': 'Close token picker', onclick: closePicker })), result);
    picker.anchor = anchor;
    picker.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePicker(); } });
    const panel = anchor.closest('#panel');
    let row;
    function dock() {
      const current = panel.querySelector(`#${CSS.escape(anchor.id)}`);
      if (!current) return closePicker();
      picker.anchor = current;
      for (let el = current.parentElement; el; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
      const field = current.closest('.fld') || current.closest('.fbox');
      // Dock below the whole field row, making room instead of covering wells.
      row = field.closest('.irow') || field;
      row.after(picker);
    }
    function place() {
      const column = panel.getBoundingClientRect();
      picker.style.maxHeight = `${Math.max(100, Math.min(340, column.height - row.offsetHeight - 32))}px`;
      picker.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    dock();
    // A component build may redraw the inspector while the person is choosing.
    // Keep the same picker/search and attach it to the refreshed field.
    const observer = new MutationObserver(() => { if (picker && !picker.isConnected) { dock(); if (picker) { place(); search.focus({ preventScroll: true }); } } });
    observer.observe(panel, { childList: true, subtree: true });
    const reposition = () => { if (picker) place(); };
    window.addEventListener('resize', reposition);
    picker.dispose = () => { observer.disconnect(); window.removeEventListener('resize', reposition); };
    function list() {
      const query = search.value.toLowerCase();
      const matches = (choices || familyTokens(data.tokens, prop)).filter(t => `${t.name} ${t.usage} ${tokenValue(t, mode)}`.toLowerCase().includes(query));
      result.replaceChildren(...matches.map(t => h('button', { type: 'button', class: 'token-option', 'data-token': t.name, title: t.usage, onclick: () => { closePicker(); bind(prop, `var(--${t.name})`); } },
        h('i', { class: 'token-swatch', style: t.type === 'color' ? `background:${tokenValue(t, mode)}` : '', 'aria-hidden': 'true', text: t.type === 'color' ? '' : '◇' }), h('span', { text: t.name }), h('small', { text: tokenValue(t, mode) }))));
      if (!matches.length) result.append(h('p', { class: 'hint', text: 'No matching tokens' }));
      place();
    }
    list(); search.focus({ preventScroll: true }); place();
  }
  let colorCanvas;
  function canonicalColor(value) {
    if (value == null || /\b(?:var|calc|min|max|clamp|color-mix)\(/i.test(String(value)) || tokenName(value) || tokenColor(value) || /^(currentColor|inherit|initial|unset|revert)$/i.test(String(value)) || !CSS.supports('color', String(value))) return value;
    colorCanvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    colorCanvas.clearRect(0, 0, 1, 1); colorCanvas.fillStyle = String(value); colorCanvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCanvas.getImageData(0, 0, 1, 1).data;
    return 'rgba(' + [r, g, b, a / 255].join(',') + ')';
  }
  // WPC-13: a snap never happens silently. The dot says where it will go, and afterwards a toast names the token and its value, with Undo.
  const describeSnap = (text) => String(text).replace(/var\(--([\w-]+)\)/g, (_, n) => { const t = data.tokens.find(x => x.name === n); return t ? `${n} (${tokenValue(t, mode)})` : n; });
  let snapToast, snapTimer;
  function snapNotice(prop, before, after, focusUndo = false) {
    snapToast ??= h('div', { id: 'snap-toast', role: 'status', 'data-nodrag': '1' }, h('span', { class: 'ut-msg' }), h('button', { type: 'button', id: 'snap-undo', text: 'Undo' }), h('button', { type: 'button', id: 'snap-dismiss', 'aria-label': 'Dismiss', text: '×' }));
    if (!snapToast.isConnected) document.querySelector('#stage').append(snapToast);
    const hide = () => { snapToast.hidden = true; };
    snapToast.querySelector('.ut-msg').textContent = `Snapped ${prop} ${before} to ${describeSnap(after)}.`;
    snapToast.querySelector('#snap-undo').onclick = () => { hide(); Promise.resolve(ctx.undo()).then(() => document.getElementById(prop)?.focus({ preventScroll: true })); }; // focus goes back to the field it came from
    snapToast.querySelector('#snap-dismiss').onclick = hide;
    snapToast.hidden = false; clearTimeout(snapTimer); snapTimer = setTimeout(() => { if (!snapToast.contains(document.activeElement)) hide(); }, 10000);
    snapToast.querySelector('.ut-msg').textContent += ' Ctrl+Z also undoes it.';
    if (focusUndo) snapToast.querySelector('#snap-undo').focus({ preventScroll: true }); // a keyboard snap moves focus to Undo, so it is one Tab or Enter away
  }
  function decorate(panel, valueOf, bind) {
    if (!data.tokens.length) return;
    for (const input of panel.querySelectorAll('input[data-field="style"], input#background, input#stroke-color, input#shadow-color')) {
      const prop = input.id, family = /^(stroke|shadow)-color$/.test(prop) ? 'color' : prop;
      if (!familyTokens(data.tokens, family).length || input.disabled) continue;
      const v = valueOf(prop), raw = v.mixed ? undefined : v.value, name = tokenName(raw), token = data.tokens.find(t => t.name === name);
      const box = input.closest('.fbox'); if (!box) continue;
      const pickerButton = h('button', { type: 'button', class: 'token-pick', id: `token-${prop}`, 'aria-label': `Bind ${prop} to token`, title: 'Choose token', onclick: ev => { ev.stopPropagation(); openPicker(pickerButton, family, (_, value) => bind(prop, value)); }, text: '◇' });
      box.append(pickerButton);
      if (token) {
        box.classList.add('token-bound'); input.value = name; input.dataset.token = name; input.title = `var(--${name}) · ${tokenValue(token, mode)}`;
        const secondary = h('span', { class: 'token-resolved', text: tokenValue(token, mode), title: `Resolved in ${mode}` });
        box.insertBefore(secondary, pickerButton);
        const swatch = box.querySelector('.chipcolor'); if (swatch) swatch.style.background = tokenValue(token, mode);
        input.addEventListener('focus', () => { if (input.value === name) input.value = String(raw); });
        input.addEventListener('blur', () => { if (input.value === raw) input.value = name; });
      }
      const comparison = family === 'color' || ['background', 'backgroundColor', 'borderColor', 'outlineColor'].includes(family) ? canonicalColor(raw) : raw;
      const catalog = familyTokens(data.tokens, family)[0]?.type === 'color' ? data.tokens.map(t => t.type === 'color' ? { ...t, resolved: { ...t.resolved, [mode]: canonicalColor(tokenValue(t, mode)) } } : t) : data.tokens;
      if (offToken(catalog, family, comparison, mode)) {
        const nearest = nearestTokens(catalog, family, comparison, mode);
        const distant = nearest[0]?.distance > MAX_COLOR_SNAP_DISTANCE && nearest[0]?.token.type === 'color';
        const dot = h('button', { type: 'button', class: 'off-token', id: `off-token-${prop}`, 'aria-label': `${distant ? 'Choose nearest tokens' : 'Snap to nearest token'}: ${prop}`, title: distant ? 'Off token · Choose from the 3 nearest colours' : 'Off token · Snap to nearest token', onclick: ev => {
          ev.stopPropagation();
          if (distant) openPicker(dot, family, (_, value) => bind(prop, value), nearest.map(x => x.token));
          else { const snapped = snapValue(catalog, family, comparison, mode), fromKey = ev.detail === 0; Promise.resolve(bind(prop, snapped)).then(() => snapNotice(prop, raw, snapped, fromKey)); }
        } });
        if (!distant) { const target = describeSnap(snapValue(catalog, family, comparison, mode)); dot.title = `Off token · Snap ${raw} to ${target}`; dot.setAttribute('aria-label', `Snap to nearest token: ${prop}, ${raw} becomes ${target}`); }
        box.insertBefore(dot, pickerButton);
      }
    }
  }
  function draw() {
    if (!table) return;
    const active = document.activeElement;
    const families = [
      ['colour', 'Colour', t => t.type === 'color'],
      ['spacing', 'Spacing', t => t.type === 'spacing'],
      ['radius', 'Radius', t => t.type === 'radius'],
      ['type', 'Type', t => /^(font|lineHeight|letterSpacing)/.test(t.type) || t.group === 'type'],
      ['other', 'Other', () => true],
    ];
    const query = drawerSearch.value.trim().toLowerCase();
    const buckets = new Map(families.map(([id]) => [id, []]));
    for (const t of data.tokens) {
      const [id, label] = families.find(([, , match]) => match(t));
      if (`${label} ${t.name} ${t.usage} ${Object.values(t.values).join(' ')}`.toLowerCase().includes(query)) buckets.get(id).push(t);
    }
    const row = t => h('div', { class: 'token-row', 'data-token': t.name, style: `--nk-token-mode-count:${data.modes.length}` },
      h('div', { class: 'token-info', title: t.usage }, h('strong', { text: t.name })),
      ...data.modes.map(m => h('label', { class: 'token-value' }, h('span', { class: 'token-mode', text: m + (t.value !== undefined && typeof t.value !== 'object' ? ' · shared' : '') }),
        h('div', { class: 'token-value-well' },
          t.type === 'color' && h('i', { class: 'token-swatch', style: `background:${tokenValue(t, m)}`, 'aria-hidden': 'true' }),
          h('input', { 'data-mode': m, 'aria-label': `${t.name} ${m}`, value: t.values[m], onchange: async ev => {
            const r = await api.write(t.name, m, ev.target.value);
            notice.textContent = r.warning || (r.error && plain(r.error)) || `Updated ${t.name}`;
          } })))), h('p', { class: 'token-usage', text: t.usage }));
    const rows = families.filter(([id]) => buckets.get(id).length).map(([id, label]) =>
      h('section', { class: 'token-family', 'data-family': id, 'aria-labelledby': `token-family-${id}` },
        h('h3', { id: `token-family-${id}`, text: `${label} · ${buckets.get(id).length}` }), ...buckets.get(id).map(row)));
    const shown = [...buckets.values()].reduce((n, bucket) => n + bucket.length, 0);
    drawerCount.textContent = `${shown} of ${data.tokens.length} tokens`;
    if (!shown && data.tokens.length) rows.push(h('p', { class: 'hint', text: 'No matching tokens' }));
    // A socket update must not discard a value the person is still typing.
    const draft = table.contains(active) ? { name: active.closest('[data-token]')?.dataset.token, mode: active.dataset.mode, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    table.replaceChildren(...rows);
    if (draft) { const input = [...table.querySelectorAll('input')].find(i => i.closest('[data-token]').dataset.token === draft.name && i.dataset.mode === draft.mode); if (input) { input.value = draft.value; input.focus({ preventScroll: true }); input.setSelectionRange(draft.start, draft.end); } }
    if (!data.tokens.length) table.append(h('p', { class: 'hint', text: 'Configure tokens.source in napkin.json to edit tokens here.' }));
    const history = drawerPane.querySelector('#token-history');
    history.replaceChildren(...(data.history || []).slice(0, 20).map(row => h('li', { 'data-by': row.by, 'data-revision': row.revision, text: `${row.by} · ${row.summary}` })));
    if (data.error) notice.textContent = plain(data.error);
  }
  const api = {
    get data() { return data; }, get mode() { return mode; }, decorate,
    setMode(next) { if (!data.modes.includes(next)) return; mode = next; theme.value = mode; apply(); ctx.emit('token-mode', { mode }); ctx.emit('token-preview'); },
    async write(name, m, value) {
      const r = await ctx.fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mode: m, value, baseRevision: data.revision }) });
      const next = await r.json();
      if (next.ok) { if (update(next)) ctx.emit('token-preview'); }
      else ctx.hint(plain(next.error));
      return next;
    },
  };
  ctx.tokens = api;
  ctx.on('tokens', next => { if (update(next)) ctx.emit('token-preview'); });
  ctx.on('token-preview', closePicker);
  ctx.on('select', closePicker);
  ctx.drawer.add('tokens', 'Tokens', { build(pane) {
    drawerPane = pane;
    drawerSearch = h('input', { id: 'token-drawer-search', type: 'search', placeholder: 'Search names, values or usage…', 'aria-label': 'Search all tokens', oninput: draw });
    drawerCount = h('span', { id: 'token-count', role: 'status' });
    table = h('div', { id: 'token-table' }); notice = h('p', { id: 'token-notice', role: 'status', class: 'hint' });
    pane.append(h('div', { class: 'token-toolbar' }, drawerSearch, drawerCount), notice, table, h('details', {}, h('summary', { text: 'Token history' }), h('ul', { id: 'token-history' })));
    draw();
  } });
  // Put Tokens alongside Code and History regardless of registration order.
  document.querySelector('#open-history').after(document.querySelector('#open-tokens'));
  update(await (await fetch('/api/tokens')).json());
  return api;
}
