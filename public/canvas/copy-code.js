// Copy gives real code (DREAM moment 10). Cmd-C on a selected element of an HTML or React file puts the file's own text on the
// clipboard: the element's exact bytes, then the exact text of the CSS rules that apply to it, each under a comment with its
// file and line. As text/plain that is the code to read or paste anywhere; as text/html it is the element's markup (for a React
// file, the markup the browser drew from it). Cmd-V on a selected parent inserts a copied element through the engine's
// `insert` op: one edit, one undo.
//   initCopyCode(ctx) -> ctx.copyCode = { copy(nodes?), paste(text, html, target?), prepare(), picks() }; ctx.clip = the last copy's { text, html, parts }
// Several selected elements are copied together, in file order (one source after the other, then the CSS of all of them once);
// a frame copies the elements at the top of its body. Pasting napkin's own copy of several puts each back as a sibling.
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
  const ready = new Map();               // `${component}|${node}|${revision}|${rulesAt}` -> payload of one element (a few recent ones)
  const sel = () => { const s = ctx.state.selection; const c = s && ctx.state.components.get(s.component); return c && ENGINE.has(c.kind) ? { s, c } : null; };
  const frameOf = (id) => ctx.stage.sections.get(id)?.docFrame ?? null;
  const TOP = new Set(['html', 'body', 'head']), SKIP = new Set(['script', 'style', 'template', 'link', 'meta', 'title', 'head', 'base', 'noscript']);
  // What a copy takes: every selected element of the file (an element whose ancestor is selected goes with it), in the
  // order the file has them; a frame (the file's card, or its <html> / <body>) gives the elements at the top of its body.
  function picks(x = sel(), nodes = null) {
    if (!x) return [];
    const tree = frameOf(x.s.component)?.tree()?.tree || [];
    const order = [], parent = new Map(), byNode = new Map();
    (function walk(list, up) { for (const n of list) { order.push(n.node); parent.set(n.node, up); byNode.set(n.node, n); walk(n.children, n.node); } })(tree, null);
    let want = nodes ? new Set(nodes) : new Set(ctx.state.selections.filter((y) => y.component === x.s.component).map((y) => y.node));
    const frame = !nodes && (x.s.card || TOP.has(byNode.get(x.s.node)?.tag)) && ctx.state.selections.length === 1;
    if (frame) {
      const body = (function find(l) { for (const n of l) { if (n.tag === 'body') return n; const r = find(n.children); if (r) return r; } return null; })(tree);
      const top = body ? body.children : tree.flatMap((n) => (n.tag === 'html' ? n.children : [n]));
      want = new Set(top.filter((n) => !SKIP.has(n.tag) && !TOP.has(n.tag)).map((n) => n.node));
    }
    const under = (id) => { for (let p = parent.get(id); p; p = parent.get(p)) if (want.has(p)) return true; return false; };
    return order.filter((id) => want.has(id) && !under(id));
  }
  ctx.copyCode = { picks: () => picks() }; // (filled below; the edit verbs ask which elements a copy takes)

  async function rulesOf(id) {
    const hitc = rulesCache.get(id);
    if (hitc && hitc.at === rulesAt) return hitc.data;
    const data = await fetch(`/api/component/${enc(id)}/rules`).then((r) => r.json()).catch(() => ({ rules: [], vars: {} }));
    rulesCache.set(id, { at: rulesAt, data });
    return data;
  }

  // The payload for one element: server bytes + the rules the browser matched. Cached by what it depends on.
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
    if (ready.size > 40) ready.clear();
    ready.set(key, p);
    return p;
  }
  // Several elements: each one's code in file order, then the CSS that applies to any of them, once.
  const keyOf = (x, nodes) => `${x.s.component}|${nodes.join(',')}|${x.c.revision}|${rulesAt}`;
  const bundles = new Map(); // keyOf -> payload (the latest only)
  async function bundle(x, nodes) {
    const key = keyOf(x, nodes);
    if (bundles.has(key)) return bundles.get(key);
    const ps = await Promise.all(nodes.map((node) => build({ ...x.s, node }, x.c)));
    let p = ps[0];
    if (ps.length > 1) {
      const seen = new Set(), css = [];
      for (const q of ps) for (const r of q.css) { const k = `${r.file}:${r.line}`; if (!seen.has(k)) { seen.add(k); css.push(r); } }
      const vars = [...new Set(ps.flatMap((q) => q.vars || []))];
      const source = ps.map((q) => q.source).join('\n');
      const label = (r) => `/* ${r.file}:${r.line}${r.context?.length ? ' in ' + r.context.join(' ') : ''} */`;
      const text = css.length ? `${source}\n\n${MARK}\n${css.map((r) => `${label(r)}\n${r.text}`).join('\n\n')}${vars.length ? `\n\n/* custom properties used: ${vars.join(', ')} */` : ''}\n` : source;
      p = { ...ps[0], source, text, css, vars, html: ps.map((q) => q.html).join('\n'), rulesCount: css.length, count: ps.length, tags: ps.map((q) => q.tag) };
    }
    p = { ...p, parts: ps.map((q) => q.source), count: ps.length };
    bundles.clear(); bundles.set(key, p);
    return p;
  }
  // Fetch ahead, as soon as an element is selected, so Cmd-C can answer inside the copy event.
  function prepare() {
    const x = sel(), nodes = picks(x);
    return x && nodes.length ? bundle(x, nodes).catch(() => null) : Promise.resolve(null);
  }
  let schedule = 0;
  const soon = () => { clearTimeout(schedule); schedule = setTimeout(() => { prepare(); }, 60); };
  ctx.on('select', soon);
  ctx.on('render', ({ component }) => { if (ctx.state.selection?.component === component) soon(); });
  ctx.on('doc-change', () => { rulesAt++; soon(); });
  ctx.on('doc-styles', () => { rulesAt++; soon(); });

  const toast = (p) => ctx.hint(p.count > 1 ? `Copied ${p.count} elements (${p.tags.map((t) => `<${t}>`).join(', ')}) from ${p.file}${p.rulesCount ? `, with ${p.rulesCount} CSS rule${p.rulesCount === 1 ? '' : 's'}` : ''}` : `Copied the <${p.tag}> from ${p.file}:${p.line}${p.rulesCount ? `, with ${p.rulesCount} CSS rule${p.rulesCount === 1 ? '' : 's'}` : ''}`);

  function fill(data, p) {
    data.setData('text/plain', p.text);
    data.setData('text/html', p.html);
    keep(p);
  }
  // napkin's own last copy: a menu's Paste uses it when the page may not read the clipboard; `parts` pastes several elements as siblings
  const keep = (p) => { ctx.clip = { text: p.text, html: p.html, parts: p.parts }; };
  // A frame's cut copies what is in it; the file stays (Delete file removes it).
  const isFrame = (x) => x.s.card || TOP.has(frameOf(x.s.component)?.node(x.s.node)?.tag);
  const cutAfter = (ev, x) => { if (ev.type !== 'cut') return; if (isFrame(x)) ctx.hint('Copied what the frame holds; the file stays. Delete file removes it'); else ctx.ops?.remove(); };
  // The page-level copy event. Ours only for elements of an engine component; everything else keeps the browser's own copy.
  // Cut is the same copy, then the elements go (one edit, one undo).
  const onCopy = (ev) => {
    if (typing(ev.target) || document.body.dataset.play) return;
    const x = sel(); if (!x || !ev.clipboardData) return;
    if (String(getSelection?.() ?? '').trim()) return; // words selected on the page keep the browser's own copy
    const nodes = picks(x);
    if (!nodes.length) return;
    const p = bundles.get(keyOf(x, nodes));
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (p) { fill(ev.clipboardData, p); toast(p); cutAfter(ev, x); return; }
    // not fetched yet (a very quick Cmd-C): answer through the async clipboard once it is
    bundle(x, nodes).then(async (q) => {
      keep(q);
      cutAfter(ev, x);
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
    // napkin's own copy of several elements goes back as several siblings, in their order (one edit, one undo)
    const clip = ctx.clip?.parts?.length > 1 && code === String(ctx.clip.text || '').split(MARK)[0].trim() ? ctx.clip.parts : [code];
    const edits = clip.map((one, i) => (isReact(c) ? { op: 'insert', parent: into.node, index: index + i, jsx: one } : { op: 'insert', parent: into.node, index: index + i, html: one }));
    const what = clip.length > 1 ? `${clip.length} elements` : `the <${tagOf(code)}>`;
    const r = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component: s.component, baseRevision: c.revision, edits, summary: clip.length > 1 ? `Pasted ${clip.length} elements` : `Pasted <${tagOf(code)}>` }) });
    const j = await r.json().catch(() => ({ ok: false, error: `Paste failed (${r.status})` }));
    if (!j.ok) { ctx.hint(`Could not paste: ${plain(j.error)}`); return j; }
    ctx.hint(`Pasted ${what} into <${into.tag}>. Cmd-Z undoes it`);
    // what was pasted is selected once the frame has drawn it
    const added = clip.map((_, i) => `${into.node}.${index + i}`);
    (async () => { for (let k = 0; k < 160; k++) { const t = fr?.tree(); if (t?.revision === j.revision && added.every((n) => fr.has(n))) { ctx.selectMany(added.map((node) => ({ component: s.component, node, variant: {} }))); return; } await new Promise((res) => setTimeout(res, 25)); } })();
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

  // Cmd-K entries and the menus: the same things without the key chord. `nodes`: the elements to copy (else the selection's).
  async function copy(nodes = null) {
    const x = sel(), list = picks(x, nodes);
    if (!x || !list.length) { ctx.hint('Select an element to copy its code'); return null; }
    const p = await bundle(x, list);
    keep(p);
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([p.text], { type: 'text/plain' }), 'text/html': new Blob([p.html], { type: 'text/html' }) })]); } catch { try { await navigator.clipboard.writeText(p.text); } catch { /* napkin keeps its own copy (ctx.clip) for its Paste */ } }
    toast(p);
    return p;
  }
  async function pasteFromClipboard() {
    try { return await paste(await navigator.clipboard.readText(), ''); } catch { ctx.hint('Napkin cannot read the clipboard from here. Use Cmd-V'); return null; }
  }
  const api = { copy, paste, pasteFromClipboard, prepare, picks: () => picks(), payload: async () => { const x = sel(), nodes = picks(x); return x && nodes.length ? bundle(x, nodes) : null; } };
  ctx.copyCode = api;
  return api;
}
