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
import { createElement, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
let M = {}, moduleError;
try { M = await import(${JSON.stringify(file)}); } catch (error) { moduleError = error; }
const usable = (x) => typeof x === 'function' || (x && typeof x === 'object' && x.$$typeof);
const C = [M[${JSON.stringify(name)}], M.default, ...Object.values(M)].find(usable);
const loadFailure = moduleError
  ? ${JSON.stringify(file)} + ': module failed: ' + moduleError.message + '. Next: fix the module initialization or provide its required context, then reload.'
  : !C ? 'no component exported from ' + ${JSON.stringify(file)} + '. Next: export a named or default React component.' : null;
class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? createElement('div', { className: 'error', role: 'alert', style: { maxWidth: 420, padding: 16, whiteSpace: 'normal' } }, ${JSON.stringify(file)} + ': render failed: ' + this.state.error.message + '. Next: provide the required props or context in this component, then reload.') : this.props.children; }
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
        return { ok: false, error: `${file}: ${formatError(e)}. Next: fix the named import, CSS or syntax in this file, then reload.`, ms: performance.now() - t0 };
      }
    },
    async dispose(file) { const c = contexts.get(file); contexts.delete(file); await c?.dispose(); },
    async close() { for (const f of [...contexts.keys()]) await this.dispose(f); },
  };
}
