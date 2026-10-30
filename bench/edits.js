// D2 edits (LOCKED P0 measure; builders never edit). 60 scripted edits over copies of the P0 corpus, 6 for each op in
// the contract (text, attr, class, style, rule, var, insert, move, delete, prop). Each edit starts from the pristine
// file and is checked four ways:
//   span    the edited file must match the expected result exactly: every byte outside the edit's span is the same,
//           and inside it only what the op asks for (whitespace may flex only where an element is inserted, moved or
//           deleted, or where a declaration or attribute is added or removed). Odd formatting, comments, quote style,
//           attribute order, CRLF line endings and multi-byte UTF-8 around the span must survive.
//   others  no other file in the folder changes, and no file is added or removed.
//   reopen  /view after the edit (live) equals /view after napkin is stopped and the folder opened fresh
//           (pixel diff, at most 0.1% differing at more than 2/255, width 800, light).
//   undo    POST /api/undo { component } restores the edited file, and the whole folder, byte for byte.
// Pass: all 60 edits pass all four checks.
//   node bench/edits.js [--corpus DIR] [--only E01,E07] [--keep] [--selftest]
// --selftest checks the edit table against the pristine corpus (anchors unique, expectations well formed, the canonical
// result of each edit matches its own expectation and differs from the original) without starting napkin.
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { assembleCorpus, P0_FOLDERS } from './corpus.js';
import { SCRATCH, MAX_DIFF, startNapkin, call, brief, listFiles, getComponent, viewPath, launchBrowser, diffPng, finish, pct, L, toL, element, tagEnd, snapshot, snapshotDiff } from './p0-lib.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const WS = '[ \\t\\r\\n]';

// ---------- expectation builder over one file (latin1 view: one char per byte) ----------
// A part is { re, canon }: re is the allowed bytes (regex source), canon one concrete allowed choice.
const lit = (utf8) => ({ re: esc(toL(utf8)), canon: toL(utf8) });
const litL = (latin) => ({ re: esc(latin), canon: latin });
const flex = (canon, min = 0) => ({ re: `${WS}${min ? '+' : '*'}`, canon });
const alt = (...utf8) => ({ re: '(?:' + utf8.map((u) => esc(toL(u))).join('|') + ')', canon: toL(utf8[0]) });
const raw = (re, canonUtf8) => ({ re, canon: toL(canonUtf8) });

class Src {
  constructor(buf, label) { this.buf = buf; this.s = L(buf); this.label = label; }
  // Byte offset of the unique occurrence of anchor (UTF-8 text).
  at(anchor) {
    const a = toL(anchor), i = this.s.indexOf(a);
    if (i < 0) throw new Error(`${this.label}: anchor not found: ${anchor}`);
    if (this.s.indexOf(a, i + 1) >= 0) throw new Error(`${this.label}: anchor is not unique: ${anchor}`);
    return i;
  }
  el(anchor) { return element(this.s, this.at(anchor)); }
  // [a, b) of the first `target` after the unique `anchor` (and before the next '}' when inside CSS).
  after(anchor, target, { inRule = true } = {}) {
    const i = this.at(anchor), t = toL(target), j = this.s.indexOf(t, i);
    const stop = inRule ? this.s.indexOf('}', i) : this.s.length;
    if (j < 0 || j > stop) throw new Error(`${this.label}: ${target} not found after ${anchor}`);
    return [j, j + t.length];
  }
  wsBack(i) { while (i > 0 && /[ \t\r\n]/.test(this.s[i - 1])) i--; return i; }
  wsFwd(i) { while (i < this.s.length && /[ \t\r\n]/.test(this.s[i])) i++; return i; }
  // Direct child elements of an element (comments, text and {expressions} skipped).
  children(el) {
    const out = []; let i = el.openEnd;
    while (i < el.closeStart) {
      const lt = this.s.indexOf('<', i); if (lt < 0 || lt >= el.closeStart) break;
      if (this.s.startsWith('<!--', lt)) { i = this.s.indexOf('-->', lt) + 3; continue; }
      if (!/[A-Za-z]/.test(this.s[lt + 1])) { i = lt + 1; continue; }
      const c = element(this.s, lt); out.push(c); i = c.end;
    }
    return out;
  }
  // One attribute in the start tag of el: { name, start, end, valStart, valEnd, quote } (end = after the value).
  attr(el, name) {
    const tag = this.s.slice(el.start, el.openEnd), re = new RegExp(`[\\s](${esc(name)})(?:(\\s*=\\s*)("([^"]*)"|'([^']*)'|\\{[^}]*\\}|([^\\s>"'=\`{}]+)))?(?=[\\s/>])`, 'g');
    for (let m; (m = re.exec(tag));) {
      const start = el.start + m.index + 1;
      if (m[3] === undefined) return { name, start, end: start + name.length, valStart: null, valEnd: null, quote: null };
      const vs = start + name.length + m[2].length, quote = m[3][0] === '"' || m[3][0] === "'" ? m[3][0] : null;
      return { name, start, end: vs + m[3].length, valStart: quote ? vs + 1 : vs, valEnd: quote ? vs + m[3].length - 1 : vs + m[3].length, quote };
    }
    return null;
  }
  // Where a new attribute goes: after the last attribute, replacing the whitespace before '>' or '/>'.
  attrSlot(el) { let close = el.openEnd - 1; if (this.s[close - 1] === '/') close--; return [this.wsBack(close), close]; }
}

// Region builders. Each returns { regions: [[from, to, parts]] }.
const R = (from, to, ...parts) => [from, to, parts];
function textR(h, el, value) {
  const inner = h.s.slice(el.openEnd, el.closeStart), lead = inner.length - inner.trimStart().length, trail = inner.length - inner.trimEnd().length;
  return [R(el.openEnd + lead, el.closeStart - trail, lit(value))];
}
function setAttrR(h, el, name, value) {
  const a = h.attr(el, name);
  if (a && a.quote) return [R(a.valStart, a.valEnd, lit(value))];
  if (a && a.valStart !== null) return [R(a.valStart, a.valEnd, alt(value, `"${value}"`, `'${value}'`))];
  if (a) return [R(a.end, a.end, raw(`=(?:"${esc(toL(value))}"|'${esc(toL(value))}')`, `="${value}"`))];
  const [f, t] = h.attrSlot(el);
  return [R(f, t, raw(`${WS}+${esc(name)}=(?:"${esc(toL(value))}"|'${esc(toL(value))}')${WS}*`, ` ${name}="${value}"` + h.s.slice(f, t)))];
}
function removeAttrR(h, el, name) {
  const a = h.attr(el, name); if (!a) throw new Error(`${h.label}: no attribute ${name}`);
  const f = h.wsBack(a.start), t = h.wsFwd(a.end), next = h.s[t];
  return [R(f, t, next === '>' || next === '/' ? flex('') : flex(' ', 1))];
}
function classR(h, el, add = [], remove = []) {
  const a = h.attr(el, 'class');
  if (!a) return setAttrR(h, el, 'class', add.join(' '));
  const tokens = h.s.slice(a.valStart, a.valEnd).split(/[ \t\r\n]+/).filter(Boolean);
  const result = [...tokens.filter((t) => !remove.includes(t)), ...add.filter((t) => !tokens.includes(t))];
  const body = result.map(esc).join(`${WS}+`);
  if (a.quote) return [R(a.valStart, a.valEnd, raw(`${WS}*${body}${WS}*`, result.join(' ')))];
  return [R(a.valStart, a.valEnd, raw(`(?:"${body}"|'${body}'${result.length === 1 ? '|' + body : ''})`, `"${result.join(' ')}"`))];
}
function styleR(h, el, prop, value) {
  const a = h.attr(el, 'style'); if (!a || !a.quote) throw new Error(`${h.label}: no quoted style attribute`);
  const v = h.s.slice(a.valStart, a.valEnd), decls = []; let p = 0;
  for (const piece of v.split(';')) { decls.push({ from: a.valStart + p, to: a.valStart + p + piece.length, text: piece }); p += piece.length + 1; }
  const d = decls.find((x) => x.text.split(':')[0].trim().toLowerCase() === prop);
  if (d && value !== null) {
    const colon = d.from + d.text.indexOf(':') + 1, vs = h.wsFwd(colon), ve = d.from + d.text.trimEnd().length;
    return [R(vs, ve, lit(value))];
  }
  if (d) {
    const live = decls.filter((x) => x.text.trim());
    if (live[live.length - 1] === d && live.length > 1) return [R(d.from - 1, a.valEnd, raw(`;?${WS}*`, ''))];
    return [R(d.from, d.to + (h.s[d.to] === ';' ? 1 : 0), raw(`${WS}*`, ''))];
  }
  const end = a.valStart + v.trimEnd().length, semi = v.trimEnd().endsWith(';');
  const decl = `${esc(prop)}${WS}*:${WS}*${esc(toL(value))}${WS}*;?`;
  return [R(end, end, raw(semi ? `${WS}*${decl}` : `${WS}*;${WS}*${decl}`, semi ? ` ${prop}: ${value}` : `; ${prop}: ${value}`))];
}
function insertAt(h, point, text) {
  const f = h.wsBack(point), t = h.wsFwd(point);
  return R(f, t, flex(h.s.slice(f, point)), litL(text), flex(h.s.slice(point, t)));
}
function insertR(h, parent, index, html) {
  const kids = h.children(parent); const point = index < kids.length ? kids[index].start : parent.closeStart;
  return [insertAt(h, point, toL(html))];
}
function deleteR(h, el) {
  const f = h.wsBack(el.start), t = h.wsFwd(el.end);
  return [R(f, t, flex(h.s.slice(f, el.start) || h.s.slice(el.end, t)))];
}
function moveR(h, el, parent, index) {
  const kids = h.children(parent).filter((k) => k.start !== el.start);
  const point = index < kids.length ? kids[index].start : parent.closeStart;
  return [...deleteR(h, el), insertAt(h, point, h.s.slice(el.start, el.end))];
}
// The expected file: literal original bytes between regions, each region matched by its own regex (anchored, with a
// lookahead on the literal that follows so whitespace flex cannot eat into it). re.test(text) is the whole check.
function compile(h, regions) {
  regions = [...regions].sort((x, y) => x[0] - y[0]);
  const segs = []; let canon = '', pos = 0;
  for (let k = 0; k < regions.length; k++) {
    const [f, t, parts] = regions[k];
    if (f < pos) throw new Error(`${h.label}: expectation regions overlap`);
    const next = h.s.slice(t, k + 1 < regions.length ? regions[k + 1][0] : h.s.length);
    segs.push({ lit: h.s.slice(pos, f) }, { re: new RegExp(parts.map((p) => p.re).join('') + `(?=${esc(next.slice(0, 200))})`, 'sy') });
    canon += h.s.slice(pos, f) + parts.map((p) => p.canon).join('');
    pos = t;
  }
  segs.push({ lit: h.s.slice(pos), last: true }); canon += h.s.slice(pos);
  const test = (text) => {
    let i = 0;
    for (const sg of segs) {
      if (sg.lit !== undefined) { if (!text.startsWith(sg.lit, i)) return false; i += sg.lit.length; if (sg.last && i !== text.length) return false; continue; }
      sg.re.lastIndex = i; const m = sg.re.exec(text); if (!m) return false; i += m[0].length;
    }
    return i === text.length;
  };
  return { re: { test }, canon, span: [regions[0][0], regions[regions.length - 1][1]] };
}

// ---------- the 60 edits ----------
// file = the file the edit changes; comp = [file, name?] of the component the edit goes through and that is viewed.
// make(h) returns { edit, regions }; nodes are named by the byte offset of their start tag (N(offset)), resolved
// through GET /api/component/<id>'s tree (a node whose `start` is that offset).
const N = (offset) => ({ $node: offset });
const SS = { cs: 'components.css', tk: 'tokens.css', pill: 'components/Pill/preview.html', call: 'components/Callout/preview.html', note: 'components/Note/preview.html', tabs: 'components/Tabs/preview.html', press: 'components/PressButton/preview.html', check: 'components/Check/preview.html', spine: 'components/Spine/preview.html' };
const T = (name) => `components/${name}.tsx`;
const op = {
  text: (anchor, value) => (h) => { const el = h.el(anchor); return { edit: { op: 'text', node: N(el.start), value }, regions: textR(h, el, value) }; },
  attr: (anchor, name, value) => (h) => { const el = h.el(anchor); return { edit: { op: 'attr', node: N(el.start), name, value }, regions: value === null ? removeAttrR(h, el, name) : setAttrR(h, el, name, value) }; },
  prop: (anchor, name, value) => (h) => { const el = h.el(anchor); return { edit: { op: 'prop', node: N(el.start), name, value }, regions: setAttrR(h, el, name, value) }; },
  cls: (anchor, add, remove) => (h) => { const el = h.el(anchor); return { edit: { op: 'class', node: N(el.start), ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) }, regions: classR(h, el, add, remove) }; },
  style: (anchor, prop, value) => (h) => { const el = h.el(anchor); return { edit: { op: 'style', node: N(el.start), prop, value }, regions: styleR(h, el, prop, value) }; },
  // CSS: the value span is located by hand (anchor = start of the rule or block, target = the bytes that change).
  rule: (file, selector, prop, value, anchor, target) => (h) => { const [f, t] = h.after(anchor, target); return { edit: { op: 'rule', file, selector, prop, value }, regions: [R(f, t, lit(value))] }; },
  ruleR: (file, selector, prop, value, regionsOf) => (h) => ({ edit: { op: 'rule', file, selector, prop, value }, regions: regionsOf(h) }),
  vr: (file, name, value, anchor, target) => (h) => { const [f, t] = h.after(anchor, target, { inRule: false }); return { edit: { op: 'var', file, name, value }, regions: [R(f, t, lit(value))] }; },
  insert: (parentAnchor, index, html) => (h) => { const p = h.el(parentAnchor); return { edit: { op: 'insert', parent: N(p.start), index, html }, regions: insertR(h, p, index, html) }; },
  move: (anchor, parentAnchor, index) => (h) => { const el = h.el(anchor), p = h.el(parentAnchor); return { edit: { op: 'move', node: N(el.start), parent: N(p.start), index }, regions: moveR(h, el, p, index) }; },
  del: (anchor) => (h) => { const el = h.el(anchor); return { edit: { op: 'delete', node: N(el.start) }, regions: deleteR(h, el) }; },
};
const E = (id, folder, file, comp, make, why) => ({ id, folder, file, comp: Array.isArray(comp) ? comp : [comp], make, why });
export const EDITS = [
  // text
  E('E01', 'ss-ds', SS.call, SS.call, op.text('<span class="ss-call ss-call--focal">', '7'), 'a one-character text node between tags on one long line'),
  E('E02', 'ss-ds', SS.note, SS.note, op.text('<span class="ss-note__tag">Verify', 'Check'), 'text inside a nested span'),
  E('E03', 'recipes', 'recipes/manual.html', 'recipes/manual.html', op.text('<p class="ss-lead">What the system', 'One plain sentence about the system.'), 'a full page; the rest of the page is untouched'),
  E('E04', 'edge', 'inline-style.html', 'inline-style.html', op.text('<h2>Café', 'Café menu — révisé'), 'multi-byte UTF-8 on both sides: offsets are bytes'),
  E('E05', 'edge', 'table.html', 'table.html', op.text('<TD>Design systems', 'Systems'), 'uppercase tags, tabs and CRLF line endings must survive'),
  E('E06', 'tsx', T('Callout'), [T('Callout'), 'Callout'], op.text('<span data-n="detail"', 'Invite everyone.'), 'JSX text: its surrounding newline and indentation stay'),
  // attr
  E('E07', 'ss-ds', SS.tabs, SS.tabs, op.attr('<button role="tab" aria-selected="false"', 'aria-selected', 'true'), 'only the value changes; tabindex after it stays in place'),
  E('E08', 'edge', 'inline-style.html', 'inline-style.html', op.attr('<div class="card"', 'title', 'still single'), "single quotes must stay single quotes"),
  E('E09', 'edge', 'inline-style.html', 'inline-style.html', op.attr('<p class=meta data-x=unquoted', 'data-x', 'plain'), 'an unquoted value; neighbours stay unquoted'),
  E('E10', 'ss-ds', SS.press, SS.press, op.attr('<button class="ss-press">', 'data-state', 'armed'), 'a new attribute goes after the existing ones'),
  E('E11', 'ss-ds', SS.check, SS.check, op.attr('<input type="checkbox" checked>', 'checked', null), 'remove a boolean attribute'),
  E('E12', 'recipes', 'recipes/manual.html', 'recipes/manual.html', op.attr('<rect class="bx" x="184"', 'width', '120'), 'an SVG attribute in a self-closing element'),
  // class
  E('E13', 'ss-ds', SS.pill, SS.pill, op.cls('<span class="ss-pill ss-pill--ok">', ['ss-pill--bad'], ['ss-pill--ok']), 'swap a modifier class'),
  E('E14', 'ss-ds', SS.call, SS.call, op.cls('<span class="ss-call">1', ['ss-call--focal'], []), 'add a modifier class'),
  E('E15', 'recipes', 'recipes/manual.html', 'recipes/manual.html', op.cls('<p class="ss-lead">What', ['is-quiet'], []), 'add a class in a full page'),
  E('E16', 'edge', 'inline-style.html', 'inline-style.html', op.cls('<p class=meta data-x', ['lede'], []), 'an unquoted class gains a second token (now needs quotes)'),
  E('E17', 'edge', 'hover.html', 'hover.html', op.cls('<button class="btn  btn--primary   is-big"', [], ['btn--primary']), 'remove a middle token among irregular spaces'),
  E('E18', 'edge', 'grid.html', 'grid.html', op.cls('<div id="g-a">', ['tile'], []), 'add a class where there was no class attribute'),
  // inline style
  E('E19', 'ss-ds', SS.pill, SS.pill, op.style('<div class="wrap" style="align-items:center">', 'align-items', 'flex-start'), 'keep the no-space style formatting'),
  E('E20', 'ss-ds', SS.spine, SS.spine, op.style('<div class="ss-spine" style="height:220px">', 'height', '240px'), 'the first of two similar elements'),
  E('E21', 'ss-ds', SS.press, SS.press, op.style('<div style="display:flex;gap:var(--space-3)">', 'padding', '4px'), 'add a declaration after a var()'),
  E('E22', 'ss-ds', SS.note, SS.note, op.style('<div class="wrap" style="flex-direction:column;align-items:stretch">', 'align-items', null), 'remove the last declaration'),
  E('E23', 'edge', 'vars.html', 'vars.html', op.style('<span class="chip chip--local"', '--local', '#fef3c7'), 'an inline custom property'),
  E('E24', 'recipes', 'recipes/tool.html', 'recipes/tool.html', op.style('<label class="ss-label" for="new" style="grid-column: 1 / -1">', 'grid-column', '1 / 2'), 'a value with slashes and spaces'),
  // CSS rules
  E('E25', 'ss-ds', SS.cs, SS.call, op.rule('components.css', '.ss-call--focal', 'background', 'var(--cobalt)', '.ss-call--focal {', 'var(--vermilion)'), 'a shared stylesheet the preview does not link (applied)'),
  E('E26', 'ss-ds', SS.cs, SS.pill, op.rule('components.css', '.ss-pill', 'padding', '2px 8px', '.ss-pill { display: inline-block;', '1px 7px'), 'one value in a long one-line rule'),
  E('E27', 'edge', 'inline-style.html', 'inline-style.html', op.rule('inline-style.html', '.card', 'padding', '16px', '.card   {', '24px'), 'a rule in an inline <style>; its odd spacing and comment stay'),
  E('E28', 'edge', 'css/base.css', 'import.html', op.ruleR('css/base.css', '.box', 'border-radius', '4px', (h) => { const i = h.at('.box{padding:20px;') + toL('.box{padding:20px;border:2px solid var(--edge-ink);max-width:420px').length; return [R(i, i, raw(`;${WS}*border-radius${WS}*:${WS}*4px${WS}*;?${WS}*`, ';border-radius:4px'))]; }), 'add a declaration to a rule with no trailing semicolon, in a linked file that @imports'),
  E('E29', 'edge', 'hover.html', 'hover.html', op.rule('hover.html', '.btn--primary:hover', 'background', '#0f1a66', '.btn--primary:hover{', '#16248a'), 'a :hover rule'),
  E('E30', 'edge', 'grid.html', 'grid.html', op.ruleR('grid.html', '.tile', 'border', null, (h) => { const [f, t] = h.after('.tile {', ' border: 1px solid #c9ccd2;'); return [R(f, t + 1, raw(`${WS}*`, ' '))]; }), 'remove one declaration'),
  // CSS custom properties
  E('E31', 'ss-ds', SS.tk, SS.pill, op.vr('tokens.css', '--space-4', '20px', '--space-4:', '16px'), 'a spacing token used through .wrap'),
  E('E32', 'ss-ds', SS.tk, SS.call, op.vr('tokens.css', '--radius-disc', '4px', '--radius-disc:', '999px'), 'a radius token'),
  E('E33', 'edge', 'vars.html', 'vars.html', op.vr('vars.html', '--accent', '#ee5228', '--accent:', '#2236b0'), 'a variable in an inline <style>'),
  E('E34', 'edge', 'css/import-tokens.css', 'import.html', op.vr('css/import-tokens.css', '--edge-ink', '#2236b0', '--edge-ink:', '#1d1f24'), 'reached through @import; alignment spaces and the comment stay'),
  E('E35', 'recipes', 'tokens.css', 'recipes/report.html', op.vr('tokens.css', '--space-3', '14px', '--space-3:', '12px'), 'a token file linked as ../tokens.css'),
  E('E36', 'edge', 'media.html', 'media.html', op.vr('media.html', '--edge-gutter', '32px', '--edge-gutter:', '24px'), 'a variable used inside and outside @media'),
  // insert
  E('E37', 'ss-ds', SS.pill, SS.pill, op.insert('<div class="wrap" style="align-items:center">', 4, '<span class="ss-pill ss-pill--mute">New</span>'), 'append to a one-line parent'),
  E('E38', 'ss-ds', SS.note, SS.note, op.insert('<div class="wrap" style="flex-direction:column', 1, '<div class="ss-note ss-note--rule"><span class="ss-note__tag">Tip</span><div class="ss-note__body">Inserted by the bench.</div></div>'), 'insert between lines'),
  E('E39', 'edge', 'table.html', 'table.html', op.insert('<TABLE class="t">', 2, '<TR><TD>Inserted</TD><TD class="num">1</TD></TR>'), 'a row in a table with no tbody tag (index counts source children)'),
  E('E40', 'edge', 'svg.html', 'svg.html', op.insert('<g id="shapes"', 3, '<circle cx="200" cy="100" r="4"/>'), 'SVG content'),
  E('E41', 'recipes', 'recipes/review-sheet.html', 'recipes/review-sheet.html', op.insert('<ul><li>A list item.', 2, '<li>A third item.</li>'), 'a list item in a one-line list'),
  E('E42', 'tsx', T('Callout'), [T('Callout'), 'Callout'], op.insert('<div data-n="root"', 2, '<span>Extra</span>'), 'JSX: append a child'),
  // move (index = position among the parent's other children; every move here goes earlier or to another parent)
  E('E43', 'ss-ds', SS.pill, SS.pill, op.move('<span class="ss-pill ss-pill--mute">', '<div class="wrap" style="align-items:center">', 0), 'last to first on one line'),
  E('E44', 'ss-ds', SS.note, SS.note, op.move('<div class="ss-note ss-note--trap">', '<div class="wrap" style="flex-direction:column', 0), 'last to first across lines'),
  E('E45', 'ss-ds', SS.tabs, SS.tabs, op.move('<button role="tab" aria-selected="false"', '<div class="ss-tabs"', 0), 'reorder two buttons'),
  E('E46', 'edge', 'grid.html', 'grid.html', op.move('<div id="g-a">', '<aside class="side">', 0), 'to another parent that holds only text'),
  E('E47', 'recipes', 'recipes/manual.html', 'recipes/manual.html', op.move('<li><a href="#log">', '<ol class="contents ss-label">', 0), 'reorder a list in a full page'),
  E('E48', 'tsx', T('Callout'), [T('Callout'), 'Callout'], op.move('<span data-n="detail"', '<div data-n="root"', 0), 'JSX: reorder children'),
  // delete
  E('E49', 'ss-ds', SS.pill, SS.pill, op.del('<span class="ss-pill ss-pill--bad">'), 'a middle sibling on one line'),
  E('E50', 'ss-ds', SS.note, SS.note, op.del('<div class="ss-note ss-note--verify">'), 'a line of its own'),
  E('E51', 'edge', 'inline-style.html', 'inline-style.html', op.del('<p class=meta data-x'), 'the comment just above it stays'),
  E('E52', 'edge', 'svg.html', 'svg.html', op.del('<rect x="12"'), 'a self-closing SVG element'),
  E('E53', 'recipes', 'recipes/manual.html', 'recipes/manual.html', op.del('<circle class="c" cx="408"'), 'one shape in a figure'),
  E('E54', 'tsx', T('Toast'), [T('Toast'), 'Toast'], op.del('<span data-n="close"'), 'JSX: delete a child'),
  // TSX props
  E('E55', 'shadcn', 'src/components/composer.tsx', ['src/components/composer.tsx', 'Composer'], op.prop('<Textarea', 'placeholder', 'Describe your game…'), 'a prop on a multi-line element with arrow-function props'),
  E('E56', 'shadcn', 'src/components/composer.tsx', ['src/components/composer.tsx', 'Composer'], op.prop('<Textarea', 'className', 'min-h-32 text-base'), 'className as a plain prop'),
  E('E57', 'shadcn', 'src/components/ui/button.tsx', ['src/components/ui/button.tsx', 'Button'], op.prop('<ButtonPrimitive', 'data-slot', 'btn'), 'a prop next to a {...props} spread'),
  E('E58', 'shadcn', 'src/components/ui/scroll-area.tsx', ['src/components/ui/scroll-area.tsx', 'ScrollArea'], op.prop('<ScrollAreaPrimitive.Viewport', 'data-slot', 'viewport'), 'a member-expression tag name'),
  E('E59', 'tsx', T('Callout'), [T('Callout'), 'Callout'], op.prop('<div data-n="root"', 'title', 'Hello'), 'a new prop goes after the existing ones'),
  E('E60', 'shadcn', 'src/components/game-view.tsx', ['src/components/game-view.tsx', 'GameView'], op.prop('<iframe key={version}', 'title', 'game'), 'a prop after template-literal props'),
];

// Build every edit's expectation against a folder's pristine bytes.
function prepare(corpus, e) {
  const buf = readFileSync(join(corpus, e.folder, e.file));
  const h = new Src(buf, `${e.id} ${e.folder}/${e.file}`);
  const { edit, regions } = e.make(h);
  return { edit, ...compile(h, regions), original: buf };
}

function selftest(corpus) {
  const ops = {}; let bad = 0;
  for (const e of EDITS) {
    try {
      const p = prepare(corpus, e);
      if (!p.re.test(p.canon)) throw new Error('canonical result does not match its own expectation');
      if (p.re.test(L(p.original))) throw new Error('the unedited file already matches: the edit would prove nothing');
      // A stray change outside the span (first or last byte), or a reformatted line ending, must be rejected.
      const flip = (t, i) => t.slice(0, i) + (t[i] === 'x' ? 'y' : 'x') + t.slice(i + 1);
      if (p.span[0] > 0 && p.re.test(flip(p.canon, 0))) throw new Error('a change before the span is not caught');
      if (p.re.test(flip(p.canon, p.canon.length - 1))) throw new Error('a change after the span is not caught');
      if (p.canon.includes('\r\n') && p.re.test(p.canon.replace(/\r\n/g, '\n'))) throw new Error('CRLF to LF is not caught');
      ops[p.edit.op] = (ops[p.edit.op] || 0) + 1;
      const a = p.span[0], b = p.span[1] + (p.canon.length - p.original.length);
      console.log(`ok   ${e.id} ${p.edit.op.padEnd(6)} ${e.folder}/${e.file}  ${JSON.stringify(Buffer.from(L(p.original).slice(p.span[0], p.span[1]), 'latin1').toString('utf8')).slice(0, 70)} -> ${JSON.stringify(Buffer.from(p.canon.slice(a, b), 'latin1').toString('utf8')).slice(0, 90)}`);
    } catch (err) { bad++; console.log(`BAD  ${e.id} ${err.message}`); }
  }
  const counts = Object.values(ops);
  const even = counts.length === 10 && counts.every((n) => n === 6);
  finish({ measure: 'D2-edits-selftest', pass: bad === 0 && EDITS.length === 60 && even, edits: EDITS.length, bad, ops });
}

// ---------- the run ----------
async function run(corpus, only) {
  const out = mkdtempSync(join(SCRATCH, 'napkin-p0-edits-')), stateDir = join(out, 'state');
  const results = [];
  const list = EDITS.filter((e) => !only || only.includes(e.id));
  const browser = await launchBrowser();
  const open = async (folder) => {
    const nk = await startNapkin(join(corpus, folder), { stateDir });
    if (nk.ok) await call(nk.base, 'POST', '/api/styles', { applied: P0_FOLDERS[folder].applied });
    return nk;
  };
  const compId = async (nk, [file, name]) => {
    const l = await listFiles(nk.base); if (!l.ok) return { error: l.error };
    const f = l.files.find((x) => x.path === file);
    const c = f && (name ? f.components.find((x) => x.name === name) : f.components[0]);
    return c ? { id: c.id } : { error: `GET /api/files lists no component ${name || ''} in ${file}` };
  };
  const shot = async (nk, id) => browser.shoot(nk.base + viewPath(id, 800, 'light'), { width: 800, theme: 'light' });
  try {
    for (const folder of [...new Set(list.map((e) => e.folder))]) {
      const dir = join(corpus, folder);
      const pristine = snapshot(dir);
      let nk = await open(folder);
      console.log(`\n== ${folder}${nk.ok ? '' : ': napkin did not open: ' + nk.error}`);
      for (const e of list.filter((x) => x.folder === folder)) {
        const r = { id: e.id, op: null, folder, file: e.file, applied: false, span: false, others: false, reopen: false, undo: false, why: e.why, reason: '' };
        const fail = (why) => { r.reason = r.reason || why; };
        results.push(r);
        let p; try { p = prepare(corpus, e); r.op = p.edit.op; } catch (err) { fail('harness: ' + err.message); continue; }
        const target = join(dir, e.file);
        let liveShot = null, after = null;
        if (!nk.ok) { fail('napkin did not open the folder'); }
        else {
          const c = await compId(nk, e.comp);
          const comp = c.id ? await getComponent(nk.base, c.id) : { error: c.error };
          if (!comp.ok) fail(comp.error);
          else {
            // Resolve node placeholders to the tree's ids by byte offset (and check the tree's offsets are real).
            const compSrc = L(readFileSync(join(dir, e.comp[0])));
            let missing = null;
            const edit = JSON.parse(JSON.stringify(p.edit, (k, v) => {
              if (v && typeof v === 'object' && '$node' in v) {
                const n = comp.flat.find((x) => x.start === v.$node);
                if (!n) { missing = missing || `no node in GET /api/component starts at byte ${v.$node} (${JSON.stringify(compSrc.slice(v.$node, v.$node + 40))})`; return null; }
                if (!compSrc.slice(n.start, n.start + 1 + String(n.tag).length).toLowerCase().startsWith(('<' + n.tag).toLowerCase())) missing = missing || `tree node ${n.node} says <${n.tag}> at byte ${n.start}, the file has ${JSON.stringify(compSrc.slice(n.start, n.start + 20))}`;
                return n.node;
              }
              return v;
            }));
            if (missing) fail(missing);
            else {
              const res = await call(nk.base, 'POST', '/api/edit', { component: c.id, baseRevision: comp.revision, edits: [edit] });
              if (res.status !== 200 || res.json?.ok !== true) fail(`POST /api/edit -> ${brief(res)}`);
              else {
                r.applied = true;
                for (let i = 0; i < 80; i++) { after = readFileSync(target); if (!after.equals(p.original)) break; await sleep(25); }
                r.span = p.re.test(L(after));
                if (!r.span) fail(`the file is not the expected result (${describe(p, after)})`);
                const d = snapshotDiff(pristine, snapshot(dir));
                r.others = d.added.length === 0 && d.removed.length === 0 && d.changed.every((f) => f === e.file);
                if (!r.others) fail(`other files touched: ${JSON.stringify(d).slice(0, 200)}`);
                liveShot = await shot(nk, c.id);
                if (!liveShot.ok) fail(`live /view after the edit: ${liveShot.error}`);
                const u = await call(nk.base, 'POST', '/api/undo', { component: c.id });
                let now = readFileSync(target);
                for (let i = 0; i < 80 && !now.equals(p.original); i++) { await sleep(25); now = readFileSync(target); }
                const d2 = snapshotDiff(pristine, snapshot(dir));
                r.undo = u.status === 200 && now.equals(p.original) && !d2.added.length && !d2.removed.length && !d2.changed.length;
                if (!r.undo) fail(u.status !== 200 ? `POST /api/undo -> ${brief(u)}` : `undo left the folder different: ${JSON.stringify(d2).slice(0, 200)}`);
              }
            }
          }
        }
        // Whatever happened, put the folder back to pristine before the next edit (restart napkin if the harness had to).
        const d3 = snapshotDiff(pristine, snapshot(dir));
        if (d3.added.length || d3.removed.length || d3.changed.length) {
          for (const f of d3.added) rmSync(join(dir, f), { force: true });
          for (const f of [...d3.changed, ...d3.removed]) writeFileSync(join(dir, f), pristine.get(f));
          await nk.stop(); nk = await open(folder);
        }
        // Reopen: the edited bytes napkin wrote, opened fresh, must draw the same as the live view did.
        if (liveShot?.ok && after) {
          await nk.stop();
          writeFileSync(target, after);
          const fresh = await startNapkin(dir, { stateDir });
          const c2 = fresh.ok ? await compId(fresh, e.comp) : { error: fresh.error };
          const s2 = c2.id ? await shot(fresh, c2.id) : { ok: false, error: c2.error };
          await fresh.stop();
          writeFileSync(target, p.original);
          if (!s2.ok) fail(`reopened /view: ${s2.error}`);
          else { const d = diffPng(liveShot.png, s2.png); r.reopen = d.ratio <= MAX_DIFF; r.reopenDiffPct = pct(d.differing, d.total); if (!r.reopen) fail(`reopened render differs from the live one: ${r.reopenDiffPct}% pixels`); }
          nk = await open(folder);
        }
        r.pass = r.applied && r.span && r.others && r.reopen && r.undo;
        console.log(`  ${r.pass ? 'PASS' : 'FAIL'} ${e.id} ${String(r.op).padEnd(6)} ${e.file}${r.reason ? '  ' + r.reason.slice(0, 220) : ''}`);
      }
      await nk.stop();
    }
  } finally { await browser.close(); rmSync(stateDir, { recursive: true, force: true }); }
  return { results, out };
}
// Where the edited file first departs from what was expected.
function describe(p, after) {
  const a = L(p.original), b = L(after); let i = 0; while (i < a.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const show = (s) => JSON.stringify(Buffer.from(s, 'latin1').toString('utf8')).slice(0, 90);
  return `changed bytes ${i}..${a.length - j} of the original (expected span ${p.span[0]}..${p.span[1]}): ${show(a.slice(i, a.length - j))} -> ${show(b.slice(i, b.length - j))}`;
}

export { prepare, L as latin1 };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
function main() {
const { values } = parseArgs({ options: { corpus: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' }, selftest: { type: 'boolean' } } });
(async () => {
  let corpus = values.corpus, made = false;
  if (!corpus) { corpus = assembleCorpus().dir; made = true; }
  try {
    if (values.selftest) return selftest(corpus);
    const { results, out } = await run(corpus, values.only?.split(','));
    const n = (k) => results.filter((r) => r[k]).length;
    const byOp = {};
    for (const r of results) { const o = (byOp[r.op || '?'] ||= { edits: 0, pass: 0 }); o.edits++; if (r.pass) o.pass++; }
    finish({
      measure: 'D2-edits', pass: results.length === 60 && results.every((r) => r.pass), fullRun: !values.only, out,
      edits: results.length, applied: n('applied'), spanExact: n('span'), othersUntouched: n('others'), reopenMatches: n('reopen'), undoExact: n('undo'), passed: results.filter((r) => r.pass).length,
      byOp, firstFailures: results.filter((r) => !r.pass).slice(0, 8).map((r) => `${r.id} ${r.op}: ${r.reason.slice(0, 140)}`),
      passLine: 'all 60 edits: applied, file equals the expected result (only the edit span changed), no other file touched, reopened render = live render (<=0.1%), undo restores every byte',
    });
  } finally { if (made && !values.keep) rmSync(corpus, { recursive: true, force: true }); }
})().catch((e) => { console.error(e.stack); finish({ measure: 'D2-edits', pass: false, error: e.message }); });
}
