// Real rendering (F04): esbuild's in-process API bundles a component .tsx together with a small
// canvas entry that mounts it with react-dom/client. One incremental esbuild context per file,
// so a rebuild after an edit only re-parses what changed.
//   const b = createBundler(); const { code, ms } = await b.build(file, name); await b.dispose(file);
// The bundle is an ES module: `export function mount(el, props) -> unmount`.
import * as esbuild from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The component is the export named like the file's component, else the default export, else the first function.
const entry = (file, name) => `
import * as M from ${JSON.stringify(file)};
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
const C = M[${JSON.stringify(name)}] ?? M.default ?? Object.values(M).find((x) => typeof x === 'function');
if (!C) throw new Error('no component exported from ' + ${JSON.stringify(basename(file))});
export function mount(el, props = {}) {
  const root = createRoot(el);
  flushSync(() => root.render(createElement(C, props)));
  return () => root.unmount();
}
`;

const formatError = (e) => {
  const m = e.errors?.[0];
  if (!m) return String(e.message);
  return m.location ? `${m.text} (${basename(m.location.file)}:${m.location.line})` : m.text;
};

export function createBundler() {
  const contexts = new Map();
  const options = (file, name) => ({
    stdin: { contents: entry(file, name), resolveDir: dirname(file), loader: 'js', sourcefile: 'napkin-canvas-entry.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' },
    // React comes from this repo's node_modules, wherever the component folder lives.
    nodePaths: [join(ROOT, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent', minify: false,
  });
  return {
    async build(file, name) {
      const t0 = performance.now();
      try {
        let ctx = contexts.get(file);
        if (!ctx) { ctx = await esbuild.context(options(file, name)); contexts.set(file, ctx); }
        const r = await ctx.rebuild();
        return { ok: true, code: r.outputFiles[0].text, ms: performance.now() - t0 };
      } catch (e) {
        return { ok: false, error: formatError(e), ms: performance.now() - t0 };
      }
    },
    async dispose(file) { const c = contexts.get(file); contexts.delete(file); await c?.dispose(); },
    async close() { for (const f of [...contexts.keys()]) await this.dispose(f); },
  };
}
