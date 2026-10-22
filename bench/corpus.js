// Deterministic TSX corpora. Generated source belongs in a throwaway folder, never the repo.
//   generateCorpus(size, dir): varied specimens with 1-3 variant axes (engine benches, PRF/REL).
//   corpus(dir, count, { tokens }): 200 copies of fixtures/Button, 1,200 cells, optionally token-bound (bench/tokens.js).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
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
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { size: { type: 'string', default: '40' }, out: { type: 'string' } } });
  console.log(JSON.stringify(generateCorpus(Number(values.size), values.out), null, 2));
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
