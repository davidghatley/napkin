// Deterministic TSX corpora. Generated source belongs in a throwaway folder, never the repo.
//   generateCorpus(size, dir): varied specimens with 1-3 variant axes (engine benches, PRF/REL).
//   corpus(dir, count, { tokens }): 200 copies of fixtures/Button, 1,200 cells, optionally token-bound (bench/tokens.js).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, readdirSync, statSync, rmSync, renameSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function generateCorpus(size = 40, dir) {
  if (!Number.isInteger(size) || size < 1) throw new Error('size must be a positive integer');
  dir ??= mkdtempSync(join(tmpdir(), 'napkin-corpus-'));
  mkdirSync(dir, { recursive: true });
  const files = []; let cells = 0;
  for (let i = 0; i < size; i++) {
    const name = `Specimen${String(i).padStart(3, '0')}`;
    const axes = [
      [['size', ['md', 'sm', 'lg']]],
      [['size', ['md', 'sm', 'lg']], ['tone', ['plain', 'bright']]],
      [['size', ['md', 'sm']], ['tone', ['plain', 'bright']], ['density', ['normal', 'dense']]],
    ][i % 3];
    cells += axes.reduce((n, [, values]) => n * values.length, 1);
    const count = 3 + i % 10;
    const ids = ['root', 'label', ...Array.from({ length: count - 2 }, (_, j) => `item${j}`)];
    const style = (obj) => '{\n' + Object.entries(obj).map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`).join('\n') + '\n  }';
    const styles = ids.map((id, j) => `  ${id}: ${style(j === 0 ? { display: 'flex', flexDirection: i % 2 ? 'column' : 'row', gap: 4 + i % 5, padding: '8px', borderRadius: i % 9, background: ['#dce8f8', '#fae4cc', '#dcf1e5'][i % 3], color: '#18212f', fontSize: 12 + i % 5 } : { fontWeight: j === 1 ? 600 : 400, padding: '1px' })},`).join('\n');
    const variants = axes.map(([axis, values], a) => `  ${axis}: {\n${values.slice(1).map((v, j) => `    ${v}: { root: ${style(a === 0 ? { padding: `${4 + j * 8}px` } : a === 1 ? { background: '#e4ddfb' } : { gap: 2 })} },`).join('\n')}\n  },`).join('\n');
    const rootTag = ['div', 'article', 'section'][i % 3];
    const children = ids.slice(1).map((id, j) => `      <${j % 2 ? 'span' : 'p'} data-n="${id}" style={s('${id}', v)}>${id === 'label' ? '{label}' : `Detail ${i}.${j}`}</${j % 2 ? 'span' : 'p'}>`).join('\n');
    const source = `import type { CSSProperties } from 'react';
export interface ${name}Props {
  label?: string;
  enabled?: boolean;
${axes.map(([axis, values]) => `  ${axis}?: ${values.map((v) => `'${v}'`).join(' | ')};`).join('\n')}
}
const base: Record<string, CSSProperties> = {
${styles}
};
const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
${variants}
};
function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}
export function ${name}({ label = 'Specimen ${i}', enabled = true, ${axes.map(([a, values]) => `${a} = '${values[0]}'`).join(', ')} }: ${name}Props) {
  const v = { ${axes.map(([a]) => a).join(', ')} };
  return (
    <${rootTag} data-n="root" style={s('root', v)}>
${children}
    </${rootTag}>
  );
}
`;
    const file = join(dir, `${name}.tsx`);
    writeFileSync(file, source); files.push(file);
  }
  return { dir, files, size, cells };
}
// Reproducible 200-component / 1,200-cell Button corpus. All source files are created only in the caller's temp folder.
const root = fileURLToPath(new URL('../', import.meta.url));
export function corpus(dir, count = 200, { tokens = false } = {}) {
  const components = join(dir, 'components'); mkdirSync(components, { recursive: true });
  let source = readFileSync(join(root, 'fixtures/Button/Button.tsx'), 'utf8');
  if (tokens) {
    source = source.replaceAll("background: '#2236b0'", "background: 'var(--accent)'").replaceAll("background: '#16181d'", "background: 'var(--accent)'").replace("color: '#f9f9f5'", "color: 'var(--on-accent)'").replace("padding: '8px 16px'", "padding: 'var(--space-4)'").replace('borderRadius: 6', "borderRadius: 'var(--radius-medium)'");
    cpSync(join(root, 'fixtures/tokens'), join(dir, 'tokens'), { recursive: true });
    writeFileSync(join(dir, 'napkin.json'), '{"tokens":{"source":"tokens/tokens.json","css":"tokens/tokens.css"}}\n');
  }
  for (let i = 0; i < count; i++) { const name = `Button${String(i).padStart(3, '0')}`; writeFileSync(join(components, name + '.tsx'), source.replaceAll('Button', name)); }
  return components;
}

// ---------------------------------------------------------------------------------------------------------------
// P0 corpus (LOCKED, DREAM 2: D1, D2, D4). Assembles copies into a fresh folder under /tmp/claude-1000 and never
// writes into another repo: sources are read with `git archive <pinned commit>` (the committed bytes, not a working
// tree that may be dirty), so every run measures the same files. --latest uses each source repo's HEAD instead.
//   ss-ds    secret-sauce ds/project + tokens.css + components.css at its root (the previews rely on these two
//            being applied: POST /api/styles { applied: ['tokens.css', 'components.css'] }).
//   recipes  secret-sauce recipes/*.html + what they link (../tokens.css, ../components.css, and the fonts tokens.css names).
//   edge     bench/corpus/edge (hand-written, committed here) + one local web font copied from secret-sauce (OFL).
//   tsx      sample-40 made by tools/sample-repo.js as it was at the pinned napkin commit.
//   shadcn   playdough app/src/components (+ tsconfig.json for the @/ alias); node_modules is a symlink to
//            playdough's own (read only), so both napkin and the reference resolve the same packages.
// Writes <dir>/manifest.json (outside the five folders) with the commit and a content hash for each folder.
export const P0_SOURCES = {
  'secret-sauce': { repo: join(process.env.HOME || '', 'Projects/secret-sauce'), commit: 'f12f59e58a50c6f4b8c9a55731963d8c0acae754' },
  playdough: { repo: join(process.env.HOME || '', 'Projects/playdough'), commit: '68c1dad5f04962a4ae04369d4d8bc01344dd37f2' },
  napkin: { repo: root, commit: '3181316d8a9725bbf74e69dcdaf14bc79518ba84' },
};
// What each folder must show as components, and which of its stylesheets the bench applies (the "ask once" answer).
export const P0_FOLDERS = {
  'ss-ds': { applied: ['tokens.css', 'components.css'], expect: (f) => /^components\/[^/]+\/preview\.html$/.test(f), count: 22 }, // DREAM.md says 23; the pinned commit has 22 preview.html files (bundle.css is the 23rd file in components/)
  recipes: { applied: [], expect: (f) => /^recipes\/[^/]+\.html$/.test(f), count: 4 },
  edge: { applied: [], expect: (f) => /^[^/]+\.html$/.test(f), count: 10 },
  tsx: { applied: [], expect: (f) => /^components\/[^/]+\.tsx$/.test(f), count: 40 },
  shadcn: { applied: [], expect: (f) => /^src\/components\/.+\.tsx$/.test(f), count: 6 },
};
const RECIPE_FONTS = ['Stem7-Regular.woff2', 'Stem7-Bold.woff2', 'Stem7-Grid.woff2', 'Hoop-Regular.woff2', 'Hoop-Bold.woff2', 'Spire-Regular.woff2', 'OFL.txt'];

function gitOut(repo, ...args) { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim(); }
// Extract `paths` of repo@commit into dest (tar from git archive; nothing is written to the repo).
function extract(repo, commit, paths, dest, strip = 0) {
  mkdirSync(dest, { recursive: true });
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', commit, '--', ...paths], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', dest, ...(strip ? [`--strip-components=${strip}`] : [])], { input: tar });
}
function folderHash(dir) {
  const h = createHash('sha256'); let n = 0;
  const walk = (d, rel) => { for (const name of readdirSync(d).sort()) { if (name === '.git' || name === 'node_modules') continue; const p = join(d, name); if (statSync(p).isDirectory()) walk(p, rel + name + '/'); else { h.update(rel + name + '\0').update(readFileSync(p)); n++; } } };
  walk(dir, ''); return { files: n, sha256: h.digest('hex') };
}

export function assembleCorpus(opts = {}) {
  const scratch = process.env.NAPKIN_P0_TMP || '/tmp/claude-1000';
  mkdirSync(scratch, { recursive: true });
  const made = opts.out ? null : mkdtempSync(join(scratch, 'napkin-p0-corpus-'));
  try { return assemble({ ...opts, out: opts.out || made }); }
  catch (e) { if (made) rmSync(made, { recursive: true, force: true }); throw e; }
}
function assemble({ out, latest = false }) {
  const scratch = process.env.NAPKIN_P0_TMP || '/tmp/claude-1000';
  mkdirSync(scratch, { recursive: true });
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true }); if (readdirSync(dir).length) throw new Error(`${dir} is not empty; give an empty or new folder`);
  const used = {};
  for (const [name, s] of Object.entries(P0_SOURCES)) {
    if (!existsSync(join(s.repo, '.git'))) throw new Error(`source repo ${name} not found at ${s.repo}`);
    const commit = latest ? gitOut(s.repo, 'rev-parse', 'HEAD') : s.commit;
    try { gitOut(s.repo, 'cat-file', '-e', commit + '^{commit}'); } catch { throw new Error(`${name}: commit ${commit} is not in ${s.repo}`); }
    used[name] = { repo: s.repo.replace(process.env.HOME || '\0', '~'), commit };
  }
  const ss = P0_SOURCES['secret-sauce'].repo, ssc = used['secret-sauce'].commit;

  // ss-ds
  extract(ss, ssc, ['ds/project'], join(dir, 'ss-ds'), 2);
  extract(ss, ssc, ['tokens.css', 'components.css'], join(dir, 'ss-ds'));
  // recipes
  extract(ss, ssc, ['recipes', 'tokens.css', 'components.css', ...RECIPE_FONTS.map((f) => `fonts/${f}`)], join(dir, 'recipes'));
  for (const f of readdirSync(join(dir, 'recipes/recipes'))) if (!f.endsWith('.html')) rmSync(join(dir, 'recipes/recipes', f), { recursive: true, force: true });
  // edge
  cpSync(join(root, 'bench/corpus/edge'), join(dir, 'edge'), { recursive: true });
  extract(ss, ssc, ['fonts/Hoop-Bold.woff2', 'fonts/OFL.txt'], join(dir, 'edge'));
  renameSync(join(dir, 'edge/fonts/Hoop-Bold.woff2'), join(dir, 'edge/fonts/edge-sans.woff2'));
  // tsx: tools/sample-repo.js as it was at the pinned napkin commit, run from a throwaway checkout of that commit
  const nk = mkdtempSync(join(scratch, 'napkin-p0-pin-'));
  try {
    extract(root, used.napkin.commit, ['tools', 'src', 'fixtures', 'package.json'], nk);
    symlinkSync(join(root, 'node_modules'), join(nk, 'node_modules'));
    execFileSync(process.execPath, [join(nk, 'tools/sample-repo.js'), join(dir, 'tsx')], { cwd: nk, stdio: 'pipe' });
  } finally { rmSync(nk, { recursive: true, force: true }); }
  rmSync(join(dir, 'tsx/.git'), { recursive: true, force: true }); // sample-repo runs git init; imposed.js makes its own repo
  // shadcn
  const pd = P0_SOURCES.playdough.repo;
  extract(pd, used.playdough.commit, ['app/src/components', 'app/tsconfig.json'], join(dir, 'shadcn'), 1);
  if (existsSync(join(pd, 'app/node_modules'))) symlinkSync(join(pd, 'app/node_modules'), join(dir, 'shadcn/node_modules'));

  const folders = {};
  for (const [name, f] of Object.entries(P0_FOLDERS)) {
    const files = listFiles(join(dir, name)).filter(f.expect);
    if (files.length !== f.count) throw new Error(`${name}: expected ${f.count} component files, found ${files.length}`);
    folders[name] = { ...folderHash(join(dir, name)), applied: f.applied, components: files };
  }
  const manifest = { dir, made: new Date().toISOString(), pinned: !latest, sources: used, folders };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
function listFiles(d, rel = '') {
  const out = [];
  for (const name of readdirSync(d).sort()) { if (name === '.git' || name === 'node_modules') continue; const p = join(d, name); if (statSync(p).isDirectory()) out.push(...listFiles(p, rel + name + '/')); else out.push(rel + name); }
  return out;
}

// CLI. `--size N` keeps the old generated TSX corpus (perf/soak benches); without --size it assembles the P0 corpus.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { size: { type: 'string' }, out: { type: 'string' }, latest: { type: 'boolean' } } });
  if (values.size !== undefined) console.log(JSON.stringify(generateCorpus(Number(values.size), values.out), null, 2));
  else {
    try { const m = assembleCorpus({ out: values.out, latest: values.latest }); console.log(JSON.stringify(m, null, 2)); console.log(`P0 corpus: ${m.dir}`); }
    catch (e) { console.error(`corpus: ${e.message}`); process.exitCode = 2; }
  }
}
