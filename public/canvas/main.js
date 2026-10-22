// The canvas page. Plain DOM modules for the editor chrome; React only renders components.
//
// The shared `ctx` every module receives (owned here; panel.js, stage.js, layers.js, quick.js, nav.js and tools.js use it):
//   ctx.state = {
//     components: Map<componentId, { component, name, canvas, revision, doc, readOnly?, problem? }>,  // kept current
//     selection:  null | { component, node, variant },   // the primary selection (the last one picked); variant is { axis: value } of the clicked cell
//     selections: [{ component, node, variant }],        // every selected node, all in one component; selection is the last of them
//     tool:       'select',                                // set by initTools
//     zoom:       1,                                       // the canvas scale (view.js); tools divide pointer distances by it
//   }
//   ctx.select(selection | null)            one selection (or none); emits 'select'
//   ctx.selectMany(list)                    several (same component); the last is the primary
//   ctx.toggle(selection)                   shift-click: add or remove one
//   ctx.fetch(path, init)                   fetch carrying the page's session token (identity "you"); needed for any /api write
//   ctx.sendEdits(component, edits)         POST a batch on that component's current revision -> { ok, revision, doc } | { ok: false, error }
//   ctx.on(event, cb) -> off()              events: 'select' | 'change' (frame) | 'problem' (frame) | 'added' | 'removed' | 'render' ({ component, revision })
//                                           | 'tool' | 'view' ({x,y,z}) | 'layout' | 'moved' ({component,x,y}) | 'focus' ({component|null})
//   ctx.emit(event, payload)                for modules that raise their own events
//   ctx.view / ctx.stage / ctx.nav          viewport, stage and focus APIs
//   ctx.ops                                 wrap / unwrap / duplicate / copy / paste (edit-ops.js); ctx.handles: direct manipulation (handles.js)
//
// Page conventions (the tests rely on these): body[data-ready="1"] once every component has drawn;
// #revision = the revision of the component drawn last; section.cmp[data-component][data-revision][data-ready]
// per component; every rendered element keeps its data-n. See test/CONTRACT.md.
import { connectCanvas } from '/src/canvas-client.js';
import { createView } from './view.js';
import { createStage } from './stage.js';
import { renderPanel } from './panel.js';
import { initTools } from './tools.js';
import { initLayers } from './layers.js';
import { initQuick } from './quick.js';
import { initReadOnly } from './readonly.js';
import { initEmpty } from './empty.js';
import { initShortcuts } from './shortcuts.js';
import { initNav } from './nav.js';
import { initEditOps } from './edit-ops.js';
import { initHandles } from './handles.js';
import { initHistoryLane } from './history-lane.js';
import { initMatrix } from './matrix.js';
import { initPlay } from './play.js';

const $ = (s) => document.querySelector(s);
const client = await connectCanvas(location.origin + '/');

const handlers = new Map();
// The toast says it in plain words; the raw store message stays in the panel's inline errors.
const plain = (e) => (/^invalid edit #\d+: id ".*" already exists/.test(e) ? 'That id is already used' : e.replace(/^invalid edit #\d+: /, ''));
const keyOf = (s) => `${s.component}|${s.node}`;
const nameCounts = new Map(), nameById = new Map(), idsByName = new Map();
const ctx = {
  state: { components: new Map(), selection: null, selections: [], tool: 'select', zoom: 1 },
  select(selection) { ctx.selectMany(selection ? [selection] : []); },
  selectMany(list) {
    const seen = new Set();
    list = list.filter((s) => !seen.has(keyOf(s)) && seen.add(keyOf(s)));
    if (list.length && list.some((s) => s.component !== list[0].component)) list = list.filter((s) => s.component === list.at(-1).component);
    ctx.state.selections = list;
    ctx.state.selection = list.at(-1) ?? null;
    ctx.emit('select', ctx.state.selection);
  },
  toggle(sel) {
    const cur = ctx.state.selections;
    if (cur.some((s) => keyOf(s) === keyOf(sel))) ctx.selectMany(cur.filter((s) => keyOf(s) !== keyOf(sel)));
    else if (cur.length && cur[0].component !== sel.component) { ctx.selectMany([sel]); ctx.hint('Selection stays within one component'); }
    else ctx.selectMany([...cur, sel]);
  },
  fetch: (path, init) => client.fetch(path, init), // fetch with this page's session (identity "you"); use for any /api write
  async sendEdits(component, edits) {
    const c = ctx.state.components.get(component);
    const r = await client.sendEdits(component, c.revision, edits);
    $('#error').textContent = r.ok ? '' : plain(r.error);
    return r;
  },
  hint(text) { const h = $('#hint'); h.textContent = text; clearTimeout(ctx._hint); ctx._hint = setTimeout(() => { h.textContent = ''; }, 3200); },
  title(c) { return nameCounts.get(c.name) > 1 && c.path ? `${c.name} · ${c.path}` : c.name; },
  named(name) { return [...(idsByName.get(name) || [])].map(id => ctx.state.components.get(id)).filter(Boolean); },
  find(idOrName) { return ctx.state.components.get(idOrName) ?? [...ctx.state.components.values()].find((c) => c.name === idOrName); },
  on(event, cb) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(cb); return () => handlers.get(event).delete(cb); },
  emit(event, payload) { for (const cb of handlers.get(event) || []) cb(payload); },
};
window.napkin = ctx; // for tests and the console

// --- chrome theme: follows the system until the toggle is used ---
{
  const root = document.documentElement, btn = $('#theme-toggle');
  const effective = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = () => { btn.setAttribute('aria-label', `Switch to ${effective() === 'dark' ? 'light' : 'dark'} chrome`); };
  btn.addEventListener('click', () => {
    root.dataset.theme = effective() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('napkin.theme', root.dataset.theme); } catch {}
    label();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  label();
}

const view = createView(ctx, $('#stage'), $('#world'));
const stage = createStage(ctx, $('#stage'), $('#world'), view);
Object.assign(ctx, { view, stage });
initTools(ctx);
initEditOps(ctx);
initLayers(ctx, $('#layers'));
initQuick(ctx);
initShortcuts(ctx);
initReadOnly(ctx);
const nav = initNav(ctx);
initHandles(ctx);
initMatrix(ctx); // CMP-10: filter chips and collapsible groups on big matrices
initPlay(ctx); // CMP-09: P makes the cells live
initHistoryLane(ctx); // drawer: code strip, history, inspect, assets, changes
ctx.on('select', () => { $('#revision').parentElement.hidden = !ctx.state.selection; renderPanel(ctx); });
ctx.on('render', ({ component, revision }) => { $('#revision').parentElement.hidden = !ctx.state.selection; $('#revision').textContent = revision; renderPanel(ctx); counts(); });

const sync = id => {
  if (!id) return;
  const s = client.state(id), old = nameById.get(id);
  if (old !== s?.name) {
    if (old) { nameCounts.set(old, nameCounts.get(old) - 1); idsByName.get(old)?.delete(id); nameById.delete(id); }
    if (s) { nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1); nameById.set(id, s.name); if (!idsByName.has(s.name)) idsByName.set(s.name, new Set()); idsByName.get(s.name).add(id); }
  }
  s ? ctx.state.components.set(id, s) : ctx.state.components.delete(id);
};

function counts() {
  const cells = document.querySelectorAll('.cell').length, n = ctx.state.components.size;
  $('#counts').textContent = `${n} component${n === 1 ? '' : 's'} · ${cells} variant${cells === 1 ? '' : 's'}`;
}

// The change log has a fixed number of rows that are rewritten in place, so a new entry never moves the rows (FEEL-04).
const LOG_ROWS = 6, logRows = [];
for (let i = 0; i < LOG_ROWS; i++) { const li = document.createElement('li'); logRows.push(li); $('#log').append(li); }
function note(c) {
  $('#changes-placeholder').hidden = true;
  const name = ctx.state.components.get(c.component)?.name ?? c.component;
  for (let i = LOG_ROWS - 1; i > 0; i--) { logRows[i].className = logRows[i - 1].className; logRows[i].textContent = logRows[i - 1].textContent; }
  logRows[0].className = 'by-' + c.by;
  logRows[0].textContent = `${name} r${String(c.revision).slice(0, 7)} ${c.by}: ` + (c.edits ? c.edits.map((e) => e.path ? `${e.path} = ${JSON.stringify(e.value)}` : `${e.op} ${e.node?.id ?? e.id ?? ''}`.trim()).join(', ') : 'file changed on disk');
}

client.onChange((f) => {
  sync(f.component);
  if (f.type === 'progress') { ctx.state.progress = f; $('#scan-progress').textContent = f.done ? '' : `Scanning components… ${f.scanned} / ${f.total}`; ctx.emit('progress', f); }
  else if (f.type === 'change') { stage.render(f.component).catch(console.error); ctx.emit('change', f); note(f); }
  else if (f.type === 'problem') { stage.header(f.component); ctx.emit('problem', f); }
  else if (f.type === 'added') { counts(); stage.render(f.component).catch(console.error); ctx.emit('added', f); }
  else if (f.type === 'preview') { ctx.emit('preview', f); }
  else if (f.type === 'canvas') { const p = stage.position(f.component); if (!p || p.x !== f.canvas.x || p.y !== f.canvas.y) { stage.moveTo(f.component, f.canvas.x, f.canvas.y); stage.refreshOverlays(); } }
  else if (f.type === 'agents') { $('#agent-status').hidden = !f.count; $('#agent-status').textContent = f.count > 1 ? `${f.count} agents connected` : 'agent connected'; }
  else if (f.type === 'presence') {
    const sec = document.querySelector(`section.cmp[data-component="${f.component}"]`);
    if (sec) { if (f.label) sec.dataset.presence = f.label; else delete sec.dataset.presence; }
    const all = [...document.querySelectorAll('section.cmp[data-presence]')].map((s) => s.dataset.presence);
    $('#presence').textContent = all.join(' · ');
  }
  else if (f.type === 'removed') { stage.remove(f.component); ctx.emit('removed', f); renderPanel(ctx); counts(); }
});

for (const c of client.components()) sync(c.component);
await Promise.all([...ctx.state.components.keys()].map((id) => stage.render(id).catch(console.error)));
stage.layoutAll();
nav.restore();
renderPanel(ctx);
counts();
initEmpty(ctx, $('#stage'));
$('#revision').parentElement.hidden = !ctx.state.selection;
document.body.dataset.ready = '1';
