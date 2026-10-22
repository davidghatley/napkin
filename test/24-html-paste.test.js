// LAY-10: HTML paste is read by the browser's own parser and verified by rendering before it is accepted (public/canvas/html-paste.js).
// 1. curated expectations; 2. the whole critic corpus (200+ snippets): every one is either refused with a reason or accepted, and an accepted one
// is checked against an independent oracle: the nodes written through the real store, rendered by real React on the server, compared with the
// original HTML in two identical sandboxes (text, tree, every box to 0.5 px, every computed style). 0 approximations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lab } from './helpers/lab.js';
import { renderPasted } from './helpers/paste-oracle.js';
import { evidence } from './helpers/agents.js';

const CORPUS = JSON.parse(readFileSync(new URL('./fixtures/lay10-corpus.json', import.meta.url), 'utf8'));
const FIT = [
  ['spaces inside inline elements', '<div><span>Hello </span><span>world</span></div>', (t) => assert.deepEqual(t[0].children.map((c) => c.text), ['Hello ', 'world'])],
  ['a leading space', '<div><span>Hello</span><span> world</span></div>', (t) => assert.equal(t[0].children[1].text, ' world')],
  ['HTML5, windows-1252 and legacy references', '<p>&euro; &eacute; &hellip; &#128; &#x93;x&#x94; &copy 1 &notit;</p>', (t) => assert.equal(t[0].text, '€ é … € “x” © 1 ¬it;')],
  ['a text of only a non-breaking space', '<span>&nbsp;</span>', (t) => assert.equal(t[0].text, ' ')],
  ['a non-void tag written self-closing nests as HTML does', '<div/><p>in</p></div>', (t) => { assert.equal(t.length, 1); assert.equal(t[0].children[0].text, 'in'); }],
  ['the first duplicate attribute wins', '<img src="a.png" src="b.png" alt="x" alt="y">', (t) => assert.deepEqual(t[0].attrs, { src: 'a.png', alt: 'x' })],
  ['a bogus comment', '<!foo bar><p>x</p>', (t) => assert.equal(t[0].text, 'x')],
  ['a data: URI with ; inside url()', '<div style="background:url(data:image/png;base64,iVBORw0KGgo=) no-repeat;width:10px">x</div>', (t) => assert.match(t[0].style.background, /base64,iVBORw0KGgo=/)],
  ['a quoted ; and a comment', '<p style="font-family:\'a;b\', serif /* c */;margin:0">x</p>', (t) => assert.match(t[0].style.fontFamily, /a;b/)],
  ['font-size-adjust stays a string (React would add px to a number)', '<p style="font-size-adjust:0.5">x</p>', (t) => assert.strictEqual(t[0].style.fontSizeAdjust, '0.5')],
  ['plain numbers stay numbers only where React adds no px', '<p style="opacity:0.5;font-weight:600;line-height:1.4;z-index:3;flex:1;margin:0">x</p>', (t) => { assert.strictEqual(t[0].style.opacity, 0.5); assert.strictEqual(t[0].style.zIndex, 3); assert.strictEqual(t[0].style.flex, '1 1 0%'); assert.strictEqual(t[0].style.margin, '0px'); }],
  ['braces and dollar signs', '<p>{a} ${b} $5</p>', (t) => assert.equal(t[0].text, '{a} ${b} $5')],
  ['a browser copy wrapper', '<html lang="en"><head><meta charset="utf-8"></head><body><!--StartFragment--><p>x</p><!--EndFragment--></body></html>', (t) => assert.equal(t[0].text, 'x')],
  ['a width the browser itself ignores', '<p style="width:100">x</p>', (t) => assert.equal(t[0].style.width, undefined)],
  ['inline spans in a flex parent', '<div style="display:flex"><span>a</span> <span>b</span></div>', (t) => assert.equal(t[0].children.length, 2)],
];
const REFUSE = [
  ['a class name', '<div class="card">x</div>', /class/],
  ['a script', '<div><script>alert(1)</script></div>', /script/],
  ['an svg', '<svg width="10" height="10"><circle r="4"/></svg>', /svg/],
  ['a style element', '<style>p{color:red}</style><p>x</p>', /<style>/],
  ['a link', '<a href="https://example.com">go</a>', /href/],
  ['a table', '<table><tr><td>1</td></tr></table>', /table|tbody|tr|td/],
  ['!important, spaced, upper-case, after a comment', '<p style="color:red ! IMPORTANT">x</p>', /important/],
  ['a custom property', '<p style="--x: red; color: var(--x)">x</p>', /custom property/],
  ['text beside an element', '<div>Hello <span>there</span></div>', /mixes text/],
  ['text outside any element', 'Hello <p>x</p>', /outside any element/],
  ['a backtick in the text', '<p>run `npm test`</p>', /backtick/],
  ['preserved white space', '<span style="white-space:pre">a   b</span>', /exactly/],
  ['a body with attributes', '<html><body style="margin:0"><p>x</p></body></html>', /body/],
  ['a space that renders between two inline spans', '<div><span>a</span> <span>b</span></div>', /exactly/],
  ['an unsupported element', '<div><b>bold</b></div>', /<b>/],
];

test('LAY-10: curated cases, parsed by the browser and verified by rendering', { timeout: 120000 }, async (t) => {
  const L = await lab({}, { theme: 'light' });
  const paste = (html) => L.q(`import('/canvas/html-paste.js').then((m) => m.pasteHtml(${JSON.stringify(html)})).then(JSON.stringify)`).then(JSON.parse);
  try {
    for (const [name, html, check] of FIT) await t.test(`fits: ${name}`, async () => { const r = await paste(html); assert.equal(r.ok, true, r.reason); check(r.trees); });
    for (const [name, html, re] of REFUSE) await t.test(`refused: ${name}`, async () => { const r = await paste(html); assert.equal(r.ok, false, 'accepted'); assert.match(r.reason, re); });
  } finally { await L.close(); }
});

test('LAY-10: the whole critic corpus: refused with a reason, or accepted and exact against real React', { timeout: 590000 }, async () => {
  const L = await lab({}, { theme: 'light' });
  const stats = { accepted: 0, refused: 0 }, bad = [], refusals = [];
  try {
    await L.q(`import('/canvas/html-paste.js').then((m) => { window.__hp = m; return true; })`);
    for (const [name, html] of CORPUS) {
      const r = JSON.parse(await L.q(`window.__hp.pasteHtml(${JSON.stringify(html)}).then(JSON.stringify)`));
      if (!r.ok) { stats.refused++; if (!r.reason || r.reason.length < 5) bad.push(`${name}: refused without a reason`); refusals.push(`${name}: ${r.reason}`); continue; }
      stats.accepted++;
      const o = await renderPasted(r.trees);
      if (!o.ok) { bad.push(`${name}: the model refused the nodes: ${o.error}`); continue; }
      const diff = await L.q(`window.__hp.diffAgainstMarkup(${JSON.stringify(html)}, ${JSON.stringify(o.inner)})`);
      if (diff) bad.push(`${name}: ${JSON.stringify(html).slice(0, 90)} -> ${diff}`);
    }
  } finally { await L.close(); }
  evidence('LAY-10', `LAY-10: ${CORPUS.length} snippets (the critics' corpora plus the cases they listed): ${stats.accepted} accepted and verified exact against real React rendering (text, tree, every box to 0.5 px, every computed style), ${stats.refused} refused with a reason, ${bad.length} approximations.\nverify: EVIDENCE=1 node --test --test-force-exit test/24-html-paste.test.js\n\nrefusals:\n${refusals.join('\n')}\n`);
  console.log(`corpus ${CORPUS.length}: accepted ${stats.accepted}, refused ${stats.refused}, approximations ${bad.length}`);
  assert.deepEqual(bad, [], 'accepted snippets that are not exact');
});
