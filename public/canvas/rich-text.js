// Text being typed on the canvas, new or already in a file (standards section 4 rules 3, 4 and 9): one set of keys and one way
// of writing it back, so new text and text edited again behave the same.
//   Enter and Shift+Enter: a new line (<br>).  Ctrl/Cmd+B, I, U: bold, italic, underline (<strong>, <em>, <u>).
//   Escape or Ctrl/Cmd+Enter: done (onCommit).  Arrows move the caret (the browser's own).  Paste and drop: plain text only.
//   richText(el, { onCommit }) -> detach()       wires an element that is contenteditable
//   serialize(el) -> html                         its content as clean HTML: text, <br>, <strong>, <em>, <u>, and the inline
//                                                 elements the file already had (marked data-nk-keep, kept with their attributes)
//   inlineOnly(el) -> bool                        everything inside it is inline text markup (it can be edited as text)
export const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr']);
const MAP = { b: 'strong', i: 'em' };
const MADE = new Set(['strong', 'em', 'u']); // what the keys make
const FORMAT = { b: 'bold', i: 'italic', u: 'underline' };
const escText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
const escAttr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export const inlineOnly = (el) => [...el.querySelectorAll('*')].every((x) => INLINE.has(x.localName));

export function serialize(el) {
  const keepNbsp = el.dataset.nkNbsp === '1'; // the file had &nbsp; here: keep them; otherwise a space the browser wrote as one is a space
  // where the element keeps line breaks (white-space: pre and the like) the browser types a new line as a line break character:
  // it is written as <br>, the same as everywhere else
  const lines = /pre|break-spaces/.test(el.ownerDocument.defaultView?.getComputedStyle(el).whiteSpace || '');
  const walk = (n) => {
    let out = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { const t = escText(keepNbsp ? c.data : c.data.replace(/\u00a0/g, ' ')); out += lines ? t.replace(/\r?\n/g, '<br>') : t; }
      else if (c.nodeType !== 1) continue;
      else if (c.localName === 'br') out += '<br>';
      else if (c.hasAttribute('data-nk-keep')) {
        const attrs = [...c.attributes].filter((a) => a.name !== 'data-nk-keep').map((a) => (a.value === '' ? ` ${a.name}` : ` ${a.name}="${escAttr(a.value)}"`)).join('');
        out += `<${c.localName}${attrs}>${walk(c)}</${c.localName}>`;
      } else if (MADE.has(MAP[c.localName] || c.localName)) {
        const t = MAP[c.localName] || c.localName, inner = walk(c);
        if (inner) out += `<${t}>${inner}</${t}>`;
      } else if (c.localName === 'div' || c.localName === 'p') out += (out && !out.endsWith('<br>') ? '<br>' : '') + walk(c); // a line the browser made
      else out += walk(c); // a span or font the browser made: only its text
    }
    return out;
  };
  let html = walk(el);
  // <strong>a</strong><strong>b</strong> is one run; a line break at the end of a run goes after it
  for (let prev = ''; prev !== html;) { prev = html; html = html.replace(/<\/(strong|em|u)><\1>/g, '').replace(/<br><\/(strong|em|u)>/g, '</$1><br>').replace(/<(strong|em|u)><\/\1>/g, ''); }
  return html.replace(/(<br>)+$/, ''); // the browser's placeholder after a last new line
}

function insertPlain(doc, text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, i) => { if (i) doc.execCommand('insertLineBreak'); if (line) doc.execCommand('insertText', false, line); });
}

export function richText(el, { onCommit }) {
  const doc = el.ownerDocument;
  try { doc.execCommand('styleWithCSS', false, false); } catch {} // <b>, not <span style>
  el.dataset.nkNbsp = /\u00a0/.test(el.textContent) ? '1' : '0';
  // The browser decides "already bold?" from the computed style, so in a heading (bold by its own style) Ctrl+B would write a
  // span with font-weight: normal. For that one call the element is plain, so the toggle follows the markup: <b>, <i>, <u> only.
  const format = (cmd) => {
    const was = el.getAttribute('style');
    el.style.setProperty('font-weight', 'normal', 'important'); el.style.setProperty('font-style', 'normal', 'important'); el.style.setProperty('text-decoration-line', 'none', 'important');
    try { doc.execCommand(cmd); } finally { if (was === null) el.removeAttribute('style'); else el.setAttribute('style', was); }
  };
  const keydown = (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return; // the IME is using this key
    const mod = ev.ctrlKey || ev.metaKey, k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    ev.stopPropagation(); // typing never reaches the canvas keys
    if (ev.key === 'Escape' || (ev.key === 'Enter' && mod)) { ev.preventDefault(); onCommit(); return; }
    if (ev.key === 'Enter' && !ev.altKey) { ev.preventDefault(); doc.execCommand('insertLineBreak'); return; }
    if (mod && !ev.altKey && !ev.shiftKey && FORMAT[k]) { ev.preventDefault(); format(FORMAT[k]); }
  };
  const beforeinput = (ev) => {
    if (ev.inputType === 'insertParagraph') { ev.preventDefault(); doc.execCommand('insertLineBreak'); }
  };
  const paste = (ev) => { ev.preventDefault(); insertPlain(doc, ev.clipboardData?.getData('text/plain') ?? ''); };
  const drop = (ev) => { ev.preventDefault(); const t = ev.dataTransfer?.getData('text/plain'); if (t) insertPlain(doc, t); };
  el.addEventListener('keydown', keydown);
  el.addEventListener('beforeinput', beforeinput);
  el.addEventListener('paste', paste);
  el.addEventListener('drop', drop);
  return () => {
    el.removeEventListener('keydown', keydown); el.removeEventListener('beforeinput', beforeinput);
    el.removeEventListener('paste', paste); el.removeEventListener('drop', drop);
    delete el.dataset.nkNbsp;
  };
}
