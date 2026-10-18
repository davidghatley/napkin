// F01: the component file format (proposed in docs/decisions/0001-file-format.md).
// Canonical JSON: 2-space indent, keys in the order they were written, trailing newline.
// One style property per line, so one property change is a one-line diff.
// Pure: no Node imports, so the canvas page can load it too.

export function parse(text) {
  const doc = JSON.parse(text);
  if (doc.format !== 'napkin/0') throw new Error('not a napkin/0 file');
  if (!doc.root || typeof doc.root.id !== 'string') throw new Error('missing root node');
  return doc;
}

export function serialize(doc) {
  return JSON.stringify(doc, null, 2) + '\n';
}
