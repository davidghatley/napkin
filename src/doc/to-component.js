// "Create component" from a selection in an HTML frame (decision 0023, standards section 9).
// A pure conversion: the selected element's own bytes become JSX, and the CSS rules that reach it travel with it,
// so the component looks the same on its own as it did in the frame. Nothing here touches the disk.
//   toComponent({ name, html, css, from }) -> { source, dropped }
//     html  the element's outer HTML exactly as it is in the file
//     css   [{ text, context: ['@media (min-width: 600px)'] }]  rules in cascade order
//     from  'card.html:12'  where it came from, for the header comment
//     wrap  a class name: the root is wrapped in <div className={wrap}> (its CSS gives it display: contents)
//     dropped  what could not come along, in plain words (scripts, inline event handlers)
//   componentName(seed, taken) -> a free PascalCase name ("Card", then "Card2")
import { parseHtml, VOID } from './html.js';
import { decodeText } from './edit.js';

// HTML attribute -> JSX prop, where the names differ.
const PROP = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', minlength: 'minLength',
  colspan: 'colSpan', rowspan: 'rowSpan', srcset: 'srcSet', crossorigin: 'crossOrigin', autocomplete: 'autoComplete',
  autofocus: 'autoFocus', autoplay: 'autoPlay', playsinline: 'playsInline', contenteditable: 'contentEditable',
  spellcheck: 'spellCheck', enctype: 'encType', novalidate: 'noValidate', datetime: 'dateTime', usemap: 'useMap',
  frameborder: 'frameBorder', allowfullscreen: 'allowFullScreen', formaction: 'formAction', inputmode: 'inputMode',
  enterkeyhint: 'enterKeyHint', referrerpolicy: 'referrerPolicy', fetchpriority: 'fetchPriority', accesskey: 'accessKey',
  cellpadding: 'cellPadding', cellspacing: 'cellSpacing', charset: 'charSet', 'http-equiv': 'httpEquiv', srcdoc: 'srcDoc',
  viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', 'xlink:href': 'xlinkHref', 'xmlns:xlink': 'xmlnsXlink', 'xml:space': 'xmlSpace',
};
const BOOLEAN = new Set(['disabled', 'hidden', 'required', 'multiple', 'open', 'reversed', 'loop', 'muted', 'controls', 'default', 'async', 'defer', 'inert', 'novalidate', 'readonly', 'autofocus', 'autoplay', 'playsinline', 'allowfullscreen', 'selected', 'checked', 'ismap', 'nomodule']);
// A form control with a fixed value would be read-only in React; the HTML meaning is "starts as".
const INITIAL = { value: 'defaultValue', checked: 'defaultChecked' };

const camel = (s) => s.replace(/-+([a-z0-9])/gi, (_, c) => c.toUpperCase());
const str = (s) => JSON.stringify(s);

// style="color: red; --gap: 4px" -> { color: "red", "--gap": "4px" }
export function styleObject(text) {
  const out = [];
  let depth = 0, quote = '', start = 0;
  const decls = [];
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if ((ch === ';' && !depth) || i === text.length) { decls.push(text.slice(start, i)); start = i + 1; }
  }
  for (const d of decls) {
    const at = d.indexOf(':');
    if (at < 1) continue;
    const name = d.slice(0, at).trim(), value = d.slice(at + 1).trim();
    if (!name || !value) continue;
    const key = name.startsWith('--') ? str(name) : /^-ms-/i.test(name) ? camel(name.slice(1).toLowerCase()) : camel(name.toLowerCase().replace(/^-(webkit|moz|o)-/, (_, v) => `${v[0].toUpperCase()}${v.slice(1)}-`));
    out.push(`${key}: ${str(value)}`);
  }
  return out.length ? `{ ${out.join(', ')} }` : null;
}

function prop(tag, a, foreign, dropped) {
  const lname = a.lname, raw = a.valStart === null ? null : decodeText(a.value);
  if (/^on[a-z]+$/.test(lname)) { dropped.add(`the ${lname} handler on <${tag}> (inline scripts do not run in a component)`); return null; }
  if (lname === 'style') { const o = styleObject(raw || ''); return o ? `style={${o}}` : null; }
  let name = PROP[lname] || (/^(data|aria)-/.test(lname) ? lname : foreign && lname.includes('-') ? camel(lname) : lname.includes(':') ? camel(lname.replace(':', '-')) : lname);
  if ((tag === 'input' || tag === 'textarea' || tag === 'select') && INITIAL[lname]) name = INITIAL[lname];
  if (raw === null || (BOOLEAN.has(lname) && (raw === '' || raw.toLowerCase() === lname))) return name;
  return /^[^"{}\n\\<>&]*$/.test(raw) ? `${name}="${raw}"` : `${name}={${str(raw)}}`;
}

// Text between tags. HTML shows a run of white space as one space; JSX drops white space that has a line break in it.
// So a run that starts or ends with white space, or holds a brace, is written as a string; plain words stay plain.
function text(raw, pre, first = false, last = false) {
  const t = decodeText(raw.replace(/<!--[\s\S]*?-->/g, ''));
  if (pre) return t ? `{${str(t)}}` : '';
  let one = t.replace(/[ \t\n\r\f]+/g, ' ');
  // white space at the very start and end of an element shows nothing
  if (first) one = one.replace(/^ /, '');
  if (last) one = one.replace(/ $/, '');
  if (!one) return '';
  if (one === ' ') return "{' '}";
  return /^[^{}<>&]*$/.test(one) && one === one.trim() && !/[ ]/.test(one) ? one : `{${str(one)}}`;
}

// Elements that start on their own line in a browser: white space next to them shows nothing.
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'ul', 'summary', 'option', 'optgroup', 'select', 'caption', 'colgroup', 'col', 'br']);
const plain = (t) => t.replace(/[{}<>&\u00a0]/g, (c) => ({ '{': "{'{'}", '}': "{'}'}", '<': '&lt;', '>': '&gt;', '&': '&amp;', '\u00a0': '&nbsp;' })[c]);
// A phrase (text with inline elements only) written on one line, where JSX keeps every space as it is. null when it does not fit.
// White space at the edges shows nothing only in a block; inside an inline element (Hello<strong> David </strong>) it is a
// space the reader sees, so it stays.
function phrase(s, n, dropped, open) {
  if (n.children.some((c) => BLOCK.has(c.name) || c.name === 'script' || c.name === 'style' || c.name === 'pre' || c.name === 'textarea')) return null;
  const fold = (raw) => decodeText(raw.replace(/<!--[\s\S]*?-->/g, '')).replace(/[ \t\n\r\f]+/g, ' ');
  let out = '', at = n.openEnd;
  for (const c of n.children) {
    out += plain(fold(s.slice(at, c.start)));
    const attrs = c.attrs.map((a) => prop(c.name, a, !!c.foreign || c.name === 'svg', dropped)).filter(Boolean);
    const o = `<${c.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    if (VOID.has(c.name)) out += `${o} />`;
    else { const inner = phrase(s, c, dropped, o); if (inner === null) return null; out += inner; }
    at = c.end;
  }
  out += plain(fold(s.slice(at, n.closeStart ?? n.end)));
  if (BLOCK.has(n.name)) out = out.replace(/^ /, '').replace(/ $/, '');
  const line = out ? `${open}>${out}</${n.tag}>` : `${open} />`;
  return line.length <= 110 && !line.includes('\n') ? line : null;
}

function render(s, n, depth, dropped, pre = false) {
  const pad = '  '.repeat(depth);
  if (n.name === 'script') { dropped.add('a <script> element (scripts do not run in a component)'); return ''; }
  if (n.name === 'style') return ''; // its rules travel in the component's CSS
  const tag = n.tag, foreign = !!n.foreign || n.name === 'svg' || n.name === 'math';
  const attrs = n.attrs.map((a) => prop(n.name, a, foreign, dropped)).filter(Boolean);
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (VOID.has(n.name) || (n.selfClosing && foreign)) return `${pad}${open} />`;
  const keepSpace = pre || n.name === 'pre' || n.name === 'textarea';
  if (!keepSpace && !foreign && n.children.length) { const one = phrase(s, n, dropped, open); if (one !== null && pad.length + one.length <= 120) return `${pad}${one}`; }
  const parts = [];
  let at = n.openEnd;
  const edge = BLOCK.has(n.name); // white space at the start and end shows nothing in a block
  for (const c of n.children) {
    const t = text(s.slice(at, c.start), keepSpace, edge && c === n.children[0]);
    if (t) parts.push({ text: t });
    const el = render(s, c, depth + 1, dropped, keepSpace);
    if (el) parts.push({ el, block: BLOCK.has(c.name) });
    at = c.end;
  }
  const tail = text(s.slice(at, n.closeStart ?? n.end), keepSpace, edge && !n.children.length, edge);
  if (tail) parts.push({ text: tail });
  // white space beside a block element shows nothing
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].text === "{' '}" && (parts[i - 1]?.block || parts[i + 1]?.block)) parts.splice(i, 1);
  if (!parts.length) return `${pad}${open} />`;
  if (parts.length === 1 && parts[0].text && parts[0].text.length < 90) return `${pad}${open}>${parts[0].text}</${tag}>`;
  const inner = parts.map((p) => (p.el ? p.el : `${pad}  ${p.text}`)).join('\n');
  return `${pad}${open}>\n${inner}\n${pad}</${tag}>`;
}

const literal = (css) => css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

export function toComponent({ name, html, css = [], from = '', wrap = null }) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`component name "${name}" must be PascalCase (letters and digits, starting with a capital). Next: try a name like Card`);
  const s = String(html);
  const parsed = parseHtml(s);
  const roots = (parsed.root?.children || []).filter((n) => n.name !== 'script' && n.name !== 'style');
  if (roots.length !== 1) throw new Error('select one element to make a component from. Next: select the element that wraps the part you want');
  const dropped = new Set();
  // `wrap`: a class for an element with display: contents around the root, standing in for the frame's elements around it
  const jsx = wrap ? `    <div className="${wrap}">\n${render(s, roots[0], 3, dropped)}\n    </div>` : render(s, roots[0], 2, dropped);
  const own = parsed.nodes.filter((n) => n.name === 'style').map((n) => ({ text: s.slice(n.openEnd, n.closeStart ?? n.end).trim(), context: [] }));
  const sheet = [...css, ...own].filter((r) => r.text && r.text.trim()).map((r) => (r.context || []).reduceRight((inner, c) => `${c} {\n${inner.replace(/^/gm, '  ')}\n}`, r.text.trim())).join('\n\n');
  const lines = [];
  if (from) lines.push(`// Made from ${from}.`);
  if (sheet) lines.push(`const css = \`\n${literal(sheet)}\n\`;`, '');
  lines.push(`export default function ${name}() {`, '  return (');
  if (sheet) lines.push('    <>', '      <style>{css}</style>', jsx.replace(/^/gm, '  '), '    </>');
  else lines.push(jsx);
  lines.push('  );', '}', '');
  return { source: lines.join('\n'), dropped: [...dropped] };
}

// A name for the new component from what was selected: its first class, its id, or its tag. Never one that is taken.
export function componentName(seed, taken = []) {
  const words = String(seed || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  let base = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('').replace(/^[0-9]+/, '');
  if (!base) base = 'Component';
  const used = new Set([...taken].map((t) => String(t).toLowerCase()));
  let name = base, n = 2;
  while (used.has(name.toLowerCase())) name = `${base}${n++}`;
  return name;
}
