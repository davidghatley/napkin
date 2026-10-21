// Deliberately small converter: a named function, literal inline styles, intrinsic JSX.
// It refuses every construct it cannot preserve. The original is untouched until review.
import * as recast from 'recast';
import { parseAst, readComponent, literalValue } from './tsx/read.js';
import { newComponentSource } from './tsx/write.js';
import { TAGS, ATTRS } from './model.js';

// Internal capability: HTTP edit payloads cannot request a source replacement.
export const ADOPTION = Symbol('reviewed adoption');
export function proposeAdoption(source, file) {
  const refuse = (node, why) => { throw new Error(`${file}: line ${node?.loc?.start?.line || 1}: cannot adopt: ${why}. Next: keep this file read-only; simplify that construct by hand before proposing again.`); };
  let ast;
  try { ast = parseAst(source); } catch (e) { refuse(null, e.message); }
  const body = ast.program.body;
  if (ast.program.directives?.length) refuse(ast.program.directives[0], 'module directives may affect runtime behavior');
  let fn;
  for (const st of body) {
    if (st.type === 'ImportDeclaration' && st.importKind === 'type' && st.source.value === 'react') continue;
    if (st.type === 'ExportNamedDeclaration' && st.declaration?.type === 'FunctionDeclaration' && !fn) { fn = st.declaration; continue; }
    refuse(st, 'only one named exported function and React type imports can be converted');
  }
  if (!fn || fn.params.length || fn.async || fn.generator || fn.typeParameters) refuse(fn, 'conversion requires a synchronous named function without props');
  if (fn.body.body.length !== 1 || fn.body.body[0].type !== 'ReturnStatement') refuse(fn, 'local logic, hooks and side effects must be kept');
  const jsx = fn.body.body[0].argument;
  if (jsx?.type !== 'JSXElement') refuse(fn, 'the function must return one JSX element');
  const styles = [], b = recast.types.builders;
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
        const obj = a.value?.expression;
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
      } else if (child.type === 'JSXExpressionContainer' && child.expression.type === 'StringLiteral') continue;
      else refuse(child, 'dynamic children, comments and conditionals cannot be converted');
    }
  }
  walk(jsx);
  const template = newComponentSource(fn.id.name);
  const prefix = template.slice(0, template.indexOf(`export function ${fn.id.name}`));
  const base = Object.fromEntries(styles);
  const start = prefix.indexOf('const base:'), end = prefix.indexOf('\nconst variants:');
  const head = prefix.slice(0, start) + `const base: Record<string, CSSProperties> = ${JSON.stringify(base, null, 2)};\n` + prefix.slice(end);
  const result = `${head}export function ${fn.id.name}() {\n  const v = {};\n  return (${recast.print(jsx).code});\n}\n`;
  try { readComponent(result); } catch (e) { refuse(fn, e.message); }
  return { source: result, doc: readComponent(result).doc, diff: `--- ${file}\n+++ ${file} (proposed adoption)\n@@ replace file after review @@\n${source.split('\n').map((s) => '-' + s).join('\n')}\n${result.split('\n').map((s) => '+' + s).join('\n')}` };
}
