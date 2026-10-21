// Explicit network evidence command; not part of npm test. No dependencies are installed
// in the target repo, and classification never bundles or writes there.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { scanRepository, componentFiles, formatReport } from '../src/scan.js';

const COMMIT = 'ba1503c64472b82256d9de95e2e62c5901a38e8b';
const SCOPE = 'apps/v4/registry/new-york-v4/ui';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'napkin-shadcn-')), dir = join(temp, 'ui');
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  // Fetch the exact pinned commit at depth one, even after upstream HEAD advances.
  mkdirSync(dir); git('init', '-q'); git('remote', 'add', 'origin', 'https://github.com/shadcn-ui/ui.git');
  git('config', 'core.sparseCheckout', 'true');
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  writeFileSync(join(dir, '.git/info/sparse-checkout'), `/${SCOPE}/\n`);
  git('fetch', '--depth=1', '--filter=blob:none', 'origin', COMMIT);
  git('checkout', '--detach', 'FETCH_HEAD');
  const scope = join(dir, SCOPE);
  const hash = () => Object.fromEntries(componentFiles(scope).map((f) => [f.slice(scope.length + 1), createHash('sha256').update(readFileSync(f)).digest('hex')]));
  const before = hash(), rows = scanRepository(scope), after = hash();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('classification changed the source files');
  const count = rows.filter((r) => r.editable).length, reasons = new Map();
  for (const r of rows.filter((r) => !r.editable)) {
    const reason = r.reason.replace(/^.*?line \d+:\s*/, '').replace(/^line \d+:\s*/, '').split('Next:')[0].replace(/\s*\[[^\]]+\]\s*$/, '').trim().replace(/\.$/, '');
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  const output = [
    'OPN-04 — shadcn/ui dialect coverage',
    'Re-run: node tools/shadcn-report.js',
    'Source: https://github.com/shadcn-ui/ui', `Pinned commit: ${COMMIT}`,
    `Scope: ${SCOPE} (canonical new-york-v4 UI TSX files; excludes examples, styles copies and docs)`,
    `Editable: ${count}/${rows.length} (${(100 * count / rows.length).toFixed(2)}%)`,
    `Read-only: ${rows.length - count}/${rows.length}`, 'Unclassified: 0',
    `TSX SHA-256 checks unchanged: ${rows.length}/${rows.length}`, 'Repository status after scan: ' + (git('status', '--porcelain').trim() || 'clean'),
    'This measures the current dialect, not whether shadcn can render after installing its dependencies.',
    'Reasons below are the FIRST refusal per file; they are not a full census of unsupported constructs.',
    '', 'Top refusal reasons:', ...[...reasons].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${n}: ${reason}`),
    '', formatReport(rows), '', 'Source SHA-256:', ...Object.entries(before).map(([f, sha]) => `${sha}  ${f}`), '',
  ].join('\n');
  mkdirSync(join(ROOT, 'docs/evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/evidence/OPN-04.txt'), output); console.log(output.split('\n').slice(0, 20).join('\n'));
} finally { rmSync(temp, { recursive: true, force: true }); }
