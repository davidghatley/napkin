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
export function usersOfVariable(doc, name) {
  const fam = variableFamily(doc, name), found = new Set();
  const uses = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some((m) => fam.has(m[1]));
  for (const sheet of doc.styleSheets) for (const r of styleRules(sheet)) {
    if (!declsOf(r.style.cssText).some((d) => !d.prop.startsWith('--') && uses(d.value))) continue;
    for (const el of matchAll(doc, r.selectorText)) found.add(el);
  }
  for (const el of doc.querySelectorAll('[style*="var("]')) if (declsOf(el.getAttribute('style') || '').some((d) => !d.prop.startsWith('--') && uses(d.value))) found.add(el);
  return found;
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
  stageEl.append(bar);
  let spec = null, label = '', counts = { places: 0, frames: 0 };
  const layers = new Map(); // component id -> layer element

  const frames = () => [...ctx.stage.sections].filter(([, sec]) => sec.docFrame?.doc()).map(([id, sec]) => [id, sec.docFrame]);
  function elementsIn(id, f) {
    const doc = f.doc(), comp = ctx.state.components.get(id);
    if (!doc || !spec) return [];
    if (spec.variable) return [...usersOfVariable(doc, spec.variable)];
    if (spec.file && !sheetFiles(doc, comp?.path).has(spec.file)) return [];
    return [...matchAll(doc, spec.selector)];
  }
  function layerOf(id, f) {
    let l = layers.get(id);
    if (l?.isConnected) return l;
    l = document.createElement('div'); l.className = 'hl-layer'; l.setAttribute('aria-hidden', 'true'); l.dataset.nodrag = '1';
    f.cell.append(l); layers.set(id, l);
    return l;
  }
  // (Re)draw one frame's outlines. Returns how many places in it.
  function draw(id, f, ordinal) {
    const els = elementsIn(id, f);
    const l = layers.get(id);
    if (!els.length) { l?.remove(); layers.delete(id); return 0; }
    const layer = layerOf(id, f), win = f.doc().defaultView;
    const boxes = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      boxes.push(r);
      if (boxes.length >= MAX_BOXES) break;
    }
    layer.innerHTML = boxes.map((r, i) => `<i class="hl-box" style="left:${(r.left + win.scrollX).toFixed(1)}px;top:${(r.top + win.scrollY).toFixed(1)}px;width:${r.width.toFixed(1)}px;height:${r.height.toFixed(1)}px">${i === 0 ? `<b>${ordinal}</b>` : ''}</i>`).join('');
    layer.dataset.places = String(els.length);
    return els.length;
  }
  function redraw(only) {
    if (!spec) return;
    let n = 0, fr = 0, k = 0;
    for (const [id, f] of frames()) {
      if (only && id !== only) { const p = Number(layers.get(id)?.dataset.places || 0); if (p) { n += p; fr++; k++; } continue; }
      const p = draw(id, f, k + 1);
      if (p) { n += p; fr++; k++; }
    }
    counts = { places: n, frames: fr };
    document.body.dataset.highlight = String(n);
    paintBar();
  }
  function paintBar() {
    bar.hidden = !spec;
    if (!spec) return;
    bar.innerHTML = `<code>${esc(label)}</code> <span class="hl-count">lights ${counts.places} place${counts.places === 1 ? '' : 's'}${counts.frames ? ` in ${counts.frames} component${counts.frames === 1 ? '' : 's'}` : ''}</span><button type="button" id="hl-clear" aria-label="Clear the highlight (Escape)">Clear <kbd>Esc</kbd></button>`;
    bar.querySelector('#hl-clear').onclick = () => clear();
  }
  let queued = 0;
  const later = () => { if (spec && !queued) queued = requestAnimationFrame(() => { queued = 0; redraw(); }); };

  function highlight(s) {
    if (!s || (!s.selector && !s.variable)) { clear(); return counts; }
    spec = s.variable ? { variable: s.variable.startsWith('--') ? s.variable : `--${s.variable}` } : { selector: String(s.selector), file: s.file || null };
    label = spec.variable ?? spec.selector.replace(/\s+/g, ' ').trim();
    for (const l of layers.values()) l.remove(); layers.clear();
    redraw();
    ctx.emit('highlight', { ...spec, ...counts });
    return { ...counts };
  }
  function clear() {
    if (!spec) return;
    spec = null; for (const l of layers.values()) l.remove(); layers.clear();
    bar.hidden = true; delete document.body.dataset.highlight;
    ctx.emit('highlight', null);
  }

  // when the rule or the file is edited the frame loads again: its outlines follow
  ctx.on('render', ({ component }) => { if (spec && ctx.stage.sections.get(component)?.docFrame) redraw(component); });
  ctx.on('layout', later); ctx.on('framewidth', later);
  ctx.on('removed', later);

  Object.assign(ctx.stage, { highlight, clearHighlight: clear });

  // ---------- the list: "Highlight rule…" ----------
  const box = document.createElement('div');
  box.id = 'hl-pick'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Highlight a rule or variable'); box.dataset.nodrag = '1';
  box.innerHTML = `<input id="hl-input" role="combobox" aria-expanded="true" aria-controls="hl-list" aria-autocomplete="list" aria-label="Rule or variable to light up" placeholder="A rule (.ss-label) or a variable (--ink-muted)" autocomplete="off" spellcheck="false">
    <ul id="hl-list" role="listbox" aria-label="Rules and variables"></ul>
    <p class="hl-foot"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> light it up <kbd>Esc</kbd> close</p>`;
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
  function paintList() {
    const q = input.value.trim().toLowerCase();
    shown = (q ? entries.filter((e) => (e.selector || e.variable).toLowerCase().includes(q) || (e.file || '').toLowerCase().includes(q)) : entries).slice(0, 12);
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
    else if (ev.code === 'Enter') { ev.preventDefault(); choose(shown[at]); }
    else if (ev.code === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePick(); }
  });
  list.addEventListener('mousedown', (ev) => { const li = ev.target.closest('li[data-i]'); if (li) { ev.preventDefault(); choose(shown[Number(li.dataset.i)]); } });
  addEventListener('keydown', (ev) => {
    if (ev.isComposing) return;
    if (ev.code === 'Escape' && spec && box.hidden && !document.body.dataset.modal && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) { ev.preventDefault(); ev.stopImmediatePropagation(); clear(); return; }
    if (ev.code === 'KeyH' && ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !(document.body.dataset.modal && box.hidden)) { ev.preventDefault(); ev.stopImmediatePropagation(); pick(); }
  }, true);

  ctx.highlight = { pick, active: () => (spec ? { ...spec, ...counts } : null), places: () => counts.places };
  return ctx.highlight;
}
