// Read-only repository analysis. Never follow symlinks outside the requested tree.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { explainError } from './errors.js';
import { parse } from '@babel/parser';
import { readComponent } from './tsx/read.js';

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', '.napkin', '.next']);
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

// Collect independently of the dialect reader's first refusal. Each occurrence retains
// its source line; report totals count files, rather than occurrences in one file.
// A parser gives up on the token AFTER the mistake: an unclosed tag or a missing bracket is reported where the next line starts. When the
// error sits on the first token of its line, the line that is broken is the one above it (the parser's own line is said too). `relocate: false`
// keeps the parser's line, for callers that know what changed (store.js names the edited line from a diff).
function syntaxProblem(source, error, relocate) {
  const parser = error.loc?.line || 1, col = error.loc?.column ?? 0;
  const lines = source.split('\n');
  let line = parser;
  if (relocate && parser > 1 && /^\s*$/.test((lines[parser - 1] || '').slice(0, col))) { for (let i = parser - 2; i >= 0; i--) if (lines[i].trim()) { line = i + 1; break; } }
  const detail = error.message.replace(/\s*\(\d+:\d+\)\s*$/, '') + (line !== parser ? `; the parser stopped at line ${parser}` : '');
  return [{ name: 'syntax error', line, detail }];
}
export function blockingConstructs(source, { adoption = false, relocate = true } = {}) {
  let ast;
  try { ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }); } catch (error) { return syntaxProblem(source, error, relocate); }
  const out = [], add = (name, n, detail) => out.push({ name, line: n?.loc?.start?.line || 1, ...(detail ? { detail } : {}) });
  let firstStyling;
  const body = ast.program.body;
  const exported = body.find(n => n.type === 'ExportDefaultDeclaration' || n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration');
  const main = exported?.declaration?.type === 'FunctionDeclaration' ? exported.declaration : body.find(n => n.type === 'FunctionDeclaration' && /^[A-Z]/.test(n.id?.name));
  const mainBinding = body.flatMap(st => (st.declaration || st).declarations || []).find(d => /^[A-Z]/.test(d.id.name || '') && ['ArrowFunctionExpression', 'FunctionExpression'].includes(d.init?.type));
  const hasBase = body.some(n => n.type === 'VariableDeclaration' && n.kind === 'const' && n.declarations.some(d => d.id.name === 'base'));
  const visit = (n, parent) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(x => visit(x, parent)); return; }
    if (hasBase && n.type === 'FunctionDeclaration' && n.id?.name === 's') return;
    if (n.type === 'FunctionDeclaration' && n !== main && n.id?.name !== 's') add('extra helper functions', n);
    if (n.type === 'VariableDeclarator' && n !== mainBinding && ['ArrowFunctionExpression', 'FunctionExpression'].includes(n.init?.type)) add('extra helper functions', n);
    const callee = n.type === 'CallExpression' ? n.callee : null;
    const call = callee?.name || callee?.property?.name;
    if (!firstStyling && (n.type === 'JSXAttribute' && ['style', 'className'].includes(n.name.name) || call === 'cn')) firstStyling = n;
    if (n.type === 'JSXAttribute' && n.name.name === 'className' || call === 'cn') add('className or cn() styling', n);
    if (call === 'forwardRef') add('forwardRef', n);
    if (n.type === 'RestElement' || n.type === 'SpreadElement' || n.type === 'JSXSpreadAttribute') {
      // The dialect's fixed s() helper contains its own permitted spread.
      add('rest or spread props', n);
    }
    if (/^use[A-Z]/.test(call || '')) add('hooks', n);
    if (n.type === 'ExportDefaultDeclaration') add('default export', n);
    if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') add('class component', n);
    if (n.type === 'ConditionalExpression' || n.type === 'LogicalExpression' && ['&&', '||', '??'].includes(n.operator)) add('conditional rendering', n);
    if (call === 'map') add('map', n);
    if (n.type === 'ImportDeclaration' && /\.module\.(css|scss|sass|less)$/.test(n.source.value)) add('CSS modules', n);
    if (['createContext', 'useContext'].includes(call) || n.type === 'JSXMemberExpression' && ['Provider', 'Consumer'].includes(n.property.name)) add('context', n);
    for (const [key, value] of Object.entries(n)) if (!['loc', 'tokens', 'comments', 'original', 'extra'].includes(key) && value && typeof value === 'object') visit(value, n);
  };
  visit(ast);
  if (!hasBase && !adoption) add('styles outside const base', firstStyling || exported || main || body[0], (firstStyling ? "styles are not in napkin's `const base` object (this file styles with className/cn() or inline styles); see docs/dialect.md" : "this file has no styles napkin can edit (napkin keeps styles in a `const base` object); see docs/dialect.md"));
  return out.sort((a, b) => a.line - b.line).filter((c, i, all) => !all.slice(0, i).some(x => x.name === c.name && x.line === c.line));
}

function constructReasons(constructs) {
  const totals = new Map(), seen = new Map();
  for (const c of constructs) totals.set(c.name, (totals.get(c.name) || 0) + 1);
  return constructs.flatMap(c => {
    const n = (seen.get(c.name) || 0) + 1;
    seen.set(c.name, n);
    if (n > 5) return [];
    const reason = `line ${c.line}: ${c.name === 'styles outside const base' ? c.detail : c.name + (c.detail ? ` (${c.detail})` : '')}`;
    return [reason + (n === 5 && totals.get(c.name) > 5 ? ` (and ${totals.get(c.name) - 5} more ${c.name})` : '')];
  }).join('; ');
}
export function classifySource(source, file, { relocate = true } = {}) {
  const constructs = blockingConstructs(source, { relocate });
  try { if (constructs.length) throw new Error(explainError('outside the dialect')); const { doc } = readComponent(source); return { file, editable: true, name: doc.name }; }
  catch (e) {
    const line = constructs[0]?.line || e.line || e.loc?.line || 1;
    const detail = constructs.length ? constructReasons(constructs) : e.message.replace(/\b[A-Z][A-Za-z]*(?:Declaration|Expression|Statement)\b/g, 'unsupported code');
    return { file, editable: false, line, constructs, reason: explainError(detail, { file, next: constructs[0]?.name === 'syntax error' ? `fix the syntax error at line ${line}, then save; napkin reloads it.` : 'keep this file read-only, or request propose_adoption for a reviewed rewrite.' }) };
  }
}
export const scanRepository = (dir) => componentFiles(dir).map((file) => classifySource(readFileSync(file, 'utf8'), relative(resolve(dir), file)));
export function formatReport(rows) {
  const editable = rows.filter(r => r.editable).length, counts = new Map();
  for (const r of rows) for (const name of new Set((r.constructs || []).map(c => c.name))) counts.set(name, (counts.get(name) || 0) + 1);
  return [`${rows.length} TSX files: ${editable} editable, ${rows.length - editable} read-only`, ...(counts.size ? ['Top blocking constructs (files):'] : []), ...[...counts].sort((a,b) => b[1]-a[1]).map(([name,n]) => `${name}: ${n} ${n === 1 ? 'file' : 'files'}`), 'File | Status | Line | Reason', ...rows.map(r => `${r.file} | ${r.editable ? 'editable' : 'read-only'} | ${r.line || '—'} | ${r.editable ? 'Fits the napkin dialect' : r.reason}`)].join('\n');
}
