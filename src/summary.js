// One short line for a batch of edits: used in history, change frames and proposals.
const val = (v) => (typeof v === 'string' ? JSON.stringify(v.length > 30 ? v.slice(0, 29) + '…' : v) : JSON.stringify(v));
function one(e) {
  switch (e?.op) {
    case 'set': return `${e.path}${e.variant ? ` [${Object.entries(e.variant).map(([a, v]) => `${a}=${v}`).join(' ')}]` : ''} = ${val(e.value)}`;
    case 'insert': return `insert ${e.node?.id ?? 'node'} into ${e.parent}`;
    case 'duplicate': return `duplicate ${e.id}`;
    case 'paste': return `paste ${e.tree?.id ?? 'nodes'} into ${e.parent}`;
    case 'wrap': return `wrap ${(e.ids || []).join(', ')} in ${e.id}`;
    case 'unwrap': return `unwrap ${e.id}`;
    case 'delete': return `delete ${e.id}`;
    case 'move': return `move ${e.id} to ${e.parent}`;
    case 'addProp': return `add prop ${e.name}`;
    case 'removeProp': return `remove prop ${e.name}`;
    case 'setDefault': return `default ${e.name} = ${val(e.value)}`;
    case 'bindText': return e.prop ? `bind ${e.id} text to ${e.prop}` : `unbind ${e.id} text`;
    case 'addVariant': return `add variant ${e.axis}=${e.value}`;
    case 'removeVariant': return `remove variant ${e.axis}=${e.value}`;
    default: return String(e?.op ?? 'edit');
  }
}
export function summarize(edits) {
  if (!Array.isArray(edits) || !edits.length) return 'file changed on disk';
  const parts = edits.slice(0, 3).map(one);
  return parts.join('; ') + (edits.length > 3 ? ` (+${edits.length - 3} more)` : '');
}
