// Read a component .tsx file in the napkin dialect (decision 0003) into a model (src/model.js).
// Anything outside the dialect throws DialectError with the line, and the file opens read-only:
// napkin never guesses at code it can't write back faithfully (salvage INV-06).
import * as recast from 'recast';
import * as tsParser from 'recast/parsers/babel-ts.js';
import { TAGS, ATTRS } from '../model.js';

export class DialectError extends Error {
  constructor(node, message) {
    const line = node?.loc?.start?.line;
    super(line ? `line ${line}: ${message}` : message);
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

// Find the dialect's parts in the program. Shared with the writer.
export function locate(ast) {
  const parts = { imports: [] };
  for (const stmt of ast.program.body) {
    if (stmt.type === 'ImportDeclaration') { parts.imports.push(stmt); continue; }
    const d = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (d?.type === 'TSInterfaceDeclaration') { if (parts.iface) throw new DialectError(d, 'only one props interface'); parts.iface = d; continue; }
    if (d?.type === 'TSTypeAliasDeclaration') continue;
    const v = declInit(stmt);
    if (v && (v.name === 'base' || v.name === 'variants')) { parts[v.name] = v.init; continue; }
    if (d?.type === 'FunctionDeclaration' && d.id?.name === 's') { parts.helper = d; continue; }
    if (d?.type === 'FunctionDeclaration' && stmt.type === 'ExportNamedDeclaration' && /^[A-Z]/.test(d.id?.name || '')) {
      if (parts.fn) throw new DialectError(d, 'only one exported component per file');
      parts.fn = d; continue;
    }
    throw new DialectError(stmt, `napkin can't edit this statement (${d?.type || stmt.type})`);
  }
  if (!parts.fn) throw new DialectError(null, 'no exported component function (export function Name(...))');
  if (!parts.base) throw new DialectError(null, 'no `const base = { ... }` style object');
  if (!parts.helper) throw new DialectError(null, 'no style helper `function s(node, v)`');
  const body = parts.fn.body.body;
  for (const st of body) {
    const v = declInit(st);
    if (v?.name === 'v') { parts.vObj = v.init; continue; }
    if (st.type === 'ReturnStatement') { parts.ret = st; continue; }
    throw new DialectError(st, 'the component body may only define `v` and return JSX');
  }
  if (!parts.ret) throw new DialectError(parts.fn, 'the component must return JSX');
  let jsx = parts.ret.argument;
  while (jsx?.type === 'ParenthesizedExpression') jsx = jsx.expression;
  if (jsx?.type !== 'JSXElement') throw new DialectError(parts.ret, 'the component must return one JSX element');
  parts.jsx = jsx;
  const param = parts.fn.params[0];
  if (parts.fn.params.length > 1 || (param && param.type !== 'ObjectPattern')) throw new DialectError(parts.fn, 'props must be destructured: ({ a, b = 1 }: Props)');
  parts.pattern = param || null;
  return parts;
}

function readProps(parts) {
  const props = [];
  const defaults = new Map();
  for (const p of parts.pattern?.properties || []) {
    if (p.type !== 'ObjectProperty' || p.computed) throw new DialectError(p, 'props: only plain names and defaults');
    const name = keyName(p.key);
    if (p.value.type === 'AssignmentPattern') {
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
    else if (t?.type === 'TSUnionType' && t.types.every((x) => x.type === 'TSLiteralType' && x.literal.type === 'StringLiteral')) {
      prop = { name, type: 'enum', options: t.types.map((x) => x.literal.value) };
    } else if (t?.type === 'TSLiteralType' && t.literal.type === 'StringLiteral') {
      prop = { name, type: 'enum', options: [t.literal.value] };
    } else throw new DialectError(m, `prop ${name}: type must be string, boolean or a union of strings`);
    if (defaults.has(name)) prop.default = defaults.get(name);
    if (prop.type === 'enum') {
      if (!defaults.has(name)) throw new DialectError(m, `variant axis ${name} needs a default (its base value)`);
      if (!prop.options.includes(prop.default)) throw new DialectError(m, `default for ${name} is not one of its values`);
    }
    props.push(prop);
  }
  for (const name of defaults.keys()) if (!props.some((p) => p.name === name)) throw new DialectError(parts.pattern, `prop ${name} is not in the props interface`);
  return props;
}

function readNode(el, props, seen) {
  const open = el.openingElement;
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
      if (x.type !== 'Identifier' || !props.some((p) => p.name === x.name && p.type === 'string')) throw new DialectError(c, 'only {stringProp} or {"text"} inside elements');
      if (node.textProp || node.text !== undefined) throw new DialectError(c, 'one text per element');
      node.textProp = x.name;
    } else if (c.type === 'JSXElement') node.children.push(readNode(c, props, seen));
    else throw new DialectError(c, `${c.type} is not supported inside elements`);
  }
  if ((node.text !== undefined || node.textProp) && node.children.length) throw new DialectError(el, `${node.id} mixes text and elements; wrap the text in its own element`);
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

// text -> { doc, ast, parts }. Throws DialectError (read-only) or SyntaxError.
export function readComponent(text) {
  const ast = parseAst(text);
  const parts = locate(ast);
  const props = readProps(parts);
  const seen = new Set();
  const root = readNode(parts.jsx, props, seen);
  const base = Object.fromEntries(objectEntries(parts.base, 'base').map(([k, v]) => [k, styleObject(v, `base.${k}`)]));
  for (const k of Object.keys(base)) if (!seen.has(k)) throw new DialectError(parts.base, `base.${k}: no element with that data-n`);
  (function fill(n) { n.style = base[n.id] || {}; n.children.forEach(fill); })(root);
  const variants = readVariants(parts.variants, props, seen);
  const axisNames = props.filter((p) => p.type === 'enum').map((p) => p.name);
  if (axisNames.length) {
    const vNames = parts.vObj?.type === 'ObjectExpression' ? parts.vObj.properties.map((p) => keyName(p.key)) : null;
    if (!vNames || vNames.join() !== axisNames.join()) throw new DialectError(parts.vObj || parts.fn, `const v must list the variant axes in order: { ${axisNames.join(', ')} }`);
  }
  if (axisNames.length && !parts.variants) throw new DialectError(null, 'a component with variant axes needs `const variants = { ... }`');
  return { doc: { format: 'napkin/1', name: parts.fn.id.name, props, root, variants }, ast, parts };
}
