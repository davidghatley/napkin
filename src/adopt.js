// Deliberately small converter: a named function, literal inline styles, intrinsic JSX.
// It refuses every construct it cannot preserve. The original is untouched until review.
import * as recast from 'recast';
import { parseAst, readComponent, literalValue } from './tsx/read.js';
import { newComponentSource } from './tsx/write.js';
import { blockingConstructs } from './scan.js';
import { TAGS, ATTRS } from './model.js';

// Internal capability: HTTP edit payloads cannot request a source replacement.
export const ADOPTION = Symbol('reviewed adoption');
const b = recast.types.builders;
const literalText = value => recast.prettyPrint(typeof value === 'string' ? b.stringLiteral(value) : b.literal(value), { quote: 'single' }).code;

// Print the small, validated JSX subset without carrying source parentheses or indentation.
function printJsx(el, indent = 4, inline = false) {
  const open = el.openingElement;
  const attrs = open.attributes.map(a => `${a.name.name}=${a.value.type === 'StringLiteral'
    ? `"${a.value.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`
    : `{${recast.prettyPrint(a.value.expression, { quote: 'single' }).code}}`}`).join(' ');
  const tag = `<${open.name.name} ${attrs}`;
  const children = el.children.filter(c => c.type !== 'JSXText' || c.value.trim());
  if (!children.length) return `${tag} />`;
  const close = `</${open.name.name}>`;
  if (!inline && (children.length === 1 || children.every(c => c.type === 'JSXElement'))) {
    return `${tag}>\n${children.map(c => ' '.repeat(indent + 2) + (c.type === 'JSXElement' ? printJsx(c, indent + 2) : recast.prettyPrint(c, { quote: 'single' }).code)).join('\n')}\n${' '.repeat(indent)}${close}`;
  }
  return `${tag}>${children.map(c => c.type === 'JSXElement' ? printJsx(c, indent, true) : recast.prettyPrint(c, { quote: 'single' }).code).join('')}${close}`;
}

export function proposeAdoption(source, file) {
  const refuse = (node, why, next = 'keep this file read-only; simplify that construct by hand before proposing again.') => { throw new Error(`${file}: line ${node?.loc?.start?.line || 1}: cannot adopt: ${why}. Next: ${next}`); };
  const blockers = blockingConstructs(source, { adoption: true });
  if (blockers[0]?.name === 'syntax error') refuse({ loc: { start: { line: blockers[0].line } } }, blockers[0].detail, `fix the syntax error at line ${blockers[0].line} first, then propose adoption again.`);
  if (blockers.length) refuse({ loc: { start: { line: blockers[0].line } } }, blockers.map(c => `line ${c.line}: ${c.name}`).join('; '));
  let ast;
  try { ast = parseAst(source); } catch (e) { refuse({ loc: { start: { line: e.loc?.line || 1 } } }, e.message, `fix the syntax error at line ${e.loc?.line || 1} first, then propose adoption again.`); }
  const body = ast.program.body;
  if (ast.program.directives?.length) refuse(ast.program.directives[0], 'module directives may affect runtime behavior');
  let fn;
  const styleConstants = new Map();
  function constant(st) {
    if (st.type !== 'VariableDeclaration' || st.kind !== 'const') return false;
    for (const d of st.declarations) {
      if (d.id.type !== 'Identifier') refuse(d, 'style constants need a simple name, without destructuring');
      if (styleConstants.has(d.id.name)) refuse(d, `style constant ${d.id.name} is declared more than once`);
      if (d.init?.type !== 'ObjectExpression') {
        const value = d.init && literalValue(d.init);
        const kind = value === undefined ? 'not a literal style object' : `a ${typeof value}, not a style object`;
        refuse(d, `${d.id.name} is ${kind}; napkin can only adopt style objects such as { color: '#f00' }`);
      }
      for (const p of d.init.properties) if (p.type !== 'ObjectProperty' || p.computed || !['Identifier', 'StringLiteral'].includes(p.key.type) || !['string', 'number'].includes(typeof literalValue(p.value))) refuse(p, 'style constants must contain only plain string or number values');
      styleConstants.set(d.id.name, d.init);
    }
    return true;
  }
  for (const st of body) {
    if (constant(st)) continue;
    if (st.type === 'TSInterfaceDeclaration' || st.type === 'ExportNamedDeclaration' && st.declaration?.type === 'TSInterfaceDeclaration') continue;
    if (st.type === 'ImportDeclaration' && st.importKind === 'type' && st.source.value === 'react') continue;
    if (st.type === 'ExportNamedDeclaration' && st.declaration?.type === 'FunctionDeclaration' && !fn) { fn = st.declaration; continue; }
    refuse(st, 'only one named exported function and React type imports can be converted');
  }
  if (!fn || fn.params.length > 1 || fn.async || fn.generator || fn.typeParameters) refuse(fn, 'conversion requires one synchronous named function');
  const props = [], param = fn.params[0];
  if (param && param.type !== 'ObjectPattern') refuse(param, 'props must be destructured with literal defaults');
  const annotation = param?.typeAnnotation?.typeAnnotation;
  const iface = annotation?.type === 'TSTypeReference' ? body.map(st => st.declaration || st).find(st => st.type === 'TSInterfaceDeclaration' && st.id.name === annotation.typeName.name) : null;
  if (iface?.extends?.length) refuse(iface, 'inherited props need their original types');
  const members = annotation?.type === 'TSTypeLiteral' ? annotation.members : iface?.body.body;
  for (const p of param?.properties || []) {
    const name = p.key?.name;
    if (p.type !== 'ObjectProperty' || p.computed || p.value.type !== 'AssignmentPattern' || p.value.left.name !== name) refuse(p, 'each prop needs its own literal default, without renaming');
    const value = literalValue(p.value.right);
    const member = members?.find(m => m.key?.name === name);
    const type = member?.typeAnnotation?.typeAnnotation;
    let typeText = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : null;
    if (type) {
      if (['TSStringKeyword', 'TSBooleanKeyword'].includes(type.type)) typeText = type.type === 'TSStringKeyword' ? 'string' : 'boolean';
      else if (type.type === 'TSUnionType' && type.types.every(t => t.type === 'TSLiteralType' && t.literal.type === 'StringLiteral')) typeText = type.types.map(t => literalText(t.literal.value)).join(' | ');
      else refuse(member, 'only string, boolean and string enum props can be preserved');
    }
    if (!typeText || !['string', 'boolean'].includes(typeof value)) refuse(p, 'only string and boolean literal defaults can be preserved');
    props.push({ name, value, typeText, enum: type?.type === 'TSUnionType' });
  }
  if (members?.some(m => !props.some(p => p.name === m.key?.name))) refuse(param, 'every declared prop needs a literal default');
  const statements = fn.body.body.filter(st => !constant(st));
  if (statements.length !== 1 || statements[0].type !== 'ReturnStatement') refuse(fn, 'local logic, hooks and side effects must be kept');
  let jsx = statements[0].argument;
  while (jsx?.type === 'ParenthesizedExpression') jsx = jsx.expression;
  if (jsx?.type !== 'JSXElement') refuse(fn, 'the function must return one JSX element');
  const styles = [];
  function walk(el) {
    const open = el.openingElement;
    if (open.name.type !== 'JSXIdentifier' || !TAGS.has(open.name.name)) refuse(open, 'custom components and unsupported tags need their original runtime');
    const id = styles.length ? `node${styles.length}` : 'root';
    const style = {};
    styles.push([id, style]);
    const attrs = [];
    const seen = new Set();
    for (const a of open.attributes) {
      if (a.type !== 'JSXAttribute' || seen.has(a.name.name)) refuse(a, 'spread or duplicate attributes cannot be preserved');
      seen.add(a.name.name);
      if (a.name.name === 'style') {
        let obj = a.value?.expression;
        if (obj?.type === 'Identifier') obj = styleConstants.get(obj.name);
        if (obj?.type !== 'ObjectExpression') refuse(a, 'style must be an inline object of literal values');
        for (const p of obj.properties) {
          if (p.type !== 'ObjectProperty' || p.computed || !['Identifier', 'StringLiteral'].includes(p.key.type)) refuse(p, 'computed styles and style spreads cannot be preserved');
          const key = p.key.name ?? p.key.value, val = literalValue(p.value);
          if (!['string', 'number'].includes(typeof val) || key === '__proto__' || Object.hasOwn(style, key)) refuse(p, 'style values must be distinct string or number literals');
          style[key] = val;
        }
      } else if (ATTRS.includes(a.name.name) && a.value?.type === 'StringLiteral') attrs.push(a);
      else refuse(a, `attribute ${a.name.name} cannot be preserved (including className, events and existing data-n)`);
    }
    attrs.push(b.jsxAttribute(b.jsxIdentifier('data-n'), b.stringLiteral(id)), b.jsxAttribute(b.jsxIdentifier('style'), b.jsxExpressionContainer(b.callExpression(b.identifier('s'), [b.stringLiteral(id), b.identifier('v')]))));
    open.attributes = attrs;
    // Preserve the exact React JSX text value, rather than silently trimming whitespace.
    // The dialect normalizes text, so refuse whitespace patterns that would change it.
    for (const child of el.children) {
      if (child.type === 'JSXElement') walk(child);
      else if (child.type === 'JSXText') {
        if (child.value.trim() && (child.value !== child.value.trim() || /\s{2,}|[\n\r\t]/.test(child.value))) refuse(child, 'significant text whitespace needs a manual rewrite');
      } else if (child.type === 'JSXExpressionContainer' && (child.expression.type === 'StringLiteral' || child.expression.type === 'Identifier' && props.some(p => p.name === child.expression.name && p.typeText === 'string'))) continue;
      else refuse(child, 'dynamic children, comments and conditionals cannot be converted');
    }
  }
  walk(jsx);
  const entries = styles.filter(([, style]) => Object.keys(style).length);
  const base = entries.length ? `{\n${entries.map(([id, style]) => `  ${id}: {\n${Object.entries(style).map(([key, value]) => `    ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : literalText(key)}: ${literalText(value)},`).join('\n')}\n  },`).join('\n')}\n}` : '{}';
  const params = props.length ? `{ ${props.map(p => `${p.name} = ${literalText(p.value)}`).join(', ')} }: ${fn.id.name}Props` : '';
  const axes = props.filter(p => p.enum).map(p => p.name);
  const result = `import type { CSSProperties } from 'react';

export interface ${fn.id.name}Props {${props.length ? '\n' + props.map(p => `  ${p.name}?: ${p.typeText};`).join('\n') + '\n' : ''}}

const base: Record<string, CSSProperties> = ${base};

const variants: Record<
  string,
  Record<string, Record<string, CSSProperties>>
> = {};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function ${fn.id.name}(${params}) {
  const v = ${axes.length ? `{ ${axes.join(', ')} }` : '{}'};
  return (
    ${printJsx(jsx)}
  );
}
`;
  try { readComponent(result); } catch (e) { refuse(fn, e.message); }
  return { source: result, doc: readComponent(result).doc, diff: `--- ${file}\n+++ ${file} (proposed adoption)\n@@ replace file after review @@\n${source.split('\n').map((s) => '-' + s).join('\n')}\n${result.split('\n').map((s) => '+' + s).join('\n')}` };
}

// CLI starter uses the same reviewed dialect template, and commit.js creates the file.
export function starterSource(name = 'Welcome') {
  return newComponentSource(name, 'button')
    .replace(`export interface ${name}Props {}`, `export interface ${name}Props {\n  label?: string;\n  size?: 'md' | 'sm' | 'lg';\n}`)
    .replace("flexDirection: 'column',", "alignItems: 'center',\n    border: 'none',\n    borderRadius: 8,\n    background: '#4f46e5',\n    color: '#ffffff',\n    fontFamily: 'system-ui, sans-serif',\n    fontSize: 15,\n    cursor: 'pointer',")
    .replace('    padding: 16,', "    padding: '10px 18px',")
    .replace('const variants: Record<string, Record<string, Styles>> = {};', "const variants: Record<string, Record<string, Styles>> = {\n  size: {\n    sm: { root: { padding: '6px 12px', fontSize: 13 } },\n    lg: { root: { padding: '14px 24px', fontSize: 18 } },\n  },\n};")
    .replace(`export function ${name}({}: ${name}Props)`, `export function ${name}({ label = 'Make something', size = 'md' }: ${name}Props)`)
    .replace('const v = {};', 'const v = { size };')
    .replace(`<button data-n="root" style={s('root', v)} />`, `<button data-n="root" style={s('root', v)}>{label}</button>`);
}
