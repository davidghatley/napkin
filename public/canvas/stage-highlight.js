// M3, one rule lights up everywhere. Every element on the canvas that a CSS rule matches (or that uses a variable) is
// outlined in every frame, with a count; when the rule or variable is edited the frames redraw and the outlines follow.
//   napkin.stage.highlight({ selector, file? } | { variable })     the P2 inspector calls this from its rule and variable chips
//   napkin.stage.clearHighlight()
//   napkin.highlight = { pick(), active(), places() }               pick(): the "Highlight rule…" list (Cmd-K, Alt+H)
// The outlines are drawn on the canvas page, over each frame (one layer per frame, so panning and zooming cost nothing); the
// frames' documents are only read. A selector is matched as the browser matches it, with :hover, :focus and the like left
// out (the outline marks where the rule applies, not when).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MAX_BOXES = 300;
const DYNAMIC = /::?[\w-]+(?:\([^)]*\))?/g;
const KEEP = new Set(['not', 'is', 'where', 'has', 'nth-child', 'nth-of-type', 'nth-last-child', 'nth-last-of-type', 'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'only-of-type', 'root', 'empty', 'checked', 'disabled', 'enabled', 'required', 'optional', 'read-only', 'placeholder-shown', 'default', 'indeterminate', 'lang', 'dir', 'link', 'any-link', 'scope']);

export function splitList(sel) {
  const out = []; let depth = 0, cur = '', q = '';
  for (const ch of sel) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// ".btn:hover::after" -> ".btn": where the rule applies, not when
export function staticSelector(part) {
  const s = part.replace(DYNAMIC, (m) => (m.startsWith('::') ? '' : KEEP.has(m.slice(1).split('(')[0].toLowerCase()) ? m : '')).trim();
  return s.replace(/(^|[\s>+~(,])$/, '').trim();
}
export function matchAll(doc, selector) {
  const found = new Set();
  for (const part of splitList(selector)) {
    const s = staticSelector(part);
    if (!s) continue;
    try { for (const el of doc.querySelectorAll(s)) found.add(el); } catch { /* a selector the browser does not take */ }
  }
  return found;
}
function* styleRules(sheet, depth = 0) {
  let rules; try { rules = sheet.cssRules; } catch { return; }
  for (const r of rules) {
    if (r.type === 1) yield r;
    if (r.type === 3 && r.styleSheet && depth < 4) yield* styleRules(r.styleSheet, depth + 1);
    else if (r.cssRules) yield* inner(r);
  }
}
function* inner(rule) { for (const r of rule.cssRules || []) { if (r.type === 1) yield r; if (r.cssRules) yield* inner(r); } }
const declsOf = (text) => {
  const out = []; let depth = 0, cur = '';
  for (const ch of text) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && !depth) { out.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur);
  return out.map((d) => { const i = d.indexOf(':'); return i < 0 ? null : { prop: d.slice(0, i).trim(), value: d.slice(i + 1) }; }).filter(Boolean);
};
// The variables that end up in a variable's value: --accent used by --link-color used by a rule: all three.
export function variableFamily(doc, name) {
  const dep = new Map(); // used -> Set(defined from it)
  for (const sheet of doc.styleSheets) for (const r of styleRules(sheet)) {
    const ds = declsOf(r.style.cssText);
    for (const d of ds) if (d.prop.startsWith('--')) for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) { if (!dep.has(m[1])) dep.set(m[1], new Set()); dep.get(m[1]).add(d.prop); }
  }
  const fam = new Set([name]), todo = [name];
  while (todo.length) for (const x of dep.get(todo.pop()) || []) if (!fam.has(x)) { fam.add(x); todo.push(x); }
  return fam;
}
// Who uses a variable: `direct` elements have a rule or an inline style that says var(--name); `indirect` ones use it through another variable
// (--link: var(--accent); a rule that says var(--link)); `through` names those other variables.
export function usersOfVariable(doc, name) {
  const fam = variableFamily(doc, name), direct = new Set(), indirect = new Set(), through = new Set();
  const uses = (value) => { let d = false, i = false; for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) { if (m[1] === name) d = true; else if (fam.has(m[1])) { i = true; through.add(m[1]); } } return { d, i }; };
  const note = (els, u) => { for (const el of els) { if (u.d) direct.add(el); else if (u.i) indirect.add(el); } };
  for (const sheet of doc.styleSheets) for (const r of styleRules(sheet)) {
    const u = declsOf(r.style.cssText).filter((x) => !x.prop.startsWith('--')).map((x) => uses(x.value)).reduce((a, x) => ({ d: a.d || x.d, i: a.i || x.i }), { d: false, i: false });
    if (u.d || u.i) note(matchAll(doc, r.selectorText), u);
  }
  for (const el of doc.querySelectorAll('[style*="var("]')) { const u = declsOf(el.getAttribute('style') || '').filter((x) => !x.prop.startsWith('--')).map((x) => uses(x.value)).reduce((a, x) => ({ d: a.d || x.d, i: a.i || x.i }), { d: false, i: false }); note([el], u); }
  for (const el of direct) indirect.delete(el);
  return { direct, indirect, through };
}
// The files a document's style sheets come from (a /raw/ path), plus the component's own file for its inline <style>.
export function sheetFiles(doc, own) {
  const files = new Set([own]);
  const add = (sheet, depth = 0) => {
    if (sheet.href) { try { const u = new URL(sheet.href); if (u.pathname.startsWith('/raw/')) files.add(decodeURIComponent(u.pathname.slice(5))); } catch { /* not ours */ } }
    if (depth > 4) return;
    let rules; try { rules = sheet.cssRules; } catch { return; }
    for (const r of rules) if (r.type === 3 && r.styleSheet) add(r.styleSheet, depth + 1);
  };
  for (const sheet of doc.styleSheets) add(sheet);
  return files;
}

export function initHighlight(ctx) {
  const stageEl = document.querySelector('#stage');
  const bar = document.createElement('div');
  bar.id = 'hl-bar'; bar.hidden = true; bar.setAttribute('role', 'status'); bar.dataset.nodrag = '1';
  const side = document.createElement('aside');
  side.id = 'hl-side'; side.hidden = true; side.setAttribute('aria-label', 'Where this rule applies'); side.dataset.nodrag = '1';
  stageEl.append(bar, side);
  let spec = null, label = '', counts = { places: 0, frames: 0, direct: 0, indirect: 0, through: [] };
  let places = []; // [{ id, el, node, ordinal, indirect }]
  let change = null; // { path, line: [{ n, was, now }] } while an edit to a file the highlight reads is not yet kept
  const baselines = new Map(); // file -> the text when the highlight began (or when the change was kept)
  const layers = new Map(); // component id -> layer element

  const frames = () => [...ctx.stage.sections].filter(([, sec]) => sec.docFrame?.doc()).map(([id, sec]) => [id, sec.docFrame]);
  // [{ el, indirect }] for one frame
  function elementsIn(id, f) {
    const doc = f.doc(), comp = ctx.state.components.get(id);
    if (!doc || !spec) return { list: [], through: new Set() };
    if (spec.variable) { const u = usersOfVariable(doc, spec.variable); return { list: [...[...u.direct].map((el) => ({ el, indirect: false })), ...[...u.indirect].map((el) => ({ el, indirect: true }))], through: u.through }; }
    if (spec.file && !sheetFiles(doc, comp?.path).has(spec.file)) return { list: [], through: new Set() };
    return { list: [...matchAll(doc, spec.selector)].map((el) => ({ el, indirect: false })), through: new Set() };
  }
  function layerOf(id, f) {
    let l = layers.get(id);
    if (l?.isConnected) return l;
    l = document.createElement('div'); l.className = 'hl-layer'; l.setAttribute('aria-hidden', 'true'); l.dataset.nodrag = '1';
    f.cell.append(l); layers.set(id, l);
    return l;
  }
  // (Re)draw one frame's outlines. Returns { found, through }.
  function draw(id, f, ordinal) {
    const { list, through } = elementsIn(id, f);
    const l = layers.get(id);
    if (!list.length) { l?.remove(); layers.delete(id); return { found: [], through }; }
    const layer = layerOf(id, f), win = f.doc().defaultView;
    const boxes = [];
    for (const { el, indirect } of list) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      boxes.push({ r, indirect, el });
      if (boxes.length >= MAX_BOXES) break;
    }
    layer.innerHTML = boxes.map(({ r, indirect }, i) => `<i class="hl-box${indirect ? ' hl-indirect' : ''}" data-i="${i}" style="left:${(r.left + win.scrollX).toFixed(1)}px;top:${(r.top + win.scrollY).toFixed(1)}px;width:${r.width.toFixed(1)}px;height:${r.height.toFixed(1)}px">${i === 0 ? `<b>${ordinal}</b>` : ''}</i>`).join('');
    layer.dataset.places = String(list.length);
    return { found: list.map(({ el, indirect }) => ({ id, el, node: f.nodeOf(el), ordinal, indirect })), through };
  }
  function redraw(only) {
    if (!spec) return;
    const keep = only ? places.filter((p) => p.id !== only) : [];
    const mine = [], through = new Set();
    let k = 0;
    for (const [id, f] of frames()) {
      if (only && id !== only) { const has = keep.filter((p) => p.id === id); if (has.length) { k++; mine.push(...has.map((p) => ({ ...p, ordinal: k }))); } continue; }
      const r = draw(id, f, k + 1);
      for (const t of r.through) through.add(t);
      if (r.found.length) { k++; mine.push(...r.found); }
    }
    places = mine;
    const indirect = places.filter((p) => p.indirect).length;
    counts = { places: places.length, frames: k, direct: places.length - indirect, indirect, through: [...through].sort() };
    document.body.dataset.highlight = String(places.length);
    paintBar(); paintSide();
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function paintBar() {
    bar.hidden = !spec;
    if (!spec) return;
    bar.innerHTML = `<code>${esc(label)}</code> <span class="hl-count">lights ${plural(counts.places, 'place')}${counts.frames ? ` in ${plural(counts.frames, 'component')}` : ''}</span><button type="button" id="hl-clear" aria-label="Clear the highlight (Escape)">Clear <kbd>Esc</kbd></button>`;
    bar.querySelector('#hl-clear').onclick = () => clear();
  }
  const nameOf = (id) => ctx.state.components.get(id)?.name ?? id;
  const describe = (p) => {
    const el = p.el, tag = el.localName, cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    const line = ctx.stage.sections.get(p.id)?.docFrame?.node(p.node)?.line;
    return { name: `${tag}${cls}`, text, line };
  };
  function paintSide() {
    side.hidden = !spec;
    if (!spec) { side.replaceChildren(); return; }
    const groups = new Map();
    for (const p of places) { if (!groups.has(p.id)) groups.set(p.id, []); groups.get(p.id).push(p); }
    const row = (p, i) => { const d = describe(p); return `<li><button type="button" class="hl-row${p.indirect ? ' hl-ind' : ''}" data-id="${esc(p.id)}" data-node="${esc(p.node ?? '')}" data-k="${places.indexOf(p)}"><span class="hl-n">${p.ordinal}</span><code>${esc(d.name)}</code><span class="hl-t">${esc(d.text)}</span>${d.line ? `<span class="hl-l">:${d.line}</span>` : ''}</button></li>`; };
    const group = (list, title) => {
      if (!list.length) return '';
      const by = new Map(); for (const p of list) { if (!by.has(p.id)) by.set(p.id, []); by.get(p.id).push(p); }
      return `${title ? `<h4>${esc(title)}</h4>` : ''}${[...by].map(([id, ps]) => `<div class="hl-group"><div class="hl-gh"><span>${esc(nameOf(id))}</span><span>${ps.length}</span></div><ul>${ps.slice(0, 8).map(row).join('')}</ul>${ps.length > 8 ? `<p class="hl-more">${ps.length - 8} more in this component</p>` : ''}</div>`).join('')}`;
    };
    const direct = places.filter((p) => !p.indirect), indirect = places.filter((p) => p.indirect);
    const explain = spec.variable
      ? `${plural(counts.places, 'place')} in ${plural(counts.frames, 'component')}${counts.indirect ? `, including ${counts.indirect} through other variables (${counts.through.map((t) => `<code>${esc(t)}</code>`).join(', ')})` : ''}.`
      : `${plural(counts.places, 'place')} in ${plural(counts.frames, 'component')} match this rule.`;
    side.innerHTML = `<header><h3>Lights up</h3><span>${plural(counts.places, 'place')}</span></header>
      <p class="hl-explain">${explain}</p>
      <div class="hl-list">${spec.variable ? `${group(direct, `Used directly · ${direct.length}`)}${group(indirect, `Through other variables · ${indirect.length}`)}` : group(direct, '')}${places.length ? '' : '<p class="hl-more">Nothing on the canvas uses this.</p>'}</div>
      ${change ? `<section class="hl-change"><header><h3>The change</h3><span>${plural(change.lines.length, 'line')}</span></header>
        <div class="hl-diff">${change.lines.map((l) => `${l.was !== null ? `<div class="del"><i>${l.n}</i>− ${esc(l.was.trim())}</div>` : ''}${l.now !== null ? `<div class="add"><i>${l.n}</i>+ ${esc(l.now.trim())}</div>` : ''}`).join('')}</div>
        <p class="hl-explain">Change all together: this edit already applies to all ${plural(counts.places, 'place')}.</p>
        <div class="hl-actions"><button type="button" id="hl-keep" class="primary">Keep</button><button type="button" id="hl-revert">Revert</button></div></section>` : ''}`;
    side.querySelectorAll('.hl-row').forEach((b) => {
      b.addEventListener('click', () => { if (b.dataset.node) ctx.select({ component: b.dataset.id, node: b.dataset.node, variant: {} }); focusPlace(Number(b.dataset.k)); });
    });
    side.querySelector('#hl-keep')?.addEventListener('click', () => keepChange());
    side.querySelector('#hl-revert')?.addEventListener('click', () => revertChange());
  }
  // the walked-to place gets a stronger outline, and the canvas flies to it when it is not comfortably on screen (at a zoom a person can read)
  let walkAt = -1;
  function focusPlace(k, { fly = true } = {}) {
    for (const el of document.querySelectorAll('.hl-box.on')) el.classList.remove('on');
    const p = places[k]; if (!p) return;
    walkAt = k;
    const f = ctx.stage.sections.get(p.id)?.docFrame;
    const idx = f ? elementsIn(p.id, f).list.findIndex((x) => x.el === p.el) : -1;
    layers.get(p.id)?.querySelector(`.hl-box[data-i="${idx}"]`)?.classList.add('on');
    const prox = f?.element(p.node); if (!prox || !fly) return;
    const r = prox.getBoundingClientRect(), box = ctx.view.stageBox(), v = ctx.view.get();
    const inside = r.left >= box.left + 8 && r.right <= box.right - 8 && r.top >= box.top + 8 && r.bottom <= box.bottom - 8;
    if (!inside || v.z < 0.5) ctx.view.flyTo(ctx.view.rectToWorld(r), { pad: 200, max: 1.25 });
  }
  function walk(dir) {
    if (!places.length) return false;
    const k = walkAt < 0 ? (dir > 0 ? 0 : places.length - 1) : (walkAt + dir + places.length) % places.length;
    const p = places[k];
    if (p.node) ctx.select({ component: p.id, node: p.node, variant: {} });
    focusPlace(k);
    return true;
  }
  const lastFocusOnPanel = () => side.contains(document.activeElement) || bar.contains(document.activeElement);

  // ---- the change: the one-line diff of an edit to a file this highlight reads, with Keep and Revert (Revert is undo) ----
  async function textOf(path) { try { const r = await fetch('/raw/' + path.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch { return null; } }
  async function snapshot() {
    baselines.clear();
    const paths = new Set();
    for (const [id, f] of frames()) { const d = f.doc(); for (const p of sheetFiles(d, ctx.state.components.get(id)?.path)) if (p) paths.add(p); }
    await Promise.all([...paths].map(async (p) => { const t = await textOf(p); if (t !== null) baselines.set(p, t); }));
  }
  function diffLines(was, now) {
    const a = was.split('\n'), b = now.split('\n'), out = [];
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      // resync on the next line both sides share, within a short window
      let k = 1, hit = null;
      for (; k <= 8 && !hit; k++) { if (a[i + k] !== undefined && a[i + k] === b[j]) hit = [k, 0]; else if (b[j + k] !== undefined && b[j + k] === a[i]) hit = [0, k]; else if (a[i + k] !== undefined && a[i + k] === b[j + k]) hit = [k, k]; }
      const [da, db] = hit ?? [a.length - i, b.length - j];
      const n = Math.max(da, db);
      for (let q = 0; q < n; q++) out.push({ n: j + q + 1, was: q < da ? a[i + q] : null, now: q < db ? b[j + q] : null });
      i += da; j += db;
      if (out.length > 6) break;
    }
    return out;
  }
  // a long line (a whole rule on one line) shows only the part that changed: the declaration around the difference
  function trimmed(was, now) {
    if (was === null || now === null || Math.max(was.length, now.length) < 70) return [was, now];
    let a = 0; while (a < was.length && a < now.length && was[a] === now[a]) a++;
    let e = 0; while (e < was.length - a && e < now.length - a && was[was.length - 1 - e] === now[now.length - 1 - e]) e++;
    const from = Math.max(was.lastIndexOf(';', a) + 1, was.lastIndexOf('{', a) + 1, 0), cut = (t) => { const end = (() => { const k = t.indexOf(';', t.length - e); return k < 0 ? t.length : k + 1; })(); return t.slice(Math.min(from, a), end).trim(); };
    return [cut(was), cut(now)];
  }
  async function onFileChange(path) {
    if (!spec || !baselines.has(path)) return;
    const now = await textOf(path); if (now === null || !spec) return;
    const lines = diffLines(baselines.get(path), now).map((l) => { const [w, n] = trimmed(l.was, l.now); return { ...l, was: w, now: n }; });
    change = lines.length ? { path, lines } : null;
    paintSide();
  }
  function keepChange() { if (!change) return; textOf(change.path).then((t) => { if (t !== null) baselines.set(change.path, t); change = null; paintSide(); }); }
  function revertChange() { ctx.undo?.(); } // undo is the revert: the file goes back one step and the diff empties by itself

  let queued = 0;
  const later = () => { if (spec && !queued) queued = requestAnimationFrame(() => { queued = 0; redraw(); }); };

  function highlight(s) {
    if (!s || (!s.selector && !s.variable)) { clear(); return { ...counts }; }
    spec = s.variable ? { variable: s.variable.startsWith('--') ? s.variable : `--${s.variable}` } : { selector: String(s.selector), file: s.file || null };
    label = spec.variable ?? spec.selector.replace(/\s+/g, ' ').trim();
    for (const l of layers.values()) l.remove(); layers.clear();
    change = null;
    walkAt = -1;
    redraw();
    snapshot();
    if (places.length) requestAnimationFrame(() => focusPlace(0)); // fly to the first place
    ctx.emit('highlight', { ...spec, ...counts });
    return { ...counts };
  }
  function clear() {
    if (!spec) return;
    spec = null; places = []; change = null; walkAt = -1; baselines.clear();
    for (const l of layers.values()) l.remove(); layers.clear();
    bar.hidden = true; side.hidden = true; delete document.body.dataset.highlight;
    ctx.emit('highlight', null);
  }

  // when the rule or the file is edited the frame loads again: its outlines follow
  ctx.on('render', ({ component }) => { if (spec && ctx.stage.sections.get(component)?.docFrame) redraw(component); });
  ctx.on('doc-change', (f) => { if (spec && f.path) onFileChange(f.path); });
  ctx.on('layout', later); ctx.on('framewidth', later);
  ctx.on('removed', later);

  Object.assign(ctx.stage, { highlight, clearHighlight: clear });

  // ---------- the list: "Highlight rule…" ----------
  const box = document.createElement('div');
  box.id = 'hl-pick'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Highlight a rule or variable'); box.dataset.nodrag = '1';
  box.innerHTML = `<input id="hl-input" role="combobox" aria-expanded="true" aria-controls="hl-list" aria-autocomplete="list" aria-label="Rule or variable to light up" placeholder="A rule (.ss-label) or a variable (--ink-muted)" autocomplete="off" spellcheck="false">
    <ul id="hl-list" role="listbox" aria-label="Rules and variables"></ul>
    <p class="hl-foot"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> light it up (an exact name picks that one) <kbd>Esc</kbd> close</p>`;
  document.body.append(box);
  const input = box.querySelector('#hl-input'), list = box.querySelector('#hl-list');
  let entries = [], shown = [], at = 0, back = null;
  async function collect() {
    const ids = [...ctx.state.components.values()].filter((c) => c.kind === 'html').map((c) => c.component);
    const all = await Promise.all(ids.map((id) => fetch(`/api/component/${encodeURIComponent(id)}/rules`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    const rules = new Map(), vars = new Map();
    for (const d of all) {
      if (!d) continue;
      for (const r of d.rules || []) if (r.kind === 'style') { const k = `${r.file}|${r.selector}`; if (!rules.has(k)) rules.set(k, { kind: 'rule', selector: r.selector, file: r.file, line: r.line, decls: r.decls.length }); }
      for (const [name, defs] of Object.entries(d.vars || {})) if (!vars.has(name)) vars.set(name, { kind: 'variable', variable: name, file: defs[0]?.file, line: defs[0]?.line });
    }
    entries = [...rules.values(), ...vars.values()];
  }
  const nameKey = (e) => (e.selector || e.variable).trim().toLowerCase().replace(/\s+/g, ' ');
  const exactOf = (q) => { q = q.trim().toLowerCase().replace(/\s+/g, ' '); return q ? entries.find((e) => nameKey(e) === q) ?? (q.startsWith('--') || q.startsWith('.') ? null : entries.find((e) => nameKey(e) === `.${q}` || nameKey(e) === `--${q}`)) : null; };
  function paintList() {
    const q = input.value.trim().toLowerCase();
    const exact = exactOf(input.value);
    shown = (q ? entries.filter((e) => nameKey(e).includes(q) || (e.file || '').toLowerCase().includes(q)) : entries);
    if (exact) shown = [exact, ...shown.filter((e) => e !== exact)]; // an exact name comes first, so Enter picks it
    shown = shown.slice(0, 12);
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((e, i) => `<li role="option" id="hl-${i}" data-i="${i}" aria-selected="${i === at}"><code>${esc(e.selector || e.variable)}</code><span>${e.kind === 'variable' ? 'variable' : 'rule'} · ${esc((e.file || '').split('/').pop())}${e.line ? `:${e.line}` : ''}</span></li>`).join('') || '<li class="none" role="presentation">Nothing matches</li>';
    input.setAttribute('aria-activedescendant', shown.length ? `hl-${at}` : '');
  }
  async function pick() {
    if (!box.hidden) { input.focus(); return; }
    back = document.activeElement; document.body.dataset.modal = 'highlight';
    box.hidden = false; input.value = ''; at = 0; entries = []; paintList();
    input.focus();
    await collect(); paintList();
  }
  function closePick() {
    if (box.hidden) return;
    box.hidden = true; delete document.body.dataset.modal; input.blur();
    (back && back !== document.body && back.isConnected ? back : stageEl).focus({ preventScroll: true }); // (a hidden field keeps focus until the next frame: take it now)
  }
  function choose(e) {
    if (!e) return;
    closePick();
    highlight(e.variable ? { variable: e.variable } : { selector: e.selector, file: e.file });
  }
  input.addEventListener('input', () => { at = 0; paintList(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.code === 'ArrowDown' || ev.code === 'ArrowUp') { ev.preventDefault(); at = Math.max(0, Math.min(shown.length - 1, at + (ev.code === 'ArrowDown' ? 1 : -1))); paintList(); list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }
    else if (ev.code === 'Enter') { ev.preventDefault(); choose(exactOf(input.value) ?? shown[at]); }
    else if (ev.code === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePick(); }
  });
  list.addEventListener('mousedown', (ev) => { const li = ev.target.closest('li[data-i]'); if (li) { ev.preventDefault(); choose(shown[Number(li.dataset.i)]); } });
  addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    if (ev.code === 'Escape' && spec && box.hidden && !document.body.dataset.modal && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) { ev.preventDefault(); ev.stopImmediatePropagation(); clear(); return; }
    // while something is lit, Tab and Shift-Tab walk its places (select, and fly there); the last Tab goes on to Keep / Revert when there is a change to decide on
    if (ev.key === 'Tab' && spec && box.hidden && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.isComposing && !document.body.dataset.modal && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) {
      if (lastFocusOnPanel()) { if (ev.shiftKey && document.activeElement === side.querySelector('#hl-keep')) { ev.preventDefault(); ev.stopImmediatePropagation(); stageEl.focus({ preventScroll: true }); walk(-1); } return; } // inside the panel Tab keeps its normal job
      if (!(ev.target === stageEl || (stageEl.contains(ev.target) && !ev.target.closest('button, a[href], input, select, textarea, summary, [role=dialog], [role=slider], #bp-panel, #bp-strip, #theme-wipe, #play-bar, #ask-styles')))) return; // from a control elsewhere, Tab moves focus as it always did
      ev.preventDefault(); ev.stopImmediatePropagation();
      const onPlace = walkAt >= 0 && places[walkAt] && ctx.state.selection?.component === places[walkAt].id && ctx.state.selection?.node === places[walkAt].node; // the place is selected first; only the Tab after that goes on to Keep
      if (!ev.shiftKey && change && walkAt === places.length - 1 && onPlace) { side.querySelector('#hl-keep')?.focus(); return; }
      walk(ev.shiftKey ? -1 : 1);
      return;
    }
    if (ev.code === 'KeyH' && ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !(document.body.dataset.modal && box.hidden)) { ev.preventDefault(); ev.stopImmediatePropagation(); pick(); }
  }, true);

  ctx.highlight = { walk, keep: keepChange, revert: revertChange, hasChange: () => !!change, pick, active: () => (spec ? { ...spec, ...counts } : null), places: () => counts.places, rows: () => places.map((p) => ({ component: p.id, node: p.node, indirect: p.indirect })) };
  return ctx.highlight;
}
