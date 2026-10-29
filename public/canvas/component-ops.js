// WPC-28: a person renames and deletes a component on the canvas, with the same engine operations agents use
// (POST /api/components/:id/rename, DELETE /api/components/:id). Reached from Cmd-K ("Rename component…", "Delete component…"),
// F2 on a selected component or a component row in the layers tree, and the "More actions" menu on that row.
// Delete says what uses the component (the engine refuses while anything does), and is undoable: this module keeps the source
// and the frame position, and Undo (the toast button, or Cmd/Ctrl+Z straight after) writes the file back.
import { checkName, engineSentence, plain } from './words.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable;
const json = (body) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export function initComponentOps(ctx) {
  const dialog = document.createElement('dialog');
  dialog.id = 'cmp-dialog'; dialog.setAttribute('aria-labelledby', 'cmp-dialog-title');
  document.body.append(dialog);
  const toast = document.createElement('div');
  toast.id = 'cmp-toast'; toast.setAttribute('role', 'status'); toast.hidden = true;
  toast.innerHTML = '<span class="ut-msg"></span><button type="button" id="cmp-undo">Undo</button><button type="button" id="cmp-toast-dismiss" aria-label="Dismiss">×</button>';
  document.body.append(toast);
  let deleted = null, previous = null, timer = null;

  const nameOf = (id) => ctx.state.components.get(id)?.name ?? id;
  const showToast = (msg, undo) => {
    toast.querySelector('.ut-msg').textContent = msg; toast.querySelector('#cmp-undo').hidden = !undo; toast.hidden = false;
    clearTimeout(timer); timer = setTimeout(() => { toast.hidden = true; }, 12000);
  };
  toast.querySelector('#cmp-toast-dismiss').onclick = () => { toast.hidden = true; };

  function openDialog(html) {
    previous = document.activeElement;
    dialog.innerHTML = html;
    if (!dialog.open) { document.body.dataset.modal = 'component'; dialog.showModal(); }
  }
  dialog.addEventListener('close', () => { delete document.body.dataset.modal; if (previous?.isConnected) previous.focus?.({ preventScroll: true }); });
  const close = () => { if (dialog.open) dialog.close(); };

  function pick(id) { // the component to act on: the one asked for, else the selected one
    const c = ctx.state.components.get(id ?? ctx.state.selection?.component);
    if (!c) ctx.hint('Select a component first, then try again.');
    return c;
  }

  function rename(id) {
    const c = pick(id);
    if (!c) return false;
    if (c.readOnly) { ctx.hint(`${c.name} is read-only (${String(c.readOnly).replace(/\.$/, '')}), so it can't be renamed here. Rename it in your editor.`); return false; }
    openDialog(`<form method="dialog" id="cmp-rename" autocomplete="off"><h2 id="cmp-dialog-title">Rename ${esc(c.name)}</h2>
      <p>The file, the exported function and its Props type change together. Where it sits on the canvas stays.</p>
      <label>New name <input id="cmp-name" aria-label="New component name" value="${esc(c.name)}" spellcheck="false"></label>
      <p id="cmp-error" role="alert"></p>
      <div class="cmp-btns"><button type="button" id="cmp-cancel">Cancel</button><button type="submit" id="cmp-ok" class="primary">Rename</button></div></form>`);
    const input = dialog.querySelector('#cmp-name'), err = dialog.querySelector('#cmp-error');
    input.focus(); input.select();
    dialog.querySelector('#cmp-cancel').onclick = close;
    const others = [...ctx.state.components.values()].filter((x) => x !== c).map((x) => x.name);
    dialog.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const to = input.value.trim();
      if (to === c.name) { close(); return; }
      const bad = checkName('component', to, others);
      if (bad) { err.textContent = bad; input.focus(); return; }
      const res = await ctx.fetch(`/api/components/${encodeURIComponent(c.component)}/rename`, { method: 'POST', ...json({ name: to }) });
      const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
      if (!r.ok) {
        err.textContent = /needs a saved component identity/.test(r.error) ? 'Renaming needs napkin to save this component\'s identity. Reopen the folder with --write-sidecars, then try again.' : engineSentence('component', r.error, to);
        input.focus(); return;
      }
      close();
      ctx.hint(`Renamed ${c.name} to ${r.name}`);
    };
    return true;
  }

  async function remove(id) {
    const c = pick(id);
    if (!c) return false;
    if (c.readOnly) { ctx.hint(`${c.name} is read-only (${String(c.readOnly).replace(/\.$/, '')}), so it can't be deleted here. Delete the file in your editor.`); return false; }
    const get = (path) => ctx.fetch(path).then((r) => r.json()).catch(() => null);
    const [snap, graph, list] = await Promise.all([get(`/api/components/${encodeURIComponent(c.component)}`), get(`/api/components/${encodeURIComponent(c.component)}/graph`), get('/api/components')]);
    const users = graph?.usedBy ?? [];
    const file = (Array.isArray(list) ? list : list?.components)?.find?.((x) => x.id === c.component)?.path || `${c.name}.tsx`;
    if (users.length) {
      openDialog(`<form method="dialog" id="cmp-delete"><h2 id="cmp-dialog-title">${esc(c.name)} is in use</h2>
        <p>${esc(c.name)} is used by ${users.map(esc).join(', ')}. Remove or swap those uses first, then delete it.</p>
        <div class="cmp-btns"><button type="button" id="cmp-cancel" class="primary">Close</button></div></form>`);
      dialog.querySelector('#cmp-cancel').onclick = close; dialog.querySelector('#cmp-cancel').focus();
      return false;
    }
    openDialog(`<form method="dialog" id="cmp-delete"><h2 id="cmp-dialog-title">Delete ${esc(c.name)}?</h2>
      <p>This removes ${esc(file)} and its saved position. Nothing else uses ${esc(c.name)}. You can undo this right after.</p>
      <p id="cmp-error" role="alert"></p>
      <div class="cmp-btns"><button type="button" id="cmp-cancel">Cancel</button><button type="submit" id="cmp-ok" class="danger">Delete</button></div></form>`);
    dialog.querySelector('#cmp-cancel').onclick = close; dialog.querySelector('#cmp-cancel').focus();
    dialog.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const res = await ctx.fetch(`/api/components/${encodeURIComponent(c.component)}`, { method: 'DELETE' });
      const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
      if (!r.ok) { dialog.querySelector('#cmp-error').textContent = plain(r.error); return; }
      close();
      deleted = snap?.source ? { name: c.name, source: snap.source, canvas: snap.canvas } : null;
      showToast(deleted ? `Deleted ${c.name}.` : `Deleted ${c.name}. Git can bring it back.`, !!deleted);
    };
    return true;
  }

  async function undoDelete() {
    const d = deleted;
    if (!d) return false;
    deleted = null;
    const res = await ctx.fetch('/api/components', { method: 'POST', ...json({ name: d.name, source: d.source }) });
    const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
    if (!r.ok) { deleted = d; showToast(`Can't bring ${d.name} back: ${plain(r.error)}`, true); return false; }
    if (d.canvas && (d.canvas.x || d.canvas.y)) await ctx.fetch(`/api/components/${encodeURIComponent(r.id)}/canvas`, { method: 'POST', ...json(d.canvas) });
    showToast(`Brought ${d.name} back.`, false);
    return true;
  }
  toast.querySelector('#cmp-undo').onclick = undoDelete;

  addEventListener('keydown', (ev) => {
    if (document.body.dataset.modal || typing(ev.target) || ev.isComposing) return;
    if (ev.key === 'F2' && !ev.defaultPrevented && ctx.state.selection) { ev.preventDefault(); rename(); return; }
    if (deleted && ev.key.toLowerCase() === 'z' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) { ev.preventDefault(); ev.stopImmediatePropagation(); undoDelete(); }
  });

  ctx.on('change', (f) => { if (f.by === 'you' || f.mine) deleted = null; }); // a newer edit of yours is what Cmd-Z undoes now
  ctx.cmpOps = { rename, remove, undoDelete, nameOf };
  return ctx.cmpOps;
}
