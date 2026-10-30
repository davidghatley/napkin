// TSX/JSX source map (decision 0014). Any .tsx/.jsx file opens: napkin finds its exported components and maps every
// JSX element to its bytes, in the same node shape as src/doc/html.js, so the one edit path (src/doc/edit.js) serves
// both. Nothing about the file has to fit a dialect; a spot that cannot be edited as text (a className built by cn(),
// a style computed by a function) is refused on its own, with the reason.
//   parseJsx(s, ext) -> { ast, components, elements, error }    s is latin1 (byte offsets; see src/doc/source.js)
// component: { name, exportName, isDefault, start, end }   start..end is the declaration the component's JSX lives in
// element: { tag, name, start, openEnd, closeStart, end, attrs, children, parent, selfClosing, jsx: true, textOnly, text }
import { parse } from '@babel/parser';
import { explainError } from '../errors.js';

const SKIP = new Set(['loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'range', 'start', 'end', 'typeAnnotation', 'typeParameters', 'returnType']);
function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const k of Object.keys(node)) {
    if (SKIP.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') walk(x, visit, node); }
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}
const jsxName = (n) => n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? `${jsxName(n.object)}.${jsxName(n.property)}` : n.type === 'JSXNamespacedName' ? `${n.namespace.name}:${n.name.name}` : '?';
const isCap = (name) => /^[A-Z]/.test(name); // (a capitalised constant like SIZES is not component-like, so it is still left out)
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression']);
// Looks like a component definition: a function, a class, or a call wrapping one (forwardRef, memo, styled(...)).
function componentLike(init) {
  if (!init) return false;
  if (FN.has(init.type)) return true;
  if (init.type === 'CallExpression') return init.arguments.some((a) => FN.has(a.type) || componentLike(a)) || /^(forwardRef|memo|React\.forwardRef|React\.memo|styled)/.test(calleeName(init.callee));
  if (init.type === 'TSAsExpression' || init.type === 'TSSatisfiesExpression') return componentLike(init.expression);
  return false;
}
const calleeName = (c) => c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' ? `${calleeName(c.object)}.${c.property.name || ''}` : '';

export function parseJsx(s, ext = '.tsx') {
  let ast;
  const plugins = ext === '.jsx' || ext === '.js' ? ['jsx'] : ['typescript', 'jsx'];
  try { ast = parse(s, { sourceType: 'module', plugins, errorRecovery: true }); }
  catch (e) { return { ast: null, components: [], elements: [], error: explainError(`line ${e.loc?.line ?? '?'}: ${e.message.replace(/\s*\(\d+:\d+\)$/, '')}`) }; }
  // Top-level declarations by local name.
  const locals = new Map();
  for (const st of ast.program.body) {
    const d = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
    if (!d) continue;
    if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) locals.set(d.id.name, { node: d, componentLike: true });
    if (d.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') locals.set(v.id.name, { node: v, componentLike: componentLike(v.init) });
  }
  const components = [], seen = new Set();
  const add = (exportName, local, isDefault, node) => {
    const info = local ? locals.get(local) : null;
    const decl = node || info?.node;
    if (!decl) return;
    if (!node && !info.componentLike) return;
    if (seen.has(decl)) return; seen.add(decl);
    const name = isDefault ? (local && isCap(local) ? local : 'default') : exportName;
    components.push({ name, exportName: isDefault ? 'default' : exportName, isDefault, start: decl.start, end: decl.end });
  };
  for (const st of ast.program.body) {
    if (st.type === 'ExportNamedDeclaration' && !st.source) {
      const d = st.declaration;
      if (d && (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id && isCap(d.id.name)) add(d.id.name, d.id.name, false);
      if (d && d.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier' && isCap(v.id.name) && componentLike(v.init)) add(v.id.name, v.id.name, false);
      for (const sp of st.specifiers || []) {
        if (sp.type !== 'ExportSpecifier' || sp.exportKind === 'type') continue;
        const exported = sp.exported.name ?? sp.exported.value;
        if (exported === 'default') add('default', sp.local.name, true);
        else if (isCap(exported)) add(exported, sp.local.name, false);
      }
    }
    if (st.type === 'ExportDefaultDeclaration') {
      const d = st.declaration;
      if (d.type === 'Identifier') add('default', d.name, true);
      else if (FN.has(d.type) || componentLike(d)) add('default', d.id?.name || null, true, d);
    }
  }
  // Every JSX element, with its nearest JSX element ancestor as parent (fragments are transparent).
  const elements = [];
  const stack = [];
  const visit = (n) => {
    if (n.type !== 'JSXElement') return;
    const o = n.openingElement;
    const attrs = o.attributes.map((a) => {
      if (a.type === 'JSXSpreadAttribute') return { spread: true, name: '...', lname: '...', start: a.start, end: a.end, valStart: null, valEnd: null, quote: null, value: null };
      const name = jsxName(a.name);
      const v = a.value;
      if (!v) return { name, lname: name, start: a.start, end: a.end, valStart: null, valEnd: null, quote: null, value: null };
      if (v.type === 'StringLiteral') return { name, lname: name, start: a.start, end: a.end, valStart: v.start + 1, valEnd: v.end - 1, quote: s[v.start], value: s.slice(v.start + 1, v.end - 1) };
      return { name, lname: name, start: a.start, end: a.end, valStart: v.start, valEnd: v.end, quote: null, value: s.slice(v.start, v.end), expr: v.type === 'JSXExpressionContainer' ? v.expression : v };
    });
    const textOnly = n.children.every((c) => c.type === 'JSXText');
    // The element's own text runs, in order: plain JSX text, a string written as {"..."}, or a computed {expression}.
    const runs = [];
    for (const c of n.children) {
      if (c.type === 'JSXText') runs.push({ kind: 'text', start: c.start, end: c.end });
      else if (c.type === 'JSXExpressionContainer') {
        const x = c.expression;
        if (x.type === 'JSXEmptyExpression') continue;
        if (x.type === 'StringLiteral') runs.push({ kind: 'string', start: c.start, end: c.end, valStart: x.start + 1, valEnd: x.end - 1, quote: s[x.start] });
        else if (x.type === 'TemplateLiteral' && !x.expressions.length) runs.push({ kind: 'string', start: c.start, end: c.end, valStart: x.start + 1, valEnd: x.end - 1, quote: '`' });
        else if (x.type !== 'JSXElement' && x.type !== 'JSXFragment') runs.push({ kind: 'computed', start: c.start, end: c.end });
      }
    }
    const el = {
      tag: jsxName(o.name), name: jsxName(o.name), start: n.start, openEnd: o.end, closeStart: n.closingElement ? n.closingElement.start : o.end, end: n.end,
      attrs, children: [], parent: stack[stack.length - 1] || null, selfClosing: o.selfClosing, jsx: true, textOnly, jsxRuns: runs, ast: n,
      directChildren: new Set(n.children.filter((c) => c.type === 'JSXElement').map((c) => c.start)),
    };
    // An element passed as a prop (icon={<Icon />}) belongs to its host but is not one of its source children.
    if (el.parent && !el.parent.inAttrs) el.parent.children.push(el);
    else if (el.parent) (el.parent.propElements ||= []).push(el);
    elements.push(el);
    stack.push(el);
    for (const c of n.children) walk(c, inner);
    el.inAttrs = true;
    for (const a of o.attributes) walk(a, inner);
    el.inAttrs = false;
    stack.pop();
    return false;
  };
  const inner = (n) => (n.type === 'JSXElement' ? visit(n) : undefined);
  walk(ast.program, inner);
  return { ast, components, elements, error: null };
}

// The element forest of one component: elements inside its declaration, ids by path within it ("0", "0.2").
export function componentTree(parsed, comp) {
  const roots = parsed.elements.filter((e) => (!e.parent || !(e.parent.start >= comp.start && e.parent.end <= comp.end)) && e.start >= comp.start && e.end <= comp.end);
  const flat = [];
  const assign = (e, id) => { e.id = id; flat.push(e); e.children.forEach((c, i) => assign(c, `${id}.${i}`)); };
  roots.forEach((r, i) => assign(r, String(i)));
  return { roots, flat };
}
