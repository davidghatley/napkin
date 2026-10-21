// The independent oracle for HTML paste: write nodes into a component through the real store, render the file with real React on the
// server (esbuild + react-dom/server), and return the markup of the pasted part.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';
import { openStore } from '../../src/store.js';
import { ROOT } from './harness.js';
import { tsx } from './lab.js';

const PROBE = tsx('Probe', { id: 'box', tag: 'div', style: { display: 'block' } });
export async function renderPasted(trees) {
  const d = mkdtempSync(join(tmpdir(), 'napkin-ssr-'));
  const file = join(d, 'Probe.tsx');
  writeFileSync(file, PROBE);
  const store = await openStore(file);
  try {
    let { revision } = await store.read();
    for (const tree of trees) {
      const r = await store.apply({ baseRevision: revision, by: 'ssr', edits: [{ op: 'paste', parent: 'box', tree }] });
      if (!r.ok) return { ok: false, error: r.error };
      revision = r.revision;
    }
  } finally { await store.close(); }
  const res = await esbuild.build({ stdin: { contents: `import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {Probe} from './Probe.tsx'; export default renderToStaticMarkup(createElement(Probe));`, resolveDir: d, loader: 'js' }, bundle: true, write: false, format: 'cjs', platform: 'node', nodePaths: [join(ROOT, 'node_modules')], logLevel: 'silent', jsx: 'automatic' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(m, m.exports, createRequire(import.meta.url));
  const markup = m.exports.default;
  return { ok: true, markup, inner: markup.replace(/^(<link[^>]*>)+/, '').replace(/^<div[^>]*>/, '').replace(/<\/div>$/, ''), source: readFileSync(file, 'utf8') };
}
