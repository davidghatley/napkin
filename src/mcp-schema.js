// JSON Schema for one edit (src/model.js applyEdits ops), used by the MCP tools. With noGuide the schema is a bare object (eval control arm).
const str = { type: 'string' };
const op = (name, properties, required, description) => ({ type: 'object', description, properties: { op: { const: name }, ...properties }, required: ['op', ...required], additionalProperties: false });
const nodeSchema = { type: 'object', description: 'a node: { id, tag, style?, text?, attrs?, children? }', properties: { id: str, tag: str, style: { type: 'object' }, text: str, attrs: { type: 'object' }, children: { type: 'array' } }, required: ['id', 'tag'] };
// One schema per edit op (see src/model.js applyEdits); an edit that matches none of them is invalid.
export const editItemSchema = (noGuide = false) => noGuide ? { type: 'object' } : { oneOf: [
  op('set', { path: { type: 'string', description: '<nodeId>.<cssProp> | <nodeId>.text | <nodeId>.@src | <nodeId>.@alt | <nodeId>.@when (a true/false prop, or null) | <nodeId>.@slot (a ReactNode prop, or null) | <instanceId>.prop:<name>' }, value: { description: 'null removes the property' }, variant: { type: 'object', description: '{ axis: value }: write a per-variant override instead of the base' } }, ['path', 'value'], 'set a style, text or attribute'),
  op('insert', { parent: str, index: { type: 'integer' }, node: nodeSchema }, ['parent', 'node'], 'insert a node under parent (at index, default last)'),
  op('delete', { id: str }, ['id'], 'delete a node and its children'),
  op('move', { id: str, parent: str, index: { type: 'integer' } }, ['id', 'parent'], 'move a node to parent at index'),
  op('addProp', { name: str, type: { enum: ['string', 'boolean', 'enum', 'number', 'node'] }, options: { type: 'array', items: str }, default: {} }, ['name', 'type'], 'add a setting (an enum prop is a variant axis)'),
  op('removeProp', { name: str }, ['name'], 'remove a setting'),
  op('setDefault', { name: str, value: {} }, ['name', 'value'], 'change a setting\'s default'),
  op('bindText', { id: str, prop: { type: ['string', 'null'] } }, ['id', 'prop'], 'make a node\'s text come from a string prop (null unbinds)'),
  op('addVariant', { axis: str, value: str, base: str }, ['axis', 'value'], 'add a value to a variant axis (creates the axis)'),
  op('insertInstance', { parent: str, index: { type: 'integer' }, id: str, component: str, props: { type: 'object', description: '{ propOfThatComponent: "text" | 3 | true | { prop: "ourProp" } }' }, when: str }, ['parent', 'id', 'component'], 'put another component (a sibling file) under parent; the file must exist'),
  op('swapInstance', { id: str, component: str }, ['id', 'component'], 'make an instance another component; props it lacks are dropped'),
  op('extractComponent', { id: str, component: str }, ['id', 'component'], 'turn a node into an instance of component (its file must already hold the subtree; POST /api/components/:c/extract makes both files)'),
  op('removeVariant', { axis: str, value: str }, ['axis', 'value'], 'remove a variant value and its overrides'),
] };
