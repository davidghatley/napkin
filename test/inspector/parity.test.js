// The cascade is worked out three ways that must agree: the browser itself (ground truth: getComputedStyle), the same
// cascade code matching with element.matches() in the canvas, and the server's own selector matcher behind
// GET /api/component/<id>/rules?node= . Every element of a document with hard cases (inheritance, @media, !important,
// inline, :nth-child, :not, :has, sibling combinators, attribute selectors, fallbacks) is compared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFolder, sleep } from './helpers.js';
import { cli } from '../helpers/open.js';
import { launchChromium } from '../helpers/cdp.js';

const FILES = {
  'a.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Parity</title>
<style>
:root { --a: 10px; --b: var(--a); --c: #123456; --ink: #111; --deep: var(--missing, 3px); }
@media (prefers-color-scheme: dark) { :root { --ink: #eee; --c: #abcdef; } }
@media (max-width: 480px) { .card { --a: 2px; } .card .t { padding: var(--b); } }
@media (min-width: 481px) and (max-width: 700px) { .card .t { color: var(--c); } }
body { color: var(--ink); margin: 0; }
.card { --a: 20px; padding: var(--a); border: 1px solid var(--c); }
.card.alt { --a: 30px; }
.card > .t { background: var(--c); }
.card .t { color: red; }
.t { color: blue !important; margin: var(--deep) var(--nope, 1px); }
.t:not(.x) { padding-top: var(--b); }
ul li:nth-child(2n+1) { color: green; }
li:first-child + li { margin-left: 4px; }
li ~ li:last-child { margin-right: 6px; }
[data-k="v"] { outline: 1px solid var(--c); }
[data-k^="v"][title] { outline-width: 3px; }
.card:has(> .x) { --a: 40px; }
:is(.x, .y) .t, .y > .t { letter-spacing: 1px; }
div:empty { height: 5px; }
a:hover { color: red; }
p::first-line { color: orange; }
</style></head>
<body>
<div class="card" id="one"><span class="t" style="padding-left: var(--a)">One</span><span class="t x" style="margin: 7px">Two</span></div>
<div class="card alt y"><span class="t">Three</span><div data-k="vx" title="t"></div></div>
<div class="card"><span class="x"></span><b class="t">Four</b></div>
<ul><li>a</li><li>b</li><li>c</li><li>d</li></ul>
<p>Text <a href="#h">link</a></p>
</body></html>`,
};
const NORM = `(() => { const c = document.createElement('canvas').getContext('2d'); return (v) => { c.fillStyle = '#000'; c.fillStyle = v; return c.fillStyle; }; })()`;

for (const scenario of [{ width: 600, dark: false }, { width: 420, dark: true }]) {
  test(`parity at ${scenario.width}px ${scenario.dark ? 'dark' : 'light'}: browser, canvas cascade and server cascade agree on every element`, { timeout: 90000 }, async () => {
    const dir = writeFolder(FILES);
    const app = await cli(dir);
    const browser = await launchChromium({ width: scenario.width, height: 800 });
    try {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scenario.dark ? 'dark' : 'light' }] });
      await browser.goto(`${app.url}view/a.html`);
      const server = {}; // node id -> the server's answer
      const tree = await (await fetch(`${app.url}api/component/a.html`)).json();
      const ids = []; (function flat(ns) { for (const n of ns) { ids.push(n.node); flat(n.children); } })(tree.tree);
      await Promise.all(ids.map(async (id) => { server[id] = (await (await fetch(`${app.url}api/component/a.html/rules?node=${id}&width=${scenario.width}&theme=${scenario.dark ? 'dark' : 'light'}`)).json()).node; }));
      const result = await browser.eval(`(async () => {
        const { createCascade } = await import('/canvas/inspector-cascade.js');
        const data = await (await fetch('/api/component/a.html/rules')).json();
        const tree = await (await fetch('/api/component/a.html')).json();
        const norm = ${NORM};
        const PSEUDO = /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\\b(\\([^)]*\\))?/gi;
        const ids = new WeakMap(); let n = 0;
        const cas = createCascade(data.rules, { matches: (e, s) => { try { return e.matches(s.replace(PSEUDO, '').trim() || '*'); } catch { return false; } }, parent: (e) => e.parentElement, inline: (e) => e.getAttribute('style') || '', id: (e) => ids.get(e) ?? (ids.set(e, ++n), n), media: (p) => matchMedia(p).matches }, { sheets: data.sheets });
        const out = [];
        const pair = (el, node) => {
          const ex = cas.explain(el), cs = getComputedStyle(el);
          const vars = {}; for (const [k, v] of Object.entries(ex.vars)) vars[k] = { value: v?.value ?? null, browser: cs.getPropertyValue(k).trim() };
          const colors = {}; for (const p of ['color', 'background-color', 'outline-color']) { const w = ex.props[p]; if (w && w.resolved !== null) colors[p] = { ours: norm(w.resolved ?? w.value), browser: norm(cs.getPropertyValue(p)) }; }
          out.push({ node: node.node, tag: node.tag, props: Object.fromEntries(Object.entries(ex.props).map(([k, w]) => [k, [w.value, w.source.kind, w.source.order ?? null, w.resolved ?? null]])), vars, colors });
          const kids = [...el.children].filter((c) => !c.hasAttribute('data-napkin'));
          let j = 0; for (const c of kids) { while (j < node.children.length && node.children[j].tag.toLowerCase() !== c.localName) j++; if (j < node.children.length) pair(c, node.children[j++]); }
        };
        pair(document.documentElement, tree.tree[0]);
        return JSON.stringify(out);
      })()`).then(JSON.parse);
      assert.ok(result.length > 20, `${result.length} elements compared`);
      let checkedVars = 0, checkedColors = 0;
      for (const r of result) {
        const s = server[r.node];
        assert.ok(s, `server answered for ${r.node}`);
        // the canvas cascade and the server cascade pick the same winner for every property, from the same rule, with the same resolved value
        const theirs = Object.fromEntries(Object.entries(s.props).map(([k, w]) => [k, [w.value, w.source.kind, w.source.order ?? null, w.resolved ?? null]]));
        assert.deepEqual(theirs, r.props, `${r.tag} ${r.node}: winners`);
        assert.deepEqual(Object.fromEntries(Object.entries(s.vars).map(([k, v]) => [k, v?.value ?? null])), Object.fromEntries(Object.entries(r.vars).map(([k, v]) => [k, v.value])), `${r.tag} ${r.node}: variables`);
        // and the variables are what the browser says they are
        for (const [k, v] of Object.entries(r.vars)) { if (v.value !== null) { assert.equal(v.value, v.browser, `${r.tag} ${r.node}: ${k} is what the browser computes`); checkedVars++; } }
        for (const [p, c] of Object.entries(r.colors)) { assert.equal(c.ours, c.browser, `${r.tag} ${r.node}: ${p} resolves to what the browser paints`); checkedColors++; }
      }
      assert.ok(checkedVars > 15 && checkedColors > 5, `${checkedVars} variables and ${checkedColors} colours checked against the browser`);
    } finally { await browser.close(); await app.stop(); }
  });
}
