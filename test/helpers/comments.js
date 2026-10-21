// Comment tokens in a source text: `// ...` to the end of the line and `/* ... */`. Used by the fuzz tests to check that no edit
// loses or invents a comment.
export const commentTokens = (text) => (text.replace(/\r/g, '').match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || []).filter((t) => !/^\/\/\s*$/.test(t));
const count = (a) => a.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
// Comments in `before` that `after` has fewer of (lost), and tokens it has more of (invented).
export function commentDiff(before, after) {
  const b = count(commentTokens(before)), a = count(commentTokens(after));
  const lost = [], invented = [];
  for (const [t, n] of b) if ((a.get(t) || 0) < n) lost.push(t);
  for (const [t, n] of a) if ((b.get(t) || 0) < n) invented.push(t);
  return { lost, invented };
}
// Edits that delete a line a comment can sit on (a node, a property, a variant value): the comment goes with its owner.
export const mayDropComments = (edit) => edit.op === 'delete' || (edit.op === 'set' && edit.value === null) || edit.op === 'removeVariant' || edit.op === 'removeProp';
