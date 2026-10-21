// INS-04: `node src/docs.js --dir <components> --out <dir>` writes a local, static catalog of the components:
// one page (index.html) with a props table, every variant cell rendered as an image with its usage line, and the source,
// plus the images, fonts and a catalog.json. No server, no JavaScript needed to read it; open index.html from disk.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openWorkspace } from './workspace.js';
import { createRenderer } from './render-png.js';
import { axes, variantGrid } from './model.js';
import { usageFor } from './usage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const label = (v) => (Object.keys(v).length ? Object.entries(v).map(([k, x]) => `${k}=${x}`).join(' · ') : 'default');

const CSS = `
@font-face { font-family: "Inter Var"; src: url(fonts/inter-latin-wght-normal.woff2) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "JB Mono"; src: url(fonts/jetbrains-mono-latin-wght-normal.woff2) format("woff2"); font-weight: 100 800; }
:root { color-scheme: light dark; --bg: #fbfbfc; --panel: #f3f4f6; --line: #dde0e6; --text: #1c1f27; --text-2: #4f5663; --accent: #2c52d2; --cell: #ffffff; --chip: #e9ecf3;
  --sans: "Inter Var", ui-sans-serif, system-ui, sans-serif; --mono: "JB Mono", ui-monospace, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #15171c; --panel: #1d2027; --line: #2d313b; --text: #e8eaf0; --text-2: #a9b0bf; --accent: #8ea6ff; --cell: #f4f5f8; --chip: #262a34; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 var(--sans); display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
nav { position: sticky; top: 0; align-self: start; height: 100vh; overflow: auto; padding: 24px 16px; border-right: 1px solid var(--line); background: var(--panel); }
nav h1 { font-size: 15px; margin: 0 0 2px; } nav p { margin: 0 0 18px; color: var(--text-2); font-size: 12.5px; }
nav a { display: block; padding: 5px 10px; border-radius: 6px; color: var(--text); text-decoration: none; font-size: 14px; }
nav a:hover { background: var(--chip); } nav small { color: var(--text-2); margin-left: 6px; font-size: 11.5px; }
main { padding: 40px 48px 96px; max-width: 1180px; }
section.comp { margin-bottom: 72px; scroll-margin-top: 24px; }
h2 { font-size: 30px; letter-spacing: -.02em; margin: 0 0 4px; }
h3 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-2); margin: 32px 0 10px; }
.lede { color: var(--text-2); margin: 0 0 16px; }
code, pre, .mono { font-family: var(--mono); font-size: 12.5px; }
.usage { display: block; padding: 10px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; width: max-content; max-width: 100%; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-2); font-weight: 600; background: var(--panel); }
.chip { display: inline-block; padding: 1px 8px; margin: 0 4px 4px 0; border-radius: 999px; background: var(--chip); font: 12px var(--mono); }
.chip.base { outline: 1.5px solid var(--accent); }
.group { margin: 0 0 28px; } .group > .gt { font: 12px var(--mono); color: var(--text-2); margin: 0 0 8px; }
.mgrid { display: grid; grid-template-columns: max-content repeat(var(--cols), minmax(150px, max-content)); gap: 12px; align-items: stretch; }
.head { font: 12px var(--mono); color: var(--text-2); align-self: end; padding: 0 0 2px; } .head.row { align-self: center; padding-right: 8px; }
figure.cell { margin: 0; display: flex; flex-direction: column; gap: 8px; }
figure.cell .img { display: grid; place-items: center; min-height: 84px; padding: 18px; background: var(--cell); border: 1px solid var(--line); border-radius: 10px; }
figure.cell img { display: block; max-width: 100%; height: auto; }
figure.cell figcaption { font: 11.5px var(--mono); color: var(--text-2); overflow-wrap: anywhere; }
figure.cell figcaption b { display: block; color: var(--text); font-weight: 600; margin-bottom: 2px; }
details { margin-top: 28px; } summary { cursor: pointer; color: var(--accent); font-size: 14px; }
pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; overflow: auto; margin: 10px 0 0; line-height: 1.55; }
footer { color: var(--text-2); font-size: 12.5px; margin-top: 48px; }
@media (max-width: 760px) { body { display: block; } nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); } main { padding: 24px 16px 64px; } }
`;

function propsTable(doc) {
  if (!doc.props.length) return '<p class="lede">No props. This component always looks the same.</p>';
  const rows = doc.props.map((p) => {
    const kind = p.type === 'enum' ? 'variant axis' : p.type === 'string' ? 'text setting' : 'toggle';
    const vals = p.type === 'enum' ? p.options.map((o) => `<span class="chip${o === p.default ? ' base' : ''}">${esc(o)}</span>`).join('') : p.type === 'boolean' ? '<span class="chip">true</span><span class="chip">false</span>' : '<span class="lede">any text</span>';
    return `<tr><td><code>${esc(p.name)}</code></td><td><code>${esc(p.type === 'enum' ? p.options.map((o) => `'${o}'`).join(' | ') : p.type)}</code></td><td>${vals}</td><td>${p.default === undefined ? '<span class="lede">none</span>' : `<code>${esc(typeof p.default === 'string' ? `"${p.default}"` : p.default)}</code>`}</td><td>${kind}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Prop</th><th>Type</th><th>Values (the base is outlined)</th><th>Default</th><th>What it is</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function grid(doc, imgOf) {
  const ax = axes(doc);
  const cell = (v) => { const i = imgOf(v); return `<figure class="cell"><div class="img"><img src="${esc(i.src)}" width="${i.w}" height="${i.h}" alt="${esc(`${doc.name} ${label(v)}`)}"></div><figcaption><b>${esc(label(v))}</b><code>${esc(usageFor(doc, v))}</code></figcaption></figure>`; };
  if (!ax.length) return `<div class="mgrid" style="--cols:1">${cell({})}</div>`;
  const [across, down, ...rest] = ax;
  let groups = [{}];
  for (const a of rest) groups = groups.flatMap((g) => a.options.map((o) => ({ ...g, [a.name]: o })));
  return groups.map((g) => {
    const head = Object.keys(g).length ? `<p class="gt">${esc(label(g))}</p>` : '';
    const cells = [];
    cells.push(`<div></div>`);
    for (const o of across.options) cells.push(`<div class="head">${esc(across.name)} = ${esc(o)}</div>`);
    for (const r of down ? down.options : [null]) {
      cells.push(down ? `<div class="head row">${esc(down.name)} = ${esc(r)}</div>` : '<div></div>');
      for (const o of across.options) { const m = { ...g, [across.name]: o, ...(down ? { [down.name]: r } : {}) }; cells.push(cell(Object.fromEntries(ax.map((a) => [a.name, m[a.name]])))); }
    }
    return `<div class="group">${head}<div class="mgrid" style="--cols:${across.options.length}">${cells.join('')}</div></div>`;
  }).join('');
}

const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

// Writes <out>/index.html, <out>/catalog.json, <out>/img/<Name>/<n>.png and <out>/fonts/. -> { out, components: [{ name, cells }] }
export async function buildDocs({ dir, out, title = 'Component catalog' }) {
  dir = resolve(dir); out = resolve(out);
  mkdirSync(join(out, 'fonts'), { recursive: true });
  for (const f of ['inter-latin-wght-normal.woff2', 'jetbrains-mono-latin-wght-normal.woff2']) copyFileSync(join(ROOT, 'public', 'fonts', f), join(out, 'fonts', f));
  const ws = await openWorkspace(dir), renderer = createRenderer();
  const catalog = [];
  try {
    await ws.settled();
    const entries = ws.entries().sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const { doc, source, readOnly } = await e.store.read();
      if (!doc) { catalog.push({ name: e.name, readOnly, html: `<section class="comp" id="${esc(e.name)}"><h2>${esc(e.name)}</h2><p class="lede">Not shown: ${esc(readOnly)}</p></section>`, cells: 0 }); continue; }
      mkdirSync(join(out, 'img', e.name), { recursive: true });
      const images = new Map();
      const cells = variantGrid(doc);
      await Promise.all(cells.map(async (v, i) => {
        const { png } = await renderer.render(ws, e, v);
        const rel = `img/${e.name}/${i + 1}.png`;
        writeFileSync(join(out, rel), png);
        images.set(JSON.stringify(v), { src: rel, ...pngSize(png) });
      }));
      const n = cells.length;
      catalog.push({
        name: e.name, cells: n,
        props: doc.props, cellList: cells.map((v) => ({ variant: v, usage: usageFor(doc, v), image: images.get(JSON.stringify(v)).src })),
        html: `<section class="comp" id="${esc(e.name)}">
<h2>${esc(e.name)}</h2>
<p class="lede">${n} variant cell${n === 1 ? '' : 's'}${axes(doc).length ? ` across ${axes(doc).map((a) => `<code>${esc(a.name)}</code>`).join(', ')}` : ''}. Each image is the real component, drawn by a browser.</p>
<code class="usage">import { ${esc(e.name)} } from './${esc(e.name)}';</code>
<h3>Props</h3>
${propsTable(doc)}
<h3>Variants and usage</h3>
${grid(doc, (v) => images.get(JSON.stringify(v)))}
<details><summary>Source, ${esc(e.name)}.tsx</summary><pre>${esc(source)}</pre></details>
</section>`,
      });
    }
  } finally { await renderer.close(); await ws.close(); }
  const nav = catalog.map((c) => `<a href="#${esc(c.name)}">${esc(c.name)}<small>${c.cells}</small></a>`).join('');
  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
<body><nav><h1>${esc(title)}</h1><p>${catalog.length} component${catalog.length === 1 ? '' : 's'}</p>${nav}</nav>
<main>${catalog.map((c) => c.html).join('\n')}<footer>Written by napkin from the component files; nothing here is edited by hand.</footer></main>
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
