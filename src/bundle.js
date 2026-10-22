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
const entry = (file, name, displayFile = file) => `
import { createElement, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
let M = {}, moduleError;
try { M = await import(${JSON.stringify(file)}); } catch (error) { moduleError = error; }
const usable = (x) => typeof x === 'function' || (x && typeof x === 'object' && x.$$typeof);
const C = [M[${JSON.stringify(name)}], M.default, ...Object.values(M)].find(usable);
const loadFailure = moduleError
  ? ${JSON.stringify(displayFile)} + ': module failed: ' + moduleError.message + '. Next: fix the module initialization or provide its required context, then reload.'
  : !C ? 'no component exported from ' + ${JSON.stringify(displayFile)} + '. Next: export a named or default React component.' : null;
class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? createElement('div', { className: 'error', role: 'alert', style: { maxWidth: 420, padding: 16, whiteSpace: 'normal' } }, ${JSON.stringify(displayFile)} + ': render failed: ' + this.state.error.message + '. Next: provide the required props or context in this component, then reload.') : this.props.children; }
}
export function mount(el, props = {}) {
  if (loadFailure) {
    const error = document.createElement('div'); error.className = 'error'; error.setAttribute('role', 'alert');
    error.style.cssText = 'max-width:420px;padding:16px;white-space:normal'; error.textContent = loadFailure; el.append(error);
    return () => error.remove();
  }
  const root = createRoot(el);
  flushSync(() => root.render(createElement(Boundary, null, createElement(C, props))));
  return () => root.unmount();
}
`;

const formatError = async (e) => {
  if (!e.errors?.length) return String(e.message);
  return (await esbuild.formatMessages(e.errors, { kind: 'error', color: false })).join('\n').trimEnd();
};

export function createBundler() {
  const contexts = new Map();
  // `shared`: React stays an import ('react', 'react-dom/client', ...) that the canvas page maps to ONE copy (src/vendor.js), so a component
  // is a small module and drawing it again after a change does not evaluate React again (CMP-06 < 100 ms).
  const SHARED = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'];
  const options = (file, name, displayFile, shared = false) => ({
    absWorkingDir: dirname(file),
    stdin: { contents: entry(file, name, displayFile), resolveDir: dirname(file), loader: 'js', sourcefile: 'napkin-canvas-entry.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    jsx: 'automatic', loader: { '.tsx': 'tsx', '.ts': 'ts' },
    // React comes from this repo's node_modules, wherever the component folder lives.
    nodePaths: [join(ROOT, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent', minify: false,
    ...(shared && { external: SHARED }),
  });
  return {
    async build(file, name, displayFile = basename(file), { shared = false } = {}) {
      const t0 = performance.now();
      try {
        const key = shared ? `${file}#shared` : file;
        let ctx = contexts.get(key);
        if (!ctx) { ctx = await esbuild.context(options(file, name, displayFile, shared)); contexts.set(key, ctx); }
        const r = await ctx.rebuild();
        return { ok: true, code: r.outputFiles[0].text, ms: performance.now() - t0 };
      } catch (e) {
        return { ok: false, error: `${displayFile}: ${await formatError(e)}\nNext: fix the reported error, then reload.`, ms: performance.now() - t0 };
      }
    },
    // One-off bundle of `text` as if it were the content of `file` (a past revision, or the file at HEAD).
    async buildText(file, name, text) {
      const t0 = performance.now();
      try {
        const { stdin, ...rest } = options(file, name);
        const plugin = { name: 'napkin-text', setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => (a.path === file && (a.kind === 'import-statement' || a.kind === 'dynamic-import') ? { path: file, namespace: 'napkin-text' } : null));
          b.onLoad({ filter: /.*/, namespace: 'napkin-text' }, () => ({ contents: text, loader: 'tsx', resolveDir: dirname(file) }));
        } };
        const r = await esbuild.build({ ...rest, stdin, plugins: [plugin] });
        return { ok: true, code: r.outputFiles[0].text, ms: performance.now() - t0 };
      } catch (e) {
        return { ok: false, error: `${basename(file)}: ${await formatError(e)}\nNext: fix the reported error, then reload.`, ms: performance.now() - t0 };
      }
    },
    async dispose(file) { for (const key of [file, `${file}#shared`]) { const c = contexts.get(key); contexts.delete(key); await c?.dispose(); } },
    async close() { for (const f of [...contexts.keys()]) { const c = contexts.get(f); contexts.delete(f); await c?.dispose(); } },
  };
}
