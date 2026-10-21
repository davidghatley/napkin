// Read-only workspace queries (search). Rename, delete and create live in workspace.js and write through commit.js.

// Components and nodes whose name, id, tag or text contain the query (case-insensitive).
export async function search(ws, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const e of ws.entries()) {
    const { doc } = await e.store.read();
    if (e.name.toLowerCase().includes(q)) out.push({ kind: 'component', component: e.id, name: e.name });
    if (!doc) continue;
    (function walk(n) {
      const text = typeof n.text === 'string' ? n.text : null;
      const why = n.id.toLowerCase().includes(q) ? 'id' : n.tag.toLowerCase() === q ? 'tag' : text?.toLowerCase().includes(q) ? 'text' : null;
      if (why) out.push({ kind: 'node', component: e.id, name: e.name, node: n.id, tag: n.tag, ...(text !== null && { text }), match: why });
      for (const c of n.children || []) walk(c);
    })(doc.root);
  }
  return out;
}
