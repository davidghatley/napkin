// Run from the checkout: node tools/sample-repo.js ./sample-40
// Make a named, disposable S1 workspace. Refuse any nonempty destination.
import { existsSync, readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createComponent, createProjectConfig } from '../src/commit.js';
import { newComponentSource } from '../src/tsx/write.js';
import { tsxCodec } from '../src/codecs.js';
import { applyEdits } from '../src/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['Badge', 'Alert', 'Avatar', 'Banner', 'Breadcrumb', 'Callout', 'Caption', 'Checkbox', 'CodeBlock', 'Divider', 'EmptyState', 'Field', 'Footer', 'Header', 'Hero', 'IconButton', 'Input', 'Label', 'Link', 'ListItem', 'Menu', 'Modal', 'Notice', 'Pagination', 'Panel', 'Popover', 'Progress', 'Radio', 'Search', 'Sidebar', 'Skeleton', 'Stat', 'Switch', 'Tab', 'Tag', 'Toast', 'Tooltip'];

try {
  if (process.argv.length !== 3) throw new Error('Usage: node tools/sample-repo.js <empty-folder>');
  const dir = resolve(process.argv[2]);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error('Destination must be empty; choose a new folder.');
  mkdirSync(join(dir, 'components'), { recursive: true });
  for (const name of ['Button', 'Card', 'Chip']) createComponent(join(dir, 'components', `${name}.tsx`), readFileSync(join(root, 'fixtures', name, `${name}.tsx`), 'utf8'));
  for (const [i, name] of names.entries()) {
    const { doc, state } = tsxCodec.load(newComponentSource(name, 'div'));
    const compact = ['Badge', 'Tag', 'Label', 'Caption'].includes(name);
    const next = applyEdits(doc, [
      { op: 'addProp', name: 'label', type: 'string', default: name.replace(/([a-z])([A-Z])/g, '$1 $2') },
      { op: 'addProp', name: 'tone', type: 'enum', options: ['neutral', 'accent'], default: 'neutral' },
      { op: 'set', path: 'root.padding', value: compact ? '4px 10px' : 16 + (i % 3) * 4 },
      { op: 'set', path: 'root.borderRadius', value: compact ? 12 : 8 },
      { op: 'set', path: 'root.background', value: '#f1f5f9' },
      { op: 'set', path: 'root.color', value: '#1e293b' },
      { op: 'set', path: 'root.fontFamily', value: 'system-ui, sans-serif' },
      { op: 'set', path: 'root.width', value: compact ? 'auto' : 220 + (i % 4) * 20 },
      { op: 'set', path: 'root.background', value: '#dbeafe', variant: { tone: 'accent' } },
      { op: 'insert', parent: 'root', node: { id: 'label', tag: 'span', style: { fontSize: compact ? 12 : 15, fontWeight: 600 }, textProp: 'label' } },
    ]);
    createComponent(join(dir, 'components', `${name}.tsx`), tsxCodec.save(state, doc, next).text);
  }
  createProjectConfig(join(dir, 'napkin.json'), JSON.stringify({ components: 'components' }, null, 2) + '\n');
  createProjectConfig(join(dir, '.gitignore'), '.napkin/\n');
  execFileSync('git', ['init', '-q', dir]);
  console.log(`Created 40 editable components in ${process.argv[2]} (git initialized; no commits).`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
