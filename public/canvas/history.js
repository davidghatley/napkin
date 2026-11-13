// HIS-01..03 on the page: Cmd/Ctrl+Z and Shift+Cmd+Z undo and redo YOUR edits (the server keeps one stack per caller and
// refuses with who and which revision when someone else changed the same property), and the History tab: a timeline of
// revisions per component, scrub to preview an older state read-only on the canvas, Restore = one new revision.
import { plain } from './words.js';
import { h } from './drawer.js';

const pad = (n) => String(n).padStart(2, '0');
const clock = (at) => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const ago = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 5 ? 'now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const whoClass = (by) => (by === 'you' ? 'you' : by === 'file' ? 'file' : by === 'git' ? 'git' : 'agent');
const isTyping = (t) => {
  if (!t?.closest) return false;
  const f = t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  if (!f) return false;
  return f.matches('input, textarea') ? f.dataset.dirty === '1' : true; // a field with text you have not committed keeps its own undo
};

export function initHistory(ctx, drawer) {
  // ------------------------------------------------------------------------------------------- undo and redo
  // Presses are queued, never dropped: five quick Cmd+Z are five undos, and a held key repeats.
  let chain = Promise.resolve();
  const step = (verb, component, skip = false) => (chain = chain.then(() => run(verb, component, skip)).catch(() => null));
  let toast;
  function showToast(message, verb, component) {
    toast ??= h('div', { id: 'undo-toast', role: 'status', 'data-nodrag': '1' }, h('span', { class: 'ut-msg' }), h('button', { type: 'button', id: 'undo-skip', text: 'Skip this step' }), h('button', { type: 'button', id: 'undo-dismiss', 'aria-label': 'Dismiss', text: '×' }));
    if (!toast.isConnected) document.querySelector('#stage').append(toast);
    toast.querySelector('.ut-msg').textContent = message;
    toast.querySelector('#undo-skip').onclick = () => { hideToast(); step(verb, component, true); };
    toast.querySelector('#undo-dismiss').onclick = hideToast;
    toast.hidden = false;
    clearTimeout(showToast.t); showToast.t = setTimeout(hideToast, 12000);
  }
  const hideToast = () => { if (toast) toast.hidden = true; };
  async function run(verb, component, skip) {
    const item = ctx.state.components.get(component || ctx.state.selection?.component);
    if (verb === 'undo' && item?.item) {
      const response = await ctx.fetch('/api/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: item.id }) });
      const result = await response.json();
      if (result.ok) { await ctx.kinds.load(); ctx.stage.render(item.id, true); ctx.emit('select', ctx.state.selection); }
      else ctx.hint(plain(result.error));
      return result;
    }
    const r = await ctx.fetch(component ? `/api/components/${encodeURIComponent(component)}/${verb}` : `/api/${verb}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(skip ? { skip: true } : {}) });
    const j = await r.json().catch(() => ({ ok: false, error: `${verb} failed (${r.status})` }));
    if (j.ok) { hideToast(); if (verb === 'undo') { const st = document.querySelector('#snap-toast'); if (st) st.hidden = true; } ctx.hint(`${j.skipped ? `Skipped "${j.skipped.summary}". ` : ''}${verb === 'undo' ? 'Undid' : 'Redid'}: ${(j.undone || j.redone)?.summary ?? 'your last edit'}`); }
    else if (j.refused) showToast(`Can't ${verb}: ${j.refused.by} changed ${j.refused.keys.join(', ')} in revision ${j.refused.revision}. Skip this step to ${verb} the one before it.`, verb, component ?? j.component);
    else { hideToast(); ctx.hint(/nothing to/i.test(j.error) ? plain(j.error) : `Can't ${verb}: ${plain(j.error)}`); }
    return j;
  }
  ctx.undo = () => step('undo'); ctx.redo = () => step('redo');

  addEventListener('input', (ev) => { if (ev.target.matches?.('input, textarea')) ev.target.dataset.dirty = '1'; }, true);
  addEventListener('change', (ev) => { if (ev.target.matches?.('input, textarea')) delete ev.target.dataset.dirty; }, true);
  addEventListener('blur', (ev) => { if (ev.target.matches?.('input, textarea')) delete ev.target.dataset.dirty; }, true);
  addEventListener('keydown', (ev) => {
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return;
    const k = ev.key.toLowerCase();
    const redo = (k === 'z' && ev.shiftKey) || (k === 'y' && ev.ctrlKey && !ev.shiftKey);
    const undo = k === 'z' && !ev.shiftKey;
    if (!undo && !redo) return;
    if (isTyping(ev.target)) return;
    ev.preventDefault();
    step(redo ? 'redo' : 'undo');
  });

  // ------------------------------------------------------------------------------------------- the History tab
  let pane, list, slider, who, flagText, confirmBox;
  const S = { component: null, rows: [], picked: null, mod: null, token: 0, unmounts: [], timer: 0 };
  const sectionOf = (id) => document.querySelector(`section.cmp[data-component="${CSS.escape(id)}"]`);
  const nameOf = (id) => ctx.state.components.get(id)?.name ?? id;

  function currentComponent() {
    return ctx.state.selection?.component ?? S.component ?? ctx.state.components.keys().next().value ?? null;
  }

  async function load() {
    const id = S.component;
    if (!id) { S.rows = []; draw(); return; }
    const r = await fetch(`/api/components/${encodeURIComponent(id)}/history?limit=200`).then((x) => x.json()).catch(() => null);
    if (id !== S.component || !r?.ok) return;
    S.rows = r.history;
    draw();
  }

  function setComponent(id) {
    if (id === S.component) return;
    exitPreview();
    S.component = id;
    if (who) who.value = id ?? '';
    load();
  }

  function draw() {
    if (!list) return;
    list.replaceChildren();
    const newest = S.rows[0]?.revision;
    for (const row of S.rows) {
      const li = h('li', { class: `hrow ${whoClass(row.by)}`, role: 'option', tabindex: '0', 'data-revision': String(row.revision), 'data-by': row.by, 'data-kind': row.kind ?? '', 'aria-selected': String(S.picked === row.revision), onclick: () => pick(row), onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(row); } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); (ev.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling)?.focus(); } } },
        h('span', { class: 'hdot', 'aria-hidden': 'true' }),
        h('span', { class: 'hwho', text: row.by }),
        h('span', { class: 'hsum', text: row.summary, title: row.keys?.length ? row.keys.join(', ') : '' }),
        row.approvedBy ? h('span', { class: 'happ', text: `approved by ${row.approvedBy}` }) : null,
        h('time', { class: 'hwhen', datetime: new Date(row.at).toISOString(), title: new Date(row.at).toLocaleString(), text: `${clock(row.at)} · ${ago(row.at)}` }),
        h('span', { class: 'hrev', text: `r${row.revision}${row.revision === newest ? ' · now' : ''}` }));
      if (row.revision === S.picked) li.classList.add('picked');
      list.append(li);
    }
    const n = S.rows.length;
    slider.max = String(Math.max(0, n - 1)); slider.value = String(S.picked === null ? n - 1 : n - 1 - S.rows.findIndex((r) => r.revision === S.picked));
    slider.disabled = n < 2;
    const live = S.picked === null || S.picked === newest;
    pane.querySelector('#h-restore').disabled = live;
    pane.querySelector('#h-back').disabled = live;
    flagText.textContent = live ? 'Showing the live component.' : `Previewing r${S.picked}, read-only. Restore makes one new revision.`;
  }

  async function pick(row) {
    S.picked = row.revision === S.rows[0]?.revision ? null : row.revision;
    draw();
    if (S.picked === null) exitPreview(); else await showPreview(row);
  }

  // The older state is drawn in a layer on top of every cell of the component; the live cells stay underneath, untouched.
  function clearLayers() { for (const u of S.unmounts) try { u(); } catch {} S.unmounts = []; for (const e of document.querySelectorAll('.preview-layer, .preview-flag')) e.remove(); for (const e of document.querySelectorAll('section.cmp[data-preview]')) delete e.dataset.preview; }
  function paintLayers(row) {
    const sec = sectionOf(S.component);
    if (!sec || !S.mod) return;
    clearLayers();
    sec.dataset.preview = String(row.revision);
    for (const cell of sec.querySelectorAll('.cell')) {
      const inner = h('div', { class: 'preview-inner' });
      cell.append(h('div', { class: 'preview-layer', 'aria-hidden': 'true' }, inner));
      let variant = {}; try { variant = JSON.parse(cell.dataset.variant); } catch {}
      try { S.unmounts.push(S.mod.mount(inner, variant)); } catch (e) { inner.textContent = `could not draw: ${e.message}`; }
    }
    sec.querySelector('.frame').append(h('div', { class: 'preview-flag', role: 'status', text: `Preview of r${row.revision} · ${row.by} · ${clock(row.at)} · read-only` }));
  }
  async function showPreview(row) {
    const token = ++S.token, id = S.component;
    const res = await fetch(`/bundle-at/${encodeURIComponent(id)}.js?revision=${encodeURIComponent(row.revision)}`);
    if (token !== S.token) return;
    if (!res.ok) { ctx.hint(plain((await res.json().catch(() => ({}))).error || 'could not draw that revision')); return; }
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    try { S.mod = await import(url); } finally { URL.revokeObjectURL(url); }
    if (token !== S.token) return;
    paintLayers(row);
    ctx.emit('preview', { component: id, revision: row.revision });
  }
  function exitPreview() {
    if (confirmBox) confirmBox.hidden = true;
    S.token++; S.mod = null; S.picked = null; clearLayers();
    if (list) draw();
    ctx.emit('preview', { component: S.component, revision: null });
  }

  // Restore replaces the whole file with an older state, so say first whose later work it takes back and ask for a click.
  async function askRestore() {
    if (S.picked === null) return;
    const rev = S.picked;
    const r = await fetch(`/api/components/${encodeURIComponent(S.component)}/restore-preview?revision=${encodeURIComponent(rev)}`).then((x) => x.json()).catch(() => null);
    const over = r?.overwrites ?? [];
    const by = new Map(); for (const o of over) by.set(o.by, (by.get(o.by) ?? 0) + 1);
    const names = [...by].map(([n, c]) => `${c} edit${c === 1 ? '' : 's'} by ${n}`).join(', ');
    confirmBox.replaceChildren(
      h('p', { class: 'hc-msg', text: over.length ? `Restoring r${rev} undoes ${over.length} later revision${over.length === 1 ? '' : 's'}: ${names}.` : `Restoring r${rev} changes nothing that came after it.` }),
      over.length ? h('ul', { class: 'hc-list' }, over.slice(-6).map((o) => h('li', { text: `r${o.revision} ${o.by}: ${o.summary}` })), over.length > 6 ? h('li', { text: `and ${over.length - 6} more` }) : null) : null,
      h('div', { class: 'hc-btns' }, h('button', { type: 'button', id: 'h-confirm-yes', class: 'primary', text: 'Restore anyway', onclick: () => { confirmBox.hidden = true; restore(); } }), h('button', { type: 'button', id: 'h-confirm-no', text: 'Cancel', onclick: () => { confirmBox.hidden = true; } })));
    confirmBox.hidden = false;
    confirmBox.querySelector('#h-confirm-no').focus();
  }
  async function restore() {
    if (S.picked === null) return;
    const id = S.component, rev = S.picked;
    const r = await ctx.fetch(`/api/components/${encodeURIComponent(id)}/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: rev }) });
    const j = await r.json().catch(() => ({ ok: false, error: 'restore failed' }));
    exitPreview();
    ctx.hint(j.ok ? (j.noop ? `Already the same as r${rev}` : `Restored r${rev} as r${j.revision}`) : `Can't restore: ${plain(j.error)}`);
  }

  function build(p) {
    pane = p; pane.classList.add('hist');
    who = h('select', { id: 'h-component', 'aria-label': 'Component', onchange: () => setComponent(who.value) });
    slider = h('input', { type: 'range', id: 'h-scrub', min: '0', max: '0', value: '0', 'aria-label': 'Scrub through revisions, oldest to newest', oninput: () => { clearTimeout(S.timer); S.timer = setTimeout(() => { const row = S.rows[S.rows.length - 1 - Number(slider.value)]; if (row) pick(row); }, 40); } });
    flagText = h('span', { class: 'h-flag', id: 'h-flag', role: 'status' });
    list = h('ol', { id: 'h-list', role: 'listbox', 'aria-label': 'Revisions, newest first' });
    pane.append(
      h('div', { class: 'h-bar' },
        who,
        h('button', { type: 'button', id: 'h-undo', title: 'Undo your last edit (⌘Z)', text: 'Undo', onclick: () => step('undo', S.component) }),
        h('button', { type: 'button', id: 'h-redo', title: 'Redo (⇧⌘Z)', text: 'Redo', onclick: () => step('redo', S.component) }),
        h('label', { class: 'h-scrub' }, h('span', { text: 'older' }), slider, h('span', { text: 'now' })),
        h('button', { type: 'button', id: 'h-back', text: 'Back to now', onclick: () => exitPreview() }),
        h('button', { type: 'button', id: 'h-restore', class: 'primary', text: 'Restore this', onclick: askRestore }),
        flagText),
      confirmBox = h('div', { id: 'h-confirm', role: 'alertdialog', 'aria-label': 'Confirm restore', hidden: true }),
      list);
  }
  const fillComponents = () => {
    if (!who) return;
    const cur = S.component;
    who.replaceChildren(...[...ctx.state.components.values()].sort((a, b) => a.name.localeCompare(b.name)).map((c) => h('option', { value: c.component, text: c.name })));
    if (cur) who.value = cur;
  };
  drawer.add('history', 'History', { build, onOpen() { fillComponents(); const id = currentComponent(); if (id !== S.component) setComponent(id); else load(); } });

  ctx.on('select', (s) => { if (drawer.active === 'history' && s && s.component !== S.component) { fillComponents(); setComponent(s.component); } });
  ctx.on('change', (f) => {
    if (drawer.active !== 'history' || f.component !== S.component) return;
    load();
  });
  ctx.on('render', ({ component }) => { if (S.picked !== null && component === S.component && S.mod) { const row = S.rows.find((r) => r.revision === S.picked); if (row) paintLayers(row); } });
  ctx.on('removed', ({ component }) => { if (component === S.component) { S.component = null; exitPreview(); fillComponents(); } });
  setInterval(() => { if (drawer.active === 'history') for (const t of document.querySelectorAll('#h-list time')) { const row = S.rows.find((r) => String(r.revision) === t.closest('li').dataset.revision); if (row) t.textContent = `${clock(row.at)} · ${ago(row.at)}`; } }, 15000);
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.picked !== null && !ev.target.closest?.('input, select, textarea')) { ev.stopPropagation(); exitPreview(); } }, true);
  ctx.history = { show: (id) => { drawer.open('history'); if (id) setComponent(ctx.find(id)?.component ?? id); }, preview: pick, state: S, restore, ask: askRestore, exit: exitPreview };
}
