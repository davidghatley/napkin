// Read a component .tsx file in the napkin dialect (decision 0003) into a model (src/model.js).
// Anything outside the dialect throws DialectError with the line, and the file opens read-only:
// napkin never guesses at code it can't write back faithfully (salvage INV-06).
import { explainError } from '../errors.js';
import * as recast from 'recast';
import * as tsParser from 'recast/parsers/babel-ts.js';
import { TAGS, ATTRS } from '../model.js';

export class DialectError extends Error {
  constructor(node, message) {
    const line = node?.loc?.start?.line;
    super(explainError(line ? `line ${line}: ${message}` : `line 1: ${message}`, { next: "keep this file read-only, or ask propose_adoption for a reviewed dialect rewrite." }));
    this.line = line;
  }
}

export const parseAst = (text) => recast.parse(text, { parser: tsParser });

const keyName = (k) => (k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null);

export function literalValue(n) {
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'NumericLiteral') return n.value;
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral') return -n.argument.value;
  if (n.type === 'BooleanLiteral') return n.value;
  return undefined;
}

function objectEntries(obj, what) {
  if (obj?.type !== 'ObjectExpression') throw new DialectError(obj, `${what} must be an object literal`);
  return obj.properties.map((p) => {
    if (p.type !== 'ObjectProperty' || p.computed) throw new DialectError(p, `${what}: only plain "key: value" entries`);
    const k = keyName(p.key);
    if (k === null) throw new DialectError(p, `${what}: bad key`);
    return [k, p.value, p];
  });
}

function styleObject(obj, what) {
  const out = {};
  for (const [k, v] of objectEntries(obj, what)) {
    const val = literalValue(v);
    if (val === undefined || typeof val === 'boolean') throw new DialectError(v, `${what}.${k} must be a string or number literal`);
    out[k] = val;
  }
  return out;
}

const declInit = (stmt) => {
  const d = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
  if (d?.type !== 'VariableDeclaration' || d.declarations.length !== 1) return null;
  const [decl] = d.declarations;
  return decl.id.type === 'Identifier' ? { name: decl.id.name, init: decl.init, decl } : null;
};

// What an unsupported top-level statement is, in plain words.
function describe(stmt, d) {
  const t = d?.type || stmt.type;
  if (t === 'VariableDeclaration') {
    const init = d.declarations?.[0]?.init;
    const callee = init?.type === 'CallExpression' ? (init.callee.name || init.callee.property?.name) : null;
    if (callee === 'forwardRef' || callee === 'memo') return `a component wrapped in ${callee}(...)`;
    if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') return 'a component written as an arrow function or function expression';
    return `an extra variable (\`${d.declarations?.[0]?.id?.name ?? '...'}\`)`;
  }
  return ({
    FunctionDeclaration: 'an extra function', ClassDeclaration: 'a class', ExportDefaultDeclaration: 'a default export',
    TSEnumDeclaration: 'an enum', ExpressionStatement: 'a statement that runs code', ExportAllDeclaration: 'an `export *`',
    ExportNamedDeclaration: 'an export', TSModuleDeclaration: 'a namespace',
  })[t] || 'this statement';
}

// Find the dialect's parts in the program. Shared with the writer.
export function locate(ast) {
  const parts = { imports: [] };
  for (const stmt of ast.program.body) {
    if (stmt.type === 'ImportDeclaration') { parts.imports.push(stmt); continue; }
    const d = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (d?.type === 'TSInterfaceDeclaration') { if (parts.iface) throw new DialectError(stmt, 'only one props interface'); parts.iface = d; parts.ifaceStmt = stmt; continue; }
    if (d?.type === 'TSTypeAliasDeclaration') continue;
    const v = declInit(stmt);
    if (v && (v.name === 'base' || v.name === 'variants')) { parts[v.name] = v.init; continue; }
    if (d?.type === 'FunctionDeclaration' && d.id?.name === 's') { parts.helper = d; parts.helperStmt = stmt; continue; }
    if (d?.type === 'FunctionDeclaration' && stmt.type === 'ExportNamedDeclaration' && /^[A-Z]/.test(d.id?.name || '')) {
      if (parts.fn) throw new DialectError(stmt, 'only one exported component per file');
      parts.fn = d; parts.fnStmt = stmt; continue; // recast leaves loc empty on the declaration; the statement carries the line
    }
    throw new DialectError(stmt, `${describe(stmt, d)} is outside the napkin format, so this file is read-only (napkin edits \`export function Name({ props }: NameProps)\` components, see docs/dialect.md)`);
  }
  const anchor = parts.fnStmt || ast.program.body.find((x) => x.type !== 'ImportDeclaration') || null; // the line to point at
  if (!parts.fn) throw new DialectError(anchor, 'there is no `export function Name(...)` component here, so this file is read-only (see docs/dialect.md)');
  if (!parts.base) throw new DialectError(anchor, 'this component does not keep its styles in a `const base = { ... }` object (it may use className, styled-components or inline style), so this file is read-only (see docs/dialect.md)');
  if (!parts.helper) throw new DialectError(anchor, 'there is no style helper `function s(node, v)` in this file, so it is read-only (see docs/dialect.md)');
  if (parts.fn.async || parts.fn.generator || parts.fn.typeParameters || parts.fn.returnType) throw new DialectError(parts.fnStmt, 'the component must be a plain function (not async, a generator, generic or with a return type)');
  const body = parts.fn.body.body;
  for (const st of body) {
    const v = declInit(st);
    if (v?.name === 'v') { parts.vObj = v.init; parts.vStmt = st; continue; }
    if (st.type === 'ReturnStatement') { parts.ret = st; continue; }
    throw new DialectError(st, 'the component body may only define `v` and return JSX');
  }
  if (!parts.vObj) throw new DialectError(parts.fnStmt, 'the component must define `const v = { ... }` (its variant axes)');
  if (!parts.ret) throw new DialectError(parts.fnStmt, 'the component must return JSX');
  let jsx = parts.ret.argument;
  while (jsx?.type === 'ParenthesizedExpression') jsx = jsx.expression;
  if (jsx?.type !== 'JSXElement') throw new DialectError(parts.ret, 'the component must return one JSX element');
  parts.jsx = jsx;
  const param = parts.fn.params[0];
  if (parts.fn.params.length > 1 || (param && param.type !== 'ObjectPattern')) throw new DialectError(parts.fnStmt, 'props must be destructured: ({ a, b = 1 }: Props)');
  parts.pattern = param || null;
  return parts;
}

// The JSDoc comment right above an interface member is the prop's description (one line; several lines are joined with spaces).
function descriptionOf(m) {
  const c = [...(m.leadingComments || [])].reverse().find((x) => x.type === 'CommentBlock' && x.value.startsWith('*'));
  if (!c) return '';
  return c.value.replace(/^\*/, '').split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim()).filter(Boolean).join(' ');
}

function readProps(parts) {
  const props = [];
  const defaults = new Map();
  for (const p of parts.pattern?.properties || []) {
    if (p.type !== 'ObjectProperty' || p.computed) throw new DialectError(p, 'props: only plain names and defaults');
    const name = keyName(p.key);
    if (p.value.type === 'AssignmentPattern') {
      if (p.value.left.type !== 'Identifier' || p.value.left.name !== name) throw new DialectError(p, 'props: no renaming');
      const val = literalValue(p.value.right);
      if (val === undefined) throw new DialectError(p.value.right, `default for ${name} must be a literal`);
      defaults.set(name, val);
    } else if (p.value.type !== 'Identifier' || p.value.name !== name) throw new DialectError(p, 'props: no renaming');
  }
  for (const m of parts.iface?.body.body || []) {
    if (m.type !== 'TSPropertySignature' || m.computed) throw new DialectError(m, 'props interface: only plain properties');
    const name = keyName(m.key);
    const t = m.typeAnnotation?.typeAnnotation;
    let prop;
    if (t?.type === 'TSStringKeyword') prop = { name, type: 'string' };
    else if (t?.type === 'TSBooleanKeyword') prop = { name, type: 'boolean' };
    else if (t?.type === 'TSNumberKeyword') prop = { name, type: 'number' };
    else if (t?.type === 'TSTypeReference' && t.typeName?.name === 'ReactNode' && !t.typeParameters) prop = { name, type: 'node' };
    else if (t?.type === 'TSUnionType' && t.types.every((x) => x.type === 'TSLiteralType' && x.literal.type === 'StringLiteral')) {
      prop = { name, type: 'enum', options: t.types.map((x) => x.literal.value) };
    } else if (t?.type === 'TSLiteralType' && t.literal.type === 'StringLiteral') {
      prop = { name, type: 'enum', options: [t.literal.value] };
    } else throw new DialectError(m, `prop ${name}: type must be string, number, boolean, ReactNode or a union of strings`);
    if (defaults.has(name)) prop.default = defaults.get(name);
    const note = descriptionOf(m);
    if (note) prop.description = note;
    if (prop.type === 'node' && defaults.has(name)) throw new DialectError(m, `${name} is a ReactNode slot and cannot have a default`);
    if (prop.type === 'number' && defaults.has(name) && typeof defaults.get(name) !== 'number') throw new DialectError(m, `default for ${name} must be a number`);
    if (prop.type === 'boolean' && defaults.has(name) && typeof defaults.get(name) !== 'boolean') throw new DialectError(m, `default for ${name} must be true or false`);
    if (prop.type === 'enum') {
      if (!defaults.has(name)) throw new DialectError(m, `variant axis ${name} needs a default (its base value)`);
      if (!prop.options.includes(prop.default)) throw new DialectError(m, `default for ${name} is not one of its values`);
    }
    props.push(prop);
  }
  for (const name of defaults.keys()) if (!props.some((p) => p.name === name)) throw new DialectError(parts.pattern, `prop ${name} is not in the props interface`);
  return props;
}

// Names imported as `import { Name } from './Name';` in this file: the components an instance may use.
function instanceImports(parts) {
  const out = new Set();
  for (const imp of parts.imports || []) {
    const m = /^\.\/([A-Z][A-Za-z0-9]*)$/.exec(imp.source.value);
    if (!m || imp.importKind === 'type') continue;
    if (imp.specifiers.length === 1 && imp.specifiers[0].type === 'ImportSpecifier' && imp.specifiers[0].imported.name === m[1] && imp.specifiers[0].local.name === m[1]) out.add(m[1]);
    else throw new DialectError(imp, `napkin reads only \`import { ${m[1]} } from './${m[1]}';\` for a sibling component`);
  }
  return out;
}
const INSTANCE_RESERVED = new Set(['key', 'ref', 'style', 'className', 'id']);
function instanceValue(a, props) {
  if (a.value === null) return true; // <Button disabled />
  if (a.value.type === 'StringLiteral') return a.value.value;
  const x = a.value.expression;
  const lit = x && literalValue(x);
  if (lit !== undefined) return lit;
  if (x?.type === 'Identifier' && props.some((p) => p.name === x.name)) return { prop: x.name };
  throw new DialectError(a, `${a.name.name} must be a text, a number, {true}, {false} or one of this component's props`);
}
function readInstance(el, props, seen, imports) {
  const open = el.openingElement, name = open.name.name;
  const node = { id: null, tag: name, style: {}, children: [], instance: { component: name, props: {} } };
  for (const a of open.attributes) {
    if (a.type !== 'JSXAttribute') throw new DialectError(a, 'no spread attributes');
    const key = a.name.name;
    if (key === 'data-n') {
      if (a.value?.type !== 'StringLiteral') throw new DialectError(a, 'data-n must be a string');
      node.id = a.value.value;
    } else if (key === 'style') throw new DialectError(a, `<${name}> is another component, so it has no style of its own`);
    else if (INSTANCE_RESERVED.has(key) || typeof key !== 'string') throw new DialectError(a, `attribute ${key} is not supported on a component`);
    else node.instance.props[key] = instanceValue(a, props);
  }
  if (!node.id) throw new DialectError(el, 'every element needs data-n="<id>"');
  if (seen.has(node.id)) throw new DialectError(el, `duplicate data-n "${node.id}"`);
  seen.add(node.id);
  if (el.children.some((c) => !(c.type === 'JSXText' && !c.value.trim()) && !(c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression'))) throw new DialectError(el, `<${name}> cannot have children here (instances are self-closing)`);
  return node;
}

function readNode(el, props, seen, imports = new Set()) {
  const open = el.openingElement;
  if (open.name.type === 'JSXIdentifier' && /^[A-Z]/.test(open.name.name)) {
    if (!imports.has(open.name.name)) throw new DialectError(el, `<${open.name.name}> is not a supported element; to use another component add \`import { ${open.name.name} } from './${open.name.name}';\``);
    return readInstance(el, props, seen, imports);
  }
  if (open.name.type !== 'JSXIdentifier' || !TAGS.has(open.name.name)) throw new DialectError(el, `<${open.name.name || '?'}> is not a supported element`);
  const node = { id: null, tag: open.name.name, style: {}, children: [] };
  let styled = false;
  for (const a of open.attributes) {
    if (a.type !== 'JSXAttribute') throw new DialectError(a, 'no spread attributes');
    const name = a.name.name;
    if (name === 'data-n') {
      if (a.value?.type !== 'StringLiteral') throw new DialectError(a, 'data-n must be a string');
      node.id = a.value.value;
    } else if (name === 'style') {
      const c = a.value?.expression;
      const ok = c?.type === 'CallExpression' && c.callee.name === 's' && c.arguments.length === 2 && c.arguments[0].type === 'StringLiteral' && c.arguments[1].type === 'Identifier' && c.arguments[1].name === 'v';
      if (!ok) throw new DialectError(a, "style must be s('<id>', v)");
      styled = c.arguments[0].value;
    } else if (ATTRS.includes(name)) {
      if (a.value?.type !== 'StringLiteral') throw new DialectError(a, `${name} must be a string`);
      (node.attrs ??= {})[name] = a.value.value;
    } else throw new DialectError(a, `attribute ${name} is not supported`);
  }
  if (!node.id) throw new DialectError(el, 'every element needs data-n="<id>"');
  if (styled !== node.id) throw new DialectError(el, `element ${node.id} needs style={s('${node.id}', v)}`);
  if (seen.has(node.id)) throw new DialectError(el, `duplicate data-n "${node.id}"`);
  seen.add(node.id);
  for (const c of el.children) {
    if (c.type === 'JSXText') {
      if (!c.value.trim()) continue;
      if (node.text !== undefined) throw new DialectError(c, 'one text per element');
      node.text = c.value.trim().replace(/\s+/g, ' ');
    } else if (c.type === 'JSXExpressionContainer') {
      const x = c.expression;
      if (x.type === 'JSXEmptyExpression') continue;
      if (x.type === 'StringLiteral') { if (node.text !== undefined) throw new DialectError(c, 'one text per element'); node.text = x.value; continue; }
      if (x.type === 'LogicalExpression' && x.operator === '&&') { // {flag && <el ... />}: shown only while a true/false prop is true
        let right = x.right; while (right?.type === 'ParenthesizedExpression') right = right.expression;
        const flag = x.left.type === 'Identifier' && props.find((p) => p.name === x.left.name && p.type === 'boolean');
        if (!flag || right?.type !== 'JSXElement') throw new DialectError(c, 'only {flag && <element ... />} where flag is a true/false prop');
        const child = readNode(right, props, seen, imports);
        child.when = flag.name;
        node.children.push(child);
        continue;
      }
      const slotProp = x.type === 'Identifier' && props.find((p) => p.name === x.name && p.type === 'node');
      if (slotProp) { if (node.slot || node.textProp || node.text !== undefined) throw new DialectError(c, 'one text or slot per element'); node.slot = x.name; continue; }
      if (x.type !== 'Identifier' || !props.some((p) => p.name === x.name && p.type === 'string')) throw new DialectError(c, 'only {stringProp}, {slotProp} (a ReactNode prop), {flag && <element />} or {"text"} inside elements');
      if (node.textProp || node.slot || node.text !== undefined) throw new DialectError(c, 'one text per element');
      node.textProp = x.name;
    } else if (c.type === 'JSXElement') node.children.push(readNode(c, props, seen, imports));
    else throw new DialectError(c, `${({ JSXSpreadChild: 'a spread child', JSXFragment: 'a fragment (<>...</>)' })[c.type] || 'this kind of child'} is not supported inside elements`);
  }
  if ((node.text !== undefined || node.textProp || node.slot) && node.children.length) throw new DialectError(el, `${node.id} mixes text (or a slot) and elements; wrap the text in its own element`);
  return node;
}

function readVariants(obj, props, ids) {
  const out = {};
  if (!obj) return out;
  for (const [axis, vals] of objectEntries(obj, 'variants')) {
    const p = props.find((x) => x.name === axis);
    if (!p || p.type !== 'enum') throw new DialectError(vals, `variants.${axis}: no variant axis prop "${axis}"`);
    for (const [val, nodes] of objectEntries(vals, `variants.${axis}`)) {
      if (!p.options.includes(val)) throw new DialectError(nodes, `variants.${axis}.${val}: not a value of ${axis}`);
      for (const [id, st] of objectEntries(nodes, `variants.${axis}.${val}`)) {
        if (!ids.has(id)) throw new DialectError(st, `variants.${axis}.${val}.${id}: no element with that data-n`);
        const style = styleObject(st, `variants.${axis}.${val}.${id}`);
        if (Object.keys(style).length) ((out[axis] ??= {})[val] ??= {})[id] = style;
      }
    }
  }
  return out;
}

// The style helper is part of the contract between the file and napkin: it must be exactly the one napkin writes
// (whitespace aside), or the model napkin shows would not be what the component renders.
const HELPER = 'functions(node:string,v:Record<string,string>):CSSProperties{constout:CSSProperties={...base[node]};for(constaxisinv)Object.assign(out,variants[axis]?.[v[axis]]?.[node]);returnout;}';
function checkHelper(parts) {
  const code = recast.print(parts.helper).code.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  if (code !== HELPER) throw new DialectError(parts.helperStmt, 'the style helper `s` must be exactly the one napkin writes (see docs/dialect.md)');
}

// text -> { doc, ast, parts }. Throws DialectError (read-only) or SyntaxError.
export function readComponent(text) {
  const ast = parseAst(text);
  const parts = locate(ast);
  checkHelper(parts);
  const props = readProps(parts);
  const seen = new Set();
  const imports = instanceImports(parts);
  if (props.some((p) => p.type === 'node') && !parts.imports.some((i) => i.source.value === 'react' && i.specifiers.some((x) => x.imported?.name === 'ReactNode'))) throw new DialectError(parts.iface || parts.fnStmt, "a ReactNode prop needs `import type { CSSProperties, ReactNode } from 'react';`");
  const root = readNode(parts.jsx, props, seen, imports);
  const base = Object.fromEntries(objectEntries(parts.base, 'base').map(([k, v]) => [k, styleObject(v, `base.${k}`)]));
  for (const k of Object.keys(base)) if (!seen.has(k)) throw new DialectError(parts.base, `base.${k}: no element with that data-n`);
  (function fill(n) { n.style = base[n.id] || {}; n.children.forEach(fill); })(root);
  const variants = readVariants(parts.variants, props, seen);
  const axisNames = props.filter((p) => p.type === 'enum').map((p) => p.name);
  if (axisNames.length) {
    const vNames = parts.vObj?.type === 'ObjectExpression' ? parts.vObj.properties.map((p) => keyName(p.key)) : null;
    if (!vNames || vNames.join() !== axisNames.join()) throw new DialectError(parts.vObj || parts.fnStmt, `const v must list the variant axes in order: { ${axisNames.join(', ')} }`);
  }
  if (axisNames.length && !parts.variants) throw new DialectError(parts.fnStmt, 'a component with variant axes needs `const variants = { ... }`');
  return { doc: { format: 'napkin/1', name: parts.fn.id.name, props, root, variants }, ast, parts };
}
