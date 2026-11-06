// CMP-05: slots on the canvas. An element that shows a ReactNode prop (`{children}`, `{icon}`) is drawn as a drop zone:
// a dashed outline and the slot's name while it is empty, so you can see where content goes. Drop text on it (or type in
// the panel's Preview field) and the words show in every cell. The words are the slot's preview and live in the sidecar
// (POST /api/components/:id/slot-preview), never in the .tsx.
import { plain } from './words.js';
import { index } from '/src/model.js';

export function initSlots(ctx) {
  function mark(id) {
    const c = ctx.state.components.get(id), sec = document.querySelector(`section.cmp[data-component="${CSS.escape(id)}"]`);
    if (!c?.doc || !sec) return;
    const slotted = [...index(c.doc).byId.values()].filter((n) => n.slot);
    if (!slotted.length) return;
    for (const mount of sec.querySelectorAll('.cell .mount')) {
      for (const n of slotted) {
        const el = mount.querySelector(`[data-n="${CSS.escape(n.id)}"]`);
        if (!el) continue; // hidden by its condition in this cell
        const text = c.slots?.[n.slot];
        el.dataset.slot = n.slot;
        if (text) delete el.dataset.empty; else el.dataset.empty = '1';
      }
    }
  }
  ctx.on('render', ({ component }) => mark(component));

  async function setPreview(component, prop, text) {
    const r = await (await ctx.fetch(`/api/components/${encodeURIComponent(component)}/slot-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prop, text }) })).json();
    if (!r.ok) ctx.hint(plain(r.error));
    return r;
  }
  const world = document.querySelector('#world');
  world.addEventListener('dragover', (ev) => { if (ev.target.closest?.('.mount [data-slot]') && [...(ev.dataTransfer?.types || [])].includes('text/plain')) { ev.preventDefault(); ev.target.closest('[data-slot]').classList.add('slot-hot'); } });
  world.addEventListener('dragleave', (ev) => ev.target.closest?.('[data-slot]')?.classList.remove('slot-hot'));
  world.addEventListener('drop', (ev) => {
    const zone = ev.target.closest?.('.mount [data-slot]');
    if (!zone) return;
    ev.preventDefault(); zone.classList.remove('slot-hot');
    const text = ev.dataTransfer.getData('text/plain').trim().split('\n')[0].slice(0, 500);
    if (text) setPreview(zone.closest('section.cmp').dataset.component, zone.dataset.slot, text);
  });
  ctx.slots = { setPreview, mark };
}
