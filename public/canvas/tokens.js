// Tokens decorate the existing wells; the panel's own commit callback keeps scope and batching.
import { familyTokens, tokenColor, tokenName, tokenValue, offToken, snapValue } from '/src/token-math.js';
import { h } from './drawer.js';
const cssValue = v => String(v).replace(/\{([\w-]+)\}/g, 'var(--$1)');
export async function initTokens(ctx) {
  let data = { tokens: [], modes: [] }, mode = 'light', drawerPane, table, notice;
  const style = h('style', { id: 'token-stage-vars' }); style.textContent = '#world .mount, #world .preview-layer {}'; document.head.append(style);
  const declarations = style.sheet.cssRules[0].style;
  const theme = h('select', { id: 'token-theme', 'aria-label': 'Component theme', title: 'Preview token mode in every cell', onchange: () => api.setMode(theme.value) });
  const themeLabel = h('label', { id: 'token-theme-label', hidden: true }, h('span', { text: 'Theme' }), theme);
  document.querySelector('.top-right').prepend(themeLabel);
  let picker;
  function apply() {
    const names = new Set(data.tokens.map(t => '--' + t.name));
    for (const name of Array.from(declarations)) if (!names.has(name)) declarations.removeProperty(name);
    for (const t of data.tokens) { const name = '--' + t.name, value = cssValue(t.values[mode]); if (declarations.getPropertyValue(name).trim() !== value) declarations.setProperty(name, value); }
    document.querySelector('#world').dataset.tokenTheme = mode;
  }
  function update(next) {
    if (next.revision === data.revision && next.error === data.error) return false;
    data = next;
    if (!data.modes.includes(mode)) mode = data.modes[0] || 'light';
    theme.replaceChildren(...data.modes.map(m => h('option', { value: m, text: m })));
    theme.value = mode; themeLabel.hidden = !data.tokens.length;
    apply(); draw(); return true;
  }
  function closePicker() { if (!picker) return; const anchor = picker.anchor; picker.remove(); picker = null; anchor?.focus({ preventScroll: true }); }
  function openPicker(anchor, prop, bind) {
    closePicker();
    const result = h('div', { id: 'token-results', role: 'group', 'aria-label': 'Matching tokens' });
    const search = h('input', { id: 'token-search', type: 'search', placeholder: 'Search tokens…', 'aria-label': 'Search tokens', autocomplete: 'off', oninput: () => list() });
    picker = h('div', { id: 'token-picker', role: 'dialog', 'aria-label': `Bind ${prop} to a token` },
      h('div', { class: 'token-picker-head' }, search, h('button', { id: 'token-picker-close', type: 'button', text: '×', 'aria-label': 'Close token picker', onclick: closePicker })), result);
    picker.anchor = anchor;
    picker.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePicker(); } });
    document.body.append(picker);
    const r = anchor.getBoundingClientRect();
    picker.style.right = `${Math.max(12, innerWidth - r.right)}px`;
    picker.style.top = `${Math.min(r.bottom + 6, innerHeight - 350)}px`;
    function list() {
      const query = search.value.toLowerCase();
      const matches = familyTokens(data.tokens, prop).filter(t => `${t.name} ${t.usage} ${tokenValue(t, mode)}`.toLowerCase().includes(query));
      result.replaceChildren(...matches.map(t => h('button', { type: 'button', class: 'token-option', 'data-token': t.name, title: t.usage, onclick: () => { closePicker(); bind(prop, `var(--${t.name})`); } },
        h('i', { class: 'token-swatch', style: t.type === 'color' ? `background:${tokenValue(t, mode)}` : '', 'aria-hidden': 'true', text: t.type === 'color' ? '' : '◇' }), h('span', { text: t.name }), h('small', { text: tokenValue(t, mode) }))));
      if (!matches.length) result.append(h('p', { class: 'hint', text: 'No matching tokens' }));
    }
    list(); search.focus();
  }
  let colorCanvas;
  function canonicalColor(value) {
    if (value == null || tokenName(value) || tokenColor(value) || /^(currentColor|inherit|initial|unset|revert)$/i.test(String(value)) || !CSS.supports('color', String(value))) return value;
    colorCanvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    colorCanvas.clearRect(0, 0, 1, 1); colorCanvas.fillStyle = String(value); colorCanvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCanvas.getImageData(0, 0, 1, 1).data;
    return 'rgba(' + [r, g, b, a / 255].join(',') + ')';
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
        const dot = h('button', { type: 'button', class: 'off-token', id: `off-token-${prop}`, 'aria-label': `Snap to nearest token: ${prop}`, title: 'Off token · Snap to nearest token', onclick: ev => { ev.stopPropagation(); bind(prop, snapValue(catalog, family, comparison, mode)); } });
        box.insertBefore(dot, pickerButton);
      }
    }
  }
  function draw() {
    if (!table) return;
    const active = document.activeElement;
    const rows = data.tokens.map(t => h('div', { class: 'token-row', 'data-token': t.name },
      h('div', { class: 'token-info', title: t.usage }, h('strong', { text: t.name }), h('small', { text: `${t.group} · ${t.type}` })),
      ...data.modes.map(m => h('label', { class: 'token-value' }, h('span', { text: m + (t.value !== undefined && typeof t.value !== 'object' ? ' · shared' : '') }), h('input', { 'data-mode': m, 'aria-label': `${t.name} ${m}`, value: t.values[m], onchange: async ev => {
        const r = await api.write(t.name, m, ev.target.value);
        notice.textContent = r.warning || r.error || `Updated ${t.name}`;
      } }))), h('p', { class: 'token-usage', text: t.usage })));
    // A socket update must not discard a value the person is still typing.
    const draft = table.contains(active) ? { name: active.closest('[data-token]')?.dataset.token, mode: active.dataset.mode, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    table.replaceChildren(...rows);
    if (draft) { const input = [...table.querySelectorAll('input')].find(i => i.closest('[data-token]').dataset.token === draft.name && i.dataset.mode === draft.mode); if (input) { input.value = draft.value; input.focus({ preventScroll: true }); input.setSelectionRange(draft.start, draft.end); } }
    if (!data.tokens.length) table.append(h('p', { class: 'hint', text: 'Configure tokens.source in napkin.json to edit tokens here.' }));
    const history = drawerPane.querySelector('#token-history');
    history.replaceChildren(...(data.history || []).slice(0, 20).map(row => h('li', { 'data-by': row.by, 'data-revision': row.revision, text: `${row.by} · ${row.summary}` })));
    if (data.error) notice.textContent = data.error;
  }
  const api = {
    get data() { return data; }, get mode() { return mode; }, decorate,
    setMode(next) { if (!data.modes.includes(next)) return; mode = next; theme.value = mode; apply(); ctx.emit('token-mode', { mode }); ctx.emit('token-preview'); },
    async write(name, m, value) {
      const r = await ctx.fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mode: m, value, baseRevision: data.revision }) });
      const next = await r.json();
      if (next.ok) { if (update(next)) ctx.emit('token-preview'); }
      else ctx.hint(next.error);
      return next;
    },
  };
  ctx.tokens = api;
  ctx.on('tokens', next => { if (update(next)) ctx.emit('token-preview'); });
  ctx.on('token-preview', closePicker);
  ctx.on('select', closePicker);
  ctx.drawer.add('tokens', 'Tokens', { build(pane) {
    drawerPane = pane;
    table = h('div', { id: 'token-table' }); notice = h('p', { id: 'token-notice', role: 'status', class: 'hint' });
    pane.append(notice, table, h('details', {}, h('summary', { text: 'Token history' }), h('ul', { id: 'token-history' })));
    draw();
  } });
  // Put Tokens alongside Code and History regardless of registration order.
  document.querySelector('#open-history').after(document.querySelector('#open-tokens'));
  update(await (await fetch('/api/tokens')).json());
  return api;
}
