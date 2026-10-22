// Reproducible 200-component / 1,200-cell corpus. All source files are created only in caller's temp folder.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
