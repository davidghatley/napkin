// A read-only walk. Symlinks are not followed (they may leave the requested repository).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { explainError } from './errors.js';
import { readComponent } from './tsx/read.js';

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', '.napkin']);
export function componentFiles(dir, { recursive = true } = {}) {
  const files = [];
  function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(d, e.name);
      if (e.isDirectory() && recursive && !SKIP.has(e.name)) walk(file);
      else if (e.isFile() && e.name.endsWith('.tsx')) files.push(file);
    }
  }
  walk(resolve(dir)); return files;
}
export function classifySource(source, file) {
  try { const { doc } = readComponent(source); return { file, editable: true, name: doc.name }; }
  catch (e) {
    const line = e.line || e.loc?.line || 1;
    return { file, editable: false, line, reason: explainError(e.message, { file }) };
  }
}
export const scanRepository = (dir) => componentFiles(dir).map((file) => classifySource(readFileSync(file, 'utf8'), relative(resolve(dir), file)));
export function formatReport(rows) {
  const editable = rows.filter((r) => r.editable).length;
  return [`${rows.length} TSX files: ${editable} editable, ${rows.length - editable} read-only`, 'File | Status | Line | Reason', ...rows.map((r) => `${r.file} | ${r.editable ? 'editable' : 'read-only'} | ${r.line || '—'} | ${r.editable ? 'Fits the napkin dialect' : r.reason}`)].join('\n');
}
