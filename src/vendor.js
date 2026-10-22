// One copy of React for the canvas page (src/bundle.js `shared`). The page's import map points 'react', 'react/jsx-runtime',
// 'react-dom' and 'react-dom/client' at /vendor/<name>.js, each a small ES module built here once from this repo's node_modules.
// A component bundle then holds only the component, and React is evaluated once, not once per component per redraw.
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const SPECS = { react: 'react', 'react-jsx-runtime': 'react/jsx-runtime', 'react-dom': 'react-dom', 'react-dom-client': 'react-dom/client' };
const cache = new Map();

export function vendorModule(name) {
  const spec = SPECS[name];
  if (!spec) return Promise.reject(new Error(`no vendor module "${name}"`));
  if (!cache.has(name)) {
    const names = Object.keys(require(spec)).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
    const file = JSON.stringify(require.resolve(spec)); // by path: the bare names 'react' and 'react/...' are the ones left external below
    const contents = `export { ${names.join(', ')} } from ${file}; import d from ${file}; export default d;`;
    cache.set(name, esbuild.build({
      stdin: { contents, resolveDir: ROOT, loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
      // react-dom's `require('react')` (and react-dom/client's `require('react-dom')`) must reach the page's one copy: each becomes an ES import of the bare name (the import map)
      plugins: spec === 'react' ? [] : [{ name: 'shared-react', setup(b) {
        for (const pkg of spec === 'react-dom/client' ? ['react', 'react-dom'] : ['react']) {
          b.onResolve({ filter: new RegExp(`^${pkg}$`) }, (a) => (a.namespace === `ext-${pkg}` ? { path: pkg, external: true } : { path: pkg, namespace: `ext-${pkg}` }));
          b.onLoad({ filter: /.*/, namespace: `ext-${pkg}` }, () => ({ contents: `export * from "${pkg}";`, loader: 'js' }));
        }
      } }],
    }).then((r) => r.outputFiles[0].text));
  }
  return cache.get(name);
}
