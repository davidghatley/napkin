// Rebuilds the vendored runtimes from their pinned upstream releases (see public/canvas/RUNTIMES.md).
//   node tools/build-runtimes.mjs
// Needs network once: `npm pack` fetches the pinned tarballs into a temporary folder; nothing is added to node_modules.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '..'),
  tmp = mkdtempSync(join(tmpdir(), 'napkin-runtimes-')),
  PINS = { three: '0.170.0', 'lottie-web': '5.13.0', hyparquet: '1.33.0' };
try {
  for (const [name, version] of Object.entries(PINS)) {
    execFileSync('npm', ['pack', `${name}@${version}`, '--silent'], { cwd: tmp });
    const dir = join(tmp, name);
    mkdirSync(dir);
    execFileSync('tar', ['xzf', join(tmp, `${name}-${version}.tgz`), '-C', dir]);
  }
  const three = join(tmp, 'three/package');
  await build({
    entryPoints: [join(root, 'tools/model-runtime/entry.js')],
    outfile: join(root, 'public/canvas/model-runtime.js'),
    bundle: true, minify: true, format: 'esm', target: 'chrome120', legalComments: 'none',
    alias: { three: join(three, 'build/three.module.js'), 'three/examples/jsm': join(three, 'examples/jsm') },
    banner: { js: '/* three.js r170 (MIT) + napkin 3D runtime. Built by tools/build-runtimes.mjs. */' },
  });
  cpSync(join(tmp, 'three/package/LICENSE'), join(root, 'public/canvas/model-runtime.LICENSE'));
  cpSync(join(tmp, 'lottie-web/package/build/player/lottie.min.js'), join(root, 'public/canvas/lottie-runtime.js'));
  cpSync(join(tmp, 'hyparquet/package/src'), join(root, 'src/vendor/hyparquet'), { recursive: true });
  rmSync(join(root, 'src/vendor/hyparquet/node.js'), { force: true });
  rmSync(join(root, 'src/vendor/hyparquet/types.d.ts'), { force: true });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
