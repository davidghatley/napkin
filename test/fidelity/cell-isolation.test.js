// WPC-01 / WPC-02 (decision 0012): a canvas cell renders a component exactly as a plain React page with no app CSS would.
// The same Probe component is drawn in a napkin cell (100%) and in a blank page built with esbuild; every node's computed style
// and the pixels of the root's clip must be identical. The editor's chrome (box-sizing reset, ink colour, form-control resets,
// focus rings, scrollbar rules, kbd/code rules, inherited type) must not leak in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { tempRepo, startServer, sleep, ROOT } from '../helpers/harness.js';
import { launchChromium } from '../helpers/cdp.js';

export const PROBE = `import type { CSSProperties } from 'react';
export interface ProbeProps { title?: string; }
const base: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: '8px', width: '280px', padding: '16px', borderRadius: '12px', background: '#d9d9d9' },
  title: {}, lead: {}, note: {}, code: {}, key: {}, link: {}, button: {}, input: {}, select: {}, area: {}, list: {}, item: {}, table: {}, cell: {},
  scroll: { width: '120px', height: '40px', overflow: 'auto' }, tall: { height: '120px', width: '40px', background: '#ccc' },
  fixed: { width: '100px', padding: '10px', border: '3px solid #345', height: '30px' },
};
const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
};
function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}
export function Probe({ title = 'Ada Lovelace' }: ProbeProps) {
  const v = {};
  return (
    <div data-n="root" style={s('root', v)}>
      <h2 data-n="title" style={s('title', v)}>{title}</h2>
      <p data-n="lead" style={s('lead', v)}>Plain text bold italic</p>
      <span data-n="note" style={s('note', v)}>note</span>
      <code data-n="code" style={s('code', v)}>const a = 1</code>
      <kbd data-n="key" style={s('key', v)}>K</kbd>
      <a data-n="link" href="#x" style={s('link', v)}>link</a>
      <button data-n="button" style={s('button', v)}>Follow</button>
      <input data-n="input" defaultValue="hi" style={s('input', v)} />
      <select data-n="select" style={s('select', v)}><option>one</option></select>
      <textarea data-n="area" defaultValue="t" style={s('area', v)} />
      <ul data-n="list" style={s('list', v)}><li data-n="item" style={s('item', v)}>item</li></ul>
      <table data-n="table" style={s('table', v)}><tbody><tr><td data-n="cell" style={s('cell', v)}>c</td></tr></tbody></table>
      <div data-n="scroll" style={s('scroll', v)}><div data-n="tall" style={s('tall', v)} /></div>
      <div data-n="fixed" style={s('fixed', v)} />
    </div>
  );
}
`;

// color-scheme is `light` in a cell (a blank page is `normal`, which renders light): same pixels, different keyword.
// All computed properties of every element under a root, keyed by position in the tree.
const COLLECT = (rootSel) => `JSON.stringify([...document.querySelector(${JSON.stringify(rootSel)}).querySelectorAll('*'), document.querySelector(${JSON.stringify(rootSel)})].map((el) => {
  const cs = getComputedStyle(el), o = {};
  for (const p of cs) if (!/^--|^(color-scheme|cursor|width|height|inline-size|block-size|perspective-origin|transform-origin)$/.test(p)) o[p] = cs.getPropertyValue(p);
  return [el.tagName + (el.dataset.n ? '#' + el.dataset.n : ''), o];
}))`;
const BOX = (rootSel) => `JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(rootSel)}).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: Math.ceil(r.width), h: Math.ceil(r.height), rw: r.width, rh: r.height }; })())`;

// Rewritten for decision 0013 (lead ruling 2026-10-30): was the dialect cell of Probe (`.mount`), now Probe's /view frame (an iframe of the file as the
// browser draws it); the comparison with a plain no-CSS React page, the tolerance and the isolation checks are unchanged; intent unchanged.
test('WPC-01/02: a canvas cell equals a plain no-CSS React page, computed style of every node and pixels at 100%', { timeout: 120000 }, async (t) => {
  const repo = tempRepo(['Card']);
  writeFileSync(join(repo.compDir, 'Probe.tsx'), PROBE);
  writeFileSync(join(repo.compDir, 'Plain.tsx'), readFileSync(join(repo.compDir, 'Card.tsx'), 'utf8').replace(/Card/g, 'Plain')); // an existing content-box component in the dialect (width 320, padding 16)
  const server = await startServer(repo.compDir);
  const canvas = await launchChromium({ width: 1440, height: 900 });
  const app = await launchChromium({ width: 1600, height: 1200 });
  try {
    // the plain app: no app CSS (only a white page behind it, as the canvas frame is white, so rounded corners blend alike)
    const dir = mkdtempSync(join(tmpdir(), 'napkin-fidelity-'));
    writeFileSync(join(dir, 'App.tsx'), `import { createRoot } from 'react-dom/client';\nimport { flushSync } from 'react-dom';\nimport { Probe } from '@components/Probe';\nflushSync(() => createRoot(document.getElementById('m')!).render(<Probe />));\n`);
    await build({ entryPoints: [join(dir, 'App.tsx')], bundle: true, format: 'iife', jsx: 'automatic', alias: { '@components': repo.compDir }, nodePaths: [join(ROOT, 'node_modules')], outfile: join(dir, 'app.js'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
    writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><style>html { background: #fff }</style><div id="m"></div><script src="app.js"></script>`);
    await app.goto(`file://${join(dir, 'index.html')}`);
    await app.waitFor(`!!document.querySelector('#m [data-n=root]')`);
    await app.eval(`document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);

    await canvas.goto(server.url);
    await canvas.waitFor('document.body.dataset.ready === "1"');
    // Probe's frame: the document of /view/<id>; `inFrame` runs an expression with `document` and `getComputedStyle` of that document
    const PID = await canvas.eval(`napkin.find('Probe').component`);
    const FD = `napkin.stage.sections.get(${JSON.stringify(PID)}).docFrame`;
    await canvas.waitFor(`!!${FD}?.doc()?.querySelector('[data-n=root]')`);
    await canvas.eval(`document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    const inFrame = (expr) => `(() => { const document = ${FD}.doc(), getComputedStyle = (e) => document.defaultView.getComputedStyle(e); return ${expr}; })()`;
    const frameRoot = `${FD}.element(${FD}.doc().querySelector('[data-n=root]').dataset.n === 'root' ? ${FD}.tree().tree[0].node : '')`;
    await canvas.eval(`napkin.view.set({ x: 0, y: 0, z: 1 })`);
    await sleep(300);
    const rootRect = `(() => { const r = ${frameRoot}.getBoundingClientRect(); return r; })()`;
    const sel = '[data-n=root]'; // inside the frame's document
    // move the root into the middle of the stage, on whole pixels, so nothing overlaps it and antialiasing is identical
    const cur = JSON.parse(await canvas.eval(`JSON.stringify((() => { const r = ${rootRect}, v = napkin.view.get(); return { x: v.x, y: v.y, z: v.z, l: r.left, t: r.top }; })())`));
    assert.equal(cur.z, 1, 'canvas at 100%');
    await canvas.eval(`napkin.view.set({ x: ${cur.x + Math.round(420 - cur.l) + (0)}, y: ${cur.y + Math.round(140 - cur.t)}, z: 1 })`);
    await sleep(300);
    const fr = JSON.parse(await canvas.eval(`JSON.stringify((() => { const r = ${rootRect}; return [r.left, r.top]; })())`));
    t.diagnostic(`root at ${fr} on the canvas`);

    const a = JSON.parse(await canvas.eval(inFrame(COLLECT(sel)))), b = JSON.parse(await app.eval(COLLECT('#m [data-n=root]')));
    assert.equal(a.length, b.length, 'same node count');
    const diffs = [];
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i][0], b[i][0]);
      for (const p of new Set([...Object.keys(a[i][1]), ...Object.keys(b[i][1])])) if (a[i][1][p] !== b[i][1][p]) diffs.push(`${a[i][0]} ${p}: canvas ${a[i][1][p]} vs app ${b[i][1][p]}`);
    }
    t.diagnostic(`computed style: ${a.length} nodes, ${diffs.length} property differences`);
    assert.deepEqual(diffs, [], 'every node computes the same as in a blank page');

    const SB = (r) => `(() => { const e = document.querySelector(${JSON.stringify(r)} + ' [data-n=scroll]'); return [e.offsetWidth - e.clientWidth, e.scrollHeight, e.clientHeight].join(); })()`;
    t.diagnostic(`scrollbar gutter/scrollH/clientH: canvas ${await canvas.eval(inFrame(SB('').replace(/^\(\(\) => /, '(() => ').replace("' [data-n=scroll]'", "'[data-n=scroll]'")))} app ${await app.eval(SB('#m'))}`);
    // the same must hold in dark chrome, in play mode, and inside a ghost/preview layer (proposals, history preview)
    const RE = (c) => c.eval(inFrame(COLLECT(sel)));
    const same = async (what) => { const x = JSON.parse(await RE(canvas)); const bad = []; for (let i = 0; i < x.length; i++) for (const p in x[i][1]) if (x[i][1][p] !== b[i][1][p]) bad.push(`${x[i][0]} ${p}: ${x[i][1][p]} vs ${b[i][1][p]}`); assert.deepEqual(bad, [], what); };
    await canvas.eval(`document.documentElement.dataset.theme = 'dark'`); await same('dark chrome');
    await canvas.eval(`document.documentElement.dataset.theme = 'light'`); await same('light chrome');
    await canvas.eval(`document.body.dataset.play = '1'`); await same('play mode'); await canvas.eval(`delete document.body.dataset.play`);
    const ghost = (c, host) => c.eval(`(() => { const h = ${host}; const box = document.createElement('div'); box.className = 'preview-layer'; box.innerHTML = '<div class="preview-inner"><div id="gprobe"><p>x</p><button>b</button><code>c</code><input></div></div>'; h.append(box); return true; })()`);
    await ghost(canvas, `document.querySelector('section[data-name="Plain"] .cell')`); // (a dialect cell: the ghost layers live in cells)
    await app.eval(`document.body.insertAdjacentHTML('beforeend', '<div id="gprobe2"><p>x</p><button>b</button><code>c</code><input></div>')`);
    const g1 = JSON.parse(await canvas.eval(COLLECT('#gprobe'))), g2 = JSON.parse(await app.eval(COLLECT('#gprobe2')));
    const gbad = []; for (let i = 0; i < g1.length; i++) for (const p in g1[i][1]) if (p !== 'pointer-events' && g1[i][1][p] !== g2[i][1][p]) gbad.push(`${g1[i][0]} ${p}: ${g1[i][1][p]} vs ${g2[i][1][p]}`);
    assert.deepEqual(gbad, [], 'ghost/preview layers are isolated too');
    // editor custom properties never reach a cell: a component's var(--accent, fallback) gets its fallback; only token variables may arrive
    const EDITOR_VARS = 'accent accent-soft accent-text bg cell-line chrome chrome-2 chrome-3 dot frame frame-ink frame-shadow h head-line kbd line line-2 measure mono ok on-accent sans select shadow-pop text text-2 text-3 warn w c ink ls lf gz split gap gut stage panel git chip title slot out lift dir d off fh cols gcols head swatch-line stage-line dot-changed token-mode-count'.split(' ');
    const leaks = JSON.parse(await canvas.eval(`JSON.stringify((() => { const out = [];
      for (const host of [document.querySelector('section[data-name="Plain"] .mount'), document.querySelector('.preview-inner'), ${FD}.doc().body]) { // the frame's own document is a host too: editor variables must not reach it
        for (const n of ${JSON.stringify(EDITOR_VARS)}) { const e = host.ownerDocument.createElement('i'); e.style.color = 'var(--' + n + ', rgb(1, 2, 3))'; host.append(e); if (host.ownerDocument.defaultView.getComputedStyle(e).color !== 'rgb(1, 2, 3)') out.push(host.className + ' --' + n); e.remove(); }
        const cs = host.ownerDocument.defaultView.getComputedStyle(host); for (const p of cs) if (p.startsWith('--') && !p.startsWith('--nk-')) out.push(host.className + ' defines ' + p);
      } return out; })())`));
    assert.deepEqual(leaks, [], 'no editor custom property (and no un-prefixed one at all, with no tokens loaded) reaches a cell or a ghost');
    await canvas.eval(`document.querySelector('.preview-layer')?.remove()`);
    // a content-box element (Plain's root has width 320 + padding 16) says so beside W
    await canvas.eval(`napkin.select({ component: napkin.find('Plain').component, node: 'card', variant: {} })`);
    await canvas.waitFor(`!!document.querySelector('#width')`).catch(async () => { throw new Error('no panel: ' + await canvas.eval(`document.querySelector('#panel')?.textContent.slice(0, 300)`)); });
    await canvas.waitFor(`!!document.querySelector('#boxhint-width')`).catch(async () => { throw new Error('no hint: ' + await canvas.eval(`document.querySelector('#panel')?.textContent.slice(0, 400)`)); });
    assert.match(await canvas.eval(`document.querySelector('#boxhint-width').textContent`), /content-box: outer = W \+ padding \+ border/);
    await canvas.eval(`napkin.select(null)`); await sleep(200);
    const boxC = JSON.parse(await canvas.eval(`JSON.stringify((() => { const r = ${rootRect}; return { x: r.left + scrollX, y: r.top + scrollY, w: Math.ceil(r.width), h: Math.ceil(r.height), rw: r.width, rh: r.height }; })())`)), boxA = JSON.parse(await app.eval(BOX('#m [data-n=root]')));
    assert.deepEqual([boxC.rw, boxC.rh], [boxA.rw, boxA.rh], 'same layout size (280 wide + padding 16 = 312 content-box in an app)');
    const shot = async (b, box) => Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 }, captureBeyondViewport: b === app })).data, 'base64');
    const pc = await shot(canvas, boxC), pa = await shot(app, boxA);
    // decode both PNGs in the browser and count differing pixels
    // A rounded corner's antialiasing can land one level apart between a composited canvas layer and a plain page; anything above 2/255 is a real difference.
    const TOL = 2;
    const DIFF = (x, y) => `(async () => { const TOL = ${TOL}; const load = (b) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b; });
      const [a, b] = await Promise.all([load(${JSON.stringify(x)}), load(${JSON.stringify(y)})]);
      const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height), px = (i) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const A = px(a), B = px(b); const ex = []; let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      let exact = 0; for (let k = 0; k < A.length; k += 4) { if (A[k] !== B[k] || A[k + 1] !== B[k + 1] || A[k + 2] !== B[k + 2] || A[k + 3] !== B[k + 3]) exact++; if (Math.max(Math.abs(A[k] - B[k]), Math.abs(A[k + 1] - B[k + 1]), Math.abs(A[k + 2] - B[k + 2]), Math.abs(A[k + 3] - B[k + 3])) > TOL) { n++; if (ex.length < 6) ex.push([(k / 4) % w, Math.floor(k / 4 / w), [...A.slice(k, k + 4)], [...B.slice(k, k + 4)]]); const X = (k / 4) % w, Y = Math.floor(k / 4 / w); x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); } }
      return JSON.stringify({ n, total: w * h, size: [a.width, a.height, b.width, b.height], bbox: [x0, y0, x1, y1], ex, exact }); })()`;
    const d = JSON.parse(await app.eval(DIFF(pc.toString('base64'), pa.toString('base64'))));
    if (process.env.FIDELITY_OUT) { writeFileSync(join(process.env.FIDELITY_OUT, 'canvas.png'), pc); writeFileSync(join(process.env.FIDELITY_OUT, 'app.png'), pa); }
    t.diagnostic(`pixels differing by more than ${TOL}/255: ${d.n} (exactly equal except ${d.exact}) of ${d.total} (${JSON.stringify(d.bbox)}) ${JSON.stringify(d.ex)}`);
    assert.equal(d.n, 0, '0 px differ: canvas cell at 100% vs plain React app');
  } finally { await canvas.close(); await app.close(); await server.stop(); }
});
