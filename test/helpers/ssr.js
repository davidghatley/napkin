// Renders a component file to HTML with react-dom/server, the way the screen would (siblings it imports are bundled in).
import * as esbuild from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './harness.js';

export async function renderHtml(file, name, props = {}) {
  const work = mkdtempSync(join(ROOT, 'node_modules', '.napkin-ssr-')); // inside the repo so `react` resolves
  try {
    const r = await esbuild.build({
      stdin: { contents: `import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { ${name} } from ${JSON.stringify(file)}; export default (props) => renderToStaticMarkup(createElement(${name}, props));`, resolveDir: ROOT, loader: 'js' },
      bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.tsx': 'tsx' }, packages: 'external', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    });
    writeFileSync(join(work, 'ssr.mjs'), r.outputFiles[0].text);
    return (await import(pathToFileURL(join(work, 'ssr.mjs')))).default(props);
  } finally { rmSync(work, { recursive: true, force: true }); }
}
