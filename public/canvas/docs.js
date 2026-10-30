// The document engine's components on the canvas (decision 0014): every HTML file of the folder is a component, drawn
// as the browser draws it (doc-frames.js). This module keeps them in ctx.state.components (kind 'html', no dialect
// doc), follows the engine's frames (doc-change, doc-files, doc-styles) and asks once which stylesheets apply when the
// files use variables nothing they load defines. The answer is kept by the server, outside the folder.
//   initDocs(ctx) -> { load(), styles }   call load() before the first stage.render pass
import { docsChanged } from './doc-panel.js';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const getJson = async (path) => { const r = await fetch(path); return r.ok ? r.json() : null; };

export function initDocs(ctx) {
  const api = { styles: null, files: [] };
  ctx.docs = api;
  const isDoc = (id) => ctx.state.components.get(id)?.kind === 'html';

  async function load() {
    const [files, layout, styles] = await Promise.all([getJson('/api/files'), getJson('/api/layout'), getJson('/api/styles')]);
    api.files = files?.files || []; api.styles = styles;
    const seen = new Set();
    for (const f of api.files) {
      if (f.kind !== 'html') continue;
      for (const c of f.components) {
        seen.add(c.id);
        const prev = ctx.state.components.get(c.id);
        const saved = layout?.frames?.[c.id];
        ctx.state.components.set(c.id, { ...(prev || {}), component: c.id, name: c.name, path: f.path, kind: 'html', revision: f.revision, doc: null, canvas: prev?.canvas || (saved && saved.x !== undefined ? { x: saved.x, y: saved.y } : { x: 0, y: 0 }), width: prev?.width ?? saved?.width });
      }
    }
    return seen;
  }
  api.load = load;

  // A file changed (an edit by anyone, or a save in an editor): redraw every frame it reaches.
  ctx.on('doc-change', (f) => {
    docsChanged();
    for (const id of f.affects || []) {
      const c = ctx.state.components.get(id);
      if (!c || c.kind !== 'html') continue;
      if (c.path === f.path) c.revision = f.revision;
      ctx.stage.render(id).catch(console.error);
    }
    if (f.path?.endsWith('.css')) refreshStyles();
  });
  ctx.on('doc-files', async () => {
    const before = new Set([...ctx.state.components.values()].filter((c) => c.kind === 'html').map((c) => c.component));
    const seen = await load();
    for (const id of seen) if (!before.has(id)) { ctx.stage.render(id).catch(console.error); ctx.emit('added', { component: id }); }
    for (const id of before) if (!seen.has(id)) { ctx.stage.remove(id); ctx.state.components.delete(id); ctx.emit('removed', { component: id }); }
  });
  ctx.on('doc-styles', async () => {
    docsChanged();
    await refreshStyles();
    for (const c of ctx.state.components.values()) if (c.kind === 'html') ctx.stage.render(c.component).catch(console.error);
  });
  async function refreshStyles() { api.styles = await getJson('/api/styles'); ask(); }

  // ---------- ask once ----------
  function ask() {
    const s = api.styles;
    let box = $('#ask-styles');
    if (!s || s.answered || !s.undefinedVars?.length) { box?.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'ask-styles'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'ask-styles-title'); box.dataset.nodrag = '1'; $('#stage').append(box); }
    const css = api.files.filter((f) => f.kind === 'css').map((f) => f.path);
    const pick = new Set(s.pick || []);
    const order = [...(s.pick || []), ...css.filter((p) => !pick.has(p))];
    const shown = s.undefinedVars.slice(0, 4).map((v) => `<code>${esc(v)}</code>`).join(', ') + (s.undefinedVars.length > 4 ? ` and ${s.undefinedVars.length - 4} more` : '');
    const why = new Map((s.suggest || []).map((x) => [x.path, [x.defines && `defines ${x.defines}`, x.styles && `styles ${x.styles} class${x.styles === 1 ? '' : 'es'}`].filter(Boolean).join(', ')]));
    box.innerHTML = `<h2 id="ask-styles-title">Which stylesheets do these components share?</h2>
      <p>The components use ${s.undefinedVars.length} CSS variable${s.undefinedVars.length === 1 ? '' : 's'} that nothing they load defines (${shown}). Pick the folder's stylesheets that apply to every component, the way its host page loads them. napkin remembers the answer outside the folder.</p>
      <ul>${order.map((p) => `<li><label><input type="checkbox" value="${esc(p)}"${pick.has(p) ? ' checked' : ''}> <code>${esc(p)}</code>${why.get(p) ? ` <span class="why">${esc(why.get(p))}</span>` : ''}</label></li>`).join('')}</ul>
      <p class="actions"><button type="button" id="ask-styles-apply" class="primary">Apply</button> <button type="button" id="ask-styles-none">None of these</button></p>`;
    const send = async (applied) => {
      const r = await ctx.fetch('/api/styles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applied }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) { ctx.hint(j.error || `Could not save the answer (${r.status})`); return; }
      box.remove();
    };
    box.querySelector('#ask-styles-apply').onclick = () => send(order.filter((p) => box.querySelector(`input[value="${CSS.escape(p)}"]`).checked));
    box.querySelector('#ask-styles-none').onclick = () => send([]);
  }
  api.ask = ask;
  return api;
}
