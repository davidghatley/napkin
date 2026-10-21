// Explicit network evidence command; not part of npm test. No dependencies are installed
// in the target repo, and classification never bundles or writes there.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { scanRepository, componentFiles, formatReport, classifySource } from '../src/scan.js';

const COMMIT = 'ba1503c64472b82256d9de95e2e62c5901a38e8b';
const SCOPE = 'apps/v4/registry/new-york-v4/ui';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A complete pinned archive gives a reproducible census without checking out or
// writing any TSX. Python's standard-library tar reader handles archive metadata.
if (process.argv[2] === '--archive') {
  const archive = resolve(process.argv[3]);
  const script = `import tarfile,json,sys
with tarfile.open(sys.argv[1]) as tar:
 files = [m for m in tar if m.isfile() and m.name.endswith('.tsx')]
 assert all(m.name.split('/')[0].endswith(sys.argv[2]) for m in files), 'wrong pinned archive'
 print(json.dumps([[m.name.split('/',1)[1],tar.extractfile(m).read().decode()] for m in files]))`;
  const sources = JSON.parse(execFileSync('python3', ['-c', script, archive, COMMIT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const before = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const rows = sources.map(([file, source]) => classifySource(source, file));
  const after = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (before !== after) throw new Error('Next: restore the changed source archive and rerun.');
  const output = [`OPN-04 — full shadcn/ui TSX census`, `Pinned commit: ${COMMIT}`,
    `Archive: https://codeload.github.com/shadcn-ui/ui/tar.gz/${COMMIT}`,
    'Re-run: node tools/shadcn-report.js --archive <downloaded .tar.gz>',
    `Archive SHA-256 unchanged: ${before}`, 'Source files written: 0', '', formatReport(rows), ''].join('\n');
  mkdirSync(join(ROOT, 'docs/evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/evidence/OPN-04-full.txt'), output);
  console.log(output.split('\n').slice(0, 22).join('\n'));
  process.exit(0);
}
const temp = process.env.SHADCN_REPO ? null : mkdtempSync(join(tmpdir(), 'napkin-shadcn-')), dir = process.env.SHADCN_REPO || join(temp, 'ui');
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  if (!process.env.SHADCN_REPO) {
  // Fetch the exact pinned commit at depth one, even after upstream HEAD advances.
  mkdirSync(dir); git('init', '-q'); git('remote', 'add', 'origin', 'https://github.com/shadcn-ui/ui.git');
  git('config', 'core.sparseCheckout', 'true');
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  writeFileSync(join(dir, '.git/info/sparse-checkout'), `/${SCOPE}/\n`);
  git('fetch', '--depth=1', '--filter=blob:none', 'origin', COMMIT);
  git('checkout', '--detach', 'FETCH_HEAD');
  }
  if (git('rev-parse', 'HEAD').trim() !== COMMIT) throw new Error('Next: use the pinned shadcn commit ' + COMMIT);
  const scope = join(dir, SCOPE);
  const hash = () => Object.fromEntries(componentFiles(scope).map((f) => [f.slice(scope.length + 1), createHash('sha256').update(readFileSync(f)).digest('hex')]));
  const before = hash(), rows = scanRepository(scope), after = hash();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('classification changed the source files');
  const count = rows.filter((r) => r.editable).length;
  const output = [
    'OPN-04 — shadcn/ui dialect coverage',
    'Re-run: node tools/shadcn-report.js',
    'Source: https://github.com/shadcn-ui/ui', `Pinned commit: ${COMMIT}`,
    `Scope: ${SCOPE} (canonical new-york-v4 UI TSX files; excludes examples, styles copies and docs)`,
    `Editable: ${count}/${rows.length} (${(100 * count / rows.length).toFixed(2)}%)`,
    `Read-only: ${rows.length - count}/${rows.length}`, 'Unclassified: 0',
    `TSX SHA-256 checks unchanged: ${rows.length}/${rows.length}`, 'Repository status after scan: ' + (git('status', '--porcelain').trim() || 'clean'),
    'This measures the current dialect, not whether shadcn can render after installing its dependencies.',
    'Every blocking construct is counted once per file below; each occurrence retains its real source line.',
    '', formatReport(rows), '', 'Source SHA-256:', ...Object.entries(before).map(([f, sha]) => `${sha}  ${f}`), '',
  ].join('\n');
  mkdirSync(join(ROOT, 'docs/evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/evidence/OPN-04.txt'), output); console.log(output.split('\n').slice(0, 20).join('\n'));
} finally { if (temp) rmSync(temp, { recursive: true, force: true }); }
