// LAY-10: an HTML snippet from the clipboard becomes dialect nodes, or is refused with the reason. Never an approximation:
// anything the dialect cannot hold exactly (a class, a script, a <style>, an svg, text beside elements, a space that would render between
// inline elements, a bare number where CSS needs a unit ...) refuses the whole snippet. Where HTML has parsing rules (self-closing
// non-void tags, first duplicate attribute wins, bogus comments, character references) they are followed, or the snippet is refused if unsure.
// Pure (no DOM), so the same code runs in the page and in the tests.
import { TAGS, VOID, unsafeCssValue } from './model.js';
import { ENTITIES, LEGACY } from './html-entities.js';

const VOID_HTML = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// HTML5: numeric references 0x80..0x9F are windows-1252 characters
const CP1252 = [0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178];
const cp = (n) => {
  if (n >= 0x80 && n <= 0x9f) n = CP1252[n - 0x80];
  if (!(n > 0 && n <= 0x10ffff) || (n >= 0xd800 && n <= 0xdfff)) no(`&#${n}; is not a valid character`);
  return String.fromCodePoint(n);
};
class Refuse extends Error {}
const no = (why) => { throw new Refuse(why); };
// Character references the way the HTML spec reads them. Numeric ones (with or without ";") and ";" names decode. The legacy names
// (&copy, &amp, &lt ...) also decode without ";", by longest prefix (&notit; is "\u00ac" + "it;"), except in an attribute value when a
// letter, digit or "=" follows. Anything else stays literal text, exactly as a browser shows it ("Fish &chips").
function decode(t, inAttr = false) {
  return t.replace(/&(?:#([xX][0-9a-fA-F]+|\d+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g, (m, num, name, semi, off) => {
    if (num !== undefined) return cp(num[0] === 'x' || num[0] === 'X' ? parseInt(num.slice(1), 16) : Number(num));
    if (semi && Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
    for (let n = Math.min(name.length, 6); n > 0; n--) {
      const head = name.slice(0, n);
      if (!LEGACY.has(head)) continue;
      const next = n < name.length ? name[n] : t[off + m.length] ?? '';
      if (inAttr && /[=a-zA-Z0-9]/.test(next)) return m; // in an attribute, before a letter, digit or "=": literal
      return ENTITIES[head] + m.slice(1 + n);
    }
    return m;
  });
}
const NOT_WS = /[^ \t\r\n\f]/; // HTML white space: a non-breaking space is NOT white space

// Elements whose opening tag closes an open <p> (so "<p>a<div>" is two siblings in HTML, which napkin will not guess at)
const CLOSES_P = new Set(['article', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'header', 'nav', 'p', 'section', 'ul']);

const RAW = new Set(['style', 'script', 'title', 'textarea', 'svg', 'math', 'template', 'noscript', 'iframe', 'object']);
function tokenize(html) {
  const root = { tag: '#root', attrs: {}, kids: [] }, stack = [root];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+|<)/gi;
  let m;
  while ((m = re.exec(html))) {
    const top = stack.at(-1);
    if (m[0].startsWith('<!') || m[0].startsWith('<?')) continue;
    if (m[1]) { // closing tag
      const tag = m[1].toLowerCase();
      if (VOID_HTML.has(tag)) continue;
      if (top.tag !== tag) no(`the closing </${tag}> does not match <${top.tag}>`);
      stack.pop();
    } else if (m[2]) {
      const tag = m[2].toLowerCase(), attrs = {};
      for (const a of m[3].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) { const k = a[1].toLowerCase(); if (!(k in attrs)) attrs[k] = decode(a[2] ?? a[3] ?? a[4] ?? '', true); } // the first duplicate wins
      if (tag === 'p' && stack.some((x) => x.tag === 'p')) no('a <p> is opened inside a <p>; HTML would close the first one, so napkin will not guess');
      if (CLOSES_P.has(tag) && top.tag === 'p') no(`a <${tag}> is opened inside a <p>; HTML would close the paragraph first, so napkin will not guess`);
      if ((tag === 'li' && top.tag === 'li') || (tag === 'a' && stack.some((x) => x.tag === 'a')) || (tag === 'button' && stack.some((x) => x.tag === 'button'))) no(`a <${tag}> inside a <${tag}> is re-parsed by HTML; close the first one`);
      if (RAW.has(tag)) no(`<${tag}> is not an element napkin can write`); // its content is not HTML, so stop before reading it as HTML
      const el = { tag, attrs, kids: [] };
      top.kids.push(el);
      if (!VOID_HTML.has(tag)) stack.push(el); // "<div/>" does not close a div in HTML
    } else top.kids.push(m[0]);
  }
  if (stack.length > 1) no(`<${stack.at(-1).tag}> is never closed`);
  return root;
}

// Properties whose bare numbers are valid CSS. Everywhere else a bare number (width:100) is invalid, ignored by browsers, and so refused.
const UNITLESS = new Set(['opacity', 'fontWeight', 'lineHeight', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'aspectRatio', 'zoom', 'gridArea', 'gridColumn', 'gridRow', 'gridColumnStart', 'gridColumnEnd', 'gridRowStart', 'gridRowEnd', 'font', 'columnCount', 'columns', 'orphans', 'widows', 'tabSize', 'scale', 'fillOpacity', 'strokeOpacity', 'floodOpacity', 'stopOpacity', 'strokeWidth', 'strokeMiterlimit', 'strokeDashoffset', 'strokeDasharray', 'lineClamp', 'maxLines', 'fontSizeAdjust', 'counterIncrement', 'counterReset', 'counterSet', 'animationIterationCount']);
const bareTokens = (v) => { const out = []; let d = 0, cur = ''; for (const ch of v) { if (ch === '(') d++; if (ch === ')') d--; if (d === 0 && /[\s,/]/.test(ch)) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out.filter((x) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(x) && Number(x) !== 0); };
const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
// Split on ";" outside parentheses and quotes (url(data:image/png;base64,...) and 'a;b' stay whole); comments are dropped.
function parseStyle(text) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = {}, decls = []; let d = 0, q = '', cur = '';
  for (const ch of text) {
    if (q) { if (ch === q) q = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === '(') d++; if (ch === ')') d--;
    if (ch === ';' && d === 0) { decls.push(cur); cur = ''; } else cur += ch;
  }
  decls.push(cur);
  for (const raw of decls) {
    if (!raw.trim()) continue;
    const i = raw.indexOf(':');
    if (i < 0) no(`style "${raw.trim()}" is not a property: value pair`);
    const name = raw.slice(0, i).trim().toLowerCase(), value = raw.slice(i + 1).trim();
    if (name.startsWith('--')) no(`the custom property ${name} cannot be kept`);
    if (name.startsWith('-')) no(`the vendor property ${name} cannot be kept`);
    if (/!\s*important/i.test(value)) no(`${name} uses !important, which the dialect has no way to hold`);
    const prop = camel(name);
    if (!/^[a-z][a-zA-Z]*$/.test(prop)) no(`"${name}" is not a CSS property napkin can write`);
    if (!value) no(`${name} has no value`);
    if (unsafeCssValue(value)) no(`the value of ${name} has a character the dialect cannot hold`);
    if ((prop === 'whiteSpace' && /pre|break-spaces/i.test(value)) || (prop === 'whiteSpaceCollapse' && /preserve|break-spaces/i.test(value))) no(`${name}: ${value} keeps every space and line break, which napkin text does not`);
    if (!UNITLESS.has(prop) && bareTokens(value).length) no(`${name}: ${value} has a number with no unit (${bareTokens(value)[0]}); browsers ignore that, so napkin will not write it as px`);
    out[prop] = UNITLESS.has(prop) || value === '0' ? (/^-?\d*\.?\d+$/.test(value) ? Number(value) : value) : value;
  }
  return out;
}

const STEM = { div: 'frame', section: 'frame', article: 'frame', header: 'frame', footer: 'frame', nav: 'frame', ul: 'list', li: 'item', a: 'link', p: 'text', span: 'text', img: 'image', button: 'button' };
const INLINE = new Set(['span', 'a', 'strong', 'em', 'small', 'label', 'button', 'img']);
const inlineLevel = (n) => INLINE.has(n.tag) && !/^(block|flex|grid|list-item|table)/.test(String(n.style.display ?? ''));
// A space between two inline elements renders in a block parent. The dialect cannot hold that space, so refuse; a flex or grid parent ignores it.
function checkInlineSpaces(kids, parentDisplay, conv) {
  if (/flex|grid/.test(String(parentDisplay ?? ''))) return;
  let prev = null, sawSpace = false;
  for (const k of kids) {
    if (typeof k === 'string') { if (!NOT_WS.test(k) && k.length) sawSpace = true; continue; }
    const cur = conv.get(k);
    if (prev && sawSpace && inlineLevel(prev) && inlineLevel(cur)) no(`there is a space between <${prev.tag}> and <${cur.tag}> that renders in a block; napkin cannot keep a space between elements, so put the elements in a flex frame or remove it`);
    prev = cur; sawSpace = false;
  }
}
function convert(el) {
  const { tag, attrs } = el;
  if (!TAGS.has(tag)) no(`<${tag}> is not an element napkin can write (supported: ${[...TAGS].join(', ')})`);
  const node = { id: STEM[tag] ?? tag, tag, style: {}, children: [] };
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.style = parseStyle(v);
    else if ((k === 'src' || k === 'alt') && tag === 'img') { if (v.length > 500) no('the image address or alt text is longer than 500 characters'); if (/[\n`]/.test(v)) no(`the ${k} text has a line break or a backtick, which the dialect cannot hold`); (node.attrs ??= {})[k] = v; }
    else if (k === 'class') no(`<${tag}> has a class name; classes cannot be kept, only inline styles`);
    else no(`the attribute ${k} on <${tag}> cannot be kept (only style${tag === 'img' ? ', src and alt' : ''})`);
  }
  if (tag === 'img') { if (el.kids.length) no('an <img> cannot hold anything'); node.attrs ??= {}; node.attrs.src ??= ''; return node; }
  if (VOID.has(tag)) return node;
  const elements = el.kids.filter((k) => typeof k !== 'string');
  const texts = el.kids.filter((k) => typeof k === 'string' && NOT_WS.test(k));
  if (texts.length && elements.length) no(`<${tag}> mixes text with other elements; put the text in its own <span>`);
  if (texts.length) {
    // runs of HTML white space become one space; a space at either end is KEPT (it renders next to an inline sibling: "Hello " + "world")
    let text = decode(el.kids.filter((k) => typeof k === 'string').join('')).replace(/[ \t\r\n\f]+/g, ' ');
    if (!INLINE.has(tag) || /^(block|flex|grid|list-item|table)/.test(String(node.style.display ?? ''))) text = text.replace(/^ | $/g, ''); // at the edge of a block a space is never drawn
    if (text.length > 500) no('a text is longer than 500 characters');
    if (text.includes('`')) no('the text has a backtick, which the dialect cannot hold in a text');
    node.text = text;
  } else if (!elements.length && el.kids.some((k) => typeof k === 'string' && k.length) && INLINE.has(tag) && !/^(block|flex|grid|list-item|table)/.test(String(node.style.display ?? ''))) {
    node.text = ' '; // an inline element with only a space renders that space between its neighbours
  } else {
    const conv = new Map(elements.map((e) => [e, convert(e)]));
    node.children = elements.map((e) => conv.get(e));
    checkInlineSpaces(el.kids, node.style.display, conv);
  }
  return node;
}

// The wrappers a browser copy adds: <html lang>, <head><meta charset></head>, <body> with no attributes. Anything else in them is refused, not dropped.
function unwrap(kids) {
  const out = [];
  for (const k of kids) {
    if (typeof k === 'string') { out.push(k); continue; }
    if (k.tag === 'html') {
      for (const a of Object.keys(k.attrs)) if (a !== 'lang') no(`the <html> has an attribute (${a}) that napkin would drop`);
      out.push(...unwrap(k.kids));
    } else if (k.tag === 'head') {
      for (const h of k.kids) if (typeof h === 'string' ? NOT_WS.test(h) : !(h.tag === 'meta' && Object.keys(h.attrs).every((a) => a === 'charset'))) no(`the <head> has more than a charset (${typeof h === 'string' ? 'text' : '<' + h.tag + '>'}); napkin would drop it`);
    } else if (k.tag === 'body') {
      if (Object.keys(k.attrs).length) no(`the <body> has attributes (${Object.keys(k.attrs).join(', ')}) that napkin would drop`);
      out.push(...unwrap(k.kids));
    } else if (k.tag === 'meta' && Object.keys(k.attrs).every((a) => a === 'charset')) continue;
    else out.push(k);
  }
  return out;
}

// html -> { ok: true, trees: [node] } | { ok: false, reason }. A node is { id, tag, style, text?, attrs?, children }, ready for the `paste` op.
export function htmlToNodes(html) {
  try {
    const kids = unwrap(tokenize(String(html)).kids);
    const els = kids.filter((k) => typeof k !== 'string');
    if (kids.some((k) => typeof k === 'string' && NOT_WS.test(k))) no('there is text outside any element; wrap it in a <span> or <p>');
    if (!els.length) no('no element in the snippet');
    const conv = new Map(els.map((e) => [e, convert(e)]));
    checkInlineSpaces(kids, undefined, conv);
    const trees = els.map((e) => conv.get(e));
    return { ok: true, trees };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, reason: e.message };
    throw e;
  }
}
