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

// Explicit CSS keeps the showcase independent of the canvas's drawing defaults.
const text = (id, value, style = {}) => ({ id, tag: 'span', text: value, style: { fontSize: 14, lineHeight: '20px', ...style } });
const label = (style = {}) => ({ id: 'label', tag: 'span', textProp: 'label', style: { fontSize: 14, lineHeight: '20px', fontWeight: 600, ...style } });
const box = (id, style, children = []) => ({ id, tag: 'div', style, children });
const muted = { color: '#64748b', fontSize: 12, lineHeight: '18px' };
const row = { display: 'flex', alignItems: 'center', gap: 10 };
const surface = { width: 280, padding: 20, border: '1px solid #e2e8f0', background: '#ffffff', borderRadius: 12 };
const field = { width: 260, padding: '10px 14px', border: '1px solid #cbd5e1', background: '#ffffff', borderRadius: 8 };
const dot = (id, style = {}) => box(id, { width: 8, height: 8, borderRadius: 999, background: '#16a34a', flexShrink: 0, ...style });
const specs = {
  Badge: [{ padding: '4px 10px', borderRadius: 999, background: '#dcfce7', color: '#166534' }, [dot('status'), label({ fontSize: 12, lineHeight: '16px' })], 'Published'],
  Alert: [{ ...surface, background: '#fffbeb', border: '1px solid #fde68a' }, [text('icon', '!', { color: '#92400e', fontWeight: 700 }), box('message', {}, [label(), text('detail', 'Your trial ends in 3 days.', muted)])], 'Trial ending soon'],
  Avatar: [{ width: 48, height: 48, padding: 0, borderRadius: 999, justifyContent: 'center', background: '#e0e7ff', color: '#4338ca' }, [label({ fontSize: 16 })], 'JD'],
  Banner: [{ width: 380, padding: '12px 20px', background: '#1e293b', color: '#ffffff', borderRadius: 8, justifyContent: 'space-between' }, [label(), text('action', 'See what’s new →', { fontSize: 12, color: '#bfdbfe' })], 'A new release is here'],
  Breadcrumb: [{ padding: 0, background: 'transparent', gap: 8 }, [text('parent', 'Workspace', muted), text('separator', '/', muted), label()], 'Projects'],
  Callout: [{ ...surface, flexDirection: 'column', alignItems: 'flex-start', background: '#eff6ff', border: '1px solid #bfdbfe' }, [label(), text('detail', 'Invite your team to edit together.', muted)], 'Better together'],
  Caption: [{ padding: 0, background: 'transparent' }, [label({ ...muted, fontWeight: 400 })], 'Last updated a few minutes ago'],
  Checkbox: [{ padding: 0, background: 'transparent' }, [box('control', { ...row, width: 18, height: 18, borderRadius: 4, background: '#2563eb', justifyContent: 'center', color: '#ffffff' }, [text('check', '✓', { fontSize: 12, lineHeight: '16px' })]), label({ fontWeight: 400 })], 'Email me product updates'],
  CodeBlock: [{ ...surface, width: 320, flexDirection: 'column', alignItems: 'flex-start', background: '#0f172a', color: '#e2e8f0', fontFamily: 'ui-monospace, monospace' }, [label({ fontSize: 12, color: '#94a3b8' }), text('code', 'const ready = true;', { color: '#93c5fd', fontFamily: 'inherit' })], 'TypeScript'],
  Divider: [{ width: 280, padding: '8px 0', background: 'transparent' }, [box('before', { height: 1, flexGrow: 1, background: '#e2e8f0' }), label({ ...muted, fontWeight: 400 }), box('after', { height: 1, flexGrow: 1, background: '#e2e8f0' })], 'or continue with'],
  EmptyState: [{ ...surface, flexDirection: 'column', textAlign: 'center', padding: '32px 24px' }, [text('icon', '◇', { fontSize: 28, lineHeight: '36px', color: '#94a3b8' }), label(), text('detail', 'Create a project to get started.', muted)], 'No projects yet'],
  Field: [{ width: 260, padding: 0, flexDirection: 'column', alignItems: 'stretch', background: 'transparent', gap: 6 }, [label({ fontSize: 12 }), box('input', { ...field, boxSizing: 'border-box' }, [text('value', 'alex@example.com')]), text('help', 'We’ll only send essential updates.', muted)], 'Email address'],
  Footer: [{ width: 380, padding: '16px 0', background: 'transparent', borderTop: '1px solid #e2e8f0', justifyContent: 'space-between' }, [label({ ...muted, fontWeight: 400 }), text('links', 'Privacy · Terms', muted)], '© 2026 Studio'],
  Header: [{ width: 380, padding: '16px 20px', background: '#ffffff', borderBottom: '1px solid #e2e8f0', borderRadius: 0, justifyContent: 'space-between' }, [label({ fontSize: 18, lineHeight: '24px' }), text('nav', 'Projects   Team   Settings', muted)], 'Studio'],
  Hero: [{ ...surface, width: 380, padding: 32, flexDirection: 'column', alignItems: 'flex-start', background: '#eff6ff' }, [text('eyebrow', 'INTRODUCING STUDIO', { ...muted, fontWeight: 600 }), label({ fontSize: 28, lineHeight: '34px' }), text('detail', 'A calmer place for your next big idea.', { color: '#475569' })], 'Make room for great work.'],
  IconButton: [{ width: 36, height: 36, padding: 0, justifyContent: 'center', border: '1px solid #cbd5e1', background: '#ffffff' }, [label({ fontSize: 20, lineHeight: '24px' })], '+'],
  Input: [field, [label({ color: '#94a3b8', fontWeight: 400 })], 'Enter your name'],
  Label: [{ padding: 0, background: 'transparent' }, [label({ fontSize: 12, lineHeight: '18px' })], 'Project name'],
  Link: [{ padding: 0, background: 'transparent', color: '#2563eb' }, [label({ textDecoration: 'underline', fontWeight: 500 })], 'View documentation →'],
  ListItem: [{ ...field, width: 300, justifyContent: 'space-between' }, [box('copy', {}, [label(), text('detail', 'Updated 2 hours ago', muted)]), text('arrow', '›', { color: '#94a3b8', fontSize: 20 })], 'Website redesign'],
  Menu: [{ ...surface, width: 220, padding: 6, flexDirection: 'column', alignItems: 'stretch', gap: 2 }, [box('active', { padding: '8px 10px', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8' }, [label()]), text('duplicate', 'Duplicate', { padding: '8px 10px' }), text('archive', 'Archive', { padding: '8px 10px', color: '#64748b' })], 'Edit project'],
  Modal: [{ ...surface, width: 320, padding: 24, flexDirection: 'column', alignItems: 'flex-start', gap: 16, boxShadow: '0 12px 32px #0f172a14' }, [label({ fontSize: 18, lineHeight: '24px' }), text('detail', 'Everyone on your team can access this project.', muted), box('confirm', { padding: '8px 14px', borderRadius: 6, background: '#2563eb', color: '#ffffff' }, [text('action', 'Create project', { fontWeight: 600 })])], 'Create a new project'],
  Notice: [{ ...field, width: 300, background: '#f0fdf4', border: '1px solid #bbf7d0' }, [dot('status'), label({ color: '#166534', fontWeight: 500 })], 'All changes saved'],
  Pagination: [{ padding: 0, background: 'transparent', gap: 6 }, [text('previous', '‹', { padding: '6px 10px', color: '#64748b' }), box('current', { padding: '6px 12px', background: '#2563eb', color: '#ffffff', borderRadius: 6 }, [label()]), text('nextPage', '2', { padding: '6px 12px' }), text('next', '›', { padding: '6px 10px', color: '#64748b' })], '1'],
  Panel: [{ ...surface, width: 300, flexDirection: 'column', alignItems: 'stretch', gap: 16 }, [label(), text('detail', 'Manage who can access this workspace.', muted), box('separator', { height: 1, background: '#e2e8f0' }), text('members', '12 members · Pro plan', { fontSize: 12 })], 'Workspace settings'],
  Popover: [{ ...surface, width: 240, flexDirection: 'column', alignItems: 'flex-start', boxShadow: '0 6px 20px #0f172a14' }, [label(), text('detail', 'Only invited teammates can view this project.', muted)], 'Private project'],
  Progress: [{ width: 260, padding: 0, flexDirection: 'column', alignItems: 'stretch', background: 'transparent', gap: 8 }, [box('heading', { ...row, justifyContent: 'space-between' }, [label({ fontSize: 12 }), text('percent', '65%', muted)]), box('track', { height: 6, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }, [box('fill', { width: '65%', height: '100%', borderRadius: 999, background: '#2563eb' })])], 'Uploading files'],
  Radio: [{ padding: 0, background: 'transparent' }, [box('control', { ...row, width: 18, height: 18, borderRadius: 999, border: '1px solid #2563eb', justifyContent: 'center', boxSizing: 'border-box' }, [dot('selected', { background: '#2563eb' })]), label({ fontWeight: 400 })], 'Monthly billing'],
  Search: [field, [text('icon', '⌕', { fontSize: 20, color: '#64748b' }), label({ fontWeight: 400, color: '#94a3b8' }), text('shortcut', '⌘K', muted)], 'Search projects…'],
  Sidebar: [{ ...surface, width: 220, padding: 12, flexDirection: 'column', alignItems: 'stretch', gap: 6 }, [label({ padding: '8px 10px', fontSize: 16 }), text('active', 'Overview', { padding: '8px 10px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 6 }), text('projects', 'Projects', { padding: '8px 10px', color: '#475569' }), text('team', 'Team members', { padding: '8px 10px', color: '#475569' })], 'Workspace'],
  Skeleton: [{ ...surface, width: 280, alignItems: 'flex-start' }, [box('avatar', { width: 36, height: 36, borderRadius: 999, background: '#e2e8f0' }), box('lines', { display: 'flex', flexDirection: 'column', gap: 8 }, [label({ color: '#64748b', fontSize: 12 }), box('line', { width: 160, height: 10, background: '#e2e8f0', borderRadius: 4 }), box('short', { width: 110, height: 10, background: '#f1f5f9', borderRadius: 4 })])], 'Loading profile…'],
  Stat: [{ ...surface, width: 220, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }, [label({ ...muted, fontWeight: 500 }), text('value', '$24,680', { fontSize: 30, lineHeight: '38px', fontWeight: 700 }), text('trend', '↑ 12.8% this month', { ...muted, color: '#15803d' })], 'Total revenue'],
  Switch: [{ padding: 0, background: 'transparent' }, [box('track', { ...row, width: 36, height: 20, padding: 2, boxSizing: 'border-box', justifyContent: 'flex-end', borderRadius: 999, background: '#2563eb' }, [box('thumb', { width: 16, height: 16, borderRadius: 999, background: '#ffffff' })]), label({ fontWeight: 400 })], 'Enable notifications'],
  Tab: [{ padding: '10px 16px', borderRadius: 0, background: 'transparent', color: '#2563eb', borderBottom: '2px solid #2563eb' }, [label()], 'Overview'],
  Tag: [{ padding: '3px 10px', borderRadius: 6, background: '#eef2ff', color: '#4338ca', gap: 8 }, [label({ fontSize: 12, lineHeight: '18px' }), text('remove', '×', { fontSize: 14, lineHeight: '18px' })], 'Design'],
  Toast: [{ ...surface, width: 300, padding: '12px 16px', boxShadow: '0 6px 20px #0f172a14' }, [dot('success'), label(), text('close', '×', { marginLeft: 'auto', color: '#94a3b8' })], 'Project created'],
  Tooltip: [{ padding: '6px 10px', borderRadius: 6, background: '#0f172a', color: '#ffffff' }, [label({ fontSize: 12, lineHeight: '18px', fontWeight: 400 })], 'Copy to clipboard'],
};

// `insert` adds one bare node, so a tree becomes inserts plus text bindings, parents first.
const insertOps = (parent, { children = [], textProp, ...node }) => [
  { op: 'insert', parent, node },
  ...(textProp ? [{ op: 'bindText', id: node.id, prop: textProp }] : []),
  ...children.flatMap(child => insertOps(node.id, child)),
];

try {
  if (process.argv.length !== 3) throw new Error('Usage: node tools/sample-repo.js <empty-folder>');
  const dir = resolve(process.argv[2]);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error('Destination must be empty; choose a new folder.');
  mkdirSync(join(dir, 'components'), { recursive: true });
  for (const name of ['Button', 'Card', 'Chip']) createComponent(join(dir, 'components', `${name}.tsx`), readFileSync(join(root, 'fixtures', name, `${name}.tsx`), 'utf8'));
  for (const name of names) {
    const { doc, state } = tsxCodec.load(newComponentSource(name, 'div'));
    const [style, children, defaultLabel] = specs[name];
    const rootStyle = { display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, width: 'auto', height: 'auto', boxSizing: 'border-box', borderRadius: 8, background: '#f8fafc', color: '#1e293b', fontFamily: 'system-ui, sans-serif', fontSize: 14, lineHeight: '20px', ...style };
    const next = applyEdits(doc, [
      { op: 'addProp', name: 'label', type: 'string', default: defaultLabel },
      { op: 'addProp', name: 'tone', type: 'enum', options: ['neutral', 'accent'], default: 'neutral' },
      ...Object.entries(rootStyle).map(([prop, value]) => ({ op: 'set', path: `root.${prop}`, value })),
      { op: 'set', path: 'root.background', value: '#dbeafe', variant: { tone: 'accent' } },
      { op: 'set', path: 'root.color', value: '#1e3a8a', variant: { tone: 'accent' } },
      ...children.flatMap(node => insertOps('root', node)),
    ]);
    createComponent(join(dir, 'components', `${name}.tsx`), tsxCodec.save(state, doc, next).text);
  }
  createProjectConfig(join(dir, 'napkin.json'), JSON.stringify({ components: 'components' }, null, 2) + '\n');
  execFileSync('git', ['init', '-q', dir]);
  console.log(`Created 40 editable components in ${process.argv[2]} (git initialized; no commits).`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
