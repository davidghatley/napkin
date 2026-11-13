// The canvas commands of DREAM 3: one registry (actions.js) drives the palette phrases, the key map and the bindings.
//
//   ctx.surface.phrases(query)   palette results for a typed phrase ("Select orbit.html", "Arrange by kind", "Control Radius")
//   ctx.surface.bindings()       the bindings in force ({ command, keys }, from GET /api/keys)
//   ctx.surface.<verb>(arg)      what each command does (selectPath, control, depth, reset, arrange, group, present, compare,
//                                resolve, generate, openFolder, rebind, walk, focusPanel, focusCanvas, selectAll, undo)
//
// Keys: one listener reads every binding of the registry, including sequences ("A K": A, then K) and a count typed first
// ("3", then ArrowRight walks three cards). Plain keys act only when the canvas has the keyboard (nothing focused, a card or
// the stage), so a field, a list or the instrument panel keeps its own keys. The selection, the arrangement, the groups,
// the comparison and the presentation are board state on the server (GET /api/board), so an agent or a test sees what is
// on screen.
import { ACTIONS } from './actions.js';
import { eventChord, normalizeKeys } from './keynames.js';
import { variantGrid } from '/src/model.js';
import { plain } from './words.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').trim().toLowerCase();
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);
const SEQUENCE_MS = 1200;

export function initSurface(ctx) {
  const json = (path, body) => ctx.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const byId = new Map(ACTIONS.map((a) => [a.id, a]));
  const commands = ACTIONS.filter((a) => a.command && a.run);
  let bindings = ACTIONS.filter((a) => a.command && a.keys).map((a) => ({ command: a.id, keys: a.keys }));
  let board = { arrange: { by: 'manual' }, groups: [], selection: [], presentation: false, compare: null };
  const loadKeys = async () => { try { const r = await fetch('/api/keys').then((x) => x.json()); if (Array.isArray(r.bindings)) bindings = r.bindings; } catch {} ctx.emit('keys', bindings); };
  loadKeys();

  // ------------------------------------------------------------------------------------------------ cards and selection
  const cardEls = () => [...document.querySelectorAll('#world [data-item-id]')];
  const cardOf = (itemId) => document.querySelector(`#world [data-item-id="${CSS.escape(itemId)}"]`);
  const componentOfItem = (itemId) => cardOf(itemId)?.dataset.component ?? (ctx.state.components.get(itemId) ? itemId : null);
  const selectedItems = () => [...new Set(ctx.state.selections.map((s) => ctx.itemOf(s.component)).filter(Boolean))];
  // A card selected as a whole: the file item itself, a component's root, an HTML file's first element.
  function cardSelection(id) {
    const c = ctx.state.components.get(id);
    if (!c) return null;
    if (c.item) return { component: id, node: 'item', variant: {}, card: true };
    if (c.doc) return { component: id, node: c.doc.root.id, variant: variantGrid(c.doc)[0] ?? {}, card: true };
    return { component: id, node: ctx.stage.rootNode?.(id) ?? '', variant: {}, card: true };
  }
  function focusCard(id) {
    const el = ctx.stage.sections.get(id)?.el;
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.focus({ preventScroll: true, focusVisible: true });
  }
  const sync = () => json('/api/board', { selection: selectedItems() }).catch(() => {});
  ctx.on('select', sync);

  async function selectPath(path) {
    const want = String(path ?? '').trim();
    if (!want) { ctx.hint('Name a file: Select orbit.html'); return; }
    let id = componentOfItem(want);
    if (!id) { const c = ctx.state.components.all().find((x) => x.path === want || ctx.itemOf(x.component) === want) || ctx.state.components.all().find((x) => norm(x.name) === norm(want)); id = c?.component; }
    if (!id) { ctx.hint(`No file called “${want}” on this canvas`); return; }
    ctx.stage.live?.(id);
    let sel = cardSelection(id);
    for (let i = 0; i < 40 && sel && sel.node === '' && ctx.state.components.get(id)?.kind === 'html'; i++) { await new Promise((r) => setTimeout(r, 50)); sel = cardSelection(id); } // a frame still loading
    ctx.select(sel);
    ctx.stage.reveal?.(id);
    focusCard(id);
  }

  // Spatial focus: the nearest card that way, judged by the centres of the cards on screen (straight ahead beats diagonal).
  function neighbour(fromEl, dx, dy) {
    const centre = (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const cur = centre(fromEl);
    let best = null, bestScore = Infinity;
    for (const e of cardEls()) {
      if (e === fromEl || e.dataset.itemId === fromEl.dataset.itemId) continue;
      const p = centre(e), ax = p.x - cur.x, ay = p.y - cur.y;
      const ahead = dx ? ax * dx : ay * dy;
      if (ahead <= 1) continue;
      const score = Math.hypot(ax, ay) + Math.abs(dx ? ay : ax);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }
  function currentCard() {
    const active = document.activeElement?.closest?.('#world [data-item-id]');
    if (active) return active;
    const sel = ctx.state.selection;
    const el = sel && ctx.stage.sections.get(sel.component)?.el;
    if (el) return el;
    // Nothing yet: the card nearest the middle of the stage.
    const box = document.querySelector('#stage').getBoundingClientRect(), mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    let best = null, d = Infinity;
    for (const e of cardEls()) { const r = e.getBoundingClientRect(), dd = Math.hypot(r.x + r.width / 2 - mid.x, r.y + r.height / 2 - mid.y); if (r.width && dd < d) { d = dd; best = e; } }
    return best;
  }
  function walk(dx, dy, extend = false, count = 1) {
    let el = currentCard();
    if (!el) { ctx.hint('No cards on the canvas yet'); return; }
    const path = [];
    for (let i = 0; i < Math.max(1, count || 1); i++) { const next = neighbour(el, dx, dy); if (!next) break; el = next; path.push(next); }
    if (!path.length) { ctx.hint('No card further that way'); if (!ctx.state.selection) { const s = cardSelection(el.dataset.component); if (s) ctx.select(s); focusCard(el.dataset.component); } return; }
    const picked = path.map((e) => cardSelection(e.dataset.component)).filter(Boolean);
    if (extend) {
      const cur = ctx.state.selections.length ? ctx.state.selections.map((s) => ({ ...s, card: true })) : [cardSelection(currentCard().dataset.component)].filter(Boolean);
      ctx.selectMany([...cur.filter((s) => !picked.some((p) => p.component === s.component)), ...picked]);
    } else ctx.select(picked.at(-1));
    const id = picked.at(-1).component;
    ctx.stage.reveal?.(id);
    focusCard(id);
  }
  function selectAll() {
    const list = cardEls().map((e) => cardSelection(e.dataset.component)).filter(Boolean);
    ctx.selectMany(list);
    ctx.hint(`${list.length} cards selected`);
  }

  // ------------------------------------------------------------------------------------------------ instruments
  const needPanel = () => { if (!ctx.state.selection) { ctx.hint('Select something first: Select <file>'); return false; } return true; };
  const control = (label) => needPanel() && ctx.instruments.focusControl(label);
  const depth = (label, d) => needPanel() && ctx.instruments.depth(label, d);
  const reset = (label) => needPanel() && ctx.instruments.reset(label);
  const focusPanel = () => (ctx.instruments.focusFirst() || ctx.quick.focusInspector());
  const focusCanvas = () => { const s = ctx.state.selection; if (s) focusCard(s.component); else document.querySelector('#stage')?.focus?.(); };

  // ------------------------------------------------------------------------------------------------ board: arrange and groups
  const layer = document.createElement('div');
  layer.id = 'board-groups'; layer.setAttribute('aria-hidden', 'false');
  document.querySelector('#world').append(layer);
  const rectOf = (itemId) => { const id = componentOfItem(itemId); return id ? ctx.stage.componentRect(id) : null; };
  function drawGroups() {
    const frag = document.createDocumentFragment();
    for (const g of board.groups || []) {
      const rs = (g.items || []).map(rectOf).filter(Boolean);
      if (!rs.length) continue;
      const x0 = Math.min(...rs.map((r) => r.x)) - 24, y0 = Math.min(...rs.map((r) => r.y)) - 52, x1 = Math.max(...rs.map((r) => r.x + r.w)) + 24, y1 = Math.max(...rs.map((r) => r.y + r.h)) + 24;
      const el = document.createElement('div');
      el.className = 'board-group' + (g.manual ? ' manual' : '');
      el.dataset.groupId = g.id;
      el.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px`;
      el.innerHTML = `<span class="bg-name">${esc(g.name)}</span><span class="bg-count">${rs.length}</span>`;
      frag.append(el);
    }
    layer.replaceChildren(frag);
  }
  const GAP = 48, COLS = 3, SHELF = 4200;
  // Each group of the arrangement is a block of cards with its name above; blocks fill shelves left to right.
  function layoutArranged() {
    const groups = (board.groups || []).filter((g) => !g.manual && g.items?.length);
    if (!groups.length) return false;
    let x = 0, y = 0, shelf = 0;
    for (const g of groups) {
      const cards = g.items.map((id) => ({ id: componentOfItem(id), r: rectOf(id) })).filter((c) => c.id && c.r);
      if (!cards.length) continue;
      const colW = Math.max(...cards.map((c) => c.r.w)) + GAP, cols = Math.min(COLS, cards.length);
      const width = cols * colW;
      if (x > 0 && x + width > SHELF) { x = 0; y += shelf + GAP * 2; shelf = 0; }
      const heights = Array(cols).fill(0);
      for (const c of cards) { const col = heights.indexOf(Math.min(...heights)); ctx.stage.moveTo(c.id, x + col * colW, y + 60 + heights[col] + 36); heights[col] += c.r.h + GAP; }
      shelf = Math.max(shelf, Math.max(...heights) + 60);
      x += width + GAP * 2;
    }
    ctx.stage.refreshOverlays?.();
    return true;
  }
  async function readBoard() { try { board = await fetch('/api/board').then((r) => r.json()); } catch {} return board; }
  async function arrange(by) {
    const r = await json('/api/board', { arrange: { by } });
    if (r.ok === false) { ctx.hint(plain(r.error)); return; }
    board = r;
    if (by === 'manual') ctx.stage.layoutAll(); else layoutArranged();
    drawGroups();
    ctx.view.fitAll?.({ animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
    ctx.hint(by === 'manual' ? 'Cards back where you put them' : `Arranged by ${by}: ${board.groups.filter((g) => !g.manual).length} groups`);
  }
  async function group(name) {
    const items = selectedItems();
    name = String(name ?? '').trim();
    if (!name) { ctx.hint('Name the group: Group <name>'); return; }
    if (!items.length) { ctx.hint('Select the cards to group first (Shift+arrows adds the next card)'); return; }
    const r = await json('/api/board', { group: { name, items } });
    if (r.ok === false) { ctx.hint(plain(r.error)); return; }
    board = r;
    drawGroups();
    ctx.hint(`Grouped ${items.length} card${items.length === 1 ? '' : 's'} as “${name}”`);
  }
  ctx.on('layout', drawGroups); ctx.on('moved', drawGroups);
  readBoard().then(() => { if (board.arrange?.by && board.arrange.by !== 'manual') layoutArranged(); drawGroups(); });

  // ------------------------------------------------------------------------------------------------ present
  let presenting = null;
  async function present(on = true) {
    if (!on) {
      if (!presenting) return;
      const { el, back } = presenting;
      presenting = null;
      el.remove();
      document.body.removeAttribute('data-presenting-on');
      if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true, focusVisible: true }); else focusCanvas();
      await json('/api/board', { presentation: false }).catch(() => {});
      return;
    }
    if (presenting) return;
    const ids = selectedItems().length ? selectedItems() : cardEls().slice(0, 6).map((e) => e.dataset.itemId);
    const el = document.createElement('div');
    el.id = 'presentation';
    el.setAttribute('data-presenting', '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Presentation');
    el.tabIndex = -1;
    el.innerHTML = `<div class="pr-grid" data-n="${Math.min(ids.length, 4)}">${ids.slice(0, 4).map((id) => `<figure><iframe title="${esc(id)}" src="/view/${encodeURIComponent(id)}" loading="eager"></iframe><figcaption>${esc(id)}</figcaption></figure>`).join('')}</div><p class="pr-hint">Escape leaves the presentation</p>`;
    presenting = { el, back: document.activeElement };
    document.body.append(el);
    document.body.setAttribute('data-presenting-on', '');
    el.focus({ focusVisible: true });
    await json('/api/board', { presentation: true });
  }

  // ------------------------------------------------------------------------------------------------ compare variants
  let comparing = null;
  // The variants a component declares: the axes of a napkin component, else the first string-union prop of its source.
  async function variantsOf(id, path) {
    const c = ctx.state.components.get(id);
    if (c?.doc) { const grid = variantGrid(c.doc); if (grid.length >= 2) return grid; }
    const src = await fetch('/raw/' + path.split('/').map(encodeURIComponent).join('/')).then((r) => (r.ok ? r.text() : '')).catch(() => '');
    const m = /(\w+)\??\s*:\s*((?:"[^"]*"|'[^']*')(?:\s*\|\s*(?:"[^"]*"|'[^']*'))+)/.exec(src);
    if (!m) return [];
    return m[2].split('|').map((v) => ({ [m[1]]: v.trim().slice(1, -1) }));
  }
  async function compare(path) {
    const want = String(path ?? '').trim() || selectedItems()[0];
    const id = want && (componentOfItem(want) || ctx.state.components.all().find((x) => x.path === want)?.component);
    if (!id) { ctx.hint(`No component called “${want}” here`); return; }
    const item = ctx.itemOf(id), variants = await variantsOf(id, item);
    if (variants.length < 2) { ctx.hint(`${item} declares fewer than two variants`); return; }
    closeCompare();
    const el = document.createElement('section');
    el.id = 'compare'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', `Variants of ${item}`); el.tabIndex = -1;
    el.innerHTML = `<header><h2>${esc(item)}</h2><p>${variants.length} variants side by side · Escape closes</p></header><div class="cv-row">${variants.map((v) => `<figure data-variant="${esc(JSON.stringify(v))}"><iframe title="${esc(item)} ${esc(Object.values(v).join(' '))}" src="/view/${encodeURIComponent(item)}?props=${encodeURIComponent(JSON.stringify(v))}"></iframe><figcaption>${esc(Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(', '))}</figcaption></figure>`).join('')}</div>`;
    comparing = { el, back: document.activeElement };
    document.body.prepend(el); // ahead of the canvas in reading order: the comparison is what is being looked at
    el.focus({ focusVisible: true });
    await json('/api/board', { compare: { item, variants } });
  }
  function closeCompare() {
    if (!comparing) return;
    const { el, back } = comparing;
    comparing = null; el.remove();
    json('/api/board', { compare: null }).catch(() => {});
    if (back?.isConnected) back.focus({ preventScroll: true, focusVisible: true });
  }

  // ------------------------------------------------------------------------------------------------ agents and folders
  async function resolve(id, action) {
    id = String(id ?? '').trim();
    if (!id) { ctx.hint(`Name the proposal: ${action === 'accept' ? 'Approve' : 'Reject'} <id>`); return; }
    const r = await json(`/api/proposals/${encodeURIComponent(id)}/${action}`, {});
    ctx.hint(plain(r.ok === false || r.status >= 400 ? (r.error || 'That proposal could not be answered') : `Proposal ${action === 'accept' ? 'approved' : 'rejected'}`));
    ctx.emit('proposals-refresh', { id });
  }
  async function generate(path) {
    const workflow = String(path ?? '').trim();
    if (!workflow) { ctx.hint('Name the workflow: Generate <file>'); return; }
    const r = await json('/api/generate', { workflow });
    ctx.hint(plain(r.ok === false || r.status >= 400 ? (r.status === 404 ? 'Generating is not available on this server yet' : r.error) : `Queued ${workflow}, the result lands on the canvas`));
  }
  async function openFolder(path) {
    const folder = String(path ?? '').trim();
    if (!folder) { ctx.hint('Name the folder: Open folder <path>'); return; }
    const r = await json('/api/folder', { folder });
    if (r.ok === false || r.status >= 400) { ctx.hint(plain(r.status === 404 ? 'This napkin cannot switch folders from the canvas yet: run napkin <folder>' : r.error)); return; }
    location.reload();
  }
  async function rebind(text) {
    const m = /^(.+?)\s+to\s+(.+)$/i.exec(String(text ?? '').trim());
    if (!m) { ctx.hint('Write it as: Rebind <command> to <keys>, for example Rebind arrange-kind to Alt+Y'); return; }
    const keys = normalizeKeys(m[2]);
    if (!keys) { ctx.hint(`“${m[2]}” is not a key I can read: try Alt+Y or "A K"`); return; }
    const r = await json('/api/keys', { command: m[1].trim(), keys });
    if (r.ok === false) { ctx.hint(plain(r.error)); return; }
    if (Array.isArray(r.bindings)) bindings = r.bindings;
    ctx.emit('keys', bindings);
    ctx.hint(`${byId.get(r.command)?.label ?? r.command}: ${keys}`);
  }
  const undo = () => ctx.instruments.undo();

  // ------------------------------------------------------------------------------------------------ palette phrases
  // What a typed phrase can complete to. An exact phrase ranks first, then phrases the query begins, then the fuzzy list.
  function argChoices(kind, rest) {
    const r = norm(rest);
    const rank = (label) => (norm(label) === r ? 0 : norm(label).startsWith(r) ? 1 : norm(label).includes(r) ? 2 : 9);
    let list = [];
    if (kind === 'item') list = [...new Set(cardEls().map((e) => e.dataset.itemId))].map((id) => ({ value: id, label: id }));
    else if (kind === 'control') list = ctx.instruments.controls().map((c) => ({ value: c.label, label: c.label, hint: c.section }));
    else if (kind === 'proposal') list = [...document.querySelectorAll('[data-proposal-id]')].map((e) => ({ value: e.dataset.proposalId, label: e.dataset.proposalId }));
    else if (kind === 'rebind') list = commands.filter((c) => !c.arg).map((c) => ({ value: `${c.id} to `, label: `${c.id} to <keys>`, partial: true }));
    list = list.map((x) => ({ ...x, r: rank(x.label) })).filter((x) => x.r < 9 || !r).sort((a, b) => a.r - b.r || a.label.length - b.label.length);
    if (r && !list.some((x) => x.r === 0) && (kind === 'text' || kind === 'rebind' || kind === 'proposal' || kind === 'item' || kind === 'control')) list.unshift({ value: rest.trim(), label: rest.trim(), typed: true, r: kind === 'text' ? 0 : 3 });
    return list;
  }
  function phrases(q) {
    const t = String(q ?? '').replace(/^\s+/, ''), lower = t.toLowerCase();
    if (!t || (t.length < 4 && !/\s/.test(t))) return [];
    const out = [];
    for (const c of commands) {
      const head = c.phrase.replace(/\s*<.*$/, ''), hl = head.toLowerCase();
      if (c.arg) {
        if (lower.startsWith(hl + ' ')) {
          const rest = t.slice(head.length + 1);
          for (const x of argChoices(c.arg, rest).slice(0, 8)) out.push({ r: x.r ?? 1, item: { kind: 'action', label: `${head} ${x.label}`, hint: x.hint || c.about, about: c.about, key: '', command: c.id, run: x.partial ? () => ctx.quick.prefill(`${head} ${x.value}`) : () => c.run(ctx, x.value) } });
        } else if (hl.startsWith(lower) || (lower.length >= 4 && hl.includes(lower))) out.push({ r: hl === lower ? 0 : 4, item: { kind: 'action', label: c.phrase, about: c.about, key: '', command: c.id, run: () => ctx.quick.prefill(head + ' ') } });
      } else {
        const pl = c.phrase.toLowerCase(), ll = c.label.toLowerCase();
        if (pl === lower || ll === lower) out.push({ r: 0, item: { kind: 'action', label: c.phrase, about: c.about, key: keysOf(c.id), command: c.id, run: () => c.run(ctx) } });
        else if (pl.startsWith(lower) || ll.startsWith(lower)) out.push({ r: 3, item: { kind: 'action', label: c.phrase, about: c.about, key: keysOf(c.id), command: c.id, run: () => c.run(ctx) } });
      }
    }
    return out.sort((a, b) => a.r - b.r).map(({ item }) => ({ item, at: [] }));
  }
  const keysOf = (id) => bindings.filter((b) => b.command === id).map((b) => b.keys).join(' · ');

  // ------------------------------------------------------------------------------------------------ the key dispatcher
  let pending = [], pendingAt = 0, count = '';
  const editable = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable;
  // The canvas has the keyboard: nothing focused, the stage, or a card itself (not a field or widget inside it).
  const canvasHasKeys = (t) => !t || t === document.body || t === document.documentElement || t.id === 'stage' || t.id === 'world' || t.matches?.('#world [data-item-id]');
  function onKey(ev) {
    if (ev.isComposing || MODIFIERS.has(ev.key)) return;
    if (document.body.dataset.modal) return; // the palette or the key map has the keyboard
    if (presenting) { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); present(false); } return; }
    if (comparing && ev.key === 'Escape' && !editable(ev.target)) { ev.preventDefault(); ev.stopImmediatePropagation(); closeCompare(); return; }
    if (ev.defaultPrevented || editable(ev.target)) return;
    const plain = !ev.ctrlKey && !ev.altKey && !ev.metaKey;
    if (plain && !canvasHasKeys(ev.target)) return;
    if (plain && /^[0-9]$/.test(ev.key) && !ev.shiftKey && !pending.length) {
      if (count || ev.key !== '0') { count = (count + ev.key).slice(-3); ev.preventDefault(); ev.stopPropagation(); ctx.hint(`×${count}`); return; }
    }
    const chord = eventChord(ev);
    if (!chord) return;
    if (pending.length && performance.now() - pendingAt > SEQUENCE_MS) pending = [];
    const seq = [...pending, chord].join(' ');
    const exact = bindings.find((b) => b.keys === seq && byId.get(b.command)?.run);
    const longer = bindings.some((b) => b.keys.startsWith(seq + ' '));
    if (exact && !longer) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      pending = [];
      const n = Number(count) || 1; count = '';
      byId.get(exact.command).run(ctx, n);
      return;
    }
    if (longer) { ev.preventDefault(); ev.stopImmediatePropagation(); pending.push(chord); pendingAt = performance.now(); return; }
    pending = [];
    if (count && ev.key === 'Escape') count = '';
  }
  addEventListener('keydown', onKey, true);

  const api = { phrases, bindings: () => bindings, loadKeys, selectPath, control, depth, reset, arrange, group, present, compare, resolve, generate, openFolder, rebind, walk, focusPanel, focusCanvas, selectAll, undo, board: () => board, readBoard, drawGroups };
  ctx.surface = api;
  return api;
}
