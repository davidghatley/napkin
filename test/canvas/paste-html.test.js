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
const REFUSE = [
  ['a script', '<div><script>alert(1)</script></div>', /<script>/],
  ['a class name', '<div class="card">x</div>', /class/],
  ['an svg', '<svg width="10" height="10"><circle r="4"/></svg>', /<svg>/],
  ['text beside an element', '<div>Hello <b>there</b> <span>you</span></div>', /<b>|mixes text/],
  ['a link', '<a href="https://example.com">go</a>', /href/],
  ['important', '<p style="color:red !important">x</p>', /important/],
  ['a custom property', '<p style="color: var(--x); --x: red">x</p>', /custom property/],
  ['a table', '<table><tr><td>1</td></tr></table>', /<table>/],
];
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
