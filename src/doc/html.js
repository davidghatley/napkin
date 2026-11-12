// HTML source map (decision 0014). Reads an HTML file the way a browser's tokenizer would and records, for every
// element that has a start tag in the source, where its bytes are: the start tag, each attribute (name and value,
// with its quote style), the content and the end tag. Nothing is normalised: the map only points into the text.
// Elements the browser adds by itself (an implied <tbody>, <head> or <body>) have no start tag and no node (contract
// ruling 8); an element whose end tag is implied (a <li> closed by the next <li>) ends where the browser ends it.
//   parseHtml(s) -> { root, nodes, styles, links, scripts }    s is the file read as latin1 (one char = one byte)
// node: { id, tag, name, start, openEnd, closeStart, end, attrs, children, parent, implicitEnd, foreign, selfClosing }
//   id is the node's path: indexes among its parent's source element children, joined by '.' ("0.1.3").
//   tag is lowercase for HTML elements and as written for SVG/MathML ones; name is always lowercase.
// attr: { name, lname, start, end, valStart, valEnd, quote, value } (valStart null for a bare attribute; value raw latin1)

export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param', 'keygen', 'basefont', 'bgsound', 'frame']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'template']);
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'listing', 'search', 'section', 'summary', 'table', 'ul', 'li', 'dd', 'dt', 'plaintext', 'xmp']);
const SCOPE = new Set(['html', 'table', 'td', 'th', 'caption', 'marquee', 'object', 'applet', 'template', 'svg', 'math']);
const TABLE_PARTS = new Set(['thead', 'tbody', 'tfoot']);

// The attributes of the start tag beginning at `at` (s[at] === '<'), and the index just past its '>'.
// Returns { name, attrs, end, selfClosing } or null when it is not a start tag.
export function readStartTag(s, at) {
  const m = /^<([A-Za-z][^\s/>]*)/.exec(s.slice(at, at + 256));
  if (!m) return null;
  const name = m[1];
  let i = at + m[0].length; const attrs = []; let selfClosing = false;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === '>') return { name, attrs, end: i + 1, selfClosing };
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') { i++; continue; }
    if (ch === '/') { selfClosing = s[i + 1] === '>'; i++; continue; }
    selfClosing = false;
    // attribute name: up to whitespace, '/', '>' or '=' (a leading '=' is part of the name, as in the spec)
    const a = i; i++;
    while (i < n && !/[\s/>=]/.test(s[i])) i++;
    const attr = { name: s.slice(a, i), lname: s.slice(a, i).toLowerCase(), start: a, end: i, valStart: null, valEnd: null, quote: null, value: null };
    let j = i; while (j < n && /[\s]/.test(s[j])) j++;
    if (s[j] === '=') {
      j++; while (j < n && /[\s]/.test(s[j])) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j], close = s.indexOf(q, j + 1);
        const e = close < 0 ? n : close;
        Object.assign(attr, { quote: q, valStart: j + 1, valEnd: e, end: Math.min(e + 1, n), value: s.slice(j + 1, e) });
        i = attr.end;
      } else {
        let e = j; while (e < n && !/[\s>]/.test(s[e])) e++;
        Object.assign(attr, { valStart: j, valEnd: e, end: e, value: s.slice(j, e) });
        i = e;
      }
    }
    attrs.push(attr);
  }
  return { name, attrs, end: n, selfClosing };
}

export function parseHtml(s) {
  const root = { id: '', tag: '#document', name: '#document', start: 0, openEnd: 0, closeStart: s.length, end: s.length, attrs: [], children: [], parent: null };
  const stack = [root];
  const nodes = [], styles = [], links = [], scripts = [];
  const top = () => stack[stack.length - 1];
  const inForeign = () => stack.some((x) => x.foreign);
  // Close the open elements down to and including stack[k], implicitly at `at` (their content ends where the next tag starts).
  const closeTo = (k, at) => {
    while (stack.length > k) {
      const x = stack.pop();
      x.closeStart = at; x.end = at; x.implicitEnd = true;
    }
  };
  const findOpen = (names, boundary) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const x = stack[k];
      if (names.has(x.name)) return k;
      if (boundary(x)) return -1;
    }
    return -1;
  };
  const one = (x) => new Set([x]);
  const scopeStop = (extra) => (x) => SCOPE.has(x.name) || (extra && extra.has(x.name));
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt) && inForeign()) { const e = s.indexOf(']]>', lt); i = e < 0 ? n : e + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { const e = s.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    if (s[lt + 1] === '/') {
      const m = /^<\/([A-Za-z][^\s/>]*)/.exec(s.slice(lt, lt + 256));
      const gt = s.indexOf('>', lt);
      const after = gt < 0 ? n : gt + 1;
      if (!m) { i = after; continue; }
      const lname = m[1].toLowerCase();
      let k = -1;
      for (let j = stack.length - 1; j > 0; j--) if (stack[j].name === lname) { k = j; break; }
      if (k > 0) {
        closeTo(k + 1, lt);
        const x = stack.pop();
        x.closeStart = lt; x.end = after; x.implicitEnd = false;
      }
      i = after; continue;
    }
    const tag = readStartTag(s, lt);
    if (!tag) { i = lt + 1; continue; }
    const lname = tag.name.toLowerCase();
    const foreignParent = top().foreign && top().name !== 'foreignobject';
    const foreign = foreignParent || lname === 'svg' || lname === 'math';
    if (!foreign) {
      // Implied end tags (the parts of the tree-construction rules that decide where an element ends).
      if (P_CLOSERS.has(lname)) { const k = findOpen(one('p'), scopeStop(new Set(['button']))); if (k > 0) closeTo(k, lt); }
      if (lname === 'li') { const k = findOpen(one('li'), scopeStop(new Set(['ul', 'ol', 'menu']))); if (k > 0) closeTo(k, lt); }
      if (lname === 'dd' || lname === 'dt') { const k = findOpen(new Set(['dd', 'dt']), scopeStop(new Set(['dl']))); if (k > 0) closeTo(k, lt); }
      if (lname === 'td' || lname === 'th') { const k = findOpen(new Set(['td', 'th']), (x) => x.name === 'tr' || x.name === 'table' || TABLE_PARTS.has(x.name)); if (k > 0) closeTo(k, lt); }
      if (lname === 'tr') { const k = findOpen(new Set(['tr', 'td', 'th']), (x) => x.name === 'table' || TABLE_PARTS.has(x.name)); if (k > 0) closeTo(k, lt); }
      if (TABLE_PARTS.has(lname)) { const k = findOpen(new Set(['tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup']), (x) => x.name === 'table'); if (k > 0) closeTo(k, lt); }
      if (lname === 'option') { const k = findOpen(one('option'), (x) => x.name === 'select' || x.name === 'datalist'); if (k > 0) closeTo(k, lt); }
      if (lname === 'optgroup') { const k = findOpen(new Set(['option', 'optgroup']), (x) => x.name === 'select'); if (k > 0) closeTo(k, lt); }
      if (lname === 'body' || lname === 'head' || lname === 'html') { /* explicit document parts: nothing to close */ }
    }
    const parent = top();
    const node = {
      id: null, tag: foreign ? tag.name : lname, name: lname, start: lt, openEnd: tag.end, closeStart: tag.end, end: tag.end,
      attrs: tag.attrs, children: [], parent, implicitEnd: false, foreign, selfClosing: false,
    };
    node.id = parent === root ? String(parent.children.length) : `${parent.id}.${parent.children.length}`;
    parent.children.push(node); nodes.push(node);
    const leaf = (!foreign && VOID.has(lname)) || (foreign && tag.selfClosing);
    if (leaf) { node.selfClosing = tag.selfClosing; i = tag.end; }
    else if (!foreign && RAW.has(lname)) {
      const re = new RegExp(`</${lname}(?=[\\s/>])`, 'ig'); re.lastIndex = tag.end;
      const m = re.exec(s);
      const close = m ? m.index : n;
      const gt = m ? s.indexOf('>', close) : -1;
      node.closeStart = close; node.end = gt < 0 ? n : gt + 1;
      if (lname === 'style') styles.push(node);
      if (lname === 'script') scripts.push(node);
      i = node.end;
    } else { stack.push(node); i = tag.end; }
    if (lname === 'link') links.push(node);
  }
  closeTo(1, n);
  for (const x of nodes) if (x.implicitEnd && x.end === n) { /* unclosed at end of file */ }
  return { root, nodes, styles, links, scripts };
}

// Helpers over a parsed document.
export const attrOf = (node, lname) => node.attrs.find((a) => a.lname === lname) || null;
export function byId(doc, id) {
  if (id === '' || id === null || id === undefined) return null;
  let x = doc.root;
  for (const part of String(id).split('.')) { x = x.children[Number(part)]; if (!x) return null; }
  return x;
}
// Where the parsed tree's <body> content is (the <body> node, or the root when the file has none).
export function bodyOf(doc) {
  const html = doc.root.children.find((x) => x.name === 'html');
  return (html || doc.root).children.find((x) => x.name === 'body') || doc.nodes.find((x) => x.name === 'body') || null;
}
// The offset where napkin inserts the applied stylesheets and <base> for /view: just inside <head>, or where the
// browser would open the head (after the doctype, leading comments and the <html> start tag).
export function headInsertAt(s, doc) {
  const head = doc.nodes.find((x) => x.name === 'head');
  if (head) return head.openEnd;
  const html = doc.nodes.find((x) => x.name === 'html');
  if (html) return html.openEnd;
  let i = 0;
  for (;;) {
    const j = s.slice(i).search(/\S/); if (j < 0) return s.length;
    const at = i + j;
    if (s.startsWith('<!--', at)) { const e = s.indexOf('-->', at); i = e < 0 ? s.length : e + 3; continue; }
    if (/^<!doctype/i.test(s.slice(at, at + 9))) { const e = s.indexOf('>', at); i = e < 0 ? s.length : e + 1; continue; }
    return at;
  }
}
