// The label above a card on the canvas (docs/basics/standards.md 3.2): the file's name, then its extension, quieter, in the same type.
// "orbit.html" reads "orbit .html"; "Orbit.tsx" reads "Orbit .tsx". Two files with one name in different folders take their folder
// into the name ("a/Button", "b/Button"); the whole path is the tooltip.
//   cardLabel(c, title) -> { name, ext, path }    (title: ctx.title(c), which says when a name is shared)
export function cardLabel(c, title = c?.name) {
  const path = String(c?.path || (c?.item ? c.name : '') || '').replace(/#.*$/, '');
  if (!path) return { name: c?.name ?? '', ext: '', path: '' };
  const parts = path.split('/'), base = parts.at(-1), dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
  // a component exported under its own name ("Card" from Card.tsx) or a file card: the stem is the name
  const own = c.item || stem === c.name || !c.name;
  const shared = title !== c.name && parts.length > 1; // the same name in more than one folder
  const name = (shared ? `${parts.at(-2)}/` : '') + (own ? stem : c.name);
  return { name, ext: own ? ext : base, path };
}
