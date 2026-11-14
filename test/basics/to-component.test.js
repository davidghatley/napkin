// Create component from a selection: the conversion itself. What a person cares about is that the component shows the
// same thing the selection showed, so every case renders the made component with React and compares it with the HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { toComponent, componentName, styleObject } from '../../src/doc/to-component.js';

async function load(source) {
  const js = transformSync(source, { loader: 'tsx', format: 'esm', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' }).code;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(`const React = globalThis.__napkinReact;\n${js}`).toString('base64')}`);
  return mod.default;
}
globalThis.__napkinReact = React;
const shown = async (source) => renderToStaticMarkup(React.createElement(await load(source)));
// the same thing to the eye: tags, attributes and text, with white space folded the way a browser folds it
const fold = (h) => h.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/ ?\/>/g, '>').trim();

test('a card becomes a component that renders the same markup', async () => {
  const html = `<article class="card" id="hero" data-kind="promo">
  <h2 class="card-title">Orbit 731</h2>
  <p>A <strong>bright</strong> circle &amp; a <em>dark</em> one.</p>
  <a href="/launch?x=1&amp;y=2" class="btn" aria-label="Launch">Launch</a>
</article>`;
  const { source, dropped } = toComponent({ name: 'Card', html, from: 'orbit.html:12' });
  assert.deepEqual(dropped, []);
  assert.match(source, /^\/\/ Made from orbit\.html:12\.\n/);
  assert.match(source, /export default function Card\(\)/);
  assert.match(source, /className="card"/);
  const out = await shown(source);
  assert.equal(fold(out), fold(html.replace(/&amp;y/, '&amp;y')));
});

test('white space between inline elements survives; braces and entities are text', async () => {
  const html = `<p>
    <b>one</b>
    <i>two</i> {three} &lt;four&gt; five&nbsp;six
  </p>`;
  const out = await shown(toComponent({ name: 'Line', html }).source);
  assert.equal(out, '<p><b>one</b> <i>two</i> {three} &lt;four&gt; five six</p>');
});

test('inline styles become a style object, custom properties and vendor prefixes included', async () => {
  assert.equal(styleObject('color: red; --gap: 4px; -webkit-line-clamp: 2; background: url("a;b.png") no-repeat; font-size:12px'),
    '{ color: "red", "--gap": "4px", WebkitLineClamp: "2", background: "url(\\"a;b.png\\") no-repeat", fontSize: "12px" }');
  const out = await shown(toComponent({ name: 'Box', html: '<div style="padding: 8px 12px; --tone: #f0bd45; background: var(--tone)">x</div>' }).source);
  assert.equal(out, '<div style="padding:8px 12px;--tone:#f0bd45;background:var(--tone)">x</div>');
});

test('void elements, boolean attributes, form values and SVG come through', async () => {
  const html = `<form class="f"><label for="n">Name</label><input id="n" type="text" value="Ada" required maxlength="20"><br>
<input type="checkbox" checked disabled><img src="a.png" alt="A" srcset="a.png 1x, b.png 2x">
<svg viewBox="0 0 10 10" stroke-width="2" fill-rule="evenodd"><path d="M0 0L10 10" stroke-linecap="round"/><use xlink:href="#a"/></svg></form>`;
  const { source } = toComponent({ name: 'Form', html });
  assert.match(source, /htmlFor="n"/);
  assert.match(source, /defaultValue="Ada"/);
  assert.match(source, /defaultChecked/);
  assert.match(source, /strokeWidth="2"/);
  assert.match(source, /xlinkHref="#a"/);
  const out = await shown(source);
  assert.match(out, /<label for="n">Name<\/label><input id="n" type="text" required="" maxLength="20" value="Ada"\/><br\/>/);
  assert.match(out, /<input type="checkbox" disabled="" checked=""\/>/);
  assert.match(out, /<svg viewBox="0 0 10 10" stroke-width="2" fill-rule="evenodd"><path d="M0 0L10 10" stroke-linecap="round"><\/path><use xlink:href="#a"><\/use><\/svg>/);
});

test('the CSS that reaches the selection travels with it, inside its media query', async () => {
  const css = [
    { text: '.card { padding: 16px; background: `tick` ${x}; }', context: [] },
    { text: '.card { padding: 24px; }', context: ['@media (min-width: 600px)'] },
  ];
  const { source } = toComponent({ name: 'Card', html: '<div class="card">x</div>', css });
  const out = await shown(source);
  assert.match(out, /^<style>\n\.card \{ padding: 16px; background: `tick` \$\{x\}; \}\n\n@media \(min-width: 600px\) \{\n  \.card \{ padding: 24px; \}\n\}\n<\/style><div class="card">x<\/div>$/);
});

test('scripts and inline handlers stay behind, and the person is told', () => {
  const { source, dropped } = toComponent({ name: 'Btn', html: '<div><button onclick="go()">Go</button><script>go = 1</script></div>' });
  assert.doesNotMatch(source, /onclick|<script/i);
  assert.equal(dropped.length, 2);
  assert.match(dropped.join(' | '), /onclick handler on <button>/);
});

test('pre keeps its line breaks', async () => {
  const out = await shown(toComponent({ name: 'Code', html: '<pre>a\n  b\n</pre>' }).source);
  assert.equal(out, '<pre>a\n  b\n</pre>');
});

test('names: from the class, the id or the tag, never one that is taken; bad input is refused plainly', () => {
  assert.equal(componentName('card-title'), 'CardTitle');
  assert.equal(componentName('btn', ['Btn.tsx'.replace('.tsx', ''), 'btn2']), 'Btn3');
  assert.equal(componentName('123'), 'Component');
  assert.equal(componentName(''), 'Component');
  assert.throws(() => toComponent({ name: 'card', html: '<div></div>' }), /PascalCase/);
  assert.throws(() => toComponent({ name: 'Card', html: '<i>a</i><b>b</b>' }), /select one element/);
});

test('spaces at the edges of inline elements are kept, in one line and across lines', async () => {
  const one = await shown(toComponent({ name: 'Salutation', html: '<p class="salutation">Hello<strong> David </strong>— your order is confirmed.</p>' }).source);
  assert.equal(one, '<p class="salutation">Hello<strong> David </strong>— your order is confirmed.</p>');
  const long = '<div class="box"><h2>Title</h2>\n  <span>Dear<em> reader </em>of a rather long line that will not fit on one row of the generated file at all</span>\n</div>';
  const out = await shown(toComponent({ name: 'Box', html: long }).source);
  assert.match(out, /<span>Dear<em> reader <\/em>of a rather long line/);
});

test('component CSS: selectors split into compounds, and urls rebased from the stylesheet that held them', async () => {
  const { compounds, rebase } = await import('../../src/doc/component-css.js');
  assert.deepEqual(compounds('.shell > .offer h2:not(.a > b)::before').map((c) => [c.comb, c.text]), [[null, '.shell'], ['>', '.offer'], [' ', 'h2:not(.a > b)::before']]);
  assert.deepEqual(compounds('a+b ~ [data-x="1 2"]').map((c) => [c.comb, c.text]), [[null, 'a'], ['+', 'b'], ['~', '[data-x="1 2"]']]);
  assert.equal(rebase(`.b { background: url('../assets/a.png'), url(/x.png), url("data:image/png;base64,AA"), url(#f); }`, 'styles/audit.css', '.'),
    `.b { background: url('assets/a.png'), url(/x.png), url("data:image/png;base64,AA"), url(#f); }`);
  assert.equal(rebase('a { b: url(i.png) }', 'pages/x.html', 'pages'), 'a { b: url(i.png) }');
});
