// WPC-28: a person renames and deletes a component on the canvas, with the same engine operations agents use
// (POST /api/components/:id/rename, DELETE /api/components/:id). Reached from Cmd-K ("Rename frame or component", "Delete component…"),
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
  let last = null, previous = null, subject = null, fromRow = false, timer = null; // last: what Ctrl+Z undoes next, { kind: 'delete' | 'rename', ... }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const nameOf = (id) => ctx.state.components.get(id)?.name ?? id;
  const showToast = (msg, undo) => {
    toast.querySelector('.ut-msg').textContent = msg; toast.querySelector('#cmp-undo').hidden = !undo; toast.hidden = false;
    clearTimeout(timer); timer = setTimeout(() => { toast.hidden = true; }, 12000);
  };
  toast.querySelector('#cmp-toast-dismiss').onclick = () => { toast.hidden = true; };

  function openDialog(html, id, row) {
    subject = id; fromRow = !!row || !!document.activeElement?.closest?.('#layers'); previous = document.activeElement;
    dialog.innerHTML = html;
    if (!dialog.open) { document.body.dataset.modal = 'component'; dialog.showModal(); }
  }
  // Focus goes back where it was; when that was the row menu (now hidden) or a row that was redrawn, to the component's row.
  const focusRow = async (id) => {
    for (let i = 0; i < 20; i++) {
      const row = document.querySelector(`#layers .lcomp[data-component="${CSS.escape(id)}"]`);
      if (row) { row.tabIndex = 0; row.focus({ preventScroll: true }); if (document.activeElement === row) return; }
      await sleep(40);
    }
  };
  dialog.addEventListener('close', () => {
    delete document.body.dataset.modal;
    const p = previous, row = fromRow; previous = null; fromRow = false;
    if (row && subject) focusRow(subject);
    else if (p?.isConnected && p !== document.body) p.focus?.({ preventScroll: true });
  });
  const close = () => { if (dialog.open) dialog.close(); };

  // The rename itself, then the selection and focus put back on the renamed component (its id may change when the folder keeps no sidecars).
  async function renameTo(c, to) {
    const sel = ctx.state.selection?.component === c.component ? ctx.state.selection : null;
    const res = await ctx.fetch(`/api/components/${encodeURIComponent(c.component)}/rename`, { method: 'POST', ...json({ name: to }) });
    const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
    if (!r.ok) return r;
    for (let i = 0; i < 200 && !(ctx.state.components.get(r.id)?.doc && ctx.state.components.get(r.id).name === r.name); i++) await sleep(25);
    const now = ctx.state.components.get(r.id);
    if (sel && now?.doc) ctx.select({ component: r.id, node: now.doc.root.id === sel.node || !findNode(now.doc, sel.node) ? now.doc.root.id : sel.node, variant: sel.variant });
    if (fromRow) focusRow(r.id);
    return r;
  }
  const findNode = (doc, id) => { let hit = null; (function walk(n) { if (n.id === id) hit = n; n.children?.forEach(walk); })(doc.root); return hit; };

  function pick(id) { // the component to act on: the one asked for, else the selected one
    const c = ctx.state.components.get(id ?? ctx.state.selection?.component);
    if (!c) ctx.hint('Select a component first, then try again.');
    return c;
  }

  // Rename in place: the card's label becomes the field (create.js startRename), as for a frame file. Never a dialog over the canvas.
  const isFile = (c) => c?.kind === 'html' && !c.doc; // a file drawn as a frame
  function rename(id) {
    const c = pick(id);
    if (!c) return false;
    if (isFile(c) && c.fileKind !== 'html') { ctx.hint(`Rename ${c.path} in your editor for now: renaming a React file here comes in the next pass.`); return false; }
    if (c.readOnly) { ctx.hint(`${c.name} is read-only (${String(c.readOnly).replace(/\.$/, '')}), so it can't be renamed here. Rename it in your editor.`); return false; }
    if (ctx.create?.isFrameFile(c)) return !!ctx.create.startRename(c.component);
    ctx.stage.reveal?.(c.component);
    const row = !!document.activeElement?.closest?.('#layers'); // started from a layers row: focus goes back to that row after
    const others = [...ctx.state.components.values()].filter((x) => x !== c).map((x) => x.name);
    const ok = ctx.create?.startRename(c.component, {
      name: c.name,
      check: (v) => { const to = String(v ?? '').trim(); if (to === c.name) return { same: true }; const bad = checkName('component', to, others); return bad ? { error: bad } : { name: to }; },
      rename: async (to) => {
        fromRow = row;
        const r = await renameTo(c, to).finally(() => { fromRow = false; });
        if (!r.ok) return { ok: false, error: engineSentence('component', r.error, to) };
        last = { kind: 'rename', id: r.id, from: c.name, to: r.name };
        showToast(`Renamed ${c.name} to ${r.name}. Ctrl+Z puts the old name back.`, true);
        return r;
      },
    });
    if (!ok) ctx.hint(`${c.name} is not on the canvas right now. Show it, then rename it from its label.`);
    return !!ok;
  }

  async function remove(id, opts = {}) {
    const c = pick(id);
    if (!c) return false;
    if (isFile(c)) { if (c.fileKind !== 'html') { ctx.hint(`Delete ${c.path} in your editor for now: deleting a React file here comes in the next pass.`); return false; } return ctx.fileOps.remove(c.component); }
    if (c.readOnly) { ctx.hint(`${c.name} is read-only (${String(c.readOnly).replace(/\.$/, '')}), so it can't be deleted here. Delete the file in your editor.`); return false; }
    const get = (path) => ctx.fetch(path).then((r) => r.json()).catch(() => null);
    const [snap, graph, list] = await Promise.all([get(`/api/components/${encodeURIComponent(c.component)}`), get(`/api/components/${encodeURIComponent(c.component)}/graph`), get('/api/components')]);
    const users = graph?.usedBy ?? [];
    const file = (Array.isArray(list) ? list : list?.components)?.find?.((x) => x.id === c.component)?.path || `${c.name}.tsx`;
    if (users.length) {
      openDialog(`<form method="dialog" id="cmp-delete"><h2 id="cmp-dialog-title">${esc(c.name)} is in use</h2>
        <p>${esc(c.name)} is used by ${users.map(esc).join(', ')}. Remove or swap those uses first, then delete it.</p>
        <div class="cmp-btns"><button type="button" id="cmp-cancel" class="primary">Close</button></div></form>`, c.component, opts.fromRow);
      dialog.querySelector('#cmp-cancel').onclick = close; dialog.querySelector('#cmp-cancel').focus();
      return false;
    }
    openDialog(`<form method="dialog" id="cmp-delete"><h2 id="cmp-dialog-title">Delete ${esc(c.name)}?</h2>
      <p>This removes ${esc(file)} and its saved position. Nothing else uses ${esc(c.name)}. You can undo this right after.</p>
      <p id="cmp-error" role="alert"></p>
      <div class="cmp-btns"><button type="button" id="cmp-cancel">Cancel</button><button type="submit" id="cmp-ok" class="danger">Delete</button></div></form>`, c.component, opts.fromRow);
    dialog.querySelector('#cmp-cancel').onclick = close; dialog.querySelector('#cmp-cancel').focus();
    dialog.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const res = await ctx.fetch(`/api/components/${encodeURIComponent(c.component)}`, { method: 'DELETE' });
      const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
      if (!r.ok) { dialog.querySelector('#cmp-error').textContent = plain(r.error); return; }
      close();
      subject = null; // the row is gone
      last = snap?.source ? { kind: 'delete', name: c.name, source: snap.source, canvas: snap.canvas, folder: file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.' } : null;
      showToast(last ? `Deleted ${c.name}. Ctrl+Z brings it back.` : `Deleted ${c.name}. Git can bring it back.`, !!last);
    };
    return true;
  }

  async function undoLast() {
    const d = last;
    if (!d) return false;
    last = null;
    if (d.undo) { const ok = await d.undo(); if (!ok) last = d; return ok; } // a frame file's delete or copy (file-ops.js): the server's undo
    if (d.kind === 'rename') {
      const c = ctx.state.components.get(d.id);
      if (!c) { showToast(`Can't put the old name back: ${d.to} is gone.`, false); return false; }
      const r = await renameTo(c, d.from);
      if (!r.ok) { last = d; showToast(`Can't put the old name back: ${engineSentence('component', r.error, d.from)}`, true); return false; }
      showToast(`${d.to} is ${d.from} again.`, false);
      return true;
    }
    const res = await ctx.fetch('/api/components', { method: 'POST', ...json({ name: d.name, source: d.source, folder: d.folder }) });
    const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
    if (!r.ok) { last = d; showToast(`Can't bring ${d.name} back: ${plain(r.error)}`, true); return false; }
    if (d.canvas && (d.canvas.x || d.canvas.y)) await ctx.fetch(`/api/components/${encodeURIComponent(r.id)}/canvas`, { method: 'POST', ...json(d.canvas) });
    showToast(`Brought ${d.name} back.`, false);
    return true;
  }
  toast.querySelector('#cmp-undo').onclick = undoLast;

  addEventListener('keydown', (ev) => {
    if ((document.body.dataset.modal && document.body.dataset.modal !== 'component') || dialog.open || typing(ev.target) || ev.isComposing) return;
    if (last && ev.key.toLowerCase() === 'z' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) { ev.preventDefault(); ev.stopImmediatePropagation(); undoLast(); }
  });

  ctx.on('change', (f) => { if ((f.by === 'you' || f.mine) && !/^(renamed|deleted|created)\b/.test(f.summary || '')) last = null; }); // a newer edit of yours is what Cmd-Z undoes now
  ctx.on('doc-change', (f) => { if (f.by === 'you' && f.kind !== 'file' && f.kind !== 'undo' && last?.undo) last = null; }); // an edit of a file after it: Cmd-Z undoes that edit now
  // A double-click on a TSX component's label opens its rename dialog (an HTML frame's label renames in place: create.js).
  document.addEventListener('dblclick', (ev) => {
    const id = ev.target.closest?.('#stage .cmp-head h3')?.closest('.cmp')?.dataset.component, c = id && ctx.state.components.get(id);
    if (!c?.doc || c.item || c.readOnly || ctx.state.tool !== 'select') return;
    ev.preventDefault(); ev.stopPropagation();
    rename(id);
  }, true);
  // file-ops.js: what Ctrl+Z (or the toast's Undo) does next, and the toast
  const remember = (d) => { last = d; };
  ctx.cmpOps = { rename, remove, undoLast, undoDelete: undoLast, nameOf, remember, toast: showToast };
  return ctx.cmpOps;
}
