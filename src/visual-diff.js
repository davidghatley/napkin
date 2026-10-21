// INS-05: before and after images of every variant cell that changed, the working tree against HEAD.
// Cells whose document is identical are skipped without drawing; cells that differ are drawn both ways and kept only when
// the pixels differ. napkin only reads git (src/git.js).
import { variantGrid, resolveStyle, axes } from './model.js';
import { readComponent } from './tsx/read.js';
import { headSource } from './git.js';

const sig = (doc, variant) => JSON.stringify((function walk(n) {
  return [n.id, n.tag, resolveStyle(doc, n.id, variant), n.textProp ? doc.props.find((p) => p.name === n.textProp)?.default ?? null : n.text ?? null, n.attrs ?? null, n.children.map(walk)];
})(doc.root));
const keyOf = (v) => JSON.stringify(v);

export async function visualDiff(ws, renderer, e) {
  const snap = await e.store.read();
  if (!snap.doc) return { ok: false, error: `cannot compare a read-only file (${snap.readOnly}). Next: fix the file so napkin can edit it.` };
  const headText = headSource(e.file);
  let before = null, state = 'added';
  if (headText !== null) {
    try { before = readComponent(headText).doc; } catch (err) { return { ok: false, error: `the file at HEAD is outside the napkin dialect (${err.message}). Next: compare against a commit napkin can read.` }; }
    state = headText === snap.source ? 'clean' : 'modified';
  }
  if (state === 'clean') return { ok: true, state, cells: [], total: variantGrid(snap.doc).length, unchanged: variantGrid(snap.doc).length };

  const after = snap.doc;
  const cellsAfter = new Map(variantGrid(after).map((v) => [keyOf(v), v]));
  const cellsBefore = new Map(before ? variantGrid(before).map((v) => [keyOf(v), v]) : []);
  const bundleAfter = await ws.bundle(e);
  if (!bundleAfter?.ok) return { ok: false, error: `build failed: ${bundleAfter?.error}. Next: fix the build error shown on the frame.` };
  const bundleBefore = before ? await ws.bundleText(e, headText) : null;
  if (before && !bundleBefore.ok) return { ok: false, error: `the file at HEAD does not build: ${bundleBefore.error}. Next: compare against a commit that builds.` };

  const b64 = (r) => 'data:image/png;base64,' + r.png.toString('base64');
  const jobs = [];
  for (const key of new Set([...cellsAfter.keys(), ...cellsBefore.keys()])) {
    const va = cellsAfter.get(key), vb = cellsBefore.get(key);
    jobs.push((async () => {
      if (va && !vb) return { variant: va, status: 'added', after: b64(await renderer.renderCode(bundleAfter.code, va)) };
      if (vb && !va) return { variant: vb, status: 'removed', before: b64(await renderer.renderCode(bundleBefore.code, vb)) };
      if (sig(after, va) === sig(before, vb)) return null;
      const [b, a] = await Promise.all([renderer.renderCode(bundleBefore.code, vb), renderer.renderCode(bundleAfter.code, va)]);
      return b.png.equals(a.png) ? null : { variant: va, status: 'changed', before: b64(b), after: b64(a) };
    })());
  }
  const cells = (await Promise.all(jobs)).filter(Boolean);
  const total = new Set([...cellsAfter.keys(), ...cellsBefore.keys()]).size;
  return { ok: true, state, cells, total, unchanged: total - cells.length, axes: axes(after).map((a) => a.name) };
}
