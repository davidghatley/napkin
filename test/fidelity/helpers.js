// Shared by the fidelity tests: a plain no-CSS React page, a clip screenshot, and a pixel diff decoded in the browser.
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../helpers/harness.js';

export const TOL = 2; // a rounded corner's antialiasing can land one level apart between a composited layer and a plain page
// A plain app: esbuild bundle of `entry` source, white page behind it (the canvas frame is white), no other CSS.
export async function plainApp(browser, compDir, source) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-fidelity-'));
  writeFileSync(join(dir, 'App.tsx'), source);
  await build({ entryPoints: [join(dir, 'App.tsx')], bundle: true, format: 'iife', jsx: 'automatic', alias: { '@components': compDir }, nodePaths: [join(ROOT, 'node_modules')], outfile: join(dir, 'app.js'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><style>html { background: #fff }</style><div id="m"></div><script src="app.js"></script>`);
  await browser.goto(`file://${join(dir, 'index.html')}`);
  await browser.waitFor(`!!document.querySelector('#m [data-n=root]')`);
  await browser.eval(`document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
}
export const boxOf = async (b, sel) => JSON.parse(await b.eval(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(), q = (n) => Math.round(n * 100) / 100; /* float noise from the world transform (95.00001) is not a size */ return { x: r.left + scrollX, y: r.top + scrollY, w: Math.ceil(q(r.width)), h: Math.ceil(q(r.height)), rw: q(r.width), rh: q(r.height) }; })())`));
export async function clip(b, box, beyond) {
  return Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 }, captureBeyondViewport: beyond })).data, 'base64');
}
// Put the element on whole pixels in the middle of the canvas stage, at 100%.
export async function placeAt100(canvas, sel, left = 420, top = 140) {
  for (let i = 0; i < 6; i++) {
    const cur = JSON.parse(await canvas.eval(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(), v = napkin.view.get(); return { x: v.x, y: v.y, l: r.left, t: r.top }; })())`));
    if (cur.l === left && cur.t === top) return;
    await canvas.eval(`napkin.view.set({ x: ${cur.x + left - cur.l}, y: ${cur.y + top - cur.t}, z: 1 })`);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('could not place the element on whole pixels');
}
export async function pixelDiff(decoder, a, b) {
  const code = `(async () => { const TOL = ${TOL}; const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
    const [a, b] = await Promise.all([load(${JSON.stringify(a.toString('base64'))}), load(${JSON.stringify(b.toString('base64'))})]);
    const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height), px = (i) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const A = px(a), B = px(b); let n = 0, exact = 0; const ex = [];
    for (let k = 0; k < A.length; k += 4) { const m = Math.max(Math.abs(A[k] - B[k]), Math.abs(A[k + 1] - B[k + 1]), Math.abs(A[k + 2] - B[k + 2]), Math.abs(A[k + 3] - B[k + 3])); if (m) exact++; if (m > TOL) { n++; if (ex.length < 12) ex.push([(k / 4) % w, Math.floor(k / 4 / w), m]); } }
    return JSON.stringify({ n, exact, total: w * h, sizes: [a.width, a.height, b.width, b.height], ex }); })()`;
  return JSON.parse(await decoder.eval(code));
}
