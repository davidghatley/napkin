// LAY-10: a 10-snippet corpus. Snippets that fit become dialect nodes exactly; the rest are refused with the reason. 0 approximations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToNodes } from '../../src/html-import.js';
import { applyEdits } from '../../src/model.js';
import { readComponent } from '../../src/tsx/read.js';
import { readFileSync } from 'node:fs';
import { fixture } from '../helpers/harness.js';

const FIT = [
  ['a styled card', '<div style="display:flex; flex-direction:column; gap:8px; padding:16px; background:#fff"><h3 style="margin:0">Title</h3><p>Body &amp; more</p></div>', (t) => { assert.equal(t[0].style.flexDirection, 'column'); assert.equal(t[0].children[1].text, 'Body & more'); }],
  ['a button', '<button style="padding: 8px 16px; border-radius: 6px; background: rgb(34, 54, 176); color: #fff">Buy now</button>', (t) => assert.equal(t[0].style.background, 'rgb(34, 54, 176)')],
  ['an image', '<img src="assets/logo.png" alt="Logo" style="width:64px;height:64px">', (t) => assert.deepEqual(t[0].attrs, { src: 'assets/logo.png', alt: 'Logo' })],
  ['a list', '<ul style="margin:0;padding:0"><li>One</li><li>Two</li><li>Three</li></ul>', (t) => assert.equal(t[0].children.length, 3)],
  ['two siblings from a browser copy', '<html><body><!--StartFragment--><span style="font-weight:600">A</span><span style="opacity:0.5">B</span><!--EndFragment--></body></html>', (t) => { assert.equal(t.length, 2); assert.equal(t[1].style.opacity, 0.5); }],
];
const FIT2 = [
  ['named and numeric entities', '<p>5 &euro; &eacute;t&#233; &#x41; &lt;b&gt; &amp;amp</p>', (t) => assert.equal(t[0].text, '5 € été A <b> &amp')],
  ['a non-breaking space is kept, not collapsed', '<p>a&nbsp;&nbsp;b   c</p>', (t) => assert.equal(t[0].text, 'a\u00a0\u00a0b c')],
  ['braces and dollar signs are plain text', '<p>{a} ${b} $5</p>', (t) => assert.equal(t[0].text, '{a} ${b} $5')],
  ['unitless values where CSS allows them', '<p style="opacity:0.5;font-weight:600;line-height:1.4;margin:0;flex:1 1 0;z-index:3">x</p>', (t) => { assert.equal(t[0].style.opacity, 0.5); assert.equal(t[0].style.lineHeight, 1.4); assert.equal(t[0].style.margin, 0); assert.equal(t[0].style.flex, '1 1 0'); }],
];
const FIT3 = [
  ['HTML5 named references', '<p>&hellip; &rarr; &check; &NotEqualTilde;</p>', (t) => assert.equal(t[0].text, '\u2026 \u2192 \u2713 \u2242\u0338')],
  ['numeric references in the 0x80-0x9F range follow windows-1252', '<p>&#128; &#x93;x&#x94; &#145;</p>', (t) => assert.equal(t[0].text, '\u20ac \u201cx\u201d \u2018')],
  ['a text of only a non-breaking space is kept', '<span>&nbsp;</span>', (t) => assert.equal(t[0].text, '\u00a0')],
  ['a non-void element written self-closing stays open, as HTML parses it', '<div/><p>in</p></div>', (t) => { assert.equal(t.length, 1); assert.equal(t[0].children[0].text, 'in'); }],
  ['the first of two duplicate attributes wins', '<img src="a.png" src="b.png" alt="x" alt="y">', (t) => assert.deepEqual(t[0].attrs, { src: 'a.png', alt: 'x' })],
  ['a bogus comment and a doctype are dropped', '<!foo bar><!DOCTYPE html><?xml version="1.0"?><p>x</p>', (t) => assert.equal(t[0].text, 'x')],
  ['a meta charset and a plain html/body wrapper are fine', '<html lang="en"><head><meta charset="utf-8"></head><body><!--StartFragment--><p>x</p><!--EndFragment--></body></html>', (t) => assert.equal(t[0].text, 'x')],
  ['a data: URI with ; and , inside url()', '<div style="background:url(data:image/png;base64,iVBORw0KGgo=) no-repeat;width:10px">x</div>', (t) => { assert.equal(t[0].style.background, 'url(data:image/png;base64,iVBORw0KGgo=) no-repeat'); assert.equal(t[0].style.width, '10px'); }],
  ['a quoted string with ; inside', '<p style="font-family:\'a;b\', serif;margin:0">x</p>', (t) => { assert.equal(t[0].style.fontFamily, "'a;b', serif"); assert.equal(t[0].style.margin, 0); }],
  ['whitespace between inline elements inside a flex parent does not render, so it is dropped', '<div style="display:flex"><span>a</span> <span>b</span></div>', (t) => assert.equal(t[0].children.length, 2)],
  ['whitespace between a block and an inline element collapses away', '<div><div style="display:block">a</div> <span>b</span></div>', (t) => assert.equal(t[0].children.length, 2)],
];
const REFUSE2 = [
  ['important with a space', '<p style="color:red ! important">x</p>', /important/],
  ['important after a comment', '<p style="color:red /* why */ !important">x</p>', /important/],
  ['white-space-collapse preserve', '<span style="white-space-collapse:preserve">a  b</span>', /white-space/],
  ['white-space pre-wrap', '<span style="white-space: pre-wrap">a  b</span>', /white-space/],
  ['a style element', '<style>p{color:red}</style><p>x</p>', /<style>/],
  ['a head with a style', '<html><head><style>p{}</style></head><body><p>x</p></body></html>', /<style>/],
  ['a body with attributes', '<html><body style="margin:0"><p>x</p></body></html>', /body/],
  ['whitespace that renders between inline spans', '<div><span>a</span> <span>b</span></div>', /space between/],
  ['whitespace between top-level inline elements', '<span>a</span> <span>b</span>', /space between/],
  ['a paragraph opened inside a paragraph', '<p>a<p>b</p></p>', /<p>/],
  ['a div inside a paragraph', '<p>a<div>b</div></p>', /<p>/],
];
const REFUSE = [
  ['a script', '<div><script>alert(1)</script></div>', /<script>/],
  ['a class name', '<div class="card">x</div>', /class/],
  ['an svg', '<svg width="10" height="10"><circle r="4"/></svg>', /<svg>/],
  ['text beside an element', '<div>Hello <b>there</b> <span>you</span></div>', /<b>|mixes text/],
  ['a link', '<a href="https://example.com">go</a>', /href/],
  ['important', '<p style="color:red !important">x</p>', /important/],
  ['a custom property', '<p style="color: var(--x); --x: red">x</p>', /custom property/],
  ['a unitless length (browsers ignore it)', '<div style="width:100; padding:0 10">x</div>', /width.*unit|unit.*width/i],
  ['a unitless font size', '<span style="font-size:14">x</span>', /font-size|fontSize/],
  ['an entity that does not exist', '<p>a &notanentity; b</p>', /&notanentity;/],
  ['a stray ampersand', '<p>Fish &chips</p>', /&/],
  ['preserved white space', '<span style="white-space:pre">a   b</span>', /white-space/],
  ['a backtick in the text', '<p>run `npm test`</p>', /backtick/],
  ['a table', '<table><tr><td>1</td></tr></table>', /<table>/],
];
test('round 2 exactness: HTML5 references, windows-1252 numerics, nbsp text, HTML parsing rules, data URIs', () => {
  for (const [name, html, check] of FIT3) { const r = htmlToNodes(html); assert.equal(r.ok, true, `${name}: ${r.reason}`); check(r.trees); }
  for (const [name, html, re] of REFUSE2) { const r = htmlToNodes(html); assert.equal(r.ok, false, name); assert.match(r.reason, re, name); }
});
test('exactness: entities, non-breaking spaces, braces and unitless values', async () => {
  for (const [name, html, check] of FIT2) { const r = htmlToNodes(html); assert.equal(r.ok, true, `${name}: ${r.reason}`); check(r.trees); }
  // the converted text survives the real writer and reader unchanged
  const { tempRepo } = await import('../helpers/harness.js');
  const { openStore } = await import('../../src/store.js');
  const r = tempRepo(['Card']), store = await openStore(r.file), { revision } = await store.read();
  const tree = htmlToNodes('<div><p>{a} ${b} 5 &euro; a&nbsp;&nbsp;b</p></div>').trees[0];
  const ok = await store.apply({ baseRevision: revision, by: 't', edits: [{ op: 'paste', parent: 'card', tree }] });
  assert.equal(ok.ok, true, ok.error);
  const back = readComponent(readFileSync(r.file, 'utf8')).doc.root.children.at(-1).children[0];
  assert.equal(back.text, '{a} ${b} 5 € a\u00a0\u00a0b');
  await store.close();
});
test('10-snippet corpus: fits are converted exactly, the rest refused with the reason', () => {
  assert.equal(FIT.length + REFUSE.length >= 10, true);
  for (const [name, html, check] of FIT) { const r = htmlToNodes(html); assert.equal(r.ok, true, `${name}: ${r.reason}`); check(r.trees); }
  for (const [name, html, re] of REFUSE) { const r = htmlToNodes(html); assert.equal(r.ok, false, name); assert.match(r.reason, re, name); }
});
test('0 approximations: every converted style value is the snippet\'s own text, and the result is accepted by the model', () => {
  const doc = readComponent(readFileSync(fixture('Card'), 'utf8')).doc;
  const r = htmlToNodes('<div style="padding:12px 20px;border:1px solid rgba(0,0,0,.2)"><span style="letter-spacing:-0.02em">Hi</span></div>');
  assert.equal(r.trees[0].style.padding, '12px 20px');
  assert.equal(r.trees[0].style.border, '1px solid rgba(0,0,0,.2)');
  assert.equal(r.trees[0].children[0].style.letterSpacing, '-0.02em');
  const next = applyEdits(doc, [{ op: 'paste', parent: 'card', tree: r.trees[0] }]);
  assert.equal(next.root.children.at(-1).style.padding, '12px 20px');
});

test('a value with ; inside url() or quotes survives the model, the writer and the reader', async () => {
  const { tempRepo } = await import('../helpers/harness.js');
  const { openStore } = await import('../../src/store.js');
  const r = tempRepo(['Card']), store = await openStore(r.file), { revision } = await store.read();
  const tree = htmlToNodes('<div style="background:url(data:image/png;base64,iVBORw0KGgo=) no-repeat;font-family:\'a;b\', serif;width:10px">x</div>').trees[0];
  const ok = await store.apply({ baseRevision: revision, by: 't', edits: [{ op: 'paste', parent: 'card', tree }] });
  assert.equal(ok.ok, true, ok.error);
  const back = readComponent(readFileSync(r.file, 'utf8')).doc.root.children.at(-1);
  assert.equal(back.style.background, 'url(data:image/png;base64,iVBORw0KGgo=) no-repeat');
  assert.equal(back.style.fontFamily, "'a;b', serif");
  const bad = await store.apply({ baseRevision: ok.revision, by: 't', edits: [{ op: 'set', path: 'card.color', value: 'red; background: url(x)' }] });
  assert.equal(bad.ok, false, 'a ; outside quotes and parentheses is still refused');
  await store.close();
});
