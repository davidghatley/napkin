// Copy gives real code (DREAM moment 10): the exact bytes of an element in its file, and the exact text of the CSS rules
// that apply to it, each with the file and line it lives on. Nothing is rewritten or reformatted: it is a slice of the file.
//   copyPayload(engine, id, node, rules) -> { ok, kind, source, css: [{ file, line, context, text }], text, html }
// `rules` are the rules the browser matched in the frame ([{ file, start, end }] from GET /api/component/<id>/rules): the
// canvas does the matching (element.matches in the frame), the server does the slicing from the file's bytes.
import { fromL } from './source.js';
import { DocError } from './folder.js';

export const MARK = '/* napkin: the CSS that applies */';

export function copyPayload(engine, id, nodeId, rules = [], vars = []) {
  const comp = engine.component(id);
  const t = engine.tree(id);
  const find = (list) => { for (const n of list) { if (n.node === String(nodeId)) return n; const f = find(n.children); if (f) return f; } return null; };
  const n = find(t.tree || []);
  if (!n) throw new DocError(`no element ${nodeId} in ${comp.id}. Next: select the element again`, 404);
  const entry = engine.read(comp.path);
  const source = fromL(entry.s.slice(n.start, n.end));
  const css = [];
  // only rules of this component's own cascade can be asked for, and in the order the cascade has them
  const cascade = new Map(engine.rulesOf(id).rules.map((r) => [`${r.file}:${r.start}:${r.end}`, r]));
  const want = new Set(rules.map((r) => `${r.file}:${r.start}:${r.end}`));
  for (const [key, r] of cascade) {
    if (!want.has(key)) continue;
    const f = engine.read(r.file);
    css.push({ file: r.file, line: r.line, context: r.context, text: fromL(f.s.slice(r.start, r.end)) });
  }
  // custom properties the code uses: where each is defined (the file and line, from the cascade), so the text says what --x is
  const defs = engine.rulesOf(id).vars;
  const used = [...new Set(vars.map(String))].filter((v) => /^--[\w-]+$/.test(v) && defs[v]?.some((d) => !d.inline)).slice(0, 20)
    .map((name) => `${name} (${defs[name].filter((d) => !d.inline).slice(0, 2).map((d) => `${d.file}:${d.line}`).join(', ')})`);
  const label = (c) => `/* ${c.file}:${c.line}${c.context.length ? ' in ' + c.context.join(' ') : ''} */`;
  const tail = used.length ? `\n\n/* custom properties used: ${used.join(', ')} */` : '';
  const text = css.length ? `${source}\n\n${MARK}\n${css.map((c) => `${label(c)}\n${c.text}`).join('\n\n')}${tail}\n` : source;
  return { ok: true, vars: used, component: comp.id, kind: comp.kind, node: n.node, tag: n.tag, file: comp.path, line: n.line, source, css, text };
}
