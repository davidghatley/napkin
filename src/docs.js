// INS-04: `node src/docs.js --dir <components> --out <dir>` writes a local, static catalog of the components:
// one page (index.html) with a props table, every variant cell rendered as an image with its usage line, and the source,
// plus the images, fonts and a catalog.json. No server, no JavaScript needed to read it; open index.html from disk.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build as esbuild } from 'esbuild';
import { openWorkspace } from './workspace.js';
import { createRenderer } from './render-png.js';
import { axes, variantGrid } from './model.js';
import { usageFor } from './usage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const label = (v) => (Object.keys(v).length ? Object.entries(v).map(([k, x]) => `${k}=${x}`).join(' · ') : 'default');


// ------------------------------------------------------------------------------------------------ JSDoc
const squash = (c) => c.replace(/^\/\*\*|\*\/$/g, '').split('\n').map((l) => l.replace(/^\s*\* ?/, '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
// The comment right above `export function Name`, and the comments above each member of `interface NameProps`.
export function jsdoc(source, name) {
  const at = source.search(new RegExp(`export function ${name}\\b`));
  const before = at < 0 ? '' : source.slice(0, at);
  const i = before.lastIndexOf('/**');
  const m = i >= 0 && /^\/\*\*[\s\S]*?\*\/\s*$/.test(before.slice(i)) ? [null, before.slice(i).trim()] : null;
  const props = {};
  const iface = new RegExp(`interface ${name}Props\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (iface) for (const mm of iface[1].matchAll(/(\/\*\*[\s\S]*?\*\/)?\s*(\w+)\??\s*:\s*[^;]+;/g)) if (mm[1]) props[mm[2]] = squash(mm[1]);
  return { description: m ? squash(m[1]) : '', props };
}

const CSS = `
@font-face { font-family: "Inter Var"; src: url(fonts/inter-latin-wght-normal.woff2) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "JB Mono"; src: url(fonts/jetbrains-mono-latin-wght-normal.woff2) format("woff2"); font-weight: 100 800; }
:root { color-scheme: light dark; --bg: #fbfbfc; --panel: #f3f4f6; --line: #e1e4ea; --text: #1c1f27; --text-2: #565d6b; --accent: #2c52d2; --stage: #f4f5f8; --stage-line: #e4e7ee; --chip: #eceef4; --head: #fbfbfcf2;
  --sans: "Inter Var", ui-sans-serif, system-ui, sans-serif; --mono: "JB Mono", ui-monospace, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #15171c; --panel: #1b1e25; --line: #2a2e38; --text: #e8eaf0; --text-2: #a3abba; --accent: #8ea6ff; --stage: #eceef3; --stage-line: #3a3f4b; --chip: #262a34; --head: #15171cf2; } }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 76px; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 var(--sans); display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
nav { position: sticky; top: 0; align-self: start; height: 100vh; overflow: auto; padding: 28px 14px; border-right: 1px solid var(--line); background: var(--panel); }
nav h1 { font-size: 15px; margin: 0 10px 2px; } nav p { margin: 0 10px 20px; color: var(--text-2); font-size: 13px; }
nav a { display: flex; justify-content: space-between; padding: 7px 10px; border-radius: 7px; color: var(--text); text-decoration: none; font-size: 14px; }
nav a:hover { background: var(--chip); } nav a[aria-current="true"] { background: var(--chip); font-weight: 600; box-shadow: inset 3px 0 0 var(--accent); }
nav small { color: var(--text-2); font-size: 12px; }
main { padding: 0 56px 120px; max-width: 1200px; }
section.comp { padding-top: 12px; margin-bottom: 96px; }
.comp-head { position: sticky; top: 0; z-index: 5; display: flex; align-items: baseline; gap: 14px; padding: 18px 0 12px; background: var(--head); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.comp-head h2 { font-size: 26px; letter-spacing: -.02em; margin: 0; } .comp-head .meta { color: var(--text-2); font-size: 13.5px; }
h3 { font-size: 13px; letter-spacing: .04em; color: var(--text-2); margin: 44px 0 14px; font-weight: 600; text-transform: uppercase; }
.desc { font-size: 16.5px; max-width: 68ch; margin: 22px 0 0; } .desc.missing { color: var(--text-2); font-size: 14px; border-left: 3px solid var(--line); padding-left: 12px; }
code, pre, .mono { font-family: var(--mono); font-size: 12.5px; }
pre.code, code.line { display: block; padding: 11px 15px; background: var(--panel); border: 1px solid var(--line); border-radius: 9px; white-space: pre; overflow-x: auto; margin: 0; line-height: 1.55; }
code.line { width: 100%; }
.play { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start; }
.stage { min-height: 200px; display: grid; place-items: center; padding: 36px; background: var(--stage); border: 1px solid var(--stage-line); border-radius: 14px; color: #1c1f27; }
.controls { display: grid; gap: 14px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.controls label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; } .controls label small { font-weight: 400; color: var(--text-2); }
.controls input[type="text"], .controls select { font: 14px var(--sans); padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); }
.controls label.check { display: flex; gap: 8px; align-items: center; }
.play .use { grid-column: 1 / -1; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); font-weight: 600; background: var(--panel); }
td.desc-cell { color: var(--text-2); max-width: 46ch; } td.desc-cell.none { opacity: .7; font-style: italic; }
.chip { display: inline-block; padding: 1px 9px; margin: 0 5px 4px 0; border-radius: 999px; background: var(--chip); font: 12px var(--mono); }
.chip.base { outline: 1.5px solid var(--accent); }
details.group { border: 1px solid var(--line); border-radius: 12px; margin: 0 0 14px; padding: 0 18px; }
details.group > summary { cursor: pointer; padding: 14px 0; font-weight: 600; font-size: 14.5px; } details.group > summary small { color: var(--text-2); font-weight: 400; margin-left: 8px; }
details.group[open] > summary { border-bottom: 1px solid var(--line); margin-bottom: 18px; }
.mgrid { display: grid; grid-template-columns: max-content repeat(var(--cols), minmax(170px, 1fr)); gap: 16px; align-items: stretch; margin-bottom: 22px; }
.head { font-size: 13px; color: var(--text-2); align-self: end; } .head.row { align-self: center; padding-right: 10px; } .head b { color: var(--text); font-weight: 600; }
figure.cell { margin: 0; display: grid; gap: 10px; align-content: start; min-width: 0; }
figure.cell .img { display: grid; place-items: center; min-height: 96px; padding: 22px; background: var(--stage); border: 1px solid var(--stage-line); border-radius: 12px; }
figure.cell img { display: block; max-width: 100%; height: auto; }
figure.cell figcaption { font-size: 13px; color: var(--text-2); display: grid; gap: 6px; min-width: 0; } figure.cell figcaption b { color: var(--text); font-weight: 600; }
figure.cell code.line { padding: 7px 10px; font-size: 12px; }
details.src { margin-top: 34px; } details.src > summary { cursor: pointer; color: var(--accent); font-size: 14px; }
footer { color: var(--text-2); font-size: 13px; margin-top: 64px; }
@media (max-width: 900px) { body { display: block; } nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); } main { padding: 0 20px 64px; } .play { grid-template-columns: 1fr; } }
`;

// Runs in the page: the sticky header's nav highlight, and the Playground (mounts the component's own bundle, no network).
const SCRIPT = `
(function () {
  var links = [].slice.call(document.querySelectorAll('nav a'));
  var io = 'IntersectionObserver' in window && new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) links.forEach(function (a) { a.setAttribute('aria-current', String(a.hash === '#' + e.target.id)); }); }); }, { rootMargin: '-20% 0px -70% 0px' });
  [].forEach.call(document.querySelectorAll('section.comp'), function (s) { io && io.observe(s); });
  var q = function (v) { return /["\\\\{}<>\\n]/.test(v) ? '{' + JSON.stringify(v) + '}' : '"' + v + '"'; };
  [].forEach.call(document.querySelectorAll('.play'), function (play) {
    var data = JSON.parse(play.querySelector('script[type="application/json"]').textContent), api = window['__napkin_' + data.name];
    var stage = play.querySelector('.mount'), use = play.querySelector('.use'), state = {}, un = null;
    data.props.forEach(function (p) { state[p.name] = p.default === undefined ? (p.type === 'boolean' ? false : '') : p.default; });
    function draw() {
      if (un) un(); un = api ? api.mount(stage, state) : null;
      var parts = [];
      data.props.forEach(function (p) { var v = state[p.name]; if (p.type === 'enum' && v !== p.default) parts.push(p.name + '=' + q(v)); });
      data.props.forEach(function (p) { if (p.type === 'string' && state[p.name] !== '') parts.push(p.name + '=' + q(state[p.name])); });
      data.props.forEach(function (p) { if (p.type === 'boolean' && state[p.name]) parts.push(p.name); });
      use.textContent = '<' + data.name + (parts.length ? ' ' + parts.join(' ') : '') + ' />';
    }
    [].forEach.call(play.querySelectorAll('[data-prop]'), function (el) {
      el.addEventListener('input', function () { state[el.dataset.prop] = el.type === 'checkbox' ? el.checked : el.value; draw(); });
    });
    draw();
  });
})();
`;

const human = (s) => String(s).replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

function propsTable(doc, notes) {
  if (!doc.props.length) return '<p class="desc missing">No props. This component always looks the same.</p>';
  const rows = doc.props.map((p) => {
    const kind = p.type === 'enum' ? 'variant axis' : p.type === 'string' ? 'text setting' : 'toggle';
    const vals = p.type === 'enum' ? p.options.map((o) => `<span class="chip${o === p.default ? ' base' : ''}">${esc(o)}</span>`).join('') : p.type === 'boolean' ? '<span class="chip">true</span><span class="chip">false</span>' : '<span class="chip">any text</span>';
    const note = notes[p.name];
    return `<tr><td><code>${esc(p.name)}</code><br><small>${kind}</small></td><td>${vals}</td><td>${p.default === undefined ? '<span class="chip">none</span>' : `<code>${esc(typeof p.default === 'string' ? `"${p.default}"` : p.default)}</code>`}</td><td class="desc-cell${note ? '' : ' none'}">${note ? esc(note) : 'No description. Add a JSDoc comment above this prop in the file.'}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Prop</th><th>Values (the base is outlined)</th><th>Default</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function grid(doc, imgOf) {
  const ax = axes(doc);
  const cell = (v) => {
    const i = imgOf(v), caption = Object.keys(v).length ? Object.entries(v).map(([k, x]) => `${human(k)} <b>${esc(x)}</b>`).join(' · ') : '<b>Default</b>';
    return `<figure class="cell"><div class="img"><img loading="lazy" src="${esc(i.src)}" width="${i.w}" height="${i.h}" alt="${esc(`${doc.name} ${label(v)}`)}"></div><figcaption><span>${caption}</span><code class="line">${esc(usageFor(doc, v))}</code></figcaption></figure>`;
  };
  if (!ax.length) return `<div class="mgrid" style="--cols:1">${cell({})}</div>`;
  const [across, down, ...rest] = ax;
  let groups = [{}];
  for (const a of rest) groups = groups.flatMap((g) => a.options.map((o) => ({ ...g, [a.name]: o })));
  const per = across.options.length * (down ? down.options.length : 1);
  const many = groups.length * per > 12 && groups.length > 1; // a big matrix opens one group; the others fold away
  return groups.map((g, gi) => {
    const cells = [`<div></div>`];
    for (const o of across.options) cells.push(`<div class="head">${esc(human(across.name))} <b>${esc(o)}</b></div>`);
    for (const r of down ? down.options : [null]) {
      cells.push(down ? `<div class="head row">${esc(human(down.name))} <b>${esc(r)}</b></div>` : '<div></div>');
      for (const o of across.options) { const m = { ...g, [across.name]: o, ...(down ? { [down.name]: r } : {}) }; cells.push(cell(Object.fromEntries(ax.map((a) => [a.name, m[a.name]])))); }
    }
    const body = `<div class="mgrid" style="--cols:${across.options.length}">${cells.join('')}</div>`;
    if (!Object.keys(g).length) return body;
    const title = Object.entries(g).map(([k, v]) => `${esc(human(k))} <b>${esc(v)}</b>`).join(' · ');
    return `<details class="group"${many && gi > 0 ? '' : ' open'}><summary>${title}<small>${per} variants</small></summary>${body}</details>`;
  }).join('');
}

const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

// Writes <out>/index.html, <out>/catalog.json, <out>/img/<Name>/<n>.png, <out>/js/<Name>.js and <out>/fonts/. Read-only on `dir`.
// -> { out, components: [{ name, cells }] }
export async function buildDocs({ dir, out, title = 'Component catalog' }) {
  dir = resolve(dir); out = resolve(out);
  mkdirSync(join(out, 'fonts'), { recursive: true }); mkdirSync(join(out, 'js'), { recursive: true });
  for (const f of ['inter-latin-wght-normal.woff2', 'jetbrains-mono-latin-wght-normal.woff2']) copyFileSync(join(ROOT, 'public', 'fonts', f), join(out, 'fonts', f));
  const ws = await openWorkspace(dir, { writeSidecars: false }), renderer = createRenderer(); // read-only: ids are derived in memory, nothing is written into the folder, no lock is taken
  const catalog = [];
  try {
    await ws.settled();
    const entries = ws.entries().sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const { doc, source, readOnly } = await e.store.read();
      if (!doc) { catalog.push({ name: e.name, readOnly, html: `<section class="comp" id="${esc(e.name)}"><div class="comp-head"><h2>${esc(e.name)}</h2></div><p class="desc missing">Not shown: ${esc(readOnly)}</p></section>`, cells: 0 }); continue; }
      mkdirSync(join(out, 'img', e.name), { recursive: true });
      const images = new Map();
      const cells = variantGrid(doc);
      await Promise.all(cells.map(async (v, i) => {
        const { png } = await renderer.render(ws, e, v);
        const rel = `img/${e.name}/${i + 1}.png`;
        writeFileSync(join(out, rel), png);
        images.set(JSON.stringify(v), { src: rel, ...pngSize(png) });
      }));
      // the component's own bundle as a classic script (works from file://): window.__napkin_<Name>.mount(el, props)
      let playable = false;
      try {
        const entry = `import * as M from ${JSON.stringify(e.file)}; import { createElement } from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
const C = M[${JSON.stringify(e.name)}] ?? M.default ?? Object.values(M).find((x) => typeof x === 'function');
export function mount(el, props = {}) { const root = createRoot(el); flushSync(() => root.render(createElement(C, props))); return () => root.unmount(); }`;
        const r = await esbuild({ stdin: { contents: entry, resolveDir: dirname(e.file), loader: 'js' }, bundle: true, write: false, format: 'iife', globalName: `__napkin_${e.name}`, minify: true, target: 'es2019', jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' }, nodePaths: [join(ROOT, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
        writeFileSync(join(out, 'js', `${e.name}.js`), r.outputFiles[0].text); playable = true;
      } catch { /* a component that does not build has no playground; its pictures above say so */ }
      const note = jsdoc(source, e.name);
      const n = cells.length, ax = axes(doc);
      const controls = doc.props.map((p) => {
        const hint = note.props[p.name] ? `<small>${esc(note.props[p.name])}</small>` : '';
        if (p.type === 'enum') return `<label>${esc(human(p.name))}${hint}<select data-prop="${esc(p.name)}">${p.options.map((o) => `<option${o === p.default ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
        if (p.type === 'boolean') return `<label class="check"><input type="checkbox" data-prop="${esc(p.name)}"${p.default ? ' checked' : ''}> ${esc(human(p.name))}</label>`;
        return `<label>${esc(human(p.name))}${hint}<input type="text" data-prop="${esc(p.name)}" value="${esc(p.default ?? '')}"></label>`;
      }).join('') || '<p class="desc missing">No props to play with.</p>';
      catalog.push({
        name: e.name, cells: n, description: note.description, props: doc.props, cellList: cells.map((v) => ({ variant: v, usage: usageFor(doc, v), image: images.get(JSON.stringify(v)).src })),
        script: playable ? `js/${e.name}.js` : null,
        html: `<section class="comp" id="${esc(e.name)}">
<div class="comp-head"><h2>${esc(e.name)}</h2><span class="meta">${n} variant${n === 1 ? '' : 's'}${ax.length ? ` · ${ax.map((a) => esc(a.name)).join(', ')}` : ''}</span></div>
${note.description ? `<p class="desc">${esc(note.description)}</p>` : '<p class="desc missing">No description yet. Add one in a JSDoc comment (<code>/** ... */</code>) above <code>export function ' + esc(e.name) + '</code>; it shows up here.</p>'}
<h3>Playground</h3>
<div class="play"><div class="stage"><div class="mount"></div></div><form class="controls" onsubmit="return false">${controls}</form><code class="line use"></code><script type="application/json">${JSON.stringify({ name: e.name, props: doc.props.map(({ name, type, default: d }) => ({ name, type, default: d })) }).replace(/</g, '\\u003c')}</script></div>
<h3>Props</h3>
${propsTable(doc, note.props)}
<h3>All variants</h3>
${grid(doc, (v) => images.get(JSON.stringify(v)))}
<details class="src"><summary>Source, ${esc(e.name)}.tsx</summary><pre class="code">${esc(source)}</pre></details>
</section>`,
      });
    }
  } finally { await renderer.close(); await ws.close(); }
  const nav = catalog.map((c) => `<a href="#${esc(c.name)}">${esc(c.name)}<small>${c.cells}</small></a>`).join('');
  const scripts = catalog.filter((c) => c.script).map((c) => `<script src="${esc(c.script)}"></script>`).join('\n');
  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
<body><nav aria-label="Components"><h1>${esc(title)}</h1><p>${catalog.length} component${catalog.length === 1 ? '' : 's'}</p>${nav}</nav>
<main>${catalog.map((c) => c.html).join('\n')}<footer>Written by napkin from the component files; nothing here is edited by hand. The playground runs the real component in this page, offline.</footer></main>
${scripts}
<script>${SCRIPT}</script>
</body></html>
`;
  writeFileSync(join(out, 'index.html'), html);
  writeFileSync(join(out, 'catalog.json'), JSON.stringify(catalog.map(({ html, ...rest }) => rest), null, 2) + '\n');
  return { out, components: catalog.map((c) => ({ name: c.name, cells: c.cells })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, out: { type: 'string' }, title: { type: 'string' } } });
  if (!values.dir || !values.out) { console.error('usage: node src/docs.js --dir <components folder> --out <catalog folder> [--title <text>]'); process.exit(2); }
  const r = await buildDocs({ dir: values.dir, out: values.out, ...(values.title && { title: values.title }) });
  console.log(`napkin docs: ${r.components.map((c) => `${c.name} (${c.cells})`).join(', ')} -> ${join(r.out, 'index.html')}`);
  process.exit(0);
}
