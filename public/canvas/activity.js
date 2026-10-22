// AGT-09 on the page: the Activity tab. Every apply, create, rename, delete, undo and file change, by who, with the summary and the time.
// Rows arrive live from the change frames (well inside 200 ms of the edit) after one read of GET /api/activity. Click a row (or Enter) to
// select and fly to its node. Agents have their presence colour; you, file and git are neutral.
import { h } from './drawer.js';
import { nodeOfEdit, variantGrid } from '/src/model.js';

const pad = (n) => String(n).padStart(2, '0');
const clock = (at) => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const ago = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 5 ? 'now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const PEOPLE = new Set(['you', 'file', 'git', 'unknown']);
const MAX = 200;

export function initActivity(ctx, drawer) {
  const S = { rows: [], agentsOnly: false, perf: [] };
  let pane, list, onlyBox;

  const rowOf = (x) => ({ at: x.at ?? Date.now(), kind: x.kind ?? 'change', how: x.how ?? 'edit', component: x.component, name: x.name, by: x.by ?? 'unknown', summary: x.summary ?? '', revision: x.revision, node: x.node ?? null, approvedBy: x.approvedBy, color: x.color, ink: x.ink });
  function add(row, fresh) {
    if (row.kind === 'added' && /^renamed /.test(row.summary)) return; // the rename's own change row says it
    S.rows.unshift(row);
    if (S.rows.length > MAX) S.rows.length = MAX;
    if (row.color) ctx.presence?.remember?.(row.by, row.color, row.ink);
    if (list) draw(fresh ? row : null);
  }

  function dot(r) {
    const col = r.color ? r : ctx.presence?.colorOf?.(r.by) ?? {};
    return h('span', { class: 'adot', style: col.color ? `--c:${col.color};--ink:${col.ink}` : '', text: r.by === 'file' ? '▤' : r.by === 'git' ? '⎇' : r.by[0] ?? '?', 'aria-hidden': 'true' });
  }
  function draw(fresh) {
    if (!list) return;
    const rows = S.agentsOnly ? S.rows.filter((r) => !PEOPLE.has(r.by)) : S.rows;
    const focused = document.activeElement?.closest?.('.arow')?.dataset.key;
    list.replaceChildren(...(rows.length ? rows.map((r) => {
      const key = `${r.at}|${r.component}|${r.revision}|${r.by}`;
      const name = ctx.state.components.get(r.component)?.name ?? r.name ?? r.component;
      const li = h('li', { class: 'arow', role: 'option', tabindex: '0', 'data-key': key, 'data-by': r.by, 'data-kind': r.kind, 'data-how': r.how, 'data-component': r.component, 'data-node': r.node ?? '', 'data-revision': r.revision ?? '', 'data-fresh': r === fresh ? '1' : '0',
        title: 'Select and fly to this change', onclick: () => focusRow(r), onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); focusRow(r); } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); (ev.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling)?.focus(); } } },
        dot(r), h('span', { class: 'awho', text: r.by }),
        h('span', { class: 'asum', text: r.summary, title: r.summary }, r.approvedBy ? h('span', { class: 'aapp', text: `approved by ${r.approvedBy}` }) : null),
        h('span', { class: 'awhere', text: `${name}${r.node ? ' · ' + r.node : ''}${r.revision ? ' · r' + String(r.revision).slice(0, 7) : ''}` }),
        h('time', { datetime: new Date(r.at).toISOString(), title: new Date(r.at).toLocaleString(), text: `${clock(r.at)} · ${ago(r.at)}` }));
      return li;
    }) : [h('li', { class: 'empty', text: S.agentsOnly ? 'No agent has done anything yet.' : 'Nothing has happened yet.' })]));
    if (focused) list.querySelector(`.arow[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    pane.dataset.count = String(rows.length);
  }

  function focusRow(r) {
    const c = ctx.state.components.get(r.component);
    if (!c) { ctx.hint(`${r.name ?? 'That component'} is gone`); return; }
    ctx.stage.live?.(c.component);
    if (!c.doc) { const rect = ctx.stage.componentRect?.(c.component); if (rect) ctx.view.flyTo(rect, { pad: 96, max: 1.5 }); return; }
    const node = r.node && (function find(n) { return n.id === r.node ? n : n.children.map(find).find(Boolean); })(c.doc.root) ? r.node : c.doc.root.id;
    const variant = variantGrid(c.doc)[0];
    ctx.select({ component: c.component, node, variant });
    const rect = ctx.stage.nodeRect?.({ component: c.component, node, variant }) ?? ctx.stage.componentRect?.(c.component);
    if (rect) ctx.view.flyTo(rect, { pad: 140, max: 2 });
    ctx.emit('activity-focus', { component: c.component, node });
  }

  async function load() {
    const r = await fetch('/api/activity?limit=200').then((x) => x.json()).catch(() => null);
    if (!r?.ok) return;
    const seen = new Set(S.rows.map((x) => `${x.component}|${x.revision}|${x.by}|${x.kind}`));
    const older = r.activity.map(rowOf).filter((x) => !(x.kind === 'added' && /^renamed /.test(x.summary))).filter((x) => !seen.has(`${x.component}|${x.revision}|${x.by}|${x.kind}`));
    S.rows = [...S.rows, ...older].sort((a, b) => b.at - a.at).slice(0, MAX);
    draw();
  }

  function build(p) {
    pane = p; pane.classList.add('act');
    onlyBox = h('input', { type: 'checkbox', id: 'a-agents-only', onchange: () => { S.agentsOnly = onlyBox.checked; draw(); } });
    list = h('ul', { id: 'a-list', role: 'listbox', 'aria-label': 'Activity, newest first' });
    pane.append(h('div', { class: 'act-bar' }, h('label', {}, onlyBox, h('span', { text: 'Agents only' })), h('span', { text: 'Click a row to focus its node.' })), list);
  }
  drawer.add('activity', 'Activity', { build, onOpen() { load(); } });

  // live: frames from the server. t0 is when the frame reached the page, for the 200 ms test.
  ctx.on('change', (f) => { const t = performance.now(); add(rowOf({ ...f, kind: 'change', how: f.kind, node: nodeOfEdit(f.edits?.[0]) }), true); S.perf.push({ revision: f.revision, component: f.component, ms: performance.now() - t, at: Date.now(), editedAt: f.at }); if (S.perf.length > 50) S.perf.shift(); });
  ctx.on('added', (f) => add(rowOf({ kind: 'added', component: f.component, name: f.name, by: f.by ?? 'file', summary: f.summary ?? 'file appeared', revision: f.revision }), true));
  ctx.on('removed', (f) => add(rowOf({ kind: 'removed', component: f.component, name: ctx.state.components.get(f.component)?.name, by: f.by ?? 'file', summary: f.summary ?? 'file removed' }), true));
  setInterval(() => { if (drawer.active === 'activity') for (const t of list.querySelectorAll('time')) { const at = Date.parse(t.dateTime); t.textContent = `${clock(at)} · ${ago(at)}`; } }, 15000);
  ctx.activity = { rows: () => S.rows, focusRow, load, perf: S.perf, ago };
  load();
}
