// F04: render a napkin/0 document as real HTML/CSS. Pure: no Node imports.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const kebab = (p) => p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export function styleText(style = {}) {
  return Object.entries(style).map(([k, v]) => `${kebab(k)}: ${typeof v === 'number' && k !== 'fontWeight' && k !== 'lineHeight' && k !== 'opacity' ? v + 'px' : v}`).join('; ');
}

export function renderNode(node) {
  const kids = (node.children || []).map(renderNode).join('');
  return `<${node.tag} data-node="${esc(node.id)}" style="${esc(styleText(node.style))}">${node.text !== undefined ? esc(node.text) : ''}${kids}</${node.tag}>`;
}

export function renderDocument(doc) {
  return `<!doctype html><meta charset="utf-8"><title>${esc(doc.name)}</title><body style="margin:24px">${renderNode(doc.root)}</body>`;
}
