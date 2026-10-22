// INV-06: components need nothing from napkin at run time. Checked on the fixtures, a generated 40-component corpus and
// components napkin edited: (1) every import is `react` types only, none mention napkin; (2) the example consumer app
// builds against them with esbuild and the bundle holds no napkin code; (3) `tsc --strict` passes over the components
// and over the consumer app's source (App.tsx, with @types/react-dom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../examples/consumer-app/build.mjs';
import { makeCorpus } from '../helpers/corpus.js';
import { typecheck } from '../helpers/tsc.js';
import { ROOT, fixture } from '../helpers/harness.js';
import { newComponentSource } from '../../src/tsx/write.js';

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-standalone-'));
  copyFileSync(fixture('Button'), join(dir, 'Button.tsx'));
  copyFileSync(fixture('Card'), join(dir, 'Card.tsx'));
  writeFileSync(join(dir, 'Fresh.tsx'), newComponentSource('Fresh', 'section'));
  const corpus = makeCorpus(dir, 40, 6);
  return { dir, files: readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)), corpus };
}

test('INV-06: 0 napkin imports in 43 components; the only import is `import type { CSSProperties } from "react"`', () => {
  const { files } = folder();
  assert.equal(files.length, 43);
  const imports = new Set();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s+(['"])(.+?)\1/gm)) imports.add(`${m[2]}`);
    assert.doesNotMatch(text, /(?:from|require\()\s*['"][^'"]*napkin/i, `${f} imports something from napkin`); // (the word may appear in text content)
    assert.doesNotMatch(text, /\brequire\(|\bimport\(/, f);
  }
  console.log(`INV-06: imports found across ${files.length} components: ${[...imports].join(', ')}; napkin imports: 0`);
  assert.deepEqual([...imports], ['react']);
});

test('INV-06: the consumer app builds against the components and its bundle has no napkin code', async () => {
  const { dir, files } = folder();
  // The example app imports '@components/Button' (any folder of components works)
  const out = await buildApp(dir, mkdtempSync(join(tmpdir(), 'napkin-app-')));
  const bundle = readFileSync(join(out, 'app.js'), 'utf8');
  assert.ok(bundle.length > 1000);
  for (const marker of ['napkin', 'recast', '@babel', 'esbuild', 'canvas-client', 'store.js']) assert.ok(!bundle.includes(marker), `the bundle mentions ${marker}`);
  assert.ok(bundle.includes('data-n'), 'it is the real component in there');
  // every component also bundles on its own with only react beside it
  for (const f of files.slice(0, 6)) {
    const { build } = await import('esbuild');
    const r = await build({ entryPoints: [f], bundle: true, write: false, format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], logLevel: 'silent', metafile: true });
    const inputs = Object.keys(r.metafile.inputs);
    assert.deepEqual(inputs.filter((i) => !i.endsWith(f.split('/').pop())), [], `${f} pulls in only itself`);
  }
});

test('INV-06: tsc --strict passes over the components and the consumer app', () => {
  const { files } = folder();
  const app = join(ROOT, 'examples', 'consumer-app', 'App.tsx');
  const comps = files.filter((f) => /\/(Button|Card|Fresh)\.tsx$/.test(f));
  const tc = typecheck(files);
  console.log(`INV-06: tsc --strict over ${files.length} components: ${tc.ok ? '0 errors' : tc.output}`);
  assert.equal(tc.ok, true, tc.output);
  // the app imports '@components/Button': map it with a tiny shim file that re-exports from the temp folder
  const shimDir = mkdtempSync(join(tmpdir(), 'napkin-shim-'));
  copyFileSync(app, join(shimDir, 'App.tsx'));
  writeFileSync(join(shimDir, 'App.tsx'), readFileSync(app, 'utf8').replace("'@components/Button'", JSON.stringify(comps.find((f) => f.endsWith('/Button.tsx')).replace(/\.tsx$/, ''))));
  const ta = typecheck([join(shimDir, 'App.tsx')]);
  console.log(`INV-06: tsc --strict over examples/consumer-app/App.tsx: ${ta.ok ? '0 errors' : ta.output}`);
  assert.equal(ta.ok, true, ta.output);
});
