// The document engine's components on the canvas (decision 0014): every HTML file of the folder is a component, drawn
// as the browser draws it (doc-frames.js). This module keeps them in ctx.state.components (kind 'html', no dialect
// doc), follows the engine's frames (doc-change, doc-files, doc-styles) and asks once which stylesheets apply when the
// files use variables nothing they load defines. The answer is kept by the server, outside the folder.
//   initDocs(ctx) -> { load(), styles }   call load() before the first stage.render pass
import { docsChanged } from './doc-panel.js';
import { plain } from './words.js';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const getJson = async (path) => { const r = await fetch(path); return r.ok ? r.json() : null; };

export function initDocs(ctx) {
  const api = { styles: null, files: [], skipped: [] };
  ctx.docs = api;
  // A file is drawn once. The TSX dialect (variants, settings) keeps the files it can read and edit; every other .tsx/.jsx
  // file (className or inline styles, a default export, a syntax error, an import that does not build) is drawn by the
  // engine as its /view page, like an HTML file. `forced` holds dialect files whose bundle failed: they move over too.
  api.forced = new Set();
  api.enginePaths = new Set(); // .tsx/.jsx files the engine can draw (from the last load)
  const isDialect = (c) => c && c.kind !== 'html';
  // The dialect's paths are relative to the folder it opened (often a components/ folder inside the one the engine opened):
  // a dialect file is the engine file whose path ends with its own. The shared prefix is learned from the unambiguous ones.
  const prefixes = new Set();
  const candidates = (c) => [...api.enginePaths].filter((p) => p === c.path || p.endsWith('/' + c.path));
  const learn = () => { for (const c of ctx.state.components.values()) if (isDialect(c) && c.path) { const m = candidates(c); if (m.length === 1) prefixes.add(m[0].slice(0, m[0].length - c.path.length)); } };
  const engineOf = (c) => { if (!c?.path) return null; const m = candidates(c); return m.length === 1 ? m[0] : m.find((p) => prefixes.has(p.slice(0, p.length - c.path.length))) ?? null; };
  api.claims = (s) => { if (!s || !isDialect(s)) return false; const p = engineOf(s); return !!p && (!!s.readOnly || api.forced.has(p)); };
  // the dialect can read this file again (an adoption was accepted, a hand edit was fixed): its own cell takes over from the engine's frame at once
  api.release = (s) => {
    const p = engineOf(s);
    if (!p || api.forced.has(p)) return;
    for (const [id, c] of [...ctx.state.components]) if (c.kind === 'html' && c.path === p && c.fileKind !== 'html') { ctx.stage.remove(id); ctx.state.components.delete(id); ctx.emit('removed', { component: id }); }
  };
  api.takeOver = (id) => {
    const s = ctx.state.components.get(id), p = isDialect(s) && engineOf(s);
    if (!p) return false;
    api.forced.add(p);
    api.reconcile().catch(console.error);
    return true;
  };

  async function load() {
    const [files, layout, styles] = await Promise.all([getJson('/api/files?kinds=html,css,tsx,jsx'), getJson('/api/layout'), getJson('/api/styles')]);
    api.files = files?.files || []; api.styles = styles;
    api.skipped = api.files.filter((f) => f.noComponent).map((f) => ({ path: f.path, note: f.noComponent })); // files that export no component: no frame, but the layers list them
    api.enginePaths = new Set(api.files.filter((f) => f.kind === 'tsx' || f.kind === 'jsx').map((f) => f.path));
    learn();
    for (const [id, c] of [...ctx.state.components]) if (api.claims(c)) { ctx.state.components.delete(id); ctx.stage?.remove(id); } // a file never appears twice
    const mine = new Set([...ctx.state.components.values()].filter((c) => isDialect(c)).map(engineOf).filter(Boolean));
    const scanning = !!ctx.state.progress && !ctx.state.progress.done; // the dialect is still reading the folder: wait to see which files are its
    const seen = new Set();
    for (const f of api.files) {
      if (f.kind === 'css' || (f.kind !== 'html' && (mine.has(f.path) || scanning))) continue; // a dialect file the dialect draws (or may be about to)
      for (const c of f.components) {
        seen.add(c.id);
        const prev = ctx.state.components.get(c.id);
        const saved = layout?.frames?.[c.id];
        ctx.state.components.set(c.id, { ...(prev || {}), component: c.id, name: c.name, path: f.path, kind: 'html', fileKind: f.kind, revision: f.revision, doc: null, canvas: prev?.canvas || (saved && saved.x !== undefined ? { x: saved.x, y: saved.y } : { x: 0, y: 0 }), width: prev?.width ?? saved?.width });
      }
    }
    return seen;
  }
  api.load = load;
  // The folder's files changed (or a dialect file moved between the two ways of drawing): draw what is new, drop what is gone.
  async function reconcile() {
    const before = new Set([...ctx.state.components.values()].filter((c) => c.kind === 'html').map((c) => c.component));
    const seen = await load();
    for (const id of seen) if (!before.has(id)) { ctx.stage.render(id).catch(console.error); ctx.emit('added', { component: id }); }
    for (const id of before) if (!seen.has(id)) { ctx.stage.remove(id); ctx.state.components.delete(id); ctx.emit('removed', { component: id }); }
    for (const id of ctx.state.components.keys()) if (!ctx.stage.sections.has(id)) ctx.stage.render(id).catch(console.error); // a dialect file the engine gave back
  }
  api.reconcile = reconcile;
  let soon = 0; // many files can arrive at once (a branch switch): look once, after the dialect has said which are its own
  api.reconcileSoon = () => { clearTimeout(soon); soon = setTimeout(() => reconcile().catch(console.error), 200); };
  ctx.on('progress', (p) => { if (p.done) api.reconcileSoon(); });

  // A file changed (an edit by anyone, or a save in an editor): redraw every frame it reaches.
  // Frames reload beside the old document (so an edit never flashes): at most DOC_BATCH at a time, so a change that reaches every frame never has twice as many iframes in the page.
  const BATCH = 6, queue = new Set();
  let running = false;
  function redraw(id) {
    queue.add(id);
    if (running) return;
    running = true;
    (async () => {
      while (queue.size) {
        const batch = [...queue].slice(0, BATCH);
        for (const id of batch) queue.delete(id);
        await Promise.all(batch.map((id) => ctx.stage.render(id).catch(console.error)));
      }
      running = false;
    })();
  }
  ctx.on('doc-change', (f) => {
    docsChanged();
    // (the server names the components an HTML or CSS file reaches; a JSX file reaches the components it holds)
    const hit = new Set(f.affects || []);
    for (const c of ctx.state.components.values()) if (c.kind === 'html' && c.path === f.path) hit.add(c.component);
    for (const id of hit) {
      const c = ctx.state.components.get(id);
      if (!c || c.kind !== 'html') continue;
      if (c.path === f.path) c.revision = f.revision;
      redraw(id);
    }
    if (f.path?.endsWith('.css')) refreshStyles();
  });
  ctx.on('doc-files', () => api.reconcileSoon());
  ctx.on('doc-styles', async () => {
    docsChanged();
    await refreshStyles();
    for (const c of ctx.state.components.values()) if (c.kind === 'html') redraw(c.component);
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
      if (!r.ok || j.ok === false) { ctx.hint(plain(j.error || `Could not save the answer (${r.status})`)); return; }
      box.remove();
    };
    box.querySelector('#ask-styles-apply').onclick = () => send(order.filter((p) => box.querySelector(`input[value="${CSS.escape(p)}"]`).checked));
    box.querySelector('#ask-styles-none').onclick = () => send([]);
  }
  api.ask = ask;
  return api;
}
