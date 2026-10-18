// The canvas page. Uses the same canvas-client as the tests; renders with the shared renderer.
import { connectCanvas } from '/src/canvas-client.js';
import { renderNode } from '/src/render.js';

const $ = (s) => document.querySelector(s);
const FIELDS = { padding: ['card', 'padding'], fontWeight: ['title', 'fontWeight'] };
const find = (node, id) => node.id === id ? node : (node.children || []).map((c) => find(c, id)).find(Boolean);

const client = await connectCanvas(location.origin + '/');

function show({ revision, doc }, flash) {
  $('#stage').innerHTML = renderNode(doc.root);
  $('#revision').textContent = revision;
  for (const [field, [id, prop]] of Object.entries(FIELDS)) {
    const input = $('#' + field);
    if (!input.dataset.dirty) input.value = find(doc.root, id)?.style?.[prop] ?? '';
  }
  if (flash) $('#stage > *')?.classList.add('flash');
}

function note(c) {
  const li = document.createElement('li');
  li.className = 'by-' + c.by;
  li.textContent = `r${c.revision} ${c.by}: ` + (c.edits ? c.edits.map((e) => `${e.path ?? e.op} = ${JSON.stringify(e.value)}`).join(', ') : 'file changed on disk');
  $('#log').prepend(li);
}

show(client.state());
client.onChange((c) => { show(c, !c.mine); note(c); });

for (const [field, [id, prop]] of Object.entries(FIELDS)) {
  // Only an input with unsaved typing is protected from incoming changes.
  $('#' + field).addEventListener('input', (ev) => { ev.target.dataset.dirty = '1'; });
  $('#' + field).addEventListener('change', async (ev) => {
    delete ev.target.dataset.dirty;
    const raw = ev.target.value.trim();
    const value = prop === 'fontWeight' && /^\d+$/.test(raw) ? Number(raw) : raw;
    const r = await client.sendEdits(client.state().revision, [{ op: 'set', path: `${id}.${prop}`, value }]);
    $('#error').textContent = r.ok ? '' : r.error;
    if (!r.ok) show(client.state());
  });
}
document.body.dataset.ready = '1';
