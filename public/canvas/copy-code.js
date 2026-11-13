// Copy gives real code (DREAM moment 10). Cmd-C on a selected element of an HTML or React file puts the file's own text on the
// clipboard: the element's exact bytes, then the exact text of the CSS rules that apply to it, each under a comment with its
// file and line. As text/plain that is the code to read or paste anywhere; as text/html it is the element's markup (for a React
// file, the markup the browser drew from it). Cmd-V on a selected parent inserts a copied element through the engine's
// `insert` op: one edit, one undo.
//   initCopyCode(ctx) -> ctx.copyCode = { copy(), paste(text, html, target?), prepare() }; ctx.clip = the last copy's { text, html }
// The rules that apply are matched where the browser does it: element.matches() and matchMedia() inside the frame. The
// server only slices bytes (GET /api/component/<id>/copy). The payload is fetched when the element is selected, so the copy
// event itself can fill the clipboard synchronously, which is the only way a copy event can.
import { plain } from './words.js';

const enc = encodeURIComponent;
const ENGINE = new Set(['html', 'tsx', 'jsx']);
const MARK = '/* napkin: the CSS that applies */';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const typing = (t) => !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
const parts = (selector) => { const out = []; let depth = 0, cur = ''; for (const ch of selector) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
// pseudo-elements and states belong to the element they are written on: `.btn:hover::after` styles `.btn`
const STATES = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\b(\([^)]*\))?|:(hover|focus|focus-visible|focus-within|active|visited|target)\b/gi;
const hit = (el, selector) => { try { return el.matches(selector.replace(STATES, '').trim() || '*'); } catch { return false; } };
const short = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// a React file is drawn by the same frames as an HTML one (kind 'html'); its source is told by fileKind
const isReact = (c) => c.kind === 'tsx' || c.kind === 'jsx' || c.fileKind === 'tsx' || c.fileKind === 'jsx';
const tagOf = (src) => /^<\s*([\w:-]+)/.exec(src)?.[1] ?? 'element';

export function initCopyCode(ctx) {
  let rulesAt = 0;                       // bumped when a file changes, so cached rules are read again
  const rulesCache = new Map();          // component -> { at, data }
  const ready = new Map();               // `${component}|${node}|${revision}|${rulesAt}` -> payload (the latest only)
  const sel = () => { const s = ctx.state.selection; const c = s && ctx.state.components.get(s.component); return c && ENGINE.has(c.kind) ? { s, c } : null; };
  const frameOf = (id) => ctx.stage.sections.get(id)?.docFrame ?? null;

  async function rulesOf(id) {
    const hitc = rulesCache.get(id);
    if (hitc && hitc.at === rulesAt) return hitc.data;
    const data = await fetch(`/api/component/${enc(id)}/rules`).then((r) => r.json()).catch(() => ({ rules: [], vars: {} }));
    rulesCache.set(id, { at: rulesAt, data });
    return data;
  }

  // The payload for the selected element: server bytes + the rules the browser matched. Cached by what it depends on.
  async function build(s, c) {
    const key = `${s.component}|${s.node}|${c.revision}|${rulesAt}`;
    if (ready.has(key)) return ready.get(key);
    const fr = frameOf(s.component), proxy = fr?.element(s.node), el = proxy?.el;
    const data = c.kind === 'html' || c.kind === 'tsx' || c.kind === 'jsx' ? await rulesOf(s.component) : { rules: [], vars: {} };
    const win = el?.ownerDocument?.defaultView;
    const media = (r) => !r.media.length || r.media.every((m) => { try { return win ? win.matchMedia(m).matches : false; } catch { return false; } });
    const rules = el ? (data.rules || []).filter((r) => r.kind === 'style' && media(r) && parts(r.selector).some((p) => hit(el, p))) : [];
    // custom properties the element's code uses (one level of var() inside the matched rules, and its inline style)
    const names = new Set();
    const scan = (v) => { for (const m of String(v).matchAll(/var\(\s*(--[\w-]+)/g)) names.add(m[1]); };
    for (const r of rules) for (const d of r.decls) scan(d.value);
    scan(fr?.node(s.node)?.attrs?.style ?? '');
    for (const n of [...names]) for (const d of data.vars?.[n] || []) scan(d.value);
    const q = `node=${enc(s.node)}${rules.map((r) => `&rule=${enc(`${r.file}:${r.start}-${r.end}`)}`).join('')}${[...names].map((n) => `&var=${enc(n)}`).join('')}`;
    const p = await fetch(`/api/component/${enc(s.component)}/copy?${q}`).then((r) => r.json());
    if (!p.ok) throw new Error(p.error || 'could not read the element');
    // text/html: the element's own markup; for React, the markup the browser made from it
    p.html = isReact(c) ? (el?.outerHTML ?? p.source) : p.source;
    p.rulesCount = p.css.length;
    ready.clear(); ready.set(key, p);
    return p;
  }
  // Fetch ahead, as soon as an element is selected, so Cmd-C can answer inside the copy event.
  function prepare() {
    const x = sel();
    return x ? build(x.s, x.c).catch(() => null) : Promise.resolve(null);
  }
  let schedule = 0;
  const soon = () => { clearTimeout(schedule); schedule = setTimeout(() => { prepare(); }, 60); };
  ctx.on('select', soon);
  ctx.on('render', ({ component }) => { if (ctx.state.selection?.component === component) soon(); });
  ctx.on('doc-change', () => { rulesAt++; soon(); });
  ctx.on('doc-styles', () => { rulesAt++; soon(); });

  const toast = (p) => ctx.hint(`Copied the <${p.tag}> from ${p.file}:${p.line}${p.rulesCount ? `, with ${p.rulesCount} CSS rule${p.rulesCount === 1 ? '' : 's'}` : ''}`);

  function fill(data, p) {
    data.setData('text/plain', p.text);
    data.setData('text/html', p.html);
    ctx.clip = { text: p.text, html: p.html }; // napkin's own last copy: a menu's Paste uses it when the page may not read the clipboard
  }
  // The page-level copy event. Ours only for an element of an engine component; everything else keeps the browser's own copy.
  // Cut is the same copy, then the element goes (one edit, one undo).
  const onCopy = (ev) => {
    if (typing(ev.target) || document.body.dataset.play) return;
    const x = sel(); if (!x || !ev.clipboardData) return;
    if (String(getSelection?.() ?? '').trim()) return; // words selected on the page keep the browser's own copy
    const key = `${x.s.component}|${x.s.node}|${x.c.revision}|${rulesAt}`;
    const p = ready.get(key);
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (p) { fill(ev.clipboardData, p); toast(p); if (ev.type === 'cut') ctx.ops?.remove(); return; }
    // not fetched yet (a very quick Cmd-C): answer through the async clipboard once it is
    build(x.s, x.c).then(async (q) => {
      ctx.clip = { text: q.text, html: q.html };
      if (ev.type === 'cut') ctx.ops?.remove();
      const item = new ClipboardItem({ 'text/plain': new Blob([q.text], { type: 'text/plain' }), 'text/html': new Blob([q.html], { type: 'text/html' }) });
      await navigator.clipboard.write([item]); toast(q);
    }).catch((e) => ctx.hint(`Could not copy: ${plain(e.message || e)}`));
  };
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);

  // ---------- paste ----------
  const find = (list, id, up = null) => { for (const n of list) { if (n.node === id) return { n, parent: up }; const f = find(n.children, id, n); if (f) return f; } return null; };
  // What a clipboard holds that can go into the file: napkin's own text (the code before the CSS comment), or markup.
  function markup(plainText, html, react) {
    const code = String(plainText || '').split(MARK)[0].trim();
    if (/^<[A-Za-z][\s\S]*>$/.test(code)) return code;
    if (!react && html) {
      const body = new DOMParser().parseFromString(html, 'text/html').body;
      body.querySelectorAll('meta, style').forEach((n) => n.remove());
      const inner = body.innerHTML.replace(/<!--(Start|End)Fragment-->/g, '').trim();
      if (/^<[A-Za-z]/.test(inner)) return inner;
    }
    return null;
  }
  // `target`: the node to paste into instead of the selected one (a frame's menu pastes into its body)
  async function paste(plainText, html, target) {
    const x = sel(); if (!x) return null;
    const { s, c } = x;
    const code = markup(plainText, html, isReact(c));
    if (!code) { ctx.hint('Nothing to paste here: copy an element first'); return null; }
    const fr = frameOf(s.component), tree = fr?.tree()?.tree;
    const at = tree && find(tree, target ?? s.node);
    if (!at) { ctx.hint('Select an element to paste into'); return { ok: false }; }
    // onto a selected element: it becomes the last child. An element that cannot hold children takes it after itself.
    const into = !target && VOID.has(String(at.n.tag).toLowerCase()) && at.parent ? at.parent : at.n;
    const index = into === at.n ? into.children.length : into.children.indexOf(at.n) + 1;
    const edit = isReact(c) ? { op: 'insert', parent: into.node, index, jsx: code } : { op: 'insert', parent: into.node, index, html: code };
    const r = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: s.component, baseRevision: c.revision, edits: [edit], summary: `Pasted <${tagOf(code)}>` }) });
    const j = await r.json().catch(() => ({ ok: false, error: `Paste failed (${r.status})` }));
    if (!j.ok) { ctx.hint(`Could not paste: ${plain(j.error)}`); return j; }
    ctx.hint(`Pasted the <${tagOf(code)}> into <${into.tag}>. Cmd-Z undoes it`);
    return j;
  }
  document.addEventListener('paste', (ev) => {
    if (typing(ev.target) || document.body.dataset.play || !ev.clipboardData) return;
    const x = sel(); if (!x) return;
    const t = ev.clipboardData.getData('text/plain'), h = ev.clipboardData.getData('text/html');
    if (!markup(t, h, isReact(x.c))) return;       // images, plain words and the like keep going to the other paste handlers
    ev.preventDefault(); ev.stopImmediatePropagation();
    paste(t, h).catch((e) => ctx.hint(`Could not paste: ${plain(e.message || e)}`));
  }, true);

  // Cmd-K entries: the same two things without the key chord.
  async function copy() {
    const x = sel();
    if (!x) { ctx.hint('Select an element to copy its code'); return null; }
    const p = await build(x.s, x.c);
    try { await navigator.clipboard.writeText(p.text); toast(p); } catch { document.execCommand('copy'); }
    return p;
  }
  async function pasteFromClipboard() {
    try { return await paste(await navigator.clipboard.readText(), ''); } catch { ctx.hint('Napkin cannot read the clipboard from here. Use Cmd-V'); return null; }
  }
  const api = { copy, paste, pasteFromClipboard, prepare, payload: async () => { const x = sel(); return x ? build(x.s, x.c) : null; } };
  ctx.copyCode = api;
  return api;
}
