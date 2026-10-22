// LAY-10: an HTML snippet from the clipboard becomes dialect nodes, or is refused with the reason. Never an approximation, by construction:
//   1. the browser's own parser reads it (DOMParser: entities, white space, auto-closing, comments, malformed tags are all spec-exact);
//   2. the DOM is converted to dialect nodes, with each element's inline style read through the CSSOM (comments, quotes, case, url(),
//      !important are the browser's business); what the dialect cannot hold (classes, scripts, unsupported elements and attributes,
//      !important, text beside elements ...) is refused with a plain reason;
//   3. both are rendered in two identical hidden sandboxes (an iframe each, styled the way React styles elements) and compared: the text
//      the person would see, the tree shape, every element's box (to 0.5 px) and every computed style property. Any difference refuses the
//      paste with "napkin can't paste this exactly: <first difference>". Only an exact match is accepted.
//   pasteHtml(html, { context, written, checking }) -> Promise<{ ok: true, trees } | { ok: false, reason }>
//     context: the element the nodes will go into; both sandboxes sit inside a clone of its computed style (inherited white-space, colour, font,
//              direction ..., display, width), so what is checked is what the target will draw;
//     written: async (trees) => the same nodes read back from the file text the store WOULD write (dryRun), so what is checked is what is stored;
//     checking: called when the check takes a moment (slow images).
//   renderedDiff(htmlA, htmlB, opts), diffAgainstMarkup(origHtml, markup, opts) -> Promise<string | null>
import { TAGS, VOID, unsafeCssValue } from '/src/model.js';

// React appends "px" to a plain number unless the property is one of these (react-dom's unitless list); the nodes we write follow the same rule.
const REACT_UNITLESS = new Set(['animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth', 'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup', 'columnCount', 'columns', 'flex', 'flexGrow', 'flexPositive', 'flexShrink', 'flexNegative', 'flexOrder', 'gridArea', 'gridRow', 'gridRowEnd', 'gridRowSpan', 'gridRowStart', 'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'fontWeight', 'lineClamp', 'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom', 'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth']);
const STEM = { div: 'frame', section: 'frame', article: 'frame', header: 'frame', footer: 'frame', nav: 'frame', ul: 'list', li: 'item', a: 'link', p: 'text', span: 'text', img: 'image', button: 'button' };
const INLINE = new Set(['span', 'a', 'strong', 'em', 'small', 'label', 'button', 'img']);
class Refuse extends Error {}
const no = (why) => { throw new Refuse(why); };
const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;
// What React writes for a style value (so the sandbox draws exactly what a component with these nodes draws).
export const reactValue = (prop, v) => (typeof v === 'number' && v !== 0 && !REACT_UNITLESS.has(prop) ? `${v}px` : `${v}`.trim());

// "a: b; c: d(e;f)" -> [[a, b], [c, d(e;f)]]: only ever applied to the browser's own serialization of el.style, split outside quotes and parentheses.
function declarations(css) {
  const out = []; let d = 0, q = '', cur = '';
  for (const ch of css) {
    if (q) { if (ch === q) q = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === '(') d++; if (ch === ')') d--;
    if (ch === ';' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => { const i = x.indexOf(':'); return [x.slice(0, i).trim(), x.slice(i + 1).trim()]; });
}
function styleOf(el) {
  const out = {};
  for (const [name, raw] of declarations(el.style.cssText)) {
    if (/!\s*important\s*$/i.test(raw) || el.style.getPropertyPriority(name) === 'important') no(`${name} is !important, which the dialect has no way to hold`);
    if (name.startsWith('--')) no(`the custom property ${name} cannot be kept`);
    if (name.startsWith('-')) no(`the vendor property ${name} cannot be kept`);
    const prop = camel(name);
    if (!/^[a-z][a-zA-Z]*$/.test(prop)) no(`"${name}" is not a CSS property napkin can write`);
    if (/[\u2028\u2029]/.test(raw)) no(`the value of ${name} has a line separator (U+2028 / U+2029), which a component file cannot keep`);
    if (unsafeCssValue(raw)) no(`the value of ${name} has a character the dialect cannot hold`);
    out[prop] = NUMERIC.test(raw) && REACT_UNITLESS.has(prop) ? Number(raw) : raw; // plain numbers stay numbers only where React adds no "px"
  }
  return out;
}
const edgeSpace = (t) => t.replace(/^ | $/g, '');
function convert(el, raw = false) {
  const tag = el.localName;
  if (!TAGS.has(tag)) no(`<${tag}> is not an element napkin can write (supported: ${[...TAGS].join(', ')})`);
  const node = { id: STEM[tag] ?? tag, tag, style: {}, children: [] };
  for (const a of [...el.attributes]) {
    const k = a.name;
    if (k === 'style') node.style = styleOf(el);
    else if ((k === 'src' || k === 'alt') && tag === 'img') {
      if (a.value.length > 500) no('the image address or alt text is longer than 500 characters');
      if (/[\n`\u2028\u2029]/.test(a.value)) no(`the ${k} text has a line break or a backtick, which the dialect cannot hold`);
      (node.attrs ??= {})[k] = a.value;
    } else if (k === 'class') no(`<${tag}> has a class name; classes cannot be kept, only inline styles`);
    else no(`the attribute ${k} on <${tag}> cannot be kept (only style${tag === 'img' ? ', src and alt' : ''})`);
  }
  if (tag === 'img') return node;
  if (VOID.has(tag)) return node;
  const kids = [...el.childNodes].filter((n) => n.nodeType === 1 || n.nodeType === 3);
  const elements = kids.filter((n) => n.nodeType === 1), texts = kids.filter((n) => n.nodeType === 3);
  if (elements.length && texts.some((t) => /[^ \t\r\n]/.test(t.data))) no(`<${tag}> mixes text with other elements; put the text in its own <span>`);
  if (elements.length) { node.children = elements.map((e) => convert(e, raw)); return node; }
  // 1st try: collapsible white space is one space and a block's edge spaces go (they are never drawn). 2nd try (raw): the text exactly as the
  // browser holds it, for a target whose white-space or display would show the difference.
  let text = texts.map((t) => t.data).join('');
  if (!raw) { text = text.replace(/[ \t\r\n]+/g, ' '); if (!INLINE.has(tag)) text = edgeSpace(text); }
  if (text) {
    if (text.length > 500) no('a text is longer than 500 characters');
    if (text.includes('`')) no('the text has a backtick, which the dialect cannot hold in a text');
    if (/\n/.test(text)) no('the text has a line break, which the dialect cannot hold in a text');
    if (/[\u2028\u2029]/.test(text)) no('the text has a line or paragraph separator (U+2028 / U+2029), which a component file cannot keep');
    node.text = text;
  }
  return node;
}

// ---------------------------------------------------------------------------------------------- the render check
const SKIP = /^(position|top|right|bottom|left|inset.*|margin.*|transform.*|translate|rotate|scale|float|height|min-height|max-height|block-size|min-block-size|max-block-size|visibility|animation.*|transition.*|contain.*|container.*|content-visibility|will-change|perspective.*|cursor|pointer-events|opacity|filter|backdrop-filter|clip.*|mask.*|outline.*|overflow.*|resize|zoom)$/;
// Both sandboxes sit inside an element that wears the target's computed style, so inherited text properties and the display type are the target's.
function sandbox(context, width = 600) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
  f.style.cssText = `position:fixed;left:-10000px;top:0;width:${width + 40}px;height:800px;border:0;visibility:hidden;pointer-events:none`;
  document.body.append(f);
  const d = f.contentDocument;
  d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div></body></html>`); d.close();
  const root = d.getElementById('root');
  if (context?.isConnected) {
    const cs = getComputedStyle(context);
    for (const p of cs) if (!SKIP.test(p)) root.style.setProperty(p, cs.getPropertyValue(p));
    if (cs.display === 'none' || cs.display === 'contents') root.style.display = 'block';
    root.style.overflow = 'visible';
  } else root.style.width = `${width}px`;
  return { frame: f, doc: d, root, done: () => f.remove() };
}
// What a component with these nodes draws: elements built the way React builds them (style[prop] = value, "px" only where React adds it).
function build(doc, node) {
  const el = doc.createElement(node.tag);
  for (const [k, v] of Object.entries(node.style || {})) el.style[k] = reactValue(k, v);
  for (const [k, v] of Object.entries(node.attrs || {})) el.setAttribute(k, v);
  if (node.text !== undefined) el.append(doc.createTextNode(node.text));
  for (const c of node.children || []) el.append(build(doc, c));
  return el;
}
// Images load (or fail) in their own time; compare only after both sandboxes have settled. A remote picture may take a few seconds.
// Resolves false when an image never settles.
async function settle(checking, ...boxes) {
  const imgs = boxes.flatMap((b) => [...b.root.querySelectorAll('img')]).filter((i) => !i.complete);
  if (imgs.length) checking?.();
  await Promise.all(boxes.map((b) => b.doc.fonts?.ready));
  await Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); setTimeout(r, 6000); })));
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  return boxes.every((b) => [...b.root.querySelectorAll('img')].every((i) => i.complete));
}
const elementsOf = (root) => [...root.querySelectorAll('*')];
const r05 = (n) => Math.round(n * 2) / 2;
// The first difference between two rendered roots, or null when they match: text, tree shape, boxes, computed style, image attributes.
function compare(A, B) {
  const ta = A.root.innerText, tb = B.root.innerText;
  if (ta !== tb) return `the text differs (${JSON.stringify(ta.slice(0, 40))} vs ${JSON.stringify(tb.slice(0, 40))})`;
  const ea = elementsOf(A.root), eb = elementsOf(B.root);
  const shape = (root) => (function walk(n) { return [...n.children].map((c) => `${c.localName}(${walk(c)})`).join(''); })(root);
  if (shape(A.root) !== shape(B.root)) return 'the element tree differs (HTML would build it differently)';
  const ra = A.root.getBoundingClientRect(), rb = B.root.getBoundingClientRect();
  if (r05(ra.height) !== r05(rb.height)) return `the height differs (${r05(ra.height)} vs ${r05(rb.height)})`;
  for (let i = 0; i < ea.length; i++) {
    const a = ea[i], b = eb[i], tag = a.localName;
    const qa = a.getBoundingClientRect(), qb = b.getBoundingClientRect();
    for (const [name, x, y] of [['x', qa.left - ra.left, qb.left - rb.left], ['y', qa.top - ra.top, qb.top - rb.top], ['width', qa.width, qb.width], ['height', qa.height, qb.height]]) if (r05(x) !== r05(y)) return `<${tag}> ${name} differs (${r05(x)} vs ${r05(y)})`;
    const ca = A.doc.defaultView.getComputedStyle(a), cb = B.doc.defaultView.getComputedStyle(b);
    for (const p of ca) if (ca.getPropertyValue(p) !== cb.getPropertyValue(p)) return `<${tag}> ${p} differs (${ca.getPropertyValue(p)} vs ${cb.getPropertyValue(p)})`;
    for (const at of ['src', 'alt']) if (a.getAttribute(at) !== b.getAttribute(at)) return `<${tag}> ${at} differs`;
  }
  return null;
}
// Two HTML strings (a body fragment each) drawn in separate identical sandboxes; the first difference, or null. Also used by the tests as an oracle.
export async function renderedDiff(htmlA, htmlB, { context } = {}) {
  const A = sandbox(context), B = sandbox(context);
  try {
    A.root.innerHTML = htmlA; B.root.innerHTML = htmlB;
    if (!(await settle(null, A, B))) return 'an image did not load';
    return compare(A, B);
  } finally { A.done(); B.done(); }
}
// The oracle for the tests: the original HTML (as the browser builds it) against markup rendered by real React (react-dom/server) from the written file.
export async function diffAgainstMarkup(origHtml, markup, { context } = {}) {
  const doc = new DOMParser().parseFromString('<!doctype html>' + String(origHtml), 'text/html');
  const A = sandbox(context), B = sandbox(context);
  try {
    for (const n of doc.body.childNodes) A.root.append(A.doc.importNode(n, true));
    B.root.innerHTML = markup;
    if (!(await settle(null, A, B))) return 'an image did not load';
    return compare(A, B);
  } finally { A.done(); B.done(); }
}

// Draws the original and the nodes in sandboxes that wear the target's style; the first difference, or null.
async function verify(doc, trees, { context, checking }) {
  const A = sandbox(context), B = sandbox(context);
  try {
    for (const n of doc.body.childNodes) A.root.append(A.doc.importNode(n, true));
    for (const t of trees) B.root.append(build(B.doc, t));
    if (!(await settle(checking, A, B))) return { unsettled: true };
    return { diff: compare(A, B) };
  } finally { A.done(); B.done(); }
}

export async function pasteHtml(html, { context, written, checking } = {}) {
  try {
    const doc = new DOMParser().parseFromString('<!doctype html>' + String(html), 'text/html'); // standards mode, like the page it lands in
    for (const a of [...doc.documentElement.attributes]) if (a.name !== 'lang') no(`the <html> has an attribute (${a.name}) that napkin would drop`);
    for (const h of doc.head.children) if (!(h.localName === 'meta' && [...h.attributes].every((a) => a.name === 'charset'))) no(`the <head> has <${h.localName}>, which napkin would drop`);
    if (doc.body.attributes.length) no(`the <body> has attributes (${[...doc.body.attributes].map((a) => a.name).join(', ')}) that napkin would drop`);
    const top = [...doc.body.childNodes].filter((n) => n.nodeType === 1 || n.nodeType === 3);
    if (top.some((n) => n.nodeType === 3 && /[^ \t\r\n]/.test(n.data))) no('there is text outside any element; wrap it in a <span> or <p>');
    const els = top.filter((n) => n.nodeType === 1);
    if (!els.length) no('no element in the snippet');
    let firstDiff = null, firstError = null;
    for (const raw of [false, true]) {
      let trees;
      try { trees = els.map((e) => convert(e, raw)); } catch (e) { if (e instanceof Refuse) { firstError ??= e; if (!raw) throw e; break; } throw e; }
      // what will be stored: the nodes as the model and the writer would put them in the file, read back
      if (written) {
        const w = await written(trees);
        if (!w.ok) no(`napkin can't paste this: ${w.reason}`);
        trees = w.trees;
      }
      const v = await verify(doc, trees, { context, checking });
      if (v.unsettled) no('an image did not load, so the paste could not be checked; try again, or paste the image as a file');
      if (!v.diff) return { ok: true, trees };
      firstDiff ??= v.diff;
    }
    no(`napkin can't paste this exactly: ${firstDiff}`);
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, reason: e.message };
    throw e;
  }
}
