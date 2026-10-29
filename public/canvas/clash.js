// AGT-10 on the page (decision N4: keep "stale revision", and show a clash chip with both values).
// You start editing a field (focus, or a scrub); while you do, someone changes the same property. When you commit, the store refuses
// your edit as stale and says what the property holds now and who changed it. This puts a chip on that property in the panel:
// "yours 12 · scout's 16 (already saved)", with one click "Use mine" (re-sends yours on the current revision) or "Keep theirs".
// To make that race real, the edit is sent against the revision you SAW when you started on the field (not the newest one).
//   ctx.clash = { base(component), sent(component, result), list(), useMine(key), keepTheirs(key) }
import { h } from './drawer.js';

const fmt = (v) => (v === null || v === undefined ? 'nothing' : typeof v === 'string' ? v : JSON.stringify(v));
const editKey = (e) => (e?.op === 'set' ? (e.variant ? `${e.path}@${Object.entries(e.variant).map(([a, v]) => `${a}=${v}`).join(',')}` : e.path) : null);
const parseKey = (key) => { const m = /^([^.:@\s]+)\.([A-Za-z]+)(?:@(.+))?$/.exec(key); return m ? { node: m[1], prop: m[2], variant: m[3] ?? null } : null; };
const LABEL = (prop) => prop.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export function initClash(ctx) {
  const panel = document.querySelector('#panel');
  const S = { clashes: new Map(), base: new Map(), inserting: false };

  // ---- the revision you saw when you started on a field ----
  const mark = (field, pointer) => {
    const s = ctx.state.selection, c = s && ctx.state.components.get(s.component);
    if (!c) return;
    const cur = S.base.get(s.component);
    if (cur && cur.field === field && cur.node === s.node) { if (pointer) cur.pointer = true; return; }
    S.base.set(s.component, { rev: c.revision, field, node: s.node, pointer: !!pointer });
  };
  panel.addEventListener('focusin', (ev) => { if (ev.target.matches?.('input, select, textarea')) mark(ev.target.id); });
  panel.addEventListener('pointerdown', (ev) => { const l = ev.target.closest?.('label.scrub'); if (l) mark(l.dataset.scrub || l.htmlFor, true); });
  addEventListener('pointerup', () => { for (const b of S.base.values()) if (b.pointer) setTimeout(() => { b.pointer = false; if (!panel.contains(document.activeElement)) for (const [k, v] of S.base) if (v === b) S.base.delete(k); }, 600); });
  panel.addEventListener('focusout', (ev) => {
    const s = ctx.state.selection; if (!s) return;
    setTimeout(() => { const b = S.base.get(s.component); if (b && !b.pointer && !panel.contains(document.activeElement)) S.base.delete(s.component); }, 250);
  });
  ctx.on('select', () => { S.base.clear(); place(); });

  // main.js asks here for the base revision of a send, and tells us the result.
  const base = (component) => {
    const b = S.base.get(component), s = ctx.state.selection;
    // an old base would make your own earlier edits of the same property look like someone else's: after any write of yours, send on the current revision
    return b && s?.component === component && (b.pointer || panel.contains(document.activeElement)) ? b.rev : undefined;
  };
  const sent = (component, r) => {
    const b = S.base.get(component);
    if (b && r.ok && (b.pointer || panel.contains(document.activeElement))) b.rev = r.revision; // your own edit moved the revision on: the next send on this field starts from it
    else if (b) S.base.delete(component);
  };

  // ---- the chip ----
  ctx.on('stale', ({ component, edits, result }) => {
    for (const s of result.stale ?? []) {
      const edit = edits.find((e) => editKey(e) === s.key) ?? null;
      S.clashes.set(`${component}|${s.key}`, { component, key: s.key, theirs: s.value, yours: s.yours, by: s.by ?? 'someone', revision: s.revision, edit, edits });
    }
    place();
    ctx.emit('clash', { component, keys: (result.stale ?? []).map((s) => s.key) });
  });
  ctx.on('change', (f) => { const b0 = S.base.get(f.component); if (f.by === 'you' && b0 && b0.rev !== f.revision) S.base.delete(f.component); // revisions are opaque hashes: a write of yours that sent() did not follow drops the old base
    // a newer write of the same key by anyone settles the clash
    if (!f.edits) return;
    for (const e of f.edits) { const k = editKey(e); if (k && S.clashes.delete(`${f.component}|${k}`)) place(); }
  });
  ctx.on('removed', ({ component }) => { for (const k of [...S.clashes.keys()]) if (k.startsWith(component + '|')) S.clashes.delete(k); place(); });

  function chip(c) {
    const pk = parseKey(c.key);
    const label = pk ? LABEL(pk.prop) : c.key;
    return h('div', { class: 'clash-chip', role: 'group', 'data-key': c.key, 'data-prop': pk?.prop ?? '', 'aria-label': `Clash on ${label}` },
      h('div', { class: 'cc-text' }, h('b', { text: `${label}: ` }), 'yours ', h('code', { class: 'cc-yours', text: fmt(c.yours) }), ` · ${c.by}'s `, h('code', { class: 'cc-theirs-val', text: fmt(c.theirs) }), ' ', h('span', { class: 'cc-landed', text: '(already saved)' })),
      h('button', { type: 'button', class: 'cc-mine', title: `Write ${fmt(c.yours)} on top of ${c.by}'s change`, text: 'Use mine', onclick: () => useMine(c.component + '|' + c.key) }),
      h('button', { type: 'button', class: 'cc-theirs', title: `Keep ${c.by}'s value`, text: 'Keep theirs', onclick: () => keepTheirs(c.component + '|' + c.key) }));
  }
  function place() {
    if (S.inserting) return;
    S.inserting = true;
    try {
      for (const e of panel.querySelectorAll('.clash-chip')) e.remove();
      const s = ctx.state.selection;
      if (!s) return;
      for (const c of S.clashes.values()) {
        if (c.component !== s.component) continue;
        const pk = parseKey(c.key);
        if (pk && pk.node !== s.node) continue;
        const input = pk && panel.querySelector('#' + CSS.escape(pk.prop));
        const row = input?.closest('.f');
        for (const er of (row ?? panel).querySelectorAll(`.field-error[id^="err-style-"]`)) if (/stale/.test(er.textContent)) er.remove(); // the chip says it better
        const body = input?.closest('.sbody'); // the top of the property's own section, full width (a row is too narrow for two values and two buttons)
        if (body) body.prepend(chip(c));
        else { const head = panel.querySelector('.selhead'); if (head) head.after(chip(c)); else panel.prepend(chip(c)); }
      }
    } finally { S.inserting = false; obs.takeRecords(); } // our own insertions are not news
  }
  const obs = new MutationObserver(() => { if (!S.inserting && S.clashes.size) place(); });
  obs.observe(panel, { childList: true, subtree: true });

  async function useMine(id) {
    const c = S.clashes.get(id);
    if (!c) return null;
    S.base.delete(c.component);
    const r = await ctx.sendEdits(c.component, c.edit ? [c.edit] : c.edits);
    if (r.ok) { S.clashes.delete(id); ctx.hint(`Applied yours (${fmt(c.yours)}) on top of ${c.by}'s change`); place(); ctx.emit('clash-resolved', { key: c.key, choice: 'mine', revision: r.revision }); }
    return r;
  }
  function keepTheirs(id) {
    const c = S.clashes.get(id);
    if (!c) return;
    S.clashes.delete(id);
    const pk = parseKey(c.key), input = pk && panel.querySelector('#' + CSS.escape(pk.prop));
    if (input) { input.value = typeof c.theirs === 'string' ? c.theirs.replace(/px$/, '') : fmt(c.theirs); input.dispatchEvent(new Event('input', { bubbles: true })); } // the draft you typed is replaced by theirs
    place();
    ctx.emit('clash-resolved', { key: c.key, choice: 'theirs' });
  }
  ctx.clash = { base, sent, list: () => [...S.clashes.values()], useMine, keepTheirs, state: S };
}
