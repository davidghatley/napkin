// Text already in an HTML frame, edited again where it is (standards section 4 rules 3, 4, 6 and 9).
//   Select tool, double-click a text element: it becomes editable in the frame itself, with the word under the pointer selected.
//   Enter or F2 on a selected text element: the same, with all its text selected.
//   F2 on anything else in a frame, or on a card: the card's label becomes the name field (create.js startRename), never a dialog.
//   Escape, Ctrl/Cmd+Enter or a click elsewhere commit: one edit (op text, or op inner when it holds formatting or line breaks),
//   one undo step; the text stays selected and the tool is Select. Text emptied out is removed.
// The keys while typing (new line, bold, italic, underline, plain paste) are rich-text.js's, shared with new text (create.js).
//   initTextEdit(ctx) -> ctx.textEdit = { begin(selection, point?), target(selection), editing(), finish() }
import { richText, serialize, inlineOnly, INLINE } from './rich-text.js';
import { plain } from './words.js';

const NOT_TEXT = new Set(['html', 'head', 'body', 'title', 'script', 'style', 'template', 'svg', 'math', 'select', 'textarea', 'input', 'img', 'video', 'audio', 'canvas', 'iframe', 'object', 'embed', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'picture', 'br', 'hr', 'wbr']);
const WORD = /[\p{L}\p{N}_'’-]/u;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

export function initTextEdit(ctx) {
  const stageEl = document.querySelector('#stage');
  const htmlFile = (c) => c && !c.item && c.kind === 'html' && (c.fileKind ?? 'html') === 'html' && !c.readOnly;
  let editing = null;

  // The text element a selection stands for: the element itself, or, for bold or a link inside a paragraph, the element that
  // holds the whole run of text. null when it is not text (a box, a list, an image, the body).
  function target(sel) {
    const c = sel && ctx.state.components.get(sel.component), df = ctx.stage.sections.get(sel?.component)?.docFrame;
    if (!htmlFile(c) || !df?.doc()) return null;
    let el = df.element(sel.node)?.el;
    if (!el) return null;
    while (INLINE.has(el.localName) && el.parentElement && !NOT_TEXT.has(el.parentElement.localName) && inlineOnly(el.parentElement) && df.nodeOf(el.parentElement)) el = el.parentElement;
    if (NOT_TEXT.has(el.localName) || !inlineOnly(el) || !el.textContent.trim()) return null;
    const node = df.nodeOf(el);
    return node ? { component: sel.component, node, df, el } : null;
  }

  // The word under a page point, inside el (its text node and offsets), or null when the point is not on a word.
  function wordAt(df, el, x, y) {
    const f = df.iframe(), d = df.doc(), fr = f.getBoundingClientRect(), z = f.offsetWidth ? fr.width / f.offsetWidth : 1;
    const r = d.caretRangeFromPoint?.((x - fr.left) / z - f.clientLeft, (y - fr.top) / z - f.clientTop);
    if (!r || r.startContainer.nodeType !== 3 || !el.contains(r.startContainer)) return null;
    const t = r.startContainer.data;
    let a = r.startOffset, b = a;
    while (a > 0 && WORD.test(t[a - 1])) a--;
    while (b < t.length && WORD.test(t[b])) b++;
    return { node: r.startContainer, a, b };
  }

  function begin(sel, point = null) {
    const t = target(sel);
    if (!t) return false;
    editing?.finish(true);
    const { df, el, component, node } = t;
    const f = df.iframe(), d = df.doc(), win = d.defaultView;
    for (const x of el.querySelectorAll('*')) x.setAttribute('data-nk-keep', ''); // what the file has stays as the file has it
    ctx.select({ component, node, variant: {} });
    const done = (how) => finish(how);
    const detach = richText(el, { onCommit: () => done('key') });
    const before = serialize(el);
    el.contentEditable = 'true'; el.spellcheck = false;
    document.body.dataset.textEdit = '1'; df.cell.dataset.textEdit = '1'; // the frame takes the pointer while its text is edited (doc.css)
    f.focus(); el.focus({ preventScroll: true });
    const s = win.getSelection(), range = d.createRange();
    const w = point && wordAt(df, el, point.x, point.y);
    if (w) { range.setStart(w.node, w.a); range.setEnd(w.node, w.b); } else range.selectNodeContents(el);
    s.removeAllRanges(); s.addRange(range);
    // a press anywhere outside the frame commits, as does focus leaving the element
    const outside = (ev) => { if (ev.target !== f) done('away'); };
    const blur = () => setTimeout(() => { if (editing?.el === el && !(d.hasFocus() && d.activeElement === el)) done('away'); }, 0);
    addEventListener('pointerdown', outside, true);
    el.addEventListener('blur', blur);
    // Auto-width text that is all a frame holds (made by a click with the Text tool: white-space pre, the body hugging it): the frame
    // grows sideways with what is typed, and the new width is written with the text, in the same undo step (standards 4.1).
    const hug = (() => {
      const body = d.body, ws = win.getComputedStyle(el).whiteSpace;
      if (!body || !/^(pre|nowrap)$/.test(ws) || el.parentElement !== body || !body.style.width) return null;
      if ([...body.children].some((k) => k !== el && !['script', 'style', 'template'].includes(k.localName))) return null;
      const bodyNode = df.nodeOf(body);
      return bodyNode ? { body, bodyNode, was: body.style.width, wasFrame: df.width } : null;
    })();
    const fit = () => { if (!hug) return null; const w = Math.max(48, Math.ceil(el.scrollWidth) + 1); hug.body.style.width = `${w}px`; if (w !== df.width) df.setWidth(w); return w; };
    if (hug) el.addEventListener('input', fit);
    let over = false;
    async function finish(how) {
      if (over) return; over = true;
      editing = null;
      const html = serialize(el), text = el.textContent;
      const hugW = hug ? fit() : null; if (hug) el.removeEventListener('input', fit);
      detach(); removeEventListener('pointerdown', outside, true); el.removeEventListener('blur', blur);
      el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck');
      for (const x of el.querySelectorAll('[data-nk-keep]')) x.removeAttribute('data-nk-keep');
      delete document.body.dataset.textEdit; delete df.cell.dataset.textEdit;
      win.getSelection()?.removeAllRanges();
      if (d.activeElement === el) el.blur();
      f.blur(); if (how === 'key') stageEl.focus({ preventScroll: true });
      const putBack = () => { if (hug) { hug.body.style.width = hug.was; if (df.width !== hug.wasFrame) df.setWidth(hug.wasFrame); } };
      if (how === 'cancel' || html === before) { putBack(); if (how === 'key') ctx.select({ component, node, variant: {} }); return; }
      const c = ctx.state.components.get(component);
      const flat = !/</.test(html) && !/</.test(before) && !el.children.length;
      const edits = !text.trim() ? [{ op: 'delete', node }]
        : flat && !/\u00a0/.test(text) ? [{ op: 'text', node, value: text.trim() }]
        : [{ op: 'inner', node, html: html.replace(/^\s+|\s+$/g, '') }];
      const widen = hug && edits[0].op !== 'delete' && hugW && `${hugW}px` !== hug.was;
      if (widen) edits.push({ op: 'style', node: hug.bodyNode, prop: 'width', value: `${hugW}px` });
      const res = await ctx.fetch('/api/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component, baseRevision: c?.revision, edits, summary: edits[0].op === 'delete' ? 'Removed empty text' : 'Edited text', ...(widen && { canvas: { width: hugW } }) }) });
      const r = await res.json().catch(() => ({ ok: false, error: `server answered ${res.status}` }));
      if (!r.ok) { el.innerHTML = before; putBack(); ctx.hint(`Could not change the text: ${plain(r.error)}`); return; }
      if (widen && c) c.width = hugW;
      if (how !== 'key' || edits[0].op === 'delete') return;
      // the text stays selected once the frame has drawn the new revision
      for (let i = 0; i < 300; i++) {
        const sec = ctx.stage.sections.get(component);
        if (sec?.el.dataset.revision === String(r.revision) && sec.docFrame?.has(node)) break;
        await sleep(20);
      }
      if (!editing) ctx.select({ component, node, variant: {} });
    }
    editing = { el, finish: done };
    return true;
  }

  // Select tool, a double-click in an HTML frame (standards section 5 rule 2): on selected text it edits, the word under the
  // pointer selected; otherwise it selects one level deeper toward the pointer. (The clicks before it picked the level.)
  stageEl.addEventListener('dblclick', (ev) => {
    if (ctx.state.tool !== 'select' || document.body.dataset.play || ev.target.closest?.('.cmp-head, [data-nodrag], input')) return;
    const id = ev.target.closest?.('.doc-cell')?.closest('section.cmp')?.dataset.component;
    const p = id && ctx.stage.sections.get(id)?.docFrame?.pick(ev.clientX, ev.clientY);
    if (!p) return;
    const s = ctx.state.selections.length === 1 && ctx.state.selection?.component === id ? ctx.state.selection : null;
    const point = { x: ev.clientX, y: ev.clientY };
    if (s && target(s) && begin(s, point)) { ev.preventDefault(); ev.stopPropagation(); return; }
    const next = ctx.stage.deeper?.(id, p.dataset.n);
    if (next) { ctx.select({ component: id, node: next, variant: {} }); ev.preventDefault(); ev.stopPropagation(); return; }
    if (begin({ component: id, node: p.dataset.n, variant: {} }, point)) { ev.preventDefault(); ev.stopPropagation(); }
  });

  // Enter and F2 (registered before nav.js, so Enter edits text rather than focusing the card; actions.js 'text-reedit').
  addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.isComposing || typing(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    if (ev.key !== 'Enter' && ev.key !== 'F2') return;
    if (document.body.dataset.modal || document.body.dataset.play || ctx.state.tool !== 'select' || editing) return;
    if (ev.target.closest?.('button, a, summary, [role=treeitem], [role=option], [role=tab], #layers, #doc-dock')) return; // a row or a control keeps its own Enter and F2
    const sel = ctx.state.selections.length === 1 ? ctx.state.selection : null;
    if (!sel) return;
    if (begin(sel)) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    if (ev.key === 'F2') { ev.preventDefault(); ev.stopImmediatePropagation(); ctx.cmpOps?.rename(sel.component); }
  }, true);

  const api = { begin, target: (sel) => !!target(sel), editing: () => !!editing, finish: () => editing?.finish('key') };
  ctx.textEdit = api;
  return api;
}
