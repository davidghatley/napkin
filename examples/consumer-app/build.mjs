// node examples/consumer-app/build.mjs [componentsDir] [outDir]
// Bundles App.tsx with esbuild; '@components' points at the folder napkin edits.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const components = resolve(process.argv[2] || join(root, 'fixtures', 'Button'));
const out = resolve(process.argv[3] || join(here, 'dist'));

export async function buildApp(componentsDir = components, outDir = out) {
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [join(here, 'App.tsx')], bundle: true, format: 'esm', jsx: 'automatic', minify: true,
    alias: { '@components': componentsDir }, nodePaths: [join(root, 'node_modules')],
    outfile: join(outDir, 'app.js'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
  });
  writeFileSync(join(outDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>consumer app</title><div id="app"></div><script type="module" src="app.js"></script>\n');
  return outDir;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log('built', await buildApp());
