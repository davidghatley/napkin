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
//   ctx.menu / ctx.layers                   the context menu (context-menu.js); the layers tree's rows (layers.js)
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
import { initComponentOps } from './component-ops.js';
import { initQuick } from './quick.js';
import { initReadOnly } from './readonly.js';
import { initEmpty } from './empty.js';
import { initShortcuts } from './shortcuts.js';
import { initNav } from './nav.js';
import { initEditOps } from './edit-ops.js';
import { initFrameOps } from './frame-ops.js';
import { initHandles } from './handles.js';
import { initTokens } from './tokens.js';
import { initHistoryLane } from './history-lane.js';
import { plain } from './words.js';
import { variantGrid } from '/src/model.js';
import { initMatrix } from './matrix.js';
import { initPlay } from './play.js';
import { initTabs } from './tabs.js';
import { initInstances } from './instances.js';
import { initSlots } from './slots.js';
import { initAgentsLane } from './agents-lane.js';
import { initDocs } from './docs.js';
import { initTimeStrip } from './time-strip.js';
import { initCopyCode } from './copy-code.js';
import { initLive } from './stage-live.js';
import { initHighlight } from './stage-highlight.js';
import { initLegend } from './legend.js';
import { initStylesTab } from './styles-tab.js';
import { initWidths } from './stage-ruler.js';
import { initTheme } from './stage-theme.js';
import { initChrome } from './stage-chrome.js';
import { initBreakpoints } from './stage-breakpoints.js';
import { initInspector } from './doc-panel.js';
import { initKinds } from './kinds.js';
import { initInstruments } from './surface-panel.js';
import { initSurface } from './commands.js';
import { initShell } from './shell.js';
import { initContextMenu } from './context-menu.js';
import { initRightPanel } from './right-panel.js';
import { initCreate } from './create.js';
import { initTextEdit } from './text-edit.js';
import { initMakeComponent } from './make-component.js';

const $ = (s) => document.querySelector(s);
const client = await connectCanvas(location.origin + '/');

const handlers = new Map();
// The toast says it in plain words; the raw store message stays in the panel's inline errors.
const keyOf = (s) => `${s.component}|${s.node}`;
// A whole card (a file item, or a component picked as one card) can be selected together with other cards; elements stay within one component.
const isCard = (s) => s.card || s.node === "item";
const nameCounts = new Map(), nameById = new Map(), idsByName = new Map();
// Components are the files napkin has always drawn (the TSX dialect and the document engine). File items (any other kind,
// public/canvas/kinds.js) live in the same map for get/has/set/delete, but iteration and size see components only, so every
// existing loop keeps its meaning. all() and total are the whole canvas.
class ComponentMap extends Map {
  items = new Map();
  set(k, v) { if (v?.item) this.items.set(k, v); else super.set(k, v); return this; }
  get(k) { return super.get(k) ?? this.items.get(k); }
  has(k) { return super.has(k) || this.items.has(k); }
  delete(k) { return this.items.delete(k) || super.delete(k); }
  all() { return [...super.values(), ...this.items.values()]; }
  get total() { return this.size + this.items.size; }
}
const ctx = {
  state: { components: new ComponentMap(), selection: null, selections: [], tool: 'select', zoom: 1 },
  select(selection) { ctx.selectMany(selection ? [selection] : []); },
  selectMany(list) {
    const seen = new Set();
    list = list.filter((s) => !seen.has(keyOf(s)) && seen.add(keyOf(s)));
    if (list.length && !list.every(isCard) && list.some((s) => s.component !== list[0].component)) list = list.filter((s) => s.component === list.at(-1).component);
    ctx.state.selections = list;
    ctx.state.selection = list.at(-1) ?? null;
    ctx.emit('select', ctx.state.selection);
  },
  toggle(sel) {
    const cur = ctx.state.selections;
    if (cur.some((s) => keyOf(s) === keyOf(sel))) ctx.selectMany(cur.filter((s) => keyOf(s) !== keyOf(sel)));
    else if (cur.length && cur[0].component !== sel.component && !(isCard(sel) && cur.every(isCard))) { ctx.selectMany([sel]); ctx.hint('Selection stays within one component'); }
    else ctx.selectMany([...cur, sel]);
  },
  fetch: (path, init) => client.fetch(path, init), // fetch with this page's session (identity "you"); use for any /api write
  async sendEdits(component, edits, opts = {}) {
    ctx.lastEditAt = performance.now(); // an edit through the element panel is newer than any instrument change before it
    const c = ctx.state.components.get(component);
    const r = await client.sendEdits(component, ctx.clash?.base(component) ?? c.revision, edits); // clash.js: the revision you saw when you began on the field
    ctx.clash?.sent(component, r);
    if (!r.ok && r.stale?.length) ctx.emit('stale', { component, edits, result: r }); // a clash chip shows both values (AGT-10)
    $('#error').textContent = r.ok || r.stale?.length || opts.quiet ? '' : plain(r.error); // a form says it beside its field (quiet): one message, not two
    return r;
  },
  hint(text) { const h = $('#hint'); h.textContent = plain(text); clearTimeout(ctx._hint); ctx._hint = setTimeout(() => { h.textContent = ''; }, 3200); },
  // two components with one name show their paths (the dialect's names are counted as they arrive; the engine's are counted here)
  title(c) { return c.path && (nameCounts.get(c.name) > 1 || (c.kind === 'html' && [...ctx.state.components.values()].filter((x) => x.name === c.name).length > 1)) ? `${c.name} · ${c.path.replace(/#.*$/, '')}` : c.name; },
  named(name) { return [...(idsByName.get(name) || [])].map(id => ctx.state.components.get(id)).filter(Boolean); },
  // The file a canvas card stands for, as /api/items names it (its id is its path): what the instruments and the board speak of.
  itemOf(id) { const c = ctx.state.components.get(id); if (!c) return null; if (c.item) return id; const p = String(c.path || "").replace(/#.*$/, ""); if (!p) return id; const m = [...(ctx.docs?.enginePaths || [])].find((e) => e === p || e.endsWith("/" + p)); return m || p; },
  find(idOrName) { return ctx.state.components.get(idOrName) ?? ctx.state.components.all().find((c) => c.name === idOrName); },
  on(event, cb) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(cb); return () => handlers.get(event).delete(cb); },
  emit(event, payload) { for (const cb of handlers.get(event) || []) cb(payload); },
};
window.napkin = ctx; // for tests and the console

// --- chrome theme: follows the system until the toggle is used ---
{
  const root = document.documentElement, btn = $('#theme-toggle');
  const effective = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = () => { const t = `Switch to ${effective() === 'dark' ? 'light' : 'dark'} chrome`; btn.setAttribute('aria-label', t); btn.dataset.tip = t; };
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
initContextMenu(ctx); // right-click menus (standards section 8); first, so an open menu hears the keys before the canvas does
initLive(ctx); // M1: Space-P holds play mode (registered before play.js so it sees P first)
initLegend(ctx);
initHighlight(ctx); // M3: napkin.stage.highlight({ selector, file } | { variable }) (before nav: Escape clears it first)
initTools(ctx);
initCreate(ctx); // basics pass 2: draw a frame, text or image on the canvas or into an HTML frame (create.js)
initTextEdit(ctx); // edit text in an HTML frame again, in place; F2 renames a card from its label (before nav: Enter on text edits it)
initMakeComponent(ctx); // basics pass 3: an element selected in an HTML frame becomes a component file (make-component.js)
initShell(ctx); // the chrome tooltip and the left panel's collapse (basics pass 1)
initRightPanel(ctx); // the right panel's resizable left edge (basics, b-panel)
initEditOps(ctx);
initFrameOps(ctx); // a frame as an object: nudge, resize, delete and duplicate its file, each one undo step (frame-ops.js)
initComponentOps(ctx); // WPC-28: rename and delete a component (Cmd-K, F2, row menu)
initLayers(ctx, $('#layers'));
initQuick(ctx);
initInstruments(ctx); // the one instrument panel (dials) for whatever is selected
initSurface(ctx); // commands, bindings, spatial focus, board state (commands.js)
initShortcuts(ctx);
window.napkinEarly?.replay(); // keys pressed before this point (early.js) now reach the palette and the key map
initReadOnly(ctx);
const nav = initNav(ctx);
initHandles(ctx);
initMatrix(ctx); // CMP-10: filter chips and collapsible groups on big matrices
initPlay(ctx); // CMP-09: P makes the cells live
initStylesTab(ctx); // the sidebar's Styles tab
initBreakpoints(ctx); // M4: the breakpoints panel and the widths strip
initWidths(ctx); // M4: next / previous breakpoint, back to 640 px
initTheme(ctx); // M5: the theme wipe
initChrome(ctx); // M11: Tab hides every bit of chrome
initTabs(ctx); // WPC-07: cell content stays out of the Tab order outside play mode
initInstances(ctx); // CMP-04, 06..08: composition
initSlots(ctx); // CMP-05: slot drop zones
initHistoryLane(ctx); // drawer: code strip, history, inspect, assets, changes
await initTokens(ctx); // token source, theme preview and Tokens drawer
ctx.on('token-preview', () => { if (ctx.state.selection) { renderPanel(ctx); stage.refreshOverlays(); } });
initTimeStrip(ctx);   // moment 9: the film strip of a component's versions (H)
initCopyCode(ctx);    // moment 10: Cmd-C gives the file's own HTML/JSX and CSS; Cmd-V inserts it
initAgentsLane(ctx);  // presence, proposals tray + ghost cells, Activity tab, clash chip
ctx.on('select', () => { $('#revision').parentElement.hidden = !ctx.state.selection; renderPanel(ctx); });
// #revision shows 8 characters (the frame title shows 7); the full revision is its tooltip
ctx.on('render', ({ component, revision }) => { $('#revision').parentElement.hidden = !ctx.state.selection; $('#revision').textContent = String(revision).slice(0, 8); $('#revision').title = `revision ${revision}`; if (!ctx.state.selection || ctx.state.selection.component === component) renderPanel(ctx); counts(); });

const claimedIds = new Set(), seenIds = new Set();
const sync = id => {
  if (!id) return;
  const s = client.state(id), old = nameById.get(id);
  if (old !== s?.name) {
    if (old) { nameCounts.set(old, nameCounts.get(old) - 1); idsByName.get(old)?.delete(id); nameById.delete(id); }
    if (s) { nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1); nameById.set(id, s.name); if (!idsByName.has(s.name)) idsByName.set(s.name, new Set()); idsByName.get(s.name).add(id); }
  }
  // A file is drawn once: the engine's frame takes over a dialect file it claims (read-only, or a build that failed). docs.js decides.
  const claimed = !!ctx.docs?.claims(s);
  if (s && !claimed) ctx.state.components.set(id, s); else { ctx.state.components.delete(id); if (claimed) ctx.stage?.remove(id); }
  if (ctx.docs && (claimed !== claimedIds.has(id) || (s && !claimed && !seenIds.has(id)))) { if (claimed) claimedIds.add(id); else { if (claimedIds.delete(id) && s) ctx.docs.release(s); } ctx.docs.reconcileSoon(); }
  s ? seenIds.add(id) : seenIds.delete(id);
};

function counts() {
  // WPC-35: counted from the documents, not from the cells on screen (frames far off screen are not drawn), so zoom never changes it
  let cells = 0; for (const c of ctx.state.components.values()) if (c.doc) cells += variantGrid(c.doc).length;
  const n = ctx.state.components.size;
  $('#counts').textContent = `${n} component${n === 1 ? '' : 's'}${cells ? ` · ${cells} variant${cells === 1 ? '' : 's'}` : ''}`;
}

// (The sidebar's change log is on hold since basics pass 1: who changed what is in the Activity drawer, and changes against git in Changes.)

client.onChange((f) => {
  sync(f.component);
  if (f.type === 'progress') { ctx.state.progress = f; $('#scan-progress').textContent = f.done ? '' : `Scanning components… ${f.scanned} / ${f.total}`; ctx.emit('progress', f); }
  else if (f.type === 'tokens') { ctx.emit('tokens', f); }
  else if (f.type === 'change') { stage.render(f.component).catch(console.error); ctx.emit('change', f); }
  else if (f.type === 'problem') { if (ctx.state.components.has(f.component) && !stage.sections.has(f.component)) stage.render(f.component).catch(console.error); else stage.header(f.component); ctx.emit('problem', f); }
  else if (f.type === 'added') { counts(); stage.render(f.component).catch(console.error); ctx.emit('added', f); }
  else if (f.type === 'preview') { ctx.emit('preview', f); }
  else if (f.type === 'connection') { document.body.dataset.connection = f.connected ? 'ok' : 'lost'; ctx.emit('connection', f); }
  else if (f.type === 'slots') { stage.render(f.component, true).catch(console.error); }
  else if (f.type === 'build') { if (f.cause && f.ok) stage.render(f.component, true).catch(console.error); } // a component this one shows was edited: draw it again
  else if (f.type === 'canvas') { const p = stage.position(f.component); if (!p || p.x !== f.canvas.x || p.y !== f.canvas.y) { stage.moveTo(f.component, f.canvas.x, f.canvas.y); stage.refreshOverlays(); } }
  else if (f.type === 'folder') { location.reload(); } // another folder was opened in this napkin
  else if (f.type === 'agents') { $('#agent-status').hidden = !f.count; $('#agent-status').textContent = f.count > 1 ? `${f.count} agents connected` : 'agent connected'; ctx.emit('agents', f); }
  else if (f.type === 'presence') ctx.emit('presence', f); // presence.js
  else if (f.type === 'proposal' || f.type === 'proposal-resolved') ctx.emit(f.type, f); // proposals.js
  else if (f.type === 'removed') { stage.remove(f.component); ctx.emit('removed', f); renderPanel(ctx); counts(); }
  else if (typeof f.type === 'string' && f.type.startsWith('doc-')) ctx.emit(f.type, f); // the document engine (docs.js)
  else if (f.type === 'item-change' || f.type === 'items-changed') ctx.emit(f.type, f);
});

for (const c of client.components()) sync(c.component);
const docs = initDocs(ctx);
initInspector(ctx); // the inspector's scope keys, measuring and checks (doc-panel.js)
await docs.load(); // the folder's HTML components (decision 0014), drawn with the rest
await initKinds(ctx).load();
const drawn = Promise.all(ctx.state.components.all().map((c) => c.component).map((id) => stage.render(id).catch(console.error)));
// A big folder is laid out as soon as the cards exist; frames still loading are given room by their estimate and settle into it.
if (ctx.state.components.total > 150) await Promise.race([drawn, new Promise((r) => setTimeout(r, 100))]); else await drawn;
stage.layoutAll();
nav.restore();
renderPanel(ctx);
counts();
initEmpty(ctx, $('#stage'));
$('#revision').parentElement.hidden = !ctx.state.selection;
document.body.dataset.ready = '1';
try { if (sessionStorage.getItem('napkin.focusFirst')) { sessionStorage.removeItem('napkin.focusFirst'); const c = document.querySelector('#world [data-item-id]'); if (c) { if (!c.hasAttribute('tabindex')) c.tabIndex = -1; c.focus({ preventScroll: true, focusVisible: true }); } } } catch {} // after Open folder, focus starts on the first card
docs.ask();
