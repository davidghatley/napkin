// A few components for the fuzz to use as instances (decision 0004): their documents, and the files to write next to a corpus so the
// imports resolve. Chip has text, number, true/false, a variant axis and a slot; Badge is small.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readComponent } from '../../src/tsx/read.js';
import { ROOT } from './harness.js';

const button = () => readFileSync(join(ROOT, 'test', 'fixtures', '0004', 'Button.tsx'), 'utf8');
export const SIBLING_SOURCES = {
  Chip: () => button().replace(/Button/g, 'Chip'),
  Badge: () => button().replace(/Button/g, 'Badge').replace("  disabled?: boolean;\n", '  hint?: string;\n  children?: ReactNode;\n').replace("import type { CSSProperties }", 'import type { CSSProperties, ReactNode }').replace(", disabled = false", ', hint, children'),
};
export const siblingDocs = () => Object.fromEntries(Object.entries(SIBLING_SOURCES).map(([n, f]) => [n, readComponent(f()).doc]));
export const writeSiblings = (dir) => { for (const [n, f] of Object.entries(SIBLING_SOURCES)) writeFileSync(join(dir, `${n}.tsx`), f()); };
