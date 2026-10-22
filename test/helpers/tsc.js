// Runs `tsc --strict --noEmit` over a folder of components (and any extra files) with this repo's pinned typescript and
// @types/react. Returns { ok, output }. The folder can be anywhere: the type packages are mapped by path.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './harness.js';

export function typecheck(files) {
  const dir = mkdtempSync(join(tmpdir(), 'napkin-tsc-'));
  const types = (p) => join(ROOT, 'node_modules', '@types', p);
  const tsconfig = {
    compilerOptions: {
      strict: true, noEmit: true, jsx: 'react-jsx', target: 'es2022', module: 'esnext', moduleResolution: 'bundler',
      skipLibCheck: true, types: [],
      paths: { react: [types('react')], 'react/*': [types('react') + '/*'], 'react-dom/*': [types('react-dom') + '/*'], 'react-dom': [types('react-dom')] },
    },
    files,
  };
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  try {
    const output = execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (e) { return { ok: false, output: String(e.stdout || '') + String(e.stderr || '') }; }
}
