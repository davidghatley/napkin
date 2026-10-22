// Real rendering (F04): esbuild's in-process API bundles a component .tsx together with a small
// canvas entry that mounts it with react-dom/client. One incremental esbuild context per file,
// so a rebuild after an edit only re-parses what changed.
//   const b = createBundler(); const { code, ms } = await b.build(file, name); await b.dispose(file);
// The bundle is an ES module: `export function mount(el, props) -> unmount`.
import * as esbuild from 'esbuild';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JSXRuntime from 'react/jsx-runtime';
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

// The canvas page maps these bare names to one shared copy of React (public/index.html import map, GET /runtime.js),
// so forty components do not ship, parse and evaluate forty copies of it. Server-side renderers use standalone bundles.
export const SHARED = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'];
export const IMPORT_MAP = { imports: { react: '/runtime.js', 'react-dom': '/runtime.js?module=react-dom', 'react-dom/client': '/runtime.js?module=react-dom/client', 'react/jsx-runtime': '/runtime.js?module=react/jsx-runtime' } };

export function createBundler() {
  const contexts = new Map();
  const names = (mod) => Object.keys(mod).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
  const facades = { 'react-dom': ['ReactDOM', names(ReactDOM)], 'react-dom/client': ['ReactDOMClient', names(ReactDOMClient)], 'react/jsx-runtime': ['JSXRuntime', names(JSXRuntime)] };
  let runtime;
  const sharedRuntime = () => runtime ??= esbuild.build({
    stdin: { contents: `export { default, ${names(React).join(', ')} } from 'react'; export { default as ReactDOM } from 'react-dom'; export { default as ReactDOMClient } from 'react-dom/client'; export { default as JSXRuntime } from 'react/jsx-runtime'; `, resolveDir: ROOT },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  }).then((r) => ({ ok: true, code: r.outputFiles[0].text }));
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
    // The module GET /runtime.js serves: the whole React runtime once, or a thin facade for react-dom, react-dom/client, react/jsx-runtime.
    async runtime(module) {
      if (!module) return sharedRuntime();
      const facade = facades[module];
      if (!facade) return null;
      const [namespace, exports] = facade;
      return { ok: true, code: `import { ${namespace} as D } from '/runtime.js'; export default D; export const { ${exports.join(', ')} } = D;` };
    },
    // Incremental, for the canvas page: React is left external (see SHARED).
    async build(file, name, displayFile = basename(file)) {
      const t0 = performance.now();
      try {
        let ctx = contexts.get(file);
        if (!ctx) { ctx = await esbuild.context(options(file, name, displayFile, true)); contexts.set(file, ctx); }
        const r = await ctx.rebuild();
        return { ok: true, code: r.outputFiles[0].text, ms: performance.now() - t0 };
      } catch (e) {
        return { ok: false, error: `${displayFile}: ${await formatError(e)}\nNext: fix the reported error, then reload.`, ms: performance.now() - t0 };
      }
    },
    // One-off bundle of `text` as if it were the content of `file` (a past revision, or the file at HEAD).
    async buildText(file, name, text, { shared = false } = {}) {
      const t0 = performance.now();
      try {
        const { stdin, ...rest } = options(file, name, undefined, shared);
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
    // A one-off bundle with its own React, for programs that draw it outside the canvas page (render_component, visual diff).
    async buildStandalone(file, name, displayFile = basename(file)) {
      const t0 = performance.now();
      try {
        const r = await esbuild.build(options(file, name, displayFile));
        return { ok: true, code: r.outputFiles[0].text, ms: performance.now() - t0 };
      } catch (e) {
        return { ok: false, error: `${displayFile}: ${await formatError(e)}\nNext: fix the reported error, then reload.`, ms: performance.now() - t0 };
      }
    },
    async dispose(file) { const c = contexts.get(file); contexts.delete(file); await c?.dispose(); },
    async close() { for (const f of [...contexts.keys()]) await this.dispose(f); },
  };
}
