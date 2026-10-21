// The JSX line that draws one variant cell in an app (INS-03). Pure; the canvas page and `napkin docs` both import it.
//   usageFor(doc, { size: 'sm' }) -> '<Button size="sm" label="Button" />'
// Variant axes appear only when they differ from the base (an omitted prop is its default), then every text setting with its
// default, then boolean settings that are on. Pasted into an app that imports the component, it renders that cell.
const q = (v) => (/["\\{}<>\n]/.test(v) ? `{${JSON.stringify(v)}}` : `"${v}"`);
export function usageFor(doc, variant = {}) {
  const parts = [];
  for (const p of doc.props) if (p.type === 'enum') { const v = variant[p.name] ?? p.default; if (v !== p.default) parts.push(`${p.name}=${q(v)}`); }
  for (const p of doc.props) if (p.type === 'string' && typeof p.default === 'string') parts.push(`${p.name}=${q(p.default)}`);
  for (const p of doc.props) if (p.type === 'boolean' && p.default === true) parts.push(p.name);
  return `<${doc.name}${parts.map((x) => ' ' + x).join('')} />`;
}
