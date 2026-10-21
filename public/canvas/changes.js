// HIS-05 and INS-05 on the page. A dot in a component's title when its file differs from git HEAD, and the Changes tab: the
// line diff against HEAD and before/after pictures of every cell that changed (unchanged cells are hidden).
// napkin only reads git; it never commits, stages or checks out.
import { h } from './drawer.js';

export function initChanges(ctx, drawer) {
  const S = { git: false, changed: new Map(), picked: null, token: 0 };
  let pane, listEl, diffEl, picsEl, titleEl, timer = 0;

  async function refresh() {
    const r = await fetch('/api/git').then((x) => x.json()).catch(() => null);
    if (!r?.ok) return;
    S.git = r.git; S.changed = new Map(r.components.map((c) => [c.component, c.state]));
    for (const sec of document.querySelectorAll('section.cmp')) {
      const title = sec.querySelector('.cmp-title'); if (!title) continue;
      let dot = title.querySelector('.git-dot');
      const st = S.changed.get(sec.dataset.component);
      if (!st) { dot?.remove(); delete sec.dataset.git; continue; }
      if (!dot) { dot = h('i', { class: 'git-dot', role: 'img' }); title.querySelector('h3')?.after(dot); }
      dot.dataset.state = st; dot.setAttribute('aria-label', `${st === 'added' ? 'New, not in git yet' : 'Changed since the last commit'}`); dot.title = st === 'added' ? 'New since HEAD (not committed)' : 'Changed since HEAD (not committed)';
      sec.dataset.git = st;
    }
    if (drawer.active === 'changes') drawList();
    ctx.emit('git', { changed: [...S.changed] });
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };

  function drawList() {
    listEl.replaceChildren();
    if (!S.git) { listEl.append(h('li', { class: 'empty', text: 'This folder is not in a git repository.' })); return; }
    if (!S.changed.size) { listEl.append(h('li', { class: 'empty', text: 'Nothing differs from HEAD.' })); diffEl.textContent = ''; picsEl.replaceChildren(); titleEl.textContent = ''; return; }
    for (const [id, st] of S.changed) {
      const name = ctx.state.components.get(id)?.name ?? id;
      listEl.append(h('li', {}, h('button', { type: 'button', class: 'chg', 'data-component': id, 'aria-pressed': String(S.picked === id), onclick: () => show(id) }, h('i', { class: 'git-dot', 'data-state': st, 'aria-hidden': 'true' }), h('span', { text: name }), h('small', { text: st }))));
    }
    if (!S.picked || !S.changed.has(S.picked)) show([...S.changed.keys()][0]);
  }

  const diffLines = (text) => text.split('\n').map((l) => h('div', { class: `dl ${l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'dm' : l.startsWith('@@') ? 'dh' : l.startsWith('+') ? 'da' : l.startsWith('-') ? 'dd' : ''}`, text: l || ' ' }));

  async function show(id) {
    S.picked = id; const token = ++S.token;
    for (const b of listEl.querySelectorAll('.chg')) b.setAttribute('aria-pressed', String(b.dataset.component === id));
    const name = ctx.state.components.get(id)?.name ?? id;
    titleEl.textContent = `${name} against HEAD`;
    diffEl.replaceChildren(h('div', { class: 'dl', text: 'Reading the diff…' })); picsEl.replaceChildren(h('p', { class: 'p-note', text: 'Drawing the changed cells…' }));
    const d = await fetch(`/api/components/${encodeURIComponent(id)}/diff`).then((x) => x.json()).catch(() => null);
    if (token !== S.token) return;
    diffEl.replaceChildren(...(d?.diff ? diffLines(d.diff) : [h('div', { class: 'dl', text: 'No line changes.' })]));
    const v = await fetch(`/api/components/${encodeURIComponent(id)}/visual-diff`).then((x) => x.json()).catch(() => null);
    if (token !== S.token) return;
    picsEl.replaceChildren();
    if (!v?.ok) { picsEl.append(h('p', { class: 'p-note', text: v?.error ?? 'Could not draw the comparison.' })); return; }
    picsEl.dataset.changed = String(v.cells.length); picsEl.dataset.total = String(v.total);
    picsEl.append(h('p', { class: 'p-note', id: 'v-note', text: v.cells.length ? `${v.cells.length} of ${v.total} cells changed. ${v.unchanged} unchanged cell${v.unchanged === 1 ? ' is' : 's are'} hidden.` : `No cell looks different (${v.total} checked).` }));
    for (const c of v.cells) {
      const name = Object.entries(c.variant).map(([k, x]) => `${k}=${x}`).join(' · ') || 'default';
      picsEl.append(h('figure', { class: `pair ${c.status}`, 'data-variant': JSON.stringify(c.variant), 'data-status': c.status },
        h('div', { class: 'pics' },
          c.before ? h('div', { class: 'pic' }, h('img', { src: c.before, alt: `Before, ${name}` }), h('span', { text: 'before' })) : h('div', { class: 'pic none' }, h('span', { text: 'not in HEAD' })),
          c.after ? h('div', { class: 'pic' }, h('img', { src: c.after, alt: `After, ${name}` }), h('span', { text: 'after' })) : h('div', { class: 'pic none' }, h('span', { text: 'removed' }))),
        h('figcaption', { text: `${name} · ${c.status}` })));
    }
  }

  function build(p) {
    pane = p; pane.classList.add('changes');
    listEl = h('ul', { id: 'chg-list', class: 'chg-list', 'aria-label': 'Components that differ from HEAD' });
    titleEl = h('h3', { class: 'chg-title', id: 'chg-title' });
    diffEl = h('div', { class: 'diff', id: 'chg-diff', role: 'region', tabindex: '0', 'aria-label': 'Line diff against HEAD' });
    picsEl = h('div', { class: 'pics-wrap', id: 'chg-pics' });
    pane.append(listEl, h('div', { class: 'chg-main' }, titleEl, h('div', { class: 'chg-cols' }, diffEl, picsEl)));
  }
  drawer.add('changes', 'Changes', { build, key: '⌘⇧G', onOpen: async () => { await refresh(); drawList(); if (S.picked && S.changed.has(S.picked)) show(S.picked); } });
  ctx.on('change', later); ctx.on('added', later); ctx.on('removed', later);
  ctx.on('render', later);
  addEventListener('keydown', (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 'g' && !ev.target.closest?.('input, textarea')) { ev.preventDefault(); drawer.toggle('changes'); } });
  ctx.changes = { refresh, state: S, show };
  refresh();
}
