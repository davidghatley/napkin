// The canvas page. Plain DOM modules for the editor chrome; React only renders components.
//
// The shared `ctx` every module receives (owned here; panel.js, stage.js and tools.js use it):
//   ctx.state = {
//     components: Map<componentId, { component, name, revision, doc, readOnly?, problem? }>,  // kept current
//     selection:  null | { component, node, variant },   // variant is { axis: value } of the clicked grid cell
//     tool:       'select',                                // set by initTools (M4 adds more)
//   }
//   ctx.select(selection | null)            sets state.selection and emits 'select'
//   ctx.sendEdits(component, edits)         POST a batch on that component's current revision -> { ok, revision, doc } | { ok: false, error }
//   ctx.on(event, cb) -> off()              events: 'select' (selection) | 'change' (frame) | 'problem' (frame) | 'added' | 'removed' | 'render' ({ component, revision }) | 'tool'
//   ctx.emit(event, payload)                for modules that raise their own events
//
// Page conventions (the tests rely on these): body[data-ready="1"] once every component has drawn;
// #revision = the revision of the component drawn last; section.cmp[data-component][data-revision][data-ready]
// per component; every rendered element keeps its data-n.
import { connectCanvas } from '/src/canvas-client.js';
import { createStage } from './stage.js';
import { renderPanel } from './panel.js';
import { initTools } from './tools.js';

const $ = (s) => document.querySelector(s);
const client = await connectCanvas(location.origin + '/');

const handlers = new Map();
const ctx = {
  state: { components: new Map(), selection: null, tool: 'select' },
  select(selection) { ctx.state.selection = selection; ctx.emit('select', selection); },
  async sendEdits(component, edits) {
    const c = ctx.state.components.get(component);
    const r = await client.sendEdits(component, c.revision, edits);
    $('#error').textContent = r.ok ? '' : r.error;
    return r;
  },
  on(event, cb) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(cb); return () => handlers.get(event).delete(cb); },
  emit(event, payload) { for (const cb of handlers.get(event) || []) cb(payload); },
};

const stage = createStage(ctx, $('#stage'));
initTools(ctx);
ctx.on('select', () => renderPanel(ctx));
ctx.on('render', ({ component, revision }) => { $('#revision').textContent = revision; renderPanel(ctx); });

const sync = (id) => { const s = client.state(id); s ? ctx.state.components.set(id, s) : ctx.state.components.delete(id); };

function note(c) {
  const li = document.createElement('li');
  const name = ctx.state.components.get(c.component)?.name ?? c.component;
  li.className = 'by-' + c.by;
  li.textContent = `${name} r${c.revision} ${c.by}: ` + (c.edits ? c.edits.map((e) => `${e.path ?? e.op} = ${JSON.stringify(e.value)}`).join(', ') : 'file changed on disk');
  $('#log').prepend(li);
}

client.onChange((f) => {
  sync(f.component);
  if (f.type === 'change') { stage.render(f.component).catch(console.error); ctx.emit('change', f); note(f); }
  else if (f.type === 'problem') { stage.header(f.component); ctx.emit('problem', f); }
  else if (f.type === 'added') { stage.render(f.component).catch(console.error); ctx.emit('added', f); }
  else if (f.type === 'removed') { stage.remove(f.component); ctx.emit('removed', f); renderPanel(ctx); }
});

for (const c of client.components()) sync(c.component);
await Promise.all([...ctx.state.components.keys()].map((id) => stage.render(id).catch(console.error)));
renderPanel(ctx);
document.body.dataset.ready = '1';
