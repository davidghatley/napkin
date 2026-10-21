// LAY-10: an HTML snippet from the clipboard becomes dialect nodes, or is refused with the reason. Never an approximation:
// anything the dialect cannot hold exactly (a class, a script, an svg, text beside elements, an unknown tag...) refuses the whole snippet.
// Pure (no DOM), so the same code runs in the page and in the tests.
import { TAGS, VOID } from './model.js';
import { ENTITIES } from './html-entities.js';

const VOID_HTML = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Character references: every one in the HTML 4 table is decoded once; anything else is refused, never left as literal text.
function decode(t) {
  const stray = /&(?![#a-zA-Z0-9]+;)(?=[#a-zA-Z])/.exec(t.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/gi, ''));
  if (stray) no('the text has an "&" that is not a complete character reference (write &amp;)');
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) no(`&${e}; is not a valid character`);
      return String.fromCodePoint(cp);
    }
    if (!(e in ENTITIES)) no(`&${e}; is not a character reference napkin knows; type the character itself`);
    return ENTITIES[e];
  });
}
class Refuse extends Error {}
const no = (why) => { throw new Refuse(why); };

function tokenize(html) {
  const root = { tag: '#root', attrs: {}, kids: [] }, stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+|<)/gi;
  let m;
  while ((m = re.exec(html))) {
    const top = stack.at(-1);
    if (m[0].startsWith('<!')) continue;
    if (m[1]) { // closing tag
      const tag = m[1].toLowerCase();
      if (VOID_HTML.has(tag)) continue;
      if (top.tag !== tag) no(`the closing </${tag}> does not match <${top.tag}>`);
      stack.pop();
    } else if (m[2]) {
      const tag = m[2].toLowerCase(), attrs = {};
      for (const a of m[3].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      const el = { tag, attrs, kids: [] };
      top.kids.push(el);
      if (!(VOID_HTML.has(tag) || m[4])) stack.push(el);
    } else top.kids.push(m[0]);
  }
  if (stack.length > 1) no(`<${stack.at(-1).tag}> is never closed`);
  return root;
}

// Properties whose bare numbers are valid CSS. Everywhere else a bare number (width:100) is invalid, ignored by browsers, and so refused.
const UNITLESS = new Set(['opacity', 'fontWeight', 'lineHeight', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'aspectRatio', 'zoom', 'gridArea', 'gridColumn', 'gridRow', 'gridColumnStart', 'gridColumnEnd', 'gridRowStart', 'gridRowEnd', 'font', 'columnCount', 'columns', 'orphans', 'widows', 'tabSize', 'scale', 'fillOpacity', 'strokeOpacity', 'animationIterationCount']);
const bareTokens = (v) => { const out = []; let d = 0, cur = ''; for (const ch of v) { if (ch === '(') d++; if (ch === ')') d--; if (d === 0 && /[\s,\/]/.test(ch)) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out.filter((x) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(x) && Number(x) !== 0); };
const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function parseStyle(text) {
  const out = {};
  const decls = []; let d = 0, q = '', cur = '';
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
    if (/!important/i.test(value)) no(`${name} uses !important, which the dialect has no way to hold`);
    const prop = camel(name);
    if (!/^[a-z][a-zA-Z]*$/.test(prop)) no(`"${name}" is not a CSS property napkin can write`);
    if (!value) no(`${name} has no value`);
    if (/[;{}<>\\`\n]/.test(value)) no(`the value of ${name} has a character the dialect cannot hold`);
    if (prop === 'whiteSpace' && /pre|break-spaces/.test(value)) no('white-space: ' + value + ' keeps every space and line break, which napkin text does not');
    if (!UNITLESS.has(prop) && bareTokens(value).length) no(`${name}: ${value} has a number with no unit (${bareTokens(value)[0]}); browsers ignore that, so napkin will not write it as px`);
    out[prop] = UNITLESS.has(prop) || value === '0' ? (/^-?\d*\.?\d+$/.test(value) ? Number(value) : value) : value;
  }
  return out;
}

const STEM = { div: 'frame', section: 'frame', article: 'frame', header: 'frame', footer: 'frame', nav: 'frame', ul: 'list', li: 'item', a: 'link', p: 'text', span: 'text', img: 'image', button: 'button' };
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
  const texts = el.kids.filter((k) => typeof k === 'string' && k.trim());
  if (texts.length && elements.length) no(`<${tag}> mixes text with other elements; put the text in its own <span>`);
  if (texts.length) {
    const text = decode(texts.join('')).replace(/[ \t\r\n\f]+/g, ' ').replace(/^ | $/g, '');
    if (text.length > 500) no('a text is longer than 500 characters');
    if (text.includes('`')) no('the text has a backtick, which the dialect cannot hold in a text');
    node.text = text;
  } else node.children = elements.map(convert);
  return node;
}

// html -> { ok: true, trees: [node] } | { ok: false, reason }. A node is { id, tag, style, text?, attrs?, children }, ready for the `paste` op.
export function htmlToNodes(html) {
  try {
    const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(String(html))?.[1] ?? String(html).replace(/<!--StartFragment-->|<!--EndFragment-->/g, '');
    const root = tokenize(body);
    const els = root.kids.filter((k) => typeof k !== 'string');
    if (root.kids.some((k) => typeof k === 'string' && k.trim())) no('there is text outside any element; wrap it in a <span> or <p>');
    if (!els.length) no('no element in the snippet');
    return { ok: true, trees: els.map(convert) };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, reason: e.message };
    throw e;
  }
}
